import Phaser from 'phaser';
import type { World } from '../sim/World';
import type { SimEvent } from '../sim/types';
import { GRENADE } from '../data/combat';

interface Effect { active: boolean; kind: 'trace'|'ring'|'flash'|'spark'; x: number; y: number; endX: number; endY: number; life: number; duration: number; radius: number; color: number }
interface FloatingText { view: Phaser.GameObjects.Text; life: number; x: number; y: number }

/** Cosmetic combat feedback. Pools never participate in the deterministic simulation. */
export class CombatView {
  private readonly art: Phaser.GameObjects.Graphics;
  private readonly effectArt: Phaser.GameObjects.Graphics;
  private readonly effects: Effect[] = Array.from({length:192}, () => ({active:false,kind:'spark',x:0,y:0,endX:0,endY:0,life:0,duration:0,radius:0,color:0}));
  private readonly numbers: FloatingText[];
  private readonly pickupLabels = new Map<number, Phaser.GameObjects.Text>();
  private effectCursor = 0;
  private numberCursor = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly world: World) {
    this.art = scene.add.graphics().setDepth(18);
    this.effectArt = scene.add.graphics().setDepth(35);
    this.numbers = Array.from({length:40}, () => ({
      view:scene.add.text(0,0,'',{fontFamily:'monospace',fontSize:'16px',fontStyle:'bold',color:'#fff0bb',stroke:'#152630',strokeThickness:4}).setOrigin(0.5).setDepth(40).setVisible(false),
      life:0,x:0,y:0,
    }));
  }

  event(event: SimEvent): void {
    if (event.type === 'shot') {
      const dx=(event.endX??event.x)-event.x,dy=(event.endY??event.y)-event.y;
      const length=Math.hypot(dx,dy),ux=length?dx/length:1,uy=length?dy/length:0;
      const advance=Math.min(length,event.weapon==='pistol'?11:24);
      const muzzleX=event.x+ux*advance,muzzleY=event.y+uy*advance;
      this.effect('trace', muzzleX, muzzleY, 0.11, 0xffe5a2, 0, event.endX ?? event.x, event.endY ?? event.y);
      this.effect('flash', muzzleX, muzzleY, 0.08, 0xffe2a0, 15,ux,uy);
      this.sparks(event.endX ?? event.x, event.endY ?? event.y, 4, 0xffe3a3);
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
      this.effect('flash',event.x,event.y,0.24,0xffc774,65);
      this.effect('ring',event.x,event.y,0.4,0xffb45e,GRENADE.blastRadius);
      this.effect('ring',event.x,event.y,0.65,0x6f786a,GRENADE.blastRadius * 1.25);
      this.sparks(event.x,event.y,22,0xffc477);
      this.scene.cameras.main.shake(160, 0.003);
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
    for (const pickup of this.world.pickups) {
      let label = this.pickupLabels.get(pickup.id);
      if (!label) {
        label = this.scene.add.text(0,0,'',{fontFamily:'monospace',fontSize:'9px',fontStyle:'bold',color:'#c3d7c7',stroke:'#14232d',strokeThickness:3}).setOrigin(0.5).setDepth(23);
        this.pickupLabels.set(pickup.id,label);
      }
      label.setVisible(pickup.active);
      if (!pickup.active) continue;
      const y = pickup.y + Math.sin(time * 0.003 + pickup.id) * 3;
      const near = this.world.fighters.some(f => f.alive && Math.hypot(f.x-pickup.x,f.y-pickup.y)<75);
      g.fillStyle(0xffcf83,0.05).fillTriangle(pickup.x-19,pickup.y+15,pickup.x+19,pickup.y+15,pickup.x,pickup.y-60);
      g.lineStyle(1,0xd9b775,0.5).strokeEllipse(pickup.x,pickup.y+15,36,8);
      g.fillStyle(0x13242c).fillRoundedRect(pickup.x-20,y-7,40,19,2);
      g.lineStyle(1,near?0xffd58c:0x6b8f82,0.9).strokeRoundedRect(pickup.x-20,y-7,40,19,2);
      if (pickup.kind === 'throwable' || pickup.weapon === 'grenade') {
        g.fillStyle(0xa1b889).fillRect(pickup.x-4,y-3,8,10);
        g.fillStyle(0xffd282).fillRect(pickup.x-2,y-6,4,3);
      } else {
        const length=pickup.weapon==='pistol'?17:28;
        g.fillStyle(0xb0c0b0).fillRect(pickup.x-length/2,y-2,length,4);
        g.fillStyle(0xe1b873).fillRect(pickup.x-length/2+3,y+2,4,5);
        if (length>20) g.fillStyle(0x6a8981).fillRect(pickup.x-2,y+2,8,3);
      }
      label.setText(`${near?'[E]  ':''}${pickup.weapon.toUpperCase()}`).setPosition(pickup.x,y-16);
    }
    for (const projectile of this.world.projectiles) {
      if (!projectile.active) continue;
      const blink = projectile.life < 60 && Math.floor(time/80)%2===0;
      g.fillStyle(0x111e26).fillCircle(projectile.x,projectile.y,projectile.radius+2);
      g.fillStyle(blink?0xffa06e:0x8d9f6d).fillCircle(projectile.x,projectile.y,projectile.radius);
      g.lineStyle(1,0x48583f).lineBetween(projectile.x-4,projectile.y,projectile.x+4,projectile.y);
      g.fillStyle(0xffd58c).fillRect(projectile.x-2,projectile.y-projectile.radius-2,4,3);
      g.fillStyle(0xffdc9d,0.75).fillCircle(projectile.x+Math.sin(time)*2,projectile.y-projectile.radius-4,1.5);
    }
    for (const fighter of this.world.fighters) {
      if (!fighter.alive || !fighter.combat) continue;
      const combat = fighter.combat;
      if (combat.cookTicks > 0) {
        let x=fighter.x+combat.aimX*22,y=fighter.y-8+combat.aimY*22;
        let vx=combat.aimX*GRENADE.speed+fighter.vx*0.45,vy=combat.aimY*GRENADE.speed-170;
        const remaining = Math.max(0, GRENADE.fuseTicks - combat.cookTicks);
        for(let step=0;step<Math.min(78,remaining);step++) {
          vy+=GRENADE.gravity/60;x+=vx/60;y+=vy/60;
          if(this.world.terrain.atPixel(x,y)) {g.lineStyle(1,0xffd69a,0.6).strokeCircle(x,y,5);break;}
          if(step%5===0)g.fillStyle(0xfbe1a8,0.6-step/170).fillCircle(x,y,1.7);
        }
        const progress=Math.min(combat.cookTicks/GRENADE.fuseTicks,1);
        g.lineStyle(2,progress>0.7?0xff8e6c:0xffdb8e,0.9).beginPath().arc(fighter.x,fighter.y-27,10,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-progress)).strokePath();
      }
      if (fighter.action === 'melee-windup') {
        g.lineStyle(1,fighter.color,0.45).beginPath().arc(fighter.x,fighter.y-4,29,fighter.facing===1?2.8:0.1,fighter.facing===1?4.5:1.8).strokePath();
      }
      if (fighter.action === 'melee-active' || fighter.action === 'melee-recovery') {
        const angle=fighter.facing===1?0:Math.PI;
        const upper=combat.pendingAttack==='uppercut';
        const fade=fighter.action==='melee-active'?0.8:0.25;
        g.lineStyle(5,0xffe3a0,fade).beginPath().arc(fighter.x,fighter.y-4,upper?43:37,angle-1.1,angle+1.1).strokePath();
        g.lineStyle(2,0xffffff,fade).beginPath().arc(fighter.x,fighter.y-4,upper?47:41,angle-0.8,angle+0.8).strokePath();
      }
    }
    this.drawEffects(delta);
    for (const number of this.numbers) {
      if(number.life<=0)continue;
      number.life-=delta;number.y-=delta*38;
      number.view.setPosition(number.x,number.y).setAlpha(Math.min(1,number.life*3)).setVisible(number.life>0);
    }
  }

  private drawEffects(delta: number): void {
    const g=this.effectArt;g.clear();
    for(const effect of this.effects) {
      if(!effect.active)continue;
      effect.life-=delta;
      if(effect.life<=0){effect.active=false;continue;}
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
    for(const label of this.pickupLabels.values())label.destroy();
    this.pickupLabels.clear();
  }
}
