/*
  CRAL Champions - Generatore rosa Fantacalcio
  Pagina standalone, senza backend e senza persistenza lato server.

  Contratto con il frontend/admin esistente:
  - listone ufficiale: data/fantacalcio/listone_fantacalcio.csv
  - export utente: partecipante;idGiocatore (rosa complessiva)
  - filename download: rosa_<partecipante_slug>.csv
  - l'Admin replica la rosa su tutte le giornate del calendario e pubblica i file canonici interni.
  - regola rosa: 1 PT + 4 giocatori di movimento (5 totali)
  - budget: baseCreditiSuggeriti del listone; fallback storico 250.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CralFantaRosterBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MANIFEST_URL = 'data/manifest.csv';
  const CONFIG_URL = 'data/config.csv';
  const LISTONE_URL = 'data/fantacalcio/listone_fantacalcio.csv';
  const DEFAULT_DAY = 1;
  const DEFAULT_BUDGET = 250;
  const REQUIRED_TOTAL = 5;
  const REQUIRED_KEEPERS = 1;
  const REQUIRED_MOVEMENT = 4;

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/^\uFEFF/, '').trim();
  }

  function normalizeKey(value) {
    return cleanText(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function idKey(value) {
    const raw = cleanText(value);
    const digits = raw.replace(/\D/g, '');
    if (!digits) return normalizeKey(raw);
    const n = Number.parseInt(digits, 10);
    return Number.isFinite(n) ? String(n) : normalizeKey(raw);
  }

  function slugParticipant(name) {
    return cleanText(name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'partecipante';
  }

  function rosterFileName(participant) {
    return `rosa_${slugParticipant(participant)}.csv`;
  }

  function manifestHasFantacalcio(text) {
    const parsed = parseDelimited(text);
    if (!parsed.rows.length) return false;
    const rows = parsed.rows;
    const header = rows[0].map(normalizeKey);
    const fileIndex = header.findIndex(h => ['file', 'nome', 'filename', 'path', 'percorso'].includes(h));
    const values = fileIndex >= 0
      ? rows.slice(1).map(row => cleanText(row[fileIndex]))
      : rows.flat().map(cleanText);
    return values.some(value => {
      const path = value.replace(/\\/g, '/').replace(/^\/?data\//i, '').replace(/^\/+/, '');
      return /^fantacalcio\/listone_fantacalcio\.csv$/i.test(path);
    });
  }

  function parseConfig(text) {
    const parsed = parseDelimited(text);
    const out = {};
    if (!parsed.rows.length) return out;
    const header = parsed.rows[0].map(normalizeKey);
    const keyIndex = header.findIndex(h => ['chiave', 'key', 'nome'].includes(h));
    const valueIndex = header.findIndex(h => ['valore', 'value', 'testo'].includes(h));
    if (keyIndex < 0 || valueIndex < 0) return out;
    parsed.rows.slice(1).forEach(row => {
      const key = normalizeKey(row[keyIndex]);
      if (!key) return;
      out[key] = cleanText(row[valueIndex]);
    });
    return out;
  }

  function configBool(value, fallback = true) {
    const v = normalizeKey(value);
    if (!v) return fallback;
    if (['false', '0', 'no', 'n', 'off', 'disabilitato'].includes(v)) return false;
    if (['true', '1', 'si', 's', 'yes', 'on', 'abilitato'].includes(v)) return true;
    return fallback;
  }

  function rosterWindowStatus(config, now = Date.now()) {
    const cfg = config || {};
    const enabled = configBool(cfg.fantacalciocreazionerosaenabled, true);
    const openRaw = cleanText(cfg.fantacalciocreazionerosaopenfrom);
    const closeRaw = cleanText(cfg.fantacalciocreazionerosacloseat);
    const openAt = Date.parse(openRaw);
    const closeAt = Date.parse(closeRaw);
    if (!enabled) return { open: false, reason: 'disabled', openAt: null, closeAt: null };
    if (Number.isFinite(openAt) && now < openAt) return { open: false, reason: 'not-open-yet', openAt, closeAt: Number.isFinite(closeAt) ? closeAt : null };
    if (Number.isFinite(closeAt) && now >= closeAt) return { open: false, reason: 'closed', openAt: Number.isFinite(openAt) ? openAt : null, closeAt };
    return { open: true, reason: 'open', openAt: Number.isFinite(openAt) ? openAt : null, closeAt: Number.isFinite(closeAt) ? closeAt : null };
  }

  function rosterWindowMessage(status) {
    if (!status || status.open) return '';
    if (status.reason === 'disabled') return 'Creazione rose disabilitata dall\'admin.';
    if (status.reason === 'not-open-yet' && Number.isFinite(status.openAt)) return `Creazione rose non ancora aperta. Apertura: ${new Date(status.openAt).toLocaleString('it-IT')}.`;
    if (status.reason === 'closed' && Number.isFinite(status.closeAt)) return `Creazione rose chiusa. Termine: ${new Date(status.closeAt).toLocaleString('it-IT')}.`;
    return 'Creazione rose non disponibile in questo momento.';
  }

  function detectSeparator(text) {
    const first = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).find(line => line.trim()) || '';
    const semicolons = (first.match(/;/g) || []).length;
    const commas = (first.match(/,/g) || []).length;
    return semicolons >= commas ? ';' : ',';
  }

  function parseDelimited(text, separator) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const sep = separator || detectSeparator(source);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"') {
          if (source[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === sep) { row.push(field); field = ''; continue; }
      if (ch === '\r') continue;
      if (ch === '\n') {
        row.push(field); field = '';
        if (row.some(value => String(value).trim() !== '')) rows.push(row);
        row = [];
        continue;
      }
      field += ch;
    }
    if (field !== '' || row.length) {
      row.push(field);
      if (row.some(value => String(value).trim() !== '')) rows.push(row);
    }
    return { separator: sep, rows };
  }

  function fantaRole(raw) {
    const v = cleanText(raw).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!v) return 'G';
    if (v === 'PT' || v === 'P' || v === 'POR' || v === 'PORTIERE' || v === 'GK' || v.startsWith('PORT')) return 'PT';
    if (v === 'D' || v === 'DC' || v === 'DD' || v === 'DS' || v === 'DIF' || v === 'DIFENSORE' || v.startsWith('DIF') || v === 'DEF' || v.startsWith('DEF')) return 'D';
    if (v === 'C' || v === 'CC' || v === 'CD' || v === 'CS' || v === 'CEN' || v === 'CENTROCAMPISTA' || v.startsWith('CENTR') || v === 'MID' || v.startsWith('MID')) return 'C';
    if (v === 'A' || v === 'ATT' || v === 'ATTACCANTE' || v.startsWith('ATT') || v === 'FW' || v === 'FWD' || v === 'FORWARD' || v === 'STRIKER') return 'A';
    return 'G';
  }

  function parseListone(text) {
    const parsed = parseDelimited(text);
    if (!parsed.rows.length) throw new Error('Il listone ufficiale è vuoto.');
    const headers = parsed.rows[0].map(cleanText);
    const byHeader = new Map(headers.map((header, index) => [normalizeKey(header), index]));
    const required = ['id', 'ruolo', 'giocatore', 'squadra', 'crediti'];
    const missing = required.filter(name => !byHeader.has(normalizeKey(name)));
    if (missing.length) throw new Error(`Listone non compatibile: mancano le colonne ${missing.join(', ')}.`);

    const idx = name => byHeader.get(normalizeKey(name));
    const budgetIndex = byHeader.get(normalizeKey('baseCreditiSuggeriti'));
    const players = [];
    const seen = new Map();
    const budgets = new Set();

    for (let i = 1; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      if (!row.some(value => cleanText(value))) continue;
      const id = cleanText(row[idx('id')]);
      const roleRaw = cleanText(row[idx('ruolo')]);
      const playerName = cleanText(row[idx('giocatore')]);
      const team = cleanText(row[idx('squadra')]);
      const creditsRaw = cleanText(row[idx('crediti')]).replace(',', '.');
      const credits = Number(creditsRaw);
      const line = i + 1;

      if (!id || !roleRaw || !playerName || !team || !Number.isFinite(credits) || credits < 0) {
        throw new Error(`Listone non valido alla riga ${line}: id, ruolo, giocatore, squadra e crediti sono obbligatori.`);
      }
      const key = idKey(id);
      if (seen.has(key)) throw new Error(`Listone non valido: id ${id} duplicato alle righe ${seen.get(key)} e ${line}.`);
      seen.set(key, line);

      if (budgetIndex !== undefined) {
        const rawBudget = cleanText(row[budgetIndex]).replace(',', '.');
        if (rawBudget) {
          const n = Number(rawBudget);
          if (!Number.isFinite(n) || n <= 0) throw new Error(`Listone non valido alla riga ${line}: baseCreditiSuggeriti non numerica.`);
          budgets.add(String(n));
        }
      }

      players.push({
        id,
        role: fantaRole(roleRaw),
        roleRaw,
        name: playerName,
        team,
        credits
      });
    }

    if (!players.length) throw new Error('Il listone ufficiale non contiene giocatori.');
    if (budgets.size > 1) throw new Error('Listone non valido: baseCreditiSuggeriti non è uguale per tutti i giocatori.');
    const budget = budgets.size === 1 ? Number([...budgets][0]) : DEFAULT_BUDGET;
    return { players, budget, separator: parsed.separator };
  }

  function validateParticipant(name) {
    const participant = cleanText(name).replace(/\s+/g, ' ');
    const errors = [];
    if (!participant) errors.push('Inserisci nome e cognome del partecipante.');
    if (participant.length > 100) errors.push('Il nome del partecipante è troppo lungo.');
    return { participant, errors };
  }

  function validateRoster(selectedIds, players, budget) {
    const ids = Array.isArray(selectedIds) ? selectedIds.map(cleanText).filter(Boolean) : [];
    const list = Array.isArray(players) ? players : [];
    const byId = new Map();
    list.forEach(player => byId.set(idKey(player.id), player));

    const errors = [];
    const resolved = [];
    const seen = new Set();
    let credits = 0;
    let keepers = 0;
    let movement = 0;

    ids.forEach(id => {
      const key = idKey(id);
      if (seen.has(key)) {
        errors.push(`Il giocatore con id ${id} è stato selezionato più di una volta.`);
        return;
      }
      seen.add(key);
      const player = byId.get(key);
      if (!player) {
        errors.push(`Il giocatore con id ${id} non è presente nel listone ufficiale.`);
        return;
      }
      resolved.push(player);
      credits += Number(player.credits) || 0;
      if (fantaRole(player.role) === 'PT') keepers++;
      else movement++;
    });

    if (ids.length !== REQUIRED_TOTAL) errors.push(`La rosa deve contenere esattamente ${REQUIRED_TOTAL} giocatori.`);
    if (keepers !== REQUIRED_KEEPERS) errors.push(`La rosa deve contenere esattamente ${REQUIRED_KEEPERS} portiere (PT).`);
    if (movement !== REQUIRED_MOVEMENT) errors.push(`La rosa deve contenere esattamente ${REQUIRED_MOVEMENT} giocatori di movimento.`);

    const maxBudget = Number.isFinite(Number(budget)) && Number(budget) > 0 ? Number(budget) : DEFAULT_BUDGET;
    if (credits > maxBudget) errors.push(`Budget superato: ${credits} crediti utilizzati su ${maxBudget}.`);

    return {
      valid: errors.length === 0,
      errors,
      players: resolved,
      total: ids.length,
      keepers,
      movement,
      credits,
      budget: maxBudget,
      remaining: maxBudget - credits
    };
  }

  function csvEscape(value, separator) {
    const text = String(value == null ? '' : value);
    if (text.includes('"') || text.includes('\r') || text.includes('\n') || text.includes(separator)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function buildRosterCsv(participantName, selectedIds) {
    const participantValidation = validateParticipant(participantName);
    if (participantValidation.errors.length) throw new Error(participantValidation.errors[0]);
    const separator = ';';
    const rows = [
      ['partecipante', 'idGiocatore'],
      ...(selectedIds || []).map(id => [participantValidation.participant, cleanText(id)])
    ];
    return rows.map(row => row.map(value => csvEscape(value, separator)).join(separator)).join('\r\n') + '\r\n';
  }

  function initPage() {
    if (typeof document === 'undefined') return;
    const app = document.querySelector('[data-roster-builder]');
    if (!app) return;

    const $ = selector => app.querySelector(selector);
    const participantInput = $('#participantName');
    const searchInput = $('#playerSearch');
    const roleFilter = $('#roleFilter');
    const playersList = $('#playersList');
    const selectedList = $('#selectedList');
    const downloadButton = $('#downloadRoster');
    const resetButton = $('#resetRoster');
    const statusBox = $('#validationStatus');
    const listoneStatus = $('#listoneStatus');
    const creditUsed = $('#creditUsed');
    const creditBudget = $('#creditBudget');
    const creditRemaining = $('#creditRemaining');
    const countTotal = $('#countTotal');
    const countPt = $('#countPt');
    const countMovement = $('#countMovement');
    const themeButton = document.getElementById('themeToggle');

    const state = { players: [], budget: DEFAULT_BUDGET, selectedIds: [], ready: false };

    function applyTheme(theme, save) {
      const dark = theme === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      if (themeButton) {
        themeButton.textContent = dark ? '☀️' : '🌙';
        themeButton.setAttribute('aria-label', dark ? 'Passa al tema chiaro' : 'Passa al tema scuro');
      }
      if (save) localStorage.setItem('cral_theme', dark ? 'dark' : 'light');
    }

    const savedTheme = localStorage.getItem('cral_theme');
    const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme === 'dark' || (!savedTheme && prefersDark) ? 'dark' : 'light', false);
    if (themeButton) themeButton.addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    });

    function selectedSet() {
      return new Set(state.selectedIds.map(idKey));
    }

    function currentValidation() {
      return validateRoster(state.selectedIds, state.players, state.budget);
    }

    function canAdd(player) {
      if (!state.ready) return false;
      const selected = selectedSet();
      if (selected.has(idKey(player.id))) return false;
      if (state.selectedIds.length >= REQUIRED_TOTAL) return false;
      const validation = currentValidation();
      if (fantaRole(player.role) === 'PT' && validation.keepers >= REQUIRED_KEEPERS) return false;
      if (fantaRole(player.role) !== 'PT' && validation.movement >= REQUIRED_MOVEMENT) return false;
      return validation.credits + Number(player.credits || 0) <= state.budget;
    }

    function playerMatches(player) {
      const query = normalizeKey(searchInput ? searchInput.value : '');
      const filter = roleFilter ? roleFilter.value : 'all';
      if (filter === 'pt' && fantaRole(player.role) !== 'PT') return false;
      if (filter === 'movement' && fantaRole(player.role) === 'PT') return false;
      if (!query) return true;
      return [player.name, player.team, player.roleRaw, player.id].some(value => normalizeKey(value).includes(query));
    }

    function renderPlayers() {
      playersList.innerHTML = '';
      if (!state.ready) return;
      const selected = selectedSet();
      const visible = state.players.filter(playerMatches);
      if (!visible.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Nessun giocatore corrisponde ai filtri.';
        playersList.appendChild(empty);
        return;
      }
      visible.forEach(player => {
        const card = document.createElement('article');
        card.className = 'player-card';
        card.dataset.playerId = player.id;
        const isSelected = selected.has(idKey(player.id));
        if (isSelected) card.classList.add('is-selected');

        const main = document.createElement('div');
        main.className = 'player-main';
        const top = document.createElement('div');
        top.className = 'player-topline';
        const role = document.createElement('span');
        role.className = 'role-pill ' + (fantaRole(player.role) === 'PT' ? 'is-keeper' : '');
        role.textContent = fantaRole(player.role) === 'PT' ? 'PT' : (player.roleRaw || 'G');
        const name = document.createElement('strong');
        name.textContent = player.name;
        top.appendChild(role); top.appendChild(name);
        const meta = document.createElement('span');
        meta.className = 'player-meta';
        meta.textContent = `${player.team} · ${player.credits} crediti`;
        main.appendChild(top); main.appendChild(meta);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'player-add';
        button.dataset.action = isSelected ? 'remove' : 'add';
        button.dataset.playerId = player.id;
        button.textContent = isSelected ? 'Rimuovi' : 'Aggiungi';
        if (!isSelected && !canAdd(player)) button.disabled = true;
        button.addEventListener('click', () => {
          if (isSelected) state.selectedIds = state.selectedIds.filter(id => idKey(id) !== idKey(player.id));
          else if (canAdd(player)) state.selectedIds.push(player.id);
          renderAll();
        });

        card.appendChild(main); card.appendChild(button); playersList.appendChild(card);
      });
    }

    function renderSelected() {
      selectedList.innerHTML = '';
      const byId = new Map(state.players.map(player => [idKey(player.id), player]));
      if (!state.selectedIds.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Nessun giocatore selezionato.';
        selectedList.appendChild(empty);
        return;
      }
      state.selectedIds.forEach((id, index) => {
        const player = byId.get(idKey(id));
        if (!player) return;
        const row = document.createElement('div');
        row.className = 'selected-player';
        const n = document.createElement('span');
        n.className = 'selected-index'; n.textContent = String(index + 1);
        const copy = document.createElement('div'); copy.className = 'selected-copy';
        const strong = document.createElement('strong'); strong.textContent = player.name;
        const small = document.createElement('small'); small.textContent = `${fantaRole(player.role) === 'PT' ? 'PT' : 'Movimento'} · ${player.team} · ${player.credits} crediti`;
        copy.appendChild(strong); copy.appendChild(small);
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-player'; remove.textContent = '×'; remove.setAttribute('aria-label', `Rimuovi ${player.name}`);
        remove.addEventListener('click', () => { state.selectedIds.splice(index, 1); renderAll(); });
        row.appendChild(n); row.appendChild(copy); row.appendChild(remove); selectedList.appendChild(row);
      });
    }

    function renderSummary() {
      const roster = currentValidation();
      const participant = validateParticipant(participantInput ? participantInput.value : '');
      creditUsed.textContent = String(roster.credits);
      creditBudget.textContent = String(roster.budget);
      creditRemaining.textContent = String(roster.remaining);
      countTotal.textContent = `${roster.total}/${REQUIRED_TOTAL}`;
      countPt.textContent = `${roster.keepers}/${REQUIRED_KEEPERS}`;
      countMovement.textContent = `${roster.movement}/${REQUIRED_MOVEMENT}`;

      const allErrors = [...participant.errors, ...roster.errors];
      statusBox.innerHTML = '';
      if (!state.ready) {
        statusBox.className = 'validation-status is-loading';
        statusBox.textContent = 'Caricamento del listone ufficiale…';
      } else if (!allErrors.length) {
        statusBox.className = 'validation-status is-valid';
        statusBox.innerHTML = '<strong>✓ Rosa valida</strong><span>Il CSV può essere scaricato e inviato all\'admin.</span>';
      } else {
        statusBox.className = 'validation-status is-invalid';
        const title = document.createElement('strong'); title.textContent = 'Rosa non ancora valida'; statusBox.appendChild(title);
        const ul = document.createElement('ul');
        allErrors.forEach(error => { const li = document.createElement('li'); li.textContent = error; ul.appendChild(li); });
        statusBox.appendChild(ul);
      }
      downloadButton.disabled = !state.ready || allErrors.length > 0;
    }

    function renderAll() {
      renderSelected();
      renderSummary();
      renderPlayers();
    }

    if (participantInput) participantInput.addEventListener('input', renderSummary);
    if (searchInput) searchInput.addEventListener('input', renderPlayers);
    if (roleFilter) roleFilter.addEventListener('change', renderPlayers);
    if (resetButton) resetButton.addEventListener('click', () => { state.selectedIds = []; renderAll(); });

    if (downloadButton) downloadButton.addEventListener('click', () => {
      const participant = validateParticipant(participantInput.value);
      const roster = currentValidation();
      if (!state.ready || participant.errors.length || !roster.valid) { renderSummary(); return; }
      const csv = buildRosterCsv(participant.participant, state.selectedIds);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = rosterFileName(participant.participant);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    async function loadListone() {
      try {
        // config.csv governa la disponibilità temporale del builder. Per i tornei
        // legacy senza le nuove chiavi il comportamento resta aperto (fallback true).
        let config = {};
        try {
          const configResponse = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' });
          if (configResponse.ok) config = parseConfig(await configResponse.text());
        } catch { /* compatibilità legacy: config non leggibile => nessun blocco aggiuntivo */ }
        const access = rosterWindowStatus(config);
        if (!access.open) throw new Error(rosterWindowMessage(access));

        const manifestResponse = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
        if (!manifestHasFantacalcio(await manifestResponse.text())) {
          throw new Error('Fantacalcio non ancora configurato per questo torneo.');
        }
        const response = await fetch(`${LISTONE_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`listone HTTP ${response.status}`);
        const parsed = parseListone(await response.text());
        state.players = parsed.players;
        state.budget = parsed.budget;
        state.ready = true;
        listoneStatus.className = 'source-status is-ok';
        listoneStatus.textContent = `Listone ufficiale caricato · ${parsed.players.length} giocatori · budget ${parsed.budget} crediti`;
        renderAll();
      } catch (error) {
        state.ready = false;
        listoneStatus.className = 'source-status is-error';
        listoneStatus.textContent = `Impossibile caricare il listone ufficiale: ${error && error.message ? error.message : error}`;
        renderAll();
      }
    }

    renderAll();
    loadListone();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage, { once: true });
    else initPage();
  }

  return {
    MANIFEST_URL,
    CONFIG_URL,
    LISTONE_URL,
    DEFAULT_DAY,
    DEFAULT_BUDGET,
    REQUIRED_TOTAL,
    REQUIRED_KEEPERS,
    REQUIRED_MOVEMENT,
    cleanText,
    normalizeKey,
    idKey,
    slugParticipant,
    rosterFileName,
    manifestHasFantacalcio,
    parseConfig,
    configBool,
    rosterWindowStatus,
    rosterWindowMessage,
    parseDelimited,
    fantaRole,
    parseListone,
    validateParticipant,
    validateRoster,
    buildRosterCsv
  };
});
