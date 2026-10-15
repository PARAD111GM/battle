import Phaser from 'phaser';
import type { World } from '../sim/World';
import { MATERIALS } from '../data/materials';

/** Props and physical debris read the same body transforms used by the headless simulation. */
export class PropsView {
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly art: Phaser.GameObjects.Graphics;
  private readonly debrisArt: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene, private readonly world: World) {
    this.art=scene.add.graphics().setDepth(16);
    this.debrisArt=scene.add.graphics().setDepth(24);
  }

  update(time:number,debug:boolean):void {
    const g=this.art;g.clear();this.debrisArt.clear();
    const camera=this.scene.cameras.main;
    const view=camera.worldView;
    for(const prop of this.world.props) {
      if(prop.type!=='crate'&&prop.type!=='barrel')continue;
      let sprite=this.sprites.get(prop.id);
      if(!sprite) {
        sprite=this.scene.add.image(prop.x,prop.y,prop.type==='crate'?'rivet-crate':'rivet-barrel').setDepth(15);
        this.sprites.set(prop.id,sprite);
      }
      const visible=prop.active&&prop.x+prop.width/2>view.left&&prop.x-prop.width/2<view.right&&prop.y+prop.height/2>view.top&&prop.y-prop.height/2<view.bottom;
      sprite.setVisible(visible);
      if(!visible)continue;
      sprite.setPosition(prop.x,prop.y).setDisplaySize(prop.width,prop.height).setRotation(prop.rotation);
      sprite.setDepth(prop.heldBy===null?15:23);
      const health=prop.hp/prop.maxHp;
      sprite.clearTint();
      if(prop.type==='barrel'&&health<0.55) {
        const pulse=0.5+Math.sin(time*0.015)*0.5;
        if(pulse>0.55)sprite.setTint(0xffb292);
        g.fillStyle(0xffbc6a,0.07+pulse*0.09).fillEllipse(prop.x,prop.y,prop.width+13,prop.height+10);
        g.fillStyle(0xffe1a2,0.8).fillCircle(prop.x+Math.sin(time*0.03)*4,prop.y-prop.height/2-4,1.7);
      }
      if(health<0.95) {
        const x=prop.x-prop.width/2,y=prop.y-prop.height/2;
        g.lineStyle(1,0x1e2928,0.9).beginPath().moveTo(x+4,y+3).lineTo(prop.x,prop.y-3).lineTo(prop.x-3,prop.y+8).lineTo(x+prop.width-4,y+prop.height-4).strokePath();
        if(health<0.4)g.lineStyle(1,0xffdab6,0.4).lineBetween(prop.x,prop.y-3,x+prop.width-4,y+5);
      }
      if(prop.heldBy!==null)g.lineStyle(1,0xffd39a,0.55).strokeCircle(prop.x,prop.y,Math.max(prop.width,prop.height)*0.65);
      if(debug)g.lineStyle(1,prop.type==='barrel'?0xff9b77:0xe6c38c,0.7).strokeRect(prop.x-prop.width/2,prop.y-prop.height/2,prop.width,prop.height);
    }
    const d=this.debrisArt;
    for(const body of this.world.debris) {
      if(!body.active||body.x<view.left-32||body.x>view.right+32||body.y<view.top-32||body.y>view.bottom+32)continue;
      const color=MATERIALS[body.material]?.debrisColor??0xa6b5a4;
      const alpha=Math.min(1,body.life/40);
      const cosine=Math.cos(body.rotation),sine=Math.sin(body.rotation),hw=body.width/2,hh=body.height/2;
      const point=(x:number,y:number)=>({x:body.x+x*cosine-y*sine,y:body.y+x*sine+y*cosine});
      const a=point(-hw,-hh),b=point(hw,-hh),c=point(hw,hh),e=point(-hw,hh);
      d.fillStyle(color,alpha).beginPath().moveTo(a.x,a.y).lineTo(b.x,b.y).lineTo(c.x,c.y);
      if(body.material!==5)d.lineTo(e.x,e.y);
      d.closePath().fillPath();
      d.lineStyle(1,0xefffe2,0.25*alpha).lineBetween(a.x,a.y,b.x,b.y);
      if(debug)d.lineStyle(1,0xd0a7ff,0.7).strokeRect(body.x-hw,body.y-hh,body.width,body.height);
    }
  }

  destroy():void {
    for(const sprite of this.sprites.values())sprite.destroy();
    this.sprites.clear();this.art.destroy();this.debrisArt.destroy();
  }
}
