import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedSoliditySnapshot, sourceDigest } from '../src/solidity-snapshot.mjs';
import { createSolidityCompiler } from '../src/solidity-compiler.mjs';
import { compilerReadiness } from '../../../scripts/compiler-pin.mjs';
const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const projectSource = { protocol:'ynx-solidity-project/v1', sessionId, entryPath:'contracts/PinCheck.sol', sources:Object.fromEntries(Object.entries({
  'contracts/PinCheck.sol':'// SPDX-License-Identifier: MIT\npragma solidity 0.8.24; import "./lib/Math.sol"; contract PinCheck { function ping() external pure returns(uint256) { return Math.value(); } }',
  'contracts/lib/Math.sol':'// SPDX-License-Identifier: MIT\npragma solidity 0.8.24; library Math { function value() internal pure returns(uint256) { return 3; } }',
}).map(([path, content]) => [path,{content,sha256:sourceDigest(content),documentVersion:2}])) };
test('real compiler resolves relative imports only from the source-bound project snapshot', async t => {
  if (!compilerReadiness().available) return t.skip('Supply the reviewed compiler input.');
  const result = await createSolidityCompiler().compile({owner:'owner-A',name:'PinCheck',snapshot:projectSource,sessionId});
  assert.equal(result.ok,true); assert.equal(result.sourceName,projectSource.entryPath);
  assert.equal(Object.keys(result.sourceDigests).length,2); assert.equal(result.sourceDigests[projectSource.entryPath],projectSource.sources[projectSource.entryPath].sha256);
  assert.ok(result.abi.some(item=>item.name==='ping')); assert.match(result.bytecode,/^0x[0-9a-f]+$/);
  const missing=structuredClone(projectSource); delete missing.sources['contracts/lib/Math.sol'];
  const failed=await createSolidityCompiler().compile({owner:'owner-A',name:'PinCheck',snapshot:missing,sessionId});
  assert.equal(failed.ok,false); assert.equal(failed.status,422); assert.equal(failed.bytecode,undefined);
  assert.ok(failed.diagnostics.some(item=>/not found/.test(item.message)));
});
test('snapshot cannot select another session, escape paths, change a digest, or smuggle execution settings', () => {
  const variations=[value=>value.sessionId='other-session',value=>value.entryPath='../Outside.sol',value=>value.sources['/etc/Outside.sol']=value.sources[value.entryPath],value=>value.sources[value.entryPath].content+=' changed',value=>value.settings={optimizer:false},value=>value.sources[value.entryPath].documentVersion=-1,value=>value.sources['https://host/Remote.sol']=value.sources[value.entryPath]];
  for(const mutate of variations){const value=structuredClone(projectSource);mutate(value);assert.throws(()=>reviewedSoliditySnapshot(value,sessionId),error=>error.code==='compiler_snapshot');}
});
test('per-file, aggregate and file-count limits are measured before worker dispatch', () => {
  const make=(count,size)=>({protocol:'ynx-solidity-project/v1',sessionId,entryPath:'0.sol',sources:Object.fromEntries(Array.from({length:count},(_,i)=>{const content='x'.repeat(size);return[`${i}.sol`,{content,sha256:sourceDigest(content),documentVersion:1}];}))});
  for(const value of [make(1,65537),make(5,65536),make(33,1)])assert.throws(()=>reviewedSoliditySnapshot(value,sessionId),error=>error.code==='compiler_snapshot');
  assert.equal(reviewedSoliditySnapshot(make(4,65536),sessionId).sourceBytes,262144);
});
