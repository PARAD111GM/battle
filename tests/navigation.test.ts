import { describe, expect, it } from 'vitest';
import warehouse from '../src/data/arenas/warehouse.json';
import { TUNING } from '../src/data/tuning';
import { NavigationGraph, type NavNode } from '../src/sim/ai/NavigationGraph';
import { aStar } from '../src/sim/ai/pathfinding';
import { overlapsTerrain } from '../src/sim/physics/aabb';
import { TileMap } from '../src/sim/terrain/TileMap';
import type { ArenaData, ArenaProp } from '../src/sim/types';

function arena(width = 28, height = 22, floor = 16): ArenaData {
  const tiles = Array<number>(width * height).fill(0);
  for (let col = 0; col < width; col++) tiles[floor * width + col] = 3;
  return { id: 'navigation-test', name: 'Navigation test', subtitle: '', width, height, tileSize: 20,
    tiles, spawns: [], props: [], weaponSpawns: [], background: '' };
}

function edgeKinds(route: NavNode[]): string[] {
  return route.slice(1).map((node, index) => {
    const edge = route[index].edges.find(candidate => candidate.to === node.id);
    expect(edge, `route edge ${route[index].id} -> ${node.id}`).toBeDefined();
    return edge!.kind;
  });
}

function node(id: string, x: number, y: number, edges: [string, number][] = []): NavNode {
  return { id, x, y, col: Math.floor(x / 20), row: Math.floor(y / 20),
    edges: edges.map(([to, cost]) => ({ to, cost, kind: 'walk' })) };
}

describe('weighted deterministic pathfinding', () => {
  it('finds the cheapest route after improving an already discovered node', () => {
    const nodes = new Map([
      ['start', node('start', 0, 0, [['goal', 12], ['bridge', 5], ['detour', 1]])],
      ['bridge', node('bridge', 10, 0, [['goal', 1]])],
      ['detour', node('detour', 0, 10, [['bridge', 1]])],
      ['goal', node('goal', 20, 0)],
    ]);
    const route = aStar(nodes, 'start', 'goal');
    expect(route.map(item => item.id)).toEqual(['start', 'detour', 'bridge', 'goal']);
    expect(route.reduce((cost, current, index) => index === 0 ? 0
      : cost + route[index - 1].edges.find(edge => edge.to === current.id)!.cost, 0)).toBe(3);
  });

  it('handles zero-cost cycles, unreachable goals, and missing endpoints', () => {
    const nodes = new Map([
      ['start', node('start', 0, 0, [['middle', 0], ['goal', 5]])],
      ['middle', node('middle', 100, 0, [['start', 0], ['goal', 1]])],
      ['goal', node('goal', 1, 0)],
      ['isolated', node('isolated', 30, 30)],
    ]);
    expect(aStar(nodes, 'start', 'goal').map(item => item.id)).toEqual(['start', 'middle', 'goal']);
    expect(aStar(nodes, 'start', 'start')).toEqual([nodes.get('start')]);
    expect(aStar(nodes, 'start', 'isolated')).toEqual([]);
    expect(aStar(nodes, 'missing', 'goal')).toEqual([]);
    expect(aStar(nodes, 'start', 'missing')).toEqual([]);
    expect(aStar(new Map(), 'missing', 'missing')).toEqual([]);
  });

  it('chooses the same equal-cost path independently of outgoing edge order', () => {
    const nodes = new Map([
      ['start', node('start', 0, 0, [['right', 1], ['left', 1]])],
      ['left', node('left', 20, -20, [['goal', 1]])],
      ['right', node('right', 20, 20, [['goal', 1]])],
      ['goal', node('goal', 40, 0)],
    ]);
    const first = aStar(nodes, 'start', 'goal').map(item => item.id);
    nodes.get('start')!.edges.reverse();
    expect(aStar(nodes, 'start', 'goal').map(item => item.id)).toEqual(first);
    expect(first).toHaveLength(3);
  });
});

describe('platform navigation graph', () => {
  it('places nodes on support tiles with full fighter clearance and links a flat floor', () => {
    const data = arena();
    data.tiles[14 * data.width + 5] = 3;
    const map = new TileMap(data), graph = new NavigationGraph(map, []);
    expect(graph.nodes.has('5,16')).toBe(false);
    expect(graph.nodes.has('5,14')).toBe(true);
    expect(graph.nodes.get('2,16')).toMatchObject({ col: 2, row: 16, x: 50, y: 301 });
    for (const point of graph.nodes.values()) {
      expect(map.isSolid(point.col, point.row), `${point.id} has support`).toBe(true);
      expect(overlapsTerrain(map, point.x, point.y, TUNING.fighter.width, TUNING.fighter.height), `${point.id} has clearance`).toBe(false);
    }
    const route = graph.path('10,16', '20,16');
    expect(route[0]?.id).toBe('10,16');
    expect(route.at(-1)?.id).toBe('20,16');
    expect(edgeKinds(route)).toContain('walk');
    expect(graph.nearest(50, 301)?.id).toBe('2,16');
  });

  it('routes across a short wall using a jump without permitting a walk through it', () => {
    const data = arena();
    for (let row = 13; row < 16; row++) data.tiles[row * data.width + 12] = 3;
    const graph = new NavigationGraph(new TileMap(data), []);
    const route = graph.path('4,16', '22,16');
    expect(route[0]?.id).toBe('4,16');
    expect(route.at(-1)?.id).toBe('22,16');
    expect(edgeKinds(route)).toContain('jump');
    expect(graph.nodes.get('11,16')?.edges.some(edge => edge.to === '13,16' && edge.kind === 'walk')).toBe(false);
  });

  it('does not find an impossible route through a wall reaching the arena ceiling', () => {
    const data = arena();
    for (let row = 0; row < 16; row++) data.tiles[row * data.width + 12] = 3;
    const graph = new NavigationGraph(new TileMap(data), []);
    expect(graph.path('4,16', '22,16')).toEqual([]);
    expect(graph.path('22,16', '4,16')).toEqual([]);
  });

  it('provides a safe drop route but rejects the physically unreachable reverse jump', () => {
    const data = arena();
    for (let col = 1; col <= 6; col++) data.tiles[6 * data.width + col] = 4;
    const graph = new NavigationGraph(new TileMap(data), []);
    const descending = graph.path('5,6', '10,16');
    expect(descending[0]?.id).toBe('5,6');
    expect(descending.at(-1)?.id).toBe('10,16');
    expect(edgeKinds(descending)).toContain('drop');
    expect(graph.path('10,16', '5,6')).toEqual([]);
  });

  it('catches a lower ledge across a gap beyond a standing-center jump landing', () => {
    const data = arena(50, 40);
    data.tileSize = 24;
    data.tiles.fill(0);
    data.tiles[27 * data.width + 40] = 4;
    data.tiles[30 * data.width + 29] = 4;
    const graph = new NavigationGraph(new TileMap(data), []);
    // The centers are 264px apart; catching the near edge saves 22px and gives
    // the falling fighter enough additional flight time to reach the platform.
    const route = graph.path('40,27', '29,30');
    expect(route.map(point => point.id)).toEqual(['40,27', '29,30']);
    expect(edgeKinds(route)).toEqual(['ledge']);
  });

  it.each(['ladder', 'rope'])('uses a %s to reach a platform above jump height', type => {
    const data = arena();
    for (let col = 4; col <= 10; col++) if (col !== 6) data.tiles[6 * data.width + col] = 4;
    const prop: ArenaProp = { id: 1, type, x: 120, y: 120, width: 20, height: 200 };
    const map = new TileMap(data);
    expect(new NavigationGraph(map, []).path('5,16', '5,6')).toEqual([]);
    const route = new NavigationGraph(map, [prop]).path('5,16', '5,6');
    expect(route[0]?.id).toBe('5,16');
    expect(route.at(-1)?.id).toBe('5,6');
    expect(edgeKinds(route)).toContain('climb');
  });

  it('connects every Warehouse spawn to every other through the authored routes', () => {
    const graph = new NavigationGraph(new TileMap(warehouse), warehouse.props);
    const kinds = new Set<string>();
    for (const from of warehouse.spawns) for (const to of warehouse.spawns) {
      const route = graph.findPath(from, to);
      expect(route.length, `Warehouse route (${from.x},${from.y}) -> (${to.x},${to.y})`).toBeGreaterThan(0);
      expect(route[0]?.id).toBe(graph.nearest(from.x, from.y)?.id);
      expect(route.at(-1)?.id).toBe(graph.nearest(to.x, to.y)?.id);
      for (const kind of edgeKinds(route)) kinds.add(kind);
    }
    expect(kinds.has('climb')).toBe(true);
  });

  it('repairs a destroyed floor locally, removes stale edges, and restores rebuilt terrain', () => {
    const map = new TileMap(arena(100)), graph = new NavigationGraph(map, []);
    const distant = graph.nodes.get('90,16');
    const beforeRevision = graph.revision;
    expect(graph.path('4,16', '35,16').length).toBeGreaterThan(0);
    for (let col = 10; col <= 25; col++) map.set(col, 16, 0);
    graph.repair(map.changedTiles.values());
    expect(graph.revision).toBeGreaterThan(beforeRevision);
    expect(graph.nodes.get('90,16')).toBe(distant);
    for (let col = 10; col <= 25; col++) expect(graph.nodes.has(`${col},16`)).toBe(false);
    for (const point of graph.nodes.values()) for (const edge of point.edges) {
      expect(graph.nodes.has(edge.to), `${point.id} retains only live destinations`).toBe(true);
    }
    expect(graph.path('4,16', '35,16')).toEqual([]);
    map.changedTiles.clear();
    for (let col = 10; col <= 25; col++) map.set(col, 16, 3);
    graph.repair(map.changedTiles.values());
    expect(graph.path('4,16', '35,16').length).toBeGreaterThan(0);
    expect(graph.nodes.get('90,16')).toBe(distant);
  });
});
