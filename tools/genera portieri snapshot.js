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
  const cal = {};
  let currentGiornata = null;
  let inHeader = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const gMatch = trimmed.match(/GIORNATA\s+(\d+)/i);
    if (gMatch) {
      currentGiornata = parseInt(gMatch[1], 10);
      inHeader = true; // prossima riga è l'header Casa;Trasferta;Note
      cal[currentGiornata] = cal[currentGiornata] || [];
      continue;
    }
    if (inHeader) { inHeader = false; continue; } // salta header
    if (currentGiornata !== null) {
      const sep = detectSep(trimmed);
      const cells = parseCsvLine(trimmed, sep);
      const casa = (cells[0] || '').trim();
      const trasferta = (cells[1] || '').trim();
      if (casa && trasferta) {
        cal[currentGiornata].push({ casa, trasferta });
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

// ── Calcola le giornate con portiere esterno ──────────────────────────────────
// Logica:
//   Per ogni giornata in partiteGiocate:
//     delta punti portieri = puntiAttuali - puntiSnapshot[giornata-1]
//     delta atteso = numero partite giocate quella giornata
//     portieri esterni = delta atteso - delta reale  (se > 0)
//
// puntiSnapshot è cumulativo: { giornata: N, totale: 14, perPortiere: {...} }
// Lo confrontiamo con lo snapshot precedente per ricavare il delta.
function computeExternalPortieri(puntiAttuali, snapshotPrecedente, partiteGiocate, calendario) {
  const result = {}; // { giornata: N, esterne: K, partite: [{casa,trasferta}] }

  // Ordina le giornate giocate
  const giornateGiocate = Object.keys(partiteGiocate).map(Number).sort((a, b) => a - b);

  // Punti di partenza: snapshot precedente o zero
  let puntiPrecedenti = snapshotPrecedente ? { ...snapshotPrecedente.perPortiere } : {};
  let totalePrecedente = Object.values(puntiPrecedenti).reduce((s, v) => s + v, 0);

  // Punti attuali totali
  const totaleAttuale = Object.values(puntiAttuali).reduce((s, v) => s + v, 0);

  // Se non c'è snapshot precedente assumiamo 0 per tutte le giornate non ancora snapsottate.
  // Se c'è snapshot, lo usiamo come base per la giornata successiva a quella snapsottata.
  const giornataSnapsottata = snapshotPrecedente ? (snapshotPrecedente.giornata || 0) : 0;

  // Per le giornate successive allo snapshot calcoliamo il delta cumulativo.
  // Siccome abbiamo solo il totale attuale (non per-giornata), possiamo calcolare
  // il delta SOLO tra snapshot e adesso — ma non tra giornate intermedie.
  // Soluzione: lo snapshot viene aggiornato ad ogni run, quindi il delta è sempre
  // tra l'ultima giornata snapsottata e la/le nuove giornate caricate.

  const nuoveGiornate = giornateGiocate.filter(g => g > giornataSnapsottata);
  if (!nuoveGiornate.length) {
    console.log('Nessuna nuova giornata rispetto allo snapshot.');
    return result;
  }

  // Delta totale tra snapshot e adesso
  const deltaTotal = totaleAttuale - totalePrecedente;
  // Partite totali nelle nuove giornate
  const partiteTotaliNuove = nuoveGiornate.reduce((s, g) => s + (partiteGiocate[g] || []).length, 0);
  // Portieri esterni totali nelle nuove giornate
  const esterniTotali = Math.max(0, partiteTotaliNuove - deltaTotal);

  console.log(`Giornate nuove: ${nuoveGiornate.join(', ')}`);
  console.log(`Partite giocate nelle nuove giornate: ${partiteTotaliNuove}`);
  console.log(`Delta punti portieri: ${deltaTotal}`);
  console.log(`Portieri esterni stimati: ${esterniTotali}`);

  // Distribuzione per giornata: se abbiamo una sola giornata nuova è semplice.
  // Se ne abbiamo più d'una, dobbiamo fare una stima per giornata — non è possibile
  // essere certi senza snapshot intermedi. In questo caso segnaliamo solo il totale
  // sull'ultima giornata nuova e lasciamo le altre a 0 (verranno corrette al prossimo run).
  if (nuoveGiornate.length === 1) {
    const g = nuoveGiornate[0];
    const partiteG = (partiteGiocate[g] || []).length;
    const esterniG = Math.max(0, partiteG - deltaTotal);
    if (esterniG > 0) {
      // Identifica le partite con portiere esterno: quelle le cui squadre NON hanno
      // guadagnato punti rispetto allo snapshot
      const partiteConEsterno = [];
      for (const { casa, trasferta } of (partiteGiocate[g] || [])) {
        // Cerca i portieri di casa e trasferta nel CSV classifica
        // Non abbiamo il mapping squadra→portiere diretto, quindi usiamo il teamCode
        // dalla classifica_portieri.csv (colonna teamCode = nome squadra)
        const portiereC = Object.entries(puntiAttuali).find(([n]) => {
          // cerca nella classifica se questo portiere appartiene a casa
          return false; // placeholder — vedi sotto
        });
        // Semplicemente: per ora registriamo la partita come "esterna" senza sapere quale squadra
        partiteConEsterno.push({ casa, trasferta });
      }
      result[g] = { esterne: esterniG, partite: partiteConEsterno };
    }
  } else {
    // Più giornate nuove: registriamo il totale sull'ultima giornata, le altre a 0.
    // Al prossimo run (con snapshot aggiornato) si avrà la precisione corretta.
    const ultima = nuoveGiornate[nuoveGiornate.length - 1];
    if (esterniTotali > 0) {
      result[ultima] = { esterne: esterniTotali, partite: partiteGiocate[ultima] || [] };
    }
  }

  return result;
}

// ── Identifica quali partite hanno portiere esterno ───────────────────────────
// Usa la classifica_portieri.csv per mappare squadra→portiere, poi confronta
// i punti attuali vs snapshot per vedere se il portiere di quella squadra ha preso punti
function identificaPartiteEsterne(partiteGiocate, giornata, puntiAttuali, snapshotPrecedente, portieriPerSquadra) {
  const partite = partiteGiocate[giornata] || [];
  const partiteEsterne = [];

  for (const { casa, trasferta } of partite) {
    const portiereCasa = portieriPerSquadra[casa];
    const portiereTrasferta = portieriPerSquadra[trasferta];

    const puntiCasaOra = portiereCasa ? (puntiAttuali[portiereCasa] || 0) : null;
    const puntiTrasfOra = portiereTrasferta ? (puntiAttuali[portiereTrasferta] || 0) : null;
    const puntiCasaPrec = portiereCasa ? ((snapshotPrecedente?.perPortiere || {})[portiereCasa] || 0) : null;
    const puntiTrasfPrec = portiereTrasferta ? ((snapshotPrecedente?.perPortiere || {})[portiereTrasferta] || 0) : null;

    const deltaC = puntiCasaOra !== null ? puntiCasaOra - puntiCasaPrec : 0;
    const deltaT = puntiTrasfOra !== null ? puntiTrasfOra - puntiTrasfPrec : 0;

    // Se entrambi i portieri delle squadre non hanno guadagnato punti → esterno
    const casaEsterna = deltaC === 0;
    const trasfEsterna = deltaT === 0;

    if (casaEsterna || trasfEsterna) {
      // Il portiere esterno appartiene alla squadra che non ha guadagnato punti
      // ma dobbiamo stare attenti: in una partita vince UN portiere (quello del clean sheet o MVG)
      // In realtà il punto lo prende solo 1 portiere per partita.
      // Se deltaC=0 e deltaT=0 → esterno (nessuno dei due ha preso punti)
      // Se deltaC=1 e deltaT=0 → Casa ha portiere interno che ha vinto, Trasferta non conta
      // Se deltaC=0 e deltaT=1 → Trasferta ha portiere interno che ha vinto, Casa non conta
      // Il "vincitore" del premio portiere è chi ha guadagnato 1 punto.
      if (deltaC === 0 && deltaT === 0) {
        // Entrambi 0 → il punto è andato a un esterno per questa partita
        partiteEsterne.push({ casa, trasferta });
      }
      // Se uno dei due ha preso il punto, non c'è esterno per questa partita
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
    const partiteEsterne = identificaPartiteEsterne(
      partiteGiocate, g, puntiAttuali, snapshotPrecedente, portieriPerSquadra
    );
    if (partiteEsterne.length > 0) {
      console.log(`Giornata ${g}: ${partiteEsterne.length} partita/e con portiere esterno`);
      partiteEsterne.forEach(p => console.log(`  - ${p.casa} vs ${p.trasferta}`));
      portieriEsterni[String(g)] = partiteEsterne;
    } else {
      console.log(`Giornata ${g}: nessun portiere esterno`);
    }
    // Dopo ogni giornata aggiorno lo "snapshot intermedio" per la giornata successiva
    // usando i punti attuali come riferimento (non possiamo avere i punti intermedi)
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
