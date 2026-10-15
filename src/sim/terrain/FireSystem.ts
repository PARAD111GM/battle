import { MATERIALS } from '../../data/materials';
import { WORLD_TUNING } from '../../data/worldTuning';
import type { World } from '../World';

export interface FireCell { col: number; row: number; x: number; y: number; age: number; life: number; owner: number }
const F = WORLD_TUNING.fire;

export class FireSystem {
  readonly cells = new Map<string, FireCell>();
  constructor(private readonly world: World) {}

  ignite(x: number, y: number, radius: number, owner = -1): void {
    if (![x, y, radius].every(Number.isFinite) || radius < 0) return;
    const map = this.world.terrain;
    let added = false;
    for (let row = Math.max(0, Math.floor((y - radius) / map.tileSize)); row <= Math.min(map.height - 1, Math.floor((y + radius) / map.tileSize)); row++) {
      for (let col = Math.max(0, Math.floor((x - radius) / map.tileSize)); col <= Math.min(map.width - 1, Math.floor((x + radius) / map.tileSize)); col++) {
        if (Math.hypot((col + 0.5) * map.tileSize - x, (row + 0.5) * map.tileSize - y) > radius + map.tileSize / 2) continue;
        if (this.fuel(col, row) || (!map.isSolid(col, row) && map.isSolid(col, row + 1))) { this.add(col, row, owner); added = true; }
      }
    }
    if (!added) this.add(Math.floor(x / map.tileSize), Math.floor(y / map.tileSize), owner);
  }

  step(): void {
    const map = this.world.terrain;
    for (const cell of [...this.cells.values()]) {
      cell.age++; cell.life--;
      if (cell.life <= 0) { this.cells.delete(`${cell.col},${cell.row}`); continue; }
      if (cell.age % F.spreadTicks === 0) for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (this.fuel(cell.col + dc, cell.row + dr)) this.add(cell.col + dc, cell.row + dr, cell.owner);
      }
      if (cell.age % F.damageTicks !== 0) continue;
      const material = MATERIALS[map.get(cell.col, cell.row)];
      if (material?.flammable) this.world.damageTerrain(cell.col, cell.row, F.tileDamage * (1 - material.fireResistance), cell.owner);
      for (const fighter of this.world.fighters) {
        if (fighter.alive && Math.abs(fighter.x - cell.x) < map.tileSize * 0.65 + fighter.width / 2
          && Math.abs(fighter.y - cell.y) < map.tileSize * 0.65 + fighter.height / 2) {
          this.world.damageFighter(fighter, F.fighterDamage, cell.owner, 0, 0, 'fire');
        }
      }
      for (const prop of this.world.props) {
        if (!prop.active || Math.abs(prop.x - cell.x) > (prop.width + map.tileSize) / 2 || Math.abs(prop.y - cell.y) > (prop.height + map.tileSize) / 2) continue;
        if (prop.type === 'grass' && cell.age >= F.spreadTicks * 2) prop.active = false;
        else if (prop.type === 'crate' || prop.type === 'barrel') this.world.damageProp(prop, F.tileDamage, cell.owner);
      }
    }
  }

  private fuel(col: number, row: number): boolean {
    const map = this.world.terrain;
    if (MATERIALS[map.get(col, row)]?.flammable) return true;
    const x = (col + 0.5) * map.tileSize, y = (row + 0.5) * map.tileSize;
    return this.world.props.some(prop => prop.active && prop.type === 'grass' && Math.abs(prop.x - x) <= prop.width / 2 && Math.abs(prop.y - y) <= prop.height / 2);
  }

  private add(col: number, row: number, owner: number): void {
    const map = this.world.terrain;
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) return;
    const key = `${col},${row}`;
    if (this.cells.has(key) || this.cells.size >= F.maxCells) return;
    const x = (col + 0.5) * map.tileSize, y = (row + 0.5) * map.tileSize;
    this.cells.set(key, { col, row, x, y, age: 0, life: F.lifeTicks, owner });
    this.world.events.push({ type: 'ignite', x, y, color: 0xff9f42 });
  }
}
