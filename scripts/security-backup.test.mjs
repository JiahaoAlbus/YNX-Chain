import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup, restoreBackup } from "./security-backup.mjs";

test("encrypted backup restores exact bytes and excludes signer recovery", () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-backup-test-"));
  const source = join(root, "source");
  const restored = join(root, "restored");
  mkdirSync(join(source, "nested"), { recursive: true });
  writeFileSync(join(source, "state.json"), "{\"height\":42}\n");
  writeFileSync(join(source, "nested", "object.bin"), Buffer.from([0, 1, 2, 255]));
  const keyFile = join(root, "key");
  writeFileSync(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });
  const backup = join(root, "backup.enc");
  const manifest = join(root, "backup.manifest.json");
  const created = createBackup({ source, output: backup, manifestPath: manifest, keyFile, sourceCommit: "a".repeat(40), createdAt: "2026-07-22T00:00:00Z" });
  assert.equal(created.algorithm, "AES-256-GCM");
  assert.equal(created.signerRecoveryIncluded, false);
  const result = restoreBackup({ backup, manifestPath: manifest, destination: restored, keyFile });
  assert.equal(result.restoredFiles, 2);
  assert.equal(readFileSync(join(restored, "state.json"), "utf8"), "{\"height\":42}\n");
  assert.deepEqual(readFileSync(join(restored, "nested", "object.bin")), Buffer.from([0, 1, 2, 255]));
});

test("tampered encrypted backup fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-backup-tamper-"));
  const source = join(root, "source");
  mkdirSync(source);
  writeFileSync(join(source, "state"), "authoritative");
  const keyFile = join(root, "key");
  writeFileSync(keyFile, Buffer.alloc(32, 9), { mode: 0o600 });
  const backup = join(root, "backup.enc");
  const manifest = join(root, "manifest.json");
  createBackup({ source, output: backup, manifestPath: manifest, keyFile, sourceCommit: "b".repeat(40) });
  writeFileSync(backup, Buffer.concat([readFileSync(backup), Buffer.from("tamper")]));
  assert.throws(() => restoreBackup({ backup, manifestPath: manifest, destination: join(root, "restored"), keyFile }), /integrity check failed/);
});
