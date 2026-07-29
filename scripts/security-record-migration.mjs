#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directions = new Set(["forward", "rollback"]);

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha256").update(bytes).digest("hex");
}

function serialized(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function objectCount(value) {
  if (Array.isArray(value)) return 1 + value.reduce((total, item) => total + objectCount(item), 0);
  if (value && typeof value === "object") {
    return 1 + Object.values(value).reduce((total, item) => total + objectCount(item), 0);
  }
  return 0;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
}

export function validateMigrationPlan(plan) {
  if (plan?.schemaVersion !== 1) throw new Error("migration plan schemaVersion must be 1");
  requireString(plan.id, "migration plan id");
  requireString(plan.owner, "migration plan owner");
  requireString(plan.deprecationDate, "migration plan deprecationDate");
  if (!Number.isInteger(plan.fromSchemaVersion) || !Number.isInteger(plan.toSchemaVersion)) {
    throw new Error("migration plan versions must be integers");
  }
  if (plan.toSchemaVersion !== plan.fromSchemaVersion + 1) {
    throw new Error("migration plan must advance exactly one schema version");
  }
  if (!["compatible-additive", "fail-closed-minimum-client"].includes(plan.oldClientBehavior)) {
    throw new Error("migration plan oldClientBehavior is invalid");
  }
  if (typeof plan.securitySemanticsChanged !== "boolean") {
    throw new Error("migration plan securitySemanticsChanged must be boolean");
  }
  if (!Number.isInteger(plan.minimumReaderSchemaVersion) || plan.minimumReaderSchemaVersion < 1) {
    throw new Error("migration plan minimumReaderSchemaVersion must be a positive integer");
  }
  if (plan.securitySemanticsChanged) {
    if (
      plan.oldClientBehavior !== "fail-closed-minimum-client"
      || plan.minimumReaderSchemaVersion < plan.toSchemaVersion
    ) {
      throw new Error("security semantic changes require a fail-closed minimum-client gate");
    }
  } else if (
    plan.oldClientBehavior !== "compatible-additive"
    || plan.minimumReaderSchemaVersion > plan.fromSchemaVersion
  ) {
    throw new Error("additive compatibility must remain readable by the prior schema reader");
  }
  return plan;
}

function validateRecordVersion(record, expected) {
  if (!Number.isInteger(record?.schemaVersion)) throw new Error("record schemaVersion must be an integer");
  if (record.schemaVersion !== expected) {
    throw new Error(`unknown or unsupported schemaVersion ${record.schemaVersion}; expected ${expected}`);
  }
}

export function migrateRecord({ record, plan, direction, dryRun = true }) {
  validateMigrationPlan(plan);
  if (!directions.has(direction)) throw new Error("direction must be forward or rollback");
  const before = structuredClone(record);
  let after;

  if (direction === "forward") {
    validateRecordVersion(before, plan.fromSchemaVersion);
    if (before.migrationCompatibility !== undefined) {
      throw new Error("source record already contains migrationCompatibility");
    }
    after = {
      ...before,
      schemaVersion: plan.toSchemaVersion,
      migrationCompatibility: {
        planId: plan.id,
        fromSchemaVersion: plan.fromSchemaVersion,
        toSchemaVersion: plan.toSchemaVersion,
        owner: plan.owner,
        deprecationDate: plan.deprecationDate,
        oldClientBehavior: plan.oldClientBehavior,
        minimumReaderSchemaVersion: plan.minimumReaderSchemaVersion,
        securitySemanticsChanged: plan.securitySemanticsChanged,
        irreversibleEvents: [],
      },
    };
  } else {
    validateRecordVersion(before, plan.toSchemaVersion);
    const marker = before.migrationCompatibility;
    if (
      marker?.planId !== plan.id
      || marker.fromSchemaVersion !== plan.fromSchemaVersion
      || marker.toSchemaVersion !== plan.toSchemaVersion
    ) {
      throw new Error("rollback record is not bound to the selected migration plan");
    }
    if (!Array.isArray(marker.irreversibleEvents)) {
      throw new Error("rollback record must declare irreversibleEvents");
    }
    if (marker.irreversibleEvents.length > 0) {
      throw new Error("rollback prohibited after an irreversible business event");
    }
    const { migrationCompatibility: ignored, ...preserved } = before;
    after = {
      ...preserved,
      schemaVersion: plan.fromSchemaVersion,
    };
  }

  const beforeBytes = serialized(before);
  const afterBytes = serialized(after);
  return {
    record: after,
    report: {
      schemaVersion: 1,
      migrationId: plan.id,
      owner: plan.owner,
      direction,
      dryRun,
      fromSchemaVersion: before.schemaVersion,
      toSchemaVersion: after.schemaVersion,
      oldClientBehavior: plan.oldClientBehavior,
      minimumReaderSchemaVersion: plan.minimumReaderSchemaVersion,
      securitySemanticsChanged: plan.securitySemanticsChanged,
      deprecationDate: plan.deprecationDate,
      before: {
        bytes: Buffer.byteLength(beforeBytes),
        sha256: digest(beforeBytes),
        objectCount: objectCount(before),
      },
      after: {
        bytes: Buffer.byteLength(afterBytes),
        sha256: digest(afterBytes),
        objectCount: objectCount(after),
      },
      unknownAdditiveFieldsPreserved: true,
      backup: null,
      mutated: !dryRun,
    },
  };
}

export function migrateFile({
  inputPath,
  outputPath = inputPath,
  backupPath,
  planPath,
  direction,
  dryRun = true,
}) {
  for (const [value, label] of [[inputPath, "inputPath"], [planPath, "planPath"]]) requireString(value, label);
  if (!dryRun) requireString(backupPath, "backupPath");
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  const plan = JSON.parse(readFileSync(resolve(planPath), "utf8"));
  const sourceBytes = readFileSync(input);
  const record = JSON.parse(sourceBytes.toString("utf8"));
  const result = migrateRecord({ record, plan, direction, dryRun });

  if (dryRun) return result;

  const backup = resolve(backupPath);
  if (backup === input || backup === output) throw new Error("backupPath must differ from inputPath and outputPath");
  mkdirSync(dirname(backup), { recursive: true });
  copyFileSync(input, backup, constants.COPYFILE_EXCL);
  const backupBytes = readFileSync(backup);
  if (digest(backupBytes) !== digest(sourceBytes)) throw new Error("pre-mutation backup digest mismatch");

  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.migration-${process.pid}.tmp`;
  try {
    writeFileSync(temporary, serialized(result.record), { flag: "wx", mode: 0o600 });
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }

  result.report.backup = {
    path: backup,
    bytes: backupBytes.length,
    sha256: digest(backupBytes),
    createdBeforeMutation: true,
  };
  return result;
}

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --name value pairs");
    output[key.slice(2)] = value;
  }
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (!["dry-run", "apply"].includes(command)) {
      throw new Error("usage: security-record-migration.mjs <dry-run|apply> --direction <forward|rollback> --plan PATH --input PATH [--output PATH] [--backup PATH]");
    }
    const args = parseArgs(process.argv.slice(3));
    const result = migrateFile({
      inputPath: resolve(root, args.input),
      outputPath: resolve(root, args.output ?? args.input),
      backupPath: args.backup ? resolve(root, args.backup) : undefined,
      planPath: resolve(root, args.plan),
      direction: args.direction,
      dryRun: command === "dry-run",
    });
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
