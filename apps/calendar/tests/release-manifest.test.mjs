import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJSON = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const release = readJSON("../product-release.json");
const rootRelease = readJSON("../../../product-release.json");
const publicMetadata = readJSON("../../../public-product-metadata.json");
const integrationContract = readJSON("../../../release/integration/calendar-contract.json");
const testVectors = readJSON("../../../docs/integration/CROSS_PRODUCT_TEST_VECTORS.json");
const coverage = readJSON("../../../.ai-bridge/full-goal-coverage.json");

test("Calendar release record exposes every acceptance state and evidence field", () => {
  for (const key of [
    "productId", "name", "branch", "commit", "version", "surfaces",
    "implementedLocal", "testedLocal", "installedLocal", "integratedCentral",
    "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned",
    "storeReleased", "publicUrls", "healthUrls", "artifactUrls", "sha256",
    "bytes", "signingClass", "minOS", "installEvidence", "centralIntegration",
    "knownLimitations", "generatedAt",
  ]) assert.ok(Object.hasOwn(release, key), `missing ${key}`);
  assert.equal(release.productId, "com.ynx.calendar");
  assert.match(release.commit, /^[0-9a-f]{40}$/);
  for (const key of ["publicUrls", "healthUrls", "artifactUrls", "installEvidence", "knownLimitations"])
    assert.ok(Array.isArray(release[key]), `${key} must be an array`);
  for (const key of ["implementedLocal", "testedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"])
    assert.equal(typeof release[key], "boolean", `${key} must be boolean`);
  if (release.downloadHosted) {
    assert.ok(release.artifactUrls.length > 0);
    assert.ok(Object.keys(release.sha256).length > 0);
    assert.ok(Object.values(release.bytes).every((value) => Number.isInteger(value) && value > 0));
    for (const url of release.artifactUrls) {
      assert.match(url, /^https:\/\//);
      const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
      assert.match(release.sha256[name], /^[0-9a-f]{64}$/, `missing digest for ${name}`);
      assert.ok(Number.isInteger(release.bytes[name]) && release.bytes[name] > 0, `missing size for ${name}`);
    }
  }
  if (!release.deployedStaging && !release.deployedPublic)
    assert.deepEqual(release.healthUrls, []);
});

test("current source and historical preview artifacts remain separated", () => {
  assert.equal(release.branch, "codex/final-calendar");
  assert.equal(release.commit, "9abb16167f3e862447d731cba91f6b37a8b82d34");
  assert.equal(release.installedLocal, false);
  assert.equal(release.downloadHosted, false);
  assert.deepEqual(release.artifactUrls, []);
  assert.equal(release.historicalPreview.sourceCommit, "e227c4f0505537b19f4588ea26478c54518f0a4c");
  assert.equal(release.historicalPreview.classification, "historical-testnet-preview-not-current-source");
  assert.equal(release.historicalPreview.downloadHosted, true);
  assert.ok(release.historicalPreview.artifactUrls.length > 0);
  assert.equal(rootRelease.sourceCommit, release.commit);
  assert.equal(rootRelease.releaseStates.installedLocal, false);
  assert.equal(rootRelease.releaseStates.downloadHosted, false);
});

test("integration contract freezes Calendar authority without claiming central acceptance", () => {
  assert.equal(integrationContract.owner, "36-calendar");
  assert.equal(integrationContract.productId, "com.ynx.calendar");
  assert.equal(integrationContract.sourceCommit, release.commit);
  assert.equal(integrationContract.calendarSchemas.recurrenceSchema.version, 1);
  assert.deepEqual(
    integrationContract.calendarSchemas.recurrenceSchema.frequencies,
    ["daily", "weekly", "monthly", "yearly"],
  );
  assert.equal(integrationContract.calendarSchemas.eventMutation.previewRequired, true);
  assert.equal(integrationContract.calendarSchemas.eventMutation.automaticReschedule, false);
  assert.equal(integrationContract.releaseStates.integratedCentral, false);
  assert.equal(integrationContract.releaseStates.deployedPublic, true);
  assert.equal(integrationContract.releaseStates.productionSigned, false);
  assert.ok(testVectors.vectors.some((vector) => vector.id === "CAL-X-003" && vector.status === "local-pass"));
  assert.ok(testVectors.vectors.some((vector) => vector.id === "CAL-X-005" && vector.status === "local-pass"));
});

test("full goal coverage is machine-readable and uses only accepted states", () => {
  const allowedStates = new Set([
    "notStarted", "inProgress", "implementedLocal", "testedLocal", "integratedCentral",
    "testnetVerified", "publicVerified", "externalBlocked", "notApplicable", "verifiedComplete",
  ]);
  const requiredFields = [
    "id", "category", "requirement", "applicability", "status", "evidence", "sourceCommit",
    "tests", "artifact", "publicProof", "blockedBy", "owner", "nextAction", "lastUpdated",
  ];
  assert.equal(coverage.overallStatus, "ACTIVE");
  assert.ok(coverage.items.length >= 25);
  for (const item of coverage.items) {
    for (const field of requiredFields) assert.ok(Object.hasOwn(item, field), `${item.id} missing ${field}`);
    assert.ok(allowedStates.has(item.status), `${item.id} has invalid status ${item.status}`);
    assert.match(item.sourceCommit, /^[0-9a-f]{40}$/);
    for (const field of ["evidence", "tests", "artifact", "publicProof", "blockedBy"])
      assert.ok(Array.isArray(item[field]), `${item.id}.${field} must be an array`);
    if (item.status === "notApplicable") {
      assert.notEqual(item.applicability, "required");
      assert.ok(item.evidence.length > 0, `${item.id} notApplicable requires evidence`);
    }
  }
});

test("public metadata is publication-safe and keeps release claims evidence-bound", () => {
  const serialized = JSON.stringify(publicMetadata);
  for (const forbidden of ["/Users/", "Worktree", "localhost", "127.0.0.1", "example.com"])
    assert.equal(serialized.includes(forbidden), false, `public metadata leaks ${forbidden}`);
  assert.equal(publicMetadata.canonicalRoute, "/dapp/calendar");
  assert.equal(publicMetadata.sourceCommit, release.commit);
  assert.equal(publicMetadata.websitePublished, true);
  assert.equal(publicMetadata.deployedPublic, true);
  assert.equal(publicMetadata.downloadHosted, false);
  assert.equal(publicMetadata.productionSigned, false);
  assert.equal(publicMetadata.storeReleased, false);
  assert.deepEqual(publicMetadata.downloads.currentSource, []);
  assert.equal(publicMetadata.downloads.historicalPreview.classification, "older test-only preview; not proof of current source");
  assert.equal(publicMetadata.locales.length, 12);
  assert.ok(publicMetadata.faq.length >= 5);
});
