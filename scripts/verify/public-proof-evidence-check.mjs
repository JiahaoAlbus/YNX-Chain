#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const requiredChecks = [
  "rpc.status.chain",
  "rpc.status.height.growth",
  "rpc.validators.count",
  "rpc.validators.addresses",
  "rpc.validators.monikers",
  "evm.eth_chainId.result",
  "evm.eth_blockNumber.result",
  "rest.status.chain",
  "grpc.endpoint",
  "governance.requestValidityRules.required",
  "governance.transparency.initial.report",
  "faucet.health.chain",
  "faucet.health.native",
  "faucet.request.tx",
  "indexer.overview.chain",
  "indexer.overview.native",
  "explorer.health.truthful",
  "explorer.summary.chain",
  "explorer.summary.native",
  "explorer.summary.validators",
  "explorer.faucetTx.hash",
  "ai.health.truthful",
  "web4.health.truthful",
  "pay.intent.created",
  "trust.trace.address",
  "governance.request.illegal.classification",
  "governance.request.illegal.nativeYnxtProtected",
  "governance.request.review.classification",
  "governance.request.review.lookup.id",
  "governance.request.review.markReviewed.status",
  "governance.request.manualReject.status",
  "governance.request.notice.classification",
  "trust.appeal.open.status",
  "trust.appeal.lookup.id",
  "trust.appeal.resolve.status",
  "trust.trackingReview.valid.classification",
  "trust.trackingReview.overbroad.classification",
  "governance.transparency.final.report",
  "resource.quote.available",
  "ide.compile.ok",
];

function parseArgs(argv) {
  const args = { evidencePath: "", outPath: "", selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--out") {
      args.outPath = argv[i + 1] || "";
      i += 1;
    } else if (!args.evidencePath) {
      args.evidencePath = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateEvidence(evidence) {
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];
  const byName = new Map();
  for (const check of checks) {
    if (typeof check?.name === "string") byName.set(check.name, check);
  }
  const missingRequiredChecks = requiredChecks.filter((name) => !byName.has(name));
  const failedChecks = checks.filter((check) => !check?.ok).map((check) => check?.name || "unnamed-check");
  const failedRequiredChecks = requiredChecks.filter((name) => byName.has(name) && !byName.get(name)?.ok);
  const skippedMutableActions = byName.has("mutable.remote.actions");
  const validPublicProof = evidence?.status === "passed" &&
    missingRequiredChecks.length === 0 &&
    failedChecks.length === 0 &&
    failedRequiredChecks.length === 0 &&
    !skippedMutableActions;
  return {
    validPublicProof,
    evidenceStatus: evidence?.status || "missing",
    requiredCheckCount: requiredChecks.length,
    observedCheckCount: checks.length,
    missingRequiredChecks,
    failedRequiredChecks,
    failedChecks,
    skippedMutableActions,
    requiredChecks,
  };
}

function writeReport(file, report) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

function buildFixture({ status = "passed", omit = [], fail = [], includeSkipped = false } = {}) {
  const omitSet = new Set(omit);
  const failSet = new Set(fail);
  const checks = requiredChecks
    .filter((name) => !omitSet.has(name))
    .map((name) => ({ name, ok: !failSet.has(name), detail: failSet.has(name) ? "fixture failure" : "fixture ok" }));
  if (includeSkipped) checks.push({ name: "mutable.remote.actions", ok: false, detail: "fixture skipped" });
  return { status, checks };
}

function selfTest() {
  const valid = validateEvidence(buildFixture());
  assert.equal(valid.validPublicProof, true, "complete passed fixture should be valid");
  const missing = validateEvidence(buildFixture({ omit: ["trust.appeal.resolve.status"] }));
  assert.equal(missing.validPublicProof, false, "missing appeal resolution proof must be invalid");
  assert(missing.missingRequiredChecks.includes("trust.appeal.resolve.status"));
  const failed = validateEvidence(buildFixture({ fail: ["governance.request.illegal.nativeYnxtProtected"] }));
  assert.equal(failed.validPublicProof, false, "failed native YNXT protection proof must be invalid");
  assert(failed.failedRequiredChecks.includes("governance.request.illegal.nativeYnxtProtected"));
  const skipped = validateEvidence(buildFixture({ includeSkipped: true }));
  assert.equal(skipped.validPublicProof, false, "skipped mutable remote actions must be invalid");
  assert.equal(skipped.skippedMutableActions, true);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-public-proof-check-"));
  const out = path.join(tmp, "report.json");
  writeReport(out, valid);
  assert.equal(readJson(out).validPublicProof, true, "report should be written");
  console.log("public-proof-evidence-check self-test passed");
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  selfTest();
  process.exit(0);
}

const evidencePath = args.evidencePath || process.env.YNX_REMOTE_EVIDENCE_PATH || "tmp/verify-testnet/remote-evidence.json";
const report = validateEvidence(readJson(evidencePath));
writeReport(args.outPath, report);
if (!report.validPublicProof) {
  console.error(`public-proof evidence invalid: ${evidencePath}`);
  if (report.missingRequiredChecks.length) console.error(`missing required checks: ${report.missingRequiredChecks.join(", ")}`);
  if (report.failedRequiredChecks.length) console.error(`failed required checks: ${report.failedRequiredChecks.join(", ")}`);
  if (report.failedChecks.length) console.error(`failed checks: ${report.failedChecks.join(", ")}`);
  if (report.skippedMutableActions) console.error("mutable remote actions were skipped");
  process.exit(1);
}
console.log(`public-proof evidence valid: ${evidencePath}`);
