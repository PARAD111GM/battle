import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Capture the actual WebGL viewer at exact animation times. GIF and video use
// separate samples because GIF timing is quantized to hundredths of a second.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/art-direction/shared-rig');
const framesDirectory = '/tmp/rivetfall-shared-rig-frames';
const duration = .8, fps = 60, frameCount = 48, gifFps = 50, gifFrames = 40, repeats = 6;
const framePath = (kind, index) => join(framesDirectory, `${kind}-${String(index).padStart(3, '0')}.png`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const rawPixels = path => execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 16 * 1024 * 1024 });
const probe = path => JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration:format=duration', '-of', 'json', path]));
const rate = value => { const [numerator, denominator] = value.split('/').map(Number); return numerator / denominator; };

await mkdir(framesDirectory, { recursive: true });
for (const name of await readdir(framesDirectory)) if (/^(?:video|gif|side)-\d{3}\.png$/.test(name)) await unlink(join(framesDirectory, name));

// Inspect the source GLB as well as its rendered output: it must contain one
// animation shared by two skinned characters, with a real closed bone cycle.
const glbBytes = await readFile(join(output, 'shared-rig.glb'));
assert.equal(glbBytes.readUInt32LE(0), 0x46546c67, 'Expected a binary glTF model');
let gltf, binary;
for (let offset = 12; offset < glbBytes.length;) {
  const length = glbBytes.readUInt32LE(offset), type = glbBytes.readUInt32LE(offset + 4);
  const chunk = glbBytes.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'));
  if (type === 0x004e4942) binary = chunk;
  offset += length + 8;
}
assert.ok(gltf && binary);
assert.equal(gltf.animations.length, 1, 'There must be exactly one shared animation clip');
assert.equal(gltf.skins.length, 2, 'Both character models must be skinned');
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const accessorData = index => {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType, 5126, 'Animation samples must be floating point');
  const size = sizes[accessor.type], values = [];
  for (let element = 0; element < accessor.count; element++) {
    const vector = [];
    for (let item = 0; item < size; item++) {
      const position = (view.byteOffset || 0) + (accessor.byteOffset || 0) + element * (view.byteStride || size * 4) + item * 4;
      vector.push(binary.readFloatLE(position));
    }
    values.push(vector);
  }
  return values;
};
const clip = gltf.animations[0];
let maxEndpointError = 0, animatedChannels = 0;
for (const channel of clip.channels) {
  const sampler = clip.samplers[channel.sampler];
  assert.notEqual(sampler.interpolation, 'CUBICSPLINE', 'Exporter expects plain sampled animation values');
  const times = accessorData(sampler.input).flat(), values = accessorData(sampler.output);
  assert.ok(times.length >= 2 && Math.abs(times[0]) < 1e-6 && Math.abs(times.at(-1) - duration) < 1e-6);
  assert.ok(values.flat().every(Number.isFinite), 'Every animation component must be finite');
  const first = values[0], last = values.at(-1);
  const direct = Math.max(...first.map((value, i) => Math.abs(last[i] - value)));
  const opposite = channel.target.path === 'rotation' ? Math.max(...first.map((value, i) => Math.abs(last[i] + value))) : Infinity;
  maxEndpointError = Math.max(maxEndpointError, Math.min(direct, opposite));
  if (values.some(vector => vector.some((value, i) => Math.abs(value - first[i]) > 1e-5))) animatedChannels++;
}
assert.ok(animatedChannels > 20, 'The shared clip must animate the skeleton, rather than only moving a static mesh');
assert.ok(maxEndpointError < 1e-5, `Animation endpoints differ by ${maxEndpointError}`);
const modelReport = { sha256: digest(glbBytes), clips: gltf.animations.length, skins: gltf.skins.length, clip: clip.name, channels: clip.channels.length, animatedChannels, maxEndpointError };

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const target = process.env.SHARED_RIG_URL || `http://127.0.0.1:${server.address().port}/docs/art-direction/shared-rig/viewer.html`;
const errors = [], frameHashes = new Set(), gifHashes = new Set(), sideHashes = new Set();
let browser, closureRaster, viewerState;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1040, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(target);
  await page.waitForFunction(() => window.__SHARED_RIG_VIEWER__?.getState().ready, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    const api = window.__SHARED_RIG_VIEWER__;
    for (const method of ['pause', 'play', 'seek', 'setSpeed', 'setCamera', 'setBones', 'getState']) if (typeof api[method] !== 'function') throw new Error(`Missing viewer API ${method}`);
    api.pause(); api.setSpeed(1); api.setBones(false); api.seek(0);
    document.getElementById('view-label').style.display = 'none';
    Object.assign(document.getElementById('stage').style, { width: '960px', height: '640px', minHeight: '0', border: '0', borderRadius: '0' });
  });
  await page.waitForTimeout(100);
  const canvas = page.locator('#stage canvas');
  const bounds = await canvas.boundingBox();
  assert.ok(bounds && bounds.width === 960 && bounds.height === 640, 'Canvas export size must be exactly 960×640');
  const state = () => page.evaluate(() => window.__SHARED_RIG_VIEWER__.getState());
  const seek = time => page.evaluate(time => window.__SHARED_RIG_VIEWER__.seek(time), time);
  const camera = view => page.evaluate(view => { window.__SHARED_RIG_VIEWER__.seek(0); window.__SHARED_RIG_VIEWER__.setCamera(view); }, view);
  const capture = async (kind, index, time, hashes) => {
    await seek(time);
    const png = await canvas.screenshot({ path: framePath(kind, index), animations: 'disabled' });
    assert.ok(png.length > 10000, `Rendered ${kind} frame ${index} is unexpectedly empty`);
    hashes.add(digest(png));
  };
  viewerState = await state();
  assert.equal(viewerState.ready, true); assert.equal(viewerState.paused, true); assert.equal(viewerState.error, null);
  assert.equal(viewerState.animationCount, 1); assert.equal(viewerState.skeletonCount, 2);
  assert.ok(Math.abs(viewerState.duration - duration) < 1e-6);
  await page.waitForTimeout(120); assert.equal((await state()).time, viewerState.time, 'Pause must freeze playback time');
  await page.locator('#speed').selectOption('0.5'); assert.equal((await state()).speed, .5);
  await page.locator('#speed').selectOption('1');
  await page.locator('#bones').check(); assert.equal((await state()).bones, true);
  await page.locator('#bones').uncheck(); assert.equal((await state()).bones, false);
  await page.locator('#side').click(); assert.equal((await state()).camera, 'side');
  await page.locator('#front').click(); assert.equal((await state()).camera, 'front');
  await page.locator('#reset').click(); assert.equal((await state()).camera, 'three-quarter');
  await page.locator('#timeline').evaluate(input => { input.value = '250'; input.dispatchEvent(new Event('input', { bubbles: true })); }); assert.ok(Math.abs((await state()).time - duration / 4) < 1e-6);
  assert.equal((await state()).paused, true);
  await page.locator('#play').click(); assert.equal((await state()).paused, false);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__SHARED_RIG_VIEWER__.pause());
  assert.notEqual((await state()).time, duration / 4, 'Play must advance the animation');

  await camera('three-quarter');
  for (let frame = 0; frame < frameCount; frame++) {
    await capture('video', frame, frame / fps, frameHashes);
    if (frame % 12 === 0) console.log(JSON.stringify({ phase: 'video', frame, path: framePath('video', frame) }));
  }
  assert.equal(frameHashes.size, frameCount, 'Each 60 fps sample must render a distinct pose');
  await seek(duration);
  const closurePath = join(framesDirectory, 'loop-closure.png');
  const closure = await canvas.screenshot({ path: closurePath, animations: 'disabled' });
  const before = rawPixels(framePath('video', 0)), after = rawPixels(closurePath);
  assert.equal(before.length, after.length);
  let changed = 0, totalError = 0;
  for (let pixel = 0; pixel < before.length; pixel += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(before[pixel + channel] - after[pixel + channel]);
      totalError += difference; pixelChanged ||= difference !== 0;
    }
    if (pixelChanged) changed++;
  }
  closureRaster = { pixelIdentical: digest(closure) === digest(await readFile(framePath('video', 0))), changedPixels: changed, changedFraction: changed / (before.length / 4), meanChannelError: totalError / before.length };
  assert.ok(closureRaster.changedFraction <= .01 && closureRaster.meanChannelError <= .02, 'Loop images must match within WebGL edge/shadow rasterization tolerance');
  for (let frame = 0; frame < gifFrames; frame++) {
    await capture('gif', frame, frame / gifFps, gifHashes);
    if (frame % 10 === 0) console.log(JSON.stringify({ phase: 'gif', frame }));
  }
  assert.equal(gifHashes.size, gifFrames, 'Each directly sampled GIF frame must be distinct');
  await camera('side');
  for (let frame = 0; frame < gifFrames; frame++) {
    await capture('side', frame, frame / gifFps, sideHashes);
    if (frame % 10 === 0) console.log(JSON.stringify({ phase: 'side', frame }));
  }
  assert.equal(sideHashes.size, gifFrames, 'Each side view GIF frame must be distinct');
  assert.deepEqual(errors, [], 'The preview must emit no page or console errors');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

for (const [quarter, frame] of [0, 12, 24, 36].entries()) await copyFile(framePath('video', frame), join(framesDirectory, `pose-${quarter}.png`));
for (const [quarter, frame] of [0, 10, 20, 30].entries()) await copyFile(framePath('side', frame), join(framesDirectory, `side-pose-${quarter}.png`));
await copyFile(framePath('video', 12), join(output, 'shared-rig-run.png'));
const gif = join(output, 'shared-rig-run.gif'), sideGif = join(output, 'shared-rig-run-side.gif'), mp4 = join(output, 'shared-rig-run.mp4');
for (const [kind, path] of [['gif', gif], ['side', sideGif]]) {
  run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(gifFps), '-i', join(framesDirectory, `${kind}-%03d.png`), '-filter_complex', '[0:v]split[frames][palette_input];[palette_input]palettegen=max_colors=256:stats_mode=full[palette];[frames][palette]paletteuse=dither=sierra2_4a', '-frames:v', String(gifFrames), '-loop', '0', path]);
}
run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', join(framesDirectory, 'video-%03d.png'), '-vf', `loop=loop=${repeats - 1}:size=${frameCount}:start=0,setpts=N/(${fps}*TB)`, '-frames:v', String(frameCount * repeats), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
const media = {};
for (const [kind, path] of [['gif', gif], ['sideGif', sideGif], ['mp4', mp4]]) {
  const info = probe(path), stream = info.streams[0], isVideo = kind === 'mp4';
  assert.equal(stream.width, 960); assert.equal(stream.height, 640);
  assert.equal(Number(stream.nb_read_frames), isVideo ? frameCount * repeats : gifFrames);
  assert.equal(rate(stream.avg_frame_rate), isVideo ? fps : gifFps);
  assert.ok(Math.abs(Number(info.format.duration) - duration * (isVideo ? repeats : 1)) < .011);
  if (!isVideo) {
    const bytes = await readFile(path), loopAt = bytes.indexOf(Buffer.from('NETSCAPE2.0'));
    assert.ok(loopAt >= 0 && bytes[loopAt + 13] === 0 && bytes[loopAt + 14] === 0, 'GIF must repeat forever');
  }
  run('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-']);
  media[kind] = { path, ...info };
}
assert.equal(digest(await readFile(join(output, 'shared-rig.glb'))), modelReport.sha256, 'The source GLB must remain unchanged during capture');
const report = { duration, sourceFrames: frameCount, sourceFps: fps, gifFrames, gifFps, videoUniqueFrames: frameHashes.size, gifUniqueFrames: gifHashes.size, sideUniqueFrames: sideHashes.size, dimensions: '960x640', model: modelReport, viewerState, closureRaster, errors, media, framesDirectory };
await writeFile(join(framesDirectory, 'export-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
