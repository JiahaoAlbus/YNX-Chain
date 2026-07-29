import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializeKubernetesTreeAtCommit,
  preflightStagingRollback,
  rollbackStaging,
  validateRollbackTarget,
} from "./security-staging-rollback.mjs";
import {
  renderStagingReleaseManifest,
  stagingReleaseInputSha256,
} from "./security-stage-release.mjs";
import { validateStagingReleaseManifest } from "./security-deploy.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const targetCommit = "a".repeat(40);
const runtimeCommit = "c".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const context = "ynx-staging";
const clusterUid = "11111111-2222-3333-4444-555555555555";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function input() {
  return {
    schemaVersion: 1,
    sourceCommit: targetCommit,
    quantWorkerImage: {
      repository: "registry.staging.ynxweb4.com/security/quant-worker",
      digest: imageDigest,
    },
    backupOperatorImage: {
      repository: "registry.staging.ynxweb4.com/security/backup-operator",
      digest: imageDigest,
    },
    awsRegion: "ap-southeast-1",
    backupOperatorRoleArn: "arn:aws:iam::123456789012:role/ynx-staging-backup",
    backupEncryptionSecretArn: "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/staging/backup-key-AbCdEf",
    databaseCredentialSecretArn: "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/staging/database-url-AbCdEf",
    chainStateDestination: "s3://ynx-staging-chain-backup/state",
    chainStateReplicaDestination: "s3://ynx-staging-chain-replica/state",
    databaseDestination: "s3://ynx-staging-database-backup/postgres",
    objectSourceBucket: "ynx-staging-artifacts",
    objectDestination: "s3://ynx-staging-object-backup/objects",
    chainStatePvcName: "chain-data-staging",
    awsEndpointCidrs: ["10.20.0.0/24", "10.20.1.0/24"],
    databaseEndpointCidrs: ["10.30.0.0/24"],
    databasePort: 5432,
  };
}

function verifiedEvidence(manifest) {
  return {
    schemaVersion: 1,
    action: "staging-deployment",
    sourceCommit: targetCommit,
    releaseInputSha256: stagingReleaseInputSha256(input()),
    manifestSha256: sha256(manifest),
    state: "deployed-staging-verified",
    mutationPerformed: true,
    deployedStaging: true,
    rolloutVerified: true,
    liveManifestReconciled: true,
    readiness: { pass: true },
  };
}

function writeJson(relativePath, value) {
  const absolute = resolve(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(absolute, bytes, { mode: 0o600 });
  return { absolute, bytes, digest: sha256(bytes) };
}

function clusterFixture(rendered) {
  const calls = [];
  const execFile = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (command === "git" && args[0] === "rev-parse") return `${runtimeCommit}\n`;
    if (command === "git" && args[0] === "status") return "";
    if (command !== "kubectl") throw new Error("unexpected command");
    if (args[0] === "kustomize") return rendered;
    if (args[0] === "config") return `${context}\n`;
    if (args.includes("kube-system")) return JSON.stringify({ metadata: { uid: clusterUid } });
    if (args.includes("version")) return JSON.stringify({ serverVersion: { gitVersion: "v1.33.1" } });
    if (args.includes("--dry-run=server")) return "server dry-run passed";
    if (args.includes("apply")) return "rollback manifest applied";
    if (args.includes("diff")) return "";
    if (args.includes("rollout")) return "rollback rollout complete";
    if (args.includes("namespace") && args.includes("ynx-services-staging")) {
      return JSON.stringify({ metadata: { labels: { environment: "staging" } } });
    }
    if (args.includes("deployment")) {
      return JSON.stringify({
        items: [{
          metadata: { generation: 4 },
          spec: { replicas: 1 },
          status: { observedGeneration: 4, availableReplicas: 1 },
        }],
      });
    }
    if (args.includes("pods")) {
      return JSON.stringify({ items: [{ status: { conditions: [{ type: "Ready", status: "True" }] } }] });
    }
    if (args.includes("networkpolicy")) {
      return JSON.stringify({ items: [{ metadata: { name: "default-deny-all" } }] });
    }
    if (args.includes("peerauthentication")) {
      return JSON.stringify({ items: [{ spec: { mtls: { mode: "STRICT" } } }] });
    }
    if (args.includes("cronjob")) return JSON.stringify({ items: [{ spec: { suspend: false } }] });
    if (args.includes("secretproviderclass")) {
      return JSON.stringify({ items: [{ metadata: { name: "ynx-staging-secrets" } }] });
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, execFile };
}

function currentTree() {
  return {
    kubernetesRoot: resolve(root, "infra/k8s"),
    files: 1,
    bytes: 1,
    cleanup() {},
  };
}

test("verified target evidence binds input, executing commit, and evidence digest", () => {
  const evidence = verifiedEvidence("manifest");
  const evidenceBytes = Buffer.from(JSON.stringify(evidence));
  const result = validateRollbackTarget({
    input: input(),
    evidenceBytes,
    expectedEvidenceSha256: sha256(evidenceBytes),
    runtimeSourceCommit: runtimeCommit,
  });
  assert.equal(result.input.sourceCommit, targetCommit);
  assert.equal(result.manifestSha256, sha256("manifest"));
  assert.throws(
    () => validateRollbackTarget({
      input: { ...input(), chainStatePvcName: "different-pvc" },
      evidenceBytes,
      expectedEvidenceSha256: sha256(evidenceBytes),
      runtimeSourceCommit: runtimeCommit,
    }),
    /input does not match/,
  );
  const unverifiedBytes = Buffer.from(JSON.stringify({ ...evidence, rolloutVerified: false }));
  assert.throws(
    () => validateRollbackTarget({
      input: input(),
      evidenceBytes: unverifiedBytes,
      expectedEvidenceSha256: sha256(unverifiedBytes),
      runtimeSourceCommit: runtimeCommit,
    }),
    /does not prove/,
  );
  assert.throws(
    () => validateRollbackTarget({
      input: input(),
      evidenceBytes,
      expectedEvidenceSha256: "d".repeat(64),
      runtimeSourceCommit: runtimeCommit,
    }),
    /digest does not match/,
  );
});

test("current Git commit reconstructs a deployable target Kubernetes tree", () => {
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const tree = materializeKubernetesTreeAtCommit({ sourceCommit });
  try {
    const rollbackInput = { ...input(), sourceCommit };
    const manifest = renderStagingReleaseManifest(rollbackInput, {
      kubernetesSourceRoot: tree.kubernetesRoot,
    });
    const validation = validateStagingReleaseManifest(manifest, { sourceCommit });
    assert.equal(validation.pass, true, validation.failures.join("\n"));
    assert.ok(tree.files > 0);
    assert.ok(tree.bytes > 0);
  } finally {
    tree.cleanup();
  }
});

test("target Git tree materialization accepts regular blobs and cleans up", () => {
  const files = new Map([
    ["infra/k8s/overlays/staging/kustomization.yaml", Buffer.from("resources: []\n")],
    ["infra/k8s/base/runtime.yaml", Buffer.from("kind: Namespace\n")],
  ]);
  const execFile = (_command, args) => {
    if (args[0] === "cat-file") return "";
    if (args[0] === "ls-tree") {
      return [...files.keys()]
        .map((path) => `100644 blob ${"e".repeat(40)}\t${path}`)
        .join("\n");
    }
    if (args[0] === "show") return files.get(args[1].slice(41));
    throw new Error("unexpected Git command");
  };
  const tree = materializeKubernetesTreeAtCommit({
    sourceCommit: targetCommit,
    execFile,
  });
  const workspace = resolve(tree.kubernetesRoot, "../..");
  assert.equal(readFileSync(resolve(tree.kubernetesRoot, "base/runtime.yaml"), "utf8"), "kind: Namespace\n");
  assert.equal(tree.files, 2);
  tree.cleanup();
  assert.equal(existsSync(workspace), false);
});

test("target Git tree rejects symlinks before reading blobs", () => {
  const calls = [];
  const execFile = (_command, args) => {
    calls.push(args);
    if (args[0] === "cat-file") return "";
    if (args[0] === "ls-tree") {
      return `120000 blob ${"e".repeat(40)}\tinfra/k8s/overlays/staging/kustomization.yaml`;
    }
    throw new Error("blob read must not occur");
  };
  assert.throws(
    () => materializeKubernetesTreeAtCommit({ sourceCommit: targetCommit, execFile }),
    /unsupported entry/,
  );
  assert.equal(calls.some((args) => args[0] === "show"), false);
});

test("rollback preflight reconstructs the exact prior manifest before server dry-run", () => {
  const rendered = renderStagingReleaseManifest(input());
  const targetPath = `evidence/security-platform/.rollback-target-${process.pid}-preflight.json`;
  const target = writeJson(targetPath, verifiedEvidence(rendered));
  const fixture = clusterFixture(rendered);
  try {
    const { receipt } = preflightStagingRollback({
      input: input(),
      targetEvidencePath: targetPath,
      targetEvidenceSha256: target.digest,
      runtimeSourceCommit: runtimeCommit,
      context,
      expectedClusterUid: clusterUid,
      execFile: fixture.execFile,
      materializeTree: currentTree,
      now: new Date("2026-07-26T15:00:00.000Z"),
    });
    assert.equal(receipt.action, "staging-rollback-preflight");
    assert.equal(receipt.sourceCommit, targetCommit);
    assert.equal(receipt.runtimeSourceCommit, runtimeCommit);
    assert.equal(receipt.rollbackTargetEvidenceSha256, target.digest);
    assert.equal(receipt.serverDryRunPassed, true);
    assert.equal(fixture.calls.some((call) => call.args.includes("--dry-run=server")), true);
  } finally {
    rmSync(target.absolute, { force: true });
  }
});

test("rollback applies the full target and records verified rollback evidence", () => {
  const rendered = renderStagingReleaseManifest(input());
  const targetPath = `evidence/security-platform/.rollback-target-${process.pid}-apply.json`;
  const outputPath = `evidence/security-platform/.rollback-result-${process.pid}.json`;
  const target = writeJson(targetPath, verifiedEvidence(rendered));
  const fixture = clusterFixture(rendered);
  try {
    const result = rollbackStaging({
      input: input(),
      targetEvidencePath: targetPath,
      targetEvidenceSha256: target.digest,
      runtimeSourceCommit: runtimeCommit,
      context,
      expectedClusterUid: clusterUid,
      operatorId: "staging-operator",
      changeId: "incident-20260726-rollback",
      acknowledge: "rollback-staging",
      evidencePath: outputPath,
      execFile: fixture.execFile,
      materializeTree: currentTree,
      now: (() => {
        const values = [
          new Date("2026-07-26T15:00:00.000Z"),
          new Date("2026-07-26T15:01:00.000Z"),
        ];
        return () => values.shift();
      })(),
    });
    assert.equal(result.action, "staging-rollback");
    assert.equal(result.state, "deployed-staging-verified");
    assert.equal(result.sourceCommit, targetCommit);
    assert.equal(result.runtimeSourceCommit, runtimeCommit);
    assert.equal(JSON.parse(readFileSync(resolve(root, outputPath), "utf8")).rollbackTargetEvidenceSha256, target.digest);
    const applyCalls = fixture.calls.filter((call) => call.args.includes("apply"));
    assert.equal(applyCalls.length, 2);
    assert.equal(applyCalls[0].args.includes("--dry-run=server"), true);
    assert.equal(applyCalls[1].args.includes("--dry-run=server"), false);
  } finally {
    rmSync(target.absolute, { force: true });
    rmSync(resolve(root, outputPath), { force: true });
  }
});

test("manifest drift and wrong acknowledgement stop rollback before mutation", () => {
  const rendered = renderStagingReleaseManifest(input());
  const targetPath = `evidence/security-platform/.rollback-target-${process.pid}-reject.json`;
  const drifted = verifiedEvidence(rendered);
  drifted.manifestSha256 = "f".repeat(64);
  const target = writeJson(targetPath, drifted);
  const fixture = clusterFixture(rendered);
  try {
    assert.throws(
      () => preflightStagingRollback({
        input: input(),
        targetEvidencePath: targetPath,
        targetEvidenceSha256: target.digest,
        runtimeSourceCommit: runtimeCommit,
        context,
        expectedClusterUid: clusterUid,
        execFile: fixture.execFile,
        materializeTree: currentTree,
      }),
      /manifest does not match/,
    );
    assert.equal(fixture.calls.some((call) => call.args.includes("apply")), false);
  } finally {
    rmSync(target.absolute, { force: true });
  }

  const validPath = `evidence/security-platform/.rollback-target-${process.pid}-ack.json`;
  const valid = writeJson(validPath, verifiedEvidence(rendered));
  const acknowledgementFixture = clusterFixture(rendered);
  try {
    assert.throws(
      () => rollbackStaging({
        input: input(),
        targetEvidencePath: validPath,
        targetEvidenceSha256: valid.digest,
        runtimeSourceCommit: runtimeCommit,
        context,
        expectedClusterUid: clusterUid,
        operatorId: "staging-operator",
        changeId: "incident-20260726-rollback",
        acknowledge: "apply-staging",
        evidencePath: `evidence/security-platform/.rollback-result-${process.pid}-ack.json`,
        execFile: acknowledgementFixture.execFile,
        materializeTree: currentTree,
      }),
      /acknowledge=rollback-staging/,
    );
    assert.equal(acknowledgementFixture.calls.some((call) => call.args.includes("apply")), false);
  } finally {
    rmSync(valid.absolute, { force: true });
  }
});
