import { describe, expect, it } from 'vitest';
import { COMBAT, GRENADE } from '../src/data/combat';
import { TUNING } from '../src/data/tuning';
import { World } from '../src/sim/World';
import { neutralInput, type ArenaData, type InputCommand } from '../src/sim/types';
import { WEAPONS } from '../src/sim/weapons/definitions';

function arena(): ArenaData {
  const width = 80, height = 40, tileSize = 20;
  const tiles = Array<number>(width * height).fill(0);
  for (let x = 0; x < width; x++) tiles[30 * width + x] = 1;
  return {
    id: 'combat-test', name: 'Combat test', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 100, y: 581 }, { x: 300, y: 581 }], props: [], weaponSpawns: [], background: '',
  };
}

function input(patch: Partial<InputCommand> = {}): InputCommand { return { ...neutralInput(), ...patch }; }
function advance(world: World, ticks: number, commands: Record<number, Partial<InputCommand>> = {}): void {
  for (let tick = 0; tick < ticks; tick++) {
    world.step(Object.fromEntries(Object.entries(commands).map(([id, command]) => [id, input(command)])));
  }
}

describe('combat simulation', () => {
  it('traces gunfire to the nearest enemy and consumes one cartridge', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    const nearest = world.addFighter({ x: 200 });
    const farthest = world.addFighter({ x: 300 });
    const initialAmmo = attacker.combat.ammo.pistol;

    advance(world, 1, { 0: { shoot: true } });

    expect(nearest.hp).toBeLessThan(nearest.maxHp);
    expect(farthest.hp).toBe(farthest.maxHp);
    expect(attacker.hp).toBe(attacker.maxHp);
    expect(attacker.combat.ammo.pistol).toBe(initialAmmo - 1);
    expect(world.events.some(event => event.type === 'shot')).toBe(true);
  });

  it('stops gunfire at terrain before an enemy', () => {
    const data = arena();
    for (let row = 20; row < 30; row++) data.tiles[row * data.width + 10] = 1;
    const world = new World(data);
    const attacker = world.addFighter();
    const target = world.addFighter();

    advance(world, 1, { 0: { shoot: true } });

    expect(target.hp).toBe(target.maxHp);
    expect(attacker.combat.ammo.pistol).toBe(WEAPONS.pistol.magazine - 1);
  });

  it('honors fire cooldown while the trigger stays held', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    const ammo = attacker.combat.ammo.pistol;
    advance(world, WEAPONS.pistol.cooldownTicks, { 0: { shoot: true } });
    expect(attacker.combat.ammo.pistol).toBe(ammo - 1);
    advance(world, 1, { 0: { shoot: true } });
    expect(attacker.combat.ammo.pistol).toBe(ammo - 2);
  });

  it('fires a shotgun spread with one shell and applies recoil', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    const target = world.addFighter({ x: 150, hp: 500, maxHp: 500 });
    attacker.combat.primary = 'shotgun';
    attacker.combat.equipped = 'primary';
    advance(world, 1, { 0: { shoot: true } });

    expect(attacker.combat.ammo.shotgun).toBe(WEAPONS.shotgun.magazine - 1);
    expect(world.events.filter(event => event.type === 'shot')).toHaveLength(WEAPONS.shotgun.pellets);
    expect(target.hp).toBe(target.maxHp - WEAPONS.shotgun.damage * WEAPONS.shotgun.pellets);
    expect(attacker.vx).toBeLessThan(0);
    const initialX = attacker.x;
    advance(world, 1);
    expect(attacker.x).toBeLessThan(initialX);
  });

  it('reloads an empty gun from finite reserve without creating ammunition', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    attacker.combat.ammo.pistol = 0;
    attacker.combat.reserve.pistol = 3;

    advance(world, 1, { 0: { shoot: true } });
    expect(attacker.combat.reloadTicks).toBeGreaterThan(0);
    expect(attacker.combat.ammo.pistol).toBe(0);
    advance(world, WEAPONS.pistol.reloadTicks + 1);
    expect(attacker.combat.ammo.pistol).toBe(3);
    expect(attacker.combat.reserve.pistol).toBe(0);
    expect(attacker.combat.reloadTicks).toBe(0);

    attacker.combat.ammo.pistol = 0;
    advance(world, WEAPONS.pistol.reloadTicks + 5, { 0: { shoot: true } });
    expect(attacker.combat.ammo.pistol).toBe(0);
    expect(attacker.combat.reserve.pistol).toBe(0);
  });

  it('clears the reload action when collecting a replacement weapon so rolling remains available', () => {
    const data = arena();
    data.weaponSpawns = [{ x: 100, y: 581 }];
    const world = new World(data);
    const fighter = world.addFighter();
    fighter.combat.ammo.pistol = 0;
    advance(world, 1, { 0: { shoot: true } });
    expect(fighter.combat.reloadTicks).toBeGreaterThan(0);
    expect(fighter.action).toBe('reload');

    advance(world, 1, { 0: { interact: true } });
    expect(fighter.combat.primary).toBe('shotgun');
    expect(fighter.combat.reloadTicks).toBe(0);
    expect(fighter.action).not.toBe('reload');
    advance(world, 1, { 0: { roll: true } });
    expect(fighter.action).toBe('roll');
  });

  it('uses a fresh fire press to attack with the equipped melee weapon', () => {
    const world = new World(arena());
    const fighter = world.addFighter();
    const target = world.addFighter({ x: 132, hp: 500, maxHp: 500 });
    advance(world, 1, { 0: { switchWeapon: 4 } });
    expect(fighter.combat.equipped).toBe('melee');
    advance(world, 25, { 0: { shoot: true } });
    const hpAfterSwing = target.hp;
    expect(hpAfterSwing).toBeLessThan(target.maxHp);
    target.x = 132; target.y = 581; target.vx = target.vy = 0;
    advance(world, 60, { 0: { shoot: true } });
    expect(target.hp).toBe(hpAfterSwing);

    target.x = 132; target.y = 581; target.vx = target.vy = 0;
    advance(world, 1);
    advance(world, 25, { 0: { shoot: true } });
    expect(target.hp).toBeLessThan(hpAfterSwing);
  });

  it('hits once per melee swing and requires releasing attack before a second swing', () => {
    const world = new World(arena());
    world.addFighter();
    const target = world.addFighter({ x: 132, hp: 500, maxHp: 500 });

    advance(world, 20, { 0: { attack: true } });
    const hpAfterSwing = target.hp;
    expect(hpAfterSwing).toBeLessThan(500);
    target.x = 132; target.y = 581; target.vx = target.vy = 0;
    advance(world, 70, { 0: { attack: true } });
    expect(target.hp).toBe(hpAfterSwing);

    target.x = 132; target.y = 581; target.vx = target.vy = 0;
    advance(world, 1);
    advance(world, 20, { 0: { attack: true } });
    expect(target.hp).toBeLessThan(hpAfterSwing);
  });

  it('keeps melee damage within its forward reach', () => {
    const world = new World(arena());
    world.addFighter({ x: 200 });
    const behind = world.addFighter({ x: 168 });
    const distant = world.addFighter({ x: 500 });
    advance(world, 30, { 0: { attack: true, aimX: 1 } });
    expect(behind.hp).toBe(behind.maxHp);
    expect(distant.hp).toBe(distant.maxHp);
  });

  it.each([1, 6])('keeps a melee swing from hitting through a still-solid material %i wall', material => {
    const data = arena();
    for (let row = 26; row < 30; row++) data.tiles[row * data.width + 6] = material;
    const world = new World(data);
    world.addFighter({ x: 107 });
    const target = world.addFighter({ x: 153 });
    advance(world, 25, { 0: { attack: true } });
    expect(world.terrain.isSolid(6, 29)).toBe(true);
    expect(target.hp).toBe(target.maxHp);
  });

  it('advances through the three-hit combo and resets after its input window expires', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    const target = world.addFighter({ x: 132, hp: 500, maxHp: 500 });
    let totalDamage = 0;
    for (const [index, name] of (['jab1', 'jab2', 'jab3'] as const).entries()) {
      // Reset the training target between swings to isolate combo sequencing from knockback range.
      Object.assign(target, { x: attacker.x + 32, y: 581, vx: 0, vy: 0, grounded: true });
      target.combat.stunTicks = 0;
      advance(world, 1, { 0: { attack: true } });
      expect(attacker.combat.pendingAttack).toBe(name);
      expect(attacker.combat.meleeStage).toBe(index + 1);
      const attack = COMBAT.attacks[name];
      advance(world, attack.windupTicks + attack.activeTicks + attack.recoveryTicks);
      totalDamage += attack.damage;
      expect(target.hp).toBe(target.maxHp - totalDamage);
    }
    advance(world, COMBAT.comboWindowTicks + 1);
    advance(world, 1, { 0: { attack: true } });
    expect(attacker.combat.pendingAttack).toBe('jab1');
    expect(attacker.combat.meleeStage).toBe(1);
  });

  it('selects an uppercut from up plus attack and launches the target', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    const target = world.addFighter({ x: 132 });
    advance(world, 1, { 0: { moveY: -1, attack: true } });
    expect(attacker.combat.pendingAttack).toBe('uppercut');
    advance(world, COMBAT.attacks.uppercut.windupTicks);
    expect(target.hp).toBe(target.maxHp - COMBAT.attacks.uppercut.damage);
    expect(target.vy).toBeLessThan(-500);
  });

  it('selects a divekick from down plus attack while airborne and hits below', () => {
    const world = new World(arena());
    const attacker = world.addFighter({ y: 500 });
    const target = world.addFighter({ x: 132 });
    advance(world, 1, { 0: { moveY: 1, attack: true } });
    expect(attacker.combat.pendingAttack).toBe('divekick');
    expect(attacker.vy).toBeGreaterThanOrEqual(600);
    advance(world, COMBAT.attacks.divekick.windupTicks + COMBAT.attacks.divekick.activeTicks);
    expect(target.hp).toBe(target.maxHp - COMBAT.attacks.divekick.damage);
  });

  it('preserves damage knockback through the next movement step', () => {
    const world = new World(arena());
    world.addFighter();
    const target = world.addFighter();
    const initialX = target.x, initialY = target.y;

    expect(world.damageFighter(target, 20, 0, 600, -Math.PI / 6, 'melee')).toBe(true);
    expect(target.vx).toBeGreaterThan(0);
    expect(target.vy).toBeLessThan(0);
    advance(world, 1);

    expect(target.x).toBeGreaterThan(initialX + 2);
    expect(target.y).toBeLessThan(initialY);
    expect(target.vx).toBeGreaterThan(0);
    expect(target.damage).toBeGreaterThan(0);
  });

  it('rejects damage during invulnerability and accepts it after the window ends', () => {
    const world = new World(arena());
    world.addFighter();
    const target = world.addFighter({ invulnerableTicks: 3 });

    expect(world.damageFighter(target, 20, 0)).toBe(false);
    expect(target.hp).toBe(target.maxHp);
    expect(target.vx).toBe(0);
    advance(world, 3);
    expect(world.damageFighter(target, 20, 0)).toBe(true);
    expect(target.hp).toBe(target.maxHp - 20);
  });

  it('makes the active roll window immune to weapon damage', () => {
    const world = new World(arena());
    world.addFighter();
    const target = world.addFighter();
    advance(world, 1, { 1: { roll: true, aimX: -1 } });
    expect(target.invulnerableTicks).toBeGreaterThan(0);
    advance(world, 1, { 0: { shoot: true } });
    expect(target.hp).toBe(target.maxHp);
    expect(world.damageFighter(target, 20, 0)).toBe(false);
  });

  it('grabs a nearby enemy and releases them with an attack throw', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    const target = world.addFighter({ x: 132 });

    advance(world, 1, { 0: { interact: true } });
    expect(attacker.combat.grabTarget).toBe(target.id);
    advance(world, 1, { 0: { attack: true } });

    expect(attacker.combat.grabTarget).toBe(null);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(target.vx).toBeGreaterThan(0);
    expect(target.combat.stunTicks).toBeGreaterThan(0);
  });

  it('blocks a melee strike from the front while bullets and rear strikes still connect', () => {
    const frontWorld = new World(arena());
    frontWorld.addFighter();
    const front = frontWorld.addFighter({ x: 135 });
    advance(frontWorld, 1, { 1: { block: true, aimX: -1 } });
    frontWorld.damageFighter(front, 30, 0, 250, 0, 'melee');
    expect(front.hp).toBeGreaterThan(front.maxHp - 30);

    const bulletWorld = new World(arena());
    bulletWorld.addFighter();
    const bulletTarget = bulletWorld.addFighter();
    advance(bulletWorld, 1, { 1: { block: true, aimX: -1 } });
    advance(bulletWorld, 1, { 0: { shoot: true }, 1: { block: true, aimX: -1 } });
    expect(bulletTarget.hp).toBe(bulletTarget.maxHp - WEAPONS.pistol.damage);

    const rearWorld = new World(arena());
    rearWorld.addFighter({ x: 180 });
    const rear = rearWorld.addFighter({ x: 135 });
    advance(rearWorld, 1, { 1: { block: true, aimX: -1 } });
    rearWorld.damageFighter(rear, 30, 0, 250, 0, 'melee');
    expect(rear.hp).toBe(rear.maxHp - 30);
  });

  it('breaks a depleted guard and stuns the defender', () => {
    const world = new World(arena());
    world.addFighter();
    const target = world.addFighter({ x: 135 });
    advance(world, 1, { 1: { block: true, aimX: -1 } });
    const strike = () => world.damageFighter(target, 20, 0, 250, 0, 'melee');
    expect(strike()).toBe(false);
    expect(strike()).toBe(false);
    expect(target.hp).toBe(target.maxHp);
    expect(strike()).toBe(true);
    expect(target.combat.blockMeter).toBe(0);
    expect(target.combat.stunTicks).toBeGreaterThanOrEqual(COMBAT.guardBreakTicks);
    expect(target.action).toBe('stunned');
    expect(target.hp).toBe(target.maxHp - 20);
    expect(world.events.some(event => event.type === 'guard-break')).toBe(true);
  });

  it('equips a weapon pickup, respawns it and requires a new interaction to collect it again', () => {
    const data = arena();
    data.weaponSpawns = [{ x: 100, y: 581 }];
    const world = new World(data);
    const fighter = world.addFighter();
    advance(world, 1, { 0: { interact: true } });
    expect(fighter.combat.primary).toBe('shotgun');
    expect(fighter.combat.equipped).toBe('primary');
    expect(fighter.combat.ammo.shotgun).toBe(WEAPONS.shotgun.magazine);
    expect(world.pickups[0].active).toBe(false);
    fighter.combat.ammo.shotgun = 0;

    advance(world, COMBAT.pickupRespawnTicks, { 0: { interact: true } });
    expect(world.pickups[0].active).toBe(true);
    expect(fighter.combat.ammo.shotgun).toBe(0);
    advance(world, 1);
    advance(world, 1, { 0: { interact: true } });
    expect(world.pickups[0].active).toBe(false);
    expect(fighter.combat.ammo.shotgun).toBe(WEAPONS.shotgun.magazine);
  });

  it('deducts grenade cooking time from the thrown grenade fuse', () => {
    const world = new World(arena());
    const fighter = world.addFighter();
    const initialCount = fighter.combat.throwableCount;
    advance(world, 45, { 0: { throw: true, aimX: 1, aimY: -0.4 } });
    expect(world.projectiles.filter(projectile => projectile.active)).toHaveLength(0);
    expect(fighter.combat.cookTicks).toBeGreaterThan(0);
    const cookedTicks = fighter.combat.cookTicks;
    advance(world, 1);

    const grenade = world.projectiles.find(projectile => projectile.active);
    expect(grenade).toBeDefined();
    expect(fighter.combat.throwableCount).toBe(initialCount - 1);
    expect(grenade!.life).toBeLessThanOrEqual(GRENADE.fuseTicks - cookedTicks);
    expect(grenade!.life).toBeGreaterThan(0);
    let exploded = false;
    for (let tick = 0; tick < GRENADE.fuseTicks; tick++) {
      advance(world, 1);
      exploded ||= world.events.some(event => event.type === 'explosion');
    }
    expect(exploded).toBe(true);
    expect(grenade!.active).toBe(false);
  });

  it('detonates an overcooked grenade in the holder’s hand without throwing extras', () => {
    const world = new World(arena());
    const fighter = world.addFighter();
    const initialCount = fighter.combat.throwableCount;
    let exploded = false;
    for (let tick = 0; tick < GRENADE.fuseTicks + 60; tick++) {
      advance(world, 1, { 0: { throw: true } });
      exploded ||= world.events.some(event => event.type === 'explosion');
    }
    expect(exploded).toBe(true);
    expect(fighter.hp).toBeLessThan(fighter.maxHp);
    expect(fighter.combat.throwableCount).toBe(initialCount - 1);
    advance(world, 1);
    expect(world.projectiles.filter(projectile => projectile.active)).toHaveLength(0);
    expect(fighter.combat.throwableCount).toBe(initialCount - 1);
  });

  it('applies an explosion only inside its radius, respecting invulnerability', () => {
    const world = new World(arena());
    const near = world.addFighter({ x: 100 });
    const outside = world.addFighter({ x: 500 });
    const invulnerable = world.addFighter({ x: 110, invulnerableTicks: 10 });
    world.explode(100, 581, 135, 60);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(outside.hp).toBe(outside.maxHp);
    expect(invulnerable.hp).toBe(invulnerable.maxHp);
  });

  it('knocks out a fighter once, credits the attacker and restores health on respawn', () => {
    const world = new World(arena());
    const attacker = world.addFighter();
    const target = world.addFighter();
    const initialStocks = target.stocks;

    expect(world.damageFighter(target, 200, attacker.id)).toBe(true);
    expect(target.alive).toBe(false);
    expect(target.action).toBe('dead');
    expect(target.stocks).toBe(initialStocks - 1);
    expect(target.combat.deaths).toBe(1);
    expect(attacker.combat.kills).toBe(1);
    expect(world.damageFighter(target, 200, attacker.id)).toBe(false);
    expect(target.combat.deaths).toBe(1);
    expect(attacker.combat.kills).toBe(1);

    advance(world, TUNING.fighter.respawnTicks);
    expect(target.alive).toBe(true);
    expect(target.hp).toBe(target.maxHp);
    expect(target.damage).toBe(0);
    expect(target.invulnerableTicks).toBeGreaterThan(0);
    expect(target.combat.deaths).toBe(1);
    expect(attacker.combat.kills).toBe(1);
  });

  it('replays mixed combat commands with identical state, projectiles and events', () => {
    const first = new World(arena(), 144), second = new World(arena(), 144);
    for (const world of [first, second]) {
      world.addFighter({ hp: 500, maxHp: 500 });
      world.addFighter({ x: 260, hp: 500, maxHp: 500 });
    }
    for (let tick = 0; tick < 480; tick++) {
      const commands = {
        0: input({ moveX: Math.sin(tick * 0.06), shoot: tick % 7 < 3, attack: tick % 43 === 0, throw: tick % 150 < 50, jump: tick % 90 < 12, switchWeapon: tick % 120 === 0 ? 1 : 0 }),
        1: input({ moveX: -Math.sin(tick * 0.07), aimX: -1, shoot: tick % 11 < 2, attack: tick % 37 === 0, block: tick % 60 < 15, roll: tick % 73 === 0 }),
      };
      first.step(commands); second.step(commands);
      expect(first.fighters).toEqual(second.fighters);
      expect(first.projectiles).toEqual(second.projectiles);
      expect(first.pickups).toEqual(second.pickups);
      expect(first.hitboxes).toEqual(second.hitboxes);
      expect(first.events).toEqual(second.events);
    }
    expect(first.rng.state).toBe(second.rng.state);
    expect(first.tick).toBe(480);
  });
});
