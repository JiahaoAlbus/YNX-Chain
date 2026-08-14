import {PWA_CACHE, cacheableResponse, serviceWorkerRoute} from "./service-worker-policy.js";

const ASSETS = ["./", "./index.html", "./styles.css", "./accessibility.css", "./app.js", "./provider.js", "./i18n.js", "./service-worker-policy.js", "./ynx-logo.png", "./manifest.webmanifest"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(PWA_CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== PWA_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const route = serviceWorkerRoute(event.request, self.location.origin);
  if (route === "network-only") return;
  if (route === "navigation-network-first") {
    event.respondWith(fetch(event.request).then(async (response) => {
      if (cacheableResponse(response)) (await caches.open(PWA_CACHE)).put("./index.html", response.clone());
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
    if (cacheableResponse(response)) (await caches.open(PWA_CACHE)).put(event.request, response.clone());
    return response;
  }).catch(() => new Response("Offline asset unavailable", {status: 503, headers: {"content-type": "text/plain; charset=utf-8"}}))));
});
