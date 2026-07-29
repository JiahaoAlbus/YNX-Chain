import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  executeProductionOperation,
  preflightProductionOperation,
  productionOperationBundleDigest,
  validateProductionOperationBundle,
} from "./security-production-operation.mjs";
import { bindProductionOperationExecution } from "./security-production-operation-binding.mjs";

const runtimeCommit = "a".repeat(40);
const evidenceDigest = "b".repeat(64);
const inventoryDigest = "c".repeat(64);
const policyDigest = "d".repeat(64);
const now = new Date("2026-07-27T06:00:00.000Z");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function releaseRequestBytes(path) {
  return `${JSON.stringify({ schemaVersion: 1, path })}\n`;
}

function releaseRequestDigest(path) {
  return sha256(releaseRequestBytes(path));
}

function common(operation, acknowledge, inputs) {
  return {
    schemaVersion: 1,
    operation,
    runtimeSourceCommit: runtimeCommit,
    context: "ynx-production",
    expectedClusterUid: "11111111-2222-3333-4444-555555555555",
    operatorId: "production-operator",
    changeId: `change-20260727-${operation}`,
    acknowledge,
    evidencePath: `release/evidence/${operation}.json`,
    rolloutTimeoutSeconds: 600,
    leaseDurationSeconds: 600,
    alert: {
      endpoint: "https://alerts.security.ynxweb4.com/v1/events",
      expectedHost: "alerts.security.ynxweb4.com",
      credentialHeaderFile: "/run/secrets/ynx/production-alert-authorization-header",
      credentialVersionFile: "/run/secrets/ynx/production-alert-authorization-header.version-id",
      secretInventoryPath: "/secure/operator/secret-inventory.json",
      secretInventorySha256: inventoryDigest,
    },
    inputs,
  };
}

function initialBundle() {
  const releaseRequestPath = "/secure/operator/release-request.json";
  return common("initial-deployment", "apply-production-release", {
    releaseRequestPath,
    releaseRequestSha256: releaseRequestDigest(releaseRequestPath),
  });
}

function blueGreenBundle() {
  const stableReleaseRequestPath = "/secure/operator/stable-release.json";
  const candidateReleaseRequestPath = "/secure/operator/candidate-release.json";
  return common("blue-green-update", "promote-production-blue-green", {
    stableReleaseRequestPath,
    stableReleaseRequestSha256: releaseRequestDigest(stableReleaseRequestPath),
    candidateReleaseRequestPath,
    candidateReleaseRequestSha256: releaseRequestDigest(candidateReleaseRequestPath),
    stableEvidencePath: "release/evidence/stable.json",
    stableEvidenceSha256: evidenceDigest,
    observationSeconds: 300,
    sampleIntervalSeconds: 30,
  });
}

function rollbackBundle() {
  const currentReleaseRequestPath = "/secure/operator/current-release.json";
  const targetReleaseRequestPath = "/secure/operator/target-release.json";
  return common("manual-rollback", "rollback-production-release", {
    currentReleaseRequestPath,
    currentReleaseRequestSha256: releaseRequestDigest(currentReleaseRequestPath),
    targetReleaseRequestPath,
    targetReleaseRequestSha256: releaseRequestDigest(targetReleaseRequestPath),
    currentEvidencePath: "release/evidence/current.json",
    currentEvidenceSha256: evidenceDigest,
    targetEvidencePath: "release/evidence/target.json",
    targetEvidenceSha256: "e".repeat(64),
    authorizationRequestPath: "/secure/operator/authorization-request.json",
    authorizationPolicyPath: "/secure/operator/authorization-policy.json",
    authorizationApprovalPaths: [
      "/secure/operator/security-approval.json",
      "/secure/operator/sre-approval.json",
    ],
    trustedAuthorizationPolicySha256: policyDigest,
  });
}

function validate(bundle) {
  const digest = productionOperationBundleDigest(bundle);
  return validateProductionOperationBundle(bundle, digest);
}

test("all production operations have strict, digest-bound, value-free bundles", () => {
  for (const bundle of [initialBundle(), blueGreenBundle(), rollbackBundle()]) {
    assert.equal(validate(bundle), bundle);
    assert.match(productionOperationBundleDigest(bundle), /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(bundle).includes("Authorization: Bearer"), false);
    assert.equal(JSON.stringify(bundle).includes("signatureBase64"), false);
  }
});

test("bundle rejects digest drift, extra fields, wrong acknowledgement, and escaping evidence", () => {
  const base = initialBundle();
  assert.throws(
    () => validateProductionOperationBundle(base, "0".repeat(64)),
    /digest does not match/,
  );
  assert.throws(
    () => validate({ ...base, token: "must-not-exist" }),
    /fields are invalid/,
  );
  assert.throws(
    () => validate({ ...base, acknowledge: "apply-staging" }),
    /acknowledgement is invalid/,
  );
  assert.throws(
    () => validate({ ...base, evidencePath: "../outside.json" }),
    /must stay inside/,
  );
});

test("operation-specific fields and rollback approval multiplicity are enforced", () => {
  assert.throws(
    () => validate({
      ...blueGreenBundle(),
      inputs: { ...blueGreenBundle().inputs, observationSeconds: 10 },
    }),
    /observationSeconds/,
  );
  assert.throws(
    () => validate({
      ...rollbackBundle(),
      inputs: {
        ...rollbackBundle().inputs,
        authorizationApprovalPaths: ["/secure/operator/one.json"],
      },
    }),
    /2-5 unique/,
  );
  assert.throws(
    () => validate({
      ...initialBundle(),
      inputs: {
        releaseRequestPath: "/secure/operator/release-request.json",
        releaseRequestSha256: initialBundle().inputs.releaseRequestSha256,
        targetReleaseRequestPath: "/unexpected.json",
      },
    }),
    /fields are invalid/,
  );
});

function readFixture(path) {
  if (path.endsWith("secret-inventory.json")) return JSON.stringify({ inventory: true });
  if (path.includes("authorization-request")) return JSON.stringify({ request: true });
  if (path.includes("authorization-policy")) return JSON.stringify({ policy: true });
  if (path.includes("approval")) return JSON.stringify({ approval: path });
  if (path.includes("release")) return releaseRequestBytes(path);
  throw new Error(`unexpected read ${path}`);
}

function releaseOptions() {
  return { runtimeSourceCommit: runtimeCommit };
}

function release(role = "initial") {
  return {
    receipt: {
      action: `${role}-release-preflight`,
      runtimeSourceCommit: runtimeCommit,
    },
  };
}

function preflightDependencies(calls) {
  return {
    readFile: readFixture,
    loadReleaseRequest: (path) => {
      calls.push(["load-release", path]);
      return releaseOptions();
    },
    preflightInitial: (options) => {
      calls.push(["initial-preflight", options]);
      return release();
    },
    preflightBlueGreen: (options) => {
      calls.push(["blue-green-preflight", options]);
      return {
        receipt: { action: "blue-green-preflight" },
        stable: release("stable"),
        candidate: release("candidate"),
      };
    },
    preflightRollback: (options) => {
      calls.push(["rollback-preflight", options]);
      return {
        receipt: { action: "rollback-preflight" },
        current: release("current"),
        target: release("target"),
      };
    },
    preflightAlert: (options) => {
      calls.push(["alert-preflight", options]);
      return {
        sourceCommit: runtimeCommit,
        credentialBinding: {
          bound: true,
          credentialIdentitySha256: "2".repeat(64),
        },
        alertDeliveryPerformed: false,
        productionMutationPerformed: false,
        ready: true,
      };
    },
    bindReleaseApproval: (options) => {
      calls.push(["release-approval", options]);
      return { authorizationId: "1".repeat(64), bound: true };
    },
    bindRollbackApproval: (options) => {
      calls.push(["rollback-approval", options]);
      return { authorizationId: "1".repeat(64), bound: true };
    },
  };
}

test("initial bundle preflight is read-only and binds release approval plus alert inputs", () => {
  const bundle = initialBundle();
  const calls = [];
  const result = preflightProductionOperation({
    bundle,
    trustedBundleSha256: productionOperationBundleDigest(bundle),
    now,
    ...preflightDependencies(calls),
  });
  assert.equal(result.operation, "initial-deployment");
  assert.equal(result.ready, true);
  assert.equal(result.leaseAcquired, false);
  assert.equal(result.alertDeliveryPerformed, false);
  assert.equal(result.productionMutationPerformed, false);
  assert.equal(calls.some(([name]) => name === "initial-preflight"), true);
  assert.equal(calls.some(([name]) => name === "release-approval"), true);
  assert.equal(calls.some(([name]) => name === "alert-preflight"), true);
  assert.equal(calls.some(([name]) => name.startsWith("execute")), false);
});

test("blue-green and rollback preflight map exact releases, evidence, and authorization", () => {
  for (const bundle of [blueGreenBundle(), rollbackBundle()]) {
    const calls = [];
    const result = preflightProductionOperation({
      bundle,
      trustedBundleSha256: productionOperationBundleDigest(bundle),
      now,
      ...preflightDependencies(calls),
    });
    assert.equal(result.operation, bundle.operation);
    assert.equal(result.ready, true);
    if (bundle.operation === "blue-green-update") {
      const mapped = calls.find(([name]) => name === "blue-green-preflight")[1];
      assert.equal(mapped.stableEvidenceSha256, evidenceDigest);
      assert.equal(mapped.observationSeconds, 300);
      assert.equal(calls.some(([name]) => name === "release-approval"), true);
    } else {
      const mapped = calls.find(([name]) => name === "rollback-preflight")[1];
      assert.equal(mapped.currentEvidenceSha256, evidenceDigest);
      const approval = calls.find(([name]) => name === "rollback-approval")[1];
      assert.equal(approval.authorizationOptions.approvals.length, 2);
      assert.equal(approval.authorizationOptions.trustedPolicySha256, policyDigest);
    }
  }
});

test("bundle execution binding ties preflight, authorization, and credential identity", () => {
  const bundle = initialBundle();
  const preflight = preflightProductionOperation({
    bundle,
    trustedBundleSha256: productionOperationBundleDigest(bundle),
    now,
    ...preflightDependencies([]),
  });
  const changeApproval = { authorizationId: "1".repeat(64) };
  const alertInputPreflight = {
    credentialBinding: { credentialIdentitySha256: "2".repeat(64) },
  };
  const result = bindProductionOperationExecution({
    preflight,
    expectedOperation: "initial-deployment",
    runtimeSourceCommit: runtimeCommit,
    changeApproval,
    alertInputPreflight,
  });
  assert.equal(result.bound, true);
  assert.equal(result.bundleSha256, productionOperationBundleDigest(bundle));
  assert.equal(result.changeAuthorizationId, "1".repeat(64));
  assert.equal(result.credentialIdentitySha256, "2".repeat(64));

  for (const override of [
    { expectedOperation: "blue-green-update" },
    { runtimeSourceCommit: "f".repeat(40) },
    { changeApproval: { authorizationId: "3".repeat(64) } },
    {
      alertInputPreflight: {
        credentialBinding: { credentialIdentitySha256: "4".repeat(64) },
      },
    },
  ]) {
    assert.throws(
      () => bindProductionOperationExecution({
        preflight,
        expectedOperation: "initial-deployment",
        runtimeSourceCommit: runtimeCommit,
        changeApproval,
        alertInputPreflight,
        ...override,
      }),
      /does not bind this execution/,
    );
  }
});

test("release request runtime commit drift fails before cluster preflight", () => {
  const bundle = initialBundle();
  let clusterReached = false;
  assert.throws(
    () => preflightProductionOperation({
      bundle,
      trustedBundleSha256: productionOperationBundleDigest(bundle),
      now,
      readFile: readFixture,
      loadReleaseRequest: () => ({ runtimeSourceCommit: "f".repeat(40) }),
      preflightInitial: () => {
        clusterReached = true;
      },
    }),
    /runtimeSourceCommit does not match/,
  );
  assert.equal(clusterReached, false);
});

test("release request digest drift and mid-processing replacement fail closed", () => {
  const digestDrift = {
    ...initialBundle(),
    inputs: {
      ...initialBundle().inputs,
      releaseRequestSha256: "0".repeat(64),
    },
  };
  assert.throws(
    () => preflightProductionOperation({
      bundle: digestDrift,
      trustedBundleSha256: productionOperationBundleDigest(digestDrift),
      now,
      readFile: readFixture,
      loadReleaseRequest: () => releaseOptions(),
    }),
    /release request digest does not match/,
  );

  const bundle = initialBundle();
  let releaseReads = 0;
  assert.throws(
    () => preflightProductionOperation({
      bundle,
      trustedBundleSha256: productionOperationBundleDigest(bundle),
      now,
      readFile: (path) => {
        if (path.endsWith("secret-inventory.json")) return JSON.stringify({ inventory: true });
        releaseReads += 1;
        return releaseReads === 1
          ? releaseRequestBytes(path)
          : `${JSON.stringify({ schemaVersion: 1, path, replaced: true })}\n`;
      },
      loadReleaseRequest: () => releaseOptions(),
    }),
    /changed during operator bundle processing/,
  );
});

test("execute repeats preflight then dispatches only the selected existing runtime", () => {
  for (const bundle of [initialBundle(), blueGreenBundle(), rollbackBundle()]) {
    const calls = [];
    const executors = {
      executeInitial: (options) => {
        calls.push(["execute-initial", options]);
        return { operation: "initial-deployment" };
      },
      executeBlueGreen: (options) => {
        calls.push(["execute-blue-green", options]);
        return { operation: "blue-green-update" };
      },
      executeRollback: (options) => {
        calls.push(["execute-rollback", options]);
        return { operation: "manual-rollback" };
      },
    };
    const result = executeProductionOperation({
      bundle,
      trustedBundleSha256: productionOperationBundleDigest(bundle),
      readFile: readFixture,
      loadReleaseRequest: () => releaseOptions(),
      preflight: (options) => {
        calls.push(["bundle-preflight", options]);
        return {
          bundleSha256: productionOperationBundleDigest(bundle),
          productionMutationPerformed: false,
          ready: true,
        };
      },
      now: () => now,
      ...executors,
    });
    assert.equal(result.operation, bundle.operation);
    assert.equal(calls[0][0], "bundle-preflight");
    assert.equal(calls.filter(([name]) => name.startsWith("execute-")).length, 1);
    const execution = calls.find(([name]) => name.startsWith("execute-"))[1];
    assert.equal(execution.context, bundle.context);
    assert.equal(execution.alertOptions.credentialSecretInventory.inventory, true);
    assert.equal(execution.operatorBundlePreflight.ready, true);
    assert.equal(execution.now(), now);
  }
});
