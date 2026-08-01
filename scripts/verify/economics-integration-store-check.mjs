import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-economics-integration-store-"));
const statePath = path.join(directory, "state", "integration.json");
const sourceCommit = "72591ce6ab9eb4ae7878fcf6369c9aac37e7fba9";
const args = [
  "run",
  "./cmd/ynx-economics-integration-store",
  "-state",
  statePath,
  "-economics-input",
  "economics/examples/runtime-replay.json",
  "-staking-input",
  "economics/examples/staking-risk-runtime-replay.json",
  "-safety-input",
  "economics/examples/safety-module-runtime-replay.json",
  "-source-commit",
  sourceCommit,
  "-ingested-at",
  "2026-08-04T00:00:00Z",
  "-summary",
];

try {
  const first = runJSON("go", args);
  assert.equal(first.contractId, "ynx.economics.integration.v1");
  assert.equal(first.sourceCommit, sourceCommit);
  assert.equal(first.applied, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.revision, 2);
  assert.equal(first.acceptedBundles, 1);
  assert.deepEqual(first.recordCounts, {
    envelopes: 8,
    billingLedger: 18,
    explorer: 8,
    monitor: 24,
  });
  assert.match(first.bundleHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.safetyStateHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.storeStateHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.receiptAuditHash, /^sha256:[0-9a-f]{64}$/);

  const mode = fs.statSync(statePath).mode & 0o777;
  assert.equal(mode, 0o600, `integration store mode was ${mode.toString(8)}`);

  const second = runJSON("go", args);
  assert.equal(second.applied, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.revision, first.revision);
  assert.equal(second.acceptedBundles, first.acceptedBundles);
  assert.deepEqual(second.recordCounts, first.recordCounts);
  assert.equal(second.bundleHash, first.bundleHash);
  assert.equal(second.storeStateHash, first.storeStateHash);
  assert.notEqual(second.receiptAuditHash, first.receiptAuditHash);
  assert.match(second.receiptAuditHash, /^sha256:[0-9a-f]{64}$/);

  const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.contractId, "ynx.economics.integration.v1");
  assert.equal(persisted.revision, 2);
  assert.equal(persisted.acceptedBundles.length, 1);
  assert.match(persisted.acceptedBundles[0].safetyStateHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(persisted.auditEvents.length, 1);
  assert.equal(persisted.envelopes.length, 8);
  assert.equal(persisted.billingLedger.length, 18);
  assert.equal(persisted.explorer.length, 8);
  assert.equal(persisted.monitor.length, 24);
  assert.equal(persisted.stateHash, first.storeStateHash);

  console.log(`economics integration store verified: source=${sourceCommit} bundle=${first.bundleHash} state=${first.storeStateHash} records=8/18/8/24 safety=true`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

function runJSON(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed`);
  return JSON.parse(result.stdout);
}
