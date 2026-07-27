#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const [sourceCommit, output = ""] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(sourceCommit || "")) {
  console.error("usage: bridge-migration-evidence.mjs <source-commit> [output]");
  process.exit(2);
}

const requiredTests = [
  "TestBridgeV1StateMigratesOnlyAfterLegacyIntegrityVerification",
  "TestBridgeV2StateMigratesToCurrentSchema",
  "TestBridgeV3StateMigratesLifecycleWithHonestCoverage",
  "TestBridgeV4MigrationPreservesResolvedExposureThroughDispute",
  "TestBridgeV5ReconciliationReplayMigratesFailClosed",
  "TestBridgeV6LifecycleMigratesWithoutInventingDestinationAvailability",
  "TestBridgeV6RollbackBackupForwardRecoversDeterministically",
  "TestBridgeResealedInvalidLifecycleIsRejected",
  "TestBridgeResealedAttestationAndIndexForgeryIsRejected"
];
const testPattern = `^(${requiredTests.join("|")})$`;
const args = ["test", "-json", "-count=1", "-race", "-run", testPattern, "./internal/bridgegateway"];
const startedAt = performance.now();
const result = spawnSync("go", args, { encoding: "utf8", maxBuffer: 16 << 20 });
const durationMs = performance.now() - startedAt;
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.stderr.write(result.stderr || "");
  process.stderr.write(result.stdout || "");
  throw new Error(`bridge migration test process exited ${result.status}`);
}

const events = [];
for (const line of result.stdout.split("\n")) {
  if (!line.trim()) continue;
  events.push(JSON.parse(line));
}
const passedTests = [...new Set(events.filter(event => event.Action === "pass" && event.Test).map(event => event.Test))].sort();
const missing = requiredTests.filter(name => !passedTests.includes(name));
if (missing.length) {
  throw new Error(`bridge migration evidence omitted required tests: ${missing.join(", ")}`);
}
const packagePassed = events.some(event => event.Action === "pass" && event.Package === "github.com/JiahaoAlbus/YNX-Chain/internal/bridgegateway" && !event.Test);
if (!packagePassed) {
  throw new Error("bridge migration package did not report a passing result");
}

const report = {
  schemaVersion: 1,
  sourceCommit,
  generatedAt: new Date().toISOString(),
  classification: "bounded-local-migration-and-rollback-rehearsal",
  command: `go ${args.join(" ")}`,
  raceDetector: true,
  result: "passed",
  durationMs,
  testCount: passedTests.length,
  tests: passedTests,
  rawOutputSha256: crypto.createHash("sha256").update(result.stdout).digest("hex"),
  rollbackPolicy: {
    mutationFreezeRequired: true,
    exactPreMigrationBackupRequired: true,
    backwardsStateConversionAllowed: false,
    postUpgradeMutationRollbackAllowed: false,
    deterministicForwardRecoveryVerified: true,
    acceptedMutationLoss: 0
  },
  coverage: {
    legacySchemas: [1, 2, 3, 4, 5, 6],
    currentSchema: 7,
    integrityVerifiedBeforeMigration: true,
    auditChainVerifiedBeforeMigration: true,
    destinationConfirmationDoesNotImplyAvailability: true,
    tamperRejected: true,
    remoteMigration: false
  }
};

if (output) {
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(JSON.stringify(report));
}
console.log(`bridge migration evidence passed: tests=${passedTests.length} durationMs=${durationMs.toFixed(2)} outputSha256=${report.rawOutputSha256}`);
