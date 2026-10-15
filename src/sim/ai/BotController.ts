import { TUNING } from '../../data/tuning';
import { SeededRandom } from '../random';
import { neutralInput, type Fighter, type InputCommand, type Vec2 } from '../types';
import type { World } from '../World';
import { equippedWeapon, WEAPONS } from '../weapons/definitions';
import { hasLineOfSight } from '../weapons/firearms';
import type { NavEdge, NavNode } from './NavigationGraph';

const A = TUNING.ai;
interface Observation extends Vec2 { id: number; vx: number; vy: number; tick: number }

/** A Normal bot has its own RNG and only aims at observations made through bounded vision. */
export class BotController {
  readonly rng: SeededRandom;
  readonly debug: { goal: string; targetId: number | null; path: string[]; stuckTicks: number } = { goal: 'patrol', targetId: null, path: [], stuckTicks: 0 };
  private observed: Observation | null = null;
  private nextReaction = 0;
  private nextPlan = 0;
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
  private lastPosition: Vec2 | null = null;
  private lastWantedMotion = false;
  private progressAnchor: Vec2 | null = null;
  private nextProgressCheck = 0;
  private wasAlive = false;

  constructor(seed = 12345) { this.rng = new SeededRandom(seed); }

  private canSee(world: World, fighter: Fighter, target: Fighter): boolean {
    const dx = target.x - fighter.x, dy = target.y - fighter.y;
    const distance = Math.hypot(dx, dy);
    if (distance > A.visionRange || !hasLineOfSight(world, fighter.x, fighter.y - 7, target.x, target.y - 7)) return false;
    for (const prop of world.props) {
      if (!prop.active || !prop.dynamic || prop.heldBy === fighter.id) continue;
      let near = 0, far = 1;
      for (const [origin, delta, min, max] of [[fighter.x, dx, prop.x - prop.width / 2, prop.x + prop.width / 2], [fighter.y - 7, dy, prop.y - prop.height / 2, prop.y + prop.height / 2]]) {
        if (Math.abs(delta) < 0.0001) { if (origin < min || origin > max) { near = 2; break; } continue; }
        const a = (min - origin) / delta, b = (max - origin) / delta;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      }
      if (near <= far && near < 0.99 && far > 0.01) return false;
    }
    return true;
  }

  private perceive(world: World, fighter: Fighter): void {
    const visible = world.fighters.filter(target => target !== fighter && target.alive && target.team !== fighter.team && this.canSee(world, fighter, target));
    visible.sort((a, b) => Math.hypot(a.x - fighter.x, a.y - fighter.y) - Math.hypot(b.x - fighter.x, b.y - fighter.y));
    const target = visible[0];
    if (target) {
      this.observed = { id: target.id, x: target.x, y: target.y, vx: target.vx, vy: target.vy, tick: world.tick };
      this.debug.targetId = target.id;
      this.aimOffset = this.rng.range(-A.aimError, A.aimError);
      const distance = Math.hypot(target.x - fighter.x, target.y - fighter.y);
      if (distance < 80 && target.action === 'melee-windup') this.defendUntil = world.tick + 12;
      this.rollNow = fighter.rollCooldown === 0 && target.action === 'shoot' && distance < 500 && this.rng.next() < 0.25;
    } else if (this.observed && world.tick - this.observed.tick > A.memoryTicks) {
      this.observed = null;
      this.debug.targetId = null;
    }
  }

  private chooseGoal(world: World, fighter: Fighter, visible: boolean): { point: Vec2; key: string; label: string } | null {
    const graph = world.navigation;
    if (!graph) return null;
    const totalAmmo = [fighter.combat.primary, fighter.combat.sidearm].reduce((sum, id) => sum + fighter.combat.ammo[id] + fighter.combat.reserve[id], 0);
    if (totalAmmo < 6) {
      const supply = world.pickups.filter(item => item.active).sort((a, b) => Math.hypot(a.x - fighter.x, a.y - fighter.y) - Math.hypot(b.x - fighter.x, b.y - fighter.y))[0];
      if (supply) return { point: supply, key: `pickup:${supply.id}`, label: 'seek ammunition' };
    }
    if (this.observed) {
      const target = this.observed;
      if (fighter.hp / fighter.maxHp < A.fleeHealthRatio && visible) {
        const desiredX = fighter.x + Math.sign(fighter.x - target.x || fighter.facing) * 400;
        const node = graph.nearest(desiredX, fighter.y);
        if (node) return { point: node, key: `flee:${node.id}`, label: 'retreat to cover' };
      }
      return { point: target, key: `enemy:${target.id}`, label: visible ? 'engage' : 'last seen / cover' };
    }
    const pickups = world.pickups.filter(item => item.active);
    pickups.sort((a, b) => Math.hypot(a.x - fighter.x, a.y - fighter.y) - Math.hypot(b.x - fighter.x, b.y - fighter.y));
    for (const pickup of pickups.slice(0, 4)) {
      if (Math.hypot(pickup.x - fighter.x, pickup.y - fighter.y) < 900) return { point: pickup, key: `pickup:${pickup.id}`, label: 'seek weapon' };
    }
    if (this.goal && this.goalKey.startsWith('patrol:') && Math.hypot(this.goal.x - fighter.x, this.goal.y - fighter.y) > 40) return { point: this.goal, key: this.goalKey, label: 'patrol' };
    const candidates = [...graph.nodes.values()].filter(node => Math.hypot(node.x - fighter.x, node.y - fighter.y) > 160 && Math.hypot(node.x - fighter.x, node.y - fighter.y) < 800);
    const node = candidates.length ? this.rng.pick(candidates) : graph.nearest(fighter.x + 200, fighter.y);
    return node ? { point: node, key: `patrol:${node.id}`, label: 'patrol' } : null;
  }

  private plan(world: World, fighter: Fighter, goal: { point: Vec2; key: string; label: string }): void {
    this.debug.goal = goal.label;
    const changed = goal.key !== this.goalKey;
    this.goal = { x: goal.point.x, y: goal.point.y };
    this.goalKey = goal.key;
    if (world.tick - this.lastPlan < 12 || (!changed && world.tick < this.nextPlan)) return;
    const path = world.navigation!.findPath(fighter, this.goal);
    this.debug.path = path.map(node => node.id);
    this.pathIndex = path.length > 1 ? 1 : 0;
    this.lastPlan = world.tick;
    this.nextPlan = world.tick + A.replanTicks;
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
      const ladder = world.arena.props.find(prop => (prop.type === 'ladder' || prop.type === 'rope') && Math.abs(fighter.x - prop.x - prop.width / 2) < prop.width / 2 + 12 && fighter.y > prop.y - fighter.height && fighter.y < prop.y + prop.height + fighter.height);
      const upward = ladder ? destination.y <= ladder.y + ladder.height / 2 : destination.y < fighter.y;
      const cleared = upward ? fighter.y <= destination.y - 4 : fighter.y >= destination.y - 3;
      if (cleared) { command.moveY = 0; command.moveX = Math.sign(dx || fighter.facing); }
      else { command.moveX = 0; command.moveY = upward ? -1 : 1; }
    }
    return edge;
  }

  command(world: World, fighter: Fighter): InputCommand {
    const command = neutralInput();
    if (!fighter.alive) { this.wasAlive = false; return command; }
    if (!this.wasAlive) {
      this.wasAlive = true; this.observed = null; this.debug.targetId = null;
      this.nextReaction = world.tick + A.reactionTicks; this.nextPlan = 0;
      this.lastPosition = { x: fighter.x, y: fighter.y }; this.debug.stuckTicks = 0;
      this.progressAnchor = { x: fighter.x, y: fighter.y }; this.nextProgressCheck = world.tick + 60;
    }
    if (world.tick >= this.nextReaction) { this.perceive(world, fighter); this.nextReaction = world.tick + A.reactionTicks; }
    const target = this.observed ? world.fighters.find(other => other.id === this.observed!.id && other.alive) : undefined;
    const visible = Boolean(target && this.canSee(world, fighter, target));
    if (!target && this.observed) { this.observed = null; this.debug.targetId = null; }
    const goal = this.chooseGoal(world, fighter, visible);
    if (goal) this.plan(world, fighter, goal);
    const edge = this.navigate(world, fighter, command);

    if (this.observed) {
      const observed = this.observed;
      const distance = Math.hypot(observed.x - fighter.x, observed.y - fighter.y);
      const lead = Math.min(0.055, distance / 15000);
      const aimAngle = Math.atan2(observed.y - fighter.y + observed.vy * lead, observed.x - fighter.x + observed.vx * lead) + this.aimOffset;
      command.aimX = Math.cos(aimAngle); command.aimY = Math.sin(aimAngle);
      const weapon = WEAPONS[equippedWeapon(fighter.combat)];
      const hasAmmo = (id: string): boolean => fighter.combat.ammo[id] + fighter.combat.reserve[id] > 0;
      const currentAmmo = hasAmmo(equippedWeapon(fighter.combat));
      if (visible && Math.abs(observed.y - fighter.y) < 65) {
        if (this.debug.goal === 'engage' && weapon?.kind === 'gun' && currentAmmo && distance > 65 && distance < A.preferredRange) command.moveX = 0;
        if (distance < 46) { command.attack = world.tick % 23 === 0; command.moveX = Math.sign(observed.x - fighter.x); }
        else if (weapon?.kind === 'gun') command.shoot = distance < weapon.range * 0.92;
        if (distance < 65 && this.defendUntil > world.tick) { command.block = true; command.attack = false; }
        if (this.rollNow && fighter.grounded) { command.roll = true; this.rollNow = false; }
      } else if (visible && weapon?.kind === 'gun') command.shoot = distance < weapon.range * 0.9;
      if ((fighter.combat.equipped === 'melee' && distance > 75) || (weapon?.kind === 'gun' && !currentAmmo)) {
        const slot = hasAmmo(fighter.combat.primary) ? 2 : hasAmmo(fighter.combat.sidearm) ? 3 : 4;
        command.switchWeapon = world.tick % 2 === 0 ? slot : 0;
      }
      if (!visible && distance > 120 && distance < 650 && fighter.combat.throwableCount > 0 && world.tick >= this.nextGrenade && world.tick - observed.tick < A.memoryTicks) {
        this.cookUntil = world.tick + A.grenadeCookTicks; this.nextGrenade = world.tick + A.grenadeCooldownTicks;
      }
      if (world.tick < this.cookUntil) { command.throw = true; command.aimY = Math.min(-0.32, command.aimY); command.shoot = false; }
    } else {
      command.aimX = command.moveX < 0 ? -1 : 1; command.aimY = 0;
    }

    const pickup = world.pickups.find(item => item.active && Math.hypot(item.x - fighter.x, item.y - fighter.y) < 43);
    if (pickup && world.tick % 18 === 0) command.interact = true;
    if (fighter.combat.heldProp !== null || fighter.combat.grabTarget !== null) command.attack = world.tick % 2 === 0;

    const danger = world.projectiles.find(projectile => projectile.active && projectile.kind === 'grenade' && projectile.life < 75 && Math.hypot(projectile.x - fighter.x, projectile.y - fighter.y) < A.hazardRange);
    const barrel = world.props.find(prop => prop.active && prop.type === 'barrel' && prop.hp < prop.maxHp && Math.hypot(prop.x - fighter.x, prop.y - fighter.y) < 150);
    if (danger || barrel) {
      const hazard = danger ?? barrel!;
      this.debug.goal = 'avoid blast'; command.moveX = Math.sign(fighter.x - hazard.x || fighter.facing);
      if (fighter.grounded && fighter.rollCooldown === 0) command.roll = true;
      if (danger && danger.life < 22 && fighter.grounded && world.tick >= this.nextJump) { this.jumpUntil = world.tick + 16; this.nextJump = world.tick + 35; }
    }
    if (world.tick < this.jumpUntil && edge?.kind !== 'climb') command.jump = true;
    if (fighter.ledge) command.moveY = -1;

    if (this.lastPosition && this.lastWantedMotion && Math.hypot(fighter.x - this.lastPosition.x, fighter.y - this.lastPosition.y) < 0.4 && fighter.combat.stunTicks === 0) this.debug.stuckTicks++;
    else if (Math.hypot(fighter.vx, fighter.vy) > 50) this.debug.stuckTicks = Math.max(0, this.debug.stuckTicks - 3);
    if (world.tick >= this.nextProgressCheck) {
      if (this.progressAnchor && this.lastWantedMotion && Math.hypot(fighter.x - this.progressAnchor.x, fighter.y - this.progressAnchor.y) < 18) this.debug.stuckTicks += 60;
      this.progressAnchor = { x: fighter.x, y: fighter.y }; this.nextProgressCheck = world.tick + 60;
    }
    const frontX = fighter.x + Math.sign(command.moveX || fighter.facing) * (fighter.width / 2 + 7);
    const wallAhead = world.terrain.atPixel(frontX, fighter.y) > 0;
    if (wallAhead && edge?.kind !== 'climb' && fighter.grounded && world.tick >= this.nextJump) { this.jumpUntil = world.tick + A.jumpHoldTicks; this.nextJump = world.tick + 50; command.jump = true; }
    if (this.debug.stuckTicks > A.stuckRecoverTicks) {
      this.debug.goal = 'clear blocked route';
      command.attack = world.tick % 23 === 0;
      command.aimX = Math.sign(command.moveX || fighter.facing); command.aimY = 0;
      command.shoot = wallAhead && fighter.combat.equipped !== 'melee';
      this.nextPlan = Math.min(this.nextPlan, world.tick + 1);
      if (fighter.grounded && world.tick >= this.nextJump) { this.jumpUntil = world.tick + A.jumpHoldTicks; this.nextJump = world.tick + 50; command.jump = true; }
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
    this.lastWantedMotion = Math.abs(command.moveX) > 0.1 || Math.abs(command.moveY) > 0.1;
    this.lastPosition = { x: fighter.x, y: fighter.y };
    return command;
  }
}
