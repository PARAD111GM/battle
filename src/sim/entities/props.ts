import { TUNING } from '../../data/tuning';
import { MATERIALS } from '../../data/materials';
import { WORLD_TUNING } from '../../data/worldTuning';
import { overlapsTerrain } from '../physics/aabb';
import type { ArenaProp, Fighter } from '../types';
import type { World } from '../World';
import { integrateRigid } from './rigid';
import type { Debris, PropBody, RigidBody } from './types';

const P = TUNING.props, D = TUNING.debris;
const W = WORLD_TUNING.props;
interface PropFrame { fighters: Map<number, { x: number; y: number }>; platforms: Map<number, { x: number; y: number }> }
const frames = new WeakMap<World, PropFrame>();
const isPlatform = (prop: PropBody): boolean => ['moving-platform', 'movingPlatform', 'platform', 'elevator'].includes(prop.type);

export function createProps(props: ArenaProp[]): PropBody[] {
  return props.map(prop => {
    const dynamic = prop.type === 'crate' || prop.type === 'barrel';
    const damageable = dynamic || ['support', 'door', 'hanging-light', 'light'].includes(prop.type);
    const defaultHp = dynamic ? prop.type === 'barrel' ? P.barrelHp : P.crateHp
      : prop.type === 'support' ? W.supportHp : prop.type === 'door' ? W.doorHp : W.lightHp;
    const hp = damageable ? (typeof prop.hp === 'number' && prop.hp > 0 ? prop.hp : defaultHp) : Infinity;
    const x = prop.x + prop.width / 2, y = prop.y + prop.height / 2;
    return { id: prop.id, type: prop.type, active: true, dynamic,
      x, y, width: prop.width, height: prop.height,
      damageable, open: prop.open === true, broken: false, originX: x, originY: y,
      travelX: typeof prop.travelX === 'number' ? prop.travelX : prop.type === 'elevator' ? 0 : 192,
      travelY: typeof prop.travelY === 'number' ? prop.travelY : prop.type === 'elevator' ? -144 : 0,
      periodTicks: typeof prop.periodTicks === 'number' && prop.periodTicks > 0 ? prop.periodTicks : W.platformPeriod,
      anchorCol: typeof prop.anchorCol === 'number' ? prop.anchorCol : undefined,
      anchorRow: typeof prop.anchorRow === 'number' ? prop.anchorRow : undefined,
      vx: 0, vy: 0, rotation: 0, angularVelocity: 0, hp, maxHp: hp, heldBy: null, owner: -1, hitTargets: [] };
  });
}

export function activeClimbables(world: World): ArenaProp[] {
  return world.props.filter(prop => prop.active && !prop.broken && (prop.type === 'ladder' || prop.type === 'rope'))
    .map(prop => ({ id: prop.id, type: prop.type, x: prop.x - prop.width / 2, y: prop.y - prop.height / 2, width: prop.width, height: prop.height }));
}

/** Current geometry used by locomotion, including one-way platform surfaces. */
export function activeMovementProps(world: World): ArenaProp[] {
  return world.props.filter(prop => prop.active && (isPlatform(prop) || (!prop.broken && (prop.type === 'ladder' || prop.type === 'rope'))))
    .map(prop => ({ id: prop.id, type: prop.type, x: prop.x - prop.width / 2, y: prop.y - prop.height / 2, width: prop.width, height: prop.height }));
}

/** Move platforms before fighters so standing bodies inherit their exact displacement. */
export function preStepProps(world: World): void {
  const frame: PropFrame = { fighters: new Map(world.fighters.map(fighter => [fighter.id, { x: fighter.x, y: fighter.y }])), platforms: new Map() };
  frames.set(world, frame);
  let anchorsChanged = false;
  for (const prop of world.props) {
    if (!prop.active) continue;
    if (!prop.broken && prop.anchorCol !== undefined && prop.anchorRow !== undefined && !world.terrain.isSolid(prop.anchorCol, prop.anchorRow)) {
      if (prop.type === 'ladder' || prop.type === 'rope') {
        prop.dynamic = true; prop.broken = true; prop.damageable = false; prop.life = 120; prop.angularVelocity = 1.5; anchorsChanged = true;
        world.spawnDebris(prop.x, prop.y - prop.height / 2, prop.type === 'rope' ? 2 : 4, -1, 5);
        world.events.push({ type: 'prop-break', x: prop.x, y: prop.y, text: prop.type });
        continue;
      }
      if (prop.type === 'hanging-light' || prop.type === 'light') damageProp(world, prop, prop.hp, -1);
    }
    if (!isPlatform(prop)) continue;
    const oldX = prop.x, oldY = prop.y, oldTop = oldY - prop.height / 2;
    frame.platforms.set(prop.id, { x: oldX, y: oldY });
    const progress = (1 - Math.cos(world.tick / prop.periodTicks * Math.PI * 2)) / 2;
    const targetX = prop.originX + prop.travelX * progress, targetY = prop.originY + prop.travelY * progress;
    const riders = world.fighters.filter(fighter => fighter.alive && fighter.vy >= 0
      && Math.abs(fighter.y + fighter.height / 2 - oldTop) <= 3
      && Math.abs(fighter.x - oldX) < (fighter.width + prop.width) / 2);
    // Sweep both the platform and its riders; a blocked authored route must not
    // carry a fighter through a ceiling or jump across it on a later tick.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(targetX - oldX), Math.abs(targetY - oldY)) / (world.terrain.tileSize / 3)));
    for (let step = 1; step <= steps; step++) {
      const x = oldX + (targetX - oldX) * step / steps, y = oldY + (targetY - oldY) * step / steps;
      if (overlapsTerrain(world.terrain, x, y, prop.width, prop.height)
        || riders.some(fighter => overlapsTerrain(world.terrain, fighter.x + x - oldX, fighter.y + y - oldY, fighter.width, fighter.height))) break;
      prop.x = x; prop.y = y;
    }
    prop.vx = (prop.x - oldX) / TUNING.dt; prop.vy = (prop.y - oldY) / TUNING.dt;
    for (const fighter of riders) {
      const x = fighter.x + prop.x - oldX, y = fighter.y + prop.y - oldY;
      if (!overlapsTerrain(world.terrain, x, y, fighter.width, fighter.height)) {
        fighter.x = x; fighter.y = y; fighter.grounded = true; fighter.coyoteTicks = TUNING.movement.coyoteTicks;
      } else if (world.tick % 30 === 0) world.damageFighter(fighter, 10, -1, 0, 0, 'crush');
    }
  }
  if (anchorsChanged) world.navigation?.setClimbables(activeClimbables(world));
}

export function spawnRagdoll(world: World, fighter: Fighter): void {
  const bodies = world.props.filter(prop => prop.type === 'ragdoll');
  let body = bodies.find(prop => !prop.active);
  if (!body && bodies.length >= W.maxRagdolls) body = bodies.reduce((oldest, prop) => (prop.life ?? 0) < (oldest.life ?? 0) ? prop : oldest);
  const data: PropBody = {
    id: body?.id ?? world.props.reduce((maximum, prop) => Math.max(maximum, prop.id + 1), 0), type: 'ragdoll', active: true, dynamic: true,
    x: fighter.x, y: fighter.y, width: fighter.height * 0.8, height: fighter.width, vx: fighter.vx * 0.5, vy: Math.min(-140, fighter.vy),
    rotation: 0, angularVelocity: fighter.facing * 6, hp: 0, maxHp: 0, heldBy: null, owner: fighter.id, hitTargets: [],
    damageable: false, open: false, broken: true, originX: fighter.x, originY: fighter.y, travelX: 0, travelY: 0, periodTicks: 1, color: fighter.color, life: W.ragdollLife,
  };
  if (body) Object.assign(body, data); else world.props.push(data);
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
  if (!prop.active || !prop.damageable || amount <= 0 || !Number.isFinite(amount)) return;
  prop.hp -= amount;
  prop.owner = owner;
  if (prop.hp > 0) return;
  // Deactivate before triggering explosions: a neighboring barrel can never recurse into this one.
  prop.active = false;
  if (prop.type === 'hanging-light' || prop.type === 'light') { prop.active = true; prop.dynamic = true; prop.broken = true; prop.damageable = false; prop.angularVelocity = 3; }
  if (prop.heldBy !== null) {
    const holder = world.fighters.find(fighter => fighter.id === prop.heldBy);
    if (holder) holder.combat.heldProp = null;
  }
  prop.heldBy = null;
  world.events.push({ type: 'prop-break', x: prop.x, y: prop.y, text: prop.type, color: prop.type === 'barrel' ? 0xf07a55 : MATERIALS[2].debrisColor });
  world.spawnDebris(prop.x, prop.y, prop.type === 'barrel' ? 4 : 2, owner, 4);
  if (prop.type === 'support') world.structures.invalidateArea(prop.x, prop.y, prop.width, prop.height);
  if (prop.type === 'barrel') world.explode(prop.x, prop.y, P.barrelRadius, P.barrelDamage, owner);
  else if (prop.type === 'crate' && world.rng.next() < P.lootChance) {
    world.pickups.push({ id: world.pickups.reduce((max, item) => Math.max(max, item.id + 1), 0), x: prop.x, y: prop.y, kind: 'loot', weapon: world.rng.pick(['pistol', 'smg', 'shotgun']), active: true, respawnTicks: -1 });
  }
}

export function tryGrabProp(world: World, fighter: Fighter): boolean {
  const door = world.props.find(item => item.active && item.type === 'door' && Math.hypot(item.x - fighter.x, item.y - fighter.y) <= W.interactionRange + Math.max(item.width, item.height) / 2);
  if (door) {
    if (door.open && world.fighters.some(other => other.alive && overlaps(door, other))) return true;
    door.open = !door.open;
    world.events.push({ type: 'door', x: door.x, y: door.y, amount: door.open ? 1 : 0 });
    return true;
  }
  const prop = world.props.find(item => item.active && ['crate', 'barrel'].includes(item.type) && item.heldBy === null && Math.hypot(item.x - fighter.x, item.y - fighter.y) <= P.grabRange + item.width / 2);
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
    if (prop.life !== undefined && --prop.life <= 0) { prop.active = false; continue; }
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
    if (prop.type !== 'ragdoll') hitFighters(world, prop, fromX, fromY, speed, false);
    if (prop.y > world.arena.height * world.arena.tileSize + 300) prop.active = false;
  }
  collideProps(world);
  resolveInteractiveSurfaces(world);
  for (const chunk of world.debris) {
    if (!chunk.active) continue;
    if (--chunk.life <= 0) { chunk.active = false; continue; }
    const fromX = chunk.x, fromY = chunk.y, speed = Math.hypot(chunk.vx, chunk.vy);
    integrateRigid(chunk, world.terrain, D.gravity, D.bounce, D.friction);
    hitFighters(world, chunk, fromX, fromY, speed, true);
    if (chunk.y > world.arena.height * world.arena.tileSize + 300) chunk.active = false;
  }
}

function resolveInteractiveSurfaces(world: World): void {
  const frame = frames.get(world);
  if (!frame) return;
  for (const fighter of world.fighters) {
    if (!fighter.alive) continue;
    const before = frame.fighters.get(fighter.id);
    if (!before) continue;
    for (const prop of world.props) {
      if (!prop.active) continue;
      if (isPlatform(prop)) {
        const old = frame.platforms.get(prop.id) ?? prop;
        const oldTop = old.y - prop.height / 2, top = prop.y - prop.height / 2;
        if (fighter.vy >= 0 && before.y + fighter.height / 2 <= oldTop + 3 && fighter.y + fighter.height / 2 >= top
          && Math.abs(fighter.x - prop.x) < (fighter.width + prop.width) / 2
          && !overlapsTerrain(world.terrain, fighter.x, top - fighter.height / 2, fighter.width, fighter.height)) {
          fighter.y = top - fighter.height / 2; fighter.vy = 0; fighter.grounded = true; fighter.coyoteTicks = TUNING.movement.coyoteTicks;
          if (fighter.action === 'fall') fighter.action = 'idle';
        }
      } else if (prop.type === 'door' && !prop.open && Math.abs(fighter.y - prop.y) < (fighter.height + prop.height) / 2) {
        const left = prop.x - prop.width / 2, right = prop.x + prop.width / 2;
        if (before.x + fighter.width / 2 <= left + 0.01 && fighter.x + fighter.width / 2 > left) {
          fighter.x = left - fighter.width / 2; fighter.vx = 0;
        } else if (before.x - fighter.width / 2 >= right - 0.01 && fighter.x - fighter.width / 2 < right) {
          fighter.x = right + fighter.width / 2; fighter.vx = 0;
        } else if (overlaps(prop, fighter)) {
          fighter.x = fighter.x < prop.x ? left - fighter.width / 2 : right + fighter.width / 2; fighter.vx = 0;
        }
      }
    }
  }
}
