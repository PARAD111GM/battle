import type { Fighter } from '../types';
import type { TileMap } from '../terrain/TileMap';

const EPSILON = 0.00001;

/** All simulation body positions are their centers, in world pixels. */
export function overlapsTerrain(map: TileMap, x: number, y: number, width: number, height: number): boolean {
  const left = Math.floor((x - width / 2 + EPSILON) / map.tileSize);
  const right = Math.floor((x + width / 2 - EPSILON) / map.tileSize);
  const top = Math.floor((y - height / 2 + EPSILON) / map.tileSize);
  const bottom = Math.floor((y + height / 2 - EPSILON) / map.tileSize);
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) if (map.isSolid(col, row)) return true;
  }
  return false;
}

export function hasGroundSupport(body: Fighter, map: TileMap): boolean {
  return overlapsTerrain(map, body.x, body.y + body.height / 2 + 0.25, body.width - 0.02, 0.5);
}

export interface CollisionResult { hitWall: boolean; hitCeiling: boolean; landed: boolean }

/** Axis-separated AABB sweep. Substeps stay below a tile so fast rolls cannot tunnel. */
export function moveAndCollide(body: Fighter, map: TileMap, dt: number): CollisionResult {
  const result: CollisionResult = { hitWall: false, hitCeiling: false, landed: false };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(body.vx), Math.abs(body.vy)) * dt / (map.tileSize * 0.45)));
  const subDt = dt / steps;
  const wasGrounded = body.grounded;
  body.grounded = false;
  for (let step = 0; step < steps; step++) {
    const dx = body.vx * subDt;
    body.x += dx;
    if (dx !== 0) {
      const left = Math.floor((body.x - body.width / 2 + EPSILON) / map.tileSize);
      const right = Math.floor((body.x + body.width / 2 - EPSILON) / map.tileSize);
      const top = Math.floor((body.y - body.height / 2 + EPSILON) / map.tileSize);
      const bottom = Math.floor((body.y + body.height / 2 - EPSILON) / map.tileSize);
      let resolvedX = body.x;
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
        if (!map.isSolid(col, row)) continue;
        resolvedX = dx > 0
          ? Math.min(resolvedX, col * map.tileSize - body.width / 2)
          : Math.max(resolvedX, (col + 1) * map.tileSize + body.width / 2);
        body.vx = 0;
        result.hitWall = true;
      }
      body.x = resolvedX;
    }
    const dy = body.vy * subDt;
    body.y += dy;
    if (dy !== 0) {
      const left = Math.floor((body.x - body.width / 2 + EPSILON) / map.tileSize);
      const right = Math.floor((body.x + body.width / 2 - EPSILON) / map.tileSize);
      const top = Math.floor((body.y - body.height / 2 + EPSILON) / map.tileSize);
      const bottom = Math.floor((body.y + body.height / 2 - EPSILON) / map.tileSize);
      let resolvedY = body.y;
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
        if (!map.isSolid(col, row)) continue;
        resolvedY = dy > 0
          ? Math.min(resolvedY, row * map.tileSize - body.height / 2)
          : Math.max(resolvedY, (row + 1) * map.tileSize + body.height / 2);
        body.vy = 0;
        if (dy > 0) body.grounded = true;
        else result.hitCeiling = true;
      }
      body.y = resolvedY;
    }
  }
  body.grounded ||= body.vy >= 0 && hasGroundSupport(body, map);
  result.landed = !wasGrounded && body.grounded;
  return result;
}
