import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { World } from '../src/sim/World';
import { NavigationGraph } from '../src/sim/ai/NavigationGraph';
import { TileMap } from '../src/sim/terrain/TileMap';
import type { ArenaData } from '../src/sim/types';

function arena(): ArenaData {
  const width = 80, height = 30, tileSize = 20, tiles = Array<number>(width * height).fill(0);
  for (let col = 0; col < width; col++) tiles[25 * width + col] = 6;
  return { id: 'soak-regression', name: 'Soak regression', subtitle: '', width, height, tileSize, tiles,
    spawns: [{ x: 400, y: 481 }, { x: 500, y: 481 }], props: [], weaponSpawns: [], background: '' };
}

describe('soak regressions', () => {
  it('launcher-only bots switch to melee and fight inside their explosive safety range', () => {
    const world = new World(arena(), 810, { timeLimit: 180, scoreLimit: 0, weaponSet: 'custom', customWeapons: ['grenade-launcher'] });
    const first = world.addFighter({ controller: 'bot' }), second = world.addFighter({ controller: 'bot' });
    let switched = false;
    for (let tick = 0; tick < 600; tick++) {
      world.step({});
      switched ||= first.combat.equipped === 'melee' && second.combat.equipped === 'melee';
    }
    expect(switched).toBe(true);
    expect(first.combat.damageDealt + second.combat.damageDealt).toBeGreaterThan(100);
    expect(first.combat.deaths + second.combat.deaths).toBeGreaterThan(0);
  });

  it('abandons a floating pickup after its supporting platform has disappeared', () => {
    const world = new World(arena(), 91, { timeLimit: 180, scoreLimit: 0 });
    world.pickups.push({ id: 0, x: 400, y: 220, kind: 'weapon', weapon: 'sniper', active: true, respawnTicks: 0 });
    const fighter = world.addFighter({ controller: 'bot', difficulty: 'expert' });
    let farthest = 0;
    for (let tick = 0; tick < 600; tick++) {
      world.step({});
      farthest = Math.max(farthest, Math.abs(fighter.x - 400));
      expect(world.bots.get(fighter.id)!.debug.goal).not.toBe('seek weapon');
    }
    expect(farthest).toBeGreaterThan(240);
    expect(world.pickups[0].active).toBe(true);
  });

  it('patrols off a small remnant island using the reachable lower floor', () => {
    const width = 120, height = 80, tileSize = 24, tiles = Array<number>(width * height).fill(0);
    for (let col = 0; col < width; col++) tiles[74 * width + col] = 6;
    for (let col = 85; col <= 91; col++) tiles[46 * width + col] = 6;
    // Nearby but upward-unreachable platforms dominate a random global shortlist.
    for (let row = 8; row <= 36; row += 7) for (let col = 55; col <= 115; col++) tiles[row * width + col] = 6;
    const world = new World({ ...arena(), width, height, tileSize, tiles, spawns: [{ x: 2191, y: 1085 }] }, 2275724963,
      { timeLimit: 180, scoreLimit: 0 });
    const fighter = world.addFighter({ controller: 'bot', difficulty: 'expert' });
    for (let tick = 0; tick < 600 && fighter.y < 1700; tick++) world.step({});
    expect(fighter.y).toBeGreaterThan(1700);
    expect(fighter.alive).toBe(true);
  });

  it('excavates a concrete cavity with ordinary melee commands and physically escapes', () => {
    // Captured rooftop cavity from seed29: a low ceiling, concrete left wall, and a pit to the right.
    const width = 80, height = 60, tileSize = 24, tiles = Array<number>(width * height).fill(0);
    const cavity = [
      '553355333........', '553355333........', '333333333......3.', '333333333......33',
      '553355333......33', '553355333......33', '333333333......33', '333333333......33',
      '55335..........33', '5533...........33', '33333..........33', '333333333......33',
      '55335.333......33', '553355333......33', '333333333......33', '333333333......33',
    ];
    cavity.forEach((line, row) => [...line].forEach((value, col) => { tiles[(row + 33) * width + col + 49] = value === '.' ? 0 : Number(value); }));
    for (let row = 49; row <= 51; row++) for (const col of [...Array.from({ length: 9 }, (_, i) => i + 49), 64, 65]) tiles[row * width + col] = row === 51 ? 6 : 3;
    const world = new World({ ...arena(), width, height, tileSize, tiles, spawns: [{ x: 1380, y: 1037 }] }, 29,
      { timeLimit: 180, scoreLimit: 0 });
    const fighter = world.addFighter({ controller: 'bot', difficulty: 'hard', character: 'wisp' });
    const originalTiles = world.terrain.tiles.filter(Boolean).length;
    let escaped = false;
    for (let tick = 0; tick < 600 && fighter.alive && !escaped; tick++) {
      world.step({});
      escaped = fighter.x <= 1380 - 96;
    }
    expect(escaped).toBe(true);
    expect(fighter.alive).toBe(true);
    expect(world.terrain.tiles.filter(Boolean).length).toBeLessThan(originalTiles);
  });

  it('queues changed navigation, removes invalid edges immediately, and completes in bounded node steps', () => {
    const map = new TileMap(arena()), graph = new NavigationGraph(map, []);
    const distant = graph.nodes.get('78,25');
    for (let col = 20; col <= 35; col++) map.set(col, 25, 0);
    graph.queueRepair(map.changedTiles.values());
    expect(graph.pendingRepairs).toBeGreaterThan(TUNING.ai.repairNodeBudget);
    expect(graph.nodes.has('25,25')).toBe(false);
    for (const node of graph.nodes.values()) for (const edge of node.edges) expect(graph.nodes.has(edge.to)).toBe(true);
    let steps = 0;
    while (graph.pendingRepairs && steps++ < 1000) expect(graph.stepRepair()).toBeLessThanOrEqual(TUNING.ai.repairNodeBudget);
    expect(graph.pendingRepairs).toBe(0);
    expect(graph.nodes.get('78,25')).toBe(distant);
    expect(graph.path('10,25', '40,25')).toEqual([]);
    for (let col = 20; col <= 35; col++) map.set(col, 25, 6);
    graph.queueRepair(map.changedTiles.values());
    while (graph.pendingRepairs) graph.stepRepair();
    expect(graph.path('10,25', '40,25').length).toBeGreaterThan(0);
    const rebuilt = new NavigationGraph(map, []);
    expect([...graph.nodes.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...rebuilt.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)));
  });
});
