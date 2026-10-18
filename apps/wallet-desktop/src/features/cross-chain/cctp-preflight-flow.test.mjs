import test from 'node:test';
import assert from 'node:assert/strict';
import { CctpFlow, installCctpIPC } from './cctp-flow.mjs';
import { CctpReader } from './cctp-reader.mjs';
import { ROUTE } from './cctp-wire.mjs';
import { EVMAdapter } from '../../multichain-evm.mjs';
import { MultichainService } from '../../multichain-service.mjs';
import { validateNetwork } from '../../multichain-config.mjs';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const INPUT = { routeId: ROUTE.id };
const verified = () => ({ status: 'verified', stage: 'rpc-identity', errorCode: null });
const copy = value => structuredClone(value);
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const code = expected => error => error?.code === expected;

function fixture() {
  const networks = [ROUTE.source, ROUTE.destination].map((route, index) => validateNetwork({ name: route.name, chainId: String(route.chainId), genesis: `0x${String(index + 1).repeat(64)}`, rpcUrl: `https://controlled-${index}.example.org/`, symbol: 'ETH', decimals: 18 }));
  const state = { identity: { account: ACCOUNT, revision: 1, locked: false }, config: { version: 1, revision: 5, selected: networks[0].id, networks: copy(networks), tokens: [] } };
  const calls = { reader: [], store: [], writes: [], ids: 0, config: 0, context: 0 };
  const forbidden = name => () => { calls.writes.push(name); throw new Error(`Preflight cannot invoke ${name}`); };
  const store = new Proxy({}, { get(_target, key) { calls.store.push(String(key)); throw new Error('Preflight must not access cross-chain history'); } });
  // Exercise the original context/snapshot/assert implementation and its current
  // account, config revision, lifecycle epoch and lock comparisons.
  const wallet = new MultichainService({
    config: { async read() { calls.config++; return copy(state.config); } },
    getContext: async () => { calls.context++; return copy(state.identity); },
    withSecret: forbidden('custody'), journal: store, adapter: {},
  });
  for (const name of ['prepareCctpStep', 'send', 'cancel', 'prepare', 'mutate', 'balances']) wallet[name] = forbidden(name);
  const reader = { async preflightNetwork(network, route) { calls.reader.push({ network: copy(network), route }); return verified(); }, quote: forbidden('quote'), attestation: forbidden('attestation'), destination: forbidden('destination') };
  const flow = new CctpFlow({ wallet, reader, store, id() { calls.ids++; throw new Error('Preflight must not allocate an operation ID'); } });
  const noEffects = () => { assert.deepEqual(calls.store, []); assert.deepEqual(calls.writes, []); assert.equal(calls.ids, 0); };
  const blockReader = () => {
    const entered = gate(), source = gate(), destination = gate();
    reader.preflightNetwork = async (network, route) => {
      calls.reader.push({ network: copy(network), route });
      if (calls.reader.length === 2) entered.resolve();
      return (route === ROUTE.source ? source : destination).promise;
    };
    return { entered: entered.promise, source, destination };
  };
  return { state, calls, wallet, reader, flow, networks, noEffects, blockReader };
}

const expectedSide = (side, network, route, status = 'verified', stage = 'rpc-identity', errorCode = null) => ({ side, chainId: route.chainId, networkId: network?.id ?? null, genesis: network?.genesis ?? null, status, stage, errorCode });
const assertClosed = result => {
  assert.deepEqual(Object.keys(result).sort(), ['routeId', 'available', 'source', 'destination', 'canSign', 'approved', 'canRetry', 'targetReceived'].sort());
  for (const side of [result.source, result.destination]) assert.deepEqual(Object.keys(side).sort(), ['side', 'chainId', 'networkId', 'genesis', 'status', 'stage', 'errorCode'].sort());
  for (const flag of ['canSign', 'approved', 'canRetry', 'targetReceived']) assert.equal(result[flag], false);
  assert.doesNotThrow(() => JSON.stringify(result));
};

test('static route metadata is unavailable until a read-only preflight, with no cached signing grant', async () => {
  const h = fixture();
  assert.equal(h.flow.routes()[0].available, false);
  assert.equal(h.flow.routes()[0].requiresPreflight, true);
  const result = await h.flow.preflight(INPUT);
  assert.deepEqual(result, { routeId: ROUTE.id, available: true, source: expectedSide('source', h.networks[0], ROUTE.source), destination: expectedSide('destination', h.networks[1], ROUTE.destination), canSign: false, approved: false, canRetry: false, targetReceived: false });
  assertClosed(result); h.noEffects();
  assert.equal(h.flow.routes()[0].available, false, 'A prior identity read cannot become a persistent route/approval grant');
});

test('real CctpReader and EVMAdapter verify both saved network identities without fees, balances or HTTP', async () => {
  const h = fixture(), rpcCalls = [];
  const evm = new EVMAdapter({ rpc: async (url, method, params) => {
    rpcCalls.push({ url, method, params });
    const network = h.networks.find(item => item.rpcUrl === url); assert.ok(network);
    if (method === 'eth_chainId') return network.chainId;
    assert.equal(method, 'eth_getBlockByNumber'); assert.deepEqual(params, ['0x0', false]);
    return { hash: network.genesis, number: '0x0' };
  } });
  h.flow.reader = new CctpReader({ evm, fetchImpl: () => { throw new Error('Network preflight cannot fetch fees or attestations'); } });
  const result = await h.flow.preflight(INPUT);
  assert.equal(result.available, true); assertClosed(result);
  assert.equal(rpcCalls.length, 4);
  assert.deepEqual(rpcCalls.filter(call => call.method === 'eth_chainId').map(call => call.url).sort(), h.networks.map(network => network.rpcUrl).sort());
  h.noEffects();
});

test('missing and duplicate networks are reported independently without contacting either ambiguous route', async () => {
  const h = fixture(); h.state.config.networks = [h.networks[1], copy(h.networks[1])];
  const result = await h.flow.preflight(INPUT);
  assert.deepEqual(result.source, expectedSide('source', null, ROUTE.source, 'unverified', 'network-selection', 'CCTP_NETWORK_REQUIRED'));
  assert.deepEqual(result.destination, expectedSide('destination', null, ROUTE.destination, 'unverified', 'network-selection', 'CCTP_NETWORK_AMBIGUOUS'));
  assert.equal(result.available, false); assertClosed(result);
  assert.equal(h.calls.reader.length, 0); h.noEffects();
});

test('a malformed saved network stays unverified while the independently valid side still reports verification', async () => {
  for (const patch of [{ id: 'not-a-network-id' }, { family: 'bitcoin' }, { genesis: '0x00' }, { rpcUrl: 'http://localhost:8545/' }, { extra: 'untrusted' }]) {
    const h = fixture(); h.state.config.networks[0] = { ...h.state.config.networks[0], ...patch };
    const result = await h.flow.preflight(INPUT);
    assert.deepEqual(result.source, expectedSide('source', null, ROUTE.source, 'unverified', 'saved-network', 'CCTP_NETWORK_INVALID'));
    assert.deepEqual(result.destination, expectedSide('destination', h.networks[1], ROUTE.destination));
    assert.equal(result.available, false); assert.equal(h.calls.reader.length, 1); assertClosed(result); h.noEffects();
  }
});

test('closed reader failures remain scoped to one side and never imply an approval or target receipt', async () => {
  const h = fixture();
  h.reader.preflightNetwork = async (_network, route) => route === ROUTE.source ? { status: 'unverified', stage: 'rpc-identity', errorCode: 'MULTICHAIN_NETWORK_MISMATCH' } : verified();
  const result = await h.flow.preflight(INPUT);
  assert.deepEqual(result.source, expectedSide('source', h.networks[0], ROUTE.source, 'unverified', 'rpc-identity', 'MULTICHAIN_NETWORK_MISMATCH'));
  assert.equal(result.destination.status, 'verified'); assert.equal(result.available, false); assertClosed(result); h.noEffects();
});

test('extra or malformed reader success data and thrown details cannot cross the preflight result boundary', async () => {
  const invalid = [null, { status: 'verified' }, { ...verified(), canSign: true }, { ...verified(), errorCode: 'MULTICHAIN_RPC_TIMEOUT' }, { status: 'unverified', stage: 'rpc-identity', errorCode: null }, { status: 'unverified', stage: 'rpc-identity', errorCode: 'PRIVATE_BACKEND_DETAIL' }, { ...verified(), stage: 'balance' }];
  for (const value of invalid) {
    const h = fixture(); h.reader.preflightNetwork = async (_network, route) => route === ROUTE.source ? value : verified();
    const result = await h.flow.preflight(INPUT);
    assert.deepEqual(result.source, expectedSide('source', h.networks[0], ROUTE.source, 'unverified', 'rpc-identity', 'CCTP_PREFLIGHT_UNAVAILABLE'));
    assert.equal(result.destination.status, 'verified'); assert.equal(result.available, false); assertClosed(result); h.noEffects();
  }
  const h = fixture(); h.reader.preflightNetwork = async () => { throw Object.assign(new Error('PRIVATE_BACKEND_DETAIL'), { code: 'UNBOUNDED_ERROR' }); };
  const result = await h.flow.preflight(INPUT);
  assert.equal(result.source.errorCode, 'CCTP_PREFLIGHT_UNAVAILABLE'); assert.equal(result.destination.errorCode, 'CCTP_PREFLIGHT_UNAVAILABLE');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_BACKEND_DETAIL')); assertClosed(result); h.noEffects();
});

test('only the fixed route and a closed routeId input can reach account or network reads', async () => {
  const h = fixture();
  for (const value of [null, { ...INPUT, rpcUrl: 'https://alternate.example.org/' }, { ...INPUT, amount: '1' }]) await assert.rejects(h.flow.preflight(value), code('MULTICHAIN_INVALID_INPUT'));
  for (const value of [{ routeId: 'ynx-base-usdc' }, {}]) await assert.rejects(h.flow.preflight(value), code('CCTP_UNSUPPORTED_ROUTE'));
  assert.equal(h.calls.context, 0); assert.equal(h.calls.config, 0); assert.equal(h.calls.reader.length, 0); h.noEffects();
});

for (const change of ['account', 'lock', 'identity-revision', 'lifecycle-epoch', 'config-revision']) test(`a late preflight cannot publish after original Wallet ${change} changes`, async () => {
  const h = fixture(), blocked = h.blockReader();
  const pending = h.flow.preflight(INPUT), rejected = assert.rejects(pending, code('MULTICHAIN_CONTEXT_CHANGED'));
  await blocked.entered;
  if (change === 'account') h.state.identity.account = OTHER;
  if (change === 'lock') h.state.identity.locked = true;
  if (change === 'identity-revision') h.state.identity.revision++;
  if (change === 'lifecycle-epoch') h.wallet.invalidate();
  if (change === 'config-revision') h.state.config.revision++;
  blocked.source.resolve(verified()); blocked.destination.resolve(verified()); await rejected;
  assert.equal(h.calls.reader.length, 2); h.noEffects();
});

test('a newer preflight supersedes both late replies from the previous read without changing stored state', async () => {
  const h = fixture(), blocked = h.blockReader();
  const old = h.flow.preflight(INPUT), rejected = assert.rejects(old, code('CCTP_PREFLIGHT_REPLACED')); await blocked.entered;
  h.reader.preflightNetwork = async () => verified();
  const current = await h.flow.preflight(INPUT); assert.equal(current.available, true);
  blocked.source.resolve(verified()); blocked.destination.resolve(verified()); await rejected;
  h.noEffects();
});

test('a locked original wallet fails before any route RPC can run', async () => {
  const h = fixture(); h.state.identity.locked = true;
  await assert.rejects(h.flow.preflight(INPUT), code('MULTICHAIN_LOCKED'));
  assert.equal(h.calls.reader.length, 0); h.noEffects();
});

test('the ninth closed IPC is safe read-only and never obtains a signing guard', async () => {
  const h = fixture(), handlers = new Map(); let safe = 0, sensitive = 0, guards = 0;
  installCctpIPC({ handle: (name, handler) => { assert.ok(!handlers.has(name)); handlers.set(name, handler); }, flow: h.flow,
    safe: async action => { safe++; try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: { code: error.code } }; } },
    sensitive: () => { sensitive++; throw new Error('Preflight cannot enter a sensitive mutation wrapper'); }, getGuard: () => { guards++; throw new Error('Preflight cannot request signing approval'); } });
  assert.equal(handlers.size, 9);
  const handler = handlers.get('wallet:cross-chain-preflight'); assert.equal(typeof handler, 'function');
  const result = await handler({}, INPUT); assert.equal(result.ok, true); assertClosed(result.value);
  assert.deepEqual(await handler({}, { ...INPUT, approve: true }), { ok: false, error: { code: 'MULTICHAIN_INVALID_INPUT' } });
  assert.equal(safe, 2); assert.equal(sensitive, 0); assert.equal(guards, 0); h.noEffects();
});
