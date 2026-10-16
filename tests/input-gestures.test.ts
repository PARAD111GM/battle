import { describe, expect, it } from 'vitest';
import { MovementGestures, axisDirections, type DirectionButtons } from '../src/input/MovementGestures';
import { defaultSettings } from '../src/input/settings';

const directions = (held: Partial<DirectionButtons> = {}): DirectionButtons => ({ left: false, right: false, up: false, down: false, ...held });
const defaults = defaultSettings().gestures;
const update = (gestures: MovementGestures, time: number, held: Partial<DirectionButtons>, options = defaults) => gestures.update(directions(held), time, options);

describe('directional gestures sampled independently of simulation ticks', () => {
  it.each(['left', 'right'] as const)('sprints after a second %s edge and clears on release', direction => {
    const gestures = new MovementGestures();
    update(gestures, 0, { [direction]: true });
    expect(gestures.consume().sprint).toBe(false);
    update(gestures, 80, {});
    update(gestures, 250, { [direction]: true });
    expect(gestures.consume().sprint).toBe(true);
    update(gestures, 5000, { [direction]: true });
    expect(gestures.consume().sprint).toBe(true);
    update(gestures, 5001, {});
    expect(gestures.consume().sprint).toBe(false);
  });

  it('does not mistake repeats, late presses or reversed directions for a double tap', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { right: true });
    update(gestures, 50, { right: true });
    expect(gestures.consume().sprint).toBe(false);
    update(gestures, 60, {}); update(gestures, 251, { right: true });
    expect(gestures.consume().sprint).toBe(false);
    update(gestures, 260, { left: true });
    expect(gestures.consume().sprint).toBe(false);
    update(gestures, 270, { right: true });
    expect(gestures.consume().sprint).toBe(false);
  });

  it('clears active sprint on reversal and does not rearm when an opposite key is released', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { right: true }); update(gestures, 10, {}); update(gestures, 20, { right: true });
    expect(gestures.consume().sprint).toBe(true);
    update(gestures, 30, { right: true, left: true });
    expect(gestures.consume().sprint).toBe(false);
    update(gestures, 40, { right: true });
    expect(gestures.consume().sprint).toBe(false);
    update(gestures, 50, {}); update(gestures, 60, { right: true });
    expect(gestures.consume().sprint).toBe(false);
    update(gestures, 70, { left: true });
    expect(gestures.consume().sprint).toBe(false);
  });

  it('buffers a quick down double tap through hitstop exactly once, but never buffers released sprint', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { down: true }); update(gestures, 10, {}); update(gestures, 30, { down: true }); update(gestures, 40, {});
    update(gestures, 1000, {});
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: true, roll: false });
    expect(gestures.consume().dropThrough).toBe(false);
    update(gestures, 1100, { right: true }); update(gestures, 1110, {}); update(gestures, 1120, { right: true }); update(gestures, 1130, {});
    expect(gestures.consume().sprint).toBe(false);
  });

  it('emits no extra drop pulses while down is held, including repeated device samples', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { down: true }); update(gestures, 1, {}); update(gestures, 2, { down: true });
    expect(gestures.consume().dropThrough).toBe(true);
    for (const time of [3, 100, 200, 500]) {
      update(gestures, time, { down: true }); expect(gestures.consume().dropThrough).toBe(false);
    }
  });

  it('holds roll for either order of down plus horizontal, and retains a released combo until consumed', () => {
    for (const first of [{ down: true }, { left: true }]) {
      const gestures = new MovementGestures();
      update(gestures, 0, first); expect(gestures.consume().roll).toBe(false);
      update(gestures, 10, { left: true, down: true });
      expect(gestures.consume().roll).toBe(true); expect(gestures.consume().roll).toBe(true);
      update(gestures, 20, {}); expect(gestures.consume().roll).toBe(false);
    }
    const gestures = new MovementGestures();
    update(gestures, 0, { right: true, down: true }); update(gestures, 10, {});
    expect(gestures.consume().roll).toBe(true); expect(gestures.consume().roll).toBe(false);
  });

  it('gives a down double tap priority over buffered roll and suppresses roll until down releases', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { right: true, down: true });
    update(gestures, 10, { right: true }); update(gestures, 20, { right: true, down: true });
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: true, roll: false });
    update(gestures, 40, { right: true, down: true });
    expect(gestures.consume().roll).toBe(false); expect(gestures.consume().dropThrough).toBe(false);
    update(gestures, 50, { down: true }); update(gestures, 60, { left: true, down: true });
    expect(gestures.consume().roll).toBe(false);
    update(gestures, 70, { left: true }); update(gestures, 500, { left: true, down: true });
    expect(gestures.consume().roll).toBe(true);
  });

  it('applies the same roll suppression to a dedicated drop request', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { left: true, down: true }); gestures.requestDrop();
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: true, roll: false });
    update(gestures, 10, { left: true, down: true }); expect(gestures.consume().roll).toBe(false);
    update(gestures, 20, {}); update(gestures, 500, { left: true, down: true });
    expect(gestures.consume().roll).toBe(true);
  });

  it('resets held states, queued actions and tap history between matches or settings changes', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { down: true, left: true }); update(gestures, 10, {});
    update(gestures, 20, { down: true, left: true }); gestures.reset();
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: false, roll: false });
    update(gestures, 30, { down: true });
    expect(gestures.consume().dropThrough).toBe(false);
    update(gestures, 40, { left: true }); expect(gestures.consume().sprint).toBe(false);
  });

  it('preserves a held gamepad baseline on reset without manufacturing a new sprint or drop tap', () => {
    const gestures = new MovementGestures();
    update(gestures, 0, { down: true, right: true }); update(gestures, 10, {});
    update(gestures, 20, { down: true, right: true });
    gestures.reset(gestures.directions);
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: false, roll: false });
    update(gestures, 30, { down: true, right: true });
    expect(gestures.consume()).toMatchObject({ sprint: false, dropThrough: false });
    update(gestures, 40, {}); update(gestures, 50, { down: true, right: true });
    expect(gestures.consume()).toMatchObject({ sprint: false, dropThrough: false });
    update(gestures, 60, {}); update(gestures, 70, { down: true, right: true });
    expect(gestures.consume()).toEqual({ sprint: true, dropThrough: true, roll: false });
  });

  it('uses the configured time window and keeps disabled gestures inactive', () => {
    const gestures = new MovementGestures(), options = { ...defaults, doubleTapWindowMs: 100 };
    update(gestures, 0, { down: true, left: true }, options); update(gestures, 10, {}, options);
    update(gestures, 101, { down: true, left: true }, options);
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: false, roll: true });
    gestures.reset();
    const disabled = { ...defaults, sprintDoubleTap: false, dropThroughDoubleTap: false, rollWithDown: false };
    update(gestures, 0, { down: true, right: true }, disabled); update(gestures, 1, {}, disabled); update(gestures, 2, { down: true, right: true }, disabled);
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: false, roll: false });
    gestures.requestDrop(); expect(gestures.consume().dropThrough).toBe(true);
  });

  it('keeps each player and controller tap history independent', () => {
    const first = new MovementGestures(), second = new MovementGestures();
    update(first, 0, { right: true, down: true }); update(first, 10, {});
    update(second, 20, { right: true, down: true });
    expect(second.consume()).toEqual({ sprint: false, dropThrough: false, roll: true });
    update(first, 20, { right: true, down: true });
    expect(first.consume()).toEqual({ sprint: true, dropThrough: true, roll: false });
  });

  it('requires analog stick release beyond hysteresis and supports diagonal/drop and digital pad values', () => {
    const gestures = new MovementGestures();
    const sample = (time: number, x: number, y = 0) => gestures.update(axisDirections(x, y, gestures.directions), time, defaults);
    sample(0, 0.49); sample(10, 0.6); sample(20, 0.4); sample(30, 0.6);
    expect(gestures.consume().sprint).toBe(false);
    sample(40, 0.24); sample(50, 0.6);
    expect(gestures.consume().sprint).toBe(true);
    sample(60, -1); expect(gestures.consume().sprint).toBe(false);
    sample(70, -1, 1); sample(80, -1, 0); sample(90, -1, 1);
    expect(gestures.consume()).toEqual({ sprint: false, dropThrough: true, roll: false });
  });
});
