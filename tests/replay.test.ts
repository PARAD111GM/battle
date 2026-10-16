import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/data/arenas';
import { World } from '../src/sim/World';
import { createPlayback, createRecorder, decodeReplay, encodeReplay, REPLAY_LIMITS, REPLAY_VERSION, validateReplay, type ReplayData } from '../src/sim/replay';
import { recordInputs, restoreInputs } from '../src/sim/replay/inputs';
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
  it('appends sprint and drop-through bits without changing the original eight button positions', () => {
    const oldButtons = { ...neutralInput(), jump: true, attack: true, shoot: true, throw: true, special: true, roll: true, block: true, interact: true };
    const extended = { ...oldButtons, sprint: true, dropThrough: true, moveX: -0.5, aimY: 0.25, switchWeapon: 4 };
    const recorded = recordInputs({ 0: oldButtons, 1: extended }, new Set([0, 1]));
    expect(recorded[0][5]).toBe(255);
    expect(recorded[1]).toEqual([1, -0.5, 0, 1, 0.25, 1023, 4]);
    expect(restoreInputs(recorded)).toEqual({ 0: oldButtons, 1: extended });
    expect(recordInputs({ 0: { ...neutralInput(), sprint: true } }, new Set([0]))[0][5]).toBe(256);
    expect(recordInputs({ 0: { ...neutralInput(), dropThrough: true } }, new Set([0]))[0][5]).toBe(512);
    for (const [index, button] of ['jump', 'attack', 'shoot', 'throw', 'special', 'roll', 'block', 'interact'].entries()) {
      expect(recordInputs({ 0: { ...neutralInput(), [button]: true } }, new Set([0]))[0][5]).toBe(1 << index);
    }
  });

  it('round-trips sprint and a platform drop with identical intermediate and final simulation state', () => {
    const data = arena();
    data.props = [{ id: 0, type: 'moving-platform', x: 50, y: 400, width: 300, height: 16, travelX: 0, travelY: 0, periodTicks: 120 }];
    data.spawns = [{ x: 120, y: 381 }, { x: 800, y: 581 }];
    const world = new World(data, 821, { scoreLimit: 0 });
    const fighter = world.addFighter();
    const recorder = createRecorder(world), snapshots: unknown[] = [];
    let dropped = false;
    for (let tick = 0; tick < 100; tick++) {
      world.step({ 0: { ...neutralInput(), moveX: tick < 25 ? 1 : 0, sprint: tick < 25, dropThrough: tick >= 8 && tick < 15 } });
      dropped ||= fighter.dropThroughState !== null;
      snapshots.push(structuredClone(state(world)));
    }
    expect(dropped).toBe(true);
    expect(fighter.y).toBeGreaterThan(400);
    const decoded = decodeReplay(recorder.toJSON());
    expect(decoded.version).toBe(REPLAY_VERSION);
    expect(decoded.frames.some(frame => (frame.inputs[0][5] & 256) !== 0)).toBe(true);
    expect(decoded.frames.some(frame => (frame.inputs[0][5] & 512) !== 0)).toBe(true);
    const playback = createPlayback(decoded);
    for (const snapshot of snapshots) { expect(playback.step()).toBe(true); expect(state(playback.world)).toEqual(snapshot); }
    expect(playback.finished).toBe(true);
  });

  it.each([
    { kind: 'tiles' as const, row: 25, startCol: 10, endCol: 17 },
    { kind: 'prop' as const, propId: 2 },
  ])('preserves a configured $kind drop-through snapshot and held-button latch', dropThroughState => {
    const data = arena();
    data.props.push({ id: 2, type: 'moving-platform', x: 80, y: 400, width: 120, height: 16, travelX: 0, travelY: 0, periodTicks: 120 });
    const world = new World(data, 71), fighter = world.addFighter({
      x: dropThroughState.kind === 'tiles' ? 240 : 120,
      y: dropThroughState.kind === 'tiles' ? 510 : 405,
      vy: 120, dropThroughHeld: true, dropThroughState,
    });
    const recorder = createRecorder(world), replay = createPlayback(recorder.toJSON());
    expect(replay.data.fighters[0].dropThroughHeld).toBe(true);
    expect(replay.data.fighters[0].dropThroughState).toEqual(dropThroughState);
    expect(replay.world.fighters[0]).toEqual(fighter);
    expect(replay.world.fighters[0].dropThroughState).not.toBe(fighter.dropThroughState);
    world.step({ 0: { ...neutralInput(), dropThrough: true, sprint: true } });
    const stepped = createPlayback(recorder.toJSON());
    stepped.step();
    expect(state(stepped.world)).toEqual(state(world));
  });

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
  it('normalizes version 1 snapshots and leaves both added inputs false during playback', () => {
    const current = sample();
    const legacy = JSON.parse(JSON.stringify(current));
    legacy.version = 1;
    delete legacy.fighters[0].dropThroughHeld;
    delete legacy.fighters[0].dropThroughState;
    const oldJSON = JSON.stringify(legacy), decoded = decodeReplay(oldJSON);
    expect(decoded.version).toBe(REPLAY_VERSION);
    expect(decoded.fighters[0].dropThroughHeld).toBe(false);
    expect(decoded.fighters[0].dropThroughState).toBe(null);
    expect(restoreInputs(decoded.frames[0].inputs)[0]).toMatchObject({ sprint: false, dropThrough: false });
    const originalPlayback = createPlayback(current), legacyPlayback = createPlayback(oldJSON);
    while (originalPlayback.step()) expect(legacyPlayback.step()).toBe(true);
    expect(state(legacyPlayback.world)).toEqual(state(originalPlayback.world));
    expect(JSON.stringify(legacy)).toBe(oldJSON);
    expect(decodeReplay(encodeReplay(decoded))).toEqual(decoded);
    legacy.fighters[0].dropThroughHeld = true;
    legacy.fighters[0].dropThroughState = { kind: 'prop', propId: 0 };
    const normalized = validateReplay(legacy);
    expect(normalized.fighters[0].dropThroughHeld).toBe(false);
    expect(normalized.fighters[0].dropThroughState).toBe(null);
  });

  it('retains the version 1 button-mask bound instead of interpreting old unknown bits', () => {
    const legacy = JSON.parse(JSON.stringify(sample()));
    legacy.version = 1;
    delete legacy.fighters[0].dropThroughHeld;
    delete legacy.fighters[0].dropThroughState;
    legacy.frames[0].inputs[0][5] = 255;
    expect(() => validateReplay(legacy)).not.toThrow();
    for (const buttons of [256, 512, 1023]) {
      legacy.frames[0].inputs[0][5] = buttons;
      expect(() => validateReplay(legacy)).toThrow('buttons');
    }
  });

  it.each(['sprint', 'dropThrough'] as const)('requires explicit boolean %s values in newly recorded inputs', button => {
    for (const value of [undefined, null, 1, 'true']) {
      const command = { ...neutralInput(), [button]: value } as unknown as InputCommand;
      expect(() => recordInputs({ 0: command }, new Set([0]))).toThrow('booleans');
    }
  });

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
    ['unknown button bit', (data: any) => { data.frames[0].inputs[0][5] = 1024; }],
    ['negative button mask', (data: any) => { data.frames[0].inputs[0][5] = -1; }],
    ['fractional button mask', (data: any) => { data.frames[0].inputs[0][5] = 0.5; }],
    ['missing drop button latch', (data: any) => { delete data.fighters[0].dropThroughHeld; }],
    ['non-boolean drop button latch', (data: any) => { data.fighters[0].dropThroughHeld = 1; }],
    ['missing drop support state', (data: any) => { delete data.fighters[0].dropThroughState; }],
    ['unknown drop support kind', (data: any) => { data.fighters[0].dropThroughState = { kind: 'anything' }; }],
    ['negative drop prop ID', (data: any) => { data.fighters[0].dropThroughState = { kind: 'prop', propId: -1 }; }],
    ['fractional drop prop ID', (data: any) => { data.fighters[0].dropThroughState = { kind: 'prop', propId: 0.5 }; }],
    ['out-of-grid drop row', (data: any) => { data.fighters[0].dropThroughState = { kind: 'tiles', row: data.arena.height, startCol: 0, endCol: 2 }; }],
    ['reversed drop tile span', (data: any) => { data.fighters[0].dropThroughState = { kind: 'tiles', row: 2, startCol: 4, endCol: 2 }; }],
    ['out-of-grid drop column', (data: any) => { data.fighters[0].dropThroughState = { kind: 'tiles', row: 2, startCol: 0, endCol: data.arena.width }; }],
    ['non-finite drop row', (data: any) => { data.fighters[0].dropThroughState = { kind: 'tiles', row: NaN, startCol: 0, endCol: 2 }; }],
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
