import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  bindProductionAlertCredential,
  buildProductionChangeAlert,
  deliverProductionChangeAlert,
  preflightProductionAlertInputs,
  productionAlertSecretInventoryDigest,
} from "./security-production-alert.mjs";

const now = new Date("2026-07-27T05:00:00.000Z");
const clusterUid = "11111111-2222-3333-4444-555555555555";
const operatorId = "production-operator";
const sourceCommit = "c".repeat(40);
const headerPath = "/run/secrets/ynx/production-alert-authorization-header";
const versionPath = `${headerPath}.version-id`;
const versionId = "d".repeat(32);
const managerReference = "aws-secretsmanager://arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/production/alerts-AbCdEf";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function credentialSecret(overrides = {}) {
  return {
    id: "production-change-alert-delivery",
    class: "provider",
    secretType: "provider-credential",
    owner: "security-sre",
    product: "30-security-platform",
    environment: "production",
    purpose: "production change alert delivery to alerts.security.ynxweb4.com",
    provider: "aws-secrets-manager",
    managerReference,
    storageLocation: headerPath,
    accessPolicy: "production change operator read-only delivery",
    rotationPeriodDays: 30,
    createdAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    lastRotatedAt: "2026-07-15T00:00:00.000Z",
    nextRotationAt: "2026-08-14T00:00:00.000Z",
    revocationStatus: "active",
    breakGlassPolicy: "ynx-break-glass-production-v1",
    auditStatus: "verified",
    backupStatus: "prohibited",
    recoveryBoundary: "provider reissue only",
    rotationRunbook: "security-platform/SECRET_ROTATION_RUNBOOK.md",
    lastRotationEvidence: "operator evidence required",
    ...overrides,
  };
}

function credentialInventory(secret = credentialSecret(), overrides = {}) {
  return {
    schemaVersion: 1,
    schema: "security-platform/secret-inventory.schema.json",
    source: "production security operator inventory",
    asOf: "2026-07-27T04:45:00.000Z",
    status: "partial",
    requiredSecretTypes: ["provider-credential"],
    separationRules: ["one secret id maps to one purpose"],
    valueMaterialStored: false,
    secrets: [secret],
    blockedBy: ["other production secret classes remain unconfigured"],
    ...overrides,
  };
}

function managerInspection(secret = credentialSecret(), overrides = {}) {
  return {
    schemaVersion: 1,
    action: "secret-manager-metadata-inspection",
    sourceCommit,
    asOf: now.toISOString(),
    result: "passed-manager-metadata",
    secretId: secret.id,
    secretType: secret.secretType,
    owner: secret.owner,
    product: secret.product,
    environment: secret.environment,
    provider: secret.provider,
    managerReferenceSha256: sha256(secret.managerReference),
    kmsKeySha256: "e".repeat(64),
    currentVersionSha256: sha256(versionId),
    rotationEnabled: true,
    nextRotationAt: secret.nextRotationAt,
    deletionScheduled: false,
    requiredTagBindingsVerified: [
      "ynx:owner",
      "ynx:product",
      "ynx:environment",
      "ynx:purpose",
    ],
    secretValueRequested: false,
    secretValueRecorded: false,
    ...overrides,
  };
}

function privateStat(path) {
  return {
    isFile: () => true,
    size: path === versionPath ? versionId.length : 64,
    mode: 0o100400,
  };
}

function mountedFile(path) {
  if (path === headerPath) {
    return "Authorization: Bearer test-production-alert-token-1234567890\n";
  }
  if (path === versionPath) return `${versionId}\n`;
  throw new Error("unexpected mount path");
}

function bindCredential({
  secretOverrides,
  inspectionOverrides,
  inventoryOverrides,
  trustedInventorySha256,
  mountedVersion = versionId,
  versionFile = versionPath,
  statFile = privateStat,
} = {}) {
  const secret = credentialSecret(secretOverrides);
  const inventory = credentialInventory(secret, inventoryOverrides);
  return bindProductionAlertCredential({
    secretInventory: inventory,
    trustedSecretInventorySha256: trustedInventorySha256
      ?? productionAlertSecretInventoryDigest(inventory),
    sourceCommit,
    expectedHost: "alerts.security.ynxweb4.com",
    credentialHeaderFile: headerPath,
    credentialVersionFile: versionFile,
    checkedAt: now,
    inspectSecret: () => managerInspection(secret, inspectionOverrides),
    execFile: () => {
      throw new Error("provider adapter is injected");
    },
    readFile: (path) => (
      path === headerPath
        ? "Authorization: Bearer test-production-alert-token-1234567890\n"
        : `${mountedVersion}\n`
    ),
    statFile,
  });
}

function approval(overrides = {}) {
  return {
    schemaVersion: 1,
    type: "release-approval",
    action: "production-deployment",
    changeId: "change-20260727-production",
    authorizationId: "a".repeat(64),
    resourceReferenceSha256: "b".repeat(64),
    approvedAt: "2026-07-27T04:30:00.000Z",
    expiresAt: "2026-07-27T05:30:00.000Z",
    immediateAlertRequired: true,
    bound: true,
    ...overrides,
  };
}

function acceptedResponse(input, overrides = {}) {
  const envelope = JSON.parse(input);
  return {
    schemaVersion: 1,
    status: "accepted",
    alertId: envelope.event.alertId,
    eventDigestSha256: envelope.eventDigestSha256,
    providerEventId: "alert-provider-event-0001",
    acceptedAt: "2026-07-27T05:00:01.000Z",
    idempotencyEnforced: true,
    ...overrides,
  };
}

function deliver({ approvalOverrides, responseOverrides, endpoint, expectedHost, credentialHeaderFile } = {}) {
  const calls = [];
  const execFile = (command, args, options) => {
    calls.push({ command, args, options });
    return `${JSON.stringify(acceptedResponse(options.input, responseOverrides))}\n202`;
  };
  const times = [
    new Date(now),
    new Date("2026-07-27T05:00:02.000Z"),
  ];
  const result = deliverProductionChangeAlert({
    approval: approval(approvalOverrides),
    operatorId,
    expectedClusterUid: clusterUid,
    endpoint: endpoint ?? "https://alerts.security.ynxweb4.com/v1/events",
    expectedHost: expectedHost ?? "alerts.security.ynxweb4.com",
    credentialHeaderFile: credentialHeaderFile ?? headerPath,
    credentialVersionFile: versionPath,
    credentialSecretInventory: credentialInventory(),
    trustedCredentialSecretInventorySha256: productionAlertSecretInventoryDigest(
      credentialInventory(),
    ),
    sourceCommit,
    execFile,
    readFile: mountedFile,
    statFile: privateStat,
    inspectSecret: ({ secret }) => managerInspection(secret),
    now: () => times.shift(),
  });
  return { result, calls };
}

test("alert event binds approval, operator, cluster, and authorization window", () => {
  const result = buildProductionChangeAlert({
    approval: approval(),
    operatorId,
    expectedClusterUid: clusterUid,
    createdAt: now,
  });
  assert.equal(result.event.eventType, "ynx.production.change.authorized");
  assert.equal(result.event.severity, "high");
  assert.equal(result.event.authorizationId, "a".repeat(64));
  assert.equal(result.event.operatorIdentity, operatorId);
  assert.match(result.event.clusterUidSha256, /^[0-9a-f]{64}$/);
  assert.match(result.eventDigestSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.event.secretValueIncluded, false);
});

test("credential binding joins inventory, direct provider metadata, and mounted AWSCURRENT", () => {
  const result = bindCredential();
  assert.equal(result.bound, true);
  assert.equal(result.secretId, "production-change-alert-delivery");
  assert.equal(result.currentVersionSha256, sha256(versionId));
  assert.equal(result.privateMountVerified, true);
  assert.equal(result.secretValueRecorded, false);
  assert.match(result.bindingSha256, /^[0-9a-f]{64}$/);
  assert.match(result.credentialIdentitySha256, /^[0-9a-f]{64}$/);
  assert.equal("managerReference" in result, false);
  assert.equal("mountPath" in result, false);
});

test("input preflight verifies provider and mount without alert delivery", () => {
  const secret = credentialSecret();
  const inventory = credentialInventory(secret);
  let providerInspections = 0;
  const result = preflightProductionAlertInputs({
    endpoint: "https://alerts.security.ynxweb4.com/v1/events",
    expectedHost: "alerts.security.ynxweb4.com",
    credentialHeaderFile: headerPath,
    credentialVersionFile: versionPath,
    credentialSecretInventory: inventory,
    trustedCredentialSecretInventorySha256: productionAlertSecretInventoryDigest(inventory),
    sourceCommit,
    execFile: () => {
      throw new Error("only injected metadata inspection may execute");
    },
    readFile: mountedFile,
    statFile: privateStat,
    inspectSecret: () => {
      providerInspections += 1;
      return managerInspection(secret);
    },
    checkedAt: now,
  });
  assert.equal(result.ready, true);
  assert.equal(result.providerMetadataInspected, true);
  assert.equal(result.alertDeliveryPerformed, false);
  assert.equal(result.productionMutationPerformed, false);
  assert.equal(result.secretValueRequested, false);
  assert.equal(providerInspections, 1);
  assert.match(result.receiptSha256, /^[0-9a-f]{64}$/);
});

test("credential binding invokes the metadata-only AWS adapter", () => {
  const secret = credentialSecret();
  const inventory = credentialInventory(secret);
  const calls = [];
  const result = bindProductionAlertCredential({
    secretInventory: inventory,
    trustedSecretInventorySha256: productionAlertSecretInventoryDigest(inventory),
    sourceCommit,
    expectedHost: "alerts.security.ynxweb4.com",
    credentialHeaderFile: headerPath,
    credentialVersionFile: versionPath,
    checkedAt: now,
    execFile: (command, args) => {
      calls.push({ command, args });
      return JSON.stringify({
        ARN: managerReference.slice("aws-secretsmanager://".length),
        RotationEnabled: true,
        KmsKeyId: "arn:aws:kms:ap-southeast-1:123456789012:key/11111111-2222-3333-4444-555555555555",
        VersionIdsToStages: { [versionId]: ["AWSCURRENT"] },
        Tags: [
          { Key: "ynx:owner", Value: secret.owner },
          { Key: "ynx:product", Value: secret.product },
          { Key: "ynx:environment", Value: secret.environment },
          { Key: "ynx:purpose", Value: secret.purpose },
        ],
      });
    },
    readFile: mountedFile,
    statFile: privateStat,
  });
  assert.equal(result.bound, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "aws");
  assert.deepEqual(calls[0].args.slice(0, 2), ["secretsmanager", "describe-secret"]);
  assert.equal(calls[0].args.includes("get-secret-value"), false);
});

test("credential inventory identity, lifecycle, and no-value boundary fail closed", () => {
  for (const secretOverrides of [
    { environment: "staging" },
    { purpose: "generic webhook" },
    { storageLocation: "/run/secrets/ynx/other" },
    { auditStatus: "pending" },
    { backupStatus: "verified" },
    { revocationStatus: "revoked" },
    { nextRotationAt: "2026-07-27T04:59:59.000Z" },
    { rotationPeriodDays: 120 },
    { value: "must-not-exist" },
  ]) {
    assert.throws(
      () => bindCredential({ secretOverrides }),
      /inventory metadata|lifecycle/,
    );
  }
  assert.throws(
    () => bindCredential({ trustedInventorySha256: "0".repeat(64) }),
    /not trusted and current/,
  );
  assert.throws(
    () => bindCredential({ inventoryOverrides: { status: "not-configured" } }),
    /not trusted and current/,
  );
  assert.throws(
    () => bindCredential({ inventoryOverrides: { valueMaterialStored: true } }),
    /not trusted and current/,
  );
  assert.throws(
    () => bindCredential({ inventoryOverrides: { secretValue: "must-not-exist" } }),
    /not trusted and current/,
  );
});

test("credential provider version and private mount drift fail closed", () => {
  assert.throws(
    () => bindCredential({ mountedVersion: "f".repeat(32) }),
    /does not bind inventory, provider, and mount/,
  );
  assert.throws(
    () => bindCredential({ inspectionOverrides: { secretValueRequested: true } }),
    /does not bind inventory, provider, and mount/,
  );
  assert.throws(
    () => bindCredential({ versionFile: "/run/secrets/ynx/different.version-id" }),
    /version mount is not adjacent/,
  );
  assert.throws(
    () => bindCredential({
      statFile: (path) => ({ ...privateStat(path), mode: 0o100440 }),
    }),
    /private regular Secret Manager mount/,
  );
});

test("delivery uses pinned HTTPS and a Secret Manager header file", () => {
  const { result, calls } = deliver();
  assert.equal(result.delivered, true);
  assert.equal(result.idempotencyEnforced, true);
  assert.equal(result.secretValueIncluded, false);
  assert.match(result.providerEventIdSha256, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "curl");
  assert.ok(calls[0].args.includes("=https"));
  assert.ok(calls[0].args.includes(`@${headerPath}`));
  assert.doesNotMatch(JSON.stringify(calls[0].args), /Bearer|token|secret-value/i);
  assert.equal(JSON.parse(calls[0].options.input).event.secretValueIncluded, false);
  assert.equal(result.credentialBinding.bound, true);
  assert.equal(result.credentialBinding.currentVersionSha256, sha256(versionId));
  assert.match(result.inputPreflightSha256, /^[0-9a-f]{64}$/);
});

test("endpoint drift and unsafe credential sources fail before network access", () => {
  for (const options of [
    { endpoint: "http://alerts.security.ynxweb4.com/v1/events" },
    { endpoint: "https://different.ynxweb4.com/v1/events" },
    { endpoint: "https://alerts.security.ynxweb4.com/v1/events?token=value" },
    { expectedHost: "127.0.0.1", endpoint: "https://127.0.0.1/v1/events" },
    { credentialHeaderFile: "/tmp/alert-token" },
  ]) {
    assert.throws(() => deliver(options), /production alert/);
  }
});

test("credential mount must contain exactly one bounded bearer header", () => {
  for (const value of [
    "token-value",
    "Authorization: Basic dXNlcjpwYXNz\n",
    "Authorization: Bearer short\n",
    "Authorization: Bearer valid-production-alert-token-12345\nHost: other.example\n",
  ]) {
    assert.throws(
      () => deliverProductionChangeAlert({
        approval: approval(),
        operatorId,
        expectedClusterUid: clusterUid,
        endpoint: "https://alerts.security.ynxweb4.com/v1/events",
        expectedHost: "alerts.security.ynxweb4.com",
        credentialHeaderFile: headerPath,
        credentialVersionFile: versionPath,
        credentialSecretInventory: credentialInventory(),
        trustedCredentialSecretInventorySha256: productionAlertSecretInventoryDigest(
          credentialInventory(),
        ),
        sourceCommit,
        readFile: (path) => (path === headerPath ? value : `${versionId}\n`),
        statFile: privateStat,
        inspectSecret: ({ secret }) => managerInspection(secret),
        execFile: () => {
          throw new Error("network must not be reached");
        },
        now: () => now,
      }),
      /credential header boundary/,
    );
  }
});

test("provider failures cannot echo credential material", () => {
  const secret = "production-alert-secret-value-1234567890";
  assert.throws(
    () => deliverProductionChangeAlert({
      approval: approval(),
      operatorId,
      expectedClusterUid: clusterUid,
      endpoint: "https://alerts.security.ynxweb4.com/v1/events",
      expectedHost: "alerts.security.ynxweb4.com",
      credentialHeaderFile: headerPath,
      credentialVersionFile: versionPath,
      credentialSecretInventory: credentialInventory(),
      trustedCredentialSecretInventorySha256: productionAlertSecretInventoryDigest(
        credentialInventory(),
      ),
      sourceCommit,
      readFile: (path) => (
        path === headerPath ? `Authorization: Bearer ${secret}\n` : `${versionId}\n`
      ),
      statFile: privateStat,
      inspectSecret: ({ secret: metadata }) => managerInspection(metadata),
      execFile: () => {
        throw new Error(`provider rejected ${secret}`);
      },
      now: () => now,
    }),
    (error) => {
      assert.equal(error.message, "production change alert delivery failed");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("credential rotation during delivery fails before a receipt is accepted", () => {
  const inventory = credentialInventory();
  let headerReads = 0;
  const times = [new Date(now), new Date("2026-07-27T05:00:02.000Z")];
  assert.throws(
    () => deliverProductionChangeAlert({
      approval: approval(),
      operatorId,
      expectedClusterUid: clusterUid,
      endpoint: "https://alerts.security.ynxweb4.com/v1/events",
      expectedHost: "alerts.security.ynxweb4.com",
      credentialHeaderFile: headerPath,
      credentialVersionFile: versionPath,
      credentialSecretInventory: inventory,
      trustedCredentialSecretInventorySha256: productionAlertSecretInventoryDigest(inventory),
      sourceCommit,
      readFile: (path) => {
        if (path === versionPath) return `${versionId}\n`;
        headerReads += 1;
        return headerReads < 3
          ? "Authorization: Bearer test-production-alert-token-1234567890\n"
          : "Authorization: Bearer rotated-production-alert-token-123456789\n";
      },
      statFile: privateStat,
      inspectSecret: ({ secret }) => managerInspection(secret),
      execFile: (_command, _args, options) => (
        `${JSON.stringify(acceptedResponse(options.input))}\n202`
      ),
      now: () => times.shift(),
    }),
    /mount changed during delivery/,
  );
});

test("unbound, non-alerting, and expired approvals fail closed", () => {
  for (const approvalOverrides of [
    { bound: false },
    { immediateAlertRequired: false },
    { expiresAt: "2026-07-27T04:59:59.000Z" },
    { authorizationId: "not-a-digest" },
  ]) {
    assert.throws(() => deliver({ approvalOverrides }), /production alert|authorizationId/);
  }
});

test("provider status, event drift, idempotency, and time are verified", () => {
  for (const responseOverrides of [
    { status: "queued" },
    { alertId: "c".repeat(64) },
    { eventDigestSha256: "d".repeat(64) },
    { idempotencyEnforced: false },
    { acceptedAt: "2026-07-27T06:00:00.000Z" },
  ]) {
    assert.throws(
      () => deliver({ responseOverrides }),
      /receipt does not bind/,
    );
  }
});

test("rollback alert is critical and carries the incident binding", () => {
  const result = buildProductionChangeAlert({
    approval: approval({
      type: "break-glass-authorization",
      action: "production-manual-rollback",
      incidentId: "inc-20260727-production",
      authorizedAt: "2026-07-27T04:59:00.000Z",
      approvedAt: undefined,
    }),
    operatorId,
    expectedClusterUid: clusterUid,
    createdAt: now,
  });
  assert.equal(result.event.severity, "critical");
  assert.equal(result.event.incidentId, "inc-20260727-production");
});
