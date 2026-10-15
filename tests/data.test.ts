import {describe,it,expect} from 'vitest';
import {ARENAS} from '../src/data/arenas';
import {SeededRandom} from '../src/sim/random';
import {TileMap} from '../src/sim/terrain/TileMap';
describe('arena data and deterministic foundations',()=>{
  it('has complete grids, legal materials, and eight usable spawn positions',()=>{
    for(const arena of ARENAS){
      expect(arena.tiles).toHaveLength(arena.width*arena.height);
      expect(arena.spawns.length).toBeGreaterThanOrEqual(8);
      expect(arena.tiles.every(t=>Number.isInteger(t)&&t>=0&&t<=6)).toBe(true);
      const terrain=new TileMap(arena);
      for(const s of arena.spawns){expect(terrain.atPixel(s.x,s.y)).toBe(0);expect(s.x).toBeGreaterThan(0);expect(s.y).toBeLessThan(arena.height*arena.tileSize);}
    }
  });
  it('replays seeded random draws and does not modify source arena data',()=>{
    const a=new SeededRandom(56),b=new SeededRandom(56);
    expect(Array.from({length:100},()=>a.next())).toEqual(Array.from({length:100},()=>b.next()));
    const arena=ARENAS[0],original=arena.tiles[0],map=new TileMap(arena);map.set(0,0,4);
    expect(arena.tiles[0]).toBe(original);expect(map.dirtyChunks.has('0,0')).toBe(true);
  });
});
