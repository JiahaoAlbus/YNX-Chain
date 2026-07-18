const CACHE = "ynx-dex-shell-v2";
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"]))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/v1/")) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    try {
      const response = await fetch(event.request);
      if (response.ok && new URL(event.request.url).origin === self.location.origin) await cache.put(event.request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") return cache.match("/");
      return new Response("Offline asset unavailable", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  }));
});
