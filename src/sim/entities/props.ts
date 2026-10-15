import { TUNING } from '../../data/tuning';
import { MATERIALS } from '../../data/materials';
import { overlapsTerrain } from '../physics/aabb';
import type { ArenaProp, Fighter } from '../types';
import type { World } from '../World';
import { integrateRigid } from './rigid';
import type { Debris, PropBody, RigidBody } from './types';

const P = TUNING.props, D = TUNING.debris;
export function createProps(props: ArenaProp[]): PropBody[] {
  return props.map(prop => {
    const dynamic = prop.type === 'crate' || prop.type === 'barrel';
    const hp = dynamic ? prop.type === 'barrel' ? P.barrelHp : P.crateHp : Infinity;
    return { id: prop.id, type: prop.type, active: true, dynamic,
      x: prop.x + prop.width / 2, y: prop.y + prop.height / 2, width: prop.width, height: prop.height,
      vx: 0, vy: 0, rotation: 0, angularVelocity: 0, hp, maxHp: hp, heldBy: null, owner: -1, hitTargets: [] };
  });
}

export function spawnDebris(world: World, x: number, y: number, material: number, owner: number, count: number): void {
  for (let i = 0; i < count; i++) {
    let chunk = world.debris.find(item => !item.active);
    if (!chunk && world.debris.length >= D.maxCount) return;
    const size = world.rng.range(D.minSize, D.maxSize);
    const data: Debris = { active: true, id: chunk?.id ?? world.debris.length, x, y, width: size, height: size,
      vx: world.rng.range(-310, 310), vy: world.rng.range(-470, -150), rotation: world.rng.range(-Math.PI, Math.PI), angularVelocity: world.rng.range(-9, 9),
      material, owner, life: D.lifeTicks, hitTargets: [] };
    if (chunk) Object.assign(chunk, data);
    else { chunk = data; world.debris.push(chunk); }
  }
}

export function damageProp(world: World, prop: PropBody, amount: number, owner: number): void {
  if (!prop.active || !prop.dynamic || amount <= 0 || !Number.isFinite(amount)) return;
  prop.hp -= amount;
  prop.owner = owner;
  if (prop.hp > 0) return;
  // Deactivate before triggering explosions: a neighboring barrel can never recurse into this one.
  prop.active = false;
  if (prop.heldBy !== null) {
    const holder = world.fighters.find(fighter => fighter.id === prop.heldBy);
    if (holder) holder.combat.heldProp = null;
  }
  prop.heldBy = null;
  world.events.push({ type: 'prop-break', x: prop.x, y: prop.y, text: prop.type, color: prop.type === 'barrel' ? 0xf07a55 : MATERIALS[2].debrisColor });
  world.spawnDebris(prop.x, prop.y, prop.type === 'barrel' ? 4 : 2, owner, 4);
  if (prop.type === 'barrel') world.explode(prop.x, prop.y, P.barrelRadius, P.barrelDamage, owner);
  else if (world.rng.next() < P.lootChance) {
    world.pickups.push({ id: world.pickups.reduce((max, item) => Math.max(max, item.id + 1), 0), x: prop.x, y: prop.y, kind: 'loot', weapon: world.rng.pick(['pistol', 'smg', 'shotgun']), active: true, respawnTicks: -1 });
  }
}

export function tryGrabProp(world: World, fighter: Fighter): boolean {
  const prop = world.props.find(item => item.active && item.dynamic && item.heldBy === null && Math.hypot(item.x - fighter.x, item.y - fighter.y) <= P.grabRange + item.width / 2);
  if (!prop) return false;
  prop.heldBy = fighter.id; prop.vx = prop.vy = prop.angularVelocity = 0; prop.owner = fighter.id;
  fighter.combat.heldProp = prop.id;
  world.events.push({ type: 'grab', fighterId: fighter.id, x: prop.x, y: prop.y, text: prop.type });
  return true;
}

export function releaseHeldProp(world: World, fighter: Fighter, thrown: boolean): void {
  const prop = world.props.find(item => item.id === fighter.combat.heldProp && item.active);
  fighter.combat.heldProp = null;
  if (!prop) return;
  prop.heldBy = null; prop.owner = fighter.id; prop.hitTargets = [];
  prop.vx = thrown ? fighter.combat.aimX * P.throwSpeed + fighter.vx * 0.4 : fighter.vx;
  prop.vy = thrown ? fighter.combat.aimY * P.throwSpeed - P.throwLift : 0;
  prop.angularVelocity = thrown ? fighter.facing * 8 : 0;
  if (thrown) world.events.push({ type: 'throw', fighterId: fighter.id, x: prop.x, y: prop.y, text: prop.type });
}

function overlaps(a: RigidBody, b: {x: number; y: number; width: number; height: number}): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
}

/** Segment expanded by the body's bounds catches fast chunks between physics steps. */
function sweptFighter(body: RigidBody, fromX: number, fromY: number, fighter: Fighter): boolean {
  let near = 0, far = 1;
  for (const [origin, delta, min, max] of [[fromX, body.x - fromX, fighter.x - (fighter.width + body.width) / 2, fighter.x + (fighter.width + body.width) / 2], [fromY, body.y - fromY, fighter.y - (fighter.height + body.height) / 2, fighter.y + (fighter.height + body.height) / 2]]) {
    if (Math.abs(delta) < 0.00001) { if (origin < min || origin > max) return false; continue; }
    const first = (min - origin) / delta, second = (max - origin) / delta;
    near = Math.max(near, Math.min(first, second)); far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return true;
}

function hitFighters(world: World, body: PropBody | Debris, fromX: number, fromY: number, speed: number, debris: boolean): void {
  if (speed < (debris ? D.impactMinSpeed : P.impactMinSpeed)) return;
  for (const fighter of world.fighters) {
    if (!fighter.alive || fighter.id === body.owner || body.hitTargets.includes(fighter.id) || !sweptFighter(body, fromX, fromY, fighter)) continue;
    body.hitTargets.push(fighter.id);
    const damage = Math.min(debris ? D.maxImpactDamage : P.maxImpactDamage, Math.round(speed * (debris ? D.damageScale : P.impactDamageScale)));
    world.damageFighter(fighter, damage, body.owner, speed * 0.65, Math.atan2(body.vy, body.vx), 'prop');
    body.vx *= -0.25; body.vy *= -0.25;
    break;
  }
}

function collideProps(world: World): void {
  const props = world.props.filter(prop => prop.active && prop.dynamic && prop.heldBy === null);
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
    const a = props[i], b = props[j];
    if (!overlaps(a, b)) continue;
    const overlapX = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
    const overlapY = (a.height + b.height) / 2 - Math.abs(a.y - b.y);
    if (overlapY <= overlapX) {
      const top = a.y < b.y ? a : b, bottom = top === a ? b : a;
      top.y = bottom.y - (top.height + bottom.height) / 2;
      top.vy = Math.min(0, -top.vy * P.bounce); top.vx *= P.friction;
    } else {
      const sign = a.x < b.x ? -1 : 1;
      a.x += sign * overlapX / 2; b.x -= sign * overlapX / 2;
      const velocity = a.vx; a.vx = b.vx * P.bounce; b.vx = velocity * P.bounce;
    }
  }
}

export function stepProps(world: World): void {
  for (const prop of world.props) {
    if (!prop.active || !prop.dynamic) continue;
    if (prop.heldBy !== null) {
      const holder = world.fighters.find(fighter => fighter.id === prop.heldBy && fighter.alive);
      if (!holder || holder.combat.stunTicks > 0) { if (holder) releaseHeldProp(world, holder, false); else prop.heldBy = null; }
      else {
        let x = holder.x + holder.facing * (holder.width / 2 + prop.width / 2 + 5), y = holder.y - 8;
        if (overlapsTerrain(world.terrain, x, y, prop.width, prop.height)) { x = holder.x; y = holder.y - holder.height / 2 - prop.height / 2 - 2; }
        if (!overlapsTerrain(world.terrain, x, y, prop.width, prop.height)) { prop.x = x; prop.y = y; }
        prop.vx = prop.vy = 0;
        continue;
      }
    }
    const fromX = prop.x, fromY = prop.y, speed = Math.hypot(prop.vx, prop.vy);
    integrateRigid(prop, world.terrain, P.gravity, P.bounce, P.friction);
    hitFighters(world, prop, fromX, fromY, speed, false);
    if (prop.y > world.arena.height * world.arena.tileSize + 300) prop.active = false;
  }
  collideProps(world);
  for (const chunk of world.debris) {
    if (!chunk.active) continue;
    if (--chunk.life <= 0) { chunk.active = false; continue; }
    const fromX = chunk.x, fromY = chunk.y, speed = Math.hypot(chunk.vx, chunk.vy);
    integrateRigid(chunk, world.terrain, D.gravity, D.bounce, D.friction);
    hitFighters(world, chunk, fromX, fromY, speed, true);
    if (chunk.y > world.arena.height * world.arena.tileSize + 300) chunk.active = false;
  }
}
