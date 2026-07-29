import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runLocalRestoreDrill } from "./security-disaster-recovery.mjs";
import { buildRotationPlan } from "./security-rotation.mjs";

function tempRoot(name) {
  return mkdtempSync(resolve(tmpdir(), `${name}-`));
}

test("local restore drill encrypts, restores, and verifies every file", () => {
  const base = tempRoot("ynx-restore-test");
  const source = resolve(base, "source");
  const workDir = resolve(base, "work");
  const keyFile = resolve(base, "backup-key-input");
  mkdirSync(resolve(source, "nested"), { recursive: true });
  writeFileSync(resolve(source, "alpha.txt"), "alpha\n");
  writeFileSync(resolve(source, "nested/beta.json"), '{"ok":true}\n');
  writeFileSync(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });

  const times = [
    new Date("2026-07-25T06:00:00.000Z"),
    new Date("2026-07-25T06:00:00.010Z"),
    new Date("2026-07-25T06:00:00.025Z"),
  ];
  const result = runLocalRestoreDrill({
    source,
    keyFile,
    sourceCommit: "a".repeat(40),
    workDir,
    now: () => times.shift(),
  });

  assert.equal(result.result, "passed-local");
  assert.equal(result.dataIntegrity, true);
  assert.equal(result.sourceFiles, 2);
  assert.equal(result.restoredFiles, 2);
  assert.equal(result.rtoEvidenceMs, 15);
  assert.equal(result.signerRecoveryIncluded, false);
  assert.ok(result.limitations.includes("no cross-region recovery evidence"));
});

test("restore drill rejects ambiguous source identity", () => {
  const base = tempRoot("ynx-restore-sha-test");
  const source = resolve(base, "source");
  const keyFile = resolve(base, "backup-key-input");
  mkdirSync(source, { recursive: true });
  writeFileSync(resolve(source, "file.txt"), "data");
  writeFileSync(keyFile, Buffer.alloc(32, 3), { mode: 0o600 });
  assert.throws(
    () => runLocalRestoreDrill({ source, keyFile, sourceCommit: "short" }),
    /full Git SHA/,
  );
});

test("rotation plan separates creation, reload verification, grace, and revocation", () => {
  const plan = buildRotationPlan({
    secret: {
      id: "deploy-staging",
      secretType: "deploy-key",
      owner: "release-engineering",
      managerReference: "aws-secretsmanager://[REDACTED_SECRET]",
      environment: "staging",
    },
    graceSeconds: 600,
  });
  assert.equal(plan.graceSeconds, 600);
  assert.ok(plan.steps.some((step) => step.includes("separate approved action")));
  assert.ok(plan.automaticActionsExcluded.includes("dependent-service reload"));
});
