import { describe, expect, it } from 'vitest';
import { defaultSettings, settings } from '../src/input/settings';
import { CONTROL_SCHEMES_KEY, CONTROL_SCHEME_NAME_LIMIT, MAX_CONTROL_SCHEMES, ControlSchemesStore } from '../src/input/controlSchemes';

function memoryStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & { saved(): string | undefined } {
  let value = initial;
  return { getItem: key => { expect(key).toBe(CONTROL_SCHEMES_KEY); return value ?? null; },
    setItem: (key, next) => { expect(key).toBe(CONTROL_SCHEMES_KEY); value = next; }, saved: () => value };
}

function customSettings() {
  const value = defaultSettings();
  value.keyboard[0].jump = 'KeyV'; value.keyboard[1].jump = 'KeyB';
  value.mouse = { attack: 0, shoot: 2 };
  value.gamepad.buttons.slot1 = 11; value.gamepad.axes.aimX = 4; value.gamepad.deadzone = 0.35; value.gamepad.invertAimY = true;
  value.audio = { master: 0, sfx: 0.1, music: 0.2 }; value.effects = { screenShake: false, hitstop: false };
  return value;
}

const controlsOf = (current = defaultSettings()) => ({ keyboard: current.keyboard, mouse: current.mouse, gamepad: current.gamepad });

describe('named control scheme snapshots', () => {
  it('persists and restores both keyboards, mouse, gamepad and active selection without audio or effects', () => {
    const storage = memoryStorage(), store = new ControlSchemesStore(storage), current = customSettings();
    const scheme = store.save('  Couch crew  ', current);
    expect(scheme.name).toBe('Couch crew'); expect(store.activeId).toBe(scheme.id);
    expect(scheme.controls).toEqual(controlsOf(current));
    expect(Object.keys(scheme.controls).sort()).toEqual(['gamepad', 'keyboard', 'mouse']);
    const document = JSON.parse(storage.saved()!);
    expect(document.version).toBe(1);
    expect(document.schemes[0].controls.audio).toBeUndefined(); expect(document.schemes[0].controls.effects).toBeUndefined();
    const restored = new ControlSchemesStore(storage);
    expect(restored.list()).toEqual([scheme]); expect(restored.activeId).toBe(scheme.id); expect(restored.persistent).toBe(true);
  });

  it('keeps snapshots isolated from live settings and every returned value', () => {
    const store = new ControlSchemesStore(null), current = customSettings();
    const saved = store.save('Independent', current), expected = structuredClone(saved);
    current.keyboard[0].jump = 'KeyC'; current.gamepad.axes.aimX = 7; current.mouse.attack = 1;
    saved.name = 'Changed outside'; saved.controls.keyboard[1].jump = 'KeyZ';
    const listed = store.list(); listed[0].controls.gamepad.buttons.jump = 9; listed.pop();
    const fetched = store.get(saved.id)!; fetched.controls.mouse.shoot = 4;
    expect(store.get(saved.id)).toEqual(expected); expect(store.list()).toHaveLength(1);
  });

  it('updates existing snapshots explicitly, preserves IDs, and selects the updated scheme', () => {
    const storage = memoryStorage(), store = new ControlSchemesStore(storage);
    const first = store.save('First', defaultSettings()), second = store.save('Second', defaultSettings());
    const updated = store.save('First revised', customSettings(), first.id);
    expect(updated.id).toBe(first.id); expect(updated.controls.keyboard[0].jump).toBe('KeyV');
    expect(store.list()).toHaveLength(2); expect(store.activeId).toBe(first.id);
    expect(store.get(second.id)).toEqual(second);
    expect(new ControlSchemesStore(storage).get(first.id)).toEqual(updated);
  });

  it('renames, selects, deselects and deletes without changing the global active controls', () => {
    const before = structuredClone(settings.get()), storage = memoryStorage(), store = new ControlSchemesStore(storage);
    const first = store.save('One', defaultSettings()), second = store.save('Two', customSettings());
    const renamed = store.rename(first.id, '  ONE renamed  ');
    expect(renamed.name).toBe('ONE renamed'); expect(store.activeId).toBe(second.id);
    renamed.controls.keyboard[0].jump = 'KeyZ'; expect(store.get(first.id)!.controls.keyboard[0].jump).toBe('Space');
    store.select(first.id); expect(store.activeId).toBe(first.id);
    store.remove(second.id); expect(store.activeId).toBe(first.id);
    store.select(null); expect(new ControlSchemesStore(storage).activeId).toBeNull();
    store.select(first.id); store.remove(first.id);
    expect(store.activeId).toBeNull(); expect(store.get(first.id)).toBeUndefined();
    expect(new ControlSchemesStore(storage).list()).toEqual([]); expect(settings.get()).toEqual(before);
  });

  it('rejects blank, long and duplicate names without changing the library', () => {
    const storage = memoryStorage(), store = new ControlSchemesStore(storage);
    const original = store.save('Couch', defaultSettings()), another = store.save('Other', defaultSettings());
    const unchanged = storage.saved();
    expect(() => store.save('   ', defaultSettings())).toThrow(/name/i);
    expect(() => store.save('x'.repeat(CONTROL_SCHEME_NAME_LIMIT + 1), defaultSettings())).toThrow(/48/);
    expect(() => store.save(' couch ', defaultSettings())).toThrow(/already exists/);
    expect(() => store.rename(another.id, 'COUCH')).toThrow(/already exists/);
    expect(() => store.save('COUCH', customSettings(), another.id)).toThrow(/already exists/);
    expect(storage.saved()).toBe(unchanged); expect(store.activeId).toBe(another.id);
    expect(store.rename(original.id, 'cOuCh').name).toBe('cOuCh');
    expect(store.save('x'.repeat(CONTROL_SCHEME_NAME_LIMIT), defaultSettings()).name).toHaveLength(CONTROL_SCHEME_NAME_LIMIT);
  });

  it('enforces the 16-scheme limit while permitting updates, renames and freed slots', () => {
    const store = new ControlSchemesStore(null);
    const created = Array.from({ length: MAX_CONTROL_SCHEMES }, (_, index) => store.save(`Scheme ${index}`, defaultSettings()));
    expect(() => store.save('One too many', defaultSettings())).toThrow(/16/);
    expect(store.save('Updated', customSettings(), created[0].id).id).toBe(created[0].id);
    expect(store.rename(created[1].id, 'Renamed').name).toBe('Renamed');
    store.remove(created[2].id); const replacement = store.save('Replacement', defaultSettings());
    expect(created.map(scheme => scheme.id)).not.toContain(replacement.id); expect(store.list()).toHaveLength(MAX_CONTROL_SCHEMES);
  });

  it('rejects missing or malformed IDs for mutations while allowing absent lookups', () => {
    const storage = memoryStorage(), store = new ControlSchemesStore(storage);
    const original = store.save('Existing', defaultSettings()), previous = storage.saved();
    for (const id of ['', '../invalid', 'missing']) {
      expect(store.get(id)).toBeUndefined();
      expect(() => store.save('Updated', defaultSettings(), id)).toThrow(/scheme/);
      expect(() => store.rename(id, 'Renamed')).toThrow(/scheme/);
      expect(() => store.remove(id)).toThrow(/scheme/);
      expect(() => store.select(id)).toThrow(/scheme/);
    }
    expect(store.list()).toEqual([original]); expect(store.activeId).toBe(original.id); expect(storage.saved()).toBe(previous);
  });

  it('recovers corrupt documents and unsupported versions as an empty library', () => {
    for (const raw of ['{broken', 'null', '42', '[]', '{"version":2,"schemes":[]}', '{"version":1,"schemes":"bad"}']) {
      const storage = memoryStorage(raw), store = new ControlSchemesStore(storage);
      expect(store.list()).toEqual([]); expect(store.activeId).toBeNull();
      const saved = store.save('Recovered', defaultSettings());
      expect(new ControlSchemesStore(storage).list()).toEqual([saved]);
    }
  });

  it('sanitizes stored controls, skips invalid or duplicate records, and discards a missing active ID', () => {
    const raw = { version: 1, activeId: 'missing', schemes: [null,
      { id: '../bad', name: 'Bad ID', controls: controlsOf() },
      { id: 'blank', name: ' ', controls: controlsOf() },
      { id: 'missing-controls', name: 'No controls' },
      { id: 'good', name: '  Saved  ', controls: { keyboard: [{ jump: 'Escape', attack: 'KeyV' }], mouse: { attack: 99 }, gamepad: { axes: { aimX: 100 }, deadzone: 5 }, audio: { master: 0 } } },
      { id: 'good', name: 'Duplicate ID', controls: controlsOf() },
      { id: 'other', name: 'sAVED', controls: controlsOf() },
      { id: 'last', name: 'Also saved', controls: controlsOf(customSettings()) },
    ] };
    const store = new ControlSchemesStore(memoryStorage(JSON.stringify(raw)));
    expect(store.list().map(scheme => scheme.id)).toEqual(['good', 'last']); expect(store.activeId).toBeNull();
    const good = store.get('good')!;
    expect(good.name).toBe('Saved'); expect(good.controls.keyboard[0].jump).toBe('Space'); expect(good.controls.keyboard[0].attack).toBe('KeyV');
    expect(good.controls.mouse.attack).toBe(2); expect(good.controls.gamepad.axes.aimX).toBe(2); expect(good.controls.gamepad.deadzone).toBe(0.8);
    expect(Object.keys(good.controls).sort()).toEqual(['gamepad', 'keyboard', 'mouse']);
  });

  it('bounds restored libraries and clears selection if its entry was discarded by the limit', () => {
    const raw = { version: 1, activeId: 'scheme-20', schemes: Array.from({ length: 21 }, (_, index) => ({ id: `scheme-${index}`, name: `Scheme ${index}`, controls: controlsOf() })) };
    const store = new ControlSchemesStore(memoryStorage(JSON.stringify(raw)));
    expect(store.list()).toHaveLength(MAX_CONTROL_SCHEMES); expect(store.activeId).toBeNull();
  });

  it('keeps all operations usable for the session when storage is absent or denied', () => {
    const denied = { getItem: () => { throw new Error('Access denied'); }, setItem: () => { throw new Error('Quota denied'); } };
    for (const storage of [null, denied, { getItem: () => null, setItem: denied.setItem }]) {
      const store = new ControlSchemesStore(storage);
      const first = store.save('Session', customSettings()); expect(store.persistent).toBe(false);
      expect(store.get(first.id)!.controls.keyboard[0].jump).toBe('KeyV');
      store.rename(first.id, 'Session renamed'); store.select(null); store.select(first.id); store.remove(first.id);
      expect(store.list()).toEqual([]); expect(store.activeId).toBeNull(); expect(store.persistent).toBe(false);
    }
  });
});
