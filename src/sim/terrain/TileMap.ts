import type { ArenaData } from '../types';
export class TileMap {
  readonly width: number; readonly height: number; readonly tileSize: number;
  readonly tiles: number[]; revision = 0; dirtyChunks = new Set<string>();
  constructor(arena: ArenaData) { this.width=arena.width; this.height=arena.height; this.tileSize=arena.tileSize; this.tiles=[...arena.tiles]; }
  get(col: number,row: number): number { if(col<0||row<0||col>=this.width||row>=this.height)return 0;return this.tiles[row*this.width+col] ?? 0; }
  isSolid(col: number,row: number): boolean {return this.get(col,row)>0;}
  atPixel(x: number,y: number): number { return this.get(Math.floor(x/this.tileSize),Math.floor(y/this.tileSize)); }
  set(col: number,row: number,value: number): void {if(col<0||row<0||col>=this.width||row>=this.height)return;this.tiles[row*this.width+col]=value;this.revision++;this.dirtyChunks.add(`${Math.floor(col/32)},${Math.floor(row/32)}`);}
}
