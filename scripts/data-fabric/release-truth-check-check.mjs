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
  "product-release.json",
  "release/release-record.json",
  "release/integration/ynx-data-fabric-contract.json",
  "integration/product-event-contracts.json",
  "public-product-metadata.json",
  ".ai-bridge/current-plan.md",
  ".ai-bridge/agent-status.md",
  ".ai-bridge/decisions.md",
  ".ai-bridge/open-questions.md",
  ".ai-bridge/execution-log.jsonl",
  ".ai-bridge/full-goal-coverage.json",
  "docs/integration/INTEGRATION_HANDOFF.md",
  "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json",
  "docs/integration/DEPENDENCY_ACCEPTANCE.md",
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
    verifyReleaseTruth({ root: fixture, expectedSourceCommit });
  } catch {
    return;
  }
  throw new Error(`release truth negative vector did not fail: ${label}`);
}

try {
  verifyReleaseTruth({ root, expectedSourceCommit });
  copyFixture();
  verifyReleaseTruth({ root: fixture, expectedSourceCommit });

  expectFailure("stale source commit", () => {
    const release = readJSON("product-release.json");
    release.sourceCommit = "0000000000000000000000000000000000000000";
    writeJSON("product-release.json", release);
  });

  expectFailure("public URL without deployment evidence", () => {
    const metadata = readJSON("public-product-metadata.json");
    metadata.publicURLs.status = "https://status.invalid/ynx-data-fabric";
    writeJSON("public-product-metadata.json", metadata);
  });

  expectFailure("public state without deployment evidence", () => {
    const metadata = readJSON("public-product-metadata.json");
    metadata.releaseStatus.deployedPublic = true;
    writeJSON("public-product-metadata.json", metadata);
  });

  expectFailure("invalid coverage status", () => {
    const coverage = readJSON(".ai-bridge/full-goal-coverage.json");
    coverage.items[0].status = "looksComplete";
    writeJSON(".ai-bridge/full-goal-coverage.json", coverage);
  });

  expectFailure("fabricated remote CI success", () => {
    const release = readJSON("release/release-record.json");
    release.evidence.remoteCI.status = "completed";
    release.evidence.remoteCI.conclusion = "success";
    writeJSON("release/release-record.json", release);
  });

  process.stdout.write(`${JSON.stringify({ status: "verified", negativeVectors: 5, sourceCommit: expectedSourceCommit })}\n`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
