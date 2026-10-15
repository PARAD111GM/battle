import Phaser from 'phaser';

/** One boundary for replacing our original procedural art with production atlases. */
export interface AtlasSource { key: string; image: string; atlas: string }
export class AssetLibrary {
  static preload(scene: Phaser.Scene, atlases: AtlasSource[] = []): void {
    for (const source of atlases) scene.load.atlas(source.key, source.image, source.atlas);
  }

  static create(scene: Phaser.Scene): void {
    if (scene.textures.exists('rivet-particle')) return;
    const art = scene.make.graphics({ x: 0, y: 0 });
    art.fillStyle(0xffffff).fillRect(0, 0, 4, 4);
    art.generateTexture('rivet-particle', 4, 4);
    art.clear();
    art.fillStyle(0x080e15, 0.3).fillEllipse(18, 4, 36, 8);
    art.generateTexture('rivet-shadow', 36, 8);
    art.clear();
    art.fillStyle(0x372e24).fillRect(0, 0, 40, 40);
    art.fillStyle(0x8b6442).fillRect(2, 2, 36, 36);
    art.fillStyle(0xa47b4d).fillRect(4, 4, 32, 4).fillRect(4, 32, 32, 4);
    art.lineStyle(3, 0xc59858).lineBetween(5, 7, 34, 32).lineBetween(5, 32, 34, 7);
    art.lineStyle(1, 0x392e25).strokeRect(2, 2, 36, 36);
    art.fillStyle(0x34363a);
    for (const x of [5, 32]) for (const y of [5, 32]) art.fillRect(x, y, 3, 3);
    art.generateTexture('rivet-crate', 40, 40);
    art.clear();
    art.fillStyle(0x552d30).fillRoundedRect(1, 0, 26, 36, 3);
    art.fillStyle(0x99554a).fillRect(4, 3, 19, 29);
    art.fillStyle(0xe0a45a).fillRect(4, 11, 19, 13);
    art.fillStyle(0x2c3236).fillRect(0, 4, 28, 3).fillRect(0, 29, 28, 4);
    art.fillStyle(0x342c29).fillTriangle(14, 12, 6, 22, 22, 22);
    art.fillStyle(0xffd18a).fillRect(13, 16, 2, 3).fillRect(13, 20, 2, 1);
    art.generateTexture('rivet-barrel', 28, 36);
    art.destroy();
  }
}
