/*
  Service Worker per CRAL Champions - cache solo del logo CRAL.

  Compatibile con entrambe le strutture:
  - CralChampions2026:        /immagini/logo_cral.png
  - CralChampionsAuriga:      /tornei/<edizione>/immagini/logo_cral.png

  Obiettivo:
  - non intercettare CSV, HTML, JS, CSS o altre immagini;
  - usare la cache solo per il file logo_cral.* nella cartella immagini;
  - servire il logo dalla cache quando disponibile e aggiornarlo in background.

  Quando modifichi la logica del service worker, aumenta CACHE_NAME.
*/

const CACHE_PREFIX = 'cral-logo-';
const CACHE_NAME = `${CACHE_PREFIX}v4`;

// Accetta solo il logo CRAL vero e proprio, non qualunque immagine che contenga
// casualmente le parole "logo" e "cral" nel percorso.
const CRAL_LOGO_FILE_RE = /^(?:logo[_-]?cral|logocral)\.(?:png|jpe?g|webp|svg)$/i;

function getNormalizedCacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function isCralLogoRequest(request) {
  if (request.method !== 'GET') return false;

  // Le richieste non-image non vengono mai gestite dal SW.
  // In alcuni browser/contesti request.destination puo essere vuoto: in quel
  // caso si continua con il controllo stretto sul percorso del file.
  if (request.destination && request.destination !== 'image') return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;

  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch (_) {
    // Se il path non e decodificabile, usa comunque il valore originale.
  }

  const parts = pathname.toLowerCase().split('/').filter(Boolean);
  const filename = parts[parts.length - 1] || '';
  const parentFolder = parts[parts.length - 2] || '';

  // Copre sia /immagini/logo_cral.png sia
  // /tornei/<edizione>/immagini/logo_cral.png, senza toccare giocatori/squadre.
  return parentFolder === 'immagini' && CRAL_LOGO_FILE_RE.test(filename);
}

async function fetchAndUpdateLogoCache(request, cache, cacheKey) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });

    if (response && response.ok) {
      await cache.put(cacheKey, response.clone());
    }

    return response;
  } catch (_) {
    return null;
  }
}

async function getCralLogoResponseAndUpdate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = getNormalizedCacheKey(request);
  const cached = await cache.match(cacheKey);
  const updatePromise = fetchAndUpdateLogoCache(request, cache, cacheKey);

  if (cached) {
    // Risposta immediata dalla cache: la rete aggiorna solo per il prossimo giro.
    return { response: cached, updatePromise };
  }

  // Prima visita o cache pulita: solo il logo aspetta la rete una volta.
  const fresh = await updatePromise;
  return {
    response: fresh || new Response('Logo CRAL non disponibile.', {
      status: 504,
      statusText: 'Logo CRAL non disponibile',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
    updatePromise,
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (!isCralLogoRequest(event.request)) return;

  const work = getCralLogoResponseAndUpdate(event.request);

  event.respondWith(work.then(({ response }) => response));
  event.waitUntil(work.then(({ updatePromise }) => updatePromise).catch(() => null));
});
