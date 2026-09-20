import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../contract/public-endpoint-manifest.json';
import {validateFinanceConsumerContract} from './endpoint-manifest';
function copy(){return structuredClone(manifest) as Record<string,any>}
test('accepted Finance manifest is usable only before its exact expiry boundary',()=>{
  assert.equal(validateFinanceConsumerContract(copy(),Date.parse('2026-09-20T08:44:59.999Z')).manifestVersion,'1.0.0-p0.2');
  assert.throws(()=>validateFinanceConsumerContract(copy(),Date.parse('2026-09-20T08:45:00Z')),/CLIENT_RETIRED/);
});
test('Finance rejects malformed authority, wrong chain, endpoint, product and signer drift',()=>{
  const cases:[(value:Record<string,any>)=>void,RegExp][]=[
    [value=>{value.expiresAt=value.issuedAt},/authority window is malformed/],
    [value=>{value.evmChainHex='0x1'},/WRONG_CHAIN/],
    [value=>{value.sourceCommit='0'.repeat(40)},/ENDPOINT_MANIFEST_UNVERIFIED/],
    [value=>{value.integrity.payloadSha256='0'.repeat(64)},/ENDPOINT_MANIFEST_UNVERIFIED/],
    [value=>{value.evmRpc='https://rpc.invalid'},/accepted endpoint origins changed/],
    [value=>{value.endpointStates.products.finance.status='VERIFIED'},/must not activate/],
    [value=>{value.integrity.remoteSignature.failClosed=false},/remote replacement authority/],
  ];
  for(const [mutate,expected] of cases){const value=copy();mutate(value);assert.throws(()=>validateFinanceConsumerContract(value,Date.parse('2026-08-20T08:45:00Z')),expected)}
});
