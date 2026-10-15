import { chromium } from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5173');
 await page.waitForFunction(()=>window.__RIVETFALL__?.world.tick>3);
 const initial=await page.evaluate(()=>window.__RIVETFALL__.world.fighters.map(f=>({id:f.id,x:f.x,y:f.y})));
 await page.waitForFunction(()=>window.__RIVETFALL__.world.tick>=150,null,{timeout:60000});
 const state=await page.evaluate(()=>{const w=window.__RIVETFALL__.world;return {tick:w.tick,bots:w.fighters.filter(f=>f.controller==='bot').map(f=>({id:f.id,x:f.x,y:f.y,shots:f.combat.shots,goal:w.bots.get(f.id)?.debug.goal})),nodes:w.navigation?.nodes.size};});
 if(state.bots.length!==3||!(state.nodes>0))throw Error('Three-bot navigation setup failed');
 if(!state.bots.every(f=>Math.hypot(f.x-initial[f.id].x,f.y-initial[f.id].y)>10||f.shots>0))throw Error('Bot failed to make progress');
 await page.keyboard.press('F2');await page.waitForTimeout(150);await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/bots.png'});
 if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({state,pageErrors:errors},null,2));
}finally{await browser.close();}
