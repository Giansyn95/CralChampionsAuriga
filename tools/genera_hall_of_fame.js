#!/usr/bin/env node
'use strict';

/*
  Genera hall_of_fame.json nella root del sito.

  Perche esiste:
  - la Hall of Fame della landing leggeva 4 CSV per ogni edizione conclusa
    (4 x N richieste). Con questo snapshot ne basta 1, qualunque sia N.

  Garanzie:
  - usa lo STESSO motore (CRALHallOfFame) incorporato in index.html tra i
    marcatori CRAL_HALL_ENGINE_START/END: nessuna logica duplicata, quindi
    snapshot e fallback CSV della landing danno sempre gli stessi risultati;
  - e deterministico: se i dati non cambiano il file non viene riscritto
    (nessun commit inutile, "generatoIl" resta quello precedente);
  - la landing confronta "firma" (id delle edizioni concluse) con tornei.json:
    se non coincide ignora lo snapshot e calcola dai CSV.

  Uso:  node tools/genera_hall_of_fame.js
*/

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const VERSIONE = 1;
const OUT = path.join(root, 'hall_of_fame.json');
const FILES = ['classifica_squadre.csv', 'classifica_marcatori.csv', 'classifica_mvp.csv', 'classifica_portieri.csv'];

function fail(msg) {
  console.error(`::error title=Hall of Fame::${msg}`);
  process.exit(1);
}

// Stesse regole di index.html (esc / slug / torneoKey / normalizzaStato).
const esc = v => String(v == null ? '' : v);
const slug = v => esc(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const torneoKey = t => esc(t.id || [t.anno, slug(t.stagione || t.nome)].filter(Boolean).join('-'));
function normalizzaStato(stato) {
  const k = esc(stato).toLowerCase().replace(/[\s_]/g, '-');
  if (/corso|attuale|corrente|nuova/.test(k)) return 'in-corso';
  if (/prossim|futuro|upcoming/.test(k)) return 'prossimo';
  return 'concluso';
}

function loadEngine() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const m = html.match(/\/\* CRAL_HALL_ENGINE_START \*\/([\s\S]*?)\/\* CRAL_HALL_ENGINE_END \*\//);
  if (!m) fail('Motore CRALHallOfFame non trovato in index.html');
  return new Function(m[1] + '; return CRALHallOfFame;')();
}

function readCsv(dir, name) {
  const f = path.join(dir, 'data', name);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

function main() {
  const registryFile = path.join(root, 'tornei.json');
  if (!fs.existsSync(registryFile)) fail('tornei.json non trovato');
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  const concluded = (Array.isArray(registry.tornei) ? registry.tornei : [])
    .filter(t => t && t.attivo !== false && normalizzaStato(t.stato) === 'concluso');

  const engine = loadEngine();

  const editions = concluded.map(t => {
    const dir = path.join(root, String(t.cartella || t.url || '').replace(/\/+$/, ''));
    const csv = FILES.map(f => readCsv(dir, f));
    if (!csv.some(Boolean)) console.warn(`Attenzione: nessun CSV di classifica trovato in ${toRel(dir)}`);
    // Solo i campi usati dal rendering: lo snapshot resta piccolo.
    const tournament = { id: torneoKey(t), anno: t.anno, stagione: t.stagione, nome: t.nome, url: t.url || (t.cartella ? t.cartella + '/' : ''), ordine: t.ordine };
    return {
      tournament,
      completed: true,
      standings: engine.parseCsv(csv[0]),
      scorers: engine.parseCsv(csv[1]),
      mvps: engine.parseCsv(csv[2]),
      keepers: engine.parseCsv(csv[3])
    };
  });

  const data = engine.build(editions);
  const firma = concluded.map(torneoKey).sort();
  const core = { versione: VERSIONE, firma, data };

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { /* primo run */ }
  if (previous) {
    const { generatoIl, ...prevCore } = previous;
    if (JSON.stringify(prevCore) === JSON.stringify(core)) {
      console.log(`hall_of_fame.json gia aggiornato (${firma.length} edizioni).`);
      return;
    }
  }

  const out = { ...core, generatoIl: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`hall_of_fame.json aggiornato: ${firma.length} edizioni (${firma.join(', ') || 'nessuna'}).`);
}

function toRel(p) { return path.relative(root, p).replace(/\\/g, '/') || '.'; }

main();
