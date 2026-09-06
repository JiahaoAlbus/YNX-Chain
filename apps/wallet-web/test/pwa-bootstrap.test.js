import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {MessageChannel} from "node:worker_threads";
import {obsoletePwaCaches,upgradeNavigationUrl} from "../src/service-worker-policy.js";

const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
const start=app.indexOf('const wait=(milliseconds)'),end=app.indexOf('if(!isExtension&&"serviceWorker" in navigator){',start);
const block=app.slice(start,end);
const A=`ynx-wallet-shell-build-${"a".repeat(64)}`,B=`ynx-wallet-shell-build-${"b".repeat(64)}`;
function harness({pageBuild=A,activeBuild=B,url="https://wallet.test/?lang=en#connect",complete=true,updateError=null,controllerPresent=true,onProof=null}={}){
  const navigations=[],document={documentElement:{dataset:{},inert:false}};
  const makeWorker=cache=>({state:"activated",postMessage(message,[port]){if(message.type==="YNX_WALLET_PWA_VERIFY_CACHE"){onProof?.(environment);port.postMessage({cache,complete})}else port.postMessage({cache})}});
  const registration={active:makeWorker(activeBuild),installing:null,waiting:null,async update(){if(updateError)throw updateError}};
  const environment={PWA_CACHE:pageBuild,initialPwaNavigationUrl:url,upgradeNavigationUrl,obsoletePwaCaches,MessageChannel,URL,Date,setTimeout,clearTimeout,document,location:{replace(target){navigations.push(target)}},navigator:{serviceWorker:{controller:controllerPresent?makeWorker(pageBuild):null,async register(){return registration},async getRegistration(){return registration}}},caches:{async keys(){return [pageBuild,B]}}};
  runInNewContext(block+'\nglobalThis.check={convergePwaServiceWorker,reloadForPwaBuild};',environment);
  return {environment,navigations,document,...environment.check};
}
test("old imported policy reloads to the newly activated build instead of waiting for an impossible old version",async()=>{
  const value=harness();assert.equal((await value.convergePwaServiceWorker()).reloading,true);
  assert.equal(value.navigations.length,1);assert.equal(value.navigations[0],`https://wallet.test/?lang=en&ynx-sw-upgrade=${B}#connect`);
  assert.equal(value.document.documentElement.inert,true);assert.equal(value.document.documentElement.dataset.pwa,"updating");
  value.reloadForPwaBuild(B);assert.equal(value.navigations.length,1);
});
test("a repeated mismatched build marker fails closed after one reload",async()=>{
  const value=harness({url:`https://wallet.test/?ynx-sw-upgrade=${B}`});
  await assert.rejects(value.convergePwaServiceWorker(),error=>error.code==="PWA_SERVICE_WORKER_BUILD_MISMATCH");
  assert.equal(value.navigations.length,0);
});
test("a current page remains ready with a distinct build cache present and preserves browser state",async()=>{
  const value=harness({activeBuild:A});
  assert.equal((await value.convergePwaServiceWorker()).reloading,false);assert.equal(value.navigations.length,0);
  assert.equal(value.document.documentElement.inert,false);
  assert.doesNotMatch(block,/localStorage|indexedDB|sessionStorage|\.clear\(/u);
});
test("update network failure preserves readiness only after exact controlled-cache verification",async()=>{
  const error=new Error("HTTP 503 during update"),value=harness({activeBuild:A,updateError:error});
  const result=await value.convergePwaServiceWorker();assert.equal(result.reloading,false);assert.equal(result.updateDeferred,true);
  assert.equal(value.navigations.length,0);assert.equal(value.document.documentElement.inert,false);
});
for(const [name,options]of [["partial cache",{complete:false,activeBuild:A}],["mixed active build",{activeBuild:B}],["first install without a controller",{controllerPresent:false,activeBuild:A}],["controller changes during verification",{activeBuild:A,onProof:environment=>{environment.navigator.serviceWorker.controller=null}}]])test(`update network failure cannot accept ${name}`,async()=>{
  const error=new Error("HTTP 503 during update"),value=harness({...options,updateError:error});
  await assert.rejects(value.convergePwaServiceWorker(),candidate=>candidate===error);
});
