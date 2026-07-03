# CRAL Champions

Sito statico per la gestione e la pubblicazione del torneo aziendale **CRAL Champions**.

Il progetto è composto da una singola pagina HTML che legge dati da file CSV e TXT, mostra classifiche, calendario, risultati, statistiche giocatori, riepiloghi di giornata, Pagellone ignorante e sezione Fantacalcio. È pensato per essere pubblicato facilmente su **GitHub Pages**, senza backend e senza processo di build.

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
- Ricerca globale per squadre, giocatori e partite.
- Tabelle ordinabili.
- Tema chiaro/scuro con preferenza salvata nel browser.
- Stampa o esportazione in PDF tramite browser.
- Banner diagnostico per CSV mancanti o con problemi di formato.
- Supporto a immagini di squadre, giocatori e logo CRAL.
- Anteprima link tramite metadati Open Graph.
- Interfaccia responsive e ottimizzata per desktop e smartphone.

## Stack tecnico

- **HTML5**
- **CSS3**
- **JavaScript vanilla**
- **CSV** come sorgente dati principale
- **TXT** per i pagelloni di giornata
- **JSON** opzionale per cache/snapshot precomputati
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
│   ├── pagelloni/
│   │   ├── pagellone_giornata_1.txt
│   │   ├── pagellone_giornata_2.txt
│   │   └── pagellone_giornata_N.txt
│   ├── giornata1/
│   │   └── rosa_partecipante.csv
│   └── fantacalcio/
│       ├── listone_fantacalcio.csv
│       ├── eventi_fantacalcio.csv
│       └── fantacalcio_cache.json
└── immagini/
    ├── logo_cral.png
    ├── squadre/
    │   └── nome-squadra.png
    └── giocatori/
        └── nome-giocatore.png
```

> I nomi effettivi dei CSV possono essere gestiti tramite `data/manifest.csv`. I file base più importanti sono caricati automaticamente anche se non dichiarati nel manifest. I pagelloni vengono cercati nella cartella `data/pagelloni/` con nome `pagellone_giornata_N.txt`.

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

I file TXT dei pagelloni possono stare direttamente in `data/pagelloni/` e non richiedono necessariamente l'inserimento nel manifest se rispettano il nome `pagellone_giornata_N.txt`.

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

Il calendario viene usato per determinare il numero totale delle giornate e lo stato di avanzamento generale del torneo.

### `data/riepilogo_giornate.csv`

Riepiloghi per giornata con marcatori, MVP, portieri, autogol e statistiche aggregate.

Questo file è importante anche per il Pagellone: viene usato come fonte principale per associare correttamente ogni pagella alla partita di riferimento, recuperare il risultato e ordinare le squadre secondo l'ordine reale del match.

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

Le rose sono usate anche per risolvere correttamente immagini, iniziali e ruoli dei giocatori nei casi di omonimia. Se due giocatori hanno lo stesso cognome ma giocano in squadre diverse, il sito usa il mapping **squadra + giocatore** per scegliere la persona corretta.

## Pagellone ignorante

La sezione Pagellone legge file di testo semplici, uno per giornata, dalla cartella:

```text
data/pagelloni/
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

Per i giocatori, il riconoscimento è guidato dalle rose squadra: se un nome è ambiguo, l'immagine viene scelta in base alla squadra di appartenenza.

## Fantacalcio

La sezione Fantacalcio carica dati da:

```text
data/giornataX/rosa_*.csv
data/giornataX/roster_*.csv
data/fantacalcio/listone_fantacalcio.csv
data/fantacalcio/eventi_fantacalcio.csv
```

È supportato anche un file cache opzionale:

```text
data/fantacalcio/fantacalcio_cache.json
```

La cache può essere usata per velocizzare il caricamento dei risultati precomputati, soprattutto quando aumentano giornate, rose e partecipanti.

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

Per evitare problemi di caricamento dei CSV e dei TXT via browser, è consigliato usare un piccolo server locale.

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
2. Aggiorna `manifest.csv` se aggiungi nuovi CSV.
3. Aggiungi i pagelloni in `data/pagelloni/` con nome `pagellone_giornata_N.txt`.
4. Aggiungi o aggiorna immagini in `immagini/`.
5. Esegui commit e push sul repository.
6. Apri il sito e usa il pulsante di ricarica dati se necessario.

Per mantenere corretta l'associazione delle pagelle alle partite, aggiorna anche `riepilogo_giornate.csv` quando aggiungi una nuova giornata.

## Note operative

- Il sito è completamente statico: ogni aggiornamento passa dai file CSV, TXT e immagini.
- I CSV possono usare `;` oppure `,` come separatore.
- Il sito include controlli per segnalare file mancanti, colonne incoerenti, intestazioni vuote e valori numerici non validi.
- Le tabelle e le sezioni più dense sono scrollabili su mobile.
- La UI è responsive e ottimizzata per consultazione da desktop e smartphone.
- Il Pagellone usa il Riepilogo come riferimento per partite e risultati; se il Riepilogo manca, usa fallback meno precisi.
- Le immagini dei giocatori vengono associate tramite rosa e squadra, così gli omonimi vengono gestiti correttamente.
- I voti con `+` e `-` restano leggibili in visualizzazione ma vengono convertiti in valori numerici solo per medie e calcoli.
- Chart.js viene caricato solo quando servono i grafici, riducendo il caricamento iniziale.
- Le sezioni pesanti, come Pagellone e pagelle nella scheda giocatore, usano indici e rendering mirato per mantenere fluida l'interfaccia.

## Licenza

Aggiungi qui la licenza del progetto, se prevista.

Esempio:

```text
MIT
```
