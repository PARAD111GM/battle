import Phaser from 'phaser';
import { TUNING } from '../data/tuning';
import type { World } from '../sim/World';
import type { InputCommand, SimEvent } from '../sim/types';
import { AssetLibrary } from './AssetLibrary';
import { FighterView } from './FighterView';
import { CombatView } from './CombatView';
import { TerrainView } from './TerrainView';
import { PropsView } from './PropsView';
import { BotDebugView } from './BotDebugView';
import { drawBackdrop } from './Backdrop';
import { WorldEffectsView } from './WorldEffectsView';

interface Particle { active: boolean; x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: number }

export class ArenaScene extends Phaser.Scene {
  public paused = false;
  public debug = false;
  public navDebug = false;
  public onTick?: () => void;
  private accumulator = 0;
  public terrainView!: TerrainView;
  private effectsArt!: Phaser.GameObjects.Graphics;
  private debugArt!: Phaser.GameObjects.Graphics;
  private debugText!: Phaser.GameObjects.Text;
  private readonly views = new Map<number, FighterView>();
  private readonly particles: Particle[] = Array.from({ length: 256 }, () => ({active:false,x:0,y:0,vx:0,vy:0,life:0,maxLife:0,size:0,color:0}));
  private nextParticle = 0;
  private focusX = 0;
  private focusY = 0;
  private visualTime = 0;
  private combatView!: CombatView;
  private propsView!: PropsView;
  private botDebugView!: BotDebugView;
  public worldEffectsView!: WorldEffectsView;

  constructor(public world: World, private readonly getCommands: () => Record<number, InputCommand>) {
    super({ key: 'ArenaScene' });
  }

  preload(): void { AssetLibrary.preload(this); }

  create(): void {
    this.accumulator=0;this.visualTime=0;this.nextParticle=0;
    for(const particle of this.particles)particle.active=false;
    AssetLibrary.create(this);
    this.cameras.main.setBackgroundColor('#111c26');
    drawBackdrop(this,this.world.arena);
    this.terrainView = new TerrainView(this, this.world.terrain);
    this.effectsArt = this.add.graphics().setDepth(30);
    this.combatView = new CombatView(this, this.world);
    this.propsView = new PropsView(this, this.world);
    this.botDebugView = new BotDebugView(this,this.world);
    this.worldEffectsView=new WorldEffectsView(this,this.world);
    this.debugArt = this.add.graphics().setDepth(45);
    this.debugText = this.add.text(16, 16, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#c8ffee', backgroundColor: '#0d1825', padding: {x:12,y:10},
    }).setOrigin(1, 0).setDepth(100).setVisible(false);
    const first = this.world.fighters[0] ?? this.world.arena.spawns[0];
    this.focusX = first?.x ?? 600; this.focusY = (first?.y ?? 500) - 120;
    this.cameras.main.setZoom(this.cameraZoom()).centerOn(this.focusX, this.focusY);
    const onF1 = (event: KeyboardEvent) => { event.preventDefault(); this.debug = !this.debug; };
    const onF2 = (event: KeyboardEvent) => { event.preventDefault(); this.navDebug = !this.navDebug; };
    this.input.keyboard?.on('keydown-F1', onF1);
    this.input.keyboard?.on('keydown-F2', onF2);
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-F1', onF1);
      this.input.keyboard?.off('keydown-F2', onF2);
      this.scale.off('resize', this.onResize, this);
      for (const view of this.views.values()) view.destroy();
      this.views.clear();
      this.combatView.destroy();
      this.terrainView.destroy();
      this.propsView.destroy();
      this.botDebugView.destroy();
      this.worldEffectsView.destroy();
    });
    this.updateCamera(true);
    this.terrainView.update(this.cameras.main);
  }

  update(_time: number, delta: number): void {
    const elapsed = Math.min(delta, 100);
    if (!this.paused) {
      this.visualTime += elapsed;
      this.accumulator += elapsed;
      const fixedMs = 1000 / TUNING.tickRate;
      let steps = 0;
      while (!this.paused && this.accumulator >= fixedMs && steps < TUNING.performance.maxFrameSteps) {
        const began = performance.now();
        this.world.step(this.getCommands());
        if (performance.now() - began > TUNING.performance.simWarningMs && this.world.tick % 120 === 0) {
          console.warn('Simulation tick exceeded its 4 ms budget');
        }
        for (const event of this.world.events) this.visualEvent(event);
        this.events.emit('simtick');
        this.onTick?.();
        this.accumulator -= fixedMs; steps++;
      }
      if (steps === TUNING.performance.maxFrameSteps) this.accumulator = 0;
      this.updateParticles(elapsed / 1000);
    } else this.accumulator = 0;
    this.combatView.update(this.visualTime, this.paused ? 0 : elapsed / 1000);
    for (const fighter of this.world.fighters) {
      let view = this.views.get(fighter.id);
      if (!view) { view = new FighterView(this, fighter); this.views.set(fighter.id, view); }
      view.update(fighter, this.visualTime);
      if (!this.paused && fighter.grounded && fighter.action === 'run' && this.world.tick % 8 === 0 && delta > 0) {
        this.emitDust(fighter.x - fighter.facing * 6, fighter.y + fighter.height / 2, 1, 0x8fa69b, 0.45);
      }
    }
    this.updateCamera();
    this.terrainView.update(this.cameras.main);
    this.propsView.update(this.visualTime,this.debug);
    this.botDebugView.update(this.navDebug);
    this.worldEffectsView.update(this.visualTime);
    this.drawDebug();
  }

  private onResize(): void { this.updateCamera(true); }

  private cameraZoom(): number {
    const living = this.world.fighters.filter(fighter => fighter.alive);
    const spanX = living.length > 1 ? Math.max(...living.map(f => f.x)) - Math.min(...living.map(f => f.x)) : 0;
    const spanY = living.length > 1 ? Math.max(...living.map(f => f.y)) - Math.min(...living.map(f => f.y)) : 0;
    return Phaser.Math.Clamp(Math.min(this.scale.width / Math.max(1160, spanX + TUNING.camera.padding * 2), this.scale.height / Math.max(650, spanY + TUNING.camera.padding * 2)), TUNING.camera.minZoom, TUNING.camera.maxZoom);
  }

  private updateCamera(immediate = false): void {
    const living = this.world.fighters.filter(fighter => fighter.alive);
    const camera = this.cameras.main;
    const zoom = this.cameraZoom();
    const lerp = immediate ? 1 : TUNING.camera.lerp;
    camera.setZoom(Phaser.Math.Linear(camera.zoom, zoom, lerp));
    if (living.length) {
      const minX = Math.min(...living.map(f => f.x)); const maxX = Math.max(...living.map(f => f.x));
      const minY = Math.min(...living.map(f => f.y)); const maxY = Math.max(...living.map(f => f.y));
      const width = this.world.arena.width * this.world.arena.tileSize;
      const height = this.world.arena.height * this.world.arena.tileSize;
      const halfW = this.scale.width / camera.zoom / 2;
      const halfH = this.scale.height / camera.zoom / 2;
      const targetX = Phaser.Math.Clamp((minX + maxX) / 2, Math.min(halfW, width / 2), Math.max(width - halfW, width / 2));
      const targetY = Phaser.Math.Clamp((minY + maxY) / 2 - 120, Math.min(halfH, height / 2), Math.max(height - halfH - 40, height / 2));
      this.focusX = Phaser.Math.Linear(this.focusX, targetX, lerp);
      this.focusY = Phaser.Math.Linear(this.focusY, targetY, lerp);
    }
    camera.centerOn(this.focusX, this.focusY);
  }

  private visualEvent(event: SimEvent): void {
    this.combatView.event(event);
    if (event.type === 'land') this.emitDust(event.x, event.y, 10, 0xb4baa0, Math.min(1.5, event.intensity ?? 1));
    if (event.type === 'jump') this.emitDust(event.x, event.y + 18, 6, 0xb5b49b, 0.7);
    if (event.type === 'roll') this.emitDust(event.x, event.y + 16, 8, 0xadbaaa, 0.9);
    if (event.type === 'ledge') this.emitDust(event.x, event.y, 4, 0xc5d8b2, 0.55);
    if (event.type === 'respawn') this.emitDust(event.x, event.y, 16, 0x8ef4d1, 1.2);
    if (event.type === 'tile-break') this.emitDust(event.x,event.y,5,event.color??0xa8ac91,1.1);
    if (event.type === 'prop-break') this.emitDust(event.x,event.y,14,event.color??0xc49b68,1.7);
  }

  private emitDust(x: number, y: number, count: number, color: number, force: number): void {
    for (let index = 0; index < count; index++) {
      const particle = this.particles[this.nextParticle++ % this.particles.length];
      Object.assign(particle, {active:true,x:x+(Math.random()-0.5)*14,y:y-2,vx:(Math.random()-0.5)*150*force,vy:-Math.random()*85*force,life:0.2+Math.random()*0.25,maxLife:0.45,size:2+Math.random()*4,color});
    }
  }

  private updateParticles(dt: number): void {
    const g = this.effectsArt; g.clear();
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {particle.active = false;continue;}
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += 120 * dt;
      g.fillStyle(particle.color, particle.life / particle.maxLife * 0.6).fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
  }

  private drawDebug(): void {
    const g = this.debugArt; g.clear(); this.debugText.setVisible(this.debug);
    if (!this.debug) return;
    const camera = this.cameras.main;
    this.debugText.setScale(1 / camera.zoom).setPosition(camera.worldView.right - 28 / camera.zoom, camera.worldView.top + 180 / camera.zoom);
    for (const fighter of this.world.fighters) {
      if (!fighter.alive) continue;
      g.lineStyle(1, 0x8bffbe).strokeRect(fighter.x - fighter.width / 2, fighter.y - fighter.height / 2, fighter.width, fighter.height);
      g.lineStyle(2, 0xffb66d).lineBetween(fighter.x, fighter.y, fighter.x + fighter.vx * 0.15, fighter.y + fighter.vy * 0.15);
      if (fighter.ledge) g.fillStyle(0xff8f9a).fillCircle(fighter.ledge.x, fighter.ledge.y, 4);
    }
    for (const hitbox of this.world.hitboxes) g.lineStyle(1, 0xff705c).strokeRect(hitbox.x-hitbox.width/2,hitbox.y-hitbox.height/2,hitbox.width,hitbox.height);
    const first = this.world.fighters[0];
    const terrain=this.terrainView.stats;
    this.debugText.setText([`SIM ${this.world.tick} · ${Math.round(this.game.loop.actualFps)} FPS · 60 HZ`, `STATE ${first?.action ?? '—'} · ${first?.grounded ? 'GROUND' : 'AIR'}`,`VELOCITY ${first?.vx.toFixed(0) ?? 0}, ${first?.vy.toFixed(0) ?? 0}`,`CHUNKS ${terrain.visible}/${terrain.total} · REBUILDS ${terrain.rebuilds}`,`F1  HIDE DEBUG`]);
  }
}
