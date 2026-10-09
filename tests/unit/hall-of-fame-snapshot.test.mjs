import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
const generator = path.join(repo, 'tools', 'genera_hall_of_fame.js');
const html = fs.readFileSync('index.html', 'utf8');

function makeSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cral-hof-'));
  fs.copyFileSync(path.join(repo, 'index.html'), path.join(dir, 'index.html'));
  const edition = (id, anno, ordine, stato, champion, scorer, goals) => {
    const d = path.join(dir, 'tornei', id, 'data');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'classifica_squadre.csv'), `Posizione;Squadra\n1;${champion}\n2;Altra\n`);
    fs.writeFileSync(path.join(d, 'classifica_marcatori.csv'), `Posizione;Squadra;Giocatore;Gol\n1;X;${scorer};${goals}\n`);
    fs.writeFileSync(path.join(d, 'classifica_mvp.csv'), `Posizione;Squadra;Giocatore;PuntiMVP\n1;X;${scorer};3\n`);
    fs.writeFileSync(path.join(d, 'classifica_portieri.csv'), `posizione;punti;Portiere;Squadra\n1;4;Verdi PT;X\n`);
    return { id, anno, stagione: 'Primavera', nome: 'Primavera', cartella: `tornei/${id}`, url: `tornei/${id}/`, stato, ordine, attivo: true };
  };
  const tornei = [
    edition('2025-spring', '2025', 20251, 'concluso', 'Team A', 'Mario Rossi', 7),
    edition('2026-spring', '2026', 20261, 'concluso', 'Team B', 'Mario Rossi', 8),
    edition('2027-spring', '2027', 20271, 'in-corso', 'Team C', 'Luca Bianchi', 999)
  ];
  fs.writeFileSync(path.join(dir, 'tornei.json'), JSON.stringify({ tornei }));
  return dir;
}
const run = cwd => execFileSync('node', [generator], { cwd, encoding: 'utf8' });

test('snapshot Hall of Fame: stessa logica della landing, edizioni in corso escluse', () => {
  const dir = makeSite();
  run(dir);
  const snap = JSON.parse(fs.readFileSync(path.join(dir, 'hall_of_fame.json'), 'utf8'));
  assert.equal(snap.versione, 1);
  assert.deepEqual(snap.firma, ['2025-spring', '2026-spring']);
  assert.equal(snap.data.editions, 2);
  assert.equal(snap.data.firstChampion.name, 'Team A');
  assert.equal(snap.data.allTimeScorer.name, 'Mario Rossi');
  assert.equal(snap.data.allTimeScorer.value, 15);
  assert.equal(snap.data.history[0].tournament.anno, '2026');
  assert.equal(snap.data.history[0].tournament.url, 'tornei/2026-spring/');
  assert.ok(!JSON.stringify(snap).includes('999'), 'edizione in corso non deve entrare nello snapshot');
});

test('snapshot Hall of Fame: e deterministico e non viene riscritto se i dati non cambiano', () => {
  const dir = makeSite();
  run(dir);
  const file = path.join(dir, 'hall_of_fame.json');
  const first = fs.readFileSync(file, 'utf8');
  assert.match(run(dir), /gia aggiornato/);
  assert.equal(fs.readFileSync(file, 'utf8'), first);

  // Un dato cambia -> viene riscritto.
  const csv = path.join(dir, 'tornei', '2026-spring', 'data', 'classifica_marcatori.csv');
  fs.writeFileSync(csv, 'Posizione;Squadra;Giocatore;Gol\n1;X;Mario Rossi;20\n');
  run(dir);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).data.allTimeScorer.value, 27);
});

test('snapshot Hall of Fame: la landing lo usa solo se la firma coincide e ha il fallback CSV', () => {
  assert.match(html, /fetch\('hall_of_fame\.json'/);
  assert.match(html, /j\.firma\.slice\(\)\.sort\(\)\.join\('\|'\)===hallSignature\(list\)/);
  assert.match(html, /\(await hallSnapshot\(list\)\) \|\| await hallFromCsv\(list\)/);
  assert.match(html, /hallPool\(list,3,/);
  assert.match(html, /const HALL_PAGE = \d+/);
});
