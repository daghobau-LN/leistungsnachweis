/* Service Worker: hält die App auch ohne Internet startbereit.
   Nachweise und Server-Antworten werden hier NIE zwischengespeichert –
   die Warteschlange liegt in der App selbst. */
const CACHE = 'ln-app-1.2.1';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'icons/logo.svg', 'icons/logo-mark.svg',
  'fonts/plex-sans-latin-400.woff2', 'fonts/plex-sans-latin-600.woff2',
  'fonts/plex-sans-latin-ext-400.woff2', 'fonts/plex-sans-latin-ext-600.woff2',
  'fonts/plex-arabic-arabic-400.woff2', 'fonts/plex-arabic-arabic-600.woff2'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' → beim Aktualisieren nie veraltete Dateien aus dem HTTP-Zwischenspeicher (GitHub Pages hält Dateien bis zu 10 Min.) übernehmen
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ln-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Server-Anfragen nie anfassen

  // config.js zuerst aus dem Netz (damit eine geänderte Server-Adresse sofort gilt)
  const networkFirst = url.pathname.endsWith('/config.js');

  const fromNetwork = fetch(req).then(async (res) => {
    if (res && res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(req, res.clone());
    }
    return res;
  }).catch(() => null);

  event.waitUntil(fromNetwork.then(() => undefined));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (networkFirst) {
      const res = await fromNetwork;
      if (res) return res;
    }
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fromNetwork;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
