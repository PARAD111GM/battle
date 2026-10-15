import { COMBAT, GRENADE, type AttackDefinition } from '../../data/combat';
import { TUNING } from '../../data/tuning';
import { releaseHeldProp, tryGrabProp } from '../entities/props';
import { overlapsTerrain } from '../physics/aabb';
import type { Fighter, InputCommand } from '../types';
import type { World } from '../World';
import { equippedWeapon, WEAPONS } from '../weapons/definitions';
import { fireGun, hasLineOfSight, startReload, throwGrenade, tryPickup } from '../weapons/firearms';
import type { WeaponSlot } from '../weapons/types';

function attackDefinition(fighter: Fighter): AttackDefinition | undefined {
  return (COMBAT.attacks as Record<string, AttackDefinition>)[fighter.combat.pendingAttack];
}

function startMelee(fighter: Fighter, command: InputCommand, world: World): void {
  const combat = fighter.combat;
  fighter.climbing = false;
  fighter.ledge = null;
  fighter.climbCooldownTicks = Math.max(fighter.climbCooldownTicks, 12);
  let attack: string;
  if (command.moveY < -0.3) { attack = 'uppercut'; combat.meleeStage = 0; }
  else if (!fighter.grounded && command.moveY > 0.3) { attack = 'divekick'; combat.meleeStage = 0; fighter.vy = Math.max(fighter.vy, 600); }
  else { combat.meleeStage = combat.comboWindow > 0 ? combat.meleeStage % 3 + 1 : 1; attack = `jab${combat.meleeStage}`; }
  combat.pendingAttack = attack;
  combat.hitTargets = [];
  combat.hitProps = [];
  combat.hitTiles = [];
  combat.attackBufferTicks = 0;
  const definition = attackDefinition(fighter)!;
  combat.comboWindow = COMBAT.comboWindowTicks + definition.windupTicks + definition.activeTicks + definition.recoveryTicks;
  fighter.action = 'melee-windup'; fighter.actionTicks = definition.windupTicks;
  world.events.push({ type: 'melee', fighterId: fighter.id, x: fighter.x, y: fighter.y, text: attack });
}

function progressAction(fighter: Fighter): void {
  if (!fighter.action.startsWith('melee-') && !['shoot', 'throw-recovery', 'stunned'].includes(fighter.action)) return;
  if (fighter.actionTicks > 0) fighter.actionTicks--;
  const attack = attackDefinition(fighter);
  if (fighter.actionTicks > 0) return;
  if (fighter.action === 'melee-windup' && attack) { fighter.action = 'melee-active'; fighter.actionTicks = attack.activeTicks; }
  else if (fighter.action === 'melee-active' && attack) { fighter.action = 'melee-recovery'; fighter.actionTicks = attack.recoveryTicks; }
  else if (fighter.action === 'melee-recovery' || fighter.action === 'shoot' || fighter.action === 'throw-recovery' || fighter.action === 'stunned') {
    fighter.action = fighter.grounded ? 'idle' : 'fall';
    fighter.combat.pendingAttack = '';
  }
}

function holdGrab(world: World, fighter: Fighter, attackPressed: boolean): boolean {
  const combat = fighter.combat;
  if (combat.grabTarget === null) return false;
  const target = world.fighters.find(other => other.id === combat.grabTarget && other.alive);
  if (!target || --combat.grabTicks <= 0) { combat.grabTarget = null; fighter.action = 'idle'; return false; }
  const heldX = fighter.x + fighter.facing * (fighter.width + 8);
  if (!overlapsTerrain(world.terrain, heldX, fighter.y, target.width, target.height)) {
    target.x = heldX;
    target.y = fighter.y;
  }
  target.vx = target.vy = 0;
  target.combat.stunTicks = Math.max(2, target.combat.stunTicks);
  target.action = 'stunned';
  if (attackPressed) {
    world.damageFighter(target, COMBAT.grabDamage, fighter.id, COMBAT.grabKnockback, fighter.facing > 0 ? -0.45 : Math.PI + 0.45, 'grab');
    combat.grabTarget = null;
    combat.attackBufferTicks = 0;
    combat.pendingAttack = 'grab-throw';
    fighter.action = 'melee-recovery'; fighter.actionTicks = 16;
    world.events.push({ type: 'throw', fighterId: fighter.id, x: target.x, y: target.y, text: 'grab-throw' });
  }
  return true;
}

export function stepCombat(world: World, fighter: Fighter, command: InputCommand): void {
  const combat = fighter.combat;
  const shootPressed = command.shoot && !combat.shootHeld;
  const attackPressed = (command.attack && !combat.attackHeld) || (combat.equipped === 'melee' && shootPressed);
  const interactPressed = command.interact && !combat.interactHeld;
  const throwReleased = !command.throw && combat.throwHeld;
  const throwPressed = command.throw && !combat.throwHeld;
  const switchPressed = command.switchWeapon !== 0 && !combat.switchHeld;
  combat.attackHeld = command.attack;
  combat.shootHeld = command.shoot;
  combat.interactHeld = command.interact;
  combat.switchHeld = command.switchWeapon !== 0;
  combat.throwHeld = command.throw;
  combat.attackBufferTicks = attackPressed ? COMBAT.attackBufferTicks : Math.max(0, combat.attackBufferTicks - 1);
  combat.cooldown = Math.max(0, combat.cooldown - 1);
  combat.comboWindow = Math.max(0, combat.comboWindow - 1);
  if (fighter.action !== 'block') combat.blockMeter = Math.min(COMBAT.guardMaximum, combat.blockMeter + COMBAT.guardRegenPerTick);
  const aimLength = Math.hypot(command.aimX, command.aimY);
  if (Number.isFinite(aimLength) && aimLength > 0.1) { combat.aimX = command.aimX / aimLength; combat.aimY = command.aimY / aimLength; }

  if (combat.stunTicks > 0) {
    if (combat.heldProp !== null) releaseHeldProp(world, fighter, false);
    combat.stunTicks--;
    combat.grabTarget = null;
    if (combat.cookTicks > 0) throwGrenade(world, fighter);
    fighter.action = 'stunned'; fighter.actionTicks = combat.stunTicks;
    return;
  }
  if (combat.heldProp !== null) {
    if (attackPressed || throwPressed) {
      releaseHeldProp(world, fighter, true);
      combat.attackBufferTicks = 0;
      fighter.action = 'throw-recovery'; fighter.actionTicks = GRENADE.throwRecoveryTicks;
    }
    return;
  }
  if (holdGrab(world, fighter, attackPressed)) return;
  if (switchPressed) {
    const slots: WeaponSlot[] = ['primary', 'sidearm', 'melee'];
    combat.equipped = command.switchWeapon === 1 ? slots[(slots.indexOf(combat.equipped) + 1) % slots.length] : slots[Math.max(0, Math.min(2, command.switchWeapon - 2))];
    combat.reloadTicks = 0;
    if (fighter.action === 'reload') fighter.action = 'idle';
  }
  if (combat.reloadTicks > 0) {
    combat.reloadTicks--;
    if (combat.reloadTicks === 0) {
      const id = equippedWeapon(combat), weapon = WEAPONS[id];
      if (weapon) {
        const transfer = Math.min(weapon.magazine - combat.ammo[id], combat.reserve[id]);
        combat.ammo[id] += transfer; combat.reserve[id] -= transfer;
      }
      fighter.action = fighter.grounded ? 'idle' : 'fall';
    }
  }
  progressAction(fighter);
  const busy = fighter.action.startsWith('melee-') || fighter.action === 'roll' || fighter.action === 'throw-recovery';
  if (interactPressed && !busy && combat.cookTicks === 0) {
    const target = world.fighters.find(other => other !== fighter && other.alive && other.invulnerableTicks === 0 && Math.hypot(other.x - fighter.x, other.y - fighter.y) < COMBAT.grabRange);
    if (target) {
      combat.grabTarget = target.id; combat.grabTicks = COMBAT.grabDurationTicks;
      fighter.action = 'throw-windup'; fighter.actionTicks = COMBAT.grabDurationTicks;
      target.combat.stunTicks = 2; target.action = 'stunned';
      world.events.push({ type: 'grab', fighterId: fighter.id, x: target.x, y: target.y });
      return;
    }
    if (tryGrabProp(world, fighter)) return;
    if (!tryPickup(world, fighter)) startReload(world, fighter);
  }
  if (!busy && combat.reloadTicks === 0) {
    if (command.throw && (combat.cookTicks > 0 || throwPressed) && combat.throwableCount > 0) {
      combat.cookTicks++;
      fighter.action = 'throw-windup'; fighter.actionTicks = GRENADE.fuseTicks - combat.cookTicks;
      if (combat.cookTicks >= GRENADE.fuseTicks) {
        combat.throwableCount--; combat.cookTicks = 0;
        world.explode(fighter.x, fighter.y, GRENADE.blastRadius, GRENADE.damage, fighter.id);
      }
      return;
    }
    if (throwReleased && combat.cookTicks > 0) { throwGrenade(world, fighter); return; }
    if (command.block && fighter.grounded && combat.blockMeter > 0) { fighter.action = 'block'; fighter.vx *= 0.65; return; }
    if (fighter.action === 'block' || fighter.action === 'throw-windup') fighter.action = fighter.grounded ? 'idle' : 'fall';
    if (combat.attackBufferTicks > 0) startMelee(fighter, command, world);
    else if (command.shoot) {
      if (Math.abs(combat.aimX) > 0.1) fighter.facing = Math.sign(combat.aimX);
      if (combat.equipped === 'melee') { if (attackPressed) startMelee(fighter, command, world); }
      else fireGun(world, fighter);
    }
  }
  if (fighter.action === 'melee-active') {
    const attack = attackDefinition(fighter);
    if (attack) world.hitboxes.push({ owner: fighter.id, x: fighter.x + fighter.facing * attack.offsetX, y: fighter.y + attack.offsetY,
      width: attack.width, height: attack.height, damage: attack.damage, knockback: attack.knockback,
      angle: fighter.facing > 0 ? attack.angle : Math.PI - attack.angle, kind: 'melee' });
  }
}

export function resolveMelee(world: World): void {
  for (const hitbox of world.hitboxes) {
    const owner = world.fighters.find(fighter => fighter.id === hitbox.owner);
    if (!owner?.alive) continue;
    const size = world.terrain.tileSize;
    for (let row = Math.floor((hitbox.y - hitbox.height / 2) / size); row <= Math.floor((hitbox.y + hitbox.height / 2) / size); row++) {
      for (let col = Math.floor((hitbox.x - hitbox.width / 2) / size); col <= Math.floor((hitbox.x + hitbox.width / 2) / size); col++) {
        const key = `${col},${row}`;
        if (!world.terrain.isSolid(col, row) || owner.combat.hitTiles.includes(key)) continue;
        owner.combat.hitTiles.push(key);
        world.damageTerrain(col, row, TUNING.props.meleeTerrainPower, owner.id);
      }
    }
    for (const prop of world.props) {
      if (!prop.active || !prop.dynamic || owner.combat.hitProps.includes(prop.id)) continue;
      if (Math.abs(prop.x - hitbox.x) > (prop.width + hitbox.width) / 2 || Math.abs(prop.y - hitbox.y) > (prop.height + hitbox.height) / 2) continue;
      owner.combat.hitProps.push(prop.id);
      world.damageProp(prop, hitbox.damage, owner.id);
    }
    for (const target of world.fighters) {
      if (target === owner || !target.alive || owner.combat.hitTargets.includes(target.id)) continue;
      if (Math.abs(target.x - hitbox.x) > (target.width + hitbox.width) / 2 || Math.abs(target.y - hitbox.y) > (target.height + hitbox.height) / 2) continue;
      if (!hasLineOfSight(world, owner.x, owner.y, target.x, target.y)) continue;
      owner.combat.hitTargets.push(target.id);
      world.damageFighter(target, hitbox.damage, owner.id, hitbox.knockback, hitbox.angle, hitbox.kind);
    }
  }
}
