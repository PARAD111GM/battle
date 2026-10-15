export type WeaponSlot = 'primary'|'sidearm'|'melee';
export interface CombatState {
  primary: string; sidearm: string; melee: string; throwable: string; equipped: WeaponSlot;
  ammo: Record<string,number>; reserve: Record<string,number>; cooldown: number; reloadTicks: number;
  meleeStage: number; comboWindow: number; hitTargets: number[]; hitProps: number[]; hitTiles: string[]; attackHeld: boolean; shootHeld: boolean;
  throwHeld: boolean; interactHeld: boolean; switchHeld: boolean;
  attackBufferTicks: number; grabTicks: number;
  specialHeld: boolean; specialTicks: number; specialPhase: string; slowTicks: number; flashTicks: number; wearApplied: boolean;
  durability: Record<string,number>; throwableAmmo: Record<string,number>;
  throwableCount: number; cookTicks: number; specialMeter: number; stunTicks: number; blockMeter: number;
  aimX: number; aimY: number; pendingAttack: string; grabTarget: number|null; heldProp: number|null;
  lastHitBy: number; lastHitTick: number; kills: number; deaths: number; damageDealt: number; shots: number; hits: number;
}
export interface Projectile {
  active: boolean; id: number; kind: string; owner: number; weapon: string;
  x:number;y:number;vx:number;vy:number;radius:number;life:number;damage:number; blastRadius:number;
  gravity?:number; bounce?:number; effect?:string; sticky?:boolean; armedTicks?:number; stuck?:boolean; impact?:boolean;
  savedAmmo?:number; savedReserve?:number; savedDurability?:number;
}
export interface Pickup {id:number;x:number;y:number;kind:string;weapon:string;active:boolean;respawnTicks:number;quantity?:number;ammo?:number;reserve?:number;durability?:number}
export interface Hitbox {owner:number;x:number;y:number;width:number;height:number;damage:number;knockback:number;angle:number;kind:string}
export interface AreaEffect {id:number;kind:string;x:number;y:number;radius:number;life:number;owner:number}
export interface Barrier {id:number;owner:number;team:number;x:number;y:number;width:number;height:number;hp:number;life:number;active:boolean}
