import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {compilePwaShell} from "../scripts/build.mjs";
import {createPwaUpgradeHarness,historicalPwaFixture} from "../scripts/pwa-upgrade-browser-harness.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");

test("browser fixture loads the exact historical v8 worker and complete source assets, not a cache seed",async()=>{
  const fixture=await historicalPwaFixture("2f55f7924");
  assert.equal(fixture.cache,"ynx-wallet-web-v8");
  assert.equal(fixture.workerSha256,sha(execFileSync("git",["show","2f55f7924:apps/wallet-web/public/sw.js"])));
  assert.equal(sha(fixture.files["index.html"]),"2df10866a35b074a6fb366439197646dd4e979bc83bdae3aba0ba6db3802986c");
  for(const [key,expected]of Object.entries(fixture.assetIntegrity))assert.equal(sha(fixture.files[key==="./"?"index.html":key.slice(2)]),expected,key);
  assert.ok(fixture.files["app.js"].length>10000);
});

test("browser server exposes exact candidate assets and deliberate failed/held update responses",async()=>{
  const candidate=compilePwaShell({"index.html":Buffer.from("<html><head></head><body>HTTP fixture</body></html>"),"app.js":Buffer.from("// fixture"),"styles.css":Buffer.from("body{}"),"service-worker-policy.js":await readFile(new URL("../src/service-worker-policy.js",import.meta.url))},await readFile(new URL("../public/sw.js",import.meta.url),"utf8"));
  const fixture=await createPwaUpgradeHarness({port:0,candidate}),base=fixture.url;
  const phase=next=>fetch(base+"__phase",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phase:next})});
  try{
    assert.equal((await fetch(base)).status,200);
    await phase("candidate-a");
    for(const [key,expected]of Object.entries(fixture.metadata().bundles["candidate-a"].assetIntegrity)){
      const response=await fetch(new URL(key,base+"wallet/"));assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),expected,key);
    }
    await phase("candidate-b-broken");assert.equal((await fetch(base+"wallet/app.js")).status,503);
    await phase("candidate-b-hold");
    const pending=fetch(base+"wallet/styles.css");
    for(let attempt=0;attempt<20&&!fixture.metadata().heldRequests;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(fixture.metadata().heldRequests,1);
    await fetch(base+"__release",{method:"POST"});const released=await pending;assert.equal(released.status,200);
    assert.equal(sha(Buffer.from(await released.arrayBuffer())),fixture.metadata().bundles["candidate-b"].assetIntegrity["./styles.css"]);
  }finally{await fixture.close()}
});
