import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../contract/public-endpoint-manifest.json';
import {validateFinanceConsumerContract} from './endpoint-manifest';

function copy(){return structuredClone(manifest) as Record<string,any>}

test('accepted Finance manifest is usable only before its exact expiry boundary',()=>{
  assert.equal(validateFinanceConsumerContract(copy(),Date.parse('2026-09-20T08:44:59.999Z')).manifestVersion,'1.0.0-p0.2');
  assert.throws(()=>validateFinanceConsumerContract(copy(),Date.parse('2026-09-20T08:45:00Z')),/CLIENT_RETIRED/);
  assert.throws(()=>validateFinanceConsumerContract(copy(),Date.parse('2026-09-21T00:00:00Z')),/CLIENT_RETIRED/);
});

test('Finance rejects malformed authority windows and a wrong chain',()=>{
  const malformed=copy();malformed.expiresAt=malformed.issuedAt;
  assert.throws(()=>validateFinanceConsumerContract(malformed,Date.parse('2026-08-20T08:45:00Z')),/authority window is malformed/);
  const wrongChain=copy();wrongChain.evmChainHex='0x1';
  assert.throws(()=>validateFinanceConsumerContract(wrongChain,Date.parse('2026-08-20T08:45:00Z')),/WRONG_CHAIN/);
});

test('Finance rejects source, hash, endpoint, product activation and signer-policy drift',()=>{
  const cases:[(value:Record<string,any>)=>void,RegExp][]=[
    [value=>{value.sourceCommit='0'.repeat(40)},/ENDPOINT_MANIFEST_UNVERIFIED/],
    [value=>{value.integrity.payloadSha256='0'.repeat(64)},/ENDPOINT_MANIFEST_UNVERIFIED/],
    [value=>{value.evmRpc='https://rpc.invalid'},/accepted endpoint origins changed/],
    [value=>{value.endpointStates.products.finance.status='VERIFIED'},/must not activate/],
    [value=>{value.integrity.remoteSignature.status='VERIFIED'},/remote replacement authority/],
    [value=>{value.integrity.remoteSignature.failClosed=false},/remote replacement authority/],
  ];
  for(const [mutate,expected] of cases){const value=copy();mutate(value);assert.throws(()=>validateFinanceConsumerContract(value,Date.parse('2026-08-20T08:45:00Z')),expected)}
});
