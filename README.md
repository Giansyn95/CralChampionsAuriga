# CRAL Champions

Sito statico per visualizzare classifiche, calendario, risultati, statistiche giocatori, squadre e riepiloghi giornata di un torneo **CRAL Champions**.

Il progetto è composto principalmente da un unico file `index.html`, pensato per funzionare sia in locale sia pubblicato su GitHub Pages. I dati vengono letti da file CSV e le immagini da cartelle locali del progetto.

## Funzionalità principali

- Home con riepilogo generale del torneo:
  - numero squadre;
  - numero giocatori;
  - partite disputate;
  - dati aggiornati a giornata `X/Y`, dove `X` è l'ultima giornata con riepilogo caricato e `Y` è il totale giornate previsto dal calendario;
  - grafico 💣 top marcatori;
  - grafico 🏆 punti squadre.
- Scheda **Classifiche**:
  - classifica squadre;
  - classifica marcatori;
  - classifica MVP;
  - classifica portieri.
- Scheda **Statistiche**:
  - media gol per partita dei giocatori.
- Scheda **Squadre**:
  - elenco squadre;
  - elenco giocatori per squadra;
  - supporto immagini giocatori;
  - evidenza del capitano con fascia `C`.
- Scheda **Calendario**:
  - supporto calendario tabellare;
  - supporto calendario a blocchi per giornata;
  - gestione squadre a riposo.
- Scheda **Risultati**:
  - partite giocate con loghi squadre e risultato.
- Scheda **Riepilogo giornate**:
  - filtro per giornata;
  - partite della giornata;
  - marcatori della giornata;
  - MVP della giornata;
  - miglior portiere;
  - autogol;
  - statistiche complete, se presenti.
- Ricerca globale per squadra, giocatore o partita, con riconoscimento coerente di nome e cognome dei giocatori.
- Tema chiaro/scuro con salvataggio della preferenza in `localStorage`.
- Ordinamento cliccabile delle colonne nelle tabelle.
- Stampa / esportazione PDF tramite pulsante dedicato.
- Caricamento automatico da CSV pubblicati nel repository.
- Caricamento manuale di una cartella locale con CSV e immagini, quando il sito viene aperto in locale.

## Struttura consigliata del progetto

```text
CralChampions/
├── index.html
├── README.md
├── manifest.csv
├── config.csv
├── classifica_squadre.csv
├── classifica_marcatori.csv
├── classifica_mvp.csv
├── classifica_portieri.csv
├── risultati_partite.csv
├── calendario.csv
├── riepilogo_giornate.csv
└── immagini/
    ├── logo_cral.png
    ├── squadre/
    │   ├── nome_squadra.png
    │   └── ...
    └── giocatori/
        ├── nome_giocatore.png
        └── ...
```

I file CSV possono stare nella root del repository oppure nella cartella `data/`. Il codice prova prima a caricare da `data/` e poi dalla root.

## File CSV riconosciuti automaticamente

L'applicazione riconosce questi file principali:

| File | Uso |
|---|---|
| `config.csv` | Titolo e sottotitolo del sito |
| `manifest.csv` | Elenco dei CSV da caricare automaticamente |
| `classifica_squadre.csv` | Classifica generale squadre |
| `classifica_marcatori.csv` | Classifica marcatori |
| `classifica_mvp.csv` | Classifica MVP |
| `classifica_portieri.csv` | Classifica portieri |
| `risultati_partite.csv` / `risultati.csv` / `partite.csv` | Risultati partite |
| `calendario.csv` / `calendario_andata_ritorno.csv` | Calendario |
| `riepilogo_giornate.csv` | Riepilogo giornate |
| `squadra_NomeSquadra.csv` | Rosa di una singola squadra |

Sono riconosciuti anche file riepilogo separati per giornata, ad esempio:

```text
giornata_1.csv
riepilogo_giornata_1.csv
referto_giornata_1.csv
```

## Manifest

Il file `manifest.csv` serve a indicare quali CSV caricare. Esempio:

```csv
file
classifica_squadre.csv
classifica_marcatori.csv
classifica_mvp.csv
classifica_portieri.csv
risultati_partite.csv
calendario.csv
riepilogo_giornate.csv
squadra_Red Lions.csv
squadra_Blue Tigers.csv
```

I file di riepilogo possono essere già presenti nel manifest anche se non esistono ancora perché il torneo è in corso. L'interfaccia non mostra alert per questi riepiloghi mancanti.

## Configurazione sito

Il file `config.csv` può contenere titolo e sottotitolo del sito.

Esempio:

```csv
chiave;valore
titolo;CRAL Champions
sottotitolo;Classifiche, calendario, risultati e statistiche giocatori
```

Puoi cambiare titolo e sottotitolo a ogni nuova edizione del torneo senza modificare il codice HTML.

## Classifiche

La scheda **Classifiche** mostra, nell'ordine:

1. Classifica squadre
2. Classifica marcatori
3. Classifica MVP
4. Classifica portieri

Per Marcatori, MVP e Portieri, il codice prova a portare come prima colonna la posizione in classifica. Sono riconosciute intestazioni come:

```text
Posizione
Pos.
Pos
Rank
```

Per i valori principali sono riconosciute varie intestazioni equivalenti, ad esempio:

```text
Gol
Goal
Reti
Punti
Punti MVP
Portiere
Giocatore
Player
```

## Riepilogo giornate

La scheda **Riepilogo giornate** supporta sia un CSV unico sia file separati per giornata.

Le tabelle principali vengono mostrate con questo ordine di colonne prioritario:

### Marcatori della giornata

```text
Sezione
Giocatore
Gol / Goal / Reti
```

### MVP della giornata

```text
Sezione
Giocatore
Punti
```

### Miglior portiere

```text
Sezione
Giocatore / Portiere
Punti
```

Sono supportate sezioni come:

```text
Partita
Marcatore
Totale marcatore giornata
MVP
Miglior portiere
Autogol
Statistica
```

I `Totale marcatore giornata` vengono usati come fallback quando non ci sono marcatori dettagliati, ma non vengono mostrati come scheda separata per evitare doppioni.

## CSV squadre

Ogni squadra può avere un file dedicato con nome:

```text
squadra_NomeSquadra.csv
```

Esempio:

```csv
Cognome;Nome;Ruolo;Numero;Capitano
Rossi;Mario;Attaccante;10;Sì
Bianchi;Luca;Portiere;1;
```

Il sito prova a riconoscere automaticamente:

- nome giocatore;
- cognome;
- ruolo;
- numero;
- capitano.

Il capitano viene evidenziato con una fascia gialla `C`.

## Immagini

Sono supportati questi formati:

```text
png, jpg, jpeg, webp, gif, svg
```

Cartelle consigliate:

```text
immagini/squadre/
immagini/giocatori/
```

Il nome file viene normalizzato, quindi è consigliato usare nomi semplici e coerenti con i CSV.

Esempi:

```text
immagini/squadre/redlions.png
immagini/giocatori/mariorossi.png
```

Se un'immagine non viene trovata, il sito mostra automaticamente le iniziali.

## Calendario

Sono supportati due formati.

### Formato tabellare

```csv
Giornata;Squadra casa;Squadra trasferta;Data;Note
1;Red Lions;Blue Tigers;AAAA-MM-GG;
```

### Formato a blocchi

```csv
GIORNATA 1;;
Casa;Trasferta;Note
Red Lions;Blue Tigers;
Green Foxes;Yellow Bears;
;;Riposa: Black Panthers
```

Il formato a blocchi è utile per calendari divisi per giornata e per gestire squadre a riposo.

## Risultati

Esempio CSV risultati:

```csv
Giornata;Squadra casa;Squadra trasferta;Gol casa;Gol trasferta;Note
1;Red Lions;Blue Tigers;3;2;
```

In alternativa può essere usata una colonna `Risultato`:

```csv
Giornata;Squadra casa;Squadra trasferta;Risultato
1;Red Lions;Blue Tigers;3 - 2
```

## Ricerca e ordinamento

La barra di ricerca filtra la sezione attiva. Cerca tra squadre, giocatori, partite e valori contenuti nei CSV.

Per i giocatori, la ricerca prova ad allineare nome e cognome anche quando i CSV usano formati diversi, ad esempio `Nome Cognome`, `Cognome Nome` oppure solo nome o solo cognome. Questo evita risultati diversi tra una ricerca per nome e una ricerca per cognome.

Quando il filtro viene riconosciuto come ricerca giocatore, alcune sezioni vengono ridotte ai soli dati pertinenti:

- in **Squadre** viene mostrata solo la squadra a cui appartiene il giocatore filtrato;
- in **Risultati** non vengono mostrate schede partita, perché il tab è legato alle squadre e non al singolo giocatore;
- in **Classifiche** non viene mostrata la classifica squadre; vengono mostrate solo le classifiche in cui il giocatore è presente;
- in **Riepilogo giornate** non vengono mostrate le card generali della giornata, come partite giocate, gol totali, media gol, partita con più gol o partite della giornata; restano solo Marcatori, MVP, Miglior portiere o Autogol se il giocatore ha righe effettive in quelle sezioni.

Le sezioni vuote non pertinenti vengono nascoste, quindi non vengono mostrate card con messaggi come `Nessun risultato per la ricerca` quando il filtro riguarda un giocatore.

Le tabelle sono ordinabili cliccando sulle intestazioni delle colonne. Le tabelle di Marcatori, MVP e Portieri usano larghezze coerenti tra loro, così i risultati restano allineati anche durante il filtro.

## Tema scuro

Il pulsante con icona luna/sole permette di cambiare tema. La scelta viene salvata nel browser tramite `localStorage`.

## Grafici

I grafici della Home usano Chart.js caricato da CDN:

```text
https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js
```

Sono presenti:

- grafico 💣 top marcatori;
- grafico 🏆 punti squadre.

Se Chart.js non viene caricato, il sito continua a funzionare ma i grafici non vengono mostrati.

## Pubblicazione su GitHub Pages

Per pubblicare il progetto:

1. Caricare `index.html`, CSV e cartelle immagini nel repository GitHub.
2. Aprire il repository su GitHub.
3. Andare in **Settings > Pages**.
4. Selezionare il branch, di solito `main`.
5. Selezionare la cartella `/root` se i file sono nella root del repository.
6. Salvare.

L'URL avrà forma simile a:

```text
https://nomeutente.github.io/nome-repository/
```

Per togliere il nome utente dall'URL serve un dominio personalizzato.

## Riutilizzo per tornei futuri

Per usare lo stesso progetto in un nuovo torneo basta aggiornare i CSV, le immagini e, se necessario, il file `config.csv`. Il file `index.html` può rimanere lo stesso, purché i nomi dei file e delle colonne restino compatibili con quelli descritti in questo README.

## Note tecniche

- Il sito è completamente statico: non richiede backend o database.
- I dati vengono letti da CSV.
- Le immagini vengono cercate automaticamente in base ai nomi di squadre e giocatori.
- Il codice usa funzioni di escape per evitare inserimenti HTML non sicuri dai CSV.
- Il caricamento manuale cartella funziona meglio su browser basati su Chromium, come Chrome o Edge.
- Su GitHub Pages il caricamento automatico funziona se i file CSV sono pubblicati nel repository e i nomi corrispondono a quelli indicati nel manifest.

## Ultime modifiche applicate

- Rimossa dalla Home la voce **CSV Caricati**.
- Rimosso l'alert per i file di riepilogo mancanti indicati nel manifest.
- Aggiunta nella Home la card **Dati aggiornati a giornata X/Y**, calcolata confrontando l'ultima giornata con riepilogo caricato con il numero totale di giornate del calendario.
- Aggiunte le emoji nei grafici Home: 💣 per **Top marcatori** e 🏆 per **Punti squadre**.
- Corretto il filtro tabellare per evitare che una riga dati venga interpretata come intestazione quando la ricerca restituisce un solo risultato.
- Migliorata la ricerca giocatore: nome e cognome vengono riconosciuti in modo coerente anche con formati `Nome Cognome` e `Cognome Nome`.
- Nelle classifiche Marcatori, MVP e Portieri, la posizione viene mostrata come prima colonna quando disponibile.
- Nel tab **Classifiche**, quando si filtra un giocatore, la classifica squadre viene nascosta e restano solo le classifiche realmente pertinenti. Per i portieri viene evitata la visualizzazione di sezioni non collegate, come MVP, se non pertinenti.
- Nel tab **Squadre**, quando si filtra un giocatore, viene mostrata solo la squadra associata al giocatore filtrato.
- Nel tab **Risultati**, quando si filtra un giocatore, non viene mostrata una card partita vuota.
- Nel **Riepilogo giornate**, quando si filtra un giocatore, vengono nascoste le card generali di giornata e restano solo i dati effettivamente relativi al giocatore.
- Nel **Riepilogo giornate**, le sezioni vuote come MVP, Marcatori o Miglior portiere vengono nascoste quando non hanno righe per il giocatore filtrato.
- Nel Riepilogo giornate, le tabelle principali mostrano prima le colonne richieste:
  - `Sezione`, `Giocatore`, `Gol/Goal/Reti` per i marcatori;
  - `Sezione`, `Giocatore`, `Punti` per MVP;
  - `Sezione`, `Giocatore/Portiere`, `Punti` per miglior portiere.
- Allineate le larghezze delle colonne nelle tabelle Marcatori, MVP e Portieri, sia nelle classifiche sia nel riepilogo giornate.

## Licenza

Progetto realizzato per uso interno del torneo CRAL Champions.
