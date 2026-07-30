import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deployProduction,
  preflightProductionDeployment,
} from "./security-production-deploy.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceCommit = "a".repeat(40);
const quantDigest = "b".repeat(64);
const backupDigest = "d".repeat(64);
const context = "ynx-production";
const clusterUid = "11111111-2222-3333-4444-555555555555";
const version = "1.0.0";

function manifest() {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ynx-services
  labels:
    environment: production
    security.ynx/manifest-class: production-release
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quant-worker
  namespace: ynx-services
  labels:
    security.ynx/source-commit: ${sourceCommit}
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: worker
        image: registry.ynxweb4.com/security/quant-worker@sha256:${quantDigest}
`;
}

function probePolicy() {
  return {
    schemaVersion: 1,
    environment: "production",
    tlsHosts: [
      "rpc.ynxweb4.com",
      "evm.ynxweb4.com",
      "rest.ynxweb4.com",
      "faucet.ynxweb4.com",
      "indexer.ynxweb4.com",
      "explorer.ynxweb4.com",
      "ai.ynxweb4.com",
      "web4.ynxweb4.com",
    ],
    services: [
      { name: "faucet", host: "faucet.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
      { name: "indexer", host: "indexer.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
      { name: "ai-gateway", host: "ai.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
      { name: "web4-hub", host: "web4.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
    ],
    connectTimeoutSeconds: 5,
    totalTimeoutSeconds: 15,
    maxResponseBytes: 65536,
  };
}

function releaseBundle() {
  return {
    receipt: {
      schemaVersion: 1,
      action: "production-release-preflight",
      sourceCommit,
      runtimeSourceCommit: sourceCommit,
      version,
      productionManifestSha256: "e".repeat(64),
      publicProbePolicySha256: "f".repeat(64),
      asOf: "2026-07-26T17:00:00.000Z",
      productionSigned: true,
      deployedPublic: false,
      mutationPerformed: false,
    },
    manifest: manifest(),
    attestation: {
      images: [
        {
          role: "backup-operator",
          reference: `registry.ynxweb4.com/security/backup-operator@sha256:${backupDigest}`,
        },
        {
          role: "quant-worker",
          reference: `registry.ynxweb4.com/security/quant-worker@sha256:${quantDigest}`,
        },
      ],
    },
    publicProbePolicy: probePolicy(),
  };
}

function deploymentList() {
  return {
    items: [{
      metadata: {
        name: "quant-worker",
        generation: 4,
        labels: { "security.ynx/source-commit": sourceCommit },
      },
      spec: { replicas: 3 },
      status: { observedGeneration: 4, availableReplicas: 3 },
    }],
  };
}

function pods() {
  return {
    items: [1, 2, 3].map((index) => ({
      metadata: { name: `quant-worker-${index}`, labels: { app: "quant-worker" } },
      status: {
        conditions: [{ type: "Ready", status: "True" }],
        containerStatuses: [{
          ready: true,
          restartCount: 0,
          imageID: `docker-pullable://registry.ynxweb4.com/security/quant-worker@sha256:${quantDigest}`,
        }],
      },
    })),
  };
}

function ingress() {
  return {
    metadata: {
      annotations: {
        "cert-manager.io/cluster-issuer": "letsencrypt-production",
        "nginx.ingress.kubernetes.io/ssl-redirect": "true",
        "nginx.ingress.kubernetes.io/enable-modsecurity": "true",
      },
    },
    spec: {
      ingressClassName: "nginx",
      tls: [{ hosts: probePolicy().tlsHosts, secretName: "ynx-tls-cert" }],
    },
  };
}

function fixture({
  existingProduction = false,
  publicIdentityFails = false,
} = {}) {
  const calls = [];
  const execFile = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (command === "kubectl") {
      if (args[0] === "config") return `${context}\n`;
      if (args.includes("kube-system")) return JSON.stringify({ metadata: { uid: clusterUid } });
      if (args.includes("version")) return JSON.stringify({ serverVersion: { gitVersion: "v1.33.1" } });
      if (
        args.includes("get")
        && args.includes("deployment")
        && args.includes("quant-worker")
        && args.includes("--ignore-not-found=true")
      ) {
        return existingProduction ? JSON.stringify(deploymentList().items[0]) : "";
      }
      if (args.includes("--dry-run=server")) return "production dry-run passed";
      if (args.includes("apply")) return "production resources applied";
      if (args.includes("diff")) return "";
      if (args.includes("rollout")) return "production rollout complete";
      if (args.includes("namespace") && args.includes("ynx-services")) {
        return JSON.stringify({ metadata: { labels: { environment: "production" } } });
      }
      if (args.includes("deployment")) return JSON.stringify(deploymentList());
      if (args.includes("pods")) return JSON.stringify(pods());
      if (args.includes("networkpolicy")) {
        return JSON.stringify({ items: [{ metadata: { name: "default-deny-all" } }] });
      }
      if (args.includes("peerauthentication")) {
        return JSON.stringify({ items: [{ spec: { mtls: { mode: "STRICT" } } }] });
      }
      if (args.includes("cronjob")) {
        return JSON.stringify({
          items: [{
            metadata: { labels: { "security.ynx/source-commit": sourceCommit } },
            spec: { suspend: false },
          }],
        });
      }
      if (args.includes("secretproviderclass")) {
        return JSON.stringify({ items: [{ metadata: { name: "ynx-production-secrets" } }] });
      }
      if (args.includes("ingress")) return JSON.stringify(ingress());
      if (args.includes("resourcequota")) {
        return JSON.stringify({ spec: { hard: { pods: "50", "services.loadbalancers": "3" } } });
      }
      if (args.includes("hpa")) return JSON.stringify({ spec: { minReplicas: 3, maxReplicas: 10 } });
      if (args.includes("configmap")) {
        return JSON.stringify({
          data: {
            "enable-modsecurity": "true",
            "enable-owasp-modsecurity-crs": "true",
          },
        });
      }
      if (args.includes("certificate")) {
        return JSON.stringify({
          spec: {
            secretName: "ynx-tls-cert",
            issuerRef: {
              kind: "ClusterIssuer",
              name: "letsencrypt-production",
              group: "cert-manager.io",
            },
          },
          status: {
            notBefore: "2026-07-26T16:00:00.000Z",
            notAfter: "2027-07-26T17:00:00.000Z",
            conditions: [{ type: "Ready", status: "True" }],
          },
        });
      }
      throw new Error(`unexpected kubectl command: ${args.join(" ")}`);
    }
    if (command === "curl") {
      if (args.includes("--write-out")) return "200|0|203.0.113.10";
      const url = args.at(-1);
      if (url.endsWith("/health")) {
        return JSON.stringify({
          status: "ok",
          environment: "production",
          source: new URL(url).hostname.split(".")[0] === "ai" ? "ai-gateway"
            : new URL(url).hostname.split(".")[0] === "web4" ? "web4-hub"
              : new URL(url).hostname.split(".")[0],
          sourceCommit: publicIdentityFails ? "wrong" : sourceCommit,
          version,
          asOf: "2026-07-26T17:00:00.000Z",
        });
      }
      if (url.endsWith("/version")) {
        return JSON.stringify({
          environment: "production",
          source: new URL(url).hostname.split(".")[0] === "ai" ? "ai-gateway"
            : new URL(url).hostname.split(".")[0] === "web4" ? "web4-hub"
              : new URL(url).hostname.split(".")[0],
          sourceCommit,
          version,
          asOf: "2026-07-26T17:00:00.000Z",
        });
      }
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, execFile };
}

function evidencePath(name) {
  return `evidence/security-platform/.production-deploy-${process.pid}-${name}.json`;
}

function leaseFactory() {
  return {
    receipt: { lock: "default/ynx-production-release-lock" },
    renew: () => ({ renewedAt: "2026-07-26T17:00:00.000Z" }),
    release: () => ({ releasedAt: "2026-07-26T17:06:00.000Z", expired: true }),
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
  return {
    authorizationId: approval.authorizationId,
    immutable: true,
    consumed: true,
  };
}

const alertCredentialIdentity = "4".repeat(64);

function alertInputPreflight({ sourceCommit: executingCommit }) {
  assert.equal(executingCommit, sourceCommit);
  return {
    sourceCommit: executingCommit,
    alertDeliveryPerformed: false,
    productionMutationPerformed: false,
    credentialBinding: {
      bound: true,
      credentialIdentitySha256: alertCredentialIdentity,
    },
    ready: true,
  };
}

function alertDispatcher({ approval, sourceCommit: executingCommit }) {
  assert.equal(executingCommit, sourceCommit);
  return {
    authorizationId: approval.authorizationId,
    credentialBinding: {
      credentialIdentitySha256: alertCredentialIdentity,
    },
    delivered: true,
  };
}

function operatorBundlePreflight() {
  return {
    schemaVersion: 1,
    action: "production-operation-bundle-preflight",
    operation: "initial-deployment",
    bundleSha256: "6".repeat(64),
    runtimeSourceCommit: sourceCommit,
    changeAuthorization: {
      authorizationId: "2".repeat(64),
    },
    alertPreflight: {
      credentialBinding: {
        credentialIdentitySha256: alertCredentialIdentity,
      },
    },
    receiptSha256: "7".repeat(64),
    leaseAcquired: false,
    alertDeliveryPerformed: false,
    productionMutationPerformed: false,
    ready: true,
  };
}

test("production preflight binds signed release, cluster identity, and server dry-run", () => {
  const cluster = fixture();
  const verified = [];
  const result = preflightProductionDeployment({
    context,
    expectedClusterUid: clusterUid,
    execFile: cluster.execFile,
    verifyRelease: (options) => {
      verified.push(options);
      return releaseBundle();
    },
    authorize,
    now: new Date("2026-07-26T17:00:00.000Z"),
  });
  assert.equal(result.receipt.action, "production-deployment-preflight");
  assert.equal(result.receipt.productionSigned, true);
  assert.equal(result.receipt.operatorAuthorization.pass, true);
  assert.equal(result.receipt.serverDryRunPassed, true);
  assert.equal(result.receipt.mutationPerformed, false);
  assert.equal(result.receipt.deployedPublic, false);
  assert.equal(verified.length, 1);
  const dryRun = cluster.calls.find((call) => call.args.includes("--dry-run=server"));
  assert.ok(dryRun);
  assert.match(dryRun.input, /kind: Deployment/);
});

test("initial deployment runtime rejects an existing production release before dry-run", () => {
  const cluster = fixture({ existingProduction: true });
  assert.throws(
    () => preflightProductionDeployment({
      context,
      expectedClusterUid: clusterUid,
      execFile: cluster.execFile,
      verifyRelease: () => releaseBundle(),
      authorize,
      approvalBinder,
      approvalConsumer,
      alertDispatcher,
      alertInputPreflight,
      leaseFactory,
      now: new Date("2026-07-26T17:00:00.000Z"),
    }),
    /blue-green update runtime/,
  );
  assert.equal(cluster.calls.some((call) => call.args.includes("--dry-run=server")), false);
});

test("production deploy sets public truth only after live controls and HTTPS probes", () => {
  const cluster = fixture();
  const path = evidencePath("success");
  try {
    const result = deployProduction({
      context,
      expectedClusterUid: clusterUid,
      operatorId: "production-operator",
      changeId: "change-20260726-production",
      acknowledge: "apply-production-release",
      evidencePath: path,
      rolloutTimeoutSeconds: 600,
      execFile: cluster.execFile,
      verifyRelease: () => releaseBundle(),
      authorize,
      approvalBinder,
      approvalConsumer,
      alertDispatcher,
      alertInputPreflight,
      operatorBundlePreflight: operatorBundlePreflight(),
      leaseFactory,
      now: (() => {
        const values = [
          new Date("2026-07-26T17:00:00.000Z"),
          new Date("2026-07-26T17:05:00.000Z"),
          new Date("2026-07-26T17:06:00.000Z"),
        ];
        return () => values.shift();
      })(),
    });
    assert.equal(result.state, "deployed-public-verified");
    assert.equal(result.productionSigned, true);
    assert.equal(result.deployedPublic, true);
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.productionLeaseReleased, true);
    assert.equal(result.productionLeaseRenewals.length, 2);
    assert.equal(result.changeApproval.bound, true);
    assert.equal(result.approvalConsumption.consumed, true);
    assert.equal(result.alertDelivery.delivered, true);
    assert.equal(result.alertInputPreflight.ready, true);
    assert.equal(result.operatorBundleBinding.bound, true);
    assert.equal(result.operatorBundleBinding.bundleSha256, "6".repeat(64));
    assert.equal(result.readiness.pass, true);
    assert.equal(result.publicProbes.tls.length, 8);
    assert.equal(result.publicProbes.services.length, 4);
    assert.deepEqual(JSON.parse(readFileSync(resolve(root, path), "utf8")), result);
    const mutationCalls = cluster.calls.filter((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    ));
    assert.equal(mutationCalls.length, 1);
    assert.equal(cluster.calls.some((call) => call.args.includes("--force-conflicts")), false);
    assert.equal(cluster.calls.some((call) => call.args.includes("delete")), false);
    assert.equal(cluster.calls.some((call) => call.args.includes("secret")), false);
  } finally {
    rmSync(resolve(root, path), { force: true });
  }
});

test("public identity failure records applied but not publicly verified truth", () => {
  const cluster = fixture({ publicIdentityFails: true });
  const path = evidencePath("probe-failure");
  try {
    assert.throws(
      () => deployProduction({
        context,
        expectedClusterUid: clusterUid,
        operatorId: "production-operator",
        changeId: "change-20260726-production-failure",
        acknowledge: "apply-production-release",
        evidencePath: path,
        execFile: cluster.execFile,
        verifyRelease: () => releaseBundle(),
        authorize,
        approvalBinder,
        approvalConsumer,
        alertDispatcher,
        alertInputPreflight,
        leaseFactory,
        now: (() => {
          const values = [
            new Date("2026-07-26T17:00:00.000Z"),
            new Date("2026-07-26T17:00:30.000Z"),
            new Date("2026-07-26T17:01:00.000Z"),
          ];
          return () => values.shift();
        })(),
      }),
      /public response identity failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.state, "apply-completed-verification-failed");
    assert.equal(result.productionSigned, true);
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.deployedPublic, false);
  } finally {
    rmSync(resolve(root, path), { force: true });
  }
});

test("approval consumption failure prevents production Apply", () => {
  const cluster = fixture();
  const path = evidencePath("approval-consumption-failed");
  try {
    assert.throws(
      () => deployProduction({
        context,
        expectedClusterUid: clusterUid,
        operatorId: "production-operator",
        changeId: "change-20260726-approval-failed",
        acknowledge: "apply-production-release",
        evidencePath: path,
        execFile: cluster.execFile,
        verifyRelease: () => releaseBundle(),
        authorize,
        approvalBinder,
        alertInputPreflight,
        alertDispatcher,
        approvalConsumer: () => {
          throw new Error("production approval consumption failed");
        },
        leaseFactory,
        now: (() => {
          const values = [
            new Date("2026-07-26T17:00:00.000Z"),
            new Date("2026-07-26T17:00:30.000Z"),
          ];
          return () => values.shift();
        })(),
      }),
      /production approval consumption failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.approvalConsumptionAttempted, true);
    assert.equal(result.approvalConsumption, null);
    assert.equal(result.productionLeaseReleased, true);
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.deployedPublic, false);
    assert.equal(cluster.calls.some((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    )), false);
  } finally {
    rmSync(resolve(root, path), { force: true });
  }
});

test("alert delivery failure prevents approval consumption and production Apply", () => {
  const cluster = fixture();
  const path = evidencePath("alert-delivery-failed");
  let consumptionAttempted = false;
  try {
    assert.throws(
      () => deployProduction({
        context,
        expectedClusterUid: clusterUid,
        operatorId: "production-operator",
        changeId: "change-20260726-alert-failed",
        acknowledge: "apply-production-release",
        evidencePath: path,
        execFile: cluster.execFile,
        verifyRelease: () => releaseBundle(),
        authorize,
        approvalBinder,
        alertInputPreflight,
        alertDispatcher: () => {
          throw new Error("production change alert delivery failed");
        },
        approvalConsumer: () => {
          consumptionAttempted = true;
        },
        leaseFactory,
        now: (() => {
          const values = [
            new Date("2026-07-26T17:00:00.000Z"),
            new Date("2026-07-26T17:00:30.000Z"),
          ];
          return () => values.shift();
        })(),
      }),
      /production change alert delivery failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.alertDeliveryAttempted, true);
    assert.equal(result.alertDelivery, null);
    assert.equal(result.approvalConsumptionAttempted, false);
    assert.equal(result.productionLeaseReleased, true);
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.deployedPublic, false);
    assert.equal(consumptionAttempted, false);
    assert.equal(cluster.calls.some((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    )), false);
  } finally {
    rmSync(resolve(root, path), { force: true });
  }
});

test("external alert input failure prevents Lease, delivery, and production mutation", () => {
  const cluster = fixture();
  const path = evidencePath("alert-input-preflight-failed");
  let leaseAttempted = false;
  let deliveryAttempted = false;
  assert.throws(
    () => deployProduction({
      context,
      expectedClusterUid: clusterUid,
      operatorId: "production-operator",
      changeId: "change-20260726-alert-input-failed",
      acknowledge: "apply-production-release",
      evidencePath: path,
      execFile: cluster.execFile,
      verifyRelease: () => releaseBundle(),
      authorize,
      approvalBinder,
      alertInputPreflight: () => {
        throw new Error("production alert secret inventory is not trusted and current");
      },
      alertDispatcher: () => {
        deliveryAttempted = true;
      },
      leaseFactory: () => {
        leaseAttempted = true;
      },
      now: () => new Date("2026-07-26T17:00:00.000Z"),
    }),
    /secret inventory is not trusted/,
  );
  assert.equal(leaseAttempted, false);
  assert.equal(deliveryAttempted, false);
  assert.equal(cluster.calls.some((call) => (
    call.args.includes("apply") && !call.args.includes("--dry-run=server")
  )), false);
  assert.throws(() => readFileSync(resolve(root, path), "utf8"));
});

test("credential drift after preflight prevents approval consumption and production Apply", () => {
  const cluster = fixture();
  const path = evidencePath("alert-credential-drift");
  let consumptionAttempted = false;
  try {
    assert.throws(
      () => deployProduction({
        context,
        expectedClusterUid: clusterUid,
        operatorId: "production-operator",
        changeId: "change-20260726-alert-credential-drift",
        acknowledge: "apply-production-release",
        evidencePath: path,
        execFile: cluster.execFile,
        verifyRelease: () => releaseBundle(),
        authorize,
        approvalBinder,
        alertInputPreflight,
        alertDispatcher: () => ({
          credentialBinding: {
            credentialIdentitySha256: "5".repeat(64),
          },
          delivered: true,
        }),
        approvalConsumer: () => {
          consumptionAttempted = true;
        },
        leaseFactory,
        now: (() => {
          const values = [
            new Date("2026-07-26T17:00:00.000Z"),
            new Date("2026-07-26T17:00:30.000Z"),
          ];
          return () => values.shift();
        })(),
      }),
      /credential changed after external input preflight/,
    );
    const result = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    assert.equal(result.alertDelivery.delivered, true);
    assert.equal(result.approvalConsumptionAttempted, false);
    assert.equal(result.productionLeaseReleased, true);
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.deployedPublic, false);
    assert.equal(consumptionAttempted, false);
    assert.equal(cluster.calls.some((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    )), false);
  } finally {
    rmSync(resolve(root, path), { force: true });
  }
});

test("production RBAC failure prevents dry-run, Lease, and mutation", () => {
  const cluster = fixture();
  let leaseAttempted = false;
  assert.throws(
    () => deployProduction({
      context,
      expectedClusterUid: clusterUid,
      operatorId: "production-operator",
      changeId: "change-20260726-rbac-rejected",
      acknowledge: "apply-production-release",
      evidencePath: evidencePath("rbac-rejected"),
      execFile: cluster.execFile,
      verifyRelease: () => releaseBundle(),
      authorize: () => {
        throw new Error("production operator RBAC boundary failed: require:patch");
      },
      leaseFactory: () => {
        leaseAttempted = true;
      },
      now: () => new Date("2026-07-26T17:00:00.000Z"),
    }),
    /production operator RBAC boundary failed/,
  );
  assert.equal(cluster.calls.some((call) => call.args.includes("--dry-run=server")), false);
  assert.equal(cluster.calls.some((call) => (
    call.args.includes("apply") && !call.args.includes("--dry-run=server")
  )), false);
  assert.equal(leaseAttempted, false);
});

test("production Lease acquisition failure prevents production mutation", () => {
  const cluster = fixture();
  const path = evidencePath("lease-rejected");
  assert.throws(
    () => deployProduction({
      context,
      expectedClusterUid: clusterUid,
      operatorId: "production-operator",
      changeId: "change-20260726-production-locked",
      acknowledge: "apply-production-release",
      evidencePath: path,
      execFile: cluster.execFile,
      verifyRelease: () => releaseBundle(),
      authorize,
      approvalBinder,
      approvalConsumer,
      alertInputPreflight,
      leaseFactory: () => {
        throw new Error("production release mutation is locked by another active operator");
      },
      now: () => new Date("2026-07-26T17:00:00.000Z"),
    }),
    /locked by another active operator/,
  );
  assert.equal(cluster.calls.some((call) => (
    call.args.includes("apply") && !call.args.includes("--dry-run=server")
  )), false);
  rmSync(resolve(root, path), { force: true });
});

test("production mutation requires exact acknowledgement and a bounded evidence path", () => {
  const cluster = fixture();
  assert.throws(
    () => deployProduction({
      context,
      expectedClusterUid: clusterUid,
      operatorId: "production-operator",
      changeId: "change-20260726-production",
      acknowledge: "apply-staging",
      evidencePath: evidencePath("ack"),
      execFile: cluster.execFile,
      verifyRelease: () => releaseBundle(),
      authorize,
    }),
    /acknowledge=apply-production-release/,
  );
  assert.equal(cluster.calls.length, 0);
  assert.throws(
    () => deployProduction({
      context,
      expectedClusterUid: clusterUid,
      operatorId: "production-operator",
      changeId: "change-20260726-production",
      acknowledge: "apply-production-release",
      evidencePath: "../outside.json",
      execFile: cluster.execFile,
      verifyRelease: () => releaseBundle(),
      authorize,
    }),
    /must stay inside/,
  );
  assert.equal(cluster.calls.length, 0);
});
