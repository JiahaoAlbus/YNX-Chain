const CACHE = 'ynx-monitor-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];
const isLiveEvidence = (url) => ['/status', '/connectivity'].includes(url.pathname.toLowerCase());
const isOperations = (url) => { const path = url.pathname.toLowerCase(); return path === '/ops' || path.startsWith('/ops/'); };
const isAuthenticated = (request) => request.headers.has('Authorization');
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(key => key.startsWith('ynx-monitor-shell-') && key !== CACHE).map(key => caches.delete(key)));
  const cache = await caches.open(CACHE);
  await Promise.all((await cache.keys()).filter(request => isLiveEvidence(new URL(request.url)) || isOperations(new URL(request.url)) || isAuthenticated(request)).map(request => cache.delete(request)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Match Express case-insensitive routing. Bearer responses are never offline content.
  if (isAuthenticated(event.request)) { event.respondWith(fetch(event.request, { cache: 'no-store' })); return; }
  // These routes must never use a cached response or the cached HTML shell.
  if (isLiveEvidence(url)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response(
      JSON.stringify({ availability: 'unavailable', error: 'public_status_unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    )));
    return;
  }
  if (isOperations(url)) { event.respondWith(fetch(event.request, { cache: 'no-store' })); return; }
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !/(?:^|,)\s*no-store(?:\s|,|$)/i.test(response.headers.get('Cache-Control') || '')) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}));
    }
    return response;
  }).catch(() => caches.open(CACHE).then(async cache => (await cache.match(event.request)) || cache.match('/'))));
});
