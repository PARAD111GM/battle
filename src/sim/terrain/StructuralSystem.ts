import { WORLD_TUNING } from '../../data/worldTuning';
import { integrateRigid } from '../entities/rigid';
import type { Debris } from '../entities/types';
import type { World } from '../World';
import type { TileCoordinate } from './TileMap';

interface Search { queue: number[]; cursor: number; members: number[]; seen: Set<number> }
const S = WORLD_TUNING.structure;

/** Changes seed budgeted component searches; untouched maps do no structural work. */
export class StructuralSystem {
  readonly chunks: Debris[] = [];
  visitedThisTick = 0;
  private readonly pending = new Set<number>();
  private readonly checked = new Set<number>();
  private readonly observed = new Map<string, number>();
  private readonly detach: number[] = [];
  private search: Search | null = null;
  private detachCursor = 0;
  private nextChunk = 0;

  constructor(private readonly world: World) {}

  get pendingCount(): number { return this.pending.size + (this.search ? this.search.queue.length - this.search.cursor : 0) + this.detach.length - this.detachCursor; }

  invalidateArea(x: number, y: number, width: number, height: number): void {
    const map = this.world.terrain;
    this.restart();
    for (let row = Math.floor((y - height / 2) / map.tileSize) - 1; row <= Math.floor((y + height / 2) / map.tileSize) + 1; row++) {
      for (let col = Math.floor((x - width / 2) / map.tileSize) - 1; col <= Math.floor((x + width / 2) / map.tileSize) + 1; col++) this.seed(col, row);
    }
  }

  step(changes: Iterable<TileCoordinate>): void {
    const map = this.world.terrain;
    const fresh: TileCoordinate[] = [];
    for (const change of changes) {
      const key = `${change.col},${change.row}`, material = map.get(change.col, change.row);
      if (this.observed.get(key) === material) continue;
      this.observed.set(key, material);
      fresh.push(change);
    }
    if (fresh.length) {
      this.restart();
      for (const { col, row } of fresh) {
        this.seed(col, row); this.seed(col - 1, row); this.seed(col + 1, row); this.seed(col, row - 1); this.seed(col, row + 1);
      }
    }
    this.visitedThisTick = 0;
    while (this.visitedThisTick < S.visitBudget) {
      if (!this.search) {
        const seed = this.pending.values().next().value as number | undefined;
        if (seed === undefined) break;
        this.pending.delete(seed);
        if (this.checked.has(seed) || !map.isSolid(seed % map.width, Math.floor(seed / map.width))) continue;
        this.search = { queue: [seed], cursor: 0, members: [], seen: new Set([seed]) };
      }
      const job = this.search;
      const index = job.queue[job.cursor++];
      const col = index % map.width, row = Math.floor(index / map.width);
      this.visitedThisTick++;
      if (map.isSolid(col, row)) {
        job.members.push(index);
        if (this.anchored(col, row)) {
          for (const member of job.seen) this.checked.add(member);
          this.search = null;
          continue;
        }
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nextCol = col + dc, nextRow = row + dr;
          if (nextCol < 0 || nextCol >= map.width || nextRow < 0 || nextRow >= map.height || !map.isSolid(nextCol, nextRow)) continue;
          const next = nextRow * map.width + nextCol;
          if (!job.seen.has(next)) { job.seen.add(next); job.queue.push(next); }
        }
      }
      if (job.cursor >= job.queue.length) {
        for (const member of job.members) { this.checked.add(member); this.detach.push(member); }
        this.search = null;
      }
    }
    for (let count = 0; count < S.detachBudget && this.detachCursor < this.detach.length; count++) {
      const index = this.detach[this.detachCursor++], col = index % map.width, row = Math.floor(index / map.width);
      const material = map.get(col, row);
      if (!material || material === 6 || this.anchored(col, row)) continue;
      map.set(col, row, 0);
      this.observed.set(`${col},${row}`, 0);
      const x = (col + 0.5) * map.tileSize, y = (row + 0.5) * map.tileSize;
      this.spawnChunk(x, y, material);
      this.world.events.push({ type: 'collapse', x, y, amount: material });
    }
    if (this.detachCursor >= this.detach.length) { this.detach.length = 0; this.detachCursor = 0; }
    this.stepChunks();
  }

  private restart(): void {
    if (this.search?.members.length) this.pending.add(this.search.members[0]);
    this.search = null;
    this.checked.clear();
    // An edit can reconnect a component while its detached cells are still queued.
    for (let index = this.detachCursor; index < this.detach.length; index++) this.pending.add(this.detach[index]);
    this.detach.length = 0; this.detachCursor = 0;
  }

  private seed(col: number, row: number): void {
    const map = this.world.terrain;
    if (col >= 0 && row >= 0 && col < map.width && row < map.height && map.isSolid(col, row)) this.pending.add(row * map.width + col);
  }

  private anchored(col: number, row: number): boolean {
    const map = this.world.terrain;
    if (map.get(col, row) === 6) return true;
    const x = (col + 0.5) * map.tileSize, y = (row + 0.5) * map.tileSize;
    return this.world.props.some(prop => prop.active && prop.type === 'support'
      && Math.abs(prop.x - x) <= (prop.width + map.tileSize) / 2
      && Math.abs(prop.y - y) <= (prop.height + map.tileSize) / 2);
  }

  private spawnChunk(x: number, y: number, material: number): void {
    let chunk = this.chunks.find(item => !item.active);
    if (!chunk && this.chunks.length >= S.maxChunks) chunk = this.chunks[this.nextChunk++ % S.maxChunks];
    const data: Debris = { id: chunk?.id ?? this.chunks.length, active: true, x, y, width: this.world.terrain.tileSize - 0.1, height: this.world.terrain.tileSize - 0.1,
      vx: 0, vy: 0, rotation: 0, angularVelocity: 0, material, owner: -1, life: S.chunkLife, hitTargets: [] };
    if (chunk) Object.assign(chunk, data); else this.chunks.push(data);
  }

  private stepChunks(): void {
    for (const chunk of this.chunks) {
      if (!chunk.active) continue;
      if (--chunk.life <= 0) { chunk.active = false; continue; }
      const oldX = chunk.x, oldY = chunk.y, speed = chunk.vy;
      integrateRigid(chunk, this.world.terrain, S.gravity, 0, 0.8);
      if (speed >= S.crushSpeed) for (const fighter of this.world.fighters) {
        if (!fighter.alive || chunk.hitTargets.includes(fighter.id)) continue;
        const withinX = fighter.x + fighter.width / 2 >= Math.min(oldX, chunk.x) - chunk.width / 2 && fighter.x - fighter.width / 2 <= Math.max(oldX, chunk.x) + chunk.width / 2;
        const withinY = fighter.y + fighter.height / 2 >= oldY - chunk.height / 2 && fighter.y - fighter.height / 2 <= chunk.y + chunk.height / 2;
        if (withinX && withinY) {
          chunk.hitTargets.push(fighter.id);
          this.world.damageFighter(fighter, Math.min(S.crushDamage, 20 + speed * 0.055), chunk.owner, speed * 0.3, Math.PI / 2, 'crush');
        }
      }
      if (chunk.y > this.world.arena.height * this.world.terrain.tileSize + 200) chunk.active = false;
    }
  }
}
