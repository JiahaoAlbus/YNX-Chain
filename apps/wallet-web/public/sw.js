import {ASSET_INTEGRITY} from "./asset-integrity.js";
import {PWA_CACHE, allPwaCaches, assetKeyForRequest, obsoletePwaCaches, recoveryNavigationUrl, responseMatchesIntegrity, serviceWorkerRoute} from "./service-worker-policy.js";

const ASSETS = Object.keys(ASSET_INTEGRITY);
const unavailable = (message = "Offline asset unavailable") => new Response(message, {status: 503, headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}});
async function purgeObsolete() { await Promise.all(obsoletePwaCaches(await caches.keys()).map((key) => caches.delete(key))); }
async function verified(response, key) { return await responseMatchesIntegrity(response, ASSET_INTEGRITY[key]) ? response : null; }
function recoveryDocument(target) {
  const safeTarget=JSON.stringify(target).replaceAll("<", "\\u003c");
  return new Response(`<!doctype html><html lang="en" class="notranslate" translate="no"><meta charset="utf-8"><meta name="google" content="notranslate"><title>YNX Wallet recovery</title><body><p>Updating YNX Wallet…</p><script>location.replace(${safeTarget})</script></body></html>`, {status:503, headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'","x-ynx-wallet-recovery":PWA_CACHE}});
}
async function recoverVersionDrift(request) {
  const target=recoveryNavigationUrl(request.url);
  if(!target)return unavailable("PWA shell recovery stopped after one attempt");
  await Promise.all(allPwaCaches(await caches.keys()).map((key)=>caches.delete(key)));
  if(!await self.registration.unregister())return unavailable("PWA shell recovery could not unregister the stale worker");
  return recoveryDocument(target);
}
async function currentCacheReady() {
  const cache = await caches.open(PWA_CACHE);
  for (const key of ASSETS) {
    const response = await cache.match(key);
    if (!response || !await verified(response, key)) return false;
  }
  return true;
}
async function installCurrent() {
  await caches.delete(PWA_CACHE);
  try {
    const cache = await caches.open(PWA_CACHE);
    for (const key of ASSETS) {
      const response = await verified(await fetch(key, {cache: "no-store"}), key);
      if (!response) throw new Error(`PWA shell integrity rejected ${key}`);
      await cache.put(key, response);
    }
    if (!await currentCacheReady()) throw new Error("PWA shell integrity cache is incomplete");
  } catch (error) {
    await caches.delete(PWA_CACHE);
    throw error;
  }
}
self.addEventListener("install", (event) => event.waitUntil(installCurrent().then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil((async()=>{
  if(!await currentCacheReady()){
    await caches.delete(PWA_CACHE);
    throw new Error("PWA shell activation rejected an incomplete cache");
  }
  const obsolete=obsoletePwaCaches(await caches.keys());
  await Promise.all(obsolete.map((key)=>caches.delete(key)));
  await self.clients.claim();
  await purgeObsolete();
})()));
self.addEventListener("message",(event)=>{
  if(event.data?.type!=="YNX_WALLET_PWA_VERSION"||!event.ports?.[0])return;
  event.ports[0].postMessage({cache:PWA_CACHE});
});
self.addEventListener("fetch", (event) => {
  const scopeUrl = self.registration.scope;
  const route = serviceWorkerRoute(event.request, scopeUrl);
  if (route === "network-only") return;
  event.waitUntil(purgeObsolete());
  const key = assetKeyForRequest(event.request, scopeUrl);
  if (!key || !ASSET_INTEGRITY[key]) return;
  if (route === "navigation-network-first") {
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(async (response) => {
      const valid = await verified(response, "./index.html");
      if (!valid) return response?.ok && ["basic","default"].includes(response.type) ? recoverVersionDrift(event.request) : unavailable("PWA shell integrity verification failed");
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
