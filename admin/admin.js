import {
  buildMatchdayPublication, buildModel, csvStringify, existingMatchdayDetails,
  fileKind, manifestChange, norm, objectRows, pagelloneText, parsePagellone, playersForTeam, relativeDataPath, rosterCsv,
  safeTeamFilename, sectionFiles, validateMatchdayDraft, validatePagelloneEntries
} from './core.js';
import {
  DEFAULT_TARGETS, verifyTarget, getTournaments, getSnapshot,
  publishChanges as ghPublishChanges, createTournament as ghCreateTournament,
  saveSession, loadSession, clearSession
} from './gh.js';
import { parseTournamentRegistry } from './tournament.js';

const app = document.getElementById('app');
const state = {
  target: 'collaudo',
  tournament: 'tornei/2026-spring',
  snapshot: null,
  model: null,
  tournaments: [],
  registryWarning: '',
  active: 'dashboard',
  pending: new Map(),
  selectedDay: null,
  dayDraft: null,
  selectedTeam: '',
  selectedFile: '',
  calendarDraft: null,
  selectedPagelloneDay: null,
  pagelloneDraft: null,
  pagelloneDirty: false,
  status: null,
  busy: false,
  targets: { collaudo: null, produzione: null }
};

function el(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
  return node;
}
function button(text, cls, onClick, title='') {
  const b=el('button',`btn ${cls||''}`,text); b.type='button'; if(title)b.title=title; if(onClick)b.addEventListener('click',onClick); return b;
}
function input(type='text', value='', cls='input') { const i=el('input',cls); i.type=type; i.value=value??''; return i; }
function select(options, value='', cls='select') {
  const s=el('select',cls); options.forEach(o=>{const opt=el('option','',o.label??o.value??o);opt.value=o.value??o;if(String(opt.value)===String(value))opt.selected=true;s.appendChild(opt)});return s;
}
function fieldWrap(label,node){const w=el('div','field');w.appendChild(el('label','',label));w.appendChild(node);return w}
function messageBox(type, lines) {
  const box=el('div',`${type}-box`); (Array.isArray(lines)?lines:[lines]).filter(Boolean).forEach((x,i)=>{if(i)box.appendChild(document.createElement('br'));box.appendChild(document.createTextNode(String(x)))});return box;
}
function setStatus(type, text){state.status={type,text}; render();}

function requireTarget(key){
  const t = state.targets[key];
  if(!t){const e=new Error('Ambiente non configurato.');e.status=401;throw e}
  return t;
}

// ---------------- logo pubblico (schermata di login) ----------------
function rawGithubUrl(owner, repo, branch, path) {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${String(path || '').replace(/^\/+/, '')}`;
}
async function resolveLogoUrl(owner, repo, branch) {
  if (!owner || !repo || !branch) return '';
  try {
    const res = await fetch(rawGithubUrl(owner, repo, branch, 'tornei.json'), { cache: 'no-store' });
    if (!res.ok) return '';
    const registry = parseTournamentRegistry(await res.text());
    let logoPath = String(registry.logo || '').trim();
    if (!logoPath) {
      const current = (registry.tornei || []).find(t => t.corrente) || (registry.tornei || [])[0];
      const folder = current?.cartella ? String(current.cartella).replace(/^\/+|\/+$/g, '') : '';
      if (folder) logoPath = `${folder}/immagini/logo_cral.png`;
    }
    return logoPath ? rawGithubUrl(owner, repo, branch, logoPath) : '';
  } catch { return ''; }
}
function loadBrandLogo(markEl, owner, repo, branch) {
  const requestId = (markEl._logoRequest = (markEl._logoRequest || 0) + 1);
  resolveLogoUrl(owner, repo, branch).then(url => {
    if (!url || markEl._logoRequest !== requestId) return;
    const img = new Image();
    img.alt = 'Logo CRAL Champions Auriga';
    img.onload = () => { if (markEl._logoRequest !== requestId) return; markEl.textContent = ''; markEl.classList.add('brand-mark-logo'); markEl.appendChild(img); };
    img.onerror = () => {};
    img.src = url;
  }).catch(() => {});
}

// ---------------- sessione / login ----------------
function sessionCheck(){
  const restored = loadSession();
  if (restored && (restored.collaudo || restored.produzione)) {
    state.targets = restored;
    if (state.targets[state.target]) {
      initializeAdmin().catch(e=>{
        if(e.status===401) renderLogin(state.target,'Il token salvato non è più valido: inseriscilo di nuovo.');
        else renderFatal(e.message);
      });
      return;
    }
  }
  renderLogin(state.target);
}
async function loadTournamentList(){
  const target = requireTarget(state.target);
  const data = await getTournaments(target);
  state.tournaments = data.tournaments || [];
  state.registryWarning = data.registryWarning || '';
  return data;
}
async function initializeAdmin(){
  await loadTournamentList();
  if(!state.tournaments.some(t=>t.path===state.tournament)){
    state.tournament = state.tournaments.find(t=>t.current)?.path || state.tournaments[0]?.path || state.tournament;
  }
  return loadSnapshot(false);
}

function renderLogin(targetKey='collaudo', error=''){
  app.innerHTML=''; const screen=el('div','center-screen'); const card=el('div','login-card');
  const brand=el('div','brand');const mark=el('div','brand-mark','CR');brand.appendChild(mark);const copy=el('div');copy.appendChild(el('h1','','CRAL Admin'));copy.appendChild(el('p','','Gestione dati e pubblicazione sicura del torneo — versione statica GitHub Pages'));brand.appendChild(copy);card.appendChild(brand);
  card.appendChild(messageBox('info',[
    'Nessun server: questa pagina scrive su GitHub usando direttamente il tuo Personal Access Token.',
    'Il token resta solo in questa scheda del browser (sessionStorage) finché non premi "Esci" o la chiudi. Usa un token fine-grained, limitato al solo repository, con scadenza breve.'
  ]));
  if(error)card.appendChild(messageBox('error',error));

  const existing = state.targets[targetKey] || {};
  const def = DEFAULT_TARGETS[targetKey] || DEFAULT_TARGETS.collaudo;

  const envSel = select([{value:'collaudo',label:'Collaudo'},{value:'produzione',label:'Produzione'}], targetKey);
  envSel.addEventListener('change', () => renderLogin(envSel.value));
  card.appendChild(fieldWrap('Ambiente', envSel));

  const owner = input('text', existing.owner ?? def.owner);
  const repo = input('text', existing.repo ?? def.repo);
  const branch = input('text', existing.branch ?? def.branch);
  const publicBaseUrl = input('text', existing.publicBaseUrl ?? '');
  publicBaseUrl.placeholder = `https://${(existing.owner ?? def.owner)}.github.io/${(existing.repo ?? def.repo)} (opzionale)`;
  const token = input('password', '');
  token.autocomplete = 'off';
  token.placeholder = 'ghp_… oppure github_pat_…';

  card.appendChild(fieldWrap('Owner / organizzazione repository', owner));
  card.appendChild(fieldWrap('Nome repository', repo));
  card.appendChild(fieldWrap('Branch', branch));
  card.appendChild(fieldWrap('URL pubblico GitHub Pages (opzionale)', publicBaseUrl));
  card.appendChild(fieldWrap('Personal Access Token GitHub (Contents: Read and write)', token));

  loadBrandLogo(mark, owner.value.trim(), repo.value.trim(), branch.value.trim() || 'main');
  const refreshLogo = () => loadBrandLogo(mark, owner.value.trim(), repo.value.trim(), branch.value.trim() || 'main');
  [owner, repo, branch].forEach(f => f.addEventListener('blur', refreshLogo));

  const go = button('Verifica e accedi', 'gold', async () => {
    go.disabled = true; go.textContent = 'Verifica in corso…';
    const target = {
      key: targetKey,
      owner: owner.value.trim(),
      repo: repo.value.trim(),
      branch: branch.value.trim() || 'main',
      publicBaseUrl: publicBaseUrl.value.trim(),
      token: token.value.trim(),
      label: def.label
    };
    try {
      await verifyTarget(target);
      state.targets[targetKey] = target;
      state.target = targetKey;
      saveSession(state.targets);
      await initializeAdmin();
    } catch (e) {
      renderLogin(targetKey, e.message);
    }
  });
  go.style.width = '100%';
  card.appendChild(go);
  token.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
  screen.appendChild(card); app.appendChild(screen);
  setTimeout(() => token.focus(), 0);
}
function renderFatal(text){app.innerHTML='';const screen=el('div','center-screen');const card=el('div','login-card');card.appendChild(messageBox('error',text));card.appendChild(button('Riprova','secondary',sessionCheck));screen.appendChild(card);app.appendChild(screen)}

async function loadSnapshot(confirmDiscard=true){
  if(confirmDiscard&&state.pending.size&&!window.confirm('Ci sono modifiche non pubblicate. Ricaricando verranno scartate. Continuare?'))return false;
  state.busy=true; renderLoading('Caricamento dati dal repository…');
  try{
    const target = requireTarget(state.target);
    const snap = await getSnapshot(target, state.tournament);
    state.snapshot=snap;state.model=buildModel(snap);state.tournament=snap.tournament;state.pending.clear();state.selectedFile='';state.calendarDraft=null;state.selectedTeam=state.model.teams[0]?.name||'';
    const last=state.model.days.at(-1)||1; state.selectedDay=last;state.dayDraft=makeDayDraft(last);state.selectedPagelloneDay=last;state.pagelloneDraft=null;state.pagelloneDirty=false;state.status=snap.skipped?.length?{type:'warning',text:`${snap.skipped.length} file tecnici troppo grandi non sono stati caricati nell'editor.`}:(state.registryWarning?{type:'warning',text:`Attenzione: ${state.registryWarning} I tornei vengono comunque rilevati dalle cartelle reali, ma correggi tornei.json prima di creare una nuova edizione.`}:null);state.busy=false;render();
    return true;
  }catch(e){state.busy=false;if(e.status===401){renderLogin(state.target,'Sessione GitHub scaduta o token non più valido: accedi di nuovo.');return false}renderFatal(e.message);return false}
}
function renderLoading(text){app.innerHTML='';const screen=el('div','center-screen');const card=el('div','login-card');const row=el('div','btn-row');const spin=el('span','spinner');spin.style.color='var(--blue)';row.appendChild(spin);row.appendChild(el('strong','',text));card.appendChild(row);screen.appendChild(card);app.appendChild(screen)}

function draftKey(day){return `cral-admin-draft|${state.target}|${state.tournament}|${day}`}
function saveLocalDayDraft(){if(!state.dayDraft||!state.snapshot)return;try{localStorage.setItem(draftKey(state.dayDraft.day),JSON.stringify({commit:state.snapshot.commitSha,draft:state.dayDraft}))}catch{}}
function makeDayDraft(day){
  const matches=state.model.matches.filter(m=>Number(m.day)===Number(day)).map(m=>{
    const d=existingMatchdayDetails(state.model,m);const internal=[],external=[];
    (d.scorers||[]).forEach(s=>(s.external||norm(s.player)==='esterno'?external:internal).push({team:s.team||m.home,player:s.player||'',qty:Number(s.qty||1),external:!!s.external}));
    return {...structuredClone(m),day:Number(day),details:{...d,scorers:internal,externalGoals:external.map(s=>({team:s.team||m.home,player:norm(s.player)==='esterno'?'':s.player,qty:s.qty})),ownGoals:d.ownGoals||[]}};
  });
  const fresh={day:Number(day),matches};
  try{const saved=JSON.parse(localStorage.getItem(draftKey(day))||'null');if(saved?.commit===state.snapshot.commitSha&&saved.draft)return saved.draft}catch{}
  return fresh;
}
function switchDay(day){state.selectedDay=Number(day);state.dayDraft=makeDayDraft(day);render()}
function touchDraft(){saveLocalDayDraft()}

function effectiveModel(){
  if(!state.snapshot)return state.model;
  const files={...state.snapshot.files};
  state.pending.forEach(change=>{
    if(change.delete){delete files[change.path];return}
    const old=files[change.path]||{};
    const text=String(change.content??'');
    files[change.path]={...old,text,size:new Blob([text]).size};
  });
  return buildModel({...state.snapshot,files});
}
function refreshModelFromPending(){
  const selected=state.selectedTeam;
  state.model=effectiveModel();
  if(selected&&state.model.teams.some(t=>t.name===selected))state.selectedTeam=selected;
  else state.selectedTeam=state.model.teams[0]?.name||'';
}
function stageGuidedChanges(changes,source,{manifest=true}={}){
  const before=effectiveModel();
  const list=[...changes];
  if(manifest){
    const m=manifestChange(before,list);
    const current=before.fileList.find(f=>f.path===m.path)?.text||'';
    if(String(current).replace(/\r\n/g,'\n')!==String(m.content).replace(/\r\n/g,'\n'))list.push(m);
  }
  list.forEach(c=>state.pending.set(c.path,{...c,source}));
  refreshModelFromPending();
  return list.length;
}

function render(){
  if(!state.model)return;app.innerHTML='';renderTopbar();const layout=el('div','layout');layout.appendChild(renderSidebar());const main=el('main','main');if(state.status)main.appendChild(messageBox(state.status.type,state.status.text));
  if(state.active==='dashboard')renderDashboard(main);else if(state.active==='newTournament')renderNewTournament(main);else if(state.active==='giornata')renderGiornata(main);else if(state.active==='squadre')renderSquadre(main);else if(state.active==='calendario')renderCalendario(main);else if(state.active==='pagellone')renderPagellone(main);else if(state.active==='classifiche')renderClassifiche(main);else if(state.active==='files')renderFiles(main);else if(state.active==='publish')renderPublish(main);layout.appendChild(main);app.appendChild(layout)
}
function renderTopbar(){
  const top=el('header','topbar');const inner=el('div','topbar-inner');inner.appendChild(el('div','top-title','CRAL Champions · Admin'));
  const controls=el('div','env-controls');const env=select([{value:'collaudo',label:'Collaudo'},{value:'produzione',label:'Produzione'}],state.target);if(state.target==='produzione')env.classList.add('select-prod');env.addEventListener('change',async()=>{
    const next=env.value;if(next===state.target)return;
    if(state.pending.size&&!window.confirm('Cambiare ambiente scarterà le modifiche non pubblicate. Continuare?')){env.value=state.target;return}
    if(!state.targets[next]){state.target=next;renderLogin(next,`Configura l'ambiente ${next==='produzione'?'Produzione':'Collaudo'} per continuare.`);return}
    state.target=next;state.busy=true;renderLoading('Caricamento ambiente…');
    try{await initializeAdmin()}catch(e){state.busy=false;if(e.status===401){renderLogin(next);return}renderFatal(e.message)}
  });controls.appendChild(env);
  const tournamentOptions=state.tournaments.map(t=>({value:t.path,label:`${t.current?'★ ':''}${t.title||t.path}`}));
  if(!tournamentOptions.some(o=>o.value===state.tournament))tournamentOptions.unshift({value:state.tournament,label:state.tournament});
  const tp=select(tournamentOptions,state.tournament);tp.addEventListener('change',async()=>{const next=tp.value;if(!next||next===state.tournament)return;if(state.pending.size&&!window.confirm('Cambiare torneo scarterà le modifiche non pubblicate. Continuare?')){tp.value=state.tournament;return}state.tournament=next;await loadSnapshot(false)});controls.appendChild(tp);
  controls.appendChild(button('+ Nuovo torneo','secondary',()=>{state.active='newTournament';render()}));
  controls.appendChild(button('Ricarica','secondary',async()=>{await loadTournamentList();await loadSnapshot(true)}));
  controls.appendChild(button('Esci','ghost',()=>{clearSession();state.targets={collaudo:null,produzione:null};state.snapshot=null;state.model=null;renderLogin('collaudo')}));
  inner.appendChild(controls);top.appendChild(inner);app.appendChild(top)
}
function renderSidebar(){
  const side=el('nav','sidebar');const items=[['dashboard','🏠','Dashboard'],['newTournament','➕','Nuovo torneo'],['giornata','⚽','Giornata'],['squadre','👕','Squadre'],['calendario','📅','Calendario'],['pagellone','📣','Pagellone'],['classifiche','🏆','Classifiche'],['files','🗂️','File'],['publish','🚀','Pubblica']];
  items.forEach(([id,icon,label])=>{const b=el('button',`nav-btn ${state.active===id?'active':''}`);b.type='button';b.appendChild(document.createTextNode(`${icon} ${label}`));if(id==='publish'&&state.pending.size)b.appendChild(el('span','pending-pill',state.pending.size));b.addEventListener('click',()=>{state.active=id;render()});side.appendChild(b)});return side
}
function pageHead(title,sub,actions=[]){const wrap=el('div','page-head');const copy=el('div');copy.appendChild(el('h2','',title));copy.appendChild(el('p','',sub));wrap.appendChild(copy);if(actions.length){const row=el('div','btn-row');actions.forEach(a=>row.appendChild(a));wrap.appendChild(row)}return wrap}

function renderDashboard(main){
  main.appendChild(pageHead('Dashboard',`Repository ${state.snapshot.repository} · Torneo ${state.tournament}`));
  const grid=el('div','grid');
  grid.appendChild((()=>{const k=el('div','kpi');k.appendChild(el('b','',state.model.teams.length));k.appendChild(el('span','','Squadre'));return k})());
  grid.appendChild((()=>{const k=el('div','kpi');k.appendChild(el('b','',state.model.days.length));k.appendChild(el('span','','Giornate'));return k})());
  grid.appendChild((()=>{const k=el('div','kpi');k.appendChild(el('b','',state.model.matches.length));k.appendChild(el('span','','Partite registrate'));return k})());
  grid.appendChild((()=>{const k=el('div','kpi');k.appendChild(el('b','',state.pending.size));k.appendChild(el('span','','Modifiche in sospeso'));return k})());
  main.appendChild(grid);
  const info=el('div','card');info.appendChild(el('h3','','Stato sorgenti'));const commit=el('div','small');commit.appendChild(document.createTextNode('Commit caricato: '));commit.appendChild(el('span','mono',state.snapshot.commitSha));info.appendChild(commit);info.appendChild(el('p','small muted',`File caricati dall'Admin: ${state.model.fileList.length}. Il frontend pubblico continua a leggere gli stessi CSV/TXT tramite manifest e classificazione per nome.`));if(state.pending.size)info.appendChild(messageBox('warning',`${state.pending.size} file modificati sono pronti ma non ancora pubblicati.`));main.appendChild(info)
}

function slugPart(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
function renderNewTournament(main){
  main.appendChild(pageHead('Nuovo torneo','Crea una nuova edizione senza duplicare i dati del torneo precedente. Vengono copiati solo il motore index.html e, se presente, il logo CRAL.'));
  if(state.pending.size)main.appendChild(messageBox('warning','Hai modifiche dati non ancora pubblicate sul torneo corrente. La creazione di un nuovo torneo e un commit separato: pubblicale o scartale prima per evitare confusione.'));
  const yearDefault=String(new Date().getFullYear());
  const card=el('div','card wizard-card');
  card.appendChild(messageBox('info','Il template serve solo per riusare la versione corrente dell’app pubblica. Il nuovo data/ nasce vuoto ma con manifest, config e CSV base validi.'));
  const grid=el('div','wizard-grid');
  const year=input('number',yearDefault);year.min='2020';year.max='2100';
  const season=input('text','Primavera');
  const id=input('text',`${yearDefault}-primavera`);
  const title=input('text',`CRAL Champions - Primavera ${yearDefault}`);
  const description=input('text','Classifiche, calendario, risultati e statistiche giocatori');
  const templates=state.tournaments.map(t=>({value:t.path,label:t.title||t.path}));
  const template=select(templates,state.tournament);
  let idManuallyChanged=false,titleManuallyChanged=false;
  const auto=()=>{const y=String(year.value||'').trim();const se=String(season.value||'').trim();if(!idManuallyChanged)id.value=`${y}-${slugPart(se)||'torneo'}`;if(!titleManuallyChanged)title.value=`CRAL Champions - ${se||'Torneo'} ${y}`};
  year.addEventListener('input',auto);season.addEventListener('input',auto);id.addEventListener('input',()=>idManuallyChanged=true);title.addEventListener('input',()=>titleManuallyChanged=true);
  grid.appendChild(fieldWrap('Anno',year));grid.appendChild(fieldWrap('Stagione / nome edizione',season));grid.appendChild(fieldWrap('ID cartella',id));grid.appendChild(fieldWrap('Titolo pubblico',title));grid.appendChild(fieldWrap('Descrizione / sottotitolo',description));grid.appendChild(fieldWrap('Template applicazione',template));
  card.appendChild(grid);
  const current=input('checkbox');current.checked=true;const cr=el('label','checkbox-row');cr.appendChild(current);cr.appendChild(document.createTextNode(' Imposta come torneo corrente in tornei.json'));card.appendChild(cr);
  let prodConfirm=null;if(state.target==='produzione'){card.appendChild(messageBox('warning','Stai creando direttamente nel repository di PRODUZIONE. Per sicurezza e consigliato creare prima in Collaudo.'));prodConfirm=input('text','');prodConfirm.placeholder='CREA TORNEO PRODUZIONE';card.appendChild(fieldWrap('Conferma produzione',prodConfirm))}
  const summary=el('div','creation-summary');summary.appendChild(el('strong','','Verranno creati:'));summary.appendChild(el('div','small muted','index.html dal template, logo CRAL se disponibile, data/config.csv, data/manifest.csv, classifiche vuote, risultati, calendario, riepilogo e aggiornamento di tornei.json.'));card.appendChild(summary);
  const actions=el('div','btn-row');actions.style.marginTop='14px';actions.appendChild(button('Crea torneo','gold',()=>createTournament({id:id.value,year:year.value,season:season.value,name:season.value,title:title.value,description:description.value,makeCurrent:current.checked},template.value,prodConfirm?.value||'')));card.appendChild(actions);main.appendChild(card)
}
async function createTournament(tournament,templateTournament,productionConfirmation){
  if(state.pending.size){state.status={type:'error',text:'Pubblica o scarta prima le modifiche dati del torneo corrente.'};render();return}
  if(!templateTournament){state.status={type:'error',text:'Nessun torneo template disponibile nel repository.'};render();return}
  const path=`tornei/${String(tournament.id||'').trim().toLowerCase()}`;
  if(!window.confirm(`Creare ${path} in ${state.target.toUpperCase()}? L’operazione crea un commit atomico su GitHub.`))return;
  state.busy=true;renderLoading('Creazione del nuovo torneo…');
  try{
    const target=requireTarget(state.target);
    const result=await ghCreateTournament(target,{baseCommitSha:state.snapshot.commitSha,templateTournament,tournament,productionConfirmation});
    await loadTournamentList();state.tournament=result.tournament;await loadSnapshot(false);state.active='squadre';state.status={type:'success',text:`Torneo ${result.tournament} creato. Ora puoi creare le squadre, poi il calendario e infine le giornate. Commit ${result.sha.slice(0,8)}.`};render();
  }catch(e){state.busy=false;if(e.status===409){state.status={type:'error',text:e.message};state.active='newTournament';render();return}if(e.status===401){renderLogin(state.target,'Sessione GitHub scaduta o token non più valido: accedi di nuovo.');return}state.status={type:'error',text:e.message};state.active='newTournament';render()}
}

function teamOptions(match, includeBlank=false){const a=[];if(includeBlank)a.push({value:'',label:'—'});[match.home,match.away].filter(Boolean).forEach(t=>a.push({value:t,label:t}));return a}
function playerOptions(team, includeBlank=true,current=''){const opts=includeBlank?[{value:'',label:'— seleziona —'}]:[];playersForTeam(state.model,team).forEach(p=>opts.push({value:p.fullName,label:p.displayName}));if(current&&!opts.some(o=>norm(o.value)===norm(current)))opts.splice(includeBlank?1:0,0,{value:current,label:`${current} · valore file`});return opts}
function addManualMatch(){const teams=state.model.teams.map(t=>t.name);const home=teams[0]||'',away=teams[1]||'';state.dayDraft.matches.push({id:`manual-${Date.now()}`,day:state.dayDraft.day,date:'',home,away,homeGoals:null,awayGoals:null,notes:'',forfeit:false,penalizedTeam:'',details:{scorers:[],externalGoals:[],ownGoals:[],mvp:null,keeper:null}});touchDraft();render()}
function renderGiornata(main){
  const days=[...new Set([...state.model.days,state.selectedDay,(state.model.days.at(-1)||0)+1].filter(Boolean))].sort((a,b)=>a-b);const daySel=select(days.map(d=>({value:d,label:`Giornata ${d}`})),state.selectedDay);daySel.addEventListener('change',()=>switchDay(daySel.value));
  const actions=[button('+ Partita','secondary',addManualMatch),button('Prepara pubblicazione','gold',prepareMatchday)];main.appendChild(pageHead('Gestione giornata','Risultati, marcatori, MVP, miglior portiere e autogol con controlli di coerenza.',actions));
  const toolbar=el('div','card day-toolbar');toolbar.appendChild(fieldWrap('Giornata',daySel));const reset=button('Ripristina dati repository','ghost',()=>{localStorage.removeItem(draftKey(state.selectedDay));state.dayDraft=makeDayDraft(state.selectedDay);render()});toolbar.appendChild(reset);main.appendChild(toolbar);
  const validation=validateMatchdayDraft(state.model,state.dayDraft);if(validation.errors.length)main.appendChild(messageBox('error',validation.errors));else if(validation.warnings.length)main.appendChild(messageBox('warning',validation.warnings));
  if(!state.dayDraft.matches.length){const empty=el('div','card');empty.appendChild(messageBox('info','Nessuna partita trovata per questa giornata. Aggiungila manualmente oppure compila prima il calendario.'));main.appendChild(empty);return}
  const grid=el('div','match-grid');state.dayDraft.matches.forEach((m,i)=>grid.appendChild(renderMatchCard(m,i)));main.appendChild(grid)
}
function renderMatchCard(match,index){
  const card=el('article','match-card');const head=el('div','match-head');const title=el('div','match-title');title.appendChild(el('span','',`${match.home||'?'}  vs  ${match.away||'?'}`));const del=button('Rimuovi','danger',()=>{state.dayDraft.matches.splice(index,1);touchDraft();render()});del.classList.add('small');title.appendChild(del);head.appendChild(title);head.appendChild(el('div','match-sub',`Giornata ${match.day}${match.date?' · '+match.date:''}`));card.appendChild(head);
  const body=el('div');const meta=el('div','match-body');const teams=state.model.teams.map(t=>({value:t.name,label:t.name}));
  const metaGrid=el('div','award-grid');const home=select(teams,match.home);const away=select(teams,match.away);home.addEventListener('change',()=>{match.home=home.value;touchDraft();render()});away.addEventListener('change',()=>{match.away=away.value;touchDraft();render()});metaGrid.appendChild(fieldWrap('Squadra casa',home));metaGrid.appendChild(fieldWrap('Squadra trasferta',away));const date=input('text',match.date||'');date.placeholder='gg/mm/aaaa o testo libero';date.addEventListener('input',()=>{match.date=date.value;touchDraft()});metaGrid.appendChild(fieldWrap('Data',date));const notes=input('text',match.notes||'');notes.placeholder='Note partita';notes.addEventListener('input',()=>{match.notes=notes.value;touchDraft()});metaGrid.appendChild(fieldWrap('Note',notes));meta.appendChild(metaGrid);body.appendChild(meta);
  const score=el('div','score-editor');const hs=el('div','score-side');hs.appendChild(el('strong','',match.home||'Casa'));const hi=input('number',match.homeGoals??'','score-input');hi.min='0';hi.addEventListener('input',()=>{match.homeGoals=hi.value===''?null:Number(hi.value);touchDraft()});hs.appendChild(hi);score.appendChild(hs);score.appendChild(el('div','score-dash','–'));const as=el('div','score-side');as.appendChild(el('strong','',match.away||'Trasferta'));const ai=input('number',match.awayGoals??'','score-input');ai.min='0';ai.addEventListener('input',()=>{match.awayGoals=ai.value===''?null:Number(ai.value);touchDraft()});as.appendChild(ai);score.appendChild(as);body.appendChild(score);
  const mb=el('div','match-body');const forfeitchk=input('checkbox');forfeitchk.checked=!!match.forfeit;const fr=el('label','checkbox-row');fr.appendChild(forfeitchk);fr.appendChild(document.createTextNode(' Partita decisa a tavolino / forfeit'));forfeitchk.addEventListener('change',()=>{match.forfeit=forfeitchk.checked;touchDraft();render()});mb.appendChild(fr);
  if(match.forfeit){const penal=select(teamOptions(match,true),match.penalizedTeam||'');penal.addEventListener('change',()=>{match.penalizedTeam=penal.value;touchDraft()});mb.appendChild(fieldWrap('Squadra penalizzata',penal))}else{mb.appendChild(renderScorers(match));mb.appendChild(renderExternalGoals(match));mb.appendChild(renderOwnGoals(match));mb.appendChild(renderAwards(match))}
  body.appendChild(mb);card.appendChild(body);return card
}
function subsection(title,addText,onAdd){const sec=el('div','subsection');const h=el('div','subsection-title');h.appendChild(el('span','',title));h.appendChild(button(addText,'secondary small',onAdd));sec.appendChild(h);return sec}
function renderScorers(match){
  const sec=subsection('⚽ Marcatori rosa','+ Marcatore',()=>{const team=match.home;const p=playersForTeam(state.model,team)[0];match.details.scorers.push({team,player:p?.fullName||'',qty:1});touchDraft();render()});
  (match.details.scorers||[]).forEach((s,i)=>{const row=el('div','entry-row');const ts=select(teamOptions(match),s.team,'select team-cell');ts.addEventListener('change',()=>{s.team=ts.value;s.player=playersForTeam(state.model,s.team)[0]?.fullName||'';touchDraft();render()});row.appendChild(ts);const ps=select(playerOptions(s.team),s.player);ps.addEventListener('change',()=>{s.player=ps.value;touchDraft()});row.appendChild(ps);const q=input('number',s.qty||1);q.min='1';q.addEventListener('input',()=>{s.qty=Math.max(1,Number(q.value||1));touchDraft()});row.appendChild(q);row.appendChild(button('×','danger small',()=>{match.details.scorers.splice(i,1);touchDraft();render()}));sec.appendChild(row)});return sec
}
function renderExternalGoals(match){
  const sec=subsection('🌐 Gol di giocatori esterni','+ Esterno',()=>{match.details.externalGoals.push({team:match.home,player:'',qty:1});touchDraft();render()});
  (match.details.externalGoals||[]).forEach((s,i)=>{const row=el('div','entry-row');const ts=select(teamOptions(match),s.team,'select team-cell');ts.addEventListener('change',()=>{s.team=ts.value;touchDraft()});row.appendChild(ts);const name=input('text',s.player||'');name.placeholder='Nome esterno (facoltativo)';name.addEventListener('input',()=>{s.player=name.value;touchDraft()});row.appendChild(name);const q=input('number',s.qty||1);q.min='1';q.addEventListener('input',()=>{s.qty=Math.max(1,Number(q.value||1));touchDraft()});row.appendChild(q);row.appendChild(button('×','danger small',()=>{match.details.externalGoals.splice(i,1);touchDraft();render()}));sec.appendChild(row)});return sec
}
function renderOwnGoals(match){
  const sec=subsection('↩ Autogol','+ Autogol',()=>{match.details.ownGoals.push({beneficiary:match.home,player:'',qty:1});touchDraft();render()});
  (match.details.ownGoals||[]).forEach((a,i)=>{const row=el('div','entry-row own');const bs=select(teamOptions(match),a.beneficiary,'select team-cell');bs.addEventListener('change',()=>{a.beneficiary=bs.value;a.player='';touchDraft();render()});row.appendChild(bs);const offenderTeam=norm(a.beneficiary)===norm(match.home)?match.away:match.home;const ps=select(playerOptions(offenderTeam),a.player);ps.addEventListener('change',()=>{a.player=ps.value;touchDraft()});row.appendChild(ps);const q=input('number',a.qty||1);q.min='1';q.addEventListener('input',()=>{a.qty=Math.max(1,Number(q.value||1));touchDraft()});row.appendChild(q);row.appendChild(button('×','danger small',()=>{match.details.ownGoals.splice(i,1);touchDraft();render()}));sec.appendChild(row)});return sec
}
function awardEditor(match,key,label){
  const wrap=el('div');const current=match.details[key]||{team:match.home,player:'',points:1,external:false};const ext=input('checkbox');ext.checked=!!current.external;const extLabel=el('label','checkbox-row');extLabel.appendChild(ext);extLabel.appendChild(document.createTextNode(' Esterno'));wrap.appendChild(extLabel);
  const team=select(teamOptions(match),current.team||match.home);team.addEventListener('change',()=>{current.team=team.value;if(!current.external)current.player=playersForTeam(state.model,current.team)[0]?.fullName||'';match.details[key]=current;touchDraft();render()});wrap.appendChild(team);
  let person;if(current.external){person=input('text',current.player||'');person.placeholder=`Nome ${label} esterno`;person.addEventListener('input',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}else{person=select(playerOptions(current.team||match.home),current.player||'');person.addEventListener('change',()=>{current.player=person.value;match.details[key]=current;touchDraft()})}wrap.appendChild(person);
  ext.addEventListener('change',()=>{current.external=ext.checked;current.player='';match.details[key]=current;touchDraft();render()});return fieldWrap(label,wrap)
}
function renderAwards(match){const sec=el('div','subsection');sec.appendChild(el('div','subsection-title','Premi'));const grid=el('div','award-grid');grid.appendChild(awardEditor(match,'mvp','⭐ MVP'));grid.appendChild(awardEditor(match,'keeper','🧤 Miglior portiere'));sec.appendChild(grid);return sec}
function prepareMatchday(){
  const model=effectiveModel();const result=buildMatchdayPublication(model,state.dayDraft);if(result.validation.errors.length){state.status={type:'error',text:result.validation.errors.join(' ')};render();return}result.changes.forEach(c=>state.pending.set(c.path,{...c,source:'Giornata'}));refreshModelFromPending();state.status={type:result.validation.warnings.length?'warning':'success',text:`Preparati ${result.changes.length} file per la giornata ${state.dayDraft.day}.${result.validation.warnings.length?' '+result.validation.warnings.join(' '):''}`};state.active='publish';render()
}

function renderSquadre(main){
  main.appendChild(pageHead('Squadre','Modifica le rose senza toccare manualmente i CSV.',[button('+ Nuova squadra','secondary',addTeam)]));if(!state.model.teams.length){main.appendChild(messageBox('info','Nessuna squadra trovata.'));return}
  if(!state.selectedTeam||!state.model.teams.some(t=>t.name===state.selectedTeam))state.selectedTeam=state.model.teams[0].name;const team=state.model.teams.find(t=>t.name===state.selectedTeam);const shell=el('div','team-editor');const list=el('div','card team-list');state.model.teams.forEach(t=>{const b=el('button',t.name===state.selectedTeam?'active':'',t.name);b.addEventListener('click',()=>{state.selectedTeam=t.name;render()});list.appendChild(b)});shell.appendChild(list);shell.appendChild(renderRosterEditor(team));main.appendChild(shell)
}
function renderRosterEditor(team){
  const card=el('div','card');card.appendChild(el('h3','',team.name));const draft=team._adminPlayers||(team._adminPlayers=structuredClone(team.players));const wrap=el('div','table-wrap');const table=el('table','data-table');const thead=el('thead');const hr=el('tr');['Nome','Cognome','Ruolo','Numero','Capitano',''].forEach(h=>hr.appendChild(el('th','',h)));thead.appendChild(hr);table.appendChild(thead);const tbody=el('tbody');draft.forEach((p,i)=>{const tr=el('tr');const vals=[['nome',p.nome],['cognome',p.cognome],['role',p.role],['number',p.number]];vals.forEach(([k,v])=>{const td=el('td');const x=input('text',v||'');x.addEventListener('input',()=>p[k]=x.value);td.appendChild(x);tr.appendChild(td)});const cap=el('td');const c=input('checkbox');c.checked=!!p.captain;c.addEventListener('change',()=>p.captain=c.checked);cap.appendChild(c);tr.appendChild(cap);const rm=el('td');rm.appendChild(button('×','danger small',()=>{draft.splice(i,1);render()}));tr.appendChild(rm);tbody.appendChild(tr)});table.appendChild(tbody);wrap.appendChild(table);card.appendChild(wrap);const row=el('div','btn-row');row.style.marginTop='10px';row.appendChild(button('+ Giocatore','secondary',()=>{draft.push({nome:'',cognome:'',role:'',number:'',captain:false});render()}));row.appendChild(button('Salva rosa','gold',()=>saveRoster(team,draft)));card.appendChild(row);return card
}
function saveRoster(team,players){
  const invalid=players.filter(p=>!String(p.nome||'').trim()&&!String(p.cognome||'').trim());if(invalid.length){state.status={type:'error',text:'Ogni giocatore deve avere almeno nome o cognome.'};render();return}
  const rel=team.rel||safeTeamFilename(team.name);const path=team.path||`${state.model.dataRoot}/${rel}`;const content=rosterCsv(team.name,players,team.file);const count=stageGuidedChanges([{path,content}],`Rosa ${team.name}`);state.status={type:'success',text:`Rosa ${team.name} pronta per la pubblicazione (${count} file inclusa eventuale modifica al manifest).`};render()
}
function addTeam(){const name=window.prompt('Nome della nuova squadra:')?.trim();if(!name)return;if(state.model.teams.some(t=>norm(t.name)===norm(name))){state.status={type:'error',text:'Esiste già una squadra con questo nome.'};render();return}const rel=safeTeamFilename(name),team={name,rel,path:`${state.model.dataRoot}/${rel}`,file:null,players:[],_adminPlayers:[]};state.model.teams.push(team);state.selectedTeam=name;render()}

function ensureCalendarDraft(){if(state.calendarDraft)return;const source=state.model.calendarMatches?.length?state.model.calendarMatches:state.model.matches;state.calendarDraft=source.map(m=>({day:m.day||'',date:m.date||'',home:m.home,away:m.away,notes:m.notes||''})).filter(m=>m.home&&m.away)}
function renderCalendario(main){
  ensureCalendarDraft();main.appendChild(pageHead('Calendario','Editor grafico. Se il calendario sorgente è a blocchi, al salvataggio viene normalizzato nel formato piatto già supportato dall’app.',[button('+ Partita','secondary',()=>{state.calendarDraft.push({day:(state.model.days.at(-1)||1),date:'',home:state.model.teams[0]?.name||'',away:state.model.teams[1]?.name||'',notes:''});render()}),button('Salva calendario','gold',saveCalendar)]));
  const card=el('div','card');const wrap=el('div','table-wrap');const table=el('table','data-table');const head=el('tr');['Giornata','Data','Casa','Trasferta','Note',''].forEach(h=>head.appendChild(el('th','',h)));const thead=el('thead');thead.appendChild(head);table.appendChild(thead);const body=el('tbody');const teams=state.model.teams.map(t=>({value:t.name,label:t.name}));state.calendarDraft.forEach((m,i)=>{const tr=el('tr');const d=input('number',m.day);d.min='1';d.addEventListener('input',()=>m.day=Number(d.value||0));const date=input('text',m.date);date.addEventListener('input',()=>m.date=date.value);const h=select(teams,m.home);h.addEventListener('change',()=>m.home=h.value);const a=select(teams,m.away);a.addEventListener('change',()=>m.away=a.value);const n=input('text',m.notes);n.addEventListener('input',()=>m.notes=n.value);[d,date,h,a,n].forEach(x=>{const td=el('td');td.appendChild(x);tr.appendChild(td)});const rm=el('td');rm.appendChild(button('×','danger small',()=>{state.calendarDraft.splice(i,1);render()}));tr.appendChild(rm);body.appendChild(tr)});table.appendChild(body);wrap.appendChild(table);card.appendChild(wrap);main.appendChild(card)
}
function saveCalendar(){
  const calendarFiles=sectionFiles(effectiveModel(),'calendario');if(calendarFiles.length>1){state.status={type:'error',text:`Più calendari attivi nel manifest (${calendarFiles.map(f=>f.rel).join(', ')}). Risolvi prima l'ambiguità nell'editor File.`};render();return}
  const seen=new Set();let bad=false;for(const m of state.calendarDraft){if(!m.day||!m.home||!m.away||norm(m.home)===norm(m.away)){bad=true;break}const key=`${m.day}|${norm(m.home)}|${norm(m.away)}`;if(seen.has(key)){bad=true;break}seen.add(key)}if(bad){state.status={type:'error',text:'Calendario non valido: controlla giornata, squadre e partite duplicate.'};render();return}
  const rows=[['Giornata','Data','Squadra casa','Squadra trasferta','Note'],...state.calendarDraft.sort((a,b)=>a.day-b.day).map(m=>[m.day,m.date,m.home,m.away,m.notes])];const file=calendarFiles[0];const rel=file?.rel||'calendario.csv';const path=file?.path||`${state.model.dataRoot}/${rel}`;const count=stageGuidedChanges([{path,content:csvStringify(rows,';')}],'Calendario');state.status={type:'success',text:`Calendario pronto per la pubblicazione (${count} file inclusa eventuale modifica al manifest).`};render()
}

function pagelloneDayFromRel(rel){const m=String(rel||'').match(/giornata[_\s-]*(\d+)/i);return m?Number(m[1]):null}
function pagelloneFileForDay(day){return state.model.fileList.find(f=>fileKind(f.rel)==='pagellone'&&pagelloneDayFromRel(f.rel)===Number(day))||null}
function loadPagelloneDraft(day){const file=pagelloneFileForDay(day);state.selectedPagelloneDay=Number(day);state.pagelloneDraft=file?parsePagellone(file.text):[];state.pagelloneDirty=false}
function pagelloneDays(){const found=state.model.fileList.filter(f=>fileKind(f.rel)==='pagellone').map(f=>pagelloneDayFromRel(f.rel)).filter(Boolean);return [...new Set([...state.model.days,...found,state.selectedPagelloneDay||1].filter(Boolean))].sort((a,b)=>a-b)}
function markPagelloneDirty(){state.pagelloneDirty=true}
function switchPagelloneDay(day){if(state.pagelloneDirty&&!window.confirm('Ci sono modifiche al Pagellone non salvate. Cambiare giornata e scartarle?'))return false;loadPagelloneDraft(day);render();return true}
function renderPagellone(main){
  if(!state.pagelloneDraft)loadPagelloneDraft(state.selectedPagelloneDay||state.model.days.at(-1)||1);
  const days=pagelloneDays();const daySel=select(days.map(d=>({value:d,label:`Giornata ${d}`})),state.selectedPagelloneDay);daySel.addEventListener('change',()=>{const old=state.selectedPagelloneDay;if(!switchPagelloneDay(daySel.value))daySel.value=old});
  main.appendChild(pageHead('Pagellone ignorante','Editor guidato del file TXT: squadra e giocatore vengono agganciati alle rose per evitare omonimie.',[button('+ Pagella','secondary',()=>{const team=state.model.teams[0]?.name||'';const p=playersForTeam(state.model,team)[0];state.pagelloneDraft.push({team,player:p?.fullName||'',text:'',comparison:'',vote:''});markPagelloneDirty();render()}),button('Salva Pagellone','gold',savePagellone)]));
  const toolbar=el('div','card day-toolbar');toolbar.appendChild(fieldWrap('Giornata',daySel));const source=pagelloneFileForDay(state.selectedPagelloneDay);toolbar.appendChild(el('div','small muted',source?`File: ${source.rel}`:'Nuovo file: pagelloni/pagellone_giornata_'+state.selectedPagelloneDay+'.txt'));main.appendChild(toolbar);
  const validation=validatePagelloneEntries(effectiveModel(),state.pagelloneDraft);if(validation.errors.length)main.appendChild(messageBox('error',validation.errors));else if(validation.warnings.length)main.appendChild(messageBox('warning',validation.warnings));
  if(!state.pagelloneDraft.length){main.appendChild(messageBox('info','Nessuna pagella presente. Usa “+ Pagella” per iniziare.'));return}
  const teams=state.model.teams.map(t=>({value:t.name,label:t.name}));const grid=el('div','pagella-grid');
  state.pagelloneDraft.forEach((entry,i)=>{const card=el('div','card pagella-edit');const top=el('div','subsection-title');top.appendChild(el('span','',`Pagella ${i+1}`));top.appendChild(button('Rimuovi','danger small',()=>{state.pagelloneDraft.splice(i,1);markPagelloneDirty();render()}));card.appendChild(top);const row=el('div','award-grid');const ts=select(teams,entry.team);ts.addEventListener('change',()=>{entry.team=ts.value;entry.player=playersForTeam(state.model,entry.team)[0]?.fullName||'';markPagelloneDirty();render()});row.appendChild(fieldWrap('Squadra',ts));const ps=select(playerOptions(entry.team,true,entry.player),entry.player);ps.addEventListener('change',()=>{entry.player=ps.value;markPagelloneDirty()});row.appendChild(fieldWrap('Giocatore',ps));card.appendChild(row);const txt=el('textarea','input');txt.value=entry.text||'';txt.style.minHeight='88px';txt.placeholder='Testo della pagella';txt.addEventListener('input',()=>{entry.text=txt.value;markPagelloneDirty()});card.appendChild(fieldWrap('Testo',txt));const bottom=el('div','award-grid');const cmp=input('text',entry.comparison||'');cmp.placeholder='Es. Javier Zanetti';cmp.addEventListener('input',()=>{entry.comparison=cmp.value;markPagelloneDirty()});bottom.appendChild(fieldWrap('Paragone',cmp));const vote=input('text',entry.vote||'');vote.placeholder='Es. 7+ oppure 6,5';vote.addEventListener('input',()=>{entry.vote=vote.value;markPagelloneDirty()});bottom.appendChild(fieldWrap('Voto',vote));card.appendChild(bottom);grid.appendChild(card)});main.appendChild(grid)
}
function savePagellone(){
  if(!state.pagelloneDraft?.length){state.status={type:'error',text:'Aggiungi almeno una pagella. Per svuotare intenzionalmente un file usa l’editor avanzato.'};render();return}
  const model=effectiveModel();const validation=validatePagelloneEntries(model,state.pagelloneDraft);if(validation.errors.length){state.status={type:'error',text:validation.errors.join(' ')};render();return}
  const file=pagelloneFileForDay(state.selectedPagelloneDay);const rel=file?.rel||`pagelloni/pagellone_giornata_${state.selectedPagelloneDay}.txt`;const path=file?.path||`${state.model.dataRoot}/${rel}`;const count=stageGuidedChanges([{path,content:pagelloneText(state.pagelloneDraft)}],`Pagellone giornata ${state.selectedPagelloneDay}`);state.pagelloneDirty=false;state.status={type:validation.warnings.length?'warning':'success',text:`Pagellone giornata ${state.selectedPagelloneDay} pronto per la pubblicazione (${count} file).${validation.warnings.length?' '+validation.warnings.join(' '):''}`};render()
}

function renderClassifiche(main){
  main.appendChild(pageHead('Classifiche','La giornata ricalcola automaticamente squadre, marcatori, MVP e portieri. Le penalità e le relative note vengono preservate dal file esistente.'));
  const card=el('div','card');card.appendChild(messageBox('info','Ordinamento automatico squadre: Punti finali → differenza reti → gol fatti → ordine precedente. L’ordine precedente rimane quindi lo spareggio stabile quando i valori numerici sono identici.'));
  const rows=state.model.standings||[];if(!rows.length){card.appendChild(el('p','muted','Classifica squadre non presente. Verrà generata alla prima pubblicazione di una giornata.'));main.appendChild(card);return}
  const parsed=sectionFiles(state.model,'classifica_squadre')[0]?.parsed;const headers=parsed?.headers||[];const wrap=el('div','table-wrap');const table=el('table','data-table');const th=el('tr');headers.forEach(h=>th.appendChild(el('th','',h)));const thead=el('thead');thead.appendChild(th);table.appendChild(thead);const tb=el('tbody');rows.forEach(r=>{const tr=el('tr');headers.forEach(h=>tr.appendChild(el('td','',r[h]??'')));tb.appendChild(tr)});table.appendChild(tb);wrap.appendChild(table);card.appendChild(wrap);main.appendChild(card)
}

function renderFiles(main){
  const files=state.model.fileList.filter(f=>/\.(csv|txt|json)$/i.test(f.rel));if(!state.selectedFile||!files.some(f=>f.path===state.selectedFile))state.selectedFile=files[0]?.path||'';const current=files.find(f=>f.path===state.selectedFile);main.appendChild(pageHead('File','Editor avanzato: utile per config, pagelloni, Fantacalcio e formati non ancora coperti dalle schermate guidate.'));
  const shell=el('div','file-list');const nav=el('div','card file-nav');files.forEach(f=>{const b=el('button',`file-item ${f.path===state.selectedFile?'active':''}`);b.type='button';b.appendChild(el('div','file-path',f.rel));b.appendChild(el('div','file-meta',`${fileKind(f.rel)} · ${f.size} byte`));b.addEventListener('click',()=>{state.selectedFile=f.path;render()});nav.appendChild(b)});shell.appendChild(nav);const editor=el('div','card');if(current){editor.appendChild(el('h3','',current.rel));const ta=el('textarea','textarea');ta.value=state.pending.get(current.path)?.content??current.text;editor.appendChild(ta);const row=el('div','btn-row');row.style.marginTop='10px';row.appendChild(button('Salva modifica','gold',()=>{state.pending.set(current.path,{path:current.path,content:ta.value,source:'Editor file'});state.status={type:'success',text:`${current.rel} aggiunto alle modifiche da pubblicare.`};render()}));row.appendChild(button('Ripristina','ghost',()=>{state.pending.delete(current.path);render()}));editor.appendChild(row)}shell.appendChild(editor);main.appendChild(shell)
}

function renderPublish(main){
  main.appendChild(pageHead('Pubblicazione','Tutti i file vengono scritti insieme nello stesso commit GitHub. Se il branch è cambiato, l’operazione viene bloccata.'));
  const card=el('div','card');if(!state.pending.size){card.appendChild(messageBox('info','Nessuna modifica pronta. Usa Gestione giornata, Squadre, Calendario o File.'));main.appendChild(card);return}
  card.appendChild(el('h3','',`${state.pending.size} file da pubblicare`));state.pending.forEach(c=>{const r=el('div','change-row');const copy=el('div');copy.appendChild(el('code','',relativeDataPath(c.path,state.model.dataRoot)));copy.appendChild(el('div','file-meta',c.source||'Modifica'));r.appendChild(copy);r.appendChild(el('span','change-state','MODIFICATO'));card.appendChild(r)});main.appendChild(card);
  const publish=el('div','card');const msg=input('text',`Admin CRAL: aggiornamento dati${state.dayDraft?.day?' giornata '+state.dayDraft.day:''}`);publish.appendChild(fieldWrap('Messaggio commit',msg));let confirmInput=null;if(state.target==='produzione'){publish.appendChild(messageBox('warning','Stai per scrivere nel repository di PRODUZIONE. Digita esattamente “PUBBLICA PRODUZIONE”.'));confirmInput=input('text','');publish.appendChild(fieldWrap('Conferma produzione',confirmInput))}
  const row=el('div','btn-row');row.appendChild(button('Scarta tutte','danger',()=>{if(window.confirm('Scartare tutte le modifiche non pubblicate?')){state.pending.clear();state.status={type:'warning',text:'Modifiche scartate.'};render()}}));const go=button(state.target==='produzione'?'Pubblica in PRODUZIONE':'Pubblica in collaudo','gold',()=>publishChanges(msg.value,confirmInput?.value||''));row.appendChild(go);publish.appendChild(row);main.appendChild(publish)
}
async function publishChanges(message,productionConfirmation){
  if(!state.pending.size)return;state.busy=true;renderLoading('Pubblicazione atomica su GitHub…');
  try{
    const target=requireTarget(state.target);
    const changesArr=[...state.pending.values()].map(({path,content,delete:del})=>({path,content,delete:del}));
    const result=await ghPublishChanges(target,{tournament:state.tournament,baseCommitSha:state.snapshot.commitSha,changes:changesArr,message,productionConfirmation});
    state.pending.clear();try{localStorage.removeItem(draftKey(state.selectedDay))}catch{}state.status={type:'success',text:`Pubblicazione completata. Commit ${result.sha.slice(0,8)}.`};await loadSnapshot(false);state.status={type:'success',text:`Pubblicazione completata. Commit ${result.sha.slice(0,8)}. ${result.url}`};state.active='dashboard';render()
  }catch(e){
    state.busy=false;
    if(e.status===409){state.status={type:'error',text:'Pubblicazione bloccata: repository/ambiente o commit non coincidono più con lo snapshot caricato. Ricarica i dati prima di riprovare.'};state.active='publish';render();return}
    if(e.status===401){renderLogin(state.target,'Sessione GitHub scaduta o token non più valido: accedi di nuovo.');return}
    state.status={type:'error',text:e.message};state.active='publish';render()
  }
}

sessionCheck();
