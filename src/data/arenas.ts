import warehouse from './arenas/warehouse.json';
import rooftops from './arenas/rooftops.json';
import mine from './arenas/mine.json';
import construction from './arenas/construction.json';
import type { ArenaData } from '../sim/types';
import { validateArena } from './arenaValidation';
export const ARENAS: ArenaData[] = [warehouse, rooftops, mine, construction];
export const getArena = (id = 'warehouse'): ArenaData => ARENAS.find(a => a.id === id) ?? ARENAS[0];
/** Editor maps use their own namespace so authored arenas cannot be overwritten. */
export function registerArena(value: ArenaData): ArenaData {
  const result = validateArena(value);
  if (!result.arena) throw new Error(result.errors.join('\n'));
  const arena = result.arena;
  arena.id = arena.id.startsWith('custom-') ? arena.id : `custom-${arena.id}`.slice(0, 64);
  const existing = ARENAS.findIndex(item => item.id === arena.id);
  if (existing >= 0) ARENAS[existing] = arena;
  else { if (ARENAS.length >= 20) ARENAS.splice(4, 1); ARENAS.push(arena); }
  return arena;
}
