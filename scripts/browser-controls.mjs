import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = (process.env.TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const overlay = page.locator('#overlay');
  const schemes = page.locator('[data-control-scheme]');
  const name = page.getByLabel('Control scheme name');
  const controls = () => page.evaluate(() => {
    const { keyboard, mouse, gamepad, gestures } = window.__RIVETFALL__.settings.get();
    return { keyboard, mouse, gamepad, gestures };
  });
  const bind = async (player, action, key) => {
    await page.locator(`[data-controls-tab="keyboard${player}"]`).click();
    await page.locator(`[data-key-bind="${action}"]`).click();
    await page.keyboard.press(key);
  };
  const range = async (selector, value) => {
    await page.locator(selector).evaluate((input, next) => {
      input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  };
  const saveNew = async schemeName => {
    await name.fill(schemeName); await page.locator('[data-scheme-action="save"]').click();
    const id = await schemes.inputValue();
    expect(id).not.toBe('');
    await expect(schemes.locator('option:checked')).toHaveText(schemeName);
    return id;
  };
  const customize = async () => {
    await page.locator('[data-action="settings"]').click();
    await expect(overlay).toHaveAttribute('data-screen', 'settings');
  };

  await page.goto(base);
  const defaultPreferences = await page.evaluate(() => {
    const { audio, effects } = window.__RIVETFALL__.settings.get(); return { audio, effects };
  });
  await page.getByRole('button', { name: 'ENTER THE ARENA' }).click();
  await page.locator('[data-action="settings"]').click();
  await range('[data-volume="master"]', 25); await range('[data-volume="music"]', 20);
  await page.locator('[data-effect="screenShake"]').uncheck();
  await page.locator('[data-pref-back]').click();
  await page.locator('[data-action="controls"]').click();
  await expect(overlay).toHaveAttribute('data-screen', 'controls');
  await customize();
  await expect(schemes).toHaveValue('');
  await expect(schemes.locator('option')).toHaveCount(1);
  await expect(page.locator('[data-volume]')).toHaveCount(0);
  await expect(page.locator('[data-effect]')).toHaveCount(0);
  const originalAttack = (await controls()).keyboard[0].attack;
  await page.locator('[data-key-bind="attack"]').click(); await name.click();
  await page.keyboard.type('Draft Scheme');
  await expect(name).toHaveValue('Draft Scheme');
  expect((await controls()).keyboard[0].attack).toBe(originalAttack);
  await expect(page.locator('.capturing')).toHaveCount(0);
  await name.fill('');
  for (const gesture of ['sprintDoubleTap', 'dropThroughDoubleTap', 'rollWithDown']) await expect(page.locator(`[data-gesture="${gesture}"]`)).toBeChecked();
  await expect(page.locator('[data-double-tap-window]')).toHaveValue('250');

  // Each scheme must capture both local keyboards and the complete mouse/gamepad mapping.
  await bind(1, 'jump', 'v'); await bind(2, 'jump', 'b');
  await page.locator('[data-mouse-bind="attack"]').selectOption('0');
  await page.locator('[data-controls-tab="gamepad"]').click();
  await page.locator('[data-pad-bind="jump"]').selectOption('11');
  await page.locator('[data-axis="aimX"]').selectOption('4');
  await range('[data-deadzone]', 35); await page.locator('[data-invert-aim]').check();
  await page.locator('[data-gesture="sprintDoubleTap"]').uncheck();
  await page.locator('[data-gesture="rollWithDown"]').uncheck();
  await range('[data-double-tap-window]', 340);
  await expect(page.locator('[data-double-tap-output]')).toContainText('340');
  const firstControls = await controls();
  expect(firstControls.keyboard.map(binding => binding.jump)).toEqual(['KeyV', 'KeyB']);
  expect(firstControls.mouse).toEqual({ attack: 0, shoot: 2 });
  expect(firstControls.gamepad).toMatchObject({ buttons: { jump: 11 }, axes: { aimX: 4 }, deadzone: .35, invertAimY: true });
  expect(firstControls.gestures).toEqual({ sprintDoubleTap: false, dropThroughDoubleTap: true, rollWithDown: false, doubleTapWindowMs: 340 });
  const firstId = await saveNew('Arcade Crew');
  await expect(page.locator('[data-scheme-state]')).toHaveText('Saved scheme');
  await expect(page.locator('[data-scheme-state]')).toHaveAttribute('data-modified', 'false');

  await bind(1, 'jump', 'n'); await bind(2, 'jump', 'm');
  await expect(page.locator('[data-scheme-state]')).toHaveText('Unsaved changes');
  await expect(page.locator('[data-scheme-state]')).toHaveAttribute('data-modified', 'true');
  await page.locator('[data-mouse-bind="attack"]').selectOption('1');
  await page.locator('[data-controls-tab="gamepad"]').click();
  await page.locator('[data-pad-bind="jump"]').selectOption('9');
  await page.locator('[data-axis="aimX"]').selectOption('5');
  await range('[data-deadzone]', 45); await page.locator('[data-invert-aim]').uncheck();
  await page.locator('[data-gesture="sprintDoubleTap"]').check();
  await page.locator('[data-gesture="dropThroughDoubleTap"]').uncheck();
  await page.locator('[data-gesture="rollWithDown"]').check();
  await range('[data-double-tap-window]', 180);
  const secondControls = await controls();
  const secondId = await saveNew('Alternate Crew');
  expect(secondId).not.toBe(firstId);
  await expect(schemes.locator('option')).toHaveCount(3);

  // Audio and effects are preferences, not part of a control scheme.
  await page.evaluate(() => window.__RIVETFALL__.settings.update({ audio: { master: .61, music: .17 }, effects: { screenShake: true } }));
  await expect(page.locator('[data-scheme-state]')).toHaveText('Saved scheme');
  const preferences = await page.evaluate(() => {
    const { audio, effects } = window.__RIVETFALL__.settings.get(); return { audio, effects };
  });
  await schemes.selectOption(firstId); expect(await controls()).toEqual(firstControls);
  expect(await page.evaluate(() => {
    const { audio, effects } = window.__RIVETFALL__.settings.get(); return { audio, effects };
  })).toEqual(preferences);
  expect(await page.evaluate(() => window.__RIVETFALL__.audio.stats.volumes)).toEqual(preferences.audio);
  await schemes.selectOption(''); expect(await controls()).toEqual(firstControls);
  await expect(page.locator('[data-scheme-state]')).toHaveText('Current custom controls');
  await schemes.selectOption(firstId);

  await bind(1, 'jump', 'c');
  const updatedControls = await controls();
  await page.locator('[data-scheme-action="update"]').click();
  await schemes.selectOption(secondId); expect(await controls()).toEqual(secondControls);
  await schemes.selectOption(firstId); expect(await controls()).toEqual(updatedControls);
  await name.fill('Cobalt Crew'); await page.locator('[data-scheme-action="rename"]').click();
  await expect(schemes).toHaveValue(firstId);
  await expect(schemes.locator('option:checked')).toHaveText('Cobalt Crew');

  await name.fill('Alternate Crew'); await page.locator('[data-scheme-action="rename"]').click();
  await expect(page.locator('.settings-status')).toContainText(/already|duplicate|exists|unique/i);
  await expect(page.locator('.scheme-feedback')).toBeVisible();
  await expect(page.locator('.scheme-feedback')).toContainText(/already|duplicate|exists|unique/i);
  await expect(schemes.locator('option:checked')).toHaveText('Cobalt Crew');
  await name.fill('Cobalt Crew'); await page.locator('[data-scheme-action="save"]').click();
  await expect(page.locator('.settings-status')).toContainText(/already|duplicate|exists|unique/i);
  await expect(page.locator('.scheme-feedback')).toBeVisible();
  await expect(page.locator('.scheme-feedback')).toContainText(/already|duplicate|exists|unique/i);
  await expect(schemes.locator('option')).toHaveCount(3);

  await schemes.selectOption(secondId); await page.locator('[data-scheme-action="delete"]').click();
  await expect(schemes.locator('option')).toHaveCount(2);
  await expect(schemes).toHaveValue(''); expect(await controls()).toEqual(secondControls);
  expect(await schemes.locator('option').evaluateAll(options => options.map(option => option.value))).not.toContain(secondId);
  await schemes.selectOption(firstId); expect(await controls()).toEqual(updatedControls);
  await page.locator('[data-pref-reset]').click();
  expect((await controls()).keyboard[0].jump).toBe('Space');
  expect((await controls()).gestures).toEqual({ sprintDoubleTap: true, dropThroughDoubleTap: true, rollWithDown: true, doubleTapWindowMs: 250 });
  await expect(schemes).toHaveValue(''); await expect(schemes.locator('option')).toHaveCount(2);
  expect(await page.evaluate(() => {
    const { audio, effects } = window.__RIVETFALL__.settings.get(); return { audio, effects };
  })).toEqual(preferences);
  await schemes.selectOption(firstId); expect(await controls()).toEqual(updatedControls);

  // Escape cancels capture first, then returns through the originating Controls screen.
  await page.locator('[data-controls-tab="keyboard1"]').click();
  await page.locator('[data-key-bind="attack"]').click(); await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('data-screen', 'settings');
  expect(await controls()).toEqual(updatedControls);
  await expect(page.locator('[data-gesture="sprintDoubleTap"]')).not.toBeChecked();
  await expect(page.locator('[data-gesture="dropThroughDoubleTap"]')).toBeChecked();
  await expect(page.locator('[data-gesture="rollWithDown"]')).not.toBeChecked();
  await expect(page.locator('[data-double-tap-window]')).toHaveValue('340');
  await page.keyboard.press('Escape'); await expect(overlay).toHaveAttribute('data-screen', 'controls');
  await expect(page.locator('.controls-table tr').filter({ hasText: 'Jump' })).toContainText('C');
  await page.locator('[data-action="back"]').click(); await expect(overlay).toHaveAttribute('data-screen', 'menu');
  await page.locator('[data-action="settings"]').click(); await page.locator('[data-pref-reset]').click();
  await expect(schemes.locator('option')).toHaveCount(2);
  expect((await controls()).keyboard[0].jump).toBe('Space');
  expect(await page.evaluate(() => {
    const { audio, effects } = window.__RIVETFALL__.settings.get(); return { audio, effects };
  })).toEqual(defaultPreferences);
  await schemes.selectOption(firstId);
  await range('[data-volume="master"]', 61); await range('[data-volume="music"]', 17);
  await page.locator('[data-pref-back]').click();

  // A new document verifies profiles, selection, controls, and preferences came from storage.
  await page.reload(); await page.getByRole('button', { name: 'ENTER THE ARENA' }).click();
  await page.locator('[data-action="controls"]').click(); await customize();
  await expect(schemes).toHaveValue(firstId); await expect(schemes.locator('option')).toHaveCount(2);
  await expect(schemes.locator('option:checked')).toHaveText('Cobalt Crew');
  expect(await controls()).toEqual(updatedControls);
  expect(await page.evaluate(() => {
    const { audio, effects } = window.__RIVETFALL__.settings.get(); return { audio, effects };
  })).toEqual(preferences);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/controls-gestures-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-control-schemes.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-pref-back]').click(); await page.locator('[data-action="back"]').click();

  // Exercise the restored binding through the real input adapter and running simulation.
  await page.locator('[data-action="setup"]').click();
  await page.getByLabel('Number of fighters').selectOption('2');
  await page.getByLabel('Player 2 controller').selectOption('keyboard2');
  await page.locator('[data-action="characters"]').click(); await page.locator('[data-action="start"]').click();
  await page.waitForFunction(() => window.__RIVETFALL__.world.fighters.slice(0, 2).every(fighter => fighter.grounded));
  for (const [player, key] of [[0, 'c'], [1, 'b']]) {
    const before = await page.evaluate(index => window.__RIVETFALL__.world.fighters[index].y, player);
    await page.keyboard.down(key);
    await page.waitForFunction(({ index, y }) => {
      const fighter = window.__RIVETFALL__.world.fighters[index];
      return !fighter.grounded && fighter.vy < 0 && fighter.y < y;
    }, { index: player, y: before });
    await page.keyboard.up(key);
  }
  await page.keyboard.press('Escape'); await expect(overlay).toHaveAttribute('data-screen', 'pause');
  const pausedTick = await page.evaluate(() => window.__RIVETFALL__.world.tick);
  await page.locator('[data-action="controls"]').click(); await customize();
  await page.locator('[data-key-bind="jump"]').click(); await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('data-screen', 'settings');
  await page.keyboard.press('Escape'); await expect(overlay).toHaveAttribute('data-screen', 'controls');
  await page.locator('[data-action="back"]').click(); await expect(overlay).toHaveAttribute('data-screen', 'pause');
  expect(await page.evaluate(() => window.__RIVETFALL__.world.tick)).toBe(pausedTick);
  await page.locator('[data-action="resume"]').click();
  await page.waitForFunction(tick => window.__RIVETFALL__.world.tick > tick, pausedTick);

  expect(errors).toEqual([]);
  console.log(JSON.stringify({ schemes: 'save/select/update/rename/duplicate rejection/delete passed', controls: 'both keyboards, mouse, gamepad and gesture toggles/timing restored', audioAndEffects: 'preserved on scheme load', persistence: 'profiles, selected scheme, bindings and preferences restored after reload', navigation: 'Controls/customize/back preserves main and paused match', input: 'saved C and B bindings jump both real human fighters', mobileOverflow: 'none', errors }, null, 2));
} finally { await browser.close(); }
