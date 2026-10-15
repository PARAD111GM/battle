import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import type { World } from '../src/sim/World';

class Parameter {
  value = 0;
  setValueAtTime(value: number) { this.value = value; }
  setTargetAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  disconnected = false;
  connect() {}
  disconnect() { this.disconnected = true; }
}
class Source extends Node {
  frequency = new Parameter();
  type = 'sine';
  buffer: unknown;
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: Array<number | undefined> = [];
  start(time: number) { this.starts.push(time); }
  stop(time?: number) { this.stops.push(time); }
}
class Context {
  currentTime = 0;
  state = 'suspended';
  sampleRate = 48000;
  destination = new Node();
  sources: Source[] = [];
  gains: Array<Node & { gain: Parameter }> = [];
  resumes = 0;
  closes = 0;
  deny = false;
  createGain() { const gain = Object.assign(new Node(), { gain: new Parameter() }); this.gains.push(gain); return gain; }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: new Parameter(), knee: new Parameter(), ratio: new Parameter(), attack: new Parameter(), release: new Parameter() }); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createOscillator() { const source = new Source(); this.sources.push(source); return source; }
  createBufferSource() { return this.createOscillator(); }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Parameter() }); }
  createBiquadFilter() { return Object.assign(new Node(), { type: 'lowpass', frequency: new Parameter(), Q: new Parameter() }); }
  async resume() { this.resumes++; if (this.deny) throw new Error('Autoplay denied'); this.state = 'running'; }
  async close() { this.closes++; this.state = 'closed'; }
}

function harness(music = 0, maxVoices = 40) {
  const context = new Context();
  let creations = 0;
  const engine = new AudioEngine({ master: 1, sfx: 1, music }, { maxVoices,
    contextFactory: () => { creations++; return context as unknown as AudioContext; } });
  return { engine, context, creations: () => creations };
}

function world(): World {
  return { tick: 1, arena: { width: 100, tileSize: 24 }, terrain: { atPixel: () => 4 },
    fighters: [{ id: 0, alive: true, controller: 'human', x: 200, y: 300, height: 38, grounded: true, action: 'run', vx: 180 }],
  } as unknown as World;
}

describe('gesture-gated procedural audio', () => {
  it('creates and resumes audio only through the explicit unlock path', async () => {
    const { engine, context, creations } = harness();
    engine.event({ type: 'shot', x: 0, y: 0, weapon: 'pistol' }); engine.update(world());
    expect(creations()).toBe(0);
    expect(engine.stats.unlocked).toBe(false);
    await engine.unlock();
    expect(creations()).toBe(1);
    expect(context.resumes).toBe(1);
    expect(engine.stats.unlocked).toBe(true);
    await engine.unlock();
    expect(context.resumes).toBe(1);
    engine.event({ type: 'shot', x: 0, y: 0, weapon: 'pistol' });
    expect(context.sources.length).toBeGreaterThan(0);
  });

  it('tolerates browser denial and retries on a later gesture without throwing', async () => {
    const { engine, context, creations } = harness();
    context.deny = true;
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.stats.unlocked).toBe(false);
    engine.event({ type: 'explosion', x: 0, y: 0 });
    expect(context.sources).toHaveLength(0);
    context.deny = false;
    await engine.unlock();
    expect(engine.stats.unlocked).toBe(true);
    expect(creations()).toBe(1);
    const unavailable = new AudioEngine({}, { contextFactory: () => { throw new Error('No output device'); } });
    await expect(unavailable.unlock()).resolves.toBeUndefined();
    expect(unavailable.stats.unlocked).toBe(false);
  });

  it('coalesces shotgun pellets and mass terrain destruction into bounded reports', async () => {
    const { engine, context } = harness();
    await engine.unlock();
    for (let pellet = 0; pellet < 7; pellet++) engine.event({ type: 'shot', x: pellet, y: 0, fighterId: 1, weapon: 'shotgun' });
    expect(context.sources).toHaveLength(2);
    for (let tile = 0; tile < 1000; tile++) engine.event({ type: 'tile-break', x: tile * 24, y: 0, amount: tile % 5 + 1 });
    expect(context.sources).toHaveLength(4);
    expect(engine.stats.droppedEvents).toBe(1005);
    context.currentTime = 0.1;
    engine.event({ type: 'tile-break', x: 0, y: 0, amount: 5 });
    expect(context.sources).toHaveLength(6);
  });

  it('limits concurrent voices and disconnects stolen or expired sources', async () => {
    const { engine, context } = harness(0, 8);
    await engine.unlock();
    for (let blast = 0; blast < 50; blast++) engine.event({ type: 'explosion', x: blast * 200, y: 0 });
    expect(engine.stats.activeVoices).toBe(8);
    expect(context.sources.filter(source => !source.disconnected)).toHaveLength(8);
    context.currentTime = 2;
    const state = world(); state.fighters.length = 0;
    engine.update(state);
    expect(engine.stats.activeVoices).toBe(0);
    expect(context.sources.every(source => source.disconnected)).toBe(true);
  });

  it('applies live independent volume buses and safely clamps bad settings', async () => {
    const { engine, context } = harness(0.4);
    await engine.unlock();
    engine.setVolumes({ master: 0.25, sfx: 0.6, music: 0.2 });
    expect(context.gains.slice(0, 3).map(node => node.gain.value)).toEqual([0.25, 0.6, 0.2]);
    engine.setVolumes({ master: 5, sfx: -3, music: NaN });
    expect(engine.stats.volumes).toEqual({ master: 1, sfx: 0, music: 0.2 });
    engine.event({ type: 'shot', x: 0, y: 0, weapon: 'pistol' });
    expect(context.sources).toHaveLength(0);
    engine.setVolumes({ sfx: 1, master: 0 });
    engine.update(world());
    expect(context.sources).toHaveLength(0);
  });

  it('uses a separate clock for restrained footsteps and avoids duplicate frame sounds', async () => {
    const { engine, context } = harness();
    const state = world();
    await engine.unlock();
    engine.update(state);
    expect(context.sources).toHaveLength(1);
    engine.update(state);
    context.currentTime = 0.1; state.tick++;
    engine.update(state);
    expect(context.sources).toHaveLength(1);
    context.currentTime = 0.3; state.tick++;
    engine.update(state);
    expect(context.sources).toHaveLength(2);
  });

  it('schedules actual original music voices and silences all match audio while paused', async () => {
    const { engine, context } = harness(0.4);
    const state = world(); state.fighters.length = 0;
    await engine.unlock(); engine.update(state);
    expect(engine.stats.musicNotes).toBe(2);
    expect(context.sources).toHaveLength(2);
    context.currentTime = 0.28; engine.update(state);
    context.currentTime = 0.56; engine.update(state);
    expect(engine.stats.musicNotes).toBeGreaterThan(2);
    const notes = engine.stats.musicNotes;
    engine.pause(true);
    expect(engine.stats.activeVoices).toBe(0);
    context.currentTime = 8;
    engine.update(state); engine.event({ type: 'explosion', x: 0, y: 0 });
    expect(engine.stats.musicNotes).toBe(notes);
    expect(engine.stats.activeVoices).toBe(0);
    engine.pause(false); engine.update(state);
    expect(engine.stats.activeVoices).toBeGreaterThan(0);
  });

  it('cleans up between matches and permits deliberate UI feedback in a paused menu', async () => {
    const { engine, context } = harness();
    await engine.unlock();
    engine.event({ type: 'explosion', x: 0, y: 0 });
    engine.reset();
    expect(engine.stats.activeVoices).toBe(0);
    engine.event({ type: 'explosion', x: 0, y: 0 });
    expect(engine.stats.activeVoices).toBe(2);
    engine.pause(true);
    engine.click(); await engine.unlock(); await Promise.resolve();
    expect(engine.stats.activeVoices).toBe(1);
    engine.dispose();
    expect(engine.stats.activeVoices).toBe(0);
    expect(context.closes).toBe(1);
    await engine.unlock(); engine.event({ type: 'shot', x: 0, y: 0 });
    expect(engine.stats.activeVoices).toBe(0);
    engine.dispose(); expect(context.closes).toBe(1);
  });
});
