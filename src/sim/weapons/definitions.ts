import definitions from '../../data/weapons.json';
import { COMBAT, GRENADE } from '../../data/combat';
import type { CombatState, WeaponSlot } from './types';

export interface WeaponDefinition {
  name: string; kind: string; slot: string; damage: number; magazine: number; reserve: number;
  cooldownTicks: number; reloadTicks: number; range: number; pellets: number; spread: number; recoil: number; terrainPower: number;
}
export const WEAPONS: Record<string, WeaponDefinition> = definitions;
export function equippedWeapon(combat: CombatState): string { return combat[combat.equipped]; }
export function createCombatState(): CombatState {
  return {
    primary: 'smg', sidearm: 'pistol', melee: 'unarmed', throwable: 'grenade', equipped: 'sidearm' as WeaponSlot,
    ammo: Object.fromEntries(Object.entries(WEAPONS).map(([id, value]) => [id, value.magazine])),
    reserve: Object.fromEntries(Object.entries(WEAPONS).map(([id, value]) => [id, value.reserve])),
    cooldown: 0, reloadTicks: 0, meleeStage: 0, comboWindow: 0, hitTargets: [], hitProps: [], hitTiles: [], attackHeld: false, shootHeld: false,
    throwHeld: false, interactHeld: false, switchHeld: false, attackBufferTicks: 0, grabTicks: 0,
    throwableCount: GRENADE.count, cookTicks: 0, specialMeter: 0, stunTicks: 0, blockMeter: COMBAT.guardMaximum,
    aimX: 1, aimY: 0, pendingAttack: '', grabTarget: null, heldProp: null,
    lastHitBy: -1, lastHitTick: -1, kills: 0, deaths: 0, damageDealt: 0, shots: 0, hits: 0,
  };
}
