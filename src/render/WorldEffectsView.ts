import Phaser from 'phaser';
import type { World } from '../sim/World';

/** Bounded scene effects and screen affordances; every effect reads simulation-owned lifetimes. */
export class WorldEffectsView {
  private readonly art:Phaser.GameObjects.Graphics;
  private readonly front:Phaser.GameObjects.Graphics;
  private readonly screen:Phaser.GameObjects.Graphics;
  private readonly arrowLabels=new Map<number,Phaser.GameObjects.Text>();
  public flashAlpha=0;
  constructor(private readonly scene:Phaser.Scene,private readonly world:World) {
    this.art=scene.add.graphics().setDepth(17);
    this.front=scene.add.graphics().setDepth(38);
    this.screen=scene.add.graphics().setDepth(90);
  }

  update(time:number):void {
    const g=this.art,f=this.front,s=this.screen;g.clear();f.clear();s.clear();
    const camera=this.scene.cameras.main,view=camera.worldView;
    for(const effect of this.world.effects) {
      if(effect.life<=0||effect.x+effect.radius<view.left||effect.x-effect.radius>view.right||effect.y+effect.radius<view.top||effect.y-effect.radius>view.bottom)continue;
      if(effect.kind==='smoke') {
        const fade=Math.min(1,effect.life/50);
        for(let cloud=0;cloud<7;cloud++) {
          const phase=cloud*2.4+effect.id;
          const x=effect.x+Math.cos(phase)*effect.radius*0.38,y=effect.y+Math.sin(phase)*effect.radius*0.28+Math.sin(time*0.001+phase)*8;
          f.fillStyle(cloud%2?0x85959b:0x5a6c78,fade*0.32).fillCircle(x,y,effect.radius*(0.5+(cloud%3)*0.08));
        }
      } else if(effect.kind==='slow') {
        g.fillStyle(0x8adcd8,0.035).fillCircle(effect.x,effect.y,effect.radius);
        g.lineStyle(2,0xa9fff1,0.25).strokeCircle(effect.x,effect.y,effect.radius);
        for(let mark=0;mark<12;mark++) {
          const a=mark*Math.PI/6+time*0.00025;
          g.lineStyle(2,0xc1fff3,0.45).lineBetween(effect.x+Math.cos(a)*effect.radius*0.96,effect.y+Math.sin(a)*effect.radius*0.96,effect.x+Math.cos(a)*effect.radius,effect.y+Math.sin(a)*effect.radius);
        }
      } else if(effect.kind==='air-strike') {
        const pulse=0.5+Math.sin(time*0.02)*0.5;
        f.fillStyle(0xff9e73,0.025+pulse*0.03).fillRect(effect.x-30,view.top,60,effect.y-view.top);
        f.lineStyle(2,0xffbd86,0.45+pulse*0.4).strokeEllipse(effect.x,effect.y,effect.radius*2,effect.radius*0.55);
        f.lineBetween(effect.x-13,effect.y,effect.x+13,effect.y).lineBetween(effect.x,effect.y-13,effect.x,effect.y+13);
        f.fillStyle(0xffc998,0.8).fillTriangle(effect.x-7,effect.y-45,effect.x+7,effect.y-45,effect.x,effect.y-33);
      }
    }
    for(const barrier of this.world.barriers) {
      if(!barrier.active)continue;
      const x=barrier.x-barrier.width/2,y=barrier.y-barrier.height/2;
      const alpha=Math.min(1,barrier.life/40);
      g.fillStyle(0x7be8d4,0.18*alpha).fillRect(x,y,barrier.width,barrier.height);
      g.lineStyle(2,0xb3fff0,0.85*alpha).strokeRect(x,y,barrier.width,barrier.height);
      for(let line=6;line<barrier.height;line+=9)g.lineStyle(1,0x9eead8,0.25*alpha).lineBetween(x,y+line,x+barrier.width,y+line);
      g.fillStyle(0xdcfff0,0.7*alpha).fillRect(x-2,y+barrier.height-5,barrier.width+4,5);
    }
    for(const cell of this.world.fire.cells.values()) {
      if(cell.x<view.left-30||cell.x>view.right+30||cell.y<view.top-40||cell.y>view.bottom+40)continue;
      const size=this.world.terrain.tileSize,phase=time*0.012+cell.col*2.9+cell.row;
      const flame=12+Math.sin(phase)*5;
      g.fillStyle(0xffa14f,0.055).fillCircle(cell.x,cell.y,30);
      f.fillStyle(0xe77643,0.8).fillTriangle(cell.x-size*0.48,cell.y+3,cell.x+Math.sin(phase)*3,cell.y-flame-6,cell.x+size*0.48,cell.y+3);
      f.fillStyle(0xffc573,0.9).fillTriangle(cell.x-6,cell.y+2,cell.x+Math.sin(phase+1)*3,cell.y-flame,cell.x+7,cell.y+2);
      f.fillStyle(0xffedb1,0.8).fillTriangle(cell.x-3,cell.y+2,cell.x+2,cell.y-flame*0.45,cell.x+4,cell.y+2);
    }
    for(const fighter of this.world.fighters) {
      if(!fighter.alive)continue;
      if(fighter.combat.slowTicks>0)f.lineStyle(1,0xa2eee5,0.4).strokeEllipse(fighter.x,fighter.y,32,53);
      if(fighter.action==='special'&&fighter.special==='slam') {
        g.lineStyle(2,fighter.color,0.6).strokeCircle(fighter.x,fighter.y+fighter.height/2,25+Math.sin(time*0.03)*4);
        const rise=fighter.combat.specialPhase==='rise',y=fighter.y+(rise?-34:28),direction=rise?-1:1;
        f.fillStyle(0xffd49a,0.65).fillTriangle(fighter.x-8,y,fighter.x+8,y,fighter.x,y+direction*10);
      }
      if(fighter.special==='bullet-time'&&fighter.combat.specialPhase==='dash')for(let ghost=1;ghost<4;ghost++)g.fillStyle(0x9cffec,0.19/ghost).fillRoundedRect(fighter.x-fighter.vx*0.018*ghost-8,fighter.y-20,16,38,3);
    }
    for(const label of this.arrowLabels.values())label.setVisible(false);
    const inset=28/camera.zoom;
    for(const fighter of this.world.fighters) {
      if(!fighter.alive||Phaser.Geom.Rectangle.Contains(view,fighter.x,fighter.y))continue;
      const x=Phaser.Math.Clamp(fighter.x,view.left+inset,view.right-inset),y=Phaser.Math.Clamp(fighter.y,view.top+inset,view.bottom-inset);
      const angle=Math.atan2(fighter.y-y,fighter.x-x),c=Math.cos(angle),n=Math.sin(angle),r=9/camera.zoom;
      s.fillStyle(fighter.color,0.95).fillTriangle(x+c*r,y+n*r,x-c*r-n*r*0.65,y-n*r+c*r*0.65,x-c*r+n*r*0.65,y-n*r-c*r*0.65);
      let label=this.arrowLabels.get(fighter.id);
      if(!label){label=this.scene.add.text(0,0,'',{fontFamily:'monospace',fontSize:'10px',fontStyle:'bold',color:'#fff2ce',stroke:'#12212c',strokeThickness:3}).setOrigin(0.5).setDepth(91);this.arrowLabels.set(fighter.id,label);}
      label.setText(`${fighter.id+1}`).setScale(1/camera.zoom).setPosition(x-c*r*2,y-n*r*2).setVisible(true);
    }
    const flashTicks=Math.max(0,...this.world.fighters.filter(fighter=>fighter.controller==='human').map(fighter=>fighter.combat.flashTicks));
    this.flashAlpha=Math.min(0.92,flashTicks/70);
    if(this.flashAlpha>0)s.fillStyle(0xf6f9ed,this.flashAlpha).fillRect(view.x,view.y,view.width,view.height);
  }

  destroy():void {this.art.destroy();this.front.destroy();this.screen.destroy();for(const label of this.arrowLabels.values())label.destroy();this.arrowLabels.clear();}
}
