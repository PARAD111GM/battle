import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
 await page.waitForFunction(()=>window.__RIVETFALL__?.world.tick>3);
 const before=await page.evaluate(()=>({x:window.__RIVETFALL__.world.fighters[0].x,tick:window.__RIVETFALL__.world.tick}));
 await page.keyboard.down('d');await page.waitForFunction(x=>window.__RIVETFALL__.world.fighters[0].x>x+40,before.x);await page.keyboard.up('d');
 const after=await page.evaluate(()=>({x:window.__RIVETFALL__.world.fighters[0].x,tick:window.__RIVETFALL__.world.tick}));
 if(!(after.x>before.x+25&&after.tick>before.tick))throw Error('Movement failed: '+JSON.stringify({before,after}));
 await page.keyboard.press('F1');await page.waitForTimeout(100);
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/movement.png'});
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({browser:'Chromium',movement:'passed',before,after,pageErrors:errors},null,2));
} finally {await browser.close();}
