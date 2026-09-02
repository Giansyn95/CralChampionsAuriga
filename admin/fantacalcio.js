// Logica Fantacalcio per l'Admin: caricamento listone, caricamento rose (con
// validazione contro il listone) ed eventi speciali (rigori parati/sbagliati,
// autogol). Nessuna dipendenza dal DOM: solo parsing/validazione/generazione
// testo, così può essere testata e riusata da admin.js.
import { csvStringify, field, norm, num, parseCsv, rowsToObjects } from './core.js';

// ---------------- normalizzazione ID giocatore ----------------
// Allineata a fantaIdVariants() del frontend pubblico: un id "1" e un id "001"
// devono combaciare, così come una qualunque forma con zeri iniziali diversi.
export function idVariants(value) {
  const out = new Set();
  const raw = String(value ?? '').trim();
  if (raw) out.add(raw);
  const digits = raw.replace(/\D/g, '');
  if (digits) {
    const stripped = String(Number.parseInt(digits, 10));
    if (stripped && stripped !== 'NaN') { out.add(stripped); out.add(stripped.padStart(3, '0')); }
  }
  return [...out].filter(Boolean);
}
export function idKey(value) {
  const digits = String(value ?? '').trim().replace(/\D/g, '');
  if (!digits) return norm(value);
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? String(n) : norm(value);
}

// ---------------- LISTONE ----------------
export const LISTONE_HEADERS = ['id', 'ruolo', 'giocatore', 'squadra', 'crediti', 'baseCreditiSuggeriti'];

export function parseListoneCsv(text) {
  const { separator, rows } = parseCsv(text || '');
  const objects = rowsToObjects(rows);
  const players = objects.map((o, i) => ({
    id: String(field(o, ['id']) || '').trim(),
    ruolo: String(field(o, ['ruolo', 'role']) || '').trim(),
    giocatore: String(field(o, ['giocatore', 'nome', 'player']) || '').trim(),
    squadra: String(field(o, ['squadra', 'team']) || '').trim(),
    crediti: String(field(o, ['crediti', 'credit']) || '').trim(),
    baseCreditiSuggeriti: String(field(o, ['baseCreditiSuggeriti', 'crediti suggeriti', 'base crediti']) || '').trim(),
    row: i + 2 // riga file (1 = header)
  }));
  return { separator: separator || ';', players };
}
export function validateListoneRows(players) {
  const errors = [];
  if (!players.length) { errors.push('Il listone è vuoto: nessuna riga trovata.'); return errors; }
  const seen = new Map();
  players.forEach(p => {
    if (!p.id) errors.push(`Riga ${p.row}: id giocatore mancante.`);
    if (!p.giocatore) errors.push(`Riga ${p.row}: nome giocatore mancante.`);
    if (p.id) {
      const k = idKey(p.id);
      if (seen.has(k)) errors.push(`Id "${p.id}" duplicato (righe ${seen.get(k)} e ${p.row}).`);
      else seen.set(k, p.row);
    }
  });
  return errors;
}
export function listoneCsvContent(players, separator = ';') {
  const rows = [LISTONE_HEADERS, ...players.map(p => [p.id, p.ruolo, p.giocatore, p.squadra, p.crediti, p.baseCreditiSuggeriti])];
  return csvStringify(rows, separator);
}
export function listoneIndex(players) {
  const map = new Map();
  players.forEach(p => { idVariants(p.id).forEach(v => map.set(norm(v), p)); });
  return map;
}

// ---------------- ROSE (rosa_<partecipante>_giornataN.csv) ----------------
export function slugParticipant(name) {
  return String(name || '').trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'partecipante';
}
export function rosterFileName(participant, giornata) {
  return `rosa_${slugParticipant(participant)}_giornata${giornata}.csv`;
}
export function rosterRelPath(participant, giornata) {
  return `fantacalcio/giornata${giornata}/${rosterFileName(participant, giornata)}`;
}
// Un CSV rosa caricato dall'utente può contenere UNA sola rosa (tutte le righe
// stesso partecipante) oppure PIÙ rose insieme (una per partecipante): in
// entrambi i casi lo suddividiamo per partecipante.
export function parseRosterUpload(text, fallbackGiornata) {
  const { rows } = parseCsv(text || '');
  const objects = rowsToObjects(rows);
  const errors = [];
  if (!objects.length) { errors.push('Il file non contiene righe di rosa.'); return { rosters: [], errors }; }
  const byParticipant = new Map();
  objects.forEach((o, i) => {
    const line = i + 2;
    const giornataRaw = field(o, ['giornata', 'turno', 'round']);
    const giornata = giornataRaw !== '' ? Number.parseInt(String(giornataRaw), 10) : fallbackGiornata;
    const partecipante = String(field(o, ['partecipante', 'utente', 'nome partecipante', 'giocatore fantacalcio']) || '').trim();
    const idGiocatore = String(field(o, ['idGiocatore', 'id giocatore', 'id']) || '').trim();
    if (!partecipante) { errors.push(`Riga ${line}: partecipante mancante.`); return; }
    if (!Number.isFinite(giornata) || giornata <= 0) { errors.push(`Riga ${line}: giornata mancante o non valida.`); return; }
    if (!idGiocatore) { errors.push(`Riga ${line}: idGiocatore mancante.`); return; }
    const key = `${giornata}|${norm(partecipante)}`;
    if (!byParticipant.has(key)) byParticipant.set(key, { giornata, partecipante, ids: [], lines: [] });
    const entry = byParticipant.get(key);
    entry.ids.push(idGiocatore);
    entry.lines.push(line);
  });
  return { rosters: [...byParticipant.values()], errors };
}
export function validateRosterAgainstListone(roster, listoneMap) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  roster.ids.forEach((id, i) => {
    const line = roster.lines[i];
    if (!listoneMap.has(norm(id))) { errors.push(`${roster.partecipante} (giornata ${roster.giornata}), riga ${line}: id giocatore "${id}" non presente nel listone.`); return; }
    const k = idKey(id);
    if (seen.has(k)) warnings.push(`${roster.partecipante} (giornata ${roster.giornata}): id "${id}" ripetuto nella stessa rosa.`);
    seen.add(k);
  });
  if (!roster.ids.length) errors.push(`${roster.partecipante} (giornata ${roster.giornata}): rosa vuota.`);
  return { errors, warnings };
}
export function rosterCsvContent(roster, separator = ';') {
  const rows = [['giornata', 'partecipante', 'idGiocatore'], ...roster.ids.map(id => [String(roster.giornata), roster.partecipante, id])];
  return csvStringify(rows, separator);
}

// ---------------- EVENTI SPECIALI (eventi_fantacalcio.csv) ----------------
// Tipi ufficialmente riconosciuti dal motore punteggi del frontend pubblico
// (vedi tornei/*/index.html, blocco "FANTACALCIO STATICO").
export const EVENT_TYPES = [
  { value: 'RIGORE_PARATO', label: 'Rigore parato' },
  { value: 'RIGORE_SBAGLIATO', label: 'Rigore sbagliato' },
  { value: 'AUTOGOAL', label: 'Autogol' }
];
export function parseEventiCsv(text) {
  const { separator, rows } = parseCsv(text || '');
  const objects = rowsToObjects(rows);
  const events = objects.map((o, i) => ({
    giornata: String(field(o, ['giornata', 'turno', 'round']) || '').trim(),
    idGiocatore: String(field(o, ['idGiocatore', 'id giocatore', 'id']) || '').trim(),
    tipoEvento: String(field(o, ['tipoEvento', 'evento', 'tipo']) || '').trim(),
    quantita: String(field(o, ['quantita', 'qta', 'valore', 'qty']) || '1').trim(),
    row: i + 2
  })).filter(e => e.giornata || e.idGiocatore || e.tipoEvento);
  return { separator: separator || ';', events };
}
export function eventiCsvContent(events, separator = ';') {
  const rows = [['giornata', 'idGiocatore', 'tipoEvento', 'quantita'], ...events.map(e => [String(e.giornata), String(e.idGiocatore), String(e.tipoEvento), String(e.quantita || 1)])];
  return csvStringify(rows, separator);
}
export function validateNewEvent(event, listoneMap) {
  const errors = [];
  if (!event.giornata || !(Number(event.giornata) > 0)) errors.push('Giornata non valida.');
  if (!event.idGiocatore) errors.push('Seleziona un giocatore dal listone.');
  else if (!listoneMap.has(norm(event.idGiocatore))) errors.push(`Id giocatore "${event.idGiocatore}" non presente nel listone.`);
  if (!EVENT_TYPES.some(t => t.value === event.tipoEvento)) errors.push('Tipo evento non valido.');
  const q = num(event.quantita);
  if (!(q > 0)) errors.push('Quantità non valida: deve essere maggiore di zero.');
  return errors;
}

// ---------------- manifest fantacalcio ----------------
// manifest_fantacalcio.csv (dedicato, "fanta_manifest") elenca almeno un seed
// per il frontend: listone, eventi e UNA rosa per partecipante (usata come
// template per derivare tutte le altre giornate). Vedi discoverFantaFiles()
// nel frontend pubblico: non serve elencare ogni giornata, ma è più chiaro e
// robusto farlo comunque per chi ispeziona il repository.
export function parseManifestFantaLines(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(x => x.trim()).filter(Boolean).filter(x => norm(x) !== 'file');
}
export function manifestFantaContent(existingText, addPaths) {
  const current = parseManifestFantaLines(existingText);
  const seen = new Set(current.map(x => x.replace(/^fantacalcio\//i, '').toLowerCase()));
  const merged = [...current];
  (addPaths || []).forEach(p => {
    const rel = String(p || '').replace(/^fantacalcio\//i, '');
    const key = rel.toLowerCase();
    if (!seen.has(key)) { merged.push(`fantacalcio/${rel}`); seen.add(key); }
  });
  return csvStringify([['file'], ...merged.map(x => [x])], ';');
}
