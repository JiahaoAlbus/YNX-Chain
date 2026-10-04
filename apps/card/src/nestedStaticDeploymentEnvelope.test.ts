import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {createCardStaticEnvelope} from "../scripts/card-static-envelope.mjs";
import {cardCallbackKind} from "./providerCallback";

test("Card nested deployment envelope preserves a fixed dist-web Output Directory without source rebuild",()=>{
  const manifest=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")) as {scripts?:Record<string,unknown>};
  const build=readFileSync(new URL("../scripts/build-deployment-envelope.mjs",import.meta.url),"utf8");
  const verify=readFileSync(new URL("../scripts/verify-deployment-envelope.mjs",import.meta.url),"utf8");
  assert.equal(manifest.scripts?.["build:deployment-envelope"],"node scripts/build-deployment-envelope.mjs");
  assert.equal(manifest.scripts?.["verify:deployment-envelope"],"node scripts/verify-deployment-envelope.mjs");
  assert.match(build,/createCardStaticEnvelope\(root,source,envelope\)/);
  const temporary=mkdtempSync(resolve(tmpdir(),"ynx-card-nested-behavior-")),source=resolve(temporary,"static"),target=resolve(temporary,"envelope");
  mkdirSync(resolve(source,"assets"),{recursive:true});
  const identity={productId:"ynx-card",environment:"testnet",productionRealPayments:false,sourceCommit:"a".repeat(40),sourceTree:"b".repeat(40),cardApiCompatibility:{frontendSourceCommit:"a".repeat(40),frontendSourceTree:"b".repeat(40),backendSourceCommit:"c".repeat(40)}};
  writeFileSync(resolve(source,"runtime-identity.json"),JSON.stringify(identity));writeFileSync(resolve(source,"index.html"),"<h1>TEST fixture only</h1>");writeFileSync(resolve(source,"assets","fixture.css"),"body {color: blue}");
  createCardStaticEnvelope(fileURLToPath(new URL("../",import.meta.url)),source,target);
  for(const path of ["index.html","runtime-identity.json","assets/fixture.css"])assert.deepEqual(readFileSync(resolve(target,"dist-web",path)),readFileSync(resolve(source,path)));
  assert.equal(JSON.parse(readFileSync(resolve(target,"package.json"),"utf8")).scripts["build:web"],"node build-static.mjs");
  assert.match(execFileSync(process.execPath,["build-static.mjs"],{cwd:target,encoding:"utf8"}),/CARD_EXACT_STATIC_ENVELOPE_PASS/);
  writeFileSync(resolve(target,"dist-web","index.html"),"tampered fixture");
  assert.throws(()=>execFileSync(process.execPath,["build-static.mjs"],{cwd:target,stdio:"pipe"}));
  assert.throws(()=>createCardStaticEnvelope(fileURLToPath(new URL("../",import.meta.url)),source,target),/OUTPUT_EXISTS/);
  assert.match(verify,/Nested Vercel output does not contain the exact static file set/);
  assert.match(verify,/\["run","build:web"\]/);
});

test("Card Wallet callback rewrites once to the root SPA while retaining the callback URL and query for protocol parsing",()=>{
  const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8")) as {rewrites:Array<{source:string;destination:string}>};
  const verify=readFileSync(new URL("../scripts/verify-deployment-envelope.mjs",import.meta.url),"utf8");
  const callback=config.rewrites.find(rewrite=>rewrite.source==="/wallet-auth/callback");
  assert.deepEqual(callback,{source:"/wallet-auth/callback",destination:"/"});
  assert.notEqual(callback?.source,callback?.destination); // No self-rewrite loop.
  assert.match(verify,/source:"\/wallet-auth\/callback",destination:"\/"/);
  const request=new URL("https://card.ynxweb4.com/wallet-auth/callback?cardApplicationApprovalResult=synthetic-business-result");
  assert.equal(cardCallbackKind(request.href),"application");
  assert.equal(request.searchParams.get("cardApplicationApprovalResult"),"synthetic-business-result");
});
