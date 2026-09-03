const { test, expect } = require('@playwright/test');

const BASE = String(process.env.LIVE_BASE_URL || '').replace(/\/$/, '');
if (!BASE) throw new Error('LIVE_BASE_URL non configurato');

function joinBase(rel = '') {
  return `${BASE}/${String(rel).replace(/^\/+/, '')}`;
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('response', response => {
    const url = new URL(response.url());
    const critical = ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(response.request().resourceType());
    const expectedSwProbe = response.status() === 404 && /\/sw\.js$/i.test(url.pathname) && url.href !== joinBase('sw.js');
    if (critical && response.status() >= 400 && !expectedSwProbe) errors.push(`${response.status()} ${url.href}`);
  });
  return errors;
}

test('landing live, registry e service worker sono raggiungibili', async ({ page, request }) => {
  const errors = collectErrors(page);
  const registryResponse = await request.get(joinBase('tornei.json'), { failOnStatusCode: false });
  expect(registryResponse.status()).toBe(200);
  const registry = await registryResponse.json();
  expect(Array.isArray(registry.tornei)).toBeTruthy();
  expect(registry.tornei.length).toBeGreaterThan(0);

  const sw = await request.get(joinBase('sw.js'), { failOnStatusCode: false });
  expect(sw.status()).toBe(200);

  const response = await page.goto(joinBase(''), { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).not.toBeEmpty();
  await page.waitForTimeout(1200);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('torneo live corrente carica dati e tab principali', async ({ page, request }) => {
  const registryResponse = await request.get(joinBase('tornei.json'));
  const registry = await registryResponse.json();
  const torneo = registry.tornei.find(t => t.corrente && t.attivo !== false) || registry.tornei.find(t => t.attivo !== false) || registry.tornei[0];
  expect(torneo).toBeTruthy();
  const errors = collectErrors(page);
  const url = joinBase(torneo.url || `${torneo.cartella}/`);
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(1800);
  const text = await page.locator('body').innerText();
  expect(text.length).toBeGreaterThan(100);
  expect(text).toMatch(/Calendario|Classifica|Squadre|Risultati/i);

  const tabs = page.locator('[role="tab"]');
  const count = await tabs.count();
  expect(count).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < Math.min(count, 8); i++) {
    const tab = tabs.nth(i);
    if (await tab.isVisible()) await tab.click();
  }

  expect(errors, errors.join('\n')).toEqual([]);
});

test('live iPhone: nessun overflow orizzontale evidente', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'live-iphone', 'Specifico per progetto iPhone');
  await page.goto(joinBase(''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 2);
});
