#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();

function resolveFromRoot(value, fallback) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? path.normalize(raw) : path.join(repoRoot, raw);
}

function toRepoRelative(absPath) {
  return path.relative(repoRoot, absPath).replace(/\\/g, '/') || '.';
}

function existsDir(p) { return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory(); }
function existsFile(p) { return !!p && fs.existsSync(p) && fs.statSync(p).isFile(); }

// ── CSV parser minimale ───────────────────────────────────────────────────────
function parseCsvLine(line, sep) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (!inQ && ch === sep) { cells.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells;
}

function detectSep(line) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const c of line) if (counts[c] !== undefined) counts[c]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = detectSep(lines[0]);
  const headers = parseCsvLine(lines[0], sep).map(h => h.toLowerCase().trim());
  return lines.slice(1).map(l => {
    const cells = parseCsvLine(l, sep);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

function readCsv(filePath) {
  if (!existsFile(filePath)) return [];
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

// ── Normalizza nomi per confronto ─────────────────────────────────────────────
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/\s+pt\s*$/i, '')   // rimuove suffisso PT
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Legge classifica_portieri.csv ─────────────────────────────────────────────
function readPortieriClassifica(dataDir) {
  const f = path.join(dataDir, 'classifica_portieri.csv');
  const rows = readCsv(f);
  // Struttura: posizione;teamCode;playerName;punti;nota
  const result = {};
  for (const r of rows) {
    const name = r['playername'] || r['giocatore'] || r['nome'] || r['portiere'] || '';
    const punti = parseInt(r['punti'] || '0', 10) || 0;
    if (name) result[name] = punti;
  }
  return result; // { "Iacobellis PT": 5, ... }
}

// ── Legge calendario ──────────────────────────────────────────────────────────
// Restituisce { 1: [{casa, trasferta}], 2: [...], ... }
function readCalendario(dataDir) {
  const f = path.join(dataDir, 'calendario_andata_ritorno.csv');
  if (!existsFile(f)) return {};
  const text = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  // cal: { 1: { partite: [{casa,trasferta}], riposa: "Out Of Office FC" }, ... }
  const cal = {};
  let currentGiornata = null;
  let inHeader = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const gMatch = trimmed.match(/GIORNATA\s+(\d+)/i);
    if (gMatch) {
      currentGiornata = parseInt(gMatch[1], 10);
      inHeader = true;
      cal[currentGiornata] = cal[currentGiornata] || { partite: [], riposa: null };
      continue;
    }
    if (inHeader) { inHeader = false; continue; }
    if (currentGiornata !== null) {
      const sep = detectSep(trimmed);
      const cells = parseCsvLine(trimmed, sep);
      const casa = (cells[0] || '').trim();
      const trasferta = (cells[1] || '').trim();
      const note = (cells[2] || '').trim();
      // Estrai squadra che riposa dalla colonna Note (es. "Riposa: Out Of Office FC")
      const riposaMatch = note.match(/Riposa\s*:\s*(.+)/i);
      if (riposaMatch) {
        cal[currentGiornata].riposa = riposaMatch[1].trim();
      }
      if (casa && trasferta) {
        cal[currentGiornata].partite.push({ casa, trasferta });
      }
    }
  }
  return cal;
}

// ── Legge i CSV riepilogo per capire quali giornate/partite sono state giocate ─
// Restituisce { 1: [{casa, trasferta}], ... } solo partite con risultato
function readPartiteGiocate(dataDir) {
  const giocate = {};
  if (!existsDir(dataDir)) return giocate;

  // Cerca tutti i file che matchano riepilogo*.csv in data/ e sottocartelle
  function walk(dir) {
    const files = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...walk(full));
      else if (e.isFile() && /riepilogo.*\.csv$/i.test(e.name)) files.push(full);
    }
    return files;
  }

  const riepilogoCsvs = walk(dataDir);
  for (const f of riepilogoCsvs) {
    const rows = readCsv(f);
    for (const r of rows) {
      const sezione = (r['sezione'] || '').toLowerCase().trim();
      if (sezione !== 'partita') continue;
      const giornata = parseInt(r['giornata'] || '0', 10);
      if (!giornata) continue;
      const golCasa = r['golcasa'] || r['gol casa'] || r['gol_casa'] || '';
      const golTrasf = r['goltrasferta'] || r['gol trasferta'] || r['gol_trasferta'] || '';
      // Ha risultato solo se entrambi i gol sono presenti e numerici
      if (golCasa === '' || golTrasf === '') continue;
      if (isNaN(parseInt(golCasa, 10)) || isNaN(parseInt(golTrasf, 10))) continue;
      const casa = r['casa'] || r['squadra casa'] || '';
      const trasferta = r['trasferta'] || r['squadra trasferta'] || '';
      if (!casa || !trasferta) continue;
      giocate[giornata] = giocate[giornata] || [];
      // Evita duplicati
      const already = giocate[giornata].some(p => p.casa === casa && p.trasferta === trasferta);
      if (!already) giocate[giornata].push({ casa, trasferta });
    }
  }
  return giocate;
}

// ── Identifica quali partite hanno portiere esterno ───────────────────────────
// Per ogni partita giocata nella giornata:
//   - recupera i portieri di casa e trasferta dalla classifica
//   - confronta i punti attuali con lo snapshot precedente
//   - se deltaC=0 e deltaT=0 → il punto è andato a un portiere esterno
//   - la squadra che riposa viene ignorata (delta=0 per assenza, non per esterno)
function identificaPartiteEsterne(partiteGiocate, giornata, puntiAttuali, snapshotPrecedente, portieriPerSquadra, riposa) {
  const partite = partiteGiocate[giornata] || [];
  const partiteEsterne = [];
  const puntiPrec = (snapshotPrecedente && snapshotPrecedente.perPortiere) || {};

  for (const { casa, trasferta } of partite) {
    const portiereCasa = portieriPerSquadra[casa];
    const portiereTrasferta = portieriPerSquadra[trasferta];

    // Delta punti rispetto allo snapshot precedente
    const deltaC = portiereCasa ? ((puntiAttuali[portiereCasa] || 0) - (puntiPrec[portiereCasa] || 0)) : 0;
    const deltaT = portiereTrasferta ? ((puntiAttuali[portiereTrasferta] || 0) - (puntiPrec[portiereTrasferta] || 0)) : 0;

    // La squadra che riposa non partecipa → il suo portiere non prende punti per definizione,
    // non per assenza di un titolare. La escludiamo dal conteggio.
    // Nota: in questa partita né casa né trasferta riposano (il riposo è una terza squadra),
    // quindi riposa non influenza direttamente questa coppia. Ma se per qualche motivo
    // casa o trasferta corrispondessero alla squadra che riposa, saltiamo.
    const norm = s => String(s || '').toLowerCase().trim();
    if (riposa && (norm(casa) === norm(riposa) || norm(trasferta) === norm(riposa))) continue;

    if (deltaC === 0 && deltaT === 0) {
      // Nessuno dei due portieri ha guadagnato punti → portiere esterno per questa partita
      console.log(`  Giornata ${giornata}: portiere esterno in ${casa} vs ${trasferta} (deltaC=${deltaC}, deltaT=${deltaT})`);
      partiteEsterne.push({ casa, trasferta });
    } else {
      console.log(`  Giornata ${giornata}: portiere interno in ${casa} vs ${trasferta} (deltaC=${deltaC}, deltaT=${deltaT})`);
    }
  }
  return partiteEsterne;
}

// ── Legge classifica_portieri per mappare squadra→portiere ───────────────────
function readPortieriPerSquadra(dataDir) {
  const f = path.join(dataDir, 'classifica_portieri.csv');
  const rows = readCsv(f);
  const result = {};
  for (const r of rows) {
    const team = r['teamcode'] || r['squadra'] || r['team'] || '';
    const name = r['playername'] || r['giocatore'] || r['nome'] || r['portiere'] || '';
    if (team && name) result[team] = name;
  }
  return result; // { "Auriga Juniors": "Iacobellis PT", ... }
}

// ── Scopre i tornei ──────────────────────────────────────────────────────────
function isTournamentDir(absDir) {
  return existsFile(path.join(absDir, 'index.html')) &&
         existsDir(path.join(absDir, 'data'));
}

function walkDirs(root, maxDepth) {
  const out = [];
  function rec(dir, depth) {
    if (depth > maxDepth || !existsDir(dir)) return;
    out.push(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      rec(path.join(dir, entry.name), depth + 1);
    }
  }
  rec(root, 0);
  return out;
}

function discoverTournamentDirs() {
  const candidates = [];
  if (isTournamentDir(repoRoot)) candidates.push(repoRoot);
  const torneiDir = path.join(repoRoot, 'tornei');
  if (existsDir(torneiDir)) {
    candidates.push(...walkDirs(torneiDir, 2).filter(isTournamentDir));
  }
  return [...new Set(candidates.map(p => path.resolve(p)))]
    .sort((a, b) => toRepoRelative(a).localeCompare(toRepoRelative(b), 'it'));
}

function parseArgs(argv) {
  const out = { all: false, dirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.dirs.push(a);
  }
  return out;
}

// ── Main per un singolo torneo ────────────────────────────────────────────────
function processOne(siteDir) {
  const dataDir = path.join(siteDir, 'data');
  const snapshotPath = path.join(dataDir, 'portieri_snapshot.json');

  console.log('');
  console.log('Torneo: ' + toRepoRelative(siteDir));
  console.log('Data:   ' + toRepoRelative(dataDir));

  if (!existsDir(dataDir)) {
    console.log('Cartella data non trovata, skip.');
    return;
  }

  // 1. Punti attuali portieri
  const puntiAttuali = readPortieriClassifica(dataDir);
  if (!Object.keys(puntiAttuali).length) {
    console.log('classifica_portieri.csv non trovata o vuota, skip.');
    return;
  }
  console.log('Portieri trovati: ' + Object.keys(puntiAttuali).length);

  // 2. Mappa squadra→portiere
  const portieriPerSquadra = readPortieriPerSquadra(dataDir);

  // 3. Calendario
  const calendario = readCalendario(dataDir);
  const giornateCalendario = Object.keys(calendario).length;
  console.log('Giornate in calendario: ' + giornateCalendario);

  // 4. Partite giocate dai CSV riepilogo
  const partiteGiocate = readPartiteGiocate(dataDir);
  const giornateGiocate = Object.keys(partiteGiocate).map(Number).sort((a, b) => a - b);
  console.log('Giornate con partite giocate: ' + giornateGiocate.join(', '));

  // 5. Snapshot precedente
  let snapshotPrecedente = null;
  if (existsFile(snapshotPath)) {
    try {
      snapshotPrecedente = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      console.log('Snapshot precedente: giornata ' + snapshotPrecedente.giornata +
                  ', totale punti ' + snapshotPrecedente.totalePunti);
    } catch (e) {
      console.log('Snapshot precedente non leggibile, parto da zero.');
    }
  } else {
    console.log('Nessuno snapshot precedente trovato.');
  }

  // 6. Per ogni nuova giornata giocata, identifica partite con portiere esterno
  const giornataSnapsottata = snapshotPrecedente ? (snapshotPrecedente.giornata || 0) : 0;
  const nuoveGiornate = giornateGiocate.filter(g => g > giornataSnapsottata);

  const portieriEsterni = snapshotPrecedente ? { ...snapshotPrecedente.portieriEsterni } : {};
  // portieriEsterni: { "8": [{casa, trasferta}], ... }

  for (const g of nuoveGiornate) {
    // Recupera la squadra che riposa in questa giornata dal calendario
    const calGiornata = calendario[g] || {};
    const riposa = calGiornata.riposa || null;
    if (riposa) console.log(`Giornata ${g}: riposa ${riposa} (esclusa dal confronto delta)`);

    const partiteEsterne = identificaPartiteEsterne(
      partiteGiocate, g, puntiAttuali, snapshotPrecedente, portieriPerSquadra, riposa
    );
    if (partiteEsterne.length > 0) {
      console.log(`Giornata ${g}: ${partiteEsterne.length} partita/e con portiere esterno`);
      partiteEsterne.forEach(p => console.log(`  - ${p.casa} vs ${p.trasferta}`));
      portieriEsterni[String(g)] = partiteEsterne;
    } else {
      console.log(`Giornata ${g}: nessun portiere esterno`);
    }
  }

  // 7. Salva snapshot aggiornato
  const ultimaGiornata = giornateGiocate.length ? giornateGiocate[giornateGiocate.length - 1] : 0;
  const snapshot = {
    generatoIl: new Date().toISOString(),
    giornata: ultimaGiornata,
    totalePunti: Object.values(puntiAttuali).reduce((s, v) => s + v, 0),
    perPortiere: puntiAttuali,
    portieriEsterni
    // portieriEsterni: { "8": [{casa:"BOT & BALL", trasferta:"FC Stealthy Dribblers"}] }
  };

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log('Snapshot salvato: ' + toRepoRelative(snapshotPath));
  if (Object.keys(portieriEsterni).length) {
    console.log('Portieri esterni registrati per giornate: ' + Object.keys(portieriEsterni).join(', '));
  }
}

// ── Entrypoint ────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Uso:
  node tools/genera_portieri_snapshot.js tornei/2026-estate
  node tools/genera_portieri_snapshot.js --all

Output:
  <torneo>/data/portieri_snapshot.json

Il JSON contiene:
  - perPortiere: punti attuali per portiere
  - portieriEsterni: per giornata, le partite in cui il punto portiere è andato a un esterno
`);
    process.exit(0);
  }

  const envSite = process.env.TOURNAMENT_DIR || process.env.TORNEO_DIR || process.env.SITE_DIR;
  const explicitDirs = args.dirs.length ? args.dirs : (envSite ? String(envSite).split(/[\s,]+/).filter(Boolean) : []);

  let siteDirs;
  if (args.all || !explicitDirs.length) {
    siteDirs = discoverTournamentDirs();
    if (!siteDirs.length) {
      console.error('Nessun torneo trovato.');
      process.exit(1);
    }
  } else {
    siteDirs = explicitDirs.map(d => resolveFromRoot(d, '.'));
  }

  console.log('Tornei da elaborare: ' + siteDirs.map(toRepoRelative).join(', '));
  for (const siteDir of siteDirs) {
    processOne(siteDir);
  }
}

main();
