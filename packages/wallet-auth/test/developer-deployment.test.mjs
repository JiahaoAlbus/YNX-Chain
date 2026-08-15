import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createDeveloperDeploymentCallback, createDeveloperDeploymentDeepLink, developerArtifactDigest,
  developerDeploymentRequestHash, parseDeveloperDeploymentDeepLink, parseDeveloperDeploymentResponse,
  signDeveloperDeployment, walletIdentity,
} from "../src/index.js";

const NOW = new Date("2026-08-10T02:00:00.000Z");
const SECRET = "0000000000000000000000000000000000000000000000000000000000000065";

function request(overrides = {}) {
  const source = readFileSync(new URL("../../../contracts/devtools/SampleEVMWriteCounter.sol", import.meta.url), "utf8").trim();
  const artifact = JSON.parse(readFileSync(new URL("../../../artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json", import.meta.url), "utf8"));
  const base = { name:"SampleEVMWriteCounter", source, deployedBytecode:artifact.deployedBytecode.toLowerCase(), constructorArgs:["7"], idempotencyKey:"developer-deploy-vector-1" };
  const payload = { ...base, requestHash:developerDeploymentRequestHash(base) }, artifactDigest = developerArtifactDigest(payload);
  return { version:"1",chainId:6423,productClientId:"ynx-developer-v1",bundleId:"com.ynxweb4.developer.testnetpreview",callback:"ynxdeveloper://deployment/callback",sessionBinding:"a".repeat(64),account:walletIdentity(SECRET).account,nonce:1,action:"ide_contract_deploy",payload,artifactDigest,simulation:{chainId:6423,blockNumber:900000,gasEstimate:"21000",gasPriceWei:"1",maxFeeWei:"21000",compilerVersion:"0.8.24",artifactDigest,source:"https://rpc.ynxweb4.com/",asOf:NOW.toISOString()},issuedAt:NOW.toISOString(),expiresAt:"2026-08-10T02:05:00.000Z",...overrides };
}

test("Developer deployment deep link signs the exact canonical YNX application transaction",()=>{
  const expected=request(),parsed=parseDeveloperDeploymentDeepLink(createDeveloperDeploymentDeepLink(expected,NOW),NOW),signed=signDeveloperDeployment(parsed,{accountSecret:SECRET,account:expected.account},NOW),verified=parseDeveloperDeploymentResponse(signed,expected,NOW),callback=createDeveloperDeploymentCallback(signed,expected,NOW);
  assert.equal(verified.signedTransaction.action,"ide_contract_deploy");
  assert.equal(verified.signedTransaction.fee,1);
  assert.equal(verified.signedTransaction.payload.requestHash,expected.payload.requestHash);
  assert.match(verified.signedTransaction.signature,/^[0-9a-f]{136,144}$/);
  assert.match(verified.transactionHash,/^0x[0-9a-f]{64}$/);
  assert.match(callback,/^ynxdeveloper:\/\/deployment\/callback\?response=/);
  const root=fileURLToPath(new URL("../../../",import.meta.url)),go=spawnSync("go",["run","./scripts/fixtures/verify-developer-wallet-deploy"],{cwd:root,input:JSON.stringify({canonicalPayloadHex:verified.canonicalPayloadHex,transactionHash:verified.transactionHash}),encoding:"utf8",maxBuffer:1024*1024});
  assert.equal(go.status,0,go.stderr);
  assert.match(go.stdout,/ide_contract_deploy 0x[0-9a-f]{64} 1/);
});

test("Developer deployment rejects session, artifact, simulation, route and signature substitution",()=>{
  const expected=request(),signed=signDeveloperDeployment(expected,{accountSecret:SECRET},NOW);
  assert.throws(()=>createDeveloperDeploymentDeepLink({...expected,sessionBinding:"b"},NOW),/sessionBinding/);
  assert.throws(()=>createDeveloperDeploymentDeepLink({...expected,artifactDigest:"b".repeat(64)},NOW),/artifact/);
  assert.throws(()=>createDeveloperDeploymentDeepLink({...expected,simulation:{...expected.simulation,chainId:1}},NOW),/chain/);
  assert.throws(()=>parseDeveloperDeploymentDeepLink(createDeveloperDeploymentDeepLink(expected,NOW).replace("developer-deploy","authorize"),NOW),/route/);
  assert.throws(()=>parseDeveloperDeploymentResponse({...signed,transactionHash:`0x${"0".repeat(64)}`},expected,NOW),/hash|encoding/);
  assert.throws(()=>parseDeveloperDeploymentResponse({...signed,signedTransaction:{...signed.signedTransaction,signature:`${signed.signedTransaction.signature.slice(0,-2)}00`}},expected,NOW),/signature|encoding|hash/);
});
