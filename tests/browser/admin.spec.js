const { test, expect } = require('@playwright/test');

function collectLocalErrors(page) {
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('response', response => {
    const url = new URL(response.url());
    const critical = ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(response.request().resourceType());
    if (url.origin === 'http://127.0.0.1:4173' && critical && response.status() >= 400) {
      errors.push(`${response.status()} ${url.pathname}`);
    }
  });
  return errors;
}

test('login Admin è raggiungibile e contiene i controlli essenziali', async ({ page }) => {
  const errors = collectLocalErrors(page);
  const response = await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);

  await expect(page.locator('.login-card')).toBeVisible();
  await expect(page.locator('.login-card input[type="password"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Verifica e accedi/i })).toBeVisible();

  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => n.getAttribute('src')));
  expect(scripts.some(x => x && x.includes('mobile-fix-v40.js'))).toBeTruthy();
  expect(scripts.some(x => x && x.includes('admin-pro-v4.js'))).toBeTruthy();

  await page.waitForTimeout(500);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('login Admin mobile resta dentro il viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Specifico per progetto iPhone');
  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });

  // Il bootstrap dell'Admin è asincrono: DOMContentLoaded non garantisce che
  // la login-card sia già stata renderizzata. Aspettiamo esplicitamente l'input.
  const tokenInput = page.locator('.login-card input[type="password"]');
  await expect(tokenInput).toBeVisible();

  const metrics = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.querySelector('meta[name="viewport"]')?.content || ''
  }));
  const fontSize = await tokenInput.evaluate(el => getComputedStyle(el).fontSize);

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 2);
  expect(metrics.viewport).toContain('initial-scale=1');
  expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(16);
});
