#!/usr/bin/env node
/**
 * Operator-invoked secret rotation controls.
 *
 * Secret values are never read into JavaScript, printed, written to evidence,
 * or placed directly in process arguments. AWS CLI receives a file:// reference
 * to a caller-owned 0600 file. Rotation and old-version revocation are separate
 * steps so the grace period and dependent-service reload can be audited.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAwsManagerReference } from "./security-secret-manager.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inventoryPath = resolve(root, "security-platform/secret-inventory.json");

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

function awsSecretBinding(managerReference) {
  return parseAwsManagerReference(managerReference);
}

function runJson(execFile, command, args, action) {
  try {
    const output = execFile(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  } catch {
    throw new Error(`${action} failed`);
  }
}

function validateValueFile(path) {
  const absolutePath = resolve(path);
  const stat = statSync(absolutePath);
  if (!stat.isFile()) throw new Error("new secret value path must be a regular file");
  if (stat.size < 16 || stat.size > 65_536) throw new Error("new secret value file size is outside the accepted boundary");
  if ((stat.mode & 0o077) !== 0) throw new Error("new secret value file must not be accessible by group or other users");
  return absolutePath;
}

function parseDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function validateSourceCommit(sourceCommit) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("sourceCommit must be a full Git SHA");
  }
  return sourceCommit;
}

function validateVersionId(versionId, label) {
  if (typeof versionId !== "string" || !/^[A-Za-z0-9-]{32,64}$/.test(versionId)) {
    throw new Error(`${label} must be a valid AWS secret version ID`);
  }
  return versionId;
}

function versionStages(record, versionId) {
  const stages = record.VersionIdsToStages?.[versionId];
  return Array.isArray(stages) ? stages : [];
}

function exactlyOneVersionForStage(record, stage) {
  const versions = Object.entries(record.VersionIdsToStages ?? {})
    .filter(([, stages]) => Array.isArray(stages) && stages.includes(stage))
    .map(([versionId]) => versionId);
  if (versions.length !== 1) throw new Error(`manager must expose exactly one ${stage} version`);
  return validateVersionId(versions[0], stage);
}

function describeSecret(execFile, managerId, region) {
  return runJson(execFile, "aws", [
    "secretsmanager",
    "describe-secret",
    "--secret-id",
    managerId,
    "--region",
    region,
    "--output",
    "json",
    "--no-cli-pager",
  ], "AWS Secrets Manager describe-secret");
}

function verifyManagerIdentity(record, managerId) {
  if (record.ARN !== managerId) throw new Error("manager returned a different secret identity");
}

function resolveEvidencePath(relativePath) {
  const output = resolve(root, relativePath);
  if (!output.startsWith(`${root}/`)) throw new Error("evidence path must stay inside the repository");
  return output;
}

function writeEvidence(relativePath, record) {
  const output = resolveEvidencePath(relativePath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

export function checkRotationStatus({ inventory = loadInventory(), now = new Date() } = {}) {
  const nowMs = now.getTime();
  return (inventory.secrets ?? []).map((secret) => {
    const rotationDays = Number(secret.rotationPeriodDays ?? 0);
    const lastRotatedMs = parseDate(secret.lastRotatedAt ?? secret.lastRotated);
    const nextRotationMs = parseDate(secret.nextRotationAt ?? secret.nextRotation);
    let status = "metadata-invalid";
    let ageDays = null;

    if (rotationDays > 0 && lastRotatedMs !== null) {
      ageDays = Math.floor((nowMs - lastRotatedMs) / 86_400_000);
      const deadline = nextRotationMs ?? lastRotatedMs + rotationDays * 86_400_000;
      const warningAt = deadline - Math.max(1, Math.ceil(rotationDays * 0.2)) * 86_400_000;
      status = nowMs > deadline ? "overdue" : nowMs >= warningAt ? "warning" : "ok";
    } else if (secret.revocationStatus === "revoked") {
      status = "revoked";
    } else if (secret.auditStatus === "not-configured") {
      status = "not-configured";
    }

    return {
      id: secret.id,
      secretType: secret.secretType ?? secret.class,
      owner: secret.owner,
      environment: secret.environment,
      rotationPeriodDays: rotationDays || null,
      lastRotatedAt: secret.lastRotatedAt ?? secret.lastRotated ?? null,
      nextRotationAt: secret.nextRotationAt ?? secret.nextRotation ?? null,
      ageDays,
      status,
    };
  });
}

export function buildRotationPlan({ secret, graceSeconds = 300, emergency = false }) {
  if (!secret?.id || !secret?.owner || !secret?.managerReference) {
    throw new Error("rotation plan requires secret id, owner, and managerReference");
  }
  if (!Number.isInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 86_400) {
    throw new Error("graceSeconds must be an integer between 0 and 86400");
  }
  return {
    schemaVersion: 1,
    secretId: secret.id,
    secretType: secret.secretType ?? secret.class,
    owner: secret.owner,
    product: secret.product ?? null,
    environment: secret.environment ?? null,
    managerReference: secret.managerReference,
    emergency,
    graceSeconds,
    steps: [
      "confirm named operator and incident linkage when emergency",
      "validate caller-owned secret file permissions without reading its value",
      "capture current manager version metadata",
      "create a new manager version through a file reference",
      "verify provider-reported AWSCURRENT and AWSPREVIOUS transitions",
      "reload dependent services and verify bounded downtime",
      "observe the dual-key grace period",
      "detach AWSPREVIOUS in a separate approved action",
      "verify underlying credential revocation separately at its authoritative issuer",
      "attach evidence and update inventory metadata",
    ],
    automaticActionsExcluded: [
      "break-glass approval",
      "dependent-service reload",
      "production isolation",
      "incident declaration",
      "AWSPREVIOUS detachment before grace expiry",
      "underlying credential revocation without issuer evidence",
    ],
  };
}

export function beginAwsRotation({
  secretId,
  newValuePath,
  operatorId,
  graceSeconds = 300,
  emergency = false,
  incidentId,
  reason,
  sourceCommit,
  rotationRequestId = randomUUID(),
  evidencePath,
  inventory = loadInventory(),
  now = () => new Date(),
  execFile = execFileSync,
}) {
  validateSourceCommit(sourceCommit);
  if (!operatorId?.trim()) throw new Error("named operatorId is required");
  if (emergency && (!incidentId?.trim() || !reason?.trim())) {
    throw new Error("emergency rotation requires incidentId and reason");
  }

  const secret = findSecret(inventory, secretId);
  const plan = buildRotationPlan({ secret, graceSeconds, emergency });
  const valueFile = validateValueFile(newValuePath);
  const manager = awsSecretBinding(secret.managerReference);
  const managerId = manager.arn;
  validateVersionId(rotationRequestId, "rotationRequestId");
  const startedAt = now();

  const before = describeSecret(execFile, managerId, manager.region);
  verifyManagerIdentity(before, managerId);
  const oldCurrentVersionId = exactlyOneVersionForStage(before, "AWSCURRENT");

  if (evidencePath) {
    writeEvidence(evidencePath, {
      schemaVersion: 1,
      action: "secret-rotation-intent",
      sourceCommit,
      secretId: secret.id,
      secretType: secret.secretType ?? secret.class,
      owner: secret.owner,
      product: secret.product ?? null,
      environment: secret.environment ?? null,
      managerType: "aws-secrets-manager",
      managerReference: secret.managerReference,
      managerRegion: manager.region,
      operatorId,
      emergency,
      incidentId: emergency ? incidentId : null,
      reason: emergency ? reason : null,
      rotationRequestId,
      oldVersionId: oldCurrentVersionId,
      startedAt: startedAt.toISOString(),
      state: "provider-mutation-not-confirmed",
      secretValueRecorded: false,
      plan,
    });
  }

  const updated = runJson(execFile, "aws", [
    "secretsmanager",
    "update-secret",
    "--secret-id",
    managerId,
    "--region",
    manager.region,
    "--client-request-token",
    rotationRequestId,
    "--secret-string",
    `file://${valueFile}`,
    "--output",
    "json",
    "--no-cli-pager",
  ], "AWS Secrets Manager update-secret");
  if (updated.ARN !== managerId) throw new Error("manager update returned a different secret identity");
  const newVersionId = validateVersionId(updated.VersionId, "newVersionId");
  if (newVersionId !== rotationRequestId || newVersionId === oldCurrentVersionId) {
    throw new Error("manager did not return a distinct new version");
  }

  const completedAt = now();
  let providerTransitionVerified = false;
  let transitionFailure = null;
  try {
    const after = describeSecret(execFile, managerId, manager.region);
    verifyManagerIdentity(after, managerId);
    if (exactlyOneVersionForStage(after, "AWSCURRENT") !== newVersionId) {
      throw new Error("new version is not AWSCURRENT");
    }
    if (!versionStages(after, oldCurrentVersionId).includes("AWSPREVIOUS")) {
      throw new Error("old version is not AWSPREVIOUS");
    }
    providerTransitionVerified = true;
  } catch (error) {
    transitionFailure = error.message;
  }

  const transition = {
    schemaVersion: 1,
    action: "secret-rotation-transition",
    sourceCommit,
    secretId: secret.id,
    secretType: secret.secretType ?? secret.class,
    owner: secret.owner,
    product: secret.product ?? null,
    environment: secret.environment ?? null,
    managerType: "aws-secrets-manager",
    managerReference: secret.managerReference,
    managerRegion: manager.region,
    operatorId,
    emergency,
    incidentId: emergency ? incidentId : null,
    reason: emergency ? reason : null,
    rotationRequestId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    oldVersionId: oldCurrentVersionId,
    newVersionId,
    graceSeconds,
    graceUntil: new Date(completedAt.getTime() + graceSeconds * 1000).toISOString(),
    state: providerTransitionVerified
      ? "pending-dependent-service-verification-and-finalization"
      : "provider-transition-unverified",
    providerTransitionVerified,
    providerTransitionFailure: transitionFailure,
    secretValueRecorded: false,
    dependentServiceReloadVerified: false,
    boundedDowntimeVerified: false,
    oldVersionStageDetached: false,
    oldVersionRevoked: false,
    underlyingCredentialRevoked: false,
    plan,
  };

  if (evidencePath) writeEvidence(evidencePath, transition);
  if (!providerTransitionVerified) {
    throw new Error(`rotation mutation requires recovery: ${transitionFailure}`);
  }
  return transition;
}

export function finalizeAwsRotation({
  transitionPath,
  operatorId,
  sourceCommit,
  dependentServiceReloadEvidence,
  boundedDowntimeEvidence,
  evidencePath,
  inventory = loadInventory(),
  now = () => new Date(),
  execFile = execFileSync,
}) {
  validateSourceCommit(sourceCommit);
  if (!operatorId?.trim()) throw new Error("named operatorId is required");
  if (!dependentServiceReloadEvidence?.trim() || !boundedDowntimeEvidence?.trim()) {
    throw new Error("dependent-service reload and bounded-downtime evidence are required");
  }

  const transition = JSON.parse(readFileSync(resolve(transitionPath), "utf8"));
  const secret = findSecret(inventory, transition.secretId);
  if (
    transition.managerReference !== secret.managerReference
    || transition.owner !== secret.owner
    || transition.product !== secret.product
    || transition.environment !== secret.environment
  ) {
    throw new Error("transition metadata does not match the accepted inventory");
  }
  if (transition.sourceCommit !== sourceCommit) throw new Error("transition sourceCommit does not match the runtime");
  if (transition.state !== "pending-dependent-service-verification-and-finalization") {
    throw new Error("transition is not pending finalization");
  }
  if (transition.providerTransitionVerified !== true) {
    throw new Error("provider transition was not verified");
  }
  if (transition.operatorId === operatorId) {
    throw new Error("finalizer must differ from the rotation initiator");
  }
  if (typeof transition.operatorId !== "string" || transition.operatorId.trim() === "") {
    throw new Error("transition initiator is missing");
  }
  validateVersionId(transition.oldVersionId, "oldVersionId");
  validateVersionId(transition.newVersionId, "newVersionId");
  validateVersionId(transition.rotationRequestId, "rotationRequestId");
  if (transition.rotationRequestId !== transition.newVersionId) {
    throw new Error("transition request ID does not match the new version");
  }
  const currentTime = now();
  const graceUntil = parseDate(transition.graceUntil);
  if (graceUntil === null || currentTime.getTime() < graceUntil) {
    throw new Error("rotation grace period has not expired");
  }

  const manager = awsSecretBinding(transition.managerReference);
  const managerId = manager.arn;
  if (transition.managerRegion && transition.managerRegion !== manager.region) {
    throw new Error("transition manager region does not match its ARN");
  }
  const before = describeSecret(execFile, managerId, manager.region);
  verifyManagerIdentity(before, managerId);
  if (exactlyOneVersionForStage(before, "AWSCURRENT") !== transition.newVersionId) {
    throw new Error("provider current version does not match the transition");
  }
  if (!versionStages(before, transition.oldVersionId).includes("AWSPREVIOUS")) {
    throw new Error("provider previous version does not match the transition");
  }

  if (evidencePath) {
    writeEvidence(evidencePath, {
      ...transition,
      finalizationStartedAt: currentTime.toISOString(),
      finalizationStartedBy: operatorId,
      state: "manager-stage-finalization-not-confirmed",
      dependentServiceReloadVerified: true,
      dependentServiceReloadEvidence,
      boundedDowntimeVerified: true,
      boundedDowntimeEvidence,
      oldVersionStageDetached: false,
      oldVersionRevoked: false,
      underlyingCredentialRevoked: false,
      secretValueRecorded: false,
    });
  }

  runJson(execFile, "aws", [
    "secretsmanager",
    "update-secret-version-stage",
    "--secret-id",
    managerId,
    "--region",
    manager.region,
    "--version-stage",
    "AWSPREVIOUS",
    "--remove-from-version-id",
    transition.oldVersionId,
    "--output",
    "json",
    "--no-cli-pager",
  ], "AWS Secrets Manager update-secret-version-stage");

  let finalizationFailure = null;
  try {
    const after = describeSecret(execFile, managerId, manager.region);
    verifyManagerIdentity(after, managerId);
    if (exactlyOneVersionForStage(after, "AWSCURRENT") !== transition.newVersionId) {
      throw new Error("provider current version changed during finalization");
    }
    if (versionStages(after, transition.oldVersionId).includes("AWSPREVIOUS")) {
      throw new Error("provider did not detach AWSPREVIOUS from the old version");
    }
  } catch (error) {
    finalizationFailure = error.message;
  }
  if (finalizationFailure) {
    if (evidencePath) {
      writeEvidence(evidencePath, {
        ...transition,
        finalizationAttemptedAt: currentTime.toISOString(),
        finalizationAttemptedBy: operatorId,
        state: "manager-stage-finalization-unverified",
        providerFinalizationVerified: false,
        providerFinalizationFailure: finalizationFailure,
        oldVersionStageDetached: false,
        oldVersionRevoked: false,
        underlyingCredentialRevoked: false,
        secretValueRecorded: false,
      });
    }
    throw new Error(`manager stage mutation requires recovery: ${finalizationFailure}`);
  }

  const result = {
    ...transition,
    finalizedAt: currentTime.toISOString(),
    finalizedBy: operatorId,
    state: "finalized-manager-stage-detached",
    dependentServiceReloadVerified: true,
    dependentServiceReloadEvidence,
    boundedDowntimeVerified: true,
    boundedDowntimeEvidence,
    providerFinalizationVerified: true,
    oldVersionStageDetached: true,
    oldVersionDeprecated: true,
    oldVersionRevoked: false,
    underlyingCredentialRevoked: false,
    issuerRevocationEvidence: null,
    limitation: "detaching the final manager stage deprecates the stored version but does not prove revocation of the underlying credential at its issuer",
    secretValueRecorded: false,
  };

  if (evidencePath) writeEvidence(evidencePath, result);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command === "status") {
      const results = checkRotationStatus();
      process.stdout.write(`${JSON.stringify({ configuredSecrets: results.length, results }, null, 2)}\n`);
      if (results.some((entry) => entry.status === "overdue" || entry.status === "metadata-invalid")) process.exitCode = 1;
    } else if (command === "plan") {
      const inventory = loadInventory();
      const secret = findSecret(inventory, args["secret-id"]);
      const plan = buildRotationPlan({
        secret,
        graceSeconds: Number(args["grace-seconds"] ?? 300),
        emergency: args.emergency === "true",
      });
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } else if (command === "rotate") {
      if (args.acknowledge !== "operator-action") throw new Error("rotate requires --acknowledge operator-action");
      const result = beginAwsRotation({
        secretId: args["secret-id"],
        newValuePath: args["new-value-file"],
        operatorId: args["operator-id"],
        graceSeconds: Number(args["grace-seconds"] ?? 300),
        emergency: args.emergency === "true",
        incidentId: args["incident-id"],
        reason: args.reason,
        sourceCommit: args["source-commit"],
        evidencePath: args.evidence,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (command === "finalize") {
      if (args.acknowledge !== "detach-previous-stage") throw new Error("finalize requires --acknowledge detach-previous-stage");
      const result = finalizeAwsRotation({
        transitionPath: args.transition,
        operatorId: args["operator-id"],
        sourceCommit: args["source-commit"],
        dependentServiceReloadEvidence: args["reload-evidence"],
        boundedDowntimeEvidence: args["downtime-evidence"],
        evidencePath: args.evidence,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      throw new Error("usage: security-rotation.mjs status|plan|rotate|finalize with explicit --name value arguments");
    }
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
