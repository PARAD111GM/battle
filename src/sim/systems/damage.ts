import { COMBAT } from '../../data/combat';
import type { Fighter } from '../types';
import type { World } from '../World';

export function applyDamage(world: World, target: Fighter, amount: number, owner: number, knockback: number, angle: number, kind: string): boolean {
  if (!target.alive || target.invulnerableTicks > 0 || amount <= 0) return false;
  const source = world.fighters.find(fighter => fighter.id === owner);
  if (target.action === 'block' && kind === 'melee' && source && (source.x - target.x) * target.facing >= 0) {
    target.combat.blockMeter = Math.max(0, target.combat.blockMeter - amount * COMBAT.guardDamageMultiplier);
    world.events.push({ type: 'block', fighterId: target.id, x: target.x, y: target.y, amount });
    if (target.combat.blockMeter > 0) return false;
    target.combat.stunTicks = COMBAT.guardBreakTicks;
    target.action = 'stunned';
    world.events.push({ type: 'guard-break', fighterId: target.id, x: target.x, y: target.y });
  }
  target.hp = Math.max(0, target.hp - amount);
  target.damage += amount;
  target.combat.specialMeter = Math.min(100, target.combat.specialMeter + amount * 0.45);
  target.combat.lastHitBy = owner;
  target.combat.lastHitTick = world.tick;
  target.combat.stunTicks = Math.max(target.combat.stunTicks, Math.min(35, Math.round(COMBAT.hitstunTicks + amount * 0.35)));
  target.combat.pendingAttack = '';
  target.combat.attackBufferTicks = 0;
  target.combat.grabTarget = null;
  target.climbing = false;
  target.ledge = null;
  target.grounded = false;
  target.action = 'stunned';
  target.actionTicks = target.combat.stunTicks;
  const force = knockback * (1 + target.damage / 180);
  target.vx = Math.cos(angle) * force;
  target.vy = Math.sin(angle) * force - 90;
  if (source && source !== target) {
    source.combat.damageDealt += amount;
    source.combat.specialMeter = Math.min(100, source.combat.specialMeter + amount * 0.7);
    if (kind === 'bullet') source.combat.hits++;
  }
  world.events.push({ type: 'hit', fighterId: target.id, x: target.x, y: target.y, amount, intensity: Math.min(1, amount / 30), color: target.color });
  if (target.hp <= 0) world.knockout(target, owner, 'knockout');
  return true;
}
