import { describe, expect, it } from 'vitest';
import { defaultSettings, isBindingCode, normalizeSettings, SettingsStore, SETTINGS_KEY, type SettingsStorage } from '../src/input/settings';

function memoryStorage(initial?: string): SettingsStorage & { saved(): string | undefined } {
  let value = initial;
  return { getItem: () => value ?? null, setItem: (key, next) => { expect(key).toBe(SETTINGS_KEY); value = next; }, saved: () => value };
}

describe('validated local control and presentation settings', () => {
  it('recovers defaults from corrupt storage, missing browser storage and unknown schema versions', () => {
    expect(new SettingsStore(memoryStorage('{broken')).get()).toEqual(defaultSettings());
    expect(new SettingsStore().get()).toEqual(defaultSettings());
    expect(normalizeSettings({ version: 2, keyboard: [{ attack: 'KeyV' }] })).toEqual(defaultSettings());
    const denied = new SettingsStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(() => denied.update({ audio: { master: 0.4 } })).not.toThrow();
    expect(denied.get().audio.master).toBe(0.4);
    expect(denied.persistent).toBe(false);
  });

  it('validates bindings and device indices, clamps levels and keeps unrelated defaults', () => {
    const data = normalizeSettings({ version: 1, keyboard: [{ attack: '<script>', jump: 'KeyV', roll: 'Escape' }],
      audio: { master: -1, music: 3, sfx: 'loud' }, effects: { screenShake: 'false', hitstop: false },
      gamepad: { axes: { aimX: 100 }, buttons: { shoot: 99 }, deadzone: 5 }, mouse: { attack: -5 } });
    expect(data.keyboard[0].attack).toBe('KeyJ');
    expect(data.keyboard[0].jump).toBe('KeyV');
    expect(data.keyboard[0].roll).toBe('');
    expect(data.audio).toEqual({ master: 0, sfx: 0.85, music: 1 });
    expect(data.effects).toEqual({ screenShake: true, hitstop: false });
    expect(data.gamepad.axes.aimX).toBe(2);
    expect(data.gamepad.buttons.shoot).toBe(7);
    expect(data.gamepad.deadzone).toBe(0.8);
    expect(data.mouse.attack).toBe(2);
    expect(['Escape', 'Tab', 'F1', 'ControlLeft', 'MetaLeft', 'AltRight'].some(isBindingCode)).toBe(false);
  });

  it('swaps occupied keys across both local players without making either action unreachable', () => {
    const store = new SettingsStore(memoryStorage());
    const note = store.bindKeyboard(0, 'left', 'ArrowLeft');
    expect(store.get().keyboard[0].left).toBe('ArrowLeft');
    expect(store.get().keyboard[1].left).toBe('KeyA');
    expect(note).toContain('Player 2');
    store.bindKeyboard(1, 'slot3', 'Digit1');
    expect(store.get().keyboard[0].slot1).toBe('Digit9');
    expect(store.get().keyboard[1].slot3).toBe('Digit1');
    const before = structuredClone(store.get());
    expect(store.bindKeyboard(0, 'jump', 'Escape')).toContain('reserved');
    expect(store.get()).toEqual(before);
  });

  it('swaps mouse and gamepad actions and allows unbound weapon-slot buttons', () => {
    const store = new SettingsStore(memoryStorage());
    expect(store.bindMouse('attack', 0)).toContain('Swapped');
    expect(store.get().mouse).toEqual({ attack: 0, shoot: 2 });
    expect(store.bindGamepad('attack', 7)).toContain('Swapped');
    expect(store.get().gamepad.buttons.attack).toBe(7);
    expect(store.get().gamepad.buttons.shoot).toBe(2);
    store.bindGamepad('slot1', 11);
    expect(store.get().gamepad.buttons.slot1).toBe(11);
    expect(store.get().gamepad.buttons.slot2).toBe(-1);
    store.bindKeyboard(1, 'jump', '');
    expect(store.get().keyboard[1].jump).toBe('');
  });

  it('saves and reloads both keyboard profiles, device controls, audio and effects', () => {
    const storage = memoryStorage(), store = new SettingsStore(storage);
    let notices = 0;
    const unsubscribe = store.subscribe(() => notices++);
    store.bindKeyboard(0, 'jump', 'KeyV'); store.bindKeyboard(1, 'jump', 'KeyB');
    store.update({ audio: { music: 0 }, effects: { hitstop: false }, gestures: { sprintDoubleTap: false, doubleTapWindowMs: 320 }, gamepad: { axes: { aimX: 4 }, deadzone: 0.35, invertAimY: true } });
    expect(notices).toBe(3);
    unsubscribe(); store.bindMouse('shoot', 1);
    expect(notices).toBe(3);
    expect(storage.saved()).toBeTruthy();
    expect(new SettingsStore(storage).get()).toEqual(store.get());
    store.reset();
    expect(store.get()).toEqual(defaultSettings());
    expect(new SettingsStore(storage).get()).toEqual(defaultSettings());
  });

  it('recovers duplicate stored controls deterministically and never aliases default objects', () => {
    const source = defaultSettings(); source.keyboard[0].right = 'KeyA'; source.gamepad.buttons.shoot = 2;
    const recovered = normalizeSettings(source);
    expect(recovered.keyboard[0].left).toBe('KeyA'); expect(recovered.keyboard[0].right).toBe('');
    expect(recovered.gamepad.buttons.attack).toBe(2); expect(recovered.gamepad.buttons.shoot).toBe(-1);
    const independent = defaultSettings(); independent.keyboard[0].attack = 'KeyV';
    expect(defaultSettings().keyboard[0].attack).toBe('KeyJ');
  });

  it('defaults to directional gestures and preserves explicit legacy roll controls during migration', () => {
    const fresh = defaultSettings();
    expect(fresh.gestures).toEqual({ sprintDoubleTap: true, dropThroughDoubleTap: true, rollWithDown: true, doubleTapWindowMs: 250 });
    for (const action of ['roll', 'sprint', 'dropThrough'] as const) {
      expect(fresh.keyboard[0][action]).toBe(''); expect(fresh.keyboard[1][action]).toBe(''); expect(fresh.gamepad.buttons[action]).toBe(-1);
    }
    const migrated = normalizeSettings({ version: 1, keyboard: [{ roll: 'ShiftLeft' }, { roll: 'ShiftRight' }], gamepad: { buttons: { roll: 1 } } });
    expect(migrated.keyboard[0].roll).toBe('ShiftLeft'); expect(migrated.keyboard[1].roll).toBe('ShiftRight'); expect(migrated.gamepad.buttons.roll).toBe(1);
    expect(migrated.gestures).toEqual(fresh.gestures);
  });

  it('validates gesture options, merges independent changes and persists optional sprint/drop bindings', () => {
    expect(normalizeSettings({ version: 1, gestures: { sprintDoubleTap: 'false', dropThroughDoubleTap: false, rollWithDown: false, doubleTapWindowMs: -2 } }).gestures)
      .toEqual({ sprintDoubleTap: true, dropThroughDoubleTap: false, rollWithDown: false, doubleTapWindowMs: 100 });
    expect(normalizeSettings({ version: 1, gestures: { doubleTapWindowMs: Infinity } }).gestures.doubleTapWindowMs).toBe(250);
    const storage = memoryStorage(), store = new SettingsStore(storage);
    store.update({ gestures: { sprintDoubleTap: false, doubleTapWindowMs: 900 } });
    store.update({ gestures: { rollWithDown: false } });
    expect(store.get().gestures).toEqual({ sprintDoubleTap: false, dropThroughDoubleTap: true, rollWithDown: false, doubleTapWindowMs: 500 });
    store.bindKeyboard(0, 'sprint', 'ShiftLeft'); store.bindKeyboard(1, 'dropThrough', 'ShiftRight');
    store.bindGamepad('sprint', 8); store.bindGamepad('dropThrough', 9);
    expect(new SettingsStore(storage).get()).toEqual(store.get());
    store.reset(); expect(store.get()).toEqual(defaultSettings());
  });
});
