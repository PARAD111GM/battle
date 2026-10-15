import { TUNING } from '../../data/tuning';
import { COMBAT, GRENADE, SPECIALS, THROWABLES } from '../../data/combat';
import { overlapsTerrain } from '../physics/aabb';
import type { Fighter } from '../types';
import type { World } from '../World';
import { equippedWeapon, pickupKind, WEAPONS, type WeaponDefinition } from './definitions';
import type { Barrier, Projectile } from './types';
import type { PropBody } from '../entities/types';

/** Returns entry distance of a ray into a fighter's AABB, or Infinity. */
function rayBody(x: number, y: number, dx: number, dy: number, fighter: Pick<Fighter, 'x' | 'y' | 'width' | 'height'>): number {
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

export function hasLineOfSight(world: World, x: number, y: number, toX: number, toY: number): boolean {
  const distance = Math.hypot(toX - x, toY - y);
  if (distance < 0.01) return true;
  return rayTerrain(world, x, y, (toX - x) / distance, (toY - y) / distance, distance) >= distance - 0.01;
}

export function blocksVision(world: World, x: number, y: number, toX: number, toY: number): boolean {
  if (!hasLineOfSight(world, x, y, toX, toY)) return true;
  const distance = Math.hypot(toX - x, toY - y);
  if (distance < 0.01) return false;
  const dx = (toX - x) / distance, dy = (toY - y) / distance;
  for (const prop of world.props) if (prop.active && prop.damageable && !(prop.type === 'door' && prop.open) && rayBody(x, y, dx, dy, prop) < distance) return true;
  for (const barrier of world.barriers) if (barrier.active && rayBody(x, y, dx, dy, barrier) < distance) return true;
  for (const effect of world.effects) {
    if (effect.kind !== 'smoke' || effect.life <= 0) continue;
    const along = Math.max(0, Math.min(distance, (effect.x - x) * dx + (effect.y - y) * dy));
    if (Math.hypot(effect.x - x - dx * along, effect.y - y - dy * along) < effect.radius) return true;
  }
  return false;
}

function poolProjectile(world: World, data: Projectile): void {
  const reused = world.projectiles.find(projectile => !projectile.active);
  if (reused) Object.assign(reused, { gravity: undefined, bounce: undefined, effect: undefined, sticky: false, armedTicks: 0, stuck: false, impact: false, savedAmmo: undefined, savedReserve: undefined, savedDurability: undefined }, data);
  else if (world.projectiles.length < 128) world.projectiles.push(data);
}

function traceShot(world: World, fighter: Fighter, id: string, weapon: WeaponDefinition, angle: number): void {
  let x = fighter.x, y = fighter.y - 7, dx = Math.cos(angle), dy = Math.sin(angle), range = weapon.range, damage = weapon.damage;
  for (let bounce = 0; bounce <= (weapon.ricochets ?? 0); bounce++) {
    let distance = rayTerrain(world, x, y, dx, dy, range);
    let target: Fighter | undefined, propTarget: PropBody | undefined, shield: Barrier | undefined;
    for (const barrier of world.barriers) {
      if (!barrier.active || barrier.owner === fighter.id) continue;
      const entry = rayBody(x, y, dx, dy, barrier);
      if (entry < distance) { distance = entry; shield = barrier; }
    }
    for (const prop of world.props) {
      if (!prop.active || !prop.damageable || (prop.type === 'door' && prop.open)) continue;
      const entry = rayBody(x, y, dx, dy, prop);
      if (entry < distance) { distance = entry; propTarget = prop; shield = undefined; }
    }
    for (const other of world.fighters) {
      if (other === fighter || !other.alive) continue;
      const entry = rayBody(x, y, dx, dy, other);
      if (entry < distance) { distance = entry; target = other; propTarget = undefined; shield = undefined; }
    }
    const endX = x + dx * distance, endY = y + dy * distance;
    world.events.push({ type: 'shot', fighterId: fighter.id, x: x + dx * Math.min(18, distance), y: y + dy * Math.min(18, distance), endX, endY, weapon: id, amount: damage });
    if (target) { world.damageFighter(target, damage, fighter.id, weapon.knockback ?? 130, Math.atan2(dy, dx), 'bullet'); break; }
    if (shield) { shield.hp -= damage; if (shield.hp <= 0) shield.active = false; world.events.push({ type: 'block', x: endX, y: endY }); break; }
    if (propTarget) { world.damageProp(propTarget, damage, fighter.id); propTarget.vx += dx * weapon.recoil; break; }
    if (distance >= range) break;
    const size = world.terrain.tileSize;
    const col = Math.floor((endX + dx * 0.01) / size), row = Math.floor((endY + dy * 0.01) / size);
    const material = world.terrain.get(col, row);
    world.damageTerrain(col, row, weapon.terrainPower, fighter.id);
    if (bounce >= (weapon.ricochets ?? 0) || (material !== 4 && material !== 6)) break;
    const hitVertical = Math.abs(endX / size - Math.round(endX / size)) < 0.001;
    if (hitVertical) dx = -dx; else dy = -dy;
    range -= distance; damage *= weapon.ricochetLoss ?? 0.6;
    x = endX + dx * 0.05; y = endY + dy * 0.05;
  }
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
    const perfectAim = fighter.special === 'bullet-time' && combat.specialTicks > 0;
    const angle = baseAngle + (perfectAim ? 0 : world.rng.range(-weapon.spread, weapon.spread) * (fighter.grounded ? 1 : 1.4));
    if (weapon.fireMode === 'projectile') {
      const speed = weapon.projectileSpeed ?? 700;
      poolProjectile(world, { active: true, id: world.tick * 100 + fighter.id, kind: 'grenade', weapon: id, owner: fighter.id,
        x: originX, y: originY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        radius: 6, life: weapon.fuseTicks ?? 120, damage: weapon.damage, blastRadius: weapon.blastRadius ?? 100,
        gravity: weapon.projectileGravity ?? 0, bounce: weapon.projectileBounce ?? 0, effect: weapon.effect ?? 'explosion', impact: weapon.directImpact });
      world.events.push({ type: 'shot', fighterId: fighter.id, x: originX, y: originY, endX: originX + Math.cos(angle) * 25, endY: originY + Math.sin(angle) * 25, weapon: id });
    } else traceShot(world, fighter, id, weapon, angle);
  }
  fighter.vx -= combat.aimX * weapon.recoil;
  fighter.vy -= combat.aimY * weapon.recoil;
  if (combat.ammo[id] === 0) startReload(world, fighter);
}

export function throwGrenade(world: World, fighter: Fighter): void {
  const combat = fighter.combat;
  if (combat.throwableCount <= 0) return;
  const definition = THROWABLES[combat.throwable] ?? THROWABLES.grenade;
  combat.throwableCount--;
  combat.throwableAmmo[combat.throwable] = combat.throwableCount;
  const data: Projectile = { active: true, id: world.tick * 100 + fighter.id, kind: 'grenade', owner: fighter.id, weapon: combat.throwable,
    x: fighter.x + combat.aimX * 22, y: fighter.y - 8 + combat.aimY * 22,
    vx: combat.aimX * definition.speed + fighter.vx * 0.45, vy: combat.aimY * definition.speed - 170,
    radius: definition.radius, life: Math.max(1, (definition.lifeTicks ?? definition.fuseTicks) - combat.cookTicks), damage: definition.damage, blastRadius: definition.blastRadius,
    gravity: definition.gravity, bounce: definition.bounce, effect: definition.effect, sticky: definition.sticky, impact: definition.impact, armedTicks: 30 };
  // A wall immediately beside the muzzle must not allow a grenade to spawn through it.
  if (overlapsTerrain(world.terrain, data.x, data.y, data.radius * 2, data.radius * 2)) { data.x = fighter.x; data.y = fighter.y - 8; data.vx *= -0.25; }
  poolProjectile(world, data);
  combat.cookTicks = 0;
  fighter.action = 'throw-recovery'; fighter.actionTicks = GRENADE.throwRecoveryTicks;
  world.events.push({ type: 'throw', fighterId: fighter.id, x: data.x, y: data.y, weapon: combat.throwable });
}

export function throwHeldWeapon(world: World, fighter: Fighter): boolean {
  const id = equippedWeapon(fighter.combat), weapon = WEAPONS[id];
  if (!weapon || id === 'unarmed') return false;
  poolProjectile(world, { active: true, id: world.tick * 100 + fighter.id, kind: 'weapon', weapon: id, owner: fighter.id,
    x: fighter.x, y: fighter.y - 8, vx: fighter.combat.aimX * 680, vy: fighter.combat.aimY * 680 - 110,
    radius: 8, life: 240, damage: weapon.kind === 'melee' ? weapon.damage : 22, blastRadius: 0, gravity: 1200, bounce: 0.35, effect: 'weapon-drop',
    savedAmmo: fighter.combat.ammo[id], savedReserve: fighter.combat.reserve[id], savedDurability: fighter.combat.durability[id] });
  fighter.combat[fighter.combat.equipped] = fighter.combat.equipped === 'melee' ? 'unarmed' : '';
  fighter.combat.equipped = fighter.combat.primary ? 'primary' : fighter.combat.sidearm ? 'sidearm' : 'melee';
  fighter.combat.reloadTicks = 0;
  fighter.action = 'throw-recovery'; fighter.actionTicks = GRENADE.throwRecoveryTicks;
  world.events.push({ type: 'throw', fighterId: fighter.id, x: fighter.x, y: fighter.y, weapon: id });
  return true;
}

export function detonateProjectile(world: World, projectile: Projectile): void {
  projectile.active = false;
  const effect = projectile.effect ?? 'explosion';
  if (effect === 'weapon-drop') {
    world.pickups.push({ id: world.pickups.reduce((max, item) => Math.max(max, item.id + 1), 0), x: projectile.x, y: projectile.y, kind: 'loot', weapon: projectile.weapon, active: true, respawnTicks: -1, ammo: projectile.savedAmmo, reserve: projectile.savedReserve, durability: projectile.savedDurability });
  } else if (effect === 'smoke') {
    if (world.effects.length >= 64) world.effects.shift();
    world.effects.push({ id: projectile.id, kind: 'smoke', x: projectile.x, y: projectile.y, radius: projectile.blastRadius, life: 420, owner: projectile.owner });
    world.events.push({ type: 'smoke', x: projectile.x, y: projectile.y, amount: projectile.blastRadius });
  } else if (effect === 'flash') {
    const source = world.fighters.find(fighter => fighter.id === projectile.owner);
    for (const fighter of world.fighters) {
      const distance = Math.hypot(fighter.x - projectile.x, fighter.y - projectile.y);
      if (!fighter.alive || distance > projectile.blastRadius || !hasLineOfSight(world, projectile.x, projectile.y, fighter.x, fighter.y)) continue;
      if (source && source !== fighter && world.settings.mode === 'team' && !world.settings.friendlyFire && source.team === fighter.team) continue;
      fighter.combat.flashTicks = Math.max(fighter.combat.flashTicks, Math.round(180 * (1 - distance / projectile.blastRadius * 0.7)));
    }
    world.events.push({ type: 'flash', x: projectile.x, y: projectile.y, amount: projectile.blastRadius });
  } else if (effect === 'fire') {
    world.ignite(projectile.x, projectile.y, projectile.blastRadius, projectile.owner);
    world.explode(projectile.x, projectile.y, projectile.blastRadius * 0.65, projectile.damage, projectile.owner);
  } else {
    const before = WEAPONS[projectile.weapon]?.kind === 'gun' ? new Map(world.fighters.filter(fighter => fighter.id !== projectile.owner).map(fighter => [fighter.id, fighter.damage])) : null;
    world.explode(projectile.x, projectile.y, projectile.blastRadius, projectile.damage, projectile.owner);
    if (before && world.fighters.some(fighter => before.has(fighter.id) && fighter.damage > before.get(fighter.id)!)) {
      const shooter = world.fighters.find(fighter => fighter.id === projectile.owner);
      if (shooter) shooter.combat.hits++;
    }
  }
}

export function stepProjectiles(world: World): void {
  for (let index = world.effects.length - 1; index >= 0; index--) {
    const effect = world.effects[index];
    if (--effect.life <= 0) {
      if (effect.kind === 'air-strike') world.explode(effect.x, effect.y, effect.radius, SPECIALS.airStrikeDamage, effect.owner);
      world.effects.splice(index, 1); continue;
    }
    if (effect.kind === 'slow') for (const fighter of world.fighters) {
      const owner = world.fighters.find(other => other.id === effect.owner);
      if (fighter.alive && fighter.id !== effect.owner && (!owner || world.settings.mode !== 'team' || owner.team !== fighter.team) && Math.hypot(fighter.x - effect.x, fighter.y - effect.y) < effect.radius) fighter.combat.slowTicks = 3;
    }
  }
  for (const barrier of world.barriers) if (barrier.active && (--barrier.life <= 0 || barrier.hp <= 0)) barrier.active = false;
  for (const projectile of world.projectiles) {
    if (!projectile.active) continue;
    projectile.life--;
    if (projectile.life <= 0) {
      detonateProjectile(world, projectile);
      continue;
    }
    if (projectile.sticky) {
      projectile.armedTicks = Math.max(0, (projectile.armedTicks ?? 0) - 1);
      const owner = world.fighters.find(fighter => fighter.id === projectile.owner);
      if (projectile.armedTicks === 0 && world.fighters.some(fighter => fighter.alive && fighter.id !== projectile.owner && (!owner || world.settings.mode !== 'team' || world.settings.friendlyFire || owner.team !== fighter.team) && Math.hypot(fighter.x - projectile.x, fighter.y - projectile.y) < 55)) { detonateProjectile(world, projectile); continue; }
      if (projectile.stuck) continue;
    }
    const slow = world.effects.some(effect => effect.kind === 'slow' && effect.owner !== projectile.owner && Math.hypot(effect.x - projectile.x, effect.y - projectile.y) < effect.radius) ? SPECIALS.slowScale : 1;
    projectile.vy += (projectile.gravity ?? GRENADE.gravity) * TUNING.dt * slow;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(projectile.vx), Math.abs(projectile.vy)) * TUNING.dt / (world.terrain.tileSize / 3)));
    const dt = TUNING.dt * slow / steps;
    for (let i = 0; i < steps; i++) {
      if (!projectile.active || projectile.stuck) break;
      let impact = false;
      const oldX = projectile.x; projectile.x += projectile.vx * dt;
      if (overlapsTerrain(world.terrain, projectile.x, projectile.y, projectile.radius * 2, projectile.radius * 2)) { projectile.x = oldX; projectile.vx *= -(projectile.bounce ?? GRENADE.bounce); impact = true; }
      const oldY = projectile.y; projectile.y += projectile.vy * dt;
      if (overlapsTerrain(world.terrain, projectile.x, projectile.y, projectile.radius * 2, projectile.radius * 2)) { projectile.y = oldY; projectile.vy *= -(projectile.bounce ?? GRENADE.bounce); projectile.vx *= 0.83; if (Math.abs(projectile.vy) < 20) projectile.vy = 0; impact = true; }
      const victim = world.fighters.find(fighter => fighter.alive && fighter.id !== projectile.owner && Math.abs(fighter.x - projectile.x) < fighter.width / 2 + projectile.radius && Math.abs(fighter.y - projectile.y) < fighter.height / 2 + projectile.radius);
      if (victim && projectile.kind === 'weapon') { world.damageFighter(victim, projectile.damage, projectile.owner, 400, Math.atan2(projectile.vy, projectile.vx), 'prop'); detonateProjectile(world, projectile); break; }
      if (projectile.impact && (impact || victim)) { detonateProjectile(world, projectile); break; }
      if (projectile.sticky && impact) { projectile.stuck = true; projectile.vx = projectile.vy = 0; }
      if (projectile.kind === 'weapon' && impact && Math.hypot(projectile.vx, projectile.vy) < 45) { detonateProjectile(world, projectile); break; }
    }
    if (projectile.y > world.arena.height * world.arena.tileSize + 500) projectile.active = false;
  }
  for (const pickup of world.pickups) {
    if (!pickup.active && pickup.respawnTicks >= 0 && --pickup.respawnTicks <= 0) pickup.active = true;
  }
}

export function tryPickup(world: World, fighter: Fighter): boolean {
  const pickup = world.pickups.find(item => item.active && Math.hypot(item.x - fighter.x, item.y - fighter.y) <= COMBAT.pickupRange);
  if (!pickup) return false;
  const weapon = WEAPONS[pickup.weapon];
  const kind = pickupKind(pickup.weapon);
  if (kind === 'health') {
    if (world.settings.damageMode === 'percent') fighter.damage = Math.max(0, fighter.damage - (pickup.quantity ?? 45));
    else fighter.hp = Math.min(fighter.maxHp, fighter.hp + (pickup.quantity ?? 45));
  }
  else if (kind === 'ammo') {
    for (const id of [fighter.combat.primary, fighter.combat.sidearm]) if (WEAPONS[id]) fighter.combat.reserve[id] = Math.min(WEAPONS[id].reserve, fighter.combat.reserve[id] + (pickup.quantity ?? WEAPONS[id].magazine * 2));
  } else if (kind === 'throwable') {
    if (fighter.combat.throwable !== pickup.weapon) fighter.combat.throwableCount = 0;
    fighter.combat.throwable = pickup.weapon;
    fighter.combat.throwableCount = Math.min(6, fighter.combat.throwableCount + (pickup.quantity ?? 3));
    fighter.combat.throwableAmmo[pickup.weapon] = fighter.combat.throwableCount;
  } else if (weapon) {
    const slot = weapon.slot as 'primary' | 'sidearm' | 'melee';
    fighter.combat[slot] = pickup.weapon; fighter.combat.equipped = slot;
    fighter.combat.ammo[pickup.weapon] = pickup.ammo ?? weapon.magazine;
    fighter.combat.reserve[pickup.weapon] = pickup.reserve ?? weapon.reserve;
    fighter.combat.durability[pickup.weapon] = pickup.durability ?? weapon.durability ?? Infinity;
  } else return false;
  fighter.combat.reloadTicks = 0;
  if (fighter.action === 'reload') { fighter.action = fighter.grounded ? 'idle' : 'fall'; fighter.actionTicks = 0; }
  pickup.active = false; pickup.respawnTicks = pickup.kind === 'loot' ? -1 : COMBAT.pickupRespawnTicks;
  world.events.push({ type: 'pickup', fighterId: fighter.id, x: pickup.x, y: pickup.y, weapon: pickup.weapon });
  return true;
}
