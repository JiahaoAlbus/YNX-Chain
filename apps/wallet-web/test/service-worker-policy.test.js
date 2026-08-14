import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {PWA_CACHE, assetKeyForRequest, cacheableResponse, obsoletePwaCaches, responseMatchesIntegrity, serviceWorkerRoute} from "../src/service-worker-policy.js";

const origin = "https://wallet.ynxweb4.com";
const request = (url, method="GET", mode="cors") => ({url,method,mode});

test("PWA routes only same-origin GET navigation and assets into cache strategies", () => {
  assert.equal(PWA_CACHE,"ynx-wallet-web-v6");
  assert.equal(serviceWorkerRoute(request(`${origin}/wallet`,"GET","navigate"),origin),"navigation-network-first");
  assert.equal(serviceWorkerRoute(request(`${origin}/app.js`),origin),"asset-cache-first");
  assert.equal(serviceWorkerRoute(request("https://evm.ynxweb4.com","POST"),origin),"network-only");
  assert.equal(serviceWorkerRoute(request("https://metamask.io/download"),origin),"network-only");
  assert.equal(serviceWorkerRoute(request("https://www.ynxweb4.com/downloads/wallet.apk"),origin),"network-only");
});

test("only obsolete YNX caches are purged and requests resolve to canonical asset keys",()=>{
  assert.deepEqual(obsoletePwaCaches(["ynx-wallet-web-v2","ynx-wallet-web-v5",PWA_CACHE,"another-product-v1","ynx-wallet-web-preview"]),["ynx-wallet-web-v2","ynx-wallet-web-v5"]);
  assert.equal(assetKeyForRequest(request(`${origin}/`),origin),"./index.html");
  assert.equal(assetKeyForRequest(request(`${origin}/app.js?rollback=1`),origin),"./app.js");
  assert.equal(assetKeyForRequest(request("https://evm.ynxweb4.com"),origin),null);
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
