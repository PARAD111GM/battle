import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/data/arenas';
import { BOT_DIFFICULTIES, type BotDifficultyName } from '../src/data/ai';
import { TUNING } from '../src/data/tuning';
import { World } from '../src/sim/World';
import { neutralInput, type ArenaData, type Fighter, type InputCommand } from '../src/sim/types';
import { WEAPONS } from '../src/sim/weapons/definitions';

function floor(): ArenaData {
  const width = 80, height = 36, tileSize = 20;
  const tiles = Array<number>(width * height).fill(0);
  for (let col = 0; col < width; col++) tiles[30 * width + col] = 6;
  return { id: 'ai-full', name: 'AI test', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 100, y: 581 }, { x: 400, y: 581 }], props: [], weaponSpawns: [], background: '' };
}

function duel(difficulty: BotDifficultyName = 'normal', distance = 300, team = false) {
  const world = new World(floor(), 81, { mode: team ? 'team' : 'deathmatch', timeLimit: 0, scoreLimit: 0 });
  const bot = world.addFighter({ controller: 'bot', difficulty, team: 0, hp: 100, maxHp: 100 });
  const enemy = world.addFighter({ x: bot.x + distance, team: 1, hp: 1000, maxHp: 1000 });
  const controller = world.bots.get(bot.id)!;
  return { world, bot, enemy, controller };
}

/** Advance perception without advancing physics so each difficulty sees the same observations. */
function commandAt(world: World, bot: Fighter, tick: number): InputCommand {
  world.tick = tick;
  return world.bots.get(bot.id)!.command(world, bot);
}
function warm(world: World, bot: Fighter, ticks = 24): InputCommand {
  let result = neutralInput();
  for (let tick = 0; tick <= ticks; tick++) result = commandAt(world, bot, tick);
  return result;
}

describe('four difficulty levels and fair perception', () => {
  it('preserves Normal tuning and changes actual reaction, aim, and tactical response by difficulty', () => {
    expect(BOT_DIFFICULTIES.normal.reactionTicks).toBe(TUNING.ai.reactionTicks);
    expect(BOT_DIFFICULTIES.normal.aimError).toBe(TUNING.ai.aimError);
    expect(BOT_DIFFICULTIES.normal.replanTicks).toBe(TUNING.ai.replanTicks);
    const measured = Object.keys(BOT_DIFFICULTIES).map(name => {
      const { world, bot, controller } = duel(name as BotDifficultyName);
      let firstShot = -1, firstAim = 0;
      for (let tick = 0; tick < 30; tick++) {
        const command = commandAt(world, bot, tick);
        if (command.shoot && firstShot < 0) { firstShot = tick; firstAim = Math.abs(Math.atan2(command.aimY, command.aimX)); }
      }
      const decision = duel(name as BotDifficultyName);
      commandAt(decision.world, decision.bot, 0);
      decision.bot.hp = 40;
      decision.world.pickups.push({ id: 99, kind: 'health', weapon: '', x: 60, y: 581, active: true, respawnTicks: 0 });
      let healthTick = -1;
      for (let tick = 1; tick < 30; tick++) {
        commandAt(decision.world, decision.bot, tick);
        if (decision.controller.debug.goal === 'seek health' && healthTick < 0) healthTick = tick;
      }
      expect(controller.debug.targetId).toBe(1);
      return { firstShot, firstAim, healthTick };
    });
    expect(measured.map(item => item.firstShot)).toEqual([21, 9, 6, 4]);
    expect(measured.map(item => item.healthTick)).toEqual([24, 9, 6, 4]);
    for (let index = 1; index < measured.length; index++) expect(measured[index].firstAim).toBeLessThan(measured[index - 1].firstAim);
  });

  it('changes actual defensive roll frequency and Easy blocking probability', () => {
    const totals = Object.keys(BOT_DIFFICULTIES).map(name => {
      const { world, bot, enemy } = duel(name as BotDifficultyName, 50);
      let rolls = 0, blocks = 0;
      for (let tick = 0; tick < 1200; tick++) {
        enemy.action = tick < 600 ? 'shoot' : 'melee-windup';
        const command = commandAt(world, bot, tick);
        rolls += Number(command.roll); blocks += Number(command.block);
      }
      return { rolls, blocks };
    });
    for (let index = 1; index < totals.length; index++) expect(totals[index].rolls).toBeGreaterThan(totals[index - 1].rolls);
    expect(totals[1].blocks).toBeGreaterThan(totals[0].blocks * 1.5);
  });

  it('never selects teammates and holds fire when a teammate crosses the firing line', () => {
    const { world, bot, enemy, controller } = duel('expert', 400, true);
    const ally = world.addFighter({ x: 300, y: 581, team: 0 });
    const command = warm(world, bot);
    expect(controller.debug.targetId).toBe(enemy.id);
    expect(command.shoot).toBe(false);
    ally.y = 400;
    expect(commandAt(world, bot, 25).shoot).toBe(true);
    enemy.alive = false;
    for (let tick = 26; tick < 60; tick++) expect(commandAt(world, bot, tick).shoot).toBe(false);
    expect(controller.debug.targetId).toBe(null);
  });

  it('treats all other fighters as opponents in a free-for-all even if team numbers match', () => {
    const { world, bot, enemy, controller } = duel();
    enemy.team = bot.team;
    expect(warm(world, bot).shoot).toBe(true);
    expect(controller.debug.targetId).toBe(enemy.id);
  });

  it('respects smoke occlusion and blindness, then reacquires after visibility returns', () => {
    const { world, bot, enemy, controller } = duel('expert');
    world.effects.push({ id: 1, kind: 'smoke', x: 250, y: 560, radius: 90, life: 420, owner: enemy.id });
    expect(warm(world, bot).shoot).toBe(false);
    expect(controller.debug.targetId).toBe(null);
    world.effects.length = 0;
    expect(commandAt(world, bot, 28).shoot).toBe(true);
    bot.combat.flashTicks = 90;
    const blind = commandAt(world, bot, 29);
    expect(blind.shoot || blind.attack || blind.special || blind.throw).toBe(false);
    expect(blind.aimX).toBe(bot.facing);
    expect(blind.aimY).toBe(0);
    bot.combat.flashTicks = 0;
    expect(commandAt(world, bot, 32).shoot).toBe(true);
  });
});

describe('tactical utility and the full arsenal', () => {
  it('seeks a health pickup before engaging when wounded', () => {
    const { world, bot, controller } = duel();
    bot.hp = 25;
    world.pickups.push({ id: 99, kind: 'health', weapon: '', x: 40, y: 581, active: true, respawnTicks: 0 });
    const command = warm(world, bot);
    expect(controller.debug.goal).toBe('seek health');
    expect(command.moveX).toBeLessThan(0);
  });

  it('retreats away from an observed opponent when health is critical and no medkit is available', () => {
    const { world, bot, enemy, controller } = duel();
    bot.x = 600; enemy.x = 900; bot.hp = 20;
    expect(warm(world, bot).moveX).toBeLessThan(0);
    expect(controller.debug.goal).toBe('retreat to cover');
  });

  it.each(['grenade', 'sticky-mine', 'molotov'])('moves away from a visible %s hazard', weapon => {
    const { world, bot, controller } = duel();
    world.projectiles.push({ id: 1, active: true, kind: 'grenade', weapon, owner: 1, x: 150, y: 581, vx: 0, vy: 0, radius: 6,
      life: weapon === 'grenade' ? 35 : 600, damage: 60, blastRadius: 135 });
    const command = commandAt(world, bot, 0);
    expect(command.moveX).toBeLessThan(0);
    expect(command.roll).toBe(true);
    expect(controller.debug.goal).toContain(weapon === 'sticky-mine' ? 'mine' : 'blast');
  });

  it('moves and jumps away from burning ground', () => {
    const { world, bot, controller } = duel();
    world.fire.cells.set('7,29', { col: 7, row: 29, x: 145, y: 590, age: 0, life: 240, owner: 1 });
    const command = commandAt(world, bot, 0);
    expect(command.moveX).toBeLessThan(0);
    expect(command.jump).toBe(true);
    expect(controller.debug.goal).toBe('avoid fire');
  });

  it('throws over cover only after a real sighting and uses a charged special', () => {
    const { world, bot } = duel('normal', 200);
    expect(warm(world, bot).shoot).toBe(true);
    for (let row = 0; row < 30; row++) world.terrain.tiles[row * world.arena.width + 10] = 6;
    const grenade = commandAt(world, bot, 25);
    expect(grenade.throw).toBe(true);
    expect(grenade.aimY).toBeLessThan(-0.3);
    expect(grenade.shoot).toBe(false);
    const special = duel('expert', 100);
    special.bot.special = 'slam'; special.bot.combat.specialMeter = 100;
    expect(warm(special.world, special.bot).special).toBe(true);
  });

  it.each(Object.entries(WEAPONS).filter(([, weapon]) => weapon.kind === 'gun').map(([id]) => id))('uses %s and switches when it is exhausted', id => {
    const { world, bot } = duel('expert');
    bot.combat.primary = id; bot.combat.equipped = 'primary';
    expect(warm(world, bot).shoot).toBe(true);
    bot.combat.ammo[id] = bot.combat.reserve[id] = 0;
    if (id === 'pistol') { bot.combat.sidearm = 'smg'; bot.combat.ammo.smg = 10; }
    expect(commandAt(world, bot, 26).switchWeapon).toBe(3);
  });

  it('leads observed target motion and compensates projectile gravity', () => {
    const { world, bot, enemy } = duel('expert');
    bot.combat.primary = 'grenade-launcher'; bot.combat.equipped = 'primary'; enemy.vx = 200; enemy.vy = -100;
    const command = warm(world, bot);
    expect(command.shoot).toBe(true);
    expect(command.aimY).toBeLessThan(-0.15);
    expect(Math.hypot(command.aimX, command.aimY)).toBeCloseTo(1);
  });

  it.each(['knife', 'bat', 'machete', 'sledge'])('uses the %s melee weapon at close range', id => {
    const { world, bot } = duel('expert', 35);
    bot.combat.melee = id; bot.combat.equipped = 'melee';
    warm(world, bot, 16);
    const command = commandAt(world, bot, 17);
    expect(command.attack).toBe(true);
    expect(command.shoot).toBe(false);
  });
});

describe('navigation progress and recovery', () => {
  it('finishes an Expert jump before replanning onto an upper Warehouse ledge', () => {
    const world = new World(ARENAS.find(arena => arena.id === 'warehouse')!, 817, { timeLimit: 0, scoreLimit: 0 });
    const bot = world.addFighter({ x: 2352, y: 872, controller: 'bot', difficulty: 'expert' });
    let reachedCatwalk = false, collected = false;
    for (let tick = 0; tick < 600; tick++) {
      world.step({});
      reachedCatwalk ||= bot.grounded && bot.y < 750;
      collected ||= world.events.some(event => event.type === 'pickup' && event.fighterId === bot.id);
    }
    expect(reachedCatwalk).toBe(true);
    expect(collected).toBe(true);
    expect(bot.combat.deaths).toBe(0);
  });

  it('resets perception on respawn even when World skips calling a dead controller', () => {
    const { world, bot, controller } = duel('normal');
    warm(world, bot);
    expect(controller.debug.targetId).toBe(1);
    world.knockout(bot);
    bot.respawnTicks = 1;
    world.step({});
    expect(bot.alive).toBe(true);
    const command = controller.command(world, bot);
    expect(command.shoot || command.throw).toBe(false);
    expect(controller.debug.targetId).toBe(null);
  });

  it('recognizes repeated pacing inside a small crater as stalled route progress', () => {
    const world = new World(floor(), 81);
    world.pickups.push({ id: 0, kind: 'weapon', weapon: 'smg', x: 700, y: 581, active: true, respawnTicks: 0 });
    const bot = world.addFighter({ controller: 'bot', x: 400, y: 581, grounded: true });
    const controller = world.bots.get(bot.id)!;
    let recovered = -1;
    for (let tick = 0; tick < 300; tick++) {
      // Model an 80px confined patrol: each turn moves, but the bot never leaves the pocket.
      bot.x = 400 + (tick % 60 < 30 ? 40 : -40);
      commandAt(world, bot, tick);
      if (controller.debug.goal === 'recover blocked route') { recovered = tick; break; }
    }
    expect(recovered).toBeGreaterThan(TUNING.ai.hardRecoveryTicks);
    expect(recovered).toBeLessThan(300);
    expect([360, 440]).toContain(bot.x);
  });

  it('repairs and backs away before ten seconds without movement and never teleports', () => {
    const world = new World(floor(), 81);
    world.pickups.push({ id: 0, kind: 'weapon', weapon: 'smg', x: 500, y: 581, active: true, respawnTicks: 0 });
    const bot = world.addFighter({ controller: 'bot' });
    const controller = world.bots.get(bot.id)!;
    const start = { x: bot.x, y: bot.y }, revision = world.navigation!.revision;
    let recovered = -1, recovery = neutralInput();
    for (let tick = 0; tick <= 650; tick++) {
      const command = commandAt(world, bot, tick);
      if (controller.debug.goal === 'recover blocked route') { recovered = tick; recovery = command; break; }
    }
    expect(recovered).toBeGreaterThan(TUNING.ai.hardRecoveryTicks);
    expect(recovered).toBeLessThan(TUNING.ai.hardRecoveryTicks + 50);
    expect(world.navigation!.revision).toBeGreaterThan(revision);
    expect(recovery.moveX).toBeLessThan(0);
    expect(recovery.jump).toBe(true);
    expect({ x: bot.x, y: bot.y }).toEqual(start);
    for (let tick = 0; tick < 30; tick++) world.step({});
    expect(Math.hypot(bot.x - start.x, bot.y - start.y)).toBeGreaterThan(30);
  });

  it.each(ARENAS)('patrols authored $name routes and makes physical progress', arena => {
    const world = new World(arena, 817, { timeLimit: 0, scoreLimit: 0 });
    const bot = world.addFighter({ controller: 'bot', difficulty: 'normal' });
    const start = { x: bot.x, y: bot.y };
    const sections = new Set<string>();
    let greatestDistance = 0, pickups = 0;
    for (let tick = 0; tick < 1800; tick++) {
      world.step({});
      sections.add(`${Math.floor(bot.x / 120)},${Math.floor(bot.y / 120)}`);
      greatestDistance = Math.max(greatestDistance, Math.hypot(bot.x - start.x, bot.y - start.y));
      pickups += world.events.filter(event => event.type === 'pickup' && event.fighterId === bot.id).length;
      expect(Number.isFinite(bot.x + bot.y)).toBe(true);
      expect(world.bots.get(bot.id)!.debug.stuckTicks).toBeLessThan(650);
    }
    expect(greatestDistance).toBeGreaterThan(240);
    expect(sections.size).toBeGreaterThan(4);
    expect(pickups).toBeGreaterThan(0);
  }, 15000);
});
