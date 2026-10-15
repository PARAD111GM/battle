import { GRENADE } from './tuning';
export { COMBAT, GRENADE, SPECIALS } from './tuning';
export type { AttackDefinition } from './tuning';

export interface ThrowableDefinition { name: string; fuseTicks: number; radius: number; blastRadius: number; damage: number; speed: number; gravity: number; bounce: number; effect: string; lifeTicks?: number; sticky?: boolean; impact?: boolean }
export const THROWABLES: Record<string, ThrowableDefinition> = {
  grenade: { name: 'Frag grenade', ...GRENADE, effect: 'explosion' },
  molotov: { name: 'Molotov', fuseTicks: 180, radius: 6, blastRadius: 110, damage: 12, speed: 610, gravity: 950, bounce: 0, effect: 'fire', impact: true },
  'sticky-mine': { name: 'Sticky mine', fuseTicks: 240, lifeTicks: 1200, radius: 7, blastRadius: 125, damage: 65, speed: 560, gravity: 800, bounce: 0, effect: 'explosion', sticky: true },
  flashbang: { name: 'Flashbang', fuseTicks: 115, radius: 5, blastRadius: 240, damage: 0, speed: 660, gravity: 900, bounce: 0.6, effect: 'flash' },
  smoke: { name: 'Smoke canister', fuseTicks: 100, radius: 6, blastRadius: 190, damage: 0, speed: 600, gravity: 900, bounce: 0.4, effect: 'smoke' },
};
