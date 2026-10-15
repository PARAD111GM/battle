import { validateArena } from '../../data/arenaValidation';
import { CHARACTERS } from '../../data/characters';
import { THROWABLES } from '../../data/combat';
import type { MatchSettings } from '../match/types';
import { WEAPONS } from '../weapons/definitions';
import { REPLAY_LIMITS, REPLAY_VERSION, ReplayError, type RecordedInput, type ReplayCombat, type ReplayData, type ReplayFighter, type ReplayFrame } from './types';

type ObjectValue = Record<string, unknown>;
type Range = readonly [number, number, boolean?];

function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReplayError(`${path} must be an object`);
  return value as ObjectValue;
}
function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new ReplayError(`${path} must be a finite ${integer ? 'integer ' : ''}from ${min} to ${max}`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ReplayError(`${path} must be a boolean`);
  return value;
}
function string(value: unknown, path: string, max = 80): string {
  if (typeof value !== 'string' || value.length > max) throw new ReplayError(`${path} must be text of at most ${max} characters`);
  return value;
}
function choice<T extends string>(value: unknown, path: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new ReplayError(`${path} has an unsupported value`);
  return value as T;
}
function array(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new ReplayError(`${path} must contain ${min}–${max} entries`);
  return value;
}
function numericFields(source: ObjectValue, target: ObjectValue, path: string, fields: Record<string, Range>): void {
  for (const [key, [min, max, integer]] of Object.entries(fields)) target[key] = number(source[key], `${path}.${key}`, min, max, integer);
}
function booleanFields(source: ObjectValue, target: ObjectValue, path: string, fields: string[]): void {
  for (const key of fields) target[key] = boolean(source[key], `${path}.${key}`);
}
function nullableId(value: unknown, path: string): number | null { return value === null ? null : number(value, path, 0, 1_000_000, true); }

function settings(value: unknown): MatchSettings {
  const raw = object(value, 'settings');
  const customWeapons = array(raw.customWeapons, 'settings.customWeapons', 64).map((id, index) => choice(id, `settings.customWeapons[${index}]`, [...Object.keys(WEAPONS), ...Object.keys(THROWABLES)]));
  return {
    mode: choice(raw.mode, 'settings.mode', ['deathmatch', 'team', 'stocks']),
    damageMode: choice(raw.damageMode, 'settings.damageMode', ['health', 'percent']),
    timeLimit: number(raw.timeLimit, 'settings.timeLimit', 0, 86400),
    stocks: number(raw.stocks, 'settings.stocks', 1, 999, true),
    scoreLimit: number(raw.scoreLimit, 'settings.scoreLimit', 0, 100_000, true),
    friendlyFire: boolean(raw.friendlyFire, 'settings.friendlyFire'),
    weaponSet: choice(raw.weaponSet, 'settings.weaponSet', ['all', 'melee', 'guns', 'custom']),
    customWeapons: [...new Set(customWeapons)],
  };
}

function weaponMap(value: unknown, path: string, keys: string[], durability = false): Record<string, number | null> {
  const raw = object(value, path), result: Record<string, number | null> = {};
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new ReplayError(`${path} has unknown or missing item IDs`);
  for (const id of keys) {
    if (durability && raw[id] === null && WEAPONS[id].durability === undefined) result[id] = null;
    else result[id] = number(raw[id], `${path}.${id}`, 0, 1_000_000, !durability);
  }
  return result;
}

function combat(value: unknown, path: string): ReplayCombat {
  const raw = object(value, path), result: ObjectValue = {};
  for (const slot of ['primary', 'sidearm', 'melee'] as const) result[slot] = choice(raw[slot], `${path}.${slot}`, ['', ...Object.keys(WEAPONS).filter(id => WEAPONS[id].slot === slot)]);
  result.throwable = choice(raw.throwable, `${path}.throwable`, Object.keys(THROWABLES));
  result.equipped = choice(raw.equipped, `${path}.equipped`, ['primary', 'sidearm', 'melee']);
  if (!result[result.equipped as string]) throw new ReplayError(`${path}.equipped refers to an empty slot`);
  const itemIds = Object.keys(WEAPONS);
  result.ammo = weaponMap(raw.ammo, `${path}.ammo`, itemIds);
  result.reserve = weaponMap(raw.reserve, `${path}.reserve`, itemIds);
  result.durability = weaponMap(raw.durability, `${path}.durability`, itemIds, true);
  result.throwableAmmo = weaponMap(raw.throwableAmmo, `${path}.throwableAmmo`, Object.keys(THROWABLES));
  const tick: Range = [0, REPLAY_LIMITS.maxTicks, true];
  numericFields(raw, result, path, {
    cooldown: tick, reloadTicks: tick, meleeStage: [0, 3, true], comboWindow: tick, attackBufferTicks: tick, grabTicks: tick,
    specialTicks: tick, slowTicks: tick, flashTicks: tick, throwableCount: [0, 999, true], cookTicks: tick,
    specialMeter: [0, 100], stunTicks: tick, blockMeter: [0, 100], aimX: [-1, 1], aimY: [-1, 1],
    lastHitBy: [-1, 1023, true], lastHitTick: [-1, REPLAY_LIMITS.maxTicks, true],
    kills: [0, 1_000_000, true], deaths: [0, 1_000_000, true], damageDealt: [0, 1_000_000_000], shots: [0, 1_000_000, true], hits: [0, 1_000_000, true],
  });
  booleanFields(raw, result, path, ['attackHeld', 'shootHeld', 'throwHeld', 'interactHeld', 'switchHeld', 'specialHeld', 'wearApplied']);
  result.specialPhase = choice(raw.specialPhase, `${path}.specialPhase`, ['', 'rise', 'crash', 'dash', 'focus']);
  result.pendingAttack = choice(raw.pendingAttack, `${path}.pendingAttack`, ['', 'jab1', 'jab2', 'jab3', 'uppercut', 'divekick', 'grab-throw', ...itemIds]);
  result.hitTargets = array(raw.hitTargets, `${path}.hitTargets`, 8).map((id, index) => number(id, `${path}.hitTargets[${index}]`, 0, 1023, true));
  result.hitProps = array(raw.hitProps, `${path}.hitProps`, 512).map((id, index) => number(id, `${path}.hitProps[${index}]`, 0, 1_000_000, true));
  result.hitTiles = array(raw.hitTiles, `${path}.hitTiles`, 1024).map((id, index) => {
    const key = string(id, `${path}.hitTiles[${index}]`, 16);
    if (!/^-?\d{1,4},-?\d{1,4}$/.test(key)) throw new ReplayError(`${path}.hitTiles contains an invalid tile coordinate`);
    return key;
  });
  result.grabTarget = nullableId(raw.grabTarget, `${path}.grabTarget`);
  result.heldProp = nullableId(raw.heldProp, `${path}.heldProp`);
  return result as unknown as ReplayCombat;
}

function fighter(value: unknown, index: number, width: number, height: number): ReplayFighter {
  const path = `fighters[${index}]`, raw = object(value, path), result: ObjectValue = {};
  const tick: Range = [0, REPLAY_LIMITS.maxTicks, true];
  numericFields(raw, result, path, {
    id: [0, 1023, true], team: [0, 1023, true], color: [0, 0xffffff, true],
    x: [-1024, width + 1024], y: [-1024, height + 1024], vx: [-10000, 10000], vy: [-10000, 10000],
    width: [1, 256], height: [1, 256], speedScale: [0.1, 4], hp: [0, 100_000], maxHp: [1, 100_000], damage: [0, 1_000_000], stocks: [0, 999, true],
    coyoteTicks: tick, jumpBufferTicks: tick, actionTicks: tick, rollCooldown: tick, invulnerableTicks: tick, respawnTicks: tick, climbCooldownTicks: tick,
  });
  if (raw.facing !== -1 && raw.facing !== 1) throw new ReplayError(`${path}.facing must be -1 or 1`);
  result.facing = raw.facing;
  result.name = string(raw.name, `${path}.name`);
  result.character = choice(raw.character, `${path}.character`, CHARACTERS.map(character => character.id));
  result.special = choice(raw.special, `${path}.special`, ['slam', 'bullet-time', 'air-strike', 'shield-wall']);
  result.controller = choice(raw.controller, `${path}.controller`, ['human', 'bot']);
  result.difficulty = choice(raw.difficulty, `${path}.difficulty`, ['easy', 'normal', 'hard', 'expert']);
  result.action = choice(raw.action, `${path}.action`, ['idle', 'run', 'jump', 'fall', 'roll', 'climb', 'hang', 'melee-windup', 'melee-active', 'melee-recovery', 'shoot', 'reload', 'throw-windup', 'throw-recovery', 'block', 'stunned', 'special', 'dead']);
  booleanFields(raw, result, path, ['alive', 'grounded', 'jumpHeld', 'climbing', 'rollHeld']);
  if (raw.ledge === null) result.ledge = null;
  else {
    const ledge = object(raw.ledge, `${path}.ledge`);
    result.ledge = { x: number(ledge.x, `${path}.ledge.x`, -1024, width + 1024), y: number(ledge.y, `${path}.ledge.y`, -1024, height + 1024) };
  }
  result.combat = combat(raw.combat, `${path}.combat`);
  return result as unknown as ReplayFighter;
}

/** Returns a bounded, freshly allocated schema; no imported object is passed directly into World. */
export function validateReplay(value: unknown): ReplayData {
  const raw = object(value, 'Replay');
  if (raw.format !== 'rivetfall-replay') throw new ReplayError('This is not a Rivetfall replay');
  if (raw.version !== REPLAY_VERSION) throw new ReplayError('Unsupported replay version');
  const seed = number(raw.seed, 'seed', 0, 0xffffffff, true);
  const arenaResult = validateArena(raw.arena);
  if (!arenaResult.arena) throw new ReplayError(`Invalid replay arena: ${arenaResult.errors.slice(0, 3).join('; ')}`);
  const arena = arenaResult.arena;
  const fighters = array(raw.fighters, 'fighters', REPLAY_LIMITS.maxFighters, 1).map((entry, index) => fighter(entry, index, arena.width * arena.tileSize, arena.height * arena.tileSize));
  const fighterIds = new Set(fighters.map(entry => entry.id));
  if (fighterIds.size !== fighters.length) throw new ReplayError('Fighter IDs must be unique');
  const frames: ReplayFrame[] = [];
  let ticks = 0;
  for (const [frameIndex, value] of array(raw.frames, 'frames', REPLAY_LIMITS.maxTicks).entries()) {
    const path = `frames[${frameIndex}]`, frame = object(value, path);
    const repeat = number(frame.repeat, `${path}.repeat`, 1, REPLAY_LIMITS.maxTicks, true);
    ticks += repeat;
    if (ticks > REPLAY_LIMITS.maxTicks) throw new ReplayError('Replay exceeds the 30 minute duration limit');
    const seen = new Set<number>();
    const inputs: RecordedInput[] = array(frame.inputs, `${path}.inputs`, fighters.length).map((value, inputIndex) => {
      const label = `${path}.inputs[${inputIndex}]`, input = array(value, label, 7, 7);
      const id = number(input[0], `${label}.fighterId`, 0, 1023, true);
      if (!fighterIds.has(id) || seen.has(id)) throw new ReplayError(`${label} has an unknown or duplicate fighter ID`);
      seen.add(id);
      return [id, ...input.slice(1, 5).map((axis, index) => number(axis, `${label}.axis${index}`, -1, 1)), number(input[5], `${label}.buttons`, 0, 255, true), number(input[6], `${label}.switchWeapon`, 0, 4, true)] as RecordedInput;
    });
    frames.push({ repeat, inputs });
  }
  const durationTicks = number(raw.durationTicks, 'durationTicks', 0, REPLAY_LIMITS.maxTicks, true);
  if (durationTicks !== ticks) throw new ReplayError('Replay duration does not match its input frames');
  return { format: 'rivetfall-replay', version: REPLAY_VERSION, seed, arena, settings: settings(raw.settings), fighters, frames, durationTicks, truncated: boolean(raw.truncated, 'truncated') };
}

export function checkReplaySize(json: string): void {
  if (json.length > REPLAY_LIMITS.maxBytes || new TextEncoder().encode(json).length > REPLAY_LIMITS.maxBytes) throw new ReplayError('Replay exceeds the 16 MiB file limit');
}

export function decodeReplay(json: string): ReplayData {
  if (typeof json !== 'string') throw new ReplayError('Replay input must be JSON text');
  checkReplaySize(json);
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new ReplayError('Replay is not valid JSON'); }
  return validateReplay(value);
}

export function encodeReplay(data: ReplayData): string {
  const json = JSON.stringify(validateReplay(data));
  checkReplaySize(json);
  return json;
}
