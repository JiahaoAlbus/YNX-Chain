#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const endpoint = process.argv[2] ?? 'https://shop-api.ynxweb4.com/api/products';
const concurrency = Number(process.env.YNX_SHOP_LOAD_CONCURRENCY ?? 100);
const requests = Number(process.env.YNX_SHOP_LOAD_REQUESTS ?? 2000);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 500) throw new Error('invalid concurrency');
if (!Number.isSafeInteger(requests) || requests < concurrency || requests > 100_000) throw new Error('invalid request count');
const durations = [];
const failures = [];
let next = 0;

async function worker() {
  while (true) {
    const index = next++;
    if (index >= requests) return;
    const started = performance.now();
    try {
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json', 'user-agent': 'ynx-shop-public-load/1' },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body?.products) || body.products.length < 1) {
        failures.push({ index, status: response.status, reason: 'invalid catalog response' });
      }
    } catch (error) {
      failures.push({ index, status: 0, reason: String(error?.message ?? error) });
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = performance.now() - started;
durations.sort((a, b) => a - b);
const percentile = (value) => Number(durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)].toFixed(2));
const result = {
  endpoint,
  requests,
  concurrency,
  failures: failures.length,
  elapsedMs: Number(elapsed.toFixed(2)),
  throughputPerSecond: Number((requests / (elapsed / 1000)).toFixed(2)),
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  p99Ms: percentile(0.99),
  failureKinds: Object.fromEntries(
    Object.entries(
      failures.reduce((counts, failure) => {
        const key = `${failure.status}:${failure.reason}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    ).sort(([left], [right]) => left.localeCompare(right)),
  ),
};
console.log(JSON.stringify(result));
if (failures.length) {
  console.error(JSON.stringify({ sampleFailures: failures.slice(0, 5) }));
  process.exitCode = 1;
}
