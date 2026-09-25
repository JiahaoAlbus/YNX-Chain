import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const evidenceUrl=new URL("../evidence/runtime/firefox-branded-provider-20260920.json",import.meta.url);
const publicChannelsUrl=new URL("../public-channel-manifest.json",import.meta.url);

test("branded Firefox evidence binds the published artifact manifest",async()=>{
  const [evidence,manifest]=await Promise.all([
    readFile(evidenceUrl,"utf8").then(JSON.parse),
    readFile(publicChannelsUrl,"utf8").then(JSON.parse),
  ]);
  const artifact=manifest.channels.firefoxExtension;
  assert.ok(artifact,"published Firefox artifact is missing from the manifest");
  assert.equal(evidence.schemaVersion,"ynx.wallet.firefox-runtime-evidence.v1");
  assert.equal(evidence.artifact.sourceCommit,"c93e16be81beddc957ef5f27b7bbcdfa89c28db3");
  assert.equal(artifact.version,"0.1.1");
  assert.equal(artifact.sourceCommit,evidence.artifact.sourceCommit);
  assert.equal(evidence.artifact.bytes,artifact.bytes);
  assert.equal(evidence.artifact.sha256,artifact.sha256);
  assert.equal(artifact.url.includes(`/sha256-${artifact.sha256}/`),true);
  assert.equal(evidence.runtime.brandedMozillaFirefox,true);
  assert.equal(evidence.runtime.notarizedDeveloperIdVerified,true);
  assert.equal(evidence.temporaryAddonLifecycle.passed,true);
  assert.equal(evidence.provider.passed,true);
  assert.equal(evidence.provider.providerDiscoveryProved,true);
  assert.equal(evidence.provider.chainId,"0x1917");
  assert.equal(evidence.provider.rdns,"com.ynx.wallet");
  assert.equal(evidence.provider.isYNXWallet,true);
  assert.equal(evidence.provider.isMetaMask,false);
  assert.equal(evidence.provider.coexistenceProved,true);
  assert.equal(evidence.provider.browserCleanupPassed,true);
});

test("temporary Firefox proof cannot promote installation, signing, or transactions",async()=>{
  const evidence=JSON.parse(await readFile(evidenceUrl,"utf8"));
  assert.equal(evidence.provider.httpActionInjectionProved,false);
  assert.deepEqual(evidence.boundaries,{
    temporaryUnsignedAddon:true,
    installedLocal:false,
    accountAuthorized:false,
    messageSigned:false,
    transactionSubmitted:false,
    productionSigned:false,
    storeReleased:false,
  });
});
