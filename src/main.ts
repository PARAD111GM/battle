import Phaser from 'phaser';
import { World } from './sim/World';
import { getArena, registerArena } from './data/arenas';
import { getCharacter } from './data/characters';
import { ArenaScene } from './render/ArenaScene';
import { InputManager } from './input/InputManager';
import { neutralInput, type InputCommand } from './sim/types';
import { Hud } from './ui/Hud';
import { Menu, defaultConfig, html, type MatchConfig } from './ui/Menu';
import { ArenaEditor } from './ui/Editor';
import { SettingsPanel } from './ui/Settings';
import { settings, keyLabel } from './input/settings';
import { AudioEngine } from './audio/AudioEngine';
import { createRecorder, createPlayback, decodeReplay, REPLAY_LIMITS, type ReplayRecorder, type ReplayPlayback, type ReplayData } from './sim/replay';
import type { ArenaData } from './sim/types';
import './ui/styles.css';

const query = new URLSearchParams(location.search);
const localLab = query.has('lab');
let activeConfig = defaultConfig();
let world = new World(getArena(), 713);
let playing = false;
let started = false;
let lastControllerNotice = '';
let recorder: ReplayRecorder | undefined;
let playback: ReplayPlayback | undefined;
let settingsPanel: SettingsPanel | undefined;
let settingsReturn: 'pause' | 'menu' | 'controls' = 'menu';
const audio = new AudioEngine(settings.get().audio);
function unlockAudio(): void { if (navigator.userActivation?.isActive) void audio.unlock(); }
for (const gesture of ['pointerdown', 'keydown']) document.addEventListener(gesture, event => { if (event.isTrusted) unlockAudio(); }, { capture: true });
const input = new InputManager(document.getElementById('game')!);
const hud = new Hud(document.getElementById('hud')!);
const announcer = document.getElementById('announcer')!;
const phase = document.getElementById('phase-label')!;
const scene: ArenaScene = new ArenaScene(world, () => {
  const commands: Record<number, InputCommand> = {};
  const pads = input.connectedGamepads();
  let disconnected = false;
  for (let index = 0; index < world.fighters.length; index++) {
    const fighter = world.fighters[index], player = activeConfig.players[index];
    if (!player || player.controller === 'bot') continue;
    let command: InputCommand;
    if (player.controller.startsWith('gamepad')) {
      const selected = Number(player.controller.slice(7)), pad = pads.includes(selected) ? selected : undefined;
      command = pad === undefined ? neutralInput() : input.gamepad(pad);
      disconnected ||= pad === undefined;
    } else if (player.controller === 'keyboard2') {
      command = localLab && pads.length ? input.gamepad(pads[0]) : input.keyboard(1);
    } else {
      command = input.keyboard();
      if (scene.cameras?.main && input.mouse.active) {
        const point = scene.cameras.main.getWorldPoint(input.mouse.x, input.mouse.y);
        const dx = point.x - fighter.x, dy = point.y - fighter.y, length = Math.hypot(dx, dy) || 1;
        command.aimX = dx / length; command.aimY = dy / length;
      }
    }
    commands[fighter.id] = command;
  }
  const notice = disconnected ? 'CONNECT GAMEPAD · PRESS A BUTTON' : '';
  if (notice !== lastControllerNotice) { document.getElementById('controller-notice')!.textContent = notice; lastControllerNotice = notice; }
  return commands;
});
scene.paused = true;
const menu = new Menu(document.getElementById('overlay')!, {
  start: config => startMatch(config, menu.testingEditor),
  rematch: () => playback ? playReplay(playback.data) : startMatch(menu.config, menu.testingEditor),
  resume: () => { input.reset(); scene.paused = false; audio.pause(false); (document.activeElement as HTMLElement)?.blur(); },
  mainMenu: () => returnToMenu(),
  settings: () => showSettings(), editor: () => openEditor(),
  importReplay: () => importReplay(), exportReplay: () => exportReplay(),
  backToEditor: () => openEditor(),
});
const editor = new ArenaEditor(document.getElementById('overlay')!, { back: () => { returnToMenu(); menu.show('menu'); }, test: arena => testArena(arena) });
function createWorld(config: MatchConfig): World {
  const next = new World(getArena(config.arena), config.seed ?? 713, config.settings);
  for (const [index, player] of config.players.entries()) {
    const character = getCharacter(player.character);
    next.addFighter({ name: player.name || character.name.toUpperCase(), character: character.id,
      color: [0xffb74d, 0x68e2df, 0xff6b69, 0xa99bff, 0x90d276, 0xf08dbe, 0x79afff, 0xf2e67b][index], controller: player.controller === 'bot' ? 'bot' : 'human',
      difficulty: player.difficulty, team: config.settings.mode === 'team' ? player.team : index,
      ...(localLab && index === 1 ? { x: 550, y: 872, facing: -1 } : {}),
    });
  }
  return next;
}
function startMatch(config?: Partial<MatchConfig>, testingEditor = false): void {
  recorder?.stop(); playback = undefined; scene.stepWorld = undefined;
  settingsPanel?.destroy(); settingsPanel = undefined; editor.hide();
  menu.testingEditor = testingEditor; menu.replaying = false; menu.canExportReplay = true;
  audio.reset(); audio.pause(false); unlockAudio();
  const defaults = defaultConfig();
  activeConfig = { ...defaults, ...config, settings: { ...defaults.settings, ...config?.settings }, players: (config?.players ?? defaults.players).slice(0, Math.min(8, getArena(config?.arena ?? defaults.arena).spawns.length)) };
  while (activeConfig.players.length < 2) activeConfig.players.push(defaults.players[activeConfig.players.length]);
  menu.config = JSON.parse(JSON.stringify(activeConfig)) as MatchConfig;
  world = createWorld(activeConfig); scene.world = world;
  recorder = createRecorder(world); menu.matchArenaName = world.arena.name;
  input.reset(); hud.reset(); announcer.textContent = ''; lastControllerNotice = '';
  document.getElementById('controller-notice')!.textContent = '';
  document.getElementById('hud')!.hidden = false;
  phase.textContent = `${world.fighters.filter(f => f.controller === 'human').length} LOCAL / ${world.fighters.filter(f => f.controller === 'bot').length} BOTS`;
  menu.hide(); playing = true; scene.paused = false;
  (document.activeElement as HTMLElement)?.blur();
  if (started) scene.scene.restart();
  hud.update(world, true);
}
function returnToMenu(): void {
  settingsPanel?.destroy(); settingsPanel = undefined; editor.hide(); recorder?.stop();
  menu.testingEditor = false; menu.replaying = false; playback = undefined; scene.stepWorld = undefined; audio.pause(true);
  playing = false; scene.paused = true; input.reset(); announcer.textContent = '';
  document.getElementById('hud')!.hidden = true;
  document.getElementById('controller-notice')!.textContent = '';
  phase.textContent = 'LOCAL MULTIPLAYER';
}
function togglePause(): void {
  if (menu.screen === 'settings') return;
  if (menu.screen === 'editor') { returnToMenu(); menu.show('menu'); return; }
  if (!playing) { menu.back(); return; }
  if (menu.screen === 'match') { scene.paused = true; input.reset(); announcer.textContent = ''; audio.pause(true); menu.pause(); }
  else menu.back();
}
scene.onTick = () => {
  if (!playing) return;
  for (const event of world.events) { hud.event(event, world); audio.event(event, world); }
  audio.update(world);
  hud.update(world);
  if (world.match.ended || playback?.finished) {
    playing = false; scene.paused = true; input.reset(); announcer.textContent = '';
    document.getElementById('hud')!.hidden = true; phase.textContent = 'MATCH COMPLETE';
    audio.pause(true); recorder?.stop();
    menu.results(world.results());
    if (playback && !world.match.ended) menu.notice(`Replay complete: ${playback.position} recorded ticks. This recording ended before the match finished.`);
  }
};
function showSettings(): void {
  const fromControls = menu.screen === 'controls';
  settingsReturn = fromControls ? 'controls' : playing ? 'pause' : 'menu'; scene.paused = true; input.reset(); audio.pause(true);
  menu.external('settings');
  settingsPanel?.destroy();
  settingsPanel = new SettingsPanel(document.getElementById('overlay')!, () => { settingsPanel?.destroy(); settingsPanel = undefined; menu.show(settingsReturn); input.reset(); }, fromControls);
  settingsPanel.show();
}
function openEditor(): void {
  returnToMenu(); menu.external('editor'); phase.textContent = 'ARENA WORKSHOP'; editor.show();
}
function testArena(arena: ArenaData): void {
  const registered = registerArena(arena), config = defaultConfig(); config.arena = registered.id; config.players = config.players.slice(0, registered.spawns.length);
  startMatch(config, true); phase.textContent = 'EDITOR PLAYTEST';
}
function exportReplay(): void {
  try {
    const json = playback ? JSON.stringify(playback.data) : recorder?.toJSON();
    if (!json) { menu.notice('Play a match before saving a replay.'); return; }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `rivetfall-${world.arena.id}-replay.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    menu.notice(`Replay saved · ${playback?.data.durationTicks ?? recorder?.durationTicks ?? 0} ticks${recorder?.truncated ? ' · recording reached its limit' : ''}.`);
  } catch (error) { menu.notice(error instanceof Error ? error.message : 'Replay could not be saved.'); }
}
function importReplay(): void {
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json';
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; if (!selected) return;
    try {
      if (selected.size > REPLAY_LIMITS.maxBytes) throw new Error('Replay files must be smaller than 16 MiB.');
      const data = decodeReplay(await selected.text());
      if (data.durationTicks === 0) throw new Error('This replay has no recorded ticks.');
      playReplay(data);
    } catch (error) { menu.notice(error instanceof Error ? error.message : 'This replay could not be loaded.'); }
  });
  file.click();
}
function playReplay(data: ReplayData): void {
  const next = createPlayback(data); recorder?.stop(); settingsPanel?.destroy(); settingsPanel = undefined; editor.hide();
  playback = next; world = playback.world; scene.world = world; menu.matchArenaName = world.arena.name;
  activeConfig = { arena: world.arena.id, seed: data.seed, settings: world.settings, players: world.fighters.map((fighter, index) => ({ name: fighter.name, character: fighter.character, controller: fighter.controller === 'bot' ? 'bot' : index ? 'keyboard2' : 'keyboard', difficulty: fighter.difficulty, team: fighter.team })) };
  menu.config = activeConfig; menu.testingEditor = false; menu.replaying = true; menu.canExportReplay = true;
  scene.stepWorld = () => { playback?.step(); }; input.reset(); hud.reset(); audio.reset(); audio.pause(false); unlockAudio();
  playing = true; scene.paused = false; menu.hide(); announcer.textContent = '';
  document.getElementById('hud')!.hidden = false; document.getElementById('controller-notice')!.textContent = '';
  phase.textContent = 'REPLAY PLAYBACK'; (document.activeElement as HTMLElement)?.blur();
  if (started) scene.scene.restart(); hud.update(world, true);
}
function applyPreferences(): void {
  const current = settings.get(), key = current.keyboard[0]; audio.setVolumes(current.audio);
  document.querySelector('footer span')!.innerHTML = `<b>${html(keyLabel(key.left))} ${html(keyLabel(key.right))}</b> MOVE <b>${html(keyLabel(key.jump))}</b> JUMP <b>${html(keyLabel(key.attack))}</b> MELEE <b>${html(keyLabel(key.shoot))}</b> FIRE <b>${html(keyLabel(key.throw))}</b> THROW <b>${html(keyLabel(key.special))}</b> SPECIAL`;
}
settings.subscribe(applyPreferences); applyPreferences();
document.addEventListener('click', event => { if (event.isTrusted && (event.target as Element).closest('button')) audio.click(); });
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: '#111923', pixelArt: true, antialias: false,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }, scene: [scene], audio: { noAudio: true },
  callbacks: { postBoot: () => { started = true; } },
});
document.getElementById('menu-button')!.addEventListener('click', () => {
  if (playing) togglePause(); else { returnToMenu(); menu.show('menu'); }
});
document.getElementById('home-button')!.addEventListener('click', () => { returnToMenu(); menu.show('menu'); });
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && !event.repeat && menu.screen !== 'settings') { event.preventDefault(); togglePause(); }
});
window.addEventListener('blur', () => { if (playing && menu.screen === 'match') togglePause(); });
if (localLab) {
  const config = defaultConfig(); config.players = config.players.slice(0, 2); config.players[1].controller = 'keyboard2';
  config.settings = { ...config.settings, timeLimit: 0, scoreLimit: 0 }; startMatch(config);
} else if (query.has('quick')) startMatch();
else { world = createWorld(activeConfig); scene.world = world; returnToMenu(); menu.show('title'); }
Object.assign(window, { __RIVETFALL__: { get world() { return world; }, scene, input, game, menu, startMatch, editor, audio, settings, openEditor, testArena, playReplay,
  get recorder() { return recorder; }, get playback() { return playback; },
  get config() { return activeConfig; }, showMenu: () => { returnToMenu(); menu.show('menu'); },
} });
