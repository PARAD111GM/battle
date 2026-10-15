export interface AttackDefinition {
  windupTicks: number; activeTicks: number; recoveryTicks: number;
  damage: number; knockback: number; angle: number; width: number; height: number; offsetX: number; offsetY: number;
}
export const COMBAT = {
  comboWindowTicks: 35, attackBufferTicks: 10, hitstunTicks: 10, guardBreakTicks: 65,
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
