/** Gameplay values use pixels, seconds, and simulation ticks (60 per second). */
export const TUNING = {
  tickRate: 60, dt: 1 / 60,
  movement: {runSpeed: 310, acceleration: 2600, airAcceleration: 1700, friction: 3200, gravity: 1750, maxFallSpeed: 900, jumpSpeed: 620, jumpCut: 0.43, coyoteTicks: 6, jumpBufferTicks: 7, fastFallMultiplier: 1.85, rollSpeed: 570, rollTicks: 20, rollInvulnerableTicks: 12, rollCooldownTicks: 38, climbSpeed: 200, ledgeReach: 9, ledgeJumpSpeed: 550, climbJumpLockTicks: 14, climbDetachLockTicks: 12, ledgeClimbLockTicks: 10, ledgeDropLockTicks: 18},
  fighter: {width: 20, height: 38, hp: 100, respawnTicks: 120, spawnInvulnerabilityTicks: 90},
  camera: {minZoom: 0.38, maxZoom: 1.25, padding: 230, lerp: 0.08},
  colors: {background: 0x111923, amber: 0xffb74d, cyan: 0x68e2df, coral: 0xff6b69, violet: 0xa99bff},
  performance: {maxFrameSteps: 8, simWarningMs: 4}
} as const;
