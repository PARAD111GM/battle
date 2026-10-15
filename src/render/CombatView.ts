import Phaser from 'phaser';
import type { World } from '../sim/World';
import type { SimEvent } from '../sim/types';
import { GRENADE, THROWABLES } from '../data/combat';
import { WEAPONS } from '../sim/weapons/definitions';
import { drawWeaponArt, drawThrowableArt } from './WeaponArt';
import { TUNING } from '../data/tuning';

interface Effect { active: boolean; kind: 'trace'|'ring'|'flash'|'spark'; x: number; y: number; endX: number; endY: number; life: number; duration: number; radius: number; color: number }
interface FloatingText { view: Phaser.GameObjects.Text; life: number; x: number; y: number }
interface Casing { active: boolean; x: number; y: number; vx: number; vy: number; angle: number; spin: number; life: number; color: number }

/** Cosmetic combat feedback. Pools never participate in the deterministic simulation. */
export class CombatView {
  private readonly art: Phaser.GameObjects.Graphics;
  private readonly effectArt: Phaser.GameObjects.Graphics;
  private readonly effects: Effect[] = Array.from({length:TUNING.visual.maxCombatEffects}, () => ({active:false,kind:'spark',x:0,y:0,endX:0,endY:0,life:0,duration:0,radius:0,color:0}));
  private readonly casings: Casing[] = Array.from({length:TUNING.visual.maxCasings}, () => ({active:false,x:0,y:0,vx:0,vy:0,angle:0,spin:0,life:0,color:0}));
  private readonly casingTicks = new Map<number,number>();
  private readonly numbers: FloatingText[];
  private readonly pickupLabels: Phaser.GameObjects.Text[] = [];
  private effectCursor = 0;
  private numberCursor = 0;
  private casingCursor = 0;
  public readonly stats = { effects: 0, casings: 0, numbers: 0, pickupLabels: 0, maxEffects: TUNING.visual.maxCombatEffects, maxCasings: TUNING.visual.maxCasings, maxNumbers: TUNING.visual.maxDamageNumbers };

  constructor(private readonly scene: Phaser.Scene, private readonly world: World) {
    this.art = scene.add.graphics().setDepth(18);
    this.effectArt = scene.add.graphics().setDepth(35);
    this.numbers = Array.from({length:TUNING.visual.maxDamageNumbers}, () => ({
      view:scene.add.text(0,0,'',{fontFamily:'monospace',fontSize:'16px',fontStyle:'bold',color:'#fff0bb',stroke:'#152630',strokeThickness:4}).setOrigin(0.5).setDepth(40).setVisible(false),
      life:0,x:0,y:0,
    }));
  }

  event(event: SimEvent): void {
    if(event.type==='shot') {
      const view=this.scene.cameras.main.worldView,margin=TUNING.visual.visualCullMargin;
      if(Math.max(event.x,event.endX??event.x)<view.left-margin || Math.min(event.x,event.endX??event.x)>view.right+margin || Math.max(event.y,event.endY??event.y)<view.top-margin || Math.min(event.y,event.endY??event.y)>view.bottom+margin)return;
    } else if(!this.visible(event.x,event.y,Math.max(TUNING.visual.visualCullMargin,event.type==='explosion'?(event.amount??135):0))) return;
    if(event.type==='special') {
      this.floatText(event.x,event.y-58,(event.text??'SPECIAL').replaceAll('-',' ').toUpperCase(),'#c8ffed');
      this.effect('ring',event.x,event.y,0.5,event.color??0x9df5dc,65);
    }
    if(event.type==='slam') {
      this.effect('ring',event.x,event.y,0.42,0xffce89,event.amount??155);
      this.sparks(event.x,event.y,24,0xffcf91);
    }
    if(event.type==='flash')this.effect('ring',event.x,event.y,0.3,0xf2fff1,event.amount??200);
    if(event.type==='tile-break')this.sparks(event.x,event.y,event.amount===4?6:3,event.color??0xc8be94);
    if(event.type==='prop-break')this.sparks(event.x,event.y,10,event.color??0xc6a26b);
    if (event.type === 'shot') {
      const dx=(event.endX??event.x)-event.x,dy=(event.endY??event.y)-event.y;
      const length=Math.hypot(dx,dy),ux=length?dx/length:1,uy=length?dy/length:0;
      const advance=Math.min(length,event.weapon==='pistol'?11:24);
      const muzzleX=event.x+ux*advance,muzzleY=event.y+uy*advance;
      this.effect('trace', muzzleX, muzzleY, 0.11, 0xffe5a2, 0, event.endX ?? event.x, event.endY ?? event.y);
      this.effect('flash', muzzleX, muzzleY, 0.08, 0xffe2a0, 15,ux,uy);
      this.sparks(event.endX ?? event.x, event.endY ?? event.y, 4, 0xffe3a3);
      this.ejectCasing(event,ux,uy);
    }
    if (event.type === 'hit') {
      this.effect('flash', event.x, event.y, 0.12, 0xffedc0, 22);
      this.sparks(event.x,event.y,7,0xffd688);
      if (event.amount) this.floatText(event.x,event.y-32,`${Math.round(event.amount)}`, '#ffe0a0');
    }
    if (event.type === 'block') {
      this.effect('ring',event.x,event.y,0.23,0x8deee5,25);
      this.sparks(event.x,event.y,4,0x96fff0);
    }
    if (event.type === 'guard-break') {
      this.effect('ring',event.x,event.y,0.35,0xff9c80,42);
      this.floatText(event.x,event.y-35,'GUARD BREAK','#ffac8c');
    }
    if (event.type === 'explosion') {
      const radius=event.amount??GRENADE.blastRadius;
      this.effect('flash',event.x,event.y,0.24,0xffc774,radius*0.48);
      this.effect('ring',event.x,event.y,0.4,0xffb45e,radius);
      this.effect('ring',event.x,event.y,0.65,0x6f786a,radius * 1.25);
      this.sparks(event.x,event.y,22,0xffc477);
    }
    if (event.type === 'pickup') this.floatText(event.x,event.y-35,(event.weapon ?? event.text ?? 'PICKUP').toUpperCase(), '#9af7d9');
    if (event.type === 'knockout') {
      this.effect('ring',event.x,event.y,0.5,0xffa46d,70);
      this.sparks(event.x,event.y,15,0xffd582);
      this.floatText(event.x,event.y-40,'K.O.','#fff0b0');
    }
  }

  update(time: number, delta: number): void {
    const g = this.art; g.clear();
    let labelIndex=0;
    for (const pickup of this.world.pickups) {
      if(!pickup.active || !this.visible(pickup.x,pickup.y))continue;
      let label = this.pickupLabels[labelIndex];
      if (!label && labelIndex<TUNING.visual.maxPickupLabels) {
        label = this.scene.add.text(0,0,'',{fontFamily:'monospace',fontSize:'9px',fontStyle:'bold',color:'#c3d7c7',stroke:'#14232d',strokeThickness:3}).setOrigin(0.5).setDepth(23);
        this.pickupLabels.push(label);
      }
      if(label){label.setVisible(true);labelIndex++;}
      const y = pickup.y + Math.sin(time * 0.003 + pickup.id) * 3;
      const near = this.world.fighters.some(f => f.alive && Math.hypot(f.x-pickup.x,f.y-pickup.y)<75);
      g.fillStyle(0xffcf83,0.05).fillTriangle(pickup.x-19,pickup.y+15,pickup.x+19,pickup.y+15,pickup.x,pickup.y-60);
      g.lineStyle(1,0xd9b775,0.5).strokeEllipse(pickup.x,pickup.y+15,36,8);
      g.fillStyle(0x13242c).fillRoundedRect(pickup.x-20,y-7,40,19,2);
      g.lineStyle(1,near?0xffd58c:0x6b8f82,0.9).strokeRoundedRect(pickup.x-20,y-7,40,19,2);
      if (THROWABLES[pickup.weapon]) {
        drawThrowableArt(g,pickup.weapon,pickup.x,y+1,5);
      } else if(pickup.kind==='health'||pickup.weapon==='health') {
        g.fillStyle(0xa0e6bc).fillRect(pickup.x-3,y-4,6,13).fillRect(pickup.x-6,y,12,5);
      } else {
        g.save().translateCanvas(pickup.x-9,y+1).scaleCanvas(0.65,0.65);
        drawWeaponArt(g,pickup.weapon);g.restore();
      }
      label?.setText(`${near?'[E]  ':''}${pickup.weapon.toUpperCase()}`).setPosition(pickup.x,y-16);
    }
    for(let index=labelIndex;index<this.pickupLabels.length;index++)this.pickupLabels[index].setVisible(false);
    this.stats.pickupLabels=this.pickupLabels.length;
    for (const projectile of this.world.projectiles) {
      if (!projectile.active || !this.visible(projectile.x,projectile.y)) continue;
      const blink = projectile.life < 60 && Math.floor(time/80)%2===0;
      if(projectile.kind==='weapon') {
        g.save().translateCanvas(projectile.x,projectile.y).rotateCanvas(time*0.013+projectile.id).scaleCanvas(0.8,0.8);
        drawWeaponArt(g,projectile.weapon);g.restore();
      } else drawThrowableArt(g,projectile.weapon,projectile.x,projectile.y,projectile.radius,blink);
    }
    for (const fighter of this.world.fighters) {
      if (!fighter.alive || !fighter.combat || !this.visible(fighter.x,fighter.y,100)) continue;
      const combat = fighter.combat;
      if (combat.cookTicks > 0) {
        const throwable=THROWABLES[combat.throwable]??THROWABLES.grenade;
        let x=fighter.x+combat.aimX*22,y=fighter.y-8+combat.aimY*22;
        let vx=combat.aimX*throwable.speed+fighter.vx*0.45,vy=combat.aimY*throwable.speed-170;
        const remaining = Math.max(0, throwable.fuseTicks - combat.cookTicks);
        for(let step=0;step<Math.min(78,remaining);step++) {
          vy+=throwable.gravity/60;x+=vx/60;y+=vy/60;
          if(this.world.terrain.atPixel(x,y)) {g.lineStyle(1,0xffd69a,0.6).strokeCircle(x,y,5);break;}
          if(step%5===0)g.fillStyle(0xfbe1a8,0.6-step/170).fillCircle(x,y,1.7);
        }
        const progress=Math.min(combat.cookTicks/throwable.fuseTicks,1);
        g.lineStyle(2,progress>0.7?0xff8e6c:0xffdb8e,0.9).beginPath().arc(fighter.x,fighter.y-27,10,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-progress)).strokePath();
      }
      if (fighter.action === 'melee-windup') {
        g.lineStyle(1,fighter.color,0.45).beginPath().arc(fighter.x,fighter.y-4,29,fighter.facing===1?2.8:0.1,fighter.facing===1?4.5:1.8).strokePath();
      }
      if (fighter.action === 'melee-active' || fighter.action === 'melee-recovery') {
        const angle=fighter.facing===1?0:Math.PI;
        const upper=combat.pendingAttack==='uppercut';
        const fade=fighter.action==='melee-active'?0.8:0.25;
        const reach=WEAPONS[combat.pendingAttack]?.range??(upper?43:37);
        g.lineStyle(5,0xffe3a0,fade).beginPath().arc(fighter.x,fighter.y-4,reach,angle-1.1,angle+1.1).strokePath();
        g.lineStyle(2,0xffffff,fade).beginPath().arc(fighter.x,fighter.y-4,reach+4,angle-0.8,angle+0.8).strokePath();
      }
    }
    this.drawCasings(delta);
    this.drawEffects(delta);
    this.stats.numbers=0;
    for (const number of this.numbers) {
      if(number.life<=0)continue;
      number.life-=delta;number.y-=delta*38;
      if(number.life>0)this.stats.numbers++;
      number.view.setPosition(number.x,number.y).setAlpha(Math.min(1,number.life*3)).setVisible(number.life>0 && this.visible(number.x,number.y));
    }
  }

  private drawEffects(delta: number): void {
    const g=this.effectArt;g.clear();
    this.stats.effects=0;
    for(const effect of this.effects) {
      if(!effect.active)continue;
      effect.life-=delta;
      if(effect.life<=0){effect.active=false;continue;}
      this.stats.effects++;
      if(effect.kind!=='trace' && !this.visible(effect.x,effect.y,Math.max(TUNING.visual.visualCullMargin,effect.radius)))continue;
      const alpha=effect.life/effect.duration;
      if(effect.kind==='trace') {
        g.lineStyle(3,effect.color,alpha*0.16).lineBetween(effect.x,effect.y,effect.endX,effect.endY);
        g.lineStyle(1,0xfff6d5,alpha*0.85).lineBetween(effect.x,effect.y,effect.endX,effect.endY);
      } else if(effect.kind==='ring') {
        const radius=effect.radius*(1-alpha*0.7);
        g.fillStyle(effect.color,alpha*0.025).fillCircle(effect.x,effect.y,radius);
        g.lineStyle(2+alpha*3,effect.color,alpha*0.8).strokeCircle(effect.x,effect.y,radius);
      } else if(effect.kind==='flash') {
        const r=effect.radius*alpha;
        const ux=effect.endX||effect.endY?effect.endX:1,uy=effect.endY;
        g.fillStyle(effect.color,alpha).fillTriangle(effect.x-ux*r-uy*r*0.3,effect.y-uy*r+ux*r*0.3,effect.x+ux*r,effect.y+uy*r,effect.x-ux*r*0.3+uy*r*0.4,effect.y-uy*r*0.3-ux*r*0.4);
        g.fillStyle(0xfff9d6,alpha).fillCircle(effect.x,effect.y,r*0.32);
      } else {
        const progress=1-alpha;
        const x=effect.x+effect.endX*progress;const y=effect.y+effect.endY*progress+progress*progress*24;
        g.lineStyle(2,effect.color,alpha).lineBetween(x,y,x+effect.endX*0.08,y+effect.endY*0.08);
      }
    }
  }

  private visible(x:number,y:number,margin:number=TUNING.visual.visualCullMargin):boolean {
    const view=this.scene.cameras.main.worldView;
    return x>=view.left-margin && x<=view.right+margin && y>=view.top-margin && y<=view.bottom+margin;
  }

  private ejectCasing(event:SimEvent,ux:number,uy:number):void {
    if(!this.visible(event.x,event.y) || event.weapon==='grenade-launcher')return;
    // Pellet events belong to one shot and eject only one shell.
    const shooter=event.fighterId??-1;
    if(this.casingTicks.get(shooter)===this.world.tick)return;
    this.casingTicks.set(shooter,this.world.tick);
    Object.assign(this.casings[this.casingCursor++%this.casings.length],{
      active:true,x:event.x-ux*5,y:event.y-uy*5,vx:-ux*(45+Math.random()*45),vy:-90-Math.random()*70,
      angle:Math.random()*Math.PI,spin:(Math.random()-0.5)*18,life:TUNING.visual.casingLife,color:event.weapon==='shotgun'?0xe99979:0xe7c178,
    });
  }

  private drawCasings(delta:number):void {
    const g=this.art;this.stats.casings=0;
    for(const casing of this.casings) {
      if(!casing.active)continue;
      casing.life-=delta;
      if(casing.life<=0){casing.active=false;continue;}
      casing.vy+=TUNING.visual.casingGravity*delta;
      const x=casing.x+casing.vx*delta,y=casing.y+casing.vy*delta;
      if(this.world.terrain.atPixel(x,y)) {
        casing.vy=-Math.abs(casing.vy)*TUNING.visual.casingBounce;
        casing.vx*=0.55;casing.spin*=0.6;
      } else {casing.x=x;casing.y=y;}
      casing.angle+=casing.spin*delta;this.stats.casings++;
      if(!this.visible(casing.x,casing.y,10))continue;
      const dx=Math.cos(casing.angle)*2.4,dy=Math.sin(casing.angle)*2.4;
      g.lineStyle(2,casing.color,Math.min(1,casing.life*3)).lineBetween(casing.x-dx,casing.y-dy,casing.x+dx,casing.y+dy);
    }
  }

  private effect(kind: Effect['kind'],x:number,y:number,duration:number,color:number,radius:number,endX=0,endY=0):void {
    Object.assign(this.effects[this.effectCursor++%this.effects.length],{active:true,kind,x,y,endX,endY,duration,life:duration,radius,color});
  }
  private sparks(x:number,y:number,count:number,color:number):void {
    for(let n=0;n<count;n++)this.effect('spark',x,y,0.2+Math.random()*0.25,color,0,(Math.random()-0.5)*100,(Math.random()-0.8)*90);
  }
  private floatText(x:number,y:number,text:string,color:string):void {
    const number=this.numbers[this.numberCursor++%this.numbers.length];
    number.x=x+(Math.random()-0.5)*12;number.y=y;number.life=0.9;
    number.view.setText(text).setColor(color).setAlpha(1).setVisible(true).setPosition(number.x,number.y);
  }
  destroy():void {
    this.art.destroy();this.effectArt.destroy();
    for(const number of this.numbers)number.view.destroy();
    for(const label of this.pickupLabels)label.destroy();
    this.pickupLabels.length=0;this.casingTicks.clear();
    for(const casing of this.casings)casing.active=false;
    for(const effect of this.effects)effect.active=false;
    for(const number of this.numbers)number.life=0;
    this.stats.effects=0;this.stats.casings=0;this.stats.numbers=0;this.stats.pickupLabels=0;
  }
}
