import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { World } from '../src/sim/World';
import { overlapsTerrain } from '../src/sim/physics/aabb';
import { neutralInput, type ArenaData, type ArenaProp, type InputCommand } from '../src/sim/types';

function arena(props: ArenaProp[] = []): ArenaData {
  const width = 80, height = 40, tileSize = 20;
  const tiles = Array<number>(width * height).fill(0);
  for (let x = 0; x < width; x++) tiles[30 * width + x] = 6;
  return {
    id: 'props-test', name: 'Props test', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 100, y: 581 }, { x: 300, y: 581 }], props, weaponSpawns: [], background: '',
  };
}

const crate = (id = 1, x = 180, y = 560): ArenaProp => ({ id, type: 'crate', x, y, width: 40, height: 40 });
const barrel = (id: number, x: number): ArenaProp => ({ id, type: 'barrel', x, y: 560, width: 28, height: 40 });
function advance(world: World, ticks: number, commands: Record<number, Partial<InputCommand>> = {}): void {
  for (let tick = 0; tick < ticks; tick++) {
    world.step(Object.fromEntries(Object.entries(commands).map(([id, command]) => [id, { ...neutralInput(), ...command }])));
  }
}

describe('destructible props and debris', () => {
  it('clones authored props into centered runtime bodies without altering arena geometry', () => {
    const data = arena([crate(), { id: 2, type: 'ladder', x: 500, y: 300, width: 20, height: 300 }]);
    const original = structuredClone(data.props);
    const world = new World(data);
    const prop = world.props.find(item => item.id === 1)!;
    expect(prop.x).toBe(200);
    expect(prop.y).toBe(580);
    expect(prop.active).toBe(true);
    world.damageProp(prop, 10000);
    expect(prop.active).toBe(false);
    expect(data.props).toEqual(original);
  });

  it('uses a crate as gunfire cover until the crate is destroyed', () => {
    const world = new World(arena([crate()]));
    world.addFighter();
    const target = world.addFighter();
    const prop = world.props[0];
    advance(world, 1, { 0: { shoot: true } });
    expect(prop.hp).toBeLessThan(prop.maxHp);
    expect(prop.active).toBe(true);
    expect(target.hp).toBe(target.maxHp);

    world.damageProp(prop, 10000, 0);
    advance(world, 60, { 0: { shoot: true } });
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('chains nearby explosive barrels once each without recursion or duplicate explosions', () => {
    const world = new World(arena([barrel(1, 190), barrel(2, 240), barrel(3, 290)]));
    world.damageProp(world.props[0], 10000, 0);
    expect(world.props.every(prop => !prop.active)).toBe(true);
    expect(world.events.filter(event => event.type === 'explosion')).toHaveLength(3);
    expect(world.debris.length).toBeLessThanOrEqual(TUNING.debris.maxCount);

    for (const prop of world.props) world.damageProp(prop, 10000, 0);
    expect(world.events.filter(event => event.type === 'explosion')).toHaveLength(3);
  });

  it('destroys tiles around an explosion and emits bounded debris without changing source tiles', () => {
    const data = arena();
    for (let row = 10; row <= 12; row++) {
      for (let col = 10; col <= 12; col++) data.tiles[row * data.width + col] = 1;
    }
    const sourceTiles = [...data.tiles];
    const world = new World(data);
    world.explode(230, 230, 90, 1000, 7);
    for (let row = 10; row <= 12; row++) {
      for (let col = 10; col <= 12; col++) expect(world.terrain.get(col, row)).toBe(0);
    }
    expect(world.debris.some(piece => piece.active)).toBe(true);
    expect(world.debris.length).toBeLessThanOrEqual(TUNING.debris.maxCount);
    expect(data.tiles).toEqual(sourceTiles);
    expect(world.terrain.get(10, 30)).toBe(6);
  });

  it('gives a destroyed tile’s chunks its material and damage owner', () => {
    const data = arena();
    data.tiles[10 * data.width + 10] = 5;
    const world = new World(data);
    world.damageTerrain(10, 10, 10000, 7);
    expect(world.terrain.get(10, 10)).toBe(0);
    const chunks = world.debris.filter(piece => piece.active);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(piece => piece.material === 5 && piece.owner === 7)).toBe(true);
  });

  it('caps and reuses its debris pool after chunks expire', () => {
    const world = new World(arena());
    world.spawnDebris(200, 300, 2, 0, TUNING.debris.maxCount * 3);
    expect(world.debris).toHaveLength(TUNING.debris.maxCount);
    expect(world.debris.filter(piece => piece.active)).toHaveLength(TUNING.debris.maxCount);
    const pooled = [...world.debris];
    advance(world, TUNING.debris.lifeTicks + 1);
    expect(world.debris.every(piece => !piece.active)).toBe(true);

    world.spawnDebris(200, 300, 2, 0, 5);
    expect(world.debris).toHaveLength(TUNING.debris.maxCount);
    expect(world.debris.filter(piece => piece.active)).toHaveLength(5);
    expect(world.debris.every(piece => pooled.includes(piece))).toBe(true);
  });

  it('sweeps fast props against thin walls and floors without tunneling', () => {
    const data = arena([crate()]);
    for (let row = 0; row < 30; row++) data.tiles[row * data.width + 20] = 6;
    const world = new World(data);
    const prop = world.props[0];
    prop.vx = 30000;
    advance(world, 1);
    expect(prop.x + prop.width / 2).toBeLessThanOrEqual(400);
    expect(overlapsTerrain(world.terrain, prop.x, prop.y, prop.width, prop.height)).toBe(false);

    const dropWorld = new World(arena([crate(1, 180, 180)]));
    const dropping = dropWorld.props[0];
    dropping.vy = 30000;
    advance(dropWorld, 1);
    expect(dropping.y + dropping.height / 2).toBeLessThanOrEqual(600);
    expect(overlapsTerrain(dropWorld.terrain, dropping.x, dropping.y, dropping.width, dropping.height)).toBe(false);
  });

  it('sweeps a fast thrown prop into a fighter and attributes its damage', () => {
    const world = new World(arena([crate(1, 110)]));
    const attacker = world.addFighter({ x: 80 });
    const target = world.addFighter({ x: 260 });
    const prop = world.props[0];
    prop.owner = attacker.id;
    prop.vx = 20000;
    advance(world, 1);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(target.combat.lastHitBy).toBe(attacker.id);
    expect(attacker.hp).toBe(attacker.maxHp);
  });

  it('allows a fast moving chunk to hurt an enemy with the correct attribution', () => {
    const world = new World(arena());
    const attacker = world.addFighter({ x: 80 });
    const target = world.addFighter({ x: 260 });
    world.spawnDebris(120, 580, 4, attacker.id, 1);
    const chunk = world.debris.find(piece => piece.active)!;
    chunk.vx = 20000; chunk.vy = 0;
    advance(world, 1);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(target.combat.lastHitBy).toBe(attacker.id);
  });

  it.each(['attack', 'throw'] as const)('grabs a nearby prop and releases it with %s', action => {
    const world = new World(arena([crate(1, 112)]));
    const fighter = world.addFighter();
    const prop = world.props[0];
    advance(world, 1, { 0: { interact: true } });
    expect(prop.heldBy).toBe(fighter.id);
    advance(world, 1, { 0: { [action]: true, aimX: 1 } });
    expect(prop.heldBy).toBe(null);
    expect(prop.owner).toBe(fighter.id);
    expect(prop.vx).toBeGreaterThan(0);
    expect(fighter.combat.throwableCount).toBe(3);
  });

  it('prioritizes grabbing an enemy over a nearby prop', () => {
    const world = new World(arena([crate(1, 112)]));
    const fighter = world.addFighter();
    const enemy = world.addFighter({ x: 132 });
    advance(world, 1, { 0: { interact: true } });
    expect(fighter.combat.grabTarget).toBe(enemy.id);
    expect(world.props[0].heldBy).toBe(null);
  });

  it('settles slow chunks on the floor without penetrating it', () => {
    const world = new World(arena());
    world.spawnDebris(200, 570, 2, -1, 1);
    const chunk = world.debris.find(piece => piece.active)!;
    chunk.vx = chunk.vy = 0;
    chunk.y = 600 - chunk.height / 2 - 1;
    advance(world, 60);
    expect(chunk.active).toBe(true);
    expect(chunk.y + chunk.height / 2).toBeLessThanOrEqual(600);
    expect(chunk.y + chunk.height / 2).toBeGreaterThan(595);
    expect(Math.abs(chunk.vy)).toBeLessThan(20);
    expect(overlapsTerrain(world.terrain, chunk.x, chunk.y, chunk.width, chunk.height)).toBe(false);
  });

  it('replays barrel destruction, debris and crate drops deterministically', () => {
    const props = [barrel(1, 190), barrel(2, 240), ...Array.from({ length: 12 }, (_, i) => crate(i + 3, 400 + i * 50))];
    const first = new World(arena(props), 83), second = new World(arena(props), 83);
    for (const world of [first, second]) {
      world.damageProp(world.props[0], 10000, 0);
      for (const prop of world.props.filter(item => item.type === 'crate')) world.damageProp(prop, 10000, 0);
    }
    expect(first.pickups.length).toBeGreaterThan(0);
    for (let tick = 0; tick < 120; tick++) {
      first.step({}); second.step({});
      expect(first.props).toEqual(second.props);
      expect(first.debris).toEqual(second.debris);
      expect(first.pickups).toEqual(second.pickups);
      expect(first.events).toEqual(second.events);
    }
    expect(first.rng.state).toBe(second.rng.state);
  });
});
