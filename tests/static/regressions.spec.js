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
  expect(group(a)).toBe('cral-generated-data-${{ github.ref }}');
  expect(cancel(a)).toBe('false');
  expect(cancel(b)).toBe('false');
});

test('workflow Fantacalcio pubblica la cache con strategia race-safe senza rebase del JSON', async () => {
  const src = read('.github/workflows/genera-fantacalcio-cache.yml');

  // La cache e un artefatto derivato: in caso di branch avanzato si deve
  // ripartire dall'ultimo HEAD remoto e rigenerare, non fare merge/rebase del JSON.
  expect(src).not.toContain('git pull --rebase');
  expect(src).toContain('git fetch origin "$branch"');
  expect(src).toContain('git reset --hard "origin/$branch"');
  expect(src).toContain('regenerate_and_certify');
  expect(src).toContain('git push origin "HEAD:$branch"');
  expect(src).toContain('Un solo retry sicuro');
  expect(src).not.toMatch(/git\s+push[^\n]*--force/);
});


test('frontend Classifiche/Riepilogo/Fantacalcio mantiene i nuovi contratti UI', async () => {
  const src = read('tornei/2026-spring/index.html');
  expect(src).toContain("['classifica','🏆 Classifiche']");
  expect(src).toContain("className='classifiche-highlights'");
  expect(src).toContain('Top 5 marcatori');
  expect(src).toContain('Miglior portiere');
  expect(src).toContain("className='classifiche-mobile-ranking-actions'");
  expect(src).toContain("card.dataset.classificheKind=kind");
  expect(src).toContain("card.classList.add('classifiche-secondary-ranking')");
  expect(src).toContain('toggleClassificheMobileDetail');
  expect(src).toContain('position:sticky!important');
  expect(src).toContain('top:calc(env(safe-area-inset-top, 0px) + 6px)');
  expect(src).toContain("if(fantaCompactMobile()){");
  expect(src).toContain("scheduleFantaSecondaryWidgets(card,data,compact,renderToken)");
  expect(src).not.toContain('Portiere: rimosso dalla scheda partita');
});
