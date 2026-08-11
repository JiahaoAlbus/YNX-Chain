#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const base = (process.env.YNX_DEX_CAPACITY_URL || "https://dex.ynxweb4.com").replace(/\/$/, "");
const requests = Number(process.env.YNX_DEX_CAPACITY_REQUESTS || 1000);
const concurrency = Number(process.env.YNX_DEX_CAPACITY_CONCURRENCY || 64);
const timeoutMs = Number(process.env.YNX_DEX_CAPACITY_TIMEOUT_MS || 15_000);
if (!Number.isSafeInteger(requests) || requests < 100 || requests > 100_000) throw new Error("request count must be 100..100000");
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 500 || concurrency > requests) throw new Error("concurrency must be 1..500 and no greater than requests");
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error("timeout must be 1000..60000 ms");

const paths = [
  "/health",
  "/v1/tokens",
  "/v1/pools",
  "/v1/transactions?limit=25",
  "/v1/swaps?limit=25",
  "/v1/candles?pool=dex_ynxt_yusdt&interval=60&limit=20",
];
const durations = [];
const failures = [];
let next = 0;

function valid(path, body) {
  if (path === "/health") return body?.status === "ok" && body?.chainId === 6423 && body?.marketSourceConfigured === true && body?.marketAvailable === true && body?.executionAvailable === true && body?.indexedPools === 1;
  if (path === "/v1/tokens") return body?.chainId === 6423 && Array.isArray(body?.items) && body.items.some((token) => token.address === "YNXT") && body.items.some((token) => token.address === "ynx-usd-test");
  if (path === "/v1/pools") return Array.isArray(body?.items) && body.items.length === 1 && body.items[0]?.address === "dex_ynxt_yusdt" && body.items[0]?.reserve0 === "46" && body.items[0]?.reserve1 === "103170";
  if (path.startsWith("/v1/transactions")) return Array.isArray(body?.items) && body.items.length === 6;
  if (path.startsWith("/v1/swaps")) return Array.isArray(body?.items) && body.items.length === 2;
  return Array.isArray(body?.items) && body.items.length >= 1 && body.items.every((candle) => candle.pool === "dex_ynxt_yusdt" && candle.trades >= 1);
}

async function worker() {
  while (true) {
    const index = next++;
    if (index >= requests) return;
    const path = paths[index % paths.length];
    const started = performance.now();
    try {
      const response = await fetch(base + path, { headers: { accept: "application/json", "user-agent": "ynx-dex-capacity/1" }, signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.json();
      if (!response.ok || !valid(path, body)) failures.push({ index, path, status: response.status, reason: "invalid market response" });
    } catch (error) {
      failures.push({ index, path, status: 0, reason: String(error?.message || error) });
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsedMs = performance.now() - started;
durations.sort((left, right) => left - right);
const percentile = (ratio) => Number(durations[Math.min(durations.length - 1, Math.ceil(durations.length * ratio) - 1)].toFixed(3));
const result = {
  schemaVersion: 1,
  productId: "ynx-dex",
  measuredAt: new Date().toISOString(),
  endpoint: base,
  scope: base.startsWith("http://127.0.0.1") ? "primary-node loopback API concurrency" : "public TLS API concurrency from the executing client",
  requests,
  concurrency,
  completed: durations.length,
  successes: requests - failures.length,
  failures: failures.length,
  elapsedMs: Number(elapsedMs.toFixed(3)),
  throughputPerSecond: Number((requests / (elapsedMs / 1000)).toFixed(2)),
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: Number(durations.at(-1).toFixed(3)) },
  failureKinds: Object.fromEntries(Object.entries(failures.reduce((all, failure) => { const key = `${failure.status}:${failure.path}:${failure.reason}`; all[key] = (all[key] || 0) + 1; return all; }, {})).sort()),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) {
  process.stderr.write(`${JSON.stringify({ sampleFailures: failures.slice(0, 10) })}\n`);
  process.exitCode = 1;
}
