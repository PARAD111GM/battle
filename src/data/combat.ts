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

export interface ThrowableDefinition { name: string; fuseTicks: number; radius: number; blastRadius: number; damage: number; speed: number; gravity: number; bounce: number; effect: string; lifeTicks?: number; sticky?: boolean; impact?: boolean }
export const THROWABLES: Record<string, ThrowableDefinition> = {
  grenade: { name: 'Frag grenade', ...GRENADE, effect: 'explosion' },
  molotov: { name: 'Molotov', fuseTicks: 180, radius: 6, blastRadius: 110, damage: 12, speed: 610, gravity: 950, bounce: 0, effect: 'fire', impact: true },
  'sticky-mine': { name: 'Sticky mine', fuseTicks: 240, lifeTicks: 1200, radius: 7, blastRadius: 125, damage: 65, speed: 560, gravity: 800, bounce: 0, effect: 'explosion', sticky: true },
  flashbang: { name: 'Flashbang', fuseTicks: 115, radius: 5, blastRadius: 240, damage: 0, speed: 660, gravity: 900, bounce: 0.6, effect: 'flash' },
  smoke: { name: 'Smoke canister', fuseTicks: 100, radius: 6, blastRadius: 190, damage: 0, speed: 600, gravity: 900, bounce: 0.4, effect: 'smoke' },
};
export const SPECIALS = { meter: 100, slamWindupTicks: 12, slamLeapSpeed: 580, slamCrashSpeed: 850, slamRadius: 155, slamDamage: 40, slowTicks: 180, slowRadius: 350, slowScale: 0.45, dashTicks: 14, dashSpeed: 720, airStrikeDelay: 48, airStrikeRadius: 100, airStrikeDamage: 42, shieldTicks: 420, shieldHp: 210 } as const;
