import type { SimEvent } from '../sim/types';
import type { World } from '../sim/World';

export interface AudioVolumes { master: number; sfx: number; music: number }
export interface AudioEngineOptions { contextFactory?: () => AudioContext; maxVoices?: number }
interface Voice { source: AudioScheduledSourceNode; nodes: AudioNode[]; end: number; channel: 'sfx' | 'music'; priority: number }
interface Sound { duration: number; frequency: number; endFrequency?: number; volume: number; wave?: OscillatorType; noise?: boolean; cutoff?: number; filter?: BiquadFilterType; delay?: number }

const DEFAULT_VOLUMES: AudioVolumes = { master: 0.8, sfx: 0.85, music: 0.35 };
const clamp = (value: number, fallback: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const GUNS: Record<string, Sound[]> = {
  pistol: [{ duration: 0.09, frequency: 190, endFrequency: 65, volume: 0.13, wave: 'triangle' }, { duration: 0.075, frequency: 0, noise: true, cutoff: 1900, volume: 0.1 }],
  smg: [{ duration: 0.045, frequency: 270, endFrequency: 110, volume: 0.09, wave: 'square' }, { duration: 0.045, frequency: 0, noise: true, cutoff: 3300, volume: 0.075 }],
  shotgun: [{ duration: 0.2, frequency: 95, endFrequency: 35, volume: 0.16, wave: 'triangle' }, { duration: 0.23, frequency: 0, noise: true, cutoff: 1100, volume: 0.19 }],
  assault: [{ duration: 0.095, frequency: 160, endFrequency: 48, volume: 0.12, wave: 'sawtooth', cutoff: 900 }, { duration: 0.11, frequency: 0, noise: true, cutoff: 2500, volume: 0.1 }],
  sniper: [{ duration: 0.3, frequency: 110, endFrequency: 28, volume: 0.18, wave: 'triangle' }, { duration: 0.19, frequency: 0, noise: true, cutoff: 4800, volume: 0.16 }],
  'grenade-launcher': [{ duration: 0.2, frequency: 120, endFrequency: 42, volume: 0.17, wave: 'sine' }, { duration: 0.13, frequency: 0, noise: true, cutoff: 420, volume: 0.12 }],
};

/** Asset-free Web Audio. Only unlock()/click(), called by UI gestures, create or resume a context. */
export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private sfx?: GainNode;
  private music?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private noise?: AudioBuffer;
  private volumes: AudioVolumes;
  private readonly voices = new Set<Voice>();
  private readonly recent = new Map<string, number>();
  private readonly footsteps = new Map<number, number>();
  private readonly maxVoices: number;
  private unlockPromise?: Promise<void>;
  private disposed = false;
  private paused = false;
  private granted = false;
  private playedVoices = 0;
  private droppedEvents = 0;
  private musicNotes = 0;
  private lastTick = -1;
  private nextBeat = 0;
  private musicStep = 0;

  constructor(volumes: Partial<AudioVolumes> = {}, private readonly options: AudioEngineOptions = {}) {
    this.volumes = { ...DEFAULT_VOLUMES };
    this.maxVoices = Math.max(8, Math.min(64, Math.floor(options.maxVoices ?? 40)));
    this.setVolumes(volumes);
  }

  get stats() {
    return { unlocked: this.granted && this.context?.state === 'running', paused: this.paused,
      activeVoices: this.voices.size, maxVoices: this.maxVoices, playedVoices: this.playedVoices,
      droppedEvents: this.droppedEvents, musicNotes: this.musicNotes, volumes: { ...this.volumes } };
  }

  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.unlockPromise) return this.unlockPromise;
    // Run context creation synchronously inside the gesture, before the first await.
    this.unlockPromise = this.openContext().finally(() => { this.unlockPromise = undefined; });
    return this.unlockPromise;
  }

  private async openContext(): Promise<void> {
    try {
      if (!this.context) {
        const Constructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!this.options.contextFactory && !Constructor) return;
        this.context = this.options.contextFactory ? this.options.contextFactory() : new Constructor!();
        this.createGraph(this.context);
      }
      const wasRunning = this.granted && this.context.state === 'running';
      if (this.context.state !== 'running') await this.context.resume();
      this.granted = this.context.state === 'running';
      if (!wasRunning) this.nextBeat = this.context.currentTime + 0.03;
    } catch {
      // Missing devices, policy denial, and interrupted contexts leave the game playable.
      this.granted = false;
    }
  }

  setVolumes(volumes: Partial<AudioVolumes>): void {
    for (const key of ['master', 'sfx', 'music'] as const) {
      if (volumes[key] !== undefined) this.volumes[key] = clamp(volumes[key]!, this.volumes[key]);
    }
    const now = this.context?.currentTime ?? 0;
    for (const [node, level] of [[this.master, this.volumes.master], [this.sfx, this.volumes.sfx], [this.music, this.volumes.music]] as const) {
      if (node) { node.gain.cancelScheduledValues(now); node.gain.setTargetAtTime(level, now, 0.018); }
    }
  }

  pause(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.stopVoices();
    else this.nextBeat = (this.context?.currentTime ?? 0) + 0.03;
  }

  reset(): void {
    this.stopVoices(); this.recent.clear(); this.footsteps.clear(); this.lastTick = -1;
    this.musicStep = 0; this.nextBeat = (this.context?.currentTime ?? 0) + 0.03;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.reset(); this.granted = false;
    for (const node of [this.master, this.sfx, this.music, this.compressor]) node?.disconnect();
    try { void this.context?.close().catch(() => undefined); } catch { /* Already closed contexts are harmless. */ }
    this.context = undefined; this.noise = undefined;
  }

  click(): void {
    void this.unlock().then(() => {
      if (!this.ready() || !this.admit('ui', 0.045)) return;
      this.play({ duration: 0.045, frequency: 650, endFrequency: 980, volume: 0.07, wave: 'sine' }, 0, 1, 'sfx', 3);
    });
  }

  event(event: SimEvent, world?: World): void {
    if (this.paused || !this.ready() || this.volumes.master * this.volumes.sfx <= 0) return;
    const { pan, gain } = this.position(event.x, world);
    const actor = event.fighterId ?? -1;
    switch (event.type) {
      case 'shot': {
        // Hitscan shotguns emit one event per pellet: play one report per weapon/actor.
        if (!this.admit(`shot:${actor}:${event.weapon}`, 0.035)) return;
        for (const sound of GUNS[event.weapon ?? 'pistol'] ?? GUNS.pistol) this.play(sound, pan, gain, 'sfx', 3);
        break;
      }
      case 'explosion': case 'slam':
        if (!this.admit(`blast:${Math.round(event.x / 180)}`, 0.09)) return;
        this.play({ duration: 0.65, frequency: 85, endFrequency: 25, volume: 0.23, wave: 'sine' }, pan, gain, 'sfx', 4);
        this.play({ duration: 0.55, frequency: 0, noise: true, cutoff: 850, volume: 0.25 }, pan, gain, 'sfx', 4);
        break;
      case 'hit':
        if (!this.admit(`hit:${actor}`, 0.065)) return;
        this.play({ duration: 0.085, frequency: 180, endFrequency: 70, volume: 0.09, wave: 'triangle' }, pan, gain, 'sfx', 2);
        this.play({ duration: 0.04, frequency: 0, noise: true, cutoff: 1600, volume: 0.05 }, pan, gain, 'sfx', 2);
        break;
      case 'melee': case 'throw': case 'roll':
        if (!this.admit(`${event.type}:${actor}`, 0.075)) return;
        this.play({ duration: event.type === 'melee' ? 0.13 : 0.18, frequency: 0, noise: true, filter: 'bandpass', cutoff: event.type === 'melee' ? 1150 : 600, volume: 0.075 }, pan, gain, 'sfx', 1);
        break;
      case 'tile-break': case 'collapse': case 'prop-break':
        if (!this.admit('breaks', 0.075)) return;
        this.materialBreak(event.type === 'prop-break' ? (event.text === 'barrel' ? 4 : 2) : event.amount ?? 3, pan, gain);
        break;
      case 'block': case 'guard-break': case 'door':
        if (!this.admit(`${event.type}:${actor}`, 0.09)) return;
        this.play({ duration: 0.16, frequency: event.type === 'door' ? 95 : 720, endFrequency: event.type === 'door' ? 55 : 490, volume: 0.09, wave: 'triangle' }, pan, gain, 'sfx', 2);
        break;
      case 'land':
        if (!this.admit(`land:${actor}`, 0.12)) return;
        this.play({ duration: 0.07, frequency: 65, endFrequency: 40, volume: 0.035 + 0.04 * Math.min(1, event.intensity ?? 0.3), wave: 'sine' }, pan, gain, 'sfx', 0);
        break;
      case 'jump':
        if (!this.admit(`jump:${actor}`, 0.1)) return;
        this.play({ duration: 0.085, frequency: 190, endFrequency: 280, volume: 0.035, wave: 'triangle' }, pan, gain, 'sfx', 0);
        break;
      case 'pickup': case 'special': case 'respawn':
        if (!this.admit(`${event.type}:${actor}`, 0.15)) return;
        this.play({ duration: 0.14, frequency: 440, endFrequency: 660, volume: 0.055, wave: 'sine' }, pan, gain, 'sfx', 2);
        this.play({ duration: 0.18, frequency: 880, volume: 0.04, wave: 'sine', delay: 0.07 }, pan, gain, 'sfx', 2);
        break;
      case 'knockout': case 'ringout': case 'match-end':
        if (!this.admit('knockout', 0.18)) return;
        this.play({ duration: 0.36, frequency: 330, endFrequency: 82, volume: 0.09, wave: 'triangle' }, pan, gain, 'sfx', 3);
        break;
      case 'reload':
        if (!this.admit(`reload:${actor}`, 0.2)) return;
        this.play({ duration: 0.045, frequency: 0, noise: true, cutoff: 2100, volume: 0.06 }, pan, gain, 'sfx', 1);
        this.play({ duration: 0.035, frequency: 400, volume: 0.045, wave: 'square', delay: 0.09 }, pan, gain, 'sfx', 1);
        break;
    }
  }

  update(world: World): void {
    if (this.paused || !this.ready()) return;
    this.prune();
    if (world.tick !== this.lastTick) {
      this.lastTick = world.tick;
      const now = this.context!.currentTime;
      for (const fighter of world.fighters) {
        if (!fighter.alive || !fighter.grounded || fighter.action !== 'run' || Math.abs(fighter.vx) < 80) continue;
        if (now - (this.footsteps.get(fighter.id) ?? -Infinity) < 0.21) continue;
        this.footsteps.set(fighter.id, now);
        const { pan, gain } = this.position(fighter.x, world);
        const material = world.terrain.atPixel(fighter.x, fighter.y + fighter.height / 2 + 1);
        this.play({ duration: 0.045, frequency: material === 4 ? 170 : 90, endFrequency: material === 4 ? 90 : 50, volume: 0.025, wave: 'triangle' }, pan, gain, 'sfx', 0);
      }
    }
    this.scheduleMusic();
  }

  private createGraph(context: AudioContext): void {
    this.master = context.createGain(); this.sfx = context.createGain(); this.music = context.createGain();
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -12; this.compressor.knee.value = 12; this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.003; this.compressor.release.value = 0.15;
    this.sfx.connect(this.compressor); this.music.connect(this.compressor); this.compressor.connect(this.master); this.master.connect(context.destination);
    this.master.gain.value = this.volumes.master; this.sfx.gain.value = this.volumes.sfx; this.music.gain.value = this.volumes.music;
    this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = this.noise.getChannelData(0);
    let seed = 0x54c2a19;
    for (let index = 0; index < samples.length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; samples[index] = seed / 0x80000000 - 1; }
  }

  private ready(): boolean { return !this.disposed && this.granted && this.context?.state === 'running'; }

  private admit(key: string, spacing: number): boolean {
    const now = this.context!.currentTime;
    if (now - (this.recent.get(key) ?? -Infinity) < spacing) { this.droppedEvents++; return false; }
    this.recent.set(key, now);
    // IDs are normally bounded to eight fighters; prune stale spatial blast keys too.
    if (this.recent.size > 160) for (const [oldKey, time] of this.recent) if (now - time > 2) this.recent.delete(oldKey);
    while (this.recent.size > 160) this.recent.delete(this.recent.keys().next().value!);
    return true;
  }

  private position(x: number, world?: World): { pan: number; gain: number } {
    if (!world || !Number.isFinite(x)) return { pan: 0, gain: 1 };
    const listeners = world.fighters.filter(fighter => fighter.alive && fighter.controller === 'human');
    const living = listeners.length ? listeners : world.fighters.filter(fighter => fighter.alive);
    const center = living.length ? living.reduce((sum, fighter) => sum + fighter.x, 0) / living.length : world.arena.width * world.arena.tileSize / 2;
    const offset = x - center;
    return { pan: Math.max(-0.75, Math.min(0.75, offset / 850)), gain: Math.max(0.28, 1 - Math.abs(offset) / 2200) };
  }

  private materialBreak(material: number, pan: number, gain: number): void {
    if (material === 5) {
      this.play({ duration: 0.22, frequency: 2150, endFrequency: 1650, volume: 0.045, wave: 'sine' }, pan, gain, 'sfx', 1);
      this.play({ duration: 0.15, frequency: 0, noise: true, filter: 'highpass', cutoff: 3300, volume: 0.08 }, pan, gain, 'sfx', 1);
    } else if (material === 4 || material === 6) {
      this.play({ duration: 0.24, frequency: 510, endFrequency: 430, volume: 0.075, wave: 'triangle' }, pan, gain, 'sfx', 1);
      this.play({ duration: 0.09, frequency: 0, noise: true, cutoff: 2500, volume: 0.055 }, pan, gain, 'sfx', 1);
    } else {
      this.play({ duration: material === 2 ? 0.12 : 0.2, frequency: 0, noise: true, cutoff: material === 2 ? 1250 : 550, volume: 0.12 }, pan, gain, 'sfx', 1);
      this.play({ duration: 0.09, frequency: material === 2 ? 155 : 75, endFrequency: 45, volume: 0.065, wave: 'triangle' }, pan, gain, 'sfx', 1);
    }
  }

  private play(sound: Sound, pan: number, gain: number, channel: 'sfx' | 'music', priority: number, at?: number): void {
    const context = this.context;
    if (!context || !this.ready() || this.volumes.master * this.volumes[channel] <= 0) return;
    this.prune();
    if (this.voices.size >= this.maxVoices) {
      let quietest: Voice | undefined;
      for (const voice of this.voices) if (!quietest || voice.priority < quietest.priority || (voice.priority === quietest.priority && voice.end < quietest.end)) quietest = voice;
      if (!quietest || quietest.priority > priority) { this.droppedEvents++; return; }
      this.release(quietest, true);
    }
    const start = Math.max(context.currentTime, at ?? context.currentTime) + (sound.delay ?? 0);
    const end = start + sound.duration;
    const source = sound.noise ? context.createBufferSource() : context.createOscillator();
    if (sound.noise) (source as AudioBufferSourceNode).buffer = this.noise!;
    else {
      const oscillator = source as OscillatorNode;
      oscillator.type = sound.wave ?? 'sine';
      oscillator.frequency.setValueAtTime(Math.max(1, sound.frequency), start);
      if (sound.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, sound.endFrequency), end);
    }
    const envelope = context.createGain(), panner = context.createStereoPanner();
    const filter = context.createBiquadFilter(); filter.type = sound.filter ?? 'lowpass';
    filter.frequency.value = Math.min(context.sampleRate / 2 - 100, sound.cutoff ?? 16000); filter.Q.value = 0.5;
    panner.pan.value = pan;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, sound.volume * gain), start + Math.min(0.006, sound.duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter); filter.connect(envelope); envelope.connect(panner); panner.connect(channel === 'sfx' ? this.sfx! : this.music!);
    const voice: Voice = { source, nodes: [source, filter, envelope, panner], end, channel, priority };
    source.onended = () => this.release(voice, false);
    this.voices.add(voice); this.playedVoices++;
    source.start(start); source.stop(end + 0.015);
  }

  private scheduleMusic(): void {
    if (!this.context || this.volumes.master * this.volumes.music <= 0) return;
    const now = this.context.currentTime, interval = 60 / 108 / 2;
    if (this.nextBeat < now - interval) this.nextBeat = now + 0.03;
    for (let count = 0; count < 4 && this.nextBeat < now + 0.13; count++) {
      const step = this.musicStep++ % 32, root = [45, 41, 48, 43][Math.floor(step / 8)];
      if (step % 4 === 0) {
        this.play({ duration: 0.65, frequency: 440 * 2 ** ((root - 69) / 12), volume: 0.038, wave: 'sine' }, 0, 1, 'music', 0, this.nextBeat);
        this.musicNotes++;
      }
      if (step % 2 === 0) {
        const note = root + 24 + [0, 7, 10, 3][(step / 2) % 4];
        this.play({ duration: 0.21, frequency: 440 * 2 ** ((note - 69) / 12), volume: 0.019, wave: 'triangle', cutoff: 1500 }, step % 4 ? 0.22 : -0.22, 1, 'music', 0, this.nextBeat);
        this.musicNotes++;
      } else this.play({ duration: 0.035, frequency: 0, noise: true, filter: 'highpass', cutoff: 7000, volume: 0.009 }, 0.1, 1, 'music', 0, this.nextBeat);
      this.nextBeat += interval;
    }
  }

  private prune(): void {
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) if (voice.end + 0.02 < now) this.release(voice, true);
  }

  private stopVoices(): void { for (const voice of this.voices) this.release(voice, true); }

  private release(voice: Voice, stop: boolean): void {
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) try { voice.source.stop(); } catch { /* A naturally ended source may already be stopped. */ }
    for (const node of voice.nodes) node.disconnect();
  }
}
