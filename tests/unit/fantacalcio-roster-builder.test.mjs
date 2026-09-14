import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const builder = require('../../tornei/2026-spring/crea-rosa.js');
const listoneText = fs.readFileSync('tornei/2026-spring/data/fantacalcio/listone_fantacalcio.csv', 'utf8');
const sampleRosterBuffer = fs.readFileSync('tornei/2026-spring/data/fantacalcio/giornata1/rosa_filippo_capurso_giornata1.csv');
const sampleRoster = sampleRosterBuffer.toString('utf8');

const adminCoreSource = fs.readFileSync('admin/core.js', 'utf8');
const adminCore = await import(`data:text/javascript;base64,${Buffer.from(adminCoreSource).toString('base64')}`);

test('builder legge il listone ufficiale e ricava il budget corrente', () => {
  const parsed = builder.parseListone(listoneText);
  assert.equal(parsed.players.length, 35);
  assert.equal(parsed.budget, 250);
  assert.equal(parsed.players.filter(p => builder.fantaRole(p.role) === 'PT').length, 5);
});

test('la rosa campione rispetta la regola 1 PT + 4 movimento e il budget', () => {
  const parsed = builder.parseListone(listoneText);
  const ids = ['001', '010', '021', '028', '030'];
  const result = builder.validateRoster(ids, parsed.players, parsed.budget);
  assert.equal(result.valid, true, result.errors.join(' | '));
  assert.equal(result.total, 5);
  assert.equal(result.keepers, 1);
  assert.equal(result.movement, 4);
  assert.equal(result.credits, 48);
  assert.equal(result.remaining, 202);
});

test('CSV generato e filename sono compatibili con il contratto FE/Admin', () => {
  const ids = ['001', '010', '021', '028', '030'];
  const csv = builder.buildRosterCsv('Filippo Capurso', ids, 1);
  assert.deepEqual(Buffer.from(csv, 'utf8'), sampleRosterBuffer);
  assert.equal(builder.rosterFileName('Filippo Capurso'), 'rosa_filippo_capurso.csv');
  assert.equal(builder.rosterFileName('Nicola De Leo'), 'rosa_nicola_de_leo.csv');
});

test('il CSV generato viene accettato dal parser reale dell Admin', () => {
  const generated = builder.buildRosterCsv('Filippo Capurso', ['001', '010', '021', '028', '030'], 1);
  const parsedListone = adminCore.parseListoneCsv(listoneText);
  const listoneMap = adminCore.listoneIndex(parsedListone.players);
  const parsedUpload = adminCore.parseRosterUpload(generated, 1);

  assert.deepEqual(parsedUpload.errors, []);
  assert.equal(parsedUpload.rosters.length, 1);
  assert.equal(parsedUpload.rosters[0].giornata, 1);
  assert.equal(parsedUpload.rosters[0].partecipante, 'Filippo Capurso');
  assert.deepEqual(parsedUpload.rosters[0].ids, ['001', '010', '021', '028', '030']);
  assert.deepEqual(adminCore.validateRosterAgainstListone(parsedUpload.rosters[0], listoneMap).errors, []);
  assert.equal(builder.rosterFileName('Filippo Capurso'), 'rosa_filippo_capurso.csv');
  assert.equal(adminCore.rosterRelPath('Filippo Capurso', 1), 'fantacalcio/giornata1/rosa_filippo_capurso_giornata1.csv');
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
