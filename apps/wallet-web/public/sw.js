import {ASSET_INTEGRITY} from "./asset-integrity.js";
import {PWA_CACHE, assetKeyForRequest, obsoletePwaCaches, responseMatchesIntegrity, serviceWorkerRoute} from "./service-worker-policy.js";

const ASSETS = Object.keys(ASSET_INTEGRITY);
const unavailable = (message = "Offline asset unavailable") => new Response(message, {status: 503, headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}});
async function purgeObsolete() { await Promise.all(obsoletePwaCaches(await caches.keys()).map((key) => caches.delete(key))); }
async function verified(response, key) { return await responseMatchesIntegrity(response, ASSET_INTEGRITY[key]) ? response : null; }
async function installCurrent() {
  const cache = await caches.open(PWA_CACHE);
  for (const key of ASSETS) {
    const response = await verified(await fetch(key, {cache: "no-store"}), key);
    if (!response) throw new Error(`PWA shell integrity rejected ${key}`);
    await cache.put(key, response);
  }
}
self.addEventListener("install", (event) => event.waitUntil(installCurrent().then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(purgeObsolete().then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const route = serviceWorkerRoute(event.request, self.location.origin);
  if (route === "network-only") return;
  event.waitUntil(purgeObsolete());
  const key = assetKeyForRequest(event.request, self.location.origin);
  if (!key || !ASSET_INTEGRITY[key]) return;
  if (route === "navigation-network-first") {
    event.respondWith(fetch(event.request).then(async (response) => {
      const valid = await verified(response, "./index.html");
      if (!valid) return unavailable("PWA shell integrity verification failed");
      await (await caches.open(PWA_CACHE)).put("./index.html", valid.clone());
      return valid;
    }).catch(async () => {
      const cache = await caches.open(PWA_CACHE), cached = await cache.match("./index.html");
      if (cached && await verified(cached, "./index.html")) return cached;
      if (cached) await cache.delete("./index.html");
      return unavailable();
    }));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(PWA_CACHE), cached = await cache.match(key);
    if (cached) {
      if (await verified(cached, key)) return cached;
      await cache.delete(key);
    }
    try {
      const response = await verified(await fetch(event.request), key);
      if (!response) return unavailable("PWA asset integrity verification failed");
      await cache.put(key, response.clone()); return response;
    } catch { return unavailable(); }
  })());
});
