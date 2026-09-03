import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const coreSource = fs.readFileSync(path.join(root, 'admin/core.js'), 'utf8');
const core = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`);
const { parseCsv, rowsToObjects, norm, field, csvStringify, safeTeamFilename } = core;

const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const version = html.match(/admin-pro-v(\d+)\.js/i)?.[1];
assert.ok(version, 'Admin Pro non referenziato da admin/index.html');
const source = fs.readFileSync(path.join(root, `admin/admin-pro-v${version}.js`), 'utf8');

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(nextName, start);
  assert.ok(start >= 0 && end > start, `${name} non trovata nel sorgente Admin Pro`);
  return source.slice(start, end).trim();
}

function buildDetector() {
  const functionSource = extractFunction('proDetectCsv', 'async function proAnalyzeFiles');
  const factory = new Function(
    'parseCsv', 'rowsToObjects', 'norm', 'field', 'csvStringify', 'safeTeamFilename',
    `
      function proHeaders(rows){return (rows?.[0]||[]).map(h=>norm(h));}
      function proHas(headers,...names){return names.some(n=>headers.includes(norm(n)));}
      function proField(row, aliases){return field(row, aliases);}
      ${functionSource}
      return proDetectCsv;
    `
  );
  return factory(parseCsv, rowsToObjects, norm, field, csvStringify, safeTeamFilename);
}

const detect = buildDetector();

test('CSV calendario con colonne Gol vuote resta Calendario', () => {
  const csv = [
    'Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta',
    '1;2026-09-10;Alpha;;Beta;',
    '2;2026-09-17;Beta;;Alpha;'
  ].join('\n');
  const out = detect('calendario_definitivo.csv', csv);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'calendario');
  assert.equal(out[0].rel, 'calendario.csv');
});

test('CSV con almeno un punteggio valorizzato viene riconosciuto come Risultati', () => {
  const csv = [
    'Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta',
    '1;2026-09-10;Alpha;2;Beta;1',
    '2;2026-09-17;Beta;;Alpha;'
  ].join('\n');
  const out = detect('partite.csv', csv);
  assert.equal(out[0].kind, 'risultati');
  assert.equal(out[0].rel, 'risultati_partite.csv');
});

test('filename esplicito risultati resta Risultati anche con punteggi vuoti', () => {
  const csv = [
    'Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta',
    '1;2026-09-10;Alpha;;Beta;'
  ].join('\n');
  const out = detect('risultati_partite.csv', csv);
  assert.equal(out[0].kind, 'risultati');
});

test('CSV unico con colonna Squadra viene suddiviso in una rosa per squadra', () => {
  const csv = [
    'Squadra;Nome;Cognome;Ruolo;Numero;Capitano',
    'Alpha;Mario;Rossi;P;1;SI',
    'Alpha;Luca;Bianchi;A;9;',
    'Beta;Paolo;Verdi;P;1;SI',
    'Beta;Andrea;Neri;A;10;'
  ].join('\n');
  const out = detect('rose.csv', csv);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(x => x.kind), ['squadra', 'squadra']);
  assert.ok(out.some(x => /squadra_Alpha\.csv$/i.test(x.rel)));
  assert.ok(out.some(x => /squadra_Beta\.csv$/i.test(x.rel)));
});
