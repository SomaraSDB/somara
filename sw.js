// Service worker: guarda la app en la tablet para que funcione sin internet.
// Sube este número cada vez que cambies archivos de la app.
const CACHE = 'somara-v17';
const ARCHIVOS = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/app.js',
  './js/ui.js',
  './js/config.js',
  './js/google.js',
  './js/citas.js',
  './js/copia.js',
  './js/pin.js',
  './js/excel.js',
  './img/logo.png',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Primero la red (para recibir actualizaciones); si no hay conexión, la copia guardada.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Solo los archivos de la propia app; Google (calendario, inicio de sesión) nunca se guarda.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // `no-cache` obliga a preguntar al servidor si hay versión nueva (evita copias antiguas del navegador).
  const peticion = e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(peticion)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
