import { MATERIALS } from '../../data/materials';
import type { ArenaData } from '../types';

export interface TileCoordinate { col: number; row: number }
export interface BrokenTile extends TileCoordinate { material: number; x: number; y: number }

const CHUNK_SIZE = 32;

export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly tiles: number[];
  revision = 0;
  readonly dirtyChunks = new Set<string>();
  /** Material changes, deduplicated until consumed by navigation or structural repair. */
  readonly changedTiles = new Map<string, TileCoordinate>();
  private readonly hitPoints: Float64Array;

  constructor(arena: ArenaData) {
    this.width = arena.width;
    this.height = arena.height;
    this.tileSize = arena.tileSize;
    this.tiles = [...arena.tiles];
    this.hitPoints = Float64Array.from(this.tiles, material => MATERIALS[material]?.hp ?? 0);
  }

  private inBounds(col: number, row: number): boolean {
    return Number.isInteger(col) && Number.isInteger(row)
      && col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  get(col: number, row: number): number {
    return this.inBounds(col, row) ? this.tiles[row * this.width + col] ?? 0 : 0;
  }

  getHp(col: number, row: number): number {
    return this.inBounds(col, row) ? this.hitPoints[row * this.width + col] ?? 0 : 0;
  }

  isSolid(col: number, row: number): boolean { return this.get(col, row) > 0; }

  atPixel(x: number, y: number): number {
    return this.get(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize));
  }

  set(col: number, row: number, value: number): void {
    if (!this.inBounds(col, row) || !Number.isInteger(value) || (value !== 0 && !MATERIALS[value])) return;
    const index = row * this.width + col;
    if (this.tiles[index] === value) return;
    this.tiles[index] = value;
    this.hitPoints[index] = MATERIALS[value]?.hp ?? 0;
    this.changedTiles.set(`${col},${row}`, { col, row });
    this.markDirty(col, row);
  }

  /** Apply finite positive damage. Only a newly destroyed tile produces a break record. */
  damage(col: number, row: number, amount: number): BrokenTile | null {
    if (!this.inBounds(col, row) || !Number.isFinite(amount) || amount <= 0) return null;
    const index = row * this.width + col;
    const material = this.tiles[index];
    const hp = this.hitPoints[index];
    if (!material || !Number.isFinite(hp) || hp <= 0) return null;
    const remaining = Math.max(0, hp - amount);
    if (remaining === hp) return null;
    if (remaining > 0) {
      this.hitPoints[index] = remaining;
      this.markDirty(col, row);
      return null;
    }
    this.set(col, row, 0);
    return { col, row, material, x: (col + 0.5) * this.tileSize, y: (row + 0.5) * this.tileSize };
  }

  /** Damage falls linearly from power at the blast center to zero at the radius. */
  damageCircle(x: number, y: number, radius: number, power: number): BrokenTile[] {
    const broken: BrokenTile[] = [];
    if (![x, y, radius, power].every(Number.isFinite) || radius <= 0 || power <= 0) return broken;
    const firstCol = Math.max(0, Math.floor((x - radius) / this.tileSize));
    const lastCol = Math.min(this.width - 1, Math.floor((x + radius) / this.tileSize));
    const firstRow = Math.max(0, Math.floor((y - radius) / this.tileSize));
    const lastRow = Math.min(this.height - 1, Math.floor((y + radius) / this.tileSize));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        if (!this.isSolid(col, row)) continue;
        const distance = Math.hypot((col + 0.5) * this.tileSize - x, (row + 0.5) * this.tileSize - y);
        if (distance >= radius) continue;
        const result = this.damage(col, row, power * (1 - distance / radius));
        if (result) broken.push(result);
      }
    }
    return broken;
  }

  private markDirty(col: number, row: number): void {
    this.revision++;
    // A one-tile halo also invalidates exposed-edge art in adjacent chunks.
    const firstChunkCol = Math.max(0, Math.floor((col - 1) / CHUNK_SIZE));
    const lastChunkCol = Math.min(Math.ceil(this.width / CHUNK_SIZE) - 1, Math.floor((col + 1) / CHUNK_SIZE));
    const firstChunkRow = Math.max(0, Math.floor((row - 1) / CHUNK_SIZE));
    const lastChunkRow = Math.min(Math.ceil(this.height / CHUNK_SIZE) - 1, Math.floor((row + 1) / CHUNK_SIZE));
    for (let chunkRow = firstChunkRow; chunkRow <= lastChunkRow; chunkRow++) {
      for (let chunkCol = firstChunkCol; chunkCol <= lastChunkCol; chunkCol++) {
        this.dirtyChunks.add(`${chunkCol},${chunkRow}`);
      }
    }
  }
}
