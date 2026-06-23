# CRAL Champions

Sito statico per la gestione e la pubblicazione del torneo aziendale **CRAL Champions**.

Il progetto è composto da una singola pagina HTML che legge dati da file CSV, mostra classifiche, calendario, risultati, statistiche giocatori, riepiloghi di giornata e sezione Fantacalcio. È pensato per essere pubblicato facilmente su **GitHub Pages**, senza backend e senza processo di build.

## Funzionalità

- Home con KPI del torneo, grafici e stato di avanzamento.
- Classifiche squadre, marcatori, MVP e portieri.
- Statistiche giocatori, inclusa media gol per partita.
- Schede squadre con giocatori, ruoli, capitano e avatar.
- Calendario con stato giornate: disputate, prossime e da giocare.
- Risultati e riepiloghi di giornata.
- Sezione Fantacalcio con calcolo punteggi da rose, eventi e risultati.
- Ricerca globale per squadre, giocatori e partite.
- Tabelle ordinabili.
- Tema chiaro/scuro con preferenza salvata nel browser.
- Stampa o esportazione in PDF tramite browser.
- Banner diagnostico per CSV mancanti o con problemi di formato.
- Supporto a immagini di squadre, giocatori e logo CRAL.
- Anteprima link tramite metadati Open Graph.

## Stack tecnico

- **HTML5**
- **CSS3**
- **JavaScript vanilla**
- **CSV** come sorgente dati
- **Chart.js** caricato da CDN per i grafici
- **Google Fonts** per la UI
- **GitHub Pages** per il deploy statico

Non sono necessari Node.js, npm, database o server applicativi.

## Struttura consigliata del repository

```text
.
├── index.html
├── README.md
├── data/
│   ├── manifest.csv
│   ├── config.csv
│   ├── classifica_squadre.csv
│   ├── classifica_marcatori.csv
│   ├── classifica_mvp.csv
│   ├── classifica_portieri.csv
│   ├── risultati_partite.csv
│   ├── calendario_andata_ritorno.csv
│   ├── riepilogo_giornate.csv
│   ├── squadra_NomeSquadra.csv
│   ├── giornata1/
│   │   └── rosa_partecipante.csv
│   └── fantacalcio/
│       ├── listone_fantacalcio.csv
│       └── eventi_fantacalcio.csv
└── immagini/
    ├── logo_cral.png
    ├── squadre/
    │   └── nome-squadra.png
    └── giocatori/
        └── nome-giocatore.png
```

> I nomi effettivi dei CSV possono essere gestiti tramite `data/manifest.csv`. I file base più importanti sono caricati automaticamente anche se non dichiarati nel manifest.

## File dati principali

### `data/manifest.csv`

Elenco dei CSV da caricare.

Esempio:

```csv
file
classifica_squadre.csv
classifica_marcatori.csv
classifica_mvp.csv
classifica_portieri.csv
risultati_partite.csv
calendario_andata_ritorno.csv
riepilogo_giornate.csv
squadra_Rossi.csv
squadra_Blu.csv
```

### `data/config.csv`

Permette di personalizzare titolo e sottotitolo del sito.

Esempio:

```csv
chiave;valore
titolo;CRAL Champions - Auriga 2026
sottotitolo;Classifiche, calendario, risultati e statistiche giocatori
```

### `data/classifica_squadre.csv`

Classifica generale delle squadre.

Colonne consigliate:

```csv
Posizione;Squadra;PG;V;N;P;GF;GS;DR;Punti finali;Penalità;Nota penalità
```

### `data/classifica_marcatori.csv`

Classifica marcatori.

Colonne consigliate:

```csv
Posizione;Giocatore;Squadra;Gol;Partite;Note
```

### `data/classifica_mvp.csv`

Classifica MVP.

Colonne consigliate:

```csv
Posizione;Giocatore;Squadra;Punti MVP;Note
```

### `data/classifica_portieri.csv`

Classifica portieri.

Colonne consigliate:

```csv
Posizione;Portiere;Squadra;Punti;Note
```

### `data/risultati_partite.csv`

Risultati delle partite.

Colonne consigliate:

```csv
Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta;Note
```

### `data/calendario_andata_ritorno.csv`

Calendario del torneo.

Può essere gestito sia come tabella CSV classica sia come calendario a blocchi per giornata, in base al formato utilizzato dal file sorgente.

### `data/riepilogo_giornate.csv`

Riepiloghi per giornata con marcatori, MVP, portieri, autogol e statistiche aggregate.

### `data/squadra_NomeSquadra.csv`

Rosa di una singola squadra.

Colonne consigliate:

```csv
Nome;Cognome;Ruolo;Numero;Capitano
```

Il nome della squadra viene ricavato dal nome file, ad esempio:

```text
squadra_FC_Rossi.csv
```

## Immagini

Le immagini vengono cercate automaticamente nelle cartelle:

```text
immagini/logo_cral.png
immagini/squadre/
immagini/giocatori/
```

Sono supportati i formati:

- `.png`
- `.jpg`
- `.jpeg`

Per aumentare le probabilità di riconoscimento automatico, usa nomi file normalizzati e coerenti con squadre e giocatori.

Esempi:

```text
immagini/squadre/fcrossi.png
immagini/giocatori/mariorossi.png
```

Se un'immagine non viene trovata, il sito mostra un fallback con iniziali o placeholder.

## Fantacalcio

La sezione Fantacalcio carica dati da:

```text
data/giornataX/rosa_*.csv
data/giornataX/roster_*.csv
data/fantacalcio/listone_fantacalcio.csv
data/fantacalcio/eventi_fantacalcio.csv
```

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

## Avvio in locale

Per evitare problemi di caricamento dei CSV via browser, è consigliato usare un piccolo server locale.

Da terminale, nella cartella del progetto:

```bash
python -m http.server 8000
```

Poi apri:

```text
http://localhost:8000
```

In alternativa, la pagina include anche funzioni di caricamento manuale dei file/cartelle tramite browser compatibili con la File System Access API.

## Deploy su GitHub Pages

1. Carica il repository su GitHub.
2. Verifica che `index.html` sia nella root del repository.
3. Vai su **Settings → Pages**.
4. Seleziona il branch principale, ad esempio `main`.
5. Seleziona la cartella `/root`.
6. Salva e attendi la pubblicazione.

L'URL finale sarà simile a:

```text
https://<utente-o-organizzazione>.github.io/<nome-repository>/
```

## Aggiornamento dati

Per aggiornare il torneo:

1. Modifica o sostituisci i CSV nella cartella `data/`.
2. Aggiorna `manifest.csv` se aggiungi nuovi file.
3. Aggiungi o aggiorna immagini in `immagini/`.
4. Esegui commit e push sul repository.
5. Apri il sito e usa il pulsante di ricarica dati se necessario.

## Note operative

- Il sito è completamente statico: ogni aggiornamento passa dai file CSV.
- I CSV possono usare `;` oppure `,` come separatore.
- Il sito include controlli per segnalare file mancanti, colonne incoerenti, intestazioni vuote e valori numerici non validi.
- Le tabelle sono scrollabili su mobile.
- La UI è responsive e ottimizzata per consultazione da desktop e smartphone.
- Chart.js viene caricato solo quando servono i grafici, riducendo il caricamento iniziale.

## Licenza

Aggiungi qui la licenza del progetto, se prevista.

Esempio:

```text
MIT
```
