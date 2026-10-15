export type WeaponSlot = 'primary'|'sidearm'|'melee';
export interface CombatState {
  primary: string; sidearm: string; melee: string; throwable: string; equipped: WeaponSlot;
  ammo: Record<string,number>; reserve: Record<string,number>; cooldown: number; reloadTicks: number;
  meleeStage: number; comboWindow: number; hitTargets: number[]; hitProps: number[]; hitTiles: string[]; attackHeld: boolean; shootHeld: boolean;
  throwHeld: boolean; interactHeld: boolean; switchHeld: boolean;
  attackBufferTicks: number; grabTicks: number;
  throwableCount: number; cookTicks: number; specialMeter: number; stunTicks: number; blockMeter: number;
  aimX: number; aimY: number; pendingAttack: string; grabTarget: number|null; heldProp: number|null;
  lastHitBy: number; lastHitTick: number; kills: number; deaths: number; damageDealt: number; shots: number; hits: number;
}
export interface Projectile {
  active: boolean; id: number; kind: string; owner: number; weapon: string;
  x:number;y:number;vx:number;vy:number;radius:number;life:number;damage:number; blastRadius:number;
}
export interface Pickup {id:number;x:number;y:number;kind:string;weapon:string;active:boolean;respawnTicks:number}
export interface Hitbox {owner:number;x:number;y:number;width:number;height:number;damage:number;knockback:number;angle:number;kind:string}
