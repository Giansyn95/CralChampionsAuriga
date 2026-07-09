/*
  Service Worker per CRAL Champions Auriga — cache del logo CRAL.
  Vive nella ROOT del sito: il suo scope copre sia questa landing page
  (index.html) sia tutte le sottocartelle tornei/<edizione>/, quindi funziona
  automaticamente su qualunque pagina, senza bisogno di un file separato per
  ogni edizione.

  Obiettivo: il logo non deve MAI far vedere un caricamento, nemmeno al primo
  refresh dopo l'installazione, e deve aggiornarsi da solo se sostituite
  un'immagine mantenendo lo stesso nome/percorso.

  IMPORTANTE — perché non c'è un URL fisso da precaricare in "install":
  ogni edizione ha il proprio logo in un percorso diverso
  (es. tornei/2026-estate/immagini/logo_cral.png, tornei/2027-inverno/...),
  e la landing page in root cambia edizione "corrente" nel tempo. Precaricare
  un unico percorso fisso in fase di installazione andrebbe quindi
  regolarmente aggiornato a mano e si romperebbe ad ogni nuova edizione.
  Si usa invece una cache generica "per pattern" (vedi isLogoRequest): la
  PRIMA richiesta reale di un logo (qualunque pagina/edizione) lo mette in
  cache; da quel momento in poi è sempre istantaneo per quella pagina,
  ovunque sia. Non tocca nient'altro: tutte le altre richieste (CSV, altre
  immagini, ecc.) passano dritte in rete come sempre.

  Come funziona per ogni richiesta di logo:
  - se è già in cache, viene servita SUBITO, zero attesa di rete → zero flash;
  - in parallelo, in background (stale-while-revalidate), viene ri-scaricata
    dalla rete e la cache aggiornata: se cambiate un'immagine mantenendo lo
    stesso nome/percorso, la versione nuova sarà pronta dal prossimo
    caricamento, senza bisogno di alzare manualmente CACHE_NAME.

  Se cambiate la LOGICA di questo file (non solo le immagini), alzate
  CACHE_NAME di 1: le cache vecchie vengono ripulite in "activate".
*/
const CACHE_NAME = 'cral-logo-v3';

function isLogoRequest(request) {
  if (request.method !== 'GET') return false;
  const path = new URL(request.url).pathname.toLowerCase();
  // Stessa convenzione già usata in tutto il sito: il file deve contenere sia
  // "logo" sia "cral" nel percorso (es. .../immagini/logo_cral.png), a
  // prescindere da quale edizione/cartella lo serva.
  return path.includes('logo') && path.includes('cral');
}

self.addEventListener('install', (event) => {
  // Attiva subito il nuovo SW, senza aspettare la chiusura di tutte le schede
  // aperte: dal punto di vista del logo non c'è nulla da rompere.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (!isLogoRequest(event.request)) return; // non è un logo: lascia fare al browser normalmente

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      // Rivalidazione in background: non blocca la risposta, aggiorna solo
      // la cache per la prossima volta se il contenuto in rete è cambiato.
      const revalidate = fetch(event.request)
        .then((response) => {
          if (response && response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) return cached; // istantaneo: nessuna attesa di rete, nessun flash

      // Niente ancora in cache per questo logo (prima visita in assoluto per
      // questa pagina/edizione): aspetta la rete una volta sola. Da qui in
      // poi sarà sempre servito dalla cache.
      const fresh = await revalidate;
      if (fresh) return fresh;
      throw new Error('Logo non disponibile: né in cache né raggiungibile in rete.');
    })
  );
});
