import warehouse from './arenas/warehouse.json';
import type { ArenaData } from '../sim/types';
export const ARENAS: ArenaData[] = [warehouse];
export const getArena = (id = 'warehouse'): ArenaData => ARENAS.find(a => a.id === id) ?? ARENAS[0];
