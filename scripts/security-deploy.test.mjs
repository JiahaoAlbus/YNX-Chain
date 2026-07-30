import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  deployStaging,
  preflightStagingDeployment,
  validateStagingReleaseManifest,
} from "./security-deploy.mjs";

const sourceCommit = "a".repeat(40);
const context = "ynx-staging";
const clusterUid = "11111111-2222-3333-4444-555555555555";
const digest = "b".repeat(64);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function evidencePath(name) {
  return `evidence/security-platform/.security-deploy-test-${process.pid}-${name}.json`;
}

function readEvidence(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function manifest({ image = `registry.ynx.invalid/security-worker@sha256:${digest}`, suspend = false } = {}) {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ynx-services-staging
  labels:
    environment: staging
    security.ynx/manifest-class: staging-release
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: security-worker
  namespace: ynx-services-staging
  labels:
    security.ynx/manifest-class: staging-release
    security.ynx/source-commit: ${sourceCommit}
spec:
  replicas: 1
  template:
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
      - name: worker
        image: ${image}
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup
  namespace: ynx-services-staging
  labels:
    security.ynx/source-commit: ${sourceCommit}
spec:
  suspend: ${suspend}
  jobTemplate:
    spec:
      template:
        spec:
          securityContext:
            runAsNonRoot: true
          containers:
          - name: backup
            image: registry.ynx.invalid/backup@sha256:${digest}
            securityContext:
              allowPrivilegeEscalation: false
              readOnlyRootFilesystem: true
              capabilities:
                drop:
                - ALL
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: ynx-services-staging
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: strict
  namespace: ynx-services-staging
spec:
  mtls:
    mode: STRICT
---
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: staging-runtime
  namespace: ynx-services-staging
spec:
  provider: aws
`;
}

function deploymentList(ready = true) {
  return {
    items: [{
      metadata: { generation: 3 },
      spec: { replicas: 1 },
      status: { observedGeneration: ready ? 3 : 2, availableReplicas: ready ? 1 : 0 },
    }],
  };
}

function kubectlFixture({ rendered = manifest(), ready = true, rolloutFails = false } = {}) {
  const calls = [];
  const execFile = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (command === "git" && args[0] === "rev-parse") return `${sourceCommit}\n`;
    if (command === "git" && args[0] === "status") return "";
    if (command !== "kubectl") throw new Error("unexpected command");
    if (args[0] === "config") return `${context}\n`;
    if (args[0] === "kustomize") return rendered;
    if (args.includes("kube-system")) return JSON.stringify({ metadata: { uid: clusterUid } });
    if (args.includes("version")) return JSON.stringify({ serverVersion: { gitVersion: "v1.33.1" } });
    if (args.includes("--dry-run=server")) return "server dry-run passed";
    if (args.includes("apply")) return "resources applied";
    if (args.includes("diff")) return "";
    if (args.includes("rollout")) {
      if (rolloutFails) throw new Error("rollout failed");
      return "rollout complete";
    }
    if (args.includes("namespace") && args.includes("ynx-services-staging")) {
      return JSON.stringify({ metadata: { labels: { environment: "staging" } } });
    }
    if (args.includes("deployment")) return JSON.stringify(deploymentList(ready));
    if (args.includes("pods")) {
      return JSON.stringify({
        items: [{
          status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] },
        }],
      });
    }
    if (args.includes("networkpolicy")) return JSON.stringify({ items: [{ metadata: { name: "default-deny-all" } }] });
    if (args.includes("peerauthentication")) return JSON.stringify({ items: [{ spec: { mtls: { mode: "STRICT" } } }] });
    if (args.includes("cronjob")) return JSON.stringify({ items: [{ spec: { suspend: false } }] });
    if (args.includes("secretproviderclass")) return JSON.stringify({ items: [{ metadata: { name: "staging-runtime" } }] });
    throw new Error(`unexpected kubectl args: ${args.join(" ")}`);
  };
  return { execFile, calls };
}

test("staging release requires immutable images, active backups, and SecretProviderClass", () => {
  assert.equal(validateStagingReleaseManifest(manifest(), { sourceCommit }).pass, true);
  const tagged = validateStagingReleaseManifest(manifest({ image: "registry.ynx.invalid/security-worker:candidate" }), { sourceCommit });
  assert.equal(tagged.pass, false);
  assert.ok(tagged.failures.some((failure) => failure.includes("not digest-pinned")));
  const suspended = validateStagingReleaseManifest(manifest({ suspend: true }), { sourceCommit });
  assert.equal(suspended.pass, false);
  assert.ok(suspended.failures.some((failure) => failure.includes("must be active")));
  const noProvider = validateStagingReleaseManifest(
    manifest().replace(/^apiVersion: secrets-store[\s\S]*$/m, ""),
    { sourceCommit },
  );
  assert.equal(noProvider.pass, false);
  assert.ok(noProvider.failures.some((failure) => failure.includes("SecretProviderClass")));
  const unbound = validateStagingReleaseManifest(
    manifest().replaceAll(`security.ynx/source-commit: ${sourceCommit}`, "security.ynx/source-commit: unbound"),
    { sourceCommit },
  );
  assert.equal(unbound.pass, false);
  assert.ok(unbound.failures.some((failure) => failure.includes("not bound to sourceCommit")));
  const suffixed = validateStagingReleaseManifest(
    manifest().replaceAll(
      `security.ynx/source-commit: ${sourceCommit}`,
      `security.ynx/source-commit: ${sourceCommit}0`,
    ),
    { sourceCommit },
  );
  assert.equal(suffixed.pass, false);
  assert.ok(suffixed.failures.some((failure) => failure.includes("not bound to sourceCommit")));
});

test("preflight binds clean Git, context, cluster UID, manifest, and server dry-run", () => {
  const fixture = kubectlFixture();
  const { receipt } = preflightStagingDeployment({
    context,
    expectedClusterUid: clusterUid,
    sourceCommit,
    execFile: fixture.execFile,
    now: new Date("2026-07-26T12:00:00.000Z"),
  });
  assert.equal(receipt.serverDryRunPassed, true);
  assert.equal(receipt.mutationPerformed, false);
  assert.equal(receipt.deployedStaging, false);
  assert.equal(receipt.imageDigests.every((value) => /^[0-9a-f]{64}$/.test(value)), true);
  assert.equal("images" in receipt, false);
  const dryRun = fixture.calls.find((call) => call.args.includes("--dry-run=server"));
  assert.ok(dryRun);
  assert.match(dryRun.input, /kind: Deployment/);
});

test("preflight rejects wrong cluster identity and unpromoted candidates before apply", () => {
  const unboundManifest = kubectlFixture();
  assert.throws(
    () => preflightStagingDeployment({
      context,
      expectedClusterUid: clusterUid,
      sourceCommit,
      manifest: manifest(),
      execFile: unboundManifest.execFile,
    }),
    /requires a release input digest/,
  );
  assert.equal(unboundManifest.calls.length, 0);
  const ambiguousSource = kubectlFixture();
  assert.throws(
    () => preflightStagingDeployment({
      context,
      expectedClusterUid: clusterUid,
      sourceCommit,
      overlay: "infra/k8s/overlays/staging",
      manifest: manifest(),
      releaseInputSha256: "c".repeat(64),
      execFile: ambiguousSource.execFile,
    }),
    /cannot both be selected/,
  );
  assert.equal(ambiguousSource.calls.length, 0);
  const wrongCluster = kubectlFixture();
  assert.throws(
    () => preflightStagingDeployment({
      context,
      expectedClusterUid: "99999999-2222-3333-4444-555555555555",
      sourceCommit,
      execFile: wrongCluster.execFile,
    }),
    /UID does not match/,
  );
  const candidate = kubectlFixture({
    rendered: manifest().replaceAll("staging-release", "deployment-candidate"),
  });
  assert.throws(
    () => preflightStagingDeployment({
      context,
      expectedClusterUid: clusterUid,
      sourceCommit,
      execFile: candidate.execFile,
    }),
    /deployment-candidate manifests cannot be applied/,
  );
  assert.equal(candidate.calls.some((call) => call.args.includes("apply")), false);
});

test("deploy refuses an escaping evidence path before mutation", () => {
  const fixture = kubectlFixture();
  assert.throws(
    () => deployStaging({
      context,
      expectedClusterUid: clusterUid,
      sourceCommit,
      operatorId: "staging-operator",
      changeId: "change-20260726-1",
      acknowledge: "apply-staging",
      evidencePath: "../outside.json",
      execFile: fixture.execFile,
    }),
    /evidence path must stay inside/,
  );
  assert.equal(fixture.calls.filter((call) => call.args.includes("apply")).length, 1);
  assert.equal(fixture.calls.some((call) => call.args.includes("--dry-run=server")), true);
});

test("deploy applies only after dry-run and records verified staging readiness", () => {
  const fixture = kubectlFixture();
  const path = evidencePath("success");
  try {
    const result = deployStaging({
      context,
      expectedClusterUid: clusterUid,
      sourceCommit,
      operatorId: "staging-operator",
      changeId: "change-20260726-1",
      acknowledge: "apply-staging",
      evidencePath: path,
      execFile: fixture.execFile,
      now: (() => {
        const times = [
          new Date("2026-07-26T12:00:00.000Z"),
          new Date("2026-07-26T12:01:00.000Z"),
        ];
        return () => times.shift();
      })(),
    });
    assert.equal(result.state, "deployed-staging-verified");
    assert.equal(result.deployedStaging, true);
    assert.equal(result.deployedPublic, false);
    assert.equal(result.readiness.pass, true);
    assert.equal(result.liveManifestReconciled, true);
    assert.deepEqual(readEvidence(path), result);
    const mutationCalls = fixture.calls.filter((call) => call.args.includes("apply"));
    assert.equal(mutationCalls.length, 2);
    assert.equal(mutationCalls[0].args.includes("--dry-run=server"), true);
    assert.equal(mutationCalls[1].args.includes("--dry-run=server"), false);
    assert.equal(mutationCalls[1].args.includes("--force-conflicts"), false);
    assert.equal(fixture.calls.some((call) => call.args.includes("diff")), true);
  } finally {
    rmSync(resolve(root, path), { force: true });
  }
});

test("rollout failure records an applied-but-unverified state", () => {
  const fixture = kubectlFixture({ rolloutFails: true });
  const path = evidencePath("rollout-failed");
  try {
    assert.throws(
      () => deployStaging({
        context,
        expectedClusterUid: clusterUid,
        sourceCommit,
        operatorId: "staging-operator",
        changeId: "change-20260726-2",
        acknowledge: "apply-staging",
        evidencePath: path,
        execFile: fixture.execFile,
        now: () => new Date("2026-07-26T12:00:00.000Z"),
      }),
      /rollout verification failed/,
    );
    const evidence = readEvidence(path);
    assert.equal(evidence.state, "apply-completed-verification-failed");
    assert.equal(evidence.mutationPerformed, true);
    assert.equal(evidence.deployedStaging, false);
  } finally {
    rmSync(resolve(root, path), { force: true });
  }
});

test("deploy requires explicit acknowledgement and evidence before mutation", () => {
  const fixture = kubectlFixture();
  assert.throws(
    () => deployStaging({
      context,
      expectedClusterUid: clusterUid,
      sourceCommit,
      operatorId: "staging-operator",
      changeId: "change-20260726-1",
      acknowledge: "dry-run",
      evidencePath: "evidence/security-platform/staging.json",
      execFile: fixture.execFile,
    }),
    /acknowledge=apply-staging/,
  );
  assert.equal(fixture.calls.length, 0);
});
