import {describe,it,expect} from 'vitest';
import {ARENAS} from '../src/data/arenas';
import {TileMap} from '../src/sim/terrain/TileMap';
import {NavigationGraph} from '../src/sim/ai/NavigationGraph';
import {overlapsTerrain} from '../src/sim/physics/aabb';
import {TUNING} from '../src/data/tuning';

describe('authored arenas',()=>{
  for(const arena of ARENAS){
    it(`${arena.name} has clear spawns and routes between all eight starting positions`,()=>{
      const map=new TileMap(arena),nav=new NavigationGraph(map,arena.props);
      for(const spawn of arena.spawns){
        expect(overlapsTerrain(map,spawn.x,spawn.y,TUNING.fighter.width,TUNING.fighter.height)).toBe(false);
        for(const target of arena.spawns)expect(nav.findPath(spawn,target).length,`${arena.id}: ${JSON.stringify(spawn)} -> ${JSON.stringify(target)}`).toBeGreaterThan(0);
      }
    });
    it(`${arena.name} has valid climb anchors and useful authored content`,()=>{
      const map=new TileMap(arena);
      expect(arena.weaponSpawns.length).toBeGreaterThanOrEqual(6);
      expect(arena.props.some(p=>p.type==='crate')).toBe(true);
      for(const prop of arena.props){
        if(prop.type==='ladder'||prop.type==='rope'){
          expect(map.isSolid(Number(prop.anchorCol),Number(prop.anchorRow)),`anchor for ${prop.id}`).toBe(true);
          expect(prop.height).toBeGreaterThan(0);
        }
      }
    });
  }
});
