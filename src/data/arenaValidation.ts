import { TUNING } from './tuning';
import { MATERIALS } from './materials';
import { THROWABLES } from './combat';
import { WEAPONS } from '../sim/weapons/definitions';
import type { ArenaData, ArenaProp, Vec2 } from '../sim/types';

export const ARENA_LIMITS = { maxBytes: 2 * 1024 * 1024, minWidth: 20, maxWidth: 160, minHeight: 12, maxHeight: 100, maxProps: 256, maxSpawns: 16, maxWeaponSpawns: 128 } as const;
export const EDITOR_PROP_TYPES = ['crate', 'barrel', 'ladder', 'rope', 'door', 'support', 'hanging-light', 'moving-platform', 'elevator'] as const;
const propTypes = new Set<string>([...EDITOR_PROP_TYPES, 'light', 'movingPlatform', 'platform']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, min: number, max: number): value is number => finite(value) && Number.isInteger(value) && value >= min && value <= max;

/** Validates imported geometry before any array allocation, navigation, or physics work. */
export function validateArena(value: unknown): { arena?: ArenaData; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { errors: ['Arena must be a JSON object.'] };
  if (!integer(value.width, ARENA_LIMITS.minWidth, ARENA_LIMITS.maxWidth)) errors.push('Width must be an integer between 20 and 160 tiles.');
  if (!integer(value.height, ARENA_LIMITS.minHeight, ARENA_LIMITS.maxHeight)) errors.push('Height must be an integer between 12 and 100 tiles.');
  if (!integer(value.tileSize, 8, 64)) errors.push('Tile size must be an integer between 8 and 64 pixels.');
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id)) errors.push('Arena ID must use 1–64 lowercase letters, digits, dashes, or underscores.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) errors.push('Name must contain 1–80 characters.');
  for (const key of ['subtitle', 'background']) if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 160)) errors.push(`${key} must be text of at most 160 characters.`);
  if (errors.length) return { errors };
  const width = value.width as number, height = value.height as number, tileSize = value.tileSize as number;
  if (!Array.isArray(value.tiles) || value.tiles.length !== width * height) errors.push('Tile data length must equal width × height.');
  else if (value.tiles.some(tile => !integer(tile, 0, 255) || (tile !== 0 && !MATERIALS[tile]))) errors.push('Tiles may only contain empty (0) or a known material ID (1–6).');
  const worldWidth = width * tileSize, worldHeight = height * tileSize;
  const point = (item: unknown): item is Vec2 => record(item) && finite(item.x) && finite(item.y) && item.x >= 0 && item.y >= 0 && item.x <= worldWidth && item.y <= worldHeight;
  if (!Array.isArray(value.spawns) || value.spawns.length < 2 || value.spawns.length > ARENA_LIMITS.maxSpawns || !value.spawns.every(point)) errors.push('Add 2–16 fighter spawns with finite coordinates inside the arena.');
  if (!Array.isArray(value.weaponSpawns) || value.weaponSpawns.length > ARENA_LIMITS.maxWeaponSpawns || !value.weaponSpawns.every(point)) errors.push('Weapon spawns must contain at most 128 finite points inside the arena.');
  if (!Array.isArray(value.props) || value.props.length > ARENA_LIMITS.maxProps) errors.push('Props must be an array of at most 256 objects.');
  if (errors.length) return { errors };
  const tiles = [...value.tiles as number[]], spawns = (value.spawns as Vec2[]).map(p => ({ x: p.x, y: p.y }));
  for (const [index, spawn] of spawns.entries()) {
    const halfWidth = TUNING.fighter.width / 2, halfHeight = TUNING.fighter.height / 2;
    const left = spawn.x - halfWidth, right = spawn.x + halfWidth, top = spawn.y - halfHeight, bottom = spawn.y + halfHeight;
    if (left < 0 || right > worldWidth || top < 0 || bottom > worldHeight) { errors.push(`Fighter spawn ${index + 1} needs space for a ${TUNING.fighter.width} × ${TUNING.fighter.height} body inside the arena.`); continue; }
    let blocked = false;
    for (let row = Math.floor((top + 0.001) / tileSize); row <= Math.floor((bottom - 0.001) / tileSize); row++) {
      for (let col = Math.floor((left + 0.001) / tileSize); col <= Math.floor((right - 0.001) / tileSize); col++) if (tiles[row * width + col]) blocked = true;
    }
    if (blocked) errors.push(`Fighter spawn ${index + 1} overlaps terrain; erase around the marker or move it.`);
    if (spawns.slice(0, index).some(other => Math.abs(other.x - spawn.x) < TUNING.fighter.width && Math.abs(other.y - spawn.y) < TUNING.fighter.height)) errors.push(`Fighter spawn ${index + 1} overlaps another spawn.`);
  }
  const props: ArenaProp[] = [], ids = new Set<number>();
  for (const [index, raw] of (value.props as unknown[]).entries()) {
    if (!record(raw) || !integer(raw.id, 0, 1_000_000) || ids.has(raw.id) || typeof raw.type !== 'string' || !propTypes.has(raw.type)
      || !point(raw) || !finite(raw.width) || !finite(raw.height) || raw.width <= 0 || raw.height <= 0
      || raw.x + raw.width > worldWidth || raw.y + raw.height > worldHeight) { errors.push(`Prop ${index + 1} has an invalid/duplicate ID, unsupported type, or invalid bounds.`); continue; }
    ids.add(raw.id);
    const prop: ArenaProp = { id: raw.id, type: raw.type, x: raw.x, y: raw.y, width: raw.width, height: raw.height };
    for (const key of ['travelX', 'travelY', 'hp', 'periodTicks']) {
      const n = raw[key];
      if (n === undefined) continue;
      if (!finite(n) || Math.abs(n) > 100_000 || ((key === 'hp' || key === 'periodTicks') && n <= 0) || (key === 'periodTicks' && n < 30)) errors.push(`Prop ${index + 1}: ${key} must be a safe finite number${key === 'periodTicks' ? ' of at least 30 ticks' : ''}.`);
      else prop[key] = n;
    }
    if (finite(raw.travelX) && (raw.x + raw.travelX < 0 || raw.x + raw.width + raw.travelX > worldWidth)) errors.push(`Prop ${index + 1} moves outside the arena horizontally.`);
    if (finite(raw.travelY) && (raw.y + raw.travelY < 0 || raw.y + raw.height + raw.travelY > worldHeight)) errors.push(`Prop ${index + 1} moves outside the arena vertically.`);
    if (raw.anchorCol !== undefined || raw.anchorRow !== undefined) {
      if (!integer(raw.anchorCol, 0, width - 1) || !integer(raw.anchorRow, 0, height - 1) || !tiles[(raw.anchorRow as number) * width + (raw.anchorCol as number)]) errors.push(`Prop ${index + 1} needs an anchor on a solid tile.`);
      else { prop.anchorCol = raw.anchorCol; prop.anchorRow = raw.anchorRow; }
    }
    if (raw.open !== undefined && typeof raw.open !== 'boolean') errors.push(`Prop ${index + 1}: open must be true or false.`);
    if (typeof raw.open === 'boolean') prop.open = raw.open;
    props.push(prop);
  }
  let spawnTable: ArenaData['spawnTable'];
  if (value.spawnTable !== undefined) {
    if (!Array.isArray(value.spawnTable) || value.spawnTable.length > 64) errors.push('Spawn table must contain at most 64 entries.');
    else {
      spawnTable = [];
      for (const entry of value.spawnTable) {
        if (!record(entry) || typeof entry.weapon !== 'string' || !(Object.hasOwn(WEAPONS, entry.weapon) || Object.hasOwn(THROWABLES, entry.weapon) || ['health', 'ammo'].includes(entry.weapon)) || !finite(entry.weight) || entry.weight <= 0 || entry.weight > 10_000) errors.push('Spawn table entries need a known item and a positive finite weight.');
        else spawnTable.push({ weapon: entry.weapon, weight: entry.weight });
      }
    }
  }
  if (errors.length) return { errors };
  return { arena: { id: value.id as string, name: (value.name as string).trim(), subtitle: (value.subtitle as string | undefined) ?? '', background: (value.background as string | undefined) ?? '', width, height, tileSize, tiles, spawns, props,
    weaponSpawns: (value.weaponSpawns as Vec2[]).map(p => ({ x: p.x, y: p.y })), ...(spawnTable ? { spawnTable } : {}), }, errors: [] };
}

export function parseArenaJSON(json: string): ArenaData {
  if (json.length > ARENA_LIMITS.maxBytes) throw new Error('Arena JSON exceeds the 2 MiB limit.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('This file is not valid JSON.'); }
  const result = validateArena(value);
  if (!result.arena) throw new Error(result.errors.slice(0, 5).join('\n'));
  return result.arena;
}
