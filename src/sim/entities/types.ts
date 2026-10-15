export interface RigidBody {
  x: number; y: number; width: number; height: number;
  vx: number; vy: number; rotation: number; angularVelocity: number;
}
export interface PropBody extends RigidBody {
  id: number; type: string; active: boolean; dynamic: boolean;
  hp: number; maxHp: number; heldBy: number | null; owner: number; hitTargets: number[];
  damageable: boolean; open: boolean; broken: boolean;
  originX: number; originY: number; travelX: number; travelY: number; periodTicks: number;
  anchorCol?: number; anchorRow?: number; color?: number; life?: number;
}
export interface Debris extends RigidBody {
  active: boolean; id: number; life: number; material: number; owner: number; hitTargets: number[];
}
