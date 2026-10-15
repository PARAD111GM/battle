import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/data/arenas';
import { parseArenaJSON, validateArena } from '../src/data/arenaValidation';
import { World } from '../src/sim/World';
import { neutralInput } from '../src/sim/types';

const fixture = () => JSON.parse(JSON.stringify(ARENAS[0]));
describe('arena import validation', () => {
  it('accepts authored maps and returns a detached, playable copy', () => {
    for (const source of ARENAS) {
      const result = validateArena(source);
      expect(result.errors).toEqual([]);
      expect(result.arena).toEqual(source);
      expect(result.arena!.tiles).not.toBe(source.tiles);
      expect(result.arena!.props[0]).not.toBe(source.props[0]);
      const world = new World(result.arena!, 42); world.addFighter(); world.addFighter();
      for (let i = 0; i < 30; i++) world.step({ 0: neutralInput(), 1: neutralInput() });
      expect(world.fighters.every(f => Number.isFinite(f.x) && Number.isFinite(f.y))).toBe(true);
    }
  });
  it('rejects oversized dimensions before allocating simulation data', () => {
    for (const width of [0, 19, 161, Infinity, 40.5, '80']) expect(validateArena({ ...fixture(), width }).arena).toBeUndefined();
    expect(() => parseArenaJSON(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('2 MiB');
  });
  it('rejects invalid JSON, tile lengths and unknown materials', () => {
    expect(() => parseArenaJSON('{ broken')).toThrow('valid JSON');
    const short = fixture(); short.tiles.pop(); expect(validateArena(short).errors.join()).toContain('Tile data length');
    const unknown = fixture(); unknown.tiles[0] = 500; expect(validateArena(unknown).arena).toBeUndefined();
    const nan = fixture(); nan.tiles[0] = NaN; expect(validateArena(nan).arena).toBeUndefined();
  });
  it('rejects blocked, overlapping, missing and non-finite fighter starts', () => {
    const blocked = fixture(); const spawn = blocked.spawns[0]; blocked.tiles[Math.floor(spawn.y / blocked.tileSize) * blocked.width + Math.floor(spawn.x / blocked.tileSize)] = 1;
    expect(validateArena(blocked).errors.join()).toContain('overlaps terrain');
    const duplicate = fixture(); duplicate.spawns[1] = { ...duplicate.spawns[0] }; expect(validateArena(duplicate).errors.join()).toContain('another spawn');
    expect(validateArena({ ...fixture(), spawns: [] }).arena).toBeUndefined();
    const invalid = fixture(); invalid.spawns[0].x = Infinity; expect(validateArena(invalid).arena).toBeUndefined();
  });
  it('rejects duplicate prop IDs, unsafe motion, bad anchors and unsupported objects', () => {
    const duplicate = fixture(); duplicate.props.push({ ...duplicate.props[0] }); expect(validateArena(duplicate).errors.join()).toContain('duplicate ID');
    const invalid = fixture(); invalid.props[0].travelX = Infinity; expect(validateArena(invalid).arena).toBeUndefined();
    const unsupported = fixture(); unsupported.props[0].type = 'script'; expect(validateArena(unsupported).arena).toBeUndefined();
    const anchor = fixture(); anchor.props[0].anchorCol = -1; anchor.props[0].anchorRow = 0; expect(validateArena(anchor).errors.join()).toContain('anchor');
    const period = fixture(); period.props[0].periodTicks = 0.001; expect(validateArena(period).errors.join()).toContain('30 ticks');
  });
  it('checks pickup tables and discards unknown mutable data', () => {
    for (const weapon of ['not-a-weapon', '__proto__', 'constructor']) { const invalid = fixture(); invalid.spawnTable = [{ weapon, weight: 1 }]; expect(validateArena(invalid).arena).toBeUndefined(); }
    const data = fixture(); data.untrusted = { nested: [] }; data.props[0].untrusted = { nested: [] };
    const result = validateArena(data).arena!;
    expect('untrusted' in result).toBe(false); expect('untrusted' in result.props[0]).toBe(false);
    data.spawns[0].x = 0; expect(result.spawns[0].x).not.toBe(0);
  });
});
