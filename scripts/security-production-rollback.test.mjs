import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  preflightProductionRollback,
  rollbackProduction,
} from "./security-production-rollback.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const targetCommit = "a".repeat(40);
const currentCommit = "b".repeat(40);
const runtimeCommit = "9".repeat(40);
const targetDigest = "c".repeat(64);
const currentDigest = "d".repeat(64);
const backupDigest = "e".repeat(64);
const probePolicySha256 = "f".repeat(64);
const context = "ynx-production";
const clusterUid = "11111111-2222-3333-4444-555555555555";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function manifest(sourceCommit, imageDigest) {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: quant-worker
    security.ynx/source-commit: ${sourceCommit}
  name: quant-worker
  namespace: ynx-services
spec:
  replicas: 3
  selector:
    matchLabels:
      app: quant-worker
      security.ynx/workload: quant-worker
  template:
    metadata:
      labels:
        app: quant-worker
        security.ynx/source-commit: ${sourceCommit}
        security.ynx/workload: quant-worker
    spec:
      containers:
      - name: worker
        image: registry.ynxweb4.com/security/quant-worker@sha256:${imageDigest}
`;
}

function release(role) {
  const current = role === "current";
  const sourceCommit = current ? currentCommit : targetCommit;
  const imageDigest = current ? currentDigest : targetDigest;
  const version = current ? "1.1.0" : "1.0.0";
  const productionManifest = manifest(sourceCommit, imageDigest);
  return {
    receipt: {
      productionSigned: true,
      deployedPublic: false,
      sourceCommit,
      runtimeSourceCommit: runtimeCommit,
      version,
      productionManifestSha256: sha256(productionManifest),
      publicProbePolicySha256: probePolicySha256,
    },
    manifest: productionManifest,
    attestation: {
      images: [
        {
          role: "backup-operator",
          reference: `registry.ynxweb4.com/security/backup-operator@sha256:${backupDigest}`,
        },
        {
          role: "quant-worker",
          reference: `registry.ynxweb4.com/security/quant-worker@sha256:${imageDigest}`,
        },
      ],
    },
    publicProbePolicy: { schemaVersion: 1, environment: "production" },
  };
}

function evidencePath(name) {
  return `evidence/security-platform/.production-rollback-${process.pid}-${name}.json`;
}

function deploymentEvidence(role) {
  const bundle = release(role);
  const path = evidencePath(`${role}-evidence`);
  const value = {
    schemaVersion: 1,
    action: "production-blue-green-update",
    state: "deployed-public-verified",
    sourceCommit: bundle.receipt.sourceCommit,
    version: bundle.receipt.version,
    productionManifestSha256: bundle.receipt.productionManifestSha256,
    publicProbePolicySha256: probePolicySha256,
    contextSha256: sha256(context),
    clusterUidSha256: sha256(clusterUid),
    productionSigned: true,
    mutationPerformed: true,
    deployedPublic: true,
    productionLeaseReleased: true,
    operatorAuthorization: { pass: true },
    changeApproval: { bound: true },
    approvalConsumption: { consumed: true },
    alertDelivery: { delivered: true },
    alertInputPreflight: { ready: true },
    releasedAt: role === "current"
      ? "2026-07-27T02:00:00.000Z"
      : "2026-07-27T01:00:00.000Z",
    readiness: { pass: true },
    publicProbes: { pass: true },
  };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(resolve(root, path), bytes);
  return {
    path,
    digest: sha256(bytes),
    cleanup: () => rmSync(resolve(root, path), { force: true }),
  };
}

function deployment(role) {
  const current = role === "current";
  const sourceCommit = current ? currentCommit : targetCommit;
  const imageDigest = current ? currentDigest : targetDigest;
  return {
    metadata: {
      name: "quant-worker",
      generation: 2,
      labels: { "security.ynx/source-commit": sourceCommit },
    },
    spec: {
      replicas: 3,
      template: {
        spec: {
          containers: [{
            name: "worker",
            image: `registry.ynxweb4.com/security/quant-worker@sha256:${imageDigest}`,
          }],
        },
      },
    },
    status: {
      observedGeneration: 2,
      availableReplicas: 3,
    },
  };
}

function fixture({ activeGreen = false } = {}) {
  const calls = [];
  let active = "current";
  const execFile = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (command !== "kubectl") throw new Error(`unexpected command ${command}`);
    if (args[0] === "config") return context;
    if (args.includes("namespace") && args.includes("kube-system")) {
      return JSON.stringify({ metadata: { uid: clusterUid } });
    }
    if (args.includes("version")) {
      return JSON.stringify({ serverVersion: { gitVersion: "v1.33.1" } });
    }
    if (args.includes("get") && args.includes("deployment") && args.includes("quant-worker-green")) {
      return activeGreen ? JSON.stringify({ metadata: { name: "quant-worker-green" } }) : "";
    }
    if (args.includes("get") && args.includes("deployment") && args.includes("quant-worker")) {
      return JSON.stringify(deployment(active));
    }
    if (args.includes("--dry-run=server")) return "server dry-run accepted";
    if (args.includes("apply")) {
      if (options.input.includes(targetCommit)) active = "target";
      if (options.input.includes(currentCommit)) active = "current";
      return "server-side apply accepted";
    }
    if (args.includes("diff")) return "";
    if (args.includes("rollout")) return "rollout complete";
    throw new Error(`unexpected kubectl command: ${args.join(" ")}`);
  };
  return {
    calls,
    execFile,
    active: () => active,
    verifyReadiness: () => ({ pass: true, active }),
    verifyPublicEndpoints: () => ({ pass: true, active }),
  };
}

function verifier(options) {
  return release(options.role);
}

function leaseFactory() {
  return {
    receipt: { lock: "default/ynx-production-release-lock" },
    renew: () => ({ renewedAt: "2026-07-27T03:00:00.000Z" }),
    release: () => ({ releasedAt: "2026-07-27T03:02:00.000Z", expired: true }),
  };
}

function authorize() {
  return { pass: true, authorizationPlanSha256: "1".repeat(64) };
}

function approvalBinder({ changeId }) {
  return {
    schemaVersion: 1,
    action: "production-manual-rollback",
    changeId,
    authorizationId: "2".repeat(64),
    resourceReferenceSha256: "3".repeat(64),
    ledgerName: `ynx-change-approval-${"2".repeat(32)}`,
    bound: true,
  };
}

function approvalConsumer({ approval }) {
  return { authorizationId: approval.authorizationId, immutable: true, consumed: true };
}

const alertCredentialIdentity = "4".repeat(64);

function alertInputPreflight({ sourceCommit }) {
  assert.equal(sourceCommit, runtimeCommit);
  return {
    sourceCommit,
    alertDeliveryPerformed: false,
    productionMutationPerformed: false,
    credentialBinding: {
      bound: true,
      credentialIdentitySha256: alertCredentialIdentity,
    },
    ready: true,
  };
}

function alertDispatcher({ approval, sourceCommit }) {
  assert.equal(sourceCommit, runtimeCommit);
  return {
    authorizationId: approval.authorizationId,
    credentialBinding: {
      credentialIdentitySha256: alertCredentialIdentity,
    },
    delivered: true,
  };
}

function common(currentEvidence, targetEvidence) {
  return {
    currentReleaseOptions: { role: "current" },
    targetReleaseOptions: { role: "target" },
    currentEvidencePath: currentEvidence.path,
    currentEvidenceSha256: currentEvidence.digest,
    targetEvidencePath: targetEvidence.path,
    targetEvidenceSha256: targetEvidence.digest,
    context,
    expectedClusterUid: clusterUid,
    verifyRelease: verifier,
    authorize,
    approvalBinder,
    approvalConsumer,
    alertDispatcher,
    alertInputPreflight,
    leaseFactory,
  };
}

function clock() {
  let value = Date.parse("2026-07-27T03:00:00.000Z");
  return () => {
    const current = new Date(value);
    value += 30_000;
    return current;
  };
}

test("rollback preflight binds signed current and target releases to prior public evidence", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture();
  try {
    const result = preflightProductionRollback({
      ...common(currentEvidence, targetEvidence),
      execFile: cluster.execFile,
      now: new Date("2026-07-27T03:00:00.000Z"),
    });
    assert.equal(result.receipt.action, "production-manual-rollback-preflight");
    assert.equal(result.receipt.currentSourceCommit, currentCommit);
    assert.equal(result.receipt.targetSourceCommit, targetCommit);
    assert.equal(result.receipt.rollbackAuthorizationScope, "deployment:rollback");
    assert.equal(
      result.receipt.rollbackAuthorizationResourceId,
      `production-release:${targetCommit}`,
    );
    assert.match(result.receipt.rollbackResourceReferenceSha256, /^[0-9a-f]{64}$/);
    assert.equal(result.receipt.serverDryRunPassed, true);
    assert.equal(result.receipt.mutationPerformed, false);
    assert.equal(result.receipt.deployedPublic, true);
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
  }
});

test("manual rollback applies and publicly verifies the signed target release", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture();
  const path = evidencePath("success");
  try {
    const result = rollbackProduction({
      ...common(currentEvidence, targetEvidence),
      context,
      execFile: cluster.execFile,
      operatorId: "production-operator",
      changeId: "change-20260727-manual-rollback",
      acknowledge: "rollback-production-release",
      evidencePath: path,
      verifyReadiness: cluster.verifyReadiness,
      verifyPublicEndpoints: cluster.verifyPublicEndpoints,
      now: clock(),
    });
    assert.equal(result.state, "deployed-public-verified");
    assert.equal(result.activeSourceCommit, targetCommit);
    assert.equal(result.rollbackFromSourceCommit, currentCommit);
    assert.equal(result.currentRestored, false);
    assert.equal(result.productionLeaseReleased, true);
    assert.equal(result.productionLeaseRenewals.length, 1);
    assert.equal(result.alertDelivery.delivered, true);
    assert.equal(result.deployedPublic, true);
    assert.equal(cluster.active(), "target");
    assert.deepEqual(JSON.parse(readFileSync(resolve(root, path), "utf8")), result);
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
    rmSync(resolve(root, path), { force: true });
  }
});

test("target public failure restores and verifies the signed current release", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture();
  const path = evidencePath("recovery");
  const verifyPublicEndpoints = () => {
    if (cluster.active() === "target") throw new Error("rollback target public identity failed");
    return { pass: true, active: cluster.active() };
  };
  try {
    assert.throws(
      () => rollbackProduction({
        ...common(currentEvidence, targetEvidence),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-rollback-recovery",
        acknowledge: "rollback-production-release",
        evidencePath: path,
        verifyReadiness: cluster.verifyReadiness,
        verifyPublicEndpoints,
        now: clock(),
      }),
      /rollback target public identity failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.state, "rollback-target-failed-current-restored");
    assert.equal(result.currentRecoveryAttempted, true);
    assert.equal(result.currentRestored, true);
    assert.equal(result.activeSourceCommit, currentCommit);
    assert.equal(result.deployedPublic, true);
    assert.equal(cluster.active(), "current");
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
    rmSync(resolve(root, path), { force: true });
  }
});

test("lost Lease ownership prevents recovery mutation by the former holder", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture();
  const path = evidencePath("lease-lost");
  let renewals = 0;
  const lostLeaseFactory = () => ({
    receipt: { lock: "default/ynx-production-release-lock" },
    renew: () => {
      renewals += 1;
      if (renewals > 1) throw new Error("production Lease renewal lost production Lease ownership");
      return { renewedAt: "2026-07-27T03:00:00.000Z" };
    },
    release: () => {
      throw new Error("production Lease release lost production Lease ownership");
    },
  });
  try {
    assert.throws(
      () => rollbackProduction({
        ...common(currentEvidence, targetEvidence),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-lease-lost",
        acknowledge: "rollback-production-release",
        evidencePath: path,
        leaseFactory: lostLeaseFactory,
        verifyReadiness: cluster.verifyReadiness,
        verifyPublicEndpoints: () => {
          throw new Error("rollback target public identity failed");
        },
        now: clock(),
      }),
      /rollback target public identity failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.state, "rollback-failed-active-release-unverified");
    assert.match(result.leaseOwnershipFailure, /lost production Lease ownership/);
    assert.equal(result.currentRecovery, null);
    assert.equal(result.currentRestored, false);
    assert.equal(result.productionLeaseReleased, false);
    assert.equal(result.deployedPublic, false);
    assert.equal(cluster.active(), "target");
    const nonDryApplyCalls = cluster.calls.filter((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    ));
    assert.equal(nonDryApplyCalls.length, 1);
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
    rmSync(resolve(root, path), { force: true });
  }
});

test("rollback refuses concurrent blue-green mutation before target dry-run", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture({ activeGreen: true });
  try {
    assert.throws(
      () => preflightProductionRollback({
        ...common(currentEvidence, targetEvidence),
        execFile: cluster.execFile,
        now: new Date("2026-07-27T03:00:00.000Z"),
      }),
      /refuses an active blue-green update/,
    );
    assert.equal(cluster.calls.some((call) => call.args.includes("--dry-run=server")), false);
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
  }
});

test("rollback cannot be used to promote a target that was released later", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture();
  const targetPath = resolve(root, targetEvidence.path);
  const value = JSON.parse(readFileSync(targetPath, "utf8"));
  value.releasedAt = "2026-07-27T03:00:00.000Z";
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(targetPath, bytes);
  targetEvidence.digest = sha256(bytes);
  try {
    assert.throws(
      () => preflightProductionRollback({
        ...common(currentEvidence, targetEvidence),
        execFile: cluster.execFile,
        now: new Date("2026-07-27T04:00:00.000Z"),
      }),
      /must have been publicly released before/,
    );
    assert.equal(cluster.calls.length, 0);
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
  }
});

test("rollback rejects unpinned target evidence before cluster access", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture();
  try {
    assert.throws(
      () => preflightProductionRollback({
        ...common(currentEvidence, targetEvidence),
        targetEvidenceSha256: "0".repeat(64),
        execFile: cluster.execFile,
        now: new Date("2026-07-27T03:00:00.000Z"),
      }),
      /target production evidence digest mismatch/,
    );
    assert.equal(cluster.calls.length, 0);
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
  }
});

test("exact acknowledgement and bounded evidence path are required before mutation", () => {
  const currentEvidence = deploymentEvidence("current");
  const targetEvidence = deploymentEvidence("target");
  const cluster = fixture();
  try {
    assert.throws(
      () => rollbackProduction({
        ...common(currentEvidence, targetEvidence),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-no-ack",
        acknowledge: "yes",
        evidencePath: evidencePath("no-ack"),
      }),
      /acknowledge=rollback-production-release/,
    );
    assert.throws(
      () => rollbackProduction({
        ...common(currentEvidence, targetEvidence),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-bad-path",
        acknowledge: "rollback-production-release",
        evidencePath: "../outside.json",
      }),
      /must stay inside the repository/,
    );
    assert.equal(cluster.calls.length, 0);
  } finally {
    currentEvidence.cleanup();
    targetEvidence.cleanup();
  }
});
