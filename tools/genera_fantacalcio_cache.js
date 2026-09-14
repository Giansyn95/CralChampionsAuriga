#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

let chromium;
function loadChromium() {
  if (chromium) return chromium;
  try {
    chromium = require('playwright-chromium').chromium;
  } catch (err) {
    try {
      chromium = require('playwright').chromium;
    } catch (err2) {
      console.error('Playwright non trovato. Installa con: npm install --no-save playwright-chromium');
      process.exit(1);
    }
  }
  return chromium;
}

const repoRoot = process.cwd();
const REQUIRED_LISTONE_HEADERS = ['id', 'ruolo', 'giocatore', 'squadra', 'crediti'];
const REQUIRED_EVENTI_HEADERS = ['giornata', 'idgiocatore', 'tipoevento', 'quantita'];
const REQUIRED_ROSTER_HEADERS = ['giornata', 'partecipante', 'idgiocatore'];

function resolveFromRoot(value, fallback) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? path.normalize(raw) : path.join(repoRoot, raw);
}

function toRepoRelative(absPath) {
  const rel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
  return rel || '.';
}

function existsDir(p) {
  return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function existsFile(p) {
  return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
}

function parseArgs(argv) {
  const out = { all: false, dirs: [], preflightOnly: false, validateOnly: false, reportFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--preflight-only') out.preflightOnly = true;
    else if (a === '--validate-only') out.validateOnly = true;
    else if (a === '--report-file') {
      const next = argv[++i];
      if (next) out.reportFile = next;
    } else if (a.startsWith('--report-file=')) out.reportFile = a.slice('--report-file='.length);
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--site-dir' || a === '--torneo-dir' || a === '--tournament-dir') {
      const next = argv[++i];
      if (next) out.dirs.push(next);
    } else if (a.startsWith('--site-dir=')) out.dirs.push(a.slice('--site-dir='.length));
    else if (a.startsWith('--torneo-dir=')) out.dirs.push(a.slice('--torneo-dir='.length));
    else if (a.startsWith('--tournament-dir=')) out.dirs.push(a.slice('--tournament-dir='.length));
    else if (!a.startsWith('-')) out.dirs.push(a);
  }
  return out;
}

function printHelp() {
  console.log(`Uso:
  node tools/genera_fantacalcio_cache.js tornei/2026-spring
  node tools/genera_fantacalcio_cache.js --preflight-only tornei/2026-spring
  node tools/genera_fantacalcio_cache.js --validate-only tornei/2026-spring
  node tools/genera_fantacalcio_cache.js --all

Regole:
  - Fantacalcio completamente assente: SKIP con exit code 0.
  - Appena esiste un riferimento Fantacalcio, un CSV sorgente o una cache: configurazione obbligatoria e validazione severa.
  - Manifest/file mancanti, CSV incoerenti, cache vuota/non valida o hash sorgenti errato: exit code 1.

Output:
  <torneo>/data/fantacalcio/fantacalcio_cache.json

Variabili opzionali:
  SITE_DIR, DATA_DIR, FANTA_DIR, INDEX_FILE, CACHE_FILE
`);
}

function isTournamentDir(absDir) {
  return existsFile(path.join(absDir, 'index.html')) && existsDir(path.join(absDir, 'data'));
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
  if (existsDir(torneiDir)) candidates.push(...walkDirs(torneiDir, 2).filter(isTournamentDir));
  return [...new Set(candidates.map(p => path.resolve(p)))]
    .sort((a, b) => toRepoRelative(a).localeCompare(toRepoRelative(b), 'it'));
}

function configForSiteDir(siteDirInput, useEnvOverrides) {
  const siteDir = resolveFromRoot(siteDirInput, '.');
  const dataDir = resolveFromRoot(useEnvOverrides ? process.env.DATA_DIR : '', path.join(toRepoRelative(siteDir), 'data'));
  const fantaDir = resolveFromRoot(useEnvOverrides ? process.env.FANTA_DIR : '', path.join(toRepoRelative(dataDir), 'fantacalcio'));
  const indexPath = resolveFromRoot(useEnvOverrides ? process.env.INDEX_FILE : '', path.join(toRepoRelative(siteDir), 'index.html'));
  const outPath = resolveFromRoot(useEnvOverrides ? process.env.CACHE_FILE : '', path.join(toRepoRelative(fantaDir), 'fantacalcio_cache.json'));
  return { siteDir, dataDir, fantaDir, indexPath, outPath };
}

function getBuildConfigs(args) {
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const envSite = process.env.TOURNAMENT_DIR || process.env.TORNEO_DIR || process.env.SITE_DIR || process.env.CRAL_SITE_DIR;
  const explicitDirs = args.dirs.length ? args.dirs : (envSite ? String(envSite).split(/[\s,]+/).filter(Boolean) : []);
  if (args.all || !explicitDirs.length) {
    const discovered = discoverTournamentDirs();
    if (!discovered.length) throw new Error('Nessun torneo trovato.');
    return discovered.map(dir => configForSiteDir(toRepoRelative(dir), false));
  }
  const useEnvOverrides = explicitDirs.length === 1;
  return explicitDirs.map(dir => configForSiteDir(dir, useEnvOverrides));
}

function walkCsvFiles(dir) {
  if (!existsDir(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCsvFiles(full));
    else if (entry.isFile() && /\.csv$/i.test(entry.name)) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b, 'it'));
}

function splitCsvLine(line, separator = ';') {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === separator && !quoted) {
      out.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function readCsvSimple(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '');
  if (!lines.length) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]).map(x => x.trim());
  const rows = lines.slice(1).map(line => {
    const vals = splitCsvLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = vals[i] == null ? '' : vals[i]; });
    return obj;
  });
  return { header, rows };
}

function normalizedHeaders(header) {
  return header.map(h => String(h || '').trim().toLowerCase());
}

function requireHeaders(filePath, required) {
  const { header, rows } = readCsvSimple(filePath);
  const normalized = new Set(normalizedHeaders(header));
  const missing = required.filter(h => !normalized.has(h));
  if (missing.length) {
    throw new Error(`${toRepoRelative(filePath)}: colonne obbligatorie mancanti: ${missing.join(', ')}`);
  }
  return { header, rows };
}

function manifestEntries(filePath) {
  if (!existsFile(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) return [];
  let start = 0;
  const first = splitCsvLine(lines[0])[0].trim().toLowerCase();
  if (['file', 'nome', 'filename', 'path', 'percorso'].includes(first)) start = 1;
  const entries = [];
  for (let i = start; i < lines.length; i++) {
    const value = splitCsvLine(lines[i])[0].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^data\//i, '');
    if (value) entries.push(value);
  }
  return [...new Set(entries)];
}

function isFantaRosterRelative(rel) {
  const p = String(rel || '').replace(/\\/g, '/');
  return /^fantacalcio\/giornata\d+\/(?:rosa|roster)[_-].*\.csv$/i.test(p);
}

function rosterDayFromRelative(rel) {
  const m = String(rel || '').match(/(?:^|\/)giornata(\d+)(?:\/|_)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function sha256Files(files, baseDir) {
  const hash = crypto.createHash('sha256');
  const sorted = [...files].sort((a, b) => toRepoRelative(a).localeCompare(toRepoRelative(b), 'it'));
  for (const file of sorted) {
    const rel = path.relative(baseDir, file).replace(/\\/g, '/');
    hash.update(rel, 'utf8');
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function csvField(row, key) {
  const target = String(key || '').toLowerCase();
  const found = Object.keys(row || {}).find(k => String(k).trim().toLowerCase() === target);
  return found == null ? '' : row[found];
}

function validateSourceStructure(config) {
  const { siteDir, dataDir, fantaDir, indexPath, outPath } = config;
  if (!existsDir(siteDir)) throw new Error('Cartella torneo non trovata: ' + toRepoRelative(siteDir));
  if (!existsFile(indexPath)) throw new Error('index.html non trovato: ' + toRepoRelative(indexPath));
  if (!existsDir(dataDir)) throw new Error('Cartella data non trovata: ' + toRepoRelative(dataDir));

  const generalManifestPath = path.join(dataDir, 'manifest.csv');
  const generalEntries = manifestEntries(generalManifestPath);
  const generalFantaEntries = generalEntries.filter(x => /^fantacalcio\//i.test(x) && /\.csv$/i.test(x));
  const fantaCsvFiles = walkCsvFiles(fantaDir);
  const cacheExists = existsFile(outPath);

  // Regola fondamentale: l'assenza TOTALE dei CSV Fantacalcio e' ammessa e significa
  // feature non configurata. Appena compare anche un solo CSV sorgente, invece,
  // la configurazione diventa obbligatoria e qualsiasi incoerenza deve fallire.
  if (!fantaCsvFiles.length) {
    if (cacheExists) {
      throw new Error(`${toRepoRelative(siteDir)}: esiste ${toRepoRelative(outPath)} ma non esistono CSV sorgente Fantacalcio. Rimuovi la cache obsoleta oppure ripristina le sorgenti.`);
    }
    const staleRefs = generalFantaEntries.length;
    return {
      status: 'skip',
      reason: staleRefs
        ? `Fantacalcio senza CSV sorgente (${staleRefs} riferimenti presenti in data/manifest.csv)`
        : 'Fantacalcio non configurato',
      warning: staleRefs > 0,
      config
    };
  }

  if (!existsDir(fantaDir)) {
    throw new Error(`${toRepoRelative(siteDir)}: sono presenti CSV Fantacalcio ma la cartella ${toRepoRelative(fantaDir)} non e accessibile.`);
  }

  if (!existsFile(generalManifestPath)) {
    throw new Error(`${toRepoRelative(siteDir)}: data/manifest.csv mancante. Non posso certificare le sorgenti Fantacalcio.`);
  }

  const actualFantaRel = fantaCsvFiles.map(f => path.relative(dataDir, f).replace(/\\/g, '/')).sort();
  const manifestFantaRel = [...generalFantaEntries].sort();
  const actualSet = new Set(actualFantaRel.map(x => x.toLowerCase()));
  const manifestSet = new Set(manifestFantaRel.map(x => x.toLowerCase()));
  const missingFiles = manifestFantaRel.filter(x => !actualSet.has(x.toLowerCase()));
  const unlistedFiles = actualFantaRel.filter(x => !manifestSet.has(x.toLowerCase()));
  if (missingFiles.length) {
    throw new Error(`${toRepoRelative(siteDir)}: data/manifest.csv referenzia file Fantacalcio mancanti: ${missingFiles.join(', ')}.`);
  }
  // I CSV non presenti nel manifest generale sono comunque processati dal builder, che
  // ingerisce ricorsivamente l'intera data/fantacalcio. Non sono quindi un errore;
  // li contiamo nella certificazione per rendere visibile il caso.

  const dedicatedManifest = path.join(fantaDir, 'manifest_fantacalcio.csv');
  const listonePath = path.join(fantaDir, 'listone_fantacalcio.csv');
  const eventiPath = path.join(fantaDir, 'eventi_fantacalcio.csv');
  for (const requiredPath of [dedicatedManifest, listonePath, eventiPath]) {
    if (!existsFile(requiredPath)) throw new Error(`${toRepoRelative(siteDir)}: file Fantacalcio obbligatorio mancante: ${toRepoRelative(requiredPath)}.`);
  }

  const dedicatedEntries = manifestEntries(dedicatedManifest);
  if (!dedicatedEntries.length) throw new Error(`${toRepoRelative(dedicatedManifest)}: manifest dedicato vuoto.`);
  const declaredRosterSeeds = dedicatedEntries.filter(isFantaRosterRelative);
  if (!declaredRosterSeeds.length) {
    throw new Error(`${toRepoRelative(dedicatedManifest)}: nessuna rosa seed dichiarata. Serve almeno una rosa per partecipante/giornata per consentire la discovery live.`);
  }
  for (const rel of dedicatedEntries) {
    const abs = path.resolve(dataDir, rel);
    if (!abs.startsWith(path.resolve(dataDir) + path.sep)) throw new Error(`${toRepoRelative(dedicatedManifest)}: percorso non valido: ${rel}`);
    if (!existsFile(abs)) throw new Error(`${toRepoRelative(dedicatedManifest)}: file dichiarato ma mancante: ${rel}`);
  }

  const listone = requireHeaders(listonePath, REQUIRED_LISTONE_HEADERS);
  if (!listone.rows.length) throw new Error(`${toRepoRelative(listonePath)}: listone vuoto.`);
  const ids = new Set();
  for (const row of listone.rows) {
    const id = String(csvField(row, 'id') || '').trim();
    const giocatore = String(csvField(row, 'giocatore') || '').trim();
    const squadra = String(csvField(row, 'squadra') || '').trim();
    const ruolo = String(csvField(row, 'ruolo') || '').trim();
    const crediti = Number(String(csvField(row, 'crediti') || '').replace(',', '.'));
    if (!id || !giocatore || !squadra || !ruolo || !Number.isFinite(crediti)) {
      throw new Error(`${toRepoRelative(listonePath)}: riga listone non valida per id=${id || '(vuoto)'}.`);
    }
    if (ids.has(id)) throw new Error(`${toRepoRelative(listonePath)}: id giocatore duplicato: ${id}.`);
    ids.add(id);
  }

  const eventi = requireHeaders(eventiPath, REQUIRED_EVENTI_HEADERS);
  for (const row of eventi.rows) {
    const day = Number(csvField(row, 'giornata'));
    const id = String(csvField(row, 'idGiocatore') || '').trim();
    const tipo = String(csvField(row, 'tipoEvento') || '').trim();
    const qty = Number(String(csvField(row, 'quantita') || '').replace(',', '.'));
    if (!Number.isInteger(day) || day <= 0 || !id || !tipo || !Number.isFinite(qty)) {
      throw new Error(`${toRepoRelative(eventiPath)}: evento non valido (giornata=${csvField(row, 'giornata')}, id=${id || '(vuoto)'}).`);
    }
    if (!ids.has(id)) throw new Error(`${toRepoRelative(eventiPath)}: evento riferito a id giocatore non presente nel listone: ${id}.`);
  }

  const rosterFiles = fantaCsvFiles.filter(f => isFantaRosterRelative(path.relative(dataDir, f).replace(/\\/g, '/')));
  if (!rosterFiles.length) throw new Error(`${toRepoRelative(siteDir)}: nessuna rosa Fantacalcio trovata.`);

  const rosterParticipants = new Set();
  const rosterDays = new Set();
  for (const rosterFile of rosterFiles) {
    const rel = path.relative(dataDir, rosterFile).replace(/\\/g, '/');
    const expectedDay = rosterDayFromRelative(rel);
    const parsed = requireHeaders(rosterFile, REQUIRED_ROSTER_HEADERS);
    if (!parsed.rows.length) throw new Error(`${rel}: rosa vuota.`);
    const localIds = new Set();
    let participant = '';
    for (const row of parsed.rows) {
      const day = Number(csvField(row, 'giornata'));
      const name = String(csvField(row, 'partecipante') || '').trim();
      const id = String(csvField(row, 'idGiocatore') || '').trim();
      if (!Number.isInteger(day) || day <= 0 || !name || !id) throw new Error(`${rel}: riga rosa non valida.`);
      if (expectedDay && day !== expectedDay) throw new Error(`${rel}: contiene giornata ${day}, attesa ${expectedDay}.`);
      if (participant && participant !== name) throw new Error(`${rel}: contiene piu partecipanti (${participant} / ${name}).`);
      participant = name;
      if (!ids.has(id)) throw new Error(`${rel}: id giocatore ${id} non presente nel listone.`);
      if (localIds.has(id)) throw new Error(`${rel}: id giocatore duplicato nella stessa rosa: ${id}.`);
      localIds.add(id);
    }
    rosterParticipants.add(participant);
    if (expectedDay) rosterDays.add(expectedDay);
  }

  const allCsvFiles = walkCsvFiles(dataDir);
  return {
    status: 'ready',
    config,
    fantaCsvFiles,
    allCsvFiles,
    sourceHash: sha256Files(allCsvFiles, dataDir),
    generalManifestEntries: generalEntries.length,
    unlistedFantaCsv: unlistedFiles.length,
    dedicatedEntries: dedicatedEntries.length,
    declaredRosterSeeds: declaredRosterSeeds.length,
    listonePlayers: ids.size,
    eventRows: eventi.rows.length,
    rosterFiles: rosterFiles.length,
    rosterParticipants: [...rosterParticipants].sort((a, b) => a.localeCompare(b, 'it')),
    rosterDays: [...rosterDays].sort((a, b) => a - b)
  };
}

function preflightConfig(config) {
  return validateSourceStructure(config);
}

function validatePayload(payload, expected) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Cache Fantacalcio non e un oggetto JSON valido.');
  if (!Number.isInteger(payload.schema) || payload.schema < 1) throw new Error('Cache Fantacalcio: schema mancante/non valido.');
  if (!Array.isArray(payload.results) || !payload.results.length) throw new Error('Cache Fantacalcio vuota: results assente o senza righe.');
  if (!Number.isInteger(payload.rosterCount) || payload.rosterCount <= 0) throw new Error('Cache Fantacalcio: rosterCount non valido.');
  if (!Number.isInteger(payload.playerCount) || payload.playerCount <= 0) throw new Error('Cache Fantacalcio: playerCount non valido.');
  if (Array.isArray(payload.issues) && payload.issues.length) throw new Error('Cache Fantacalcio contiene problemi: ' + payload.issues.join(' | '));
  if (!payload.generatedAt || Number.isNaN(Date.parse(payload.generatedAt))) throw new Error('Cache Fantacalcio: generatedAt mancante/non valido.');

  const seen = new Set();
  for (let i = 0; i < payload.results.length; i++) {
    const r = payload.results[i];
    const day = Number(r && r.day);
    const name = String(r && r.name || '').trim();
    const points = Number(r && r.points);
    const credits = Number(r && r.credits);
    if (!Number.isInteger(day) || day <= 0 || !name || !Number.isFinite(points) || !Number.isFinite(credits)) {
      throw new Error(`Cache Fantacalcio: result[${i}] non valido.`);
    }
    const key = `${day}|${name.toLowerCase()}`;
    if (seen.has(key)) throw new Error(`Cache Fantacalcio: risultato duplicato per giornata ${day} / ${name}.`);
    seen.add(key);
    if (!Array.isArray(r.players) || !r.players.length) throw new Error(`Cache Fantacalcio: result[${i}] senza players.`);
  }

  if (expected) {
    const meta = payload._meta;
    if (!meta || typeof meta !== 'object') throw new Error('Cache Fantacalcio: _meta di certificazione mancante.');
    if (meta.sourceHash !== expected.sourceHash) throw new Error('Cache Fantacalcio: sourceHash non corrisponde alle sorgenti correnti.');
    if (meta.sourceFiles !== expected.allCsvFiles.length) throw new Error('Cache Fantacalcio: numero file sorgente non coerente.');
    if (meta.fantacalcioCsvFiles !== expected.fantaCsvFiles.length) throw new Error('Cache Fantacalcio: numero CSV Fantacalcio non coerente.');
    if (meta.rosterFiles !== expected.rosterFiles) throw new Error('Cache Fantacalcio: numero rose sorgente non coerente.');
    if (meta.listonePlayers !== expected.listonePlayers) throw new Error('Cache Fantacalcio: numero giocatori listone non coerente.');
    if (meta.resultRows !== payload.results.length) throw new Error('Cache Fantacalcio: resultRows non coerente.');
  }
  return true;
}

function readAndValidateExistingCache(config, expected) {
  if (!existsFile(config.outPath)) throw new Error('Cache Fantacalcio non generata: ' + toRepoRelative(config.outPath));
  let payload;
  try { payload = JSON.parse(fs.readFileSync(config.outPath, 'utf8')); }
  catch (err) { throw new Error('Cache Fantacalcio JSON illeggibile: ' + toRepoRelative(config.outPath) + ' - ' + err.message); }
  validatePayload(payload, expected);
  return payload;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function createStaticServer(root) {
  const rootAbs = path.resolve(root);
  return http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(reqUrl.pathname.replace(/^\/+/, '')) || 'index.html';
      rel = rel.replace(/\\/g, '/');
      const full = path.resolve(rootAbs, rel);
      if (!full.startsWith(rootAbs + path.sep) && full !== rootAbs) { res.writeHead(403); res.end('Forbidden'); return; }
      if (!existsFile(full)) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': contentType(full), 'Cache-Control': 'no-store' });
      fs.createReadStream(full).pipe(res);
    } catch (err) {
      res.writeHead(500); res.end(String(err && err.message || err));
    }
  });
}

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function cacheMeta(check, payload) {
  const resultParticipants = [...new Set(payload.results.map(r => String(r.name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const resultDays = [...new Set(payload.results.map(r => Number(r.day)).filter(Number.isFinite))].sort((a, b) => a - b);
  return {
    certificationVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceHash: check.sourceHash,
    sourceFiles: check.allCsvFiles.length,
    fantacalcioCsvFiles: check.fantaCsvFiles.length,
    rosterFiles: check.rosterFiles,
    rosterParticipants: check.rosterParticipants.length,
    rosterDays: check.rosterDays,
    listonePlayers: check.listonePlayers,
    eventRows: check.eventRows,
    unlistedFantaCsv: check.unlistedFantaCsv,
    resultRows: payload.results.length,
    resultParticipants: resultParticipants.length,
    resultDays
  };
}

async function buildOne(check, browser) {
  const { config } = check;
  const { siteDir, dataDir, fantaDir, indexPath, outPath } = config;
  const csvFiles = check.allCsvFiles;

  console.log('');
  console.log('Torneo: ' + toRepoRelative(siteDir));
  console.log('CSV sorgente: ' + csvFiles.length + ' - CSV Fantacalcio: ' + check.fantaCsvFiles.length);
  console.log('Rose: ' + check.rosterFiles + ' - Partecipanti sorgente: ' + check.rosterParticipants.length);
  console.log('Hash sorgenti: ' + check.sourceHash);

  const filesForBrowser = csvFiles.map(full => ({
    path: path.relative(dataDir, full).replace(/\\/g, '/'),
    text: fs.readFileSync(full, 'utf8')
  }));

  const server = createStaticServer(siteDir);
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/${path.basename(indexPath)}?buildFantacalcioCache=1`;
  let page;
  try {
    page = await browser.newPage();
    page.on('console', msg => { if (msg.type() === 'error') console.error('[browser]', msg.text()); });
    page.on('pageerror', err => console.error('[pageerror]', err && err.stack || err));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof window.__cralIngestCsvBatchForCache === 'function' && typeof window.__cralBuildFantacalcioCache === 'function',
      null,
      { timeout: 30000 }
    );

    const batchSize = 25;
    for (let i = 0; i < filesForBrowser.length; i += batchSize) {
      await page.evaluate(files => window.__cralIngestCsvBatchForCache(files), filesForBrowser.slice(i, i + batchSize));
    }

    const payload = await page.evaluate(() => window.__cralBuildFantacalcioCache());
    validatePayload(payload);
    payload._meta = cacheMeta(check, payload);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    const validated = readAndValidateExistingCache(config, check);
    console.log('Cache Fantacalcio generata e certificata: ' + toRepoRelative(outPath));
    console.log(`Risultati: ${validated.results.length} - rosterCount calcolato: ${validated.rosterCount} - playerCount: ${validated.playerCount}`);
    return { status: 'generated', check, payload: validated };
  } finally {
    if (page) await page.close().catch(() => {});
    server.close();
  }
}

function appendSummary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function writeReport(filePath, report) {
  if (!filePath) return;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configs = getBuildConfigs(args);
  console.log('Tornei richiesti: ' + configs.map(c => toRepoRelative(c.siteDir)).join(', '));

  const ready = [];
  const skipped = [];
  for (const config of configs) {
    const check = preflightConfig(config);
    if (check.status === 'skip') {
      console.log('[SKIP] ' + toRepoRelative(config.siteDir) + ': ' + check.reason + '.');
      skipped.push({ dir: toRepoRelative(config.siteDir), reason: check.reason, warning: !!check.warning });
      if (check.warning && process.env.GITHUB_ACTIONS) console.warn(`::warning title=Fantacalcio assente::${toRepoRelative(config.siteDir)} - ${check.reason}`);
      continue;
    }
    console.log('[READY] ' + toRepoRelative(config.siteDir) + `: ${check.fantaCsvFiles.length} CSV Fantacalcio, ${check.rosterFiles} rose, hash ${check.sourceHash.slice(0, 12)}...`);
    ready.push(check);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    ready: ready.map(x => ({ dir: toRepoRelative(x.config.siteDir), sourceHash: x.sourceHash, fantaCsvFiles: x.fantaCsvFiles.length, rosterFiles: x.rosterFiles })),
    skipped
  };
  writeReport(args.reportFile, report);

  if (args.preflightOnly) {
    appendSummary([
      '### Preflight cache Fantacalcio',
      `- Tornei pronti: ${ready.length ? ready.map(x => toRepoRelative(x.config.siteDir)).join(', ') : 'nessuno'}`,
      `- Tornei senza Fantacalcio: ${skipped.length ? skipped.map(x => x.dir).join(', ') : 'nessuno'}`,
      '- Esito: ✅ configurazione sorgenti valida'
    ]);
    return;
  }

  if (args.validateOnly) {
    for (const check of ready) {
      const payload = readAndValidateExistingCache(check.config, check);
      console.log('[VALID] ' + toRepoRelative(check.config.outPath) + ` - ${payload.results.length} risultati - hash sorgenti OK`);
    }
    appendSummary([
      '### Validazione cache Fantacalcio',
      ...ready.map(x => `- ✅ ${toRepoRelative(x.config.siteDir)}: JSON/schema/hash sorgenti validi`),
      ...(skipped.length ? skipped.map(x => `- ⏭️ ${x.dir}: ${x.reason}`) : [])
    ]);
    return;
  }

  if (!ready.length) {
    console.log('Nessun torneo con Fantacalcio configurato. Nessuna cache da generare.');
    appendSummary(['### Cache Fantacalcio', '- ⏭️ Fantacalcio non configurato: nessuna cache necessaria.']);
    return;
  }

  const browser = await loadChromium().launch({ headless: true });
  const built = [];
  try {
    for (const check of ready) built.push(await buildOne(check, browser));
  } finally {
    await browser.close().catch(() => {});
  }

  appendSummary([
    '### Cache Fantacalcio generata',
    ...built.map(({ check, payload }) => `- ✅ ${toRepoRelative(check.config.siteDir)}: ${payload.results.length} risultati, ${check.rosterFiles} rose sorgente, ${check.listonePlayers} giocatori, hash \`${check.sourceHash.slice(0, 16)}…\``),
    ...(skipped.length ? skipped.map(x => `- ⏭️ ${x.dir}: ${x.reason}`) : [])
  ]);
}

main().catch(err => {
  const message = String(err && err.message || err);
  console.error(err && err.stack || err);
  if (process.env.GITHUB_ACTIONS) console.error(`::error title=Cache Fantacalcio non valida::${message.replace(/\r?\n/g, ' ')}`);
  appendSummary(['### Cache Fantacalcio', `- ❌ ${message}`]);
  process.exit(1);
});
