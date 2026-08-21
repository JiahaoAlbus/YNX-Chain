import {ASSET_INTEGRITY} from "./asset-integrity.js?schema=7";
import {PWA_CACHE, PWA_CACHE_STAGING, assetKeyForRequest, obsoletePwaCaches, responseMatchesIntegrity, serviceWorkerRoute} from "./service-worker-policy.js?schema=7";

const ASSETS = Object.keys(ASSET_INTEGRITY);
const unavailable = (message = "Offline asset unavailable") => new Response(message, {status: 503, headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}});
async function purgeObsolete() { await Promise.all(obsoletePwaCaches(await caches.keys()).map((key) => caches.delete(key))); }
async function verified(response, key) { return await responseMatchesIntegrity(response, ASSET_INTEGRITY[key]) ? response : null; }
async function installCurrent() {
  await caches.delete(PWA_CACHE_STAGING);
  const staging = await caches.open(PWA_CACHE_STAGING);
  try {
    for (const key of ASSETS) {
      const response = await verified(await fetch(key, {cache: "no-store"}), key);
      if (!response) throw new Error(`PWA shell integrity rejected ${key}`);
      await staging.put(key, response);
    }
    await caches.delete(PWA_CACHE);
    const current = await caches.open(PWA_CACHE);
    for (const key of ASSETS) {
      const response = await staging.match(key);
      if (!response || !await verified(response, key)) throw new Error(`PWA shell staging rejected ${key}`);
      await current.put(key, response);
    }
  } catch (error) {
    await Promise.all([caches.delete(PWA_CACHE_STAGING), caches.delete(PWA_CACHE)]);
    throw error;
  }
  await caches.delete(PWA_CACHE_STAGING);
}
self.addEventListener("install", (event) => event.waitUntil(installCurrent().then(() => self.skipWaiting()).catch((error) => {
  console.error("YNX_PWA_INSTALL_FAILED", error instanceof Error ? error.message : String(error));
  throw error;
})));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await purgeObsolete();
  await self.clients.claim();
  for (const client of await self.clients.matchAll({type:"window",includeUncontrolled:true})) client.postMessage({type:"YNX_PWA_SHELL_UPGRADED",schema:7});
})()));
self.addEventListener("fetch", (event) => {
  const scopeUrl = self.registration.scope;
  const route = serviceWorkerRoute(event.request, scopeUrl);
  if (route === "network-only") return;
  event.waitUntil(purgeObsolete());
  const key = assetKeyForRequest(event.request, scopeUrl);
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
