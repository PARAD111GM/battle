import Phaser from 'phaser';
import type { World } from '../sim/World';

const EDGE_COLORS: Record<string,number> = {walk:0x83d9c4,jump:0xffcd83,drop:0xbea0f0,climb:0x85d9f2,rope:0x85d9f2};

/** A transparent view of the bot's actual graph and decisions, never a separate navigation model. */
export class BotDebugView {
  private readonly graphArt: Phaser.GameObjects.Graphics;
  private readonly pathArt: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<number,Phaser.GameObjects.Text>();
  private readonly legend: Phaser.GameObjects.Text;

  constructor(private readonly scene:Phaser.Scene,private readonly world:World) {
    this.graphArt=scene.add.graphics().setDepth(41);
    this.pathArt=scene.add.graphics().setDepth(42);
    this.legend=scene.add.text(0,0,'F2 / BOT VISION\nTEAL walk · AMBER jump · VIOLET drop · BLUE climb',{
      fontFamily:'monospace',fontSize:'10px',color:'#d0e5d9',backgroundColor:'#10202b',padding:{x:10,y:8},lineSpacing:5,
    }).setOrigin(0,0).setDepth(44).setVisible(false);
  }

  update(enabled:boolean):void {
    const g=this.graphArt,p=this.pathArt;g.clear();p.clear();this.legend.setVisible(enabled);
    for(const label of this.labels.values())label.setVisible(false);
    if(!enabled)return;
    const camera=this.scene.cameras.main,view=camera.worldView;
    this.legend.setScale(1/camera.zoom).setPosition(view.left+28/camera.zoom,view.top+180/camera.zoom);
    const graph=this.world.navigation;
    if(!graph)return;
    for(const node of graph.nodes.values()) {
      if(node.x<view.left-100||node.x>view.right+100||node.y<view.top-100||node.y>view.bottom+100)continue;
      for(const edge of node.edges) {
        const target=graph.nodes.get(edge.to);if(!target)continue;
        if(edge.kind==='walk'&&node.id>edge.to)continue;
        const alpha=edge.kind==='walk'?0.2:edge.kind==='jump'?0.035:0.09;
        g.lineStyle(1,EDGE_COLORS[edge.kind]??0x80b5a5,alpha).beginPath().moveTo(node.x,node.y);
        if(edge.via)g.lineTo(edge.via.x,edge.via.y);
        g.lineTo(target.x,target.y).strokePath();
      }
      g.fillStyle(0xc5e6cf,0.4).fillCircle(node.x,node.y,1.7);
    }
    for(const [id,bot] of this.world.bots) {
      const fighter=this.world.fighters.find(f=>f.id===id);if(!fighter?.alive)continue;
      const debug=bot.debug;
      let label=this.labels.get(id);
      if(!label) {
        label=this.scene.add.text(0,0,'',{fontFamily:'monospace',fontSize:'10px',fontStyle:'bold',color:'#e5f1d9',stroke:'#10202a',strokeThickness:4,align:'center'}).setOrigin(0.5,1).setDepth(44);
        this.labels.set(id,label);
      }
      label.setText(`${debug.goal.toUpperCase()}${debug.stuckTicks>90?` · STUCK ${debug.stuckTicks}`:''}`).setScale(1/camera.zoom).setPosition(fighter.x,fighter.y-55).setVisible(true);
      p.lineStyle(2,fighter.color,0.9).beginPath().moveTo(fighter.x,fighter.y);
      let previous=graph.nodes.get(debug.path[0]);
      for(const key of debug.path) {
        const node=graph.nodes.get(key);if(!node)continue;
        const edge=previous?.edges.find(candidate=>candidate.to===key);
        if(edge?.via)p.lineTo(edge.via.x,edge.via.y);
        p.lineTo(node.x,node.y);previous=node;
      }
      p.strokePath();
      const destination=debug.path.length?graph.nodes.get(debug.path[debug.path.length-1]):undefined;
      if(destination)p.lineStyle(1,fighter.color,0.8).strokeCircle(destination.x,destination.y,7);
      const target=this.world.fighters.find(other=>other.id===debug.targetId&&other.alive);
      if(target) {
        const distance=Math.hypot(target.x-fighter.x,target.y-fighter.y),steps=Math.max(1,Math.ceil(distance/14));
        p.lineStyle(1,0xffb58a,0.38);
        for(let segment=0;segment<steps;segment+=2) {
          const from=segment/steps,to=Math.min((segment+1)/steps,1);
          p.lineBetween(Phaser.Math.Linear(fighter.x,target.x,from),Phaser.Math.Linear(fighter.y,target.y,from),Phaser.Math.Linear(fighter.x,target.x,to),Phaser.Math.Linear(fighter.y,target.y,to));
        }
        p.lineStyle(1,0xffbe90,0.7).strokeCircle(target.x,target.y,25);
      }
    }
  }

  destroy():void {
    this.graphArt.destroy();this.pathArt.destroy();this.legend.destroy();
    for(const label of this.labels.values())label.destroy();this.labels.clear();
  }
}
