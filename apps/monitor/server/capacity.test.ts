import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { OpsStore } from './store.js';

test('Monitor records a bounded local HTTP capacity baseline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-monitor-capacity-'));
  const store = new OpsStore(
    join(directory, 'state.json'),
    'monitor-capacity-integrity-key-000000000001',
  );
  const app = await createApp({
    store,
    secret: 'monitor-capacity-session-secret-000001',
    users: [{ username: 'capacity-viewer', role: 'viewer', passwordHash: hashPassword('unused') }],
    publicStatusSource: null,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/health`;
  const requests = 1000;
  const concurrency = 25;
  const latencies: number[] = [];
  let failures = 0;
  let next = 0;
  const started = performance.now();

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next++;
      if (index >= requests) return;
      const requestStarted = performance.now();
      const response = await fetch(endpoint);
      latencies.push(performance.now() - requestStarted);
      if (!response.ok) failures++;
      await response.arrayBuffer();
    }
  });
  await Promise.all(workers);
  const elapsedMs = performance.now() - started;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(failures, 0);
  assert.equal(latencies.length, requests);
  latencies.sort((a, b) => a - b);
  const percentile = (p: number) => latencies[Math.floor((latencies.length - 1) * p)];
  console.log(
    `monitor-capacity requests=${requests} concurrency=${concurrency} failures=0 ` +
      `throughput=${(requests / (elapsedMs / 1000)).toFixed(1)}/s ` +
      `p50=${percentile(0.5).toFixed(3)}ms p95=${percentile(0.95).toFixed(3)}ms ` +
      `p99=${percentile(0.99).toFixed(3)}ms`,
  );
});
