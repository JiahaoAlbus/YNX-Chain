import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(appRoot, 'mobile/contract/public-endpoint-manifest.json'), 'utf8'));
const acceptedStatuses = new Set(['VERIFIED', 'DEGRADED']);
const rejectedHosts = new Set(manifest.clientPolicy.reject.filter(value => value !== 'http-production' && value !== 'relative-api' && value !== 'empty-env' && value !== 'wrong-chain' && value !== 'expired' && value !== 'unverified-remote-signature'));

if (manifest.endpointStates.products.finance.status !== 'PENDING') throw new Error('Finance product API probe is forbidden until central release evidence changes the accepted manifest.');

const endpoints = Object.entries(manifest.endpointStates)
  .filter(([, state]) => state && typeof state === 'object' && acceptedStatuses.has(state.status) && typeof state.health === 'string')
  .map(([name, state]) => ({ name, status: state.status, health: state.health }));

const results = await Promise.all(endpoints.map(async endpoint => {
  const url = new URL(endpoint.health);
  if (url.protocol !== 'https:' || rejectedHosts.has(url.hostname)) throw new Error(`rejected manifest probe target: ${endpoint.name}`);
  const started = Date.now();
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json, text/plain;q=0.8' } });
    const body = await response.text();
    return { ...endpoint, reachable: response.ok, httpStatus: response.status, elapsedMs: Date.now() - started, responseSha256: createHash('sha256').update(body).digest('hex') };
  } catch (error) {
    return { ...endpoint, reachable: false, elapsedMs: Date.now() - started, error: error instanceof Error ? error.name : String(error) };
  }
}));

process.stdout.write(`${JSON.stringify({ schemaVersion: 1, classification: 'direct-declared-endpoint-probe-not-product-api-proof', financeProductApiCalled: false, results }, null, 2)}\n`);
