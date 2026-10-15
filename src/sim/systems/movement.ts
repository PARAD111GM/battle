import { TUNING } from '../../data/tuning';
import { SPECIALS } from '../../data/combat';
import { hasGroundSupport, moveAndCollide, overlapsTerrain } from '../physics/aabb';
import type { TileMap } from '../terrain/TileMap';
import type { ArenaProp, Fighter, InputCommand, SimEvent } from '../types';

const M = TUNING.movement;
const approach = (value: number, target: number, amount: number): number => value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
const clampAxis = (value: number): number => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
const isPlatform = (prop: ArenaProp): boolean => ['moving-platform', 'movingPlatform', 'platform', 'elevator'].includes(prop.type);

function platformSupport(fighter: Fighter, props: ArenaProp[]): boolean {
  return props.some(prop => isPlatform(prop) && Math.abs(fighter.y + fighter.height / 2 - prop.y) <= 0.75
    && fighter.x + fighter.width / 2 > prop.x && fighter.x - fighter.width / 2 < prop.x + prop.width);
}

function moveFighter(fighter: Fighter, map: TileMap, props: ArenaProp[], dt: number): ReturnType<typeof moveAndCollide> {
  const oldFeet = fighter.y + fighter.height / 2, wasGrounded = fighter.grounded;
  const result = moveAndCollide(fighter, map, dt);
  if (fighter.vy >= 0) {
    let top = Infinity;
    for (const prop of props) {
      if (!isPlatform(prop) || oldFeet > prop.y + 0.75 || fighter.y + fighter.height / 2 < prop.y - 0.001) continue;
      if (fighter.x + fighter.width / 2 <= prop.x || fighter.x - fighter.width / 2 >= prop.x + prop.width) continue;
      if (!overlapsTerrain(map, fighter.x, prop.y - fighter.height / 2, fighter.width, fighter.height)) top = Math.min(top, prop.y);
    }
    if (top < Infinity) {
      fighter.y = top - fighter.height / 2; fighter.vy = 0; fighter.grounded = true;
      result.landed = !wasGrounded;
    }
  }
  return result;
}

function nearbyClimbable(fighter: Fighter, props: ArenaProp[]): ArenaProp | undefined {
  return props.find(prop => (prop.type === 'ladder' || prop.type === 'rope')
    && Math.abs(fighter.x - (prop.x + prop.width / 2)) <= fighter.width / 2 + prop.width / 2 + 5
    && fighter.y + fighter.height / 2 > prop.y
    && fighter.y - fighter.height / 2 < prop.y + prop.height);
}

function jump(fighter: Fighter, command: InputCommand, events: SimEvent[], speed: number = M.jumpSpeed): void {
  const actionBeforeJump = fighter.action;
  fighter.vy = -speed * (command.jump ? 1 : M.jumpCut);
  fighter.grounded = false;
  fighter.climbing = false;
  fighter.ledge = null;
  fighter.coyoteTicks = 0;
  fighter.jumpBufferTicks = 0;
  fighter.climbCooldownTicks = M.climbJumpLockTicks;
  fighter.action = actionBeforeJump.startsWith('melee-') || ['shoot', 'reload', 'throw-windup', 'throw-recovery', 'special'].includes(actionBeforeJump) ? actionBeforeJump : 'jump';
  events.push({ type: 'jump', fighterId: fighter.id, x: fighter.x, y: fighter.y + fighter.height / 2 });
}

function tryGrabLedge(fighter: Fighter, map: TileMap, moveX: number, moveY: number, events: SimEvent[]): void {
  if (fighter.grounded || fighter.vy < 0 || fighter.climbing || fighter.climbCooldownTicks > 0 || fighter.action === 'roll' || moveY > 0.25 || moveX * fighter.facing < -0.2) return;
  const side = fighter.x + fighter.facing * (fighter.width / 2 + M.ledgeReach);
  const head = fighter.y - fighter.height / 2;
  const col = Math.floor(side / map.tileSize);
  const startRow = Math.floor((head - M.ledgeReach) / map.tileSize);
  const endRow = Math.floor((head + M.ledgeReach) / map.tileSize);
  for (let row = startRow; row <= endRow; row++) {
    if (!map.isSolid(col, row) || map.isSolid(col, row - 1)) continue;
    const x = (col + (fighter.facing < 0 ? 1 : 0)) * map.tileSize;
    const y = row * map.tileSize;
    if (Math.abs(head - y) > M.ledgeReach) continue;
    const hangX = x - fighter.facing * (fighter.width / 2 + 0.01);
    const hangY = y + fighter.height / 2 - 5;
    if (Math.abs(hangX - fighter.x) > M.ledgeReach + 0.1 || overlapsTerrain(map, hangX, hangY, fighter.width, fighter.height)) continue;
    fighter.x = hangX;
    fighter.y = hangY;
    fighter.vx = fighter.vy = 0;
    fighter.ledge = { x, y };
    fighter.action = 'hang';
    events.push({ type: 'ledge', fighterId: fighter.id, x, y });
    return;
  }
}

/** One fixed tick of locomotion. No rendering, wall clock, or browser dependencies. */
export function stepMovement(fighter: Fighter, command: InputCommand, map: TileMap, props: ArenaProp[], events: SimEvent[]): void {
  const speedScale = fighter.speedScale ?? 1;
  const movementDt = TUNING.dt * (fighter.combat.slowTicks > 0 ? SPECIALS.slowScale : 1);
  const moveX = clampAxis(command.moveX);
  const moveY = clampAxis(command.moveY);
  const jumpPressed = command.jump && !fighter.jumpHeld;
  const jumpReleased = !command.jump && fighter.jumpHeld;
  const rollPressed = command.roll && !fighter.rollHeld;
  fighter.jumpHeld = command.jump;
  fighter.rollHeld = command.roll;
  fighter.rollCooldown = Math.max(0, fighter.rollCooldown - 1);
  fighter.invulnerableTicks = Math.max(0, fighter.invulnerableTicks - 1);
  fighter.climbCooldownTicks = Math.max(0, fighter.climbCooldownTicks - 1);
  fighter.jumpBufferTicks = jumpPressed ? M.jumpBufferTicks : Math.max(0, fighter.jumpBufferTicks - 1);
  fighter.grounded = fighter.vy >= 0 && (hasGroundSupport(fighter, map) || platformSupport(fighter, props));
  fighter.coyoteTicks = fighter.grounded ? M.coyoteTicks : Math.max(0, fighter.coyoteTicks - 1);

  if (fighter.combat.stunTicks > 0) {
    fighter.climbing = false;
    fighter.ledge = null;
    fighter.action = 'stunned';
    fighter.vx *= fighter.grounded ? 0.87 : 0.993;
    fighter.vy = Math.min(fighter.vy + M.gravity * movementDt, M.maxFallSpeed);
    moveFighter(fighter, map, props, movementDt);
    return;
  }
  const combatAction = fighter.action.startsWith('melee-') || ['shoot', 'reload', 'throw-windup', 'throw-recovery', 'block', 'special'].includes(fighter.action);

  if (fighter.ledge) {
    const ledge = fighter.ledge;
    if (jumpPressed) {
      jump(fighter, command, events, M.ledgeJumpSpeed);
      fighter.vx = moveX * (M.runSpeed * speedScale);
    } else if (moveY < -0.25) {
      const standX = ledge.x + fighter.facing * (fighter.width / 2 + 1);
      const standY = ledge.y - fighter.height / 2;
      if (!overlapsTerrain(map, standX, standY, fighter.width, fighter.height)) {
        fighter.x = standX; fighter.y = standY;
        fighter.ledge = null; fighter.grounded = true; fighter.action = 'idle';
        fighter.climbCooldownTicks = M.ledgeClimbLockTicks;
      }
      return;
    } else if (moveY > 0.25 || moveX * fighter.facing < -0.25) {
      fighter.ledge = null;
      fighter.action = 'fall';
      fighter.climbCooldownTicks = M.ledgeDropLockTicks;
      fighter.vx = moveX * (M.runSpeed * speedScale);
    } else {
      fighter.vx = fighter.vy = 0;
      fighter.action = 'hang';
      return;
    }
  }

  if (moveX !== 0 && fighter.action !== 'roll') fighter.facing = Math.sign(moveX);
  const climbable = nearbyClimbable(fighter, props);
  if (!combatAction && !fighter.climbing && fighter.action !== 'roll' && fighter.climbCooldownTicks === 0 && fighter.vy >= 0 && !jumpPressed && Math.abs(moveY) > 0.25 && climbable) {
    fighter.climbing = true;
    fighter.ledge = null;
  }
  if (fighter.climbing) {
    if (!climbable || (Math.abs(moveX) > 0.25 && Math.abs(moveY) < 0.25)) {
      fighter.climbing = false;
      fighter.climbCooldownTicks = M.climbDetachLockTicks;
    } else if (jumpPressed) {
      jump(fighter, command, events);
      fighter.vx = moveX * (M.runSpeed * speedScale);
    } else {
      fighter.action = 'climb';
      fighter.grounded = false;
      fighter.vx = (approach(fighter.x, climbable.x + climbable.width / 2, (M.climbSpeed * speedScale) * movementDt) - fighter.x) / movementDt;
      fighter.vy = moveY * (M.climbSpeed * speedScale);
      moveFighter(fighter, map, props, movementDt);
      if (fighter.grounded && moveY > 0.25) {
        fighter.climbing = false;
        fighter.action = 'idle';
        fighter.climbCooldownTicks = M.climbDetachLockTicks;
      }
      return;
    }
  }

  if (fighter.action === 'roll') {
    fighter.actionTicks = Math.max(0, fighter.actionTicks - 1);
    if (fighter.actionTicks === 0) fighter.action = fighter.grounded ? 'idle' : 'fall';
  }
  if (!combatAction && rollPressed && fighter.rollCooldown === 0 && fighter.grounded && fighter.action !== 'roll') {
    fighter.action = 'roll';
    fighter.actionTicks = M.rollTicks;
    fighter.rollCooldown = M.rollCooldownTicks;
    fighter.invulnerableTicks = Math.max(fighter.invulnerableTicks, M.rollInvulnerableTicks);
    events.push({ type: 'roll', fighterId: fighter.id, x: fighter.x, y: fighter.y });
  }
  if (fighter.action === 'roll') {
    fighter.vx = fighter.facing * (M.rollSpeed * speedScale);
  } else {
    const acceleration = fighter.grounded ? M.acceleration : M.airAcceleration;
    const dashActive = fighter.special === 'bullet-time' && fighter.combat.specialPhase === 'dash';
    fighter.vx = dashActive ? fighter.combat.aimX * SPECIALS.dashSpeed : approach(fighter.vx, moveX * (M.runSpeed * speedScale), (moveX === 0 && fighter.grounded ? M.friction : acceleration) * movementDt);
    if (fighter.jumpBufferTicks > 0 && (fighter.grounded || fighter.coyoteTicks > 0)) jump(fighter, command, events);
  }
  if (jumpReleased && fighter.vy < 0) fighter.vy *= M.jumpCut;
  const fastFalling = moveY > 0.5 && fighter.vy >= 0;
  const gravityMultiplier = fastFalling ? M.fastFallMultiplier : 1;
  fighter.vy = Math.min(fighter.vy + M.gravity * gravityMultiplier * movementDt, M.maxFallSpeed * gravityMultiplier);
  const landingSpeed = fighter.vy;
  const collision = moveFighter(fighter, map, props, movementDt);
  if (collision.landed) {
    events.push({ type: 'land', fighterId: fighter.id, x: fighter.x, y: fighter.y + fighter.height / 2, intensity: Math.min(1, landingSpeed / M.maxFallSpeed) });
    if (fighter.jumpBufferTicks > 0 && fighter.action !== 'roll') jump(fighter, command, events);
  }
  if (fighter.action !== 'roll' && !combatAction) {
    fighter.action = fighter.grounded ? (Math.abs(fighter.vx) > 10 ? 'run' : 'idle') : (fighter.vy < 0 ? 'jump' : 'fall');
    tryGrabLedge(fighter, map, moveX, moveY, events);
  }
}
