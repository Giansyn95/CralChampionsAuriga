const crypto = require('crypto');

const sha = value => crypto.createHash('sha1').update(value).digest('hex');
const jsonText = value => JSON.stringify(value, null, 2) + '\n';

class MockRepo {
  constructor(owner, repo, branch = 'main') {
    this.owner = owner;
    this.repo = repo;
    this.defaultBranch = branch;
    this.blobs = new Map();
    this.trees = new Map();
    this.commits = new Map();
    this.refs = new Map();
    this.counter = 0;
  }

  putBlob(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
    const id = sha(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]));
    this.blobs.set(id, buf);
    return id;
  }

  putTree(files) {
    const sorted = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
    const id = sha(sorted.map(([p, b]) => `${p}:${b}`).join('\n') + `:${this.counter++}`);
    this.trees.set(id, new Map(sorted));
    return id;
  }

  putCommit(treeSha, parent, message) {
    const id = sha(`${treeSha}|${parent || ''}|${message}|${this.counter++}`);
    this.commits.set(id, {
      sha: id,
      treeSha,
      parent: parent || null,
      message,
      date: new Date(Date.UTC(2026, 8, 3, 12, 0, this.counter)).toISOString()
    });
    return id;
  }

  seed(files, branch = this.defaultBranch, message = 'fixture iniziale') {
    const map = new Map();
    for (const [filePath, content] of Object.entries(files)) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
      map.set(filePath, this.putBlob(buf));
    }
    const treeSha = this.putTree(map);
    const commitSha = this.putCommit(treeSha, null, message);
    this.refs.set(branch, commitSha);
    return commitSha;
  }

  head(branch = this.defaultBranch) {
    const commitSha = this.refs.get(branch);
    if (!commitSha) throw new Error(`Branch mock inesistente: ${branch}`);
    const commit = this.commits.get(commitSha);
    return { commitSha, treeSha: commit.treeSha };
  }

  currentFiles(branch = this.defaultBranch) {
    const { treeSha } = this.head(branch);
    return new Map(this.trees.get(treeSha));
  }

  readFile(filePath, branch = this.defaultBranch) {
    const blobSha = this.currentFiles(branch).get(filePath);
    if (!blobSha) return null;
    return this.blobs.get(blobSha) || null;
  }

  commitChanges(branch, changes, message = 'fixture update') {
    const head = this.head(branch);
    const files = new Map(this.trees.get(head.treeSha));
    for (const change of changes) {
      if (change.delete) files.delete(change.path);
      else if (change.sourceSha) files.set(change.path, change.sourceSha);
      else files.set(change.path, this.putBlob(change.content ?? ''));
    }
    const treeSha = this.putTree(files);
    const commitSha = this.putCommit(treeSha, head.commitSha, message);
    this.refs.set(branch, commitSha);
    return commitSha;
  }

  history(branch = this.defaultBranch, limit = 20) {
    const out = [];
    let current = this.refs.get(branch);
    while (current && out.length < limit) {
      const c = this.commits.get(current);
      if (!c) break;
      out.push(c);
      current = c.parent;
    }
    return out;
  }
}

function sourceRegistry(title = 'Torneo automatico') {
  return {
    titolo: 'CRAL Champions Test',
    sottotitolo: 'Fixture automatica',
    logo: 'tornei/2026-test/immagini/logo_cral.png',
    archivio: { primoPiano: 1 },
    tornei: [
      {
        id: '2026-test', anno: '2026', stagione: 'Test', slug: 'test', nome: 'Test',
        cartella: 'tornei/2026-test', titolo, descrizione: 'Fixture Playwright',
        url: 'tornei/2026-test/', stato: 'in-corso', corrente: true, ordine: 20269, attivo: true
      },
      {
        id: '2027-futuro', anno: '2027', stagione: 'Futuro', slug: 'futuro', nome: 'Futuro',
        cartella: 'tornei/2027-futuro', titolo: 'Torneo futuro da preservare', descrizione: '',
        url: 'tornei/2027-futuro/', stato: 'prossimo', corrente: false, ordine: 20279, attivo: true
      }
    ]
  };
}

function productionRegistry() {
  return {
    titolo: 'CRAL Champions Produzione',
    sottotitolo: '',
    logo: 'tornei/2025-old/immagini/logo_cral.png',
    archivio: { primoPiano: 1 },
    tornei: [
      {
        id: '2025-old', anno: '2025', stagione: 'Old', slug: 'old', nome: 'Old',
        cartella: 'tornei/2025-old', titolo: 'Vecchio corrente', descrizione: '',
        url: 'tornei/2025-old/', stato: 'in-corso', corrente: true, ordine: 20259, attivo: true
      },
      {
        id: '2026-test', anno: '2026', stagione: 'Test', slug: 'test', nome: 'Test',
        cartella: 'tornei/2026-test', titolo: 'Metadati vecchi', descrizione: '',
        url: 'tornei/2026-test/', stato: 'prossimo', corrente: false, ordine: 20269, attivo: true
      }
    ]
  };
}

function baseTournamentFiles(registry, variant = 'source') {
  const logo = variant === 'production'
    ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=', 'base64');
  const files = {
    'tornei.json': jsonText(registry),
    'tornei/2026-test/index.html': '<!doctype html><html><body>fixture</body></html>',
    'tornei/2026-test/data/manifest.csv': [
      'file', 'config.csv', 'squadra_Alpha.csv', 'squadra_Beta.csv', 'calendario.csv',
      'risultati_partite.csv', 'riepilogo_giornate.csv', 'classifica_squadre.csv',
      'classifica_marcatori.csv', 'classifica_mvp.csv', 'classifica_portieri.csv'
    ].join('\n') + '\n',
    'tornei/2026-test/data/config.csv': 'chiave;valore\ntitolo;Torneo automatico\nsottotitolo;Fixture Playwright\n',
    'tornei/2026-test/data/squadra_Alpha.csv': 'Nome;Cognome;Ruolo;Numero;Capitano\nMario;Rossi;P;1;SI\nLuca;Bianchi;A;9;\n',
    'tornei/2026-test/data/squadra_Beta.csv': 'Nome;Cognome;Ruolo;Numero;Capitano\nPaolo;Verdi;P;1;SI\nAndrea;Neri;A;10;\n',
    'tornei/2026-test/data/calendario.csv': variant === 'production'
      ? 'Giornata;Data;Squadra casa;Squadra trasferta;Note\n1;2026-09-10;Alpha;Beta;VECCHIO\n'
      : 'Giornata;Data;Squadra casa;Squadra trasferta;Note\n1;2026-09-10;Alpha;Beta;\n2;2026-09-17;Beta;Alpha;\n',
    'tornei/2026-test/data/risultati_partite.csv': 'Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta;Note\n1;2026-09-10;Alpha;2;Beta;1;\n',
    'tornei/2026-test/data/riepilogo_giornate.csv': 'Sezione;Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta;Risultato;Squadra;Giocatore;Goal;PuntiMVP;PuntiPortiere;Partita;Statistica;Valore;Note;Tavolino;Squadra penalizzata\nPartita;1;2026-09-10;Alpha;2;Beta;1;2-1;;;;;;;;;;;\n',
    'tornei/2026-test/data/classifica_squadre.csv': 'Posizione;Squadra;PG;V;N;P;GF;GS;DR;Punti finali;Penalità;Nota penalità\n1;Alpha;1;1;0;0;2;1;1;3;0;\n',
    'tornei/2026-test/data/classifica_marcatori.csv': 'Posizione;Giocatore;Squadra;Gol;Partite;Note\n1;Luca Bianchi;Alpha;2;1;\n',
    'tornei/2026-test/data/classifica_mvp.csv': 'Posizione;Giocatore;Squadra;Punti MVP;Note\n1;Luca Bianchi;Alpha;3;\n',
    'tornei/2026-test/data/classifica_portieri.csv': 'Posizione;Portiere;Squadra;Punti;Note\n1;Mario Rossi;Alpha;3;\n',
    'tornei/2026-test/immagini/logo_cral.png': logo
  };
  if (variant === 'source') files['tornei/2026-test/data/nuovo.csv'] = 'chiave;valore\nnuovo;si\n';
  if (variant === 'production') files['tornei/2026-test/data/stale.csv'] = 'questo file deve sparire\n';
  return files;
}

function parseRepoPath(pathname) {
  const m = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { key: `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`, suffix: m[3] || '' };
}

function apiJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function createGitHubMock({ rollbackHistory = false } = {}) {
  const source = new MockRepo('giansyn95', 'CralChampionsAuriga');
  const production = new MockRepo('cralauriga', 'CralChampionsAuriga');

  if (rollbackHistory) {
    const old = sourceRegistry('Titolo storico');
    source.seed({
      ...baseTournamentFiles(old, 'source'),
      'tornei/2026-test/data/versione.txt': 'OLD\n'
    }, 'main', 'Versione storica');
    const current = sourceRegistry('Titolo corrente');
    current.tornei.find(t => t.cartella === 'tornei/2027-futuro').titolo = 'Futuro corrente da preservare';
    source.commitChanges('main', [
      { path: 'tornei.json', content: jsonText(current) },
      { path: 'tornei/2026-test/data/versione.txt', content: 'NEW\n' },
      { path: 'tornei/2026-test/data/extra-da-rimuovere.txt', content: 'EXTRA\n' }
    ], 'Versione corrente');
  } else {
    source.seed(baseTournamentFiles(sourceRegistry(), 'source'));
  }
  production.seed({
    ...baseTournamentFiles(productionRegistry(), 'production'),
    'tornei/2025-old/index.html': '<!doctype html><html><body>old</body></html>'
  });

  const repos = new Map([
    ['giansyn95/CralChampionsAuriga', source],
    ['cralauriga/CralChampionsAuriga', production]
  ]);

  async function install(page) {
    await page.route('https://api.github.com/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      const parsed = parseRepoPath(decodeURIComponent(url.pathname));
      if (!parsed || !repos.has(parsed.key)) return apiJson(route, { message: 'Repository mock non trovato' }, 404);
      const repo = repos.get(parsed.key);
      const suffix = parsed.suffix;
      const method = req.method();
      let body = null;
      if (['POST', 'PATCH', 'PUT'].includes(method)) {
        try { body = req.postDataJSON(); } catch { body = {}; }
      }

      let m;
      if (method === 'GET' && (m = suffix.match(/^\/git\/ref\/heads\/(.+)$/))) {
        const branch = decodeURIComponent(m[1]);
        const commitSha = repo.refs.get(branch);
        return commitSha ? apiJson(route, { ref: `refs/heads/${branch}`, object: { sha: commitSha } }) : apiJson(route, { message: 'Not Found' }, 404);
      }
      if (method === 'GET' && (m = suffix.match(/^\/git\/commits\/([a-f0-9]{40})$/i))) {
        const c = repo.commits.get(m[1]);
        if (!c) return apiJson(route, { message: 'Not Found' }, 404);
        return apiJson(route, { sha: c.sha, tree: { sha: c.treeSha }, parents: c.parent ? [{ sha: c.parent }] : [], message: c.message });
      }
      if (method === 'GET' && (m = suffix.match(/^\/git\/trees\/([a-f0-9]{40})$/i))) {
        const tree = repo.trees.get(m[1]);
        if (!tree) return apiJson(route, { message: 'Not Found' }, 404);
        return apiJson(route, {
          sha: m[1], truncated: false,
          tree: [...tree.entries()].map(([p, blobSha]) => ({ path: p, mode: '100644', type: 'blob', sha: blobSha, size: repo.blobs.get(blobSha)?.length || 0 }))
        });
      }
      if (method === 'GET' && (m = suffix.match(/^\/git\/blobs\/([a-f0-9]{40})$/i))) {
        const buf = repo.blobs.get(m[1]);
        if (!buf) return apiJson(route, { message: 'Not Found' }, 404);
        return apiJson(route, { sha: m[1], encoding: 'base64', content: buf.toString('base64') });
      }
      if (method === 'POST' && suffix === '/git/blobs') {
        const buf = body?.encoding === 'base64'
          ? Buffer.from(String(body?.content || '').replace(/\s+/g, ''), 'base64')
          : Buffer.from(String(body?.content || ''), 'utf8');
        const blobSha = repo.putBlob(buf);
        return apiJson(route, { sha: blobSha }, 201);
      }
      if (method === 'POST' && suffix === '/git/trees') {
        const base = repo.trees.get(body?.base_tree);
        if (!base) return apiJson(route, { message: 'base_tree non trovato' }, 422);
        const files = new Map(base);
        for (const entry of body?.tree || []) {
          if (entry.sha == null) files.delete(entry.path);
          else files.set(entry.path, entry.sha);
        }
        const treeSha = repo.putTree(files);
        return apiJson(route, { sha: treeSha }, 201);
      }
      if (method === 'POST' && suffix === '/git/commits') {
        const parent = body?.parents?.[0] || null;
        if (!repo.trees.has(body?.tree)) return apiJson(route, { message: 'tree non trovato' }, 422);
        const commitSha = repo.putCommit(body.tree, parent, body?.message || 'mock commit');
        return apiJson(route, { sha: commitSha, tree: { sha: body.tree } }, 201);
      }
      if (method === 'PATCH' && (m = suffix.match(/^\/git\/refs\/heads\/(.+)$/))) {
        const branch = decodeURIComponent(m[1]);
        if (!repo.commits.has(body?.sha)) return apiJson(route, { message: 'commit non trovato' }, 422);
        repo.refs.set(branch, body.sha);
        return apiJson(route, { ref: `refs/heads/${branch}`, object: { sha: body.sha } });
      }
      if (method === 'GET' && suffix === '/commits') {
        return apiJson(route, repo.history('main').map(c => ({
          sha: c.sha,
          commit: { message: c.message, author: { name: 'CRAL Test', date: c.date } }
        })));
      }
      return apiJson(route, { message: `Mock endpoint non implementato: ${method} ${suffix}` }, 404);
    });

    await page.route('https://raw.githubusercontent.com/**', async route => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const [owner, repoName, branch, ...rest] = parts;
      const repo = repos.get(`${owner}/${repoName}`);
      if (!repo || !repo.refs.has(branch)) return route.fulfill({ status: 404, body: 'Not found' });
      const filePath = rest.join('/');
      const buf = repo.readFile(filePath, branch);
      if (!buf) return route.fulfill({ status: 404, body: 'Not found' });
      const type = /\.json$/i.test(filePath) ? 'application/json' : /\.png$/i.test(filePath) ? 'image/png' : 'text/plain; charset=utf-8';
      return route.fulfill({ status: 200, contentType: type, body: buf });
    });
  }

  async function seedSession(page, includeProduction = true) {
    const targets = {
      collaudo: {
        key: 'collaudo', owner: 'giansyn95', repo: 'CralChampionsAuriga', branch: 'main',
        publicBaseUrl: '', token: 'test-token-collaudo', label: 'Collaudo'
      },
      produzione: includeProduction ? {
        key: 'produzione', owner: 'cralauriga', repo: 'CralChampionsAuriga', branch: 'main',
        publicBaseUrl: '', token: 'test-token-produzione', label: 'Produzione'
      } : null
    };
    await page.addInitScript(value => sessionStorage.setItem('cral-admin-gh-session', JSON.stringify(value)), targets);
  }

  return { install, seedSession, source, production };
}

module.exports = { createGitHubMock };
