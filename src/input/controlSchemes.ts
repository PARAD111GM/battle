import { normalizeSettings, type GameSettings } from './settings';

export const CONTROL_SCHEMES_KEY = 'rivetfall.controlSchemes.v1';
export const MAX_CONTROL_SCHEMES = 16;
export const CONTROL_SCHEME_NAME_LIMIT = 48;

export interface ControlScheme {
  id: string;
  name: string;
  controls: Pick<GameSettings, 'keyboard' | 'mouse' | 'gamepad' | 'gestures'>;
}

type SchemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface StoredSchemes { version: 1; activeId: string | null; schemes: ControlScheme[] }
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const clone = (scheme: ControlScheme): ControlScheme => structuredClone(scheme);

function schemeName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a name for this control scheme.');
  const name = value.trim();
  if (name.length > CONTROL_SCHEME_NAME_LIMIT) throw new Error(`Control scheme names can have at most ${CONTROL_SCHEME_NAME_LIMIT} characters.`);
  return name;
}

/** Reuse the live-settings schema, but never retain presentation preferences or caller objects. */
function snapshot(value: unknown): ControlScheme['controls'] {
  const source = object(value) ?? {};
  const { keyboard, mouse, gamepad, gestures } = normalizeSettings({ version: 1,
    keyboard: source.keyboard, mouse: source.mouse, gamepad: source.gamepad, gestures: source.gestures });
  return { keyboard, mouse, gamepad, gestures };
}

/** Named, independent snapshots. Selecting a scheme never changes the active gameplay settings. */
export class ControlSchemesStore {
  private schemes: ControlScheme[] = [];
  private selected: string | null = null;
  private sequence = 0;
  persistent = false;

  constructor(private readonly storage: SchemeStorage | null) {
    if (!storage) return;
    let raw: string | null;
    try { raw = storage.getItem(CONTROL_SCHEMES_KEY); this.persistent = true; }
    catch { return; }
    if (!raw) return;
    try {
      const saved = object(JSON.parse(raw));
      if (saved?.version !== 1 || !Array.isArray(saved.schemes)) return;
      const ids = new Set<string>(), names = new Set<string>();
      for (const entry of saved.schemes) {
        const source = object(entry);
        if (!source || !validId(source.id) || ids.has(source.id) || !object(source.controls)) continue;
        let name: string;
        try { name = schemeName(source.name); } catch { continue; }
        if (names.has(name.toLowerCase())) continue;
        this.schemes.push({ id: source.id, name, controls: snapshot(source.controls) });
        ids.add(source.id); names.add(name.toLowerCase());
        if (this.schemes.length === MAX_CONTROL_SCHEMES) break;
      }
      this.selected = validId(saved.activeId) && ids.has(saved.activeId) ? saved.activeId : null;
    } catch { /* A corrupt saved document starts an empty library; subsequent saves repair it. */ }
  }

  get activeId(): string | null { return this.selected; }
  list(): ControlScheme[] { return this.schemes.map(clone); }
  get(id: string): ControlScheme | undefined {
    const scheme = this.schemes.find(item => item.id === id);
    return scheme ? clone(scheme) : undefined;
  }

  save(name: string, current: GameSettings, id?: string): ControlScheme {
    const normalized = schemeName(name);
    const existing = id === undefined ? undefined : this.requireScheme(id);
    this.requireUniqueName(normalized, existing?.id);
    if (!existing && this.schemes.length >= MAX_CONTROL_SCHEMES) {
      throw new Error(`You can save up to ${MAX_CONTROL_SCHEMES} control schemes. Delete one or update an existing scheme.`);
    }
    const scheme: ControlScheme = { id: existing?.id ?? this.createId(), name: normalized, controls: snapshot(current) };
    if (existing) this.schemes[this.schemes.indexOf(existing)] = scheme;
    else this.schemes.push(scheme);
    this.selected = scheme.id;
    this.persist();
    return clone(scheme);
  }

  rename(id: string, name: string): ControlScheme {
    const scheme = this.requireScheme(id), normalized = schemeName(name);
    this.requireUniqueName(normalized, id);
    scheme.name = normalized;
    this.persist();
    return clone(scheme);
  }

  remove(id: string): void {
    const scheme = this.requireScheme(id);
    this.schemes.splice(this.schemes.indexOf(scheme), 1);
    if (this.selected === id) this.selected = null;
    this.persist();
  }

  select(id: string | null): void {
    if (id !== null) this.requireScheme(id);
    this.selected = id;
    this.persist();
  }

  private requireScheme(id: string): ControlScheme {
    if (!validId(id)) throw new Error('Choose a valid saved control scheme.');
    const scheme = this.schemes.find(item => item.id === id);
    if (!scheme) throw new Error('This control scheme no longer exists. Choose another saved scheme.');
    return scheme;
  }

  private requireUniqueName(name: string, exceptId?: string): void {
    if (this.schemes.some(scheme => scheme.id !== exceptId && scheme.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A control scheme named “${name}” already exists. Choose a different name.`);
    }
  }

  private createId(): string {
    let id: string;
    do { id = `scheme-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`; }
    while (this.schemes.some(scheme => scheme.id === id));
    return id;
  }

  private persist(): void {
    if (!this.storage) { this.persistent = false; return; }
    const document: StoredSchemes = { version: 1, activeId: this.selected, schemes: this.schemes };
    try { this.storage.setItem(CONTROL_SCHEMES_KEY, JSON.stringify(document)); this.persistent = true; }
    catch { this.persistent = false; }
  }
}

function browserStorage(): SchemeStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}
export const controlSchemes = new ControlSchemesStore(browserStorage());
