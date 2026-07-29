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
  buildProductionGreenManifest,
  preflightProductionBlueGreen,
  promoteProductionBlueGreen,
} from "./security-production-blue-green.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stableCommit = "a".repeat(40);
const candidateCommit = "b".repeat(40);
const runtimeCommit = "9".repeat(40);
const stableDigest = "c".repeat(64);
const candidateDigest = "d".repeat(64);
const backupDigest = "e".repeat(64);
const clusterUid = "11111111-2222-3333-4444-555555555555";
const context = "ynx-production";
const probePolicySha256 = "f".repeat(64);

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
      securityContext:
        runAsNonRoot: true
      containers:
      - name: worker
        image: registry.ynxweb4.com/security/quant-worker@sha256:${imageDigest}
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
`;
}

function release(role) {
  const stable = role === "stable";
  const sourceCommit = stable ? stableCommit : candidateCommit;
  const imageDigest = stable ? stableDigest : candidateDigest;
  const version = stable ? "1.0.0" : "1.1.0";
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
    publicProbePolicy: {
      schemaVersion: 1,
      environment: "production",
    },
  };
}

function evidencePath(name) {
  return `evidence/security-platform/.production-blue-green-${process.pid}-${name}.json`;
}

function stableEvidence() {
  const path = evidencePath("stable");
  const stable = release("stable");
  const value = {
    schemaVersion: 1,
    action: "production-deployment",
    state: "deployed-public-verified",
    sourceCommit: stableCommit,
    version: stable.receipt.version,
    productionManifestSha256: stable.receipt.productionManifestSha256,
    publicProbePolicySha256: probePolicySha256,
    contextSha256: sha256(context),
    clusterUidSha256: sha256(clusterUid),
    productionSigned: true,
    deployedPublic: true,
    mutationPerformed: true,
    productionLeaseReleased: true,
    operatorAuthorization: { pass: true },
    changeApproval: { bound: true },
    approvalConsumption: { consumed: true },
    alertDelivery: { delivered: true },
    alertInputPreflight: { ready: true },
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

function deployment(role, green = false) {
  const stable = role === "stable";
  const sourceCommit = stable ? stableCommit : candidateCommit;
  const imageDigest = stable ? stableDigest : candidateDigest;
  return {
    metadata: {
      name: green ? "quant-worker-green" : "quant-worker",
      generation: 2,
      labels: {
        "security.ynx/source-commit": sourceCommit,
        ...(green ? { "security.ynx/release-track": "green" } : {}),
      },
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
      updatedReplicas: 3,
      unavailableReplicas: 0,
    },
  };
}

function greenPods({ healthy = true } = {}) {
  return {
    items: Array.from({ length: 3 }, (_, index) => ({
      metadata: { name: `green-${index}` },
      status: {
        phase: "Running",
        conditions: [{ type: "Ready", status: healthy ? "True" : "False" }],
        containerStatuses: [{
          ready: healthy,
          restartCount: healthy ? 0 : 1,
          image: `registry.ynxweb4.com/security/quant-worker@sha256:${candidateDigest}`,
          imageID: `containerd://registry.ynxweb4.com/security/quant-worker@sha256:${candidateDigest}`,
        }],
      },
    })),
  };
}

function fixture({ unhealthyGreen = false } = {}) {
  const calls = [];
  let active = "stable";
  let green = false;
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
      if (args.includes("--ignore-not-found=true")) return green ? JSON.stringify(deployment("candidate", true)) : "";
      return JSON.stringify(deployment("candidate", true));
    }
    if (args.includes("get") && args.includes("deployment") && args.includes("quant-worker")) {
      return JSON.stringify(deployment(active));
    }
    if (args.includes("get") && args.includes("pods")) {
      return JSON.stringify(greenPods({ healthy: !unhealthyGreen }));
    }
    if (args.includes("--dry-run=server")) return "server dry-run accepted";
    if (args.includes("apply")) {
      if (options.input.includes("name: quant-worker-green")) {
        green = true;
      } else if (options.input.includes(candidateCommit)) {
        active = "candidate";
      } else if (options.input.includes(stableCommit)) {
        active = "stable";
      }
      return "server-side apply accepted";
    }
    if (args.includes("diff")) return "";
    if (args.includes("rollout")) return "rollout complete";
    if (args.includes("delete")) {
      green = false;
      return "deployment deleted";
    }
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
    renew: () => ({ renewedAt: "2026-07-27T00:00:00.000Z" }),
    release: () => ({ releasedAt: "2026-07-27T00:03:00.000Z", expired: true }),
  };
}

function authorize() {
  return { pass: true, authorizationPlanSha256: "1".repeat(64) };
}

function approvalBinder({ action, changeId }) {
  return {
    schemaVersion: 1,
    action,
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

function tickingClock() {
  let value = Date.parse("2026-07-27T00:00:00.000Z");
  return () => {
    const current = new Date(value);
    value += 30_000;
    return current;
  };
}

function common(stable) {
  return {
    stableReleaseOptions: { role: "stable" },
    candidateReleaseOptions: { role: "candidate" },
    stableEvidencePath: stable.path,
    stableEvidenceSha256: stable.digest,
    context,
    expectedClusterUid: clusterUid,
    observationSeconds: 60,
    sampleIntervalSeconds: 30,
    verifyRelease: verifier,
    authorize,
    approvalBinder,
    approvalConsumer,
    alertDispatcher,
    alertInputPreflight,
    leaseFactory,
  };
}

test("green manifest is isolated, immutable, and security-bound", () => {
  const candidate = release("candidate");
  const green = buildProductionGreenManifest(candidate.manifest, candidate);
  assert.match(green, /name: quant-worker-green/);
  assert.equal((green.match(/app: quant-worker-green/g) ?? []).length, 3);
  assert.match(green, /security\.ynx\/release-track: green/);
  assert.match(green, new RegExp(`@sha256:${candidateDigest}`));
  assert.doesNotMatch(green, new RegExp(`@sha256:${stableDigest}`));
});

test("preflight binds two signed releases, stable evidence, live cluster, and server dry-runs", () => {
  const stable = stableEvidence();
  const cluster = fixture();
  try {
    const result = preflightProductionBlueGreen({
      ...common(stable),
      execFile: cluster.execFile,
      now: new Date("2026-07-27T00:00:00.000Z"),
    });
    assert.equal(result.receipt.action, "production-blue-green-preflight");
    assert.equal(result.receipt.stableSourceCommit, stableCommit);
    assert.equal(result.receipt.candidateSourceCommit, candidateCommit);
    assert.equal(result.receipt.requiredSamples, 3);
    assert.equal(result.receipt.mutationPerformed, false);
    assert.equal(result.receipt.deployedPublic, true);
    assert.equal(cluster.calls.filter((call) => call.args.includes("--dry-run=server")).length, 2);
  } finally {
    stable.cleanup();
  }
});

test("preflight rejects candidate resources that the stable rollback cannot remove", () => {
  const stable = stableEvidence();
  const cluster = fixture();
  try {
    assert.throws(
      () => preflightProductionBlueGreen({
        ...common(stable),
        execFile: cluster.execFile,
        verifyRelease: (options) => {
          const bundle = release(options.role);
          if (options.role === "candidate") {
            bundle.manifest += `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: candidate-only
  namespace: ynx-services
`;
            bundle.receipt.productionManifestSha256 = sha256(bundle.manifest);
          }
          return bundle;
        },
        now: new Date("2026-07-27T00:00:00.000Z"),
      }),
      /identical Kubernetes resource inventory/,
    );
    assert.equal(cluster.calls.length, 0);
  } finally {
    stable.cleanup();
  }
});

test("promotion observes green then verifies the complete signed candidate publicly", () => {
  const stable = stableEvidence();
  const cluster = fixture();
  const path = evidencePath("success");
  try {
    const result = promoteProductionBlueGreen({
      ...common(stable),
      execFile: cluster.execFile,
      operatorId: "production-operator",
      changeId: "change-20260727-blue-green",
      acknowledge: "promote-production-blue-green",
      evidencePath: path,
      verifyReadiness: cluster.verifyReadiness,
      verifyPublicEndpoints: cluster.verifyPublicEndpoints,
      wait: () => {},
      now: tickingClock(),
    });
    assert.equal(result.state, "deployed-public-verified");
    assert.equal(result.activeSourceCommit, candidateCommit);
    assert.equal(result.greenSamples.length, 3);
    assert.equal(result.greenObservationPassed, true);
    assert.equal(result.greenRemoved, true);
    assert.equal(result.productionLeaseReleased, true);
    assert.equal(result.productionLeaseRenewals.length, 5);
    assert.equal(result.alertDelivery.delivered, true);
    assert.equal(result.deployedPublic, true);
    assert.equal(cluster.active(), "candidate");
    assert.deepEqual(JSON.parse(readFileSync(resolve(root, path), "utf8")), result);
  } finally {
    stable.cleanup();
    rmSync(resolve(root, path), { force: true });
  }
});

test("candidate public verification failure restores and verifies the pinned stable release", () => {
  const stable = stableEvidence();
  const cluster = fixture();
  const path = evidencePath("rollback");
  const verifyPublicEndpoints = () => {
    if (cluster.active() === "candidate") throw new Error("candidate public identity failed");
    return { pass: true, active: cluster.active() };
  };
  try {
    assert.throws(
      () => promoteProductionBlueGreen({
        ...common(stable),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-blue-green-rollback",
        acknowledge: "promote-production-blue-green",
        evidencePath: path,
        verifyReadiness: cluster.verifyReadiness,
        verifyPublicEndpoints,
        wait: () => {},
        now: tickingClock(),
      }),
      /candidate public identity failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.state, "candidate-failed-stable-restored");
    assert.equal(result.automaticRollbackAttempted, true);
    assert.equal(result.stableRestored, true);
    assert.equal(result.activeSourceCommit, stableCommit);
    assert.equal(result.deployedPublic, true);
    assert.equal(cluster.active(), "stable");
  } finally {
    stable.cleanup();
    rmSync(resolve(root, path), { force: true });
  }
});

test("unhealthy green never cuts over and confirms the stable release remains public", () => {
  const stable = stableEvidence();
  const cluster = fixture({ unhealthyGreen: true });
  const path = evidencePath("green-failure");
  try {
    assert.throws(
      () => promoteProductionBlueGreen({
        ...common(stable),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-green-failure",
        acknowledge: "promote-production-blue-green",
        evidencePath: path,
        verifyReadiness: cluster.verifyReadiness,
        verifyPublicEndpoints: cluster.verifyPublicEndpoints,
        wait: () => {},
        now: tickingClock(),
      }),
      /production green health failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.state, "green-failed-stable-preserved");
    assert.equal(result.candidateApplyAttempted, false);
    assert.equal(result.stableRestored, true);
    assert.equal(result.deployedPublic, true);
    assert.equal(cluster.active(), "stable");
  } finally {
    stable.cleanup();
    rmSync(resolve(root, path), { force: true });
  }
});

test("exact acknowledgement and bounded evidence path are required before mutation", () => {
  const stable = stableEvidence();
  const cluster = fixture();
  try {
    assert.throws(
      () => promoteProductionBlueGreen({
        ...common(stable),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-no-ack",
        acknowledge: "yes",
        evidencePath: evidencePath("no-ack"),
      }),
      /acknowledge=promote-production-blue-green/,
    );
    assert.throws(
      () => promoteProductionBlueGreen({
        ...common(stable),
        execFile: cluster.execFile,
        operatorId: "production-operator",
        changeId: "change-20260727-bad-path",
        acknowledge: "promote-production-blue-green",
        evidencePath: "../outside.json",
      }),
      /must stay inside the repository/,
    );
    assert.equal(cluster.calls.length, 0);
  } finally {
    stable.cleanup();
  }
});
