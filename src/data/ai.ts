import { BOT_DIFFICULTIES } from './tuning';
export { BOT_DIFFICULTIES } from './tuning';
/** Difficulty changes perception and decisions, never damage, movement speed, or hidden information. */
export interface BotDifficulty {
  reactionTicks: number;
  aimError: number;
  decisionTicks: number;
  replanTicks: number;
  rollChance: number;
  blockChance: number;
  attackIntervalTicks: number;
  grenadeCooldownTicks: number;
  grenadeChance: number;
}

export type BotDifficultyName = keyof typeof BOT_DIFFICULTIES;
export function botDifficulty(name: string): BotDifficulty {
  return BOT_DIFFICULTIES[name.toLowerCase() as BotDifficultyName] ?? BOT_DIFFICULTIES.normal;
}
