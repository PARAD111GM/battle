import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/?lab');
 await page.waitForFunction(()=>window.__RIVETFALL__?.world.tick>3);
 const before=await page.evaluate(()=>({x:window.__RIVETFALL__.world.fighters[0].x,tick:window.__RIVETFALL__.world.tick}));
 await page.keyboard.down('d');await page.waitForFunction(x=>window.__RIVETFALL__.world.fighters[0].x>x+40,before.x);await page.keyboard.up('d');
 const after=await page.evaluate(()=>({x:window.__RIVETFALL__.world.fighters[0].x,tick:window.__RIVETFALL__.world.tick}));
 if(!(after.x>before.x+25&&after.tick>before.tick))throw Error('Movement failed: '+JSON.stringify({before,after}));
 const hasCombat=await page.evaluate(()=>window.__RIVETFALL__.world.fighters.length>1);
 let combat=null;
 if(hasCombat){
   const targetBefore=await page.evaluate(()=>window.__RIVETFALL__.world.fighters[1].hp);
   await page.keyboard.down('k');
   await page.waitForFunction(hp=>window.__RIVETFALL__.world.fighters[1].hp<hp,targetBefore);
   await page.keyboard.up('k');
   combat=await page.evaluate(()=>({targetHp:window.__RIVETFALL__.world.fighters[1].hp,shots:window.__RIVETFALL__.world.fighters[0].combat.shots}));
   if(!(combat.targetHp<targetBefore&&combat.shots>0))throw Error('Combat input did not damage the second fighter');
   const secondX=await page.evaluate(()=>{
     Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{index:0,connected:true,axes:[-1,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}]});
     return window.__RIVETFALL__.world.fighters[1].x;
   });
   await page.waitForFunction(x=>window.__RIVETFALL__.world.fighters[1].x<x-20,secondX);
   await page.evaluate(()=>{Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]});});
   combat.gamepadAdapter='passed (emulated Gamepad API)';
 }
 let destruction=null;
 if(await page.evaluate(()=>typeof window.__RIVETFALL__.world.damageTerrain==='function')){
   destruction=await page.evaluate(()=>{const w=window.__RIVETFALL__.world;const before=w.terrain.get(8,30);w.damageTerrain(8,30,999,0);return {before,after:w.terrain.get(8,30),revision:w.terrain.revision};});
   if(!(destruction.before>0&&destruction.after===0))throw Error('Tile destruction failed');
 }
 await page.keyboard.press('F1');await page.waitForTimeout(100);
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/movement.png'});
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({browser:'Chromium',movement:'passed',before,after,combat,destruction,pageErrors:errors},null,2));
} finally {await browser.close();}
