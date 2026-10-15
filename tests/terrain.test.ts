import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../src/data/materials';
import { TileMap } from '../src/sim/terrain/TileMap';
import type { ArenaData } from '../src/sim/types';

function arena(width = 8, height = 8, material = 0): ArenaData {
  return {
    id: 'terrain-test', name: 'Terrain test', subtitle: '', width, height, tileSize: 20,
    tiles: Array<number>(width * height).fill(material), spawns: [], props: [], weaponSpawns: [], background: '',
  };
}

describe('destructible material terrain', () => {
  it('defines six materials with distinct durability and reusable feedback/fire data', () => {
    expect(Object.values(MATERIALS).map(material => material.name)).toEqual(['dirt', 'wood', 'concrete', 'metal', 'glass', 'bedrock']);
    expect(MATERIALS[5].hp).toBeLessThan(MATERIALS[1].hp);
    expect(MATERIALS[1].hp).toBeLessThan(MATERIALS[2].hp);
    expect(MATERIALS[2].hp).toBeLessThan(MATERIALS[3].hp);
    expect(MATERIALS[3].hp).toBeLessThan(MATERIALS[4].hp);
    expect(MATERIALS[6].hp).toBe(Infinity);
    for (const material of Object.values(MATERIALS)) {
      expect(material.hp).toBeGreaterThan(0);
      expect(material.debrisColor).toBeGreaterThan(0);
      expect(material.sound.length).toBeGreaterThan(0);
      expect(material.fireResistance).toBeGreaterThanOrEqual(0);
      expect(material.fireResistance).toBeLessThanOrEqual(1);
    }
    expect(MATERIALS[2].flammable).toBe(true);
    expect(MATERIALS[6].flammable).toBe(false);
  });

  it('keeps partial damage solid, then immediately removes collision at zero HP', () => {
    const map = new TileMap(arena(8, 8, 2));
    expect(map.damage(3, 4, 25)).toBeNull();
    expect(map.getHp(3, 4)).toBe(MATERIALS[2].hp - 25);
    expect(map.isSolid(3, 4)).toBe(true);
    expect(map.revision).toBe(1);
    expect(map.dirtyChunks).toEqual(new Set(['0,0']));
    expect(map.changedTiles.size).toBe(0);
    expect(map.damage(3, 4, MATERIALS[2].hp - 25)).toEqual({ col: 3, row: 4, material: 2, x: 70, y: 90 });
    expect(map.getHp(3, 4)).toBe(0);
    expect(map.get(3, 4)).toBe(0);
    expect(map.atPixel(70, 90)).toBe(0);
    expect(map.isSolid(3, 4)).toBe(false);
    expect(map.revision).toBe(2);
    expect(map.changedTiles.get('3,4')).toEqual({ col: 3, row: 4 });
    expect(map.damage(3, 4, 100)).toBeNull();
    expect(map.revision).toBe(2);
  });

  it('does not mutate source tiles, another map, or material durability', () => {
    const source = arena(8, 8, 2), before = [...source.tiles];
    const first = new TileMap(source), second = new TileMap(source);
    first.damage(1, 1, 25);
    first.damage(2, 2, 1000);
    first.set(3, 3, 4);
    expect(source.tiles).toEqual(before);
    expect(second.tiles).toEqual(before);
    expect(second.getHp(1, 1)).toBe(MATERIALS[2].hp);
    expect(first.getHp(1, 1)).toBe(MATERIALS[2].hp - 25);
    expect(first.getHp(3, 3)).toBe(MATERIALS[4].hp);
    first.set(1, 1, 2);
    expect(first.getHp(1, 1)).toBe(MATERIALS[2].hp - 25);
    first.set(1, 1, 0);
    first.set(1, 1, 2);
    expect(first.getHp(1, 1)).toBe(MATERIALS[2].hp);
    expect(Object.isFrozen(MATERIALS)).toBe(true);
    expect(Object.isFrozen(MATERIALS[2])).toBe(true);
  });

  it('applies radial attenuation, keeps the radius boundary unchanged, and excludes distant tiles', () => {
    const map = new TileMap(arena(8, 8, 2));
    const broken = map.damageCircle(70, 70, 40, 60);
    expect(broken).toEqual([{ col: 3, row: 3, material: 2, x: 70, y: 70 }]);
    expect(map.getHp(4, 3)).toBe(30);
    expect(map.getHp(4, 4)).toBeCloseTo(60 - 60 * (1 - Math.sqrt(800) / 40));
    expect(map.getHp(5, 3)).toBe(60);
    expect(map.getHp(6, 3)).toBe(60);
    expect(map.getHp(0, 0)).toBe(60);
    expect(map.changedTiles.size).toBe(1);
  });

  it('clips explosions to the map and handles a blast centered outside it', () => {
    const map = new TileMap(arena(2, 2, 5));
    expect(map.damageCircle(-10, 10, 30, 60)).toEqual([{ col: 0, row: 0, material: 5, x: 10, y: 10 }]);
    expect(map.get(1, 0)).toBe(5);
    expect(map.getHp(0, 1)).toBeLessThan(MATERIALS[5].hp);
    expect(map.tiles).toHaveLength(4);
    expect(map.dirtyChunks).toEqual(new Set(['0,0']));
  });

  it('never damages bedrock, including from extreme blasts', () => {
    const map = new TileMap(arena(2, 2, 6));
    expect(map.damage(0, 0, Number.MAX_VALUE)).toBeNull();
    expect(map.damage(0, 0, Infinity)).toBeNull();
    expect(map.damageCircle(10, 10, 100, Number.MAX_VALUE)).toEqual([]);
    expect(map.getHp(0, 0)).toBe(Infinity);
    expect(map.isSolid(0, 0)).toBe(true);
    expect(map.revision).toBe(0);
    expect(map.dirtyChunks.size).toBe(0);
    expect(map.changedTiles.size).toBe(0);
  });

  it('ignores invalid and no-op damage without corrupting tile HP or change tracking', () => {
    const map = new TileMap(arena(8, 8, 2));
    for (const amount of [0, -1, NaN, Infinity, -Infinity]) expect(map.damage(1, 1, amount)).toBeNull();
    for (const coordinate of [-1, 8, 0.5, NaN, Infinity, -Infinity]) {
      expect(map.damage(coordinate, 1, 100)).toBeNull();
      expect(map.damage(1, coordinate, 100)).toBeNull();
      map.set(coordinate, 1, 0);
      map.set(1, coordinate, 0);
      expect(map.get(coordinate, 1)).toBe(0);
      expect(map.getHp(1, coordinate)).toBe(0);
    }
    for (const value of [-1, 7, 0.5, NaN, Infinity]) map.set(1, 1, value);
    map.set(1, 1, 2);
    for (const radius of [0, -1, NaN, Infinity]) expect(map.damageCircle(30, 30, radius, 100)).toEqual([]);
    for (const power of [0, -1, NaN, Infinity]) expect(map.damageCircle(30, 30, 100, power)).toEqual([]);
    expect(map.damageCircle(NaN, 30, 100, 100)).toEqual([]);
    expect(map.damageCircle(30, Infinity, 100, 100)).toEqual([]);
    expect(map.damageCircle(-1000, -1000, 1, 100)).toEqual([]);
    expect(map.getHp(1, 1)).toBe(MATERIALS[2].hp);
    expect(map.tiles).toEqual(arena(8, 8, 2).tiles);
    expect(map.revision).toBe(0);
    expect(map.dirtyChunks.size).toBe(0);
    expect(map.changedTiles.size).toBe(0);
  });

  it('dirties only affected chunks and their edge neighbors, with deduplicated changes', () => {
    const map = new TileMap(arena(65, 65));
    map.set(10, 10, 2);
    expect(map.dirtyChunks).toEqual(new Set(['0,0']));
    map.dirtyChunks.clear();
    map.set(31, 31, 2);
    expect(map.dirtyChunks).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
    map.dirtyChunks.clear();
    map.damage(31, 31, 1);
    expect(map.dirtyChunks).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
    map.dirtyChunks.clear();
    map.set(32, 32, 2);
    expect(map.dirtyChunks).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
    map.dirtyChunks.clear();
    map.set(64, 64, 2);
    expect(map.dirtyChunks).toEqual(new Set(['1,1', '2,1', '1,2', '2,2']));
    map.dirtyChunks.clear();
    map.set(0, 0, 2);
    expect(map.dirtyChunks).toEqual(new Set(['0,0']));
    map.damage(31, 31, 100);
    expect(map.changedTiles.size).toBe(5);
    expect(map.changedTiles.get('31,31')).toEqual({ col: 31, row: 31 });
    expect(map.revision).toBe(7);
  });
});
