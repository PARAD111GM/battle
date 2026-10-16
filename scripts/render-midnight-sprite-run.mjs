import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Render the twelve illustrated poses as supplied. No optical-flow interpolation,
// skeletal deformation, or invented intermediate poses are applied.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'docs/art-direction'),htmlPath=join(output,'mr-midnight-run-v2.html');
const framesDirectory='/tmp/rivetfall-midnight-v2-frames';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1]};
const source=option('--source'),configPath=option('--config');
const width=640,height=480,duration=.6,sourceFps=20,sourceFrames=12,repeats=6;
const framePath=index=>join(framesDirectory,`frame-${String(index).padStart(3,'0')}.png`);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(program,parameters)=>execFileSync(program,parameters,{encoding:'utf8',maxBuffer:16*1024*1024});
const probe=path=>JSON.parse(run('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration:format=duration','-of','json',path]));
let html=await readFile(htmlPath,'utf8');
if(source){
 const image=await readFile(resolve(source));
 assert.ok(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The source must be a PNG sprite sheet.');
 const overrides=configPath?JSON.parse(await readFile(resolve(configPath),'utf8')):{};
 const config={columns:4,rows:3,duration,crop:null,offsets:null,gridOffsetX:0,gridOffsetY:0,...overrides,image:`data:image/png;base64,${image.toString('base64')}`};
 assert.equal(config.columns*config.rows,sourceFrames);assert.equal(config.duration,duration);
 const marker=/<script id="sheet-data" type="application\/json">[\s\S]*?<\/script>/;
 assert.ok(marker.test(html),'The preview must contain its embedded sheet configuration.');
 html=html.replace(marker,`<script id="sheet-data" type="application/json">${JSON.stringify(config).replaceAll('<','\\u003c')}</script>`);
 await writeFile(htmlPath,html);
}
assert.ok(/data:image\/png;base64,/.test(html),'Supply --source PATH once to embed the approved sheet.');
if(args.includes('--embed-only')){console.log(JSON.stringify({embedded:htmlPath,source:source||'existing'}));process.exit(0)}
await mkdir(framesDirectory,{recursive:true});
for(const name of await readdir(framesDirectory))if(/^frame-\d{3}\.png$/.test(name))await unlink(join(framesDirectory,name));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],network=[],frameHashes=new Set();let sourceState;
try{
 const page=await browser.newPage({viewport:{width:760,height:760},deviceScaleFactor:1});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url())});
 await page.setContent(html);await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.ready);
 sourceState=await page.evaluate(()=>{const api=window.__MIDNIGHT_SPRITE__;api.pause();api.setSpeed(1);api.setFacing(1);api.render(0);return api.getState()});
 assert.equal(sourceState.ready,true);assert.equal(sourceState.duration,duration);assert.equal(sourceState.sourceFrames,sourceFrames);assert.equal(sourceState.sourceFps,sourceFps);
 assert.equal(sourceState.paused,true);assert.ok(sourceState.alphaBounds.every(bounds=>bounds.opaque>100));
 const scene=page.locator('#scene');const bounds=await scene.boundingBox();assert.equal(bounds.width,width);assert.equal(bounds.height,height);
 const first=await scene.screenshot();
 await page.waitForTimeout(100);assert.equal(digest(await scene.screenshot()),digest(first),'Pause must hold the displayed pose.');
 await page.evaluate(duration=>window.__MIDNIGHT_SPRITE__.render(duration),duration);
 assert.equal(digest(await scene.screenshot()),digest(first),'The loop endpoint must display the first source pose exactly.');
 await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.setFacing(-1));
 assert.notEqual(digest(await scene.screenshot()),digest(first),'Facing must mirror the artwork.');
 await page.evaluate(()=>{const api=window.__MIDNIGHT_SPRITE__;api.setFacing(1);api.setSpeed(1.5)});
 assert.equal((await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.getState())).speed,1.5);
 await page.selectOption('#speed','0.5');assert.equal((await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.getState())).speed,.5);
 await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.setFrame(7));
 assert.equal((await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.getState())).frame,7);
 await page.locator('#scrub').evaluate(input=>{input.value='4';input.dispatchEvent(new Event('input',{bubbles:true}))});
 const scrubbed=await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.getState());assert.equal(scrubbed.frame,4);assert.equal(scrubbed.paused,true);
 await page.evaluate(()=>{const api=window.__MIDNIGHT_SPRITE__;api.setSpeed(1);api.play()});
 const before=await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.getState().time);await page.waitForTimeout(100);
 assert.ok((await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.getState().time))>before,'Play must advance animation time.');
 await page.evaluate(()=>window.__MIDNIGHT_SPRITE__.pause());
 for(let frame=0;frame<sourceFrames;frame++){
  const actual=await page.evaluate(frame=>{const api=window.__MIDNIGHT_SPRITE__;api.setFrame(frame);return api.getState().frame},frame);
  assert.equal(actual,frame);const png=await scene.screenshot({path:framePath(frame)});frameHashes.add(digest(png));
 }
 assert.equal(frameHashes.size,sourceFrames,'Every source pose must be visibly distinct.');
 await page.setViewportSize({width:360,height:740});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'The preview must fit a narrow screen.');
 assert.deepEqual(errors,[]);assert.deepEqual(network,[],'The interactive file must remain self-contained and work offline.');
}finally{await browser.close()}
await copyFile(framePath(0),join(output,'mr-midnight-run-v2.png'));
const gif=join(output,'mr-midnight-run-v2.gif'),mp4=join(output,'mr-midnight-run-v2.mp4');
// Every illustrated pose holds for 50 milliseconds in both formats: twelve
// poses per 0.6-second cycle, without invented intermediate frames.
run('ffmpeg',['-y','-v','error','-framerate',String(sourceFps),'-i',join(framesDirectory,'frame-%03d.png'),'-filter_complex','[0:v]split[frames][palette_input];[palette_input]palettegen=max_colors=256:stats_mode=full[palette];[frames][palette]paletteuse=dither=sierra2_4a','-frames:v',String(sourceFrames),'-loop','0',gif]);
run('ffmpeg',['-y','-v','error','-framerate',String(sourceFps),'-i',join(framesDirectory,'frame-%03d.png'),'-vf',`loop=loop=${repeats-1}:size=${sourceFrames}:start=0,setpts=N/(${sourceFps}*TB)`,'-frames:v',String(sourceFrames*repeats),'-r',String(sourceFps),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',mp4]);
const gifInfo=probe(gif),mp4Info=probe(mp4);
for(const info of[gifInfo,mp4Info]){assert.equal(info.streams[0].width,width);assert.equal(info.streams[0].height,height)}
assert.equal(Number(gifInfo.streams[0].nb_read_frames),sourceFrames);assert.equal(Number(mp4Info.streams[0].nb_read_frames),sourceFrames*repeats);
assert.ok(Math.abs(Number(gifInfo.format.duration)-duration)<.011);assert.ok(Math.abs(Number(mp4Info.format.duration)-duration*repeats)<.01);
const gifBytes=await readFile(gif),loopAt=gifBytes.indexOf(Buffer.from('NETSCAPE2.0'));
assert.ok(loopAt>=0&&gifBytes[loopAt+13]===0&&gifBytes[loopAt+14]===0,'GIF must repeat forever.');
run('ffmpeg',['-v','error','-i',gif,'-f','null','-']);run('ffmpeg',['-v','error','-i',mp4,'-f','null','-']);
const report={duration,sourceFrames,sourceFps,uniqueRenderedPoses:frameHashes.size,interpolation:false,mp4Seconds:duration*repeats,dimensions:`${width}x${height}`,source:sourceState,gif:gifInfo,mp4:mp4Info,errors,network,files:{gif,mp4,poster:join(output,'mr-midnight-run-v2.png'),html:htmlPath,frames:framesDirectory}};
await writeFile(join(framesDirectory,'export-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
