import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Evidence reconciliation only: reusedExistingBuilderEvidence, noSDKCalls,
// noGo and noSolc. Existing SDK material tests/actual-Go results are reused;
// this test never invokes prepare or hashes source/runtime/compiler materials.
// Test-only package input selection has no production override/fallback.
const selected=process.env.YNX_CONTRACT_REGISTRY_PACKAGE_ROOT;
assert.ok(selected===undefined||selected.length>0,'empty package root is not a default');
const packageRoot=realpathSync(selected===undefined?fileURLToPath(new URL('..',import.meta.url)):resolve(selected));
function inside(path){const actual=realpathSync(path);assert.ok(actual.startsWith(packageRoot+sep),'module escaped selected package');return actual;}
const packageJSON=inside(resolve(packageRoot,'package.json')),metadata=JSON.parse(readFileSync(packageJSON,'utf8'));
assert.equal(metadata.name,'@ynx-chain/wallet-auth');assert.ok(['1.3.0-pq.3.32-auth.9','1.3.0-pq.3.32-auth.10','1.3.0-pq.3.32-auth.11','1.3.0-pq.3.32-auth.12','1.3.0-pq.3.32-auth.13','1.3.0-pq.3.32-auth.14','1.3.0-pq.3.32-auth.15','1.3.0-pq.3.32-auth.16','1.3.0-pq.3.32-auth.17','1.3.0-pq.3.32-auth.18','1.3.0-pq.3.32-auth.19'].includes(metadata.version));
const selectedRequire=createRequire(packageJSON);
const entry=inside(selectedRequire.resolve('@ynx-chain/wallet-auth/pq-contract-deployment-material'));
// Byte equality binds the already verified implementation before module load.
assert.equal(hash(readFileSync(entry)),'03a3a5b1235adf03f75929abeddadab7c0fde54a5458f0d62e67f0c66d80a424');
assert.equal(hash(readFileSync(inside(resolve(packageRoot,'src/pq-contract-deployment-material.d.ts')))),'45031b2f0a002d95e28f4d640b4d16de4160cc0dce782756d8577107d02f434e');
const publicModule=await import(pathToFileURL(entry).href);
assert.equal(typeof publicModule.preparePQContractDeploymentMaterialData,'function');
// Original Protocol DATA: df4c9717c CI39993740334 producer25/upload26 PASS.
// No whole-job, production compiler or actual deployment claim.
const registryRaw=readFileSync(new URL('./fixtures/pq-contract-registry-go-df4c9717c.json',import.meta.url));
assert.equal(registryRaw.length,2285);assert.equal(hash(registryRaw),'307cfe8c0e6dc0f1513e56db2b3f1adfae87a2bb534de777c5d74facf1617d5b');
const registry=JSON.parse(registryRaw.toString('utf8'));
// Exact original 5d712dee8/39982960594 actual-Go log bytes. No reserialization,
// fixture regeneration, ABI algorithm duplication or earlier test execution.
const originalRaw=readFileSync(new URL('./fixtures/contract-deployment-fourth-go-5d712dee8.jsonl',import.meta.url));
assert.equal(originalRaw.length,3112);assert.equal(hash(originalRaw),'d34649cefc2b0fcd9ea006f1797e5b9115ccb47b8bdb236080587263a2a4b2d6');
const actualGo=originalRaw.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
test('selected public package preserves unchanged deployment-material export',()=>{assert.equal(typeof publicModule.preparePQContractDeploymentMaterialData,'function');});
test('new Go registry preserves bounded runtime and unavailable production compiler while reusing unchanged SDK evidence',()=>{
 assert.equal(registry.version,'YNX-PQ-CONTRACT-DEPLOYMENT-REGISTRY/v1');
 assert.equal(registry.runtimeMode,'pinned-artifact-bounded-evm-subset');
 assert.equal(registry.compiler.productionCompilerEnabled,false);
 assert.equal(registry.compiler.version,'0.8.24');assert.equal(registry.compiler.package,'hardhat/solc-wasm');assert.equal(registry.compiler.configPath,'hardhat.config.ts');assert.equal(registry.compiler.optimizerRuns,200);assert.equal(registry.compiler.preferWasm,true);assert.equal(registry.compiler.optimizerEnabled,true);
 assert.equal(registry.contracts.length,2);assert.equal(actualGo.length,2);assert.deepEqual(registry.contracts.map(c=>c.name).sort(),actualGo.map(c=>c.contractName).sort());
 for(const contract of registry.contracts)assert.deepEqual(Object.keys(contract).sort(),['name','sourceHash','deployedBytecodeHash','compilerConfigHash','creationBytecodeHash','rawABIHash'].sort());
});
test('new registry joins all five commitments to original exact actual-Go JSONL without SDK/Go/solc calls',()=>{
 for(const original of actualGo){
  const current=registry.contracts.find(c=>c.name===original.contractName);assert.ok(current);
  for(const field of ['sourceHash','deployedBytecodeHash','compilerConfigHash','creationBytecodeHash','rawABIHash'])assert.equal(current[field],original[field]);
  assert.equal(current.compilerConfigHash,registry.compiler.configHash);
  assert.equal(original.materialHandoffSHA256,'f4cd73d2580dabeefa441ac12d0279056caffb70ecf33923ee8abfe6e4042d22');
  assert.equal(original.syntheticFixture,true);assert.equal(original.goMaterialValidated,true);
  for(const key of ['signed','submitted','deployed','walletApproved','independentFinality'])assert.equal(original[key],false);
 }
});
