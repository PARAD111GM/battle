import Phaser from 'phaser';
import { World } from './sim/World';
import { getArena } from './data/arenas';
import { ArenaScene } from './render/ArenaScene';
import { InputManager } from './input/InputManager';
import './ui/styles.css';

const world = new World(getArena(), 713);
world.addFighter({name:'RIVET',color:0xffb74d});
const input = new InputManager(document.getElementById('game')!);
const scene: ArenaScene = new ArenaScene(world,()=>{
  const fighter=world.fighters[0];const camera=scene.cameras?.main;
  const command=input.keyboard();
  if(camera&&input.mouse.active){const p=camera.getWorldPoint(input.mouse.x,input.mouse.y);const dx=p.x-fighter.x,dy=p.y-fighter.y,len=Math.hypot(dx,dy)||1;command.aimX=dx/len;command.aimY=dy/len;}
  return {[fighter.id]:command};
});
const game=new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#111923',pixelArt:true,antialias:false,scale:{mode:Phaser.Scale.RESIZE,width:'100%',height:'100%'},scene:[scene],audio:{noAudio:true}});
document.getElementById('hud')!.innerHTML='<section class="sandbox-card"><div class="eyebrow">01 / MOVEMENT SANDBOX</div><h1>Meet your momentum.</h1><p>Run the catwalks. Climb the ropes.<br>Jump late, roll through, find your flow.</p></section><div class="lab-tag"><b>IRONWORKS</b> &nbsp; / &nbsp; FOUNDRY DISTRICT</div>';
document.getElementById('menu-button')!.addEventListener('click',()=>{scene.paused=!scene.paused;document.getElementById('announcer')!.textContent=scene.paused?'PAUSED':'';});
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!e.repeat)document.getElementById('menu-button')!.click();});
Object.assign(window,{__RIVETFALL__:{world,scene,input,game}});
