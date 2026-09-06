import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {compilePwaShell} from "../scripts/build.mjs";
import {loadPwaWorker,memoryCacheStorage} from "../scripts/pwa-worker-harness.mjs";

const worker=await readFile(new URL("../public/sw.js",import.meta.url),"utf8");
const policy=await readFile(new URL("../src/service-worker-policy.js",import.meta.url),"utf8");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const inputs=tag=>({"index.html":Buffer.from(`<html><head></head><body>${tag}</body></html>`),"app.js":Buffer.from(`globalThis.build=${JSON.stringify(tag)}`),"service-worker-policy.js":Buffer.from(policy)});
const build=tag=>compilePwaShell(inputs(tag),worker);
const networkFor=compiled=>async url=>{const path=new URL(url).pathname.slice(1)||"index.html";return compiled.files[path]?new Response(compiled.files[path]):new Response("missing",{status:404})};
const load=(compiled,options={})=>loadPwaWorker({workerSource:compiled.files["sw.js"].toString(),policySource:compiled.files["service-worker-policy.js"].toString(),assetIntegrity:compiled.assetIntegrity,network:networkFor(compiled),...options});

test("build IDs are deterministic, cover worker/policy/assets, and final hashes verify without a digest cycle",async()=>{
  const a=build("a"),same=build("a"),b=build("b");
  assert.equal(a.buildId,same.buildId);assert.notEqual(a.buildId,b.buildId);
  assert.notEqual(a.buildId,compilePwaShell(inputs("a"),worker+"\n// change").buildId);
  assert.notEqual(a.buildId,compilePwaShell({...inputs("a"),"service-worker-policy.js":Buffer.from(policy+"\n// change")},worker).buildId);
  assert.match(a.buildId,/^[0-9a-f]{64}$/);
  assert.ok(!a.files["service-worker-policy.js"].includes("__YNX_PWA_BUILD_ID__"));
  for(const [path,expected] of Object.entries(a.assetIntegrity))assert.equal(digest(a.files[path==="./"?"index.html":path.slice(2)]),expected,path);
  assert.throws(()=>compilePwaShell({...inputs("a"),"service-worker-policy.js":a.files["service-worker-policy.js"]},worker),/placeholder/);
});

test("failed new installation preserves an activated old build and its offline shell",async()=>{
  const storage=memoryCacheStorage(),a=build("old"),b=build("broken");
  const old=await load(a,{storage});await old.install();await old.activate();
  const next=await load(b,{storage,network:async url=>url.endsWith("app.js")?new Response("corrupt"):networkFor(b)(url)});
  await assert.rejects(next.install(),/integrity rejected/);
  assert.equal(next.state.skipWaiting,0);assert.equal(next.state.claims,0);
  assert.ok(storage.stores.has(old.policy.PWA_CACHE));assert.ok(!storage.stores.has(next.policy.PWA_CACHE));
  const offline=await load(a,{storage,network:async()=>{throw new Error("offline")}});
  assert.equal(await (await offline.request("/","navigate")).text(),a.files["index.html"].toString());
});

test("activation independently rejects a cache damaged after installation without deleting old builds",async()=>{
  const storage=memoryCacheStorage(),a=await load(build("a"),{storage}),b=await load(build("b"),{storage});
  await a.install();await a.activate();await b.install();
  await (await b.caches.open(b.policy.PWA_CACHE)).delete("./app.js");
  await assert.rejects(b.activate(),/activation rejected/);
  assert.equal(b.state.claims,0);assert.ok(storage.stores.has(a.policy.PWA_CACHE));
});

test("successful activation protects other installing/old build caches and reloads only in-scope clients once",async()=>{
  const storage=memoryCacheStorage(),a=await load(build("a"),{storage});await a.install();await a.activate();
  const b=await load(build("b"),{storage,clientUrls:["https://wallet.test/?lang=en#connect","https://other.test/"]});
  await b.install();const future=`ynx-wallet-shell-build-${"f".repeat(64)}`;
  await b.caches.open(future);await b.caches.open("ynx-wallet-web-v11");await b.activate();
  assert.equal(b.state.claims,1);assert.equal(b.state.navigations.length,1);
  assert.ok(b.state.navigations[0].includes(`ynx-sw-upgrade=${b.policy.PWA_CACHE}#connect`));
  assert.ok(storage.stores.has(future));assert.ok(storage.stores.has(a.policy.PWA_CACHE));assert.ok(!storage.stores.has("ynx-wallet-web-v11"));
  assert.equal((await b.request("/app.js","cors","client-0")).status,503,"an old page awaiting reload must not receive modules from the new build");
  assert.equal((await b.request("/app.js","cors","new-page")).status,200);
  await b.request("/app.js");assert.ok(storage.stores.has(future));
});

test("an empty or malformed integrity map cannot activate a build",async()=>{
  const compiled=build("manifest");
  const malformed=await loadPwaWorker({workerSource:worker,policySource:compiled.files["service-worker-policy.js"].toString(),assetIntegrity:{},network:networkFor(compiled)});
  await assert.rejects(malformed.install(),/manifest is incomplete/);
  assert.equal(malformed.state.skipWaiting,0);
});

test("navigation version drift serves only the old verified shell while requesting an update",async()=>{
  const storage=memoryCacheStorage(),a=build("a"),b=build("b");
  const old=await load(a,{storage});await old.install();await old.activate();
  const running=await load(a,{storage,network:networkFor(b)});
  assert.equal(await (await running.request("/","navigate")).text(),a.files["index.html"].toString());
  assert.equal(running.state.updates,1);assert.equal(running.state.unregisters,0);assert.ok(storage.stores.has(old.policy.PWA_CACHE));
});

test("corrupt offline bytes fail closed without borrowing a different build",async()=>{
  const storage=memoryCacheStorage(),a=await load(build("a"),{storage}),b=build("b");await a.install();await a.activate();
  const next=await load(b,{storage});await next.install();await next.activate();
  const cache=await next.caches.open(next.policy.PWA_CACHE);await cache.put("./app.js",new Response("TAMPERED"));await cache.delete("./index.html");
  const offline=await load(b,{storage,network:async()=>{throw new Error("offline")}});
  assert.equal((await offline.request("/app.js")).status,503);assert.equal((await offline.request("/","navigate")).status,503);
  assert.ok(storage.stores.has(a.policy.PWA_CACHE));
});

test("an identical complete build is reused without network fetch or cache deletion",async()=>{
  const storage=memoryCacheStorage(),compiled=build("same"),first=await load(compiled,{storage});await first.install();await first.activate();
  const second=await load(compiled,{storage,network:async()=>{throw new Error("network must not run")}});
  await second.install();assert.equal(second.state.skipWaiting,1);assert.deepEqual(storage.deletions,[]);
});

test("offline readiness acknowledgement verifies every cached byte using the active worker manifest",async()=>{
  const current=await load(build("offline"));await current.install();await current.activate();
  let proof=await current.message("YNX_WALLET_PWA_VERIFY_CACHE");
  assert.equal(proof.cache,current.policy.PWA_CACHE);assert.equal(proof.complete,true);
  await (await current.caches.open(current.policy.PWA_CACHE)).put("./app.js",new Response("tampered"));
  proof=await current.message("YNX_WALLET_PWA_VERIFY_CACHE");assert.equal(proof.complete,false);
});

for(const [name,commit] of [["v8","2f55f7924"],["v11","27d00feb"]])test(`exact historical ${name} fetch cleanup cannot delete a new build during installation`,async()=>{
  const git=path=>execFileSync("git",["show",`${commit}:apps/wallet-web/${path}`],{encoding:"utf8"});
  const legacyWorker=git("public/sw.js"),legacyPolicy=git("src/service-worker-policy.js"),legacyIndex=git("public/index.html");
  const legacyAssets={"./index.html":digest(legacyIndex),"./app.js":digest("legacy script"),"./":digest(legacyIndex)};
  const storage=memoryCacheStorage(),legacy=await loadPwaWorker({workerSource:legacyWorker,policySource:legacyPolicy,assetIntegrity:legacyAssets,storage,network:async url=>new Response(url.endsWith("app.js")?"legacy script":legacyIndex)});
  assert.equal(legacy.policy.PWA_CACHE,`ynx-wallet-web-${name}`);
  await legacy.install();await legacy.activate();
  const compiled=build("next");let release,blocked;
  const blockedSignal=new Promise(resolve=>{blocked=resolve});
  const next=await load(compiled,{storage,network:async url=>{if(url.endsWith("app.js")){blocked();await new Promise(resolve=>{release=resolve})}return networkFor(compiled)(url)}});
  const installing=next.install();await blockedSignal;
  assert.ok(storage.stores.has(next.policy.PWA_CACHE));
  await legacy.request("/app.js");assert.ok(storage.stores.has(next.policy.PWA_CACHE));
  release();await installing;await next.activate();
  assert.equal(await (await next.request("/app.js")).text(),compiled.files["app.js"].toString());
});
