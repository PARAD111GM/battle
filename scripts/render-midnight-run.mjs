import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Export the isolated SVG study, never the game. Capture one exact cycle without
// relying on browser frame scheduling, then encode reusable preview assets.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/art-direction');
const framesDirectory = '/tmp/rivetfall-midnight-frames';
const duration = .8, fps = 60, frameCount = 48, gifFps = 50, repeats = 6;
const framePath = index => join(framesDirectory, `frame-${String(index).padStart(3, '0')}.png`);
const gifFramePath = index => join(framesDirectory, `gif-frame-${String(index).padStart(3, '0')}.png`);
const target = process.env.MIDNIGHT_URL;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const rawPixels = path => execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 16 * 1024 * 1024 });
const probe = path => JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration:format=duration', '-of', 'json', path]));
await mkdir(output, { recursive: true }); await mkdir(framesDirectory, { recursive: true });
for (const name of await readdir(framesDirectory)) if (/^(?:gif-)?frame-\d{3}\.png$/.test(name)) await unlink(join(framesDirectory, name));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], geometry = new Set(), frameHashes = new Set(), gifHashes = new Set();
let nodeCount = 0, closureRaster, continuity, rigMetrics;
try {
  const page = await browser.newPage({ viewport: { width: 1040, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  if (target) await page.goto(target);
  else await page.setContent(await readFile(join(output, 'mr-midnight-run.html'), 'utf8'));
  await page.waitForFunction(() => window.__MIDNIGHT__ && document.querySelector('#scene'));
  await page.evaluate(() => {
    const api = window.__MIDNIGHT__;
    for (const method of ['render', 'pause', 'play', 'setSpeed', 'setFacing', 'getState']) if (typeof api[method] !== 'function') throw new Error(`Missing preview API ${method}`);
    api.pause(); api.setSpeed(1); api.setFacing(1);
    const scene = document.querySelector('#scene');
    scene.style.width = '960px'; scene.style.height = '640px'; scene.style.maxWidth = 'none';
  });
  const scene = page.locator('#scene');
  assert.equal(await scene.getAttribute('viewBox'), '0 0 960 640');
  const bounds = await scene.boundingBox(); assert.ok(bounds && bounds.width === 960 && bounds.height === 640);
  const snapshot = time => page.evaluate(time => {
    window.__MIDNIGHT__.render(time);
    const svg = document.querySelector('#scene');
    if (/NaN|Infinity|undefined/.test(svg.innerHTML)) throw new Error(`Non-finite SVG at ${time}`);
    const attrs = ['transform', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'opacity'];
    const rounded = value => value.replace(/-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi, number => String(Math.round(Number(number) * 1e5) / 1e5));
    const nodes = [...svg.querySelectorAll('g,path,rect,circle,ellipse,line,polyline,polygon,use')];
    return { nodes: nodes.length, markup: svg.innerHTML, geometry: JSON.stringify(nodes.map(node => [node.tagName, ...attrs.filter(attr => node.hasAttribute(attr)).map(attr => [attr, rounded(node.getAttribute(attr))])])), state: window.__MIDNIGHT__.getState() };
  }, time);

  const first = await snapshot(0); nodeCount = first.nodes;
  assert.equal(first.state.duration, duration); assert.equal(first.state.paused, true);
  assert.equal(first.state.speed, 1); assert.equal(first.state.facing, 1); assert.equal(first.state.phase, 0);
  assert.ok(nodeCount >= 20, 'The preview must contain a complete SVG rig');
  await page.waitForTimeout(80);
  const frozen = await page.evaluate(() => document.querySelector('#scene').innerHTML);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => document.querySelector('#scene').innerHTML), frozen, 'Pause must stop autonomous animation');
  assert.equal((await snapshot(duration)).geometry, first.geometry, 'The full cycle must close without a pose discontinuity');
  await page.evaluate(() => window.__MIDNIGHT__.setFacing(-1));
  const mirrored = await snapshot(0);
  assert.equal(mirrored.state.facing, -1);
  assert.notEqual(mirrored.geometry, first.geometry, 'Facing must mirror the visible rig');
  await page.evaluate(() => { window.__MIDNIGHT__.setFacing(1); window.__MIDNIGHT__.setSpeed(1.5); });
  const faster = await snapshot(duration / 4);
  assert.equal(faster.state.speed, 1.5); assert.equal(faster.state.phase, .25); assert.equal(faster.state.paused, true);
  await page.evaluate(() => window.__MIDNIGHT__.setSpeed(1));
  assert.equal((await snapshot(0)).geometry, first.geometry, 'Resetting facing and speed must restore the exact pose');
  continuity = await page.evaluate(duration => {
    const api = window.__MIDNIGHT__, epsilon = 1e-6;
    return [['near', .38], ['near', 0], ['far', .88], ['far', .5]].map(([side, phase]) => {
      api.render(((phase - epsilon + 1) % 1) * duration); const before = { ...api.metrics[side].foot };
      api.render(((phase + epsilon) % 1) * duration); const after = api.metrics[side].foot;
      return { side, phase, positionDelta: Math.hypot(after.x - before.x, after.y - before.y), angleDelta: Math.abs(after.angle - before.angle) };
    });
  }, duration);
  for (const boundary of continuity) {
    assert.ok(Number.isFinite(boundary.positionDelta) && boundary.positionDelta < .01, `Foot position must be continuous at ${boundary.side}/${boundary.phase}`);
    assert.ok(Number.isFinite(boundary.angleDelta) && boundary.angleDelta < .01, `Foot angle must be continuous at ${boundary.side}/${boundary.phase}`);
  }
  rigMetrics = await page.evaluate(duration => {
    const api = window.__MIDNIGHT__, distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const stats = { samples: 2401, maxReach: 0, maxUpperError: 0, maxLowerError: 0, overreach: 0 };
    for (let sample = 0; sample < stats.samples; sample++) {
      api.render(sample / (stats.samples - 1) * duration);
      for (const side of ['near', 'far']) {
        const { hip, knee, foot } = api.metrics[side], reach = distance(hip, foot);
        stats.maxReach = Math.max(stats.maxReach, reach);
        stats.maxUpperError = Math.max(stats.maxUpperError, Math.abs(distance(hip, knee) - 86));
        stats.maxLowerError = Math.max(stats.maxLowerError, Math.abs(distance(knee, foot) - 87));
        if (reach > 172.99) stats.overreach++;
      }
    }
    return stats;
  }, duration);
  assert.ok(Number.isFinite(rigMetrics.maxReach) && rigMetrics.maxReach <= 172.99, 'The ankle target must stay inside the two-bone IK reach');
  assert.ok(rigMetrics.maxUpperError < 1e-7 && rigMetrics.maxLowerError < 1e-7, 'Both rendered leg bones must keep their fixed lengths');
  assert.equal(rigMetrics.overreach, 0);

  for (let frame = 0; frame < frameCount; frame++) {
    const state = await snapshot(frame / fps);
    geometry.add(state.geometry);
    const png = await scene.screenshot({ path: framePath(frame), animations: 'disabled' });
    assert.ok(png.length > 10_000, `Frame ${frame} must contain rendered artwork`);
    frameHashes.add(digest(png));
    if (frame === 0) console.log(JSON.stringify({ firstFrame: framePath(0) }));
  }
  assert.ok(geometry.size >= 36 && frameHashes.size >= 36, 'The cycle must have smooth distinct poses, not repeated still frames');
  const closing = await snapshot(duration);
  assert.equal(closing.markup, first.markup, 'The complete SVG DOM must be identical at the loop boundary');
  const closingFrame = await scene.screenshot({ path: join(framesDirectory, 'loop-closure.png'), animations: 'disabled' });
  const before = rawPixels(framePath(0)), after = rawPixels(join(framesDirectory, 'loop-closure.png'));
  assert.equal(before.length, after.length);
  let changed = 0, totalError = 0;
  for (let pixel = 0; pixel < before.length; pixel += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel++) { const difference = Math.abs(before[pixel + channel] - after[pixel + channel]); totalError += difference; pixelChanged ||= difference !== 0; }
    if (pixelChanged) changed++;
  }
  // Chromium can rasterize identical SVG edge geometry a little differently after
  // transforms. Require exact DOM/pose closure and tightly bound only that noise.
  closureRaster = { pixelIdentical: digest(closingFrame) === digest(await readFile(framePath(0))), changedPixels: changed, changedFraction: changed / (before.length / 4), meanChannelError: totalError / before.length, maxChangedFraction: .01, maxMeanChannelError: .02 };
  assert.ok(closureRaster.changedFraction <= .01 && closureRaster.meanChannelError <= .02, 'Loop raster difference must remain below the documented antialiasing tolerance');
  // GIF timing is quantized to centiseconds. Render its own exact 50fps poses
  // rather than dropping frames from the independently captured 60fps video.
  for (let frame = 0; frame < duration * gifFps; frame++) {
    await snapshot(frame / gifFps);
    gifHashes.add(digest(await scene.screenshot({ path: gifFramePath(frame), animations: 'disabled' })));
  }
  assert.equal(gifHashes.size, duration * gifFps, 'All directly sampled GIF poses must be distinct');
  assert.deepEqual(errors, [], 'The isolated preview must emit no page or console errors');
} finally { await browser.close(); }

for (const [quarter, frame] of [0, 12, 24, 36].entries()) await copyFile(framePath(frame), join(framesDirectory, `pose-${quarter}.png`));
await copyFile(framePath(12), join(output, 'mr-midnight-run.png'));
const gif = join(output, 'mr-midnight-run.gif'), mp4 = join(output, 'mr-midnight-run.mp4');
run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(gifFps), '-i', join(framesDirectory, 'gif-frame-%03d.png'), '-filter_complex', '[0:v]split[frames][palette_input];[palette_input]palettegen=max_colors=256:stats_mode=full[palette];[frames][palette]paletteuse=dither=sierra2_4a', '-frames:v', String(duration * gifFps), '-loop', '0', gif]);
run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', join(framesDirectory, 'frame-%03d.png'), '-vf', `loop=loop=${repeats - 1}:size=${frameCount}:start=0,setpts=N/(${fps}*TB)`, '-frames:v', String(frameCount * repeats), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
const gifInfo = probe(gif), mp4Info = probe(mp4);
for (const info of [gifInfo, mp4Info]) {
  assert.equal(info.streams[0].width, 960); assert.equal(info.streams[0].height, 640);
}
assert.equal(Number(gifInfo.streams[0].nb_read_frames), 40);
assert.equal(Number(mp4Info.streams[0].nb_read_frames), frameCount * repeats);
const rate = value => { const [numerator, denominator] = value.split('/').map(Number); return numerator / denominator; };
assert.equal(rate(gifInfo.streams[0].avg_frame_rate), gifFps);
assert.equal(rate(mp4Info.streams[0].avg_frame_rate), fps);
assert.ok(Math.abs(Number(gifInfo.format.duration) - duration) < .011);
assert.ok(Math.abs(Number(mp4Info.format.duration) - duration * repeats) < .017);
const gifBytes = await readFile(gif), loopAt = gifBytes.indexOf(Buffer.from('NETSCAPE2.0'));
assert.ok(loopAt >= 0 && gifBytes[loopAt + 13] === 0 && gifBytes[loopAt + 14] === 0, 'GIF must repeat forever');
run('ffmpeg', ['-v', 'error', '-i', gif, '-f', 'null', '-']);
run('ffmpeg', ['-v', 'error', '-i', mp4, '-f', 'null', '-']);
const report = { duration, sourceFrames: frameCount, sourceFps: fps, gifFrames: 40, gifFps, gifUniqueFrames: gifHashes.size, mp4Frames: frameCount * repeats, mp4Seconds: duration * repeats, uniquePoses: geometry.size, uniqueFrames: frameHashes.size, svgNodes: nodeCount, dimensions: '960x640', loopClosure: 'exact SVG DOM and pose', closureRaster, continuity, rigMetrics, errors, files: { gif, mp4, preview: join(output, 'mr-midnight-run.png'), frames: framesDirectory } };
await writeFile(join(framesDirectory, 'export-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
