import { TUNING } from '../../data/tuning';
import { overlapsTerrain } from '../physics/aabb';
import type { TileCoordinate, TileMap } from '../terrain/TileMap';
import type { ArenaProp, Vec2 } from '../types';
import { aStar } from './pathfinding';

export interface NavEdge {
  to: string;
  kind: 'walk' | 'jump' | 'drop' | 'climb' | 'ledge';
  cost: number;
  via?: Vec2;
}
export interface NavNode extends Vec2 { id: string; col: number; row: number; edges: NavEdge[] }

const M = TUNING.movement;
const WIDTH = TUNING.fighter.width;
const HEIGHT = TUNING.fighter.height;
const HALF_HEIGHT = HEIGHT / 2;
// The movement integrator applies gravity before moving on each fixed tick.
const JUMP_SPEED = M.jumpSpeed - M.gravity * TUNING.dt / 2;
const JUMP_HEIGHT = JUMP_SPEED ** 2 / (2 * M.gravity);

/** Deterministic navigation over standing surfaces, with collision-checked traversal edges. */
export class NavigationGraph {
  readonly nodes = new Map<string, NavNode>();
  revision = 0;
  private readonly columns = new Map<number, NavNode[]>();
  private readonly reach: number;
  private readonly reachColumns: number;
  private readonly pendingEdges = new Set<string>();

  constructor(private readonly map: TileMap, private props: ArenaProp[]) {
    this.reach = this.jumpDuration(map.height * map.tileSize + HEIGHT) * M.runSpeed;
    this.reachColumns = Math.ceil((this.reach + map.tileSize + WIDTH) / map.tileSize);
    for (let col = 0; col < map.width; col++) this.rebuildColumn(col);
    for (const node of this.nodes.values()) this.rebuildEdges(node);
    this.addClimbEdges();
  }

  nearest(x: number, y: number): NavNode | undefined {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    let nearest: NavNode | undefined;
    let bestDistance = Infinity;
    for (const node of this.nodes.values()) {
      const distance = (node.x - x) ** 2 + (node.y - y) ** 2;
      if (distance < bestDistance || (distance === bestDistance && nearest && node.id < nearest.id)) {
        nearest = node;
        bestDistance = distance;
      }
    }
    return nearest;
  }

  path(fromId: string, toId: string): NavNode[] { return aStar(this.nodes, fromId, toId); }

  /** Runtime anchors can remove climbables without changing nearby standing surfaces. */
  setClimbables(props: ArenaProp[]): void {
    const columns = new Set<number>();
    for (const node of this.nodes.values()) if (node.edges.some(edge => edge.kind === 'climb')) columns.add(node.col);
    for (const prop of props) {
      const center = Math.floor((prop.x + prop.width / 2) / this.map.tileSize);
      for (let col = center - 2; col <= center + 2; col++) columns.add(col);
    }
    this.props = props;
    for (const col of columns) for (const node of this.columns.get(col) ?? []) {
      node.edges = node.edges.filter(edge => edge.kind !== 'climb');
      this.pendingEdges.add(node.id);
    }
    this.addClimbEdges(columns);
    this.revision++;
  }

  findPath(from: Vec2, to: Vec2): NavNode[] {
    const start = this.nearest(from.x, from.y), goal = this.nearest(to.x, to.y);
    return start && goal ? this.path(start.id, goal.id) : [];
  }

  /** Synchronous convenience for tools/tests; gameplay advances the deterministic work queue. */
  repair(changes: Iterable<TileCoordinate>): void {
    this.queueRepair(changes);
    this.stepRepair(Infinity);
  }

  get pendingRepairs(): number { return this.pendingEdges.size; }

  /** Update standing surfaces immediately; remove stale corridors before expensive edge rebuilding. */
  queueRepair(changes: Iterable<TileCoordinate>): void {
    const changedColumns = new Set<number>();
    const changedRows = new Map<number, { min: number; max: number }>();
    for (const { col, row } of changes) {
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col >= this.map.width || row < 0 || row >= this.map.height) continue;
      const rows = changedRows.get(col);
      changedRows.set(col, { min: Math.min(row, rows?.min ?? row), max: Math.max(row, rows?.max ?? row) });
      const halo = Math.ceil(WIDTH / (2 * this.map.tileSize));
      for (let nearby = Math.max(0, col - halo); nearby <= Math.min(this.map.width - 1, col + halo); nearby++) changedColumns.add(nearby);
    }
    if (!changedColumns.size) return;
    const edgeColumns = new Set<number>();
    for (const col of changedColumns) {
      this.rebuildColumn(col);
      for (let nearby = Math.max(0, col - this.reachColumns); nearby <= Math.min(this.map.width - 1, col + this.reachColumns); nearby++) edgeColumns.add(nearby);
    }
    for (const col of edgeColumns) for (const node of this.columns.get(col) ?? []) {
      node.edges = node.edges.filter(edge => {
        const target = this.nodes.get(edge.to);
        if (!target) return false;
        const minCol = Math.floor((Math.min(node.x, target.x) - WIDTH / 2) / this.map.tileSize);
        const maxCol = Math.floor((Math.max(node.x, target.x) + WIDTH / 2) / this.map.tileSize);
        const rise = edge.kind === 'jump' || edge.kind === 'ledge' ? JUMP_HEIGHT : 0;
        const minRow = Math.floor((Math.min(node.y, target.y) - rise - HALF_HEIGHT) / this.map.tileSize);
        const maxRow = Math.floor((Math.max(node.y, target.y) + HALF_HEIGHT) / this.map.tileSize);
        for (let crossed = minCol; crossed <= maxCol; crossed++) {
          const rows = changedRows.get(crossed);
          if (rows && rows.min <= maxRow && rows.max >= minRow) return false;
        }
        return true;
      });
      this.pendingEdges.add(node.id);
    }
    this.revision++;
  }

  /** A fixed node count, never wall time, makes repair scheduling identical during replay. */
  stepRepair(nodeBudget: number = TUNING.ai.repairNodeBudget): number {
    const rebuiltColumns = new Set<number>();
    let count = 0;
    while (count < nodeBudget && this.pendingEdges.size) {
      const id = this.pendingEdges.values().next().value!;
      this.pendingEdges.delete(id);
      const node = this.nodes.get(id);
      if (!node) continue;
      this.rebuildEdges(node);
      rebuiltColumns.add(node.col);
      count++;
    }
    if (rebuiltColumns.size) {
      this.addClimbEdges(rebuiltColumns);
      if (!this.pendingEdges.size) this.revision++;
    }
    return count;
  }

  private rebuildColumn(col: number): void {
    const previous = new Map((this.columns.get(col) ?? []).map(node => [node.id, node]));
    const next: NavNode[] = [];
    for (let row = 0; row < this.map.height; row++) {
      if (!this.map.isSolid(col, row)) continue;
      const x = (col + 0.5) * this.map.tileSize;
      const y = row * this.map.tileSize - HALF_HEIGHT;
      if (!this.clear(x, y)) continue;
      const id = `${col},${row}`;
      const node = previous.get(id) ?? { id, col, row, x, y, edges: [] };
      next.push(node);
      this.nodes.set(id, node);
      previous.delete(id);
    }
    for (const id of previous.keys()) this.nodes.delete(id);
    this.columns.set(col, next);
  }

  private clear(x: number, y: number): boolean {
    return x - WIDTH / 2 >= 0 && x + WIDTH / 2 <= this.map.width * this.map.tileSize
      && y - HALF_HEIGHT >= 0 && y + HALF_HEIGHT <= this.map.height * this.map.tileSize
      && !overlapsTerrain(this.map, x, y, WIDTH, HEIGHT);
  }

  private segmentClear(from: Vec2, to: Vec2): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (this.map.tileSize / 4)));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      if (!this.clear(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false;
    }
    return true;
  }

  private rebuildEdges(node: NavNode): void {
    const edges: NavEdge[] = [];
    for (let col = Math.max(0, node.col - this.reachColumns); col <= Math.min(this.map.width - 1, node.col + this.reachColumns); col++) {
      for (const target of this.columns.get(col) ?? []) {
        if (target.id === node.id || Math.abs(target.x - node.x) > this.reach) continue;
        const dx = target.x - node.x, dy = target.y - node.y;
        const distance = Math.hypot(dx, dy);
        if (Math.abs(target.col - node.col) === 1 && target.row === node.row && this.segmentClear(node, target)) {
          edges.push({ to: target.id, kind: 'walk', cost: distance });
          continue;
        }
        // Walking is sufficient on a continuous surface and avoids needless bunny hopping.
        if (target.row === node.row && this.continuousFloor(node, target)) continue;
        if (dy > 0) {
          const via = this.dropVia(node, target);
          if (via) {
            edges.push({ to: target.id, kind: 'drop', cost: Math.hypot(via.x - node.x, via.y - node.y) + Math.hypot(target.x - via.x, target.y - via.y), via });
            continue;
          }
        }
        if (dy >= -JUMP_HEIGHT && this.jumpClear(node, target)) {
          edges.push({ to: target.id, kind: 'jump', cost: distance + this.map.tileSize * 0.75 });
          continue;
        }
        const ledge = this.ledgeVia(node, target);
        if (ledge) edges.push({ to: target.id, kind: 'ledge', cost: distance + HEIGHT, via: ledge });
      }
    }
    node.edges = edges.sort((a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0);
  }

  private continuousFloor(from: NavNode, to: NavNode): boolean {
    for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col++) {
      if (!this.nodes.has(`${col},${from.row}`)) return false;
    }
    return this.segmentClear(from, to);
  }

  private jumpClear(from: Vec2, to: Vec2): boolean {
    const duration = this.jumpDuration(to.y - from.y);
    if (Math.abs(to.x - from.x) / duration > M.runSpeed || duration <= 0) return false;
    const steps = Math.max(2, Math.ceil(duration / (TUNING.dt / 2)));
    for (let step = 1; step <= steps; step++) {
      const t = duration * step / steps;
      const x = from.x + (to.x - from.x) * step / steps;
      const terminalTime = (JUMP_SPEED + M.maxFallSpeed) / M.gravity;
      const cappedTime = Math.min(t, terminalTime);
      const y = from.y - JUMP_SPEED * cappedTime + M.gravity * cappedTime * cappedTime / 2 + Math.max(0, t - terminalTime) * M.maxFallSpeed;
      if (!this.clear(x, y)) return false;
    }
    return true;
  }

  private jumpDuration(dy: number): number {
    const fallDistance = dy + JUMP_HEIGHT;
    if (fallDistance < 0) return 0;
    const capTime = M.maxFallSpeed / M.gravity;
    const capDistance = M.gravity * capTime ** 2 / 2;
    const fallingTime = fallDistance <= capDistance ? Math.sqrt(2 * fallDistance / M.gravity) : capTime + (fallDistance - capDistance) / M.maxFallSpeed;
    return JUMP_SPEED / M.gravity + fallingTime;
  }

  private dropVia(from: NavNode, to: NavNode): Vec2 | undefined {
    for (const direction of [Math.sign(to.x - from.x) || 1, -(Math.sign(to.x - from.x) || 1)]) {
      if (this.map.isSolid(from.col + direction, from.row)) continue;
      const x = (from.col + (direction > 0 ? 1 : 0)) * this.map.tileSize + direction * (WIDTH / 2 + 0.05);
      const via = { x, y: from.y };
      if (!this.segmentClear(from, via)) continue;
      const dy = to.y - from.y;
      const capTime = M.maxFallSpeed / M.gravity;
      const capDistance = M.gravity * capTime ** 2 / 2;
      const duration = dy <= capDistance ? Math.sqrt(2 * dy / M.gravity) : capTime + (dy - capDistance) / M.maxFallSpeed;
      if (Math.abs(to.x - x) / duration > M.runSpeed) continue;
      const steps = Math.max(2, Math.ceil(duration / (TUNING.dt / 2)));
      let clear = true;
      for (let step = 1; step <= steps; step++) {
        const t = duration * step / steps;
        const fall = t <= capTime ? M.gravity * t ** 2 / 2 : capDistance + (t - capTime) * M.maxFallSpeed;
        if (!this.clear(x + (to.x - x) * step / steps, from.y + fall)) { clear = false; break; }
      }
      if (clear) return via;
    }
    return undefined;
  }

  private ledgeVia(from: NavNode, to: NavNode): Vec2 | undefined {
    if (from.y - to.y > JUMP_HEIGHT + HEIGHT + M.ledgeReach - 1) return undefined;
    const direction = Math.sign(to.x - from.x);
    if (!direction || this.map.isSolid(to.col - direction, to.row)) return undefined;
    const edgeX = (to.col + (direction < 0 ? 1 : 0)) * this.map.tileSize;
    // The hand can catch up to ledgeReach below the lip, then movement snaps into its hanging pose.
    const via = { x: edgeX - direction * (WIDTH / 2 + 0.01), y: to.row * this.map.tileSize + HALF_HEIGHT + M.ledgeReach - 1 };
    if (this.clear(via.x, via.y) && this.jumpClear(from, via)) return via;
    return undefined;
  }

  private addClimbEdges(onlyColumns?: Set<number>): void {
    for (const prop of this.props) {
      if (prop.type !== 'ladder' && prop.type !== 'rope') continue;
      const x = prop.x + prop.width / 2;
      const minCol = Math.max(0, Math.floor((x - this.map.tileSize - WIDTH / 2) / this.map.tileSize));
      const maxCol = Math.min(this.map.width - 1, Math.floor((x + this.map.tileSize + WIDTH / 2) / this.map.tileSize));
      if (onlyColumns && !Array.from({ length: maxCol - minCol + 1 }, (_, index) => minCol + index).some(col => onlyColumns.has(col))) continue;
      const candidates: NavNode[] = [];
      for (let col = minCol; col <= maxCol; col++) for (const node of this.columns.get(col) ?? []) {
        if (node.y >= prop.y - HALF_HEIGHT - 0.1 && node.y <= prop.y + prop.height - HALF_HEIGHT + 0.1
          && Math.abs(node.x - x) <= this.map.tileSize + WIDTH / 2) candidates.push(node);
      }
      for (const from of candidates) {
        if (onlyColumns && !onlyColumns.has(from.col)) continue;
        for (const to of candidates) {
          if (from.id === to.id || from.row === to.row) continue;
          const entry = { x, y: from.y }, exit = { x, y: to.y };
          if (!this.segmentClear(from, entry) || !this.segmentClear(entry, exit) || !this.segmentClear(exit, to)) continue;
          const edge: NavEdge = { to: to.id, kind: 'climb', cost: Math.abs(from.x - x) + Math.abs(to.y - from.y) * (M.runSpeed / M.climbSpeed) + Math.abs(to.x - x), via: exit };
          const existing = from.edges.findIndex(item => item.to === to.id);
          if (existing < 0) from.edges.push(edge);
          else if (edge.cost < from.edges[existing].cost || from.edges[existing].kind === 'ledge') from.edges[existing] = edge;
        }
        from.edges.sort((a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0);
      }
    }
  }
}
