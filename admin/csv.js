export function countUnquoted(line, separator) {
  let q = false, count = 0;
  const text = String(line || '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { i++; continue; }
    if (c === '"') { q = !q; continue; }
    if (c === separator && !q) count++;
  }
  return count;
}

export function separatorFor(text) {
  const line = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim()) || '';
  return countUnquoted(line, ';') >= countUnquoted(line, ',') ? ';' : ',';
}

export function parseCsvDetailed(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return { rows: [], rawRows: [], separator: ';', unclosedQuote: false };
  const sep = separatorFor(text);
  const rawRows = [];
  let row = [], val = '', q = false, line = 1, rowStartLine = 1;
  const push = () => {
    row.push(val.trim());
    rawRows.push({ cells: row, line: rowStartLine, blank: row.every(x => !String(x).trim()) });
    row = []; val = ''; rowStartLine = line + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { val += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === sep && !q) { row.push(val.trim()); val = ''; }
    else if ((c === '\n' || c === '\r') && !q) {
      push();
      if (c === '\r' && n === '\n') i++;
      line++;
    } else {
      val += c;
      if (c === '\n' || (c === '\r' && n !== '\n')) line++;
    }
  }
  if (val !== '' || row.length) push();
  const filtered = rawRows.filter(r => !r.blank).map(r => r.cells.slice());
  const maxCols = Math.max(0, ...filtered.map(r => r.length));
  const rows = filtered.map(r => { while (r.length < maxCols) r.push(''); return r; });
  return { rows, rawRows, separator: sep, unclosedQuote: q };
}

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function validateCsvText(text) {
  const errors = [];
  const d = parseCsvDetailed(text);
  if (!String(text || '').trim()) return ['CSV vuoto.'];
  if (d.unclosedQuote) errors.push('Virgolette CSV non bilanciate.');
  const rows = d.rawRows.filter(r => !r.blank);
  if (!rows.length) return ['CSV senza righe.'];
  const width = rows[0].cells.length;
  const headers = rows[0].cells.map(x => String(x || '').trim());
  if (headers.some(x => !x)) errors.push('Una o più intestazioni sono vuote.');
  const normalized = headers.map(norm).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) errors.push('Intestazioni duplicate.');
  rows.slice(1).forEach(r => {
    if (r.cells.length !== width) errors.push(`Riga ${r.line}: ${r.cells.length} colonne, attese ${width}.`);
  });
  return [...new Set(errors)];
}

export function parseManifest(text) {
  const d = parseCsvDetailed(text);
  if (!d.rows.length) return [];
  const headers = d.rows[0].map(norm);
  const idx = ['file', 'nome', 'filename'].map(x => headers.indexOf(x)).find(i => i >= 0);
  const values = idx >= 0 ? d.rows.slice(1).map(r => r[idx]) : d.rows.flat();
  return [...new Set(values.map(x => String(x || '').trim().replace(/^data\//i, '')).filter(x => x && norm(x) !== 'file'))];
}
