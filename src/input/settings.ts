export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'shoot', 'throw', 'special', 'roll', 'block', 'interact', 'switch', 'slot1', 'slot2', 'slot3'] as const;
export type BindingAction = typeof ACTIONS[number];
export type KeyboardBindings = Record<BindingAction, string>;
export const ACTION_LABELS: Record<BindingAction, string> = { left: 'Move left', right: 'Move right', up: 'Climb / aim up', down: 'Drop / aim down', jump: 'Jump', attack: 'Melee attack', shoot: 'Fire weapon', throw: 'Throw grenade', special: 'Character special', roll: 'Dodge roll', block: 'Block', interact: 'Pick up / interact', switch: 'Cycle weapon', slot1: 'Primary weapon', slot2: 'Sidearm', slot3: 'Melee weapon' };
export const DEFAULT_BINDINGS: KeyboardBindings = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', jump: 'Space', attack: 'KeyJ', shoot: 'KeyK', throw: 'KeyG', special: 'KeyQ', roll: 'ShiftLeft', block: 'KeyL', interact: 'KeyE', switch: 'KeyR', slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3' };
export const SECONDARY_BINDINGS: KeyboardBindings = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', jump: 'Enter', attack: 'Comma', shoot: 'Period', throw: 'Slash', special: 'Semicolon', roll: 'ShiftRight', block: 'Quote', interact: 'Backslash', switch: 'BracketRight', slot1: 'Digit7', slot2: 'Digit8', slot3: 'Digit9' };
export type AxisAction = 'moveX' | 'moveY' | 'aimX' | 'aimY';
export interface GameSettings {
  version: 1;
  keyboard: [KeyboardBindings, KeyboardBindings];
  mouse: { attack: number; shoot: number };
  gamepad: { buttons: Record<BindingAction, number>; axes: Record<AxisAction, number>; deadzone: number; invertAimY: boolean };
  audio: { master: number; sfx: number; music: number };
  effects: { screenShake: boolean; hitstop: boolean };
}
export interface SettingsPatch {
  keyboard?: [Partial<KeyboardBindings>?, Partial<KeyboardBindings>?];
  mouse?: Partial<GameSettings['mouse']>;
  gamepad?: { buttons?: Partial<GameSettings['gamepad']['buttons']>; axes?: Partial<GameSettings['gamepad']['axes']>; deadzone?: number; invertAimY?: boolean };
  audio?: Partial<GameSettings['audio']>;
  effects?: Partial<GameSettings['effects']>;
}
export const SETTINGS_KEY = 'rivetfall.settings.v1';
export function defaultSettings(): GameSettings {
  return { version: 1, keyboard: [{ ...DEFAULT_BINDINGS }, { ...SECONDARY_BINDINGS }], mouse: { attack: 2, shoot: 0 },
    gamepad: { buttons: { left: 14, right: 15, up: 12, down: 13, jump: 0, attack: 2, shoot: 7, throw: 5, special: 3, roll: 1, block: 6, interact: 4, switch: 10, slot1: -1, slot2: -1, slot3: -1 }, axes: { moveX: 0, moveY: 1, aimX: 2, aimY: 3 }, deadzone: 0.2, invertAimY: false },
    audio: { master: 0.8, sfx: 0.85, music: 0.35 }, effects: { screenShake: true, hitstop: true } };
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bounded = (value: unknown, low: number, high: number, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
const integer = (value: unknown, high: number, fallback: number): number => typeof value === 'number' && Number.isInteger(value) && value >= -1 && value <= high ? value : fallback;
export function isBindingCode(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Left|Right|Up|Down)|Space|Enter|NumpadEnter|Shift(Left|Right)|Bracket(Left|Right)|Comma|Period|Slash|Semicolon|Quote|Backslash|Minus|Equal|Backquote|Backspace|Delete|Home|End|PageUp|PageDown|Insert|CapsLock|Numpad(Add|Subtract|Multiply|Divide|Decimal))$/.test(value));
}
export function normalizeSettings(value: unknown): GameSettings {
  const result = defaultSettings(), source = record(value);
  if (source.version !== 1) return result;
  if (Array.isArray(source.keyboard)) {
    const used = new Set<string>();
    for (const player of [0, 1] as const) for (const action of ACTIONS) {
      const code = record(source.keyboard[player])[action];
      const candidate = isBindingCode(code) ? code : result.keyboard[player][action];
      result.keyboard[player][action] = candidate && used.has(candidate) ? '' : candidate;
      if (candidate) used.add(candidate);
    }
  }
  const mouse = record(source.mouse), gamepad = record(source.gamepad), buttons = record(gamepad.buttons), axes = record(gamepad.axes);
  for (const action of ['attack', 'shoot'] as const) result.mouse[action] = integer(mouse[action], 4, result.mouse[action]);
  if (result.mouse.attack >= 0 && result.mouse.attack === result.mouse.shoot) result.mouse.shoot = -1;
  const usedButtons = new Set<number>();
  for (const action of ACTIONS) {
    const button = integer(buttons[action], 31, result.gamepad.buttons[action]);
    result.gamepad.buttons[action] = button >= 0 && usedButtons.has(button) ? -1 : button;
    if (button >= 0) usedButtons.add(button);
  }
  for (const axis of ['moveX', 'moveY', 'aimX', 'aimY'] as const) result.gamepad.axes[axis] = integer(axes[axis], 7, result.gamepad.axes[axis]);
  result.gamepad.deadzone = bounded(gamepad.deadzone, 0.05, 0.8, result.gamepad.deadzone);
  if (typeof gamepad.invertAimY === 'boolean') result.gamepad.invertAimY = gamepad.invertAimY;
  const audio = record(source.audio), effects = record(source.effects);
  for (const key of ['master', 'sfx', 'music'] as const) result.audio[key] = bounded(audio[key], 0, 1, result.audio[key]);
  for (const key of ['screenShake', 'hitstop'] as const) if (typeof effects[key] === 'boolean') result.effects[key] = effects[key];
  return result;
}
export function keyLabel(code: string): string {
  const labels: Record<string, string> = { '': 'Unbound', Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '−', Equal: '=', Backquote: '`' };
  return labels[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}
export interface SettingsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class SettingsStore {
  private value = defaultSettings();
  private listeners = new Set<(settings: GameSettings) => void>();
  persistent = false;
  constructor(private storage?: SettingsStorage) {
    if (!storage) return;
    try { const raw = storage.getItem(SETTINGS_KEY); this.value = raw ? normalizeSettings(JSON.parse(raw)) : defaultSettings(); this.persistent = true; }
    catch { this.value = defaultSettings(); }
  }
  get(): GameSettings { return this.value; }
  subscribe(listener: (settings: GameSettings) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  update(patch: SettingsPatch): void {
    const current = this.value;
    this.commit({ ...current, keyboard: [{ ...current.keyboard[0], ...patch.keyboard?.[0] }, { ...current.keyboard[1], ...patch.keyboard?.[1] }],
      mouse: { ...current.mouse, ...patch.mouse }, audio: { ...current.audio, ...patch.audio }, effects: { ...current.effects, ...patch.effects },
      gamepad: { ...current.gamepad, ...patch.gamepad, buttons: { ...current.gamepad.buttons, ...patch.gamepad?.buttons }, axes: { ...current.gamepad.axes, ...patch.gamepad?.axes } } });
  }
  bindKeyboard(player: 0 | 1, action: BindingAction, code: string): string {
    if (!isBindingCode(code)) return 'That key is reserved for browser or menu controls.';
    const next = structuredClone(this.value), previous = next.keyboard[player][action];
    let notice = '';
    for (const other of [0, 1] as const) for (const otherAction of ACTIONS) {
      if (code && next.keyboard[other][otherAction] === code && !(other === player && otherAction === action)) {
        next.keyboard[other][otherAction] = previous;
        notice = `Swapped with Player ${other + 1} ${ACTION_LABELS[otherAction].toLowerCase()}.`;
      }
    }
    next.keyboard[player][action] = code; this.commit(next); return notice;
  }
  bindGamepad(action: BindingAction, button: number): string {
    const next = structuredClone(this.value), previous = next.gamepad.buttons[action];
    let notice = '';
    for (const other of ACTIONS) if (button >= 0 && other !== action && next.gamepad.buttons[other] === button) {
      next.gamepad.buttons[other] = previous; notice = `Swapped with ${ACTION_LABELS[other].toLowerCase()}.`;
    }
    next.gamepad.buttons[action] = button; this.commit(next); return notice;
  }
  bindMouse(action: 'attack' | 'shoot', button: number): string {
    const next = structuredClone(this.value), other = action === 'attack' ? 'shoot' : 'attack';
    const duplicate = button >= 0 && next.mouse[other] === button;
    if (duplicate) next.mouse[other] = next.mouse[action];
    next.mouse[action] = button; this.commit(next); return duplicate ? `Swapped with ${ACTION_LABELS[other].toLowerCase()}.` : '';
  }
  reset(): void { this.commit(defaultSettings()); }
  private commit(value: GameSettings): void {
    this.value = normalizeSettings(value);
    try { if (this.storage) { this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.value)); this.persistent = true; } }
    catch { this.persistent = false; }
    for (const listener of this.listeners) listener(this.value);
  }
}
function browserStorage(): SettingsStorage | undefined { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } }
export const settings = new SettingsStore(browserStorage());
