import { TUNING } from '../data/tuning';
import { COMBAT } from '../data/combat';
import { hasGroundSupport } from './physics/aabb';
import { SeededRandom } from './random';
import { stepMovement } from './systems/movement';
import { resolveMelee, stepCombat } from './systems/combat';
import { applyDamage } from './systems/damage';
import { createCombatState } from './weapons/definitions';
import { stepProjectiles } from './weapons/firearms';
import type { Hitbox, Pickup, Projectile } from './weapons/types';
import { TileMap } from './terrain/TileMap';
import { neutralInput, type ArenaData, type Fighter, type InputCommand, type SimEvent } from './types';

/** Headless fixed-step simulation; the same commands and seed produce the same state. */
export class World {
  readonly terrain: TileMap;
  readonly fighters: Fighter[] = [];
  readonly rng: SeededRandom;
  readonly projectiles: Projectile[] = [];
  readonly pickups: Pickup[] = [];
  hitboxes: Hitbox[] = [];
  tick = 0;
  events: SimEvent[] = [];

  constructor(public readonly arena: ArenaData, seed = 12345) {
    this.terrain = new TileMap(arena);
    this.rng = new SeededRandom(seed);
    this.pickups = arena.weaponSpawns.map((spawn, index) => ({ id: index, x: spawn.x, y: spawn.y, kind: 'weapon', weapon: ['shotgun', 'smg', 'pistol'][index % 3], active: true, respawnTicks: 0 }));
  }

  addFighter(options: Partial<Fighter> = {}): Fighter {
    const id = options.id ?? this.fighters.reduce((next, fighter) => Math.max(next, fighter.id + 1), 0);
    if (this.fighters.some(fighter => fighter.id === id)) throw new Error(`Fighter id ${id} already exists`);
    const spawn = this.arena.spawns[this.fighters.length % this.arena.spawns.length] ?? { x: this.arena.width * this.arena.tileSize / 2, y: 50 };
    const fighter: Fighter = {
      id, name: `Fighter ${id + 1}`, character: 'rivet', team: id,
      color: id % 2 === 0 ? TUNING.colors.amber : TUNING.colors.cyan,
      controller: 'human', difficulty: 'normal',
      x: spawn.x, y: spawn.y, vx: 0, vy: 0,
      width: TUNING.fighter.width, height: TUNING.fighter.height, facing: id % 2 === 0 ? 1 : -1,
      hp: TUNING.fighter.hp, maxHp: TUNING.fighter.hp, damage: 0, stocks: 3, alive: true,
      grounded: false, coyoteTicks: 0, jumpBufferTicks: 0, jumpHeld: false, rollHeld: false,
      action: 'idle', actionTicks: 0, rollCooldown: 0, invulnerableTicks: 0,
      respawnTicks: 0, climbing: false, climbCooldownTicks: 0, ledge: null,
      combat: createCombatState(),
      ...options,
    };
    fighter.grounded = hasGroundSupport(fighter, this.terrain);
    this.fighters.push(fighter);
    return fighter;
  }

  step(commands: Record<number, InputCommand>): void {
    this.events = [];
    this.hitboxes = [];
    this.tick++;
    for (const fighter of this.fighters) {
      if (!fighter.alive) {
        fighter.respawnTicks = Math.max(0, fighter.respawnTicks - 1);
        if (fighter.respawnTicks === 0) this.respawn(fighter);
        continue;
      }
      stepMovement(fighter, commands[fighter.id] ?? neutralInput(), this.terrain, this.arena.props, this.events);
      if (fighter.y - fighter.height / 2 > this.arena.height * this.arena.tileSize + 160) {
        const owner = this.tick - fighter.combat.lastHitTick <= COMBAT.killCreditTicks ? fighter.combat.lastHitBy : -1;
        this.knockout(fighter, owner, 'ringout');
      }
    }
    for (const fighter of this.fighters) if (fighter.alive) stepCombat(this, fighter, commands[fighter.id] ?? neutralInput());
    resolveMelee(this);
    stepProjectiles(this);
  }

  damageFighter(target: Fighter, amount: number, owner: number, knockback = 250, angle = 0, kind = 'melee'): boolean {
    return applyDamage(this, target, amount, owner, knockback, angle, kind);
  }

  explode(x: number, y: number, radius: number, damage: number, owner = -1): void {
    this.events.push({ type: 'explosion', x, y, amount: radius, intensity: Math.min(1, radius / 135), weapon: 'grenade' });
    for (const fighter of this.fighters) {
      const distance = Math.hypot(fighter.x - x, fighter.y - y);
      if (distance > radius || !fighter.alive) continue;
      const angle = distance < 1 ? -Math.PI / 2 : Math.atan2(fighter.y - y, fighter.x - x);
      this.damageFighter(fighter, Math.round(damage * (1 - distance / radius * 0.65)), owner, 580, angle, 'explosion');
    }
  }

  knockout(fighter: Fighter, owner = -1, kind = 'knockout'): void {
    if (!fighter.alive) return;
    fighter.alive = false; fighter.hp = 0; fighter.stocks = Math.max(0, fighter.stocks - 1);
    fighter.action = 'dead'; fighter.respawnTicks = TUNING.fighter.respawnTicks;
    fighter.vx = fighter.vy = 0; fighter.climbing = false; fighter.ledge = null;
    fighter.combat.deaths++;
    fighter.combat.cookTicks = 0; fighter.combat.grabTarget = null;
    const killer = this.fighters.find(other => other.id === owner && other !== fighter);
    if (killer) killer.combat.kills++;
    this.events.push({ type: kind, fighterId: fighter.id, x: fighter.x, y: fighter.y, color: fighter.color, text: killer ? `${killer.name} knocked out ${fighter.name}` : `${fighter.name} fell out` });
  }

  private respawn(fighter: Fighter): void {
    const index = this.fighters.indexOf(fighter);
    const spawn = this.arena.spawns[index % this.arena.spawns.length] ?? { x: this.arena.width * this.arena.tileSize / 2, y: 50 };
    const { kills, deaths, damageDealt, shots, hits } = fighter.combat;
    Object.assign(fighter, {
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, hp: fighter.maxHp, damage: 0, alive: true,
      action: 'idle', actionTicks: 0, grounded: false, climbing: false, ledge: null,
      coyoteTicks: 0, jumpBufferTicks: 0, jumpHeld: false, rollHeld: false,
      climbCooldownTicks: 0, rollCooldown: 0, invulnerableTicks: TUNING.fighter.spawnInvulnerabilityTicks,
      combat: { ...createCombatState(), kills, deaths, damageDealt, shots, hits },
    });
    fighter.grounded = hasGroundSupport(fighter, this.terrain);
    this.events.push({ type: 'respawn', fighterId: fighter.id, x: fighter.x, y: fighter.y });
  }
}
