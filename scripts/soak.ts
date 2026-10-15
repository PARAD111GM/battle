import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ARENAS } from '../src/data/arenas';
import { CHARACTERS } from '../src/data/characters';
import { TUNING } from '../src/data/tuning';
import { WORLD_TUNING } from '../src/data/worldTuning';
import { World } from '../src/sim/World';
import type { Fighter } from '../src/sim/types';
import type { MatchSettings } from '../src/sim/match/types';

interface Failure { kind: string; tick: number; fighter?: number; detail: unknown }
interface Progress { x: number; y: number; tick: number; damageDealt: number; hp: number; damage: number; deaths: number; flagged: boolean }
const MODES = ['deathmatch', 'team', 'stocks'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;
const round = (n: number): number => Math.round(n * 1000) / 1000;

function timings(samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number): number => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
  return { samples: samples.length, averageMs: round(samples.reduce((sum, n) => sum + n, 0) / Math.max(1, samples.length)),
    p95Ms: round(percentile(0.95)), p99Ms: round(percentile(0.99)), maximumMs: round(ordered.at(-1) ?? 0),
    over4ms: samples.filter(n => n > TUNING.performance.simWarningMs).length };
}

function progress(fighter: Fighter, tick: number): Progress {
  return { x: fighter.x, y: fighter.y, tick, damageDealt: fighter.combat.damageDealt, hp: fighter.hp,
    damage: fighter.damage, deaths: fighter.combat.deaths, flagged: false };
}

function settingsFor(index: number): MatchSettings {
  const heavy = index % 3 === 0;
  const mode = MODES[Math.floor(index / 4) % MODES.length];
  return { mode, damageMode: (index + Math.floor(index / 4)) % 2 === 0 ? 'health' : 'percent',
    timeLimit: 180 + index % 3 * 60, stocks: 3 + index % 2, scoreLimit: index % 10 === 0 ? 0 : mode === 'team' ? 20 : 10,
    friendlyFire: index % 2 === 0,
    weaponSet: heavy ? 'custom' : index % 11 === 0 ? 'melee' : 'all',
    customWeapons: heavy ? ['grenade-launcher', 'sledge', index % 2 ? 'molotov' : 'grenade'] : [] };
}

/** Independent progress monitor: 96 px of travel or real combat changes, not the bot's debug timer. */
function monitorProgress(world: World, fighter: Fighter, record: Progress): number {
  const travelled = Math.abs(fighter.x - record.x) >= 96
    || ((fighter.grounded || fighter.climbing) && Math.abs(fighter.y - record.y) >= 96);
  const combat = fighter.combat.damageDealt !== record.damageDealt || fighter.hp !== record.hp || fighter.damage !== record.damage;
  if (!fighter.alive || fighter.combat.deaths !== record.deaths || travelled || combat) Object.assign(record, progress(fighter, world.tick));
  return world.tick - record.tick;
}

async function runMatch(index: number) {
  const arena = ARENAS[index % ARENAS.length], settings = settingsFor(index), seed = (0x5eed1234 + Math.imul(index + 1, 2654435761)) >>> 0;
  const started = performance.now(), world = new World(arena, seed, settings);
  for (let id = 0; id < 8; id++) world.addFighter({ controller: 'bot', difficulty: DIFFICULTIES[(id + index) % 4],
    character: CHARACTERS[(Math.floor(id / 2) + index) % CHARACTERS.length].id, team: settings.mode === 'team' ? id % 2 : id,
    name: `${DIFFICULTIES[(id + index) % 4]} ${id + 1}` });
  const observers = world.fighters.map(fighter => progress(fighter, 0));
  const samples: number[] = [], failures: Failure[] = [];
  const maxPools = { projectiles: 0, effects: 0, barriers: 0, pickups: 0, debris: 0, chunks: 0, fire: 0, props: 0, nodes: 0, events: 0 };
  const limits = { projectiles: 128, effects: 64, barriers: 32, pickups: arena.weaponSpawns.length + arena.props.length + 128,
    debris: TUNING.debris.maxCount, chunks: WORLD_TUNING.structure.maxChunks, fire: WORLD_TUNING.fire.maxCells,
    props: arena.props.length + WORLD_TUNING.props.maxRagdolls, nodes: arena.width * arena.height, events: 4096 };
  const failedPools = new Set<string>();
  let maximumIdleTicks = 0, tileBreaks = 0, collapses = 0, explosions = 0, shots = 0, pickups = 0, recoveredEpisodes = 0;
  try {
    while (!world.match.ended && world.tick <= settings.timeLimit * TUNING.tickRate + 1) {
      const stepStarted = performance.now(); world.step({}); samples.push(performance.now() - stepStarted);
      for (const fighter of world.fighters) {
        if (![fighter.x, fighter.y, fighter.vx, fighter.vy, fighter.hp, fighter.damage, fighter.combat.damageDealt,
          fighter.combat.specialMeter, fighter.combat.aimX, fighter.combat.aimY].every(Number.isFinite)) throw Error(`Non-finite fighter ${fighter.id} state`);
        const observer = observers[fighter.id], flaggedBefore = observer.flagged;
        const idle = monitorProgress(world, fighter, observer);
        maximumIdleTicks = Math.max(maximumIdleTicks, idle);
        if (flaggedBefore && !observer.flagged) recoveredEpisodes++;
        if (idle > 10 * TUNING.tickRate && !observer.flagged) {
          failures.push({ kind: 'bot-stuck', tick: world.tick, fighter: fighter.id,
            detail: { idleTicks: idle, x: round(fighter.x), y: round(fighter.y), action: fighter.action, difficulty: fighter.difficulty,
              debug: { ...world.bots.get(fighter.id)!.debug, path: [...world.bots.get(fighter.id)!.debug.path] } } });
          observer.flagged = true;
        }
      }
      for (const body of [...world.projectiles, ...world.props, ...world.debris, ...world.structures.chunks]) {
        if (body.active && ![body.x, body.y, body.vx, body.vy].every(Number.isFinite)) throw Error(`Non-finite ${'kind' in body ? body.kind : 'body'} state`);
      }
      for (const point of [...world.effects, ...world.barriers, ...world.pickups, ...world.fire.cells.values()]) {
        if (![point.x, point.y].every(Number.isFinite)) throw Error('Non-finite area, barrier, pickup or fire position');
      }
      const pools = { projectiles: world.projectiles.length, effects: world.effects.length, barriers: world.barriers.length,
        pickups: world.pickups.length, debris: world.debris.length, chunks: world.structures.chunks.length, fire: world.fire.cells.size,
        props: world.props.length, nodes: world.navigation?.nodes.size ?? 0, events: world.events.length };
      for (const key of Object.keys(pools) as (keyof typeof pools)[]) {
        maxPools[key] = Math.max(maxPools[key], pools[key]);
        if (pools[key] > limits[key] && !failedPools.has(key)) {
          failedPools.add(key); failures.push({ kind: 'pool-limit', tick: world.tick, detail: { pool: key, actual: pools[key], limit: limits[key] } });
        }
      }
      for (const event of world.events) {
        tileBreaks += Number(event.type === 'tile-break'); collapses += Number(event.type === 'collapse');
        explosions += Number(event.type === 'explosion'); shots += Number(event.type === 'shot'); pickups += Number(event.type === 'pickup');
      }
    }
    if (!world.match.ended) failures.push({ kind: 'match-did-not-end', tick: world.tick, detail: world.match });
    if (!['time-limit', 'score-limit', 'last-standing'].includes(world.match.reason)) failures.push({ kind: 'invalid-match-end', tick: world.tick, detail: world.match });
  } catch (error) { failures.push({ kind: 'exception', tick: world.tick, detail: error instanceof Error ? error.stack : String(error) }); }
  return { index, arena: arena.id, seed, settings, fighters: world.fighters.map(fighter => ({ id: fighter.id, difficulty: fighter.difficulty, character: fighter.character })),
    completed: world.match.ended, simulatedSeconds: round(world.tick / TUNING.tickRate), wallSeconds: round((performance.now() - started) / 1000),
    result: world.results(), timing: timings(samples), maximumIdleSeconds: round(maximumIdleTicks / TUNING.tickRate), recoveredEpisodes,
    destruction: { tileBreaks, collapses, explosions, shots, pickups }, maxPools, poolLimits: limits, failures, samples };
}

export async function main(args: string[]): Promise<number> {
  const arg = (name: string, fallback: string): string => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const matches = Number(arg('matches', '50')), start = Number(arg('start', '0')), output = resolve(arg('output', 'test-results/soak.json'));
  if (!Number.isInteger(matches) || matches < 1 || matches > 1000 || !Number.isInteger(start) || start < 0) throw Error('Use --matches=1..1000 and --start=0..n');
  const results: Omit<Awaited<ReturnType<typeof runMatch>>, 'samples'>[] = [], allSamples: number[] = [];
  const started = performance.now();
  const report = () => { const performanceSummary = timings(allSamples); return ({ schemaVersion: 1, generatedAt: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch }, requestedMatches: matches, completedMatches: results.filter(result => result.completed).length,
    passed: results.length === matches && results.every(result => result.completed && result.failures.length === 0),
    wallSeconds: round((performance.now() - started) / 1000), totalSimulatedSeconds: round(results.reduce((sum, result) => sum + result.simulatedSeconds, 0)),
    progressMetric: 'Independent 10-second monitor. Meaningful progress is >=96 horizontal pixels, >=96 vertical pixels while grounded/climbing, or actual damage dealt/received. Dead/respawning/eliminated fighters are exempt. Airborne jump-in-place, debug timer resets, firing without hits, and repeated failed interactions do not count.',
    configuration: 'Eight seeded bots per match; all four difficulties and characters. Four arenas, three modes, both damage models, 180/240/300-second real timers and score/stock endings. Every third match uses grenade-launcher plus explosives. No simulation intervention or synthetic ending.',
    performance: performanceSummary, warnings: performanceSummary.over4ms ? [`${performanceSummary.over4ms} simulation ticks exceeded the ${TUNING.performance.simWarningMs} ms budget; includes garbage collection and host scheduling.`] : [],
    failures: results.reduce((sum, result) => sum + result.failures.length, 0), matches: results }); };
  await mkdir(dirname(output), { recursive: true });
  console.log(`Soak: ${matches} eight-bot matches, starting index ${start}.`);
  for (let offset = 0; offset < matches; offset++) {
    const { samples, ...result } = await runMatch(start + offset);
    for (const sample of samples) allSamples.push(sample);
    results.push(result);
    await writeFile(output, `${JSON.stringify(report(), null, 2)}\n`);
    console.log(`${offset + 1}/${matches} ${result.arena} ${result.settings.mode}/${result.settings.damageMode} ${result.simulatedSeconds}s ${result.result.reason || 'FAILED'}: ${result.failures.length} failures, avg ${result.timing.averageMs}ms p95 ${result.timing.p95Ms}ms, ${result.destruction.tileBreaks + result.destruction.collapses} tiles destroyed`);
    if (result.failures.length) console.log(JSON.stringify(result.failures.slice(0, 3)));
    if (args.includes('--stop-on-failure') && result.failures.length) break;
  }
  const final = report();
  console.log(`Soak ${final.passed ? 'PASS' : 'FAIL'}: ${final.completedMatches}/${matches} matches complete, ${final.failures} failures. ${output}`);
  console.log(`Simulation avg/p95/p99/max: ${final.performance.averageMs}/${final.performance.p95Ms}/${final.performance.p99Ms}/${final.performance.maximumMs} ms; ${final.performance.over4ms} ticks >4ms.`);
  return final.passed ? 0 : 1;
}
