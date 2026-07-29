import { performance } from "node:perf_hooks";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchStore } from "../src/store.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};
const round = value => Math.round(value * 100) / 100;

const requestCount = clamp(Number(process.env.YNX_CAPACITY_REQUESTS ?? 80), 1, 110);
const concurrency = clamp(Number(process.env.YNX_CAPACITY_CONCURRENCY ?? 8), 1, 32);
const documentCount = clamp(Number(process.env.YNX_CAPACITY_DOCUMENTS ?? 40), 1, 500);
const dir = await mkdtemp(join(tmpdir(), "ynx-search-capacity-"));
const dataPath = join(dir, "index.json");
const store = new SearchStore(dataPath, { clock: () => "2026-07-29T08:00:00.000Z" });
const source = await store.registerSource({
  url: "https://capacity.example/",
  label: "Capacity fixture",
  sourceType: "ynx-official",
  owner: "YNX Search local verification",
  jurisdiction: "Local verification fixture",
  authorizationEvidence: "reviewed local capacity fixture",
  authorizationReviewedAt: "2026-07-29T00:00:00.000Z",
  robotsPolicy: "respect",
  permittedScope: ["local capacity fixture"],
  termsUrl: "https://capacity.example/terms",
  permittedUse: "index-snippet-link",
  storageRight: true,
  snippetRight: true,
  aiRetrievalRight: false,
  retentionDays: 30,
  languages: ["en"],
  freshnessSloSeconds: 3600,
  maxRequestsPerMinute: 120,
  backoffSeconds: 60,
  allowedDataClasses: ["public-docs"],
  defaultDataClass: "public-docs",
  removalUrl: "https://capacity.example/removal",
  correctionUrl: "https://capacity.example/correction",
});

for (let index = 0; index < documentCount; index += 1) {
  await store.indexDocument(source.id, {
    url: `https://capacity.example/document-${index}`,
    title: `YNX Search capacity document ${index}`,
    text: `YNX Search transparent source capacity verification document ${index}. This fixture measures bounded lexical retrieval over an explicitly public local corpus.`,
    language: "en",
    dataClass: "public-docs",
    publishedAt: "2026-07-29T00:00:00.000Z",
  });
}

const port = 45_000 + (process.pid % 1_000);
const origin = `http://127.0.0.1:${port}`;
process.env.PORT = String(port);
process.env.YNX_SEARCH_DATA_PATH = dataPath;
process.env.YNX_SEARCH_STRUCTURED_LOGS = "off";
const { server } = await import("../src/server.js");
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});

try {
  for (let index = 0; index < 5; index += 1) {
    const response = await fetch(`${origin}/api/search?q=YNX%20Search%20capacity&pageSize=10`);
    if (!response.ok) throw new Error(`capacity warmup returned ${response.status}`);
    await response.arrayBuffer();
  }

  const latencies = [];
  const statusCounts = {};
  let cursor = 0;
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, async () => {
    while (true) {
      const requestIndex = cursor;
      cursor += 1;
      if (requestIndex >= requestCount) return;
      const started = performance.now();
      const response = await fetch(`${origin}/api/search?q=YNX%20Search%20capacity&pageSize=10`);
      await response.arrayBuffer();
      latencies.push(performance.now() - started);
      statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
    }
  }));
  const durationMs = performance.now() - startedAt;
  const successful = statusCounts[200] ?? 0;
  const result = {
    schemaVersion: "1.0.0",
    product: "YNX Search",
    benchmark: "loopback-http-lexical-search",
    performedAt: new Date().toISOString(),
    sourceCommit: process.env.YNX_BUILD_COMMIT ?? null,
    scope: "local single-process Node.js service on loopback; not staging, public, or production capacity",
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    dataset: {
      sources: 1,
      documents: documentCount,
      query: "YNX Search capacity",
      pageSize: 10,
    },
    load: {
      requests: requestCount,
      concurrency: Math.min(concurrency, requestCount),
      durationMs: round(durationMs),
      throughputRequestsPerSecond: round(requestCount / (durationMs / 1_000)),
    },
    latencyMs: {
      p50: round(percentile(latencies, 0.5)),
      p95: round(percentile(latencies, 0.95)),
      p99: round(percentile(latencies, 0.99)),
      max: round(Math.max(...latencies)),
    },
    responses: {
      statusCounts,
      successful,
      errors: requestCount - successful,
    },
    result: successful === requestCount ? "pass" : "fail",
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.result !== "pass") process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
