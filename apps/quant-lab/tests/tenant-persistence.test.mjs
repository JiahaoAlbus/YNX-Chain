import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const tenantA = 'a'.repeat(64), tenantB = 'b'.repeat(64);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

function syntheticBacktest(owner, seed) {
  const bars = Array.from({ length: 48 }, (_, i) => {
    const price = 1_000_000 + i * 1_000;
    return { time: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), open: price, high: price + 1_000, low: price - 1_000, close: price, volume: 20_000_000 };
  });
  return {
    strategy: { ID: `fixture-strategy-${owner}`, Name: `Synthetic local tenant ${owner}`, Family: 'transparent', Source: `fixture://synthetic-tenant-${owner}`, SourceCommit: 'local-test-only', License: 'test-fixture', Seed: seed, Params: { fast: 3, slow: 8 }, Limitations: 'Synthetic local fixture, not real market or trading evidence.' },
    bars,
    assumptions: { FeeBPS: 10, SlippageBPS: 5, LatencyBars: 1, ParticipationBPS: 1_000, Seed: seed, TrainEnd: 24, WalkForwardWindows: 3 },
  };
}

test('actual local Quant HTTP: two tenants, two processes, durable Paper replay and restart isolation', { timeout: 120_000 }, async t => {
  t.diagnostic('LOCAL FIXTURE ONLY: synthetic prices, browser-local tenant capability IDs; not wallet authentication, live trades, public deployment or PostgreSQL evidence.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ynx-quant-tenant-fixture-'));
  const binary = path.join(root, 'ynx-quant-fixture');
  const build = spawnSync('go', ['build', '-o', binary, './apps/quant-lab/server'], { cwd: repository, env: { ...process.env, GOPROXY: 'off', GOSUMDB: 'off' }, encoding: 'utf8', timeout: 90_000 });
  if (build.status !== 0) await rm(root, { recursive: true, force: true });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const processes = new Set();
  let marketCalls = 0, feedOnline = true;
  // The adapter requires its exact source marker; all records below are explicitly
  // synthetic wire fixtures served only on loopback, never production trade evidence.
  const market = http.createServer((req, res) => {
    marketCalls++;
    assert.equal(req.url, '/v1/market-data/trades', 'test must not access Exchange auth/transaction endpoints');
    res.setHeader('Content-Type', 'application/json');
    if (!feedOnline) { res.writeHead(503); res.end('{"error":"synthetic-feed-offline"}'); return; }
    res.end(JSON.stringify({ market: 'YNXT-YUSD_TEST', source: 'YNX-owned deterministic matched trades only', externalPrice: false, trades: [{ priceMicro: 1_200_000, amountMicro: 20_000_000, createdAt: '2026-01-01T00:00:00Z' }] }));
  });
  market.listen(0, '127.0.0.1');
  await once(market, 'listening');
  const exchangeURL = `http://127.0.0.1:${market.address().port}`;
  async function stop(server) {
    if (!processes.has(server.process)) return;
    const exited = once(server.process, 'exit');
    server.process.kill('SIGTERM');
    await exited;
    processes.delete(server.process);
  }
  t.after(async () => {
    for (const proc of processes) { const exited = once(proc, 'exit'); proc.kill('SIGTERM'); await exited; }
    await new Promise(resolve => market.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  async function start() {
    const port = await freePort();
    const proc = spawn(binary, [], { cwd: repository, env: { ...process.env, YNX_QUANT_HTTP_ADDR: `127.0.0.1:${port}`, YNX_QUANT_STATE_PATH: path.join(root, 'state.json'), YNX_QUANT_DATABASE_URL: '', YNX_QUANT_STATE_NAMESPACE: '', YNX_QUANT_EXCHANGE_URL: exchangeURL }, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.add(proc);
    let logs = '';
    proc.stderr.on('data', chunk => { logs += chunk; });
    const base = `http://127.0.0.1:${port}/api`;
    for (let i = 0; i < 100; i++) {
      if (proc.exitCode !== null) assert.fail(`Quant fixture exited: ${logs}`);
      try { if ((await fetch(`${base}/health`)).status === 200) return { process: proc, base }; } catch {}
      await delay(20);
    }
    assert.fail(`Quant fixture did not start: ${logs}`);
  }
  async function api(server, route, tenant, body, expected = 200, preview = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (tenant) headers['X-YNX-Tenant-ID'] = tenant;
    if (preview) headers['X-YNX-Preview-Mode'] = 'local-paper';
    const response = await fetch(`${server.base}${route}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, expected, `${route}: ${JSON.stringify(value)}`);
    return value;
  }
  const server1 = await start();
  const server2 = await start();
  const health = await api(server1, '/health');
  assert.equal(health.storage.multiInstance, false, 'filesystem fixture must not claim PostgreSQL readiness');
  await api(server1, '/ready', undefined, undefined, 503);
  await api(server1, '/v1/snapshot', undefined, undefined, 401);
  await api(server1, '/v1/snapshot', 'invalid', undefined, 401);
  const [experimentA, experimentB] = await Promise.all([
    api(server1, '/v1/backtests', tenantA, syntheticBacktest('a', 11), 201),
    api(server2, '/v1/backtests', tenantB, syntheticBacktest('b', 22), 201),
  ]);
  const hashA = experimentA.strategy.StrategyHash, hashB = experimentB.strategy.StrategyHash;
  assert.notEqual(hashA, hashB);
  const snapshot = (server, tenant) => api(server, '/v1/snapshot', tenant);
  function assertOwnSnapshot(value, owner) {
    assert.deepEqual(Object.keys(value.strategies), [`fixture-strategy-${owner}`]);
    assert.equal(Object.values(value.experiments).every(exp => exp.strategy.ID === `fixture-strategy-${owner}`), true);
    const other = owner === 'a' ? 'b' : 'a';
    assert.equal(value.audit.some(event => event.ObjectID === `fixture-strategy-${other}`), false);
    assert.equal(value.liveFundsEnabled, false);
  }
  assertOwnSnapshot(await snapshot(server2, tenantA), 'a');
  assertOwnSnapshot(await snapshot(server1, tenantB), 'b');
  const requestA = { strategyHash: hashA, side: 'buy', amount: 1_000_000, idempotencyKey: 'same-key-both-tenants' };
  const requestB = { ...requestA, strategyHash: hashB, side: 'sell' };
  await api(server1, '/v1/paper/orders', tenantA, requestA, 403, false);
  await api(server1, '/v1/paper/orders', tenantA, { ...requestA, strategyHash: hashB, idempotencyKey: 'cross-tenant-blocked' }, 403);
  await api(server1, '/v1/paper/orders', tenantA, { ...requestA, idempotencyKey: '' }, 400);
  assert.equal(marketCalls, 0, 'denied requests must not query market');
  const duplicateA = await Promise.all(Array.from({ length: 8 }, (_, i) => api(i % 2 ? server1 : server2, '/v1/paper/orders', tenantA, requestA, 201)));
  const duplicateB = await Promise.all(Array.from({ length: 4 }, (_, i) => api(i % 2 ? server1 : server2, '/v1/paper/orders', tenantB, requestB, 201)));
  for (const result of duplicateA) assert.deepEqual(result, duplicateA[0]);
  for (const result of duplicateB) assert.deepEqual(result, duplicateB[0]);
  assert.notEqual(duplicateA[0].StrategyHash, duplicateB[0].StrategyHash);
  await api(server2, '/v1/paper/orders', tenantA, { ...requestA, amount: 2_000_000 }, 409);
  let beforeA = await snapshot(server1, tenantA), beforeB = await snapshot(server2, tenantB);
  assert.equal(beforeA.paper.Orders.length, 1);
  assert.equal(beforeB.paper.Orders.length, 1);
  assert.equal(beforeA.paper.Position, 1_000_000);
  assert.equal(beforeB.paper.Position, -1_000_000);
  assert.equal(beforeA.audit.filter(event => event.Action.startsWith('paper_order_')).length, 1);
  assert.equal(beforeB.audit.filter(event => event.Action.startsWith('paper_order_')).length, 1);
  // Two processes racing different bodies for one new key may commit only one.
  const conflictingRace = await Promise.all([server1, server2].map(async (server, i) => {
    const response = await fetch(`${server.base}/v1/paper/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-YNX-Tenant-ID': tenantA, 'X-YNX-Preview-Mode': 'local-paper' },
      body: JSON.stringify({ ...requestA, amount: 500_000 + i * 100_000, idempotencyKey: 'concurrent-conflict-key' }),
    });
    return { status: response.status, value: await response.json() };
  }));
  assert.deepEqual(conflictingRace.map(result => result.status).sort(), [201, 409]);
  const afterRace = await snapshot(server2, tenantA);
  assert.equal(afterRace.paper.Orders.length, 2);
  assert.equal(afterRace.audit.filter(event => event.Action.startsWith('paper_order_')).length, 2);
  assert.equal(afterRace.paper.Position, 1_000_000 + conflictingRace.find(result => result.status === 201).value.Filled);
  // Overwriting the saved strategy invalidates its old hash for new requests.
  const replacement = await api(server2, '/v1/backtests', tenantA, syntheticBacktest('a', 33), 201);
  assert.notEqual(replacement.strategy.StrategyHash, hashA);
  await api(server1, '/v1/paper/orders', tenantA, { ...requestA, idempotencyKey: 'stale-strategy-blocked' }, 403);
  beforeA = await snapshot(server1, tenantA);
  await stop(server1);
  await stop(server2);
  const restarted = await start();
  const afterA = await snapshot(restarted, tenantA), afterB = await snapshot(restarted, tenantB);
  for (const [before, after] of [[beforeA, afterA], [beforeB, afterB]]) {
    for (const field of ['strategies', 'experiments', 'paper', 'audit']) assert.deepEqual(after[field], before[field], `restart preserves ${field}`);
  }
  assertOwnSnapshot(afterA, 'a');
  assertOwnSnapshot(afterB, 'b');
  const callsBeforeReplay = marketCalls;
  feedOnline = false;
  assert.deepEqual(await api(restarted, '/v1/paper/orders', tenantA, requestA, 201), duplicateA[0]);
  assert.deepEqual(await api(restarted, '/v1/paper/orders', tenantB, requestB, 201), duplicateB[0]);
  assert.equal(marketCalls, callsBeforeReplay, 'durable replay bypasses offline feed');
  await api(restarted, '/v1/paper/orders', tenantA, { ...requestA, side: 'sell' }, 409);
  const files = await readdir(path.join(root, 'state.json.tenants'));
  assert.deepEqual(files.sort(), [`${tenantA}.json`, `${tenantB}.json`]);
  t.diagnostic('PASS: 2 isolated tenants, 2 concurrent local processes, 12 same-key HTTP submissions -> 2 tenant-scoped Paper orders; concurrent different-body same-key race -> exactly one additional order and one 409; restart/replay preserved receipts; stale/cross-tenant hashes 403.');
});
