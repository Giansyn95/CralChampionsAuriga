const DATA_FILES = Object.freeze({
  'manifest.csv': [
    ['file'],
    ['classifica_squadre.csv'],
    ['classifica_marcatori.csv'],
    ['classifica_mvp.csv'],
    ['classifica_portieri.csv'],
    ['risultati_partite.csv'],
    ['calendario.csv'],
    ['riepilogo_giornate.csv']
  ],
  'classifica_squadre.csv': [['Posizione','Squadra','PG','V','N','P','GF','GS','DR','Punti originali','Penalita','Punti finali','Nota penalita']],
  'classifica_marcatori.csv': [['Posizione','Giocatore','Squadra','Gol','Partite','Note']],
  'classifica_mvp.csv': [['Posizione','Giocatore','Squadra','Punti MVP','Note']],
  'classifica_portieri.csv': [['Posizione','Portiere','Squadra','Punti','Note']],
  'risultati_partite.csv': [['Giornata','Data','Squadra casa','Gol casa','Squadra trasferta','Gol trasferta','Risultato','Note','Tavolino','Squadra penalizzata']],
  'calendario.csv': [['Giornata','Data','Squadra casa','Squadra trasferta','Note']],
  'riepilogo_giornate.csv': [['Sezione','Giornata','Data','Squadra casa','Gol casa','Squadra trasferta','Gol trasferta','Risultato','Squadra','Giocatore','Goal','PuntiMVP','PuntiPortiere','Partita','Statistica','Valore','Note','Tavolino','Squadra penalizzata']]
});

function csvEscape(value) {
  const s = String(value ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows) {
  return rows.map(row => row.map(csvEscape).join(';')).join('\n') + '\n';
}
export function cleanText(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
export function validateTournamentInput(input = {}) {
  const errors = [];
  const id = cleanText(input.id, 80).toLowerCase();
  const year = cleanText(input.year, 4);
  const season = cleanText(input.season, 60);
  const name = cleanText(input.name || input.season, 80);
  const title = cleanText(input.title, 180);
  const description = cleanText(input.description, 320);
  if (!/^[a-z0-9][a-z0-9._-]{1,78}[a-z0-9]$/.test(id)) errors.push('ID torneo non valido: usa solo lettere minuscole, numeri, punto, trattino o underscore.');
  if (!/^20\d{2}$/.test(year)) errors.push('Anno non valido.');
  if (!season) errors.push('Stagione/nome edizione obbligatorio.');
  if (!title) errors.push('Titolo torneo obbligatorio.');
  if (!description) errors.push('Descrizione torneo obbligatoria.');
  return { errors, value: { id, year, season, name, title, description, makeCurrent: input.makeCurrent !== false } };
}
export function tournamentDataChanges(tournamentPath, input) {
  const { value, errors } = validateTournamentInput(input);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { statusCode: 400 });
  const dataRoot = `${tournamentPath}/data`;
  const config = csv([
    ['chiave','valore'],
    ['titolo', value.title],
    ['sottotitolo', value.description]
  ]);
  const changes = [{ path: `${dataRoot}/config.csv`, content: config }];
  for (const [name, rows] of Object.entries(DATA_FILES)) changes.push({ path: `${dataRoot}/${name}`, content: csv(rows) });
  return changes;
}
export function parseTournamentRegistry(text) {
  if (!String(text || '').trim()) return { titolo: 'CRAL Champions Auriga', sottotitolo: 'Tutte le edizioni del torneo aziendale CRAL Champions Auriga.', archivio: { primoPiano: 1 }, tornei: [] };
  let data;
  try { data = JSON.parse(text); }
  catch { throw Object.assign(new Error('tornei.json esistente non e un JSON valido.'), { statusCode: 409 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('tornei.json non ha una struttura valida.'), { statusCode: 409 });
  if (!Array.isArray(data.tornei)) data.tornei = [];
  return data;
}
function nextOrder(registry, year) {
  const sameYear = registry.tornei.filter(t => String(t.anno || '') === String(year)).map(t => Number(t.ordine || 0)).filter(Number.isFinite);
  const base = Number(year) * 10;
  const max = sameYear.length ? Math.max(...sameYear) : base;
  return max >= base && max < base + 9 ? max + 1 : Number(`${year}${Math.min(9, sameYear.length + 1)}`);
}
export function updateTournamentRegistry(text, input, tournamentPath, hasLogo = false) {
  const { value, errors } = validateTournamentInput(input);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { statusCode: 400 });
  const registry = parseTournamentRegistry(text);
  if (registry.tornei.some(t => String(t.id || '').toLowerCase() === value.id || String(t.cartella || '').replace(/^\/+|\/+$/g, '') === tournamentPath)) {
    throw Object.assign(new Error('Il torneo e gia presente in tornei.json.'), { statusCode: 409 });
  }
  if (value.makeCurrent) registry.tornei.forEach(t => { t.corrente = false; });
  const shortSlug = value.id.replace(new RegExp(`^${value.year}[-_]`), '') || value.id;
  registry.tornei.push({
    id: value.id,
    anno: value.year,
    stagione: value.season,
    slug: shortSlug,
    nome: value.name,
    cartella: tournamentPath,
    titolo: value.title,
    descrizione: value.description,
    url: `${tournamentPath}/`,
    stato: 'in-corso',
    corrente: !!value.makeCurrent,
    ordine: nextOrder(registry, value.year),
    attivo: true
  });
  registry.tornei.sort((a,b) => Number(b.ordine || 0) - Number(a.ordine || 0) || String(b.id || '').localeCompare(String(a.id || '')));
  if (value.makeCurrent && hasLogo) registry.logo = `${tournamentPath}/immagini/logo_cral.png`;
  return JSON.stringify(registry, null, 2) + '\n';
}

function htmlAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function htmlText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function customizeTournamentIndex(text, input = {}) {
  const checked = validateTournamentInput(input);
  if (checked.errors.length) throw Object.assign(new Error(checked.errors.join(' ')), { statusCode: 400 });
  const value = checked.value;
  const publicUrl = cleanText(input.publicUrl, 500).replace(/\/$/, '');
  let out = String(text || '');
  if (!out.trim()) throw Object.assign(new Error('index.html template vuoto.'), { statusCode: 409 });
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${htmlText(value.title)}</title>`);
  out = out.replace(/<meta\s+property=["']og:title["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta property="og:title" content="${htmlAttr(value.title)}" />`);
  out = out.replace(/<meta\s+property=["']og:description["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta property="og:description" content="${htmlAttr(value.description)}" />`);
  if (publicUrl) {
    out = out.replace(/<meta\s+property=["']og:url["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta property="og:url" content="${htmlAttr(publicUrl + '/')}" />`);
    out = out.replace(/<meta\s+property=["']og:image["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta property="og:image" content="${htmlAttr(publicUrl + '/immagini/logo_cral.png')}" />`);
  }
  out = out.replace(/const\s+DEFAULT_TITLE\s*=\s*[^;]+;/, `const DEFAULT_TITLE = ${JSON.stringify(value.title)};`);
  out = out.replace(/const\s+DEFAULT_SUBTITLE\s*=\s*[^;]+;/, `const DEFAULT_SUBTITLE = ${JSON.stringify(value.description)};`);
  return out;
}
