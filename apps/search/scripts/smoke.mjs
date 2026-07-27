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
  aiRetrievalRight: true,
  retentionDays: 365,
  languages: ["en"],
  freshnessSloSeconds: 3600,
  maxRequestsPerMinute: 30,
  backoffSeconds: 60,
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

  const indexStatus = await (await fetch(`${origin}/api/index/status`)).json();
  const serializedStatus = JSON.stringify(indexStatus);
  if (serializedStatus.includes(authorizationReference) || serializedStatus.includes("overrideReference\"")) {
    throw new Error("public source status leaked internal authorization evidence");
  }
  if (!indexStatus.sources[0]?.authorization?.referenceDigest) throw new Error("public source status omitted evidence digest");

  const result = await (await fetch(`${origin}/api/search?q=origin%20permission`)).json();
  if (result.total !== 1 || result.results[0].sourceUrl !== "https://docs.example/permission" || result.inference !== false || !result.results[0].indexReceiptDigest) {
    throw new Error("search citation/index receipt smoke failed");
  }

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
