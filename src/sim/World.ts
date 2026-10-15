import { TUNING } from '../data/tuning';
import { hasGroundSupport } from './physics/aabb';
import { SeededRandom } from './random';
import { stepMovement } from './systems/movement';
import { TileMap } from './terrain/TileMap';
import { neutralInput, type ArenaData, type Fighter, type InputCommand, type SimEvent } from './types';

/** Headless fixed-step simulation; the same commands and seed produce the same state. */
export class World {
  readonly terrain: TileMap;
  readonly fighters: Fighter[] = [];
  readonly rng: SeededRandom;
  tick = 0;
  events: SimEvent[] = [];

  constructor(public readonly arena: ArenaData, seed = 12345) {
    this.terrain = new TileMap(arena);
    this.rng = new SeededRandom(seed);
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
      ...options,
    };
    fighter.grounded = hasGroundSupport(fighter, this.terrain);
    this.fighters.push(fighter);
    return fighter;
  }

  step(commands: Record<number, InputCommand>): void {
    this.events = [];
    this.tick++;
    for (const fighter of this.fighters) {
      if (!fighter.alive) {
        fighter.respawnTicks = Math.max(0, fighter.respawnTicks - 1);
        if (fighter.respawnTicks === 0) this.respawn(fighter);
        continue;
      }
      stepMovement(fighter, commands[fighter.id] ?? neutralInput(), this.terrain, this.arena.props, this.events);
      if (fighter.y - fighter.height / 2 > this.arena.height * this.arena.tileSize + 160) {
        fighter.alive = false;
        fighter.action = 'dead';
        fighter.respawnTicks = TUNING.fighter.respawnTicks;
        fighter.vx = fighter.vy = 0;
        fighter.climbing = false;
        fighter.ledge = null;
        this.events.push({ type: 'ringout', fighterId: fighter.id, x: fighter.x, y: fighter.y });
      }
    }
  }

  private respawn(fighter: Fighter): void {
    const index = this.fighters.indexOf(fighter);
    const spawn = this.arena.spawns[index % this.arena.spawns.length] ?? { x: this.arena.width * this.arena.tileSize / 2, y: 50 };
    Object.assign(fighter, {
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, hp: fighter.maxHp, damage: 0, alive: true,
      action: 'idle', actionTicks: 0, grounded: false, climbing: false, ledge: null,
      coyoteTicks: 0, jumpBufferTicks: 0, jumpHeld: false, rollHeld: false,
      climbCooldownTicks: 0, rollCooldown: 0, invulnerableTicks: TUNING.fighter.spawnInvulnerabilityTicks,
    });
    fighter.grounded = hasGroundSupport(fighter, this.terrain);
    this.events.push({ type: 'respawn', fighterId: fighter.id, x: fighter.x, y: fighter.y });
  }
}
