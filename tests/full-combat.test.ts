import { describe, expect, it } from 'vitest';
import { SPECIALS, THROWABLES } from '../src/data/combat';
import { World } from '../src/sim/World';
import { neutralInput, type ArenaData, type InputCommand } from '../src/sim/types';
import { WEAPONS } from '../src/sim/weapons/definitions';
import { blocksVision } from '../src/sim/weapons/firearms';

function arena(): ArenaData {
  const width = 80, height = 40, tileSize = 20;
  const tiles = Array<number>(width * height).fill(0);
  for (let x = 0; x < width; x++) tiles[30 * width + x] = 6;
  return { id: 'full-combat', name: 'Test', subtitle: '', width, height, tileSize, tiles, spawns: [{ x: 100, y: 581 }, { x: 300, y: 581 }], props: [], weaponSpawns: [], background: '' };
}
const input = (patch: Partial<InputCommand> = {}): InputCommand => ({ ...neutralInput(), ...patch });
function advance(world: World, ticks: number, commands: Record<number, Partial<InputCommand>> = {}): void {
  for (let tick = 0; tick < ticks; tick++) world.step(Object.fromEntries(Object.entries(commands).map(([id, command]) => [id, input(command)])));
}

describe('full weapon and special content', () => {
  it('counts a shotgun volley once for accuracy even when several pellets hit', () => {
    const world = new World(arena(), 4);
    const shooter = world.addFighter(), target = world.addFighter({ x: 135, hp: 500, maxHp: 500 });
    shooter.combat.primary = 'shotgun'; shooter.combat.equipped = 'primary';
    advance(world, 1, { 0: { shoot: true } });
    expect(500 - target.hp).toBeGreaterThan(WEAPONS.shotgun.damage);
    expect(shooter.combat.hits).toBe(1);
    advance(world, WEAPONS.shotgun.cooldownTicks);
    advance(world, 1, { 0: { shoot: true, aimX: -1 } });
    expect(shooter.combat.shots).toBe(2);
    expect(world.results().fighters.find(fighter => fighter.id === shooter.id)?.accuracy).toBe(50);
  });

  it('reuses consumed transient pickups across repeated weapon throws', () => {
    const world = new World(arena());
    const fighter = world.addFighter();
    fighter.combat.ammo.pistol = 2;
    for (let cycle = 0; cycle < 6; cycle++) {
      fighter.combat.equipped = 'sidearm';
      advance(world, 1, { 0: { interact: true, throw: true } });
      const thrown = world.projectiles.find(item => item.active && item.kind === 'weapon')!;
      expect(thrown).toBeDefined(); thrown.life = 1;
      advance(world, 19);
      const pickup = world.pickups.find(item => item.active)!;
      fighter.x = pickup.x; fighter.y = pickup.y;
      advance(world, 1, { 0: { interact: true } });
      expect(fighter.combat.sidearm).toBe('pistol');
      expect(fighter.combat.ammo.pistol).toBe(2);
      expect(world.pickups).toHaveLength(1);
      advance(world, 1);
    }
  });

  it.each(['pistol', 'smg', 'shotgun', 'assault', 'sniper', 'grenade-launcher'])('%s fires its configured weapon family and deals damage', id => {
    const world = new World(arena(), 4);
    const shooter = world.addFighter(), target = world.addFighter({ hp: 500, maxHp: 500 });
    const slot = WEAPONS[id].slot as 'primary' | 'sidearm';
    shooter.combat[slot] = id; shooter.combat.equipped = slot;
    advance(world, 1, { 0: { shoot: true } });
    expect(shooter.combat.ammo[id]).toBe(WEAPONS[id].magazine - 1);
    if (WEAPONS[id].fireMode === 'projectile') {
      expect(world.projectiles.some(projectile => projectile.active && projectile.weapon === id)).toBe(true);
      advance(world, 35);
    }
    expect(target.hp).toBeLessThan(500);
    if (WEAPONS[id].fireMode === 'projectile') expect(shooter.combat.hits).toBe(1);
  });

  it.each(['knife', 'bat', 'machete', 'sledge'])('%s has real damage phases and breaks when its durability is exhausted', id => {
    const world = new World(arena());
    const attacker = world.addFighter(), target = world.addFighter({ x: 132, hp: 500, maxHp: 500 });
    attacker.combat.melee = id; attacker.combat.durability[id] = 1;
    advance(world, 1, { 0: { attack: true } });
    expect(attacker.action).toBe('melee-windup');
    expect(target.hp).toBe(500);
    advance(world, WEAPONS[id].attack!.windupTicks + 3);
    expect(target.hp).toBeLessThan(500);
    expect(attacker.combat.durability[id]).toBe(0);
    expect(attacker.combat.melee).toBe('unarmed');
  });

  it('allows an opt-in assault ricochet to reflect from metal with reduced damage', () => {
    const data = arena();
    for (let row = 20; row < 30; row++) data.tiles[row * data.width + 15] = 4;
    const world = new World(data, 10);
    const shooter = world.addFighter({ x: 200 }), target = world.addFighter({ x: 100 });
    shooter.combat.primary = 'assault'; shooter.combat.equipped = 'primary';
    advance(world, 1, { 0: { shoot: true } });
    expect(world.events.filter(event => event.type === 'shot')).toHaveLength(2);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(target.maxHp - target.hp).toBeLessThan(WEAPONS.assault.damage);
  });

  it.each(['grenade', 'molotov', 'flashbang', 'smoke'])('%s cooks, launches, and applies its distinct detonation effect', id => {
    const world = new World(arena());
    const thrower = world.addFighter(), target = world.addFighter({ hp: 500, maxHp: 500 });
    thrower.combat.throwable = id;
    advance(world, 20, { 0: { throw: true } });
    advance(world, 1);
    const projectile = world.projectiles.find(item => item.active && item.weapon === id)!;
    expect(projectile).toBeDefined();
    expect(projectile.life).toBeLessThan(THROWABLES[id].fuseTicks);
    expect(thrower.combat.throwableCount).toBe(2);
    projectile.x = target.x; projectile.y = target.y; projectile.life = 1;
    advance(world, 1);
    if (id === 'grenade') expect(target.hp).toBeLessThan(500);
    if (id === 'molotov') expect(world.fire.cells.size).toBeGreaterThan(0);
    if (id === 'flashbang') { expect(target.combat.flashTicks).toBeGreaterThan(0); expect(target.hp).toBe(500); }
    if (id === 'smoke') {
      expect(world.effects.some(effect => effect.kind === 'smoke')).toBe(true);
      expect(blocksVision(world, 100, 574, 400, 574)).toBe(true);
      expect(target.hp).toBe(500);
    }
  });

  it('sticks a mine to terrain, arms it, and detonates when an enemy approaches', () => {
    const world = new World(arena());
    const owner = world.addFighter(), target = world.addFighter({ x: 1200, hp: 500, maxHp: 500 });
    owner.combat.throwable = 'sticky-mine';
    advance(world, 1, { 0: { throw: true, aimX: 0, aimY: 1 } });
    advance(world, 1, { 0: { aimX: 0, aimY: 1 } });
    advance(world, 35);
    const mine = world.projectiles.find(projectile => projectile.active && projectile.weapon === 'sticky-mine')!;
    expect(mine.stuck).toBe(true);
    expect(mine.armedTicks).toBe(0);
    target.x = mine.x + 25; target.y = mine.y;
    advance(world, 1);
    expect(mine.active).toBe(false);
    expect(target.hp).toBeLessThan(500);
  });

  it('throws the held weapon and preserves its finite ammunition when picked up again', () => {
    const world = new World(arena());
    const fighter = world.addFighter();
    fighter.combat.ammo.pistol = 2; fighter.combat.reserve.pistol = 7;
    advance(world, 1, { 0: { interact: true, throw: true } });
    expect(fighter.combat.sidearm).toBe('');
    const thrown = world.projectiles.find(item => item.kind === 'weapon')!;
    expect(thrown.weapon).toBe('pistol');
    thrown.life = 1;
    advance(world, 1);
    const pickup = world.pickups.find(item => item.weapon === 'pistol')!;
    advance(world, 18);
    fighter.x = pickup.x; fighter.y = pickup.y;
    advance(world, 1, { 0: { interact: true } });
    expect(fighter.combat.sidearm).toBe('pistol');
    expect(fighter.combat.ammo.pistol).toBe(2);
    expect(fighter.combat.reserve.pistol).toBe(7);
  });

  it('collects health, finite ammo, melee equipment and bounded throwable stacks', () => {
    const world = new World(arena());
    const fighter = world.addFighter({ hp: 30 });
    fighter.combat.reserve.pistol = 0;
    for (const [id, weapon] of ['health', 'ammo', 'machete', 'smoke', 'smoke', 'smoke'].entries()) {
      world.pickups.push({ id, weapon, kind: 'loot', x: fighter.x, y: fighter.y, active: true, respawnTicks: -1 });
      advance(world, 1); advance(world, 1, { 0: { interact: true } });
    }
    expect(fighter.hp).toBeGreaterThan(30);
    expect(fighter.combat.reserve.pistol).toBeGreaterThan(0);
    expect(fighter.combat.melee).toBe('machete');
    expect(fighter.combat.throwable).toBe('smoke');
    expect(fighter.combat.throwableCount).toBe(6);
  });

  it('spends a full meter on a leap and crash, releasing the shockwave only upon landing', () => {
    const world = new World(arena());
    const caster = world.addFighter({ special: 'slam' }), target = world.addFighter({ x: 180, hp: 500, maxHp: 500 });
    caster.combat.specialMeter = 100;
    advance(world, 1, { 0: { special: true } });
    expect(caster.combat.specialMeter).toBe(0);
    expect(target.hp).toBe(500);
    expect(caster.vy).toBeLessThan(0);
    advance(world, SPECIALS.slamWindupTicks);
    expect(caster.grounded).toBe(false);
    expect(caster.vy).toBeGreaterThan(0);
    expect(target.hp).toBe(500);
    for (let tick = 0; tick < 60 && target.hp === 500; tick++) advance(world, 1);
    expect(target.hp).toBeLessThan(500);
    expect(caster.hp).toBe(caster.maxHp);
  });

  it('bullet time slows nearby opponents and expires', () => {
    const world = new World(arena());
    const caster = world.addFighter({ special: 'bullet-time' }), target = world.addFighter({ x: 200 });
    caster.combat.specialMeter = 100;
    advance(world, 1, { 0: { special: true } });
    const beforeDash = caster.x;
    advance(world, 25, { 1: { moveX: 1 } });
    expect(caster.x - beforeDash).toBeGreaterThan(130);
    expect(target.combat.slowTicks).toBeGreaterThan(0);
    expect(target.x - 200).toBeLessThan(70);
    advance(world, SPECIALS.slowTicks + 4);
    expect(world.effects.some(effect => effect.kind === 'slow')).toBe(false);
    expect(target.combat.slowTicks).toBe(0);
  });

  it('an airborne slam waits for ground contact instead of bursting in midair', () => {
    const world = new World(arena());
    const caster = world.addFighter({ special: 'slam', y: 180 }), target = world.addFighter({ x: 180, hp: 500, maxHp: 500 });
    caster.combat.specialMeter = 100;
    advance(world, 1, { 0: { special: true } }); advance(world, 20);
    expect(caster.grounded).toBe(false); expect(target.hp).toBe(500);
    for (let tick = 0; tick < 80 && target.hp === 500; tick++) advance(world, 1);
    expect(target.hp).toBeLessThan(500);
  });

  it('does not grab or stun an ally when team friendly fire is disabled', () => {
    const world = new World(arena(), 3, { mode: 'team', friendlyFire: false });
    const caster = world.addFighter({ team: 1 }), ally = world.addFighter({ x: 125, team: 1 });
    advance(world, 1, { 0: { interact: true } });
    expect(caster.combat.grabTarget).toBe(null); expect(ally.combat.stunTicks).toBe(0);
  });

  it('a health pickup reduces accumulated knockback percent in percent mode', () => {
    const world = new World(arena(), 5, { damageMode: 'percent' });
    const fighter = world.addFighter({ damage: 95 });
    world.pickups.push({ id: 0, kind: 'health', weapon: 'health', x: fighter.x, y: fighter.y, active: true, respawnTicks: -1 });
    advance(world, 1, { 0: { interact: true } });
    expect(fighter.damage).toBe(50); expect(fighter.hp).toBe(fighter.maxHp);
  });

  it('bullet time removes gun spread during its focus window', () => {
    const world = new World(arena(), 7);
    const caster = world.addFighter({ special: 'bullet-time' });
    caster.combat.primary = 'smg'; caster.combat.equipped = 'primary'; caster.combat.specialMeter = 100;
    advance(world, 1, { 0: { special: true } }); advance(world, SPECIALS.dashTicks + 1);
    advance(world, 1, { 0: { shoot: true, aimX: 1, aimY: 0 } });
    const shot = world.events.find(event => event.type === 'shot')!;
    expect(shot).toBeDefined(); expect(shot.endY).toBe(shot.y);
  });

  it('marks an air strike before its damaging explosions arrive', () => {
    const world = new World(arena());
    const caster = world.addFighter({ special: 'air-strike' }), target = world.addFighter({ x: 380, hp: 500, maxHp: 500 });
    caster.combat.specialMeter = 100;
    advance(world, 1, { 0: { special: true } });
    expect(world.effects.filter(effect => effect.kind === 'air-strike')).toHaveLength(3);
    expect(target.hp).toBe(500);
    advance(world, SPECIALS.airStrikeDelay + 25);
    expect(target.hp).toBeLessThan(500);
    expect(world.effects.filter(effect => effect.kind === 'air-strike')).toHaveLength(0);
  });

  it('a shield wall absorbs incoming gunfire and loses shield durability', () => {
    const world = new World(arena());
    const protectedFighter = world.addFighter({ special: 'shield-wall' });
    world.addFighter({ x: 300 });
    protectedFighter.combat.specialMeter = 100;
    advance(world, 1, { 0: { special: true } });
    advance(world, 1, { 1: { shoot: true, aimX: -1 } });
    expect(world.barriers[0].active).toBe(true);
    expect(world.barriers[0].hp).toBeLessThan(SPECIALS.shieldHp);
    expect(protectedFighter.hp).toBe(protectedFighter.maxHp);
  });

  it('uses character speed scales while keeping the same movement inputs', () => {
    const slow = new World(arena()), fast = new World(arena());
    const a = slow.addFighter({ speedScale: 0.8 }), b = fast.addFighter({ speedScale: 1.25 });
    advance(slow, 40, { 0: { moveX: 1 } }); advance(fast, 40, { 0: { moveX: 1 } });
    expect(b.x - 100).toBeGreaterThan((a.x - 100) * 1.3);
  });
});
