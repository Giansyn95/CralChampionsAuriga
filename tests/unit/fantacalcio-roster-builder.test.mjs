import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const builder = require('../../tornei/2026-spring/crea-rosa.js');
const listoneText = fs.readFileSync('tornei/2026-spring/data/fantacalcio/listone_fantacalcio.csv', 'utf8');
const sampleRosterBuffer = fs.readFileSync('tornei/2026-spring/data/fantacalcio/giornata1/rosa_filippo_capurso_giornata1.csv');

const adminCoreSource = fs.readFileSync('admin/core.js', 'utf8');
const adminCore = await import(`data:text/javascript;base64,${Buffer.from(adminCoreSource).toString('base64')}`);

test('builder legge il listone ufficiale e ricava il budget corrente', () => {
  const parsed = builder.parseListone(listoneText);
  assert.equal(parsed.players.length, 35);
  assert.equal(parsed.budget, 250);
  assert.equal(parsed.players.filter(p => builder.fantaRole(p.role) === 'PT').length, 5);
});

test('il listone corrente consente almeno una rosa valida 1 PT + 4 movimento entro il budget', () => {
  const parsed = builder.parseListone(listoneText);
  const byCreditsThenId = (a, b) => Number(a.credits) - Number(b.credits) || String(a.id).localeCompare(String(b.id));
  const keepers = parsed.players.filter(p => builder.fantaRole(p.role) === 'PT').sort(byCreditsThenId);
  const movement = parsed.players.filter(p => builder.fantaRole(p.role) !== 'PT').sort(byCreditsThenId);

  assert.ok(keepers.length >= 1, 'Il listone deve contenere almeno un portiere');
  assert.ok(movement.length >= 4, 'Il listone deve contenere almeno quattro giocatori di movimento');

  const ids = [keepers[0], ...movement.slice(0, 4)].map(p => p.id);
  const result = builder.validateRoster(ids, parsed.players, parsed.budget);
  assert.equal(result.valid, true, result.errors.join(' | '));
  assert.equal(result.total, 5);
  assert.equal(result.keepers, 1);
  assert.equal(result.movement, 4);
  assert.ok(result.credits <= parsed.budget, `Rosa minima fuori budget: ${result.credits}/${parsed.budget}`);
  assert.equal(result.remaining, parsed.budget - result.credits);
});

test('CSV utente generato è complessivo e senza giornata nel nome/contenuto', () => {
  const ids = ['001', '010', '021', '028', '030'];
  const csv = builder.buildRosterCsv('Filippo Capurso', ids);
  assert.equal(csv, [
    'partecipante;idGiocatore',
    'Filippo Capurso;001',
    'Filippo Capurso;010',
    'Filippo Capurso;021',
    'Filippo Capurso;028',
    'Filippo Capurso;030',
    ''
  ].join('\r\n'));
  assert.equal(builder.rosterFileName('Filippo Capurso'), 'rosa_filippo_capurso.csv');
  assert.equal(builder.rosterFileName('Nicola De Leo'), 'rosa_nicola_de_leo.csv');
  assert.equal(/giornata/i.test(csv), false);
});

test('Admin accetta il CSV complessivo e lo espande nei file canonici per giornata', () => {
  const generated = builder.buildRosterCsv('Filippo Capurso', ['001', '010', '021', '028', '030']);
  const parsedListone = adminCore.parseListoneCsv(listoneText);
  const listoneMap = adminCore.listoneIndex(parsedListone.players);
  const parsedUpload = adminCore.parseRosterUpload(generated, null);

  assert.deepEqual(parsedUpload.errors, []);
  assert.equal(parsedUpload.rosters.length, 1);
  assert.equal(parsedUpload.rosters[0].giornata, null);
  assert.equal(parsedUpload.rosters[0].complessiva, true);
  assert.equal(parsedUpload.rosters[0].partecipante, 'Filippo Capurso');
  assert.deepEqual(parsedUpload.rosters[0].ids, ['001', '010', '021', '028', '030']);
  assert.deepEqual(adminCore.validateRosterAgainstListone(parsedUpload.rosters[0], listoneMap).errors, []);

  const expanded = adminCore.expandRosterAcrossDays(parsedUpload.rosters[0], [1, 2, 3]);
  assert.deepEqual(expanded.map(r => r.giornata), [1, 2, 3]);
  assert.ok(expanded.every(r => r.complessiva === false));
  assert.equal(adminCore.rosterRelPath('Filippo Capurso', 1), 'fantacalcio/giornata1/rosa_filippo_capurso_giornata1.csv');
  // Il file interno di giornata 1 mantiene struttura e contenuto del formato FE storico.
  assert.equal(adminCore.rosterCsvContent(expanded[0], ';').replace(/\r\n/g, '\n'), sampleRosterBuffer.toString('utf8').replace(/\r\n/g, '\n'));
});

test('Admin mantiene compatibilità con il vecchio CSV già per giornata', () => {
  const parsedUpload = adminCore.parseRosterUpload(sampleRosterBuffer.toString('utf8'), null);
  assert.deepEqual(parsedUpload.errors, []);
  assert.equal(parsedUpload.rosters[0].giornata, 1);
  assert.equal(parsedUpload.rosters[0].complessiva, false);
  assert.deepEqual(adminCore.expandRosterAcrossDays(parsedUpload.rosters[0], [1, 2, 3]).map(r => r.giornata), [1]);
});


test('la UI del builder non espone una giornata fissa nel riepilogo', () => {
  const html = fs.readFileSync('tornei/2026-spring/crea-rosa.html', 'utf8');
  assert.ok(!html.includes('Giornata 1'));
  assert.ok(html.includes('rosa_nome_cognome.csv'));
});

test('builder si abilita solo se il manifest del torneo dichiara il listone Fantacalcio', () => {
  const manifestWithFanta = 'file\nclassifica_squadre.csv\nfantacalcio/listone_fantacalcio.csv\n';
  const manifestWithoutFanta = 'file\nclassifica_squadre.csv\ncalendario.csv\n';
  assert.equal(builder.manifestHasFantacalcio(manifestWithFanta), true);
  assert.equal(builder.manifestHasFantacalcio(manifestWithoutFanta), false);
});

test('finestra Crea la tua rosa: flag manuale e timer vengono rispettati', () => {
  const cfg = builder.parseConfig([
    'chiave;valore',
    'fantacalcioCreazioneRosaEnabled;true',
    'fantacalcioCreazioneRosaOpenFrom;2030-01-10T08:00:00.000Z',
    'fantacalcioCreazioneRosaCloseAt;2030-01-20T18:00:00.000Z'
  ].join('\n'));

  assert.equal(builder.rosterWindowStatus(cfg, Date.parse('2030-01-09T12:00:00Z')).reason, 'not-open-yet');
  assert.equal(builder.rosterWindowStatus(cfg, Date.parse('2030-01-15T12:00:00Z')).open, true);
  assert.equal(builder.rosterWindowStatus(cfg, Date.parse('2030-01-20T18:00:00Z')).reason, 'closed');

  const disabled = builder.parseConfig('chiave;valore\nfantacalcioCreazioneRosaEnabled;false\n');
  assert.equal(builder.rosterWindowStatus(disabled, Date.parse('2030-01-15T12:00:00Z')).reason, 'disabled');
});

test('tornei legacy senza chiavi timer restano abilitati per retrocompatibilità', () => {
  const cfg = builder.parseConfig('chiave;valore\ntitolo;Torneo legacy\n');
  assert.equal(builder.rosterWindowStatus(cfg, Date.parse('2030-01-15T12:00:00Z')).open, true);
});

test('builder rifiuta rose senza PT, duplicate o fuori budget', () => {
  const parsed = builder.parseListone(listoneText);
  const noKeeper = builder.validateRoster(['006', '007', '008', '010', '011'], parsed.players, parsed.budget);
  assert.equal(noKeeper.valid, false);
  assert.ok(noKeeper.errors.some(x => /portiere/i.test(x)));

  const duplicate = builder.validateRoster(['001', '001', '010', '021', '028'], parsed.players, parsed.budget);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some(x => /più di una volta/i.test(x)));

  const synthetic = [
    { id: '001', role: 'PT', credits: 80 },
    { id: '002', role: 'G', credits: 60 },
    { id: '003', role: 'G', credits: 60 },
    { id: '004', role: 'G', credits: 60 },
    { id: '005', role: 'G', credits: 60 }
  ];
  const overBudget = builder.validateRoster(['001', '002', '003', '004', '005'], synthetic, 250);
  assert.equal(overBudget.valid, false);
  assert.ok(overBudget.errors.some(x => /Budget superato/i.test(x)));
});

test('CTA Crea la tua rosa viene costruita prima della label di selezione giornata', () => {
  const source = fs.readFileSync('tornei/2026-spring/index.html', 'utf8');
  const cta = source.indexOf("creatorLink.textContent='⚽ Crea la tua rosa'");
  const claim = source.indexOf("intro.textContent='Scegli la giornata e il punteggio si aggiorna con risultati e statistiche del torneo.'");
  assert.ok(cta >= 0, 'CTA Crea la tua rosa non trovata');
  assert.ok(claim >= 0, 'Label Scegli la giornata non trovata');
  assert.ok(cta < claim, 'La CTA deve essere costruita prima della label Scegli la giornata');
});

test('Admin usa la rosa complessiva senza fallback alla giornata selezionata e la espande sul calendario', () => {
  const source = fs.readFileSync('admin/admin.js', 'utf8');
  assert.ok(source.includes('parseRosterUpload(text,filenameDay)'), 'Import rosa non usa il nuovo contratto complessivo');
  assert.ok(source.includes('expandRosterAcrossDays(r,model.days)'), 'Import rosa non viene espanso sulle giornate del calendario');
  assert.ok(!source.includes('const defaultGiornata=state.selectedDay||1;'), 'Non deve più esistere il fallback implicito alla giornata corrente');
});
