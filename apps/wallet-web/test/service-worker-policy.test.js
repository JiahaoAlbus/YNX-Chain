import assert from "node:assert/strict";
import test from "node:test";
import {PWA_CACHE, cacheableResponse, serviceWorkerRoute} from "../src/service-worker-policy.js";

const origin = "https://wallet.ynxweb4.com";
const request = (url, method="GET", mode="cors") => ({url,method,mode});

test("PWA routes only same-origin GET navigation and assets into cache strategies", () => {
  assert.equal(PWA_CACHE,"ynx-wallet-web-v3");
  assert.equal(serviceWorkerRoute(request(`${origin}/wallet`,"GET","navigate"),origin),"navigation-network-first");
  assert.equal(serviceWorkerRoute(request(`${origin}/app.js`),origin),"asset-cache-first");
  assert.equal(serviceWorkerRoute(request("https://evm.ynxweb4.com","POST"),origin),"network-only");
  assert.equal(serviceWorkerRoute(request("https://metamask.io/download"),origin),"network-only");
  assert.equal(serviceWorkerRoute(request("https://www.ynxweb4.com/downloads/wallet.apk"),origin),"network-only");
});

test("PWA caches only successful same-origin response classes", () => {
  assert.equal(cacheableResponse({ok:true,type:"basic"}),true);
  assert.equal(cacheableResponse({ok:true,type:"default"}),true);
  assert.equal(cacheableResponse({ok:true,type:"cors"}),false);
  assert.equal(cacheableResponse({ok:false,type:"basic"}),false);
});
