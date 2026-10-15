import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/data/arenas';
import { World } from '../src/sim/World';
import { createPlayback, createRecorder, decodeReplay, encodeReplay, REPLAY_LIMITS, validateReplay, type ReplayData } from '../src/sim/replay';
import { neutralInput, type ArenaData, type InputCommand } from '../src/sim/types';

function arena(): ArenaData {
  const width = 60, height = 40, tileSize = 20, tiles = Array<number>(width * height).fill(0);
  for (let col = 0; col < width; col++) tiles[30 * width + col] = 6;
  for (let row = 25; row < 30; row++) tiles[row * width + 13] = 2;
  for (let col = 10; col <= 17; col++) tiles[25 * width + col] = 2;
  return { id: 'replay-test', name: 'Replay test', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 100, y: 581 }, { x: 440, y: 581 }, { x: 760, y: 581 }],
    props: [{ id: 0, type: 'barrel', x: 180, y: 560, width: 24, height: 40 }, { id: 1, type: 'crate', x: 240, y: 560, width: 40, height: 40 }],
    weaponSpawns: [{ x: 460, y: 581 }], spawnTable: [{ weapon: 'molotov', weight: 1 }, { weapon: 'shotgun', weight: 3 }], background: '' };
}

function state(world: World): unknown {
  return {
    tick: world.tick, rng: world.rng.state, match: world.match, fighters: world.fighters,
    terrain: world.terrain.tiles, hp: world.terrain.tiles.map((_, index) => world.terrain.getHp(index % world.terrain.width, Math.floor(index / world.terrain.width))),
    props: world.props, debris: world.debris, chunks: world.structures.chunks, pickups: world.pickups,
    projectiles: world.projectiles, effects: world.effects, barriers: world.barriers, fire: [...world.fire.cells],
    bots: [...world.bots].map(([id, bot]) => [id, bot.rng.state, bot.debug]),
  };
}

function sample(): ReplayData {
  const world = new World(arena(), 123);
  world.addFighter();
  const recorder = createRecorder(world);
  world.step({ 0: neutralInput() });
  return recorder.export();
}

describe('deterministic replay recording and playback', () => {
  it('round-trips a seeded bot match with real destruction and restores every simulation subsystem', () => {
    const world = new World(arena(), 7182, { timeLimit: 10, scoreLimit: 0 });
    world.addFighter({ character: 'cinder', hp: 500, maxHp: 500 });
    world.addFighter({ character: 'flux', controller: 'bot', difficulty: 'normal', hp: 500, maxHp: 500 });
    world.addFighter({ character: 'wisp', controller: 'bot', difficulty: 'hard', hp: 500, maxHp: 500 });
    const recorder = createRecorder(world), events: string[] = [];
    for (let tick = 0; tick < 600; tick++) {
      const command: InputCommand = { ...neutralInput(), shoot: true,
        moveX: tick < 70 ? 0 : Math.sin(tick * 0.04), jump: tick % 111 < 12,
        throw: tick > 90 && tick % 180 < 25, aimY: tick % 180 < 25 ? -0.3 : 0,
        special: tick % 177 === 0, roll: tick % 149 === 0,
      };
      world.step({ 0: command });
      events.push(...world.events.map(event => event.type));
    }
    expect(events).toContain('explosion');
    expect(events).toContain('prop-break');
    expect(events).toContain('tile-break');
    expect(world.terrain.revision).toBeGreaterThan(0);
    expect(world.fighters.slice(1).every(fighter => fighter.combat.shots > 0)).toBe(true);
    expect(world.match.ended).toBe(true);
    const encoded = recorder.toJSON(), decoded = decodeReplay(encoded), replay = createPlayback(decoded);
    expect(decoded.durationTicks).toBe(600);
    const replayEvents: string[] = [];
    while (replay.step()) replayEvents.push(...replay.world.events.map(event => event.type));
    expect(replayEvents).toEqual(events);
    expect(state(replay.world)).toEqual(state(world));
    expect(replay.world.results()).toEqual(world.results());
    expect(replay.position).toBe(600);
    expect(replay.finished).toBe(true);
    const tick = replay.world.tick;
    expect(replay.step()).toBe(false);
    expect(replay.world.tick).toBe(tick);
  });

  it.each(ARENAS)('records authored $id arena settings without mutating its source', data => {
    const before = JSON.stringify(data), world = new World(data, 534, { mode: 'team', damageMode: 'percent', friendlyFire: false, weaponSet: 'custom', customWeapons: ['pistol', 'bat'] });
    world.addFighter({ character: 'rivet', team: 3 });
    world.addFighter({ character: 'flux', team: 5 });
    const recorder = createRecorder(world);
    for (let tick = 0; tick < 20; tick++) world.step({ 0: { ...neutralInput(), moveX: 1, shoot: true } });
    const playback = createPlayback(recorder.toJSON());
    while (playback.step()) { /* Replay to end. */ }
    expect(state(playback.world)).toEqual(state(world));
    expect(JSON.stringify(data)).toBe(before);
  });

  it('preserves configured inventories, infinite durability, damage and special state', () => {
    const world = new World(arena(), 123, { scoreLimit: 0 });
    const fighter = world.addFighter({ hp: 750, maxHp: 750, damage: 123, speedScale: 0.95, invulnerableTicks: 4 });
    fighter.combat.primary = 'grenade-launcher'; fighter.combat.equipped = 'primary';
    fighter.combat.ammo['grenade-launcher'] = 2; fighter.combat.specialMeter = 100;
    fighter.combat.melee = 'bat'; fighter.combat.durability.bat = 7;
    const recorder = createRecorder(world);
    world.step({ 0: { ...neutralInput(), shoot: true } });
    const replay = createPlayback(recorder.toJSON());
    expect(replay.world.fighters[0].combat.durability.unarmed).toBe(Infinity);
    expect(replay.world.fighters[0].combat.durability.bat).toBe(7);
    replay.step();
    expect(state(replay.world)).toEqual(state(world));
  });

  it('compresses repeated external inputs and preserves deliberate overrides for bot controllers', () => {
    const world = new World(arena(), 123);
    world.addFighter({ controller: 'bot' });
    const recorder = createRecorder(world), command = neutralInput();
    for (let tick = 0; tick < 90; tick++) world.step({ 0: command });
    const before = recorder.export();
    expect(before.frames).toHaveLength(1);
    expect(before.frames[0].repeat).toBe(90);
    command.moveX = 1;
    world.step({ 0: command });
    expect(before.frames[0].inputs[0][1]).toBe(0);
    expect(before.durationTicks).toBe(90);
    const playback = createPlayback(recorder.export());
    while (playback.step()) { /* Replay bot overrides exactly once. */ }
    expect(state(playback.world)).toEqual(state(world));
    expect(world.bots.get(0)!.debug.targetId).toBe(null);
  });

  it('exports a partial match, unsubscribes cleanly and leaves empty recordings playable', () => {
    const world = new World(arena()); world.addFighter();
    const recorder = createRecorder(world);
    expect(createPlayback(recorder.export()).finished).toBe(true);
    world.step({}); recorder.stop(); world.step({});
    expect(recorder.durationTicks).toBe(1);
    expect(recorder.recording).toBe(false);
    const replay = createPlayback(recorder.export());
    expect(replay.step()).toBe(true);
    expect(replay.finished).toBe(true);
    expect(replay.world.match.ended).toBe(false);
  });

  it('caps recording duration without stopping the live simulation or growing the input log', () => {
    const world = new World(arena(), 123, { mode: 'stocks', timeLimit: 0 });
    world.addFighter({ alive: false, stocks: 0 });
    const recorder = createRecorder(world);
    for (let tick = 0; tick <= REPLAY_LIMITS.maxTicks; tick++) world.step({});
    expect(recorder.durationTicks).toBe(REPLAY_LIMITS.maxTicks);
    expect(recorder.truncated).toBe(true);
    expect(recorder.recording).toBe(false);
    expect(world.tick).toBe(REPLAY_LIMITS.maxTicks + 1);
    expect(recorder.export().frames).toHaveLength(1);
    expect(decodeReplay(recorder.toJSON()).durationTicks).toBe(REPLAY_LIMITS.maxTicks);
  });

  it('rejects late recording and pre-recording world mutations rather than saving an incorrect replay', () => {
    const late = new World(arena()); late.addFighter(); late.step({});
    expect(() => createRecorder(late)).toThrow('first simulation tick');
    const altered = new World(arena()); altered.addFighter(); altered.damageTerrain(13, 25, 1);
    expect(() => createRecorder(altered)).toThrow('fresh match');
    const pickup = new World(arena()); pickup.addFighter(); pickup.pickups[0].active = false;
    expect(() => createRecorder(pickup)).toThrow('fresh match');
    const botWorld = new World(arena()); const bot = botWorld.addFighter({ controller: 'bot' });
    botWorld.bots.get(bot.id)!.command(botWorld, bot);
    expect(() => createRecorder(botWorld)).toThrow('fresh match');
    const invalidDurability = new World(arena()); const invalid = invalidDurability.addFighter();
    invalid.combat.durability.pistol = NaN;
    expect(() => createRecorder(invalidDurability)).toThrow('durability');
  });

  it('stops at the last valid prefix if an unsupported input or changed roster appears', () => {
    const world = new World(arena()); world.addFighter(); const recorder = createRecorder(world);
    world.step({});
    world.step({ 0: { ...neutralInput(), moveX: NaN } });
    expect(recorder.durationTicks).toBe(1);
    expect(recorder.truncated).toBe(true);
    expect(recorder.error).toContain('finite');
    expect(() => decodeReplay(recorder.toJSON())).not.toThrow();
    const changed = new World(arena()); changed.addFighter(); const changedRecorder = createRecorder(changed);
    changed.addFighter(); changed.step({});
    expect(changedRecorder.truncated).toBe(true);
    expect(changedRecorder.durationTicks).toBe(0);
  });
});

describe('replay import validation', () => {
  it.each([
    ['version', (data: any) => { data.version = 999; }],
    ['duration', (data: any) => { data.durationTicks = 500; }],
    ['unknown fighter', (data: any) => { data.frames[0].inputs[0][0] = 99; }],
    ['duplicate input', (data: any) => { data.frames[0].inputs.push([...data.frames[0].inputs[0]]); }],
    ['axis bounds', (data: any) => { data.frames[0].inputs[0][1] = 1000; }],
    ['non-finite number', (data: any) => { data.fighters[0].vx = Infinity; }],
    ['negative repeated ticks', (data: any) => { data.frames[0].repeat = -1; }],
    ['duration allocation bound', (data: any) => { data.frames[0].repeat = REPLAY_LIMITS.maxTicks + 1; }],
    ['arena allocation bound', (data: any) => { data.arena.width = 1_000_000_000; }],
    ['duplicate fighter ID', (data: any) => { data.fighters.push(data.fighters[0]); }],
    ['unknown weapon ID', (data: any) => { data.fighters[0].combat.primary = '__proto__'; }],
    ['inherited weapon ID in arena', (data: any) => { data.arena.spawnTable = [{ weapon: '__proto__', weight: 1 }]; }],
    ['invalid durability', (data: any) => { data.fighters[0].combat.durability.bat = null; }],
    ['missing inventory state', (data: any) => { delete data.fighters[0].combat.ammo.pistol; }],
    ['unsupported match mode', (data: any) => { data.settings.mode = 'unknown'; }],
  ])('rejects malformed %s before constructing a simulation', (_label, mutate) => {
    const data = sample(); mutate(data);
    expect(() => validateReplay(data)).toThrow();
    expect(() => createPlayback(data)).toThrow();
  });

  it('rejects invalid JSON, overflowing JSON numbers and oversized files', () => {
    expect(() => decodeReplay('{')).toThrow('valid JSON');
    expect(() => decodeReplay(encodeReplay(sample()).replace('"seed":123', '"seed":1e309'))).toThrow('finite');
    expect(() => decodeReplay(' '.repeat(REPLAY_LIMITS.maxBytes + 1))).toThrow('16 MiB');
  });

  it('copies imported state and ignores unknown properties without prototype pollution', () => {
    const data = sample(), decoded = decodeReplay(encodeReplay(data).replace('"format":', '"__proto__":{"polluted":true},"format":'));
    const replay = createPlayback(decoded);
    decoded.fighters[0].hp = 1;
    decoded.frames[0].inputs[0][1] = -1;
    expect(replay.world.fighters[0].hp).toBe(100);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(replay.data, '__proto__')).toBe(false);
    expect(replay.data.frames[0].inputs[0][1]).toBe(0);
  });
});
