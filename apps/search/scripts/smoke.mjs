import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchStore } from "../src/store.js";

const dir = await mkdtemp(join(tmpdir(), "ynx-search-smoke-"));
const dataPath = join(dir, "index.json");
const store = new SearchStore(dataPath);
const port = 44_000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const authorizationReference = "operator ticket 2026-07";
const source = await store.registerSource({
  url: "https://docs.example/",
  label: "Authorized docs",
  sourceType: "ynx-official",
  owner: "YNX Docs",
  jurisdiction: "Global public documentation",
  authorizationEvidence: authorizationReference,
  authorizationReviewedAt: "2026-07-15T00:00:00Z",
  robotsPolicy: "respect",
  permittedScope: ["public documentation"],
  termsUrl: "https://docs.example/terms",
  permittedUse: "index-snippet-link",
  storageRight: true,
  snippetRight: true,
  aiRetrievalRight: false,
  retentionDays: 365,
  languages: ["en"],
  freshnessSloSeconds: 3600,
  maxRequestsPerMinute: 30,
  backoffSeconds: 60,
  allowedDataClasses: ["public-docs"],
  defaultDataClass: "public-docs",
  removalUrl: "https://docs.example/removal",
  correctionUrl: "https://docs.example/correction",
});
await store.indexDocument(source.id, {
  url: "https://docs.example/permission",
  title: "Origin permission",
  text: "An origin permission is scoped to the exact source origin and reviewed by the user.",
});

process.env.PORT = String(port);
process.env.YNX_SEARCH_DATA_PATH = dataPath;
const { server } = await import("../src/server.js");
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});

try {
  const healthResponse = await fetch(`${origin}/api/health`);
  if (!healthResponse.ok) throw new Error(`search service health returned ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health.provider.globalCoverage !== false || health.provider.coverage !== "registered-authorized-sources-only") {
    throw new Error("provider truth contract missing");
  }
  if (!healthResponse.headers.get("x-request-id") || !healthResponse.headers.get("x-trace-id") || health.observability?.metrics !== "unavailable") {
    throw new Error("observability health contract missing");
  }

  const invalidQueryResponse = await fetch(`${origin}/api/search?q=`);
  const invalidQuery = await invalidQueryResponse.json();
  if (invalidQueryResponse.status !== 400 || !invalidQuery.errorId || invalidQueryResponse.headers.get("x-error-id") !== invalidQuery.errorId) {
    throw new Error("bounded error correlation missing");
  }

  const metricsUnavailable = await fetch(`${origin}/api/metrics`);
  if (metricsUnavailable.status !== 503) throw new Error("metrics endpoint must fail closed without operator configuration");

  const indexStatus = await (await fetch(`${origin}/api/index/status`)).json();
  const serializedStatus = JSON.stringify(indexStatus);
  if (serializedStatus.includes(authorizationReference) || serializedStatus.includes("overrideReference\"")) {
    throw new Error("public source status leaked internal authorization evidence");
  }
  if (!indexStatus.sources[0]?.authorization?.referenceDigest) throw new Error("public source status omitted evidence digest");

  const result = await (await fetch(`${origin}/api/search?q=origin%20permission`)).json();
  if (result.total !== 1 || result.results[0].sourceUrl !== "https://docs.example/permission" || result.results[0].dataClass !== "public-docs" || result.results[0].sourceUse?.permittedUse !== "index-snippet-link" || result.dataPolicyVersion !== "1.0.0" || result.sourceUsePolicyVersion !== "1.0.0" || result.inference !== false || !result.results[0].indexReceiptDigest) {
    throw new Error("search citation/index receipt smoke failed");
  }

  const aiPreviewResponse = await fetch(`${origin}/api/ai/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ query: "origin permission", filters: { aiRetrievalOnly: false } }),
  });
  if (!aiPreviewResponse.ok) throw new Error("AI retrieval policy smoke failed");
  const aiPreview = await aiPreviewResponse.json();
  if (aiPreview.sources.length !== 0) throw new Error("AI retrieval policy was overridden by user filters");

  const cross = await fetch(`${origin}/api/privacy/clear`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: "{}",
  });
  if (cross.status !== 403) throw new Error("cross-origin privacy mutation was not rejected");

  const cleared = await fetch(`${origin}/api/privacy/clear`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ walletChallenges: true, aiAudit: true }),
  });
  if (!cleared.ok) throw new Error("privacy clear smoke failed");
  console.log("search smoke ok: health, source governance redaction, cited receipt, CSRF and privacy clear");
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
