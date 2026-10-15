import { ACTIONS, ACTION_LABELS, settings, keyLabel, isBindingCode, type BindingAction, type AxisAction } from '../input/settings';
import './settings.css';

type ControlsTab = 'keyboard1' | 'keyboard2' | 'gamepad';
type Capture = { kind: 'keyboard'; player: 0 | 1; action: BindingAction } | { kind: 'gamepad'; action: BindingAction };
const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]!));
const buttonNames: Record<number, string> = { 0: 'A / Cross', 1: 'B / Circle', 2: 'X / Square', 3: 'Y / Triangle', 4: 'LB / L1', 5: 'RB / R1', 6: 'LT / L2', 7: 'RT / R2', 8: 'View / Share', 9: 'Menu / Options', 10: 'Left stick click', 11: 'Right stick click', 12: 'D-pad up', 13: 'D-pad down', 14: 'D-pad left', 15: 'D-pad right', 16: 'Home' };
const padLabel = (button: number) => button < 0 ? 'Unbound' : `${button}: ${buttonNames[button] ?? 'Button'}`;
const mouseOptions = ['Unbound', 'Left button', 'Middle button', 'Right button', 'Back button', 'Forward button'];

export class SettingsPanel {
  private tab: ControlsTab = 'keyboard1';
  private capture: Capture | null = null;
  private active = false;
  private frame = 0;
  private padHeld = new Set<string>();
  constructor(private root: HTMLElement, private onBack: () => void) {}

  show(): void {
    if (this.active) this.destroy();
    this.active = true;
    this.root.innerHTML = `<section class="settings-panel" aria-labelledby="settings-title">
      <header class="settings-heading"><div><div class="eyebrow">MAKE IT YOURS</div><h1 id="settings-title">Your edge. Your rules.</h1></div><button class="text-button" data-pref-back>← BACK</button></header>
      <div class="settings-grid"><aside class="settings-preferences"><h2>Sound & feel</h2>
        ${(['master', 'sfx', 'music'] as const).map(key => `<label class="volume-control"><span>${{ master: 'Master volume', sfx: 'Sound effects', music: 'Music' }[key]}<output data-volume-output="${key}">${Math.round(settings.get().audio[key] * 100)}%</output></span><input type="range" min="0" max="100" step="1" value="${Math.round(settings.get().audio[key] * 100)}" data-volume="${key}" aria-label="${key} volume"></label>`).join('')}
        <div class="settings-divider"></div>
        ${(['screenShake', 'hitstop'] as const).map(key => `<label class="effect-control"><span><strong>${key === 'screenShake' ? 'Screen shake' : 'Impact pause'}</strong><small>${key === 'screenShake' ? 'Camera reacts to heavy hits.' : 'Brief freezes emphasize hard hits.'}</small></span><input type="checkbox" data-effect="${key}" ${settings.get().effects[key] ? 'checked' : ''}></label>`).join('')}
        <div class="settings-divider"></div><h2>Mouse · Player 1</h2>
        ${(['attack', 'shoot'] as const).map(action => `<label class="mouse-control"><span>${ACTION_LABELS[action]}</span><select data-mouse-bind="${action}" aria-label="Mouse ${action}">${mouseOptions.map((name, index) => `<option value="${index - 1}" ${settings.get().mouse[action] === index - 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`).join('')}
        <p class="settings-note">Mouse movement aims for Player 1. Both keyboard players can aim in eight directions using movement keys.</p>
        <button class="settings-reset" data-pref-reset>RESET ALL DEFAULTS</button>
      </aside><div class="settings-controls"><nav class="settings-tabs" aria-label="Control profile"><button data-controls-tab="keyboard1">PLAYER 1</button><button data-controls-tab="keyboard2">PLAYER 2</button><button data-controls-tab="gamepad">GAMEPAD</button></nav>
        <p class="settings-help">Select a binding, then press a key. Occupied bindings swap automatically. Escape cancels; Tab keeps keyboard navigation.</p><div class="settings-bindings"></div>
      </div></div><div class="settings-status" role="status" aria-live="polite"></div>
    </section>`;
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('change', this.onChange);
    this.root.addEventListener('input', this.onInput);
    window.addEventListener('keydown', this.onKey, true);
    this.renderBindings(); this.status();
    this.root.querySelector<HTMLButtonElement>('[data-pref-back]')?.focus();
  }

  destroy(): void {
    this.active = false; this.capture = null; cancelAnimationFrame(this.frame);
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('change', this.onChange);
    this.root.removeEventListener('input', this.onInput);
    window.removeEventListener('keydown', this.onKey, true);
  }

  private status(message = ''): void {
    const status = this.root.querySelector<HTMLElement>('.settings-status');
    if (status) status.textContent = [message, settings.persistent ? 'Saved automatically in this browser.' : 'Browser storage unavailable. Changes apply for this session.'].filter(Boolean).join(' ');
  }
  private renderBindings(): void {
    const holder = this.root.querySelector<HTMLElement>('.settings-bindings');
    if (!holder) return;
    this.root.querySelectorAll<HTMLButtonElement>('[data-controls-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.controlsTab === this.tab)));
    const config = settings.get();
    if (this.tab === 'gamepad') {
      holder.innerHTML = `<p class="settings-note">One profile applies to every connected gamepad. Choose a button or use Capture, then press it on your controller.</p><div class="gamepad-axis-grid">${(['moveX', 'moveY', 'aimX', 'aimY'] as AxisAction[]).map(axis => `<label><span>${{ moveX: 'Move horizontal', moveY: 'Move vertical', aimX: 'Aim horizontal', aimY: 'Aim vertical' }[axis]}</span><select data-axis="${axis}" aria-label="${axis} axis">${Array.from({ length: 9 }, (_, index) => index - 1).map(index => `<option value="${index}" ${config.gamepad.axes[axis] === index ? 'selected' : ''}>${index < 0 ? 'Disabled' : `Axis ${index}`}</option>`).join('')}</select></label>`).join('')}</div><label class="volume-control deadzone-control"><span>Stick deadzone<output data-deadzone-output>${Math.round(config.gamepad.deadzone * 100)}%</output></span><input type="range" min="5" max="80" value="${Math.round(config.gamepad.deadzone * 100)}" data-deadzone aria-label="Stick deadzone"></label><label class="invert-aim"><input type="checkbox" data-invert-aim ${config.gamepad.invertAimY ? 'checked' : ''}> Invert vertical aim</label>
      ${ACTIONS.map(action => `<div class="binding-row"><span>${ACTION_LABELS[action]}</span><select data-pad-bind="${action}" aria-label="Gamepad ${ACTION_LABELS[action]}">${Array.from({ length: 33 }, (_, index) => index - 1).map(button => `<option value="${button}" ${config.gamepad.buttons[action] === button ? 'selected' : ''}>${padLabel(button)}</option>`).join('')}</select><button class="binding-capture ${this.capture?.kind === 'gamepad' && this.capture.action === action ? 'capturing' : ''}" data-pad-capture="${action}">${this.capture?.kind === 'gamepad' && this.capture.action === action ? 'PRESS…' : 'CAPTURE'}</button></div>`).join('')}`;
    } else {
      const player = this.tab === 'keyboard1' ? 0 : 1;
      holder.innerHTML = ACTIONS.map(action => `<div class="binding-row"><span>${ACTION_LABELS[action]}</span><button class="key-binding ${this.capture?.kind === 'keyboard' && this.capture.action === action ? 'capturing' : ''}" data-key-bind="${action}" aria-label="Player ${player + 1} ${ACTION_LABELS[action]}">${this.capture?.kind === 'keyboard' && this.capture.action === action ? 'PRESS A KEY…' : escapeHtml(keyLabel(config.keyboard[player][action]))}</button><button class="unbind-button" data-unbind="${action}" aria-label="Clear ${ACTION_LABELS[action]} binding" title="Clear binding">×</button></div>`).join('');
    }
  }

  private onClick = (event: MouseEvent): void => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.hasAttribute('data-pref-back')) { this.onBack(); return; }
    if (target.hasAttribute('data-pref-reset')) { this.cancelCapture(); settings.reset(); this.show(); this.status('Default controls, audio and effects restored.'); return; }
    if (target.dataset.controlsTab) { this.cancelCapture(); this.tab = target.dataset.controlsTab as ControlsTab; this.renderBindings(); this.status(); return; }
    if (target.dataset.keyBind) {
      this.cancelCapture(); this.capture = { kind: 'keyboard', player: this.tab === 'keyboard1' ? 0 : 1, action: target.dataset.keyBind as BindingAction };
      this.renderBindings(); this.status('Press a key. Escape cancels; Tab moves focus.'); return;
    }
    if (target.dataset.unbind) { this.cancelCapture(); settings.bindKeyboard(this.tab === 'keyboard1' ? 0 : 1, target.dataset.unbind as BindingAction, ''); this.renderBindings(); this.status('Binding cleared.'); return; }
    if (target.dataset.padCapture) {
      this.cancelCapture(); this.capture = { kind: 'gamepad', action: target.dataset.padCapture as BindingAction };
      this.padHeld = this.heldPadButtons(); this.renderBindings(); this.status('Press a gamepad button. Connect a controller and press a button if none is detected. Escape cancels.');
      this.frame = requestAnimationFrame(this.pollCapture);
    }
  };
  private onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.volume) {
      const key = target.dataset.volume as 'master' | 'sfx' | 'music'; settings.update({ audio: { [key]: Number(target.value) / 100 } });
      const output = this.root.querySelector(`[data-volume-output="${key}"]`); if (output) output.textContent = `${target.value}%`; this.status();
    }
    if (target.hasAttribute('data-deadzone')) {
      settings.update({ gamepad: { deadzone: Number(target.value) / 100 } });
      const output = this.root.querySelector('[data-deadzone-output]'); if (output) output.textContent = `${target.value}%`; this.status();
    }
  };
  private onChange = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.effect) settings.update({ effects: { [target.dataset.effect]: target.checked } });
    if (target.dataset.mouseBind) { const note = settings.bindMouse(target.dataset.mouseBind as 'attack' | 'shoot', Number(target.value)); this.root.querySelectorAll<HTMLSelectElement>('[data-mouse-bind]').forEach(select => select.value = String(settings.get().mouse[select.dataset.mouseBind as 'attack' | 'shoot'])); this.status(note); return; }
    if (target.dataset.padBind) { this.cancelCapture(); const note = settings.bindGamepad(target.dataset.padBind as BindingAction, Number(target.value)); this.renderBindings(); this.status(note); return; }
    if (target.dataset.axis) settings.update({ gamepad: { axes: { [target.dataset.axis]: Number(target.value) } } });
    if (target.hasAttribute('data-invert-aim')) settings.update({ gamepad: { invertAimY: target.checked } });
    this.status();
  };
  private onKey = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (this.capture) { this.cancelCapture(); this.renderBindings(); this.status('Binding change cancelled.'); }
      else this.onBack();
      return;
    }
    if (!this.capture || this.capture.kind !== 'keyboard') return;
    if (event.code === 'Tab') { this.cancelCapture(); this.renderBindings(); this.status('Binding change cancelled.'); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (!isBindingCode(event.code)) { this.status('That key is reserved for browser or menu controls. Choose another key, or Escape to cancel.'); return; }
    const { player, action } = this.capture;
    const note = settings.bindKeyboard(player, action, event.code);
    this.cancelCapture(); this.renderBindings(); this.status(`${ACTION_LABELS[action]} bound to ${keyLabel(event.code)}. ${note}`);
    this.root.querySelector<HTMLButtonElement>(`[data-key-bind="${action}"]`)?.focus();
  };
  private cancelCapture(): void { this.capture = null; cancelAnimationFrame(this.frame); }
  private heldPadButtons(): Set<string> {
    const held = new Set<string>();
    try { for (const pad of navigator.getGamepads?.() ?? []) if (pad?.connected) pad.buttons.forEach((button, index) => { if (button.pressed) held.add(`${pad.index}:${index}`); }); } catch { /* A denied gamepad API still permits manual mapping. */ }
    return held;
  }
  private pollCapture = (): void => {
    if (!this.active || this.capture?.kind !== 'gamepad') return;
    const held = this.heldPadButtons(), fresh = [...held].find(button => !this.padHeld.has(button)); this.padHeld = held;
    if (fresh) {
      const button = Number(fresh.split(':')[1]), action = this.capture.action;
      const note = settings.bindGamepad(action, button); this.cancelCapture(); this.renderBindings(); this.status(`${ACTION_LABELS[action]} bound to ${padLabel(button)}. ${note}`);
      this.root.querySelector<HTMLButtonElement>(`[data-pad-capture="${action}"]`)?.focus(); return;
    }
    this.frame = requestAnimationFrame(this.pollCapture);
  };
}
