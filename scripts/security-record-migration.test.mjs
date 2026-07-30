import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  migrateFile,
  migrateRecord,
  validateMigrationPlan,
} from "./security-record-migration.mjs";

const plan = {
  schemaVersion: 1,
  id: "security-platform-status-v1-v2",
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  owner: "30-security-sre-release",
  deprecationDate: "2027-07-29",
  oldClientBehavior: "compatible-additive",
  minimumReaderSchemaVersion: 1,
  securitySemanticsChanged: false,
};

function record() {
  return {
    schemaVersion: 1,
    sourceCommit: "900c314ddb8f6f56b8713e7df194f26ee0590e06",
    states: { implementedLocal: true, deployedPublic: false },
    extensionOwnedByFutureReader: { nested: ["preserve", { exact: true }] },
  };
}

test("forward migration is additive, deterministic, and reports checksums and object counts", () => {
  const first = migrateRecord({ record: record(), plan, direction: "forward" });
  const second = migrateRecord({ record: record(), plan, direction: "forward" });
  assert.deepEqual(first, second);
  assert.equal(first.record.schemaVersion, 2);
  assert.deepEqual(first.record.extensionOwnedByFutureReader, record().extensionOwnedByFutureReader);
  assert.equal(first.record.migrationCompatibility.minimumReaderSchemaVersion, 1);
  assert.match(first.report.before.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.report.after.sha256, /^[0-9a-f]{64}$/);
  assert.ok(first.report.after.objectCount > first.report.before.objectCount);
  assert.equal(first.report.mutated, false);
});

test("rollback restores the exact prior object while preserving additive fields", () => {
  const forward = migrateRecord({ record: record(), plan, direction: "forward" }).record;
  forward.extensionAddedAfterMigration = { retained: true };
  const rollback = migrateRecord({ record: forward, plan, direction: "rollback" }).record;
  assert.equal(rollback.schemaVersion, 1);
  assert.deepEqual(rollback.extensionOwnedByFutureReader, record().extensionOwnedByFutureReader);
  assert.deepEqual(rollback.extensionAddedAfterMigration, { retained: true });
  assert.equal("migrationCompatibility" in rollback, false);
});

test("unknown schema versions and unrelated rollback markers fail closed", () => {
  assert.throws(
    () => migrateRecord({ record: { ...record(), schemaVersion: 9 }, plan, direction: "forward" }),
    /unknown or unsupported schemaVersion/,
  );
  const migrated = migrateRecord({ record: record(), plan, direction: "forward" }).record;
  migrated.migrationCompatibility.planId = "other-plan";
  assert.throws(
    () => migrateRecord({ record: migrated, plan, direction: "rollback" }),
    /not bound to the selected migration plan/,
  );
});

test("security semantic changes require a fail-closed minimum-client gate", () => {
  assert.throws(
    () => validateMigrationPlan({ ...plan, securitySemanticsChanged: true }),
    /fail-closed minimum-client gate/,
  );
  assert.doesNotThrow(() => validateMigrationPlan({
    ...plan,
    securitySemanticsChanged: true,
    oldClientBehavior: "fail-closed-minimum-client",
    minimumReaderSchemaVersion: 2,
  }));
});

test("rollback is prohibited after an irreversible business event", () => {
  const migrated = migrateRecord({ record: record(), plan, direction: "forward" }).record;
  migrated.migrationCompatibility.irreversibleEvents.push("production-signature-published");
  assert.throws(
    () => migrateRecord({ record: migrated, plan, direction: "rollback" }),
    /rollback prohibited/,
  );
});

test("dry-run performs no file or backup mutation", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "ynx-record-migration-dry-"));
  try {
    const input = resolve(workspace, "record.json");
    const planPath = resolve(workspace, "plan.json");
    const backup = resolve(workspace, "record.backup.json");
    writeFileSync(input, `${JSON.stringify(record())}\n`);
    writeFileSync(planPath, `${JSON.stringify(plan)}\n`);
    const before = readFileSync(input, "utf8");
    const result = migrateFile({ inputPath: input, planPath, backupPath: backup, direction: "forward", dryRun: true });
    assert.equal(readFileSync(input, "utf8"), before);
    assert.equal(result.report.backup, null);
    assert.equal(result.report.mutated, false);
    assert.throws(() => readFileSync(backup), /ENOENT/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("apply creates an exact exclusive backup before atomic mutation", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "ynx-record-migration-apply-"));
  try {
    const input = resolve(workspace, "record.json");
    const planPath = resolve(workspace, "plan.json");
    const backup = resolve(workspace, "record.backup.json");
    const source = `${JSON.stringify(record(), null, 2)}\n`;
    writeFileSync(input, source);
    writeFileSync(planPath, `${JSON.stringify(plan)}\n`);
    const result = migrateFile({ inputPath: input, planPath, backupPath: backup, direction: "forward", dryRun: false });
    assert.equal(readFileSync(backup, "utf8"), source);
    assert.equal(JSON.parse(readFileSync(input, "utf8")).schemaVersion, 2);
    assert.equal(result.report.backup.createdBeforeMutation, true);
    assert.equal(result.report.mutated, true);
    assert.throws(
      () => migrateFile({ inputPath: backup, outputPath: backup, planPath, backupPath: input, direction: "forward", dryRun: false }),
      /EEXIST/,
    );
    assert.throws(
      () => migrateFile({ inputPath: backup, outputPath: input, planPath, backupPath: backup, direction: "forward", dryRun: false }),
      /backupPath must differ/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
