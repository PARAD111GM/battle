export interface RigidBody {
  x: number; y: number; width: number; height: number;
  vx: number; vy: number; rotation: number; angularVelocity: number;
}
export interface PropBody extends RigidBody {
  id: number; type: string; active: boolean; dynamic: boolean;
  hp: number; maxHp: number; heldBy: number | null; owner: number; hitTargets: number[];
}
export interface Debris extends RigidBody {
  active: boolean; id: number; life: number; material: number; owner: number; hitTargets: number[];
}
