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
import { TileMap, type BrokenTile } from './terrain/TileMap';
import { createProps, damageProp, releaseHeldProp, spawnDebris, stepProps } from './entities/props';
import type { Debris, PropBody } from './entities/types';
import { MATERIALS } from '../data/materials';
import { NavigationGraph } from './ai/NavigationGraph';
import { BotController } from './ai/BotController';
import { neutralInput, type ArenaData, type Fighter, type InputCommand, type SimEvent } from './types';

/** Headless fixed-step simulation; the same commands and seed produce the same state. */
export class World {
  readonly terrain: TileMap;
  readonly fighters: Fighter[] = [];
  readonly rng: SeededRandom;
  readonly projectiles: Projectile[] = [];
  readonly pickups: Pickup[] = [];
  readonly props: PropBody[];
  readonly debris: Debris[] = [];
  navigation: NavigationGraph | null = null;
  readonly bots = new Map<number, BotController>();
  hitboxes: Hitbox[] = [];
  tick = 0;
  events: SimEvent[] = [];

  constructor(public readonly arena: ArenaData, private readonly seed = 12345) {
    this.terrain = new TileMap(arena);
    this.rng = new SeededRandom(seed);
    this.props = createProps(arena.props);
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
    if (fighter.controller === 'bot') {
      if (!this.navigation) { this.navigation = new NavigationGraph(this.terrain, this.arena.props); this.terrain.changedTiles.clear(); }
      this.bots.set(fighter.id, new BotController((this.seed ^ Math.imul(fighter.id + 1, 2654435761)) >>> 0));
    }
    return fighter;
  }

  step(commands: Record<number, InputCommand>): void {
    this.events = [];
    this.hitboxes = [];
    this.tick++;
    if (this.navigation && this.tick % TUNING.ai.repairTicks === 0 && this.terrain.changedTiles.size > 0) {
      this.navigation.repair(this.terrain.changedTiles.values());
      this.terrain.changedTiles.clear();
    }
    const tickCommands = { ...commands };
    for (const fighter of this.fighters) {
      if (fighter.controller !== 'bot' || !fighter.alive || tickCommands[fighter.id]) continue;
      const bot = this.bots.get(fighter.id);
      if (bot) tickCommands[fighter.id] = bot.command(this, fighter);
    }
    for (const fighter of this.fighters) {
      if (!fighter.alive) {
        fighter.respawnTicks = Math.max(0, fighter.respawnTicks - 1);
        if (fighter.respawnTicks === 0) this.respawn(fighter);
        continue;
      }
      stepMovement(fighter, tickCommands[fighter.id] ?? neutralInput(), this.terrain, this.arena.props, this.events);
      if (fighter.y - fighter.height / 2 > this.arena.height * this.arena.tileSize + 160) {
        const owner = this.tick - fighter.combat.lastHitTick <= COMBAT.killCreditTicks ? fighter.combat.lastHitBy : -1;
        this.knockout(fighter, owner, 'ringout');
      }
    }
    for (const fighter of this.fighters) if (fighter.alive) stepCombat(this, fighter, tickCommands[fighter.id] ?? neutralInput());
    resolveMelee(this);
    stepProjectiles(this);
    stepProps(this);
  }

  damageFighter(target: Fighter, amount: number, owner: number, knockback = 250, angle = 0, kind = 'melee'): boolean {
    return applyDamage(this, target, amount, owner, knockback, angle, kind);
  }

  explode(x: number, y: number, radius: number, damage: number, owner = -1): void {
    this.events.push({ type: 'explosion', x, y, amount: radius, intensity: Math.min(1, radius / 135), weapon: 'grenade' });
    for (const tile of this.terrain.damageCircle(x, y, radius, damage * TUNING.props.explosionTerrainMultiplier)) this.emitBrokenTile(tile, owner);
    for (const prop of this.props) {
      if (!prop.active || !prop.dynamic) continue;
      const dx = Math.max(0, Math.abs(prop.x - x) - prop.width / 2), dy = Math.max(0, Math.abs(prop.y - y) - prop.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance <= radius) this.damageProp(prop, damage * (1 - distance / radius * 0.5), owner);
    }
    for (const fighter of this.fighters) {
      const distance = Math.hypot(fighter.x - x, fighter.y - y);
      if (distance > radius || !fighter.alive) continue;
      const angle = distance < 1 ? -Math.PI / 2 : Math.atan2(fighter.y - y, fighter.x - x);
      this.damageFighter(fighter, Math.round(damage * (1 - distance / radius * 0.65)), owner, 580, angle, 'explosion');
    }
  }

  damageTerrain(col: number, row: number, power: number, owner = -1): void {
    const broken = this.terrain.damage(col, row, power);
    if (broken) this.emitBrokenTile(broken, owner);
  }

  damageProp(prop: PropBody, amount: number, owner = -1): void { damageProp(this, prop, amount, owner); }

  spawnDebris(x: number, y: number, material: number, owner = -1, count = 1): void { spawnDebris(this, x, y, material, owner, count); }

  private emitBrokenTile(tile: BrokenTile, owner: number): void {
    this.events.push({ type: 'tile-break', x: tile.x, y: tile.y, amount: tile.material, color: MATERIALS[tile.material]?.debrisColor ?? 0x999999 });
    this.spawnDebris(tile.x, tile.y, tile.material, owner, TUNING.debris.piecesPerTile);
  }

  knockout(fighter: Fighter, owner = -1, kind = 'knockout'): void {
    if (!fighter.alive) return;
    releaseHeldProp(this, fighter, false);
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
