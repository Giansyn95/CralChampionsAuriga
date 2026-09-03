import assert from 'node:assert/strict';

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY || '';
const runId = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z_-]/g, '');
if (!token) throw new Error('GH_TOKEN/GITHUB_TOKEN mancante');
if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY non valido');

const [owner, repo] = repository.split('/');
const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
const sourceBranch = `cral-e2e-src-${runId}`;
const destBranch = `cral-e2e-dst-${runId}`;
const fixtureId = `e2e-${runId}`;
const prefix = `__cral_e2e__/${fixtureId}`;

async function api(method, suffix, body) {
  const response = await fetch(`${apiBase}${suffix}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let parsed = raw;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(`${method} ${suffix} -> ${response.status}: ${parsed?.message || raw}`);
  return parsed;
}

const refPath = branch => `/git/ref/heads/${encodeURIComponent(branch)}`;
const refsPath = branch => `/git/refs/heads/${encodeURIComponent(branch)}`;

async function getHead(branch) {
  const ref = await api('GET', refPath(branch));
  const commit = await api('GET', `/git/commits/${ref.object.sha}`);
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

async function getTreeBySha(treeSha) {
  return api('GET', `/git/trees/${treeSha}?recursive=1`);
}

async function getTreeForBranch(branch) {
  const head = await getHead(branch);
  return { head, tree: await getTreeBySha(head.treeSha) };
}

async function getBlob(sha) {
  return api('GET', `/git/blobs/${sha}`);
}

async function createBlob(content, encoding = 'utf-8') {
  return api('POST', '/git/blobs', { content, encoding });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForBranchHead(branch, expectedSha, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastSha = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const ref = await api('GET', refPath(branch));
      lastSha = ref?.object?.sha || null;
      if (lastSha === expectedSha) return;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  const detail = lastError ? `; ultimo errore: ${lastError.message}` : '';
  throw new Error(`Timeout attendendo HEAD ${branch}=${expectedSha}; ultimo SHA=${lastSha}${detail}`);
}

async function createAtomicCommit(branch, changes, message) {
  const head = await getHead(branch);
  const treeEntries = [];
  for (const change of changes) {
    if (change.delete) {
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    let blobSha = change.sourceSha;
    if (!blobSha) {
      const blob = await createBlob(change.content ?? '', 'utf-8');
      blobSha = blob.sha;
    }
    treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blobSha });
  }
  const tree = await api('POST', '/git/trees', { base_tree: head.treeSha, tree: treeEntries });
  const commit = await api('POST', '/git/commits', { message, tree: tree.sha, parents: [head.commitSha] });
  const updatedRef = await api('PATCH', refsPath(branch), { sha: commit.sha, force: false });
  if (updatedRef?.object?.sha) {
    assert.equal(updatedRef.object.sha, commit.sha, `GitHub non ha aggiornato subito il ref ${branch}`);
  }
  // Le Git Data API possono essere temporaneamente eventually-consistent tra PATCH del ref
  // e una GET successiva. Non verifichiamo lo stato finche HEAD non espone il commit scritto.
  await waitForBranchHead(branch, commit.sha);
  return commit.sha;
}

async function createBranch(branch, fromSha) {
  await api('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: fromSha });
  await waitForBranchHead(branch, fromSha);
}

async function deleteBranch(branch) {
  try { await api('DELETE', refsPath(branch)); } catch (error) { console.warn(`Cleanup ${branch}: ${error.message}`); }
}

async function treeMap(branch) {
  const { head, tree } = await getTreeForBranch(branch);
  return { head, map: new Map((tree.tree || []).filter(x => x.type === 'blob').map(x => [x.path, x])) };
}

async function readFile(branch, filePath) {
  const { map } = await treeMap(branch);
  const entry = map.get(filePath);
  if (!entry) return null;
  const blob = await getBlob(entry.sha);
  assert.equal(blob.encoding, 'base64');
  return Buffer.from(String(blob.content || '').replace(/\s+/g, ''), 'base64');
}


async function treeMapAtCommit(commitSha) {
  const commit = await api('GET', `/git/commits/${commitSha}`);
  const tree = await getTreeBySha(commit.tree.sha);
  return new Map((tree.tree || []).filter(x => x.type === 'blob').map(x => [x.path, x]));
}

async function readFileAtCommit(commitSha, filePath) {
  const map = await treeMapAtCommit(commitSha);
  const entry = map.get(filePath);
  if (!entry) return null;
  const blob = await getBlob(entry.sha);
  assert.equal(blob.encoding, 'base64');
  return Buffer.from(String(blob.content || '').replace(/\s+/g, ''), 'base64');
}

async function registryAtCommit(commitSha) {
  const buf = await readFileAtCommit(commitSha, 'tornei.json');
  if (!buf) throw new Error('tornei.json non trovato nel commit');
  return JSON.parse(buf.toString('utf8'));
}

async function waitForBranchFile(branch, filePath, expected, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      last = await readFile(branch, filePath);
      const ok = expected === null
        ? last === null
        : Buffer.isBuffer(last) && last.equals(expected);
      if (ok) return;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await sleep(400);
  }
  const actual = last === null ? '<missing>' : JSON.stringify(last?.toString('utf8'));
  const wanted = expected === null ? '<missing>' : JSON.stringify(expected.toString('utf8'));
  const detail = lastError ? `; ultimo errore: ${lastError.message}` : '';
  throw new Error(`Timeout attendendo ${branch}:${filePath}=${wanted}; ultimo valore=${actual}${detail}`);
}

async function registry(branch) {
  const buf = await readFile(branch, 'tornei.json');
  if (!buf) throw new Error('tornei.json non trovato');
  return JSON.parse(buf.toString('utf8'));
}

function fixtureMeta() {
  return {
    id: fixtureId,
    anno: '2099',
    stagione: 'E2E',
    slug: fixtureId,
    nome: 'E2E',
    cartella: prefix,
    titolo: 'CRAL E2E automatico',
    descrizione: 'Fixture temporanea GitHub Actions',
    url: `${prefix}/`,
    stato: 'in-corso',
    corrente: false,
    ordine: 20999,
    attivo: true
  };
}

function upsertRegistry(base, meta) {
  const next = structuredClone(base);
  next.tornei = Array.isArray(next.tornei) ? next.tornei : [];
  const idx = next.tornei.findIndex(t => String(t.cartella || '') === meta.cartella);
  if (idx >= 0) next.tornei[idx] = structuredClone(meta);
  else next.tornei.push(structuredClone(meta));
  return next;
}

async function seedBranchContents() {
  const baseRegistry = await registry(sourceBranch);
  const srcRegistry = upsertRegistry(baseRegistry, fixtureMeta());
  const dstMeta = { ...fixtureMeta(), titolo: 'CRAL E2E vecchio', stato: 'prossimo' };
  const dstRegistry = upsertRegistry(baseRegistry, dstMeta);

  const sourceLogo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=', 'base64');
  const oldLogo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const srcLogoBlob = await createBlob(sourceLogo.toString('base64'), 'base64');
  const dstLogoBlob = await createBlob(oldLogo.toString('base64'), 'base64');

  await createAtomicCommit(sourceBranch, [
    { path: 'tornei.json', content: JSON.stringify(srcRegistry, null, 2) + '\n' },
    { path: `${prefix}/index.html`, content: '<!doctype html><title>E2E</title>\n' },
    { path: `${prefix}/data/update.txt`, content: 'NEW\n' },
    { path: `${prefix}/data/added.txt`, content: 'ADDED\n' },
    { path: `${prefix}/immagini/logo_cral.png`, sourceSha: srcLogoBlob.sha }
  ], `E2E seed source ${fixtureId}`);

  await createAtomicCommit(destBranch, [
    { path: 'tornei.json', content: JSON.stringify(dstRegistry, null, 2) + '\n' },
    { path: `${prefix}/index.html`, content: '<!doctype html><title>E2E</title>\n' },
    { path: `${prefix}/data/update.txt`, content: 'OLD\n' },
    { path: `${prefix}/data/stale.txt`, content: 'STALE\n' },
    { path: `${prefix}/immagini/logo_cral.png`, sourceSha: dstLogoBlob.sha }
  ], `E2E seed destination ${fixtureId}`);
}

async function mirrorAndPromote() {
  const src = await treeMap(sourceBranch);
  const dst = await treeMap(destBranch);
  const sourceFiles = [...src.map.values()].filter(x => x.path.startsWith(`${prefix}/`));
  const destFiles = [...dst.map.values()].filter(x => x.path.startsWith(`${prefix}/`));
  const sourceByPath = new Map(sourceFiles.map(x => [x.path, x]));
  const destByPath = new Map(destFiles.map(x => [x.path, x]));
  const added = sourceFiles.filter(x => !destByPath.has(x.path));
  const updated = sourceFiles.filter(x => destByPath.has(x.path) && destByPath.get(x.path).sha !== x.sha);
  const unchanged = sourceFiles.filter(x => destByPath.has(x.path) && destByPath.get(x.path).sha === x.sha);
  const removed = destFiles.filter(x => !sourceByPath.has(x.path));

  assert.ok(added.length > 0, 'Il test deve contenere almeno un ADD');
  assert.ok(updated.length > 0, 'Il test deve contenere almeno un UPDATE');
  assert.ok(removed.length > 0, 'Il test deve contenere almeno un DELETE');
  assert.ok(unchanged.length > 0, 'Il test deve contenere almeno un file invariato');

  const changes = [];
  for (const file of [...added, ...updated]) {
    const sourceBlob = await getBlob(file.sha);
    const copiedBlob = await createBlob(String(sourceBlob.content || '').replace(/\s+/g, ''), 'base64');
    changes.push({ path: file.path, sourceSha: copiedBlob.sha });
  }
  removed.forEach(file => changes.push({ path: file.path, delete: true }));

  const srcRegistry = await registry(sourceBranch);
  const dstRegistry = await registry(destBranch);
  const meta = structuredClone(srcRegistry.tornei.find(t => t.cartella === prefix));
  assert.ok(meta, 'Metadati fixture non trovati');
  for (const t of dstRegistry.tornei || []) {
    if (t.corrente && t.cartella !== prefix) {
      t.corrente = false;
      if (String(t.stato || '') === 'in-corso') t.stato = 'concluso';
    }
  }
  meta.corrente = true;
  meta.stato = 'in-corso';
  const idx = (dstRegistry.tornei || []).findIndex(t => t.cartella === prefix);
  if (idx >= 0) dstRegistry.tornei[idx] = meta;
  else dstRegistry.tornei.push(meta);
  dstRegistry.logo = `${prefix}/immagini/logo_cral.png`;
  changes.push({ path: 'tornei.json', content: JSON.stringify(dstRegistry, null, 2) + '\n' });

  return createAtomicCommit(destBranch, changes, `E2E promote ${fixtureId}`);
}

async function verifyMirror() {
  const src = await treeMap(sourceBranch);
  const dst = await treeMap(destBranch);
  const srcPaths = [...src.map.keys()].filter(p => p.startsWith(`${prefix}/`)).sort();
  const dstPaths = [...dst.map.keys()].filter(p => p.startsWith(`${prefix}/`)).sort();
  assert.deepEqual(dstPaths, srcPaths, 'La destinazione non è un mirror esatto della cartella sorgente');
  assert.equal((await readFile(destBranch, `${prefix}/data/update.txt`)).toString('utf8'), 'NEW\n');
  assert.equal(await readFile(destBranch, `${prefix}/data/stale.txt`), null);
  assert.deepEqual(await readFile(destBranch, `${prefix}/immagini/logo_cral.png`), await readFile(sourceBranch, `${prefix}/immagini/logo_cral.png`));
  const reg = await registry(destBranch);
  const meta = reg.tornei.find(t => t.cartella === prefix);
  assert.equal(meta.corrente, true);
  assert.equal(meta.stato, 'in-corso');
}

async function rollbackOnlyTournament(promotedCommitSha) {
  const promoted = await api('GET', `/git/commits/${promotedCommitSha}`);
  const currentRegistry = await registry(destBranch);
  const unrelated = (currentRegistry.tornei || []).find(t => t.cartella !== prefix);
  if (unrelated) unrelated.titolo = `PRESERVE-${fixtureId}`;
  const fixture = currentRegistry.tornei.find(t => t.cartella === prefix);
  fixture.titolo = 'Titolo mutato dopo promote';
  await createAtomicCommit(destBranch, [
    { path: 'tornei.json', content: JSON.stringify(currentRegistry, null, 2) + '\n' },
    { path: `${prefix}/data/update.txt`, content: 'MUTATED\n' },
    { path: `${prefix}/data/extra-after-promote.txt`, content: 'EXTRA\n' }
  ], `E2E mutate ${fixtureId}`);

  const now = await treeMap(destBranch);
  const oldTree = await getTreeBySha(promoted.tree.sha);
  const oldMap = new Map((oldTree.tree || []).filter(x => x.type === 'blob').map(x => [x.path, x]));
  const currentFiles = [...now.map.values()].filter(x => x.path.startsWith(`${prefix}/`));
  const oldFiles = [...oldMap.values()].filter(x => x.path.startsWith(`${prefix}/`));
  const curByPath = new Map(currentFiles.map(x => [x.path, x]));
  const oldByPath = new Map(oldFiles.map(x => [x.path, x]));
  const changes = [];
  currentFiles.forEach(x => { if (!oldByPath.has(x.path)) changes.push({ path: x.path, delete: true }); });
  oldFiles.forEach(x => { if (!curByPath.has(x.path) || curByPath.get(x.path).sha !== x.sha) changes.push({ path: x.path, sourceSha: x.sha }); });

  const promotedRegistryBlobSha = oldMap.get('tornei.json')?.sha;
  assert.ok(promotedRegistryBlobSha, 'tornei.json storico non trovato');
  const promotedRegistryBlob = await getBlob(promotedRegistryBlobSha);
  const promotedRegistry = JSON.parse(Buffer.from(promotedRegistryBlob.content, 'base64').toString('utf8'));
  const liveRegistry = await registry(destBranch);
  const oldEntry = promotedRegistry.tornei.find(t => t.cartella === prefix);
  const idx = liveRegistry.tornei.findIndex(t => t.cartella === prefix);
  const restored = structuredClone(oldEntry);
  restored.corrente = !!liveRegistry.tornei[idx]?.corrente;
  liveRegistry.tornei[idx] = restored;
  changes.push({ path: 'tornei.json', content: JSON.stringify(liveRegistry, null, 2) + '\n' });

  const rollbackCommitSha = await createAtomicCommit(destBranch, changes, `E2E rollback ${fixtureId}`);

  // Prima validiamo il commit immutabile appena creato. Questo distingue un vero
  // errore di rollback da un ritardo di propagazione/cache nella lettura del branch.
  assert.equal((await readFileAtCommit(rollbackCommitSha, `${prefix}/data/update.txt`)).toString('utf8'), 'NEW\n');
  assert.equal(await readFileAtCommit(rollbackCommitSha, `${prefix}/data/extra-after-promote.txt`), null);
  const committedRegistry = await registryAtCommit(rollbackCommitSha);
  assert.equal(committedRegistry.tornei.find(t => t.cartella === prefix).titolo, 'CRAL E2E automatico');
  if (unrelated) {
    assert.equal(
      committedRegistry.tornei.find(t => t.cartella === unrelated.cartella).titolo,
      `PRESERVE-${fixtureId}`
    );
  }

  // Poi aspettiamo che anche la vista del branch converga allo stesso contenuto.
  // Una singola GET del ref non basta: endpoint diversi possono vedere per pochi
  // istanti revisioni differenti dopo l'aggiornamento del ref.
  await waitForBranchFile(destBranch, `${prefix}/data/update.txt`, Buffer.from('NEW\n'));
  await waitForBranchFile(destBranch, `${prefix}/data/extra-after-promote.txt`, null);
  const after = await registry(destBranch);
  assert.equal(after.tornei.find(t => t.cartella === prefix).titolo, 'CRAL E2E automatico');
  if (unrelated) assert.equal(after.tornei.find(t => t.cartella === unrelated.cartella).titolo, `PRESERVE-${fixtureId}`);
}

let createdSource = false;
let createdDest = false;
try {
  console.log(`Repository: ${repository}`);
  console.log(`Branch temporanei: ${sourceBranch}, ${destBranch}`);
  const base = await getHead(process.env.E2E_BASE_BRANCH || 'main');
  await createBranch(sourceBranch, base.commitSha);
  createdSource = true;
  await createBranch(destBranch, base.commitSha);
  createdDest = true;
  await seedBranchContents();

  const promoted = await mirrorAndPromote();
  await verifyMirror();
  await rollbackOnlyTournament(promoted);
  console.log('✅ GitHub E2E: atomic commit, mirror ADD/UPDATE/DELETE, binari e rollback superati.');
} finally {
  if (createdSource) await deleteBranch(sourceBranch);
  if (createdDest) await deleteBranch(destBranch);
}
