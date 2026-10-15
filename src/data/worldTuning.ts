export const WORLD_TUNING = {
  structure: { visitBudget: 160, detachBudget: 24, maxChunks: 96, chunkLife: 600, gravity: 1300, crushSpeed: 180, crushDamage: 70 },
  fire: { maxCells: 160, lifeTicks: 300, spreadTicks: 30, damageTicks: 15, tileDamage: 4, fighterDamage: 4 },
  props: { supportHp: 90, doorHp: 100, lightHp: 15, platformPeriod: 240, interactionRange: 65, ragdollLife: 180, maxRagdolls: 16 },
} as const;
