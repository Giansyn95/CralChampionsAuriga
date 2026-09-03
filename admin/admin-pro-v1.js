/*
 * CRAL Champions Admin Pro v1
 * Pre-bootstrap feature pack. It extends the source modules loaded by
 * admin-boot-v30.js without duplicating the existing Admin application.
 */
(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);

  function adminExtension() {
    const PRO_PAGES = new Set(['setup','import','settings','images','verify','promote','history']);
    Object.assign(state, {
      proImportPlan: [],
      proImportReplace: true,
      proRegistry: null,
      proRegistryKey: '',
      proVerifyReport: null,
      proHistory: [],
      proHistoryLoading: false,
      proHistoryIncludeRegistry: false,
      proPromotionPreview: null,
      proCalendar: { mode: 'double', start: '', interval: 7 }
    });

    function proStyle() {
      if (document.getElementById('cral-admin-pro-style')) return;
      const style = document.createElement('style');
      style.id = 'cral-admin-pro-style';
      style.textContent = `
        .pro-nav-sep{height:1px;background:var(--line,#e5e7eb);margin:10px 6px}
        .pro-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
        .pro-step{display:flex;gap:12px;align-items:flex-start}.pro-step-num{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#eef2ff;font-weight:800;flex:0 0 auto}
        .pro-ok{color:#147a42;font-weight:700}.pro-warn{color:#a25b00;font-weight:700}.pro-bad{color:#b42318;font-weight:700}
        .pro-table{width:100%;border-collapse:collapse}.pro-table th,.pro-table td{padding:8px 10px;border-bottom:1px solid var(--line,#e5e7eb);text-align:left;vertical-align:top}
        .pro-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.pro-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
        .pro-drop{border:2px dashed var(--line,#ccd2da);border-radius:12px;padding:18px;text-align:center}.pro-muted{opacity:.72;font-size:13px}
        .pro-report{display:grid;gap:8px}.pro-report-row{padding:10px 12px;border-radius:10px;background:#f7f8fa}.pro-report-row.error{background:#fff1f0}.pro-report-row.warning{background:#fff7e8}.pro-report-row.ok{background:#eefbf3}
        .pro-kpis{display:flex;gap:10px;flex-wrap:wrap}.pro-kpi{padding:10px 14px;border:1px solid var(--line,#e5e7eb);border-radius:12px;min-width:130px}.pro-kpi b{display:block;font-size:20px}
        .pro-preview{max-height:360px;overflow:auto}.pro-history-row{display:grid;grid-template-columns:minmax(90px,auto) 1fr auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line,#e5e7eb)}
        @media(max-width:760px){.pro-history-row{grid-template-columns:1fr}.pro-table{font-size:12px}}
      `;
      document.head.appendChild(style);
    }
    proStyle();

    function proNoPending(action) {
      if (!state.pending.size) return true;
      state.status = { type:'error', text:`${action}: prima pubblica o scarta le ${state.pending.size} modifiche locali in sospeso.` };
      render();
      return false;
    }
    function proCurrentTarget() { return requireTarget(state.target); }
    function proRel(path) { return relativeDataPath(path, state.model?.dataRoot || state.snapshot?.dataRoot || ''); }
    function proBytes(text) { return new TextEncoder().encode(String(text ?? '')).length; }
    function proNormPath(rel) {
      const p = String(rel || '').trim().replace(/^data\//i,'').replace(/^\/+/, '').replace(/\\/g,'/');
      if (!p || p.includes('..') || !/\.(csv|txt|json)$/i.test(p)) throw new Error('Usa un percorso relativo sotto data/ con estensione .csv, .txt o .json.');
      return p;
    }
    function proManifestEntries() {
      return [...new Set((effectiveModel()?.manifestEntries || []).map(x => String(x).trim()).filter(Boolean))];
    }
    function proStageManifest(entries, source='Gestione manifest') {
      const clean = [...new Set(entries.map(x => String(x).trim().replace(/^data\//i,'').replace(/^\/+/, '')).filter(Boolean))];
      const path = `${state.model.dataRoot}/manifest.csv`;
      const content = csvStringify([['file'], ...clean.map(x => [x])], ';');
      state.pending.set(path, { path, content, source });
    }
    function proSetManifestEntry(oldRel, newRel) {
      let entries = proManifestEntries();
      if (oldRel) entries = entries.filter(x => norm(x) !== norm(oldRel));
      if (newRel && !entries.some(x => norm(x) === norm(newRel))) entries.push(newRel);
      proStageManifest(entries);
    }
    function proStageCanonical(rel, content, kind, source, replaceEquivalent=true) {
      const path = `${state.model.dataRoot}/${rel}`;
      if (replaceEquivalent && kind && kind !== 'squadra') {
        const model = effectiveModel();
        sectionFiles(model, kind).forEach(f => {
          if (norm(f.rel) !== norm(rel)) state.pending.set(f.path, { path:f.path, delete:true, source:`Sostituito da ${rel}` });
        });
      }
      state.pending.set(path, { path, content, source });
      let entries = proManifestEntries();
      if (replaceEquivalent && kind && kind !== 'squadra') entries = entries.filter(x => fileKind(x) !== kind);
      if (!entries.some(x => norm(x) === norm(rel))) entries.push(rel);
      proStageManifest(entries, 'Manifest importazione');
      refreshModelFromPending();
    }

    async function proLoadRegistry(force=false) {
      const key = `${state.target}|${state.snapshot?.commitSha || ''}`;
      if (!force && state.proRegistry && state.proRegistryKey === key) return state.proRegistry;
      const text = await getTextFile(proCurrentTarget(), 'tornei.json');
      state.proRegistry = parseTournamentRegistry(text);
      state.proRegistryKey = key;
      return state.proRegistry;
    }
    function proRegistryEntry(registry=state.proRegistry) {
      return (registry?.tornei || []).find(t => String(t.cartella || '').replace(/^\/+|\/+$/g,'') === state.tournament) || null;
    }
    async function proRefreshAll(statusText='') {
      state.proRegistry = null; state.proRegistryKey = '';
      await loadTournamentList();
      await loadSnapshot(false);
      if (statusText) state.status = { type:'success', text:statusText };
      render();
    }

    const proBaseRefreshSidebar = refreshSidebar;
    refreshSidebar = function() {
      proBaseRefreshSidebar();
      if (!shell?.sidebar) return;
      const side = shell.sidebar;
      side.appendChild(el('div','pro-nav-sep'));
      const items = [
        ['setup','🧭','Setup'],['import','📥','Importa CSV'],['settings','⚙️','Impostazioni'],
        ['images','🖼️','Immagini'],['verify','✅','Verifica'],['promote','⬆️','Promuovi'],['history','↩️','Storico']
      ];
      items.forEach(([id,icon,label]) => {
        const b = el('button',`nav-btn ${state.active===id?'active':''}`);
        b.type='button'; b.textContent=`${icon} ${label}`;
        b.addEventListener('click',()=>{state.active=id;render()}); side.appendChild(b);
      });
    };

    const proBaseRender = render;
    render = function() {
      proBaseRender();
      if (!state.model || !PRO_PAGES.has(state.active) || !shell?.main) return;
      const main = shell.main; main.innerHTML='';
      if (state.status) main.appendChild(messageBox(state.status.type,state.status.text));
      if (state.active==='setup') proRenderSetup(main);
      else if (state.active==='import') proRenderImport(main);
      else if (state.active==='settings') proRenderSettings(main);
      else if (state.active==='images') proRenderImages(main);
      else if (state.active==='verify') proRenderVerify(main);
      else if (state.active==='promote') proRenderPromote(main);
      else if (state.active==='history') proRenderHistory(main);
    };

    const proBaseCreateTournament = createTournament;
    createTournament = async function(...args) {
      const makeCurrent=args?.[0]?.makeCurrent!==false;
      await proBaseCreateTournament(...args);
      if (state.model && state.active === 'squadre' && /creato/i.test(state.status?.text || '')) {
        state.active='setup';
        if(makeCurrent)state.status={type:'success',text:`${state.status.text} Se esisteva un torneo corrente precedente, e stato automaticamente marcato come concluso.`};
        render();
      }
    };

    function proRenderSetup(main) {
      const model=effectiveModel();
      const hasTeams=model.teams.length>0, hasCalendar=sectionFiles(model,'calendario').length>0 && model.calendarMatches.length>0;
      const hasDays=model.days.length>0, hasFanta=model.fileList.some(f=>f.active!==false && /fantacalcio/i.test(f.rel));
      main.appendChild(pageHead('Setup torneo','Procedura guidata per inizializzare e controllare una nuova edizione senza aprire GitHub.'));
      const k=el('div','pro-kpis');
      [['Squadre',model.teams.length],['Giornate',model.days.length],['Partite',model.matches.length],['Modifiche',state.pending.size]].forEach(([l,v])=>{const x=el('div','pro-kpi');x.appendChild(el('b','',v));x.appendChild(el('span','',l));k.appendChild(x)}); main.appendChild(k);
      const card=el('div','card'); card.style.marginTop='14px';
      const steps=[
        ['1','Squadre e rose',hasTeams,'Crea manualmente le squadre oppure importa un CSV unico con tutte le rose.','squadre'],
        ['2','Calendario',hasCalendar,'Carica un calendario oppure generane uno automaticamente (andata o andata/ritorno).','calendario'],
        ['3','Dati giornata',hasDays,'Inserisci risultati, marcatori, MVP, portieri e autogoal dalla schermata Giornata.','giornata'],
        ['4','Fantacalcio',hasFanta,'Carica listone, rose ed eventi speciali se previsti.','fantacalcio'],
        ['5','Immagini',false,'Carica logo, stemmi e foto; JPG/PNG vengono convertiti automaticamente.','images'],
        ['6','Verifica',false,'Controlla integrita, manifest, duplicati e riferimenti prima della pubblicazione.','verify'],
        ['7','Pubblica',state.pending.size===0,'Rivedi l anteprima e pubblica un unico commit atomico.','publish']
      ];
      steps.forEach(([n,title,ok,desc,target])=>{const row=el('div','pro-step');row.style.margin='14px 0';row.appendChild(el('div','pro-step-num',n));const c=el('div');const h=el('div');h.appendChild(el('strong','',title));h.appendChild(document.createTextNode(' '));h.appendChild(el('span',ok?'pro-ok':'pro-warn',ok?'✓ pronto':'da completare'));c.appendChild(h);c.appendChild(el('div','pro-muted',desc));const b=button('Apri','secondary small',()=>{state.active=target;render()});b.style.marginTop='7px';c.appendChild(b);row.appendChild(c);card.appendChild(row)});
      main.appendChild(card);
    }

    function proHeaders(rows){return (rows?.[0]||[]).map(h=>norm(h));}
    function proHas(headers,...names){return names.some(n=>headers.includes(norm(n)));}
    function proField(row, aliases){return field(row, aliases);}
    function proDetectCsv(fileName,text){
      const parsed=parseCsv(text); const rows=parsed.rows; const h=proHeaders(rows); const objects=rowsToObjects(rows);
      if(!rows.length) throw new Error(`${fileName}: CSV vuoto.`);
      if(proHas(h,'sezione') && proHas(h,'giornata')) return [{kind:'riepilogo',rel:'riepilogo_giornate.csv',content:csvStringify(rows,';'),label:'Riepilogo giornate'}];
      if(proHas(h,'squadra casa','casa') && proHas(h,'squadra trasferta','trasferta') && proHas(h,'giornata')){
        const scores=proHas(h,'gol casa','goal casa','gc')||proHas(h,'gol trasferta','goal trasferta','gt')||proHas(h,'risultato');
        return [{kind:scores?'risultati':'calendario',rel:scores?'risultati_partite.csv':'calendario.csv',content:csvStringify(rows,';'),label:scores?'Risultati':'Calendario'}];
      }
      if(proHas(h,'chiave')&&proHas(h,'valore')) return [{kind:'config',rel:'config.csv',content:csvStringify(rows,';'),label:'Configurazione'}];
      if(proHas(h,'posizione')&&proHas(h,'squadra')&&(proHas(h,'punti finali','punti')||proHas(h,'pg'))) return [{kind:'classifica_squadre',rel:'classifica_squadre.csv',content:csvStringify(rows,';'),label:'Classifica squadre'}];
      if(proHas(h,'giocatore','marcatore')&&proHas(h,'squadra')&&proHas(h,'gol','goal')) return [{kind:'marcatori',rel:'classifica_marcatori.csv',content:csvStringify(rows,';'),label:'Classifica marcatori'}];
      if(proHas(h,'giocatore','mvp')&&proHas(h,'squadra')&&proHas(h,'punti mvp','puntimvp')) return [{kind:'mvp',rel:'classifica_mvp.csv',content:csvStringify(rows,';'),label:'Classifica MVP'}];
      if(proHas(h,'portiere')&&proHas(h,'squadra')&&proHas(h,'punti')) return [{kind:'portieri',rel:'classifica_portieri.csv',content:csvStringify(rows,';'),label:'Classifica portieri'}];
      const rosterish=proHas(h,'nome','cognome','giocatore','nome completo') && (proHas(h,'ruolo','numero','capitano') || proHas(h,'squadra','team'));
      if(rosterish){
        const groups=new Map();
        objects.forEach(o=>{
          let team=String(proField(o,['squadra','team','club'])||'').trim();
          if(!team){team=String(fileName).replace(/\.csv$/i,'').replace(/^squadra[_\s-]*/i,'').replace(/_/g,' ').trim();}
          if(!team) return;
          if(!groups.has(team))groups.set(team,[]);groups.get(team).push(o);
        });
        if(!groups.size) throw new Error(`${fileName}: sembra una rosa ma non riesco a ricavare il nome squadra.`);
        return [...groups.entries()].map(([team,list])=>{
          const out=[['Nome','Cognome','Ruolo','Numero','Capitano']];
          list.forEach(o=>{
            const direct=String(proField(o,['giocatore','nome completo','player'])||'').trim();
            out.push([
              String(proField(o,['nome','firstname'])||'').trim(),
              String(proField(o,['cognome','lastname'])||direct).trim(),
              String(proField(o,['ruolo','role','posizione'])||'').trim(),
              String(proField(o,['numero','n','maglia'])||'').trim(),
              String(proField(o,['capitano','captain','cap'])||'').trim()
            ]);
          });
          return {kind:'squadra',rel:safeTeamFilename(team),content:csvStringify(out,';'),label:`Rosa ${team}`};
        });
      }
      throw new Error(`${fileName}: struttura non riconosciuta. Puoi comunque gestirlo dalla sezione File.`);
    }
    async function proAnalyzeFiles(files){
      const plan=[]; const errors=[];
      for(const file of files){
        try{const text=await file.text();const outputs=proDetectCsv(file.name,text);outputs.forEach(x=>plan.push({source:file.name,...x}));}
        catch(e){errors.push(e.message||String(e));}
      }
      state.proImportPlan=plan;
      state.status=errors.length?{type:'warning',text:errors.join(' ')}:{type:'success',text:`Analizzati ${files.length} file: ${plan.length} destinazioni riconosciute.`};render();
    }
    function proApplyImport(){
      if(!state.proImportPlan.length)return;
      const replace=state.proImportReplace!==false;
      const kinds=new Set(state.proImportPlan.map(x=>x.kind).filter(k=>k!=='squadra'&&k!=='config'));
      const model=effectiveModel();
      if(replace){
        kinds.forEach(kind=>sectionFiles(model,kind).forEach(f=>{
          if(!state.proImportPlan.some(p=>norm(p.rel)===norm(f.rel)))state.pending.set(f.path,{path:f.path,delete:true,source:`Sostituito da import ${kind}`});
        }));
      }
      state.proImportPlan.forEach(item=>state.pending.set(`${state.model.dataRoot}/${item.rel}`,{path:`${state.model.dataRoot}/${item.rel}`,content:item.content,source:`Import CSV: ${item.source} -> ${item.rel}`}));
      let entries=proManifestEntries();
      if(replace) entries=entries.filter(rel=>!kinds.has(fileKind(rel)));
      state.proImportPlan.forEach(p=>{if(p.kind!=='config'&&!entries.some(x=>norm(x)===norm(p.rel)))entries.push(p.rel)});
      const deleted=[...state.pending.values()].filter(c=>c.delete).map(c=>proRel(c.path)); entries=entries.filter(x=>!deleted.some(d=>norm(d)===norm(x)));
      proStageManifest(entries,'Manifest importazione CSV');refreshModelFromPending();
      state.status={type:'success',text:`Importazione pronta: ${state.proImportPlan.length} file normalizzati. Controlla l anteprima in Pubblica.`};state.active='publish';render();
    }
    function proRenderImport(main){
      main.appendChild(pageHead('Importa CSV','Trascina o seleziona CSV: il pannello riconosce il tipo dai campi, assegna il nome canonico e aggiorna il manifest.'));
      const card=el('div','card');const drop=el('div','pro-drop');drop.appendChild(el('strong','','Seleziona uno o piu CSV'));drop.appendChild(el('div','pro-muted','Supportati: rose singole/multiple, calendario, risultati, riepilogo aggregato, classifiche e config.'));
      const picker=input('file');picker.multiple=true;picker.accept='.csv,text/csv';picker.style.marginTop='10px';picker.addEventListener('change',()=>proAnalyzeFiles([...picker.files||[]]));drop.appendChild(picker);card.appendChild(drop);
      const rep=input('checkbox');rep.checked=state.proImportReplace!==false;rep.addEventListener('change',()=>state.proImportReplace=rep.checked);const lr=el('label','checkbox-row');lr.append(rep,document.createTextNode(' Sostituisci automaticamente le sorgenti equivalenti gia presenti (consigliato)'));card.appendChild(lr);main.appendChild(card);
      if(state.proImportPlan.length){const out=el('div','card');out.appendChild(el('h3','','Anteprima destinazioni'));const wrap=el('div','table-wrap pro-preview');const table=el('table','pro-table');table.innerHTML='<thead><tr><th>Origine</th><th>Tipo</th><th>Destinazione</th></tr></thead>';const tb=el('tbody');state.proImportPlan.forEach(p=>{const tr=el('tr');[p.source,p.label,p.rel].forEach((v,i)=>tr.appendChild(el('td',i===2?'pro-code':'',v)));tb.appendChild(tr)});table.appendChild(tb);wrap.appendChild(table);out.appendChild(wrap);out.appendChild(button('Prepara importazione','gold',proApplyImport));main.appendChild(out)}
    }

    function proRoundRobin(names){
      const teams=[...names];if(teams.length%2)teams.push(null);const n=teams.length;const arr=[...teams];const rounds=[];
      for(let r=0;r<n-1;r++){
        const games=[];for(let i=0;i<n/2;i++){let a=arr[i],b=arr[n-1-i];if(a&&b){if((r+i)%2){const t=a;a=b;b=t}games.push([a,b]);}}
        rounds.push(games);arr.splice(1,0,arr.pop());
      }return rounds;
    }
    function proIsoDate(base,addDays){if(!base)return'';const d=new Date(`${base}T12:00:00`);if(Number.isNaN(d.getTime()))return'';d.setDate(d.getDate()+addDays);return d.toISOString().slice(0,10)}
    function proGenerateCalendar(){
      const teams=effectiveModel().teams.map(t=>t.name);if(teams.length<2){state.status={type:'error',text:'Servono almeno due squadre.'};render();return}
      const rounds=proRoundRobin(teams), all=[];let day=1;const interval=Math.max(1,Number(state.proCalendar.interval||7));
      rounds.forEach(g=>{g.forEach(([h,a])=>all.push([day,proIsoDate(state.proCalendar.start,(day-1)*interval),h,a,'']));day++});
      if(state.proCalendar.mode==='double'){rounds.forEach(g=>{g.forEach(([h,a])=>all.push([day,proIsoDate(state.proCalendar.start,(day-1)*interval),a,h,'']));day++})}
      const content=csvStringify([['Giornata','Data','Squadra casa','Squadra trasferta','Note'],...all],';');
      proStageCanonical('calendario.csv',content,'calendario','Calendario generato automaticamente',true);
      state.calendarDraft=all.map(r=>({day:r[0],date:r[1],home:r[2],away:r[3],notes:r[4]}));
      state.status={type:'success',text:`Calendario generato: ${day-1} giornate, ${all.length} partite. Il file canonico sara calendario.csv.`};render();
    }
    const proBaseRenderCalendario=renderCalendario;
    renderCalendario=function(main){
      proBaseRenderCalendario(main);const card=el('div','card');card.appendChild(el('h3','','Generatore automatico calendario'));card.appendChild(el('p','pro-muted','Usa le squadre del torneo e crea calendario.csv. Eventuali calendari precedenti vengono rimossi dal manifest per evitare duplicazioni.'));
      const grid=el('div','wizard-grid');const mode=select([{value:'single',label:'Solo andata'},{value:'double',label:'Andata + ritorno'}],state.proCalendar.mode);mode.addEventListener('change',()=>state.proCalendar.mode=mode.value);const start=input('date',state.proCalendar.start||'');start.addEventListener('input',()=>state.proCalendar.start=start.value);const interval=input('number',state.proCalendar.interval||7);interval.min='1';interval.addEventListener('input',()=>state.proCalendar.interval=Number(interval.value||7));grid.append(fieldWrap('Formula',mode),fieldWrap('Data prima giornata',start),fieldWrap('Giorni tra le giornate',interval));card.appendChild(grid);card.appendChild(button('Genera calendario','gold',proGenerateCalendar));main.appendChild(card)
    };

    async function proRenderSettingsAsync(){try{await proLoadRegistry();render()}catch(e){state.status={type:'error',text:e.message||String(e)};render()}}
    function proRenderSettings(main){
      main.appendChild(pageHead('Impostazioni torneo','Gestisci metadati, stato, visibilita e torneo corrente direttamente da tornei.json.'));
      if(!state.proRegistry||state.proRegistryKey!==`${state.target}|${state.snapshot?.commitSha||''}`){const c=el('div','card');c.appendChild(el('div','spinner'));c.appendChild(document.createTextNode(' Caricamento metadati...'));main.appendChild(c);if(!state._proSettingsLoading){state._proSettingsLoading=true;proRenderSettingsAsync().finally(()=>state._proSettingsLoading=false)}return}
      const entry=proRegistryEntry();if(!entry){main.appendChild(messageBox('error','Il torneo corrente non e presente in tornei.json. Usa Verifica per diagnosticare il problema.'));return}
      const card=el('div','card');const grid=el('div','wizard-grid');const title=input('text',entry.titolo||'');const desc=input('text',entry.descrizione||'');const status=select([{value:'in-corso',label:'In corso'},{value:'concluso',label:'Concluso'},{value:'prossimo',label:'Prossimo'}],entry.stato||'in-corso');const current=input('checkbox');current.checked=!!entry.corrente;const active=input('checkbox');active.checked=entry.attivo!==false;
      grid.append(fieldWrap('Titolo',title),fieldWrap('Descrizione',desc),fieldWrap('Stato',status));card.appendChild(grid);let l=el('label','checkbox-row');l.append(current,document.createTextNode(' Torneo corrente'));card.appendChild(l);l=el('label','checkbox-row');l.append(active,document.createTextNode(' Visibile / attivo'));card.appendChild(l);
      card.appendChild(messageBox('info','Se imposti questo torneo come corrente, l eventuale torneo corrente precedente viene automaticamente marcato come concluso.'));
      card.appendChild(button('Salva impostazioni','gold',async()=>{if(!proNoPending('Salvataggio impostazioni'))return;try{const target=proCurrentTarget();const reg=structuredClone(state.proRegistry);const item=(reg.tornei||[]).find(t=>String(t.cartella||'').replace(/^\/+|\/+$/g,'')===state.tournament);const wasCurrent=(reg.tornei||[]).filter(t=>t!==item&&t.corrente);item.titolo=title.value.trim();item.descrizione=desc.value.trim();item.stato=status.value;item.attivo=active.checked;if(current.checked){wasCurrent.forEach(t=>{t.corrente=false;if(String(t.stato||'')==='in-corso')t.stato='concluso'});item.corrente=true;if(item.stato==='concluso')item.stato='in-corso';const logo=`${state.tournament}/immagini/logo_cral.png`;reg.logo=logo}else item.corrente=false;const result=await createAtomicCommit(target,{baseCommitSha:state.snapshot.commitSha,changes:[{path:'tornei.json',content:JSON.stringify(reg,null,2)+'\n'}],message:`Admin CRAL: aggiorna impostazioni ${item.id||state.tournament}`});await proRefreshAll(`Impostazioni salvate. Commit ${result.sha.slice(0,8)}.`)}catch(e){state.status={type:'error',text:e.message||String(e)};render()}}));main.appendChild(card)
    }

    function proBlobToBase64(blob){return blob.arrayBuffer().then(buf=>{const bytes=new Uint8Array(buf);let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)})}
    async function proConvertImage(file,mime,maxSize=1200,quality=.9){
      if(!file?.type?.startsWith('image/'))throw new Error('Seleziona un file immagine.');
      const url=URL.createObjectURL(file);let img;
      try{img=await new Promise((resolve,reject)=>{const node=new Image();node.onload=()=>resolve(node);node.onerror=()=>reject(new Error('Immagine non leggibile.'));node.src=url})}finally{setTimeout(()=>URL.revokeObjectURL(url),0)}
      let w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;const scale=Math.min(1,maxSize/Math.max(w,h));w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale));const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);const blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('Conversione immagine fallita.')),mime,quality));return {blob,base64:await proBlobToBase64(blob),width:w,height:h};
    }
    async function proStageConvertedImage(file,type,key,label){
      const {base64}=await proConvertImage(file,'image/webp',1200,.88);const target=proCurrentTarget();const imagePath=imageAssetPath(type,key);const indexPath=state.tournament+'/index.html';const currentIndex=state.pending.get(indexPath)?.content??await getTextFile(target,indexPath);const patchedIndex=addPublicImageKey(currentIndex,type,key);state.pending.set(imagePath,{path:imagePath,contentBase64:base64,binary:true,source:`Immagine ${label} -> ${key}.webp`});if(patchedIndex!==currentIndex)state.pending.set(indexPath,{path:indexPath,content:patchedIndex,source:'Registro immagini frontend'});state.status={type:'success',text:`Immagine ${label} convertita in WebP e pronta per la pubblicazione.`};render();
    }
    async function proCommitLogo(file){
      if(!proNoPending('Aggiornamento logo'))return;try{const {base64}=await proConvertImage(file,'image/png',1400,1);const target=proCurrentTarget();const registry=parseTournamentRegistry(await getTextFile(target,'tornei.json'));const entry=(registry.tornei||[]).find(t=>String(t.cartella||'').replace(/^\/+|\/+$/g,'')===state.tournament);const changes=[{path:`${state.tournament}/immagini/logo_cral.png`,contentBase64:base64}];if(entry?.corrente){registry.logo=`${state.tournament}/immagini/logo_cral.png`;changes.push({path:'tornei.json',content:JSON.stringify(registry,null,2)+'\n'})}const result=await createAtomicCommit(target,{baseCommitSha:state.snapshot.commitSha,changes,message:`Admin CRAL: aggiorna logo ${entry?.id||state.tournament}`});await proRefreshAll(`Logo aggiornato. Commit ${result.sha.slice(0,8)}.`)}catch(e){state.status={type:'error',text:e.message||String(e)};render()}
    }
    function proRenderImages(main){
      main.appendChild(pageHead('Immagini','Carica JPG, PNG o WebP. Stemmi e giocatori vengono convertiti automaticamente in WebP con nomenclatura canonica.'));
      const logo=el('div','card');logo.appendChild(el('h3','','Logo torneo'));logo.appendChild(el('p','pro-muted',`Destinazione: ${state.tournament}/immagini/logo_cral.png. Il logo viene convertito in PNG e pubblicato subito con commit atomico.`));const lp=input('file');lp.accept='image/png,image/jpeg,image/webp';lp.addEventListener('change',()=>{const f=lp.files?.[0];if(f&&window.confirm('Aggiornare il logo del torneo?'))proCommitLogo(f)});logo.appendChild(lp);main.appendChild(logo);
      const card=el('div','card');card.appendChild(el('h3','','Stemma squadra / foto giocatore'));const teams=effectiveModel().teams;const teamSel=select(teams.map(t=>({value:t.name,label:t.name})),state.selectedTeam||teams[0]?.name||'');const type=select([{value:'team',label:'Stemma squadra'},{value:'player',label:'Foto giocatore'}],'team');const playerSel=select([], '');function refill(){playerSel.innerHTML='';const team=teams.find(t=>t.name===teamSel.value);(team?.players||[]).forEach(p=>{const o=el('option','',p.displayName||p.fullName);o.value=p.id;playerSel.appendChild(o)});playerSel.disabled=type.value!=='player'}refill();teamSel.addEventListener('change',refill);type.addEventListener('change',refill);const grid=el('div','wizard-grid');grid.append(fieldWrap('Tipo',type),fieldWrap('Squadra',teamSel),fieldWrap('Giocatore',playerSel));card.appendChild(grid);const pick=input('file');pick.accept='image/png,image/jpeg,image/webp';pick.addEventListener('change',async()=>{const f=pick.files?.[0];if(!f)return;try{if(type.value==='team'){const key=imageAssetKey(teamSel.value);await proStageConvertedImage(f,'team',key,teamSel.value)}else{const team=teams.find(t=>t.name===teamSel.value);const p=(team?.players||[]).find(x=>x.id===playerSel.value);if(!p)throw new Error('Seleziona un giocatore.');await proStageConvertedImage(f,'player',playerAssetKey(p),p.displayName||p.fullName)}}catch(e){state.status={type:'error',text:e.message||String(e)};render()}});card.appendChild(pick);card.appendChild(el('p','pro-muted','Le immagini di squadra/giocatore restano nelle modifiche in sospeso e vengono pubblicate insieme agli altri dati.'));main.appendChild(card)
    }

    function proBuildVerifyReport(){
      const model=effectiveModel(),errors=[],warnings=[],ok=[];const teamSet=new Set(model.teams.map(t=>norm(t.name)));
      if(!model.teams.length)errors.push('Nessuna squadra presente.');else ok.push(`${model.teams.length} squadre riconosciute.`);
      const duplicateTeams=model.teams.map(t=>norm(t.name)).filter((x,i,a)=>a.indexOf(x)!==i);if(duplicateTeams.length)errors.push('Squadre duplicate per nome normalizzato.');
      const singleton=['calendario','risultati','classifica_squadre','marcatori','mvp','portieri'];singleton.forEach(kind=>{const fs=sectionFiles(model,kind);if(fs.length>1)warnings.push(`Piu file attivi di tipo ${kind}: ${fs.map(f=>f.rel).join(', ')}.`)});
      model.calendarMatches.forEach(m=>{if(!teamSet.has(norm(m.home)))errors.push(`Calendario: squadra casa non esistente: ${m.home}.`);if(!teamSet.has(norm(m.away)))errors.push(`Calendario: squadra trasferta non esistente: ${m.away}.`)});
      const seen=new Set();model.calendarMatches.forEach(m=>{const k=`${m.day}|${norm(m.home)}|${norm(m.away)}`;if(seen.has(k))errors.push(`Partita duplicata: giornata ${m.day}, ${m.home} - ${m.away}.`);seen.add(k)});
      const days=[...new Set(model.calendarMatches.map(m=>Number(m.day)).filter(Boolean))].sort((a,b)=>a-b);if(days.length){for(let d=days[0];d<=days.at(-1);d++)if(!days.includes(d))warnings.push(`Giornata ${d} assente dal calendario.`);ok.push(`${days.length} giornate calendario riconosciute.`)}
      model.teams.forEach(t=>{const names=new Set(),numbers=new Set();t.players.forEach(p=>{const nk=norm(p.fullName||p.displayName);if(nk&&names.has(nk))warnings.push(`${t.name}: giocatore duplicato ${p.displayName||p.fullName}.`);names.add(nk);const num=String(p.number||'').trim();if(num&&numbers.has(num))warnings.push(`${t.name}: numero maglia ${num} duplicato.`);if(num)numbers.add(num)});if(!t.players.length)warnings.push(`${t.name}: rosa vuota.`)});
      const fileByRel=new Set(model.fileList.map(f=>norm(f.rel)));model.manifestEntries.forEach(rel=>{if(!fileByRel.has(norm(rel)))errors.push(`manifest.csv punta a un file non caricato/esistente: ${rel}.`)});
      model.fileList.filter(f=>!['manifest','config','altro'].includes(fileKind(f.rel))&&f.active===false).forEach(f=>warnings.push(`File dati presente ma non attivo nel manifest: ${f.rel}.`));
      const summaryFiles=sectionFiles(model,'riepilogo');if(summaryFiles.length>1){const daySources=new Map();model.summaryMatches.forEach(m=>{if(!m.day)return;const set=daySources.get(m.day)||new Set();set.add(m.sourceFile);daySources.set(m.day,set)});[...daySources].filter(([,s])=>s.size>1).forEach(([d,s])=>errors.push(`Giornata ${d} presente in piu riepiloghi attivi: ${[...s].join(', ')}.`))}
      return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],ok};
    }
    async function proRunVerify(){
      try{
        const r=proBuildVerifyReport();const registry=await proLoadRegistry(true);const currents=(registry.tornei||[]).filter(t=>t.corrente);if(currents.length!==1)r.warnings.push(`tornei.json contiene ${currents.length} tornei correnti; consigliato esattamente 1.`);const entry=proRegistryEntry(registry);if(!entry)r.errors.push('Torneo corrente dell Admin assente da tornei.json.');
        if(entry?.corrente && String(entry.stato||'')==='concluso')r.warnings.push('Il torneo e marcato contemporaneamente come corrente e concluso.');
        const target=proCurrentTarget(),head=await getHead(target),tree=await getTree(target,head.treeSha),paths=new Set((tree.tree||[]).filter(x=>x.type==='blob').map(x=>x.path));
        const logo=`${state.tournament}/immagini/logo_cral.png`;if(!paths.has(logo))r.warnings.push(`Logo torneo mancante: ${logo}.`);
        const missingTeams=effectiveModel().teams.filter(t=>!paths.has(imageAssetPath('team',imageAssetKey(t.name)))).map(t=>t.name);if(missingTeams.length)r.warnings.push(`Stemmi squadra mancanti (${missingTeams.length}): ${missingTeams.slice(0,8).join(', ')}${missingTeams.length>8?'...':''}.`);
        const players=effectiveModel().players||[];const missingPlayers=players.filter(p=>!paths.has(imageAssetPath('player',playerAssetKey(p))));if(players.length&&missingPlayers.length)r.warnings.push(`Foto giocatori mancanti: ${missingPlayers.length} su ${players.length}.`);
        const mf=effectiveModel().fileList.find(f=>fileKind(f.rel)==='manifest');if(mf){const raw=parseCsv(mf.text||'').rows.flat().map(x=>String(x||'').trim()).filter(x=>x&&norm(x)!=='file');const seen=new Set(),dup=[];raw.forEach(x=>{const k=norm(x);if(seen.has(k))dup.push(x);seen.add(k)});if(dup.length)r.warnings.push(`manifest.csv contiene righe duplicate: ${[...new Set(dup)].join(', ')}.`)}
        state.proVerifyReport=r;state.status={type:r.errors.length?'error':r.warnings.length?'warning':'success',text:r.errors.length?`Verifica completata con ${r.errors.length} errori.`:`Verifica completata: nessun errore bloccante.`};render()
      }catch(e){state.status={type:'error',text:e.message||String(e)};render()}
    }
    function proFixManifest(){const model=effectiveModel();const entries=model.fileList.filter(f=>!['manifest','config','altro'].includes(fileKind(f.rel))).map(f=>f.rel);proStageManifest(entries,'Ricostruzione automatica manifest');refreshModelFromPending();state.status={type:'success',text:'manifest.csv ricostruito dai file dati rilevati. Controlla Pubblica.'};render()}
    function proRenderVerify(main){
      main.appendChild(pageHead('Verifica torneo','Controlla coerenza tra squadre, calendario, manifest, riepiloghi e metadati del torneo.',[button('Esegui verifica','gold',proRunVerify),button('Ricostruisci manifest','secondary',proFixManifest)]));const r=state.proVerifyReport;if(!r){main.appendChild(messageBox('info','Premi Esegui verifica per generare il report sullo stato corrente, incluse le modifiche non ancora pubblicate.'));return}const card=el('div','card pro-report');if(!r.errors.length&&!r.warnings.length)card.appendChild(el('div','pro-report-row ok','✓ Nessuna anomalia rilevata.'));r.errors.forEach(x=>card.appendChild(el('div','pro-report-row error',`ERRORE · ${x}`)));r.warnings.forEach(x=>card.appendChild(el('div','pro-report-row warning',`ATTENZIONE · ${x}`)));r.ok.forEach(x=>card.appendChild(el('div','pro-report-row ok',`OK · ${x}`)));main.appendChild(card)
    }

    async function proGhJson(target,suffix,options={}){
      const url=`https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}${suffix}`;const res=await fetch(url,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${target.token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})}});const raw=await res.text();let body=raw;try{body=raw?JSON.parse(raw):null}catch{}if(!res.ok)throw new Error(body?.message||`GitHub API ${res.status}`);return body
    }
    async function proPromotionInfo(){
      if(state.target!=='collaudo')throw new Error('Apri la sezione Promuovi dall ambiente Collaudo.');const src=requireTarget('collaudo'),dst=requireTarget('produzione');const [sh,dh]=await Promise.all([getHead(src),getHead(dst)]);const [st,dt,sreg,dreg]=await Promise.all([getTree(src,sh.treeSha),getTree(dst,dh.treeSha),getTextFile(src,'tornei.json'),getTextFile(dst,'tornei.json')]);const sourceFiles=(st.tree||[]).filter(x=>x.type==='blob'&&x.path.startsWith(state.tournament+'/'));const destFiles=(dt.tree||[]).filter(x=>x.type==='blob'&&x.path.startsWith(state.tournament+'/'));const sr=parseTournamentRegistry(sreg),dr=parseTournamentRegistry(dreg);const meta=(sr.tornei||[]).find(t=>String(t.cartella||'').replace(/^\/+|\/+$/g,'')===state.tournament);if(!meta)throw new Error('Metadati torneo non trovati in Collaudo.');return{src,dst,sh,dh,sourceFiles,destFiles,sr,dr,meta}
    }
    async function proPreviewPromotion(){try{state.proPromotionPreview=await proPromotionInfo();render()}catch(e){state.status={type:'error',text:e.message||String(e)};render()}}
    async function proPromote(makeCurrent,confirmation){
      if(!proNoPending('Promozione in Produzione'))return;if(confirmation!=='PROMUOVI PRODUZIONE'){state.status={type:'error',text:'Digita esattamente PROMUOVI PRODUZIONE.'};render();return}try{renderLoading('Promozione torneo in Produzione...');const info=await proPromotionInfo();const changes=[];for(const f of info.sourceFiles){const blob=await proGhJson(info.src,`/git/blobs/${f.sha}`);changes.push({path:f.path,contentBase64:String(blob.content||'').replace(/\s+/g,'')})}const reg=structuredClone(info.dr);const old=(reg.tornei||[]).findIndex(t=>String(t.cartella||'').replace(/^\/+|\/+$/g,'')===state.tournament);const meta=structuredClone(info.meta);if(makeCurrent){(reg.tornei||[]).forEach(t=>{if(t.corrente&&String(t.cartella||'').replace(/^\/+|\/+$/g,'')!==state.tournament){t.corrente=false;if(String(t.stato||'')==='in-corso')t.stato='concluso'}});meta.corrente=true;meta.stato='in-corso';reg.logo=`${state.tournament}/immagini/logo_cral.png`}else meta.corrente=false;if(old>=0)reg.tornei[old]=meta;else reg.tornei.push(meta);changes.push({path:'tornei.json',content:JSON.stringify(reg,null,2)+'\n'});const result=await createAtomicCommit(info.dst,{baseCommitSha:info.dh.commitSha,changes,message:`Admin CRAL: promuovi ${meta.id||state.tournament} in produzione`});state.status={type:'success',text:`Promozione completata in Produzione. ${changes.length-1} file torneo copiati. Commit ${result.sha.slice(0,8)}.`};state.proPromotionPreview=null;render()}catch(e){state.status={type:'error',text:e.message||String(e)};render()}
    }
    function proRenderPromote(main){
      main.appendChild(pageHead('Promuovi in Produzione','Copia l intero torneo da Collaudo a Produzione e sincronizza tornei.json in un unico commit.'));
      if(state.target!=='collaudo'){main.appendChild(messageBox('warning','Questa funzione parte dal Collaudo. Cambia Ambiente in alto e torna qui.'));return}if(!state.targets.produzione){main.appendChild(messageBox('warning','Configura prima le credenziali dell ambiente Produzione dal selettore Ambiente.'));return}const card=el('div','card');card.appendChild(el('p','',`Torneo sorgente: ${state.tournament}`));card.appendChild(button('Confronta con Produzione','secondary',proPreviewPromotion));if(state.proPromotionPreview){const p=state.proPromotionPreview;card.appendChild(messageBox('info',[`File sorgente: ${p.sourceFiles.length}.`,`File gia presenti in Produzione: ${p.destFiles.length}.`,`La promozione sovrascrive i file con lo stesso path e aggiunge quelli mancanti.`]));const current=input('checkbox');current.checked=!!p.meta.corrente;const lab=el('label','checkbox-row');lab.append(current,document.createTextNode(' Imposta come torneo corrente anche in Produzione'));card.appendChild(lab);const conf=input('text','');conf.placeholder='PROMUOVI PRODUZIONE';card.appendChild(fieldWrap('Conferma',conf));card.appendChild(button('Promuovi ora','gold',()=>proPromote(current.checked,conf.value)))}main.appendChild(card)
    }

    function proAppendFileManager(main){
      const card=el('div','card');card.appendChild(el('h3','','Gestione file'));card.appendChild(el('p','pro-muted','Crea, carica, rinomina o elimina file testuali sotto data/. Il manifest viene aggiornato automaticamente.'));
      const rel=input('text','');rel.placeholder='es. note_extra.csv';const ta=el('textarea','textarea');ta.placeholder='Contenuto del nuovo file';const pick=input('file');pick.accept='.csv,.txt,.json,text/csv,text/plain,application/json';pick.addEventListener('change',async()=>{const f=pick.files?.[0];if(!f)return;rel.value=f.name;ta.value=await f.text()});card.append(fieldWrap('Nuovo file / destinazione',rel),pick,ta);card.appendChild(button('Aggiungi alle modifiche','secondary',()=>{try{const r=proNormPath(rel.value);state.pending.set(`${state.model.dataRoot}/${r}`,{path:`${state.model.dataRoot}/${r}`,content:ta.value,source:'Nuovo file'});proSetManifestEntry('',r);refreshModelFromPending();state.status={type:'success',text:`${r} pronto per la pubblicazione.`};render()}catch(e){state.status={type:'error',text:e.message};render()}}));
      const current=effectiveModel().fileList.find(f=>f.path===state.selectedFile);if(current&&!['manifest','config'].includes(fileKind(current.rel))){const hr=document.createElement('hr');card.appendChild(hr);const rename=input('text',current.rel);card.appendChild(fieldWrap(`Rinomina ${current.rel}`,rename));const actions=el('div','pro-actions');actions.appendChild(button('Rinomina','secondary',()=>{try{const nr=proNormPath(rename.value);if(norm(nr)===norm(current.rel))return;const content=state.pending.get(current.path)?.content??current.text;state.pending.set(current.path,{path:current.path,delete:true,source:'Rinomina file'});state.pending.set(`${state.model.dataRoot}/${nr}`,{path:`${state.model.dataRoot}/${nr}`,content,source:`Rinominato da ${current.rel}`});proSetManifestEntry(current.rel,nr);refreshModelFromPending();state.selectedFile=`${state.model.dataRoot}/${nr}`;render()}catch(e){state.status={type:'error',text:e.message};render()}}));actions.appendChild(button('Elimina file','danger',()=>{if(!window.confirm(`Eliminare ${current.rel}?`))return;state.pending.set(current.path,{path:current.path,delete:true,source:'Elimina file'});proSetManifestEntry(current.rel,'');refreshModelFromPending();render()}));card.appendChild(actions)}main.appendChild(card)
    }
    const proBaseRenderFiles=renderFiles;renderFiles=function(main){proBaseRenderFiles(main);proAppendFileManager(main)};

    function proPublishPreview(main){
      if(!state.pending.size)return;const card=el('div','card');card.appendChild(el('h3','','Anteprima modifiche'));let add=0,mod=0,del=0,bytes=0;const currentPaths=new Set(Object.keys(state.snapshot.files||{}));const table=el('table','pro-table');table.innerHTML='<thead><tr><th>Azione</th><th>File</th><th>Origine</th><th>Dimensione</th></tr></thead>';const tb=el('tbody');state.pending.forEach(c=>{let action;if(c.delete){action='ELIMINA';del++}else if(currentPaths.has(c.path)){action='MODIFICA';mod++}else{action='NUOVO';add++}const b=c.contentBase64?Math.floor(String(c.contentBase64).length*3/4):proBytes(c.content);bytes+=b;const tr=el('tr');[action,proRel(c.path),c.source||'Modifica',c.delete?'—':`${b} B`].forEach((v,i)=>tr.appendChild(el('td',i===1?'pro-code':'',v)));tb.appendChild(tr)});table.appendChild(tb);const k=el('div','pro-kpis');[['Nuovi',add],['Modificati',mod],['Eliminati',del],['Byte',bytes]].forEach(([l,v])=>{const x=el('div','pro-kpi');x.append(el('b','',v),el('span','',l));k.appendChild(x)});card.append(k,table);main.insertBefore(card,main.lastElementChild)
    }
    const proBaseRenderPublish=renderPublish;renderPublish=function(main){proBaseRenderPublish(main);proPublishPreview(main)};

    async function proLoadHistory(){
      if(state.proHistoryLoading)return;state.proHistoryLoading=true;try{const t=proCurrentTarget();const data=await proGhJson(t,`/commits?path=${encodeURIComponent(state.tournament)}&per_page=20`);state.proHistory=(data||[]).map(c=>({sha:c.sha,message:c.commit?.message||'',date:c.commit?.author?.date||'',author:c.commit?.author?.name||''}));}catch(e){state.status={type:'error',text:e.message||String(e)}}finally{state.proHistoryLoading=false;render()}
    }
    async function proRollbackTournament(commitSha,includeRegistry=false){
      if(!proNoPending('Rollback'))return;if(!window.confirm(`Ripristinare ${state.tournament} al commit ${commitSha.slice(0,8)}? Verrà creato un NUOVO commit di ripristino.`))return;try{renderLoading('Preparazione rollback torneo...');const t=proCurrentTarget();const [head,oldCommit]=await Promise.all([getHead(t),proGhJson(t,`/git/commits/${commitSha}`)]);const [nowTree,oldTree]=await Promise.all([getTree(t,head.treeSha),getTree(t,oldCommit.tree.sha)]);const prefix=state.tournament+'/';const cur=new Map((nowTree.tree||[]).filter(x=>x.type==='blob'&&x.path.startsWith(prefix)).map(x=>[x.path,x]));const old=new Map((oldTree.tree||[]).filter(x=>x.type==='blob'&&x.path.startsWith(prefix)).map(x=>[x.path,x]));const changes=[];cur.forEach((v,p)=>{if(!old.has(p))changes.push({path:p,delete:true})});old.forEach((v,p)=>{if(!cur.has(p)||cur.get(p).sha!==v.sha)changes.push({path:p,sourceSha:v.sha})});if(includeRegistry){const oldReg=(oldTree.tree||[]).find(x=>x.type==='blob'&&x.path==='tornei.json');if(oldReg)changes.push({path:'tornei.json',sourceSha:oldReg.sha})}if(!changes.length){state.status={type:'warning',text:'Il torneo coincide gia con la versione selezionata.'};render();return}const result=await createAtomicCommit(t,{baseCommitSha:head.commitSha,changes,message:`Admin CRAL: rollback ${state.tournament} a ${commitSha.slice(0,8)}`});await proRefreshAll(`Rollback completato con nuovo commit ${result.sha.slice(0,8)}.`)}catch(e){state.status={type:'error',text:e.message||String(e)};render()}
    }
    function proRenderHistory(main){
      main.appendChild(pageHead('Storico e rollback','Mostra gli ultimi commit che hanno toccato il torneo. Il rollback non riscrive la storia: crea un nuovo commit con i file della versione scelta.',[button('Ricarica storico','secondary',()=>{state.proHistory=[];proLoadHistory()})]));
      const opt=el('label','checkbox-row');const include=input('checkbox');include.checked=!!state.proHistoryIncludeRegistry;include.addEventListener('change',()=>state.proHistoryIncludeRegistry=include.checked);opt.append(include,document.createTextNode(' Includi anche tornei.json nel rollback (metadati/stato corrente)'));main.appendChild(opt);
      if(!state.proHistory.length){const c=el('div','card');c.appendChild(el('div','pro-muted',state.proHistoryLoading?'Caricamento...':'Carico gli ultimi commit del torneo...'));main.appendChild(c);if(!state.proHistoryLoading)proLoadHistory();return}const card=el('div','card');state.proHistory.forEach(h=>{const row=el('div','pro-history-row');row.appendChild(el('code','',h.sha.slice(0,8)));const copy=el('div');copy.append(el('strong','',h.message.split('\n')[0]),el('div','pro-muted',`${h.author} · ${h.date?new Date(h.date).toLocaleString('it-IT'):''}`));row.appendChild(copy);row.appendChild(button('Ripristina torneo','danger small',()=>proRollbackTournament(h.sha,!!state.proHistoryIncludeRegistry)));card.appendChild(row)});main.appendChild(card)
    }
  }

  function patchAdminSource(source) {
    let s = source;
    s = s.replace(
      "  validateListoneRows, validateNewEvent, validateRosterAgainstListone\n} from './core.js';",
      "  validateListoneRows, validateNewEvent, validateRosterAgainstListone,\n  parseCsv, rowsToObjects, field\n} from './core.js';"
    );
    s = s.replace(
      "  saveSession, loadSession, clearSession\n} from './gh.js';",
      "  saveSession, loadSession, clearSession,\n  getHead, getTree, getBlobText, createAtomicCommit\n} from './gh.js';"
    );
    const marker = 'sessionCheck();';
    if (!s.includes(marker)) throw new Error('Admin Pro: marker sessionCheck non trovato.');
    s = s.replace(marker, `\n;(${adminExtension.toString()})();\n${marker}`);
    return s;
  }

  function patchGhSource(source) {
    const oldLine = "  changes.push({ path: 'tornei.json', content: updateTournamentRegistry(registryText, checked.value, newTournament, !!logoEntry) });";
    if (!source.includes(oldLine)) throw new Error('Admin Pro: creazione torneo non compatibile con la versione attesa di gh.js.');
    const replacement = `  let nextRegistryText = updateTournamentRegistry(registryText, checked.value, newTournament, !!logoEntry);\n  if (checked.value.makeCurrent) {\n    const beforeRegistry = parseTournamentRegistry(registryText);\n    const previousCurrent = new Set((beforeRegistry.tornei || []).filter(t => t.corrente).map(t => String(t.cartella || '').replace(/^\\/+|\\/+$/g, '')));\n    const nextRegistry = parseTournamentRegistry(nextRegistryText);\n    (nextRegistry.tornei || []).forEach(t => {\n      const path = String(t.cartella || '').replace(/^\\/+|\\/+$/g, '');\n      if (path !== newTournament && previousCurrent.has(path)) { t.corrente = false; t.stato = 'concluso'; }\n    });\n    nextRegistryText = JSON.stringify(nextRegistry, null, 2) + '\\n';\n  }\n  changes.push({ path: 'tornei.json', content: nextRegistryText });`;
    return source.replace(oldLine, replacement);
  }

  window.fetch = async function(input, init) {
    const response = await nativeFetch(input, init);
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!/\/admin\/(admin|gh)\.js$/i.test(url.pathname) || !url.searchParams.has('v30src')) return response;
      const text = await response.clone().text();
      const patched = /\/admin\/admin\.js$/i.test(url.pathname) ? patchAdminSource(text) : patchGhSource(text);
      return new Response(patched, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      console.error('[CRAL Admin Pro]', error);
      return response;
    }
  };
})();
