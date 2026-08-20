import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const app=readFileSync(new URL("../web/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
const runtime=readFileSync(new URL("../web/runtime-config.js",import.meta.url),"utf8");
const release=JSON.parse(readFileSync(new URL("../product-release.json",import.meta.url),"utf8"));

test("AI consumes the accepted Standard Wallet SDK without fixture credentials",()=>{
  assert.match(app,/StandardWalletConnection/);
  assert.match(app,/discoverEIP6963/);
  assert.match(app,/ensureYNXTestnet/);
  assert.match(app,/0x1917/);
  assert.doesNotMatch(html,/Device Ed25519 public key|signed proof|Native account/);
});

test("YNX Wallet, MetaMask, official download and guest preview are explicit",()=>{
  for(const value of ["Connect YNX Wallet","Connect MetaMask","https://ynxweb4.com/dapp/download","Continue with guest preview"])assert.ok(html.includes(value));
  assert.match(app,/Private YNX AI Product Session is degraded; no local or canned session was created/);
  assert.match(app,/Guest preview · no account data loaded/);
});

test("runtime configuration is pinned to the accepted endpoint manifest",()=>{
  assert.match(runtime,/1\.0\.0-p0\.2/);
  assert.match(runtime,/3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5/);
  assert.match(runtime,/https:\/\/evm\.ynxweb4\.com/);
  assert.doesNotMatch(runtime,/localhost|127\.0\.0\.1|example\.com/);
});

test("current source truth is separated from the historical public runtime",()=>{
  assert.equal(release.truthScope,"historical_public_runtime_with_separate_current_source_checkpoint");
  assert.equal(release.currentSourceCheckpoint.commit,"e38d222131e89a924dcba13d4e2bd4a32cc0c536");
  assert.equal(release.currentSourceCheckpoint.standardWalletConnection,true);
  assert.equal(release.currentSourceCheckpoint.guestPreview,true);
  for(const field of ["productSessionV2","installedCurrentSource","integratedCentral","deployedStaging","deployedPublic","publicVerified","computerControlVerified","productionSigned","storeReleased","generationLive","historicalPublicRuntimeInherited"]){
    assert.equal(release.currentSourceCheckpoint[field],false,`${field} must remain false`);
  }
});
