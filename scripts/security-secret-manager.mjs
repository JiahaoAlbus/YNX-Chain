#!/usr/bin/env node
/**
 * Metadata-only AWS Secrets Manager runtime inspection.
 *
 * This adapter uses the caller's short-lived AWS workload identity. It never
 * requests secret value material, accepts credentials, or emits manager ARNs.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inventoryPath = resolve(root, "security-platform/secret-inventory.json");
const requiredTags = ["ynx:owner", "ynx:product", "ynx:environment", "ynx:purpose"];

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function loadInventory() {
  return JSON.parse(readFileSync(inventoryPath, "utf8"));
}

function findSecret(inventory, secretId) {
  const secret = (inventory.secrets ?? []).find((entry) => entry.id === secretId);
  if (!secret) throw new Error(`secret ${secretId} is not configured in the inventory`);
  return secret;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseTimestamp(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO timestamp`);
  return time;
}

export function parseAwsManagerReference(managerReference) {
  const prefix = "aws-secretsmanager://";
  if (typeof managerReference !== "string" || !managerReference.startsWith(prefix)) {
    throw new Error("managerReference must use aws-secretsmanager://");
  }
  const arn = managerReference.slice(prefix.length);
  const match = arn.match(/^arn:(aws(?:-us-gov|-cn)?):secretsmanager:([a-z0-9-]+):([0-9]{12}):secret:([A-Za-z0-9/_+=.@-]+)$/);
  if (!match) throw new Error("managerReference must contain a full AWS Secrets Manager ARN");
  return {
    arn,
    partition: match[1],
    region: match[2],
    resourceName: match[4],
    referenceSha256: sha256(managerReference),
  };
}

function runAwsJson(execFile, args) {
  try {
    const output = execFile("aws", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch {
    throw new Error("AWS Secrets Manager metadata inspection failed");
  }
}

function tagsByKey(tags) {
  const output = new Map();
  for (const tag of tags ?? []) {
    if (typeof tag?.Key === "string" && typeof tag?.Value === "string") {
      output.set(tag.Key, tag.Value);
    }
  }
  return output;
}

export function inspectAwsManagedSecret({
  secret,
  sourceCommit,
  now = () => new Date(),
  execFile = execFileSync,
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("sourceCommit must be a full Git SHA");
  }
  if (!secret?.id || !secret?.owner || !secret?.product || !secret?.environment || !secret?.purpose) {
    throw new Error("secret inventory metadata is incomplete");
  }
  if (secret.provider !== "aws-secrets-manager") {
    throw new Error("secret provider must be aws-secrets-manager");
  }
  if (secret.revocationStatus !== "active") {
    throw new Error("secret must be active");
  }

  const reference = parseAwsManagerReference(secret.managerReference);
  const inspectedAt = now();
  const nextRotationAt = parseTimestamp(secret.nextRotationAt, "nextRotationAt");
  if (nextRotationAt <= inspectedAt.getTime()) {
    throw new Error("secret rotation is overdue");
  }

  const response = runAwsJson(execFile, [
    "secretsmanager",
    "describe-secret",
    "--secret-id",
    reference.arn,
    "--region",
    reference.region,
    "--output",
    "json",
    "--no-cli-pager",
  ]);

  if (response.ARN !== reference.arn) throw new Error("manager returned a different secret identity");
  if (response.DeletedDate) throw new Error("manager secret is pending deletion");
  if (response.RotationEnabled !== true) throw new Error("manager rotation is not enabled");
  if (typeof response.KmsKeyId !== "string" || response.KmsKeyId.trim() === "") {
    throw new Error("manager secret is not bound to an explicit KMS key");
  }

  const currentVersions = Object.entries(response.VersionIdsToStages ?? {})
    .filter(([, stages]) => Array.isArray(stages) && stages.includes("AWSCURRENT"))
    .map(([versionId]) => versionId);
  if (currentVersions.length !== 1) {
    throw new Error("manager must expose exactly one AWSCURRENT version");
  }

  const tags = tagsByKey(response.Tags);
  const expectedTags = {
    "ynx:owner": secret.owner,
    "ynx:product": secret.product,
    "ynx:environment": secret.environment,
    "ynx:purpose": secret.purpose,
  };
  for (const key of requiredTags) {
    if (tags.get(key) !== expectedTags[key]) {
      throw new Error(`manager tag ${key} does not match inventory`);
    }
  }

  return {
    schemaVersion: 1,
    action: "secret-manager-metadata-inspection",
    source: "AWS Secrets Manager DescribeSecret",
    sourceCommit,
    asOf: inspectedAt.toISOString(),
    confidence: "direct-provider-metadata",
    result: "passed-manager-metadata",
    secretId: secret.id,
    secretType: secret.secretType ?? secret.class,
    owner: secret.owner,
    product: secret.product,
    environment: secret.environment,
    provider: secret.provider,
    region: reference.region,
    managerReferenceSha256: reference.referenceSha256,
    managerArnSha256: sha256(response.ARN),
    kmsKeySha256: sha256(response.KmsKeyId),
    currentVersionSha256: sha256(currentVersions[0]),
    rotationEnabled: true,
    nextRotationAt: secret.nextRotationAt,
    deletionScheduled: false,
    requiredTagBindingsVerified: requiredTags,
    secretValueRequested: false,
    secretValueRecorded: false,
    installedLocal: false,
    deployedStaging: false,
    deployedPublic: false,
  };
}

function writeEvidence(relativePath, value) {
  const output = resolve(root, relativePath);
  const prefix = `${root}/`;
  if (!output.startsWith(prefix)) throw new Error("evidence path must stay inside the repository");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command !== "inspect") {
      throw new Error("usage: security-secret-manager.mjs inspect --secret-id ID --source-commit SHA [--evidence PATH]");
    }
    const secret = findSecret(loadInventory(), args["secret-id"]);
    const result = inspectAwsManagedSecret({
      secret,
      sourceCommit: args["source-commit"],
    });
    if (args.evidence) writeEvidence(args.evidence, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
