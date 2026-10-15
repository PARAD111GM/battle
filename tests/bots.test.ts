import { describe, expect, it, vi } from 'vitest';
import warehouse from '../src/data/arenas/warehouse.json';
import { TUNING } from '../src/data/tuning';
import { World } from '../src/sim/World';
import { WEAPONS } from '../src/sim/weapons/definitions';
import { neutralInput, type ArenaData, type InputCommand } from '../src/sim/types';

function arena(): ArenaData {
  const width = 160, height = 40, tileSize = 20;
  const tiles = Array<number>(width * height).fill(0);
  for (let x = 0; x < width; x++) tiles[30 * width + x] = 6;
  return {
    id: 'bots-test', name: 'Bots test', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 100, y: 581 }, { x: 300, y: 581 }], props: [], weaponSpawns: [], background: '',
  };
}

function input(patch: Partial<InputCommand> = {}): InputCommand { return { ...neutralInput(), ...patch }; }

describe('deterministic bot controllers', () => {
  it('creates navigation only when a bot joins and lets explicit commands override the bot', () => {
    const world = new World(arena());
    world.addFighter({ x: 300 });
    expect(world.navigation).toBe(null);
    expect(world.bots.size).toBe(0);
    const bot = world.addFighter({ x: 100, controller: 'bot' });
    expect(world.navigation).not.toBe(null);
    expect(world.bots.has(bot.id)).toBe(true);
    for (let tick = 0; tick < 120; tick++) world.step({ [bot.id]: neutralInput() });
    expect(bot.x).toBe(100);
    expect(bot.combat.shots).toBe(0);
    expect(world.fighters[0].hp).toBe(world.fighters[0].maxHp);
  });

  it('emits valid simulation inputs and keeps decision randomness separate from combat randomness', () => {
    const world = new World(arena(), 91);
    const bot = world.addFighter({ controller: 'bot' });
    world.addFighter({ x: 400, hp: 1000, maxHp: 1000 });
    const controller = world.bots.get(bot.id)!;
    for (let tick = 0; tick < 180; tick++) {
      const rngBefore = world.rng.state;
      const command = controller.command(world, bot);
      expect(world.rng.state).toBe(rngBefore);
      for (const axis of ['moveX', 'moveY', 'aimX', 'aimY'] as const) {
        expect(Number.isFinite(command[axis])).toBe(true);
        expect(Math.abs(command[axis])).toBeLessThanOrEqual(1);
      }
      for (const action of ['jump', 'attack', 'shoot', 'throw', 'special', 'roll', 'block', 'interact'] as const) {
        expect(typeof command[action]).toBe('boolean');
      }
      expect(Number.isInteger(command.switchWeapon)).toBe(true);
      expect(command.switchWeapon).toBeGreaterThanOrEqual(0);
      expect(command.switchWeapon).toBeLessThanOrEqual(4);
      world.step({ [bot.id]: command });
    }
  });

  it('engages a visible enemy and lands damage during a duel', () => {
    const world = new World(arena(), 12);
    const bot = world.addFighter({ controller: 'bot', hp: 500, maxHp: 500 });
    world.addFighter({ x: 400, hp: 500, maxHp: 500 });
    let acquired = false;
    for (let tick = 0; tick < 360; tick++) {
      world.step({});
      acquired ||= world.bots.get(bot.id)!.debug.targetId === 1;
    }
    expect(acquired).toBe(true);
    expect(bot.combat.shots).toBeGreaterThan(0);
    expect(bot.combat.damageDealt).toBeGreaterThan(0);
  });

  it('switches an exhausted sidearm to its loaded primary and continues fighting', () => {
    const world = new World(arena(), 12);
    const bot = world.addFighter({ controller: 'bot' });
    world.addFighter({ x: 400, hp: 1000, maxHp: 1000 });
    bot.combat.ammo.pistol = 0;
    bot.combat.reserve.pistol = 0;
    const initialPrimaryAmmo = bot.combat.ammo.smg;
    for (let tick = 0; tick < 90; tick++) world.step({});
    expect(bot.combat.equipped).toBe('primary');
    expect(bot.combat.ammo.smg).toBeLessThan(initialPrimaryAmmo);
    expect(bot.combat.damageDealt).toBeGreaterThan(0);
  });

  it('does not acquire an enemy behind a solid wall', () => {
    const data = arena();
    for (let row = 0; row < 30; row++) data.tiles[row * data.width + 18] = 6;
    const world = new World(data, 12);
    const bot = world.addFighter({ x: 200, controller: 'bot' });
    const hidden = world.addFighter({ x: 500 });
    for (let tick = 0; tick < 120; tick++) {
      world.step({});
      expect(world.bots.get(bot.id)!.debug.targetId).toBe(null);
    }
    expect(bot.combat.shots).toBe(0);
    expect(hidden.hp).toBe(hidden.maxHp);
  });

  it('does not acquire an unobstructed enemy outside its vision range', () => {
    const world = new World(arena(), 33);
    const bot = world.addFighter({ controller: 'bot' });
    world.addFighter({ x: 3000 });
    for (let tick = 0; tick < 90; tick++) {
      world.step({});
      expect(world.bots.get(bot.id)!.debug.targetId).toBe(null);
    }
    expect(bot.combat.shots).toBe(0);
  });

  it('does not acquire an initially hidden enemy through crate cover', () => {
    const data = arena();
    data.props = [{ id: 1, type: 'crate', x: 240, y: 540, width: 80, height: 60 }];
    const world = new World(data, 12);
    const bot = world.addFighter({ x: 160, controller: 'bot' });
    const hidden = world.addFighter({ x: 400 });
    const controller = world.bots.get(bot.id)!;
    for (let tick = 0; tick < TUNING.ai.reactionTicks * 3; tick++) {
      // Keep the observer behind cover while allowing its perception clock to advance.
      controller.command(world, bot);
      world.step({ [bot.id]: neutralInput() });
      expect(controller.debug.targetId).toBe(null);
    }
    expect(bot.combat.shots).toBe(0);
    expect(hidden.hp).toBe(hidden.maxHp);
  });

  it('jumps a floor gap to reach a pickup without falling or respawning', () => {
    const data = arena();
    for (let col = 10; col <= 13; col++) data.tiles[30 * data.width + col] = 0;
    data.weaponSpawns = [{ x: 350, y: 581 }];
    const world = new World(data, 21);
    const bot = world.addFighter({ x: 150, controller: 'bot' });
    const path = world.navigation!.findPath(bot, world.pickups[0]);
    expect(path.some((node, index) => node.edges.some(edge => edge.to === path[index + 1]?.id && edge.kind === 'jump'))).toBe(true);
    let crossedInAir = false;
    for (let tick = 0; tick < 300 && world.pickups[0].active; tick++) {
      world.step({});
      crossedInAir ||= bot.x > 200 && bot.x < 280 && bot.y < 570 && !bot.grounded;
    }
    expect(crossedInAir).toBe(true);
    expect(world.pickups[0].active).toBe(false);
    expect(bot.x).toBeGreaterThan(280);
    expect(bot.combat.deaths).toBe(0);
  });

  it('drops from an upper platform and lands on the lower pickup route', () => {
    const data = arena();
    for (let col = 5; col <= 14; col++) data.tiles[20 * data.width + col] = 6;
    data.weaponSpawns = [{ x: 390, y: 581 }];
    const world = new World(data, 21);
    const bot = world.addFighter({ x: 290, y: 381, controller: 'bot' });
    const path = world.navigation!.findPath(bot, world.pickups[0]);
    expect(path.some((node, index) => node.edges.some(edge => edge.to === path[index + 1]?.id && edge.kind === 'drop'))).toBe(true);
    let dropped = false;
    for (let tick = 0; tick < 300 && world.pickups[0].active; tick++) {
      world.step({});
      dropped ||= bot.y > 420 && !bot.grounded;
    }
    expect(dropped).toBe(true);
    expect(world.pickups[0].active).toBe(false);
    for (let tick = 0; tick < 30; tick++) world.step({ [bot.id]: neutralInput() });
    expect(bot.grounded).toBe(true);
    expect(bot.y).toBe(581);
    expect(bot.combat.deaths).toBe(0);
  });

  it.each([
    { startX: 360, pickupId: 0, catwalkY: 720 },
    { startX: 912, pickupId: 1, catwalkY: 648 },
  ])('climbs the authored Warehouse ladder and collects catwalk pickup $pickupId', ({ startX, pickupId, catwalkY }) => {
    const world = new World(warehouse, 83);
    const weapon = world.pickups[pickupId].weapon;
    const slot = WEAPONS[weapon].slot as 'primary' | 'sidearm' | 'melee';
    const bot = world.addFighter({ x: startX, y: 893, controller: 'bot' });
    for (const pickup of world.pickups) {
      pickup.active = pickup.id === pickupId;
      if (!pickup.active) pickup.respawnTicks = -1;
    }
    let climbed = false, highestY = bot.y;
    for (let tick = 0; tick < 600 && world.pickups[pickupId].active; tick++) {
      world.step({});
      climbed ||= bot.climbing;
      highestY = Math.min(highestY, bot.y);
    }
    expect(climbed).toBe(true);
    expect(highestY).toBeLessThan(catwalkY);
    expect(world.pickups[pickupId].active).toBe(false);
    expect(bot.combat[slot]).toBe(weapon);
  });

  it('repairs navigation after a destroyed support tile while preserving distant nodes', () => {
    const data = arena();
    data.tiles[30 * data.width + 15] = 1;
    const world = new World(data);
    const bot = world.addFighter({ controller: 'bot' });
    const navigation = world.navigation!;
    const distant = navigation.nearest(2500, 581)!;
    const destroyedSupport = navigation.nearest(310, 581)!;
    const revision = navigation.revision;
    expect(navigation.nodes.has(destroyedSupport.id)).toBe(true);
    world.damageTerrain(15, 30, 10000);
    for (let tick = 0; tick < TUNING.ai.repairTicks + 2; tick++) world.step({ [bot.id]: neutralInput() });
    expect(navigation.revision).toBeGreaterThan(revision);
    expect(navigation.nodes.has(destroyedSupport.id)).toBe(false);
    expect(navigation.nodes.get(distant.id)).toBe(distant);
    const repairedRevision = navigation.revision;
    for (let tick = 0; tick < 120; tick++) world.step({ [bot.id]: neutralInput() });
    expect(navigation.revision).toBe(repairedRevision);
  });

  it('replays one human and three bots for 1000 ticks with identical state and bounded graph updates', () => {
    const first = new World(arena(), 621), second = new World(arena(), 621);
    for (const world of [first, second]) {
      world.addFighter({ x: 500, hp: 400, maxHp: 400 });
      for (let id = 1; id <= 3; id++) world.addFighter({ x: 150 + id * 240, controller: 'bot', hp: 400, maxHp: 400 });
    }
    const initialRevision = first.navigation!.revision;
    const replans = vi.spyOn(first.navigation!, 'findPath');
    const started = performance.now();
    for (let tick = 0; tick < 1000; tick++) {
      const human = input({ moveX: Math.sin(tick * 0.035), aimX: tick % 100 < 50 ? 1 : -1, jump: tick % 103 < 12, shoot: tick % 11 < 4, attack: tick % 59 === 0, roll: tick % 97 === 0 });
      first.step({ 0: human }); second.step({ 0: human });
      expect(first.events).toEqual(second.events);
      if (tick % 25 === 0 || tick === 999) {
        expect(first.fighters).toEqual(second.fighters);
        expect(first.projectiles).toEqual(second.projectiles);
        expect(first.debris).toEqual(second.debris);
        expect(first.pickups).toEqual(second.pickups);
        expect(first.terrain.tiles).toEqual(second.terrain.tiles);
        for (let id = 1; id <= 3; id++) expect(first.bots.get(id)!.debug).toEqual(second.bots.get(id)!.debug);
      }
    }
    expect(first.rng.state).toBe(second.rng.state);
    expect(first.navigation!.revision).toBe(initialRevision);
    expect(first.navigation!.nodes.size).toBeLessThanOrEqual(first.arena.width * first.arena.height);
    expect(replans.mock.calls.length).toBeLessThanOrEqual(Math.ceil(1000 / TUNING.ai.reactionTicks) * 3 + 9);
    expect(performance.now() - started).toBeLessThan(10000);
  });
});
