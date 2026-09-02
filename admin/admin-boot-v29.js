/*
 * CRAL Champions Admin - bootstrap logica v29
 *
 * Mantiene i moduli originali come sorgente unica e applica, al caricamento,
 * patch mirate a core.js / gh.js / admin.js. In questo modo il deploy resta
 * piccolo e non duplica centinaia di righe di codice applicativo.
 */

const BASE = new URL('./', import.meta.url);
const VERSION = '29';

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch v29 non applicabile (${label}). Ricarica i file Admin dalla versione attesa.`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`Patch v29 non applicabile (${label}). Ricarica i file Admin dalla versione attesa.`);
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

async function loadSource(name) {
  const url = new URL(name, BASE);
  url.searchParams.set('v29src', VERSION);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Impossibile caricare ${name}: HTTP ${response.status}`);
  return response.text();
}

function patchCore(source) {
  let s = source;

  // 0) Manifest headerless + calendario a blocchi.
  // Il repository reale usa manifest.csv senza intestazione. objectRows() interpretava
  // la prima riga come header e produceva manifestEntries=[], disattivando TUTTI i file
  // non-boot (calendario, riepiloghi, risultati, rose). Usiamo quindi parseCsv() come fa gh.js.
  s = replaceOnce(
    s,
    "  const manifestFile = fileList.find(f => fileKind(f.rel) === 'manifest');\n  const manifestParsed = manifestFile ? objectRows(manifestFile.text || '') : { rows: [], objects: [] };\n  let manifestEntries = [];\n  if (manifestParsed.objects?.length) manifestEntries = manifestParsed.objects.map(o => field(o, ['file','nome','filename'])).filter(Boolean);\n  else manifestEntries = (manifestParsed.rows || []).flat().filter(x => norm(x) !== 'file');",
    `  const manifestFile = fileList.find(f => fileKind(f.rel) === 'manifest');
  const manifestParsed = manifestFile ? parseCsv(manifestFile.text || '') : { rows: [] };
  const manifestHeaders = (manifestParsed.rows?.[0] || []).map(norm);
  const manifestIdx = ['file','nome','filename'].map(x => manifestHeaders.indexOf(x)).find(i => i >= 0);
  let manifestEntries = manifestIdx >= 0
    ? (manifestParsed.rows || []).slice(1).map(r => r[manifestIdx])
    : (manifestParsed.rows || []).flat();
  manifestEntries = manifestEntries.filter(x => norm(x) !== 'file');`,
    'manifest headerless buildModel'
  );

  // Nel calendario reale la nota "Riposa: X" appartiene alla partita della stessa riga:
  // non deve far scartare la partita. Si scarta solo se Casa/Trasferta è davvero "Riposa".
  s = replaceOnce(
    s,
    "    if (!home || !away || /riposa/i.test(`${home} ${away} ${notes}`)) continue;",
    "    if (!home || !away || /^riposa\\b/i.test(home) || /^riposa\\b/i.test(away)) continue;",
    'calendario note riposa'
  );

  // Anche manifestChange() usava rowsToObjects() su un manifest senza header e poteva
  // riscrivere il manifest perdendo le righe esistenti. Manteniamo tutte le entry reali.
  s = replaceOnce(
    s,
    "  const file=sectionFiles(model,'manifest')[0]||{rel:'manifest.csv',path:`${model.dataRoot}/manifest.csv`,text:'file\\n'}; const parsed=parseCsv(file.text||'file\\n'); let entries=[]; const objs=rowsToObjects(parsed.rows); if(objs.length){ entries=objs.map(o=>field(o,['file','nome','filename'])).filter(Boolean); } else entries=parsed.rows.flat().filter(x=>norm(x)!=='file');",
    `  const file=sectionFiles(model,'manifest')[0]||{rel:'manifest.csv',path:\`${'${model.dataRoot}'}/manifest.csv\`,text:'file\\n'};
  const parsed=parseCsv(file.text||'file\\n');
  const manifestHeaders=(parsed.rows?.[0]||[]).map(norm);
  const manifestIdx=['file','nome','filename'].map(x=>manifestHeaders.indexOf(x)).find(i=>i>=0);
  let entries=manifestIdx>=0 ? (parsed.rows||[]).slice(1).map(r=>r[manifestIdx]) : (parsed.rows||[]).flat();
  entries=entries.filter(x=>x&&norm(x)!=='file');`,
    'manifest headerless publication'
  );

  // 1) Pagellone: SV = senza voto, valido e non genera alert.
  s = replaceOnce(
    s,
    "if(vote&&!/^\\d+(?:[.,]\\d+)?[+-]?$/.test(vote))errors.push(`Pagella ${n}: voto “${vote}” non riconosciuto.`);",
    "if(vote&&!/^(?:sv|\\d+(?:[.,]\\d+)?[+-]?)$/i.test(vote))errors.push(`Pagella ${n}: voto “${vote}” non riconosciuto.`);",
    'pagellone SV'
  );

  // 2) Tavolino: replica nell'Admin l'inferenza gia usata dal frontend pubblico
  //    (nota classifica + numero giornata + squadra).
  s = replaceOnce(
    s,
    "  model.matches = mergeMatches(model.calendarMatches, mergeMatches(model.resultMatches, model.summaryMatches));\n  model.days = [...new Set(model.matches.map(m => m.day).filter(Boolean))].sort((a,b)=>a-b);",
    `  model.matches = mergeMatches(model.calendarMatches, mergeMatches(model.resultMatches, model.summaryMatches));
  const standingForfeits = (model.standings || []).flatMap(row => {
    const note = String(field(row, ['nota penalita','nota penalità','note penalita','note penalità','nota','note','commento','descrizione']) || '').trim();
    const team = String(field(row, ['squadra','team','nome','club']) || '').trim();
    const day = dayNumber(note);
    const marker = norm(note);
    return team && day && (marker.includes('tavolino') || marker.includes('forfeit') || marker.includes('rinuncia')) ? [{ team, day, note }] : [];
  });
  model.matches.forEach(match => {
    if (match.forfeit) return;
    const hit = standingForfeits.find(x => x.day === Number(match.day) && [match.home, match.away].some(team => norm(team) === norm(x.team)));
    if (hit) {
      match.forfeit = true;
      if (!match.penalizedTeam) match.penalizedTeam = hit.team;
    }
  });
  model.days = [...new Set(model.matches.map(m => m.day).filter(Boolean))].sort((a,b)=>a-b);`,
    'inferenza tavolino da classifica'
  );

  // 3) "Goal" come spelling canonico per i nuovi file, mantenendo equivalenti
  //    le vecchie intestazioni "Gol" gia presenti nei CSV.
  s = replaceOnce(
    s,
    "const SUMMARY_CANONICAL_HEADERS = ['Sezione','Giornata','Data','Squadra casa','Gol casa','Squadra trasferta','Gol trasferta','Risultato','Squadra','Giocatore','Goal','PuntiMVP','PuntiPortiere','Partita','Statistica','Valore','Note','Tavolino','Squadra penalizzata'];\nconst RESULT_CANONICAL_HEADERS = ['Giornata','Data','Squadra casa','Gol casa','Squadra trasferta','Gol trasferta','Risultato','Note','Tavolino','Squadra penalizzata'];\nconst STANDING_CANONICAL_HEADERS = ['Posizione','Squadra','PG','V','N','P','GF','GS','DR','Punti originali','Penalità','Punti finali','Nota penalità'];\nconst SCORER_HEADERS = ['Posizione','Giocatore','Squadra','Gol','Partite','Note'];",
    "const SUMMARY_CANONICAL_HEADERS = ['Sezione','Giornata','Data','Squadra casa','Goal casa','Squadra trasferta','Goal trasferta','Risultato','Squadra','Giocatore','Goal','PuntiMVP','PuntiPortiere','Partita','Statistica','Valore','Note','Tavolino','Squadra penalizzata'];\nconst RESULT_CANONICAL_HEADERS = ['Giornata','Data','Squadra casa','Goal casa','Squadra trasferta','Goal trasferta','Risultato','Note','Tavolino','Squadra penalizzata'];\nconst STANDING_CANONICAL_HEADERS = ['Posizione','Squadra','PG','V','N','P','GF','GS','DR','Punti originali','Penalità','Punti finali','Nota penalità'];\nconst SCORER_HEADERS = ['Posizione','Giocatore','Squadra','Goal','Partite','Note'];",
    'intestazioni Goal'
  );
  s = replaceOnce(
    s,
    "function ensureHeaders(existing, required) {\n  const out = [...(existing || [])];\n  required.forEach(h => { if (!out.some(x => norm(x) === norm(h))) out.push(h); });\n  return out;\n}\nfunction setAlias(row, headers, aliases, value, fallbackHeader) {\n  let key = headers.find(h => aliases.some(a => norm(h) === norm(a)));\n  if (!key) key = headers.find(h => norm(h) === norm(fallbackHeader)) || fallbackHeader;",
    `function headerNorm(value) {
  const n = norm(value);
  if (n === 'gol') return 'goal';
  if (n === 'golcasa') return 'goalcasa';
  if (n === 'goltrasferta') return 'goaltrasferta';
  return n;
}
function ensureHeaders(existing, required) {
  const out = [...(existing || [])];
  required.forEach(h => { if (!out.some(x => headerNorm(x) === headerNorm(h))) out.push(h); });
  return out;
}
function setAlias(row, headers, aliases, value, fallbackHeader) {
  let key = headers.find(h => aliases.some(a => headerNorm(h) === headerNorm(a)));
  if (!key) key = headers.find(h => headerNorm(h) === headerNorm(fallbackHeader)) || fallbackHeader;`,
    'compatibilita Gol/Goal'
  );
  s = replaceOnce(
    s,
    "    const key=Object.keys(source).find(k=>norm(k)===norm(h));",
    "    const key=Object.keys(source).find(k=>headerNorm(k)===headerNorm(h));",
    'normalizzazione intestazioni Goal'
  );
  s = s.replace("match.homeGoals ?? '','Gol casa'", "match.homeGoals ?? '','Goal casa'");
  s = s.replace("match.awayGoals ?? '','Gol trasferta'", "match.awayGoals ?? '','Goal trasferta'");
  s = replaceOnce(
    s,
    "      'Squadra casa':match.home,'Gol casa':match.homeGoals,'Squadra trasferta':match.away,'Gol trasferta':match.awayGoals,",
    "      'Squadra casa':match.home,'Goal casa':match.homeGoals,'Squadra trasferta':match.away,'Goal trasferta':match.awayGoals,",
    'riepilogo Goal'
  );
  s = replaceOnce(
    s,
    "setAlias(o,hs,['gol','goal','reti'],e.value,'Gol')",
    "setAlias(o,hs,['gol','goal','reti'],e.value,'Goal')",
    'classifica marcatori Goal'
  );

  // 4) Giornata: i goal non assegnati sono un caso legittimo -> esterni impliciti.
  //    Blocchiamo solo sovra-assegnazioni o riferimenti realmente incoerenti.
  s = replaceOnce(
    s,
    "      if (!Number.isInteger(Number(scorer.qty)) || Number(scorer.qty) < 1) errors.push(`${label}: quantità gol non valida.`);",
    "      if (!Number.isInteger(Number(scorer.qty)) || Number(scorer.qty) < 1) errors.push(`${label}: quantità goal non valida.`);",
    'messaggio quantita goal'
  );
  s = replaceOnce(
    s,
    "    for (const agRow of details.ownGoals || []) {\n      if (![match.home,match.away].some(t => norm(t) === norm(agRow.beneficiary))) errors.push(`${label}: squadra beneficiaria autogol non valida.`);\n      if (!Number.isInteger(Number(agRow.qty)) || Number(agRow.qty) < 1) errors.push(`${label}: quantità autogol non valida.`);\n    }",
    `    for (const extRow of details.externalGoals || []) {
      if (![match.home,match.away].some(t => norm(t) === norm(extRow.team))) errors.push(\`${'${label}'}: squadra per goal esterno non valida.\`);
      if (!Number.isInteger(Number(extRow.qty)) || Number(extRow.qty) < 1) errors.push(\`${'${label}'}: quantità goal esterno non valida.\`);
    }
    for (const agRow of details.ownGoals || []) {
      if (![match.home,match.away].some(t => norm(t) === norm(agRow.beneficiary))) errors.push(\`${'${label}'}: squadra collegata all’autogoal non valida.\`);
      if (!Number.isInteger(Number(agRow.qty)) || Number(agRow.qty) < 1) errors.push(\`${'${label}'}: quantità autogoal non valida.\`);
      const offenderTeam=norm(agRow.beneficiary)===norm(match.home)?match.away:(norm(agRow.beneficiary)===norm(match.away)?match.home:'');
      if(agRow.player && offenderTeam && !findPlayer(model,agRow.player,offenderTeam)) errors.push(\`${'${label}'}: autogoal associato a ${'${agRow.player}'} ma il giocatore non risulta nella rosa di ${'${offenderTeam}'}.\`);
    }
    for (const award of [details.mvp, details.keeper]) {
      if (award?.player && !award.external && !findPlayer(model, award.player, award.team)) errors.push(\`${'${label}'}: premio associato a ${'${award.player}'} ma il giocatore non risulta nella rosa di ${'${award.team}'}.\`);
    }`,
    'validazione esterni/autogoal/premi'
  );
  s = replaceOnce(
    s,
    "      if (assignedH !== hg) errors.push(`${label}: ${match.home} ha ${hg} gol nel risultato ma ${assignedH} assegnati.`);\n      if (assignedA !== ag) errors.push(`${label}: ${match.away} ha ${ag} gol nel risultato ma ${assignedA} assegnati.`);\n      if (!details.mvp?.player) warnings.push(`${label}: MVP non selezionato.`);\n      if (!details.keeper?.player) warnings.push(`${label}: miglior portiere non selezionato.`);",
    "      if (assignedH > hg) errors.push(`${label}: ${match.home} ha ${hg} goal nel risultato ma ${assignedH} assegnati.`);\n      if (assignedA > ag) errors.push(`${label}: ${match.away} ha ${ag} goal nel risultato ma ${assignedA} assegnati.`);",
    'residuo goal esterni impliciti'
  );

  // 5) Se si flagga un premio come Esterno, il nome e facoltativo: viene scritto "Esterno".
  s = replaceOnce(
    s,
    "    if (details.mvp?.player) rows.push({Sezione:'MVP',Giornata:match.day,Squadra:details.mvp.team || '',Giocatore:details.mvp.player,PuntiMVP:Number(details.mvp.points||1),Partita:matchLabel(match),Note:details.mvp.external?'Giocatore esterno':''});\n    if (details.keeper?.player) rows.push({Sezione:'Miglior portiere',Giornata:match.day,Squadra:details.keeper.team || '',Giocatore:details.keeper.player,PuntiPortiere:Number(details.keeper.points||1),Partita:matchLabel(match),Note:details.keeper.external?'Giocatore esterno':''});",
    "    if (details.mvp && (details.mvp.player || details.mvp.external)) rows.push({Sezione:'MVP',Giornata:match.day,Squadra:details.mvp.team || '',Giocatore:details.mvp.player || 'Esterno',PuntiMVP:Number(details.mvp.points||1),Partita:matchLabel(match),Note:details.mvp.external?'Giocatore esterno':''});\n    if (details.keeper && (details.keeper.player || details.keeper.external)) rows.push({Sezione:'Miglior portiere',Giornata:match.day,Squadra:details.keeper.team || '',Giocatore:details.keeper.player || 'Esterno',PuntiPortiere:Number(details.keeper.points||1),Partita:matchLabel(match),Note:details.keeper.external?'Giocatore esterno':''});",
    'premi esterni senza nome'
  );


  // 6) v6: dati espliciti autorevoli + riepilogo non distruttivo.
  s = replaceOnce(s, "function headerNorm(value) {\n  const n = norm(value);\n  if (n === 'gol') return 'goal';\n  if (n === 'golcasa') return 'goalcasa';\n  if (n === 'goltrasferta') return 'goaltrasferta';\n  return n;\n}", "function headerNorm(value) {\n  const n = norm(value);\n  if (n === 'gol') return 'goal';\n  if (n === 'casa') return 'squadracasa';\n  if (n === 'trasferta') return 'squadratrasferta';\n  if (n === 'golcasa' || n === 'goalcasa') return 'goalcasa';\n  if (n === 'goltrasferta' || n === 'goaltrasferta') return 'goaltrasferta';\n  if (n === 'voce') return 'statistica';\n  return n;\n}", 'alias colonne storiche riepilogo');
  s = replaceOnce(s, "const SUMMARY_CANONICAL_HEADERS = ['Sezione','Giornata','Data','Squadra casa','Goal casa','Squadra trasferta','Goal trasferta','Risultato','Squadra','Giocatore','Goal','PuntiMVP','PuntiPortiere','Partita','Statistica','Valore','Note','Tavolino','Squadra penalizzata'];", "const SUMMARY_CANONICAL_HEADERS = ['Sezione','Giornata','Data','Squadra casa','Goal casa','Squadra trasferta','Goal trasferta','Risultato','Squadra','Giocatore','Goal','PuntiMVP','Portiere','PuntiPortiere','Partita','Statistica','Valore','Note','Tavolino','Squadra penalizzata'];", 'colonna Portiere riepilogo');
  s = replaceOnce(s, "    if (details.mvp && (details.mvp.player || details.mvp.external)) rows.push({Sezione:'MVP',Giornata:match.day,Squadra:details.mvp.team || '',Giocatore:details.mvp.player || 'Esterno',PuntiMVP:Number(details.mvp.points||1),Partita:matchLabel(match),Note:details.mvp.external?'Giocatore esterno':''});\n    if (details.keeper && (details.keeper.player || details.keeper.external)) rows.push({Sezione:'Miglior portiere',Giornata:match.day,Squadra:details.keeper.team || '',Giocatore:details.keeper.player || 'Esterno',PuntiPortiere:Number(details.keeper.points||1),Partita:matchLabel(match),Note:details.keeper.external?'Giocatore esterno':''});", "    if (details.mvp && (details.mvp.player || details.mvp.external)) rows.push({Sezione:'MVP',Giornata:match.day,Squadra:details.mvp.team || '',Giocatore:details.mvp.player || 'Esterno',PuntiMVP:details.mvp.external?'':Number(details.mvp.points||1),Partita:matchLabel(match),Note:details.mvp.external?'Giocatore esterno':''});\n    if (details.keeper && (details.keeper.player || details.keeper.external)) rows.push({Sezione:'Miglior portiere',Giornata:match.day,Squadra:details.keeper.team || '',Portiere:details.keeper.player || 'Esterno',PuntiPortiere:details.keeper.external?'':Number(details.keeper.points||1),Partita:matchLabel(match),Note:details.keeper.external?'Giocatore esterno':''});", 'premi esterni senza punteggio CSV');
  s = replaceOnce(s, "  }\n  return rows;\n}\nfunction normalizeToHeaders(source, headers) {", "  }\n  // v6: rigenera le sezioni derivate storicamente presenti nei riepiloghi.\n  const played = dayMatchesFromDraft(draft).filter(m => m.homeGoals !== null && m.awayGoals !== null);\n  const scorerTotals = new Map();\n  played.forEach(match => {\n    if (match.forfeit) return;\n    (match.details?.scorers || []).forEach(scorer => {\n      if (scorer.external || norm(scorer.player) === 'esterno') return;\n      const key = `${norm(scorer.player)}|${norm(scorer.team)}`;\n      const current = scorerTotals.get(key) || { player: scorer.player, team: scorer.team, goals: 0 };\n      current.goals += Number(scorer.qty || 0);\n      scorerTotals.set(key, current);\n    });\n  });\n  [...scorerTotals.values()]\n    .sort((a,b)=>b.goals-a.goals || a.player.localeCompare(b.player,'it'))\n    .forEach(item => rows.push({Sezione:'Totale marcatore giornata',Giornata:draft.day,Squadra:item.team,Giocatore:item.player,Goal:item.goals}));\n  if (played.length) {\n    const totalGoals = played.reduce((sum,m)=>sum+Number(m.homeGoals||0)+Number(m.awayGoals||0),0);\n    const cleanSheets = played.filter(m=>Number(m.homeGoals||0)===0 || Number(m.awayGoals||0)===0).length;\n    const maxMatch = [...played].sort((a,b)=>(Number(b.homeGoals||0)+Number(b.awayGoals||0))-(Number(a.homeGoals||0)+Number(a.awayGoals||0)))[0];\n    const topGoals = Math.max(0,...[...scorerTotals.values()].map(x=>x.goals));\n    const topScorers = [...scorerTotals.values()].filter(x=>x.goals===topGoals && topGoals>0);\n    const topLabel = topScorers.length===1 ? `${topScorers[0].player} (${topGoals} goal)` : (topScorers.length>1 ? `Pari merito tra ${topScorers.length} giocatori` : '—');\n    const stat = (name,value) => rows.push({Sezione:'Statistica',Giornata:draft.day,Statistica:name,Valore:value});\n    stat('Goal totali', totalGoals);\n    stat('Media goal/partita', (totalGoals/played.length).toFixed(1));\n    stat('Clean sheet', cleanSheets);\n    if (maxMatch) stat('Partita con piu goal', `${maxMatch.home} ${maxMatch.homeGoals}-${maxMatch.awayGoals} ${maxMatch.away}`);\n    stat('Miglior marcatore', topLabel);\n    stat('Partite giocate', played.length);\n  }\n  return rows;\n}\nfunction normalizeToHeaders(source, headers) {", 'rigenerazione statistiche riepilogo');
  s = replaceOnce(s, "  const next = replaceDayRows(parsed.objects,file.rel,draft.day,buildSummaryRows(draft).map(r=>normalizeToHeaders(r,headers)));", "  const managedSection = value => {\n    const n = norm(value);\n    return n === 'partita' || n.includes('marcatore') || n === 'mvp' || n.includes('portiere') || n.includes('autogoal') || n.includes('autoreti') || n.includes('statistic');\n  };\n  const keep = parsed.objects.filter(row => {\n    const sameDay = (dayNumber(field(row,['giornata','turno','round'])) || dayNumber(file.rel)) === Number(draft.day);\n    if (!sameDay) return true;\n    return !managedSection(field(row,['sezione','tipo','blocco','categoria']));\n  });\n  const generated = buildSummaryRows(draft).map(r=>normalizeToHeaders(r,headers));\n  const next = [...keep, ...generated];", 'riepilogo non distruttivo');

  // 7) v7: premio esterno senza squadra implicita + presenze opzionali reali.
  s = replaceOnce(s, "const SCORER_HEADERS = ['Posizione','Giocatore','Squadra','Goal','Partite','Note'];", "const SCORER_HEADERS = ['Posizione','Giocatore','Squadra','Goal','Presenze','Note'];", "presenze canoniche marcatori");
  s = replaceOnce(s, "  const display = `${cognome} ${nome}`.trim() || direct || full;\n  return {", "  const display = `${cognome} ${nome}`.trim() || direct || full;\n  const appearanceKey = Object.keys(row || {}).find(k => ['presenze','partite','pg'].includes(norm(k)));\n  const appearanceRaw = appearanceKey === undefined ? '' : String(row[appearanceKey] ?? '').trim();\n  const appearances = appearanceRaw === '' ? null : Math.max(0, intOrNull(appearanceRaw) ?? 0);\n  const appearancesDefined = appearanceKey !== undefined;\n  return {", "lettura presenze rosa");
  s = replaceOnce(s, "    captain: ['si','s','yes','y','true','1','x','capitano','captain','c'].includes(norm(field(row, ['capitano','captain','fascia','cap','is_captain']))),\n    sourceRow: row", "    captain: ['si','s','yes','y','true','1','x','capitano','captain','c'].includes(norm(field(row, ['capitano','captain','fascia','cap','is_captain']))),\n    appearances,\n    appearancesDefined,\n    sourceRow: row", "proprieta presenze giocatore");
  s = replaceOnce(s, "  model.players = model.teams.flatMap(t => t.players);", "  model.players = model.teams.flatMap(t => t.players);\n  for (const scorerFile of sectionFiles(model,'marcatori')) {\n    for (const row of scorerFile.parsed?.objects || []) {\n      const rawPresence = String(field(row,['presenze','partite','pg']) || '').trim();\n      if (rawPresence === '') continue;\n      const playerName = String(field(row,['giocatore','nome','calciatore','player']) || '').trim();\n      const teamName = String(field(row,['squadra','team']) || '').trim();\n      const token = norm(playerName);\n      if (!token) continue;\n      let candidates = model.players.filter(p => [p.fullName,p.displayName,p.nome,p.cognome].some(x => norm(x) === token));\n      const sameTeam = candidates.filter(p => norm(p.team) === norm(teamName));\n      if (sameTeam.length) candidates = sameTeam;\n      if (candidates.length !== 1) continue;\n      const player = candidates[0];\n      if (!player.appearancesDefined && (player.appearances === null || player.appearances === undefined)) {\n        player.appearances = Math.max(0, intOrNull(rawPresence) ?? 0);\n      }\n    }\n  }", "import presenze storiche da classifica marcatori");
  s = replaceOnce(s, "function makeRankFile(model,kind,fallback,headers,entries,standingsRows){\n  const file=chooseFile(model,kind,fallback);const parsed=objectRows(file.text||'');const hs=ensureHeaders(parsed.headers,headers);const ranks=rankMap(standingsRows);const matches=new Map(standingsRows.map(s=>[norm(s.team),Number(s.pg||0)]));\n  entries.forEach(e=>{e.matches=matches.get(norm(e.team))||0;e.average=e.matches?e.value/e.matches:0});\n  entries.sort((a,b)=>b.value-a.value||(kind==='marcatori'?(b.average-a.average):0)||(ranks.get(norm(a.team))??999)-(ranks.get(norm(b.team))??999)||a.name.localeCompare(b.name,'it'));\n  const objs=entries.map((e,i)=>{const o={};setAlias(o,hs,['posizione','pos','rank'],i+1,'Posizione');setAlias(o,hs,kind==='portieri'?['portiere','giocatore','nome']:['giocatore','nome','player'],e.name,kind==='portieri'?'Portiere':'Giocatore');setAlias(o,hs,['squadra','team'],e.team,'Squadra');if(kind==='marcatori'){setAlias(o,hs,['gol','goal','reti'],e.value,'Goal');setAlias(o,hs,['partite','presenze','pg'],e.matches,'Partite')}else if(kind==='mvp')setAlias(o,hs,['punti mvp','puntimvp','punti'],e.value,'Punti MVP');else setAlias(o,hs,['punti portiere','punti pt','punti'],e.value,'Punti'); return o;});\n  return {path:file.path||`${model.dataRoot}/${file.rel}`,rel:file.rel,content:objectsToCsv(hs,objs,parsed.separator||';')};\n}", "function makeRankFile(model,kind,fallback,headers,entries,standingsRows){\n  const file=chooseFile(model,kind,fallback);const parsed=objectRows(file.text||'');const hs=ensureHeaders(parsed.headers,headers);const ranks=rankMap(standingsRows);const teamMatches=new Map(standingsRows.map(s=>[norm(s.team),Number(s.pg||0)]));\n  const explicitAppearances=(name,team)=>{\n    const token=norm(name);if(!token)return null;\n    let candidates=(model.players||[]).filter(p=>[p.fullName,p.displayName,p.nome,p.cognome].some(x=>norm(x)===token));\n    const sameTeam=candidates.filter(p=>norm(p.team)===norm(team));if(sameTeam.length)candidates=sameTeam;\n    if(candidates.length!==1)return null;\n    const value=candidates[0].appearances;\n    return value===null||value===undefined?null:Math.max(0,Number(value)||0);\n  };\n  entries.forEach(e=>{const explicit=kind==='marcatori'?explicitAppearances(e.name,e.team):null;e.explicitMatches=explicit;e.matches=explicit!==null?explicit:(teamMatches.get(norm(e.team))||0);e.average=e.matches?e.value/e.matches:0});\n  entries.sort((a,b)=>b.value-a.value||(kind==='marcatori'?(b.average-a.average):0)||(ranks.get(norm(a.team))??999)-(ranks.get(norm(b.team))??999)||a.name.localeCompare(b.name,'it'));\n  const objs=entries.map((e,i)=>{const o={};setAlias(o,hs,['posizione','pos','rank'],i+1,'Posizione');setAlias(o,hs,kind==='portieri'?['portiere','giocatore','nome']:['giocatore','nome','player'],e.name,kind==='portieri'?'Portiere':'Giocatore');setAlias(o,hs,['squadra','team'],e.team,'Squadra');if(kind==='marcatori'){setAlias(o,hs,['gol','goal','reti'],e.value,'Goal');setAlias(o,hs,['presenze','partite','pg'],e.explicitMatches===null?'':e.explicitMatches,'Presenze')}else if(kind==='mvp')setAlias(o,hs,['punti mvp','puntimvp','punti'],e.value,'Punti MVP');else setAlias(o,hs,['punti portiere','punti pt','punti'],e.value,'Punti'); return o;});\n  return {path:file.path||`${model.dataRoot}/${file.rel}`,rel:file.rel,content:objectsToCsv(hs,objs,parsed.separator||';')};\n}", "classifica marcatori usa presenze giocatore");
  s = replaceOnce(s, "    for (const award of [details.mvp, details.keeper]) {\n      if (award?.player && !award.external && !findPlayer(model, award.player, award.team)) errors.push(`${label}: premio associato a ${award.player} ma il giocatore non risulta nella rosa di ${award.team}.`);\n    }", "    for (const award of [details.mvp, details.keeper]) {\n      if (award?.external && !award.team) errors.push(`${label}: premio esterno senza squadra associata.`);\n      else if (award && (award.player || award.external) && ![match.home,match.away].some(t => norm(t) === norm(award.team))) errors.push(`${label}: squadra premio non valida.`);\n      if (award?.player && !award.external && !findPlayer(model, award.player, award.team)) errors.push(`${label}: premio associato a ${award.player} ma il giocatore non risulta nella rosa di ${award.team}.`);\n    }", "validazione squadra premio esterno");
  s = replaceOnce(s, "export function rosterCsv(team, players, existingFile=null){\n  const parsed=existingFile?objectRows(existingFile.text||''):{headers:[],objects:[],separator:';'};const headers=ensureHeaders(parsed.headers,['Nome','Cognome','Ruolo','Numero','Capitano']);\n  const objs=players.map(p=>{const o={};setAlias(o,headers,['nome'],p.nome||'','Nome');setAlias(o,headers,['cognome'],p.cognome||'','Cognome');setAlias(o,headers,['ruolo','role'],p.role||'','Ruolo');setAlias(o,headers,['numero','n'],p.number||'','Numero');setAlias(o,headers,['capitano','captain'],p.captain?'SI':'','Capitano');return o;});\n  return objectsToCsv(headers,objs,parsed.separator||';');\n}", "export function rosterCsv(team, players, existingFile=null){\n  const parsed=existingFile?objectRows(existingFile.text||''):{headers:[],objects:[],separator:';'};const headers=ensureHeaders(parsed.headers,['Nome','Cognome','Ruolo','Numero','Presenze','Capitano']);\n  const objs=players.map(p=>{const o={};setAlias(o,headers,['nome'],p.nome||'','Nome');setAlias(o,headers,['cognome'],p.cognome||'','Cognome');setAlias(o,headers,['ruolo','role'],p.role||'','Ruolo');setAlias(o,headers,['numero','n'],p.number||'','Numero');setAlias(o,headers,['presenze','partite','pg'],p.appearances===null||p.appearances===undefined?'':Math.max(0,Number(p.appearances)||0),'Presenze');setAlias(o,headers,['capitano','captain'],p.captain?'SI':'','Capitano');return o;});\n  return objectsToCsv(headers,objs,parsed.separator||';');\n}", "salvataggio presenze rosa");
  s = replaceOnce(s, "export function rosterCsv(team, players, existingFile=null){", "export function scorerAppearancesChange(model){\n  const file=sectionFiles(model,'marcatori')[0];if(!file)return null;\n  const parsed=objectRows(file.text||'');if(!parsed.headers?.length)return null;\n  const headers=ensureHeaders(parsed.headers,['Presenze']);\n  const resolvePlayer=(name,team)=>{\n    const token=norm(name);if(!token)return null;\n    let candidates=(model.players||[]).filter(p=>[p.fullName,p.displayName,p.nome,p.cognome].some(x=>norm(x)===token));\n    const sameTeam=candidates.filter(p=>norm(p.team)===norm(team));if(sameTeam.length)candidates=sameTeam;\n    return candidates.length===1?candidates[0]:null;\n  };\n  const rows=parsed.objects.map(row=>{\n    const out={...row};const name=String(field(row,['giocatore','nome','calciatore','player'])||'').trim();const team=String(field(row,['squadra','team'])||'').trim();const player=resolvePlayer(name,team);\n    if(player){const value=player.appearances===null||player.appearances===undefined?'':Math.max(0,Number(player.appearances)||0);setAlias(out,headers,['presenze','partite','pg'],value,'Presenze')}\n    return out;\n  });\n  const content=objectsToCsv(headers,rows,parsed.separator||';');\n  if(String(content).replace(/\\r\\n/g,'\\n')===String(file.text||'').replace(/\\r\\n/g,'\\n'))return null;\n  return {path:file.path||`${model.dataRoot}/${file.rel}`,rel:file.rel,content};\n}\nexport function rosterCsv(team, players, existingFile=null){", "helper sync presenze marcatori");

  // 8) v8: nel Pagellone il file usa il cognome; un cognome univoco della rosa e valido.
  s = replaceOnce(s, "    if(e.team&&e.player&&!findPlayer(model,e.player,e.team))warnings.push(`Pagella ${n}: ${e.player} non coincide esattamente con un giocatore della rosa di ${e.team}.`);", "    if(e.team&&e.player&&!findPlayer(model,e.player,e.team)){const token=norm(e.player);const surnameMatches=playersForTeam(model,e.team).filter(p=>norm(p.cognome)===token);if(surnameMatches.length!==1)warnings.push(`Pagella ${n}: ${e.player} non corrisponde a un cognome univoco nella rosa di ${e.team}.`);}", "pagellone cognome valido");
  // v29: un cognome ambiguo nella stessa squadra e' un errore bloccante, non un warning.
  s = replaceOnce(
    s,
    "    if(e.team&&e.player&&!findPlayer(model,e.player,e.team)){const token=norm(e.player);const surnameMatches=playersForTeam(model,e.team).filter(p=>norm(p.cognome)===token);if(surnameMatches.length!==1)warnings.push(`Pagella ${n}: ${e.player} non corrisponde a un cognome univoco nella rosa di ${e.team}.`);}",
    "    if(e.team&&e.player&&!findPlayer(model,e.player,e.team)){const token=norm(e.player);const surnameMatches=playersForTeam(model,e.team).filter(p=>norm(p.cognome)===token);if(surnameMatches.length>1)errors.push(`Pagella ${n}: cognome ambiguo “${e.player}” nella rosa di ${e.team}. Seleziona il giocatore corretto con nome e cognome.`);else if(surnameMatches.length!==1)warnings.push(`Pagella ${n}: ${e.player} non corrisponde a un giocatore della rosa di ${e.team}.`);}",
    "pagellone omonimi bloccanti"
  );

  // 9) v11: punti/voto dei premi individuali espliciti e obbligatori per premi interni.
  //    Se il file storico non contiene il punteggio, l'Admin mostra il campo vuoto
  //    invece di inventare 1 punto; la pubblicazione viene bloccata finche non viene compilato.
  s = replaceOnce(
    s,
    "if (name) out.mvp = { team, player: name, points: pointsFromRow(row,['punti mvp','puntimvp','punti','valore'],1), external: !findPlayer(model,name,team) };",
    "if (name) out.mvp = { team, player: name, points: pointsFromRow(row,['punti mvp','puntimvp','punti','valore'],''), external: !findPlayer(model,name,team) };",
    'lettura punti MVP senza fallback inventato'
  );
  s = replaceOnce(
    s,
    "if (name) out.keeper = { team, player: name, points: pointsFromRow(row,['punti portiere','punti pt','puntipt','punti','valore'],1), external: !findPlayer(model,name,team) };",
    "if (name) out.keeper = { team, player: name, points: pointsFromRow(row,['punti portiere','punti pt','puntipt','punti','valore'],''), external: !findPlayer(model,name,team) };",
    'lettura punti portiere senza fallback inventato'
  );
  s = replaceOnce(
    s,
    "    for (const award of [details.mvp, details.keeper]) {\n      if (award?.external && !award.team) errors.push(`${label}: premio esterno senza squadra associata.`);\n      else if (award && (award.player || award.external) && ![match.home,match.away].some(t => norm(t) === norm(award.team))) errors.push(`${label}: squadra premio non valida.`);\n      if (award?.player && !award.external && !findPlayer(model, award.player, award.team)) errors.push(`${label}: premio associato a ${award.player} ma il giocatore non risulta nella rosa di ${award.team}.`);\n    }",
    "    for (const award of [details.mvp, details.keeper]) {\n      const awardName = award === details.mvp ? 'MVP' : 'miglior portiere';\n      if (award?.external && !award.team) errors.push(`${label}: premio esterno senza squadra associata.`);\n      else if (award && (award.player || award.external) && ![match.home,match.away].some(t => norm(t) === norm(award.team))) errors.push(`${label}: squadra premio non valida.`);\n      if (award?.player && !award.external) {\n        if (!findPlayer(model, award.player, award.team)) errors.push(`${label}: premio associato a ${award.player} ma il giocatore non risulta nella rosa di ${award.team}.`);\n        const rawPoints = String(award.points ?? '').trim().replace(',', '.');\n        const points = Number(rawPoints);\n        if (!rawPoints || !Number.isFinite(points) || points <= 0) errors.push(`${label}: ${awardName} senza punti/voto valido.`);\n      }\n    }",
    'validazione punti premi'
  );
  s = replaceOnce(
    s,
    "    if (details.mvp && (details.mvp.player || details.mvp.external)) rows.push({Sezione:'MVP',Giornata:match.day,Squadra:details.mvp.team || '',Giocatore:details.mvp.player || 'Esterno',PuntiMVP:details.mvp.external?'':Number(details.mvp.points||1),Partita:matchLabel(match),Note:details.mvp.external?'Giocatore esterno':''});\n    if (details.keeper && (details.keeper.player || details.keeper.external)) rows.push({Sezione:'Miglior portiere',Giornata:match.day,Squadra:details.keeper.team || '',Portiere:details.keeper.player || 'Esterno',PuntiPortiere:details.keeper.external?'':Number(details.keeper.points||1),Partita:matchLabel(match),Note:details.keeper.external?'Giocatore esterno':''});",
    "    if (details.mvp && (details.mvp.player || details.mvp.external)) rows.push({Sezione:'MVP',Giornata:match.day,Squadra:details.mvp.team || '',Giocatore:details.mvp.player || 'Esterno',PuntiMVP:details.mvp.external?'':Number(String(details.mvp.points ?? '').replace(',', '.')),Partita:matchLabel(match),Note:details.mvp.external?'Giocatore esterno':''});\n    if (details.keeper && (details.keeper.player || details.keeper.external)) rows.push({Sezione:'Miglior portiere',Giornata:match.day,Squadra:details.keeper.team || '',Portiere:details.keeper.player || 'Esterno',PuntiPortiere:details.keeper.external?'':Number(String(details.keeper.points ?? '').replace(',', '.')),Partita:matchLabel(match),Note:details.keeper.external?'Giocatore esterno':''});",
    'scrittura punti premi espliciti'
  );

  return s;
}

function patchGh(source) {
  let s = source;

  // Blob Git: supporto contenuto base64 per WebP.
  s = replaceOnce(
    s,
    "        body: JSON.stringify({ content: String(change.content ?? ''), encoding: 'utf-8' })",
    "        body: JSON.stringify({ content: change.contentBase64 != null ? String(change.contentBase64) : String(change.content ?? ''), encoding: change.contentBase64 != null ? 'base64' : 'utf-8' })",
    'blob base64 WebP'
  );

  // Lettura generica di un file testuale al commit corrente (serve a registrare
  // automaticamente le nuove chiavi immagine nell'index del torneo).
  s = replaceOnce(
    s,
    "// ---------- lista tornei (porting di api/tournaments.js) ----------\nexport async function getTournaments(target) {",
    `// ---------- lettura file testuale al commit corrente ----------
export async function getTextFile(target, pathValue) {
  const path = String(pathValue || '').replace(/^\\/+/, '');
  if (!path || path.includes('..')) throw fail('Percorso file non valido.', 400);
  const head = await getHead(target);
  const tree = await getTree(target, head.treeSha);
  if (tree.truncated) throw fail('Albero GitHub troppo grande/troncato.', 409);
  const entry = (tree.tree || []).find(x => x.type === 'blob' && x.path === path);
  if (!entry) throw fail(\`File non trovato: ${'${path}'}\`, 404);
  return getBlobText(target, entry.sha);
}
// ---------- lista tornei (porting di api/tournaments.js) ----------
export async function getTournaments(target) {`,
    'getTextFile'
  );

  // Percorsi pubblicabili: data CSV/TXT/JSON + index torneo + WebP canoniche.
  s = replaceOnce(
    s,
    "function safeDataPath(path, dataRoot) {\n  const p = String(path || '').replace(/^\\/+/, '');\n  const base = p.split('/').pop().toLowerCase();\n  if (/^(fantacalcio_cache|portieri_snapshot)\\.json$/i.test(base)) return false;\n  return p.startsWith(dataRoot + '/') && !p.includes('..') && /\\.(csv|txt|json)$/i.test(p);\n}",
    `function safeDataPath(path, dataRoot, tournament = '') {
  const p = String(path || '').replace(/^\\/+/, '');
  if (!p || p.includes('..')) return false;
  const base = p.split('/').pop().toLowerCase();
  if (p.startsWith(dataRoot + '/')) {
    if (/^(fantacalcio_cache|portieri_snapshot)\\.json$/i.test(base)) return false;
    return /\\.(csv|txt|json)$/i.test(p);
  }
  if (tournament && p === tournament + '/index.html') return true;
  if (tournament) {
    const prefix = tournament + '/immagini/';
    if (!p.startsWith(prefix)) return false;
    return /^(?:giocatori|squadre)\\/[a-z0-9]+\\.webp$/i.test(p.slice(prefix.length));
  }
  return false;
}`,
    'percorsi WebP/index'
  );
  s = replaceOnce(
    s,
    "    if (!safeDataPath(path, dataRoot)) throw fail(`Percorso non consentito: ${path}`, 400);",
    "    if (!safeDataPath(path, dataRoot, tournament)) throw fail(`Percorso non consentito: ${path}`, 400);",
    'validazione percorso pubblicazione'
  );

  // Validazione e accounting dei WebP base64.
  s = replaceOnce(
    s,
    "    if (change.delete) { sanitized.push({ path, delete: true }); continue; }\n    const content = String(change.content ?? '');\n    const bytes = new TextEncoder().encode(content).length;\n    if (bytes > PUB_MAX_FILE_BYTES) throw fail(`File troppo grande: ${path}`, 413);\n    total += bytes;",
    `    if (change.delete) { sanitized.push({ path, delete: true }); continue; }
    if (/\\.webp$/i.test(path)) {
      const contentBase64 = String(change.contentBase64 || '').replace(/\\s+/g, '');
      if (!contentBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64)) throw fail(\`${'${path}'}: immagine WebP non valida.\`, 400);
      const padding = (contentBase64.match(/=+$/) || [''])[0].length;
      const bytes = Math.floor(contentBase64.length * 3 / 4) - padding;
      if (bytes > PUB_MAX_FILE_BYTES) throw fail(\`File troppo grande: ${'${path}'}\`, 413);
      total += bytes;
      sanitized.push({ path, contentBase64 });
      continue;
    }
    const content = String(change.content ?? '');
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > PUB_MAX_FILE_BYTES) throw fail(\`File troppo grande: ${'${path}'}\`, 413);
    total += bytes;`,
    'validazione WebP base64'
  );

  return s;
}

function patchAdmin(source, coreUrl, ghUrl) {
  let s = source;

  // Moduli patchati.
  s = replaceOnce(s, "} from './core.js';", `} from '${coreUrl}';`, 'import core patchato');
  s = replaceOnce(s, "} from './gh.js';", `} from '${ghUrl}';`, 'import gh patchato');
  const tournamentUrl = new URL('./tournament.js', BASE).href;
  s = replaceOnce(s, "from './tournament.js';", `from '${tournamentUrl}';`, 'import tournament assoluto');
  s = replaceOnce(
    s,
    "  DEFAULT_TARGETS, verifyTarget, getTournaments, getSnapshot,",
    "  DEFAULT_TARGETS, verifyTarget, getTournaments, getSnapshot, getTextFile,",
    'import getTextFile'
  );

  // Draft giornata v5: scarta vecchi draft locali che potevano contenere select vuote
  // e riallinea nomi abbreviati/cognomi alla voce esatta della rosa.
  s = replaceOnce(
    s,
    "function draftKey(day){return `cral-admin-draft|${state.target}|${state.tournament}|${day}`}\nfunction saveLocalDayDraft()",
    `function adminV27ParseCsv(text){
  const src=String(text||'').replace(/^\\uFEFF/,'');
  const first=(src.split(/\\r?\\n/,1)[0]||'');
  const sep=(first.match(/;/g)||[]).length >= (first.match(/,/g)||[]).length ? ';' : ',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(ch==='"'){
      if(quoted&&src[i+1]==='"'){cell+='"';i++;}
      else quoted=!quoted;
    }else if(ch===sep&&!quoted){row.push(cell);cell='';}
    else if((ch==='\\n'||ch==='\\r')&&!quoted){
      if(ch==='\\r'&&src[i+1]==='\\n')i++;
      row.push(cell);cell='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[];
    }else cell+=ch;
  }
  if(cell!==''||row.length){row.push(cell);if(row.some(x=>String(x).trim()!==''))rows.push(row);}
  if(rows.length<2)return [];
  const headers=rows[0].map(x=>String(x||'').trim());
  return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,String(r[i]??'').trim()])));
}
function adminV27Field(row,names){
  const entries=Object.entries(row||{});for(const name of names){const n=norm(name);const hit=entries.find(([k])=>norm(k)===n);if(hit&&String(hit[1]??'').trim()!=='')return hit[1];}return '';
}
function adminV27CalendarMatch(row){
  const dayRaw=adminV27Field(row,['giornata','turno','round','giornata n','n giornata']);
  const day=Number(String(dayRaw||'').match(/\\d+/)?.[0]||0);
  const home=String(adminV27Field(row,['squadra casa','casa','home','team casa','squadra 1','team1','locale'])||'').trim();
  const away=String(adminV27Field(row,['squadra trasferta','trasferta','ospite','away','team trasferta','squadra 2','team2'])||'').trim();
  if(!day||!home||!away)return null;
  return {day,home,away,date:String(adminV27Field(row,['data','date','giorno'])||'').trim(),homeGoals:null,awayGoals:null,forfeit:false,penalizedTeam:''};
}
async function adminV27EnsureCalendar(target,snap){
  const model=state.model;if(!model)return {added:0,error:'model assente'};
  const before=(model.matches||[]).length;
  let text='';
  try{text=await getTextFile(target,\`${'${snap.tournament}'}/data/calendario_andata_ritorno.csv\`)}catch(error){return {added:0,error:'calendario non leggibile: '+(error?.message||String(error))};}
  const parsed=adminV27ParseCsv(text).map(adminV27CalendarMatch).filter(Boolean);
  if(!parsed.length)return {added:0,error:'calendario letto ma nessuna partita riconosciuta'};
  const same=(a,b)=>Number(a?.day)===Number(b?.day)&&norm(a?.home)===norm(b?.home)&&norm(a?.away)===norm(b?.away);
  const current=Array.isArray(model.matches)?model.matches:[];
  parsed.forEach(m=>{if(!current.some(x=>same(x,m)))current.push(m)});
  model.matches=current;
  const cal=Array.isArray(model.calendarMatches)?model.calendarMatches:[];
  parsed.forEach(m=>{if(!cal.some(x=>same(x,m)))cal.push({...m})});
  model.calendarMatches=cal;
  model.days=[...new Set([...(model.days||[]),...current.map(m=>Number(m.day)).filter(Boolean)])].sort((a,b)=>a-b);
  return {added:current.length-before,total:current.length,calendarRows:parsed.length,error:''};
}
function rosterPlayerMatch(team,value){
  const token=norm(value);if(!token)return null;
  const candidates=playersForTeam(state.model,team).filter(p=>[p.fullName,p.displayName,p.nome,p.cognome].some(x=>norm(x)===token));
  return candidates.length===1?candidates[0]:null;
}
function draftKey(day){return \`cral-admin-draft-v27|${'${state.target}'}|${'${state.tournament}'}|${'${day}'}\`}
function saveLocalDayDraft()`,
    'versione draft e resolver giocatori'
  );
  s = replaceOnce(
    s,
    "    const d=existingMatchdayDetails(state.model,m);const internal=[],external=[];\n    (d.scorers||[]).forEach(s=>(s.external||norm(s.player)==='esterno'?external:internal).push({team:s.team||m.home,player:s.player||'',qty:Number(s.qty||1),external:!!s.external}));\n    return {...structuredClone(m),day:Number(day),details:{...d,scorers:internal,externalGoals:external.map(s=>({team:s.team||m.home,player:norm(s.player)==='esterno'?'':s.player,qty:s.qty})),ownGoals:d.ownGoals||[]}};",
    `    const d=existingMatchdayDetails(state.model,m);const internal=[],external=[];
    (d.scorers||[]).forEach(row=>{
      const team=row.team||m.home;const matched=rosterPlayerMatch(team,row.player);const isExternal=norm(row.player)==='esterno'||(!matched&&!!row.external);
      const normalized={team,player:matched?.fullName||row.player||'',qty:Number(row.qty||1),external:isExternal};
      (isExternal?external:internal).push(normalized);
    });
    for(const key of ['mvp','keeper']){
      const award=d[key];if(!award?.player)continue;const matched=rosterPlayerMatch(award.team||m.home,award.player);
      if(matched)d[key]={...award,player:matched.fullName,external:false};
    }
    return {...structuredClone(m),day:Number(day),details:{...d,scorers:internal,externalGoals:external.map(row=>({team:row.team||m.home,player:norm(row.player)==='esterno'?'':row.player,qty:row.qty})),ownGoals:d.ownGoals||[]}};`,
    'preselezione marcatori/premi'
  );

  // I file fuori da /data (index + immagini) non devono entrare nel modello CSV.
  s = replaceOnce(
    s,
    "  state.pending.forEach(change=>{\n    if(change.delete){delete files[change.path];return}",
    "  state.pending.forEach(change=>{\n    if(!String(change.path||'').startsWith(state.snapshot.dataRoot+'/'))return;\n    if(change.delete){delete files[change.path];return}",
    'pending non-data'
  );

  // Spelling UI: goal/autogoal.
  s = s.replaceAll('autogol', 'autogoal').replaceAll('Autogol', 'Autogoal');
  s = s.replaceAll('Gol di giocatori esterni', 'Goal di giocatori esterni');
  s = s.replaceAll('gol fatti', 'goal fatti');
  s = s.replace("vote.placeholder='Es. 7+ oppure 6,5';", "vote.placeholder='Es. 7+, 6,5 oppure sv';");

  // Hint sul flag tavolino: non obbligatorio per dati storici gia riconosciuti dalla classifica.
  s = replaceOnce(
    s,
    "mb.appendChild(fr);\n  if(match.forfeit)",
    "mb.appendChild(fr);const fh=el('div','file-meta','Per i dati storici il flag viene anche dedotto dalla nota in Classifica (giornata + tavolino/forfeit/rinuncia). Usalo soprattutto per nuove partite o per rendere il dato esplicito.');fh.style.margin='4px 0 10px';mb.appendChild(fh);\n  if(match.forfeit)",
    'hint tavolino'
  );

  // Nome premio esterno facoltativo se la spunta Esterno e attiva.
  s = replaceOnce(
    s,
    "person.placeholder=`Nome ${label} esterno`;",
    "person.placeholder=`Nome ${label} esterno (facoltativo)`;",
    'placeholder premio esterno'
  );


  // v6: quando si prepara una giornata, aggiorna automaticamente il frontend del torneo
  // affinche i dati Esterno espliciti abbiano priorita sui fallback storici.
  s = replaceOnce(s, "function prepareMatchday(){", "function patchPublicFrontendV6(source){\n  let text=String(source||'').replace(/\\r\\n?/g,'\\n');\n  if(text.includes('CRAL_V6_EXPLICIT_EXTERNALS'))return text;\n  const replace=(needle,replacement,label)=>{if(!text.includes(needle))throw new Error('Frontend non compatibile con patch v6 ('+label+').');text=text.replace(needle,replacement)};\n  replace(\n`function countGoalsInTokenList(people){\n  return people.reduce((sum,name)=>{\n    const n=riepilogoGoalNumberFromText(name);\n    return sum + (n!==null && n>0 ? n : 1);\n  },0);\n}`,\n`function countGoalsInTokenList(people){\n  return people.reduce((sum,name)=>{\n    const n=riepilogoGoalNumberFromText(name);\n    return sum + (n!==null && n>0 ? n : 1);\n  },0);\n}\n// CRAL_V6_EXPLICIT_EXTERNALS: il dato esplicito dell'Admin ha priorita sull'inferenza storica.\nfunction riepilogoIsExplicitExternalRow(row){\n  const name=firstPresent(row,[['giocatore','marcatore','portiere','mvp','player','nome completo']]);\n  const note=firstPresent(row,[['note','nota','commento','descrizione']]);\n  return isPersonExternal(name) || norm(note).includes('giocatoreesterno');\n}\nfunction riepilogoRowMatchesMatch(row,matchRow,file){\n  const rd=String(rowGiornataKey(row,file)||''),md=String(rowGiornataKey(matchRow,file)||'');\n  if(rd&&md&&rd!==md)return false;\n  const home=firstPresent(matchRow,[['squadra casa','casa','home','squadra 1','team casa']])||Object.values(matchRow||{})[0]||'';\n  const away=firstPresent(matchRow,[['squadra trasferta','trasferta','ospite','away','squadra 2','team trasferta']])||Object.values(matchRow||{})[1]||'';\n  const matchText=norm(firstPresent(row,[['partita','match','gara','incontro']]));\n  if(matchText)return matchText.includes(norm(home))&&matchText.includes(norm(away));\n  const team=norm(firstPresent(row,[['squadra','team']]));\n  return !team||team===norm(home)||team===norm(away);\n}\nfunction riepilogoExplicitExternalRows(rows,matchRow,file,section){\n  return (rows||[]).filter(row=>{\n    if(!riepilogoIsExplicitExternalRow(row)||!riepilogoRowMatchesMatch(row,matchRow,file))return false;\n    if(!section)return true;\n    const sec=norm(firstPresent(row,[['sezione','section','tipo','categoria']]));\n    if(section==='mvp')return sec==='mvp'||sec.includes('miglioreincampo')||sec.includes('manofthematch');\n    if(section==='portiere')return sec.includes('portiere')||sec.includes('keeper');\n    return true;\n  });\n}\nfunction riepilogoExplicitExternalGoals(rows,matchRow,file){\n  const home=firstPresent(matchRow,[['squadra casa','casa','home','squadra 1','team casa']])||Object.values(matchRow||{})[0]||'';\n  const away=firstPresent(matchRow,[['squadra trasferta','trasferta','ospite','away','squadra 2','team trasferta']])||Object.values(matchRow||{})[1]||'';\n  const found=riepilogoExplicitExternalRows(rows,matchRow,file).filter(row=>{\n    const sec=norm(firstPresent(row,[['sezione','section','tipo','categoria']]));\n    return !sec||sec.includes('marcatore');\n  });\n  let homeCount=0,awayCount=0,genericCount=0;\n  found.forEach(row=>{\n    const qty=Math.max(0,num(firstPresent(row,[['goal','gol','reti','quantita','quantità','qta','valore']]))||1);\n    const team=norm(firstPresent(row,[['squadra','team']]));\n    if(team===norm(home))homeCount+=qty;else if(team===norm(away))awayCount+=qty;else genericCount+=qty;\n  });\n  return {found:found.length>0,homeCount,awayCount,genericCount};\n}\nfunction riepilogoExternalDisplayRow(row,kind){\n  if(!riepilogoIsExplicitExternalRow(row))return row;\n  const out={...row,_noLink:true};\n  const teamKey=Object.keys(out).find(k=>['squadra','team'].includes(norm(k)))||'Squadra';out[teamKey]='—';\n  const nameCandidates=kind==='portiere'?['portiere','giocatore','player']:['giocatore','marcatore','mvp','player'];\n  const nameKey=Object.keys(out).find(k=>nameCandidates.includes(norm(k)))||(kind==='portiere'?'Portiere':'Giocatore');out[nameKey]='Esterno';\n  if(kind==='mvp'){const k=Object.keys(out).find(x=>['puntimvp','punti'].includes(norm(x)))||'PuntiMVP';out[k]='N/A'}\n  if(kind==='portiere'){const k=Object.keys(out).find(x=>['puntiportiere','puntipt','punti'].includes(norm(x)))||'PuntiPortiere';out[k]='N/A'}\n  return out;\n}`,\n  'helper esterni espliciti');\n  replace(\n`    const matchGiornataKey=rowGiornataKey(r,file);`,\n`    const matchGiornataKey=rowGiornataKey(r,file);\n    const explicitExternalGoals=riepilogoExplicitExternalGoals(scorerRows||[],r,file);\n    const explicitExternalMvp=riepilogoExplicitExternalRows(contextRows||[],r,file,'mvp').length>0;`,\n  'contesto partita');\n  replace(\n`    if(scorePair && !tavolinoInfo.isForfeit){\n      const [ghTot,gaTot]=scorePair;`,\n`    if(scorePair && !tavolinoInfo.isForfeit){\n      if(explicitExternalGoals.found){\n        externalCasa=explicitExternalGoals.homeCount;\n        externalTrasferta=explicitExternalGoals.awayCount;\n        externalGeneric=explicitExternalGoals.genericCount;\n      }else{\n      const [ghTot,gaTot]=scorePair;`,\n  'priorita goal esterni');\n  replace(\n`        externalGeneric=Math.max(0, golTotali - golTorneo - autogoalCount);\n      }\n    }`,\n`        externalGeneric=Math.max(0, golTotali - golTorneo - autogoalCount);\n      }\n      }\n    }`,\n  'chiusura priorita goal esterni');\n  replace(\n`    const mvpExternal=matchPlayed && !tavolinoInfo.isForfeit && hasRoster && mvp.length>0 && mvp.every(n=>isPersonExternal(n));`,\n`    const mvpExternal=matchPlayed && !tavolinoInfo.isForfeit && (explicitExternalMvp || (hasRoster && mvp.length>0 && mvp.every(n=>isPersonExternal(n))));`,\n  'MVP esterno esplicito');\n  replace(\n`      partite.forEach(r=>{\n        const res=resultText(r);`,\n`      partite.forEach(r=>{\n        if(riepilogoExplicitExternalGoals(marcatori,r,f).found) return;\n        const res=resultText(r);`,\n  'dedup marcatori esterni tabella');\n  replace(\n`      playedPartite.forEach(r=>{\n        if(riepilogoForfeitInfo(r,f).isForfeit) return;`,\n`      playedPartite.forEach(r=>{\n        if(riepilogoForfeitInfo(r,f).isForfeit) return;\n        if(riepilogoExplicitExternalRows(mvp,r,f,'mvp').length) return;`,\n  'dedup MVP esterno');\n  replace(\n`        if(Array.isArray(esterniGiornata)){\n          return esterniGiornata.map(({casa,trasferta})=>({\n            matchLabel:casa&&trasferta?casa+' vs '+trasferta:''\n          }));\n        }`,\n`        if(Array.isArray(esterniGiornata)){\n          const explicitLabels=new Set((portiere||[]).filter(r=>riepilogoIsExplicitExternalRow(r)).map(r=>norm(firstPresent(r,[['partita','match','gara','incontro']]))).filter(Boolean));\n          return esterniGiornata.map(({casa,trasferta})=>({\n            matchLabel:casa&&trasferta?casa+' vs '+trasferta:''\n          })).filter(item=>!explicitLabels.has(norm(item.matchLabel)));\n        }`,\n  'dedup portiere snapshot');\n  replace(`    const marcatoriRows=[...marcatori,...externalScorerRows];`,`    const marcatoriRows=[...marcatori.map(r=>riepilogoExternalDisplayRow(r,'marcatore')),...externalScorerRows];`,'display marcatori esterni');\n  replace(`    const mvpRows=[...mvp,...mvpExternalRows];`,`    const mvpRows=[...mvp.map(r=>riepilogoExternalDisplayRow(r,'mvp')),...mvpExternalRows];`,'display MVP esterni');\n  replace(`    const portiereRows=[...portiere,...portiereExternalRows];`,`    const portiereRows=[...portiere.map(r=>riepilogoExternalDisplayRow(r,'portiere')),...portiereExternalRows];`,'display portieri esterni');\n  return text;\n}\nasync function stagePublicFrontendV6(){\n  const target=requireTarget(state.target),indexPath=state.tournament+'/index.html';\n  const current=state.pending.get(indexPath)?.content??await getTextFile(target,indexPath);\n  const patched=patchPublicFrontendV6(current);\n  if(patched!==current){state.pending.set(indexPath,{path:indexPath,content:patched,source:'Compatibilità frontend v6 (esterni espliciti)'});return true}\n  return false;\n}\nfunction prepareMatchday(){", 'helper frontend v6');
  s = replaceOnce(s, "function prepareMatchday(){\n  const model=effectiveModel();const result=buildMatchdayPublication(model,state.dayDraft);if(result.validation.errors.length){state.status={type:'error',text:result.validation.errors.join(' ')};render();return}result.changes.forEach(c=>state.pending.set(c.path,{...c,source:'Giornata'}));refreshModelFromPending();state.status={type:result.validation.warnings.length?'warning':'success',text:`Preparati ${result.changes.length} file per la giornata ${state.dayDraft.day}.${result.validation.warnings.length?' '+result.validation.warnings.join(' '):''}`};state.active='publish';render()\n}", "async function prepareMatchday(){\n  const model=effectiveModel();const result=buildMatchdayPublication(model,state.dayDraft);if(result.validation.errors.length){state.status={type:'error',text:result.validation.errors.join(' ')};render();return}\n  result.changes.forEach(c=>state.pending.set(c.path,{...c,source:'Giornata'}));\n  let frontendUpdated=false;\n  try{frontendUpdated=await stagePublicFrontendV6()}catch(error){result.changes.forEach(c=>state.pending.delete(c.path));state.status={type:'error',text:'Impossibile preparare la compatibilità frontend v6: '+(error.message||String(error))+'. Nessun dato giornata è stato lasciato in sospeso.'};render();return}\n  refreshModelFromPending();const total=result.changes.length+(frontendUpdated?1:0);state.status={type:result.validation.warnings.length?'warning':'success',text:`Preparati ${total} file per la giornata ${state.dayDraft.day}${frontendUpdated?' (incluso aggiornamento frontend v6)':''}.${result.validation.warnings.length?' '+result.validation.warnings.join(' '):''}`};state.active='publish';render()\n}", 'prepare giornata v6');


  // v7: portiere esterno storico senza squadra inventata + Presenze opzionali.
  s = replaceOnce(s, "  safeTeamFilename, sectionFiles, validateMatchdayDraft, validatePagelloneEntries", "  safeTeamFilename, scorerAppearancesChange, sectionFiles, validateMatchdayDraft, validatePagelloneEntries", "import sync presenze");
  s = replaceOnce(s, "    const snap = await getSnapshot(target, state.tournament);\n    state.snapshot=snap;state.model=buildModel(snap);state.tournament=snap.tournament;state.pending.clear();state.selectedFile='';state.calendarDraft=null;state.selectedTeam=state.model.teams[0]?.name||'';", "    const snap = await getSnapshot(target, state.tournament);\n    let portieriSnapshot=null;\n    try{portieriSnapshot=JSON.parse(await getTextFile(target, `${snap.tournament}/data/portieri_snapshot.json`))}catch{}\n    state.portieriSnapshot=portieriSnapshot;\n    state.snapshot=snap;state.model=buildModel(snap);state.tournament=snap.tournament;\n    state._adminV27CalendarRecovery=await adminV27EnsureCalendar(target,snap);\n    state.pending.clear();state.selectedFile='';state.calendarDraft=null;state.selectedTeam=state.model.teams[0]?.name||'';", "caricamento snapshot portieri Admin");
  s = replaceOnce(s, "function makeDayDraft(day){", "function snapshotHasExternalKeeper(match){\n  const list=state.portieriSnapshot?.portieriEsterni?.[String(match?.day||'')];if(!Array.isArray(list))return false;\n  return list.some(row=>norm(row?.casa)===norm(match.home)&&norm(row?.trasferta)===norm(match.away));\n}\nfunction makeDayDraft(day){", "helper portiere esterno snapshot");
  s = replaceOnce(s, "    const d=existingMatchdayDetails(state.model,m);const internal=[],external=[];\n    (d.scorers||[]).forEach(row=>{\n      const team=row.team||m.home;const matched=rosterPlayerMatch(team,row.player);const isExternal=norm(row.player)==='esterno'||(!matched&&!!row.external);\n      const normalized={team,player:matched?.fullName||row.player||'',qty:Number(row.qty||1),external:isExternal};\n      (isExternal?external:internal).push(normalized);\n    });\n    for(const key of ['mvp','keeper']){\n      const award=d[key];if(!award?.player)continue;const matched=rosterPlayerMatch(award.team||m.home,award.player);\n      if(matched)d[key]={...award,player:matched.fullName,external:false};\n    }\n    return {...structuredClone(m),day:Number(day),details:{...d,scorers:internal,externalGoals:external.map(row=>({team:row.team||m.home,player:norm(row.player)==='esterno'?'':row.player,qty:row.qty})),ownGoals:d.ownGoals||[]}};", "    const d=existingMatchdayDetails(state.model,m);const internal=[],external=[];\n    (d.scorers||[]).forEach(row=>{\n      const team=row.team||m.home;const matched=rosterPlayerMatch(team,row.player);const isExternal=norm(row.player)==='esterno'||(!matched&&!!row.external);\n      const normalized={team,player:matched?.fullName||row.player||'',qty:Number(row.qty||1),external:isExternal};\n      (isExternal?external:internal).push(normalized);\n    });\n    for(const key of ['mvp','keeper']){\n      const award=d[key];if(!award?.player)continue;const matched=rosterPlayerMatch(award.team||m.home,award.player);\n      if(matched)d[key]={...award,player:matched.fullName,external:false};\n    }\n    if(!d.keeper && snapshotHasExternalKeeper(m))d.keeper={team:'',player:'',points:1,external:true,inferredFromSnapshot:true};\n    return {...structuredClone(m),day:Number(day),details:{...d,scorers:internal,externalGoals:external.map(row=>({team:row.team||m.home,player:norm(row.player)==='esterno'?'':row.player,qty:row.qty})),ownGoals:d.ownGoals||[]}};", "preselezione portiere esterno senza squadra inventata");
  s = replaceOnce(s, "function awardEditor(match,key,label){\n  const wrap=el('div');const current=match.details[key]||{team:match.home,player:'',points:1,external:false};const ext=input('checkbox');ext.checked=!!current.external;const extLabel=el('label','checkbox-row');extLabel.appendChild(ext);extLabel.appendChild(document.createTextNode(' Esterno'));wrap.appendChild(extLabel);\n  const team=select(teamOptions(match),current.team||match.home);team.addEventListener('change',()=>{current.team=team.value;if(!current.external)current.player=playersForTeam(state.model,current.team)[0]?.fullName||'';match.details[key]=current;touchDraft();render()});wrap.appendChild(team);\n  let person;if(current.external){person=input('text',current.player||'');person.placeholder=`Nome ${label} esterno (facoltativo)`;person.addEventListener('input',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}else{person=select(playerOptions(current.team||match.home),current.player||'');person.addEventListener('change',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}wrap.appendChild(person);\n  ext.addEventListener('change',()=>{current.external=ext.checked;current.player='';match.details[key]=current;touchDraft();render()});return fieldWrap(label,wrap)\n}", "function awardEditor(match,key,label){\n  const wrap=el('div');const current=match.details[key]||{team:'',player:'',points:1,external:false};const ext=input('checkbox');ext.checked=!!current.external;const extLabel=el('label','checkbox-row');extLabel.appendChild(ext);extLabel.appendChild(document.createTextNode(' Esterno'));wrap.appendChild(extLabel);\n  const awardTeams=[{value:'',label:'— seleziona squadra —'},...teamOptions(match)];const team=select(awardTeams,current.team||'');team.addEventListener('change',()=>{current.team=team.value;current.inferredFromSnapshot=false;current.player='';match.details[key]=current;touchDraft();render()});wrap.appendChild(team);\n  if(current.inferredFromSnapshot&&!current.team)wrap.appendChild(el('div','file-meta','Portiere esterno rilevato dallo snapshot storico. Lo snapshot non contiene la squadra premiata: selezionala esplicitamente.'));\n  let person;if(current.external){person=input('text',current.player||'');person.placeholder=`Nome ${label} esterno (facoltativo)`;person.addEventListener('input',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}else{person=select(playerOptions(current.team||'',true,current.player||''),current.player||'');person.addEventListener('change',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}wrap.appendChild(person);\n  ext.addEventListener('change',()=>{current.external=ext.checked;current.inferredFromSnapshot=false;current.player='';if(!current.external&&!current.team)current.team=match.home;match.details[key]=current;touchDraft();render()});return fieldWrap(label,wrap)\n}", "editor premi senza default squadra casa");
  s = replaceOnce(s, "const card=el('div','card');card.appendChild(el('h3','',team.name));const draft=team._adminPlayers||(team._adminPlayers=structuredClone(team.players));const wrap=el('div','table-wrap');", "const card=el('div','card');card.appendChild(el('h3','',team.name));card.appendChild(el('p','small muted','Presenze è opzionale e indica le partite realmente giocate dal singolo nel torneo. Se lasciata vuota, il frontend usa come fallback le partite giocate dalla squadra. I valori storici presenti in classifica_marcatori.csv vengono importati automaticamente.'));const draft=team._adminPlayers||(team._adminPlayers=structuredClone(team.players));const wrap=el('div','table-wrap');", "hint presenze rosa");
  s = replaceOnce(s, "['Nome','Cognome','Ruolo','Numero','Capitano',''].forEach(h=>hr.appendChild(el('th','',h)));", "['Nome','Cognome','Ruolo','Numero','Presenze','Capitano',''].forEach(h=>hr.appendChild(el('th','',h)));", "colonna presenze roster");
  s = replaceOnce(s, "vals.forEach(([k,v])=>{const td=el('td');const x=input('text',v||'');x.addEventListener('input',()=>p[k]=x.value);td.appendChild(x);tr.appendChild(td)});const cap=el('td');", "vals.forEach(([k,v])=>{const td=el('td');const x=input('text',v||'');x.addEventListener('input',()=>p[k]=x.value);td.appendChild(x);tr.appendChild(td)});const pr=el('td');const presence=input('number',p.appearances??'');presence.min='0';presence.step='1';presence.placeholder='—';presence.addEventListener('input',()=>{p.appearances=presence.value===''?null:Math.max(0,Number.parseInt(presence.value,10)||0);p.appearancesDefined=true});pr.appendChild(presence);tr.appendChild(pr);const cap=el('td');", "input presenze roster");
  s = replaceOnce(s, "function saveRoster(team,players){\n  const invalid=players.filter(p=>!String(p.nome||'').trim()&&!String(p.cognome||'').trim());if(invalid.length){state.status={type:'error',text:'Ogni giocatore deve avere almeno nome o cognome.'};render();return}\n  const rel=team.rel||safeTeamFilename(team.name);const path=team.path||`${state.model.dataRoot}/${rel}`;const content=rosterCsv(team.name,players,team.file);const count=stageGuidedChanges([{path,content}],`Rosa ${team.name}`);state.status={type:'success',text:`Rosa ${team.name} pronta per la pubblicazione (${count} file inclusa eventuale modifica al manifest).`};render()\n}", "function saveRoster(team,players){\n  const invalid=players.filter(p=>!String(p.nome||'').trim()&&!String(p.cognome||'').trim());if(invalid.length){state.status={type:'error',text:'Ogni giocatore deve avere almeno nome o cognome.'};render();return}\n  const rel=team.rel||safeTeamFilename(team.name);const path=team.path||`${state.model.dataRoot}/${rel}`;const content=rosterCsv(team.name,players,team.file);let count=stageGuidedChanges([{path,content}],`Rosa ${team.name}`);const scorerChange=scorerAppearancesChange(effectiveModel());if(scorerChange){state.pending.set(scorerChange.path,{...scorerChange,source:`Presenze ${team.name}`});refreshModelFromPending();count++}state.status={type:'success',text:`Rosa ${team.name} pronta per la pubblicazione (${count} file inclusi eventuale manifest e aggiornamento Presenze marcatori).`};render()\n}", "sync presenze al salvataggio rosa");


  // v8: Pagellone coerente con il formato storico (solo cognome) e senza etichetta 'valore file'.
  s = replaceOnce(s, "function playerOptions(team, includeBlank=true,current=''){const opts=includeBlank?[{value:'',label:'— seleziona —'}]:[];playersForTeam(state.model,team).forEach(p=>opts.push({value:p.fullName,label:p.displayName}));if(current&&!opts.some(o=>norm(o.value)===norm(current)))opts.splice(includeBlank?1:0,0,{value:current,label:`${current} · valore file`});return opts}", "function playerOptions(team, includeBlank=true,current=''){const opts=includeBlank?[{value:'',label:'— seleziona —'}]:[];playersForTeam(state.model,team).forEach(p=>opts.push({value:p.fullName,label:p.displayName}));if(current&&!opts.some(o=>norm(o.value)===norm(current)))opts.splice(includeBlank?1:0,0,{value:current,label:current});return opts}\nfunction pagellonePlayerOptions(team,current=''){const opts=[{value:'',label:'— seleziona —'}];const roster=playersForTeam(state.model,team);const counts=new Map();roster.forEach(p=>{const key=norm(p.cognome||p.fullName);counts.set(key,(counts.get(key)||0)+1)});roster.forEach(p=>{const surname=String(p.cognome||p.fullName||'').trim();if(!surname)return;const duplicate=(counts.get(norm(surname))||0)>1;opts.push({value:surname,label:duplicate?`${surname} (${p.nome||p.fullName})`:surname})});if(current&&!opts.some(o=>norm(o.value)===norm(current)))opts.splice(1,0,{value:current,label:current});return opts}", "opzioni cognome Pagellone");
  s = replaceOnce(s, "main.appendChild(pageHead('Pagellone ignorante','Editor guidato del file TXT: squadra e giocatore vengono agganciati alle rose per evitare omonimie.',[button('+ Pagella','secondary',()=>{const team=state.model.teams[0]?.name||'';const p=playersForTeam(state.model,team)[0];state.pagelloneDraft.push({team,player:p?.fullName||'',text:'',comparison:'',vote:''});markPagelloneDirty();render()}),button('Salva Pagellone','gold',savePagellone)]));", "main.appendChild(pageHead('Pagellone ignorante','Editor guidato del file TXT: il giocatore viene salvato per cognome, come nei pagelloni storici.',[button('+ Pagella','secondary',()=>{const team=state.model.teams[0]?.name||'';const p=playersForTeam(state.model,team)[0];state.pagelloneDraft.push({team,player:p?.cognome||p?.fullName||'',text:'',comparison:'',vote:''});markPagelloneDirty();render()}),button('Salva Pagellone','gold',savePagellone)]));", "nuove pagelle salvano cognome");
  s = replaceOnce(s, "const ts=select(teams,entry.team);ts.addEventListener('change',()=>{entry.team=ts.value;entry.player=playersForTeam(state.model,entry.team)[0]?.fullName||'';markPagelloneDirty();render()});row.appendChild(fieldWrap('Squadra',ts));const ps=select(playerOptions(entry.team,true,entry.player),entry.player);ps.addEventListener('change',()=>{entry.player=ps.value;markPagelloneDirty()});", "const ts=select(teams,entry.team);ts.addEventListener('change',()=>{entry.team=ts.value;const p=playersForTeam(state.model,entry.team)[0];entry.player=p?.cognome||p?.fullName||'';markPagelloneDirty();render()});row.appendChild(fieldWrap('Squadra',ts));const ps=select(pagellonePlayerOptions(entry.team,entry.player),entry.player);ps.addEventListener('change',()=>{entry.player=ps.value;markPagelloneDirty()});", "select Pagellone per cognome");

  // v29: il Pagellone usa il nome completo come identita persistente.
  // I vecchi file con solo cognome vengono migrati automaticamente solo se il cognome e' univoco.
  s = replaceOnce(
    s,
    "function pagellonePlayerOptions(team,current=''){const opts=[{value:'',label:'— seleziona —'}];const roster=playersForTeam(state.model,team);const counts=new Map();roster.forEach(p=>{const key=norm(p.cognome||p.fullName);counts.set(key,(counts.get(key)||0)+1)});roster.forEach(p=>{const surname=String(p.cognome||p.fullName||'').trim();if(!surname)return;const duplicate=(counts.get(norm(surname))||0)>1;opts.push({value:surname,label:duplicate?`${surname} (${p.nome||p.fullName})`:surname})});if(current&&!opts.some(o=>norm(o.value)===norm(current)))opts.splice(1,0,{value:current,label:current});return opts}",
    `function pagellonePlayerResolution(team,value){
  const raw=String(value||'').trim(),token=norm(raw),roster=playersForTeam(state.model,team);
  if(!token)return {status:'blank',player:null,matches:[]};
  const exact=roster.filter(p=>norm(p.fullName)===token||norm(p.displayName)===token);
  if(exact.length===1)return {status:'exact',player:exact[0],matches:exact};
  const surnames=roster.filter(p=>norm(p.cognome)===token);
  if(surnames.length===1)return {status:'surname',player:surnames[0],matches:surnames};
  if(surnames.length>1)return {status:'ambiguous',player:null,matches:surnames};
  return {status:'missing',player:null,matches:[]};
}
function pagellonePlayerOptions(team,current=''){
  const opts=[{value:'',label:'— seleziona —'}];
  playersForTeam(state.model,team).forEach(p=>opts.push({value:p.fullName,label:p.displayName||p.fullName}));
  if(current&&!opts.some(o=>norm(o.value)===norm(current))){const r=pagellonePlayerResolution(team,current);opts.splice(1,0,{value:current,label:r.status==='ambiguous'?current+' · AMBIGUO: scegli nome e cognome':current+' · valore file'});}
  return opts;
}
function normalizePagelloneDraftPlayers(entries){
  return (entries||[]).map(entry=>{const out={...entry};const r=pagellonePlayerResolution(out.team,out.player);if(r.player)out.player=r.player.fullName;return out;});
}`,
    'pagellone identita nome completo'
  );
  s = replaceOnce(
    s,
    "function loadPagelloneDraft(day){const file=pagelloneFileForDay(day);state.selectedPagelloneDay=Number(day);state.pagelloneDraft=file?parsePagellone(file.text):[];state.pagelloneDirty=false}",
    "function loadPagelloneDraft(day){const file=pagelloneFileForDay(day);state.selectedPagelloneDay=Number(day);state.pagelloneDraft=file?normalizePagelloneDraftPlayers(parsePagellone(file.text)):[];state.pagelloneDirty=false}",
    'migrazione pagellone storico'
  );
  s = replaceOnce(
    s,
    "main.appendChild(pageHead('Pagellone ignorante','Editor guidato del file TXT: il giocatore viene salvato per cognome, come nei pagelloni storici.',[button('+ Pagella','secondary',()=>{const team=state.model.teams[0]?.name||'';const p=playersForTeam(state.model,team)[0];state.pagelloneDraft.push({team,player:p?.cognome||p?.fullName||'',text:'',comparison:'',vote:''});markPagelloneDirty();render()}),button('Salva Pagellone','gold',savePagellone)]));",
    "main.appendChild(pageHead('Pagellone ignorante','Editor guidato: ogni pagella viene associata al nome completo del giocatore. I vecchi cognomi univoci vengono riconosciuti automaticamente; gli omonimi richiedono una scelta esplicita.',[button('+ Pagella','secondary',()=>{const team=state.model.teams[0]?.name||'';const p=playersForTeam(state.model,team)[0];state.pagelloneDraft.push({team,player:p?.fullName||'',text:'',comparison:'',vote:''});markPagelloneDirty();render()}),button('Salva Pagellone','gold',savePagellone)]));",
    'header pagellone nome completo'
  );
  s = replaceOnce(
    s,
    "const ts=select(teams,entry.team);ts.addEventListener('change',()=>{entry.team=ts.value;const p=playersForTeam(state.model,entry.team)[0];entry.player=p?.cognome||p?.fullName||'';markPagelloneDirty();render()});row.appendChild(fieldWrap('Squadra',ts));const ps=select(pagellonePlayerOptions(entry.team,entry.player),entry.player);ps.addEventListener('change',()=>{entry.player=ps.value;markPagelloneDirty()});",
    `const ts=select(teams,entry.team);ts.addEventListener('change',()=>{entry.team=ts.value;const p=playersForTeam(state.model,entry.team)[0];entry.player=p?.fullName||'';markPagelloneDirty();render()});row.appendChild(fieldWrap('Squadra',ts));const ps=select(pagellonePlayerOptions(entry.team,entry.player),entry.player);const pres=pagellonePlayerResolution(entry.team,entry.player);if(pres.status==='ambiguous'){ps.style.borderColor='#b42318';ps.title='Cognome ambiguo: seleziona il giocatore corretto';}ps.addEventListener('change',()=>{entry.player=ps.value;markPagelloneDirty();render()});`,
    'select pagellone nome completo'
  );
  s = replaceOnce(
    s,
    "row.appendChild(fieldWrap('Giocatore',ps));card.appendChild(row);const txt=el('textarea','input');",
    `row.appendChild(fieldWrap('Giocatore',ps));card.appendChild(row);if(pres.status==='ambiguous'){const names=pres.matches.map(p=>p.displayName||p.fullName).join(', ');card.appendChild(messageBox('error',\`“${'${entry.player}'}” identifica più giocatori in ${'${entry.team}'}: ${'${names}'}. Seleziona nome e cognome prima di salvare.\`));}const txt=el('textarea','input');`,
    'warning omonimi pagellone'
  );

  // v11: campo punti/voto per MVP e Miglior portiere.
  // I premi interni devono avere un punteggio esplicito; per gli esterni il CSV resta vuoto e il FE visualizza N/A.
  s = replaceOnce(
    s,
    "function awardEditor(match,key,label){\n  const wrap=el('div');const current=match.details[key]||{team:'',player:'',points:1,external:false};const ext=input('checkbox');ext.checked=!!current.external;const extLabel=el('label','checkbox-row');extLabel.appendChild(ext);extLabel.appendChild(document.createTextNode(' Esterno'));wrap.appendChild(extLabel);\n  const awardTeams=[{value:'',label:'— seleziona squadra —'},...teamOptions(match)];const team=select(awardTeams,current.team||'');team.addEventListener('change',()=>{current.team=team.value;current.inferredFromSnapshot=false;current.player='';match.details[key]=current;touchDraft();render()});wrap.appendChild(team);\n  if(current.inferredFromSnapshot&&!current.team)wrap.appendChild(el('div','file-meta','Portiere esterno rilevato dallo snapshot storico. Lo snapshot non contiene la squadra premiata: selezionala esplicitamente.'));\n  let person;if(current.external){person=input('text',current.player||'');person.placeholder=`Nome ${label} esterno (facoltativo)`;person.addEventListener('input',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}else{person=select(playerOptions(current.team||'',true,current.player||''),current.player||'');person.addEventListener('change',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}wrap.appendChild(person);\n  ext.addEventListener('change',()=>{current.external=ext.checked;current.inferredFromSnapshot=false;current.player='';if(!current.external&&!current.team)current.team=match.home;match.details[key]=current;touchDraft();render()});return fieldWrap(label,wrap)\n}",
    "function awardEditor(match,key,label){\n  const wrap=el('div');const current=match.details[key]||{team:'',player:'',points:'',external:false};const ext=input('checkbox');ext.checked=!!current.external;const extLabel=el('label','checkbox-row');extLabel.appendChild(ext);extLabel.appendChild(document.createTextNode(' Esterno'));wrap.appendChild(extLabel);\n  const awardTeams=[{value:'',label:'— seleziona squadra —'},...teamOptions(match)];const team=select(awardTeams,current.team||'');team.addEventListener('change',()=>{current.team=team.value;current.inferredFromSnapshot=false;current.player='';match.details[key]=current;touchDraft();render()});wrap.appendChild(team);\n  if(current.inferredFromSnapshot&&!current.team)wrap.appendChild(el('div','file-meta','Portiere esterno rilevato dallo snapshot storico. Lo snapshot non contiene la squadra premiata: selezionala esplicitamente.'));\n  let person;if(current.external){person=input('text',current.player||'');person.placeholder=`Nome ${label} esterno (facoltativo)`;person.addEventListener('input',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}else{person=select(playerOptions(current.team||'',true,current.player||''),current.player||'');person.addEventListener('change',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}wrap.appendChild(person);\n  let pointsInput;if(current.external){pointsInput=input('text','N/A');pointsInput.disabled=true}else{pointsInput=input('number',current.points??'');pointsInput.min='0';pointsInput.step='any';pointsInput.placeholder=key==='mvp'?'Es. 5':'Es. 1';pointsInput.addEventListener('input',()=>{current.points=pointsInput.value;match.details[key]=current;touchDraft()})}const pointsWrap=fieldWrap('Punti / voto',pointsInput);wrap.appendChild(pointsWrap);if(!current.external){const raw=String(current.points??'').trim().replace(',','.');if(!raw||!Number.isFinite(Number(raw))||Number(raw)<=0){const warn=el('div','file-meta','Punteggio storico mancante/non valido: inserisci il valore reale del premio. Non viene applicato alcun valore predefinito.');warn.style.color='#b42318';wrap.appendChild(warn)}}\n  ext.addEventListener('change',()=>{current.external=ext.checked;current.inferredFromSnapshot=false;current.player='';if(!current.external&&!current.team)current.team=match.home;match.details[key]=current;touchDraft();render()});return fieldWrap(label,wrap)\n}",
    'campo punti premi'
  );

  // Upload WebP per squadra/giocatori + registrazione automatica della chiave nel frontend pubblico.
  const imageHelpers = `
let imageStageQueue=Promise.resolve();
function imageAssetKey(value){
  return String(value||'').replace(/&/g,'e').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function playerAssetKey(player){return imageAssetKey(String(player?.cognome||'')+String(player?.nome||''))}
function imageAssetPath(type,key){return state.tournament+'/immagini/'+(type==='player'?'giocatori':'squadre')+'/'+key+'.webp'}
function fileToBase64(file){
  return file.arrayBuffer().then(buffer=>{const bytes=new Uint8Array(buffer);let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary)});
}
function addPublicImageKey(indexText,type,key){
  const constName=type==='player'?'STATIC_PLAYER_IMAGE_KEYS':'STATIC_TEAM_IMAGE_KEYS';
  const re=new RegExp('(const\\\\s+'+constName+'\\\\s*=\\\\s*new Set\\\\(\\\\[)([\\\\s\\\\S]*?)(\\\\]\\\\);)');
  const match=String(indexText||'').match(re);if(!match)throw new Error('Nel frontend del torneo non trovo '+constName+'. Nessuna immagine e stata pubblicata.');
  const existing=[...match[2].matchAll(/['\"]([^'\"]+)['\"]/g)].map(m=>imageAssetKey(m[1]));
  if(existing.includes(key))return indexText;
  const body=match[2].replace(/\\s*$/,'');const comma=body.trim()&&!body.trim().endsWith(',')?',':'';const replacement=match[1]+body+comma+'\\n  \\''+key+'\\'\\n'+match[3];
  return String(indexText).replace(re,replacement);
}
async function stageWebpUpload(file,type,key,label){
  if(!file)return;if(!key)throw new Error('Nome non sufficiente per generare il file immagine.');
  if(!/\\.webp$/i.test(file.name||''))throw new Error('Seleziona un file in formato .webp.');
  if(file.size>2500000)throw new Error('Immagine troppo grande: massimo 2,5 MB.');
  const target=requireTarget(state.target);const imagePath=imageAssetPath(type,key);const indexPath=state.tournament+'/index.html';
  const currentIndex=state.pending.get(indexPath)?.content??await getTextFile(target,indexPath);const patchedIndex=addPublicImageKey(currentIndex,type,key);const contentBase64=await fileToBase64(file);
  state.pending.set(imagePath,{path:imagePath,contentBase64,binary:true,source:'Immagine '+label+' -> '+key+'.webp'});
  if(patchedIndex!==currentIndex)state.pending.set(indexPath,{path:indexPath,content:patchedIndex,source:'Registro immagini frontend'});
  state.status={type:'success',text:'Immagine '+label+' pronta: '+imagePath+'. Sara pubblicata insieme alle altre modifiche.'};render();
}
function queueWebpUpload(file,type,key,label){
  imageStageQueue=imageStageQueue.then(()=>stageWebpUpload(file,type,key,label)).catch(error=>{state.status={type:'error',text:error.message||String(error)};render()});return imageStageQueue;
}
function imageUploadRow(label,type,key){
  const row=el('div','image-upload-row');const copy=el('div','image-upload-copy');copy.appendChild(el('strong','',label));const path=key?imageAssetPath(type,key):'Nome/cognome mancanti';copy.appendChild(el('code','',path));
  if(key&&state.pending.has(path))copy.appendChild(el('div','image-upload-pending','Pronta per la pubblicazione'));
  row.appendChild(copy);const picker=input('file');picker.accept='.webp,image/webp';picker.style.display='none';const b=button('Carica .webp','secondary small',()=>picker.click());b.disabled=!key;picker.addEventListener('change',()=>{const file=picker.files?.[0];if(file)queueWebpUpload(file,type,key,label)});row.appendChild(b);row.appendChild(picker);return row;
}
function renderImageUploadSection(team,draft){
  const sec=el('div','image-upload-section');sec.appendChild(el('h4','','Immagini WebP'));sec.appendChild(el('p','image-upload-help','Il nome file viene generato automaticamente senza spazi, simboli o accenti. Le immagini vengono pubblicate in tornei/<edizione>/immagini e registrate nel frontend del torneo.'));
  sec.appendChild(imageUploadRow('Squadra '+team.name,'team',imageAssetKey(team.name)));
  const details=el('details','image-player-details');const summary=el('summary','','Foto giocatori');details.appendChild(summary);
  (draft||[]).filter(p=>String(p.nome||p.cognome||'').trim()).forEach(p=>{const label=[p.cognome,p.nome].filter(Boolean).join(' ').trim();details.appendChild(imageUploadRow(label,'player',playerAssetKey(p)))});sec.appendChild(details);return sec;
}
`;
  s = replaceOnce(s, "function renderSquadre(main){", imageHelpers + "\nfunction renderSquadre(main){", 'helper upload immagini');
  s = replaceOnce(
    s,
    "table.appendChild(tbody);wrap.appendChild(table);card.appendChild(wrap);const row=el('div','btn-row');",
    "table.appendChild(tbody);wrap.appendChild(table);card.appendChild(wrap);card.appendChild(renderImageUploadSection(team,draft));const row=el('div','btn-row');",
    'UI upload immagini'
  );

  // Pubblicazione: preserva il contenuto binario base64.
  s = replaceOnce(
    s,
    "const changesArr=[...state.pending.values()].map(({path,content,delete:del})=>({path,content,delete:del}));",
    "const changesArr=[...state.pending.values()].map(({path,content,contentBase64,binary,delete:del})=>({path,content,contentBase64,binary,delete:del}));",
    'publish WebP'
  );



  s += String.raw`

/* CRAL_ADMIN_V26_FANTA_MANIFEST_GUARD
   L'Admin puo' rigenerare manifest.csv quando prepara modifiche guidate.
   Manteniamo sempre le righe fantacalcio gia' pubblicate, senza toccare le altre. */
let cralV22ProtectedFantaManifestLines=[];
let cralV22ManifestReadKey='';
function cralV22ManifestLines(text){
  return String(text||'').replace(/\r\n?/g,'\n').split('\n').map(x=>x.trim()).filter(Boolean);
}
function cralV22FantaLineKey(line){
  return String(line||'').replace(/^data\//i,'').toLowerCase();
}
async function cralV22LoadProtectedManifest(){
  const dataRoot=state?.model?.dataRoot||state?.snapshot?.dataRoot||'';
  const tournament=state?.tournament||state?.snapshot?.tournament||'';
  const key=(state?.target||'')+'|'+tournament+'|'+dataRoot;
  if(!dataRoot||!tournament)return [];
  if(cralV22ManifestReadKey===key && cralV22ProtectedFantaManifestLines.length) return cralV22ProtectedFantaManifestLines;
  try{
    const target=requireTarget(state.target);
    const text=await getTextFile(target,dataRoot+'/manifest.csv');
    cralV22ProtectedFantaManifestLines=cralV22ManifestLines(text).filter(line=>/^fantacalcio\//i.test(line.replace(/^data\//i,'')));
    cralV22ManifestReadKey=key;
  }catch(error){
    console.warn('[CRAL Admin v26] lettura manifest Fantacalcio',error);
  }
  return cralV22ProtectedFantaManifestLines;
}
async function cralV22ProtectPendingManifest(){
  const dataRoot=state?.model?.dataRoot||state?.snapshot?.dataRoot||'';
  if(!dataRoot||!state?.pending)return;
  const path=dataRoot+'/manifest.csv';
  const pending=state.pending.get(path);
  if(!pending||pending.delete||typeof pending.content!=='string')return;
  const protectedLines=await cralV22LoadProtectedManifest();
  if(!protectedLines.length)return;
  const lines=cralV22ManifestLines(pending.content);
  const seen=new Set(lines.map(cralV22FantaLineKey));
  let changed=false;
  protectedLines.forEach(line=>{
    const key=cralV22FantaLineKey(line);
    if(!seen.has(key)){lines.push(line);seen.add(key);changed=true;}
  });
  if(changed){
    state.pending.set(path,{...pending,content:lines.join('\n')+'\n'});
  }
}
let cralV22ManifestGuardTimer=0;
function cralV22ScheduleManifestGuard(){
  clearTimeout(cralV22ManifestGuardTimer);
  cralV22ManifestGuardTimer=setTimeout(()=>{cralV22ProtectPendingManifest().catch(error=>console.warn('[CRAL Admin v26] protezione manifest',error));},30);
}
new MutationObserver(cralV22ScheduleManifestGuard).observe(document.getElementById('app')||document.body,{subtree:true,childList:true});
cralV22ScheduleManifestGuard();

/* CRAL_ADMIN_V16_AUTOGOAL_UI
   L'Admin mostra e modifica SEMPRE la squadra che commette l'autorete.
   Il select originale resta nascosto e conserva il formato storico beneficiary
   richiesto dai CSV: selezionando l'autrice, il valore sorgente viene impostato
   automaticamente sull'avversaria beneficiaria. */
function cralV16OtherTeam(match,team){
  const key=norm(team);
  if(key===norm(match.home))return match.away;
  if(key===norm(match.away))return match.home;
  return '';
}
function cralV16OwnText(node){
  return norm([...node.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent||'').join(' ').replace(/^[^A-Za-zÀ-ÿ0-9]+/,'').trim());
}
function cralV16FindMatchCard(match){
  const hk=norm(match.home),ak=norm(match.away);
  const heads=[...document.querySelectorAll('h1,h2,h3,h4,h5,strong,b,.card-title,.match-title')];
  const title=heads.find(n=>{const t=norm(n.textContent||'');return t.includes(hk)&&t.includes(ak)});
  if(title){
    let p=title;
    while(p&&p!==document.body){
      const t=norm(p.textContent||'');
      if(t.includes('autogoal')&&t.includes('premi')&&p.querySelectorAll('select').length>=2)return p;
      p=p.parentElement;
    }
  }
  const blocks=[...document.querySelectorAll('.card,article,section,main>div,#app>div,#app div')];
  return blocks.filter(p=>{const t=norm(p.textContent||'');return t.includes(hk)&&t.includes(ak)&&t.includes('autogoal')&&t.includes('premi')&&p.querySelectorAll('select').length>=2})
    .sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0]||null;
}
function cralV16Marker(card,key){
  const nodes=[...card.querySelectorAll('h2,h3,h4,h5,strong,b,span,div')].filter(n=>!n.matches('button')&&!n.querySelector('select,input,textarea'));
  return nodes.find(n=>{const own=cralV16OwnText(n);return own===key||own.endsWith(key)||own.startsWith(key)})||null;
}
function cralV16After(a,b){return !!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)}
function cralV16Between(node,start,end){return cralV16After(start,node)&&(!end||cralV16After(node,end))}
function cralV16SourceTeamSelects(card,match,start,end){
  return [...card.querySelectorAll('select:not(.cral-v16-own-goal-offender)')].filter(sel=>{
    if(sel.dataset.cralV16OwnGoalSource==='1')return true;
    if(!cralV16Between(sel,start,end))return false;
    const vals=[...sel.options].map(o=>norm(o.value||o.textContent));
    return vals.includes(norm(match.home))&&vals.includes(norm(match.away));
  });
}
function cralV16RowForSelect(sel,card){
  let p=sel.parentElement,best=sel.parentElement;
  while(p&&p!==card){
    const count=p.querySelectorAll('select').length;
    if(count>=2){best=p;break}
    p=p.parentElement;
  }
  return best;
}
function cralV16SetNativeSelect(select,value){
  if(!select)return;
  const normalized=norm(value);
  const option=[...select.options].find(o=>norm(o.value)===normalized);
  select.value=option?option.value:value;
  select.dispatchEvent(new Event('input',{bubbles:true}));
  select.dispatchEvent(new Event('change',{bubbles:true}));
}
function cralV16PopulatePlayer(select,offender,goal){
  if(!select||!offender)return;
  const current=String(goal?.player||select.value||'').trim();
  const roster=playersForTeam(state.model,offender)||[];
  const items=[{value:'',label:'— giocatore facoltativo —'},...roster.map(p=>({value:p.fullName||p.displayName||'',label:p.fullName||p.displayName||''})).filter(x=>x.value)];
  if(current&&!items.some(x=>norm(x.value)===norm(current)))items.push({value:current,label:current});
  const sig=norm(offender)+'|'+items.map(x=>norm(x.value)).join('|');
  if(select.dataset.cralV16Options!==sig){
    select.innerHTML='';
    items.forEach(x=>{const o=document.createElement('option');o.value=x.value;o.textContent=x.label;select.appendChild(o)});
    select.dataset.cralV16Options=sig;
  }
  select.value=items.find(x=>x.value===current)?.value||items.find(x=>norm(x.value)===norm(current))?.value||'';
  select.title='Giocatore che ha commesso l’autogoal (facoltativo)';
  select.setAttribute('aria-label',select.title);
}
function cralV16EnsureOffenderSelect(source,match,goal,row,playerSelect){
  source.dataset.cralV16OwnGoalSource='1';
  source.style.display='none';
  source.setAttribute('aria-hidden','true');
  source.tabIndex=-1;
  let mirror=row.querySelector('.cral-v16-own-goal-offender[data-source-id="'+(source.dataset.cralV16SourceId||'')+'"]');
  if(!source.dataset.cralV16SourceId)source.dataset.cralV16SourceId='ag'+Math.random().toString(36).slice(2);
  mirror=row.querySelector('.cral-v16-own-goal-offender[data-source-id="'+source.dataset.cralV16SourceId+'"]');
  if(!mirror){
    mirror=document.createElement('select');
    mirror.className=source.className+' cral-v16-own-goal-offender';
    mirror.dataset.sourceId=source.dataset.cralV16SourceId;
    mirror.title='Squadra che ha commesso l’autogoal';
    mirror.setAttribute('aria-label',mirror.title);
    [match.home,match.away].forEach(team=>{const o=document.createElement('option');o.value=team;o.textContent=team;mirror.appendChild(o)});
    source.insertAdjacentElement('afterend',mirror);
    mirror.addEventListener('change',()=>{
      const offender=mirror.value;
      const beneficiary=cralV16OtherTeam(match,offender);
      cralV16SetNativeSelect(source,beneficiary);
      // Il modello legacy continua a salvare beneficiary, ma l'associazione utente e' all'autrice.
      if(goal)goal.beneficiary=beneficiary;
      cralV16PopulatePlayer(playerSelect,offender,goal);
      cralV16ScheduleOwnGoals();
    });
  }
  const beneficiary=source.value||goal?.beneficiary||'';
  const offender=cralV16OtherTeam(match,beneficiary)||match.home;
  if([...mirror.options].some(o=>norm(o.value)===norm(offender)))mirror.value=[...mirror.options].find(o=>norm(o.value)===norm(offender)).value;
  cralV16PopulatePlayer(playerSelect,offender,goal);
  return mirror;
}
function cralV16EnhanceOwnGoals(){
  if(!state?.dayDraft?.matches?.length)return;
  state.dayDraft.matches.forEach(match=>{
    const goals=match.details?.ownGoals||[];if(!goals.length)return;
    const card=cralV16FindMatchCard(match);if(!card)return;
    const start=cralV16Marker(card,'autogoal');if(!start)return;
    const end=cralV16Marker(card,'premi');
    const sources=cralV16SourceTeamSelects(card,match,start,end).filter(x=>x.dataset.cralV16OwnGoalSource==='1'||cralV16Between(x,start,end)).slice(0,goals.length);
    sources.forEach((source,i)=>{
      const goal=goals[i]||{};
      const row=cralV16RowForSelect(source,card);
      const playerSelect=[...row.querySelectorAll('select:not(.cral-v16-own-goal-offender)')].find(x=>x!==source);
      cralV16EnsureOffenderSelect(source,match,goal,row,playerSelect);
      if(!row.dataset.cralV16Hint){
        row.dataset.cralV16Hint='1';
        const hint=document.createElement('div');hint.className='file-meta cral-autogoal-help';
        hint.textContent='Squadra/giocatore che ha commesso l’autorete. Il goal viene attribuito automaticamente all’avversaria.';
        hint.style.gridColumn='1 / -1';hint.style.marginTop='4px';row.appendChild(hint);
      }
    });
  });
}
let cralV16OwnGoalTimer=0;
function cralV16ScheduleOwnGoals(){
  clearTimeout(cralV16OwnGoalTimer);
  cralV16OwnGoalTimer=setTimeout(()=>{try{cralV16EnhanceOwnGoals()}catch(error){console.warn('[CRAL Admin v26] autogoal UI',error)}},20);
}
new MutationObserver(cralV16ScheduleOwnGoals).observe(document.getElementById('app')||document.body,{subtree:true,childList:true});
document.addEventListener('change',cralV16ScheduleOwnGoals,true);
cralV16ScheduleOwnGoals();
`;

  return s;
}

function moduleUrl(source, name) {
  return URL.createObjectURL(new Blob([`${source}\n//# sourceURL=${name}`], { type: 'text/javascript' }));
}

async function boot() {
  try {
    const [coreOriginal, ghOriginal, adminOriginal] = await Promise.all([
      loadSource('core.js'), loadSource('gh.js'), loadSource('admin.js')
    ]);

    let ghPatched = patchGh(ghOriginal);
    const csvUrl = new URL('./csv.js', BASE).href;
    const tournamentUrl = new URL('./tournament.js', BASE).href;
    ghPatched = ghPatched.replace("from './csv.js';", `from '${csvUrl}';`);
    ghPatched = ghPatched.replace("from './tournament.js';", `from '${tournamentUrl}';`);

    const coreUrl = moduleUrl(patchCore(coreOriginal), 'cral-core-v29.js');
    const ghUrl = moduleUrl(ghPatched, 'cral-gh-v29.js');
    const adminUrl = moduleUrl(patchAdmin(adminOriginal, coreUrl, ghUrl), 'cral-admin-v29.js');

    await import(adminUrl);
  } catch (error) {
    console.error('[CRAL Admin v29]', error);
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'max-width:760px;margin:40px auto;padding:24px;font-family:Inter,sans-serif;background:#fff;border-radius:16px;box-shadow:0 10px 30px #0002';
      const title = document.createElement('h2'); title.textContent = 'Errore bootstrap Admin v29';
      const text = document.createElement('p'); text.textContent = error?.message || String(error);
      const hint = document.createElement('p'); hint.textContent = 'Controlla che admin.js, core.js e gh.js siano quelli della versione corrente del repository, poi ricarica la pagina.';
      wrap.append(title, text, hint); app.appendChild(wrap);
    }
  }
}

boot();
