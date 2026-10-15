/** Gameplay values use pixels, seconds, and simulation ticks (60 per second). */
export const TUNING = {
  tickRate: 60, dt: 1 / 60,
  movement: {runSpeed: 310, acceleration: 2600, airAcceleration: 1700, friction: 3200, gravity: 1750, maxFallSpeed: 900, jumpSpeed: 620, jumpCut: 0.43, coyoteTicks: 6, jumpBufferTicks: 7, fastFallMultiplier: 1.85, rollSpeed: 570, rollTicks: 20, rollInvulnerableTicks: 12, rollCooldownTicks: 38, climbSpeed: 200, ledgeReach: 9, ledgeJumpSpeed: 550, climbJumpLockTicks: 14, climbDetachLockTicks: 12, ledgeClimbLockTicks: 10, ledgeDropLockTicks: 18},
  fighter: {width: 20, height: 38, hp: 100, respawnTicks: 120, spawnInvulnerabilityTicks: 90},
  props: {gravity: 1200, bounce: 0.24, friction: 0.82, throwSpeed: 650, throwLift: 190, grabRange: 56, crateHp: 35, barrelHp: 30, barrelRadius: 170, barrelDamage: 65, lootChance: 0.45, impactMinSpeed: 180, impactDamageScale: 0.04, maxImpactDamage: 35, explosionTerrainMultiplier: 4, meleeTerrainPower: 25},
  debris: {maxCount: 96, lifeTicks: 420, gravity: 1100, bounce: 0.3, friction: 0.77, minSize: 5, maxSize: 11, impactMinSpeed: 220, maxImpactDamage: 18, damageScale: 0.022, piecesPerTile: 2},
  camera: {minZoom: 0.38, maxZoom: 1.25, padding: 230, lerp: 0.08},
  colors: {background: 0x111923, amber: 0xffb74d, cyan: 0x68e2df, coral: 0xff6b69, violet: 0xa99bff},
  performance: {maxFrameSteps: 8, simWarningMs: 4}
} as const;
