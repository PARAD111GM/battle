import { neutralInput, type InputCommand } from '../sim/types';

export type BindingAction = 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack' | 'shoot' | 'throw' | 'special' | 'roll' | 'block' | 'interact' | 'switch';
export const DEFAULT_BINDINGS: Record<BindingAction, string> = {
  left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', jump: 'Space',
  attack: 'KeyJ', shoot: 'KeyK', throw: 'KeyG', special: 'KeyQ', roll: 'ShiftLeft',
  block: 'KeyL', interact: 'KeyE', switch: 'KeyR',
};
export const SECONDARY_BINDINGS: Record<BindingAction, string> = {
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', jump: 'Enter',
  attack: 'Comma', shoot: 'Period', throw: 'Slash', special: 'Semicolon', roll: 'ShiftRight',
  block: 'Quote', interact: 'Backslash', switch: 'BracketRight',
};

/** Display labels shared by the help screen and local-player setup. */
export const CONTROLS = {
  keyboardPrimary: {
    move: 'WASD', aim: 'Mouse / WASD', jump: 'Space', attack: 'J / Right mouse',
    shoot: 'K / Left mouse', throw: 'G', special: 'Q', roll: 'Left Shift',
    block: 'L', interact: 'E', switch: 'R', slots: '1 / 2 / 3',
  },
  keyboardSecondary: {
    move: 'Arrow keys', aim: 'Arrow keys', jump: 'Enter', attack: ',', shoot: '.',
    throw: '/', special: ';', roll: 'Right Shift', block: "'", interact: '\\', switch: ']',
  },
  gamepad: {
    move: 'Left stick / D-pad', aim: 'Right stick', jump: 'A / Cross', attack: 'X / Square',
    shoot: 'RT / R2', throw: 'RB / R1', special: 'Y / Triangle', roll: 'B / Circle',
    block: 'LT / L2', interact: 'LB / L1', switch: 'Left stick click',
  },
} as const;

function isInterfaceTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input,select,textarea,button,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
  ));
}

function availableGamepads(): (Gamepad | null)[] {
  // Some embedded browsers expose the API but deny it through their permissions policy.
  try { return Array.from(navigator.getGamepads?.() ?? []); }
  catch { return []; }
}

export class InputManager {
  readonly pressed = new Set<string>();
  mouse = { x: 0, y: 0, active: false, left: false, right: false };
  bindings = { ...DEFAULT_BINDINGS };
  private keyboardFacing = new Map<number, number>();
  private gamepadAim = new Map<number, { x: number; y: number }>();

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', event => {
      if (isInterfaceTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const gameplayKeys = [...Object.values(this.bindings), ...Object.values(SECONDARY_BINDINGS), 'Digit1', 'Digit2', 'Digit3'];
      if (!gameplayKeys.includes(event.code)) return;
      this.pressed.add(event.code);
      event.preventDefault();
    });
    window.addEventListener('keyup', event => this.pressed.delete(event.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    // Opening a text field or focusing a menu button must release previously held controls.
    window.addEventListener('focusin', event => { if (isInterfaceTarget(event.target)) this.reset(); });
    target.addEventListener('pointermove', event => {
      if (isInterfaceTarget(event.target)) return;
      const bounds = target.getBoundingClientRect();
      this.mouse.x = event.clientX - bounds.left;
      this.mouse.y = event.clientY - bounds.top;
      this.mouse.active = true;
    });
    target.addEventListener('pointerdown', event => {
      if (isInterfaceTarget(event.target)) return;
      if (event.button === 0) this.mouse.left = true;
      if (event.button === 2) this.mouse.right = true;
    });
    window.addEventListener('pointerup', event => {
      if (event.button === 0) this.mouse.left = false;
      if (event.button === 2) this.mouse.right = false;
    });
    window.addEventListener('pointercancel', () => this.reset());
    target.addEventListener('contextmenu', event => {
      if (!isInterfaceTarget(event.target)) event.preventDefault();
    });
  }

  /** Release held controls without changing a player's remembered facing or aim. */
  reset(): void {
    this.pressed.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    this.mouse.active = false;
  }

  connectedGamepads(): number[] {
    return availableGamepads().filter((pad): pad is Gamepad => Boolean(pad?.connected)).map(pad => pad.index);
  }

  keyboard(player = 0, aimOrigin?: { x: number; y: number }): InputCommand {
    const bindings = player === 0 ? this.bindings : SECONDARY_BINDINGS;
    const has = (action: BindingAction) => this.pressed.has(bindings[action]);
    const x = Number(has('right')) - Number(has('left'));
    const y = Number(has('down')) - Number(has('up'));
    if (x) this.keyboardFacing.set(player, x);
    let ax = x || (y ? 0 : this.keyboardFacing.get(player) ?? 1);
    let ay = y;
    if (player === 0 && this.mouse.active && aimOrigin) {
      const dx = this.mouse.x - aimOrigin.x, dy = this.mouse.y - aimOrigin.y;
      if (dx || dy) { ax = dx; ay = dy; }
    }
    const length = Math.hypot(ax, ay) || 1;
    const slot = player === 0 ? ['Digit1', 'Digit2', 'Digit3'].findIndex(key => this.pressed.has(key)) : -1;
    return {
      moveX: x, moveY: y, aimX: ax / length, aimY: ay / length,
      jump: has('jump'), attack: has('attack') || (player === 0 && this.mouse.right),
      shoot: has('shoot') || (player === 0 && this.mouse.left), throw: has('throw'),
      special: has('special'), roll: has('roll'), block: has('block'), interact: has('interact'),
      switchWeapon: slot >= 0 ? slot + 2 : has('switch') ? 1 : 0,
    };
  }

  gamepad(index: number): InputCommand {
    const pad = availableGamepads()[index];
    if (!pad?.connected) return neutralInput();
    const dead = (value: number) => Math.abs(value) > 0.2 ? value : 0;
    const down = (button: number) => pad.buttons[button]?.pressed ?? false;
    const x = down(14) || down(15) ? Number(down(15)) - Number(down(14)) : dead(pad.axes[0] ?? 0);
    const y = down(12) || down(13) ? Number(down(13)) - Number(down(12)) : dead(pad.axes[1] ?? 0);
    const ax = dead(pad.axes[2] ?? 0), ay = dead(pad.axes[3] ?? 0);
    if (ax || ay) {
      const length = Math.hypot(ax, ay);
      this.gamepadAim.set(index, { x: ax / length, y: ay / length });
    }
    const aim = this.gamepadAim.get(index) ?? { x: 1, y: 0 };
    return {
      moveX: x, moveY: y, aimX: aim.x, aimY: aim.y, jump: down(0), attack: down(2),
      shoot: down(7), throw: down(5), special: down(3), roll: down(1), block: down(6),
      interact: down(4), switchWeapon: down(10) ? 1 : 0,
    };
  }
}
