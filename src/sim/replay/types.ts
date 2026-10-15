import type { ArenaData, Fighter, InputCommand } from '../types';
import type { CombatState } from '../weapons/types';
import type { MatchSettings } from '../match/types';

export const REPLAY_VERSION = 1 as const;
export const REPLAY_LIMITS = {
  maxTicks: 60 * 60 * 30,
  maxBytes: 16 * 1024 * 1024,
  maxFighters: 8,
} as const;

/** Only infinite equipment durability uses null; all other replay numbers must be finite. */
export interface ReplayCombat extends Omit<CombatState, 'durability'> {
  durability: Record<string, number | null>;
}
export interface ReplayFighter extends Omit<Fighter, 'combat'> { combat: ReplayCombat }

/** id, movement x/y, aim x/y, button bit field, weapon-switch command. */
export type RecordedInput = [number, number, number, number, number, number, number];
export interface ReplayFrame { repeat: number; inputs: RecordedInput[] }
export interface ReplayData {
  format: 'rivetfall-replay';
  version: typeof REPLAY_VERSION;
  seed: number;
  arena: ArenaData;
  settings: MatchSettings;
  fighters: ReplayFighter[];
  frames: ReplayFrame[];
  durationTicks: number;
  /** True when the recorder stopped at a resource limit or unsupported input. */
  truncated: boolean;
}

export const INPUT_BUTTONS = ['jump', 'attack', 'shoot', 'throw', 'special', 'roll', 'block', 'interact'] as const satisfies readonly (keyof InputCommand)[];

export class ReplayError extends Error {
  constructor(message: string) { super(message); this.name = 'ReplayError'; }
}
