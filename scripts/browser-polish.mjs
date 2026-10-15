import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Run against a running Vite dev/preview server, in isolation from CPU-heavy soak tests.
// CPU timings below exclude Phaser's GPU submission and are not a hardware FPS claim.
const target = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173/');
target.searchParams.set('lab', '1');
const sampleMs = Math.max(2000, Math.min(60000, Number(process.env.POLISH_DURATION_MS) || 12000));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(target.href);
  await page.waitForFunction(() => window.__RIVETFALL__?.world.tick > 3);

  const preferences = await page.evaluate(() => {
    const app = window.__RIVETFALL__, scene = app.scene, fighter = app.world.fighters[0];
    app.game.loop.sleep();
    app.settings.update({ effects: { hitstop: false, screenShake: false } });
    scene.visualEvent({ type: 'hit', x: fighter.x, y: fighter.y, amount: 60 });
    scene.update(0, 1);
    const disabled = { hitstop: scene.hitstopMs, shake: scene.cameras.main.shakeEffect.isRunning };
    app.settings.update({ effects: { hitstop: true, screenShake: true } });
    scene.visualEvent({ type: 'hit', x: fighter.x, y: fighter.y, amount: 18 });
    const small = { hitstop: scene.hitstopMs, shake: scene.shakeStrength };
    scene.visualEvent({ type: 'hit', x: fighter.x, y: fighter.y, amount: 65 });
    const strong = { hitstop: scene.hitstopMs, shake: scene.shakeStrength };
    app.settings.update({ effects: { hitstop: false, screenShake: false } });
    scene.update(0, 1);
    const clear = { hitstop: scene.hitstopMs, shake: scene.cameras.main.shakeEffect.isRunning };
    app.settings.update({ effects: { hitstop: true, screenShake: true } });
    app.game.loop.wake();
    return { disabled, small, strong, clear };
  });
  assert.deepEqual(preferences.disabled, { hitstop: 0, shake: false });
  assert.deepEqual(preferences.clear, { hitstop: 0, shake: false });
  assert.ok(Math.abs(preferences.small.hitstop - 1000 / 30) < 0.001);
  assert.equal(preferences.strong.hitstop, 100);
  assert.ok(preferences.strong.shake > preferences.small.shake);

  const timing = await page.evaluate(() => {
    const app = window.__RIVETFALL__, scene = app.scene, world = app.world;
    app.game.loop.sleep(); scene.paused = false; scene.hitstopMs = 0; scene.accumulator = 0;
    const fighter = world.fighters[0], { x, y } = fighter, tick = world.tick;
    let reads = 0, jump = false;
    const originalCommands = scene.getCommands;
    scene.getCommands = () => {
      reads++; const commands = originalCommands(); jump ||= !!commands[0]?.jump; return commands;
    };
    scene.visualEvent({ type: 'knockout', x, y, fighterId: 0 });
    const scheduled = scene.hitstopMs;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    for (let index = 0; index < 6; index++) scene.update(0, 16);
    const frozen = { tick: world.tick, reads, remaining: scene.hitstopMs };
    for (let index = 0; index < 3; index++) scene.update(0, 16);
    const resumed = { tick: world.tick, reads, jump };
    scene.getCommands = originalCommands; scene.hitstopMs = 0; scene.accumulator = 0;

    let hooks = 0, events = 0;
    const originalEvent = scene.onSimEvent, originalStep = scene.stepWorld;
    scene.onSimEvent = () => { events++; };
    scene.stepWorld = () => { hooks++; world.step({}); world.events.push({ type: 'block', x, y }); };
    scene.update(0, 17); const firstEvents = events;
    scene.stepWorld = () => {}; scene.update(0, 17);
    const replay = { hooks, events, firstEvents };
    scene.stepWorld = originalStep; scene.onSimEvent = originalEvent;

    // Synthetic visual events exercise pool wraparound without creating gameplay projectiles.
    for (let index = 0; index < 300; index++) {
      world.tick++;
      scene.combatView.event({ type: 'shot', x, y, endX: x + 180, endY: y, fighterId: 0, weapon: 'shotgun' });
    }
    scene.combatView.update(0, 0); const full = { ...scene.combatView.stats };
    scene.combatView.update(0, 2); const drained = { ...scene.combatView.stats };
    app.game.loop.wake();
    return { tick, scheduled, frozen, resumed, replay, full, drained };
  });
  assert.equal(timing.scheduled, 100);
  assert.equal(timing.frozen.tick, timing.tick);
  assert.equal(timing.frozen.reads, 0, 'Hitstop must not consume buffered commands');
  assert.ok(timing.resumed.tick > timing.tick && timing.resumed.jump, 'A released jump must survive hitstop');
  assert.equal(timing.replay.hooks, 1);
  assert.ok(timing.replay.firstEvents > 0);
  assert.equal(timing.replay.events, timing.replay.firstEvents, 'A completed replay must not repeat old events');
  assert.equal(timing.full.casings, timing.full.maxCasings);
  assert.equal(timing.full.effects, timing.full.maxEffects);
  assert.equal(timing.drained.casings, 0);
  assert.equal(timing.drained.effects, 0);
  assert.equal(timing.drained.numbers, 0);

  await page.evaluate(() => window.__RIVETFALL__.startMatch({
    players: Array.from({ length: 8 }, (_, index) => ({
      name: `BOT ${index + 1}`, character: ['rivet', 'flux', 'cinder', 'wisp'][index % 4],
      controller: 'bot', difficulty: 'hard', team: index % 2,
    })), settings: { timeLimit: 0, scoreLimit: 0 },
  }));
  await page.waitForFunction(() => window.__RIVETFALL__.world.tick > 3 && window.__RIVETFALL__.world.fighters.length === 8);
  const perf = await page.evaluate(async duration => {
    const app = window.__RIVETFALL__, world = app.world, scene = app.scene;
    for (let col = 8; col < 70; col += 3) for (let row = 20; row < 32; row++) {
      const material = world.terrain.get(col, row);
      if (material > 0 && material < 6) world.damageTerrain(col, row, 999, 0);
    }
    const samples = [], start = performance.now();
    let previous = start, eventCount = 0;
    const countEvent = () => { eventCount++; };
    scene.events.on('simevent', countEvent);
    await new Promise(resolve => {
      const sample = now => {
        samples.push({ frameMs: now - previous, cpu: scene.frameStats.renderCpuMs, sim: scene.frameStats.simulationMs });
        previous = now;
        if (now - start < duration) requestAnimationFrame(sample); else resolve();
      };
      requestAnimationFrame(sample);
    });
    scene.events.off('simevent', countEvent);
    const percentile = (key, quantile) => samples.map(value => value[key]).sort((a, b) => a - b)[Math.floor((samples.length - 1) * quantile)];
    const total = samples.reduce((sum, row) => sum + row.frameMs, 0);
    const gl = app.game.renderer.gl, extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      samples: samples.length, seconds: total / 1000, fps: samples.length * 1000 / total,
      frameP50: percentile('frameMs', 0.5), frameP95: percentile('frameMs', 0.95),
      renderCpuP50: percentile('cpu', 0.5), renderCpuP95: percentile('cpu', 0.95),
      simFrameP50: percentile('sim', 0.5), simFrameP95: percentile('sim', 0.95),
      tick: world.tick, eventCount, stats: { ...scene.frameStats }, pools: { ...scene.combatView.stats }, terrain: scene.terrainView.stats,
      debris: world.debris.filter(body => body.active).length, chunks: world.structures.chunks.filter(body => body.active).length,
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : app.game.renderer.type,
      userAgent: navigator.userAgent,
    };
  }, sampleMs);
  assert.ok(perf.samples > 0 && perf.eventCount > 0, 'The stress sample must include live combat');
  assert.ok(perf.pools.effects <= perf.pools.maxEffects && perf.pools.casings <= perf.pools.maxCasings);
  await page.keyboard.press('F1');
  await page.waitForTimeout(100);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/m6-heavy-render.png' });

  await page.evaluate(() => {
    const app = window.__RIVETFALL__;
    window.__polishOldView = app.scene.combatView;
    app.startMatch({ players: app.config.players.slice(0, 2) });
  });
  await page.waitForFunction(() => window.__RIVETFALL__.scene.combatView !== window.__polishOldView && window.__RIVETFALL__.world.tick > 1);
  const cleanup = await page.evaluate(() => {
    const app = window.__RIVETFALL__;
    const result = {
      oldPools: { ...window.__polishOldView.stats }, currentPools: { ...app.scene.combatView.stats },
      terrainTextures: app.game.textures.getTextureKeys().filter(key => key.startsWith('rivet-terrain')).length,
      currentChunks: app.scene.terrainView.stats.total,
    };
    delete window.__polishOldView; return result;
  });
  for (const key of ['effects', 'casings', 'numbers', 'pickupLabels']) assert.equal(cleanup.oldPools[key], 0, `Shutdown must clear ${key}`);
  assert.equal(cleanup.terrainTextures, cleanup.currentChunks, 'Restart must release old terrain textures');
  assert.deepEqual(errors, []);
  const report = { preferences, timing, perf, cleanup, errors };
  await writeFile('test-results/m6-render-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
