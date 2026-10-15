import Phaser from 'phaser';
import type { TileMap } from '../sim/terrain/TileMap';
import { MATERIALS } from '../data/materials';

const CHUNK_TILES = 32;
const MATERIAL_COLORS = [0, 0x77634a, 0xa47a48, 0x647270, 0x435d63, 0x87c8c4, 0x29383f];
let rendererSerial = 0;
interface RenderChunk { image: Phaser.GameObjects.Image; texture: Phaser.Textures.CanvasTexture; cx: number; cy: number; bounds: Phaser.Geom.Rectangle }

/** Only invalidated 32×32 tile canvases are uploaded; ordinary frames reuse their textures. */
export class TerrainView {
  private readonly art: Phaser.GameObjects.Graphics;
  private readonly chunks = new Map<string, RenderChunk>();
  private readonly prefix = `rivet-terrain-${rendererSerial++}`;
  private revision = -1;
  public rebuilds = 0;
  public lastRebuiltKeys: string[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly map: TileMap) {
    this.art = scene.add.graphics().setVisible(false);
  }

  get stats(): {total:number;visible:number;rebuilds:number} {
    return {total:this.chunks.size,visible:[...this.chunks.values()].filter(chunk=>chunk.image.visible).length,rebuilds:this.rebuilds};
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    if(this.revision!==this.map.revision) {
      const changed = this.revision < 0
        ? Array.from({length:Math.ceil(this.map.height/CHUNK_TILES)},(_,cy)=>Array.from({length:Math.ceil(this.map.width/CHUNK_TILES)},(_,cx)=>`${cx},${cy}`)).flat()
        : [...this.map.dirtyChunks];
      this.lastRebuiltKeys = [];
      for(const key of changed) {
        const [cx,cy]=key.split(',').map(Number);
        if(cx<0||cy<0||cx*CHUNK_TILES>=this.map.width||cy*CHUNK_TILES>=this.map.height)continue;
        this.rebuild(cx,cy,key);this.lastRebuiltKeys.push(key);
      }
      this.map.dirtyChunks.clear();
      this.revision=this.map.revision;
    }
    const view=camera.worldView;
    for(const chunk of this.chunks.values())chunk.image.setVisible(Phaser.Geom.Intersects.RectangleToRectangle(view,chunk.bounds));
  }

  private rebuild(cx:number,cy:number,key:string):void {
    const map=this.map,size=map.tileSize,g=this.art;
    const firstCol=cx*CHUNK_TILES,firstRow=cy*CHUNK_TILES;
    const endCol=Math.min(firstCol+CHUNK_TILES,map.width),endRow=Math.min(firstRow+CHUNK_TILES,map.height);
    const width=(endCol-firstCol)*size,height=(endRow-firstRow)*size;
    g.clear();
    for(let row=firstRow;row<endRow;row++)for(let col=firstCol;col<endCol;col++) {
      const material = map.get(col, row); if (!material) continue;
      const x = (col - firstCol) * size; const y = (row - firstRow) * size; const color = MATERIAL_COLORS[material] ?? 0x647270;
      const hash = (col * 73 + row * 37) % 11;
      g.fillStyle(color).fillRect(x, y, size, size);
      g.fillStyle(hash < 5 ? 0xffffff : 0x000000, 0.015 + hash * 0.004).fillRect(x, y, size, size);
      const top = map.get(col, row - 1) === 0;
      if (top) {
        g.fillStyle(material === 2 ? 0xdbb16d : material === 4 ? 0x8ca69e : 0x91a093).fillRect(x, y, size, 3);
        g.fillStyle(0x080f16, 0.5).fillRect(x, y + size - 4, size, 4);
        if (material === 4) {
          g.fillStyle(col % 2 ? 0xdbad62 : 0x273b40).fillRect(x, y + 4, size, 4);
          g.fillStyle(0x1b3139).fillTriangle(x + 4, y + 9, x + size - 4, y + 9, x + size - 4, y + size - 5);
          g.fillStyle(0xa2b7a8).fillRect(x + 2, y + size - 7, 2, 2);
        }
      }
      if (material === 2) {
        g.lineStyle(1, 0x574a35, 0.6).lineBetween(x, y + 10, x + size, y + 10).lineBetween(x + size - 1, y + 3, x + size - 1, y + size);
        g.fillStyle(0x503e2e).fillRect(x + 3, y + 4, 2, 2).fillRect(x + size - 5, y + 4, 2, 2);
      } else if (material === 3 && (col + row) % 3 === 0) {
        g.fillStyle(0x283d42, 0.4).fillRect(x + 6, y + 11, 4, 2).fillRect(x + 16, y + 6, 2, 2);
      } else if (material === 5) {
        g.lineStyle(1, 0xc3ffeb, 0.8).lineBetween(x + 3, y + 12, x + 12, y + 3);
        g.lineStyle(1, 0x25484b).strokeRect(x, y, size, size);
      } else if (material === 6) {
        g.lineStyle(1, 0x1e2b32).lineBetween(x, y + size - 1, x + size, y + size - 1);
      }
      if (!map.get(col - 1, row)) g.fillStyle(0xa9c1af, 0.2).fillRect(x, y + 3, 2, size - 3);
      if (!map.get(col + 1, row)) g.fillStyle(0x07121b, 0.35).fillRect(x + size - 2, y, 2, size);
      const maxHp = MATERIALS[material]?.hp ?? Infinity;
      const health = map.getHp(col, row) / maxHp;
      if (Number.isFinite(maxHp) && health < 0.98) {
        const centerX = x + size * (0.35 + (hash % 3) * 0.1), centerY = y + size * 0.5;
        g.lineStyle(1, 0x13252b, 0.85).beginPath().moveTo(x + 3, y + 4).lineTo(centerX, centerY).lineTo(x + size - 3, y + size - 4).strokePath();
        if (health < 0.6) g.lineStyle(1, 0x172b30, 0.9).beginPath().moveTo(centerX, centerY).lineTo(x + size - 3, y + 4).moveTo(centerX, centerY).lineTo(x + 4, y + size - 2).strokePath();
      }

    }
    let chunk=this.chunks.get(key);
    if(!chunk) {
      const textureKey=`${this.prefix}-${key}`;
      const texture=this.scene.textures.createCanvas(textureKey,width,height);
      if(!texture)throw new Error(`Could not create terrain chunk ${key}`);
      chunk={cx,cy,texture,image:this.scene.add.image(firstCol*size,firstRow*size,textureKey).setOrigin(0).setDepth(10),bounds:new Phaser.Geom.Rectangle(firstCol*size,firstRow*size,width,height)};
      this.chunks.set(key,chunk);
    }
    chunk.texture.context.clearRect(0,0,width,height);
    g.generateTexture(chunk.texture.key,width,height);
    this.rebuilds++;
  }

  destroy():void {
    this.art.destroy();
    for(const chunk of this.chunks.values()) {
      chunk.image.destroy();
      this.scene.textures.remove(chunk.texture.key);
    }
    this.chunks.clear();
  }
}
