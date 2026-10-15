import type { World } from '../sim/World';
import type { SimEvent } from '../sim/types';
const escape = (value:string):string => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class Hud {
  private lastTick=-1;
  private feed:{text:string;tick:number}[]=[];
  private announcement='';private announceUntil=0;
  constructor(private root:HTMLElement){}
  event(event:SimEvent,world:World):void {
    if(event.type==='knockout'||event.type==='ringout'){
      this.feed.unshift({text:event.text??'Fighter knocked out',tick:world.tick});this.feed=this.feed.slice(0,4);
      if(world.fighters.reduce((n,f)=>n+f.combat.kills,0)===1){this.announcement='FIRST BLOOD';this.announceUntil=world.tick+100;}
    }
  }
  update(world:World,force=false):void {
    if(!force&&world.tick-this.lastTick<3)return;this.lastTick=world.tick;
    const fighters=world.fighters.map((f,index)=>{
      const c=f.combat;const weapon=c[c.equipped];const hex=`#${f.color.toString(16).padStart(6,'0')}`;
      return `<article class="fighter-hud fighter-${index}" style="--fighter:${hex}"><div class="fighter-title"><span class="fighter-number">${index+1}</span><strong>${escape(f.name)}</strong><span>${f.controller==='bot'?f.difficulty.toUpperCase():index===0?'KB + MOUSE':'PAD / KB'}</span></div><div class="health-line"><b>${f.alive?Math.ceil(f.hp):'OUT'}</b><div class="health-track"><i style="width:${Math.max(0,f.hp/f.maxHp*100)}%"></i></div><small>HP</small></div><div class="loadout"><b>${escape(weapon.toUpperCase())}</b><span>${c.reloadTicks>0?'RELOADING':c.equipped==='melee'?'∞':`${c.ammo[weapon]??0} / ${c.reserve[weapon]??0}`}</span></div><div class="fighter-meta"><span>GRENADES <b>${c.throwableCount}</b></span><span>KO <b>${c.kills}</b> · FALLS <b>${c.deaths}</b></span></div><div class="special-track"><i style="width:${c.specialMeter}%"></i></div></article>`;
    }).join('');
    const feed=this.feed.filter(item=>world.tick-item.tick<360).map(item=>`<div>${escape(item.text)}</div>`).join('');
    this.root.innerHTML=`<div class="hud-players">${fighters}</div><div class="round-label"><span>COMBAT LAB</span><b>∞</b><small>IRONWORKS</small></div><div class="kill-feed">${feed}</div><div class="combat-hint">E PICK UP / GRAB &nbsp; · &nbsp; R CYCLE WEAPON &nbsp; · &nbsp; HOLD G TO COOK</div>`;
    if(this.announceUntil>world.tick)document.getElementById('announcer')!.textContent=this.announcement;
    else if(document.getElementById('announcer')!.textContent===this.announcement)document.getElementById('announcer')!.textContent='';
  }
}
