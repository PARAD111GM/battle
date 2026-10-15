import { TUNING } from './tuning';

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

export const BOT_DIFFICULTIES = {
  easy: { reactionTicks: 21, aimError: 0.18, decisionTicks: 24, replanTicks: 60, rollChance: 0.08, blockChance: 0.35, attackIntervalTicks: 31, grenadeCooldownTicks: 420, grenadeChance: 0.35 },
  normal: { reactionTicks: TUNING.ai.reactionTicks, aimError: TUNING.ai.aimError, decisionTicks: 9, replanTicks: TUNING.ai.replanTicks, rollChance: 0.25, blockChance: 1, attackIntervalTicks: 23, grenadeCooldownTicks: TUNING.ai.grenadeCooldownTicks, grenadeChance: 1 },
  hard: { reactionTicks: 6, aimError: 0.04, decisionTicks: 6, replanTicks: 24, rollChance: 0.45, blockChance: 1, attackIntervalTicks: 19, grenadeCooldownTicks: 220, grenadeChance: 1 },
  expert: { reactionTicks: 4, aimError: 0.022, decisionTicks: 4, replanTicks: 18, rollChance: 0.65, blockChance: 1, attackIntervalTicks: 17, grenadeCooldownTicks: 190, grenadeChance: 1 },
} as const satisfies Record<string, BotDifficulty>;

export type BotDifficultyName = keyof typeof BOT_DIFFICULTIES;
export function botDifficulty(name: string): BotDifficulty {
  return BOT_DIFFICULTIES[name.toLowerCase() as BotDifficultyName] ?? BOT_DIFFICULTIES.normal;
}
