import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"../..");
const release=path.join(root,"release/dex");
const sha256=(data)=>createHash("sha256").update(data).digest("hex");
const load=async(file)=>JSON.parse(await readFile(file,"utf8"));
const falseClaims=["installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased"];
const manifest=await load(path.join(release,"artifact-manifest.json"));

assert.equal(manifest.productId,"ynx-dex");
assert.equal(manifest.mainnet,false);assert.equal(manifest.audited,false);assert.equal(manifest.productionLiquidity,false);
assert.equal(manifest.claims.implementedLocal,true);assert.equal(manifest.claims.testedLocal,true);
for(const key of falseClaims)assert.equal(manifest.claims[key],false,`${key} must remain false without evidence`);
for(const artifact of manifest.artifacts){
  if(artifact.file){const data=await readFile(path.join(release,artifact.file));assert.equal(data.length,artifact.sizeBytes,`${artifact.file} size`);assert.equal(sha256(data),artifact.sha256,`${artifact.file} digest`)}
  if(artifact.files)for(const file of artifact.files){const data=await readFile(path.join(root,file.path));assert.equal(data.length,file.sizeBytes,`${file.path} size`);assert.equal(sha256(data),file.sha256,`${file.path} digest`)}
}

const web=await load(path.join(release,"web-pwa-artifact.json"));
const webData=await readFile(path.join(release,web.file));assert.equal(sha256(webData),web.sha256);
for(const key of ["installedLocal","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased"])assert.equal(web[key],false,key);
assert.equal(web.publicWebDeployed,true);assert.equal(web.publicTransactionRuntimeDeployed,false);
assert.equal(web.publicDeployment.url,"https://dex.ynxweb4.com/");
assert.equal(web.publicDeployment.sourceCommit,"255c44609ee135c126b01a39156952667ee5eb8d");

const product=await load(path.join(root,"product-release.json"));
const aggregate=await readFile(path.join(release,"artifact-manifest.json"));
assert.equal(product.commit,manifest.sourceBaseCommit);assert.equal(product.runtimeCommit,product.commit);
assert.equal(product.implementedLocal,true);assert.equal(product.testedLocal,true);
assert.equal(product.recoveredCandidate?.implementedLocal,true);assert.equal(product.recoveredCandidate?.testedLocal,true);
assert.equal(product.localComponents?.consensusDexV13?.sourceCommit,product.commit);assert.equal(product.localComponents?.consensusDexV13?.testedLocal,true);
for(const component of ["strategyVault","executionAdapter","vaultIndexer","indexerRecovery","fairFlow","lpProtection","stableSwap"]){assert.equal(product.localComponents?.[component]?.sourceCommit,product.commit);assert.equal(product.localComponents?.[component]?.testedLocal,true);assert.equal(product.localComponents?.[component]?.deployedPublic,false)}
assert.equal(product.localComponents.indexerRecovery.restoreVerified,true);assert.equal(product.localComponents.indexerRecovery.operationalRpoVerified,false);
for(const key of falseClaims)assert.equal(product[key],false,key);
assert.equal(product.publicWebDeployed,true);assert.equal(product.publicTransactionRuntimeDeployed,false);
assert.equal(product.sha256.artifactManifest,sha256(aggregate));assert.equal(product.bytes.artifactManifest,aggregate.length);
assert.equal(product.sha256.webPwaBundle,web.sha256);assert.equal(product.bytes.webPwaBundle,web.sizeBytes);
const sdk=manifest.artifacts.find(item=>item.type==="javascript-sdk-npm-package");assert(sdk);assert.equal(product.sha256.javascriptSdkPackage,sdk.sha256);assert.equal(product.bytes.javascriptSdkPackage,sdk.sizeBytes);
const contracts=manifest.artifacts.find(item=>item.type==="contract-source-and-build-manifest");
for(const file of ["contracts/dex/YNXFairFlow.sol","artifacts/contracts/dex/YNXFairFlow.sol/YNXFairFlow.json","contracts/dex/YNXLPProtection.sol","artifacts/contracts/dex/YNXLPProtection.sol/YNXLPProtection.json","contracts/dex/YNXProtectedDexFactory.sol","artifacts/contracts/dex/YNXProtectedDexFactory.sol/YNXProtectedDexFactory.json","contracts/dex/YNXStableFactory.sol","artifacts/contracts/dex/YNXStableFactory.sol/YNXStableFactory.json","contracts/dex/YNXStablePool.sol","artifacts/contracts/dex/YNXStablePool.sol/YNXStablePool.json"])assert(contracts?.files.some(item=>item.path===file),`missing ${file}`);
console.log("YNX DEX artifacts: PASS");
