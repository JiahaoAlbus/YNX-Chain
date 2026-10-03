import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,dirname} from "node:path";
import {verifyReleaseArtifacts} from "./verify-release-artifacts.mjs";

function fixture(t,change={}) {
  const root=mkdtempSync(resolve(tmpdir(),"card-artifact-qa-"));
  t.after(()=>rmSync(root,{recursive:true,force:true})); // Own temporary fixture only.
  const sourceCommit="a".repeat(40),sourceTree="b".repeat(40);
  const identity={productId:"ynx-card",sourceCommit,sourceTree,appVersion:"1.0.0",
    releaseChannel:"testnet-release",environment:"testnet",evmChainId:6423,evmChainHex:"0x1917",
    paymentNetwork:"simulation",productionRealPayments:false,...change};
  const files={"index.html":'<html lang="en"><title>YNX Card</title><script src="/_expo/static/js/web/index-qa.js"></script></html>',
    "runtime-identity.json":JSON.stringify(identity),"manifest.webmanifest":"{}","sw.js":"/* QA */",
    "pwa-register.js":"/* QA */","_expo/static/js/web/index-qa.js":"/* synthetic QA, no business authority */"};
  const receipt={schemaVersion:"ynx.card.release-artifacts.v1",sourceCommit,sourceTree,appVersion:"1.0.0",
    canonicalURL:"https://card.ynxweb4.com/",files:[]};
  for(const [path,content] of Object.entries(files)) {
    const target=resolve(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
    receipt.files.push({path,bytes:Buffer.byteLength(content),sha256:createHash("sha256").update(content).digest("hex")});
  }
  return {root,receipt};
}
test("exact parity never grants publication or public-business acceptance",t=>{
  const {root,receipt}=fixture(t), result=verifyReleaseArtifacts(root,receipt);
  assert.equal(result.filesVerified,6);assert.equal(result.publicationAuthorized,false);assert.equal(result.publicBusinessVerified,false);
});
test("old source cannot pass by changing only release version",t=>{
  const {root,receipt}=fixture(t,{sourceCommit:"c".repeat(40)});
  assert.throws(()=>verifyReleaseArtifacts(root,receipt),/identity mismatch/);
});
test("QA identity cannot replace a formal Testnet release",t=>{
  const {root,receipt}=fixture(t,{releaseChannel:"qa"});assert.throws(()=>verifyReleaseArtifacts(root,receipt),/QA/);
});
test("hash drift and unexpected helper are rejected",t=>{
  const {root,receipt}=fixture(t);writeFileSync(resolve(root,"sw.js"),"changed");
  assert.throws(()=>verifyReleaseArtifacts(root,receipt),/artifact mismatch/);
  writeFileSync(resolve(root,"sw.js"),"/* QA */");writeFileSync(resolve(root,"helper.html"),"helper");
  assert.throws(()=>verifyReleaseArtifacts(root,receipt),/unexpected artifact/);
});
test("missing PWA recovery asset cannot pass an incomplete inventory",t=>{
  const {root,receipt}=fixture(t);rmSync(resolve(root,"sw.js"));receipt.files=receipt.files.filter(file=>file.path!=="sw.js");
  assert.throws(()=>verifyReleaseArtifacts(root,receipt),/missing required/);
});
test("path escapes and duplicate entries fail closed",t=>{
  const {root,receipt}=fixture(t);receipt.files.push({...receipt.files[0],path:"../index.html"});
  assert.throws(()=>verifyReleaseArtifacts(root,receipt),/invalid or duplicate/);
  receipt.files.pop();receipt.files.push({...receipt.files[0]});assert.throws(()=>verifyReleaseArtifacts(root,receipt),/invalid or duplicate/);
});
test("identity cannot enable real payments",t=>{
  const {root,receipt}=fixture(t,{productionRealPayments:true});assert.throws(()=>verifyReleaseArtifacts(root,receipt),/identity mismatch/);
});
