import type { GameSettings } from './settings';

export interface DirectionButtons { left: boolean; right: boolean; up: boolean; down: boolean }
export interface GestureCommand { sprint: boolean; dropThrough: boolean; roll: boolean }
const released = (): DirectionButtons => ({ left: false, right: false, up: false, down: false });

/** Thresholds are separate so stick noise cannot manufacture repeated taps. */
export function axisDirections(x: number, y: number, previous: Readonly<DirectionButtons>): DirectionButtons {
  const held = (amount: number, before: boolean) => amount >= (before ? 0.25 : 0.5);
  return { left: held(-x, previous.left), right: held(x, previous.right),
    up: held(-y, previous.up), down: held(y, previous.down) };
}

/** Real device edges enter here even while simulation ticks are paused by hitstop. */
export class MovementGestures {
  private held = released();
  private horizontalTap: { direction: number; time: number } | null = null;
  private downTap: number | null = null;
  private sprintDirection = 0;
  private comboRoll = false;
  private pendingRoll = false;
  private pendingDrop = false;
  private suppressRoll = false;

  get directions(): Readonly<DirectionButtons> { return this.held; }

  update(next: DirectionButtons, time: number, options: GameSettings['gestures']): void {
    const direction = Number(next.right) - Number(next.left);
    const previousDirection = Number(this.held.right) - Number(this.held.left);
    const horizontalPressed = direction < 0 ? next.left && !this.held.left : direction > 0 && next.right && !this.held.right;
    const combo = next.down && !next.up && direction !== 0;
    if (!next.down || next.up) this.suppressRoll = false;
    if (!options.sprintDoubleTap || direction !== this.sprintDirection) this.sprintDirection = 0;
    if (!options.sprintDoubleTap || (next.left && next.right)) this.horizontalTap = null;
    else if (horizontalPressed) {
      const previous = this.horizontalTap;
      if (previous?.direction === direction && time >= previous.time && time - previous.time <= options.doubleTapWindowMs) {
        this.sprintDirection = direction;
      }
      this.horizontalTap = { direction, time };
    } else if (direction && previousDirection && direction !== previousDirection) {
      this.horizontalTap = null;
    }

    if (!options.dropThroughDoubleTap) this.downTap = null;
    else if (next.down && !this.held.down && !next.up) {
      if (this.downTap !== null && time >= this.downTap && time - this.downTap <= options.doubleTapWindowMs) this.requestDrop();
      this.downTap = time;
    }
    if (!options.rollWithDown) this.pendingRoll = false;
    if (options.rollWithDown && combo && !this.comboRoll && !this.suppressRoll) this.pendingRoll = true;
    this.comboRoll = options.rollWithDown && combo;
    this.held = { ...next };
  }

  /** Dedicated drop controls use the same precedence as a down double tap. */
  requestDrop(): void {
    this.pendingDrop = true;
    this.pendingRoll = false;
    this.suppressRoll = true;
  }

  consume(): GestureCommand {
    const result = { sprint: this.sprintDirection !== 0, dropThrough: this.pendingDrop,
      roll: !this.pendingDrop && !this.suppressRoll && (this.comboRoll || this.pendingRoll) };
    this.pendingDrop = false;
    this.pendingRoll = false;
    return result;
  }

  reset(baseline: Readonly<DirectionButtons> = released()): void {
    this.held = { ...baseline }; this.horizontalTap = null; this.downTap = null; this.sprintDirection = 0;
    this.comboRoll = false; this.pendingRoll = false; this.pendingDrop = false; this.suppressRoll = false;
  }
}
