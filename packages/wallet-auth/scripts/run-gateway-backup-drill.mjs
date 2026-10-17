#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalJSON } from "../src/canonical.js";
import { createGatewayStateBackup, restoreGatewayStateBackup, verifyGatewayStateBackup } from "../src/gateway-backup.js";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";

let root;
let stage = "policy";

try {
  const samples = boundedInteger(process.env.YNX_WALLET_GATEWAY_BACKUP_DRILL_SAMPLES ?? "20", "YNX_WALLET_GATEWAY_BACKUP_DRILL_SAMPLES", 5, 100);
  const sourceCommit = sourceIdentity(process.env.YNX_WALLET_GATEWAY_SOURCE_COMMIT);
  root = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-backup-drill-"));
  chmodSync(root, 0o700);
  stage = "initialize";
  const clock = new Date();
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  stage = "create-source-state";
  const sourceDirectory = privateDirectory(root, "source");
  const statePath = join(sourceDirectory, "state.json");
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => clock });
  const sourceSnapshot = host.snapshot();
  const encryptionMaterial = randomBytes(32);
  const backupMs = [];
  const verifyMs = [];
  const restoreAndColdStartMs = [];
  let lastBackupPath;
  let lastSummary;

  for (let index = 0; index < samples; index += 1) {
    stage = "sample-create";
    const iterationDirectory = privateDirectory(root, `iteration-${index}`);
    const backupPath = join(iterationDirectory, "gateway.backup.json");
    const restorePath = join(iterationDirectory, "restored-state.json");

    let started = performance.now();
    const created = createGatewayStateBackup({ backupPath, key: encryptionMaterial, statePath, now: () => clock });
    backupMs.push(performance.now() - started);

    stage = "sample-verify";
    started = performance.now();
    const verified = verifyGatewayStateBackup({ backupPath, key: encryptionMaterial, maxAgeMs: 300_000, minimumCreatedAt: clock.toISOString(), now: () => clock });
    verifyMs.push(performance.now() - started);

    stage = "sample-restore";
    started = performance.now();
    const restored = restoreGatewayStateBackup({ backupPath, key: encryptionMaterial, statePath: restorePath, maxAgeMs: 300_000, minimumCreatedAt: clock.toISOString(), now: () => clock });
    const recovered = new CanonicalWalletGatewayNodeHost(registry, { statePath: restorePath, now: () => clock });
    restoreAndColdStartMs.push(performance.now() - started);

    if (verified.backupSha256 !== created.backupSha256 || restored.restoredStateDigest !== created.sourceStateDigest || canonicalJSON(recovered.snapshot()) !== canonicalJSON(sourceSnapshot)) {
      throw new Error("Gateway drill restore integrity diverged");
    }
    lastBackupPath = backupPath;
    lastSummary = created;
  }

  stage = "tamper-check";
  const tamperedPath = join(root, "tampered.backup.json");
  copyFileSync(lastBackupPath, tamperedPath);
  chmodSync(tamperedPath, 0o600);
  const tampered = JSON.parse(readFileSync(tamperedPath, "utf8"));
  tampered.authTag = `${tampered.authTag.slice(0, -1)}${tampered.authTag.endsWith("A") ? "B" : "A"}`;
  writeFileSync(tamperedPath, canonicalJSON(tampered), { mode: 0o600 });
  let tamperRejected = false;
  try { verifyGatewayStateBackup({ backupPath: tamperedPath, key: encryptionMaterial, now: () => clock }); }
  catch (caught) { tamperRejected = caught?.code === "BACKUP_TAMPERED"; }
  if (!tamperRejected) throw new Error("Gateway drill accepted a tampered backup");

  process.stdout.write(`${canonicalJSON({
    schemaVersion: 1,
    classification: "local-empty-state-gateway-backup-performance-drill",
    sourceCommit,
    generatedAt: new Date().toISOString(),
    samples,
    backup: distribution(backupMs),
    verify: distribution(verifyMs),
    restoreAndColdStart: distribution(restoreAndColdStartMs),
    recoveryPolicy: {
      algorithm: lastSummary.algorithm,
      backupSchemaVersion: lastSummary.schemaVersion,
      stateSchemaVersion: lastSummary.stateSchemaVersion,
      maximumAcceptedRpoMs: 300_000,
      noOverwrite: true,
      privateFileMode: "0600",
      privateDirectoryMode: "0700",
    },
    evidence: {
      backupBytes: lastSummary.backupBytes,
      backupSha256: lastSummary.backupSha256,
      sourceStateDigest: lastSummary.sourceStateDigest,
      exactSnapshotRestored: true,
      tamperRejected,
      sensitiveOrPathFieldsEmitted: false,
    },
    scopeBoundary: "Non-empty Session and consumed-Proof recovery is verified by gateway-backup.test.mjs, not by this performance fixture.",
    notClaimed: ["central deployment restore", "cross-region object storage", "production KMS integration", "production RTO or availability compliance"],
  })}\n`);
} catch (caught) {
  const publicCode = typeof caught?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(caught.code) ? caught.code : "BACKUP_DRILL_FAILED";
  process.stderr.write(`${canonicalJSON({ error: { code: publicCode, message: "Canonical Gateway backup drill failed closed" }, ok: false, stage })}\n`);
  process.exitCode = 1;
} finally {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
}

function privateDirectory(rootDirectory, name) {
  const directory = join(rootDirectory, name);
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}
function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    samples: sorted.length,
    minMicroseconds: microseconds(sorted[0]),
    p50Microseconds: microseconds(percentile(sorted, 0.50)),
    p95Microseconds: microseconds(percentile(sorted, 0.95)),
    p99Microseconds: microseconds(percentile(sorted, 0.99)),
    maxMicroseconds: microseconds(sorted.at(-1)),
  });
}
function percentile(sorted, quantile) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]; }
function microseconds(milliseconds) { return Math.round(milliseconds * 1000); }
function boundedInteger(value, label, minimum, maximum) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} is outside policy`);
  return parsed;
}
function sourceIdentity(value) {
  if (value === undefined) return null;
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("YNX_WALLET_GATEWAY_SOURCE_COMMIT must be a full lowercase Git SHA");
  return value;
}
