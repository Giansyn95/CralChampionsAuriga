#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
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

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/g, '');
}

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
  const out = { all: false, dirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
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
  node tools/genera_fantacalcio_cache.js tornei/2026-estate
  node tools/genera_fantacalcio_cache.js tornei/2026-estate tornei/2027-estate
  node tools/genera_fantacalcio_cache.js --all

Struttura attesa per ogni torneo:
  <torneo>/index.html
  <torneo>/data/fantacalcio/*.csv

Output:
  <torneo>/data/fantacalcio/fantacalcio_cache.json

Variabili opzionali, utili solo per casi particolari:
  SITE_DIR, DATA_DIR, FANTA_DIR, INDEX_FILE, CACHE_FILE
`);
}

function isTournamentDir(absDir) {
  return existsFile(path.join(absDir, 'index.html')) && existsDir(path.join(absDir, 'data', 'fantacalcio'));
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
    // Max depth 2 under tornei is enough for tornei/2026-estate, but still allows one extra grouping folder.
    candidates.push(...walkDirs(torneiDir, 2).filter(isTournamentDir));
  }

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
    if (!discovered.length) {
      throw new Error('Nessun torneo trovato. Esegui ad esempio: node tools/genera_fantacalcio_cache.js tornei/2026-estate');
    }
    return discovered.map(dir => configForSiteDir(toRepoRelative(dir), false));
  }

  const useEnvOverrides = explicitDirs.length === 1;
  return explicitDirs.map(dir => configForSiteDir(dir, useEnvOverrides));
}

function walkCsvFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCsvFiles(full));
    else if (entry.isFile() && /\.csv$/i.test(entry.name)) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b, 'it'));
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
      if (!full.startsWith(rootAbs + path.sep) && full !== rootAbs) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.writeHead(404); res.end('Not found'); return;
      }
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

async function buildOne(config, browser) {
  const { siteDir, dataDir, fantaDir, indexPath, outPath } = config;

  if (!existsDir(siteDir)) {
    throw new Error('Cartella torneo non trovata: ' + toRepoRelative(siteDir));
  }
  if (!existsFile(indexPath)) {
    throw new Error('index.html non trovato: ' + toRepoRelative(indexPath));
  }
  if (!existsDir(dataDir)) {
    throw new Error('Cartella data non trovata: ' + toRepoRelative(dataDir));
  }
  if (!existsDir(fantaDir)) {
    throw new Error('Cartella Fantacalcio non trovata: ' + toRepoRelative(fantaDir));
  }

  // Il calcolo del sito puo usare anche config/riepiloghi/classifiche presenti in data/.
  // Per questo passiamo tutti i CSV sotto data/, ma validiamo che data/fantacalcio esista.
  const csvFiles = walkCsvFiles(dataDir);
  const fantaCsvFiles = walkCsvFiles(fantaDir);
  if (!fantaCsvFiles.length) {
    throw new Error('Nessun CSV Fantacalcio trovato sotto ' + toRepoRelative(fantaDir) + '.');
  }
  if (!csvFiles.length) {
    throw new Error('Nessun CSV trovato sotto ' + toRepoRelative(dataDir) + '.');
  }

  console.log('');
  console.log('Torneo: ' + toRepoRelative(siteDir));
  console.log('Index: ' + toRepoRelative(indexPath));
  console.log('Data: ' + toRepoRelative(dataDir));
  console.log('Fantacalcio: ' + toRepoRelative(fantaDir));
  console.log('Output: ' + toRepoRelative(outPath));
  console.log('CSV totali: ' + csvFiles.length + ' - CSV Fantacalcio: ' + fantaCsvFiles.length);

  const filesForBrowser = csvFiles.map(full => ({
    path: path.relative(dataDir, full).replace(/\\/g, '/'),
    text: fs.readFileSync(full, 'utf8')
  }));

  const server = createStaticServer(siteDir);
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/${path.basename(indexPath)}?buildFantacalcioCache=1`;

  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('[browser]', msg.text());
    });
    page.on('pageerror', err => console.error('[pageerror]', err && err.stack || err));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof window.__cralIngestCsvBatchForCache === 'function' && typeof window.__cralBuildFantacalcioCache === 'function',
      null,
      { timeout: 30000 }
    );

    const batchSize = 25;
    for (let i = 0; i < filesForBrowser.length; i += batchSize) {
      const batch = filesForBrowser.slice(i, i + batchSize);
      await page.evaluate(files => window.__cralIngestCsvBatchForCache(files), batch);
    }

    const payload = await page.evaluate(() => window.__cralBuildFantacalcioCache());
    if (!payload || !Array.isArray(payload.results) || !payload.results.length) {
      throw new Error('Cache Fantacalcio vuota: controlla listone, eventi e rose in ' + toRepoRelative(fantaDir) + '.');
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log('Cache Fantacalcio generata: ' + toRepoRelative(outPath));
    console.log(`Risultati: ${payload.results.length} righe - Rose: ${payload.rosterCount} - Giocatori: ${payload.playerCount}`);
    if (payload.issues && payload.issues.length) {
      console.log('Avvisi: ' + payload.issues.length);
    }
    await page.close().catch(() => {});
  } finally {
    server.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configs = getBuildConfigs(args);
  console.log('Tornei da elaborare: ' + configs.map(c => toRepoRelative(c.siteDir)).join(', '));

  const browser = await loadChromium().launch({ headless: true });
  try {
    for (const config of configs) {
      await buildOne(config, browser);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
