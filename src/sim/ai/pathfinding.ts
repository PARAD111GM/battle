import type { NavNode } from './NavigationGraph';

interface QueueEntry {
  id: string;
  cost: number;
  priority: number;
}

/** Stable ordering independent of the host's locale or insertion order. */
function precedes(a: QueueEntry, b: QueueEntry): boolean {
  if (a.priority !== b.priority) return a.priority < b.priority;
  if (a.id !== b.id) return a.id < b.id;
  return a.cost < b.cost;
}

class MinHeap {
  private readonly entries: QueueEntry[] = [];

  push(entry: QueueEntry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!precedes(entry, this.entries[parent])) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): QueueEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!last || this.entries.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.entries.length) break;
      const right = left + 1;
      const child = right < this.entries.length
        && precedes(this.entries[right], this.entries[left]) ? right : left;
      if (!precedes(this.entries[child], last)) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

/** Nonnegative finite edge costs are the valid domain for A*. */
function validCost(cost: number): boolean {
  return Number.isFinite(cost) && cost >= 0;
}

function heuristicScale(nodes: ReadonlyMap<string, NavNode>): number {
  let scale = Infinity;
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      const next = nodes.get(edge.to);
      if (!next || !validCost(edge.cost)) continue;
      const distance = Math.hypot(next.x - node.x, next.y - node.y);
      // Unknown geometry cannot provide a safe lower bound on route cost.
      if (!Number.isFinite(distance)) return 0;
      if (distance > 0) scale = Math.min(scale, edge.cost / distance);
      if (scale === 0) return 0;
    }
  }
  return Number.isFinite(scale) ? scale : 0;
}

/** Returns an optimal path including both endpoints, or [] if unreachable. */
export function aStar(
  nodes: ReadonlyMap<string, NavNode>,
  fromId: string,
  toId: string,
): NavNode[] {
  const start = nodes.get(fromId);
  const goal = nodes.get(toId);
  if (!start || !goal) return [];
  if (fromId === toId) return [start];

  // Scaling by the cheapest cost per unit distance keeps custom edge weights
  // admissible. A zero-cost edge falls back to Dijkstra's algorithm.
  const scale = heuristicScale(nodes);
  const heuristic = (node: NavNode): number => scale === 0 ? 0
    : Math.hypot(goal.x - node.x, goal.y - node.y) * scale;
  const costs = new Map<string, number>([[fromId, 0]]);
  const previous = new Map<string, string>();
  const open = new MinHeap();
  open.push({ id: fromId, cost: 0, priority: heuristic(start) });

  for (let entry = open.pop(); entry; entry = open.pop()) {
    // An improved route leaves its older queue entry behind.
    if (entry.cost !== costs.get(entry.id)) continue;
    const current = nodes.get(entry.id)!;
    if (entry.id === toId) {
      const path: NavNode[] = [current];
      let id = entry.id;
      while (id !== fromId) {
        id = previous.get(id)!;
        path.push(nodes.get(id)!);
      }
      return path.reverse();
    }

    for (const edge of current.edges) {
      const next = nodes.get(edge.to);
      if (!next || !validCost(edge.cost)) continue;
      const cost = entry.cost + edge.cost;
      if (!Number.isFinite(cost) || cost >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, cost);
      previous.set(edge.to, entry.id);
      open.push({ id: edge.to, cost, priority: cost + heuristic(next) });
    }
  }
  return [];
}
