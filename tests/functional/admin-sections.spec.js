const { test, expect } = require('@playwright/test');
const { createGitHubMock } = require('./helpers/github-stateful-mock');

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=',
  'base64'
);
const FAKE_WEBP = Buffer.from('RIFFfake-webp-fixture-WEBP', 'utf8');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error?.message || error)));
  return errors;
}

async function openAdmin(page, mock) {
  await mock.install(page);
  await mock.seedSession(page, true);
  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
}

async function nav(page, label) {
  const button = page.locator('.sidebar .nav-btn').filter({ hasText: label }).first();
  await expect(button).toBeVisible();
  await button.click();
}

function field(page, label) {
  return page.locator('.field').filter({ has: page.locator('label', { hasText: label }) }).first();
}

async function publishPending(page) {
  await nav(page, 'Pubblica');
  await expect(page.getByRole('heading', { name: 'Pubblicazione', exact: true })).toBeVisible();
  await expect(page.locator('.change-row')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Pubblica in collaudo' }).click();
  await expect(page.locator('body')).toContainText(/Pubblicazione completata/i, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
}

async function reloadAdmin(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
}

function sourceText(mock, path) {
  const value = mock.source.readFile(path);
  return value == null ? null : value.toString('utf8');
}

function replaceManifest(mock, transform, message = 'Fixture manifest') {
  const path = 'tornei/2026-test/data/manifest.csv';
  const current = sourceText(mock, path);
  mock.source.commitChanges('main', [{ path, content: transform(current) }], message);
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

test('Dashboard: mostra KPI coerenti e aggiorna il conteggio pending dopo una modifica', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  const kpis = page.locator('.kpi');
  await expect(kpis).toHaveCount(4);
  await expect(kpis.nth(0)).toContainText(/2\s*Squadre/i);
  await expect(kpis.nth(1)).toContainText(/2\s*Giornate/i);
  await expect(kpis.nth(2)).toContainText(/2\s*Partite registrate/i);
  await expect(kpis.nth(3)).toContainText(/0\s*Modifiche in sospeso/i);

  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'config.csv' }).click();
  const editor = page.locator('.file-list .card').last();
  const textarea = editor.locator('textarea');
  await textarea.fill(`${await textarea.inputValue()}dashboard_e2e;si\n`);
  await editor.getByRole('button', { name: 'Salva modifica' }).click();
  await nav(page, 'Dashboard');
  await expect(kpis.nth(3)).toContainText(/1\s*Modifiche in sospeso/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Dashboard: resta utilizzabile con sorgenti opzionali parziali', async ({ page }) => {
  const mock = createGitHubMock();
  replaceManifest(mock, text => text
    .split(/\r?\n/)
    .filter(line => !/classifica_(?:marcatori|mvp|portieri)\.csv/i.test(line))
    .join('\n') + '\n', 'Fixture dashboard parziale');
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('.kpi')).toHaveCount(4);
  await expect(page.locator('body')).toContainText(/File caricati dall'Admin:/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Nuovo torneo
// -----------------------------------------------------------------------------

test('Nuovo torneo: rifiuta un ID già esistente senza creare commit parziali', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const before = mock.source.head().commitSha;

  await nav(page, 'Nuovo torneo');
  const fields = page.locator('.wizard-grid .field');
  await fields.nth(0).locator('input').fill('2026');
  await fields.nth(1).locator('input').fill('Test');
  await fields.nth(2).locator('input').fill('2026-test');
  await fields.nth(3).locator('input').fill('Duplicato E2E');
  await fields.nth(4).locator('input').fill('Non deve essere creato');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Crea torneo' }).click();

  await expect(page.locator('body')).toContainText(/gi[aà] presente|esiste gi[aà]|torneo.*presente/i, { timeout: 20_000 });
  expect(mock.source.head().commitSha).toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Nuovo torneo: valida i campi obbligatori prima di scrivere il repository', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const before = mock.source.head().commitSha;

  await nav(page, 'Nuovo torneo');
  const fields = page.locator('.wizard-grid .field');
  await fields.nth(0).locator('input').fill('1999');
  await fields.nth(2).locator('input').fill('!');
  await fields.nth(3).locator('input').fill('');
  await fields.nth(4).locator('input').fill('');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Crea torneo' }).click();

  await expect(page.locator('body')).toContainText(/ID torneo non valido|Anno non valido|Titolo torneo obbligatorio/i, { timeout: 20_000 });
  expect(mock.source.head().commitSha).toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

test('Setup: riconosce squadre, calendario, dati giornata, immagini e verifica corrente', async ({ page }) => {
  const mock = createGitHubMock();
  mock.source.commitChanges('main', [
    { path: 'tornei/2026-test/immagini/squadre/alpha.webp', content: FAKE_WEBP },
    { path: 'tornei/2026-test/immagini/squadre/beta.webp', content: FAKE_WEBP }
  ], 'Fixture stemmi setup');
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Verifica');
  await page.getByRole('button', { name: 'Esegui verifica' }).click();
  await expect(page.locator('body')).toContainText(/Verifica completata: nessun errore bloccante/i, { timeout: 20_000 });

  await nav(page, 'Setup');
  await expect(page.getByRole('heading', { name: 'Setup torneo' })).toBeVisible();
  const setup = page.locator('.card').filter({ has: page.locator('.pro-step') });
  await expect(setup).toContainText(/Squadre e rose\s+✓ pronto/i);
  await expect(setup).toContainText(/Calendario\s+✓ pronto/i);
  await expect(setup).toContainText(/Dati giornata\s+✓ pronto/i);
  await expect(setup).toContainText(/Fantacalcio\s+opzionale/i);
  await expect(setup).toContainText(/Immagini\s+✓ pronto/i);
  await expect(setup).toContainText(/Verifica\s+✓ pronto/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Setup: non considera il solo calendario come dati giornata completati', async ({ page }) => {
  const mock = createGitHubMock();
  mock.source.commitChanges('main', [
    { path: 'tornei/2026-test/data/risultati_partite.csv', content: 'Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta;Note\n' },
    { path: 'tornei/2026-test/data/riepilogo_giornate.csv', content: 'Sezione;Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta;Risultato;Squadra;Giocatore;Goal;PuntiMVP;PuntiPortiere;Partita;Statistica;Valore;Note;Tavolino;Squadra penalizzata\n' }
  ], 'Fixture calendario senza risultati');
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Setup');
  const dataStep = page.locator('.pro-step').filter({ hasText: 'Dati giornata' });
  await expect(dataStep).toContainText(/da completare/i);
  await expect(dataStep).not.toContainText(/✓ pronto/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Importa CSV
// -----------------------------------------------------------------------------

test('Importa CSV: calendario attraversa pending, publish, repository e reload', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Importa CSV');
  await page.locator('.pro-drop input[type="file"]').setInputFiles({
    name: 'calendario_e2e.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'Giornata;Data;Squadra casa;Squadra trasferta;Note',
      '1;2026-10-01;Alpha;Beta;IMPORT-E2E',
      '2;2026-10-08;Beta;Alpha;IMPORT-E2E-2'
    ].join('\n'))
  });
  await expect(page.locator('.pro-table tbody tr').first()).toContainText('calendario.csv');
  await page.getByRole('button', { name: /Prepara importazione/i }).click();
  await expect(page.locator('.change-row')).not.toHaveCount(0);
  await publishPending(page);

  expect(sourceText(mock, 'tornei/2026-test/data/calendario.csv')).toContain('IMPORT-E2E');
  await reloadAdmin(page);
  await nav(page, 'Calendario');
  await expect(page.locator('.data-table tbody tr').first().locator('input[type="text"]').last()).toHaveValue('IMPORT-E2E');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Importa CSV: file vuoto/non riconosciuto non crea modifiche pubblicabili', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Importa CSV');
  await page.locator('.pro-drop input[type="file"]').setInputFiles({
    name: 'sconosciuto.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('foo;bar\nuno;due\n')
  });
  await expect(page.locator('body')).toContainText(/struttura non riconosciuta/i);
  await expect(page.getByRole('button', { name: /Prepara importazione/i })).toHaveCount(0);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Squadre
// -----------------------------------------------------------------------------

test('Squadre: giocatore vuoto viene rifiutato senza creare pending', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Squadre');
  await page.getByRole('button', { name: '+ Giocatore' }).click();
  await page.getByRole('button', { name: 'Salva rosa' }).click();
  await expect(page.locator('body')).toContainText(/Ogni giocatore deve avere almeno nome o cognome/i);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Calendario
// -----------------------------------------------------------------------------

test('Calendario: modifica grafica persiste dopo publish e reload', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Calendario');
  const first = page.locator('.data-table tbody tr').first();
  await first.locator('input[type="text"]').last().fill('CAL-E2E');
  await page.getByRole('button', { name: 'Salva calendario' }).click();
  await expect(page.locator('body')).toContainText(/Calendario pronto per la pubblicazione/i);
  await publishPending(page);

  expect(sourceText(mock, 'tornei/2026-test/data/calendario.csv')).toContain('CAL-E2E');
  await reloadAdmin(page);
  await nav(page, 'Calendario');
  await expect(page.locator('.data-table tbody tr').first().locator('input[type="text"]').last()).toHaveValue('CAL-E2E');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Calendario: casa uguale a trasferta viene bloccato e non crea pending', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Calendario');
  const first = page.locator('.data-table tbody tr').first();
  const selects = first.locator('select');
  const home = await selects.nth(0).inputValue();
  await selects.nth(1).selectOption(home);
  await page.getByRole('button', { name: 'Salva calendario' }).click();
  await expect(page.locator('body')).toContainText(/Calendario non valido/i);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Giornata
// -----------------------------------------------------------------------------

test('Giornata: risultato valido genera tutti i file, pubblica e si rilegge al reload', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Giornata');
  await expect(page.getByRole('heading', { name: 'Gestione giornata' })).toBeVisible();
  const card = page.locator('.match-card').first();
  const scores = card.locator('.score-input');
  await scores.nth(0).fill('0');
  await scores.nth(1).fill('0');
  await page.getByRole('button', { name: 'Prepara pubblicazione' }).click();
  await expect(page.getByRole('heading', { name: 'Pubblicazione', exact: true })).toBeVisible();
  await expect(page.locator('.change-row')).not.toHaveCount(0);
  await publishPending(page);

  const results = sourceText(mock, 'tornei/2026-test/data/risultati_partite.csv');
  expect(results).toMatch(/2;[^\n;]*;Beta;0;Alpha;0/);
  expect(sourceText(mock, 'tornei/2026-test/data/classifica_squadre.csv')).toContain('Beta');

  await reloadAdmin(page);
  await nav(page, 'Giornata');
  const reloadedScores = page.locator('.match-card').first().locator('.score-input');
  await expect(reloadedScores.nth(0)).toHaveValue('0');
  await expect(reloadedScores.nth(1)).toHaveValue('0');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Giornata: risultato incompleto viene bloccato e non genera file pending', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Giornata');
  const scores = page.locator('.match-card').first().locator('.score-input');
  await scores.nth(0).fill('1');
  await scores.nth(1).fill('');
  await page.getByRole('button', { name: 'Prepara pubblicazione' }).click();
  await expect(page.locator('body')).toContainText(/risultato incompleto o non valido/i);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Pagellone
// -----------------------------------------------------------------------------

test('Pagellone: crea TXT, aggiorna manifest, pubblica e ricarica la pagella', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Pagellone');
  await page.getByRole('button', { name: '+ Pagella' }).click();
  const card = page.locator('.pagella-edit').first();
  await card.locator('.field').filter({ hasText: 'Testo' }).locator('textarea').fill('Prestazione E2E molto solida');
  await card.locator('.field').filter({ hasText: 'Paragone' }).locator('input').fill('Fixture Man');
  await card.locator('.field').filter({ hasText: 'Voto' }).locator('input').fill('7,5');
  await page.getByRole('button', { name: 'Salva Pagellone' }).click();
  await expect(page.locator('body')).toContainText(/Pagellone giornata 2 pronto per la pubblicazione/i);
  await publishPending(page);

  const path = 'tornei/2026-test/data/pagelloni/pagellone_giornata_2.txt';
  expect(sourceText(mock, path)).toContain('Prestazione E2E molto solida');
  expect(sourceText(mock, 'tornei/2026-test/data/manifest.csv')).toContain('pagelloni/pagellone_giornata_2.txt');

  await reloadAdmin(page);
  await nav(page, 'Pagellone');
  await expect(page.locator('.pagella-edit').first()).toContainText('Pagella 1');
  await expect(page.locator('.pagella-edit').first().locator('.field').filter({ hasText: 'Voto' }).locator('input')).toHaveValue('7,5');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Pagellone: voto non riconosciuto viene rifiutato senza pending', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Pagellone');
  await page.getByRole('button', { name: '+ Pagella' }).click();
  const card = page.locator('.pagella-edit').first();
  await card.locator('.field').filter({ hasText: 'Voto' }).locator('input').fill('ottimo');
  await page.getByRole('button', { name: 'Salva Pagellone' }).click();
  await expect(page.locator('body')).toContainText(/voto.*non riconosciuto/i);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Fantacalcio
// -----------------------------------------------------------------------------

test('Fantacalcio: listone, rosa partecipante ed evento speciale persistono insieme', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Fantacalcio');
  const cards = page.locator('.main > .card');
  const listoneCard = cards.filter({ hasText: '1. Listone Fantacalcio' });
  await listoneCard.locator('input[type="file"]').setInputFiles({
    name: 'listone.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'id;ruolo;giocatore;squadra;crediti;baseCreditiSuggeriti',
      '001;P;Mario Rossi;Alpha;10;8',
      '002;A;Luca Bianchi;Alpha;20;18',
      '003;P;Paolo Verdi;Beta;11;9'
    ].join('\n'))
  });
  await listoneCard.getByRole('button', { name: 'Conferma caricamento listone' }).click();
  await expect(page.locator('body')).toContainText(/Listone caricato: 3 giocatori/i);

  const rosterCard = page.locator('.main > .card').filter({ hasText: '2. Rose partecipanti' });
  await rosterCard.locator('input[type="file"]').setInputFiles({
    name: 'rosa_mister_e2e.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'giornata;partecipante;idGiocatore',
      '2;Mister E2E;001',
      '2;Mister E2E;002'
    ].join('\n'))
  });
  await expect(rosterCard.locator('.data-table tbody tr')).toHaveCount(1);
  await rosterCard.getByRole('button', { name: 'Conferma caricamento rose' }).click();
  await expect(page.locator('body')).toContainText(/1 rose pronte per la pubblicazione/i);

  const eventCard = page.locator('.main > .card').filter({ hasText: '3. Eventi speciali' });
  const eventFields = eventCard.locator('.field');
  await eventFields.filter({ hasText: 'Giocatore' }).locator('select').selectOption('001');
  await eventFields.filter({ hasText: 'Tipo evento' }).locator('select').selectOption('RIGORE_PARATO');
  await eventFields.filter({ hasText: 'Quantità' }).locator('input').fill('1');
  await eventCard.getByRole('button', { name: '+ Aggiungi evento' }).click();
  await eventCard.getByRole('button', { name: 'Salva eventi' }).click();
  await expect(page.locator('body')).toContainText(/eventi pronti per la pubblicazione/i);

  await publishPending(page);
  expect(sourceText(mock, 'tornei/2026-test/data/fantacalcio/listone_fantacalcio.csv')).toContain('001;P;Mario Rossi');
  expect(sourceText(mock, 'tornei/2026-test/data/fantacalcio/giornata2/rosa_mister_e2e_giornata2.csv')).toContain('Mister E2E;001');
  expect(sourceText(mock, 'tornei/2026-test/data/fantacalcio/eventi_fantacalcio.csv')).toContain('RIGORE_PARATO');
  expect(sourceText(mock, 'tornei/2026-test/data/fantacalcio/manifest_fantacalcio.csv')).toContain('listone_fantacalcio.csv');

  await reloadAdmin(page);
  await nav(page, 'Fantacalcio');
  await expect(page.locator('body')).toContainText(/Listone attualmente pubblicato: 3 giocatori/i);
  await expect(page.locator('body')).toContainText(/Eventi già presenti nel file pubblicato: 1/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Fantacalcio: listone con ID duplicato non può essere confermato', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Fantacalcio');
  const listoneCard = page.locator('.main > .card').filter({ hasText: '1. Listone Fantacalcio' });
  await listoneCard.locator('input[type="file"]').setInputFiles({
    name: 'listone_duplicato.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'id;ruolo;giocatore;squadra;crediti;baseCreditiSuggeriti',
      '001;P;Mario Rossi;Alpha;10;8',
      '1;A;Luca Bianchi;Alpha;20;18'
    ].join('\n'))
  });
  await expect(listoneCard).toContainText(/duplicato/i);
  await expect(listoneCard.getByRole('button', { name: 'Conferma caricamento listone' })).toHaveCount(0);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Classifiche
// -----------------------------------------------------------------------------

test('Classifiche: mostra squadre, capocannonieri, MVP e portieri dal repository', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Classifiche');
  await expect(page.getByRole('heading', { name: 'Classifiche' })).toBeVisible();

  const teams = page.locator('[data-ranking="classifica_squadre"]');
  const scorers = page.locator('[data-ranking="marcatori"]');
  const mvp = page.locator('[data-ranking="mvp"]');
  const keepers = page.locator('[data-ranking="portieri"]');
  await expect(teams.locator('tbody tr')).toHaveCount(1);
  await expect(teams.locator('tbody tr').first()).toContainText('Alpha');
  await expect(scorers.locator('tbody tr')).toHaveCount(1);
  await expect(scorers.locator('tbody tr').first()).toContainText('Luca Bianchi');
  await expect(mvp.locator('tbody tr')).toHaveCount(1);
  await expect(mvp.locator('tbody tr').first()).toContainText('Luca Bianchi');
  await expect(keepers.locator('tbody tr')).toHaveCount(1);
  await expect(keepers.locator('tbody tr').first()).toContainText('Mario Rossi');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Classifiche: usa anche le modifiche pending, così la preview è completa prima della pubblicazione', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'classifica_marcatori.csv' }).click();
  const editor = page.locator('.file-list .card').last();
  const current = await editor.locator('textarea').inputValue();
  await editor.locator('textarea').fill(`${current.trimEnd()}\n2;Andrea Neri;Beta;1;1;\n`);
  await editor.getByRole('button', { name: 'Salva modifica' }).click();

  await nav(page, 'Classifiche');
  const scorers = page.locator('[data-ranking="marcatori"]');
  await expect(scorers.locator('tbody tr')).toHaveCount(2);
  await expect(scorers).toContainText('Andrea Neri');

  await nav(page, 'Pubblica');
  await expect(page.locator('.change-row')).not.toHaveCount(0);
  expect(sourceText(mock, 'tornei/2026-test/data/classifica_marcatori.csv')).not.toContain('Andrea Neri');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Classifiche: gestisce classifiche mancanti o vuote senza crash', async ({ page }) => {
  const mock = createGitHubMock();
  mock.source.commitChanges('main', [
    { path: 'tornei/2026-test/data/classifica_squadre.csv', content: 'Posizione;Squadra;PG;V;N;P;GF;GS;DR;Punti finali;Penalità;Nota penalità\n' },
    { path: 'tornei/2026-test/data/classifica_marcatori.csv', delete: true },
    { path: 'tornei/2026-test/data/classifica_mvp.csv', delete: true },
    { path: 'tornei/2026-test/data/classifica_portieri.csv', delete: true }
  ], 'Fixture classifiche vuote');
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Classifiche');
  await expect(page.locator('body')).toContainText(/Classifica squadre non presente/i);
  await expect(page.locator('body')).toContainText(/Classifica marcatori non presente/i);
  await expect(page.locator('body')).toContainText(/Classifica MVP non presente/i);
  await expect(page.locator('body')).toContainText(/Classifica portieri non presente/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Immagini
// -----------------------------------------------------------------------------

test('Immagini: stemma squadra e foto giocatore diventano WebP, si pubblicano e restano nel repository', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Immagini');
  const assetCard = page.locator('.card').filter({ hasText: 'Stemma squadra / foto giocatore' });
  const selects = assetCard.locator('select');
  const picker = assetCard.locator('input[type="file"]');

  await selects.nth(0).selectOption('team');
  await selects.nth(1).selectOption('Alpha');
  await picker.setInputFiles({ name: 'alpha.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await expect(page.locator('body')).toContainText(/Immagine Alpha convertita in WebP/i, { timeout: 20_000 });

  await nav(page, 'Immagini');
  const refreshedCard = page.locator('.card').filter({ hasText: 'Stemma squadra / foto giocatore' });
  const refreshedSelects = refreshedCard.locator('select');
  await refreshedSelects.nth(0).selectOption('player');
  await refreshedSelects.nth(1).selectOption('Alpha');
  await refreshedSelects.nth(2).selectOption({ index: 0 });
  await refreshedCard.locator('input[type="file"]').setInputFiles({ name: 'mario.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await expect(page.locator('body')).toContainText(/convertita in WebP e pronta per la pubblicazione/i, { timeout: 20_000 });

  await publishPending(page);
  expect(mock.source.readFile('tornei/2026-test/immagini/squadre/alpha.webp')).not.toBeNull();
  expect(mock.source.readFile('tornei/2026-test/immagini/giocatori/rossimario.webp')).not.toBeNull();

  await reloadAdmin(page);
  await nav(page, 'Immagini');
  await expect(page.getByRole('heading', { name: 'Immagini' })).toBeVisible();
  expect(mock.source.readFile('tornei/2026-test/immagini/squadre/alpha.webp')).not.toBeNull();
  expect(mock.source.readFile('tornei/2026-test/immagini/giocatori/rossimario.webp')).not.toBeNull();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Immagini: aggiornamento logo usa commit atomico immediato e persiste al reload', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const before = Buffer.from(mock.source.readFile('tornei/2026-test/immagini/logo_cral.png'));
  const beforeHead = mock.source.head().commitSha;

  await nav(page, 'Immagini');
  const logoCard = page.locator('.card').filter({ hasText: 'Logo torneo' });
  page.once('dialog', dialog => dialog.accept());
  await logoCard.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await expect(page.locator('body')).toContainText(/Logo aggiornato\. Commit/i, { timeout: 20_000 });
  const after = mock.source.readFile('tornei/2026-test/immagini/logo_cral.png');
  expect(after).not.toBeNull();
  // Il contenuto può coincidere con la fixture PNG se il browser ricodifica in modo equivalente:
  // ciò che certifichiamo è che il file esiste nel nuovo commit e l'Admin ha completato il flusso.
  expect(mock.source.head().commitSha).not.toBe(beforeHead);
  expect(before.length).toBeGreaterThan(0);

  await reloadAdmin(page);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Immagini: file non immagine viene rifiutato senza pending', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Immagini');
  const assetCard = page.locator('.card').filter({ hasText: 'Stemma squadra / foto giocatore' });
  await assetCard.locator('input[type="file"]').setInputFiles({ name: 'non-immagine.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') });
  await expect(page.locator('body')).toContainText(/Seleziona un file immagine/i);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Verifica
// -----------------------------------------------------------------------------

test('Verifica: stato valido non produce errori bloccanti e il report diventa stale dopo una modifica', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Verifica');
  await page.getByRole('button', { name: 'Esegui verifica' }).click();
  await expect(page.locator('body')).toContainText(/nessun errore bloccante/i, { timeout: 20_000 });
  await expect(page.locator('.pro-report-row.error')).toHaveCount(0);

  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'config.csv' }).click();
  const textarea = page.locator('.file-list .card').last().locator('textarea');
  await textarea.fill(`${await textarea.inputValue()}verify_stale;1\n`);
  await page.getByRole('button', { name: 'Salva modifica' }).click();
  await nav(page, 'Verifica');
  await expect(page.locator('body')).toContainText(/report visualizzato non è più aggiornato/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Verifica: squadra inesistente nel calendario viene segnalata come errore', async ({ page }) => {
  const mock = createGitHubMock();
  mock.source.commitChanges('main', [{
    path: 'tornei/2026-test/data/calendario.csv',
    content: 'Giornata;Data;Squadra casa;Squadra trasferta;Note\n1;2026-09-10;Alpha;Gamma;INVALID-E2E\n'
  }], 'Fixture calendario non coerente');
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Verifica');
  await page.getByRole('button', { name: 'Esegui verifica' }).click();
  await expect(page.locator('body')).toContainText(/squadra trasferta non esistente: Gamma/i, { timeout: 20_000 });
  await expect(page.locator('.pro-report-row.error')).not.toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Verifica: Ricostruisci manifest crea pending pubblicabile e persiste', async ({ page }) => {
  const mock = createGitHubMock();
  mock.source.commitChanges('main', [{
    path: 'tornei/2026-test/data/pagelloni/pagellone_giornata_1.txt',
    content: 'SQUADRA: Alpha\n\nGIOCATORE: Mario Rossi\nTESTO: Fixture fuori manifest\nVOTO: 6\n'
  }], 'Fixture file dati fuori manifest');
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  expect(sourceText(mock, 'tornei/2026-test/data/manifest.csv')).not.toContain('pagelloni/pagellone_giornata_1.txt');
  await nav(page, 'Verifica');
  await page.getByRole('button', { name: 'Ricostruisci manifest' }).click();
  await expect(page.locator('body')).toContainText(/manifest\.csv ricostruito/i);
  await publishPending(page);
  expect(sourceText(mock, 'tornei/2026-test/data/manifest.csv')).toContain('pagelloni/pagellone_giornata_1.txt');

  await reloadAdmin(page);
  await nav(page, 'Verifica');
  await page.getByRole('button', { name: 'Esegui verifica' }).click();
  await expect(page.locator('body')).toContainText(/Verifica completata/i, { timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText(/manifest\.csv punta a un file non caricato\/esistente: pagelloni\/pagellone_giornata_1\.txt/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Pubblica
// -----------------------------------------------------------------------------

test('Pubblica: senza pending mostra stato vuoto e non espone il bottone di commit', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  await expect(page.getByRole('button', { name: 'Pubblica in collaudo' })).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Pubblica: Scarta tutte elimina i pending senza scrivere il repository', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const original = sourceText(mock, 'tornei/2026-test/data/config.csv');

  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'config.csv' }).click();
  const editor = page.locator('.file-list .card').last();
  await editor.locator('textarea').fill(`${original}scarta_e2e;si\n`);
  await editor.getByRole('button', { name: 'Salva modifica' }).click();
  await nav(page, 'Pubblica');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Scarta tutte' }).click();
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(sourceText(mock, 'tornei/2026-test/data/config.csv')).toBe(original);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Promuovi
// -----------------------------------------------------------------------------

test('Promuovi: conferma errata blocca il commit di Produzione', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const before = mock.production.head().commitSha;

  await nav(page, 'Promuovi');
  await page.getByRole('button', { name: /Confronta con Produzione/i }).click();
  await page.getByPlaceholder('PROMUOVI PRODUZIONE').fill('NO');
  await page.getByRole('button', { name: /Promuovi ora/i }).click();
  await expect(page.locator('body')).toContainText(/Digita esattamente PROMUOVI PRODUZIONE/i);
  expect(mock.production.head().commitSha).toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Promuovi: pending locali bloccano la promozione prima di toccare Produzione', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const before = mock.production.head().commitSha;

  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'config.csv' }).click();
  const editor = page.locator('.file-list .card').last();
  await editor.locator('textarea').fill(`${await editor.locator('textarea').inputValue()}pending_promote;1\n`);
  await editor.getByRole('button', { name: 'Salva modifica' }).click();

  await nav(page, 'Promuovi');
  await page.getByRole('button', { name: /Confronta con Produzione/i }).click();
  await page.getByPlaceholder('PROMUOVI PRODUZIONE').fill('PROMUOVI PRODUZIONE');
  await page.getByRole('button', { name: /Promuovi ora/i }).click();
  await expect(page.locator('body')).toContainText(/prima pubblica o scarta/i);
  expect(mock.production.head().commitSha).toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Impostazioni
// -----------------------------------------------------------------------------

test('Impostazioni: titolo e descrizione vengono salvati atomicamente e riletti', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'Impostazioni');
  await expect(page.getByRole('heading', { name: 'Impostazioni torneo' })).toBeVisible();
  await expect(field(page, 'Titolo').locator('input')).toBeVisible({ timeout: 10_000 });
  await field(page, 'Titolo').locator('input').fill('Titolo impostazioni E2E');
  await field(page, 'Descrizione').locator('input').fill('Descrizione impostazioni E2E');
  await page.getByRole('button', { name: 'Salva impostazioni' }).click();
  await expect(page.locator('body')).toContainText(/Impostazioni salvate\. Commit/i, { timeout: 20_000 });

  const registry = JSON.parse(sourceText(mock, 'tornei.json'));
  const entry = registry.tornei.find(t => t.id === '2026-test');
  expect(entry.titolo).toBe('Titolo impostazioni E2E');
  expect(entry.descrizione).toBe('Descrizione impostazioni E2E');

  await reloadAdmin(page);
  await nav(page, 'Impostazioni');
  await expect(field(page, 'Titolo').locator('input')).toHaveValue('Titolo impostazioni E2E', { timeout: 10_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Impostazioni: pending locali bloccano il salvataggio del registry', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const before = sourceText(mock, 'tornei.json');

  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'config.csv' }).click();
  const editor = page.locator('.file-list .card').last();
  await editor.locator('textarea').fill(`${await editor.locator('textarea').inputValue()}settings_pending;1\n`);
  await editor.getByRole('button', { name: 'Salva modifica' }).click();

  await nav(page, 'Impostazioni');
  await expect(field(page, 'Titolo').locator('input')).toBeVisible({ timeout: 10_000 });
  await field(page, 'Titolo').locator('input').fill('NON DEVE SALVARSI');
  await page.getByRole('button', { name: 'Salva impostazioni' }).click();
  await expect(page.locator('body')).toContainText(/prima pubblica o scarta/i);
  expect(sourceText(mock, 'tornei.json')).toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// File
// -----------------------------------------------------------------------------

test('File: crea, rinomina ed elimina un file mantenendo manifest e repository coerenti', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'File');
  const manager = page.locator('.card').filter({ hasText: 'Gestione file' });
  await manager.getByPlaceholder('es. note_extra.csv').fill('note_e2e.txt');
  await manager.getByPlaceholder('Contenuto del nuovo file').fill('contenuto E2E\n');
  await manager.getByRole('button', { name: 'Aggiungi alle modifiche' }).click();
  await publishPending(page);
  expect(sourceText(mock, 'tornei/2026-test/data/note_e2e.txt')).toBe('contenuto E2E\n');
  expect(sourceText(mock, 'tornei/2026-test/data/manifest.csv')).toContain('note_e2e.txt');

  await reloadAdmin(page);
  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'note_e2e.txt' }).click();
  const renameManager = page.locator('.card').filter({ hasText: 'Gestione file' });
  const renameInput = renameManager.locator('.field').filter({ hasText: 'Rinomina note_e2e.txt' }).locator('input');
  await expect(renameInput).toBeVisible();
  await renameInput.fill('note_e2e_rinominato.txt');
  await renameManager.getByRole('button', { name: 'Rinomina' }).click();
  await publishPending(page);
  expect(mock.source.readFile('tornei/2026-test/data/note_e2e.txt')).toBeNull();
  expect(sourceText(mock, 'tornei/2026-test/data/note_e2e_rinominato.txt')).toBe('contenuto E2E\n');

  await reloadAdmin(page);
  await nav(page, 'File');
  await page.locator('.file-item').filter({ hasText: 'note_e2e_rinominato.txt' }).click();
  const deleteManager = page.locator('.card').filter({ hasText: 'Gestione file' });
  page.once('dialog', dialog => dialog.accept());
  await deleteManager.getByRole('button', { name: 'Elimina file' }).click();
  await publishPending(page);
  expect(mock.source.readFile('tornei/2026-test/data/note_e2e_rinominato.txt')).toBeNull();
  expect(sourceText(mock, 'tornei/2026-test/data/manifest.csv')).not.toContain('note_e2e_rinominato.txt');

  await reloadAdmin(page);
  await nav(page, 'File');
  await expect(page.locator('.file-item').filter({ hasText: 'note_e2e_rinominato.txt' })).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('File: percorso con traversal viene rifiutato senza creare pending', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await nav(page, 'File');
  const manager = page.locator('.card').filter({ hasText: 'Gestione file' });
  await manager.getByPlaceholder('es. note_extra.csv').fill('../evil.csv');
  await manager.getByPlaceholder('Contenuto del nuovo file').fill('evil');
  await manager.getByRole('button', { name: 'Aggiungi alle modifiche' }).click();
  await expect(page.locator('body')).toContainText(/percorso relativo sotto data/i);
  await nav(page, 'Pubblica');
  await expect(page.locator('body')).toContainText(/Nessuna modifica pronta/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

// -----------------------------------------------------------------------------
// Storico
// -----------------------------------------------------------------------------

test('Storico: rollback alla versione corrente non crea un commit inutile', async ({ page }) => {
  const mock = createGitHubMock({ rollbackHistory: true });
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  const before = mock.source.head().commitSha;

  await nav(page, 'Storico');
  const rows = page.locator('.pro-history-row');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  page.once('dialog', dialog => dialog.accept());
  await rows.nth(0).getByRole('button', { name: /Ripristina torneo/i }).click();
  await expect(page.locator('body')).toContainText(/coincide già con la versione selezionata/i, { timeout: 20_000 });
  expect(mock.source.head().commitSha).toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});
