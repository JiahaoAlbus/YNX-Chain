import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { buildP0ConnectivitySnapshot, probeP0Connectivity, type P0ConnectivityProbeConfig } from './p0-connectivity.js';
import { OpsStore } from './store.js';

const rpc: P0ConnectivityProbeConfig = { id: 'native-rpc', name: 'Native RPC', kind: 'rpc', url: 'https://rpc.ynxweb4.com/status', versionUrl: 'https://rpc.ynxweb4.com/node/identity' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('P0 monitor projects public source identity without exposing a probe path', async () => {
  const result = await probeP0Connectivity(rpc, { now: new Date('2026-08-20T01:00:00.000Z'), fetch: async (url) => String(url).endsWith('/node/identity') ? response({ commit: 'a'.repeat(40), release: 'ynx-testnet-1', startedAt: '2026-08-20T00:00:00Z' }) : response({ ok: true }) });
  assert.equal(result.status, 'operational');
  assert.equal(result.endpoint, 'https://rpc.ynxweb4.com');
  assert.equal(result.identity.sourceCommit, 'a'.repeat(40));
  assert.equal(result.identity.release, 'ynx-testnet-1');
  assert.equal(JSON.stringify(result).includes('/status'), false);
});

test('P0 monitor keeps a recovered TLS failure distinct from a Gateway Product Session error', async () => {
  const history = new Map<string, { tlsFailureAt: string }>();
  const failed = await probeP0Connectivity(rpc, { history, fetch: async () => { throw new Error('TLS handshake timed out'); } });
  assert.equal(failed.errorCode, 'ENDPOINT_UNREACHABLE');
  const recovered = await probeP0Connectivity(rpc, { history, fetch: async () => response({ ok: true }) });
  assert.equal(recovered.status, 'degraded');
  assert.equal(recovered.errorCode, 'RPC_TRANSIENT_TLS_FAILURE');
  assert.doesNotMatch(recovered.message, /Product Session/i);
});

test('P0 monitor rejects a successful EVM response from the wrong chain', async () => {
  const result = await probeP0Connectivity({ id: 'evm-rpc', name: 'EVM RPC', kind: 'evm-rpc', url: 'https://evm.ynxweb4.com', expectedEvmChainId: 6423 }, { fetch: async () => response({ jsonrpc: '2.0', id: 'ynx-monitor-chain-id', result: '0x1' }) });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'EVM_CHAIN_MISMATCH');
  assert.equal(result.chainId, 1);
});

test('P0 monitor verifies canonical identity for every configured non-EVM service', async () => {
  const result = await probeP0Connectivity({
    id: 'explorer', name: 'Explorer', kind: 'product-api', url: 'https://explorer.ynxweb4.com/health',
    expectedChainId: 6423, expectedCosmosChainId: 'ynx_6423-1', expectedNativeSymbol: 'YNXT',
  }, { fetch: async () => response({ ok: true, network: { chainId: 6423 }, cometChainId: 'ynx_6423-1', nativeSymbol: 'YNXT' }) });
  assert.equal(result.status, 'operational');
  assert.deepEqual(result.chainIdentity, { chainId: 6423, cosmosChainId: 'ynx_6423-1', nativeSymbol: 'YNXT' });
});

test('P0 monitor fails closed when a successful service reports legacy or incomplete chain identity', async () => {
  const config: P0ConnectivityProbeConfig = {
    id: 'indexer', name: 'Indexer', kind: 'product-api', url: 'https://indexer.ynxweb4.com/health',
    expectedChainId: 6423, expectedCosmosChainId: 'ynx_6423-1', expectedNativeSymbol: 'YNXT',
  };
  const legacy = await probeP0Connectivity(config, { fetch: async () => response({ ok: true, chainId: 9102, cosmosChainId: 'ynx_9102-1', nativeSymbol: 'YNXT' }) });
  const incomplete = await probeP0Connectivity(config, { fetch: async () => response({ ok: true, chainId: 6423, nativeSymbol: 'YNXT' }) });
  assert.equal(legacy.status, 'unavailable');
  assert.equal(legacy.errorCode, 'CHAIN_IDENTITY_MISMATCH');
  assert.deepEqual(legacy.chainIdentity, { chainId: 9102, cosmosChainId: 'ynx_9102-1', nativeSymbol: 'YNXT' });
  assert.equal(incomplete.status, 'unavailable');
  assert.equal(incomplete.errorCode, 'CHAIN_IDENTITY_MISMATCH');
});

test('P0 monitor maps accepted Product Session errors without turning them into offline or standard-Wallet failures', async () => {
  const protocol = await probeP0Connectivity({ id: 'gateway', name: 'Wallet Gateway', kind: 'gateway', url: 'https://wallet-auth.ynxweb4.com/health' }, { fetch: async () => response({ code: 'UNKNOWN_OR_MISSING_FIELD' }, 400) });
  const proof = await probeP0Connectivity({ id: 'gateway-proof', name: 'Wallet Gateway', kind: 'gateway', url: 'https://wallet-auth.ynxweb4.com/health' }, { fetch: async () => response({ code: 'INVALID_DEVICE_PROOF' }, 400) });
  const expired = await probeP0Connectivity({ id: 'gateway-expired', name: 'Wallet Gateway', kind: 'gateway', url: 'https://wallet-auth.ynxweb4.com/health' }, { fetch: async () => response({ code: 'EXPIRED' }, 400) });
  assert.equal(protocol.errorCode, 'PRODUCT_SESSION_PROTOCOL_REJECTED');
  assert.equal(proof.errorCode, 'PRODUCT_SESSION_DEVICE_PROOF_REJECTED');
  assert.equal(expired.errorCode, 'PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW');
  assert.match(protocol.message, /Standard Wallet connection is not implied to be disconnected/);
  assert.doesNotMatch(protocol.message, /offline/i);
});

test('P0 monitor distinguishes client retirement, API failures, and WalletConnect relay failures', async () => {
  const retired = await probeP0Connectivity({ id: 'shop-android', name: 'Shop Android', kind: 'product-api', url: 'https://shop-api.ynxweb4.com/retired' }, { fetch: async () => response({ code: 'CLIENT_RETIRED' }, 410) });
  const api = await probeP0Connectivity({ id: 'shop-api', name: 'Shop API', kind: 'shop-api', url: 'https://shop-api.ynxweb4.com/health' }, { fetch: async () => response({ error: 'upstream' }, 502) });
  const relay = await probeP0Connectivity({ id: 'relay', name: 'WalletConnect Relay', kind: 'walletconnect-relay', url: 'https://relay.walletconnect.com/health' }, { fetch: async () => { throw new Error('network unavailable'); } });
  assert.equal(retired.status, 'degraded');
  assert.equal(retired.errorCode, 'CLIENT_RETIRED');
  assert.equal(api.errorCode, 'PRODUCT_API_FAILURE');
  assert.equal(relay.errorCode, 'WALLETCONNECT_RELAY_UNREACHABLE');
});

test('P0 monitor redacts raw network details and reads a product version as safe release identity', async () => {
  const unavailable = await probeP0Connectivity(rpc, { fetch: async () => { throw new Error('TLS failure at /var/private/monitor with bearer token'); } });
  const shop = await probeP0Connectivity({ id: 'shop-api', name: 'Shop API', kind: 'shop-api', url: 'https://shop-api.ynxweb4.com/health' }, { fetch: async () => response({ ok: true, commit: 'b'.repeat(8), version: '0.4.0-testnet-preview' }) });
  assert.equal(unavailable.errorCode, 'ENDPOINT_UNREACHABLE');
  assert.equal(JSON.stringify(unavailable).includes('/var/private'), false);
  assert.equal(shop.identity.sourceCommit, 'b'.repeat(8));
  assert.equal(shop.identity.release, '0.4.0-testnet-preview');
});

test('P0 monitor fails closed for non-public endpoints and describes no configured probes without calling them offline', async () => {
  await assert.rejects(() => probeP0Connectivity({ ...rpc, url: 'http://127.0.0.1:6420/status' }));
  const snapshot = await buildP0ConnectivitySnapshot([]);
  assert.equal(snapshot.status, 'not_configured');
  assert.match(snapshot.limitations[0], /not an offline classification/);
});

test('P0 public connectivity route is cache-free and truthful before probe activation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-monitor-p0-connectivity-'));
  const app = await createApp({
    store: new OpsStore(join(directory, 'state.json')),
    secret: 'p0-connectivity-route-secret-000001',
    users: [{ username: 'viewer', role: 'viewer', passwordHash: hashPassword('unused') }],
    publicStatusSource: null,
    p0ConnectivityProbes: [],
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const result = await fetch(`http://127.0.0.1:${address.port}/connectivity`);
    const body = await result.json() as { status: string; limitations: string[] };
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(body.status, 'not_configured');
    assert.match(body.limitations[0], /not an offline classification/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
