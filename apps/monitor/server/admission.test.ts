import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BoundedRateLimitStore } from './admission.js';
import { createApp } from './app.js';
import { OpsStore } from './store.js';

test('bounded rate-limit storage evicts old keys and expires buckets', async () => {
  const store = new BoundedRateLimitStore({ windowMs: 60_000, maxKeys: 256 });
  for (let index = 0; index < 300; index += 1) store.increment(`client-${index}`);
  assert.equal(store.size, 256);
  const expiringStore = new BoundedRateLimitStore({ windowMs: 2, maxKeys: 256 });
  expiringStore.increment('expired-client');
  await new Promise((resolve) => setTimeout(resolve, 5));
  expiringStore.increment('fresh-client');
  assert.equal(expiringStore.size, 1);
});

async function startMonitor(trustedProxyAddresses?: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-monitor-admission-'));
  const store = new OpsStore(join(directory, 'state.json'));
  await store.load();
  const app = await createApp({
    store,
    secret: 'monitor-admission-session-secret-000001',
    users: [],
    trustedProxyAddresses,
  });
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const login = (base: string, forwardedFor: string) => fetch(`${base}/ops/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
  body: JSON.stringify({ username: 'nobody', password: 'wrong' }),
});

test('authentication throttling is fail-closed and ignores forwarded headers by default', async () => {
  const monitor = await startMonitor();
  try {
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await login(monitor.base, `2001:db8::${index}`)).status, 503);
    }
    const blocked = await login(monitor.base, '198.51.100.77');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');
    assert.deepEqual(await blocked.json(), { error: 'rate_limited', retryAfterSeconds: 60 });
  } finally {
    await monitor.close();
  }
});

test('an explicitly trusted proxy keys IPv4 and IPv6 clients independently', async () => {
  const monitor = await startMonitor(['127.0.0.1']);
  try {
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await login(monitor.base, '2001:db8:1234:5678::1')).status, 503);
    }
    assert.equal((await login(monitor.base, '2001:db8:1234:5678::1')).status, 429);
    assert.equal((await login(monitor.base, '198.51.100.77')).status, 503);
  } finally {
    await monitor.close();
  }
});
