import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__input-check.html', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><style>body{margin:0;background:#111923}#game{width:100%;height:100px}#overlay{height:800px}</style><div id="game" tabindex="-1">GAME</div><div id="overlay"></div>' }));
  const url = (process.env.TEST_URL || 'http://127.0.0.1:5173') + '/__input-check.html';
  // The intercepted fixture has no response IP classification; permit its same-origin Vite HMR socket.
  await page.context().grantPermissions(['local-network-access'], { origin: new URL(url).origin });
  const mount = async () => {
    await page.evaluate(async () => {
      const { InputManager } = await import('/src/input/InputManager.ts');
      const { SettingsPanel } = await import('/src/ui/Settings.ts');
      // A live Vite server may timestamp dependency URLs after HMR. Import the
      // adapter's exact dependency URL so the fixture observes its singleton.
      const adapterSource = await (await fetch('/src/input/InputManager.ts')).text();
      const settingsURL = adapterSource.match(/from\s+["']([^"']*\/settings\.ts[^"']*)["']/)?.[1];
      if (!settingsURL) throw new Error('Could not resolve InputManager settings dependency');
      const { settings } = await import(settingsURL);
      const panel = new SettingsPanel(document.getElementById('overlay'), () => {
        panel.destroy(); document.getElementById('overlay').innerHTML = ''; document.activeElement?.blur();
      });
      window.check = { input: new InputManager(document.getElementById('game')), settings, panel };
      panel.show();
    });
  };
  await page.goto(url); await mount();
  await page.locator('[data-key-bind="jump"]').click(); await page.keyboard.press('v');
  assert.equal(await page.evaluate(() => window.check.settings.get().keyboard[0].jump), 'KeyV');
  await page.locator('[data-controls-tab="keyboard2"]').click();
  await page.locator('[data-key-bind="jump"]').click(); await page.keyboard.press('b');
  assert.equal(await page.evaluate(() => window.check.settings.get().keyboard[1].jump), 'KeyB');
  await page.locator('[data-key-bind="slot1"]').click(); await page.keyboard.press('1');
  assert.equal(await page.evaluate(() => window.check.settings.get().keyboard[0].slot1), 'Digit7');
  assert.match(await page.locator('.settings-status').innerText(), /Swapped with Player 1/);
  await page.locator('[data-key-bind="jump"]').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.settings-panel').count(), 1);
  assert.equal(await page.evaluate(() => window.check.settings.get().keyboard[1].jump), 'KeyB');
  await page.locator('[data-mouse-bind="attack"]').selectOption('0');
  assert.deepEqual(await page.evaluate(() => window.check.settings.get().mouse), { attack: 0, shoot: 2 });
  await page.locator('[data-volume="master"]').fill('25');
  await page.locator('[data-effect="screenShake"]').uncheck();
  await page.locator('[data-controls-tab="gamepad"]').click();
  await page.locator('[data-axis="aimX"]').selectOption('4');
  await page.locator('[data-deadzone]').fill('35');
  await page.locator('[data-invert-aim]').check();
  await page.evaluate(() => {
    window.fakePad = { index: 0, connected: true, axes: [0, 0, 0, -1, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.fakePad] });
  });
  await page.locator('[data-pad-capture="shoot"]').click();
  await page.evaluate(() => { window.fakePad.buttons[11].pressed = true; });
  await page.waitForFunction(() => window.check.settings.get().gamepad.buttons.shoot === 11);
  await page.evaluate(() => { window.fakePad.buttons[11].pressed = false; });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.settings-panel').count(), 0);
  // A press and release before a simulation step must survive renderer hitstop.
  await page.keyboard.press('v');
  assert.equal(await page.evaluate(() => window.check.input.keyboard().jump), true);
  assert.equal(await page.evaluate(() => window.check.input.keyboard().jump), false);
  await page.keyboard.press('b');
  assert.equal(await page.evaluate(() => window.check.input.keyboard(1).jump), true);
  await page.locator('#game').click();
  assert.equal(await page.evaluate(() => window.check.input.keyboard().attack), true);
  await page.evaluate(() => { window.fakePad.buttons[11].pressed = true; });
  await page.waitForTimeout(50);
  await page.evaluate(() => { window.fakePad.buttons[11].pressed = false; });
  await page.waitForTimeout(50);
  const padInput = await page.evaluate(() => window.check.input.gamepad(0));
  assert.equal(padInput.shoot, true); assert.equal(padInput.aimX, 0); assert.equal(padInput.aimY, 1);
  assert.equal(await page.evaluate(() => window.check.input.gamepad(0).shoot), false);
  const keyboard = (player = 0) => page.evaluate(index => window.check.input.keyboard(index), player);
  const resetInput = () => page.evaluate(() => window.check.input.reset());
  const gestureOptions = options => page.evaluate(gestures => window.check.settings.update({ gestures }), options);
  const pad = (x, y = 0) => page.evaluate(({ x, y }) => {
    window.fakePad.axes[0] = x; window.fakePad.axes[1] = y;
    return window.check.input.gamepad(0);
  }, { x, y });
  await gestureOptions({ sprintDoubleTap: true, dropThroughDoubleTap: true, rollWithDown: true, doubleTapWindowMs: 350 });
  await page.evaluate(() => { document.activeElement?.blur(); window.fakePad.axes.fill(0); });

  // Keyboard transitions must survive taps between simulation ticks and remain separate per player.
  await page.keyboard.down('d'); assert.equal((await keyboard()).sprint, false);
  await page.keyboard.up('d'); assert.equal((await keyboard()).sprint, false);
  await page.keyboard.down('d'); assert.equal((await keyboard()).sprint, true);
  assert.equal((await keyboard()).sprint, true);
  await page.keyboard.up('d'); assert.equal((await keyboard()).sprint, false);
  await resetInput(); await page.keyboard.press('d'); await page.keyboard.down('d');
  assert.equal((await keyboard()).sprint, true);
  await page.keyboard.down('a'); assert.equal((await keyboard()).sprint, false);
  await page.keyboard.up('d'); assert.equal((await keyboard()).sprint, false);
  await page.keyboard.up('a');
  await resetInput(); await page.keyboard.press('ArrowRight'); await page.keyboard.down('ArrowRight');
  assert.equal((await keyboard(1)).sprint, true); assert.equal((await keyboard()).sprint, false);
  await resetInput(); assert.equal((await keyboard(1)).sprint, false); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowRight'); assert.equal((await keyboard(1)).sprint, false); await page.keyboard.up('ArrowRight');
  await resetInput(); await page.keyboard.press('d');
  await page.evaluate(() => window.check.settings.update({ audio: { master: .25 } }));
  await page.keyboard.down('d'); assert.equal((await keyboard()).sprint, false); await page.keyboard.up('d');

  await resetInput(); await page.keyboard.down('s'); assert.equal((await keyboard()).roll, false);
  await page.keyboard.down('d'); assert.equal((await keyboard()).roll, true);
  await page.keyboard.up('d'); await page.keyboard.up('s');
  await resetInput(); await page.keyboard.press('s'); await page.keyboard.down('s');
  assert.equal((await keyboard()).dropThrough, true); assert.equal((await keyboard()).dropThrough, false);
  await page.keyboard.down('d'); assert.equal((await keyboard()).roll, false, 'Dropping suppresses down-direction roll until down is released');
  await page.keyboard.up('s'); await page.keyboard.up('d');
  await gestureOptions({ doubleTapWindowMs: 100 });
  await page.keyboard.press('d'); await page.waitForTimeout(180); await page.keyboard.down('d');
  assert.equal((await keyboard()).sprint, false); await page.keyboard.up('d');
  await gestureOptions({ sprintDoubleTap: false, dropThroughDoubleTap: false, rollWithDown: false, doubleTapWindowMs: 350 });
  await page.keyboard.press('d'); await page.keyboard.down('d'); assert.equal((await keyboard()).sprint, false); await page.keyboard.up('d');
  await page.keyboard.press('s'); await page.keyboard.down('s'); assert.equal((await keyboard()).dropThrough, false);
  await page.keyboard.down('d'); assert.equal((await keyboard()).roll, false);
  await page.keyboard.up('s'); await page.keyboard.up('d');

  // Dedicated bindings remain available with all gesture shortcuts disabled.
  await page.evaluate(() => {
    window.check.settings.bindKeyboard(0, 'sprint', 'KeyZ');
    window.check.settings.bindKeyboard(0, 'dropThrough', 'KeyX');
    window.check.settings.bindKeyboard(0, 'roll', 'KeyF');
  });
  await page.keyboard.down('d'); await page.keyboard.down('z'); assert.equal((await keyboard()).sprint, true);
  await page.keyboard.up('z'); assert.equal((await keyboard()).sprint, false); await page.keyboard.up('d');
  await page.keyboard.press('x'); assert.equal((await keyboard()).dropThrough, true); assert.equal((await keyboard()).dropThrough, false);
  await page.keyboard.press('f'); assert.equal((await keyboard()).roll, true);

  // The same gestures operate on sampled analog axes and remappable D-pad buttons.
  await gestureOptions({ sprintDoubleTap: true, dropThroughDoubleTap: true, rollWithDown: true, doubleTapWindowMs: 350 });
  assert.equal((await pad(1)).sprint, false); await pad(0); assert.equal((await pad(1)).sprint, true);
  assert.equal((await pad(1)).sprint, true); assert.equal((await pad(0)).sprint, false);
  await resetInput(); await pad(0); await pad(1); await pad(0); assert.equal((await pad(1)).sprint, true);
  assert.equal((await pad(-1)).sprint, false); await pad(0);
  await resetInput(); await pad(1); await pad(0); assert.equal((await pad(1)).sprint, true);
  await resetInput(); assert.equal((await pad(1)).sprint, false); await pad(0);
  assert.equal((await pad(1)).sprint, false, 'A held direction sampled after reset must not manufacture a first tap');
  await pad(0); assert.equal((await pad(1)).sprint, true); await pad(0);
  await resetInput(); await pad(0, 1); await resetInput(); assert.equal((await pad(0, 1)).dropThrough, false); await pad(0);
  assert.equal((await pad(0, 1)).dropThrough, false, 'A held down direction sampled after reset must not manufacture a first drop tap');
  await pad(0); assert.equal((await pad(0, 1)).dropThrough, true); await pad(0);
  await resetInput(); assert.equal((await pad(0, 1)).roll, false); assert.equal((await pad(1, 1)).roll, true); await pad(0);
  await resetInput(); await pad(0, 1); await pad(0); assert.equal((await pad(0, 1)).dropThrough, true);
  assert.equal((await pad(0, 1)).dropThrough, false); assert.equal((await pad(1, 1)).roll, false); await pad(0);
  await resetInput();
  const dpad = pressed => page.evaluate(pressed => {
    window.fakePad.buttons[window.check.settings.get().gamepad.buttons.right].pressed = pressed;
    return window.check.input.gamepad(0);
  }, pressed);
  assert.equal((await dpad(true)).sprint, false); await dpad(false); assert.equal((await dpad(true)).sprint, true); await dpad(false);
  await resetInput(); assert.equal((await dpad(true)).sprint, false);
  const leftDpad = pressed => page.evaluate(pressed => {
    window.fakePad.buttons[window.check.settings.get().gamepad.buttons.left].pressed = pressed;
    return window.check.input.gamepad(0);
  }, pressed);
  assert.equal((await leftDpad(true)).sprint, false);
  assert.equal((await leftDpad(false)).sprint, false, 'Releasing a conflicting D-pad direction is not a second physical right press');
  await dpad(false);
  await gestureOptions({ doubleTapWindowMs: 100 }); await pad(1); await pad(0); await page.waitForTimeout(180);
  assert.equal((await pad(1)).sprint, false); await pad(0);
  await gestureOptions({ sprintDoubleTap: false, dropThroughDoubleTap: false, rollWithDown: false, doubleTapWindowMs: 350 });
  await pad(1); await pad(0); assert.equal((await pad(1)).sprint, false); await pad(0);
  await pad(0, 1); await pad(0); const disabledPad = await pad(1, 1);
  assert.equal(disabledPad.dropThrough, false); assert.equal(disabledPad.roll, false); await pad(0);
  await page.evaluate(() => {
    window.check.settings.bindGamepad('sprint', 8); window.check.settings.bindGamepad('dropThrough', 9); window.check.settings.bindGamepad('roll', 1);
  });
  const padButton = (button, pressed) => page.evaluate(({ button, pressed }) => {
    window.fakePad.buttons[button].pressed = pressed; return window.check.input.gamepad(0);
  }, { button, pressed });
  await pad(1); assert.equal((await padButton(8, true)).sprint, true); assert.equal((await padButton(8, false)).sprint, false); await pad(0);
  assert.equal((await padButton(9, true)).dropThrough, true); assert.equal((await padButton(9, true)).dropThrough, false);
  await padButton(9, false); assert.equal((await padButton(1, true)).roll, true); await padButton(1, false);
  console.log('PASS: real keyboard and virtual analog/D-pad sprint latch/release/reversal/reset, per-player isolation, settings reset, duck-direction roll, one-shot drop, gesture toggles/timing, optional dedicated bindings.');

  // Feed real browser events through the adapter into the fixed-step simulation.
  await page.evaluate(async () => {
    const { World } = await import('/src/sim/World.ts');
    const { TUNING } = await import('/src/data/tuning.ts');
    window.movementCheck = {
      makeWorld(catwalk = false) {
        const width = 80, height = 20, tileSize = 24, tiles = new Array(width * height).fill(0);
        for (let row = 18; row < height; row++) for (let col = 0; col < width; col++) tiles[row * width + col] = 6;
        if (catwalk) {
          for (let col = 0; col < width; col++) tiles[10 * width + col] = 2;
          for (let row = 10; row < 18; row++) tiles[row * width] = 6;
        }
        this.world = new World({ id: 'browser-gesture-test', name: 'Gesture test', width, height, tileSize, tiles, spawns: [{ x: 96, y: (catwalk ? 10 : 18) * tileSize - TUNING.fighter.height / 2 }], weaponSpawns: [], props: [], spawnTable: [] }, 7, { scoreLimit: 0, timeLimit: 0 });
        this.fighter = this.world.addFighter(); window.check.input.reset();
      },
      step(ticks = 1) { for (let tick = 0; tick < ticks; tick++) this.world.step({ 0: window.check.input.keyboard() }); return { x: this.fighter.x, y: this.fighter.y, vx: this.fighter.vx, vy: this.fighter.vy, grounded: this.fighter.grounded, action: this.fighter.action, drop: this.fighter.dropThroughState }; },
    };
  });
  await gestureOptions({ sprintDoubleTap: true, dropThroughDoubleTap: true, rollWithDown: true, doubleTapWindowMs: 350 });
  await page.evaluate(() => window.movementCheck.makeWorld());
  await page.keyboard.down('d'); const walking = await page.evaluate(() => window.movementCheck.step(60)); await page.keyboard.up('d');
  await page.evaluate(() => window.movementCheck.makeWorld());
  await page.keyboard.press('d'); await page.keyboard.down('d');
  const sprinting = await page.evaluate(() => window.movementCheck.step(60)); await page.keyboard.up('d');
  assert.ok(walking.vx > 0 && Math.abs(sprinting.vx - 2 * walking.vx) < .001, `Sprint ${sprinting.vx} should be twice walk ${walking.vx}`);
  await page.evaluate(() => window.movementCheck.makeWorld());
  await page.keyboard.down('s'); await page.keyboard.down('d');
  assert.equal((await page.evaluate(() => window.movementCheck.step())).action, 'roll');
  await page.keyboard.up('s'); await page.keyboard.up('d');
  await page.evaluate(() => window.movementCheck.makeWorld(true));
  await page.keyboard.press('s'); await page.keyboard.down('s');
  const dropping = await page.evaluate(() => window.movementCheck.step());
  assert.notEqual(dropping.drop, null); assert.ok(dropping.vy > 0); assert.notEqual(dropping.action, 'roll');
  await page.keyboard.up('s');
  const landed = await page.evaluate(() => window.movementCheck.step(90));
  assert.ok(landed.grounded && landed.y > 400, 'Double-down crosses the thin catwalk and lands on the lower solid floor');
  assert.equal(landed.drop, null);
  await gestureOptions({ sprintDoubleTap: false, dropThroughDoubleTap: false, rollWithDown: false, doubleTapWindowMs: 350 });
  console.log('PASS: real keyboard → InputManager → World sprint reaches 2× walk speed, duck+direction rolls, double-down crosses a thin catwalk and lands on solid floor.');

  // A fresh document proves localStorage restoration and UI rendering, not just in-memory state.
  await page.reload(); await mount();
  const restored = await page.evaluate(() => window.check.settings.get());
  assert.equal(restored.keyboard[0].jump, 'KeyV'); assert.equal(restored.keyboard[1].jump, 'KeyB');
  assert.equal(restored.gamepad.buttons.shoot, 11); assert.equal(restored.gamepad.axes.aimX, 4); assert.equal(restored.gamepad.deadzone, 0.35);
  assert.equal(restored.audio.master, 0.25); assert.equal(restored.effects.screenShake, false);
  assert.deepEqual(restored.gestures, { sprintDoubleTap: false, dropThroughDoubleTap: false, rollWithDown: false, doubleTapWindowMs: 350 });
  await page.locator('[data-pref-reset]').click();
  assert.equal(await page.evaluate(() => window.check.settings.get().keyboard[0].jump), 'Space');
  assert.equal(await page.evaluate(() => window.check.settings.get().gamepad.buttons.shoot), 7);
  assert.equal(await page.evaluate(() => window.check.settings.get().keyboard[0].roll), '');
  assert.equal(await page.evaluate(() => window.check.settings.get().gamepad.buttons.roll), -1);
  assert.deepEqual(await page.evaluate(() => window.check.settings.get().gestures), { sprintDoubleTap: true, dropThroughDoubleTap: true, rollWithDown: true, doubleTapWindowMs: 250 });
  assert.equal(await page.locator('[data-effect="screenShake"]').isChecked(), true);
  await page.locator('[data-key-bind="jump"]').click(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('.capturing').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: P1/P2 rebinding, duplicate swapping, cancellation, mouse mapping, gamepad button capture/axes/deadzone, audio/effects, keyboard/mouse/gamepad action buffering, reload persistence and reset defaults.');
} finally { await browser.close(); }
