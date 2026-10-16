import { ACTIONS, ACTION_LABELS, settings, defaultSettings, keyLabel, isBindingCode, type BindingAction, type AxisAction } from '../input/settings';
import { controlSchemes, CONTROL_SCHEME_NAME_LIMIT, MAX_CONTROL_SCHEMES } from '../input/controlSchemes';
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
  constructor(private root: HTMLElement, private onBack: () => void, private controlsOnly = false) {}

  show(): void {
    if (this.active) this.destroy();
    this.active = true;
    this.root.innerHTML = `<section class="settings-panel" aria-labelledby="settings-title">
      <header class="settings-heading"><div><div class="eyebrow">MAKE IT YOURS</div><h1 id="settings-title">${this.controlsOnly ? 'MAKE YOUR MOVE.' : 'Your edge. Your rules.'}</h1></div><button class="text-button" data-pref-back>${this.controlsOnly ? '← CONTROLS' : '← BACK'}</button></header>
      <div class="settings-grid"><aside class="settings-preferences">${this.controlsOnly ? '' : `<h2>Sound & feel</h2>
        ${(['master', 'sfx', 'music'] as const).map(key => `<label class="volume-control"><span>${{ master: 'Master volume', sfx: 'Sound effects', music: 'Music' }[key]}<output data-volume-output="${key}">${Math.round(settings.get().audio[key] * 100)}%</output></span><input type="range" min="0" max="100" step="1" value="${Math.round(settings.get().audio[key] * 100)}" data-volume="${key}" aria-label="${key} volume"></label>`).join('')}
        <div class="settings-divider"></div>
        ${(['screenShake', 'hitstop'] as const).map(key => `<label class="effect-control"><span><strong>${key === 'screenShake' ? 'Screen shake' : 'Impact pause'}</strong><small>${key === 'screenShake' ? 'Camera reacts to heavy hits.' : 'Brief freezes emphasize hard hits.'}</small></span><input type="checkbox" data-effect="${key}" ${settings.get().effects[key] ? 'checked' : ''}></label>`).join('')}
        <div class="settings-divider"></div>`}<h2>Movement gestures</h2>
        ${([
          ['sprintDoubleTap', 'Double-tap to sprint', 'Tap left or right twice, then hold that direction for double speed.'],
          ['rollWithDown', 'Duck + direction to roll', 'Press down while moving left or right to dodge.'],
          ['dropThroughDoubleTap', 'Double-tap down to drop', 'Drop through a platform or thin catwalk when there is room below.'],
        ] as const).map(([key, label, hint]) => `<label class="effect-control gesture-control"><span><strong>${label}</strong><small>${hint}</small></span><input type="checkbox" data-gesture="${key}" aria-label="${label}" ${settings.get().gestures[key] ? 'checked' : ''}></label>`).join('')}
        <label class="volume-control gesture-timing"><span>Double-tap window<output data-double-tap-output>${settings.get().gestures.doubleTapWindowMs} ms</output></span><input type="range" min="100" max="500" step="10" value="${settings.get().gestures.doubleTapWindowMs}" data-double-tap-window aria-label="Double-tap window"></label>
        <p class="settings-note">Applies to both keyboards and every gamepad. A longer window makes double-taps easier. Optional sprint, roll, and drop-through bindings are available below.</p>
        <div class="settings-divider"></div><h2>Mouse · Player 1</h2>
        ${(['attack', 'shoot'] as const).map(action => `<label class="mouse-control"><span>${ACTION_LABELS[action]}</span><select data-mouse-bind="${action}" aria-label="Mouse ${action}">${mouseOptions.map((name, index) => `<option value="${index - 1}" ${settings.get().mouse[action] === index - 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`).join('')}
        <p class="settings-note">Mouse movement aims for Player 1. Both keyboard players can aim in eight directions using movement keys.</p>
        <button class="settings-reset" data-pref-reset>${this.controlsOnly ? 'RESET CONTROLS' : 'RESET ALL DEFAULTS'}</button>
        <p class="settings-note">Reset keeps your saved control schemes.</p>
      </aside><div class="settings-controls"><div class="control-schemes"></div><nav class="settings-tabs" aria-label="Control profile"><button data-controls-tab="keyboard1">PLAYER 1</button><button data-controls-tab="keyboard2">PLAYER 2</button><button data-controls-tab="gamepad">GAMEPAD</button></nav>
        <p class="settings-help">Select a binding, then press a key. Occupied bindings swap automatically. Escape cancels; Tab keeps keyboard navigation.</p><div class="settings-bindings"></div>
      </div></div><div class="settings-status" role="status" aria-live="polite"></div>
    </section>`;
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('change', this.onChange);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('focusin', this.onFocus);
    window.addEventListener('keydown', this.onKey, true);
    this.renderSchemes(); this.renderBindings(); this.status();
    this.root.querySelector<HTMLButtonElement>('[data-pref-back]')?.focus();
  }

  destroy(): void {
    this.active = false; this.capture = null; cancelAnimationFrame(this.frame);
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('change', this.onChange);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('focusin', this.onFocus);
    window.removeEventListener('keydown', this.onKey, true);
  }

  private status(message = ''): void {
    const status = this.root.querySelector<HTMLElement>('.settings-status');
    if (status) status.textContent = [message, settings.persistent && controlSchemes.persistent ? 'Active settings are kept in this browser. Save a scheme to keep a named copy.' : 'Some browser storage is unavailable. Unsaved changes remain available for this session.'].filter(Boolean).join(' ');
    const feedback = this.root.querySelector<HTMLElement>('.scheme-feedback');
    if (feedback) feedback.textContent = message;
    this.renderSchemeState();
  }
  private renderSchemes(): void {
    const holder = this.root.querySelector<HTMLElement>('.control-schemes');
    if (!holder) return;
    const schemes = controlSchemes.list(), selected = controlSchemes.activeId ? controlSchemes.get(controlSchemes.activeId) : undefined;
    holder.innerHTML = `<div class="scheme-heading"><h2>Saved control schemes</h2><span data-scheme-state></span></div>
      <label class="scheme-field"><span>Use a saved scheme</span><select data-control-scheme aria-label="Saved control scheme"><option value="">Current custom controls</option>${schemes.map(scheme => `<option value="${escapeHtml(scheme.id)}" ${scheme.id === selected?.id ? 'selected' : ''}>${escapeHtml(scheme.name)}</option>`).join('')}</select></label>
      <label class="scheme-field"><span>Scheme name</span><input data-scheme-name aria-label="Control scheme name" maxlength="${CONTROL_SCHEME_NAME_LIMIT}" placeholder="e.g. Couch co-op" value="${escapeHtml(selected?.name ?? '')}" autocomplete="off"></label>
      <div class="scheme-actions"><button data-scheme-action="save" ${schemes.length >= MAX_CONTROL_SCHEMES ? 'disabled' : ''}>SAVE NEW</button><button data-scheme-action="update" ${selected ? '' : 'disabled'}>SAVE CHANGES</button><button data-scheme-action="rename" ${selected ? '' : 'disabled'}>RENAME</button><button data-scheme-action="delete" ${selected ? '' : 'disabled'}>DELETE</button></div>
      <p class="scheme-feedback"></p>
      <p class="settings-note">Choose a scheme to apply it. Each saves both keyboards, mouse bindings, gamepad controls, and movement gestures. Edit your controls, then save your changes or give a new scheme its own name. ${schemes.length}/${MAX_CONTROL_SCHEMES} saved.</p>`;
    this.renderSchemeState();
  }
  private renderSchemeState(): void {
    const state = this.root.querySelector<HTMLElement>('[data-scheme-state]');
    if (!state) return;
    const selected = controlSchemes.activeId ? controlSchemes.get(controlSchemes.activeId) : undefined;
    const { keyboard, mouse, gamepad, gestures } = settings.get();
    const modified = Boolean(selected && JSON.stringify(selected.controls) !== JSON.stringify({ keyboard, mouse, gamepad, gestures }));
    state.textContent = selected ? modified ? 'Unsaved changes' : 'Saved scheme' : 'Current custom controls';
    state.dataset.modified = String(modified);
  }
  private schemeAction(action: string): void {
    this.cancelCapture(); this.renderBindings();
    const name = this.root.querySelector<HTMLInputElement>('[data-scheme-name]')?.value ?? '';
    const id = controlSchemes.activeId;
    try {
      let message: string;
      if (action === 'save') { const scheme = controlSchemes.save(name, settings.get()); message = `Saved “${scheme.name}”.`; }
      else {
        if (!id) throw new Error('Select a saved scheme first.');
        if (action === 'update') { const scheme = controlSchemes.save(name, settings.get(), id); message = `Updated “${scheme.name}”.`; }
        else if (action === 'rename') { const scheme = controlSchemes.rename(id, name); message = `Renamed scheme to “${scheme.name}”.`; }
        else if (action === 'delete') { const previous = controlSchemes.get(id)!.name; controlSchemes.remove(id); message = `Deleted “${previous}”. Current controls are unchanged.`; }
        else return;
      }
      this.renderSchemes(); this.status(message);
      this.root.querySelector<HTMLElement>(action === 'delete' ? '[data-control-scheme]' : `[data-scheme-action="${action}"]`)?.focus();
    } catch (error) { this.status(error instanceof Error ? error.message : 'Could not save this control scheme.'); }
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
    if (target.dataset.schemeAction) { this.schemeAction(target.dataset.schemeAction); return; }
    if (target.hasAttribute('data-pref-reset')) {
      this.cancelCapture();
      if (this.controlsOnly) { const { keyboard, mouse, gamepad, gestures } = defaultSettings(); settings.update({ keyboard, mouse, gamepad, gestures }); }
      else settings.reset();
      controlSchemes.select(null); this.show(); this.status(this.controlsOnly ? 'Default controls restored. Saved schemes kept.' : 'Default controls, audio and effects restored. Saved schemes kept.'); return;
    }
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
  private onFocus = (event: FocusEvent): void => {
    if (!this.capture || !(event.target instanceof Element) || !event.target.matches('input, select, textarea, [contenteditable="true"]')) return;
    this.cancelCapture(); this.renderBindings(); this.status('Binding change cancelled.');
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
    if (target.hasAttribute('data-double-tap-window')) {
      settings.update({ gestures: { doubleTapWindowMs: Number(target.value) } });
      const output = this.root.querySelector('[data-double-tap-output]'); if (output) output.textContent = `${settings.get().gestures.doubleTapWindowMs} ms`; this.status();
    }
  };
  private onChange = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.hasAttribute('data-control-scheme')) {
      this.cancelCapture();
      try {
        const id = target.value || null;
        const scheme = id ? controlSchemes.get(id) : undefined;
        controlSchemes.select(id);
        if (scheme) settings.update(scheme.controls);
        this.show(); this.status(scheme ? `Applied “${scheme.name}”.` : 'Current controls are ready to save as a new scheme.');
        this.root.querySelector<HTMLElement>('[data-control-scheme]')?.focus();
      } catch (error) { this.status(error instanceof Error ? error.message : 'Could not load this control scheme.'); }
      return;
    }
    if (target.dataset.effect) settings.update({ effects: { [target.dataset.effect]: target.checked } });
    if (target.dataset.gesture) settings.update({ gestures: { [target.dataset.gesture]: target.checked } });
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
