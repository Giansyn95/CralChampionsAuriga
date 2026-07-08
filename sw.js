/*
  Service Worker minimale per CRAL Champions.
  Unico scopo: tenere il logo CRAL in cache permanente, così dal secondo
  caricamento in poi appare istantaneo (anche offline) e non viene più
  richiesto in rete a ogni refresh. Non tocca nient'altro: tutte le altre
  richieste (CSV, altre immagini, ecc.) passano dritte in rete come sempre.

  Il logo resta lo stesso tra un'edizione e l'altra del torneo, quindi non
  serve invalidare la cache a ogni stagione. Se un giorno cambiate il file
  del logo con un nome diverso (es. logo_cral_2027.png), il Service Worker
  lo riconosce comunque grazie al controllo generico qui sotto (basta che
  il nome contenga sia "logo" sia "cral", stessa convenzione già usata nel
  resto del sito). Se invece cambiate proprio l'immagine mantenendo lo
  stesso nome file, alzate CACHE_VERSION di 1 per forzare un refresh.
*/
const CACHE_VERSION = 'cral-logo-v1';

function isLogoRequest(request){
  if(request.method !== 'GET') return false;
  const path = new URL(request.url).pathname.toLowerCase();
  return path.includes('logo') && path.includes('cral');
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if(!isLogoRequest(event.request)) return; // non è il logo: lascia fare al browser normalmente

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      if(cached) return cached; // già in cache: nessuna richiesta di rete
      try{
        const response = await fetch(event.request);
        if(response && response.ok) cache.put(event.request, response.clone());
        return response;
      }catch(err){
        // Offline e non ancora in cache: propaga l'errore, il sito mostrerà
        // lo stemma SVG di fallback già previsto per questo caso.
        throw err;
      }
    })
  );
});
