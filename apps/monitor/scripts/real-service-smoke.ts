import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { OpsStore } from '../server/store.js';

type Probe = {
  id: string;
  status: 'healthy' | 'unavailable';
  error?: string;
  httpStatus?: number;
};

const dir = await mkdtemp(join(tmpdir(), 'ynx-monitor-smoke-'));
const store = new OpsStore(join(dir, 'state.json'));
const app = await createApp({
  store,
  secret: 'local-real-service-smoke-secret',
  users: [{ username: 'smoke', role: 'operator', passwordHash: hashPassword('smoke-pass') }],
  rpcUrl: process.env.YNX_RPC_URL || 'http://127.0.0.1:6420',
  explorerUrl: process.env.YNX_EXPLORER_URL || 'http://127.0.0.1:6427',
  indexerUrl: process.env.YNX_INDEXER_URL || 'http://127.0.0.1:6426',
  aiUrl: process.env.YNX_AI_URL || 'http://127.0.0.1:6429',
});
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));

const address = server.address();
if (!address || typeof address === 'string') throw new Error('monitor smoke did not bind');
const base = `http://127.0.0.1:${address.port}`;
const auth = await fetch(`${base}/ops/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'smoke', password: 'smoke-pass' }),
});
if (!auth.ok) throw new Error(`login failed: ${auth.status}`);
const { token } = await auth.json() as { token: string };
const overview = await fetch(`${base}/ops/overview`, { headers: { authorization: `Bearer ${token}` } });
if (!overview.ok) throw new Error(`overview failed: ${overview.status}`);
const data = await overview.json() as {
  probes: Probe[];
  slo: { definition: string; passing: number; total: number };
};
if (data.probes.length !== 8 || data.slo.total !== 8 || !data.slo.definition.includes('no historical uptime')) {
  throw new Error('monitor returned incomplete or misleading probe contract');
}
const failed = data.probes.filter((probe) => probe.status !== 'healthy');
if (data.slo.passing !== 8 || failed.length) {
  const details = failed.map((probe) => `${probe.id}:${probe.error ?? `HTTP ${probe.httpStatus}`}`).join(', ');
  throw new Error(`monitor real-service probes failed: ${details}`);
}
console.log('monitor real-service smoke passed: 8/8 bounded probes healthy');
await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
