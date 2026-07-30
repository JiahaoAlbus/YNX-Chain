#!/usr/bin/env node
/**
 * Local disaster-recovery verification for the YNX Security Platform.
 *
 * This tool performs an actual encrypted backup and restore against a caller-
 * supplied directory, then compares every restored file byte-for-byte. It does
 * not claim cross-region recovery, production RTO/RPO, or signer recovery.
 */

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackup, restoreBackup } from "./security-backup.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function collectSnapshot(base, current = base) {
  const files = [];
  for (const name of readdirSync(current).sort()) {
    const path = resolve(current, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`restore drill does not accept symbolic links: ${relative(base, path)}`);
    }
    if (stat.isDirectory()) {
      files.push(...collectSnapshot(base, path));
    } else if (stat.isFile()) {
      const data = readFileSync(path);
      files.push({
        path: relative(base, path).split(sep).join("/"),
        bytes: data.length,
        sha256: sha256(data),
      });
    }
  }
  return files;
}

function compareSnapshots(expected, actual) {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const failures = [];

  for (const [path, entry] of expectedByPath) {
    const restored = actualByPath.get(path);
    if (!restored) {
      failures.push(`missing restored file: ${path}`);
      continue;
    }
    if (restored.bytes !== entry.bytes || restored.sha256 !== entry.sha256) {
      failures.push(`restored file mismatch: ${path}`);
    }
  }
  for (const path of actualByPath.keys()) {
    if (!expectedByPath.has(path)) failures.push(`unexpected restored file: ${path}`);
  }
  return failures;
}

export function runLocalRestoreDrill({
  source,
  keyFile,
  sourceCommit,
  evidencePath,
  workDir,
  now = () => new Date(),
}) {
  if (!source || !keyFile || !sourceCommit) {
    throw new Error("source, keyFile, and sourceCommit are required");
  }
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("sourceCommit must be a full Git SHA");
  }

  const startedAt = now();
  const ownsWorkDir = !workDir;
  const drillRoot = workDir
    ? resolve(workDir)
    : mkdtempSync(resolve(tmpdir(), "ynx-security-restore-drill-"));
  mkdirSync(drillRoot, { recursive: true });

  const backupPath = resolve(drillRoot, "backup.enc.json");
  const manifestPath = resolve(drillRoot, "backup.manifest.json");
  const restorePath = resolve(drillRoot, "restored");
  const sourceSnapshot = collectSnapshot(resolve(source));

  try {
    const manifest = createBackup({
      source,
      output: backupPath,
      manifestPath,
      keyFile,
      sourceCommit,
      createdAt: startedAt.toISOString(),
    });
    const restoreStartedAt = now();
    const restore = restoreBackup({
      backup: backupPath,
      manifestPath,
      destination: restorePath,
      keyFile,
    });
    const completedAt = now();
    const restoredSnapshot = collectSnapshot(restorePath);
    const failures = compareSnapshots(sourceSnapshot, restoredSnapshot);

    const result = {
      schemaVersion: 1,
      scenario: "encrypted-local-filesystem-backup-restore",
      environment: "local",
      sourceCommit,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      result: failures.length === 0 ? "passed-local" : "failed",
      detectionTimeMs: 0,
      containmentTimeMs: 0,
      recoveryTimeMs: Math.max(0, completedAt.getTime() - restoreStartedAt.getTime()),
      rtoEvidenceMs: Math.max(0, completedAt.getTime() - restoreStartedAt.getTime()),
      rpoEvidenceSeconds: 0,
      sourceFiles: sourceSnapshot.length,
      restoredFiles: restore.restoredFiles,
      encryptedBackup: {
        bytes: manifest.backup.bytes,
        sha256: manifest.backup.sha256,
        algorithm: manifest.algorithm,
      },
      dataIntegrity: failures.length === 0,
      stateConsistency: failures.length === 0,
      signerRecoveryIncluded: false,
      failures,
      limitations: [
        "local filesystem drill only",
        "no object-store immutability evidence",
        "no cross-region recovery evidence",
        "no production RTO or RPO claim",
        "no validator, treasury, bridge, oracle, mobile, TLS, deploy, or artifact-signing key recovery",
      ],
    };

    if (evidencePath) {
      const output = resolve(root, evidencePath);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    }

    if (failures.length > 0) {
      throw new Error(`restore integrity verification failed: ${failures.join("; ")}`);
    }
    return result;
  } finally {
    if (ownsWorkDir) rmSync(drillRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command !== "local-drill") {
      throw new Error("usage: security-disaster-recovery.mjs local-drill --source DIR --key-file FILE --source-commit SHA [--evidence PATH] [--work-dir DIR]");
    }
    const result = runLocalRestoreDrill({
      source: args.source,
      keyFile: args["key-file"],
      sourceCommit: args["source-commit"],
      evidencePath: args.evidence,
      workDir: args["work-dir"],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
