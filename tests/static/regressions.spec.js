const { test, expect } = require('@playwright/test');
const fs = require('fs');

const read = p => fs.readFileSync(p, 'utf8');

test('Admin carica le baseline stabili: Pro v4 + mobile v40', async () => {
  const html = read('admin/index.html');
  expect(html).toContain('mobile-fix-v40.js');
  expect(html).toContain('admin-pro-v4.js');
  expect(html).not.toContain('admin-pro-v3.js');
});

test('mobile v40 conserva reload pulito e non resetta lo scroll durante la navigazione', async () => {
  const src = read('admin/mobile-fix-v40.js');
  expect(src).toContain('hardNavigateToCleanViewport');
  expect(src).toContain('location.replace');
  expect(src).toContain('stopSettlingOnUserIntent');

  const start = src.indexOf('function settleAdmin()');
  const end = src.indexOf('function clearSettling()', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const settle = src.slice(start, end);
  expect(settle).not.toContain("addEventListener('scroll'");
  expect(settle).not.toContain('addEventListener("scroll"');
});

test('Admin Pro v4 contiene le protezioni delle cinque fix', async () => {
  const src = read('admin/admin-pro-v4.js');
  expect(src).toContain('CRAL Champions Admin Pro v4');

  // Promote deve calcolare e cancellare i file rimossi.
  expect(src).toMatch(/const\s+removed\s*=\s*destFiles\.filter/);
  expect(src).toMatch(/removed\.forEach\([^\n]+delete\s*:\s*true/);

  // I binari devono essere copiati creando blob reali nel repository di destinazione.
  expect(src).toContain("'/git/blobs'");
  expect(src).toContain("encoding:'base64'");

  // Rollback registry: deve partire dal registry corrente e non sovrascrivere tutto il file storico.
  expect(src).toContain('currentRegistryText');
  expect(src).toContain('oldRegistryText');
});

test('service worker aggiorna il logo in background (non cache-first puro)', async () => {
  const src = read('sw.js');
  expect(src).not.toMatch(/CACHE_NAME\s*=\s*`?\$\{CACHE_PREFIX\}v5`?/);

  const cachedBlock = src.match(/if\s*\(cached\)\s*\{([\s\S]*?)\n\s*\}/);
  expect(cachedBlock, 'Impossibile trovare il ramo if(cached) del service worker').toBeTruthy();
  expect(cachedBlock[1]).toContain('fetchAndUpdateLogoCache');
});

test('workflow generazione dati condividono lo stesso lock di concorrenza', async () => {
  const a = read('.github/workflows/genera-fantacalcio-cache.yml');
  const b = read('.github/workflows/genera-portieri-snapshot.yml');
  const group = text => text.match(/concurrency:\s*[\s\S]*?group:\s*([^\n]+)/)?.[1]?.trim();
  const cancel = text => text.match(/concurrency:\s*[\s\S]*?cancel-in-progress:\s*([^\n]+)/)?.[1]?.trim();
  expect(group(a), 'Manca concurrency.group Fantacalcio').toBeTruthy();
  expect(group(b), 'Manca concurrency.group Portieri').toBeTruthy();
  expect(group(a)).toBe(group(b));
  expect(cancel(a)).toBe('false');
  expect(cancel(b)).toBe('false');
  expect(a).toContain('git pull --rebase');
  expect(b).toContain('git pull --rebase');
});
