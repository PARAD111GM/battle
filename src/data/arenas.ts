import warehouse from './arenas/warehouse.json';
import rooftops from './arenas/rooftops.json';
import mine from './arenas/mine.json';
import construction from './arenas/construction.json';
import type { ArenaData } from '../sim/types';
export const ARENAS: ArenaData[] = [warehouse, rooftops, mine, construction];
export const getArena = (id = 'warehouse'): ArenaData => ARENAS.find(a => a.id === id) ?? ARENAS[0];
