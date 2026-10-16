import type { BotDifficulty } from './ai';

/** Gameplay values use pixels, seconds, and simulation ticks (60 per second). */
export const TUNING = {
  tickRate: 60, dt: 1 / 60,
  movement: {runSpeed: 310, sprintMultiplier: 2, dropThroughSpeed: 120, acceleration: 2600, airAcceleration: 1700, friction: 3200, gravity: 1750, maxFallSpeed: 900, jumpSpeed: 620, jumpCut: 0.43, coyoteTicks: 6, jumpBufferTicks: 7, fastFallMultiplier: 1.85, rollSpeed: 570, rollTicks: 20, rollInvulnerableTicks: 12, rollCooldownTicks: 38, climbSpeed: 200, ledgeReach: 9, ledgeJumpSpeed: 550, climbJumpLockTicks: 14, climbDetachLockTicks: 12, ledgeClimbLockTicks: 10, ledgeDropLockTicks: 18, stunnedGroundDrag: 0.87, stunnedAirDrag: 0.993},
  fighter: {width: 20, height: 38, hp: 100, respawnTicks: 120, spawnInvulnerabilityTicks: 90},
  props: {gravity: 1200, bounce: 0.24, friction: 0.82, throwSpeed: 650, throwLift: 190, grabRange: 56, crateHp: 35, barrelHp: 30, barrelRadius: 170, barrelDamage: 65, lootChance: 0.45, impactMinSpeed: 180, impactDamageScale: 0.04, maxImpactDamage: 35, explosionTerrainMultiplier: 4, meleeTerrainPower: 25},
  debris: {maxCount: 96, lifeTicks: 420, gravity: 1100, bounce: 0.3, friction: 0.77, minSize: 5, maxSize: 11, impactMinSpeed: 220, maxImpactDamage: 18, damageScale: 0.022, piecesPerTile: 2},
  ai: {visionRange: 900, reactionTicks: 9, memoryTicks: 135, replanTicks: 36, repairTicks: 15, repairNodeBudget: 4, hardRecoveryTicks: 240, progressDistance: 96, aimError: 0.075, preferredRange: 310, fleeHealthRatio: 0.3, stuckRecoverTicks: 75, jumpHoldTicks: 23, grenadeCooldownTicks: 260, grenadeCookTicks: 22, hazardRange: 210},
  camera: {minZoom: 0.38, maxZoom: 1.25, padding: 230, lerp: 0.08},
  colors: {background: 0x111923, amber: 0xffb74d, cyan: 0x68e2df, coral: 0xff6b69, violet: 0xa99bff},
  visual: {maxDust: 256, maxCombatEffects: 192, maxDamageNumbers: 40, maxCasings: 96, maxPickupLabels: 64,
    hitstopMinFrames: 2, hitstopMaxFrames: 6, hitstopDamageThreshold: 18, hitstopDamageStep: 12,
    shakeMin: 0.0006, shakeMax: 0.004, shakeMinMs: 65, shakeMaxMs: 190,
    casingLife: 1.25, casingGravity: 600, casingBounce: 0.3, visualCullMargin: 120},
  performance: {maxFrameSteps: 8, maxFrameDeltaMs: 100, simWarningMs: 4, warningIntervalMs: 5000}
} as const;

/** Combat phases, hitboxes, and global weapon feel. Per-item content stays in JSON/TS data. */
export interface AttackDefinition {
  windupTicks: number; activeTicks: number; recoveryTicks: number;
  damage: number; knockback: number; angle: number; width: number; height: number; offsetX: number; offsetY: number;
}
export const COMBAT = {
  comboWindowTicks: 35, attackBufferTicks: 10, hitstunTicks: 10, guardBreakTicks: 65,
  maxHitstunTicks: 35, hitstunPerDamage: 0.35, knockbackLift: 90, healthKnockbackDivisor: 180, percentKnockbackDivisor: 85, specialGainTaken: 0.45, specialGainDealt: 0.7,
  guardMaximum: 100, guardDamageMultiplier: 2.1, guardRegenPerTick: 0.45,
  grabRange: 44, grabDurationTicks: 48, grabDamage: 18, grabKnockback: 600,
  pickupRange: 48, pickupRespawnTicks: 600, killCreditTicks: 480,
  attacks: {
    jab1: {windupTicks: 5, activeTicks: 4, recoveryTicks: 10, damage: 10, knockback: 145, angle: -0.16, width: 40, height: 28, offsetX: 25, offsetY: -4},
    jab2: {windupTicks: 4, activeTicks: 4, recoveryTicks: 11, damage: 12, knockback: 185, angle: -0.2, width: 45, height: 28, offsetX: 28, offsetY: -4},
    jab3: {windupTicks: 7, activeTicks: 5, recoveryTicks: 17, damage: 18, knockback: 460, angle: -0.4, width: 52, height: 32, offsetX: 30, offsetY: -4},
    uppercut: {windupTicks: 9, activeTicks: 7, recoveryTicks: 23, damage: 22, knockback: 610, angle: -1.15, width: 36, height: 60, offsetX: 18, offsetY: -22},
    divekick: {windupTicks: 5, activeTicks: 14, recoveryTicks: 20, damage: 21, knockback: 470, angle: 0.3, width: 40, height: 44, offsetX: 18, offsetY: 18},
  } satisfies Record<string, AttackDefinition>,
} as const;
export const GRENADE = { fuseTicks: 180, radius: 6, blastRadius: 135, damage: 60, speed: 640, gravity: 900, bounce: 0.55, count: 3, throwRecoveryTicks: 16 } as const;

export const SPECIALS = { meter: 100, slamWindupTicks: 12, slamLeapSpeed: 580, slamCrashSpeed: 850, slamRadius: 155, slamDamage: 40, slowTicks: 180, slowRadius: 350, slowScale: 0.45, dashTicks: 14, dashSpeed: 720, airStrikeDelay: 48, airStrikeRadius: 100, airStrikeDamage: 42, shieldTicks: 420, shieldHp: 210 } as const;

/** Budgeted world simulation and rigid-body defaults. */
export const WORLD_TUNING = {
  structure: { visitBudget: 160, detachBudget: 24, maxChunks: 96, chunkLife: 600, gravity: 1300, crushSpeed: 180, crushDamage: 70 },
  fire: { maxCells: 160, lifeTicks: 300, spreadTicks: 30, damageTicks: 15, tileDamage: 4, fighterDamage: 4 },
  props: { supportHp: 90, doorHp: 100, lightHp: 15, platformPeriod: 240, interactionRange: 65, ragdollLife: 180, maxRagdolls: 16 },
} as const;

/** Difficulty changes perception and tactics without changing physical rules. */
export const BOT_DIFFICULTIES = {
  easy: { reactionTicks: 21, aimError: 0.18, decisionTicks: 24, replanTicks: 60, rollChance: 0.08, blockChance: 0.35, attackIntervalTicks: 31, grenadeCooldownTicks: 420, grenadeChance: 0.35 },
  normal: { reactionTicks: TUNING.ai.reactionTicks, aimError: TUNING.ai.aimError, decisionTicks: 9, replanTicks: TUNING.ai.replanTicks, rollChance: 0.25, blockChance: 1, attackIntervalTicks: 23, grenadeCooldownTicks: TUNING.ai.grenadeCooldownTicks, grenadeChance: 1 },
  hard: { reactionTicks: 6, aimError: 0.04, decisionTicks: 6, replanTicks: 24, rollChance: 0.45, blockChance: 1, attackIntervalTicks: 19, grenadeCooldownTicks: 220, grenadeChance: 1 },
  expert: { reactionTicks: 4, aimError: 0.022, decisionTicks: 4, replanTicks: 18, rollChance: 0.65, blockChance: 1, attackIntervalTicks: 17, grenadeCooldownTicks: 190, grenadeChance: 1 },
} as const satisfies Record<string, BotDifficulty>;
