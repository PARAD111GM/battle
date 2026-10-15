import { TUNING } from '../../data/tuning';
import { botDifficulty } from '../../data/ai';
import { MATERIALS } from '../../data/materials';
import { SeededRandom } from '../random';
import { neutralInput, type Fighter, type InputCommand, type Vec2 } from '../types';
import type { World } from '../World';
import { equippedWeapon, WEAPONS } from '../weapons/definitions';
import { blocksVision } from '../weapons/firearms';
import type { NavEdge, NavNode } from './NavigationGraph';

const A = TUNING.ai;
interface Observation extends Vec2 { id: number; vx: number; vy: number; grounded: boolean; tick: number }
interface Goal { point: Vec2; key: string; label: string }

/** Every bot has a separate seeded RNG and only aims at observations made through bounded vision. */
export class BotController {
  readonly rng: SeededRandom;
  readonly debug: { goal: string; targetId: number | null; path: string[]; stuckTicks: number } = { goal: 'patrol', targetId: null, path: [], stuckTicks: 0 };
  private observed: Observation | null = null;
  private nextReaction = 0;
  private nextPlan = 0;
  private nextDecision = 0;
  private selectedGoal: Goal | null = null;
  private readonly visited = new Map<string, number>();
  private readonly blockedGoals = new Map<string, number>();
  private readonly reachablePickups = new Map<number, { revision: number; until: number; x: number; y: number; reachable: boolean }>();
  private recoveryUntil = 0;
  private recoveryDirection = 1;
  private clearingDirection = 0;
  private clearingUntil = 0;
  private nextRecovery = 0;
  private lastPlan = -1000;
  private pathIndex = 1;
  private goal: Vec2 | null = null;
  private goalKey = '';
  private aimOffset = 0;
  private jumpUntil = 0;
  private nextJump = 0;
  private cookUntil = 0;
  private nextGrenade = 0;
  private defendUntil = 0;
  private rollNow = false;
  private lastWantedMotion = false;
  private progressAnchor: Vec2 | null = null;
  private lastProgressTick = 0;
  private navRevision = -1;
  private wasAlive = false;
  private previousCombat: Fighter['combat'] | null = null;

  constructor(seed = 12345) { this.rng = new SeededRandom(seed); }

  private isEnemy(world: World, fighter: Fighter, target: Fighter): boolean {
    return target !== fighter && target.alive && (world.settings.mode !== 'team' || target.team !== fighter.team);
  }

  private canSee(world: World, fighter: Fighter, target: Fighter): boolean {
    if (fighter.combat.flashTicks > 0) return false;
    return Math.hypot(target.x - fighter.x, target.y - fighter.y) <= A.visionRange
      && !blocksVision(world, fighter.x, fighter.y - 7, target.x, target.y - 7);
  }

  private perceive(world: World, fighter: Fighter): void {
    const difficulty = botDifficulty(fighter.difficulty);
    const visible = world.fighters.filter(target => this.isEnemy(world, fighter, target) && this.canSee(world, fighter, target));
    visible.sort((a, b) => Math.hypot(a.x - fighter.x, a.y - fighter.y) - Math.hypot(b.x - fighter.x, b.y - fighter.y) || a.id - b.id);
    const target = visible[0];
    if (target) {
      this.observed = { id: target.id, x: target.x, y: target.y, vx: target.vx, vy: target.vy, grounded: target.grounded, tick: world.tick };
      this.debug.targetId = target.id;
      this.aimOffset = this.rng.range(-difficulty.aimError, difficulty.aimError);
      const distance = Math.hypot(target.x - fighter.x, target.y - fighter.y);
      if (distance < 80 && target.action === 'melee-windup' && this.rng.next() < difficulty.blockChance) this.defendUntil = world.tick + 12;
      this.rollNow = fighter.rollCooldown === 0 && target.action === 'shoot' && distance < 500 && this.rng.next() < difficulty.rollChance;
    } else if (this.observed && world.tick - this.observed.tick > A.memoryTicks) {
      this.observed = null;
      this.debug.targetId = null;
    }
  }

  private chooseGoal(world: World, fighter: Fighter, visible: boolean): Goal | null {
    const graph = world.navigation;
    if (!graph) return null;
    const distance = (point: Vec2): number => Math.hypot(point.x - fighter.x, point.y - fighter.y);
    const available = world.pickups.filter(item => item.active && (this.blockedGoals.get(`pickup:${item.id}`) ?? 0) <= world.tick);
    const reachable = (item: typeof world.pickups[number]): boolean => {
      const cached = this.reachablePickups.get(item.id);
      if (cached && cached.revision === graph.revision && world.tick < cached.until && Math.hypot(fighter.x - cached.x, fighter.y - cached.y) < 160) return cached.reachable;
      const standing = graph.nearest(item.x, item.y);
      // Destroying a catwalk can leave an authored drop floating far above every standing surface.
      const reachable = Boolean(standing && Math.hypot(standing.x - item.x, standing.y - item.y) < 48 && graph.findPath(fighter, standing).length);
      this.reachablePickups.set(item.id, { revision: graph.revision, until: world.tick + 90, x: fighter.x, y: fighter.y, reachable });
      return reachable;
    };
    const nearest = (kind: (item: typeof world.pickups[number]) => boolean) => available.filter(kind)
      .sort((a, b) => distance(a) - distance(b) || a.id - b.id).find(reachable);
    if (fighter.hp / fighter.maxHp < 0.55) {
      const health = nearest(item => item.kind === 'health');
      if (health) return { point: health, key: `pickup:${health.id}`, label: 'seek health' };
    }
    if (this.observed && fighter.hp / fighter.maxHp < A.fleeHealthRatio && visible) {
      // Cover is assessed against the last observed position, never the hidden fighter's live position.
      const target = this.observed;
      const direction = Math.sign(fighter.x - target.x || fighter.facing);
      if (this.goal && this.goalKey.startsWith('flee:') && distance(this.goal) > 45) return { point: this.goal, key: this.goalKey, label: 'retreat to cover' };
      const candidates = [...graph.nodes.values()].filter(node => distance(node) > 90 && distance(node) < 520 && Math.sign(node.x - fighter.x) === direction);
      const scored = candidates.map(node => ({ node, score: (blocksVision(world, target.x, target.y - 7, node.x, node.y - 7) ? 450 : 0)
        + Math.hypot(node.x - target.x, node.y - target.y) - distance(node) * 0.3 }));
      scored.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
      for (const { node } of scored.slice(0, 6)) if (graph.findPath(fighter, node).length) return { point: node, key: `flee:${node.id}`, label: 'retreat to cover' };
    }
    const ammo = (id: string): number => (fighter.combat.ammo[id] ?? 0) + (fighter.combat.reserve[id] ?? 0);
    if (ammo(fighter.combat.primary) + ammo(fighter.combat.sidearm) < 6) {
      const supply = nearest(item => item.kind === 'ammo' || WEAPONS[item.weapon]?.kind === 'gun');
      if (supply) return { point: supply, key: `pickup:${supply.id}`, label: 'seek ammunition' };
    }
    if (this.observed) return { point: this.observed, key: `enemy:${this.observed.id}`, label: visible ? 'engage' : 'last seen / cover' };
    const pickups = available.filter(item => item.kind !== 'health' && item.kind !== 'ammo'
      && (this.visited.get(`pickup:${item.id}`) ?? -Infinity) + 300 < world.tick);
    pickups.sort((a, b) => distance(a) - distance(b) || a.id - b.id);
    for (const pickup of pickups.slice(0, 4)) {
      if (distance(pickup) < A.visionRange && reachable(pickup)) return { point: pickup, key: `pickup:${pickup.id}`, label: 'seek weapon' };
    }
    // Destruction separates directed components. Sample only genuinely reachable surfaces;
    // a short random shortlist can miss every valid route and leave a bot patrolling itself.
    const start = graph.nearest(fighter.x, fighter.y);
    const connected = new Map<string, NavNode>();
    if (start) {
      const queue = [start]; connected.set(start.id, start);
      for (let index = 0; index < queue.length; index++) for (const edge of queue[index].edges) {
        const next = graph.nodes.get(edge.to);
        if (next && !connected.has(next.id)) { connected.set(next.id, next); queue.push(next); }
      }
    }
    if (this.goal && this.goalKey.startsWith('patrol:') && connected.has(this.goalKey.slice(7)) && distance(this.goal) > 40
      && (this.blockedGoals.get(this.goalKey) ?? 0) <= world.tick) return { point: this.goal, key: this.goalKey, label: 'patrol' };
    if (this.goalKey.startsWith('patrol:')) this.visited.set(this.goalKey, world.tick);
    const candidates = [...connected.values()].filter(node => distance(node) > 160
      && (this.blockedGoals.get(`patrol:${node.id}`) ?? 0) <= world.tick);
    // Prefer unvisited nearby sections. A seeded tie breaker keeps matches reproducible.
    const scored = candidates.map(node => ({ node, score: (this.visited.get(`patrol:${node.id}`) ?? -10000)
      + Math.max(0, distance(node) - 800) + this.rng.next() * 240 }));
    scored.sort((a, b) => a.score - b.score || a.node.id.localeCompare(b.node.id));
    if (scored[0]) return { point: scored[0].node, key: `patrol:${scored[0].node.id}`, label: 'patrol' };
    const node = [...connected.values()].sort((a, b) => distance(b) - distance(a) || a.id.localeCompare(b.id))[0];
    return node ? { point: node, key: `patrol:${node.id}`, label: 'patrol' } : null;
  }

  private plan(world: World, fighter: Fighter, goal: Goal): void {
    this.debug.goal = goal.label;
    const changed = goal.key !== this.goalKey;
    this.goal = { x: goal.point.x, y: goal.point.y };
    this.goalKey = goal.key;
    if (world.tick - this.lastPlan < 12 || (!changed && world.tick < this.nextPlan)) return;
    const previous = world.navigation!.nodes.get(this.debug.path[Math.max(0, this.pathIndex - 1)]);
    const traversal = previous?.edges.find(edge => edge.to === this.debug.path[this.pathIndex]);
    // An airborne fighter is not standing on the closest upper node yet. Finish the physical arc.
    if (!fighter.grounded && !fighter.climbing && !fighter.ledge && this.navRevision === world.navigation!.revision
      && ['jump', 'ledge', 'drop'].includes(traversal?.kind ?? '')) return;
    const path = world.navigation!.findPath(fighter, this.goal);
    this.debug.path = path.map(node => node.id);
    this.pathIndex = path.length > 1 ? 1 : 0;
    this.lastPlan = world.tick;
    this.nextPlan = world.tick + botDifficulty(fighter.difficulty).replanTicks;
    this.navRevision = world.navigation!.revision;
  }

  private navigate(world: World, fighter: Fighter, command: InputCommand): NavEdge | undefined {
    const graph = world.navigation;
    if (!graph || !this.goal) return;
    let next: NavNode | undefined = graph.nodes.get(this.debug.path[this.pathIndex]);
    while (next && fighter.grounded && Math.abs(next.x - fighter.x) < 17 && Math.abs(next.y - fighter.y) < 25 && this.pathIndex < this.debug.path.length - 1) {
      next = graph.nodes.get(this.debug.path[++this.pathIndex]);
    }
    const previous = graph.nodes.get(this.debug.path[Math.max(0, this.pathIndex - 1)]);
    const edge = previous?.edges.find(candidate => candidate.to === next?.id);
    const destination = next ?? this.goal;
    const dx = destination.x - fighter.x;
    command.moveX = Math.abs(dx) < 7 ? 0 : Math.max(-1, Math.min(1, dx / 20));
    if (edge?.kind === 'climb' && edge.via) {
      const ladderX = edge.via.x;
      const upward = destination.y < (previous?.y ?? fighter.y);
      const reachedHeight = upward ? fighter.y <= destination.y - 3 : fighter.y >= destination.y - 3;
      if (reachedHeight) { command.moveX = Math.sign(dx); command.moveY = 0; }
      else if (Math.abs(fighter.x - ladderX) > 6 && !fighter.climbing) command.moveX = Math.sign(ladderX - fighter.x);
      else { command.moveX = 0; command.moveY = upward ? -1 : 1; }
    } else if (edge?.kind === 'jump' || edge?.kind === 'ledge') {
      if (fighter.grounded && world.tick >= this.nextJump) {
        this.jumpUntil = world.tick + A.jumpHoldTicks;
        this.nextJump = world.tick + A.jumpHoldTicks + 12;
      }
      command.jump = world.tick < this.jumpUntil;
      if (fighter.ledge) command.moveY = -1;
    } else if (edge?.kind === 'drop') {
      if (edge.via && fighter.grounded && fighter.y <= (previous?.y ?? fighter.y) + 8) command.moveX = Math.sign(edge.via.x - fighter.x);
      command.moveY = 1;
    }
    if (fighter.climbing && edge?.kind !== 'climb') {
      // Replanning can choose the upper surface before the climber has cleared its opening.
      // Finish at the navigation surface, not the pickup's floating display position.
      const upward = destination.y < fighter.y;
      const cleared = upward ? fighter.y <= destination.y - 4 : fighter.y >= destination.y - 3;
      if (cleared) { command.moveY = 0; command.moveX = Math.sign(dx || fighter.facing); }
      else { command.moveX = 0; command.moveY = upward ? -1 : 1; }
    }
    return edge;
  }

  /** Avoid firing through a teammate, including when friendly fire is enabled. */
  private allyInLine(world: World, fighter: Fighter, aimX: number, aimY: number, range: number): boolean {
    if (world.settings.mode !== 'team') return false;
    return world.fighters.some(ally => {
      if (ally === fighter || !ally.alive || ally.team !== fighter.team) return false;
      const dx = ally.x - fighter.x, dy = ally.y - fighter.y;
      const along = dx * aimX + dy * aimY;
      const spread = WEAPONS[equippedWeapon(fighter.combat)]?.spread ?? 0;
      return along > 0 && along < range && Math.abs(dx * aimY - dy * aimX) < Math.max(ally.width, ally.height) / 2 + 5 + Math.tan(spread) * along * 1.5;
    });
  }

  command(world: World, fighter: Fighter): InputCommand {
    const command = neutralInput();
    const difficulty = botDifficulty(fighter.difficulty);
    if (!fighter.alive) { this.wasAlive = false; return command; }
    // World skips dead bots; a new combat state identifies respawns even without a dead command tick.
    if (this.previousCombat !== fighter.combat) { this.previousCombat = fighter.combat; this.wasAlive = false; }
    if (!this.wasAlive) {
      this.wasAlive = true; this.observed = null; this.debug.targetId = null;
      this.nextReaction = world.tick + difficulty.reactionTicks; this.nextPlan = 0; this.nextDecision = 0;
      this.selectedGoal = null; this.goal = null; this.goalKey = ''; this.debug.path = [];
      this.debug.stuckTicks = 0; this.lastWantedMotion = false;
      this.progressAnchor = { x: fighter.x, y: fighter.y }; this.lastProgressTick = world.tick;
      this.cookUntil = 0; this.defendUntil = 0; this.rollNow = false; this.recoveryUntil = 0; this.clearingDirection = 0;
    }
    if (world.tick >= this.nextReaction) { this.perceive(world, fighter); this.nextReaction = world.tick + difficulty.reactionTicks; }
    const target = this.observed ? world.fighters.find(other => other.id === this.observed!.id && this.isEnemy(world, fighter, other)) : undefined;
    const visible = Boolean(target && this.canSee(world, fighter, target));
    if (!target && this.observed) { this.observed = null; this.debug.targetId = null; this.nextDecision = world.tick; }
    if (world.tick >= this.nextDecision || world.navigation?.revision !== this.navRevision) {
      this.selectedGoal = this.chooseGoal(world, fighter, visible);
      this.nextDecision = world.tick + difficulty.decisionTicks;
    }
    if (this.selectedGoal) this.plan(world, fighter, this.selectedGoal);
    const edge = this.navigate(world, fighter, command);

    if (this.observed && fighter.combat.flashTicks === 0) {
      const observed = this.observed;
      const distance = Math.hypot(observed.x - fighter.x, observed.y - fighter.y);
      const weapon = WEAPONS[equippedWeapon(fighter.combat)];
      // Physical projectiles lead the observed velocity. Hitscan weapons retain Normal's slight lead.
      const speed = weapon?.projectileSpeed ?? 0;
      let lead = speed > 0 ? Math.min(0.85, distance / speed) : Math.min(0.055, distance / 15000);
      if (speed > 0) lead = Math.min(0.85, Math.hypot(observed.x - fighter.x + observed.vx * lead, observed.y - fighter.y + observed.vy * lead) / speed);
      const aimAngle = Math.atan2(observed.y - fighter.y + observed.vy * lead - (weapon?.projectileGravity ?? 0) * lead * lead / 2, observed.x - fighter.x + observed.vx * lead) + this.aimOffset;
      command.aimX = Math.cos(aimAngle); command.aimY = Math.sin(aimAngle);
      const hasAmmo = (id: string): boolean => (fighter.combat.ammo[id] ?? 0) + (fighter.combat.reserve[id] ?? 0) > 0;
      const currentAmmo = hasAmmo(equippedWeapon(fighter.combat));
      if (visible && Math.abs(observed.y - fighter.y) < 65) {
        if (this.debug.goal === 'engage' && weapon?.kind === 'gun' && currentAmmo && distance > 65 && distance < Math.min(A.preferredRange, weapon.range * 0.75)) command.moveX = 0;
        const meleeRange = fighter.combat.equipped === 'melee' ? Math.max(46, Math.min(95, weapon?.range ?? 46)) : 46;
        if (distance < meleeRange) { command.attack = world.tick % difficulty.attackIntervalTicks === 0; command.moveX = Math.sign(observed.x - fighter.x); }
        else if (weapon?.kind === 'gun') command.shoot = currentAmmo && distance < weapon.range * 0.92;
        if (distance < 65 && this.defendUntil > world.tick) { command.block = true; command.attack = false; }
        if (this.rollNow && fighter.grounded) { command.roll = true; this.rollNow = false; }
      } else if (visible && weapon?.kind === 'gun') command.shoot = currentAmmo && distance < weapon.range * 0.9;
      if (visible && fighter.combat.equipped === 'melee' && fighter.grounded && !observed.grounded
        && observed.y < fighter.y - 30 && observed.y > fighter.y - 150 && Math.abs(observed.x - fighter.x) < 150) {
        // Intercept a nearby jumper's landing instead of endlessly exchanging the same two platforms.
        command.moveX = Math.abs(observed.x - fighter.x) < 65 ? 0 : Math.sign(observed.x - fighter.x);
        command.jump = false; this.jumpUntil = 0; this.nextJump = world.tick + 12;
      }
      const gunReturnRange = Math.max(95, (WEAPONS[fighter.combat.primary]?.blastRadius ?? 0) * 1.4);
      if ((fighter.combat.equipped === 'melee' && distance > gunReturnRange) || (weapon?.kind === 'gun' && !currentAmmo)) {
        const slot = hasAmmo(fighter.combat.primary) ? 2 : hasAmmo(fighter.combat.sidearm) ? 3 : 4;
        command.switchWeapon = world.tick % 2 === 0 ? slot : 0;
      }
      // Grenades only target a recent actual sighting; unseen enemies cannot be located through walls.
      if (!visible && distance > 120 && distance < 650 && fighter.combat.throwableCount > 0 && world.tick >= this.nextGrenade && world.tick - observed.tick < A.memoryTicks) {
        this.nextGrenade = world.tick + difficulty.grenadeCooldownTicks;
        if (this.rng.next() < difficulty.grenadeChance) this.cookUntil = world.tick + A.grenadeCookTicks;
      }
      if (world.tick < this.cookUntil) {
        command.throw = true; command.aimY = Math.min(-0.55, command.aimY); command.shoot = false;
        const length = Math.hypot(command.aimX, command.aimY); command.aimX /= length; command.aimY /= length;
      }
      if (fighter.combat.specialMeter >= 100 && visible && distance < (fighter.special === 'slam' ? 140 : 650)) command.special = true;
      if (this.allyInLine(world, fighter, command.aimX, command.aimY, distance)) { command.shoot = false; command.attack = false; }
      if (visible && weapon?.blastRadius && distance < weapon.blastRadius * 1.3) {
        // A launcher cannot safely defend its stopping distance. Commit to a close-range weapon.
        command.shoot = false;
        if (Math.abs(observed.y - fighter.y) < 65) command.moveX = Math.sign(observed.x - fighter.x);
        const safeSidearm = hasAmmo(fighter.combat.sidearm) && !WEAPONS[fighter.combat.sidearm]?.blastRadius;
        command.switchWeapon = world.tick % 2 === 0 ? safeSidearm ? 3 : 4 : 0;
      }
      if (world.settings.mode === 'team' && world.fighters.some(ally => ally !== fighter && ally.alive && ally.team === fighter.team
        && Math.hypot(ally.x - observed.x, ally.y - observed.y) < Math.max(135, weapon?.blastRadius ?? 0))) {
        command.throw = false;
        if (weapon?.blastRadius) command.shoot = false;
      }
    } else {
      command.aimX = fighter.combat.flashTicks > 0 ? fighter.facing : command.moveX < 0 ? -1 : 1; command.aimY = 0;
    }

    const pickup = world.pickups.find(item => item.active && Math.hypot(item.x - fighter.x, item.y - fighter.y) < 43
      && (item.kind !== 'health' || fighter.hp < fighter.maxHp));
    if (pickup && world.tick % 18 === 0) command.interact = true;
    if (fighter.combat.heldProp !== null || fighter.combat.grabTarget !== null) {
      command.attack = world.tick % 2 === 0;
      if (fighter.combat.heldProp !== null && !visible) { command.aimX = fighter.facing * 0.8; command.aimY = -0.6; }
    }

    const noticed = (point: Vec2): boolean => fighter.combat.flashTicks === 0
      && !blocksVision(world, fighter.x, fighter.y - 7, point.x, point.y);
    const danger = world.projectiles.find(projectile => projectile.active
      && ((projectile.kind === 'grenade' && (projectile.life < 75 || projectile.weapon === 'sticky-mine' || projectile.weapon === 'molotov')) || projectile.kind === 'mine' || projectile.kind === 'rocket' || projectile.kind === 'molotov')
      && Math.hypot(projectile.x - fighter.x, projectile.y - fighter.y) < A.hazardRange && noticed(projectile));
    const barrel = world.props.find(prop => prop.active && prop.type === 'barrel' && prop.hp < prop.maxHp
      && Math.hypot(prop.x - fighter.x, prop.y - fighter.y) < 150 && noticed(prop));
    const fire = [...world.fire.cells.values()].find(cell => Math.hypot(cell.x - fighter.x, cell.y - fighter.y) < 65
      && Math.abs(cell.y - fighter.y) < fighter.height + world.terrain.tileSize);
    const falling = world.structures.chunks.find(chunk => chunk.active && chunk.vy > 180 && Math.abs(chunk.x - fighter.x) < 60 && chunk.y < fighter.y && fighter.y - chunk.y < 160);
    const hazard = fire ?? danger ?? barrel ?? falling;
    if (hazard) {
      this.debug.goal = fire ? 'avoid fire' : falling ? 'avoid falling structure' : danger?.weapon === 'sticky-mine' || danger?.kind === 'mine' ? 'avoid mine' : 'avoid blast';
      command.moveX = Math.sign(fighter.x - hazard.x || fighter.facing); command.moveY = 0; command.block = false;
      if (fighter.grounded && fighter.rollCooldown === 0) command.roll = true;
      if ((fire || (danger && danger.life < 22)) && fighter.grounded && world.tick >= this.nextJump) { this.jumpUntil = world.tick + 16; this.nextJump = world.tick + 35; }
    }
    if (world.tick < this.jumpUntil && edge?.kind !== 'climb') command.jump = true;
    if (fighter.ledge) command.moveY = -1;

    // Intermittent zero-axis commands at a blocked waypoint must not erase a stalled route.
    const waitingForPickup = this.goalKey.startsWith('pickup:') && world.pickups.some(item => item.active && this.goalKey === `pickup:${item.id}`);
    const routePending = waitingForPickup || this.goalKey.startsWith('patrol:') || Boolean(this.goal && Math.hypot(this.goal.x - fighter.x, this.goal.y - fighter.y) > 40);
    const intentionalHold = visible && (command.shoot || command.block || fighter.combat.reloadTicks > 0);
    if ((!this.lastWantedMotion && !routePending) || intentionalHold || fighter.combat.stunTicks > 0 || !this.progressAnchor
      || Math.abs(fighter.x - this.progressAnchor.x) >= A.progressDistance
      || ((fighter.grounded || fighter.climbing) && Math.abs(fighter.y - this.progressAnchor.y) >= A.progressDistance)) {
      this.progressAnchor = { x: fighter.x, y: fighter.y }; this.lastProgressTick = world.tick;
      this.debug.stuckTicks = 0; this.clearingDirection = 0;
    } else this.debug.stuckTicks = world.tick - this.lastProgressTick;
    const frontX = fighter.x + Math.sign(command.moveX || fighter.facing) * (fighter.width / 2 + 7);
    const wallAhead = world.terrain.atPixel(frontX, fighter.y) > 0;
    if (wallAhead && edge?.kind !== 'climb' && fighter.grounded && world.tick >= this.nextJump) { this.jumpUntil = world.tick + A.jumpHoldTicks; this.nextJump = world.tick + 50; command.jump = true; }
    if (this.debug.stuckTicks > A.stuckRecoverTicks) {
      this.debug.goal = 'clear blocked route';
      if (!this.clearingDirection) {
        let nearestWall = Infinity;
        for (const direction of [-1, 1]) for (let distance = fighter.width / 2 + 7; distance <= A.progressDistance * 2; distance += world.terrain.tileSize) {
          const materials = [-0.3, 0, 0.3].map(height => world.terrain.atPixel(fighter.x + direction * distance, fighter.y + fighter.height * height)).filter(Boolean);
          if (!materials.length) continue;
          if (materials.every(material => Number.isFinite(MATERIALS[material]?.hp)) && distance < nearestWall) {
            nearestWall = distance; this.clearingDirection = direction;
          }
          break; // A bedrock wall cannot be excavated by ordinary weapons.
        }
        if (this.clearingDirection) this.clearingUntil = world.tick + A.hardRecoveryTicks;
      }
      if (this.clearingDirection && world.tick < this.clearingUntil) {
        // Keep a single excavation direction. Alternating tiny patrol goals otherwise chips
        // both walls forever; melee clears a full-height corridor while jump/shoot interrupt it.
        command.moveX = this.clearingDirection; command.moveY = 0;
        command.aimX = this.clearingDirection; command.aimY = 0;
        command.attack = world.tick % difficulty.attackIntervalTicks === 0;
        command.shoot = command.throw = command.jump = command.block = false;
        this.jumpUntil = 0;
      } else {
        command.attack = false;
        command.aimX = Math.sign(command.moveX || fighter.facing); command.aimY = 0;
        if (fighter.grounded && world.tick >= this.nextJump) { this.jumpUntil = world.tick + A.jumpHoldTicks; this.nextJump = world.tick + 50; command.jump = true; }
      }
      this.nextPlan = Math.min(this.nextPlan, world.tick + 1);
    }
    if (fighter.grounded && command.moveX !== 0 && !['jump', 'drop', 'climb', 'ledge'].includes(edge?.kind ?? '') && !command.jump) {
      const ahead = fighter.x + Math.sign(command.moveX) * 27;
      if (!world.terrain.atPixel(ahead, fighter.y + fighter.height / 2 + 12)) {
        const direction = Math.sign(command.moveX), feet = fighter.y + fighter.height / 2;
        let landing = false;
        for (let distance = 45; distance <= 180 && !landing; distance += world.terrain.tileSize) {
          for (let depth = 0; depth <= 96; depth += world.terrain.tileSize) {
            if (world.terrain.atPixel(fighter.x + direction * distance, feet + depth + 1)) { landing = true; break; }
          }
        }
        this.nextPlan = world.tick;
        if (landing && world.tick >= this.nextJump) { this.jumpUntil = world.tick + A.jumpHoldTicks; this.nextJump = world.tick + A.jumpHoldTicks + 12; command.jump = true; }
        else if (!landing) command.moveX = 0;
      }
    }
    if (this.debug.stuckTicks > A.hardRecoveryTicks && world.tick >= this.nextRecovery
      && (!this.clearingDirection || world.tick >= this.clearingUntil)) {
      // Repair the affected standing columns, abandon an unreachable goal, then use ordinary movement.
      const col = Math.floor(fighter.x / world.terrain.tileSize), row = Math.floor((fighter.y + fighter.height / 2) / world.terrain.tileSize);
      world.navigation?.queueRepair([{ col, row }]);
      this.blockedGoals.set(this.goalKey, world.tick + 600);
      this.selectedGoal = null; this.goal = null; this.goalKey = ''; this.debug.path = []; this.clearingDirection = 0;
      this.nextDecision = world.tick; this.nextPlan = world.tick;
      this.recoveryDirection = -Math.sign(command.moveX || fighter.facing);
      this.recoveryUntil = world.tick + 40; this.nextRecovery = world.tick + 120;
      this.progressAnchor = { x: fighter.x, y: fighter.y }; this.lastProgressTick = world.tick;
    }
    if (world.tick < this.recoveryUntil) {
      this.debug.goal = 'recover blocked route'; command.moveX = this.recoveryDirection;
      command.moveY = fighter.ledge || fighter.climbing ? 1 : 0;
      command.jump = fighter.grounded || world.tick < this.jumpUntil;
      command.block = false;
    }
    if (fighter.combat.flashTicks > 0) {
      command.shoot = command.attack = command.throw = command.special = false;
      command.aimX = fighter.facing; command.aimY = 0;
    }
    if (this.allyInLine(world, fighter, command.aimX, command.aimY, this.observed ? Math.hypot(this.observed.x - fighter.x, this.observed.y - fighter.y) : 300)) command.shoot = false;
    const standingNode = fighter.grounded ? world.navigation?.nearest(fighter.x, fighter.y) : undefined;
    if (standingNode) this.visited.set(`patrol:${standingNode.id}`, world.tick);
    this.lastWantedMotion = Math.abs(command.moveX) > 0.1 || Math.abs(command.moveY) > 0.1 || command.jump || waitingForPickup;
    return command;
  }
}
