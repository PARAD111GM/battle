import definitions from '../../data/weapons.json';
import { COMBAT, GRENADE, THROWABLES, type AttackDefinition } from '../../data/combat';
import type { CombatState, WeaponSlot } from './types';
import type { MatchSettings } from '../match/types';

export interface WeaponDefinition {
  name: string; kind: string; slot: string; damage: number; magazine: number; reserve: number;
  cooldownTicks: number; reloadTicks: number; range: number; pellets: number; spread: number; recoil: number; terrainPower: number;
  fireMode?: string; projectileSpeed?: number; projectileGravity?: number; projectileBounce?: number; fuseTicks?: number;
  blastRadius?: number; effect?: string; directImpact?: boolean; ricochets?: number; ricochetLoss?: number;
  knockback?: number; durability?: number; attack?: AttackDefinition;
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
    specialHeld: false, specialTicks: 0, specialPhase: '', slowTicks: 0, flashTicks: 0, wearApplied: false,
    durability: Object.fromEntries(Object.entries(WEAPONS).map(([id, value]) => [id, value.durability ?? Infinity])),
    throwableAmmo: Object.fromEntries(Object.keys(THROWABLES).map(id => [id, id === 'grenade' ? GRENADE.count : 0])),
    throwableCount: GRENADE.count, cookTicks: 0, specialMeter: 0, stunTicks: 0, blockMeter: COMBAT.guardMaximum,
    aimX: 1, aimY: 0, pendingAttack: '', grabTarget: null, heldProp: null,
    lastHitBy: -1, lastHitTick: -1, kills: 0, deaths: 0, damageDealt: 0, shots: 0, hits: 0,
  };
}

export function pickupKind(id: string): string { return THROWABLES[id] ? 'throwable' : id === 'health' || id === 'ammo' ? id : 'weapon'; }

export function configureLoadout(combat: CombatState, settings: Pick<MatchSettings, 'weaponSet' | 'customWeapons'>): void {
  const allowed = (id: string): boolean => id === 'unarmed' || settings.weaponSet === 'all' || (settings.weaponSet === 'custom' ? settings.customWeapons.includes(id) : settings.weaponSet === 'melee' ? WEAPONS[id]?.kind === 'melee' : WEAPONS[id]?.kind === 'gun');
  for (const slot of ['primary', 'sidearm', 'melee'] as const) {
    if (allowed(combat[slot])) continue;
    combat[slot] = Object.keys(WEAPONS).find(id => WEAPONS[id].slot === slot && allowed(id)) ?? (slot === 'melee' ? 'unarmed' : '');
  }
  if (settings.weaponSet === 'melee' || settings.weaponSet === 'guns' || (settings.weaponSet === 'custom' && !settings.customWeapons.includes(combat.throwable))) {
    const available = settings.weaponSet === 'custom' ? Object.keys(THROWABLES).find(id => settings.customWeapons.includes(id)) : undefined;
    if (available) combat.throwable = available;
    else combat.throwableCount = 0;
  }
  if (!combat[combat.equipped]) combat.equipped = combat.primary ? 'primary' : combat.sidearm ? 'sidearm' : 'melee';
  combat.throwableAmmo[combat.throwable] = combat.throwableCount;
}
