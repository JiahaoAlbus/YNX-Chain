#!/usr/bin/env node

import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";

const baseUrl = (process.env.YNX_BENCHMARK_URL || "http://127.0.0.1:6460").replace(/\/$/, "");
const requests = positiveInteger(process.env.YNX_BENCHMARK_REQUESTS, 2000);
const concurrency = positiveInteger(process.env.YNX_BENCHMARK_CONCURRENCY, 25);
const warmup = positiveInteger(process.env.YNX_BENCHMARK_WARMUP, 100);
const timeoutMs = positiveInteger(process.env.YNX_BENCHMARK_TIMEOUT_MS, 5000);
const paths = ["/health", "/status"];

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    await response.arrayBuffer();
    return { ok: response.ok, status: response.status, latencyMs: performance.now() - started };
  } catch (error) {
    return { ok: false, status: 0, latencyMs: performance.now() - started, error: error.name };
  } finally {
    clearTimeout(timer);
  }
}

async function run(total, record) {
  let next = 0;
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const index = next++;
      if (index >= total) return;
      const result = await request(paths[index % paths.length]);
      if (record) results.push({ path: paths[index % paths.length], ...result });
    }
  });
  const started = performance.now();
  await Promise.all(workers);
  return { results, durationMs: performance.now() - started };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

await run(warmup, false);
const measured = await run(requests, true);
const successful = measured.results.filter((result) => result.ok);
const latencies = successful.map((result) => result.latencyMs).sort((a, b) => a - b);
const byPath = Object.fromEntries(paths.map((path) => {
  const values = successful.filter((result) => result.path === path).map((result) => result.latencyMs).sort((a, b) => a - b);
  return [path, {
    successfulRequests: values.length,
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
  }];
}));

const output = {
  schemaVersion: 1,
  benchmarkKind: "single-process-local-devnet-http-read",
  measuredAt: new Date().toISOString(),
  target: baseUrl,
  endpoints: paths,
  requests,
  warmupRequests: warmup,
  concurrency,
  timeoutMs,
  durationMs: measured.durationMs,
  successfulRequests: successful.length,
  failedRequests: measured.results.length - successful.length,
  throughputRequestsPerSecond: successful.length / (measured.durationMs / 1000),
  aggregateLatencyMs: {
    p50: percentile(latencies, 0.50),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    max: latencies.at(-1) ?? null,
  },
  byPath,
  environment: {
    platform: process.platform,
    architecture: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
  },
  interpretation: "Development evidence only. This is not a multi-validator, WAN, write-path, adversarial, or production capacity result.",
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.failedRequests > 0) process.exitCode = 1;
