import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { World } from '../src/sim/World';
import { moveAndCollide, overlapsTerrain } from '../src/sim/physics/aabb';
import { neutralInput, type ArenaData, type ArenaProp, type InputCommand } from '../src/sim/types';

function arena(props: ArenaProp[] = []): ArenaData {
  const width = 80, height = 40, tileSize = 20, tiles = Array<number>(width * height).fill(0);
  for (let col = 0; col < width; col++) tiles[32 * width + col] = 6;
  return { id: 'movement-controls', name: 'Movement controls', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 300, y: 181 }], props, weaponSpawns: [], background: '' };
}

function floor(data: ArenaData, row: number, material = 4, start = 4, end = 45): void {
  for (let col = start; col <= end; col++) data.tiles[row * data.width + col] = material;
}

function advance(world: World, ticks: number, command: Partial<InputCommand> = {}): void {
  for (let tick = 0; tick < ticks; tick++) world.step({ 0: { ...neutralInput(), ...command } });
}

describe('sprint locomotion', () => {
  it('doubles the normal run target, returns to normal after release, and stops without direction', () => {
    const world = new World(arena()), fighter = world.addFighter({ y: 621, speedScale: 0.9 });
    advance(world, 24, { moveX: 1, sprint: true });
    expect(fighter.vx).toBe(TUNING.movement.runSpeed * 0.9 * 2);
    advance(world, 16, { moveX: 1 });
    expect(fighter.vx).toBe(TUNING.movement.runSpeed * 0.9);
    advance(world, 15, { sprint: true });
    expect(fighter.vx).toBe(0);
    advance(world, 30, { moveX: -1, sprint: true });
    expect(fighter.vx).toBe(-TUNING.movement.runSpeed * 0.9 * 2);
  });

  it('leaves the roll speed unchanged and sweeps sprinting fighters into walls', () => {
    const data = arena();
    for (let row = 25; row < 32; row++) data.tiles[row * data.width + 30] = 3;
    const world = new World(data), fighter = world.addFighter({ y: 621 });
    advance(world, 1, { moveX: 1, sprint: true, roll: true });
    expect(fighter.vx).toBe(TUNING.movement.rollSpeed);
    advance(world, 60, { moveX: 1, sprint: true });
    expect(fighter.x).toBe(590);
    expect(overlapsTerrain(world.terrain, fighter.x, fighter.y, fighter.width, fighter.height)).toBe(false);
  });
});

describe('drop through an exact support', () => {
  it('drops through a thin catwalk, lands on the lower catwalk and requires a new press', () => {
    const data = arena(); floor(data, 10); floor(data, 18);
    const world = new World(data), fighter = world.addFighter();
    advance(world, 1, { dropThrough: true });
    expect(fighter.dropThroughState).toEqual({ kind: 'tiles', row: 10, startCol: 4, endCol: 45 });
    expect(fighter.grounded).toBe(false);
    expect(fighter.y).toBeGreaterThan(181);
    advance(world, 80, { dropThrough: true });
    expect(fighter.y).toBe(341);
    expect(fighter.grounded).toBe(true);
    expect(fighter.dropThroughState).toBeNull();
    advance(world, 1);
    advance(world, 1, { dropThrough: true });
    expect(fighter.dropThroughState).toMatchObject({ kind: 'tiles', row: 18 });
    advance(world, 60);
    expect(fighter.y).toBe(621);
    expect(fighter.dropThroughState).toBeNull();
    expect(world.terrain.get(10, 10)).toBe(4);
  });

  it.each(['bedrock', 'thick floor', 'insufficient clearance', 'vertical wall'])('rejects %s and preserves a running roll', kind => {
    const data = arena(); floor(data, 10, kind === 'bedrock' ? 6 : 4);
    if (kind === 'thick floor') floor(data, 11);
    if (kind === 'insufficient clearance') floor(data, 12);
    if (kind === 'vertical wall') for (let row = 11; row < 32; row++) data.tiles[row * data.width + 15] = 3;
    const world = new World(data), fighter = world.addFighter();
    advance(world, 1, { moveX: 1, roll: true });
    expect(fighter.action).toBe('roll');
    advance(world, 1, { moveX: 1, roll: true, dropThrough: true });
    expect(fighter.dropThroughState).toBeNull();
    expect(fighter.action).toBe('roll');
    expect(fighter.y).toBe(181);
  });

  it('cancels an active roll only when the support can be dropped through', () => {
    const data = arena(); floor(data, 10); floor(data, 18);
    const world = new World(data), fighter = world.addFighter();
    advance(world, 1, { moveX: 1, roll: true });
    expect(fighter.action).toBe('roll');
    advance(world, 1, { moveX: 1, roll: true, dropThrough: true, moveY: 1 });
    expect(fighter.action).toBe('fall');
    expect(fighter.dropThroughState?.kind).toBe('tiles');
    expect(fighter.y).toBeGreaterThan(181);
    expect(fighter.coyoteTicks).toBe(0);
  });

  it('keeps neighboring walls and all other terrain collidable while crossing the selected row', () => {
    const data = arena(); floor(data, 10, 4, 4, 15);
    for (let row = 8; row <= 18; row++) data.tiles[row * data.width + 16] = 3;
    floor(data, 18);
    const world = new World(data), fighter = world.addFighter({ x: 290 });
    advance(world, 1, { dropThrough: true });
    expect(fighter.dropThroughState).toEqual({ kind: 'tiles', row: 10, startCol: 4, endCol: 15 });
    fighter.vx = 20_000;
    moveAndCollide(fighter, world.terrain, TUNING.dt);
    expect(fighter.x).toBe(310);
    advance(world, 80, { moveX: 1 });
    expect(fighter.x).toBe(310);
    expect(fighter.y).toBe(341);
    expect(fighter.dropThroughState).toBeNull();
  });

  it('does not turn an airborne held drop into a drop upon landing', () => {
    const data = arena(); floor(data, 10);
    const world = new World(data), fighter = world.addFighter({ y: 80 });
    advance(world, 60, { dropThrough: true });
    expect(fighter.y).toBe(181);
    expect(fighter.dropThroughState).toBeNull();
  });

  it.each([0, -100, 100])('drops through a platform moving vertically by %i, then stops receiving its horizontal carry', travelY => {
    const data = arena([{ id: 7, type: 'moving-platform', x: 220, y: 200, width: 200, height: 12, travelX: 120, travelY, periodTicks: 240 }]);
    floor(data, 24);
    const world = new World(data), fighter = world.addFighter();
    advance(world, 30);
    expect(fighter.x).toBeGreaterThan(310);
    expect(fighter.grounded).toBe(true);
    advance(world, 1, { dropThrough: true });
    expect(fighter.dropThroughState).toEqual({ kind: 'prop', propId: 7 });
    const droppedX = fighter.x, droppedY = fighter.y, platformX = world.props[0].x;
    advance(world, 4);
    expect(fighter.x).toBe(droppedX);
    expect(fighter.y).toBeGreaterThan(droppedY);
    expect(world.props[0].x).toBeGreaterThan(platformX);
    advance(world, 60);
    expect(fighter.y).toBe(461);
    expect(fighter.grounded).toBe(true);
    expect(fighter.dropThroughState).toBeNull();
  });

  it('lands on another one-way platform without ignoring its support', () => {
    const data = arena([
      { id: 7, type: 'platform', x: 220, y: 200, width: 200, height: 12, travelX: 0, travelY: 0 },
      { id: 8, type: 'elevator', x: 220, y: 340, width: 200, height: 12, travelX: 0, travelY: 0 },
    ]);
    const world = new World(data), fighter = world.addFighter();
    advance(world, 60, { dropThrough: true });
    expect(fighter.y).toBe(321);
    expect(fighter.dropThroughState).toBeNull();
    expect(fighter.grounded).toBe(true);
  });

  it('passes a rapidly descending elevator instead of reacquiring its support', () => {
    const data = arena([{ id: 7, type: 'elevator', x: 220, y: 200, width: 200, height: 12, travelX: 0, travelY: 200, periodTicks: 80 }]);
    const world = new World(data), fighter = world.addFighter();
    advance(world, 12);
    expect(world.props[0].vy).toBeGreaterThan(TUNING.movement.dropThroughSpeed);
    advance(world, 1, { dropThrough: true });
    expect(fighter.vy).toBeGreaterThan(world.props[0].vy);
    advance(world, 80, { dropThrough: true });
    expect(fighter.y).toBe(621);
    expect(fighter.grounded).toBe(true);
    expect(fighter.dropThroughState).toBeNull();
  });

  it('rejects a prop drop when another platform leaves too little room below', () => {
    const data = arena([
      { id: 7, type: 'platform', x: 220, y: 200, width: 200, height: 12, travelX: 0 },
      { id: 8, type: 'platform', x: 220, y: 240, width: 200, height: 12, travelX: 0 },
    ]);
    const world = new World(data), fighter = world.addFighter();
    advance(world, 4, { dropThrough: true });
    expect(fighter.y).toBe(181);
    expect(fighter.dropThroughState).toBeNull();
  });

  it('clears support and held state on knockout and respawn', () => {
    const data = arena(); floor(data, 10);
    const world = new World(data), fighter = world.addFighter();
    advance(world, 1, { dropThrough: true });
    expect(fighter.dropThroughHeld).toBe(true);
    world.knockout(fighter);
    expect(fighter.dropThroughState).toBeNull();
    expect(fighter.dropThroughHeld).toBe(false);
    advance(world, TUNING.fighter.respawnTicks);
    expect(fighter.alive).toBe(true);
    expect(fighter.dropThroughState).toBeNull();
    expect(fighter.dropThroughHeld).toBe(false);
  });
});
