import { SPECIALS } from '../../data/combat';
import type { Fighter } from '../types';
import type { World } from '../World';

export function activateSpecial(world: World, fighter: Fighter): boolean {
  const combat = fighter.combat;
  if (combat.specialMeter < SPECIALS.meter) return false;
  combat.specialMeter = 0;
  fighter.action = 'special'; fighter.actionTicks = 18;
  combat.pendingAttack = '';
  world.events.push({ type: 'special', fighterId: fighter.id, x: fighter.x, y: fighter.y, text: fighter.special, color: fighter.color });
  if (fighter.special === 'slam') {
    combat.specialPhase = 'rise';
    combat.specialTicks = SPECIALS.slamWindupTicks;
    fighter.actionTicks = 120;
    fighter.vy = fighter.grounded ? -SPECIALS.slamLeapSpeed : Math.min(-230, fighter.vy);
    fighter.grounded = false;
    fighter.climbing = false;
    fighter.ledge = null;
  } else if (fighter.special === 'bullet-time') {
    combat.specialPhase = 'dash';
    combat.specialTicks = SPECIALS.slowTicks;
    fighter.actionTicks = SPECIALS.dashTicks;
    fighter.vx = combat.aimX * SPECIALS.dashSpeed;
    world.effects.push({ id: world.tick * 100 + fighter.id, kind: 'slow', x: fighter.x, y: fighter.y, radius: SPECIALS.slowRadius, life: SPECIALS.slowTicks, owner: fighter.id });
  } else if (fighter.special === 'air-strike') {
    const targetX = fighter.x + combat.aimX * 280, targetY = fighter.y + combat.aimY * 180;
    for (let strike = -1; strike <= 1; strike++) world.effects.push({ id: world.tick * 100 + fighter.id * 3 + strike, kind: 'air-strike', x: targetX + strike * 85, y: targetY, radius: SPECIALS.airStrikeRadius, life: SPECIALS.airStrikeDelay + (strike + 1) * 8, owner: fighter.id });
  } else if (fighter.special === 'shield-wall') {
    const data = { id: world.tick * 100 + fighter.id, owner: fighter.id, team: fighter.team, x: fighter.x + fighter.facing * 58, y: fighter.y - 16, width: 14, height: 106, hp: SPECIALS.shieldHp, life: SPECIALS.shieldTicks, active: true };
    const old = world.barriers.find(barrier => !barrier.active);
    if (old) Object.assign(old, data); else if (world.barriers.length < 16) world.barriers.push(data);
  }
  if (world.effects.length > 64) world.effects.splice(0, world.effects.length - 64);
  return true;
}

export function stepSpecial(world: World, fighter: Fighter): void {
  const combat = fighter.combat;
  if (fighter.special === 'slam' && combat.specialPhase) {
    if (combat.specialPhase === 'rise') {
      combat.specialTicks--;
      if (combat.specialTicks <= 0) { combat.specialPhase = 'crash'; fighter.vy = SPECIALS.slamCrashSpeed; }
    }
    if (combat.specialPhase !== 'crash' || !fighter.grounded) return;
    combat.specialPhase = ''; combat.specialTicks = 0;
    fighter.actionTicks = 14;
    const immunity = fighter.invulnerableTicks;
    fighter.invulnerableTicks = Math.max(1, immunity);
    world.explode(fighter.x, fighter.y + fighter.height / 2, SPECIALS.slamRadius, SPECIALS.slamDamage, fighter.id);
    fighter.invulnerableTicks = immunity;
    world.events.push({ type: 'slam', fighterId: fighter.id, x: fighter.x, y: fighter.y + fighter.height / 2, amount: SPECIALS.slamRadius, intensity: 1 });
    return;
  }
  if (combat.specialTicks <= 0) return;
  combat.specialTicks--;
  if (fighter.special === 'bullet-time' && combat.specialTicks <= SPECIALS.slowTicks - SPECIALS.dashTicks) combat.specialPhase = combat.specialTicks > 0 ? 'focus' : '';
}
