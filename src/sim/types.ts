import type { CombatState } from './weapons/types';
export interface Vec2 { x: number; y: number }
export interface InputCommand {
  moveX: number; moveY: number; aimX: number; aimY: number;
  jump: boolean; attack: boolean; shoot: boolean; throw: boolean;
  special: boolean; roll: boolean; block: boolean; interact: boolean; switchWeapon: number;
}
export const neutralInput = (): InputCommand => ({moveX:0,moveY:0,aimX:1,aimY:0,jump:false,attack:false,shoot:false,throw:false,special:false,roll:false,block:false,interact:false,switchWeapon:0});
export type ActionState = 'idle' | 'run' | 'jump' | 'fall' | 'roll' | 'climb' | 'hang' | 'melee-windup' | 'melee-active' | 'melee-recovery' | 'shoot' | 'reload' | 'throw-windup' | 'throw-recovery' | 'block' | 'stunned' | 'special' | 'dead';
export interface Fighter {
  id: number; name: string; character: string; team: number; color: number;
  controller: 'human' | 'bot'; difficulty: string;
  x: number; y: number; vx: number; vy: number; width: number; height: number; facing: number;
  hp: number; maxHp: number; damage: number; stocks: number; alive: boolean;
  grounded: boolean; coyoteTicks: number; jumpBufferTicks: number; jumpHeld: boolean;
  action: ActionState; actionTicks: number; rollCooldown: number; invulnerableTicks: number;
  respawnTicks: number; climbing: boolean; ledge: Vec2 | null; rollHeld: boolean; climbCooldownTicks: number;
  combat: CombatState;
}
export interface SimEvent { type: string; x: number; y: number; fighterId?: number; amount?: number; color?: number; text?: string; intensity?: number; endX?:number;endY?:number;weapon?:string }
export interface ArenaProp { id: number; type: string; x: number; y: number; width: number; height: number; [key: string]: unknown }
export interface ArenaData { id: string; name: string; subtitle: string; width: number; height: number; tileSize: number; tiles: number[]; spawns: Vec2[]; props: ArenaProp[]; weaponSpawns: Vec2[]; background: string }
