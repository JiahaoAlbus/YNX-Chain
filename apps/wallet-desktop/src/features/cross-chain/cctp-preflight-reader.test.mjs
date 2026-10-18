import test from 'node:test';
import assert from 'node:assert/strict';
import {EVMAdapter} from '../../multichain-evm.mjs';
import {CctpReader} from './cctp-reader.mjs';
import {ROUTE} from './cctp-wire.mjs';

const network = {chainId: '0xaa36a7', genesis: '0x' + 'a1'.repeat(32), rpcUrl: 'https://controlled.example.org'};
const unverified = errorCode => ({status: 'unverified', stage: 'rpc-identity', errorCode});
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}};

test('preflight reuses actual EVM chain and genesis verification without contract, fee or balance reads', async () => {
  const calls = [];
  const evm = new EVMAdapter({rpc: async (url, method, params) => {
    assert.equal(url, network.rpcUrl); calls.push([method, params]);
    if (method === 'eth_chainId') return network.chainId;
    if (method === 'eth_getBlockByNumber') return {hash: network.genesis};
    assert.fail('Preflight must not make any other RPC request');
  }});
  const reader = new CctpReader({evm, fetchImpl: () => assert.fail('Preflight must not query Circle fees')});
  assert.deepEqual(await reader.preflightNetwork(network, ROUTE.source), {status: 'verified', stage: 'rpc-identity', errorCode: null});
  assert.deepEqual(calls, [['eth_chainId', []], ['eth_getBlockByNumber', ['0x0', false]]]);
});

test('preflight returns only closed mismatch/error codes, never RPC error text or URLs', async () => {
  const reader = new CctpReader({evm: new EVMAdapter({rpc: async (_url, method) => method === 'eth_chainId' ? '0x1' : {hash: network.genesis}})});
  assert.deepEqual(await reader.preflightNetwork(network, ROUTE.source), unverified('MULTICHAIN_NETWORK_MISMATCH'));
  assert.deepEqual(await reader.preflightNetwork({...network, chainId: '0x1'}, ROUTE.source), unverified('CCTP_NETWORK_MISMATCH'));
  for (const code of ['MULTICHAIN_NETWORK_MISMATCH', 'MULTICHAIN_RPC_TIMEOUT', 'MULTICHAIN_RPC_ERROR', 'CCTP_NETWORK_MISMATCH', 'CCTP_PREFLIGHT_TIMEOUT', 4444, 'provider-specific-error', undefined]) {
    const failing = new CctpReader({evm: {verify: async () => {throw Object.assign(new Error('sensitive provider text https://private.invalid/?secret=not-real'), {code})}}});
    const expected = ['MULTICHAIN_NETWORK_MISMATCH', 'MULTICHAIN_RPC_TIMEOUT', 'MULTICHAIN_RPC_ERROR', 'CCTP_NETWORK_MISMATCH', 'CCTP_PREFLIGHT_TIMEOUT'].includes(code) ? code : 'CCTP_PREFLIGHT_UNAVAILABLE';
    const result = await failing.preflightNetwork(network, ROUTE.source);
    assert.deepEqual(result, unverified(expected));
    assert.equal(JSON.stringify(result).includes('private.invalid'), false);
  }
});

test('25 second overall identity deadline returns once and ignores late success', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const gate = deferred(); let calls = 0, published = 0;
  const reader = new CctpReader({evm: {verify: async () => {calls++; await gate.promise; return true}}});
  const pending = reader.preflightNetwork(network, ROUTE.source).then(result => {published++; return result});
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(calls, 1); t.mock.timers.tick(24999);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(published, 0);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.deepEqual(result, unverified('CCTP_PREFLIGHT_TIMEOUT'));
  gate.resolve(); for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(published, 1); assert.deepEqual(result, unverified('CCTP_PREFLIGHT_TIMEOUT'));
});

test('late identity rejection after deadline is consumed without retry or a second result', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const gate = deferred(); let calls = 0;
  const reader = new CctpReader({evm: {verify: async () => {calls++; return gate.promise}}});
  const pending = reader.preflightNetwork(network, ROUTE.source);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(25000);
  assert.deepEqual(await pending, unverified('CCTP_PREFLIGHT_TIMEOUT'));
  gate.reject(Object.assign(Error('late raw provider text'), {code: 4444}));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(calls, 1);
});
