import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__RIVETFALL__?.world);
  const locked = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/AudioEngine.ts');
    window.__AUDIO_REVIEW__ = new AudioEngine({ master: 0.5, sfx: 0.7, music: 0.25 });
    const engine = window.__AUDIO_REVIEW__;
    engine.event({ type: 'shot', x: 0, y: 0, weapon: 'pistol' });
    const button = document.createElement('button');
    button.id = 'audio-review-unlock'; button.textContent = 'Verify audio';
    button.style.cssText = 'position:fixed;right:8px;top:8px;z-index:999999;padding:16px';
    button.addEventListener('click', async () => {
      await engine.unlock();
      engine.event({ type: 'shot', x: 0, y: 0, weapon: 'pistol' });
      engine.update(window.__RIVETFALL__.world);
    });
    document.body.append(button);
    return engine.stats;
  });
  assert.equal(locked.unlocked, false);
  assert.equal(locked.playedVoices, 0);
  await page.click('#audio-review-unlock');
  await page.waitForFunction(() => window.__AUDIO_REVIEW__.stats.unlocked && window.__AUDIO_REVIEW__.stats.playedVoices >= 4);
  const lifecycle = await page.evaluate(() => {
    const engine = window.__AUDIO_REVIEW__;
    for (let index = 0; index < 100; index++) engine.event({ type: 'explosion', x: index * 200, y: 0 });
    const crowded = engine.stats;
    engine.pause(true);
    const paused = engine.stats;
    engine.reset(); engine.pause(false); engine.setVolumes({ master: 0 });
    engine.event({ type: 'shot', x: 0, y: 0, weapon: 'sniper' });
    const muted = engine.stats;
    engine.dispose();
    return { crowded, paused, muted, disposed: engine.stats };
  });
  assert.ok(lifecycle.crowded.activeVoices <= lifecycle.crowded.maxVoices);
  assert.equal(lifecycle.paused.activeVoices, 0);
  assert.equal(lifecycle.muted.activeVoices, 0);
  assert.equal(lifecycle.disposed.unlocked, false);

  // Render genuine Web Audio buffers to verify that synthesis produces distinct
  // output and both SFX and music volume controls affect the actual signal.
  const rendered = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/AudioEngine.ts');
    const render = async (kind, muted = false) => {
      const offline = new OfflineAudioContext(2, 48000, 48000);
      const context = new Proxy(offline, { get(target, key) {
        if (key === 'state') return 'running';
        if (key === 'resume' || key === 'close') return async () => undefined;
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const engine = new AudioEngine({ master: muted ? 0 : 1, sfx: 1, music: kind === 'music' ? 1 : 0 }, { contextFactory: () => context });
      await engine.unlock();
      if (kind === 'music') engine.update({ tick: 1, fighters: [], arena: { width: 100, tileSize: 24 }, terrain: {} });
      else engine.event({ type: 'shot', x: 0, y: 0, weapon: kind });
      const buffer = await offline.startRendering(), data = buffer.getChannelData(0);
      let energy = 0, peak = 0, hash = 2166136261;
      for (let index = 0; index < data.length; index++) {
        const sample = data[index]; energy += sample * sample; peak = Math.max(peak, Math.abs(sample));
        if (index % 17 === 0) hash = Math.imul(hash ^ Math.round(sample * 32767), 16777619) >>> 0;
      }
      engine.dispose();
      return { kind, muted, rms: Math.sqrt(energy / data.length), peak, hash };
    };
    const sounds = [];
    for (const kind of ['pistol', 'smg', 'shotgun', 'assault', 'sniper', 'grenade-launcher', 'music']) sounds.push(await render(kind));
    sounds.push(await render('pistol', true)); sounds.push(await render('music', true));
    return sounds;
  });
  for (const sound of rendered) {
    if (sound.muted) assert.equal(sound.rms, 0);
    else { assert.ok(sound.rms > 0.00001, `${sound.kind} is audible`); assert.ok(sound.peak < 1, `${sound.kind} has headroom`); }
  }
  assert.equal(new Set(rendered.filter(sound => !sound.muted).map(sound => sound.hash)).size, 7);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: 'Chromium', gestureGate: 'passed', lifecycle, rendered, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
