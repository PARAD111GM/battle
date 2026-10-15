import { ARENAS, getArena } from '../data/arenas';
import { THROWABLES } from '../data/combat';
import { settings, keyLabel } from '../input/settings';
import { CHARACTERS, getCharacter } from '../data/characters';
import { WEAPONS } from '../sim/weapons/definitions';
import type { ArenaData } from '../sim/types';
import type { MatchSettings, MatchResults } from '../sim/match/types';

export interface PlayerConfig {
  name: string; character: string; controller: string; difficulty: string; team: number;
}
export interface MatchConfig { arena: string; settings: Partial<MatchSettings>; players: PlayerConfig[]; seed?: number }
export const html = (value: unknown): string => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function defaultConfig(): MatchConfig {
  return { arena: 'warehouse', settings: { mode: 'deathmatch', damageMode: 'health', timeLimit: 300, stocks: 3, scoreLimit: 10, friendlyFire: true, weaponSet: 'all', customWeapons: ['pistol', 'shotgun', 'unarmed'] },
    players: ['rivet', 'flux', 'cinder', 'wisp'].map((character, index) => ({ name: character.toUpperCase(), character, controller: index ? 'bot' : 'keyboard', difficulty: 'normal', team: index % 2 })) };
}
export function arenaArt(arena: ArenaData): string {
  const colors = ['transparent', '#58675e', '#a98357', '#91bfc7', '#616e7b'];
  let tiles = '';
  for (let y = 0; y < arena.height; y++) {
    for (let x = 0; x < arena.width;) {
      const value = arena.tiles[y * arena.width + x];
      if (!value) { x++; continue; }
      let end = x + 1; while (end < arena.width && arena.tiles[y * arena.width + end] === value) end++;
      tiles += `<rect x="${x * arena.tileSize}" y="${y * arena.tileSize}" width="${(end - x) * arena.tileSize}" height="${arena.tileSize}" fill="${colors[value] ?? '#7d7461'}"/>`; x = end;
    }
  }
  const props = arena.props.filter(p => p.type === 'ladder' || p.type === 'rope').map(p => `<path d="M${p.x + p.width / 2} ${p.y}v${p.height}" stroke="#cba968" stroke-width="${p.type === 'rope' ? 4 : 9}" stroke-dasharray="${p.type === 'rope' ? '0' : '7 6'}"/>`).join('');
  return `<svg class="arena-art" viewBox="0 0 ${arena.width * arena.tileSize} ${arena.height * arena.tileSize}" role="img" aria-label="${html(arena.name)} arena layout"><rect width="100%" height="100%" fill="#14232b"/><path d="M0 300H4000M0 600H4000M0 900H4000" stroke="#20383e" stroke-width="3"/>${tiles}${props}${arena.spawns.map((s, i) => `<circle cx="${s.x}" cy="${s.y}" r="13" fill="${i % 2 ? '#68e2df' : '#ffb74d'}"/>`).join('')}</svg>`;
}
export function portrait(id: string, large = false): string {
  const character = getCharacter(id), color = `#${character.color.toString(16).padStart(6, '0')}`;
  const index = Math.max(0, CHARACTERS.findIndex(c => c.id === id));
  return `<svg class="fighter-portrait ${large ? 'large' : ''}" viewBox="0 0 180 230" aria-hidden="true"><defs><linearGradient id="metal-${id}" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#25383f"/></linearGradient></defs><ellipse cx="91" cy="216" rx="58" ry="9" fill="#070d12" opacity=".5"/><path d="M65 145l-8 62h22l15-48 10 48h24l-13-64" fill="#23313b" stroke="#0d1820" stroke-width="6"/><path d="M56 202h25v14H48v-8zm47 0h26l8 14h-34" fill="#788082"/><path d="M58 84l-17 19-11 49 15 7 24-41m51-35 22 25 9 43-17 5-21-43" fill="${color}" stroke="#10212a" stroke-width="6"/><path d="M57 80l32-13 34 15-7 70-26 14-32-13z" fill="url(#metal-${id})" stroke="#101d26" stroke-width="7"/><path d="M65 99h51v12H65m7 14h34v10H72" stroke="#182c36" stroke-width="7"/><path d="M66 42l19-13 29 10 8 32-18 19-33-8z" fill="#354954" stroke="#101d26" stroke-width="6"/><path d="M70 50l45 4-1 14-40-2z" fill="${index === 2 ? '#fff1ae' : '#b2f8ed'}"/><path d="M76 55l32 3" stroke="#fff" stroke-width="3"/><path d="M62 82l61 5-7 13-54-5" fill="${color}"/>${index === 0 ? '<path d="M55 29h70l-9 17-50-4z" fill="#ffb74d"/>' : index === 1 ? '<path d="M114 41l15-23 7 3-10 30" fill="#68e2df"/>' : index === 2 ? '<path d="M76 30l10-21 6 20 13-9 4 20" fill="#ff6b69"/>' : '<path d="M69 43Q84 4 119 39l10 45-13-13-1-20" fill="#a99bff"/>'}<path d="M34 145l17-3 43 16-4 14-47-10-11 8-8-6z" fill="#151e26" stroke="#536572" stroke-width="4"/><path d="M82 158l28 8" stroke="${color}" stroke-width="5"/><path d="M65 151l-4 38m52-38 7 38" stroke="${color}" stroke-width="5"/></svg>`;
}

type Screen = 'title' | 'menu' | 'setup' | 'characters' | 'controls' | 'pause' | 'results' | 'match' | 'settings' | 'editor';
interface MenuActions { start: (config: MatchConfig) => void; resume: () => void; mainMenu: () => void; settings?: () => void; editor?: () => void; importReplay?: () => void; exportReplay?: () => void; backToEditor?: () => void; rematch?: () => void }
export class Menu {
  config: MatchConfig = defaultConfig();
  screen: Screen = 'title';
  matchArenaName = '';
  testingEditor = false;
  replaying = false;
  canExportReplay = false;
  private selectedPlayer = 0;
  private resultsData?: MatchResults;
  private previous: Screen = 'menu';
  constructor(private root: HTMLElement, private actions: MenuActions) {
    try { const saved = JSON.parse(localStorage.getItem('rivetfall.match') ?? 'null') as MatchConfig | null; if (saved && Array.isArray(saved.players) && saved.players.length >= 2 && saved.players.length <= 8 && saved.settings) this.config = saved; } catch { /* Storage may be unavailable in embedded browsers. */ }
    root.addEventListener('click', event => { const button = (event.target as Element).closest<HTMLElement>('[data-action]'); if (button) this.action(button.dataset.action!, button.dataset.value); });
    root.addEventListener('change', event => this.change(event.target as HTMLInputElement));
  }
  show(screen: Screen): void { this.screen = screen; this.render(); }
  external(screen: 'settings' | 'editor'): void { this.screen = screen; this.root.dataset.screen = screen; }
  notice(message: string): void { const old = this.root.querySelector('.menu-message'); old?.remove(); const status = document.createElement('div'); status.className = 'menu-message'; status.setAttribute('role', 'status'); status.textContent = message; this.root.querySelector('.screen')?.append(status); }
  hide(): void { this.screen = 'match'; this.root.innerHTML = ''; this.root.dataset.screen = 'match'; }
  results(results: MatchResults): void { this.resultsData = results; this.show('results'); }
  pause(): void { this.show('pause'); }
  back(): void {
    if (this.screen === 'pause') { this.hide(); this.actions.resume(); }
    else if (this.screen === 'controls') this.show(this.previous);
    else if (this.screen === 'characters') this.show('setup');
    else if (this.screen !== 'match' && this.screen !== 'title') this.show('menu');
  }
  private save(): void { try { localStorage.setItem('rivetfall.match', JSON.stringify(this.config)); } catch { /* Optional persistence. */ } }
  private action(action: string, value?: string): void {
    if (action === 'settings') this.actions.settings?.();
    if (action === 'editor') this.actions.editor?.();
    if (action === 'import-replay') this.actions.importReplay?.();
    if (action === 'export-replay') this.actions.exportReplay?.();
    if (action === 'back-editor') this.actions.backToEditor?.();
    if (action === 'enter') this.show('menu');
    if (action === 'setup') this.show('setup');
    if (action === 'quick') { this.config = defaultConfig(); this.actions.start(clone(this.config)); }
    if (action === 'characters') { this.save(); this.selectedPlayer = 0; this.show('characters'); }
    if (action === 'start') { this.save(); this.actions.start(clone(this.config)); }
    if (action === 'back') this.back();
    if (action === 'menu') { this.actions.mainMenu(); this.show('menu'); }
    if (action === 'resume') { this.hide(); this.actions.resume(); }
    if (action === 'rematch') { if (this.actions.rematch) this.actions.rematch(); else this.actions.start(clone(this.config)); }
    if (action === 'arena') { this.config.arena = value!; this.config.players.length = Math.min(this.config.players.length, getArena(value).spawns.length); this.render(); }
    if (action === 'player') { this.selectedPlayer = Number(value); this.render(); }
    if (action === 'character') { const player = this.config.players[this.selectedPlayer]; player.character = value!; player.name = getCharacter(value!).name.toUpperCase(); this.render(); }
    if (action === 'controls') { this.previous = this.screen; this.show('controls'); }
  }
  private change(target: HTMLInputElement): void {
    if (target.dataset.setting) {
      const key = target.dataset.setting as keyof MatchSettings;
      const value = target.type === 'checkbox' ? target.checked : ['timeLimit', 'stocks', 'scoreLimit'].includes(key) ? Number(target.value) : target.value;
      Object.assign(this.config.settings, { [key]: value });
      if (key === 'weaponSet' || key === 'mode') this.render();
    }
    if (target.dataset.slots) {
      const length = Math.max(2, Math.min(8, getArena(this.config.arena).spawns.length, Number(target.value)));
      while (this.config.players.length < length) { const index = this.config.players.length, character = CHARACTERS[index % CHARACTERS.length]; this.config.players.push({ name: character.name.toUpperCase(), character: character.id, controller: 'bot', difficulty: 'normal', team: index % 2 }); }
      this.config.players.length = length; this.render();
    }
    if (target.dataset.player !== undefined && target.dataset.field) {
      const index = Number(target.dataset.player), key = target.dataset.field;
      Object.assign(this.config.players[index], { [key]: key === 'team' ? Number(target.value) : target.value });
      if (key === 'controller') this.render();
    }
    if (target.dataset.weapon) { const selected = new Set(this.config.settings.customWeapons ?? []); target.checked ? selected.add(target.dataset.weapon) : selected.delete(target.dataset.weapon); this.config.settings.customWeapons = [...selected]; }
  }
  private option(value: string | number, label: string, current: unknown): string { return `<option value="${html(value)}" ${String(current) === String(value) ? 'selected' : ''}>${html(label)}</option>`; }
  private setting(key: keyof MatchSettings, label: string, options: (string | [string | number, string])[]): string {
    return `<label class="field"><span>${label}</span><select data-setting="${key}" aria-label="${label}">${options.map(o => Array.isArray(o) ? this.option(o[0], o[1], this.config.settings[key]) : this.option(o, o, this.config.settings[key])).join('')}</select></label>`;
  }
  private title(): string {
    return `<div class="title-copy"><div class="eyebrow"><span class="signal-dot"></span> LOCAL MULTIPLAYER · 2—8 FIGHTERS</div><h1>BREAK THE ARENA.<br><em>OWN THE FIGHT.</em></h1><p>Heavy hits. Wild weapons. No safe ground.<br>A fast, destructible brawler for your next rivalry.</p><button class="primary-button" data-action="enter">ENTER THE ARENA <span>→</span></button><div class="title-footnote">PLAY SOLO WITH BOTS OR BRING YOUR RIVALS</div><div class="feature-strip"><span><b>04</b> FIGHTERS</span><span><b>04</b> ARENAS</span><span><b>∞</b> WAYS TO FALL</span></div></div><div class="title-art"><div class="art-grid"></div><div class="art-word">RIVET<br>FALL</div><div class="hero-fighter hero-back">${portrait('flux', true)}</div><div class="hero-fighter hero-front">${portrait('rivet', true)}</div><div class="art-note"><span>01 / IRONWORKS</span><b>EVERY SURFACE HAS A BREAKING POINT.</b></div><span class="art-cross cross-a">+</span><span class="art-cross cross-b">+</span></div>`;
  }
  private menu(): string {
    const arena = getArena(this.config.arena);
    return `<div class="menu-intro"><div class="eyebrow">THE ARENA IS YOURS</div><h1>MAKE<br><em>AN IMPACT.</em></h1><p>Build your match. Pick a fighter.<br>Leave the place different than you found it.</p><button class="primary-button" data-action="setup">PLAY <span>→</span></button><button class="secondary-button" data-action="quick">QUICK MATCH <span>1 PLAYER + 3 BOTS</span></button><button class="text-button" data-action="controls">CONTROLS & HOW TO PLAY →</button><div class="menu-utilities"><button class="text-button" data-action="editor">ARENA EDITOR</button><button class="text-button" data-action="import-replay">LOAD REPLAY</button><button class="text-button" data-action="settings">SETTINGS</button></div><div class="local-note"><span class="signal-dot"></span> OFFLINE READY · NO ACCOUNT NEEDED</div></div><div class="menu-showcase"><div class="section-line"><span>THE ROSTER</span><span>04 / BUILT DIFFERENT</span></div><div class="roster-preview">${CHARACTERS.map(c => `<div class="roster-mini" style="--character:#${c.color.toString(16).padStart(6, '0')}">${portrait(c.id)}<h3>${html(c.name)}</h3><span>${html(c.role)}</span></div>`).join('')}</div><div class="featured-arena">${arenaArt(arena)}<div><span class="eyebrow">FEATURED BATTLEGROUND</span><h2>${html(arena.name)}</h2><p>${html(arena.subtitle)}</p></div><span class="arena-index">01 / 04</span></div></div>`;
  }
  private setup(): string {
    const s = this.config.settings;
    return `<div class="screen-heading"><div><div class="eyebrow">01 / SET THE STAKES</div><h1>YOUR MATCH. YOUR RULES.</h1></div><button class="text-button" data-action="back">← BACK</button></div><div class="setup-grid"><section class="arena-select"><div class="section-line"><span>BATTLEGROUND</span><span>${ARENAS.length} ARENAS</span></div><div class="arena-options">${ARENAS.map(a => `<button class="arena-card ${a.id === this.config.arena ? 'selected' : ''}" data-action="arena" data-value="${html(a.id)}" aria-pressed="${a.id === this.config.arena}">${arenaArt(a)}<span><strong>${html(a.name)}</strong><small>${html(a.subtitle)}</small></span><i>${a.id === this.config.arena ? '✓' : '→'}</i></button>`).join('')}</div><div class="rules-panel"><div class="section-line"><span>MATCH RULES</span><span>MAKE IT YOURS</span></div><div class="rule-fields">${this.setting('mode', 'Mode', [['deathmatch', 'Deathmatch'], ['team', 'Team battle'], ['stocks', 'Last fighter standing']])}${this.setting('damageMode', 'Damage system', [['health', 'Health / knockout'], ['percent', 'Percent / ring-out']])}${this.setting('timeLimit', 'Time limit', [[120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes'], [600, '10 minutes'], [0, 'Unlimited']])}${s.mode === 'stocks' ? this.setting('stocks', 'Starting stocks', [[1, '1 life'], [3, '3 lives'], [5, '5 lives'], [10, '10 lives']]) : this.setting('scoreLimit', 'Score limit', [[5, '5 knockouts'], [10, '10 knockouts'], [20, '20 knockouts'], [0, 'Unlimited']])}${this.setting('weaponSet', 'Weapons', [['all', 'Full arsenal'], ['melee', 'Melee only'], ['guns', 'Guns only'], ['custom', 'Custom selection']])}<label class="toggle-field"><input type="checkbox" data-setting="friendlyFire" ${s.friendlyFire ? 'checked' : ''}/><span>Friendly fire<small>Teammates can damage each other</small></span></label></div>${s.weaponSet === 'custom' ? `<div class="weapon-checks">${Object.entries({ ...WEAPONS, ...THROWABLES }).map(([id, w]) => `<label><input type="checkbox" data-weapon="${id}" ${(s.customWeapons ?? []).includes(id) ? 'checked' : ''}>${html(w.name)}</label>`).join('')}</div>` : ''}</div></section><section class="lobby-panel"><div class="section-line"><span>THE LINEUP</span><label class="slot-count">FIGHTERS <select data-slots="true" aria-label="Number of fighters">${[2, 3, 4, 5, 6, 7, 8].filter(n => n <= getArena(this.config.arena).spawns.length).map(n => this.option(n, String(n), this.config.players.length)).join('')}</select></label></div><div class="player-slots">${this.config.players.map((p, i) => `<article class="player-slot" style="--character:#${getCharacter(p.character).color.toString(16).padStart(6, '0')}"><span class="slot-number">${String(i + 1).padStart(2, '0')}</span><div class="slot-content"><div class="slot-top"><strong>${html(getCharacter(p.character).name)}</strong><select data-player="${i}" data-field="controller" aria-label="Player ${i + 1} controller">${[['keyboard', 'Keyboard + mouse'], ['keyboard2', 'Second keyboard'], ...Array.from({ length: 6 }, (_, n) => [`gamepad${n}`, `Gamepad ${n + 1}`]), ['bot', 'Bot']].map(([id, label]) => this.option(id, label, p.controller)).join('')}</select></div><div class="slot-details">${p.controller === 'bot' ? `<label>SKILL <select data-player="${i}" data-field="difficulty" aria-label="Player ${i + 1} difficulty">${['easy', 'normal', 'hard', 'expert'].map(d => this.option(d, d.toUpperCase(), p.difficulty)).join('')}</select></label>` : `<span>${p.controller === 'keyboard' ? 'WASD + MOUSE' : p.controller === 'keyboard2' ? 'ARROWS + ENTER' : 'PRESS A BUTTON TO CONNECT'}</span>`}<label>TEAM <select data-player="${i}" data-field="team" aria-label="Player ${i + 1} team">${[0, 1, 2, 3].map(n => this.option(n, ['AMBER', 'CYAN', 'CORAL', 'VIOLET'][n], p.team)).join('')}</select></label></div></div></article>`).join('')}</div><p class="lobby-help">Share a keyboard with a rival, connect gamepads, or fill the arena with bots. Choose your fighters next.</p><button class="primary-button" data-action="characters">CHOOSE FIGHTERS <span>→</span></button></section></div>`;
  }
  private characters(): string {
    const selected = this.config.players[this.selectedPlayer], character = getCharacter(selected.character);
    return `<div class="screen-heading"><div><div class="eyebrow">02 / PICK YOUR EDGE</div><h1>WHO’S MAKING THE MESS?</h1></div><button class="text-button" data-action="back">← MATCH SETUP</button></div><div class="player-tabs">${this.config.players.map((p, i) => `<button class="player-tab ${i === this.selectedPlayer ? 'selected' : ''}" data-action="player" data-value="${i}" style="--character:#${getCharacter(p.character).color.toString(16).padStart(6, '0')}"><small>${p.controller === 'bot' ? 'BOT' : 'PLAYER'} ${i + 1}</small><strong>${html(getCharacter(p.character).name)}</strong></button>`).join('')}</div><div class="character-options">${CHARACTERS.map(c => `<button class="character-card ${selected.character === c.id ? 'selected' : ''}" style="--character:#${c.color.toString(16).padStart(6, '0')}" data-action="character" data-value="${c.id}" aria-pressed="${selected.character === c.id}"><div class="character-number">0${CHARACTERS.indexOf(c) + 1} / ${selected.character === c.id ? 'SELECTED' : 'AVAILABLE'}</div>${portrait(c.id)}<div class="character-card-copy"><span>${html(c.role)}</span><h2>${html(c.name)}</h2><p>${html(c.description)}</p><div class="character-stat"><span>${c.hp} HP</span><span>${Math.round(c.speedScale * 100)}% SPEED</span></div></div></button>`).join('')}</div><div class="character-confirm"><div><span class="eyebrow">PLAYER ${this.selectedPlayer + 1} · ${html(character.name)}</span><p><strong>${html(character.special)}</strong> · Charge your special meter through combat. Use your special action to unleash it.</p></div><button class="primary-button" data-action="start">LET’S BREAK SOMETHING <span>→</span></button></div>`;
  }
  private controls(): string {
    const current = settings.get(), bindings = current.keyboard;
    const key = (player: number, action: keyof typeof bindings[0]): string => keyLabel(bindings[player][action]);
    const mouse = (button: number): string => ['Left mouse', 'Middle mouse', 'Right mouse', 'Mouse 4', 'Mouse 5'][button] ?? 'Off';
    const buttons = ['A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back', 'Start', 'Left stick click', 'Right stick click', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];
    const pad = (action: keyof typeof current.gamepad.buttons): string => buttons[current.gamepad.buttons[action]] ?? (current.gamepad.buttons[action] < 0 ? 'Off' : `Button ${current.gamepad.buttons[action]}`);
    const rows = [
      ['Move / climb', ['up', 'left', 'down', 'right'].map(a => key(0, a as 'up')).join(' / '), ['up', 'left', 'down', 'right'].map(a => key(1, a as 'up')).join(' / '), `Move axes ${current.gamepad.axes.moveX} / ${current.gamepad.axes.moveY}`],
      ['Aim', 'Mouse', 'Movement keys', `Aim axes ${current.gamepad.axes.aimX} / ${current.gamepad.axes.aimY}`],
      ...([['Jump', 'jump'], ['Melee', 'attack'], ['Fire', 'shoot'], ['Throw / cook', 'throw'], ['Special', 'special'], ['Roll', 'roll'], ['Block', 'block'], ['Pick up / grab / reload', 'interact'], ['Switch weapon', 'switch']] as const).map(([label, action]) => [label, key(0, action) + (action === 'attack' || action === 'shoot' ? ` / ${mouse(current.mouse[action])}` : ''), key(1, action), pad(action)]),
    ];
    return `<div class="screen-heading"><div><div class="eyebrow">A LITTLE KNOW-HOW GOES A LONG WAY</div><h1>LEARN THE ROPES.</h1></div><button class="text-button" data-action="back">← BACK</button></div><div class="controls-layout"><div class="table-scroll"><table class="controls-table"><thead><tr><th>ACTION</th><th>KEYBOARD + MOUSE</th><th>SECOND KEYBOARD</th><th>GAMEPAD</th></tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<${i ? 'td' : 'th'}>${html(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div><aside class="how-to"><div class="eyebrow">FIGHT SMART</div><h2>THE WORLD<br>FIGHTS BACK.</h2><p>Tap jump for a short hop. Hold it to climb higher. Press down in the air to fall faster.</p><p>Climb ropes and ladders with up/down. Jump or move away to detach. Catch ledges, then press up to pull yourself over.</p><p>Chain melee taps for a combo. Up + melee launches an uppercut; down + melee in the air delivers a divekick.</p><p>Grab a nearby rival with interact, then press melee to throw. Time a roll to avoid a hit.</p><p>Crack terrain, detonate barrels, and send rivals into hazards. A full special meter turns the fight.</p><small>ESC PAUSE · F1 HITBOXES · F2 BOT DEBUG</small></aside></div>`;
  }
  private pauseScreen(): string {
    return `<div class="pause-card"><div class="eyebrow">TAKE A BREATHER</div><h1>FIGHT PAUSED.</h1><p>The arena can wait a moment.</p><button class="primary-button" data-action="resume">BACK TO THE FIGHT <span>→</span></button><button class="secondary-button" data-action="rematch">RESTART MATCH</button><button class="secondary-button" data-action="controls">CONTROLS</button><button class="secondary-button" data-action="settings">SETTINGS</button>${this.canExportReplay ? '<button class="secondary-button" data-action="export-replay">SAVE REPLAY</button>' : ''}${this.testingEditor ? '<button class="secondary-button" data-action="back-editor">BACK TO EDITOR</button>' : ''}<button class="text-button" data-action="menu">RETURN TO MAIN MENU</button></div>`;
  }
  private resultsScreen(): string {
    const result = this.resultsData!;
    const winners = result.fighters.filter(f => result.winnerIds.includes(f.id));
    const mvp = result.fighters.find(f => f.id === result.mvpId);
    const title = winners.length === 1 ? `${winners[0].name} WINS.` : winners.length > 1 && this.config.settings.mode === 'team' ? 'TEAM VICTORY.' : 'WHAT A FIGHT.';
    return `<div class="results-heading"><div class="eyebrow">THE DUST HAS SETTLED · ${html(result.reason.replaceAll('-', ' '))}</div><h1>${html(title)}</h1><p>${html(this.matchArenaName || getArena(this.config.arena).name)} · ${Math.floor(result.elapsedTicks / 60 / 60)}:${String(Math.floor(result.elapsedTicks / 60) % 60).padStart(2, '0')} played</p></div>${mvp ? `<div class="mvp-banner"><span>★ MATCH MVP</span><strong>${html(mvp.name)}</strong><span>${mvp.kills} KNOCKOUTS · ${Math.round(mvp.damage)} DAMAGE · ${Math.round(mvp.accuracy)}% ACCURACY</span></div>` : ''}<div class="table-scroll"><table class="results-table"><thead><tr><th>FIGHTER</th><th>KO</th><th>FALLS</th><th>DAMAGE</th><th>ACCURACY</th><th>STOCKS</th></tr></thead><tbody>${[...result.fighters].sort((a, b) => Number(b.winner) - Number(a.winner) || b.kills - a.kills || b.damage - a.damage).map((f, i) => `<tr class="${f.winner ? 'winner' : ''}"><th><span>${String(i + 1).padStart(2, '0')}</span>${html(f.name)}${f.winner ? '<small>WINNER</small>' : ''}</th><td>${f.kills}</td><td>${f.deaths}</td><td>${Math.round(f.damage)}</td><td>${Math.round(f.accuracy)}<small>%</small></td><td>${f.stocks}</td></tr>`).join('')}</tbody></table></div><div class="results-actions">${this.testingEditor ? '<button class="secondary-button" data-action="back-editor">BACK TO EDITOR</button>' : ''}${this.canExportReplay ? '<button class="secondary-button" data-action="export-replay">SAVE REPLAY</button>' : ''}<button class="text-button" data-action="menu">← MAIN MENU</button><button class="secondary-button" data-action="setup">CHANGE MATCH</button><button class="primary-button" data-action="rematch">RUN IT BACK <span>↻</span></button></div>`;
  }
  private render(): void {
    this.root.dataset.screen = this.screen;
    const content = this.screen === 'title' ? this.title() : this.screen === 'menu' ? this.menu() : this.screen === 'setup' ? this.setup() : this.screen === 'characters' ? this.characters() : this.screen === 'controls' ? this.controls() : this.screen === 'pause' ? this.pauseScreen() : this.screen === 'results' ? this.resultsScreen() : '';
    this.root.innerHTML = content ? `<section class="screen screen-${this.screen}" aria-label="${this.screen}">${content}</section>` : '';
    this.root.querySelector<HTMLElement>('.primary-button')?.focus({ preventScroll: true });
  }
}
