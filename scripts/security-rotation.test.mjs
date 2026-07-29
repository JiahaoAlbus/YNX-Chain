import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  beginAwsRotation,
  finalizeAwsRotation,
} from "./security-rotation.mjs";

const sourceCommit = "a".repeat(40);
const managerArn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/staging/deploy-AbCdEf";
const oldVersionId = "1".repeat(32);
const newVersionId = "2".repeat(32);

function inventory() {
  return {
    secrets: [{
      id: "deploy-staging",
      class: "deploy",
      secretType: "deploy-key",
      owner: "release-engineering",
      product: "30-security-platform",
      environment: "staging",
      managerReference: `aws-secretsmanager://${managerArn}`,
    }],
  };
}

function managerRecord(stages) {
  return {
    ARN: managerArn,
    VersionIdsToStages: stages,
  };
}

function valueFile() {
  const path = resolve(mkdtempSync(resolve(tmpdir(), "ynx-rotation-value-")), "value");
  writeFileSync(path, "0123456789abcdef", { mode: 0o600 });
  return path;
}

function beginRotation({ afterStages, evidencePath } = {}) {
  const calls = [];
  const responses = [
    managerRecord({ [oldVersionId]: ["AWSCURRENT"] }),
    { ARN: managerArn, VersionId: newVersionId },
    managerRecord(afterStages ?? {
      [oldVersionId]: ["AWSPREVIOUS"],
      [newVersionId]: ["AWSCURRENT"],
    }),
  ];
  const times = [
    new Date("2026-07-26T00:00:00.000Z"),
    new Date("2026-07-26T00:00:01.000Z"),
  ];
  const transition = beginAwsRotation({
    secretId: "deploy-staging",
    newValuePath: valueFile(),
    operatorId: "operator-a",
    sourceCommit,
    rotationRequestId: newVersionId,
    graceSeconds: 60,
    evidencePath,
    inventory: inventory(),
    now: () => times.shift(),
    execFile: (command, args) => {
      calls.push([command, args]);
      return JSON.stringify(responses.shift());
    },
  });
  return { transition, calls };
}

test("rotation verifies provider version transition and uses an idempotency token", () => {
  const { transition, calls } = beginRotation();
  assert.equal(transition.providerTransitionVerified, true);
  assert.equal(transition.oldVersionId, oldVersionId);
  assert.equal(transition.newVersionId, newVersionId);
  assert.equal(transition.rotationRequestId, newVersionId);
  assert.equal(transition.sourceCommit, sourceCommit);
  assert.equal(transition.oldVersionRevoked, false);
  assert.equal(transition.underlyingCredentialRevoked, false);
  assert.equal(calls.length, 3);
  assert.equal(calls.every(([, args]) => (
    args[args.indexOf("--region") + 1] === "ap-southeast-1"
  )), true);
  assert.deepEqual(calls.map(([, args]) => args[1]), [
    "describe-secret",
    "update-secret",
    "describe-secret",
  ]);
  const updateArgs = calls[1][1];
  assert.equal(updateArgs[updateArgs.indexOf("--client-request-token") + 1], newVersionId);
  assert.match(updateArgs[updateArgs.indexOf("--secret-string") + 1], /^file:\/\//);
});

test("rotation fails closed when provider does not report the expected stages", () => {
  assert.throws(
    () => beginRotation({
      afterStages: {
        [oldVersionId]: ["AWSCURRENT"],
        [newVersionId]: ["AWSPENDING"],
      },
    }),
    /rotation mutation requires recovery/,
  );
});

function transitionFile(overrides = {}) {
  const path = resolve(mkdtempSync(resolve(tmpdir(), "ynx-rotation-transition-")), "transition.json");
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    action: "secret-rotation-transition",
    sourceCommit,
    secretId: "deploy-staging",
    owner: "release-engineering",
    product: "30-security-platform",
    environment: "staging",
    managerReference: `aws-secretsmanager://${managerArn}`,
    managerRegion: "ap-southeast-1",
    operatorId: "operator-a",
    oldVersionId,
    newVersionId,
    rotationRequestId: newVersionId,
    graceUntil: "2026-07-26T00:01:00.000Z",
    state: "pending-dependent-service-verification-and-finalization",
    providerTransitionVerified: true,
    ...overrides,
  }), { mode: 0o600 });
  return path;
}

function finalize({
  transitionPath = transitionFile(),
  operatorId = "operator-b",
  beforeStages,
  afterStages,
  calls = [],
} = {}) {
  const responses = [
    managerRecord(beforeStages ?? {
      [oldVersionId]: ["AWSPREVIOUS"],
      [newVersionId]: ["AWSCURRENT"],
    }),
    {},
    managerRecord(afterStages ?? {
      [newVersionId]: ["AWSCURRENT"],
    }),
  ];
  const result = finalizeAwsRotation({
    transitionPath,
    operatorId,
    sourceCommit,
    inventory: inventory(),
    dependentServiceReloadEvidence: "monitor receipt reload-1",
    boundedDowntimeEvidence: "monitor receipt downtime-1",
    now: () => new Date("2026-07-26T00:02:00.000Z"),
    execFile: (command, args) => {
      calls.push([command, args]);
      return JSON.stringify(responses.shift());
    },
  });
  return { result, calls };
}

test("finalization verifies provider state before and after stage detachment", () => {
  const { result, calls } = finalize();
  assert.equal(result.state, "finalized-manager-stage-detached");
  assert.equal(result.providerFinalizationVerified, true);
  assert.equal(result.oldVersionStageDetached, true);
  assert.equal(result.oldVersionDeprecated, true);
  assert.equal(result.oldVersionRevoked, false);
  assert.equal(result.underlyingCredentialRevoked, false);
  assert.equal(calls.length, 3);
  assert.equal(calls.every(([, args]) => (
    args[args.indexOf("--region") + 1] === "ap-southeast-1"
  )), true);
  assert.deepEqual(calls.map(([, args]) => args[1]), [
    "describe-secret",
    "update-secret-version-stage",
    "describe-secret",
  ]);
  assert.equal(calls[1][1].includes("--move-to-version-id"), false);
});

test("finalization requires source binding and a distinct finalizer", () => {
  assert.throws(
    () => finalizeAwsRotation({
      transitionPath: transitionFile(),
      operatorId: "operator-b",
      sourceCommit: "b".repeat(40),
      dependentServiceReloadEvidence: "reload",
      boundedDowntimeEvidence: "downtime",
      inventory: inventory(),
    }),
    /sourceCommit does not match/,
  );
  assert.throws(
    () => finalize({ operatorId: "operator-a" }),
    /finalizer must differ/,
  );
});

test("finalization binds transition identity to the accepted inventory", () => {
  assert.throws(
    () => finalize({
      transitionPath: transitionFile({
        managerReference: "aws-secretsmanager://arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/staging/other-AbCdEf",
      }),
    }),
    /does not match the accepted inventory/,
  );
});

test("finalization refuses provider drift before mutation", () => {
  const calls = [];
  assert.throws(
    () => finalize({
      calls,
      beforeStages: {
        [oldVersionId]: ["AWSCURRENT"],
        [newVersionId]: ["AWSPREVIOUS"],
      },
    }),
    /current version does not match/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][1], "describe-secret");
});

test("finalization fails if AWSPREVIOUS remains attached", () => {
  assert.throws(
    () => finalize({
      afterStages: {
        [oldVersionId]: ["AWSPREVIOUS"],
        [newVersionId]: ["AWSCURRENT"],
      },
    }),
    /manager stage mutation requires recovery: provider did not detach AWSPREVIOUS/,
  );
});
