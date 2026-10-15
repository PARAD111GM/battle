import { TUNING } from '../../data/tuning';
import type { TileMap } from '../terrain/TileMap';
import type { RigidBody } from './types';

/** Swept custom rigid AABB with no rendering or third-party physics dependencies. */
export function integrateRigid(body: RigidBody, map: TileMap, gravity: number, bounce: number, friction: number): void {
  body.vy += gravity * TUNING.dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(body.vx), Math.abs(body.vy)) * TUNING.dt / (map.tileSize / 3)));
  const dt = TUNING.dt / steps;
  for (let i = 0; i < steps; i++) {
    for (const axis of ['x', 'y'] as const) {
      const velocity = axis === 'x' ? 'vx' : 'vy';
      const delta = body[velocity] * dt;
      if (delta === 0) continue;
      body[axis] += delta;
      const minCol = Math.floor((body.x - body.width / 2 + 0.001) / map.tileSize);
      const maxCol = Math.floor((body.x + body.width / 2 - 0.001) / map.tileSize);
      const minRow = Math.floor((body.y - body.height / 2 + 0.001) / map.tileSize);
      const maxRow = Math.floor((body.y + body.height / 2 - 0.001) / map.tileSize);
      let resolved = body[axis], hit = false;
      for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
        if (!map.isSolid(col, row)) continue;
        const tilePosition = (axis === 'x' ? col : row) * map.tileSize;
        const halfSize = (axis === 'x' ? body.width : body.height) / 2;
        resolved = delta > 0 ? Math.min(resolved, tilePosition - halfSize) : Math.max(resolved, tilePosition + map.tileSize + halfSize);
        hit = true;
      }
      if (hit) {
        body[axis] = resolved;
        body[velocity] = -body[velocity] * bounce;
        body.angularVelocity *= friction;
        if (axis === 'y' && delta > 0) {
          body.vx *= friction;
          if (Math.abs(body.vy) < gravity * TUNING.dt * 1.5) body.vy = 0;
          if (Math.abs(body.vx) < 4) body.vx = 0;
        }
      }
    }
  }
  body.rotation += body.angularVelocity * TUNING.dt;
}
