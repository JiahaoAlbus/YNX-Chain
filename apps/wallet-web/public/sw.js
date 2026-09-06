import {ASSET_INTEGRITY} from "./asset-integrity.js";
import {PWA_BUILD_ID, PWA_CACHE, allPwaCaches, assetKeyForRequest, obsoletePwaCaches, responseMatchesIntegrity, serviceWorkerRoute, upgradeNavigationUrl} from "./service-worker-policy.js";

const ASSETS = Object.keys(ASSET_INTEGRITY);
const reloadingClients = new Set();
const unavailable = (message = "Offline asset unavailable") => new Response(message, {status: 503, headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}});
async function purgeObsolete() { await Promise.all(obsoletePwaCaches(await caches.keys()).map((key) => caches.delete(key))); }
async function verified(response, key) { return await responseMatchesIntegrity(response, ASSET_INTEGRITY[key]) ? response : null; }
async function cachedNavigation() {
  const cache = await caches.open(PWA_CACHE), cached = await cache.match("./index.html");
  if (cached && await verified(cached, "./index.html")) return cached;
  if (cached) await cache.delete("./index.html");
  return unavailable();
}
async function currentCacheReady() {
  if (!ASSETS.includes("./index.html") || !ASSETS.includes("./service-worker-policy.js") || ASSETS.some(key=>!/^[0-9a-f]{64}$/u.test(ASSET_INTEGRITY[key]))) return false;
  const cache = await caches.open(PWA_CACHE);
  for (const key of ASSETS) {
    const response = await cache.match(key);
    if (!response || !await verified(response, key)) return false;
  }
  return true;
}
async function installCurrent() {
  if (!/^[0-9a-f]{64}$/u.test(PWA_BUILD_ID)) throw new Error("PWA shell is missing its build identity");
  if (!ASSETS.includes("./index.html") || !ASSETS.includes("./service-worker-policy.js") || ASSETS.some(key=>!/^[0-9a-f]{64}$/u.test(ASSET_INTEGRITY[key]))) throw new Error("PWA shell integrity manifest is incomplete");
  const existing = (await caches.keys()).includes(PWA_CACHE);
  if (existing && await currentCacheReady()) return;
  try {
    const cache = await caches.open(PWA_CACHE);
    for (const key of ASSETS) {
      const response = await verified(await fetch(key, {cache: "no-store"}), key);
      if (!response) throw new Error(`PWA shell integrity rejected ${key}`);
      await cache.put(key, response);
    }
    if (!await currentCacheReady()) throw new Error("PWA shell integrity cache is incomplete");
  } catch (error) {
    // Only a cache created by this installation is disposable. Never erase a
    // previous build, or a complete cache belonging to an identical build.
    if (!existing) await caches.delete(PWA_CACHE);
    throw error;
  }
}
self.addEventListener("install", (event) => event.waitUntil(installCurrent().then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil((async()=>{
  if(!await currentCacheReady()){
    throw new Error("PWA shell activation rejected an incomplete cache");
  }
  const replacingShell=allPwaCaches(await caches.keys()).some(key=>key!==PWA_CACHE);
  const windows=replacingShell?(await self.clients.matchAll({type:"window",includeUncontrolled:true})).filter(client=>assetKeyForRequest({url:client.url,method:"GET"},self.registration.scope)):[];
  for(const client of windows)if(client.id)reloadingClients.add(client.id);
  const obsolete=obsoletePwaCaches(await caches.keys());
  await Promise.all(obsolete.map((key)=>caches.delete(key)));
  await self.clients.claim();
  await purgeObsolete();
  // A page still executing its old cached modules expects its old build ID.
  // Reload it once after the complete new cache is active, preserving its URL.
  if(replacingShell){
    await Promise.all(windows.map(async client=>{
      const target=upgradeNavigationUrl(client.url);
      if(target)await client.navigate(target).catch(()=>null);
    }));
  }
})()));
self.addEventListener("message",(event)=>{
  if(!event.ports?.[0])return;
  if(event.data?.type==="YNX_WALLET_PWA_VERSION")event.ports[0].postMessage({cache:PWA_CACHE});
  else if(event.data?.type==="YNX_WALLET_PWA_VERIFY_CACHE")event.waitUntil(currentCacheReady().then(complete=>{
    event.ports[0].postMessage({cache:PWA_CACHE,complete});
  }).catch(()=>event.ports[0].postMessage({cache:PWA_CACHE,complete:false})));
});
self.addEventListener("fetch", (event) => {
  const scopeUrl = self.registration.scope;
  const route = serviceWorkerRoute(event.request, scopeUrl);
  if (route === "network-only") return;
  event.waitUntil(purgeObsolete());
  const key = assetKeyForRequest(event.request, scopeUrl);
  if (!key || !ASSET_INTEGRITY[key]) return;
  if(route!=="navigation-network-first"&&reloadingClients.has(event.clientId)){
    event.respondWith(Promise.resolve(unavailable("PWA shell changed; reload this page before requesting assets")));
    return;
  }
  if (route === "navigation-network-first") {
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(async (response) => {
      const valid = await verified(response, "./index.html");
      if (!valid) {
        // A newer deployment is not evidence that its whole shell is ready.
        // Keep this verified shell usable while a separate installation updates.
        event.waitUntil(self.registration.update().catch(()=>null));
        return cachedNavigation();
      }
      await (await caches.open(PWA_CACHE)).put("./index.html", valid.clone());
      return valid;
    }).catch(cachedNavigation));
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
