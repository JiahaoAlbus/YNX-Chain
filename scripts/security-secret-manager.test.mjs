import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectAwsManagedSecret,
  parseAwsManagerReference,
} from "./security-secret-manager.mjs";

const arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/staging/deploy-AbCdEf";
const sourceCommit = "a".repeat(40);
const secret = {
  id: "deploy-staging",
  class: "deploy",
  secretType: "deploy-key",
  owner: "release-engineering",
  product: "30-security-platform",
  environment: "staging",
  purpose: "staging deployment",
  provider: "aws-secrets-manager",
  managerReference: `aws-secretsmanager://${arn}`,
  nextRotationAt: "2026-08-20T00:00:00.000Z",
  revocationStatus: "active",
};

function providerResponse(overrides = {}) {
  return {
    ARN: arn,
    Name: "ynx/staging/deploy",
    RotationEnabled: true,
    KmsKeyId: "arn:aws:kms:ap-southeast-1:123456789012:key/11111111-2222-3333-4444-555555555555",
    VersionIdsToStages: {
      "version-current": ["AWSCURRENT"],
      "version-previous": ["AWSPREVIOUS"],
    },
    Tags: [
      { Key: "ynx:owner", Value: "release-engineering" },
      { Key: "ynx:product", Value: "30-security-platform" },
      { Key: "ynx:environment", Value: "staging" },
      { Key: "ynx:purpose", Value: "staging deployment" },
    ],
    ...overrides,
  };
}

test("AWS manager inspection verifies metadata without requesting value material", () => {
  const calls = [];
  const result = inspectAwsManagedSecret({
    secret,
    sourceCommit,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
    execFile: (command, args) => {
      calls.push([command, args]);
      return JSON.stringify(providerResponse());
    },
  });

  assert.equal(result.result, "passed-manager-metadata");
  assert.equal(result.rotationEnabled, true);
  assert.equal(result.secretValueRequested, false);
  assert.equal(result.secretValueRecorded, false);
  assert.equal(result.managerReference, undefined);
  assert.equal(result.installedLocal, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "aws");
  assert.deepEqual(calls[0][1].slice(0, 2), ["secretsmanager", "describe-secret"]);
  assert.equal(calls[0][1].includes("get-secret-value"), false);
});

test("manager reference requires a full Secrets Manager ARN", () => {
  assert.equal(parseAwsManagerReference(`aws-secretsmanager://${arn}`).region, "ap-southeast-1");
  assert.throws(
    () => parseAwsManagerReference("aws-secretsmanager://friendly-name"),
    /full AWS Secrets Manager ARN/,
  );
  assert.throws(
    () => parseAwsManagerReference("vault://secret/path"),
    /aws-secretsmanager/,
  );
});

test("manager inspection fails closed on identity, rotation, KMS, and version drift", () => {
  const inspect = (overrides) => inspectAwsManagedSecret({
    secret,
    sourceCommit,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
    execFile: () => JSON.stringify(providerResponse(overrides)),
  });

  assert.throws(() => inspect({ ARN: `${arn}-other` }), /different secret identity/);
  assert.throws(() => inspect({ RotationEnabled: false }), /rotation is not enabled/);
  assert.throws(() => inspect({ KmsKeyId: undefined }), /explicit KMS key/);
  assert.throws(
    () => inspect({ VersionIdsToStages: { one: ["AWSCURRENT"], two: ["AWSCURRENT"] } }),
    /exactly one AWSCURRENT/,
  );
});

test("manager inspection enforces inventory tag and rotation deadline bindings", () => {
  assert.throws(
    () => inspectAwsManagedSecret({
      secret,
      sourceCommit,
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      execFile: () => JSON.stringify(providerResponse({
        Tags: providerResponse().Tags.map((tag) => (
          tag.Key === "ynx:environment" ? { ...tag, Value: "production" } : tag
        )),
      })),
    }),
    /ynx:environment does not match/,
  );
  assert.throws(
    () => inspectAwsManagedSecret({
      secret: { ...secret, nextRotationAt: "2026-07-25T00:00:00.000Z" },
      sourceCommit,
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      execFile: () => {
        throw new Error("provider must not be called after local deadline failure");
      },
    }),
    /rotation is overdue/,
  );
});

test("provider failures do not echo provider stderr", () => {
  assert.throws(
    () => inspectAwsManagedSecret({
      secret,
      sourceCommit,
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      execFile: () => {
        const error = new Error("provider failed");
        error.stderr = "sensitive provider detail";
        throw error;
      },
    }),
    (error) => error.message === "AWS Secrets Manager metadata inspection failed",
  );
});

test("manager inspection requires exact source identity", () => {
  assert.throws(
    () => inspectAwsManagedSecret({
      secret,
      sourceCommit: "short",
      execFile: () => JSON.stringify(providerResponse()),
    }),
    /full Git SHA/,
  );
});
