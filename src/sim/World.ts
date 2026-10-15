import { TUNING } from '../data/tuning';
import { COMBAT, THROWABLES } from '../data/combat';
import { getCharacter } from '../data/characters';
import { hasGroundSupport } from './physics/aabb';
import { SeededRandom } from './random';
import { stepMovement } from './systems/movement';
import { resolveMelee, stepCombat } from './systems/combat';
import { applyDamage } from './systems/damage';
import { configureLoadout, createCombatState, pickupKind, WEAPONS } from './weapons/definitions';
import { stepProjectiles } from './weapons/firearms';
import type { AreaEffect, Barrier, Hitbox, Pickup, Projectile } from './weapons/types';
import { TileMap, type BrokenTile } from './terrain/TileMap';
import { activeClimbables, activeMovementProps, createProps, damageProp, preStepProps, releaseHeldProp, spawnDebris, spawnRagdoll, stepProps } from './entities/props';
import type { Debris, PropBody } from './entities/types';
import { MATERIALS } from '../data/materials';
import { NavigationGraph } from './ai/NavigationGraph';
import { BotController } from './ai/BotController';
import { StructuralSystem } from './terrain/StructuralSystem';
import { FireSystem } from './terrain/FireSystem';
import { createMatchSettings, type MatchResults, type MatchSettings, type MatchState } from './match/types';
import { createMatchState, getMatchResults, updateMatch } from './match/rules';
import { neutralInput, type ArenaData, type Fighter, type InputCommand, type SimEvent } from './types';

/** Headless fixed-step simulation; the same commands and seed produce the same state. */
export class World {
  readonly terrain: TileMap;
  readonly fighters: Fighter[] = [];
  readonly rng: SeededRandom;
  readonly projectiles: Projectile[] = [];
  readonly effects: AreaEffect[] = [];
  readonly barriers: Barrier[] = [];
  readonly pickups: Pickup[] = [];
  readonly props: PropBody[];
  readonly debris: Debris[] = [];
  readonly structures: StructuralSystem;
  readonly fire: FireSystem;
  readonly settings: MatchSettings;
  readonly match: MatchState = createMatchState();
  navigation: NavigationGraph | null = null;
  readonly bots = new Map<number, BotController>();
  hitboxes: Hitbox[] = [];
  tick = 0;
  events: SimEvent[] = [];
  private readonly inputObservers = new Set<(commands: Readonly<Record<number, InputCommand>>) => void>();

  constructor(public readonly arena: ArenaData, public readonly seed = 12345, settings: Partial<MatchSettings> = {}) {
    this.settings = createMatchSettings(settings);
    this.terrain = new TileMap(arena);
    this.rng = new SeededRandom(seed);
    this.props = createProps(arena.props);
    this.structures = new StructuralSystem(this);
    this.fire = new FireSystem(this);
    this.pickups = arena.weaponSpawns.map((spawn, index) => {
      const weapon = this.spawnWeapon(index);
      return { id: index, x: spawn.x, y: spawn.y, kind: pickupKind(weapon), weapon, active: true, respawnTicks: 0 };
    });
  }

  addFighter(options: Partial<Fighter> = {}): Fighter {
    if (this.fighters.length >= 8) throw new Error('A match supports at most 8 fighters');
    const id = options.id ?? this.fighters.reduce((next, fighter) => Math.max(next, fighter.id + 1), 0);
    if (this.fighters.some(fighter => fighter.id === id)) throw new Error(`Fighter id ${id} already exists`);
    const spawn = this.arena.spawns[this.fighters.length % this.arena.spawns.length] ?? { x: this.arena.width * this.arena.tileSize / 2, y: 50 };
    const character = getCharacter(options.character);
    const characterHp = options.character ? character.hp : TUNING.fighter.hp;
    const fighter: Fighter = {
      id, name: `Fighter ${id + 1}`, character: character.id, team: id,
      speedScale: options.character ? character.speedScale : 1, special: character.special,
      color: options.character ? character.color : id % 2 === 0 ? TUNING.colors.amber : TUNING.colors.cyan,
      controller: 'human', difficulty: 'normal',
      x: spawn.x, y: spawn.y, vx: 0, vy: 0,
      width: TUNING.fighter.width, height: TUNING.fighter.height, facing: id % 2 === 0 ? 1 : -1,
      hp: characterHp, maxHp: characterHp, damage: 0, stocks: this.settings.stocks, alive: true,
      grounded: false, coyoteTicks: 0, jumpBufferTicks: 0, jumpHeld: false, rollHeld: false,
      action: 'idle', actionTicks: 0, rollCooldown: 0, invulnerableTicks: 0,
      respawnTicks: 0, climbing: false, climbCooldownTicks: 0, ledge: null,
      combat: createCombatState(),
      ...options,
    };
    configureLoadout(fighter.combat, this.settings);
    fighter.grounded = hasGroundSupport(fighter, this.terrain);
    this.fighters.push(fighter);
    if (fighter.controller === 'bot') {
      if (!this.navigation) this.navigation = new NavigationGraph(this.terrain, activeClimbables(this));
      this.bots.set(fighter.id, new BotController((this.seed ^ Math.imul(fighter.id + 1, 2654435761)) >>> 0));
    }
    return fighter;
  }

  step(commands: Record<number, InputCommand>): void {
    if (this.match.ended) return;
    for (const observer of this.inputObservers) observer(commands);
    this.events = [];
    this.hitboxes = [];
    this.tick++;
    this.match.elapsedTicks++;
    preStepProps(this);
    const tickCommands = { ...commands };
    for (const fighter of this.fighters) {
      if (fighter.controller !== 'bot' || !fighter.alive || tickCommands[fighter.id]) continue;
      const bot = this.bots.get(fighter.id);
      if (bot) tickCommands[fighter.id] = bot.command(this, fighter);
    }
    for (const fighter of this.fighters) {
      if (!fighter.alive) {
        if (this.settings.mode === 'stocks' && fighter.stocks <= 0) continue;
        fighter.respawnTicks = Math.max(0, fighter.respawnTicks - 1);
        if (fighter.respawnTicks === 0) this.respawn(fighter);
        continue;
      }
      stepMovement(fighter, tickCommands[fighter.id] ?? neutralInput(), this.terrain, activeMovementProps(this), this.events);
      if (fighter.y - fighter.height / 2 > this.arena.height * this.arena.tileSize + 160
        || fighter.y + fighter.height / 2 < -240
        || fighter.x + fighter.width / 2 < -160
        || fighter.x - fighter.width / 2 > this.arena.width * this.arena.tileSize + 160) {
        const owner = this.tick - fighter.combat.lastHitTick <= COMBAT.killCreditTicks ? fighter.combat.lastHitBy : -1;
        this.knockout(fighter, owner, 'ringout');
      }
    }
    for (const fighter of this.fighters) if (fighter.alive) stepCombat(this, fighter, tickCommands[fighter.id] ?? neutralInput());
    resolveMelee(this);
    stepProjectiles(this);
    stepProps(this);
    this.fire.step();
    this.structures.step(this.terrain.changedTiles.values());
    if (this.navigation && this.tick % TUNING.ai.repairTicks === 0 && this.terrain.changedTiles.size > 0) {
      this.navigation.queueRepair(this.terrain.changedTiles.values());
      this.terrain.changedTiles.clear();
    }
    this.navigation?.stepRepair(TUNING.ai.repairNodeBudget);
    updateMatch(this.settings, this.match, this.fighters);
    if (this.match.ended) this.events.push({ type: 'match-end', x: 0, y: 0, text: this.match.reason });
  }

  results(): MatchResults { return getMatchResults(this.match, this.fighters); }

  /** Observe external input before bots resolve their commands. Returns an unsubscribe function. */
  observeInputs(observer: (commands: Readonly<Record<number, InputCommand>>) => void): () => void {
    this.inputObservers.add(observer);
    return () => { this.inputObservers.delete(observer); };
  }

  /** Arena-authored weighted drops, filtered by the selected match weapon set. */
  spawnWeapon(index = 0): string {
    const allowed = (id: string): boolean => {
      if (id === 'health' || id === 'ammo') return true;
      const definition = WEAPONS[id];
      if (!definition && !THROWABLES[id]) return false;
      if (this.settings.weaponSet === 'custom') return this.settings.customWeapons.includes(id);
      if (this.settings.weaponSet === 'melee') return definition?.slot === 'melee';
      if (this.settings.weaponSet === 'guns') return definition?.slot === 'primary' || definition?.slot === 'sidearm';
      return true;
    };
    const table = this.arena.spawnTable?.filter(entry => allowed(entry.weapon) && Number.isFinite(entry.weight) && entry.weight > 0);
    if (table?.length) {
      let roll = this.rng.next() * table.reduce((sum, entry) => sum + entry.weight, 0);
      for (const entry of table) { roll -= entry.weight; if (roll < 0) return entry.weapon; }
      return table[table.length - 1].weapon;
    }
    const defaults = ['shotgun', 'smg', 'pistol'].filter(allowed);
    const candidates = defaults.length ? defaults : [...Object.keys(WEAPONS), ...Object.keys(THROWABLES)].filter(id => id !== 'unarmed' && allowed(id));
    return candidates[index % candidates.length] ?? 'unarmed';
  }

  damageFighter(target: Fighter, amount: number, owner: number, knockback = 250, angle = 0, kind = 'melee'): boolean {
    return applyDamage(this, target, amount, owner, knockback, angle, kind);
  }

  explode(x: number, y: number, radius: number, damage: number, owner = -1): void {
    this.events.push({ type: 'explosion', x, y, amount: radius, intensity: Math.min(1, radius / 135), weapon: 'grenade' });
    for (const tile of this.terrain.damageCircle(x, y, radius, damage * TUNING.props.explosionTerrainMultiplier)) this.emitBrokenTile(tile, owner);
    for (const prop of this.props) {
      if (!prop.active || !prop.damageable) continue;
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

  ignite(x: number, y: number, radius: number, owner = -1): void { this.fire.ignite(x, y, radius, owner); }

  spawnDebris(x: number, y: number, material: number, owner = -1, count = 1): void { spawnDebris(this, x, y, material, owner, count); }

  emitBrokenTile(tile: BrokenTile, owner = -1): void {
    this.events.push({ type: 'tile-break', x: tile.x, y: tile.y, amount: tile.material, color: MATERIALS[tile.material]?.debrisColor ?? 0x999999 });
    this.spawnDebris(tile.x, tile.y, tile.material, owner, TUNING.debris.piecesPerTile);
  }

  knockout(fighter: Fighter, owner = -1, kind = 'knockout'): void {
    if (!fighter.alive) return;
    releaseHeldProp(this, fighter, false);
    spawnRagdoll(this, fighter);
    fighter.alive = false; fighter.hp = 0; fighter.stocks = Math.max(0, fighter.stocks - 1);
    fighter.action = 'dead'; fighter.respawnTicks = TUNING.fighter.respawnTicks;
    fighter.vx = fighter.vy = 0; fighter.climbing = false; fighter.ledge = null;
    fighter.combat.deaths++;
    fighter.combat.cookTicks = 0; fighter.combat.grabTarget = null;
    const killer = this.fighters.find(other => other.id === owner && other !== fighter);
    if (killer && (this.settings.mode !== 'team' || killer.team !== fighter.team)) killer.combat.kills++;
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
    configureLoadout(fighter.combat, this.settings);
    fighter.grounded = hasGroundSupport(fighter, this.terrain);
    this.events.push({ type: 'respawn', fighterId: fighter.id, x: fighter.x, y: fighter.y });
  }
}
