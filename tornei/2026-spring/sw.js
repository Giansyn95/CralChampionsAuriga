/*
  Service Worker per CRAL Champions — cache del logo CRAL.

  Obiettivo: il logo non deve MAI far vedere un caricamento, nemmeno al
  primissimo refresh dopo l'installazione, e deve aggiornarsi da solo se un
  giorno sostituite il file mantenendo lo stesso nome (logo_cral.png).
  Non tocca nient'altro: tutte le altre richieste (CSV, altre immagini, ecc.)
  passano dritte in rete come sempre.

  Come funziona:
  1) INSTALL: il logo viene scaricato e messo in cache subito, durante
     l'installazione del Service Worker (non si aspetta la prima richiesta).
     Appena questo SW diventa attivo, il logo è già pronto in cache.
  2) FETCH: le richieste per il logo vengono servite SEMPRE dalla cache,
     istantaneamente, zero attesa di rete → zero flash, anche su refresh
     rapidissimi. In parallelo, in background (stale-while-revalidate),
     riscarica il file dalla rete e aggiorna la cache: se avete cambiato
     l'immagine mantenendo lo stesso nome, la versione nuova sarà pronta
     per il prossimo caricamento, senza bisogno di alzare manualmente
     CACHE_NAME.

  Se invece cambiate anche la logica di questo file (non solo l'immagine),
  alzate CACHE_NAME di 1: le cache vecchie vengono ripulite in "activate".
*/
const CACHE_NAME = 'cral-logo-v2';

// Risolto rispetto allo scope del Service Worker: funziona sia se il sito
// è alla radice del dominio, sia se è sotto un sotto-percorso (es. GitHub
// Pages tipo dominio.github.io/NomeRepo/).
const LOGO_URL = new URL('immagini/logo_cral.png', self.registration.scope).href;

function isLogoRequest(request) {
  if (request.method !== 'GET') return false;
  const path = new URL(request.url).pathname.toLowerCase();
  // Stessa convenzione già usata nel resto del sito: il file deve contenere
  // sia "logo" sia "cral" nel nome/percorso (es. immagini/logo_cral.png).
  // Riconosce quindi anche eventuali varianti (logo-cral.jpg, ecc.).
  return path.includes('logo') && path.includes('cral');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(LOGO_URL))
      .catch(() => {
        // Prima installazione offline o file momentaneamente irraggiungibile:
        // non bloccare l'installazione, si riproverà alla prima richiesta reale.
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (!isLogoRequest(event.request)) return; // non è il logo: lascia fare al browser normalmente

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

      // Niente in cache (prima visita in assoluto, o precache fallita perché
      // eravamo offline all'installazione): aspetta la rete una volta sola.
      const fresh = await revalidate;
      if (fresh) return fresh;
      throw new Error('Logo non disponibile: né in cache né raggiungibile in rete.');
    })
  );
});
