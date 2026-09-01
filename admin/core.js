export function norm(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function intOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}
export function num(value) {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
export function dayNumber(value) {
  const m = String(value ?? '').match(/(?:giornata|turno|round)?[_\s-]*(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}
function countSep(line, sep) {
  let q = false, count = 0;
  for (let i = 0; i < String(line || '').length; i++) {
    const c = line[i], n = line[i + 1];
    if (c === '"' && q && n === '"') { i++; continue; }
    if (c === '"') q = !q;
    else if (c === sep && !q) count++;
  }
  return count;
}
export function csvSeparator(text) {
  const line = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).find(x => x.trim()) || '';
  return countSep(line, ';') >= countSep(line, ',') ? ';' : ',';
}
export function parseCsv(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return { separator: ';', rows: [] };
  const separator = csvSeparator(text);
  const rows = [];
  let row = [], val = '', q = false;
  const push = () => { row.push(val); if (row.some(x => String(x).trim())) rows.push(row.map(x => String(x).trim())); row = []; val = ''; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { val += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === separator && !q) { row.push(val); val = ''; }
    else if ((c === '\r' || c === '\n') && !q) { push(); if (c === '\r' && n === '\n') i++; }
    else val += c;
  }
  if (val !== '' || row.length) push();
  const width = Math.max(0, ...rows.map(r => r.length));
  rows.forEach(r => { while (r.length < width) r.push(''); });
  return { separator, rows };
}
export function csvEscape(value, separator = ';') {
  const s = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (s.includes('"') || s.includes('\n') || s.includes(separator) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function csvStringify(rows, separator = ';') {
  return (rows || []).map(row => row.map(v => csvEscape(v, separator)).join(separator)).join('\n') + '\n';
}
export function rowsToObjects(rows) {
  if (!rows?.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h || `Colonna ${i + 1}`, r[i] ?? ''])));
}
export function objectRows(text) {
  const parsed = parseCsv(text);
  return { ...parsed, headers: parsed.rows[0] || [], objects: rowsToObjects(parsed.rows) };
}
export function field(obj, aliases) {
  const keys = Object.keys(obj || {});
  for (const alias of aliases) {
    const k = keys.find(x => norm(x) === norm(alias));
    if (k !== undefined && String(obj[k] ?? '').trim() !== '') return obj[k];
  }
  for (const alias of aliases) {
    const k = keys.find(x => norm(x).includes(norm(alias)));
    if (k !== undefined && String(obj[k] ?? '').trim() !== '') return obj[k];
  }
  return '';
}
export function fileKind(path) {
  const raw = String(path || '').split('/').pop().toLowerCase();
  const n = norm(raw);
  if (raw.startsWith('rosa_') || raw.startsWith('roster_')) return 'fanta_roster';
  if (n === 'listonefantacalciocsv') return 'fanta_listone';
  if (n === 'eventifantacalciocsv') return 'fanta_eventi';
  if (raw.includes('fantacalcio') && (raw.includes('classifica') || raw.includes('risultati'))) return 'fanta_output';
  if (n.includes('classificasquadre')) return 'classifica_squadre';
  if (n.includes('marcatori')) return 'marcatori';
  if (n.includes('mvp')) return 'mvp';
  if (n.includes('portieri')) return 'portieri';
  if (n.includes('pagellone')) return 'pagellone';
  if (n.includes('riepilogogiornata') || n.includes('riepilogogiornate') || n.includes('refertogiornata') || /^giornata\d*csv$/.test(n) || /^giornata\d+/.test(n)) return 'riepilogo';
  if (n.includes('risultati') || n === 'partitecsv' || n.includes('partite')) return 'risultati';
  if (n.includes('calendario')) return 'calendario';
  if (/^squadra/i.test(raw)) return 'squadra';
  if (n === 'configcsv') return 'config';
  if (n === 'manifestcsv') return 'manifest';
  return 'altro';
}
export function relativeDataPath(repoPath, dataRoot) {
  const prefix = `${dataRoot}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
}
export function sectionFiles(model, kind) {
  return model.fileList.filter(f => f.active !== false && fileKind(f.rel) === kind);
}

const FORFEIT_TRUE_TOKENS = ['si', 's', 'x', '1', 'true', 'vero', 'yes', 'y'];
const FORFEIT_FALSE_TOKENS = ['no', 'n', '0', 'false', 'falso'];
function forfeitFlag(obj) {
  // La sorgente dati può marcare il forfeit in due modi equivalenti che l'app
  // pubblica capisce già: una colonna dedicata "Tavolino" (SI/NO, X, 1/0...)
  // oppure una nota testuale libera ("Vittoria a tavolino", "Rinuncia", ecc.).
  // Se la colonna dedicata è presente e valorizzata ha sempre la priorità,
  // altrimenti si ricade sulla scansione testuale su tutti i campi.
  const explicit = norm(field(obj, ['tavolino', 'a tavolino', 'forfeit']));
  if (FORFEIT_TRUE_TOKENS.includes(explicit)) return true;
  if (FORFEIT_FALSE_TOKENS.includes(explicit)) return false;
  return /tavolino|forfeit|rinuncia/i.test(Object.values(obj || {}).join(' '));
}
function scorePair(obj) {
  const direct = field(obj, ['risultato', 'score']);
  const nums = String(direct || '').match(/-?\d+/g);
  if (nums?.length >= 2) return [Number(nums[0]), Number(nums[1])];
  const h = field(obj, ['gol casa', 'goal casa', 'reti casa', 'gc']);
  const a = field(obj, ['gol trasferta', 'goal trasferta', 'reti trasferta', 'gt']);
  if (String(h).trim() !== '' && String(a).trim() !== '') return [num(h), num(a)];
  return null;
}
function matchFromObject(obj, file, index = 0) {
  const home = String(field(obj, ['squadra casa', 'casa', 'home', 'squadra 1', 'team casa']) || '').trim();
  const away = String(field(obj, ['squadra trasferta', 'trasferta', 'ospite', 'away', 'squadra 2', 'team trasferta']) || '').trim();
  if (!home && !away) return null;
  const score = scorePair(obj);
  return {
    id: `${dayNumber(field(obj, ['giornata', 'turno', 'round'])) || dayNumber(file) || 0}|${norm(home)}|${norm(away)}|${index}`,
    day: dayNumber(field(obj, ['giornata', 'turno', 'round'])) || dayNumber(file) || null,
    date: String(field(obj, ['data', 'giorno', 'date']) || '').trim(),
    home, away,
    homeGoals: score ? score[0] : null,
    awayGoals: score ? score[1] : null,
    notes: String(field(obj, ['note', 'nota', 'commento', 'descrizione']) || '').trim(),
    forfeit: forfeitFlag(obj),
    penalizedTeam: String(field(obj, ['squadra penalizzata', 'penalizzata', 'team penalizzato', 'perdente']) || '').trim(),
    sourceFile: file,
    sourceRow: obj
  };
}
function parseBlockCalendar(text, file) {
  const separator = csvSeparator(text);
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let day = null;
  for (const line of lines) {
    const cells = line.split(separator).map(x => x.trim());
    const m = (cells[0] || '').match(/GIORNATA\s+(\d+)/i);
    if (m) { day = Number(m[1]); continue; }
    if (!day || !cells.some(Boolean) || /^casa$/i.test(cells[0] || '') || /^squadra\s*(casa|1)/i.test(cells[0] || '')) continue;
    const home = cells[0] || '', away = cells[1] || '', notes = cells[2] || '';
    if (!home || !away || /riposa/i.test(`${home} ${away} ${notes}`)) continue;
    out.push({ id: `${day}|${norm(home)}|${norm(away)}|${out.length}`, day, date: '', home, away, homeGoals: null, awayGoals: null, notes, forfeit: false, penalizedTeam: '', sourceFile: file, sourceRow: null });
  }
  return out;
}
export function parseRiepilogo(text) {
  const buckets = { partite: [], marcatori: [], totaliMarcatori: [], mvp: [], portieri: [], autogoal: [], statistiche: [] };
  const parsed = objectRows(text);
  const sectionBucket = value => {
    const s = norm(value);
    if (!s) return '';
    if (s === 'partita' || s.includes('partite') || s.includes('risultati')) return 'partite';
    if (s.includes('totalemarcatore') || s.includes('totalimarcatori') || s.includes('classificagiornatamarcatori')) return 'totaliMarcatori';
    if (s.includes('marcatore') || s.includes('marcatori')) return 'marcatori';
    if (s === 'mvp' || s.includes('miglioreincampo') || s.includes('manofthematch')) return 'mvp';
    if (s.includes('portiere') || s.includes('portieri') || s.includes('clean')) return 'portieri';
    if (s.includes('autogoal') || s.includes('autoreti')) return 'autogoal';
    if (s.includes('statistic')) return 'statistiche';
    return '';
  };
  const hasSection = parsed.headers.some(h => norm(h) === 'sezione');
  if (hasSection) {
    for (const row of parsed.objects) {
      const bucket = sectionBucket(field(row, ['sezione', 'tipo', 'blocco', 'categoria']));
      (buckets[bucket || 'partite']).push(row);
    }
    return buckets;
  }

  // Formato storico a blocchi: PARTITE;..., MARCATORI;..., MVP;..., ecc.
  const sep = csvSeparator(text);
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let current = '', header = null, data = [];
  const parseLine = line => parseCsv(line).rows[0] || String(line || '').split(sep).map(x => x.trim());
  const flush = () => {
    if (current && header) {
      const rows = [header, ...data];
      buckets[current].push(...rowsToObjects(rows));
    }
    current = ''; header = null; data = [];
  };
  for (const line of lines) {
    if (!String(line).trim()) { flush(); continue; }
    const cells = parseLine(line);
    const bucket = sectionBucket(cells[0] || '');
    const rest = cells.slice(1).filter(x => String(x || '').trim());
    const looksSection = bucket && (rest.length === 0 || /casa|trasferta|giocatore|squadra|statistica|valore|risultato|goal|gol/i.test(rest.join(' ')));
    if (looksSection) {
      flush(); current = bucket; header = rest.length ? cells.slice(1) : null; continue;
    }
    if (current) {
      if (!header) header = cells;
      else data.push(cells);
    }
  }
  flush();
  if (Object.values(buckets).every(arr => !arr.length) && parsed.objects.length) buckets.partite.push(...parsed.objects);
  return buckets;
}
function teamNameFromFile(rel, standingsNames = []) {
  const base = rel.split('/').pop().replace(/\.csv$/i, '').replace(/^squadra[_\s-]*/i, '').replace(/_/g, ' ');
  return standingsNames.find(x => norm(x) === norm(base)) || base;
}
function playerFromRoster(row, team, index) {
  const nome = String(field(row, ['nome', 'first name', 'firstname']) || '').trim();
  const cognome = String(field(row, ['cognome', 'last name', 'lastname']) || '').trim();
  const direct = String(field(row, ['giocatore', 'nome completo', 'calciatore', 'player', 'cognome e nome']) || '').trim();
  const full = `${nome} ${cognome}`.trim() || direct;
  const display = `${cognome} ${nome}`.trim() || direct || full;
  return {
    id: `${norm(team)}|${norm(full || display)}|${index}`,
    team,
    nome,
    cognome,
    fullName: full || display,
    displayName: display || full,
    role: String(field(row, ['ruolo', 'role', 'posizione', 'position']) || '').trim(),
    number: String(field(row, ['numero', 'n', 'maglia']) || '').trim(),
    captain: ['si','s','yes','y','true','1','x','capitano','captain','c'].includes(norm(field(row, ['capitano','captain','fascia','cap','is_captain']))),
    sourceRow: row
  };
}
function mergeMatches(primary, secondary) {
  const map = new Map();
  const keyFor = m => `${m.day || 0}|${norm(m.home)}|${norm(m.away)}`;
  [...primary, ...secondary].forEach(m => {
    if (!m?.home || !m?.away) return;
    const key = keyFor(m);
    const old = map.get(key);
    if (!old) map.set(key, { ...m });
    else {
      ['date','notes','penalizedTeam'].forEach(k => { if (!old[k] && m[k]) old[k] = m[k]; });
      if (m.homeGoals !== null) old.homeGoals = m.homeGoals;
      if (m.awayGoals !== null) old.awayGoals = m.awayGoals;
      old.forfeit = old.forfeit || m.forfeit;
      if (m.sourceFile && fileKind(m.sourceFile) === 'risultati') old.sourceFile = m.sourceFile;
    }
  });
  return [...map.values()].sort((a,b) => (a.day || 999) - (b.day || 999) || String(a.date).localeCompare(String(b.date)) || a.home.localeCompare(b.home, 'it'));
}
export function buildModel(snapshot) {
  const fileList = Object.entries(snapshot.files || {}).map(([path, meta]) => {
    const rel = relativeDataPath(path, snapshot.dataRoot);
    const parsed = /\.csv$/i.test(path) ? objectRows(meta.text) : null;
    return { path, rel, ...meta, parsed };
  });
  const manifestFile = fileList.find(f => fileKind(f.rel) === 'manifest');
  const manifestParsed = manifestFile ? objectRows(manifestFile.text || '') : { rows: [], objects: [] };
  let manifestEntries = [];
  if (manifestParsed.objects?.length) manifestEntries = manifestParsed.objects.map(o => field(o, ['file','nome','filename'])).filter(Boolean);
  else manifestEntries = (manifestParsed.rows || []).flat().filter(x => norm(x) !== 'file');
  manifestEntries = [...new Set(manifestEntries.map(x => String(x || '').trim().replace(/^data\//i,'').replace(/^\/+/, '')).filter(Boolean))];
  const manifestSet = new Set(manifestEntries.map(x => x.toLowerCase()));
  const hasManifest = !!(manifestFile && String(manifestFile.text || '').trim());
  fileList.forEach(f => {
    const k = fileKind(f.rel);
    // config.csv e manifest.csv sono BOOT_FILES nel frontend. Gli altri file sono
    // considerati attivi solo se elencati nel manifest. Se il manifest manca del
    // tutto, teniamo i file scoperti disponibili per permettere all'Admin di
    // ricostruirlo senza perdere dati.
    f.active = k === 'config' || k === 'manifest' || !hasManifest || manifestSet.has(f.rel.toLowerCase());
  });
  const model = { ...snapshot, fileList, manifestEntries, hasManifest };
  const standingFiles = sectionFiles(model, 'classifica_squadre');
  const standings = standingFiles.flatMap(f => f.parsed?.objects || []);
  const standingsNames = standings.map(r => String(field(r, ['squadra', 'team', 'nome', 'club']) || '')).filter(Boolean);
  const teams = [];
  for (const file of sectionFiles(model, 'squadra')) {
    const name = teamNameFromFile(file.rel, standingsNames);
    const players = (file.parsed?.objects || []).map((r, i) => playerFromRoster(r, name, i)).filter(p => p.fullName);
    teams.push({ name, rel: file.rel, path: file.path, file, players });
  }
  standingsNames.forEach(name => { if (!teams.some(t => norm(t.name) === norm(name))) teams.push({ name, rel: '', path: '', file: null, players: [] }); });
  model.teams = teams.sort((a,b) => a.name.localeCompare(b.name, 'it'));
  model.players = model.teams.flatMap(t => t.players);
  model.standings = standings;

  let calendarMatches = [];
  for (const file of sectionFiles(model, 'calendario')) {
    if (/GIORNATA\s+\d+/i.test(file.text)) calendarMatches.push(...parseBlockCalendar(file.text, file.rel));
    else calendarMatches.push(...(file.parsed?.objects || []).map((r,i) => matchFromObject(r,file.rel,i)).filter(Boolean));
  }
  let resultMatches = [];
  for (const file of sectionFiles(model, 'risultati')) resultMatches.push(...(file.parsed?.objects || []).map((r,i) => matchFromObject(r,file.rel,i)).filter(Boolean));
  let summaryMatches = [];
  model.summaries = [];
  for (const file of sectionFiles(model, 'riepilogo')) {
    const parsed = parseRiepilogo(file.text);
    model.summaries.push({ file, parsed });
    summaryMatches.push(...parsed.partite.map((r,i) => matchFromObject(r,file.rel,i)).filter(Boolean));
  }
  model.calendarMatches = mergeMatches(calendarMatches, []);
  model.resultMatches = mergeMatches(resultMatches, []);
  model.summaryMatches = mergeMatches(summaryMatches, []);
  model.matches = mergeMatches(model.calendarMatches, mergeMatches(model.resultMatches, model.summaryMatches));
  model.days = [...new Set(model.matches.map(m => m.day).filter(Boolean))].sort((a,b)=>a-b);
  return model;
}
export function playersForTeam(model, team) {
  return model.players.filter(p => norm(p.team) === norm(team)).sort((a,b)=>a.displayName.localeCompare(b.displayName,'it'));
}
export function findPlayer(model, name, team = '') {
  const candidates = model.players.filter(p => norm(p.fullName) === norm(name) || norm(p.displayName) === norm(name));
  if (team) return candidates.find(p => norm(p.team) === norm(team)) || null;
  return candidates.length === 1 ? candidates[0] : null;
}
function matchLabel(m) { return `${m.home} - ${m.away}`; }
function rowDay(row, file) { return dayNumber(field(row, ['giornata','turno','round'])) || dayNumber(file) || null; }
function rowBelongsToMatch(row, match) {
  const text = norm(field(row, ['partita','match','gara','incontro']));
  if (text && text.includes(norm(match.home)) && text.includes(norm(match.away))) return true;
  const team = norm(field(row, ['squadra','team']));
  return !!team && [norm(match.home), norm(match.away)].includes(team);
}
function pointsFromRow(row, aliases, fallback = 1) {
  const raw = field(row, aliases);
  return String(raw).trim() === '' ? fallback : num(raw);
}
export function existingMatchdayDetails(model, match) {
  const out = { scorers: [], mvp: null, keeper: null, ownGoals: [], externalGoals: [], notes: match.notes || '' };
  for (const summary of model.summaries || []) {
    const file = summary.file.rel;
    if (match.day && dayNumber(file) && dayNumber(file) !== match.day) continue;
    const filter = row => (!match.day || rowDay(row,file) === match.day) && rowBelongsToMatch(row, match);
    summary.parsed.marcatori.filter(filter).forEach(row => {
      const name = String(field(row, ['giocatore','marcatore','calciatore','player','nome completo']) || '').trim();
      const team = String(field(row, ['squadra','team']) || '').trim();
      const qty = Math.max(1, pointsFromRow(row, ['goal','gol','reti','quantita','qta','valore'], 1));
      if (name) out.scorers.push({ team, player: name, qty, external: !findPlayer(model,name,team) });
    });
    summary.parsed.mvp.filter(filter).forEach(row => {
      if (out.mvp) return;
      const name = String(field(row, ['giocatore','mvp','nome completo','player']) || '').trim();
      const team = String(field(row, ['squadra','team']) || '').trim();
      if (name) out.mvp = { team, player: name, points: pointsFromRow(row,['punti mvp','puntimvp','punti','valore'],1), external: !findPlayer(model,name,team) };
    });
    summary.parsed.portieri.filter(filter).forEach(row => {
      if (out.keeper) return;
      const name = String(field(row, ['giocatore','portiere','nome completo','player']) || '').trim();
      const team = String(field(row, ['squadra','team']) || '').trim();
      if (name) out.keeper = { team, player: name, points: pointsFromRow(row,['punti portiere','punti pt','puntipt','punti','valore'],1), external: !findPlayer(model,name,team) };
    });
    summary.parsed.autogoal.filter(filter).forEach(row => {
      const beneficiary = String(field(row, ['squadra','team','squadra beneficiaria','a favore di']) || '').trim();
      const player = String(field(row, ['giocatore','marcatore','player']) || '').trim();
      out.ownGoals.push({ beneficiary, player, qty: Math.max(1,pointsFromRow(row,['goal','gol','reti','quantita','qta','valore'],1)) });
    });
  }
  return out;
}

const SUMMARY_CANONICAL_HEADERS = ['Sezione','Giornata','Data','Squadra casa','Gol casa','Squadra trasferta','Gol trasferta','Risultato','Squadra','Giocatore','Goal','PuntiMVP','PuntiPortiere','Partita','Statistica','Valore','Note','Tavolino','Squadra penalizzata'];
const RESULT_CANONICAL_HEADERS = ['Giornata','Data','Squadra casa','Gol casa','Squadra trasferta','Gol trasferta','Risultato','Note','Tavolino','Squadra penalizzata'];
const STANDING_CANONICAL_HEADERS = ['Posizione','Squadra','PG','V','N','P','GF','GS','DR','Punti originali','Penalità','Punti finali','Nota penalità'];
const SCORER_HEADERS = ['Posizione','Giocatore','Squadra','Gol','Partite','Note'];
const MVP_HEADERS = ['Posizione','Giocatore','Squadra','Punti MVP','Note'];
const KEEPER_HEADERS = ['Posizione','Portiere','Squadra','Punti','Note'];

function ensureHeaders(existing, required) {
  const out = [...(existing || [])];
  required.forEach(h => { if (!out.some(x => norm(x) === norm(h))) out.push(h); });
  return out;
}
function setAlias(row, headers, aliases, value, fallbackHeader) {
  let key = headers.find(h => aliases.some(a => norm(h) === norm(a)));
  if (!key) key = headers.find(h => norm(h) === norm(fallbackHeader)) || fallbackHeader;
  row[key] = value ?? '';
}
function objectsToCsv(headers, objects, separator = ';') {
  return csvStringify([headers, ...objects.map(o => headers.map(h => o[h] ?? ''))], separator);
}
function dayMatchesFromDraft(draft) { return (draft.matches || []).filter(m => m.home && m.away); }

export function validateMatchdayDraft(model, draft) {
  const errors = [], warnings = [];
  const day = intOrNull(draft.day);
  if (!day || day < 1) errors.push('Seleziona una giornata valida.');
  const seen = new Set();
  for (const match of dayMatchesFromDraft(draft)) {
    const label = `${match.home} - ${match.away}`;
    const key = `${norm(match.home)}|${norm(match.away)}`;
    if (seen.has(key)) errors.push(`${label}: partita duplicata.`); seen.add(key);
    if (norm(match.home) === norm(match.away)) errors.push(`${label}: casa e trasferta coincidono.`);
    const hg = intOrNull(match.homeGoals), ag = intOrNull(match.awayGoals);
    const played = hg !== null || ag !== null;
    if (played && (hg === null || ag === null || hg < 0 || ag < 0)) errors.push(`${label}: risultato incompleto o non valido.`);
    if (!played) continue;
    const forfeit = !!match.forfeit;
    const details = match.details || { scorers: [], ownGoals: [] };
    for (const scorer of details.scorers || []) {
      if (![match.home,match.away].some(t => norm(t) === norm(scorer.team))) errors.push(`${label}: squadra marcatore non valida.`);
      if (!scorer.player?.trim()) errors.push(`${label}: marcatore senza nome.`);
      if (!Number.isInteger(Number(scorer.qty)) || Number(scorer.qty) < 1) errors.push(`${label}: quantità gol non valida.`);
      if (!scorer.external && !findPlayer(model, scorer.player, scorer.team)) errors.push(`${label}: ${scorer.player} non è nella rosa di ${scorer.team}.`);
    }
    for (const agRow of details.ownGoals || []) {
      if (![match.home,match.away].some(t => norm(t) === norm(agRow.beneficiary))) errors.push(`${label}: squadra beneficiaria autogol non valida.`);
      if (!Number.isInteger(Number(agRow.qty)) || Number(agRow.qty) < 1) errors.push(`${label}: quantità autogol non valida.`);
    }
    if (!forfeit) {
      const scorerGoalsFor = team => (details.scorers || []).filter(x => norm(x.team) === norm(team)).reduce((s,x)=>s+Number(x.qty||0),0);
      const ownGoalsFor = team => (details.ownGoals || []).filter(x => norm(x.beneficiary) === norm(team)).reduce((s,x)=>s+Number(x.qty||0),0);
      const externalFor = team => (details.externalGoals || []).filter(x => norm(x.team) === norm(team)).reduce((s,x)=>s+Number(x.qty||0),0);
      const assignedH = scorerGoalsFor(match.home) + ownGoalsFor(match.home) + externalFor(match.home);
      const assignedA = scorerGoalsFor(match.away) + ownGoalsFor(match.away) + externalFor(match.away);
      if (assignedH !== hg) errors.push(`${label}: ${match.home} ha ${hg} gol nel risultato ma ${assignedH} assegnati.`);
      if (assignedA !== ag) errors.push(`${label}: ${match.away} ha ${ag} gol nel risultato ma ${assignedA} assegnati.`);
      if (!details.mvp?.player) warnings.push(`${label}: MVP non selezionato.`);
      if (!details.keeper?.player) warnings.push(`${label}: miglior portiere non selezionato.`);
    }
    if (forfeit && !match.penalizedTeam) warnings.push(`${label}: partita a tavolino senza squadra penalizzata esplicita.`);
  }
  return { errors, warnings };
}

function resultObjectForMatch(match, headers) {
  const o = {};
  setAlias(o,headers,['giornata','turno','round'],match.day,'Giornata');
  setAlias(o,headers,['data','giorno','date'],match.date || '','Data');
  setAlias(o,headers,['squadra casa','casa','home','squadra 1'],match.home,'Squadra casa');
  setAlias(o,headers,['gol casa','goal casa','reti casa','gc'],match.homeGoals ?? '','Gol casa');
  setAlias(o,headers,['squadra trasferta','trasferta','ospite','away','squadra 2'],match.away,'Squadra trasferta');
  setAlias(o,headers,['gol trasferta','goal trasferta','reti trasferta','gt'],match.awayGoals ?? '','Gol trasferta');
  setAlias(o,headers,['risultato','score'],match.homeGoals !== null && match.awayGoals !== null ? `${match.homeGoals} - ${match.awayGoals}` : '','Risultato');
  setAlias(o,headers,['note','nota','commento','descrizione'],match.notes || '','Note');
  setAlias(o,headers,['tavolino','a tavolino','forfeit'],match.forfeit ? 'SI' : '','Tavolino');
  setAlias(o,headers,['squadra penalizzata','penalizzata','team penalizzato'],match.penalizedTeam || '','Squadra penalizzata');
  return o;
}
function replaceDayRows(existingObjects, fileRel, day, newObjects) {
  return [...existingObjects.filter(r => (dayNumber(field(r,['giornata','turno','round'])) || dayNumber(fileRel)) !== day), ...newObjects];
}
function chooseFile(model, kind, fallback) { return sectionFiles(model,kind)[0] || { rel:fallback, path:`${model.dataRoot}/${fallback}`, text:'', parsed:{headers:[],objects:[],separator:';'} }; }

function buildSummaryRows(draft) {
  const rows = [];
  for (const match of dayMatchesFromDraft(draft)) {
    if (match.homeGoals === null || match.awayGoals === null) continue;
    const base = {
      Sezione:'Partita',Giornata:match.day,Data:match.date || '',
      'Squadra casa':match.home,'Gol casa':match.homeGoals,'Squadra trasferta':match.away,'Gol trasferta':match.awayGoals,
      Risultato:`${match.homeGoals} - ${match.awayGoals}`,Partita:matchLabel(match),Note:match.notes || '',
      Tavolino:match.forfeit?'SI':'','Squadra penalizzata':match.penalizedTeam || ''
    };
    rows.push(base);
    if (match.forfeit) continue;
    const details = match.details || {};
    (details.scorers || []).forEach(s => rows.push({Sezione:'Marcatore',Giornata:match.day,Squadra:s.team,Giocatore:s.player,Goal:Number(s.qty||1),Partita:matchLabel(match)}));
    (details.externalGoals || []).forEach(s => rows.push({Sezione:'Marcatore',Giornata:match.day,Squadra:s.team,Giocatore:s.player || 'Esterno',Goal:Number(s.qty||1),Partita:matchLabel(match),Note:'Giocatore esterno'}));
    if (details.mvp?.player) rows.push({Sezione:'MVP',Giornata:match.day,Squadra:details.mvp.team || '',Giocatore:details.mvp.player,PuntiMVP:Number(details.mvp.points||1),Partita:matchLabel(match),Note:details.mvp.external?'Giocatore esterno':''});
    if (details.keeper?.player) rows.push({Sezione:'Miglior portiere',Giornata:match.day,Squadra:details.keeper.team || '',Giocatore:details.keeper.player,PuntiPortiere:Number(details.keeper.points||1),Partita:matchLabel(match),Note:details.keeper.external?'Giocatore esterno':''});
    (details.ownGoals || []).forEach(a => rows.push({Sezione:'Autogoal',Giornata:match.day,Squadra:a.beneficiary,Giocatore:a.player || '',Goal:Number(a.qty||1),Partita:matchLabel(match)}));
  }
  return rows;
}
function normalizeToHeaders(source, headers) {
  return headers.reduce((o,h)=>{
    const key=Object.keys(source).find(k=>norm(k)===norm(h));
    o[h]=key!==undefined?source[key]:'';
    return o;
  },{});
}
function summaryFileForDay(model, day) {
  const files = sectionFiles(model,'riepilogo');
  const exact = files.find(f => dayNumber(f.rel) === day);
  if (exact) return exact;
  const aggregate = files.find(f => /riepilogo[_-]?giornate/i.test(f.rel) || !dayNumber(f.rel));
  return aggregate || { rel:'riepilogo_giornate.csv', path:`${model.dataRoot}/riepilogo_giornate.csv`, text:'', parsed:{headers:[],objects:[],separator:';'} };
}
function parseSummaryFlatFile(file) {
  const parsed = objectRows(file.text || '');
  if (parsed.headers.some(h=>norm(h)==='sezione')) return parsed;
  if (!String(file.text || '').trim()) return {headers:[],objects:[],separator:';'};
  const buckets=parseRiepilogo(file.text||'');
  const objects=[];
  const append=(label,rows)=>rows.forEach(r=>objects.push({Sezione:label,...r}));
  append('Partita',buckets.partite);append('Marcatore',buckets.marcatori);append('Totale marcatore giornata',buckets.totaliMarcatori);append('MVP',buckets.mvp);append('Miglior portiere',buckets.portieri);append('Autogoal',buckets.autogoal);append('Statistica',buckets.statistiche);
  const sourceHeaders=[...new Set(objects.flatMap(o=>Object.keys(o)))];
  return {headers:sourceHeaders,objects,separator:';'};
}
function makeSummaryChange(model,draft) {
  const file = summaryFileForDay(model,draft.day);
  const parsed = parseSummaryFlatFile(file);
  const headers = ensureHeaders(parsed.headers, SUMMARY_CANONICAL_HEADERS);
  const next = replaceDayRows(parsed.objects,file.rel,draft.day,buildSummaryRows(draft).map(r=>normalizeToHeaders(r,headers)));
  return { path:file.path || `${model.dataRoot}/${file.rel}`, rel:file.rel, content:objectsToCsv(headers,next,parsed.separator || ';') };
}
function makeResultsChange(model,draft) {
  const file = chooseFile(model,'risultati','risultati_partite.csv');
  const parsed = objectRows(file.text || '');
  const headers = ensureHeaders(parsed.headers, RESULT_CANONICAL_HEADERS);
  const newRows = dayMatchesFromDraft(draft).filter(m=>m.homeGoals!==null&&m.awayGoals!==null).map(m=>resultObjectForMatch(m,headers));
  const next = replaceDayRows(parsed.objects,file.rel,draft.day,newRows);
  return { path:file.path || `${model.dataRoot}/${file.rel}`, rel:file.rel, content:objectsToCsv(headers,next,parsed.separator || ';') };
}
function allResultsWithChange(model, resultChange) {
  const all=[];
  for(const f of sectionFiles(model,'risultati')){
    const text=f.rel===resultChange.rel?resultChange.content:f.text;
    objectRows(text).objects.forEach((r,i)=>{ const m=matchFromObject(r,f.rel,i); if(m&&m.homeGoals!==null&&m.awayGoals!==null) all.push(m); });
  }
  if(!sectionFiles(model,'risultati').some(f=>f.rel===resultChange.rel)) objectRows(resultChange.content).objects.forEach((r,i)=>{ const m=matchFromObject(r,resultChange.rel,i); if(m&&m.homeGoals!==null&&m.awayGoals!==null) all.push(m); });
  const uniq=new Map(); all.forEach(m=>uniq.set(`${m.day}|${norm(m.home)}|${norm(m.away)}`,m)); return [...uniq.values()];
}
function existingStandingByTeam(model) {
  const map=new Map(); (model.standings||[]).forEach((r,i)=>{ const team=String(field(r,['squadra','team','nome','club'])||''); if(team) map.set(norm(team),{r,i}); }); return map;
}
function makeStandingsChange(model,resultChange){
  const file=chooseFile(model,'classifica_squadre','classifica_squadre.csv');
  const parsed=objectRows(file.text||''); const headers=ensureHeaders(parsed.headers,STANDING_CANONICAL_HEADERS);
  const existing=existingStandingByTeam(model); const stats=new Map();
  const ensure=team=>{ const k=norm(team); if(!stats.has(k)) stats.set(k,{team,pg:0,v:0,n:0,p:0,gf:0,gs:0,points:0}); return stats.get(k); };
  model.teams.forEach(t=>ensure(t.name));
  allResultsWithChange(model,resultChange).forEach(m=>{ const h=ensure(m.home),a=ensure(m.away); h.pg++;a.pg++;h.gf+=m.homeGoals;h.gs+=m.awayGoals;a.gf+=m.awayGoals;a.gs+=m.homeGoals; if(m.homeGoals>m.awayGoals){h.v++;a.p++;h.points+=3}else if(m.homeGoals<m.awayGoals){a.v++;h.p++;a.points+=3}else{h.n++;a.n++;h.points++;a.points++;} });
  const rows=[...stats.values()].map(s=>{
    const old=existing.get(norm(s.team)); const penalty=old?num(field(old.r,['penalita','penalità'])):0; const note=old?String(field(old.r,['nota penalita','nota penalità','note penalita','note','nota'])||''):'';
    return {...s,penalty,note,previous:old?.i??999,final:s.points-penalty};
  }).sort((a,b)=>b.final-a.final||a.previous-b.previous||a.team.localeCompare(b.team,'it'));
  const tieWarnings=[];
  const byPoints=new Map();
  rows.forEach(s=>{const key=String(s.final);const list=byPoints.get(key)||[];list.push(s.team);byPoints.set(key,list)});
  [...byPoints.entries()].filter(([,teams])=>teams.length>1).forEach(([points,teams])=>{
    tieWarnings.push(`Parità a ${points} punti tra ${teams.join(', ')}: l'Admin conserva l'ordine ufficiale precedente perché il regolamento di spareggio non è definito nel codice sorgente.`);
  });
  const objs=rows.map((s,i)=>{ const o={}; setAlias(o,headers,['posizione','pos','rank'],i+1,'Posizione');setAlias(o,headers,['squadra','team','nome'],s.team,'Squadra');setAlias(o,headers,['pg','partite','giocate'],s.pg,'PG');setAlias(o,headers,['v','vittorie'],s.v,'V');setAlias(o,headers,['n','pareggi'],s.n,'N');setAlias(o,headers,['p','sconfitte'],s.p,'P');setAlias(o,headers,['gf','gol fatti','goal fatti'],s.gf,'GF');setAlias(o,headers,['gs','gol subiti','goal subiti'],s.gs,'GS');setAlias(o,headers,['dr','differenza reti'],s.gf-s.gs,'DR');setAlias(o,headers,['punti originali','puntioriginali'],s.points,'Punti originali');setAlias(o,headers,['penalita','penalità'],s.penalty,'Penalità');setAlias(o,headers,['punti finali','puntifinali','punti'],s.final,'Punti finali');setAlias(o,headers,['nota penalita','nota penalità','note penalita'],s.note,'Nota penalità'); return o; });
  return {path:file.path||`${model.dataRoot}/${file.rel}`,rel:file.rel,content:objectsToCsv(headers,objs,parsed.separator||';'),standingsRows:rows,tieWarnings};
}
function summaryTextsWithChange(model,summaryChange){ const arr=[]; for(const f of sectionFiles(model,'riepilogo')) arr.push({rel:f.rel,text:f.rel===summaryChange.rel?summaryChange.content:f.text}); if(!arr.some(x=>x.rel===summaryChange.rel))arr.push({rel:summaryChange.rel,text:summaryChange.content}); return arr; }
function aggregateAwards(model,summaryChange){
  const scorer=new Map(),mvp=new Map(),keeper=new Map(); const add=(map,name,team,val)=>{const key=`${norm(name)}|${norm(team)}`;const cur=map.get(key)||{name,team,value:0};cur.value+=Number(val||0);map.set(key,cur);};
  summaryTextsWithChange(model,summaryChange).forEach(({rel,text})=>{
    const p=parseRiepilogo(text);
    const marcByDay=new Map(), totalsByDay=new Map();
    const group=(map,row)=>{const d=rowDay(row,rel)||0;const list=map.get(d)||[];list.push(row);map.set(d,list)};
    p.marcatori.forEach(r=>group(marcByDay,r));p.totaliMarcatori.forEach(r=>group(totalsByDay,r));
    const days=new Set([...marcByDay.keys(),...totalsByDay.keys()]);
    days.forEach(day=>{
      const scorerRows=(marcByDay.get(day)||[]).length?(marcByDay.get(day)||[]):(totalsByDay.get(day)||[]);
      scorerRows.forEach(r=>{const n=String(field(r,['giocatore','marcatore','player','statistica'])||'').trim();const note=norm(field(r,['note','nota','commento']));if(n&&norm(n)!=='esterno'&&!note.includes('giocatoreesterno'))add(scorer,n,String(field(r,['squadra','team'])||''),pointsFromRow(r,['goal','gol','reti','quantita','qta','valore'],1));});
    });
    p.mvp.forEach(r=>{const n=String(field(r,['giocatore','mvp','player','statistica'])||'').trim();const note=norm(field(r,['note','nota','commento']));if(n&&norm(n)!=='esterno'&&!note.includes('giocatoreesterno'))add(mvp,n,String(field(r,['squadra','team'])||''),pointsFromRow(r,['punti mvp','puntimvp','punti','valore'],1));});
    p.portieri.forEach(r=>{const n=String(field(r,['giocatore','portiere','player','statistica'])||'').trim();const note=norm(field(r,['note','nota','commento']));if(n&&norm(n)!=='esterno'&&!note.includes('giocatoreesterno'))add(keeper,n,String(field(r,['squadra','team'])||''),pointsFromRow(r,['punti portiere','punti pt','puntipt','punti','valore'],1));});
  });
  return {scorer:[...scorer.values()],mvp:[...mvp.values()],keeper:[...keeper.values()]};
}
function rankMap(standingsRows){return new Map(standingsRows.map((s,i)=>[norm(s.team),i]));}
function makeRankFile(model,kind,fallback,headers,entries,standingsRows){
  const file=chooseFile(model,kind,fallback);const parsed=objectRows(file.text||'');const hs=ensureHeaders(parsed.headers,headers);const ranks=rankMap(standingsRows);const matches=new Map(standingsRows.map(s=>[norm(s.team),Number(s.pg||0)]));
  entries.forEach(e=>{e.matches=matches.get(norm(e.team))||0;e.average=e.matches?e.value/e.matches:0});
  entries.sort((a,b)=>b.value-a.value||(kind==='marcatori'?(b.average-a.average):0)||(ranks.get(norm(a.team))??999)-(ranks.get(norm(b.team))??999)||a.name.localeCompare(b.name,'it'));
  const objs=entries.map((e,i)=>{const o={};setAlias(o,hs,['posizione','pos','rank'],i+1,'Posizione');setAlias(o,hs,kind==='portieri'?['portiere','giocatore','nome']:['giocatore','nome','player'],e.name,kind==='portieri'?'Portiere':'Giocatore');setAlias(o,hs,['squadra','team'],e.team,'Squadra');if(kind==='marcatori'){setAlias(o,hs,['gol','goal','reti'],e.value,'Gol');setAlias(o,hs,['partite','presenze','pg'],e.matches,'Partite')}else if(kind==='mvp')setAlias(o,hs,['punti mvp','puntimvp','punti'],e.value,'Punti MVP');else setAlias(o,hs,['punti portiere','punti pt','punti'],e.value,'Punti'); return o;});
  return {path:file.path||`${model.dataRoot}/${file.rel}`,rel:file.rel,content:objectsToCsv(hs,objs,parsed.separator||';')};
}
export function manifestChange(model, changes){
  const file=sectionFiles(model,'manifest')[0]||{rel:'manifest.csv',path:`${model.dataRoot}/manifest.csv`,text:'file\n'}; const parsed=parseCsv(file.text||'file\n'); let entries=[]; const objs=rowsToObjects(parsed.rows); if(objs.length){ entries=objs.map(o=>field(o,['file','nome','filename'])).filter(Boolean); } else entries=parsed.rows.flat().filter(x=>norm(x)!=='file');
  if(!entries.length&&!model.hasManifest){
    entries=model.fileList.filter(f=>f.rel!=='manifest.csv'&&f.rel!=='config.csv'&&/\.(csv|txt)$/i.test(f.rel)).map(f=>f.rel);
  }
  changes.forEach(c=>{const rel=relativeDataPath(c.path,model.dataRoot);if(!entries.some(x=>norm(x)===norm(rel)))entries.push(rel);});
  const clean=[...new Set(entries.map(x=>String(x).trim()).filter(Boolean))]; return {path:file.path||`${model.dataRoot}/manifest.csv`,rel:'manifest.csv',content:csvStringify([['file'],...clean.map(x=>[x])],';')};
}
function activeSourceErrors(model){
  const errors=[];
  for(const kind of ['risultati','classifica_squadre','marcatori','mvp','portieri']){
    const files=sectionFiles(model,kind);
    if(files.length>1) errors.push(`Più file attivi di tipo ${kind}: ${files.map(f=>f.rel).join(', ')}. Rimuovi l'ambiguità dal manifest prima di pubblicare.`);
  }
  const owners=new Map();
  for(const summary of model.summaries||[]){
    const file=summary.file.rel;
    const rows=Object.values(summary.parsed).flat();
    const days=[...new Set(rows.map(r=>rowDay(r,file)).filter(Boolean))];
    if(!days.length&&dayNumber(file)) days.push(dayNumber(file));
    for(const day of days){const prev=owners.get(day);if(prev&&prev!==file)errors.push(`La giornata ${day} compare in più riepiloghi attivi: ${prev}, ${file}.`);else owners.set(day,file)}
  }
  return [...new Set(errors)];
}
export function buildMatchdayPublication(model,draft){
  const validation=validateMatchdayDraft(model,draft); validation.errors.push(...activeSourceErrors(model)); if(validation.errors.length)return{validation,changes:[]};
  const results=makeResultsChange(model,draft); const summary=makeSummaryChange(model,draft); const standings=makeStandingsChange(model,results); const awards=aggregateAwards(model,summary);
  validation.warnings.push(...(standings.tieWarnings||[]));
  const scorer=makeRankFile(model,'marcatori','classifica_marcatori.csv',SCORER_HEADERS,awards.scorer,standings.standingsRows);
  const mvp=makeRankFile(model,'mvp','classifica_mvp.csv',MVP_HEADERS,awards.mvp,standings.standingsRows);
  const keeper=makeRankFile(model,'portieri','classifica_portieri.csv',KEEPER_HEADERS,awards.keeper,standings.standingsRows);
  const base=[results,summary,standings,scorer,mvp,keeper]; const manifest=manifestChange(model,base); const all=[...base,manifest];
  const current=new Map(model.fileList.map(f=>[f.path,String(f.text||'').replace(/\r\n/g,'\n')])); const changes=all.filter(c=>String(current.get(c.path)||'').replace(/\r\n/g,'\n')!==String(c.content).replace(/\r\n/g,'\n')).map(c=>({path:c.path,content:c.content}));
  return {validation,changes,preview:{standings:standings.standingsRows,awards}};
}

export function rosterCsv(team, players, existingFile=null){
  const parsed=existingFile?objectRows(existingFile.text||''):{headers:[],objects:[],separator:';'};const headers=ensureHeaders(parsed.headers,['Nome','Cognome','Ruolo','Numero','Capitano']);
  const objs=players.map(p=>{const o={};setAlias(o,headers,['nome'],p.nome||'','Nome');setAlias(o,headers,['cognome'],p.cognome||'','Cognome');setAlias(o,headers,['ruolo','role'],p.role||'','Ruolo');setAlias(o,headers,['numero','n'],p.number||'','Numero');setAlias(o,headers,['capitano','captain'],p.captain?'SI':'','Capitano');return o;});
  return objectsToCsv(headers,objs,parsed.separator||';');
}
export function safeTeamFilename(team){const slug=String(team||'').trim().replace(/[^A-Za-z0-9À-ÿ_-]+/g,'_').replace(/^_+|_+$/g,'');return `squadra_${slug||'NuovaSquadra'}.csv`;}

export function parsePagellone(text){
  const entries=[];
  let team='', current=null;
  const push=()=>{if(current&&(current.player||current.text||current.comparison||current.vote)){entries.push(current)}current=null};
  for(const rawLine of String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/)){
    const line=String(rawLine||'').trim();
    if(!line)continue;
    const i=line.indexOf(':');
    if(i<0)continue;
    const key=norm(line.slice(0,i));
    const value=line.slice(i+1).trim();
    if(key==='squadra'){push();team=value;continue}
    if(key==='giocatore'){push();current={team,player:value,text:'',comparison:'',vote:''};continue}
    if(!current)continue;
    if(key==='testo')current.text=value;
    else if(key==='paragone')current.comparison=value;
    else if(key==='voto')current.vote=value;
  }
  push();
  return entries;
}
export function pagelloneText(entries){
  const clean=(entries||[]).map(x=>({
    team:String(x.team||'').trim(),player:String(x.player||'').trim(),text:String(x.text||'').trim(),comparison:String(x.comparison||'').trim(),vote:String(x.vote||'').trim()
  })).filter(x=>x.team&&x.player);
  const groups=[];
  clean.forEach(entry=>{let g=groups.find(x=>norm(x.team)===norm(entry.team));if(!g){g={team:entry.team,entries:[]};groups.push(g)}g.entries.push(entry)});
  const lines=[];
  groups.forEach((g,gi)=>{
    if(gi)lines.push('');
    lines.push(`SQUADRA: ${g.team}`,'');
    g.entries.forEach((e,ei)=>{
      if(ei)lines.push('');
      lines.push(`GIOCATORE: ${e.player}`);
      if(e.text)lines.push(`TESTO: ${e.text}`);
      if(e.comparison)lines.push(`PARAGONE: ${e.comparison}`);
      if(e.vote)lines.push(`VOTO: ${e.vote}`);
    });
  });
  return lines.join('\n').trimEnd()+'\n';
}
export function validatePagelloneEntries(model,entries){
  const errors=[],warnings=[];
  (entries||[]).forEach((e,i)=>{
    const n=i+1;
    if(!String(e.team||'').trim())errors.push(`Pagella ${n}: squadra mancante.`);
    if(!String(e.player||'').trim())errors.push(`Pagella ${n}: giocatore mancante.`);
    if(e.team&&e.player&&!findPlayer(model,e.player,e.team))warnings.push(`Pagella ${n}: ${e.player} non coincide esattamente con un giocatore della rosa di ${e.team}.`);
    const vote=String(e.vote||'').trim();
    if(vote&&!/^\d+(?:[.,]\d+)?[+-]?$/.test(vote))errors.push(`Pagella ${n}: voto “${vote}” non riconosciuto.`);
  });
  return {errors,warnings};
}
