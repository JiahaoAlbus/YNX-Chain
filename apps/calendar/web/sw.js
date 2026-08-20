const CACHE = "ynx-calendar-v5";
const ASSETS = [
  "/",
  "/styles.css",
  "/i18n.js",
  "/locales.json",
  "/app.js",
  "/wallet-connection.js",
  "/ynx-dapp-connect-sdk/constants.js",
  "/ynx-dapp-connect-sdk/discovery.js",
  "/ynx-dapp-connect-sdk/errors.js",
  "/ynx-dapp-connect-sdk/provider.js",
  "/manifest.webmanifest",
  "/ynx-logo.png",
  "/ynx-app-icon.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/v1/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((response) => response || caches.match("/"))),
  );
});
