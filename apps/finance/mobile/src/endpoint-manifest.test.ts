import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {bundledEndpointAuthority,canonicalEndpointAuthorityPayload} from '@ynx-chain/sdk';
import {assertFinanceProductSessionContract,financeEndpointAuthorityPin,financeNetworkEndpoints,validateFinanceConsumerContract} from './endpoint-manifest';
import {assertFinanceAuthorityV2NativeCapabilities} from './endpoint-authority-capabilities';

const digest=async(payload:string)=>bytesToHex(sha256(new TextEncoder().encode(payload)));
const copy=()=>structuredClone(bundledEndpointAuthority) as Record<string,any>;
test('Finance consumes the exact shared 1.1.0 authority and current independent pin',async()=>{
  const authority=await validateFinanceConsumerContract(copy(),Date.parse('2026-09-20T08:55:00.000Z'),digest);
  assert.equal(authority.manifestVersion,financeEndpointAuthorityPin.manifestVersion);
  assert.equal(await digest(canonicalEndpointAuthorityPayload(authority)),financeEndpointAuthorityPin.payloadSha256);
  assert.deepEqual(await financeNetworkEndpoints(Date.parse('2026-09-20T08:55:00.000Z')),{rpc:'https://rpc-testnet.ynxweb4.com',evmRpc:'https://rpc-testnet.ynxweb4.com',faucet:'https://faucet-testnet.ynxweb4.com'});
});
test('authority time boundaries and payload tampering fail closed',async()=>{
  await assert.rejects(()=>validateFinanceConsumerContract(copy(),Date.parse('2026-09-20T08:54:59.999Z'),digest),/AUTHORITY_NOT_YET_VALID/);
  await assert.rejects(()=>validateFinanceConsumerContract(copy(),Date.parse('2026-09-27T08:55:00.000Z'),digest),/AUTHORITY_EXPIRED/);
  const tampered=copy();tampered.rpc='https://rpc.ynxweb4.com';
  await assert.rejects(()=>validateFinanceConsumerContract(tampered,Date.parse('2026-09-20T09:00:00.000Z'),digest),/AUTHORITY_ENDPOINT_ALLOWLIST|AUTHORITY_HASH_MISMATCH/);
});
test('RPC/Faucet renewal never promotes pending Finance private services',async()=>{
  await assert.rejects(()=>assertFinanceProductSessionContract(Date.parse('2026-09-20T09:00:00.000Z')),/PRIVATE_SERVICE_DEGRADED.*PENDING/);
  const promoted=copy();promoted.endpointStates.products.finance.status='VERIFIED';
  await assert.rejects(()=>validateFinanceConsumerContract(promoted,Date.parse('2026-09-20T09:00:00.000Z'),digest),/AUTHORITY_PRODUCT_PROMOTION|AUTHORITY_HASH_MISMATCH/);
});
test('native v2 refuses missing or unreviewed Ed25519, CAS and trusted clock capabilities',()=>{
  assert.throws(()=>assertFinanceAuthorityV2NativeCapabilities(undefined),/Ed25519,durable-CAS,trusted-clock/);
  assert.throws(()=>assertFinanceAuthorityV2NativeCapabilities({verifyEd25519:async()=>true,durableCompareAndSwap:async()=>true,trustedClockMs:()=>Date.now()}),/adapter-not-reviewed/);
});
