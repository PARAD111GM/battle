import { neutralInput, type InputCommand } from '../sim/types';

import { settings, type BindingAction, type KeyboardBindings } from './settings';
export { DEFAULT_BINDINGS, SECONDARY_BINDINGS } from './settings';
export type { BindingAction } from './settings';

/** Display labels shared by the help screen and local-player setup. */
export const CONTROLS = {
  keyboardPrimary: {
    move: 'WASD', aim: 'Mouse / WASD', jump: 'Space', attack: 'J / Right mouse',
    shoot: 'K / Left mouse', throw: 'G', special: 'Q', roll: 'Left Shift',
    block: 'L', interact: 'E', switch: 'R', slots: '1 / 2 / 3',
  },
  keyboardSecondary: {
    move: 'Arrow keys', aim: 'Arrow keys', jump: 'Enter', attack: ',', shoot: '.',
    throw: '/', special: ';', roll: 'Right Shift', block: "'", interact: '\\', switch: ']', slots: '7 / 8 / 9',
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
  private pendingKeys = new Set<string>();
  private mouseButtons = new Set<number>();
  private pendingMouse = new Set<number>();
  private padButtons = new Map<number, Set<number>>();
  private pendingPadButtons = new Map<number, Set<number>>();
  private keyboardFacing = new Map<number, number>();
  private gamepadAim = new Map<number, { x: number; y: number }>();
  get bindings(): KeyboardBindings { return settings.get().keyboard[0]; }
  set bindings(value: KeyboardBindings) { settings.update({ keyboard: [value] }); }

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', event => {
      if (isInterfaceTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const gameplayKeys = settings.get().keyboard.flatMap(bindings => Object.values(bindings));
      if (!gameplayKeys.includes(event.code)) return;
      if (!event.repeat && !this.pressed.has(event.code)) this.pendingKeys.add(event.code);
      this.pressed.add(event.code);
      event.preventDefault();
    });
    window.addEventListener('keyup', event => this.pressed.delete(event.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
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
      this.mouseButtons.add(event.button); this.pendingMouse.add(event.button);
      if (event.button === 0) this.mouse.left = true;
      if (event.button === 2) this.mouse.right = true;
      if (event.button > 0) event.preventDefault();
    });
    window.addEventListener('pointerup', event => {
      this.mouseButtons.delete(event.button);
      if (event.button === 0) this.mouse.left = false;
      if (event.button === 2) this.mouse.right = false;
    });
    window.addEventListener('pointercancel', () => this.reset());
    target.addEventListener('contextmenu', event => {
      if (!isInterfaceTarget(event.target)) event.preventDefault();
    });
    target.addEventListener('auxclick', event => { if (!isInterfaceTarget(event.target)) event.preventDefault(); });
    // Poll during hitstop too, retaining short gamepad actions until the next simulation tick.
    const sample = () => { this.sampleGamepads(); requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
    settings.subscribe(() => this.reset());
  }

  /** Release held and buffered controls without changing remembered facing or aim. */
  reset(): void {
    this.pressed.clear(); this.pendingKeys.clear(); this.mouseButtons.clear(); this.pendingMouse.clear();
    this.pendingPadButtons.clear();
    this.mouse.left = false; this.mouse.right = false; this.mouse.active = false;
  }

  connectedGamepads(): number[] {
    return availableGamepads().filter((pad): pad is Gamepad => Boolean(pad?.connected)).map(pad => pad.index);
  }

  keyboard(player = 0, aimOrigin?: { x: number; y: number }): InputCommand {
    const config = settings.get(), bindings = config.keyboard[player === 0 ? 0 : 1];
    const has = (action: BindingAction) => this.pressed.has(bindings[action]) ||
      (!['left', 'right', 'up', 'down'].includes(action) && this.pendingKeys.has(bindings[action]));
    const x = Number(has('right')) - Number(has('left'));
    const y = Number(has('down')) - Number(has('up'));
    if (x) this.keyboardFacing.set(player, x);
    let ax = x || (y ? 0 : this.keyboardFacing.get(player) ?? 1), ay = y;
    if (player === 0 && this.mouse.active && aimOrigin) {
      const dx = this.mouse.x - aimOrigin.x, dy = this.mouse.y - aimOrigin.y;
      if (dx || dy) { ax = dx; ay = dy; }
    }
    const length = Math.hypot(ax, ay) || 1;
    const mouse = (action: 'attack' | 'shoot') => player === 0 && config.mouse[action] >= 0 &&
      (this.mouseButtons.has(config.mouse[action]) || this.pendingMouse.has(config.mouse[action]));
    const slot = (['slot1', 'slot2', 'slot3'] as const).findIndex(has);
    const command: InputCommand = {
      moveX: x, moveY: y, aimX: ax / length, aimY: ay / length,
      jump: has('jump'), attack: has('attack') || mouse('attack'), shoot: has('shoot') || mouse('shoot'),
      throw: has('throw'), special: has('special'), roll: has('roll'), block: has('block'), interact: has('interact'),
      switchWeapon: slot >= 0 ? slot + 2 : has('switch') ? 1 : 0,
    };
    for (const code of Object.values(bindings)) this.pendingKeys.delete(code);
    if (player === 0) this.pendingMouse.clear();
    return command;
  }

  private sampleGamepads(): (Gamepad | null)[] {
    const pads = availableGamepads(), connected = new Set<number>();
    for (const pad of pads) if (pad?.connected) {
      connected.add(pad.index);
      const previous = this.padButtons.get(pad.index) ?? new Set<number>();
      const next = new Set<number>(), pending = this.pendingPadButtons.get(pad.index) ?? new Set<number>();
      pad.buttons.forEach((button, index) => {
        if (button.pressed) { next.add(index); if (!previous.has(index)) pending.add(index); }
      });
      this.padButtons.set(pad.index, next); this.pendingPadButtons.set(pad.index, pending);
    }
    for (const index of this.padButtons.keys()) if (!connected.has(index)) {
      this.padButtons.delete(index); this.pendingPadButtons.delete(index); this.gamepadAim.delete(index);
    }
    return pads;
  }

  gamepad(index: number): InputCommand {
    const pad = this.sampleGamepads()[index];
    if (!pad?.connected) return neutralInput();
    const config = settings.get().gamepad, pending = this.pendingPadButtons.get(index);
    const dead = (value: number) => Math.abs(value) > config.deadzone ? Math.max(-1, Math.min(1, value)) : 0;
    const down = (action: BindingAction, buffer = true) => {
      const button = config.buttons[action];
      return button >= 0 && (Boolean(pad.buttons[button]?.pressed) || (buffer && Boolean(pending?.has(button))));
    };
    const left = down('left', false), right = down('right', false), up = down('up', false), downwards = down('down', false);
    const x = left || right ? Number(right) - Number(left) : dead(pad.axes[config.axes.moveX] ?? 0);
    const y = up || downwards ? Number(downwards) - Number(up) : dead(pad.axes[config.axes.moveY] ?? 0);
    const ax = dead(pad.axes[config.axes.aimX] ?? 0), ay = dead(pad.axes[config.axes.aimY] ?? 0) * (config.invertAimY ? -1 : 1);
    if (ax || ay) {
      const length = Math.hypot(ax, ay); this.gamepadAim.set(index, { x: ax / length, y: ay / length });
    }
    const aim = this.gamepadAim.get(index) ?? { x: 1, y: 0 };
    const slot = (['slot1', 'slot2', 'slot3'] as const).findIndex(action => down(action));
    const command: InputCommand = {
      moveX: x, moveY: y, aimX: aim.x, aimY: aim.y, jump: down('jump'), attack: down('attack'),
      shoot: down('shoot'), throw: down('throw'), special: down('special'), roll: down('roll'), block: down('block'),
      interact: down('interact'), switchWeapon: slot >= 0 ? slot + 2 : down('switch') ? 1 : 0,
    };
    pending?.clear();
    return command;
  }
}
