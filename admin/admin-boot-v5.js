/*
 * CRAL Champions Admin - bootstrap logica v5
 *
 * Mantiene i moduli originali come sorgente unica e applica, al caricamento,
 * patch mirate a core.js / gh.js / admin.js. In questo modo il deploy resta
 * piccolo e non duplica centinaia di righe di codice applicativo.
 */

const BASE = new URL('./', import.meta.url);
const VERSION = '5';

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch v5 non applicabile (${label}). Ricarica i file Admin dalla versione attesa.`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`Patch v5 non applicabile (${label}). Ricarica i file Admin dalla versione attesa.`);
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

async function loadSource(name) {
  const url = new URL(name, BASE);
  url.searchParams.set('v5src', VERSION);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Impossibile caricare ${name}: HTTP ${response.status}`);
  return response.text();
}

function patchCore(source) {
  let s = source;

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
      if (![match.home,match.away].some(t => norm(t) === norm(agRow.beneficiary))) errors.push(\`${'${label}'}: squadra beneficiaria autogoal non valida.\`);
      if (!Number.isInteger(Number(agRow.qty)) || Number(agRow.qty) < 1) errors.push(\`${'${label}'}: quantità autogoal non valida.\`);
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
    `function rosterPlayerMatch(team,value){
  const token=norm(value);if(!token)return null;
  const candidates=playersForTeam(state.model,team).filter(p=>[p.fullName,p.displayName,p.nome,p.cognome].some(x=>norm(x)===token));
  return candidates.length===1?candidates[0]:null;
}
function draftKey(day){return \`cral-admin-draft-v5|${'${state.target}'}|${'${state.tournament}'}|${'${day}'}\`}
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

    const coreUrl = moduleUrl(patchCore(coreOriginal), 'cral-core-v5.js');
    const ghUrl = moduleUrl(ghPatched, 'cral-gh-v5.js');
    const adminUrl = moduleUrl(patchAdmin(adminOriginal, coreUrl, ghUrl), 'cral-admin-v5.js');

    await import(adminUrl);
  } catch (error) {
    console.error('[CRAL Admin v5]', error);
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'max-width:760px;margin:40px auto;padding:24px;font-family:Inter,sans-serif;background:#fff;border-radius:16px;box-shadow:0 10px 30px #0002';
      const title = document.createElement('h2'); title.textContent = 'Errore bootstrap Admin v5';
      const text = document.createElement('p'); text.textContent = error?.message || String(error);
      const hint = document.createElement('p'); hint.textContent = 'Controlla che admin.js, core.js e gh.js siano quelli della versione corrente del repository, poi ricarica la pagina.';
      wrap.append(title, text, hint); app.appendChild(wrap);
    }
  }
}

boot();
