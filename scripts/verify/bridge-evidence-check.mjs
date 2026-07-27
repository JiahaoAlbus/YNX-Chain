#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const capacity = read("docs/bridge/capacity-evidence.json");
const restore = read("docs/bridge/restore-evidence.json");
const migration = read("docs/bridge/migration-rollback-evidence.json");
const fail = message => { throw new Error(message); };

if (capacity.classification !== "bounded-local-measurement-not-production-capacity" || capacity.remoteMeasured !== false || capacity.providerLatencyMeasured !== false || capacity.destinationLatencyMeasured !== false) fail("capacity scope overclaim");
if (capacity.state?.transferCount !== 100 || capacity.state?.growthBytes <= 0 || capacity.coldStartMs <= 0) fail("capacity state evidence invalid");
for (const sample of capacity.samples || []) {
  if (sample.total !== sample.successes || sample.failures !== 0 || sample.errorRate !== 0 || sample.latencyMs?.p50 <= 0 || sample.latencyMs?.p95 < sample.latencyMs?.p50 || sample.latencyMs?.p99 < sample.latencyMs?.p95 || sample.throughputPerSecond <= 0) fail(`capacity sample invalid: ${sample.name}`);
}

if (restore.classification !== "bounded-local-restore-drill" || restore.corruptionRejected !== true || restore.rpoAcceptedMutationLoss !== 0 || restore.remoteRestore !== false || restore.backup?.mode !== "600" || !/^[0-9a-f]{64}$/.test(restore.backup?.sha256 || "") || restore.restoreToHealthMs <= 0) fail("restore evidence invalid");
if (restore.restored?.transferCount !== 1 || restore.restored?.paused !== true || restore.restored?.coordinatorOutstanding !== "100" || restore.restored?.reconciliationBalanced !== true) fail("restored semantics invalid");

if (migration.classification !== "bounded-local-migration-and-rollback-rehearsal" || migration.result !== "passed" || migration.raceDetector !== true || migration.testCount < 9 || !/^[0-9a-f]{64}$/.test(migration.rawOutputSha256 || "")) fail("migration evidence invalid");
if (migration.rollbackPolicy?.mutationFreezeRequired !== true || migration.rollbackPolicy?.exactPreMigrationBackupRequired !== true || migration.rollbackPolicy?.backwardsStateConversionAllowed !== false || migration.rollbackPolicy?.postUpgradeMutationRollbackAllowed !== false || migration.rollbackPolicy?.deterministicForwardRecoveryVerified !== true || migration.rollbackPolicy?.acceptedMutationLoss !== 0) fail("migration rollback policy is unsafe");
if (JSON.stringify(migration.coverage?.legacySchemas) !== JSON.stringify([1, 2, 3, 4, 5, 6]) || migration.coverage?.currentSchema !== 7 || migration.coverage?.integrityVerifiedBeforeMigration !== true || migration.coverage?.auditChainVerifiedBeforeMigration !== true || migration.coverage?.destinationConfirmationDoesNotImplyAvailability !== true || migration.coverage?.tamperRejected !== true || migration.coverage?.remoteMigration !== false) fail("migration coverage overclaim or omission");
for (const required of [
  "TestBridgeV1StateMigratesOnlyAfterLegacyIntegrityVerification",
  "TestBridgeV2StateMigratesToCurrentSchema",
  "TestBridgeV3StateMigratesLifecycleWithHonestCoverage",
  "TestBridgeV4MigrationPreservesResolvedExposureThroughDispute",
  "TestBridgeV5ReconciliationReplayMigratesFailClosed",
  "TestBridgeV6LifecycleMigratesWithoutInventingDestinationAvailability",
  "TestBridgeV6RollbackBackupForwardRecoversDeterministically",
  "TestBridgeResealedInvalidLifecycleIsRejected",
  "TestBridgeResealedAttestationAndIndexForgeryIsRejected"
]) {
  if (!(migration.tests || []).includes(required)) fail(`migration evidence missing required test: ${required}`);
}

for (const commit of [capacity.sourceCommit, restore.sourceCommit, migration.sourceCommit]) {
  if (!/^[0-9a-f]{40}$/.test(commit || "")) fail("evidence source commit invalid");
  const result = spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"]);
  if (result.status !== 0) fail(`evidence source is not an ancestor: ${commit}`);
}

console.log(`bridge evidence check passed: capacity source=${capacity.sourceCommit.slice(0, 12)} restore source=${restore.sourceCommit.slice(0, 12)} migration source=${migration.sourceCommit.slice(0, 12)} zero request failures, corruption rejected, local RPO=0, deterministic rollback/forward recovery verified`);
