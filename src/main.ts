import Phaser from 'phaser';
import { World } from './sim/World';
import { getArena } from './data/arenas';
import { ArenaScene } from './render/ArenaScene';
import { InputManager } from './input/InputManager';
import { Hud } from './ui/Hud';
import './ui/styles.css';

const world = new World(getArena(), 713);
world.addFighter({name:'RIVET',color:0xffb74d});
world.addFighter({name:'FLUX',color:0x68e2df,x:550,y:872,facing:-1});
const input = new InputManager(document.getElementById('game')!);
const hud = new Hud(document.getElementById('hud')!);
const scene: ArenaScene = new ArenaScene(world,()=>{
  const fighter=world.fighters[0];const camera=scene.cameras?.main;
  const command=input.keyboard();
  if(camera&&input.mouse.active){const p=camera.getWorldPoint(input.mouse.x,input.mouse.y);const dx=p.x-fighter.x,dy=p.y-fighter.y,len=Math.hypot(dx,dy)||1;command.aimX=dx/len;command.aimY=dy/len;}
  const pad=input.connectedGamepads()[0];
  return {[fighter.id]:command,[world.fighters[1].id]:pad!==undefined?input.gamepad(pad):input.keyboard(1)};
});
scene.onTick=()=>{for(const event of world.events)hud.event(event,world);hud.update(world);};
const game=new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#111923',pixelArt:true,antialias:false,scale:{mode:Phaser.Scale.RESIZE,width:'100%',height:'100%'},scene:[scene],audio:{noAudio:true}});
document.getElementById('phase-label')!.textContent='DEMOLITION LAB';
document.querySelector('footer span')!.innerHTML='<b>A D</b> MOVE <b>SPACE</b> JUMP <b>J / RMB</b> MELEE <b>K / LMB</b> FIRE <b>G</b> GRENADE <b>L</b> BLOCK';
document.getElementById('menu-button')!.addEventListener('click',()=>{scene.paused=!scene.paused;input.reset();(document.activeElement as HTMLElement)?.blur();document.getElementById('announcer')!.textContent=scene.paused?'PAUSED':'';});
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!e.repeat)document.getElementById('menu-button')!.click();});
Object.assign(window,{__RIVETFALL__:{world,scene,input,game}});
