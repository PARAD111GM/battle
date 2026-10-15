import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  // The cloud browser disallows file:// navigation. Inline loading exercises the
  // exact bundled document while every external request is explicitly blocked.
  await page.setContent(await readFile('dist/rivetfall.html', 'utf8'), { waitUntil: 'load' });
  await page.getByRole('button', { name: 'ENTER THE ARENA' }).click();
  await page.locator('[data-action="quick"]').click();
  await page.waitForFunction(() => window.__RIVETFALL__?.world.tick >= 20);
  const state = await page.evaluate(() => {
    const world = window.__RIVETFALL__.world;
    return { tick: world.tick, fighters: world.fighters.length, bots: world.bots.size };
  });
  expect(state.fighters).toBe(4); expect(state.bots).toBe(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toHaveAttribute('data-screen', 'pause');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/standalone.png' });
  expect(errors).toEqual([]); expect(requests).toEqual([]);
  console.log(JSON.stringify({ offlineDocument: 'passed', state, externalRequests: requests, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
