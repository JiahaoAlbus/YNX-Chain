#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fail(message) { throw new Error(`public BFT public continuity rejected: ${message}`); }
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${path.basename(file)} is not valid JSON: ${error.message}`); }
}

function validate(root, commit, release, migrationHeight, migrationHash, maxLag) {
  if (!/^[0-9a-f]{12}$/.test(commit) || release !== `ynx-bft-gateway-${commit}`) fail("release identity is invalid");
  if (!Number.isSafeInteger(migrationHeight) || migrationHeight < 1 || !/^[0-9a-f]{64}$/.test(migrationHash)) fail("migration anchor is invalid");
  if (!Number.isSafeInteger(maxLag) || maxLag < 0 || maxLag > 20) fail("maximum lag is invalid");
  const serviceRelease = `ynx-chain-${commit}`;
  const before = readJSON(path.join(root, "gateway-before-health.json"));
  const after = readJSON(path.join(root, "gateway-after-health.json"));
  const status = readJSON(path.join(root, "gateway-status.json"));
  for (const value of [before, after]) {
    if (value.ok !== true || value.service !== "ynx-bft-gatewayd" || value.chainId !== 6423 || value.nativeSymbol !== "YNXT" || value.cometChainId !== "ynx_6423-1" || value.validatorCount !== 4 || value.publicCutoverReady !== true) fail("public Gateway identity/readiness mismatch");
    if (value.migrationHeight !== migrationHeight || value.migrationBlockHash !== migrationHash || value.build?.commit !== commit || value.build?.release !== release) fail("public Gateway build or migration anchor mismatch");
  }
  if (!Number.isSafeInteger(before.height) || !Number.isSafeInteger(after.height) || after.height <= before.height || after.height <= migrationHeight) fail("public BFT height did not grow beyond migration");
  if (status.chainId !== 6423 || status.nativeCurrencySymbol !== "YNXT" || status.consensusEngine !== "cometbft" || status.validatorCount !== 4 || status.publicCutoverReady !== true || status.migrationHeight !== migrationHeight || status.migrationBlockHash !== migrationHash) fail("public status mismatch");
  const evm = readJSON(path.join(root, "evm-chain-id.json"));
  if (evm.jsonrpc !== "2.0" || evm.result !== "0x1917") fail("public root-path EVM chain ID mismatch");
  const indexer = readJSON(path.join(root, "indexer-health.json"));
  if (indexer.ok !== true || indexer.service !== "ynx-indexerd" || indexer.chainId !== 6423 || indexer.nativeSymbol !== "YNXT" || indexer.lastError !== "" || indexer.build?.commit !== commit || indexer.build?.release !== serviceRelease) fail("public Indexer identity mismatch");
  if (!Number.isSafeInteger(indexer.lastIndexedHeight) || !Number.isSafeInteger(indexer.lastSourceHeight) || indexer.lastIndexedHeight < migrationHeight + 1 || indexer.lastSourceHeight < indexer.lastIndexedHeight || indexer.lastSourceHeight - indexer.lastIndexedHeight > maxLag) fail("public Indexer continuity or lag mismatch");
  const explorer = readJSON(path.join(root, "explorer-health.json"));
  if (explorer.ok !== true || explorer.service !== "ynx-explorerd" || explorer.network?.chainId !== 6423 || explorer.nativeSymbol !== "YNXT" || explorer.validatorCount !== 4 || explorer.indexerOk !== true || explorer.truthfulStatus !== "rpc-and-indexer-backed" || explorer.build?.commit !== commit || explorer.build?.release !== serviceRelease) fail("public Explorer identity mismatch");
  if (!Number.isSafeInteger(explorer.rpcHeight) || !Number.isSafeInteger(explorer.syncLagBlocks) || explorer.rpcHeight < after.height || explorer.syncLagBlocks < 0 || explorer.syncLagBlocks > maxLag) fail("public Explorer continuity or lag mismatch");
  const services = {};
  for (const name of ["faucet", "ai", "pay", "trust", "resource"]) {
    const value = readJSON(path.join(root, `${name}-health.json`));
    const address = value.signerAddress || value.faucetAddress || "";
    if (value.ok !== true || value.upstreamMode !== "bft" || !/^0x[0-9a-f]{40}$/.test(address) || value.build?.commit !== commit || value.build?.release !== serviceRelease) fail(`${name} public BFT identity mismatch`);
    services[name] = address;
  }
  const freeze = readJSON(path.join(root, "mutation-freeze.json"));
  if (freeze.httpStatus !== 503) fail("public mutations are not frozen during verification");
  return {schemaVersion:1,status:"passed",commit,release,migrationHeight,migrationBlockHash:migrationHash,heightBefore:before.height,heightAfter:after.height,indexedHeight:indexer.lastIndexedHeight,indexLag:indexer.lastSourceHeight-indexer.lastIndexedHeight,explorerLag:explorer.syncLagBlocks,validatorCount:4,publicIngressChanged:true,publicCutoverReady:true,mutationsStillFrozen:true,automaticRollbackRequired:true,services};
}

function writeFixture(root, commit, release, height, hash) {
  const gatewayBuild={commit,release,buildTime:"2026-07-13T00:00:00Z"};
  const serviceBuild={commit,release:`ynx-chain-${commit}`,buildTime:"2026-07-13T00:00:00Z"};
  const gateway=(h)=>({ok:true,service:"ynx-bft-gatewayd",chainId:6423,nativeSymbol:"YNXT",cometChainId:"ynx_6423-1",validatorCount:4,publicCutoverReady:true,migrationHeight:height,migrationBlockHash:hash,height:h,build:gatewayBuild});
  const files={
    "gateway-before-health.json":gateway(height+8),
    "gateway-after-health.json":gateway(height+10),
    "gateway-status.json":{chainId:6423,nativeCurrencySymbol:"YNXT",consensusEngine:"cometbft",validatorCount:4,publicCutoverReady:true,migrationHeight:height,migrationBlockHash:hash},
    "evm-chain-id.json":{jsonrpc:"2.0",id:1,result:"0x1917"},
    "indexer-health.json":{ok:true,service:"ynx-indexerd",chainId:6423,nativeSymbol:"YNXT",lastIndexedHeight:height+9,lastSourceHeight:height+10,lastError:"",build:serviceBuild},
    "explorer-health.json":{ok:true,service:"ynx-explorerd",network:{chainId:6423},nativeSymbol:"YNXT",validatorCount:4,indexerOk:true,truthfulStatus:"rpc-and-indexer-backed",rpcHeight:height+10,syncLagBlocks:1,build:serviceBuild},
    "mutation-freeze.json":{httpStatus:503},
  };
  for (const [index,name] of ["faucet","ai","pay","trust","resource"].entries()) files[`${name}-health.json`]={ok:true,upstreamMode:"bft",[name==="faucet"?"faucetAddress":"signerAddress"]:`0x${String(index+1).repeat(40)}`,build:serviceBuild};
  for (const [name,value] of Object.entries(files)) fs.writeFileSync(path.join(root,name),`${JSON.stringify(value)}\n`);
}

const args=process.argv.slice(2);
if (args[0] === "--self-test") {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ynx-public-bft-continuity-"));
  const commit="abcdef123456",release=`ynx-bft-gateway-${commit}`,height=100,hash="a".repeat(64);
  try {
    writeFixture(root,commit,release,height,hash);
    if (validate(root,commit,release,height,hash,3).status !== "passed") fail("valid fixture failed");
    const explorerPath=path.join(root,"explorer-health.json"),explorer=readJSON(explorerPath); explorer.syncLagBlocks=4; fs.writeFileSync(explorerPath,`${JSON.stringify(explorer)}\n`);
    let rejected=false; try { validate(root,commit,release,height,hash,3); } catch { rejected=true; }
    if (!rejected) fail("stale Explorer fixture passed");
    writeFixture(root,commit,release,height,hash);
    fs.writeFileSync(path.join(root,"mutation-freeze.json"),'{"httpStatus":200}\n');
    rejected=false; try { validate(root,commit,release,height,hash,3); } catch { rejected=true; }
    if (!rejected) fail("unfrozen public mutation fixture passed");
    console.log("public BFT public continuity self-test passed");
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
} else {
  const [root,commit,release,heightValue,hash,maxLagValue,output]=args;
  if (!root||!commit||!release||!heightValue||!hash||!maxLagValue||!output) fail("evidence root, identity, migration anchor, max lag, and output are required");
  const result=validate(path.resolve(root),commit,release,Number(heightValue),hash.toLowerCase().replace(/^0x/,""),Number(maxLagValue));
  fs.writeFileSync(output,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
  console.log(`public BFT public continuity passed: height=${result.heightAfter} indexLag=${result.indexLag} explorerLag=${result.explorerLag}`);
}
