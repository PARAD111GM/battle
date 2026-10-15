import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { TUNING } from '../src/data/tuning';
import { World } from '../src/sim/World';
import { createMatchSettings } from '../src/sim/match/types';
import { neutralInput, type ArenaData } from '../src/sim/types';

function arena(): ArenaData {
  const width = 60, height = 40, tileSize = 20;
  const tiles = Array<number>(width * height).fill(0);
  for (let col = 0; col < width; col++) tiles[30 * width + col] = 6;
  return { id: 'match-test', name: 'Match test', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 100, y: 581 }, { x: 400, y: 581 }], props: [], weaponSpawns: [], background: '' };
}

function advance(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) world.step({});
}

describe('match rules and results', () => {
  it('ends deathmatch at the score limit and freezes the complete simulation', () => {
    const world = new World(arena(), 7, { scoreLimit: 2 });
    const winner = world.addFighter();
    const victim = world.addFighter();
    winner.combat.kills = 1;
    world.knockout(victim, winner.id);
    world.step({});
    expect(world.match).toEqual({ elapsedTicks: 1, ended: true, winnerIds: [winner.id], reason: 'score-limit' });
    const frozen = JSON.stringify({ fighters: world.fighters, projectiles: world.projectiles, debris: world.debris, tick: world.tick, match: world.match });
    world.step({ [winner.id]: { ...neutralInput(), moveX: 1, shoot: true } });
    expect(JSON.stringify({ fighters: world.fighters, projectiles: world.projectiles, debris: world.debris, tick: world.tick, match: world.match })).toBe(frozen);
  });

  it('uses combined team kills and awards every fighter on the winning team', () => {
    const world = new World(arena(), 7, { mode: 'team', scoreLimit: 3 });
    const first = world.addFighter({ team: 4 });
    const second = world.addFighter({ team: 4 });
    const enemy = world.addFighter({ team: 9 });
    first.combat.kills = 1;
    second.combat.kills = 1;
    world.knockout(enemy, second.id);
    world.step({});
    expect(world.match.ended).toBe(true);
    expect(world.match.winnerIds).toEqual([first.id, second.id]);
    expect(world.results().fighters.filter(row => row.winner).map(row => row.id).sort()).toEqual([first.id, second.id]);
  });

  it('does not reward a team kill even when friendly fire is enabled', () => {
    const world = new World(arena(), 7, { mode: 'team', scoreLimit: 1, friendlyFire: true });
    const attacker = world.addFighter({ team: 2 });
    const ally = world.addFighter({ team: 2 });
    world.addFighter({ team: 3 });
    world.damageFighter(ally, 1000, attacker.id);
    world.step({});
    expect(ally.combat.deaths).toBe(1);
    expect(attacker.combat.kills).toBe(0);
    expect(world.match.ended).toBe(false);
  });

  it.each(['deathmatch', 'team'] as const)('ends %s exactly at the time limit and preserves ties', mode => {
    const world = new World(arena(), 7, { mode, timeLimit: 1, scoreLimit: 0 });
    world.addFighter({ team: 0 });
    world.addFighter({ team: 1 });
    advance(world, TUNING.tickRate - 1);
    expect(world.match.ended).toBe(false);
    world.step({});
    expect(world.match).toEqual({ elapsedTicks: 60, ended: true, winnerIds: [0, 1], reason: 'time-limit' });
  });

  it('chooses the deathmatch score leader when time runs out', () => {
    const world = new World(arena(), 7, { timeLimit: 1 / 60, scoreLimit: 0 });
    world.addFighter().combat.kills = 2;
    world.addFighter().combat.kills = 3;
    world.step({});
    expect(world.match.winnerIds).toEqual([1]);
  });

  it('eliminates a fighter at zero stocks and ends only when one remains', () => {
    const world = new World(arena(), 7, { mode: 'stocks', stocks: 1 });
    const first = world.addFighter();
    const second = world.addFighter();
    const third = world.addFighter();
    world.knockout(first, second.id);
    advance(world, TUNING.fighter.respawnTicks + 1);
    expect(first.stocks).toBe(0);
    expect(first.alive).toBe(false);
    expect(world.match.ended).toBe(false);
    world.knockout(second, third.id);
    world.step({});
    expect(world.match.winnerIds).toEqual([third.id]);
    expect(world.match.reason).toBe('last-standing');
  });

  it('does not prematurely end a single-fighter stocks practice session', () => {
    const world = new World(arena(), 7, { mode: 'stocks', timeLimit: 0 });
    world.addFighter();
    advance(world, 5);
    expect(world.match.ended).toBe(false);
  });

  it('resolves stocks timeouts by remaining stocks and shares equal scores', () => {
    const world = new World(arena(), 7, { mode: 'stocks', timeLimit: 1 / 60 });
    world.addFighter({ stocks: 2 });
    world.addFighter({ stocks: 3 });
    world.addFighter({ stocks: 3 });
    world.step({});
    expect(world.match.winnerIds).toEqual([1, 2]);
    expect(world.match.reason).toBe('time-limit');
  });

  it('keeps respawning at zero stocks outside stocks mode and preserves earned stats', () => {
    const world = new World(arena(), 7, { mode: 'deathmatch', stocks: 1, scoreLimit: 0 });
    const fighter = world.addFighter();
    fighter.combat.kills = 4; fighter.combat.damageDealt = 123; fighter.combat.shots = 10; fighter.combat.hits = 3;
    world.knockout(fighter);
    advance(world, TUNING.fighter.respawnTicks);
    expect(fighter.alive).toBe(true);
    expect(fighter.stocks).toBe(0);
    expect(world.results().fighters[0]).toMatchObject({ kills: 4, deaths: 1, damage: 123, shots: 10, hits: 3, accuracy: 30 });
  });

  it('keeps health in percentage mode, scales knockback and permits ringout knockouts', () => {
    const world = new World(arena(), 7, { damageMode: 'percent', scoreLimit: 0 });
    const attacker = world.addFighter();
    const target = world.addFighter();
    world.damageFighter(target, 200, attacker.id, 250, 0, 'bullet');
    expect(target.hp).toBe(target.maxHp);
    expect(target.alive).toBe(true);
    expect(target.damage).toBe(200);
    expect(target.vx).toBeGreaterThan(250);
    target.x = -400;
    world.step({});
    expect(target.alive).toBe(false);
    expect(attacker.combat.kills).toBe(1);
  });

  it('honors friendly-fire protection only for allies in team mode', () => {
    const team = new World(arena(), 7, { mode: 'team', friendlyFire: false });
    const attacker = team.addFighter({ team: 1 });
    const ally = team.addFighter({ team: 1 });
    const enemy = team.addFighter({ team: 2 });
    expect(team.damageFighter(ally, 25, attacker.id)).toBe(false);
    expect(ally.hp).toBe(ally.maxHp);
    expect(team.damageFighter(enemy, 25, attacker.id)).toBe(true);
    const freeForAll = new World(arena(), 7, { friendlyFire: false });
    freeForAll.addFighter({ team: 1 });
    const opponent = freeForAll.addFighter({ team: 1 });
    expect(freeForAll.damageFighter(opponent, 25, 0)).toBe(true);
  });

  it.each([{ x: -300 }, { x: 1600 }, { y: -400 }, { y: 1100 }])('recognizes an arena ringout at %j', position => {
    const world = new World(arena());
    const fighter = world.addFighter(position);
    world.step({});
    expect(fighter.alive).toBe(false);
    expect(world.events.some(event => event.type === 'ringout')).toBe(true);
  });

  it('returns stable ranked results and a damage tie-break MVP with bounded accuracy', () => {
    const world = new World(arena());
    const first = world.addFighter();
    const second = world.addFighter();
    first.combat.kills = second.combat.kills = 2;
    first.combat.damageDealt = 100; second.combat.damageDealt = 250;
    second.combat.shots = 2; second.combat.hits = 8;
    const results = world.results();
    expect(results.mvpId).toBe(second.id);
    expect(results.fighters[0].accuracy).toBe(100);
    expect(results.fighters[1].accuracy).toBe(0);
    results.winnerIds.push(99);
    expect(world.match.winnerIds).toEqual([]);
  });

  it('applies explicit character tuning while retaining generic test defaults', () => {
    const world = new World(arena());
    const generic = world.addFighter();
    expect(generic.hp).toBe(100);
    expect(generic.speedScale).toBe(1);
    for (const character of CHARACTERS) {
      const fighter = world.addFighter({ character: character.id });
      expect(fighter.hp).toBe(character.hp);
      expect(fighter.maxHp).toBe(character.hp);
      expect(fighter.speedScale).toBe(character.speedScale);
      expect(fighter.special).toBe(character.special);
    }
  });

  it('caps matches at eight unique fighter ids', () => {
    const world = new World(arena());
    for (let i = 0; i < 8; i++) world.addFighter();
    expect(() => world.addFighter()).toThrow('8 fighters');
    const other = new World(arena());
    other.addFighter({ id: 4 });
    expect(() => other.addFighter({ id: 4 })).toThrow('already exists');
  });

  it('copies settings and sanitizes timer, stock and score values', () => {
    const weapons = ['pistol', 'pistol'];
    const settings = createMatchSettings({ stocks: -3, scoreLimit: -1, timeLimit: Number.NaN, weaponSet: 'custom', customWeapons: weapons });
    weapons.push('smg');
    expect(settings.stocks).toBe(1);
    expect(settings.scoreLimit).toBe(0);
    expect(settings.timeLimit).toBe(300);
    expect(settings.customWeapons).toEqual(['pistol']);
  });

  it('respects seeded arena spawn weights and the selected weapon filter', () => {
    const data = arena();
    data.weaponSpawns = [{ x: 100, y: 581 }, { x: 200, y: 581 }];
    data.spawnTable = [{ weapon: 'pistol', weight: 1 }, { weapon: 'smg', weight: 4 }, { weapon: 'missing', weight: 500 }];
    const first = new World(data, 81), second = new World(data, 81);
    expect(first.pickups).toEqual(second.pickups);
    const filtered = new World(data, 81, { weaponSet: 'custom', customWeapons: ['pistol'] });
    expect(filtered.pickups.map(pickup => pickup.weapon)).toEqual(['pistol', 'pistol']);
    const rolls = Array.from({ length: 300 }, () => first.spawnWeapon());
    expect(rolls.filter(id => id === 'smg').length).toBeGreaterThan(rolls.filter(id => id === 'pistol').length * 2);
    expect(rolls).not.toContain('missing');
  });
});
