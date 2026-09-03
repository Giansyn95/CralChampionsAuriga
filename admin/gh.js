// Porting client-side del backend Vercel: nessun server, tutte le chiamate
// vanno dirette a api.github.com usando il Personal Access Token inserito
// dall'utente nel browser. L'API GitHub supporta CORS, quindi funziona
// direttamente da una pagina statica (GitHub Pages).
//
// ATTENZIONE SICUREZZA: il token vive solo in sessionStorage (svuotato alla
// chiusura della scheda o premendo "Esci") e non lascia mai il browser se
// non verso api.github.com con il tuo stesso token. Chi ha accesso fisico o
// da devtools a questa scheda potrebbe però leggerlo: usa sempre un token
// "fine-grained", limitato al solo repo necessario, con scadenza breve.

import { parseCsvDetailed, parseManifest, validateCsvText } from './csv.js';
import {
  customizeTournamentIndex, parseTournamentRegistry, tournamentDataChanges,
  updateTournamentRegistry, validateTournamentInput
} from './tournament.js';

const API = 'https://api.github.com';
const SESSION_KEY = 'cral-admin-gh-session';

export const DEFAULT_TARGETS = Object.freeze({
  collaudo: { owner: 'giansyn95', repo: 'CralChampionsAuriga', branch: 'main', label: 'Collaudo' },
  produzione: { owner: 'cralauriga', repo: 'CralChampionsAuriga', branch: 'main', label: 'Produzione' }
});

function fail(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---------- base64 <-> UTF-8 (i blob GitHub arrivano in base64) ----------
function base64ToUtf8(b64) {
  const binary = atob(String(b64 || '').replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// ---------- chiamata GitHub di basso livello ----------
async function gh(target, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${target.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  let body = null;
  const raw = await response.text();
  if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
  if (!response.ok) {
    const message = body?.message || `GitHub API ${response.status}`;
    const status = response.status === 401 ? 401
      : response.status === 403 ? 403
      : response.status === 404 ? 404
      : (response.status === 409 || response.status === 422) ? 409
      : 502;
    throw fail(message, status);
  }
  return body;
}
function repoPath(target, suffix) {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}${suffix}`;
}

export async function getHead(target) {
  const ref = await gh(target, repoPath(target, `/git/ref/heads/${encodeURIComponent(target.branch)}`));
  const commitSha = ref.object.sha;
  const commit = await gh(target, repoPath(target, `/git/commits/${commitSha}`));
  return { commitSha, treeSha: commit.tree.sha, commit };
}
export async function getTree(target, treeSha) {
  return gh(target, repoPath(target, `/git/trees/${treeSha}?recursive=1`));
}
export async function getBlobText(target, sha) {
  const blob = await gh(target, repoPath(target, `/git/blobs/${sha}`));
  if (blob.encoding !== 'base64') throw fail('Encoding blob GitHub non supportato.', 502);
  return base64ToUtf8(blob.content);
}
export async function createAtomicCommit(target, { baseCommitSha, changes, message }) {
  const head = await getHead(target);
  if (head.commitSha !== baseCommitSha) {
    const err = fail('Il repository è cambiato dopo il caricamento dei dati. Ricarica prima di pubblicare per evitare sovrascritture.', 409);
    err.currentCommitSha = head.commitSha;
    throw err;
  }
  const entries = new Array(changes.length);
  const queue = changes.map((change, index) => ({ change, index }));
  const workers = Array.from({ length: Math.min(6, queue.length || 1) }, async () => {
    while (queue.length) {
      const { change, index } = queue.shift();
      if (change.delete) { entries[index] = { path: change.path, mode: '100644', type: 'blob', sha: null }; continue; }
      if (change.sourceSha) {
        if (!/^[a-f0-9]{40}$/i.test(String(change.sourceSha))) throw fail('SHA sorgente non valido.', 400);
        entries[index] = { path: change.path, mode: '100644', type: 'blob', sha: String(change.sourceSha) };
        continue;
      }
      const blob = await gh(target, repoPath(target, '/git/blobs'), {
        method: 'POST',
        body: JSON.stringify({ content: String(change.content ?? ''), encoding: 'utf-8' })
      });
      entries[index] = { path: change.path, mode: '100644', type: 'blob', sha: blob.sha };
    }
  });
  await Promise.all(workers);
  const tree = await gh(target, repoPath(target, '/git/trees'), {
    method: 'POST',
    body: JSON.stringify({ base_tree: head.treeSha, tree: entries })
  });
  const commit = await gh(target, repoPath(target, '/git/commits'), {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommitSha] })
  });
  await gh(target, repoPath(target, `/git/refs/heads/${encodeURIComponent(target.branch)}`), {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { sha: commit.sha, url: `https://github.com/${target.owner}/${target.repo}/commit/${commit.sha}` };
}

// ---------- verifica token/target (usata dal login) ----------
export async function verifyTarget(target) {
  if (!target.owner || !target.repo || !target.branch) throw fail('Owner, repo e branch sono obbligatori.', 400);
  if (!target.token) throw fail('Inserisci il token GitHub.', 400);
  await getHead(target); // lancia 401/403/404 se qualcosa non va
  return true;
}

// ---------- percorso torneo ----------
export function normalizeTournamentPath(value, fallback = 'tornei/2026-spring') {
  const raw = String(value || fallback).trim().replace(/^\/+|\/+$/g, '');
  if (!/^tornei\/[A-Za-z0-9._-]+$/.test(raw)) throw fail('Percorso torneo non valido.', 400);
  return raw;
}

// ---------- lista tornei (porting di api/tournaments.js) ----------
export async function getTournaments(target) {
  const head = await getHead(target);
  const tree = await getTree(target, head.treeSha);
  if (tree.truncated) throw fail('Albero GitHub troppo grande/troncato.', 409);
  const blobs = (tree.tree || []).filter(x => x.type === 'blob');
  const byPath = new Map(blobs.map(x => [x.path, x]));
  const registryEntry = byPath.get('tornei.json');
  let registry = parseTournamentRegistry('');
  let registryWarning = '';
  if (registryEntry) {
    try { registry = parseTournamentRegistry(await getBlobText(target, registryEntry.sha)); }
    catch (error) { registryWarning = error.message; registry = parseTournamentRegistry(''); }
  }
  const metaByPath = new Map((registry.tornei || []).map(t => [String(t.cartella || '').replace(/^\/+|\/+$/g, ''), t]));
  const paths = blobs.map(x => x.path.match(/^(tornei\/[^/]+)\/index\.html$/)?.[1]).filter(Boolean);
  const unique = [...new Set(paths)].sort();
  const tournaments = unique.map(path => {
    const meta = metaByPath.get(path) || {};
    return {
      path,
      id: String(meta.id || path.split('/').pop()),
      title: String(meta.titolo || meta.nome || path.split('/').pop()),
      season: String(meta.stagione || meta.nome || ''),
      year: String(meta.anno || ''),
      current: !!meta.corrente,
      active: meta.attivo !== false
    };
  }).sort((a, b) => Number(b.current) - Number(a.current) || b.path.localeCompare(a.path));
  return { target: target.key, repository: `${target.owner}/${target.repo}`, branch: target.branch, commitSha: head.commitSha, registryWarning, tournaments };
}

// ---------- snapshot dati torneo (porting di api/snapshot.js) ----------
const SNAP_MAX_FILE_BYTES = 2_500_000;
const SNAP_MAX_TOTAL_BYTES = 14_000_000;

function isAdminRelevant(path, dataRoot) {
  if (!path.startsWith(dataRoot + '/')) return false;
  const rel = path.slice(dataRoot.length + 1);
  const base = rel.split('/').pop().toLowerCase();
  if (!/\.(csv|txt|json)$/i.test(base)) return false;
  if (/^(fantacalcio_cache|portieri_snapshot)\.json$/i.test(base)) return false;
  return true;
}
async function loadEntries(target, entries) {
  const out = {};
  let total = 0;
  const queue = [];
  for (const entry of entries) {
    if (!entry || entry.size > SNAP_MAX_FILE_BYTES) continue;
    if (total + entry.size > SNAP_MAX_TOTAL_BYTES) continue;
    total += entry.size;
    queue.push(entry);
  }
  const workers = Array.from({ length: Math.min(8, queue.length || 1) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      const text = await getBlobText(target, entry.sha);
      out[entry.path] = { text, sha: entry.sha, size: entry.size };
    }
  });
  await Promise.all(workers);
  return out;
}
export async function getSnapshot(target, tournamentValue) {
  const tournament = normalizeTournamentPath(tournamentValue);
  const dataRoot = `${tournament}/data`;
  const head = await getHead(target);
  const tree = await getTree(target, head.treeSha);
  if (tree.truncated) throw fail('Albero GitHub troppo grande/troncato: caricamento Admin interrotto per evitare uno snapshot incompleto.', 409);
  const blobs = (tree.tree || []).filter(x => x.type === 'blob');
  const byPath = new Map(blobs.map(x => [x.path, x]));
  if (!byPath.has(`${tournament}/index.html`)) throw fail(`Torneo non trovato: ${tournament}`, 404);

  const manifestEntry = byPath.get(`${dataRoot}/manifest.csv`);
  let manifestText = '';
  if (manifestEntry) manifestText = await getBlobText(target, manifestEntry.sha);
  const manifestPaths = parseManifest(manifestText).map(p => `${dataRoot}/${p.replace(/^\/+/, '')}`);

  const wanted = new Map();
  const add = path => { const e = byPath.get(path); if (e && isAdminRelevant(path, dataRoot)) wanted.set(path, e); };
  add(`${dataRoot}/manifest.csv`);
  add(`${dataRoot}/config.csv`);
  manifestPaths.forEach(add);
  blobs.filter(e => isAdminRelevant(e.path, dataRoot)).forEach(e => {
    const rel = e.path.slice(dataRoot.length + 1);
    const base = rel.split('/').pop().toLowerCase();
    if (
      /^squadra[_\s-]/i.test(base) ||
      /classifica|marcatori|mvp|portieri|risultati|partite|calendario|riepilogo|referto|giornata|eventi/i.test(base) ||
      rel.toLowerCase().startsWith('pagelloni/')
    ) wanted.set(e.path, e);
  });

  const files = await loadEntries(target, [...wanted.values()]);
  if (manifestEntry && !files[`${dataRoot}/manifest.csv`]) {
    files[`${dataRoot}/manifest.csv`] = { text: manifestText, sha: manifestEntry.sha, size: manifestEntry.size };
  }
  const skipped = [...wanted.values()].filter(e => !files[e.path]).map(e => ({ path: e.path, size: e.size }));
  return {
    target: target.key, repository: `${target.owner}/${target.repo}`, branch: target.branch,
    tournament, dataRoot, commitSha: head.commitSha, files, skipped
  };
}

// ---------- pubblicazione (porting di api/publish.js) ----------
const PUB_MAX_FILE_BYTES = 2_500_000;
const PUB_MAX_TOTAL_BYTES = 12_000_000;
const PUB_MAX_CHANGES = 80;

function structuredBlockCsv(text) {
  const raw = String(text || '');
  return /GIORNATA\s+\d+/i.test(raw) || /^(?:PARTITE|MARCATORI|MVP|MIGLIOR\s+PORTIERE|PORTIERI|AUTOGOAL|STATISTICHE)(?:\s*[;,]|\s*$)/im.test(raw);
}
function safeDataPath(path, dataRoot) {
  const p = String(path || '').replace(/^\/+/, '');
  const base = p.split('/').pop().toLowerCase();
  if (/^(fantacalcio_cache|portieri_snapshot)\.json$/i.test(base)) return false;
  return p.startsWith(dataRoot + '/') && !p.includes('..') && /\.(csv|txt|json)$/i.test(p);
}
function validateManifestPaths(text) {
  const errors = [];
  for (const entry of parseManifest(text)) {
    let decoded = entry;
    try { decoded = decodeURIComponent(entry); } catch { errors.push(`Percorso manifest non valido: ${entry}`); continue; }
    const normalized = decoded.replace(/\\/g, '/');
    if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith('/') || normalized.split('/').includes('..') || !/\.(csv|txt|json)$/i.test(normalized)) {
      errors.push(`Percorso manifest non sicuro: ${entry}`);
    }
  }
  return errors;
}
export async function publishChanges(target, { tournament: tournamentValue, baseCommitSha, changes, message, productionConfirmation }) {
  const tournament = normalizeTournamentPath(tournamentValue);
  const dataRoot = `${tournament}/data`;
  if (!/^[a-f0-9]{40}$/i.test(String(baseCommitSha || ''))) throw fail('Commit base non valido.', 400);
  if (target.key === 'produzione' && productionConfirmation !== 'PUBBLICA PRODUZIONE') throw fail('Conferma produzione mancante.', 400);

  const list = Array.isArray(changes) ? changes : [];
  if (!list.length || list.length > PUB_MAX_CHANGES) throw fail('Numero modifiche non valido.', 400);
  const seen = new Set();
  const sanitized = [];
  let total = 0;
  for (const change of list) {
    const path = String(change.path || '').replace(/^\/+/, '');
    if (!safeDataPath(path, dataRoot)) throw fail(`Percorso non consentito: ${path}`, 400);
    if (seen.has(path)) throw fail(`File duplicato nella pubblicazione: ${path}`, 400);
    seen.add(path);
    if (change.delete) { sanitized.push({ path, delete: true }); continue; }
    const content = String(change.content ?? '');
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > PUB_MAX_FILE_BYTES) throw fail(`File troppo grande: ${path}`, 413);
    total += bytes;
    if (/\.csv$/i.test(path)) {
      const errors = structuredBlockCsv(content)
        ? (parseCsvDetailed(content).unclosedQuote ? ['Virgolette CSV non bilanciate.'] : [])
        : validateCsvText(content);
      if (errors.length) throw fail(`${path}: ${errors.slice(0, 4).join(' ')}`, 400);
    }
    if (/manifest\.csv$/i.test(path)) {
      const errors = validateManifestPaths(content);
      if (errors.length) throw fail(errors[0], 400);
    }
    if (/\.json$/i.test(path)) {
      try { JSON.parse(content); } catch { throw fail(`${path}: JSON non valido.`, 400); }
    }
    sanitized.push({ path, content });
  }
  if (total > PUB_MAX_TOTAL_BYTES) throw fail('Pubblicazione troppo grande.', 413);

  const commitMessage = String(message || 'Admin CRAL: aggiornamento dati').trim().slice(0, 180);
  return createAtomicCommit(target, { baseCommitSha, changes: sanitized, message: commitMessage });
}

// ---------- creazione torneo (porting di api/create-tournament.js) ----------
export async function createTournament(target, { baseCommitSha, templateTournament: templateValue, tournament: tournamentInput, productionConfirmation }) {
  if (!/^[a-f0-9]{40}$/i.test(String(baseCommitSha || ''))) throw fail('Commit base non valido.', 400);
  if (target.key === 'produzione' && productionConfirmation !== 'CREA TORNEO PRODUZIONE') throw fail('Conferma creazione in produzione mancante.', 400);

  const checked = validateTournamentInput(tournamentInput || {});
  if (checked.errors.length) throw fail(checked.errors.join(' '), 400);
  const newTournament = normalizeTournamentPath(`tornei/${checked.value.id}`);
  const templateTournament = normalizeTournamentPath(templateValue);
  if (newTournament === templateTournament) throw fail('Il nuovo torneo deve avere un ID diverso dal template.', 400);

  const head = await getHead(target);
  if (head.commitSha !== baseCommitSha) throw fail('Il repository è cambiato dopo il caricamento. Ricarica prima di creare il torneo.', 409);
  const tree = await getTree(target, head.treeSha);
  if (tree.truncated) throw fail('Albero GitHub troppo grande/troncato.', 409);
  const blobs = (tree.tree || []).filter(x => x.type === 'blob');
  const byPath = new Map(blobs.map(x => [x.path, x]));
  if (blobs.some(x => x.path === newTournament || x.path.startsWith(newTournament + '/'))) {
    throw fail(`Esiste già un contenuto sotto ${newTournament}.`, 409);
  }
  const templateIndex = byPath.get(`${templateTournament}/index.html`);
  if (!templateIndex) throw fail(`Template non trovato: ${templateTournament}/index.html`, 404);

  const registryEntry = byPath.get('tornei.json');
  const [registryText, templateIndexText] = await Promise.all([
    registryEntry ? getBlobText(target, registryEntry.sha) : Promise.resolve(''),
    getBlobText(target, templateIndex.sha)
  ]);
  const logoEntry = byPath.get(`${templateTournament}/immagini/logo_cral.png`);
  const publicBaseUrl = target.publicBaseUrl || `https://${target.owner}.github.io/${target.repo}`;
  const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}/${newTournament}`;
  const changes = [
    { path: `${newTournament}/index.html`, content: customizeTournamentIndex(templateIndexText, { ...checked.value, publicUrl }) },
    ...tournamentDataChanges(newTournament, checked.value)
  ];
  if (logoEntry) changes.push({ path: `${newTournament}/immagini/logo_cral.png`, sourceSha: logoEntry.sha });
  changes.push({ path: 'tornei.json', content: updateTournamentRegistry(registryText, checked.value, newTournament, !!logoEntry) });

  const message = `Admin CRAL: crea torneo ${checked.value.id}`;
  const result = await createAtomicCommit(target, { baseCommitSha, changes, message });
  return { ...result, tournament: newTournament, createdFiles: changes.map(c => c.path), copiedLogo: !!logoEntry };
}

// ---------- sessione (token solo in sessionStorage, mai in localStorage) ----------
export function saveSession(targets) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(targets)); } catch { /* storage non disponibile: si prosegue solo in memoria */ }
}
export function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
