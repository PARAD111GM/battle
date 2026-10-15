import { TUNING } from '../../data/tuning';
import { COMBAT, GRENADE } from '../../data/combat';
import { overlapsTerrain } from '../physics/aabb';
import type { Fighter } from '../types';
import type { World } from '../World';
import { equippedWeapon, WEAPONS } from './definitions';
import type { Projectile } from './types';

/** Returns entry distance of a ray into a fighter's AABB, or Infinity. */
function rayBody(x: number, y: number, dx: number, dy: number, fighter: Fighter): number {
  let near = 0, far = Infinity;
  for (const [origin, direction, min, max] of [[x, dx, fighter.x - fighter.width / 2, fighter.x + fighter.width / 2], [y, dy, fighter.y - fighter.height / 2, fighter.y + fighter.height / 2]]) {
    if (Math.abs(direction) < 1e-9) { if (origin < min || origin > max) return Infinity; continue; }
    const a = (min - origin) / direction, b = (max - origin) / direction;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (near > far) return Infinity;
  }
  return far >= 0 ? near : Infinity;
}

/** Grid DDA visits each crossed tile; it cannot skip a thin wall at any range. */
function rayTerrain(world: World, x: number, y: number, dx: number, dy: number, range: number): number {
  const size = world.terrain.tileSize;
  let col = Math.floor(x / size), row = Math.floor(y / size), distance = 0;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : Math.abs(size / dx), deltaY = dy === 0 ? Infinity : Math.abs(size / dy);
  let nextX = dx === 0 ? Infinity : ((col + (sx > 0 ? 1 : 0)) * size - x) / dx;
  let nextY = dy === 0 ? Infinity : ((row + (sy > 0 ? 1 : 0)) * size - y) / dy;
  while (distance <= range) {
    if (world.terrain.isSolid(col, row)) return Math.max(0, distance);
    if (nextX < nextY) { distance = nextX; nextX += deltaX; col += sx; }
    else { distance = nextY; nextY += deltaY; row += sy; }
  }
  return range;
}

export function startReload(world: World, fighter: Fighter): boolean {
  const id = equippedWeapon(fighter.combat), weapon = WEAPONS[id];
  if (!weapon || weapon.kind !== 'gun' || fighter.combat.reloadTicks > 0 || fighter.combat.ammo[id] >= weapon.magazine || fighter.combat.reserve[id] <= 0) return false;
  fighter.combat.reloadTicks = weapon.reloadTicks;
  fighter.action = 'reload'; fighter.actionTicks = weapon.reloadTicks;
  world.events.push({ type: 'reload', fighterId: fighter.id, x: fighter.x, y: fighter.y, weapon: id });
  return true;
}

export function fireGun(world: World, fighter: Fighter): void {
  const combat = fighter.combat, id = equippedWeapon(combat), weapon = WEAPONS[id];
  if (!weapon || weapon.kind !== 'gun' || combat.cooldown > 0 || combat.reloadTicks > 0) return;
  if (combat.ammo[id] <= 0) { startReload(world, fighter); return; }
  combat.ammo[id]--; combat.cooldown = weapon.cooldownTicks; combat.shots++;
  fighter.action = 'shoot'; fighter.actionTicks = Math.min(8, weapon.cooldownTicks);
  const originX = fighter.x, originY = fighter.y - 7;
  const baseAngle = Math.atan2(combat.aimY, combat.aimX);
  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    const angle = baseAngle + world.rng.range(-weapon.spread, weapon.spread) * (fighter.grounded ? 1 : 1.4);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let distance = rayTerrain(world, originX, originY, dx, dy, weapon.range);
    let target: Fighter | undefined;
    for (const other of world.fighters) {
      if (other === fighter || !other.alive) continue;
      const entry = rayBody(originX, originY, dx, dy, other);
      if (entry < distance) { distance = entry; target = other; }
    }
    if (target) world.damageFighter(target, weapon.damage, fighter.id, id === 'shotgun' ? 90 : 130, angle, 'bullet');
    world.events.push({ type: 'shot', fighterId: fighter.id, x: originX + dx * Math.min(18, distance), y: originY + dy * Math.min(18, distance), endX: originX + dx * distance, endY: originY + dy * distance, weapon: id, amount: weapon.damage });
  }
  fighter.vx -= combat.aimX * weapon.recoil;
  fighter.vy -= combat.aimY * weapon.recoil;
  if (combat.ammo[id] === 0) startReload(world, fighter);
}

export function throwGrenade(world: World, fighter: Fighter): void {
  const combat = fighter.combat;
  if (combat.throwableCount <= 0) return;
  combat.throwableCount--;
  const data: Projectile = { active: true, id: world.tick * 100 + fighter.id, kind: 'grenade', owner: fighter.id, weapon: 'grenade',
    x: fighter.x + combat.aimX * 22, y: fighter.y - 8 + combat.aimY * 22,
    vx: combat.aimX * GRENADE.speed + fighter.vx * 0.45, vy: combat.aimY * GRENADE.speed - 170,
    radius: GRENADE.radius, life: Math.max(1, GRENADE.fuseTicks - combat.cookTicks), damage: GRENADE.damage, blastRadius: GRENADE.blastRadius };
  // A wall immediately beside the muzzle must not allow a grenade to spawn through it.
  if (overlapsTerrain(world.terrain, data.x, data.y, data.radius * 2, data.radius * 2)) { data.x = fighter.x; data.y = fighter.y - 8; data.vx *= -0.25; }
  const reused = world.projectiles.find(projectile => !projectile.active);
  if (reused) Object.assign(reused, data);
  else if (world.projectiles.length < 128) world.projectiles.push(data);
  combat.cookTicks = 0;
  fighter.action = 'throw-recovery'; fighter.actionTicks = GRENADE.throwRecoveryTicks;
  world.events.push({ type: 'throw', fighterId: fighter.id, x: data.x, y: data.y, weapon: 'grenade' });
}

export function stepProjectiles(world: World): void {
  for (const projectile of world.projectiles) {
    if (!projectile.active) continue;
    projectile.life--;
    if (projectile.life <= 0) {
      projectile.active = false;
      world.explode(projectile.x, projectile.y, projectile.blastRadius, projectile.damage, projectile.owner);
      continue;
    }
    projectile.vy += GRENADE.gravity * TUNING.dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(projectile.vx), Math.abs(projectile.vy)) * TUNING.dt / (world.terrain.tileSize / 3)));
    const dt = TUNING.dt / steps;
    for (let i = 0; i < steps; i++) {
      const oldX = projectile.x; projectile.x += projectile.vx * dt;
      if (overlapsTerrain(world.terrain, projectile.x, projectile.y, projectile.radius * 2, projectile.radius * 2)) { projectile.x = oldX; projectile.vx *= -GRENADE.bounce; }
      const oldY = projectile.y; projectile.y += projectile.vy * dt;
      if (overlapsTerrain(world.terrain, projectile.x, projectile.y, projectile.radius * 2, projectile.radius * 2)) { projectile.y = oldY; projectile.vy *= -GRENADE.bounce; projectile.vx *= 0.83; if (Math.abs(projectile.vy) < 20) projectile.vy = 0; }
    }
    if (projectile.y > world.arena.height * world.arena.tileSize + 500) projectile.active = false;
  }
  for (const pickup of world.pickups) {
    if (!pickup.active && --pickup.respawnTicks <= 0) pickup.active = true;
  }
}

export function tryPickup(world: World, fighter: Fighter): boolean {
  const pickup = world.pickups.find(item => item.active && Math.hypot(item.x - fighter.x, item.y - fighter.y) <= COMBAT.pickupRange);
  if (!pickup) return false;
  const weapon = WEAPONS[pickup.weapon];
  if (!weapon) return false;
  if (weapon.slot === 'primary') { fighter.combat.primary = pickup.weapon; fighter.combat.equipped = 'primary'; }
  else if (weapon.slot === 'sidearm') { fighter.combat.sidearm = pickup.weapon; fighter.combat.equipped = 'sidearm'; }
  fighter.combat.ammo[pickup.weapon] = weapon.magazine;
  fighter.combat.reserve[pickup.weapon] = weapon.reserve;
  fighter.combat.reloadTicks = 0;
  pickup.active = false; pickup.respawnTicks = COMBAT.pickupRespawnTicks;
  world.events.push({ type: 'pickup', fighterId: fighter.id, x: pickup.x, y: pickup.y, weapon: pickup.weapon });
  return true;
}
