const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));
const norm = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

function csvHeader(file) {
  const text = read(file).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/).find(line => line.trim()) || '';
  const delimiter = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  return first.split(delimiter).map(x => x.trim().replace(/^"|"$/g, ''));
}

function manifestEntries(file) {
  const text = read(file).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) return [];
  return lines.slice(1).map(line => line.split(';')[0].trim().replace(/^"|"$/g, '')).filter(Boolean);
}

test('tornei.json e struttura tornei sono coerenti', async () => {
  expect(exists('tornei.json'), 'Manca tornei.json').toBeTruthy();
  const registry = JSON.parse(read('tornei.json'));
  expect(Array.isArray(registry.tornei), 'tornei.json deve contenere tornei[]').toBeTruthy();
  expect(registry.tornei.length, 'Deve esistere almeno un torneo').toBeGreaterThan(0);

  const ids = new Set();
  const folders = new Set();
  const current = registry.tornei.filter(t => t.corrente === true && t.attivo !== false);
  expect(current.length, 'Deve esserci al massimo un torneo corrente attivo').toBeLessThanOrEqual(1);

  for (const torneo of registry.tornei) {
    expect(torneo.id, 'Ogni torneo deve avere id').toBeTruthy();
    expect(torneo.cartella, `Torneo ${torneo.id}: manca cartella`).toBeTruthy();
    expect(ids.has(torneo.id), `ID torneo duplicato: ${torneo.id}`).toBeFalsy();
    expect(folders.has(torneo.cartella), `Cartella torneo duplicata: ${torneo.cartella}`).toBeFalsy();
    ids.add(torneo.id);
    folders.add(torneo.cartella);

    expect(exists(torneo.cartella), `Cartella inesistente: ${torneo.cartella}`).toBeTruthy();
    expect(exists(`${torneo.cartella}/index.html`), `Manca ${torneo.cartella}/index.html`).toBeTruthy();
    expect(exists(`${torneo.cartella}/data`), `Manca ${torneo.cartella}/data`).toBeTruthy();
    expect(exists(`${torneo.cartella}/data/manifest.csv`), `Manca manifest.csv in ${torneo.cartella}`).toBeTruthy();
  }

  if (registry.logo) {
    expect(exists(registry.logo), `Il logo globale dichiarato non esiste: ${registry.logo}`).toBeTruthy();
  }
});

test('manifest dei tornei non contiene sorgenti dati concorrenti', async () => {
  const registry = JSON.parse(read('tornei.json'));
  for (const torneo of registry.tornei) {
    const manifest = `${torneo.cartella}/data/manifest.csv`;
    const entries = manifestEntries(manifest);
    const normalized = entries.map(norm);

    expect(new Set(normalized).size, `${manifest}: righe duplicate`).toBe(normalized.length);

    const calendars = entries.filter(x => /calendario/i.test(x));
    expect(calendars.length, `${manifest}: più calendari attivi (${calendars.join(', ')})`).toBeLessThanOrEqual(1);

    const aggregate = entries.filter(x => /riepilogo[_-]?giornate\.csv$/i.test(x));
    const perDay = entries.filter(x => /riepilogo[_-]?giornata[_-]?\d+\.csv$/i.test(x));
    expect(!(aggregate.length && perDay.length), `${manifest}: riepilogo aggregato e per-giornata sono attivi insieme`).toBeTruthy();

    for (const rel of entries) {
      const target = `${torneo.cartella}/data/${rel}`;
      if (!exists(target)) {
        if (/^pagellone[_-]?giornata[_-]?\d+\.txt$/i.test(rel)) {
          console.warn(`WARNING legacy: ${manifest} contiene ${rel}, ma i pagelloni dovrebbero stare in data/pagelloni/.`);
          continue;
        }
        expect(exists(target), `${manifest}: file dichiarato ma inesistente: ${rel}`).toBeTruthy();
      }
    }
  }
});

test('CSV canonici hanno intestazioni minime riconoscibili', async () => {
  const registry = JSON.parse(read('tornei.json'));
  const required = {
    'calendario.csv': ['giornata', 'data', 'squadracasa', 'squadratrasferta'],
    'risultati_partite.csv': ['giornata', 'squadracasa', 'squadratrasferta'],
    'classifica_squadre.csv': ['squadra'],
    'classifica_marcatori.csv': ['giocatore', 'squadra'],
    'classifica_mvp.csv': ['giocatore', 'squadra'],
    'classifica_portieri.csv': ['squadra'],
    'riepilogo_giornate.csv': ['giornata']
  };

  for (const torneo of registry.tornei) {
    const root = `${torneo.cartella}/data`;
    for (const [name, cols] of Object.entries(required)) {
      const file = `${root}/${name}`;
      if (!exists(file)) continue;
      const h = csvHeader(file).map(norm);
      for (const col of cols) {
        expect(h.includes(col), `${file}: manca una colonna equivalente a "${col}"`).toBeTruthy();
      }
    }

    const teamFiles = fs.readdirSync(path.join(ROOT, root)).filter(x => /^squadra_.*\.csv$/i.test(x));
    for (const name of teamFiles) {
      const h = csvHeader(`${root}/${name}`).map(norm);
      expect(h.some(x => ['nome', 'giocatore', 'nomegiocatore'].includes(x)), `${root}/${name}: manca Nome/Giocatore`).toBeTruthy();
    }
  }
});
