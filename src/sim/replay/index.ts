import { World } from '../World';
import type { Fighter, InputCommand } from '../types';
import { recordInputs, restoreInputs } from './inputs';
import { checkReplaySize, decodeReplay, encodeReplay, validateReplay } from './validation';
import { REPLAY_LIMITS, REPLAY_VERSION, ReplayError, type ReplayData, type ReplayFighter } from './types';

export { decodeReplay, encodeReplay, validateReplay } from './validation';
export { REPLAY_LIMITS, REPLAY_VERSION, ReplayError } from './types';
export type { ReplayData, ReplayFrame, ReplayFighter, RecordedInput } from './types';

function snapshotFighter(fighter: Fighter): ReplayFighter {
  // Infinite durability is the only non-finite value in a newly configured fighter.
  for (const durability of Object.values(fighter.combat.durability)) {
    if (durability !== Infinity && !Number.isFinite(durability)) throw new ReplayError('Equipment durability must be finite or positive infinity');
  }
  return JSON.parse(JSON.stringify({ ...fighter, combat: { ...fighter.combat,
    durability: Object.fromEntries(Object.entries(fighter.combat.durability).map(([id, durability]) => [id, durability === Infinity ? null : durability])),
  } })) as ReplayFighter;
}

function restoreFighter(snapshot: ReplayFighter): Fighter {
  const copy = JSON.parse(JSON.stringify(snapshot)) as ReplayFighter;
  return { ...copy, combat: { ...copy.combat,
    durability: Object.fromEntries(Object.entries(copy.combat.durability).map(([id, durability]) => [id, durability === null ? Infinity : durability])),
  } };
}

function initialWorld(data: ReplayData): World {
  const world = new World(data.arena, data.seed, data.settings);
  for (const snapshot of data.fighters) {
    const fighter = world.addFighter(restoreFighter(snapshot));
    // addFighter establishes bot controllers/navigation; restore the exact configured
    // body and inventory after its normal loadout/ground-support initialization.
    Object.assign(fighter, restoreFighter(snapshot));
  }
  return world;
}

/** Attach once after configuring fighters, before the first tick; drive the match through World.step. */
export class ReplayRecorder {
  private readonly data: ReplayData;
  private readonly fighterIds: Set<number>;
  private unsubscribe: () => void = () => {};
  private lastInputs = '';
  private estimatedBytes: number;
  private active = true;
  private failure: string | null = null;

  constructor(world: World) {
    if (world.tick !== 0 || world.match.elapsedTicks !== 0 || world.match.ended) throw new ReplayError('Start recording before the first simulation tick');
    if (world.terrain.revision !== 0 || world.projectiles.length || world.effects.length || world.barriers.length || world.debris.length || world.fire.cells.size || world.structures.chunks.length) throw new ReplayError('Record a fresh match before terrain or world objects are modified');
    this.data = validateReplay({ format: 'rivetfall-replay', version: REPLAY_VERSION, seed: world.seed >>> 0,
      arena: world.arena, settings: world.settings, fighters: world.fighters.map(snapshotFighter),
      frames: [], durationTicks: 0, truncated: false });
    const restored = initialWorld(this.data);
    if (restored.rng.state !== world.rng.state || JSON.stringify(restored.props) !== JSON.stringify(world.props) || JSON.stringify(restored.pickups) !== JSON.stringify(world.pickups)
      || JSON.stringify([...restored.bots]) !== JSON.stringify([...world.bots])) {
      throw new ReplayError('Record a fresh match before props, pickups, bots, or random state are modified');
    }
    this.fighterIds = new Set(this.data.fighters.map(fighter => fighter.id));
    const json = JSON.stringify(this.data);
    checkReplaySize(json);
    this.estimatedBytes = new TextEncoder().encode(json).length + 128;
    this.unsubscribe = world.observeInputs(commands => this.capture(commands, world));
  }

  get recording(): boolean { return this.active; }
  get durationTicks(): number { return this.data.durationTicks; }
  get truncated(): boolean { return this.data.truncated; }
  get error(): string | null { return this.failure; }

  private capture(commands: Readonly<Record<number, InputCommand>>, world: World): void {
    if (!this.active) return;
    if (this.data.durationTicks >= REPLAY_LIMITS.maxTicks) { this.truncate('Recording reached the 30 minute limit'); return; }
    if (world.fighters.length !== this.fighterIds.size || world.fighters.some(fighter => !this.fighterIds.has(fighter.id))) { this.truncate('Fighter roster changed after recording began'); return; }
    try {
      const inputs = recordInputs(commands, this.fighterIds), key = JSON.stringify(inputs);
      const last = this.data.frames[this.data.frames.length - 1];
      if (last && key === this.lastInputs) last.repeat++;
      else {
        // Commands contain only ASCII number syntax. The allowance covers the
        // frame wrapper, comma, and the largest possible repeat field.
        const bytes = key.length + 64;
        if (this.estimatedBytes + bytes > REPLAY_LIMITS.maxBytes) { this.truncate('Recording reached the 16 MiB limit'); return; }
        this.data.frames.push({ repeat: 1, inputs });
        this.estimatedBytes += bytes;
        this.lastInputs = key;
      }
      this.data.durationTicks++;
    } catch (error) { this.truncate(error instanceof Error ? error.message : 'Unsupported input command'); }
  }

  private truncate(message: string): void { this.data.truncated = true; this.failure = message; this.stop(); }
  stop(): void { this.active = false; this.unsubscribe(); }
  /** A detached snapshot can be exported while the live recording continues. */
  export(): ReplayData { return validateReplay(this.data); }
  toJSON(): string { return encodeReplay(this.data); }
}

export class ReplayPlayback {
  readonly world: World;
  readonly data: ReplayData;
  private frameIndex = 0;
  private repeatIndex = 0;
  private elapsed = 0;

  constructor(data: ReplayData) {
    this.data = validateReplay(data);
    checkReplaySize(JSON.stringify(this.data));
    this.world = initialWorld(this.data);
  }

  get position(): number { return this.elapsed; }
  get finished(): boolean { return this.elapsed >= this.data.durationTicks || this.world.match.ended; }

  /** Steps exactly one recorded tick; bots regenerate their original decisions once. */
  step(): boolean {
    if (this.finished) return false;
    const frame = this.data.frames[this.frameIndex];
    this.world.step(restoreInputs(frame.inputs));
    this.elapsed++;
    if (++this.repeatIndex >= frame.repeat) { this.frameIndex++; this.repeatIndex = 0; }
    return true;
  }
}

export const createRecorder = (world: World): ReplayRecorder => new ReplayRecorder(world);
export const createPlayback = (data: ReplayData | string): ReplayPlayback => new ReplayPlayback(typeof data === 'string' ? decodeReplay(data) : data);
