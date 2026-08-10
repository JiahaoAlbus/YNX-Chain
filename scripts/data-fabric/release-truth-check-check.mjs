#!/usr/bin/env node

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findExpectedSourceCommit, verifyReleaseTruth } from "./release-truth-check.mjs";

const root = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const expectedSourceCommit = findExpectedSourceCommit(root);
const fixture = mkdtempSync(path.join(os.tmpdir(), "ynx-data-fabric-release-truth-"));

const files = [
  "release/data-fabric/product-release.json",
  "release/data-fabric/release-record.json",
  "release/integration/ynx-data-fabric-contract.json",
  "release/data-fabric/operator-inputs.request.json",
  "integration/product-event-contracts.json",
  "release/data-fabric/public-product-metadata.json",
  "docs/data-fabric/coordination/current-plan.md",
  "docs/data-fabric/coordination/agent-status.md",
  "docs/data-fabric/coordination/decisions.md",
  "docs/data-fabric/coordination/open-questions.md",
  "docs/data-fabric/coordination/execution-log.jsonl",
  "release/data-fabric/full-goal-coverage.json",
  "docs/data-fabric/integration/INTEGRATION_HANDOFF.md",
  "docs/data-fabric/integration/CROSS_PRODUCT_TEST_VECTORS.json",
  "docs/data-fabric/integration/DEPENDENCY_ACCEPTANCE.md",
];

function copyFixture() {
  for (const relativePath of files) {
    const target = path.join(fixture, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, relativePath), target);
  }
}

function readJSON(relativePath) {
  return JSON.parse(readFileSync(path.join(fixture, relativePath), "utf8"));
}

function writeJSON(relativePath, value) {
  writeFileSync(path.join(fixture, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function expectFailure(label, mutation) {
  copyFixture();
  mutation();
  try {
    verifyReleaseTruth({ root: fixture, expectedSourceCommit, repositoryRoot: root });
  } catch {
    return;
  }
  throw new Error(`release truth negative vector did not fail: ${label}`);
}

try {
  verifyReleaseTruth({ root, expectedSourceCommit });
  copyFixture();
  verifyReleaseTruth({ root: fixture, expectedSourceCommit, repositoryRoot: root });

  expectFailure("stale source commit", () => {
    const release = readJSON("release/data-fabric/product-release.json");
    release.sourceCommit = "0000000000000000000000000000000000000000";
    writeJSON("release/data-fabric/product-release.json", release);
  });

  expectFailure("public URL without deployment evidence", () => {
    const metadata = readJSON("release/data-fabric/public-product-metadata.json");
    metadata.publicURLs.status = "https://status.invalid/ynx-data-fabric";
    writeJSON("release/data-fabric/public-product-metadata.json", metadata);
  });

  expectFailure("public state without deployment evidence", () => {
    const metadata = readJSON("release/data-fabric/public-product-metadata.json");
    metadata.releaseStatus.deployedPublic = true;
    writeJSON("release/data-fabric/public-product-metadata.json", metadata);
  });

  expectFailure("invalid coverage status", () => {
    const coverage = readJSON("release/data-fabric/full-goal-coverage.json");
    coverage.items[0].status = "looksComplete";
    writeJSON("release/data-fabric/full-goal-coverage.json", coverage);
  });

  expectFailure("invalid remote CI ancestry", () => {
    const release = readJSON("release/data-fabric/release-record.json");
    release.evidence.remoteCI.headCommit = "0000000000000000000000000000000000000000";
    writeJSON("release/data-fabric/release-record.json", release);
  });

  process.stdout.write(`${JSON.stringify({ status: "verified", negativeVectors: 5, sourceCommit: expectedSourceCommit })}\n`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
