import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import warehouse from '../src/data/arenas/warehouse.json';
import { World } from '../src/sim/World';
import { moveAndCollide, overlapsTerrain } from '../src/sim/physics/aabb';
import { neutralInput, type ArenaData, type InputCommand } from '../src/sim/types';

function arena(): ArenaData {
  const width = 40, height = 30, tileSize = 20;
  const tiles = Array<number>(width * height).fill(0);
  for (let x = 0; x < width; x++) tiles[20 * width + x] = 1;
  return { id: 'test', name: 'Test', subtitle: '', width, height, tileSize, tiles, spawns: [{ x: 80, y: 381 }], props: [], weaponSpawns: [], background: '' };
}

function input(patch: Partial<InputCommand> = {}): InputCommand { return { ...neutralInput(), ...patch }; }
function advance(world: World, count: number, command: Partial<InputCommand> = {}): void {
  for (let i = 0; i < count; i++) world.step({ 0: input(command) });
}

describe('fixed-step platform locomotion', () => {
  it('settles on a floor, accelerates and stops without penetrating tiles', () => {
    const world = new World(arena());
    const fighter = world.addFighter({ y: 80 });
    advance(world, 70);
    expect(fighter.y).toBe(381);
    expect(fighter.grounded).toBe(true);
    advance(world, 15, { moveX: 1 });
    expect(fighter.vx).toBe(TUNING.movement.runSpeed);
    expect(fighter.x).toBeGreaterThan(120);
    advance(world, 12);
    expect(fighter.vx).toBe(0);
    expect(overlapsTerrain(world.terrain, fighter.x, fighter.y, fighter.width, fighter.height)).toBe(false);
  });

  it('sweeps fast bodies into a wall, floor and ceiling without tunneling', () => {
    const data = arena();
    for (let row = 0; row < 20; row++) data.tiles[row * data.width + 10] = 1;
    for (let col = 0; col < 10; col++) data.tiles[2 * data.width + col] = 1;
    const world = new World(data);
    const fighter = world.addFighter({ x: 100, y: 200, vx: 20_000 });
    const wall = moveAndCollide(fighter, world.terrain, 1 / 60);
    expect(wall.hitWall).toBe(true);
    expect(fighter.x).toBe(190);
    fighter.vy = -20_000;
    const ceiling = moveAndCollide(fighter, world.terrain, 1 / 60);
    expect(ceiling.hitCeiling).toBe(true);
    expect(fighter.y).toBe(79);
    fighter.vy = 40_000;
    moveAndCollide(fighter, world.terrain, 1 / 60);
    expect(fighter.y).toBe(381);
    expect(fighter.grounded).toBe(true);
  });

  it('accepts a coyote jump shortly after walking off an edge', () => {
    const data = arena();
    for (let col = 5; col < data.width; col++) data.tiles[20 * data.width + col] = 0;
    const world = new World(data);
    const fighter = world.addFighter({ x: 96, vx: TUNING.movement.runSpeed });
    advance(world, 4, { moveX: 1 });
    expect(fighter.grounded).toBe(false);
    expect(fighter.coyoteTicks).toBeGreaterThan(0);
    advance(world, 1, { jump: true, moveX: 1 });
    expect(fighter.vy).toBeLessThan(-500);
    expect(fighter.coyoteTicks).toBe(0);
  });

  it('does not permit a new jump after the coyote window expires', () => {
    const data = arena();
    for (let col = 5; col < data.width; col++) data.tiles[20 * data.width + col] = 0;
    const world = new World(data);
    const fighter = world.addFighter({ x: 96, vx: TUNING.movement.runSpeed });
    advance(world, 12, { moveX: 1 });
    advance(world, 1, { jump: true, moveX: 1 });
    expect(fighter.vy).toBeGreaterThan(0);
  });

  it('buffers a jump pressed before landing and does not bounce on held jump', () => {
    const world = new World(arena());
    const fighter = world.addFighter({ y: 360, vy: 450 });
    advance(world, 1, { jump: true });
    expect(fighter.jumpBufferTicks).toBeGreaterThan(0);
    advance(world, 3, { jump: true });
    expect(fighter.vy).toBeLessThan(0);
    expect(fighter.jumpBufferTicks).toBe(0);
    advance(world, 80, { jump: true });
    expect(fighter.grounded).toBe(true);
    expect(fighter.vy).toBe(0);
  });

  it('makes released jumps lower and fast fall faster', () => {
    const highWorld = new World(arena()), lowWorld = new World(arena());
    const high = highWorld.addFighter(), low = lowWorld.addFighter();
    advance(highWorld, 1, { jump: true }); advance(lowWorld, 1, { jump: true });
    advance(highWorld, 15, { jump: true }); advance(lowWorld, 15);
    expect(high.y).toBeLessThan(low.y - 40);
    const slowWorld = new World(arena()), fastWorld = new World(arena());
    const slow = slowWorld.addFighter({ y: 80 }), fast = fastWorld.addFighter({ y: 80 });
    advance(slowWorld, 10); advance(fastWorld, 10, { moveY: 1 });
    expect(fast.vy).toBeGreaterThan(slow.vy * 1.5);
    expect(fast.y).toBeGreaterThan(slow.y);
  });

  it('rolls with a limited invulnerability window, cooldown and fresh-press requirement', () => {
    const world = new World(arena());
    const fighter = world.addFighter();
    advance(world, 1, { roll: true });
    expect(fighter.action).toBe('roll');
    expect(fighter.vx).toBe(TUNING.movement.rollSpeed);
    expect(fighter.invulnerableTicks).toBe(TUNING.movement.rollInvulnerableTicks);
    advance(world, TUNING.movement.rollInvulnerableTicks, { roll: true });
    expect(fighter.invulnerableTicks).toBe(0);
    expect(fighter.action).toBe('roll');
    advance(world, 50, { roll: true });
    expect(fighter.action).not.toBe('roll');
    expect(fighter.rollCooldown).toBe(0);
    advance(world, 1); advance(world, 1, { roll: true });
    expect(fighter.action).toBe('roll');
    advance(world, TUNING.movement.rollTicks);
    advance(world, 1, { roll: true });
    expect(fighter.action).not.toBe('roll');
    expect(fighter.rollCooldown).toBeGreaterThan(0);
  });

  it.each(['ladder', 'rope'])('climbs and pauses on a %s, then jumps free', type => {
    const data = arena();
    data.props.push({ id: 1, type, x: 70, y: 130, width: 20, height: 270 });
    const world = new World(data);
    const fighter = world.addFighter();
    advance(world, 12, { moveY: -1 });
    expect(fighter.climbing).toBe(true);
    expect(fighter.y).toBeLessThan(350);
    const pauseY = fighter.y;
    advance(world, 12);
    expect(fighter.y).toBe(pauseY);
    advance(world, 1, { moveY: -1, jump: true });
    expect(fighter.climbing).toBe(false);
    expect(fighter.vy).toBeLessThan(0);
    advance(world, 5, { moveY: -1, jump: true });
    expect(fighter.climbing).toBe(false);
  });

  it('climbs through every authored Warehouse catwalk opening', () => {
    for (const prop of warehouse.props.filter(item => item.type === 'ladder' || item.type === 'rope')) {
      const world = new World(warehouse);
      const fighter = world.addFighter({ x: prop.x + prop.width / 2, y: prop.y + prop.height - TUNING.fighter.height / 2 - 1 });
      const ticksToTop = Math.ceil(prop.height / (TUNING.movement.climbSpeed * TUNING.dt));
      advance(world, ticksToTop + 6, { moveY: -1 });
      expect(fighter.y + fighter.height / 2, `${prop.type} ${prop.id} reaches above its catwalk`).toBeLessThan(prop.y);
      expect(overlapsTerrain(world.terrain, fighter.x, fighter.y, fighter.width, fighter.height)).toBe(false);
    }
  });

  it('catches a ledge, climbs to its top, and can drop without immediately grabbing again', () => {
    const data = arena();
    data.tiles[10 * data.width + 10] = 1;
    data.tiles[10 * data.width + 11] = 1;
    const world = new World(data);
    const fighter = world.addFighter({ x: 186, y: 216, vy: 30 });
    advance(world, 1, { moveX: 1 });
    expect(fighter.action).toBe('hang');
    expect(fighter.ledge).toEqual({ x: 200, y: 200 });
    advance(world, 1, { moveY: -1 });
    expect(fighter.ledge).toBe(null);
    expect(fighter.grounded).toBe(true);
    expect(fighter.y).toBe(181);
    expect(fighter.x).toBe(211);
    fighter.x = 186; fighter.y = 216; fighter.vy = 30; fighter.grounded = false; fighter.climbCooldownTicks = 0;
    advance(world, 1, { moveX: 1 });
    expect(fighter.ledge).not.toBe(null);
    advance(world, 1, { moveY: 1 });
    advance(world, 2);
    expect(fighter.ledge).toBe(null);
    expect(fighter.vy).toBeGreaterThan(0);
  });

  it('respawns a sandbox fighter after falling beyond the bottom boundary', () => {
    const world = new World(arena());
    const fighter = world.addFighter({ x: -100, y: 900, damage: 50 });
    advance(world, 1);
    expect(fighter.alive).toBe(false);
    expect(world.events.some(event => event.type === 'ringout')).toBe(true);
    advance(world, TUNING.fighter.respawnTicks);
    expect(fighter.alive).toBe(true);
    expect(fighter.x).toBe(80);
    expect(fighter.y).toBe(381);
    expect(fighter.damage).toBe(0);
    expect(fighter.invulnerableTicks).toBe(TUNING.fighter.spawnInvulnerabilityTicks);
  });

  it('produces identical state and events for replayed inputs and seed', () => {
    const first = new World(arena(), 77), second = new World(arena(), 77);
    first.addFighter(); second.addFighter();
    for (let tick = 0; tick < 500; tick++) {
      const command = input({ moveX: Math.sin(tick * 0.13), jump: tick % 53 < 18, roll: tick % 79 === 0, moveY: tick % 61 > 45 ? 1 : 0 });
      first.step({ 0: command }); second.step({ 0: command });
      expect(first.fighters).toEqual(second.fighters);
      expect(first.events).toEqual(second.events);
    }
    expect(first.tick).toBe(500);
    expect(first.rng.state).toBe(second.rng.state);
    expect(first.arena.tiles).toEqual(arena().tiles);
  });
});
