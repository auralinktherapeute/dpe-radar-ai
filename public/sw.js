/**
 * Service worker — usage terrain.
 *
 * Un negociateur consulte le Radar en voiture, entre deux rendez-vous, avec
 * une couverture reseau incertaine. La strategie retenue :
 *
 *  - « network-first » sur les pages : on veut la donnee du jour, mais on
 *    tombe sur le cache plutot que sur une page d'erreur ;
 *  - AUCUNE mise en cache des reponses de l'API : un score perime affiche
 *    comme frais ferait citer une donnee fausse en rendez-vous.
 */
const CACHE = 'dpe-radar-v1';
const SHELL = ['/radar', '/pipeline', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Les scores ne sont jamais servis depuis le cache.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/radar'))),
  );
});
