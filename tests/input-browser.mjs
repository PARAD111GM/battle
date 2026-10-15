import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__input-check.html', route => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#111923}#game{width:100%;height:100px}#overlay{height:800px}</style><div id="game" tabindex="-1">GAME</div><div id="overlay"></div>' }));
  const url = (process.env.TEST_URL || 'http://127.0.0.1:5173') + '/__input-check.html';
  const mount = async () => {
    await page.evaluate(async () => {
      const { InputManager } = await import('/src/input/InputManager.ts');
      const { SettingsPanel } = await import('/src/ui/Settings.ts');
      const { settings } = await import('/src/input/settings.ts');
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
  // A fresh document proves localStorage restoration and UI rendering, not just in-memory state.
  await page.reload(); await mount();
  const restored = await page.evaluate(() => window.check.settings.get());
  assert.equal(restored.keyboard[0].jump, 'KeyV'); assert.equal(restored.keyboard[1].jump, 'KeyB');
  assert.equal(restored.gamepad.buttons.shoot, 11); assert.equal(restored.gamepad.axes.aimX, 4); assert.equal(restored.gamepad.deadzone, 0.35);
  assert.equal(restored.audio.master, 0.25); assert.equal(restored.effects.screenShake, false);
  await page.locator('[data-pref-reset]').click();
  assert.equal(await page.evaluate(() => window.check.settings.get().keyboard[0].jump), 'Space');
  assert.equal(await page.evaluate(() => window.check.settings.get().gamepad.buttons.shoot), 7);
  assert.equal(await page.locator('[data-effect="screenShake"]').isChecked(), true);
  await page.locator('[data-key-bind="jump"]').click(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('.capturing').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: P1/P2 rebinding, duplicate swapping, cancellation, mouse mapping, gamepad button capture/axes/deadzone, audio/effects, keyboard/mouse/gamepad action buffering, reload persistence and reset defaults.');
} finally { await browser.close(); }
