import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-economics-local-testnet-"));
const storePath = path.join(directory, "state", "integration.json");
const evidencePath = path.join(directory, "evidence", "local-testnet.json");
const sourceCommit = "72591ce6ab9eb4ae7878fcf6369c9aac37e7fba9";

try {
  runJSON("go", [
    "run",
    "./cmd/ynx-economics-integration-store",
    "-state",
    storePath,
    "-economics-input",
    "economics/examples/runtime-replay.json",
    "-staking-input",
    "economics/examples/staking-risk-runtime-replay.json",
    "-source-commit",
    sourceCommit,
    "-ingested-at",
    "2026-08-04T00:00:00Z",
    "-summary",
  ]);

  const args = [
    "run",
    "./cmd/ynx-economics-local-testnet-evidence",
    "-store",
    storePath,
    "-source-commit",
    sourceCommit,
    "-generated-at",
    "2026-08-04T01:00:00Z",
    "-height",
    "6423",
    "-nonce",
    "1",
    "-out",
    evidencePath,
    "-summary",
  ];
  const first = runJSON("go", args);
  assert.equal(first.evidenceClass, "local-testnet-simulation");
  assert.equal(first.sourceCommit, sourceCommit);
  assert.equal(first.blockHeight, 6423);
  assert.equal(first.receiptStatus, "simulated-committed");
  assert.equal(first.explorerProofs, 5);
  assert.equal(first.monitorProofs, 15);
  assert.equal(first.sharedTestnet, false);
  assert.equal(first.publicDeployment, false);
  assert.equal(first.production, false);
  assert.deepEqual(first.recordCounts, {
    envelopes: 5,
    billingLedger: 18,
    explorer: 5,
    monitor: 15,
  });
  assert.match(first.transactionId, /^econ-local-tx-[0-9a-f]{64}$/);
  assert.match(first.blockHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.evidenceHash, /^sha256:[0-9a-f]{64}$/);

  const mode = fs.statSync(evidencePath).mode & 0o777;
  assert.equal(mode, 0o600, `local Testnet evidence mode was ${mode.toString(8)}`);
  const persisted = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.equal(persisted.evidenceClass, "local-testnet-simulation");
  assert.equal(persisted.transaction.id, first.transactionId);
  assert.equal(persisted.block.hash, first.blockHash);
  assert.equal(persisted.receipt.status, "simulated-committed");
  assert.equal(persisted.receipt.finality, "local-deterministic-simulation");
  assert.equal(persisted.sharedTestnet, false);
  assert.equal(persisted.publicDeployment, false);
  assert.equal(persisted.production, false);
  assert.equal(persisted.releaseStates.integratedCentral, false);
  assert.equal(persisted.releaseStates.deployedPublic, false);
  assert.equal(persisted.explorer.length, 5);
  assert.equal(persisted.monitor.length, 15);

  const second = runJSON("go", args);
  assert.deepEqual(second, first, "deterministic evidence replay changed the summary");
  console.log(`economics local Testnet evidence verified: tx=${first.transactionId} block=${first.blockHash} evidence=${first.evidenceHash} sharedTestnet=false`);
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
