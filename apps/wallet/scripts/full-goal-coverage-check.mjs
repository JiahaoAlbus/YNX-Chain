import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const walletRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(walletRoot, "../..");
const matrixPath = path.join(repoRoot, ".ai-bridge", "full-goal-coverage.json");
const matrix = JSON.parse(await readFile(matrixPath, "utf8"));

const allowedStatuses = new Set([
  "notStarted",
  "inProgress",
  "implementedLocal",
  "testedLocal",
  "integratedCentral",
  "testnetVerified",
  "publicVerified",
  "externalBlocked",
  "notApplicable",
  "verifiedComplete",
]);

assert.equal(matrix.productNumber, "02");
assert.equal(matrix.productSlug, "wallet-auth");
assert.equal(matrix.branch, "codex/final-wallet-auth");
assert.ok(Array.isArray(matrix.items) && matrix.items.length > 0);

const ids = new Set();
const counts = {};
for (const item of matrix.items) {
  assert.ok(item.id && !ids.has(item.id), `duplicate or missing coverage id: ${item.id}`);
  ids.add(item.id);
  assert.ok(item.category, `${item.id}: missing category`);
  assert.ok(item.requirement, `${item.id}: missing requirement`);
  assert.equal(typeof item.applicability, "boolean", `${item.id}: applicability must be boolean`);
  assert.ok(allowedStatuses.has(item.status), `${item.id}: unsupported status ${item.status}`);
  assert.ok(Array.isArray(item.evidence), `${item.id}: evidence must be an array`);
  assert.ok(Array.isArray(item.tests), `${item.id}: tests must be an array`);
  assert.ok(Array.isArray(item.blockedBy), `${item.id}: blockedBy must be an array`);
  assert.ok(item.owner, `${item.id}: missing owner`);
  assert.ok(item.nextAction, `${item.id}: missing nextAction`);
  assert.match(item.lastUpdated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `${item.id}: invalid lastUpdated`);
  assert.match(item.sourceCommit, /^[0-9a-f]{40}$/, `${item.id}: invalid sourceCommit`);

  if (item.status === "externalBlocked") {
    assert.ok(item.blockedBy.length > 0, `${item.id}: externalBlocked requires a concrete blocker`);
  }
  if (item.status === "notApplicable") {
    assert.equal(item.applicability, false, `${item.id}: notApplicable requires applicability=false`);
    assert.ok(item.nextAction.length >= 24, `${item.id}: notApplicable requires a product rationale`);
  } else {
    assert.equal(item.applicability, true, `${item.id}: applicable status requires applicability=true`);
  }

  for (const evidence of item.evidence) {
    if (/^https?:\/\//.test(evidence)) continue;
    await access(path.join(repoRoot, evidence));
  }
  counts[item.status] = (counts[item.status] ?? 0) + 1;
}

for (const status of allowedStatuses) {
  assert.equal(
    matrix.summary?.[status] ?? 0,
    counts[status] ?? 0,
    `summary count mismatch for ${status}`,
  );
}

assert.equal(
  Object.values(matrix.summary).reduce((sum, value) => sum + value, 0),
  matrix.items.length,
  "coverage summary must count every item exactly once",
);

const authPackage = JSON.parse(
  await readFile(path.join(repoRoot, "packages", "wallet-auth", "package.json"), "utf8"),
);
assert.equal(
  authPackage.bin?.["ynx-wallet-gatewayd"],
  "scripts/ynx-wallet-gatewayd.mjs",
  "canonical Gateway CLI bin mapping changed",
);
const gatewayCliPath = path.join(
  repoRoot,
  "packages",
  "wallet-auth",
  "scripts",
  "ynx-wallet-gatewayd.mjs",
);
const gatewayCli = await readFile(gatewayCliPath, "utf8");
assert.ok(gatewayCli.startsWith("#!/usr/bin/env node\n"), "Gateway CLI must retain its Node shebang");
const gatewayCliMode = (await stat(gatewayCliPath)).mode & 0o777;
assert.equal(gatewayCliMode & 0o100, 0o100, "Gateway CLI owner execute bit is required for npm bin packaging");

console.log(
  `wallet full-goal coverage verified: ${matrix.items.length} unique requirements with valid states, blockers and evidence paths`,
);
