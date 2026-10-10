# CRAL Champions

Sito statico per la gestione e la pubblicazione del torneo aziendale **CRAL Champions**.

Il progetto è composto da una **landing page** in root (edizione corrente, archivio dei tornei e Hall of Fame) e da una **cartella per ogni edizione** in `tornei/`. Ogni edizione è una pagina HTML che legge dati da file CSV e TXT e mostra classifiche, calendario, risultati, statistiche giocatori, riepiloghi di giornata, Pagellone ignorante e sezione Fantacalcio. Un **pannello admin** permette di pubblicare i dati direttamente su GitHub. Il sito è pensato per **GitHub Pages**, senza backend e senza processo di build.

## Indice

1. [Funzionalità](#funzionalità)
2. [Stack tecnico](#stack-tecnico)
3. [Struttura del repository](#struttura-del-repository)
4. [File dati principali](#file-dati-principali)
5. [Immagini](#immagini)
6. [Pagellone ignorante](#pagellone-ignorante)
7. [Scheda dettaglio giocatore](#scheda-dettaglio-giocatore)
8. [Fantacalcio](#fantacalcio)
9. [Hall of Fame: come resta veloce con tante edizioni](#hall-of-fame-come-resta-veloce-con-tante-edizioni)
10. [Pannello admin](#pannello-admin)
11. [Automazioni (GitHub Actions)](#automazioni-github-actions)
12. [Avvio in locale](#avvio-in-locale)
13. [Deploy su GitHub Pages](#deploy-su-github-pages)
14. [Aggiungere una nuova edizione](#aggiungere-una-nuova-edizione)
15. [Aggiornamento dati](#aggiornamento-dati)
16. [Note operative](#note-operative)
17. [Licenza](#licenza)

## Funzionalità

- Home con KPI del torneo, grafici e stato di avanzamento.
- Classifiche squadre, marcatori, MVP e portieri.
- Statistiche giocatori, inclusa media gol per partita.
- Schede squadre con giocatori, ruoli, capitano e avatar.
- Scheda dettaglio giocatore con statistiche, timeline eventi, confronto tra giocatori e sezione **Pagelle ricevute**.
- Calendario con stato giornate: disputate, prossime e da giocare.
- Risultati e riepiloghi di giornata.
- **Pagellone ignorante** con pagelle caricate da file TXT, grafica in stile fogli affissi al muro, filtri per giornata, squadra e partita.
- Sezione Fantacalcio con calcolo punteggi da rose, eventi e risultati.
- Landing con archivio dei tornei e Hall of Fame: record all-time, albo d'oro a pagine, schede comprimibili e ricerca per squadra, giocatore o anno quando le edizioni sono tante.
- Ricerca globale per squadre, giocatori e partite.
- Tabelle ordinabili.
- Tema chiaro/scuro con preferenza salvata nel browser.
- Banner diagnostico per CSV mancanti o con problemi di formato.
- Supporto a immagini di squadre, giocatori e logo CRAL, con riconoscimento automatico dei file caricati.
- Anteprima link tramite metadati Open Graph.
- Interfaccia responsive e ottimizzata per desktop e smartphone.
- Pannello admin per pubblicare risultati, pagelloni e dati direttamente su GitHub.
- Pagina "Crea la tua rosa" per i partecipanti al Fantacalcio.

## Stack tecnico

- **HTML5**
- **CSS3**
- **JavaScript vanilla**
- **CSV** come sorgente dati principale
- **TXT** per i pagelloni di giornata
- **JSON** per l'elenco edizioni (`tornei.json`) e per cache/snapshot precomputati
- **Chart.js** caricato da CDN per i grafici
- **Google Fonts** per la UI
- **GitHub Pages** per il deploy statico
- **GitHub Actions** per generare gli snapshot e lanciare i test

Per usare e pubblicare il sito non sono necessari Node.js, npm, database o server applicativi. Node.js 20 serve solo per i generatori in `tools/` e per i test, che girano già in automatico su GitHub Actions.

## Struttura del repository

```text
.
├── index.html                  # landing: edizione corrente, archivio, Hall of Fame
├── tornei.json                 # elenco edizioni (stato, ordine, cartella, url)
├── hall_of_fame.json           # snapshot generato: record all-time e albo d'oro
├── sw.js                       # service worker: solo cache del logo CRAL
├── 404.html
├── README.md
├── package.json                # script di test
├── playwright.config.js
├── playwright.live.config.js
├── admin/                      # pannello admin (pubblica su GitHub)
├── docs/
│   └── README_MIGRAZIONE.md
├── tools/                      # generatori usati dalle GitHub Actions
│   ├── genera_hall_of_fame.js
│   ├── genera_immagini_manifest.js
│   ├── genera_portieri_snapshot.js
│   └── genera_fantacalcio_cache.js
├── tests/                      # unit, static, browser, functional, github, live
├── .github/workflows/          # snapshot automatici e test
└── tornei/
    └── 2026-spring/            # una cartella per edizione
        ├── index.html
        ├── crea-rosa.html      # creazione rosa Fantacalcio
        ├── crea-rosa.css
        ├── crea-rosa.js
        ├── data/
        │   ├── manifest.csv
        │   ├── config.csv
        │   ├── classifica_squadre.csv
        │   ├── classifica_marcatori.csv
        │   ├── classifica_mvp.csv
        │   ├── classifica_portieri.csv
        │   ├── risultati_partite.csv
        │   ├── calendario_andata_ritorno.csv
        │   ├── riepilogo_giornataN.csv
        │   ├── squadra_NomeSquadra.csv
        │   ├── portieri_snapshot.json
        │   ├── pagelloni/
        │   │   └── pagellone_giornata_N.txt
        │   └── fantacalcio/
        │       ├── manifest_fantacalcio.csv
        │       ├── listone_fantacalcio.csv
        │       ├── eventi_fantacalcio.csv
        │       ├── fantacalcio_cache.json
        │       └── giornataN/
        │           └── rosa_nome_cognome_giornataN.csv
        └── immagini/
            ├── logo_cral.png
            ├── manifest.json   # generato: elenco delle immagini presenti
            ├── squadre/
            │   └── nomesquadra.webp
            └── giocatori/
                ├── cognomenome.webp
                └── thumb/
```

> Da qui in avanti, salvo diversa indicazione, i percorsi `data/` e `immagini/` sono relativi alla cartella dell'edizione, ad esempio `tornei/2026-spring/data/`.

> I CSV da caricare sono elencati in `data/manifest.csv`. I file base più importanti sono caricati automaticamente anche se non dichiarati nel manifest. I pagelloni vengono cercati nella cartella `data/pagelloni/`.

## File dati principali

Tutti i file di questa sezione stanno in `tornei/<edizione>/data/`. I CSV possono usare `;` oppure `,` come separatore.

### `data/manifest.csv`

Elenco dei file da caricare, uno per riga, sotto l'intestazione `file`.

Esempio:

```csv
file
classifica_squadre.csv
classifica_marcatori.csv
classifica_mvp.csv
classifica_portieri.csv
calendario_andata_ritorno.csv
risultati_partite.csv
squadra_AurigaJuniors.csv
squadra_BlackJack.csv
riepilogo_giornata1.csv
riepilogo_giornata2.csv
fantacalcio/listone_fantacalcio.csv
fantacalcio/eventi_fantacalcio.csv
```

I file TXT dei pagelloni possono stare direttamente in `data/pagelloni/`.

### `data/config.csv`

Personalizza titolo e sottotitolo dell'edizione e le impostazioni di creazione rosa.

Esempio:

```csv
chiave,valore
titolo,CRAL Auriga - Spring Champions 2026
sottotitolo,L'unica KPI che conta: vincere.
anno,2026
organizzazione,Auriga
fantacalcioCreazioneRosaEnabled,true
fantacalcioCreazioneRosaOpenFrom,2026-09-14T14:50:00.000Z
fantacalcioCreazioneRosaCloseAt,2026-09-18T15:05:00.000Z
```

Le chiavi `fantacalcioCreazioneRosa*` sono gestite dal pannello admin e definiscono se la pagina **Crea la tua rosa** (`crea-rosa.html`) è attiva e in quale finestra di tempo.

### `data/classifica_squadre.csv`

Classifica generale delle squadre.

Intestazione usata nell'edizione di esempio:

```csv
Posizione;Squadra;PuntiFinali;PuntiOriginali;Penalita;Partite;Vinte;Pareggiate;Perse;GolFatti;GolSubiti;DiffReti;NotaPenalita;PG;V;N;P;GF;GS;DR
```

### `data/classifica_marcatori.csv`

Classifica marcatori.

```csv
Posizione;Squadra;Giocatore;Gol;Presenze;Note
```

### `data/classifica_mvp.csv`

Classifica MVP.

```csv
Posizione;Squadra;Giocatore;PuntiMVP;Note
```

### `data/classifica_portieri.csv`

Classifica portieri.

```csv
posizione;teamCode;playerName;punti;nota;Portiere;Squadra;Note
```

Le colonne `Portiere` e `Squadra` sono quelle mostrate nel sito; `teamCode` e `playerName` possono restare vuote.

### `data/risultati_partite.csv`

Risultati delle partite.

```csv
Giornata;Casa;Trasferta;GolCasa;GolTrasferta;Data;Risultato;Note;Tavolino;Squadra penalizzata
```

### `data/calendario_andata_ritorno.csv`

Calendario del torneo, a blocchi per giornata:

```csv
GIORNATA 1;;
Casa;Trasferta;Note
BOT & BALL;Out Of Office FC;Riposa: BlackJack
```

Può essere gestito anche come tabella CSV classica, in base al formato del file sorgente.

Il calendario viene usato per determinare il numero totale delle giornate e lo stato di avanzamento generale del torneo.

### `data/riepilogo_giornataN.csv`

Riepilogo di una giornata (un file per giornata, ad esempio `riepilogo_giornata1.csv`) con partite, marcatori, MVP, portieri e statistiche. È riconosciuto anche un unico `riepilogo_giornate.csv` aggregato.

Intestazione usata nell'edizione di esempio:

```csv
Sezione;Giornata;Casa;Trasferta;GolCasa;GolTrasferta;Esito;Squadra;Giocatore;Gol;PuntiMVP;Portiere;PuntiPortiere;Partita;Voce;Valore;Note
```

Questi file sono importanti anche per il Pagellone: vengono usati come fonte principale per associare correttamente ogni pagella alla partita di riferimento, recuperare il risultato e ordinare le squadre secondo l'ordine reale del match.

### `data/squadra_NomeSquadra.csv`

Rosa di una singola squadra.

```csv
Squadra;Cognome;Nome;Ruolo;Capitano
BlackJack;Cirilli;Michele;D;No
```

Il nome della squadra viene ricavato dal nome file, ad esempio:

```text
squadra_AurigaJuniors.csv
```

Le rose sono usate anche per risolvere correttamente immagini, iniziali e ruoli dei giocatori nei casi di omonimia. Se due giocatori hanno lo stesso cognome ma giocano in squadre diverse, il sito usa il mapping **squadra + giocatore** per scegliere la persona corretta.

### `data/portieri_snapshot.json`

Snapshot dei punti portiere, generato dal workflow `genera-portieri-snapshot.yml`. Non va modificato a mano.

## Immagini

Le immagini stanno in `tornei/<edizione>/immagini/`:

```text
immagini/logo_cral.png
immagini/manifest.json      (generato, non va modificato a mano)
immagini/squadre/
immagini/giocatori/
immagini/giocatori/thumb/
```

### Caricamento automatico

Per aggiungere una foto basta **caricare il file** nella cartella giusta: non serve modificare nessun elenco nel codice.

1. Carica il file in `immagini/squadre/`, `immagini/giocatori/` o `immagini/giocatori/thumb/` (dal pannello admin, da GitHub o con un normale commit).
2. Il workflow `genera-immagini-manifest.yml` aggiorna da solo `immagini/manifest.json`, che elenca i file realmente presenti.
3. Il sito legge il manifest e usa solo quei file: nessun tentativo alla cieca e nessun errore 404.

Formati e nomi:

- **Squadre e giocatori:** `.webp`, `.png`, `.jpg`, `.jpeg`, `.avif` o `.gif`. Per i giocatori viene provata prima la cartella principale e poi `thumb/`.
- **Nome file:** minuscolo, senza spazi, accenti o punteggiatura; `&` diventa `e`. Per i giocatori è cognome + nome, come nella classifica. Il sito riconosce anche l'ordine inverso (`Mario Rossi` trova `rossimario.webp`).
- **Logo:** `logo_cral.png` (sono provati anche `.jpg`, `.jpeg` e `.webp`).

Esempi:

```text
immagini/squadre/outofofficefc.webp
immagini/squadre/boteball.webp          (per "BOT & BALL")
immagini/giocatori/saracinogianvito.webp
```

Se il manifest manca o non è leggibile, il sito usa gli elenchi `STATIC_TEAM_IMAGE_KEYS` e `STATIC_PLAYER_IMAGE_KEYS` presenti in `tornei/<edizione>/index.html`: sono mantenuti dal pannello admin e restano un ripiego sicuro. Per rigenerare il manifest a mano: `node tools/genera_immagini_manifest.js`.

Se un'immagine non viene trovata, il sito mostra un fallback con iniziali o placeholder.

Per i giocatori, il riconoscimento è guidato dalle rose squadra: se un nome è ambiguo, l'immagine viene scelta in base alla squadra di appartenenza.

## Pagellone ignorante

La sezione Pagellone legge file di testo semplici, uno per giornata, dalla cartella dell'edizione:

```text
tornei/<edizione>/data/pagelloni/
```

Nome file consigliato:

```text
pagellone_giornata_1.txt
pagellone_giornata_2.txt
pagellone_giornata_3.txt
```

### Formato del file pagellone

Ogni file è diviso in blocchi squadra. Dentro ogni squadra, ogni pagella inizia con `GIOCATORE:`.

Esempio:

```text
SQUADRA: FC Rossi

GIOCATORE: Mario Rossi
TESTO: Corre, pressa e trova anche il gol. Solido come una saracinesca.
PARAGONE: Javier Zanetti
VOTO: 7+

GIOCATORE: Luigi Bianchi
TESTO: Parte forte, poi si spegne nel secondo tempo.
PARAGONE: Nokia scarico al 12%
VOTO: 6-

SQUADRA: FC Blu

GIOCATORE: Paolo Verdi
TESTO: Tiene in piedi la squadra con due parate decisive.
PARAGONE: Gigi Buffon versione ufficio
VOTO: 7,5
```

Campi supportati:

| Campo | Descrizione |
|---|---|
| `SQUADRA` | Nome della squadra a cui appartengono le pagelle successive. |
| `GIOCATORE` | Nome, cognome o anche solo cognome del giocatore. L'associazione viene risolta tramite la rosa della squadra. |
| `TESTO` | Testo della pagella. |
| `PARAGONE` | Paragone scherzoso mostrato nella card. |
| `VOTO` | Voto numerico, anche con `+` o `-`. |

### Voti con `+` e `-`

I voti con simbolo vengono visualizzati mantenendo il simbolo originale:

```text
6+
6-
7+
7-
```

Nei calcoli interni valgono:

| Voto visuale | Valore numerico usato nei calcoli |
|---|---:|
| `6+` | `6,25` |
| `6-` | `5,75` |
| `7+` | `7,25` |
| `7-` | `6,75` |

Se in dati precedenti è presente un valore come `6,25` o `5,75`, l'interfaccia lo riconverte rispettivamente in `6+` e `6-` nella visualizzazione.

### Filtri del Pagellone

Il Pagellone ha due modalità principali:

1. **Per giornata**
   - il filtro si posiziona automaticamente sull'ultima giornata di riferimento;
   - permette di muoversi tra tutte le giornate del torneo;
   - mostra anche giornate senza pagellone caricato;
   - se manca il file della giornata selezionata, mostra `Nessuna valutazione caricata per la giornata X.`;
   - se non è presente alcuna pagella per nessuna giornata, mostra `Nessuna valutazione caricata.`;
   - dopo la scelta della giornata è possibile restringere ulteriormente per partita.

2. **Per squadra**
   - permette di scegliere una squadra e vedere le pagelle associate;
   - la lista è ordinata dalla giornata 1 alla giornata N tra quelle effettivamente caricate;
   - il filtro partita mostra solo partite/giornate che hanno almeno un pagellone caricato;
   - se per la squadra selezionata non ci sono valutazioni nel contesto scelto, mostra `Nessuna valutazione caricata per SQUADRA relativa alla giornata N.`.

### Associazione con partite, risultati e immagini

Per evitare errori di abbinamento, il Pagellone usa il `riepilogo_giornate.csv` come riferimento principale per:

- capire a quale partita appartiene ogni squadra;
- recuperare il risultato corretto;
- ordinare le squadre come nel match reale, ad esempio `A vs B` mostra prima A e poi B;
- gestire correttamente riposi e partite non disputate;
- colorare l'esito quando serve: vittoria, pareggio o sconfitta.

Per immagini, iniziali e icone ruolo, il Pagellone usa lo stesso mapping delle rose del tab Squadre. Questo permette di distinguere omonimi basandosi sulla squadra di riferimento.

### Grafica

Le pagelle sono mostrate come fogli affissi a una bacheca/muro, con:

- card effetto carta;
- nastro adesivo o puntina;
- ombra leggera;
- rotazioni controllate;
- layout responsive per desktop e mobile.

## Scheda dettaglio giocatore

Cliccando su un giocatore si apre una scheda di dettaglio con statistiche e informazioni aggregate.

La scheda include anche la sezione **Pagelle ricevute**, quando sono disponibili pagelloni associati al giocatore.

La sezione mostra:

- numero di pagelle ricevute;
- media voto;
- miglior voto;
- ultimo voto;
- lista delle pagelle dalla più recente alla più vecchia.

Ogni riga mostra partita e voto. Cliccando sulla riga si apre il dettaglio della pagella associata al voto; ricliccando la stessa riga il dettaglio si richiude.

Nel dettaglio esteso vengono mostrati:

- giornata;
- partita;
- risultato con colore contestuale;
- voto visuale con `+` o `-` quando presente;
- testo della pagella;
- paragone.

Su mobile la riga compatta mostra solo partita e voto prima del click, per mantenere la scheda leggera e leggibile. Il risultato completo viene mostrato solo nel dettaglio aperto.

Per non appesantire l'interfaccia, le pagelle dei giocatori vengono indicizzate una sola volta e poi recuperate tramite mapping **giocatore + squadra** quando viene aperta la scheda.

## Fantacalcio

La sezione Fantacalcio carica dati da (percorsi relativi alla cartella dell'edizione):

```text
data/fantacalcio/giornataX/rosa_*.csv
data/fantacalcio/giornataX/roster_*.csv
data/fantacalcio/listone_fantacalcio.csv
data/fantacalcio/eventi_fantacalcio.csv
data/fantacalcio/manifest_fantacalcio.csv
```

Le rose dei partecipanti seguono il nome `rosa_nome_cognome_giornataX.csv` (ad esempio `rosa_mario_rossi_giornata1.csv`) dentro la cartella della giornata. I partecipanti possono generare la propria rosa dalla pagina `crea-rosa.html` dell'edizione, validata sul listone ufficiale; apertura e chiusura si impostano dal pannello admin.

È supportato anche un file cache opzionale:

```text
data/fantacalcio/fantacalcio_cache.json
```

La cache velocizza il caricamento dei risultati precomputati, soprattutto quando aumentano giornate, rose e partecipanti. Viene rigenerata dal workflow `genera-fantacalcio-cache.yml`.

Regole punteggio visualizzate dalla web app:

| Evento | Punti |
|---|---:|
| Presenza | +6 |
| Gol | +3 |
| MVP | +5 |
| Porta inviolata portiere | +1 |
| Rigore parato | +3 |
| Gol subito portiere | -1 |
| Rigore sbagliato | -3 |
| Autogol | -2 |

## Hall of Fame: come resta veloce con tante edizioni

La landing legge `hall_of_fame.json` (1 sola richiesta) invece dei 4 CSV di ogni edizione.

- Il file è generato da `tools/genera_hall_of_fame.js` tramite il workflow `genera-hall-of-fame.yml`, a ogni modifica di `tornei.json` o dei CSV di classifica. Usa lo stesso motore incorporato in `index.html`, quindi non esiste logica duplicata.
- Lo snapshot vale solo se la sua `firma` (id delle edizioni concluse) coincide con `tornei.json`. Se manca, è vecchio o non è leggibile, la landing calcola tutto dai CSV (max 3 edizioni in parallelo): stesso risultato, solo più lento.
- Per rigenerarlo a mano: `node tools/genera_hall_of_fame.js`.
- Albo d'oro: 6 edizioni per volta (`HALL_PAGE`), ricerca dalla quinta edizione (`HALL_TOOLS_MIN`), la più recente aperta e le altre compresse.

## Pannello admin

Il pannello in `admin/` (raggiungibile da `/admin/`) permette di gestire il torneo senza toccare i file a mano:

- pubblicare risultati e pagelloni di giornata;
- aggiornare classifiche e dati Fantacalcio;
- gestire la creazione rosa (apertura e chiusura);
- creare un nuovo torneo.

Le modifiche vengono salvate come commit direttamente sul repository tramite le API di GitHub, usando un **Personal Access Token** inserito al login. Il token resta solo nella sessione del browser (`sessionStorage`) e non viene salvato altrove: usa un token con i soli permessi necessari al repository.

## Automazioni (GitHub Actions)

I workflow in `.github/workflows/` si occupano dei dati derivati e dei controlli.

| Workflow | Quando parte | Cosa fa |
|---|---|---|
| `genera-hall-of-fame.yml` | Modifica di `tornei.json`, dei CSV di classifica o del generatore | Rigenera `hall_of_fame.json` |
| `genera-immagini-manifest.yml` | Modifica di `tornei.json` o di file in `tornei/**/immagini/` | Rigenera `immagini/manifest.json` di ogni edizione |
| `genera-portieri-snapshot.yml` | Modifica di `tornei.json` o dei CSV delle edizioni | Rigenera `portieri_snapshot.json` |
| `genera-fantacalcio-cache.yml` | Modifica di `tornei.json`, dei CSV delle edizioni o del generatore | Rigenera `fantacalcio_cache.json` |
| `test-automatici.yml` | Push su `main`/`master` che tocca sito, admin, tornei, tools o test | Esegue i test automatici |
| `test-live-smoke.yml` | Ogni giorno alle 04:23 UTC e a richiesta | Controlla che il sito pubblicato risponda |
| `certifica-production-ready.yml` | Solo a richiesta (conferma testuale) | Certifica la release |
| `test-github-e2e.yml` | Solo a richiesta (conferma testuale) | Test end-to-end su branch temporanei di GitHub |

I workflow che scrivono dati sul repository usano lo stesso lock, così non lavorano sul branch contemporaneamente.

Per lanciare i test in locale:

```bash
npm install
npm run test:unit
npm run check:syntax
```

## Avvio in locale

Per evitare problemi di caricamento di CSV, TXT e JSON via browser, è consigliato usare un piccolo server locale.

Da terminale, nella cartella del progetto:

```bash
python -m http.server 8000
```

Poi apri:

```text
http://localhost:8000
```

La landing è in `/`, un'edizione in `/tornei/<edizione>/`, il pannello admin in `/admin/`.

In alternativa, la pagina di edizione include anche funzioni di caricamento manuale dei file/cartelle tramite browser compatibili con la File System Access API.

## Deploy su GitHub Pages

1. Carica il repository su GitHub.
2. Verifica che `index.html` e `tornei.json` siano nella root del repository.
3. Vai su **Settings → Pages**.
4. Seleziona il branch principale, ad esempio `main`.
5. Seleziona la cartella `/root`.
6. Salva e attendi la pubblicazione.

L'URL finale sarà simile a:

```text
https://<utente-o-organizzazione>.github.io/<nome-repository>/
```

Dopo il primo deploy controlla nella scheda **Actions** che i workflow di generazione non diano errori e che abbiano i permessi di scrittura sul repository.

## Aggiungere una nuova edizione

1. Crea il torneo dal pannello admin, oppure copia la cartella dell'edizione precedente:

   ```bash
   cp -R tornei/2026-spring tornei/2027-spring
   ```

2. Aggiorna i dati in `tornei/2027-spring/data/` e le immagini in `tornei/2027-spring/immagini/` (il manifest immagini si rigenera da solo).
3. Aggiungi l'edizione in `tornei.json`, con `id`, `anno`, `stagione`, `cartella`, `url`, `stato`, `ordine` e `attivo`.
4. Imposta `corrente: true` solo sull'edizione che deve stare in primo piano nella landing.
5. Quando il torneo finisce, metti `stato: "concluso"`: l'edizione entra nella Hall of Fame e il workflow rigenera `hall_of_fame.json`.

Esempio di voce in `tornei.json`:

```json
{
  "id": "2027-spring",
  "anno": "2027",
  "stagione": "Primavera",
  "nome": "Primavera",
  "cartella": "tornei/2027-spring",
  "url": "tornei/2027-spring/",
  "stato": "in-corso",
  "corrente": true,
  "ordine": 20271,
  "attivo": true
}
```

## Aggiornamento dati

Per aggiornare un'edizione, dal pannello admin oppure a mano:

1. Modifica o sostituisci i CSV in `tornei/<edizione>/data/`.
2. Aggiorna `manifest.csv` se aggiungi nuovi CSV.
3. Aggiungi i pagelloni in `data/pagelloni/` con nome `pagellone_giornata_N.txt`.
4. Aggiungi o aggiorna le immagini in `immagini/`: vengono riconosciute da sole, senza modificare il codice.
5. Esegui commit e push sul repository.
6. Attendi i workflow di generazione (snapshot portieri, cache Fantacalcio, Hall of Fame, manifest immagini): partono da soli.
7. Apri il sito e usa il pulsante di ricarica dati se necessario.

Per mantenere corretta l'associazione delle pagelle alle partite, aggiorna anche il riepilogo (`riepilogo_giornataN.csv`) quando aggiungi una nuova giornata.

## Note operative

- Il sito è completamente statico: ogni aggiornamento passa dai file CSV, TXT, JSON e immagini.
- I CSV possono usare `;` oppure `,` come separatore.
- Il sito include controlli per segnalare file mancanti, colonne incoerenti, intestazioni vuote e valori numerici non validi.
- Le tabelle e le sezioni più dense sono scrollabili su mobile.
- La UI è responsive e ottimizzata per consultazione da desktop e smartphone.
- Il Pagellone usa il Riepilogo come riferimento per partite e risultati; se il Riepilogo manca, usa fallback meno precisi.
- Le immagini dei giocatori vengono associate tramite rosa e squadra, così gli omonimi vengono gestiti correttamente (vedi la sezione Immagini).
- `sw.js` mette in cache solo il logo CRAL: CSV, HTML, JS e altre immagini non vengono mai intercettati.
- I voti con `+` e `-` restano leggibili in visualizzazione ma vengono convertiti in valori numerici solo per medie e calcoli.
- Chart.js viene caricato solo quando servono i grafici, riducendo il caricamento iniziale.
- Le sezioni pesanti, come Pagellone e pagelle nella scheda giocatore, usano indici e rendering mirato per mantenere fluida l'interfaccia.

## Licenza

```text
CRAL AURIGA, Gianvito Saracino
```
