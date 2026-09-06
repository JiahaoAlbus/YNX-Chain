import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {PWA_CACHE, allPwaCaches, assetKeyForRequest, cacheableResponse, cleanPwaNavigationUrl, obsoletePwaCaches, recoveryNavigationUrl, responseMatchesIntegrity, serviceWorkerRoute, upgradeNavigationUrl} from "../src/service-worker-policy.js";

const origin = "https://wallet.ynxweb4.com";
const request = (url, method="GET", mode="cors") => ({url,method,mode});

test("PWA routes only same-origin GET navigation and assets into cache strategies", () => {
  assert.equal(PWA_CACHE,"ynx-wallet-web-v11");
  assert.equal(serviceWorkerRoute(request(`${origin}/wallet`,"GET","navigate"),origin),"navigation-network-first");
  assert.equal(serviceWorkerRoute(request(`${origin}/app.js`),origin),"asset-cache-first");
  assert.equal(serviceWorkerRoute(request("https://evm.ynxweb4.com","POST"),origin),"network-only");
  assert.equal(serviceWorkerRoute(request("https://metamask.io/download"),origin),"network-only");
  assert.equal(serviceWorkerRoute(request("https://www.ynxweb4.com/downloads/wallet.apk"),origin),"network-only");
});

test("only obsolete YNX caches are purged and requests resolve to canonical asset keys",()=>{
  assert.deepEqual(obsoletePwaCaches(["ynx-wallet-web-v2","ynx-wallet-web-v6",PWA_CACHE,"another-product-v1","ynx-wallet-web-preview"]),["ynx-wallet-web-v2","ynx-wallet-web-v6"]);
  assert.deepEqual(allPwaCaches(["ynx-wallet-web-v2",PWA_CACHE,"another-product-v1","ynx-wallet-web-preview"]),["ynx-wallet-web-v2",PWA_CACHE]);
  assert.equal(assetKeyForRequest(request(`${origin}/`),origin),"./index.html");
  assert.equal(assetKeyForRequest(request(`${origin}/app.js?rollback=1`),origin),"./app.js");
  assert.equal(assetKeyForRequest(request("https://evm.ynxweb4.com"),origin),null);
});

test("version drift recovery and upgrade navigation are single-attempt and URL preserving",()=>{
  const original=`${origin}/?lang=en&source=3651#connect`;
  const recovery=recoveryNavigationUrl(original);
  assert.equal(recovery,`${origin}/?lang=en&source=3651&ynx-sw-recovery=ynx-wallet-web-v11#connect`);
  assert.equal(recoveryNavigationUrl(recovery),null);
  const upgrade=upgradeNavigationUrl(original);
  assert.equal(upgrade,`${origin}/?lang=en&source=3651&ynx-sw-upgrade=ynx-wallet-web-v11#connect`);
  assert.equal(upgradeNavigationUrl(upgrade),null);
  assert.equal(recoveryNavigationUrl("javascript:alert(1)"),null);
});

test("PWA recovery markers are removed without changing route state",()=>{
  assert.equal(cleanPwaNavigationUrl(`${origin}/?lang=en&verify=1&ynx-sw-recovery=ynx-wallet-web-v11&ynx-sw-upgrade=ynx-wallet-web-v9#connect`),"/?lang=en&verify=1#connect");
  assert.equal(cleanPwaNavigationUrl(`${origin}/?lang=en#connect`),null);
  assert.equal(cleanPwaNavigationUrl("chrome-extension://wallet/index.html?ynx-sw-recovery=ynx-wallet-web-v11"),null);
});

test("nested official scope resolves canonical keys and rejects same-origin paths outside Wallet",()=>{
  const scope=`${origin}/wallet/companion/`;
  assert.equal(assetKeyForRequest(request(`${origin}/wallet/companion/`),scope),"./index.html");
  assert.equal(assetKeyForRequest(request(`${origin}/wallet/companion/app.js?cold=1`),scope),"./app.js");
  assert.equal(assetKeyForRequest(request(`${origin}/wallet/companionish/app.js`),scope),null);
  assert.equal(assetKeyForRequest(request(`${origin}/app.js`),scope),null);
  assert.equal(serviceWorkerRoute(request(`${origin}/wallet/companion/`,`GET`,`navigate`),scope),"navigation-network-first");
  assert.equal(serviceWorkerRoute(request(`${origin}/wallet/companion/app.js`),scope),"asset-cache-first");
  assert.equal(serviceWorkerRoute(request(`${origin}/app.js`),scope),"network-only");
});

test("built worker derives cache keys from its registration scope",async()=>{
  const worker=await import("node:fs/promises").then(({readFile})=>readFile(new URL("../public/sw.js",import.meta.url),"utf8"));
  assert.match(worker,/const scopeUrl = self\.registration\.scope;/u);
  assert.doesNotMatch(worker,/assetKeyForRequest\(event\.request, self\.location\.origin\)/u);
  assert.match(worker,/self\.registration\.unregister\(\)/u);
  assert.match(worker,/x-ynx-wallet-recovery/u);
  assert.doesNotMatch(worker,/client\.navigate\(/u);
  assert.doesNotMatch(worker,/includeUncontrolled:true/u);
  assert.match(worker,/YNX_WALLET_PWA_VERSION/u);
  assert.match(worker,/event\.ports\[0\]\.postMessage\(\{cache:PWA_CACHE\}\)/u);
  assert.match(worker,/async function currentCacheReady\(\)/u);
  assert.match(worker,/await caches\.delete\(PWA_CACHE\);\s+try/u);
  assert.match(worker,/if \(!await currentCacheReady\(\)\) throw new Error\("PWA shell integrity cache is incomplete"\)/u);
  assert.match(worker,/catch \(error\) \{\s+await caches\.delete\(PWA_CACHE\);\s+throw error;/u);
  const activationGuard=worker.indexOf('if(!await currentCacheReady())');
  const obsoleteDeletion=worker.indexOf('const obsolete=obsoletePwaCaches');
  assert.ok(activationGuard>=0&&activationGuard<obsoleteDeletion,"v11 integrity must be ready before obsolete caches are deleted");
  assert.match(worker,/await self\.clients\.claim\(\);\s+await purgeObsolete\(\);/u);
});

test("PWA bootstrap waits for activated v11 control and permits only one bounded reload",async()=>{
  const app=await import("node:fs/promises").then(({readFile})=>readFile(new URL("../public/app.js",import.meta.url),"utf8"));
  assert.match(app,/register\("\.\/sw\.js",\{type:"module",scope:"\.\/"\}\)/u);
  assert.match(app,/worker\?\.state==="activated"&&await workerVersion\(worker\)===PWA_CACHE/u);
  assert.match(app,/await waitForV11Worker\(registration\)/u);
  assert.match(app,/const startingControllerVersion=await workerVersion\(navigator\.serviceWorker\.controller\)/u);
  assert.match(app,/if\(startingControllerVersion!==PWA_CACHE&&reloadUrl\)/u);
  assert.match(app,/return \{reloading:true\}/u);
  assert.match(app,/if\(!await waitForV11Controller\(\)\)throw Object\.assign/u);
  assert.match(app,/obsoletePwaCaches\(keys\)\.length===0/u);
  assert.match(app,/Date\.now\(\)-stableSince>=1000/u);
  assert.match(app,/dataset\.pwa="ready"/u);
  assert.match(app,/dataset\.pwa="failed"/u);
  assert.match(app,/const reloadUrl=upgradeNavigationUrl\(initialPwaNavigationUrl\)/u);
  assert.match(app,/location\.replace\(reloadUrl\)/u);
  assert.match(app,/if\(!result\.reloading\)document\.documentElement\.dataset\.pwa="ready"/u);
  assert.doesNotMatch(app,/register\("\.\/sw\.js"[^;]+\.catch\(\(\) => \{\}\)/u);
});

test("public bootstrap HTML remains byte-compatible with the deployed v8 worker",async()=>{
  const html=await import("node:fs/promises").then(({readFile})=>readFile(new URL("../public/index.html",import.meta.url)));
  assert.equal(createHash("sha256").update(html).digest("hex"),"2df10866a35b074a6fb366439197646dd4e979bc83bdae3aba0ba6db3802986c");
  assert.doesNotMatch(html.toString("utf8"),/ynx-wallet-shell/u);
});

test("PWA caches only successful same-origin response classes", () => {
  assert.equal(cacheableResponse({ok:true,type:"basic"}),true);
  assert.equal(cacheableResponse({ok:true,type:"default"}),true);
  assert.equal(cacheableResponse({ok:true,type:"cors"}),false);
  assert.equal(cacheableResponse({ok:false,type:"basic"}),false);
});

test("cached bytes require the exact build digest",async()=>{
  const body="trusted shell",digest=createHash("sha256").update(body).digest("hex");
  assert.equal(await responseMatchesIntegrity(new Response(body),digest),true);
  assert.equal(await responseMatchesIntegrity(new Response("tampered shell"),digest),false);
  assert.equal(await responseMatchesIntegrity(new Response(body),"0".repeat(64)),false);
});
