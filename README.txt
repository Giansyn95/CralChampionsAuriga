CRAL Champions - progetto sito statico riutilizzabile
====================================================

STRUTTURA CARTELLE (importante)
--------------------------------
CRAL/
|-- index.html              <- unico file da aprire, sempre visibile e libero
|-- README.txt               <- questo file
`-- data/                    <- TUTTI i dati del torneo, da proteggere/nascondere
    |-- config.csv
    |-- manifest.csv
    |-- classifica_squadre.csv
    |-- classifica_marcatori.csv
    |-- classifica_mvp.csv          (opzionale)
    |-- classifica_portieri.csv     (opzionale)
    |-- risultati_partite.csv
    |-- calendario_andata_ritorno.csv
    |-- squadra_NomeSquadra.csv     (uno per squadra)
    `-- immagini/
        |-- logo_cral.png           (logo mostrato in alto)
        |-- squadre/                (loghi squadre)
        `-- giocatori/              (foto giocatori)

index.html legge automaticamente tutto dentro data/. Non serve indicare il
percorso nei CSV: basta che i file siano dentro quella cartella con i nomi
giusti (vedi "CSV supportati" più sotto).

Uso normale
-----------
1) Copia tutta la cartella CRAL (con dentro data/) in Z:\CRAL.
2) Esporta/sostituisci i CSV del torneo dentro Z:\CRAL\data.
3) Apri Z:\CRAL\index.html con doppio click.
4) Se il browser blocca il caricamento automatico dei CSV locali, clicca
   "Seleziona cartella" e scegli Z:\CRAL (non serve entrare in data/, il
   sito scende automaticamente nelle sottocartelle).

Come nascondere e proteggere la cartella data/ (Windows)
----------------------------------------------------------
Questo evita che utenti non amministratori vedano o modifichino per errore
i CSV, lasciando solo index.html visibile e apribile liberamente.

Da PowerShell, posizionati nella cartella CRAL ed esegui:

    attrib +h +r /s data

- "+h" nasconde la cartella data e tutto il suo contenuto da Esplora File
  (visibile solo attivando "Elementi nascosti").
- "+r" la imposta come sola lettura, evitando sovrascritture accidentali.
- "/s" applica gli attributi anche ai sottofile e alle sottocartelle.

Per ripristinare la visibilità e la scrittura quando devi aggiornare i CSV:

    attrib -h -r /s data

IMPORTANTE: questi sono attributi di Windows, non permessi di sicurezza
reali. Un amministratore (o chiunque sappia attivare "Elementi nascosti"
e togliere la sola lettura) può comunque accedere ai file. Per una vera
restrizione serve impostare i permessi NTFS della cartella (tasto destro
su data -> Proprieta -> Sicurezza) assegnando "Lettura" agli utenti
standard e "Controllo completo" solo al tuo account amministratore.

File da modificare per i tornei futuri
--------------------------------------
- data/config.csv: cambia titolo, sottotitolo, anno e organizzazione.
- data/manifest.csv: aggiungi o rimuovi i CSV da caricare.
- data/immagini/logo_cral.png: logo del CRAL mostrato nell'intestazione.
- data/immagini/squadre: inserisci i loghi delle squadre.
- data/immagini/giocatori: inserisci le foto dei giocatori.

Nomi immagini consigliati
-------------------------
Il sito normalizza i nomi togliendo spazi, accenti e simboli.
Esempi:
- Auriga Juniors -> data/immagini/squadre/aurigajuniors.jpg
- BOT & BALL -> data/immagini/squadre/boteball.png
- Rossi Mario -> data/immagini/giocatori/rossimario.jpg

CSV supportati (tutti dentro data/)
------------------------------------
- classifica_squadre.csv
- classifica_marcatori.csv
- classifica_mvp.csv
- classifica_portieri.csv
- risultati_partite.csv oppure risultati.csv oppure partite.csv
- calendario_andata_ritorno.csv oppure calendario.csv (anche in formato
  a blocchi con righe "GIORNATA 1", "GIORNATA 2", ecc. e colonna Note
  per indicare la squadra che riposa)
- squadra_NomeSquadra.csv per le rose delle squadre

Statistiche giocatori
---------------------
La sezione Statistiche calcola la media goal per partita cosi:
media = gol del giocatore / partite giocate dalla sua squadra.

Servono:
- data/classifica_marcatori.csv con colonne tipo Giocatore, Squadra, Gol
- data/risultati_partite.csv con colonne tipo Squadra casa, Squadra
  trasferta, Gol casa, Gol trasferta

Se nel CSV marcatori e' gia' presente una colonna Partite o Presenze, il
sito puo' usare quella.
