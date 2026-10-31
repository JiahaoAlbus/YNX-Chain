import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CctpFlow, CctpStore } from './cctp-flow.mjs';
import { CctpReader } from './cctp-reader.mjs';
import { ROUTE } from './cctp-wire.mjs';
import { MultichainService } from '../../multichain-service.mjs';
import { validateNetwork } from '../../multichain-config.mjs';

const ACCOUNT = `0x${'11'.repeat(20)}`, RECIPIENT = `0x${'22'.repeat(20)}`;
const SOURCE_HASH = `0x${'bb'.repeat(32)}`, MINT_HASH = `0x${'cc'.repeat(32)}`, NONCE = `0x${'dd'.repeat(32)}`;
const copy = value => structuredClone(value);
const code = expected => error => error?.code === expected;
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const padded = value => `0x${value.slice(2).padStart(64, '0').toLowerCase()}`;

function message(binding, expiry, nonce = NONCE, source = false) {
  const bytes = Buffer.alloc(376), word = (offset, value, size = 32) => Buffer.from(BigInt(value).toString(16).padStart(size * 2, '0'), 'hex').copy(bytes, offset);
  word(0, 1, 4); word(4, 0, 4); word(8, 6, 4); word(12, source ? 0 : nonce);
  word(44, ROUTE.source.tokenMessenger); word(76, ROUTE.destination.tokenMessenger); word(108, ACCOUNT);
  word(140, 2000, 4); word(144, source ? 0 : 2000, 4); word(148, 1, 4);
  word(152, ROUTE.source.usdc); word(184, RECIPIENT); word(216, binding.amountUnits); word(248, ACCOUNT); word(280, binding.maxFeeUnits); word(344, source ? 0 : expiry);
  return `0x${bytes.toString('hex')}`;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-cctp-proof-refresh-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const networks = [ROUTE.source, ROUTE.destination].map((route, i) => validateNetwork({ name: route.name, chainId: String(route.chainId), rpcUrl: `https://controlled-refresh-${i}.example.org/`, symbol: 'ETH', decimals: 18, genesis: `0x${String(i + 1).repeat(64)}` }));
  const state = { identity: { account: ACCOUNT, revision: 1, locked: false }, config: { version: 1, revision: 1, selected: networks[0].id, networks, tokens: [] }, mode: 'complete', hold: null, observed: 'included' };
  const calls = { requests: [], original: [], writes: [], destination: [] };
  const forbidden = name => () => { calls.writes.push(name); throw new Error(`Proof refresh cannot invoke ${name}`); };
  const wallet = new MultichainService({ config: { read: async () => copy(state.config) }, getContext: async () => copy(state.identity), withSecret: forbidden('custody'), adapter: {}, journal: {} });
  wallet.prepareCctpStep = forbidden('prepare'); wallet.send = forbidden('send'); wallet.cancel = forbidden('cancel');
  const now = 1800000000000, context = await wallet.context();
  const binding = { routeId: ROUTE.id, account: ACCOUNT, recipient: RECIPIENT, amountUnits: '1000000', maxFeeUnits: '0', maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000', sourceNetwork: networks[0], destinationNetwork: networks[1], context, configRevision: 1, expiresAt: now + 120000, quoteId: randomUUID() };
  const proof = (expiry, nonce = NONCE) => ({ sourceTxHash: SOURCE_HASH, nonce, message: message(binding, expiry, nonce), attestation: `0x${'12'.repeat(65)}`, amountReceived: '1000000', feeExecuted: '0' });
  const expired = proof(90), refreshed = proof(200);
  const record = { id: randomUUID(), revision: 0, binding, state: 'mint-ready', operations: [{ step: 'burn', id: randomUUID(), state: 'included', hash: SOURCE_HASH }], proof: expired, destination: null, firstError: null, createdAt: now, updatedAt: now };
  const filePath = join(directory, 'cross-chain.json'), store = new CctpStore({ filePath }); await store.insert(record);
  wallet.checkCctpStep = async input => { calls.original.push(copy(input)); return { id: input.id, state: state.observed, hash: input.id === record.operations[0].id ? SOURCE_HASH : MINT_HASH }; };
  const reader = new CctpReader({
    evm: { verify: async () => true, call: async (_network, method) => { assert.equal(method, 'eth_blockNumber'); return '0x64'; } },
    fetchImpl: async (url, options) => {
      calls.requests.push({ url, method: options.method });
      if (state.hold) { state.hold.entered.resolve(); await state.hold.release.promise; }
      if (state.mode === 'error') throw new Error('Controlled unavailable Circle response');
      if (state.mode === 'pending') return new Response('', { status: 404 });
      const next = state.mode === 'nonce-mismatch' ? proof(200, `0x${'ee'.repeat(32)}`) : refreshed;
      return new Response(JSON.stringify({ sourceTxHash: SOURCE_HASH, messages: [{ ...next, eventNonce: next.nonce, cctpVersion: 2, status: 'complete' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  // The source inclusion/events are controlled verified observations. The actual
  // reader still enforces intent/nonce/expiry and performs its real bounded GET
  // response decoding; the scope here is whether flow re-queries that reader.
  reader.receipt = async () => ({ status: '0x1' });
  reader.events = (_receipt, _contract, _abi, name) => name === 'MessageSent' ? [{ message: message(binding, 0, NONCE, true) }] : [{ burnToken: ROUTE.source.usdc, amount: 1000000n, depositor: ACCOUNT, mintRecipient: padded(RECIPIENT), destinationDomain: 6n, destinationTokenMessenger: padded(ROUTE.destination.tokenMessenger), destinationCaller: padded(ACCOUNT), maxFee: 0n, minFinalityThreshold: 2000n, hookData: '0x' }];
  reader.destination = async input => { calls.destination.push(copy(input)); return { state: 'pending' }; };
  const flow = new CctpFlow({ wallet, reader, store: new CctpStore({ filePath }), now: () => now, id: forbidden('id-allocation') });
  return { state, calls, store, flow, record, expired, refreshed };
}

test('cold recovery refreshes cached expired proof through the original hash GET while preserving nonce and operation history', async t => {
  const h = await fixture(t), result = await h.flow.check(h.record.id);
  assert.equal(result.state, 'mint-ready');
  assert.deepEqual(result.proof, h.refreshed);
  assert.equal(result.proof.sourceTxHash, SOURCE_HASH); assert.equal(result.proof.nonce, NONCE);
  assert.deepEqual(result.operations, h.record.operations);
  assert.deepEqual(h.calls.requests, [{ url: `https://iris-api-sandbox.circle.com/v2/messages/0?transactionHash=${SOURCE_HASH}`, method: 'GET' }]);
  assert.deepEqual((await h.store.get(h.record.id)).proof, h.refreshed);
  assert.deepEqual(h.calls.writes, []);
});

for (const mode of ['pending', 'error']) test(`a ${mode} refreshed proof preserves cached evidence but leaves the original transfer query-only`, async t => {
  const h = await fixture(t); h.state.mode = mode;
  if (mode === 'error') await assert.rejects(h.flow.check(h.record.id), code('CCTP_HTTP_UNAVAILABLE'));
  else assert.equal((await h.flow.check(h.record.id)).state, 'attestation-pending');
  const saved = await h.store.get(h.record.id);
  assert.equal(saved.state, 'attestation-pending'); assert.deepEqual(saved.proof, h.expired); assert.deepEqual(saved.operations, h.record.operations);
  await assert.rejects(h.flow.prepareStep(h.record.id), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.requests.length, 1); assert.deepEqual(h.calls.writes, []);
});

test('a different refreshed nonce cannot replace the original claim or cached evidence', async t => {
  const h = await fixture(t); h.state.mode = 'nonce-mismatch';
  await assert.rejects(h.flow.check(h.record.id), code('CCTP_RESULT_MISMATCH'));
  const saved = await h.store.get(h.record.id);
  assert.equal(saved.state, 'attestation-pending'); assert.deepEqual(saved.proof, h.expired); assert.deepEqual(saved.operations, h.record.operations);
  assert.deepEqual(h.calls.writes, []);
});

for (const observed of ['signed', 'unknown', 'review']) test(`an existing ${observed} mint never refreshes or substitutes the proof bound to that original operation`, async t => {
  const h = await fixture(t), mint = { step: 'mint', id: randomUUID(), state: observed === 'review' ? 'review' : 'unknown', hash: observed === 'review' ? null : MINT_HASH };
  await h.store.update(h.record.id, h.record.revision, value => { value.operations.push(mint); value.state = observed === 'review' ? 'mint-ready' : 'mint-pending'; });
  h.state.observed = observed;
  const result = await h.flow.check(h.record.id);
  assert.deepEqual(result.proof, h.expired); assert.equal(result.operations.at(-1).id, mint.id);
  assert.equal(h.calls.requests.length, 0);
  assert.deepEqual(h.calls.writes, []);
  if (observed !== 'review') { assert.equal(h.calls.original.at(-1).id, mint.id); assert.equal(h.calls.destination[0].message, h.expired.message); }
  else { assert.equal(h.calls.original.length, 0); assert.equal(h.calls.destination.length, 0); }
});

for (const change of ['account', 'lock', 'config']) test(`a ${change} change during original proof GET cannot publish refreshed evidence`, async t => {
  const h = await fixture(t); h.state.hold = { entered: gate(), release: gate() };
  const pending = h.flow.check(h.record.id), rejected = assert.rejects(pending, code('MULTICHAIN_CONTEXT_CHANGED'));
  await h.state.hold.entered.promise;
  if (change === 'account') h.state.identity.account = RECIPIENT;
  if (change === 'lock') h.state.identity.locked = true;
  if (change === 'config') h.state.config.revision++;
  h.state.hold.release.resolve(); await rejected;
  const saved = await h.store.get(h.record.id);
  assert.equal(saved.state, 'attestation-pending'); assert.deepEqual(saved.proof, h.expired); assert.deepEqual(saved.operations, h.record.operations);
  assert.deepEqual(h.calls.writes, []);
});
