import Phaser from 'phaser';
import { World } from './sim/World';
import { getArena } from './data/arenas';
import { getCharacter } from './data/characters';
import { ArenaScene } from './render/ArenaScene';
import { InputManager } from './input/InputManager';
import { neutralInput, type InputCommand } from './sim/types';
import { Hud } from './ui/Hud';
import { Menu, defaultConfig, type MatchConfig } from './ui/Menu';
import './ui/styles.css';

const query = new URLSearchParams(location.search);
const localLab = query.has('lab');
let activeConfig = defaultConfig();
let world = new World(getArena(), 713);
let playing = false;
let started = false;
let lastControllerNotice = '';
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
  start: config => startMatch(config),
  resume: () => { input.reset(); scene.paused = false; (document.activeElement as HTMLElement)?.blur(); },
  mainMenu: () => returnToMenu(),
});
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
function startMatch(config?: Partial<MatchConfig>): void {
  const defaults = defaultConfig();
  activeConfig = { ...defaults, ...config, settings: { ...defaults.settings, ...config?.settings }, players: (config?.players ?? defaults.players).slice(0, 8) };
  while (activeConfig.players.length < 2) activeConfig.players.push(defaults.players[activeConfig.players.length]);
  menu.config = JSON.parse(JSON.stringify(activeConfig)) as MatchConfig;
  world = createWorld(activeConfig); scene.world = world;
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
  playing = false; scene.paused = true; input.reset(); announcer.textContent = '';
  document.getElementById('hud')!.hidden = true;
  document.getElementById('controller-notice')!.textContent = '';
  phase.textContent = 'LOCAL MULTIPLAYER';
}
function togglePause(): void {
  if (!playing) { menu.back(); return; }
  if (menu.screen === 'match') { scene.paused = true; input.reset(); announcer.textContent = ''; menu.pause(); }
  else menu.back();
}
scene.onTick = () => {
  if (!playing) return;
  for (const event of world.events) hud.event(event, world);
  hud.update(world);
  if (world.match.ended) {
    playing = false; scene.paused = true; input.reset(); announcer.textContent = '';
    document.getElementById('hud')!.hidden = true; phase.textContent = 'MATCH COMPLETE';
    menu.results(world.results());
  }
};
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: '#111923', pixelArt: true, antialias: false,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }, scene: [scene], audio: { noAudio: true },
  callbacks: { postBoot: () => { started = true; } },
});
document.getElementById('menu-button')!.addEventListener('click', () => {
  if (playing) togglePause(); else { returnToMenu(); menu.show('menu'); }
});
document.getElementById('home-button')!.addEventListener('click', () => { returnToMenu(); menu.show('menu'); });
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && !event.repeat) { event.preventDefault(); togglePause(); }
});
window.addEventListener('blur', () => { if (playing && menu.screen === 'match') togglePause(); });
if (localLab) {
  const config = defaultConfig(); config.players = config.players.slice(0, 2); config.players[1].controller = 'keyboard2';
  config.settings = { ...config.settings, timeLimit: 0, scoreLimit: 0 }; startMatch(config);
} else if (query.has('quick')) startMatch();
else { world = createWorld(activeConfig); scene.world = world; returnToMenu(); menu.show('title'); }
Object.assign(window, { __RIVETFALL__: { get world() { return world; }, scene, input, game, menu, startMatch,
  get config() { return activeConfig; }, showMenu: () => { returnToMenu(); menu.show('menu'); },
} });
