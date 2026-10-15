import { describe, expect, it } from 'vitest';
import { WORLD_TUNING } from '../src/data/worldTuning';
import { NavigationGraph } from '../src/sim/ai/NavigationGraph';
import { activeClimbables } from '../src/sim/entities/props';
import { overlapsTerrain } from '../src/sim/physics/aabb';
import { World } from '../src/sim/World';
import { neutralInput, type ArenaData, type ArenaProp, type InputCommand } from '../src/sim/types';

function arena(props: ArenaProp[] = [], width = 40): ArenaData {
  const height = 30, tileSize = 20, tiles = Array<number>(width * height).fill(0);
  for (let col = 0; col < width; col++) tiles[26 * width + col] = 6;
  return { id: 'world-content-test', name: 'World content', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 100, y: 501 }], props, weaponSpawns: [], background: '' };
}

function advance(world: World, ticks: number, input: Partial<InputCommand> = {}): void {
  for (let tick = 0; tick < ticks; tick++) world.step({ 0: { ...neutralInput(), ...input } });
}

describe('structural collapse', () => {
  it('does no flood fill on untouched floating fixtures, then drops unsupported tiles after a support cut', () => {
    const data = arena();
    for (let col = 10; col <= 15; col++) data.tiles[18 * data.width + col] = 3;
    data.tiles[19 * data.width + 10] = 2;
    for (let row = 20; row < 26; row++) data.tiles[row * data.width + 10] = 6;
    const source = [...data.tiles], world = new World(data);
    const fighter = world.addFighter({ x: 270 });
    advance(world, 5);
    expect(world.structures.visitedThisTick).toBe(0);
    expect(world.structures.chunks).toHaveLength(0);
    world.damageTerrain(10, 19, 10000);
    advance(world, 1);
    expect(world.terrain.get(13, 18)).toBe(0);
    expect(world.structures.chunks.some(chunk => chunk.active && chunk.material === 3)).toBe(true);
    advance(world, 60);
    expect(fighter.hp).toBeLessThan(fighter.maxHp);
    expect(world.terrain.get(10, 20)).toBe(6);
    expect(data.tiles).toEqual(source);
  });

  it('retains a supported component until its damageable support prop breaks', () => {
    const data = arena([{ id: 1, type: 'support', x: 160, y: 200, width: 20, height: 20 }]);
    for (let col = 8; col <= 14; col++) data.tiles[10 * data.width + col] = 4;
    const world = new World(data);
    world.damageTerrain(14, 10, 10000);
    advance(world, 2);
    expect(world.terrain.get(10, 10)).toBe(4);
    world.damageProp(world.props[0], 10000);
    advance(world, 2);
    expect(world.props[0].active).toBe(false);
    expect(world.terrain.get(10, 10)).toBe(0);
    expect(world.structures.chunks.length).toBeGreaterThan(0);
  });

  it('budgets large flood fills and caps falling bodies', () => {
    const data = arena([], 230);
    for (let col = 1; col <= 210; col++) data.tiles[10 * data.width + col] = 2;
    data.tiles[11 * data.width + 1] = 2;
    for (let row = 12; row < 26; row++) data.tiles[row * data.width + 1] = 6;
    const world = new World(data);
    world.damageTerrain(1, 11, 10000);
    for (let tick = 0; tick < 45; tick++) {
      world.step({});
      expect(world.structures.visitedThisTick).toBeLessThanOrEqual(WORLD_TUNING.structure.visitBudget);
      expect(world.structures.chunks.length).toBeLessThanOrEqual(WORLD_TUNING.structure.maxChunks);
    }
    expect(world.terrain.get(200, 10)).toBe(0);
    expect(world.structures.pendingCount).toBe(0);
  });
});

describe('persistent fire', () => {
  it('spreads through wood, burns it away over time, and hurts nearby fighters', () => {
    const data = arena();
    for (let col = 10; col <= 15; col++) {
      data.tiles[20 * data.width + col] = 2;
      data.tiles[21 * data.width + col] = 6;
    }
    const world = new World(data), fighter = world.addFighter({ x: 210, y: 381 });
    world.ignite(210, 410, 1, 7);
    expect(world.fire.cells.size).toBe(1);
    advance(world, WORLD_TUNING.fire.spreadTicks + 1);
    expect(world.fire.cells.has('11,20')).toBe(true);
    expect(fighter.hp).toBeLessThan(fighter.maxHp);
    expect(fighter.combat.lastHitBy).toBe(7);
    advance(world, 280);
    expect(world.terrain.get(10, 20)).toBe(0);
    expect(world.terrain.get(10, 21)).toBe(6);
    expect(world.fire.cells.size).toBeLessThanOrEqual(WORLD_TUNING.fire.maxCells);
  });

  it('spreads through authored grass and removes it after burning', () => {
    const world = new World(arena([{ id: 1, type: 'grass', x: 200, y: 480, width: 100, height: 20 }]));
    world.ignite(210, 490, 1);
    advance(world, WORLD_TUNING.fire.spreadTicks + 1);
    expect(world.fire.cells.has('11,24')).toBe(true);
    advance(world, WORLD_TUNING.fire.spreadTicks);
    expect(world.props[0].active).toBe(false);
  });
});

describe('interactive world bodies', () => {
  it.each([
    { type: 'moving-platform', travelX: 120, travelY: 0 },
    { type: 'elevator', travelX: 0, travelY: -100 },
  ])('carries a rider on a $type and permits jumping free', options => {
    const world = new World(arena([{ id: 1, ...options, x: 150, y: 400, width: 100, height: 16, periodTicks: 120 }]));
    const fighter = world.addFighter({ x: 200, y: 381 });
    advance(world, 30);
    expect(fighter.x).toBeCloseTo(200 + options.travelX / 2, 5);
    expect(fighter.y).toBeCloseTo(381 + options.travelY / 2, 5);
    expect(fighter.grounded).toBe(true);
    advance(world, 1, { jump: true });
    expect(fighter.vy).toBeLessThan(-500);
    expect(fighter.grounded).toBe(false);
    expect(fighter.y + fighter.height / 2).toBeLessThan(world.props[0].y - world.props[0].height / 2);
  });

  it('blocks a closed door, opens with interaction, and allows passage', () => {
    const world = new World(arena([{ id: 1, type: 'door', x: 200, y: 440, width: 20, height: 80 }]));
    const fighter = world.addFighter({ x: 150 });
    advance(world, 30, { moveX: 1 });
    expect(fighter.x).toBe(190);
    advance(world, 1, { interact: true });
    expect(world.props[0].open).toBe(true);
    advance(world, 25, { moveX: 1 });
    expect(fighter.x).toBeGreaterThan(230);
  });

  it('stops an elevator at an obstructed shaft without carrying its rider through a ceiling', () => {
    const data = arena([{ id: 1, type: 'elevator', x: 150, y: 440, width: 100, height: 16, travelY: -240, periodTicks: 180 }]);
    for (let col = 5; col <= 14; col++) data.tiles[15 * data.width + col] = 6;
    const world = new World(data), fighter = world.addFighter({ x: 200, y: 421 });
    for (let tick = 0; tick < 180; tick++) {
      world.step({});
      const platform = world.props[0];
      expect(overlapsTerrain(world.terrain, platform.x, platform.y, platform.width, platform.height)).toBe(false);
      expect(overlapsTerrain(world.terrain, fighter.x, fighter.y, fighter.width, fighter.height)).toBe(false);
      expect(fighter.y - fighter.height / 2).toBeGreaterThanOrEqual(320);
    }
    expect(fighter.hp).toBe(fighter.maxHp);
  });

  it('treats a platform as ground for rolling and for a Slam impact', () => {
    const data = arena([{ id: 1, type: 'moving-platform', x: 100, y: 400, width: 240, height: 16, travelX: 0, travelY: 0 }]);
    const rollWorld = new World(data), rolling = rollWorld.addFighter({ x: 200, y: 381 });
    advance(rollWorld, 1);
    advance(rollWorld, 1, { roll: true });
    expect(rolling.action).toBe('roll');
    expect(rolling.grounded).toBe(true);

    const slamWorld = new World(data), slamming = slamWorld.addFighter({ character: 'rivet', x: 200, y: 381 });
    slamming.combat.specialMeter = 100;
    advance(slamWorld, 1, { special: true });
    const impacts: number[] = [];
    for (let tick = 0; tick < 120; tick++) {
      slamWorld.step({});
      for (const event of slamWorld.events) if (event.type === 'slam') impacts.push(event.y);
    }
    expect(impacts).toEqual([400]);
    expect(slamming.combat.specialPhase).toBe('');
  });

  it('drops an anchored ladder and removes its navigation edges immediately', () => {
    const data = arena([
      { id: 1, type: 'ladder', x: 200, y: 200, width: 20, height: 320, anchorCol: 11, anchorRow: 10 },
      { id: 2, type: 'support', x: 160, y: 200, width: 20, height: 20 },
    ]);
    for (let col = 8; col <= 14; col++) if (col !== 10) data.tiles[10 * data.width + col] = 2;
    const world = new World(data);
    world.navigation = new NavigationGraph(world.terrain, activeClimbables(world));
    expect([...world.navigation.nodes.values()].some(node => node.edges.some(edge => edge.kind === 'climb'))).toBe(true);
    world.damageTerrain(11, 10, 10000);
    advance(world, 1);
    expect(world.props[0]).toMatchObject({ active: true, dynamic: true, broken: true });
    expect(activeClimbables(world)).toEqual([]);
    expect([...world.navigation.nodes.values()].some(node => node.edges.some(edge => edge.kind === 'climb'))).toBe(false);
    advance(world, 120);
    expect(world.props[0].active).toBe(false);
  });

  it('breaks a hanging light into a falling body and creates temporary knockout bodies', () => {
    const world = new World(arena([{ id: 1, type: 'hanging-light', x: 200, y: 200, width: 30, height: 12 }]));
    const light = world.props[0];
    world.damageProp(light, 1000);
    expect(light).toMatchObject({ active: true, dynamic: true, broken: true, damageable: false });
    advance(world, 20);
    expect(light.y).toBeGreaterThan(250);
    const fighter = world.addFighter({ vx: 300 });
    world.knockout(fighter);
    const ragdoll = world.props.find(prop => prop.type === 'ragdoll');
    expect(ragdoll?.active).toBe(true);
    expect(ragdoll?.color).toBe(fighter.color);
    advance(world, WORLD_TUNING.props.ragdollLife + 1);
    expect(ragdoll?.active).toBe(false);
  });
});
