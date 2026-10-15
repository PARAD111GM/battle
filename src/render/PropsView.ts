import Phaser from 'phaser';
import type { World } from '../sim/World';
import { MATERIALS } from '../data/materials';

/** Props and physical debris read the same body transforms used by the headless simulation. */
export class PropsView {
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly art: Phaser.GameObjects.Graphics;
  private readonly debrisArt: Phaser.GameObjects.Graphics;
  private readonly structureArt: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene, private readonly world: World) {
    this.art=scene.add.graphics().setDepth(16);
    this.debrisArt=scene.add.graphics().setDepth(24);
    this.structureArt=scene.add.graphics().setDepth(8);
  }

  update(time:number,debug:boolean):void {
    const g=this.art;g.clear();this.debrisArt.clear();this.structureArt.clear();
    const camera=this.scene.cameras.main;
    const view=camera.worldView;
    for(const prop of this.world.props) {
      const visible=prop.active&&prop.x+prop.width/2>view.left&&prop.x-prop.width/2<view.right&&prop.y+prop.height/2>view.top&&prop.y-prop.height/2<view.bottom;
      if(prop.type!=='crate'&&prop.type!=='barrel') {
        if(!visible)continue;
        const p=prop.type==='ladder'||prop.type==='rope'||prop.type==='hanging-light'?this.structureArt:g;
        if(prop.type==='hanging-light'&&!prop.broken&&prop.anchorRow!==undefined&&prop.anchorCol!==undefined) {
          const size=this.world.terrain.tileSize;
          p.lineStyle(2,0x14232b).lineBetween(prop.x,prop.y,(prop.anchorCol+0.5)*size,(prop.anchorRow+0.5)*size);
        }
        p.save().translateCanvas(prop.x,prop.y).rotateCanvas(prop.rotation);
        const w=prop.width,h=prop.height,fade=prop.life===undefined?1:Math.min(1,prop.life/35);
        if(prop.type==='ladder') {
          p.lineStyle(3,0xb9a179,fade).lineBetween(-w/2,-h/2,-w/2,h/2).lineBetween(w/2,-h/2,w/2,h/2);
          for(let y=-h/2+8;y<h/2;y+=15)p.lineStyle(2,0xb9a179,fade).lineBetween(-w/2,y,w/2,y);
        } else if(prop.type==='rope') {
          p.lineStyle(3,0xc2b68c,fade).lineBetween(0,-h/2,0,h/2);
          for(let y=-h/2;y<h/2;y+=12)p.fillStyle(0x837c5b,fade).fillRect(-2,y,4,3);
          p.fillStyle(0xb5a17a,fade).fillCircle(0,h/2,4);
        } else if(prop.type==='door') {
          const panel=prop.open?Math.min(7,w):w;
          p.lineStyle(2,0x82968d,0.7).strokeRect(-w/2-2,-h/2-2,w+4,h+4);
          p.fillStyle(0x344e53,prop.open?0.55:1).fillRect(-w/2,-h/2,panel,h);
          p.fillStyle(0x78a39a,0.5).fillRect(-w/2+2,-h/2+3,2,h-6);
          if(!prop.open){p.fillStyle(0xb4c0a1).fillRect(w/2-6,-2,3,7);p.fillStyle(0xd5b775).fillRect(-w/2+3,-h/2+6,w-6,4);}
        } else if(prop.type==='moving-platform'||prop.type==='elevator') {
          p.fillStyle(0x233c45).fillRect(-w/2,-h/2,w,h);
          p.fillStyle(0x8fa49b).fillRect(-w/2,-h/2,w,3);
          for(let x=-w/2+3;x<w/2-8;x+=15)p.fillStyle(0xddb46b).fillTriangle(x,-h/2+4,x+8,-h/2+4,x+8,Math.min(h/2,-h/2+12));
          p.fillStyle(0x111f2a).fillRect(-w/2,h/2-3,w,3);
          if(prop.type==='elevator')p.lineStyle(2,0x9fb9a7,0.3).lineBetween(-w/2+8,-h/2,-w/2+8,-80).lineBetween(w/2-8,-h/2,w/2-8,-80);
        } else if(prop.type==='hanging-light') {
          if(!prop.broken)p.fillStyle(0xffd590,0.06).fillTriangle(-w/3,2,-w*3,150,w*3,150);
          p.fillStyle(0x35474a).fillTriangle(0,-h/2,-w/2,h/2,w/2,h/2);
          p.fillStyle(prop.broken?0x6c7973:0xffdfa4).fillRect(-w/2,h/2,w,3);
        } else if(prop.type==='ragdoll') {
          p.fillStyle(prop.color??0xa8ae95,fade).fillRoundedRect(-w*0.4,-h*0.25,w*0.8,h*0.65,3);
          p.fillStyle(0xcba88a,fade).fillCircle(0,-h*0.35,w*0.36);
          p.fillStyle(0x203440,fade).fillRect(-w*0.4,h*0.25,w*0.32,h*0.25).fillRect(w*0.1,h*0.25,w*0.32,h*0.25);
          p.lineStyle(4,prop.color??0xa8ae95,fade).lineBetween(-w*0.3,-h*0.1,-w*0.7,h*0.1).lineBetween(w*0.3,-h*0.1,w*0.7,-h*0.25);
        } else if(prop.type==='grass') {
          for(let blade=0;blade<Math.ceil(w/7);blade++)p.fillStyle(blade%2?0x799064:0x5c775d).fillTriangle(-w/2+blade*7,h/2,-w/2+blade*7-3,-h/2,-w/2+blade*7+4,h/2);
        }
        if(debug)p.lineStyle(1,0xb4d4bd,0.6).strokeRect(-w/2,-h/2,w,h);
        p.restore();continue;
      }
      let sprite=this.sprites.get(prop.id);
      if(!sprite) {
        sprite=this.scene.add.image(prop.x,prop.y,prop.type==='crate'?'rivet-crate':'rivet-barrel').setDepth(15);
        this.sprites.set(prop.id,sprite);
      }
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
    for(const bodies of [this.world.debris,this.world.structures.chunks])for(const body of bodies) {
      if(!body.active||body.x<view.left-32||body.x>view.right+32||body.y<view.top-32||body.y>view.bottom+32)continue;
      const color=MATERIALS[body.material]?.debrisColor??0xa6b5a4;
      const alpha=Math.min(1,body.life/40);
      const cosine=Math.cos(body.rotation),sine=Math.sin(body.rotation),hw=body.width/2,hh=body.height/2;
      const cx=hw*cosine,sy=hh*sine,sx=hw*sine,cy=hh*cosine;
      const ax=body.x-cx+sy,ay=body.y-sx-cy,bx=body.x+cx+sy,by=body.y+sx-cy;
      d.fillStyle(color,alpha).beginPath().moveTo(ax,ay).lineTo(bx,by).lineTo(body.x+cx-sy,body.y+sx+cy);
      if(body.material!==5)d.lineTo(body.x-cx-sy,body.y-sx+cy);
      d.closePath().fillPath();
      d.lineStyle(1,0xefffe2,0.25*alpha).lineBetween(ax,ay,bx,by);
      if(debug)d.lineStyle(1,0xd0a7ff,0.7).strokeRect(body.x-hw,body.y-hh,body.width,body.height);
    }
  }

  destroy():void {
    for(const sprite of this.sprites.values())sprite.destroy();
    this.sprites.clear();this.art.destroy();this.debrisArt.destroy();this.structureArt.destroy();
  }
}
