import test from "node:test";
import assert from "node:assert/strict";
import {
  bindProductionReleaseApproval,
  bindProductionRollbackAuthorization,
  consumeProductionApproval,
  productionRollbackResourceReferenceSha256,
} from "./security-production-approval.mjs";

const currentCommit = "a".repeat(40);
const targetCommit = "b".repeat(40);
const runtimeCommit = "c".repeat(40);
const clusterUid = "11111111-2222-3333-4444-555555555555";
const operatorId = "production-operator";
const now = new Date("2026-07-27T04:00:00.000Z");

function release({
  sourceCommit = targetCommit,
  version = "1.0.0",
  approvalId = "change-20260727-production",
} = {}) {
  return {
    receipt: {
      sourceCommit,
      runtimeSourceCommit: runtimeCommit,
      version,
      productionManifestSha256: sourceCommit[0].repeat(64),
    },
    attestation: {
      approval: {
        approvalId,
        approvedAt: "2026-07-27T03:30:00.000Z",
        expiresAt: "2026-07-27T04:30:00.000Z",
        approvers: ["release-owner", "security-owner"],
      },
    },
  };
}

test("signed release approval binds change, cluster, manifest, and independent operator", () => {
  const result = bindProductionReleaseApproval({
    release: release(),
    action: "production-deployment",
    operatorId,
    changeId: "change-20260727-production",
    expectedClusterUid: clusterUid,
    now,
  });
  assert.equal(result.bound, true);
  assert.equal(result.type, "release-approval");
  assert.equal(result.approverCount, 2);
  assert.match(result.authorizationId, /^[0-9a-f]{64}$/);
  assert.match(result.ledgerName, /^ynx-change-approval-[0-9a-f]{32}$/);
});

test("wrong change, approving operator, and expired release approval fail closed", () => {
  assert.throws(
    () => bindProductionReleaseApproval({
      release: release(),
      action: "production-blue-green-update",
      operatorId,
      changeId: "different-change",
      expectedClusterUid: clusterUid,
      now,
    }),
    /changeId does not match/,
  );
  assert.throws(
    () => bindProductionReleaseApproval({
      release: release(),
      action: "production-deployment",
      operatorId: "release-owner",
      changeId: "change-20260727-production",
      expectedClusterUid: clusterUid,
      now,
    }),
    /operator must be independent/,
  );
  assert.throws(
    () => bindProductionReleaseApproval({
      release: release(),
      action: "production-deployment",
      operatorId,
      changeId: "change-20260727-production",
      expectedClusterUid: clusterUid,
      now: new Date("2026-07-27T05:00:00.000Z"),
    }),
    /not currently valid/,
  );
});

function rollbackAuthorization(overrides = {}) {
  return {
    action: "break-glass-authorization",
    source: "YNX break-glass multi-party signature verifier",
    incidentId: "inc-20260727-production",
    environment: "production",
    scope: "deployment:rollback",
    product: "YNX Security Platform",
    requestId: "change-20260727-rollback",
    operatorIdentity: operatorId,
    resourceId: `production-release:${targetCommit}`,
    resourceReferenceSha256: overrides.resourceReferenceSha256,
    authorizationId: "d".repeat(64),
    requestDigest: "e".repeat(64),
    policyDigest: "f".repeat(64),
    authorizedAt: "2026-07-27T03:59:00.000Z",
    expiresAt: "2026-07-27T04:15:00.000Z",
    approvalThreshold: 2,
    distinctRoleThreshold: 2,
    approvals: [{}, {}],
    oneTimeUseRequired: true,
    consumptionLedgerRequired: true,
    automaticExecutionAllowed: false,
    immediateAlertRequired: true,
    ...overrides,
  };
}

test("manual rollback binds a freshly verified multi-party authorization", () => {
  const currentRelease = release({ sourceCommit: currentCommit, version: "1.1.0" });
  const targetRelease = release({ sourceCommit: targetCommit });
  const expectedDigest = productionRollbackResourceReferenceSha256({
    currentRelease,
    targetRelease,
    expectedClusterUid: clusterUid,
  });
  const authorize = (options) => {
    assert.equal(options.sourceCommit, runtimeCommit);
    return rollbackAuthorization({ resourceReferenceSha256: expectedDigest });
  };
  const result = bindProductionRollbackAuthorization({
    currentRelease,
    targetRelease,
    operatorId,
    changeId: "change-20260727-rollback",
    expectedClusterUid: clusterUid,
    authorizationOptions: {
      request: {
        resourceReferenceSha256: expectedDigest,
      },
    },
    authorize,
    now,
  });
  assert.equal(result.bound, true);
  assert.equal(result.type, "break-glass-authorization");
  assert.equal(result.approvalCount, 2);
  assert.equal(result.incidentId, "inc-20260727-production");
  assert.equal(result.immediateAlertRequired, true);
  assert.equal(result.resourceReferenceSha256, expectedDigest);
});

test("rollback authorization must bind operator, change, scope, target, and digest", () => {
  const currentRelease = release({ sourceCommit: currentCommit, version: "1.1.0" });
  const targetRelease = release({ sourceCommit: targetCommit });
  for (const override of [
    { scope: "backup:restore" },
    { requestId: "different-change" },
    { operatorIdentity: "different-operator" },
    { resourceId: `production-release:${currentCommit}` },
    { resourceReferenceSha256: "0".repeat(64) },
    { automaticExecutionAllowed: true },
  ]) {
    assert.throws(
      () => bindProductionRollbackAuthorization({
        currentRelease,
        targetRelease,
        operatorId,
        changeId: "change-20260727-rollback",
        expectedClusterUid: clusterUid,
        authorizationOptions: {},
        authorize: () => rollbackAuthorization(override),
        now,
      }),
      /does not bind the requested change/,
    );
  }
});

test("approval consumption creates an immutable, uniquely named ConfigMap", () => {
  const approval = bindProductionReleaseApproval({
    release: release(),
    action: "production-deployment",
    operatorId,
    changeId: "change-20260727-production",
    expectedClusterUid: clusterUid,
    now,
  });
  let created = false;
  const execFile = (command, args, options) => {
    assert.equal(command, "kubectl");
    assert.ok(args.includes("create"));
    if (created) throw new Error("AlreadyExists");
    created = true;
    const document = JSON.parse(options.input);
    assert.equal(document.immutable, true);
    assert.deepEqual(document.data, {});
    return JSON.stringify({
      ...document,
      metadata: {
        ...document.metadata,
        uid: "22222222-3333-4444-8555-666666666666",
        resourceVersion: "7",
        creationTimestamp: "2026-07-27T04:00:01.000Z",
      },
    });
  };
  const receipt = consumeProductionApproval({
    context: "ynx-production",
    approval,
    execFile,
  });
  assert.equal(receipt.consumed, true);
  assert.equal(receipt.immutable, true);
  assert.throws(
    () => consumeProductionApproval({
      context: "ynx-production",
      approval,
      execFile,
    }),
    /production approval consumption failed/,
  );
});

test("unbound or tampered approval cannot reach Kubernetes", () => {
  let called = false;
  assert.throws(
    () => consumeProductionApproval({
      context: "ynx-production",
      approval: {
        schemaVersion: 1,
        bound: false,
        action: "production-deployment",
        authorizationId: "a".repeat(64),
      },
      execFile: () => {
        called = true;
      },
    }),
    /bound production approval is invalid/,
  );
  assert.equal(called, false);
});
