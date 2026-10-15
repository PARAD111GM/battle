import type { World } from '../sim/World';
import type { SimEvent } from '../sim/types';
const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const label = (value: string): string => value.replaceAll('-', ' ').replaceAll('_', ' ').toUpperCase();
export class Hud {
  private lastTick = -100;
  private feed: { text: string; tick: number }[] = [];
  private announcement = '';
  private announceUntil = 0;
  private firstBlood = false;
  private lastKills = new Map<number, number>();
  constructor(private root: HTMLElement) {}
  reset(): void {
    this.lastTick = -100; this.feed = []; this.announcement = ''; this.announceUntil = 0;
    this.firstBlood = false; this.lastKills.clear(); this.root.innerHTML = '';
  }
  event(event: SimEvent, world: World): void {
    if (event.type !== 'knockout' && event.type !== 'ringout') return;
    this.feed.unshift({ text: event.text ?? 'Fighter knocked out', tick: world.tick }); this.feed.length = Math.min(4, this.feed.length);
    const target = world.fighters.find(f => f.id === event.fighterId);
    const killer = world.fighters.find(f => f.id === target?.combat.lastHitBy && f !== target);
    if (!killer) return;
    const previous = this.lastKills.get(killer.id);
    if (previous !== undefined && world.tick - previous <= 240) { this.announcement = 'DOUBLE KILL'; this.announceUntil = world.tick + 100; }
    else if (!this.firstBlood) { this.announcement = 'FIRST BLOOD'; this.announceUntil = world.tick + 110; }
    this.firstBlood = true; this.lastKills.set(killer.id, world.tick);
  }
  update(world: World, force = false): void {
    if (!force && world.tick - this.lastTick < 6) return;
    this.lastTick = world.tick;
    const percent = world.settings.damageMode === 'percent';
    const stocks = world.settings.mode === 'stocks';
    const fighters = world.fighters.map((f, index) => {
      const c = f.combat, weapon = c[c.equipped], hex = `#${f.color.toString(16).padStart(6, '0')}`;
      const value = f.alive ? Math.ceil(percent ? f.damage : f.hp) : stocks && f.stocks === 0 ? 'OUT' : `${Math.ceil(f.respawnTicks / 60)}s`;
      const width = Math.max(0, Math.min(100, percent ? f.damage / 3 : f.hp / f.maxHp * 100));
      const ammunition = c.reloadTicks > 0 ? 'RELOADING' : c.equipped === 'melee' ? !Number.isFinite(c.durability?.[weapon]) ? '∞' : `${Math.ceil(c.durability[weapon])} DUR` : `${c.ammo[weapon] ?? 0} / ${c.reserve[weapon] ?? 0}`;
      return `<article class="fighter-hud fighter-${index}" style="--fighter:${hex}"><div class="fighter-title"><span class="fighter-number">${index + 1}</span><strong>${escape(f.name)}</strong><span>${f.controller === 'bot' ? escape(f.difficulty.toUpperCase()) : 'LOCAL'}</span></div><div class="health-line"><b>${value}</b><div class="health-track"><i style="width:${width}%"></i></div><small>${percent ? '%' : 'HP'}</small></div><div class="loadout"><b>${escape(label(weapon))}</b><span>${ammunition}</span></div><div class="fighter-meta"><span>${escape(label(c.throwable))} <b>${c.throwableCount}</b></span><span>${stocks ? `LIVES <b>${f.stocks}</b>` : `KO <b>${c.kills}</b> · FALLS <b>${c.deaths}</b>`}</span></div><div class="fighter-meta"><span>${c.specialMeter >= 100 ? 'SPECIAL READY · Q / Y' : 'SPECIAL CHARGE'}</span><span>${Math.floor(c.specialMeter)}%</span></div><div class="special-track ${c.specialMeter >= 100 ? 'ready' : ''}"><i style="width:${Math.min(100, c.specialMeter)}%"></i></div></article>`;
    }).join('');
    this.feed = this.feed.filter(item => world.tick - item.tick < 360);
    const feed = this.feed.map(item => `<div>${escape(item.text)}</div>`).join('');
    const seconds = Math.max(0, Math.ceil(world.settings.timeLimit - world.match.elapsedTicks / 60));
    const timer = world.settings.timeLimit === 0 ? '∞' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const modes = { deathmatch: 'DEATHMATCH', team: 'TEAM BATTLE', stocks: 'LAST FIGHTER STANDING' };
    this.root.innerHTML = `<div class="hud-players" data-count="${world.fighters.length}">${fighters}</div><div class="round-label"><span>${modes[world.settings.mode]}</span><b>${timer}</b><small>${escape(world.arena.name.toUpperCase())}</small></div><div class="kill-feed">${feed}</div><div class="combat-hint">E PICK UP / GRAB &nbsp; · &nbsp; R CYCLE &nbsp; · &nbsp; HOLD G TO COOK &nbsp; · &nbsp; ESC PAUSE</div>`;
    const announcer = document.getElementById('announcer');
    if (announcer) announcer.textContent = this.announceUntil > world.tick ? this.announcement : '';
  }
}
