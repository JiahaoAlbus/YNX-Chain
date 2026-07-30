#!/usr/bin/env node
/**
 * Strict operator bundle boundary for production release operations.
 *
 * A single canonical JSON bundle selects initial deployment, blue-green update,
 * or manual rollback. The bundle contains references and pinned digests only;
 * secret values are forbidden. `preflight` performs read-only release, RBAC,
 * cluster, approval, and alert-input checks. `execute` repeats preflight before
 * dispatching to the existing mutation runtime.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindProductionReleaseApproval,
  bindProductionRollbackAuthorization,
} from "./security-production-approval.mjs";
import { preflightProductionAlertInputs } from "./security-production-alert.mjs";
import {
  deployProduction,
  preflightProductionDeployment,
} from "./security-production-deploy.mjs";
import {
  loadProductionReleaseRequest,
  preflightProductionBlueGreen,
  promoteProductionBlueGreen,
} from "./security-production-blue-green.mjs";
import {
  preflightProductionRollback,
  rollbackProduction,
} from "./security-production-rollback.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const operations = new Set([
  "initial-deployment",
  "blue-green-update",
  "manual-rollback",
]);
const topLevelFields = [
  "acknowledge",
  "alert",
  "changeId",
  "context",
  "evidencePath",
  "expectedClusterUid",
  "inputs",
  "leaseDurationSeconds",
  "operation",
  "operatorId",
  "rolloutTimeoutSeconds",
  "runtimeSourceCommit",
  "schemaVersion",
];
const alertFields = [
  "credentialHeaderFile",
  "credentialVersionFile",
  "endpoint",
  "expectedHost",
  "secretInventoryPath",
  "secretInventorySha256",
];
const inputFields = {
  "initial-deployment": [
    "releaseRequestPath",
    "releaseRequestSha256",
  ],
  "blue-green-update": [
    "candidateReleaseRequestPath",
    "candidateReleaseRequestSha256",
    "observationSeconds",
    "sampleIntervalSeconds",
    "stableEvidencePath",
    "stableEvidenceSha256",
    "stableReleaseRequestPath",
    "stableReleaseRequestSha256",
  ],
  "manual-rollback": [
    "authorizationApprovalPaths",
    "authorizationPolicyPath",
    "authorizationRequestPath",
    "currentEvidencePath",
    "currentEvidenceSha256",
    "currentReleaseRequestPath",
    "currentReleaseRequestSha256",
    "targetEvidencePath",
    "targetEvidenceSha256",
    "targetReleaseRequestPath",
    "targetReleaseRequestSha256",
    "trustedAuthorizationPolicySha256",
  ],
};
const acknowledgements = {
  "initial-deployment": "apply-production-release",
  "blue-green-update": "promote-production-blue-green",
  "manual-rollback": "rollback-production-release",
};

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) throw new Error(`${label} must be sha256`);
  return value;
}

function fullCommit(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error(`${label} must be a full Git SHA`);
  return value;
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
}

function safePath(value, label, { repositoryRelative = false } = {}) {
  if (
    typeof value !== "string"
    || value.length < 3
    || value.length > 4096
    || /[\0\r\n]/.test(value)
  ) {
    throw new Error(`${label} must be a bounded path`);
  }
  if (repositoryRelative) {
    const absolute = resolve(root, value);
    if (value.startsWith("/") || !absolute.startsWith(`${root}/`)) {
      throw new Error(`${label} must stay inside the repository`);
    }
  }
  return value;
}

function exactObject(value, fields, label) {
  if (
    value == null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")
  ) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function validateAlert(alert) {
  exactObject(alert, alertFields, "production operation alert");
  if (typeof alert.endpoint !== "string" || !alert.endpoint.startsWith("https://")) {
    throw new Error("production operation alert endpoint must use HTTPS");
  }
  safeIdentifier(alert.expectedHost, "alert expectedHost");
  safePath(alert.credentialHeaderFile, "alert credentialHeaderFile");
  safePath(alert.credentialVersionFile, "alert credentialVersionFile");
  safePath(alert.secretInventoryPath, "alert secretInventoryPath");
  digest(alert.secretInventorySha256, "alert secretInventorySha256");
}

function validateInputs(bundle) {
  const inputs = exactObject(
    bundle.inputs,
    inputFields[bundle.operation],
    `${bundle.operation} inputs`,
  );
  if (bundle.operation === "initial-deployment") {
    safePath(inputs.releaseRequestPath, "releaseRequestPath");
    digest(inputs.releaseRequestSha256, "releaseRequestSha256");
    return;
  }
  if (bundle.operation === "blue-green-update") {
    safePath(inputs.stableReleaseRequestPath, "stableReleaseRequestPath");
    safePath(inputs.candidateReleaseRequestPath, "candidateReleaseRequestPath");
    digest(inputs.stableReleaseRequestSha256, "stableReleaseRequestSha256");
    digest(inputs.candidateReleaseRequestSha256, "candidateReleaseRequestSha256");
    safePath(inputs.stableEvidencePath, "stableEvidencePath", { repositoryRelative: true });
    digest(inputs.stableEvidenceSha256, "stableEvidenceSha256");
    boundedInteger(inputs.observationSeconds, 30, 3600, "observationSeconds");
    boundedInteger(inputs.sampleIntervalSeconds, 5, 300, "sampleIntervalSeconds");
    if (inputs.sampleIntervalSeconds > inputs.observationSeconds) {
      throw new Error("sampleIntervalSeconds cannot exceed observationSeconds");
    }
    return;
  }
  safePath(inputs.currentReleaseRequestPath, "currentReleaseRequestPath");
  safePath(inputs.targetReleaseRequestPath, "targetReleaseRequestPath");
  digest(inputs.currentReleaseRequestSha256, "currentReleaseRequestSha256");
  digest(inputs.targetReleaseRequestSha256, "targetReleaseRequestSha256");
  safePath(inputs.currentEvidencePath, "currentEvidencePath", { repositoryRelative: true });
  safePath(inputs.targetEvidencePath, "targetEvidencePath", { repositoryRelative: true });
  digest(inputs.currentEvidenceSha256, "currentEvidenceSha256");
  digest(inputs.targetEvidenceSha256, "targetEvidenceSha256");
  safePath(inputs.authorizationRequestPath, "authorizationRequestPath");
  safePath(inputs.authorizationPolicyPath, "authorizationPolicyPath");
  digest(inputs.trustedAuthorizationPolicySha256, "trustedAuthorizationPolicySha256");
  if (
    !Array.isArray(inputs.authorizationApprovalPaths)
    || inputs.authorizationApprovalPaths.length < 2
    || inputs.authorizationApprovalPaths.length > 5
    || new Set(inputs.authorizationApprovalPaths).size !== inputs.authorizationApprovalPaths.length
  ) {
    throw new Error("manual rollback requires 2-5 unique authorization approval paths");
  }
  inputs.authorizationApprovalPaths.forEach((path, index) => {
    safePath(path, `authorizationApprovalPaths[${index}]`);
  });
}

export function productionOperationBundleDigest(bundle) {
  return sha256(canonicalJson(bundle));
}

export function validateProductionOperationBundle(bundle, trustedBundleSha256) {
  digest(trustedBundleSha256, "trusted production operation bundle digest");
  exactObject(bundle, topLevelFields, "production operation bundle");
  if (bundle.schemaVersion !== 1 || !operations.has(bundle.operation)) {
    throw new Error("production operation bundle identity is invalid");
  }
  if (productionOperationBundleDigest(bundle) !== trustedBundleSha256) {
    throw new Error("production operation bundle digest does not match");
  }
  fullCommit(bundle.runtimeSourceCommit, "runtimeSourceCommit");
  safeIdentifier(bundle.context, "context");
  safeIdentifier(bundle.expectedClusterUid, "expectedClusterUid");
  safeIdentifier(bundle.operatorId, "operatorId");
  safeIdentifier(bundle.changeId, "changeId");
  if (bundle.acknowledge !== acknowledgements[bundle.operation]) {
    throw new Error("production operation acknowledgement is invalid");
  }
  safePath(bundle.evidencePath, "evidencePath", { repositoryRelative: true });
  boundedInteger(bundle.rolloutTimeoutSeconds, 60, 1800, "rolloutTimeoutSeconds");
  boundedInteger(bundle.leaseDurationSeconds, 60, 1800, "leaseDurationSeconds");
  validateAlert(bundle.alert);
  validateInputs(bundle);
  return bundle;
}

function readJson(readFile, path, label) {
  try {
    return JSON.parse(readFile(resolve(path), "utf8"));
  } catch {
    throw new Error(`${label} read failed`);
  }
}

function alertOptions(bundle, readFile) {
  return {
    endpoint: bundle.alert.endpoint,
    expectedHost: bundle.alert.expectedHost,
    credentialHeaderFile: bundle.alert.credentialHeaderFile,
    credentialVersionFile: bundle.alert.credentialVersionFile,
    credentialSecretInventory: readJson(
      readFile,
      bundle.alert.secretInventoryPath,
      "production alert secret inventory",
    ),
    trustedCredentialSecretInventorySha256: bundle.alert.secretInventorySha256,
  };
}

function releaseOptions(
  readFile,
  loadReleaseRequest,
  path,
  trustedRequestSha256,
  runtimeSourceCommit,
) {
  let before;
  let after;
  try {
    before = readFile(resolve(path));
  } catch {
    throw new Error("release request read failed");
  }
  if (sha256(before) !== trustedRequestSha256) {
    throw new Error("release request digest does not match the operator bundle");
  }
  const options = loadReleaseRequest(path);
  try {
    after = readFile(resolve(path));
  } catch {
    throw new Error("release request re-read failed");
  }
  if (
    !Buffer.from(before).equals(Buffer.from(after))
    || sha256(after) !== trustedRequestSha256
  ) {
    throw new Error("release request changed during operator bundle processing");
  }
  if (options.runtimeSourceCommit !== runtimeSourceCommit) {
    throw new Error("release request runtimeSourceCommit does not match the operator bundle");
  }
  return options;
}

function rollbackAuthorizationOptions(bundle, readFile) {
  return {
    request: readJson(
      readFile,
      bundle.inputs.authorizationRequestPath,
      "rollback authorization request",
    ),
    policy: readJson(
      readFile,
      bundle.inputs.authorizationPolicyPath,
      "rollback authorization policy",
    ),
    approvals: bundle.inputs.authorizationApprovalPaths.map((path) => (
      readJson(readFile, path, "rollback authorization approval")
    )),
    trustedPolicySha256: bundle.inputs.trustedAuthorizationPolicySha256,
  };
}

function commonMutationOptions(bundle, alert) {
  return {
    context: bundle.context,
    expectedClusterUid: bundle.expectedClusterUid,
    operatorId: bundle.operatorId,
    changeId: bundle.changeId,
    acknowledge: bundle.acknowledge,
    evidencePath: bundle.evidencePath,
    rolloutTimeoutSeconds: bundle.rolloutTimeoutSeconds,
    leaseDurationSeconds: bundle.leaseDurationSeconds,
    alertOptions: alert,
  };
}

export function preflightProductionOperation({
  bundle,
  trustedBundleSha256,
  execFile = execFileSync,
  readFile = readFileSync,
  now = new Date(),
  loadReleaseRequest = loadProductionReleaseRequest,
  preflightInitial = preflightProductionDeployment,
  preflightBlueGreen = preflightProductionBlueGreen,
  preflightRollback = preflightProductionRollback,
  preflightAlert = preflightProductionAlertInputs,
  bindReleaseApproval = bindProductionReleaseApproval,
  bindRollbackApproval = bindProductionRollbackAuthorization,
}) {
  validateProductionOperationBundle(bundle, trustedBundleSha256);
  if (
    !(now instanceof Date)
    || !Number.isFinite(now.getTime())
    || typeof execFile !== "function"
    || typeof readFile !== "function"
    || typeof loadReleaseRequest !== "function"
    || typeof preflightInitial !== "function"
    || typeof preflightBlueGreen !== "function"
    || typeof preflightRollback !== "function"
    || typeof preflightAlert !== "function"
    || typeof bindReleaseApproval !== "function"
    || typeof bindRollbackApproval !== "function"
  ) {
    throw new Error("production operation preflight dependencies are invalid");
  }
  const alert = alertOptions(bundle, readFile);
  let releasePreflight;
  let changeAuthorization;
  let executingRuntimeSourceCommit;

  if (bundle.operation === "initial-deployment") {
    const release = releaseOptions(
      readFile,
      loadReleaseRequest,
      bundle.inputs.releaseRequestPath,
      bundle.inputs.releaseRequestSha256,
      bundle.runtimeSourceCommit,
    );
    releasePreflight = preflightInitial({
      ...release,
      context: bundle.context,
      expectedClusterUid: bundle.expectedClusterUid,
      execFile,
      now,
    });
    executingRuntimeSourceCommit = releasePreflight.receipt.runtimeSourceCommit;
    changeAuthorization = bindReleaseApproval({
      release: releasePreflight,
      action: "production-deployment",
      operatorId: bundle.operatorId,
      changeId: bundle.changeId,
      expectedClusterUid: bundle.expectedClusterUid,
      now,
    });
  } else if (bundle.operation === "blue-green-update") {
    const stableReleaseOptions = releaseOptions(
      readFile,
      loadReleaseRequest,
      bundle.inputs.stableReleaseRequestPath,
      bundle.inputs.stableReleaseRequestSha256,
      bundle.runtimeSourceCommit,
    );
    const candidateReleaseOptions = releaseOptions(
      readFile,
      loadReleaseRequest,
      bundle.inputs.candidateReleaseRequestPath,
      bundle.inputs.candidateReleaseRequestSha256,
      bundle.runtimeSourceCommit,
    );
    releasePreflight = preflightBlueGreen({
      stableReleaseOptions,
      candidateReleaseOptions,
      stableEvidencePath: bundle.inputs.stableEvidencePath,
      stableEvidenceSha256: bundle.inputs.stableEvidenceSha256,
      context: bundle.context,
      expectedClusterUid: bundle.expectedClusterUid,
      observationSeconds: bundle.inputs.observationSeconds,
      sampleIntervalSeconds: bundle.inputs.sampleIntervalSeconds,
      execFile,
      now,
    });
    executingRuntimeSourceCommit = releasePreflight.candidate.receipt.runtimeSourceCommit;
    changeAuthorization = bindReleaseApproval({
      release: releasePreflight.candidate,
      action: "production-blue-green-update",
      operatorId: bundle.operatorId,
      changeId: bundle.changeId,
      expectedClusterUid: bundle.expectedClusterUid,
      now,
    });
  } else {
    const currentReleaseOptions = releaseOptions(
      readFile,
      loadReleaseRequest,
      bundle.inputs.currentReleaseRequestPath,
      bundle.inputs.currentReleaseRequestSha256,
      bundle.runtimeSourceCommit,
    );
    const targetReleaseOptions = releaseOptions(
      readFile,
      loadReleaseRequest,
      bundle.inputs.targetReleaseRequestPath,
      bundle.inputs.targetReleaseRequestSha256,
      bundle.runtimeSourceCommit,
    );
    releasePreflight = preflightRollback({
      currentReleaseOptions,
      targetReleaseOptions,
      currentEvidencePath: bundle.inputs.currentEvidencePath,
      currentEvidenceSha256: bundle.inputs.currentEvidenceSha256,
      targetEvidencePath: bundle.inputs.targetEvidencePath,
      targetEvidenceSha256: bundle.inputs.targetEvidenceSha256,
      context: bundle.context,
      expectedClusterUid: bundle.expectedClusterUid,
      execFile,
      now,
    });
    executingRuntimeSourceCommit = releasePreflight.current.receipt.runtimeSourceCommit;
    changeAuthorization = bindRollbackApproval({
      currentRelease: releasePreflight.current,
      targetRelease: releasePreflight.target,
      operatorId: bundle.operatorId,
      changeId: bundle.changeId,
      expectedClusterUid: bundle.expectedClusterUid,
      authorizationOptions: rollbackAuthorizationOptions(bundle, readFile),
      now,
    });
  }

  if (
    executingRuntimeSourceCommit !== bundle.runtimeSourceCommit
    || changeAuthorization?.bound !== true
    || !/^[0-9a-f]{64}$/.test(changeAuthorization.authorizationId ?? "")
  ) {
    throw new Error("production operation release or authorization binding failed");
  }
  const alertPreflight = preflightAlert({
    ...alert,
    sourceCommit: bundle.runtimeSourceCommit,
    execFile,
    checkedAt: now,
  });
  if (
    alertPreflight?.ready !== true
    || alertPreflight.alertDeliveryPerformed !== false
    || alertPreflight.productionMutationPerformed !== false
    || alertPreflight.sourceCommit !== bundle.runtimeSourceCommit
    || alertPreflight.credentialBinding?.bound !== true
    || !/^[0-9a-f]{64}$/.test(
      alertPreflight.credentialBinding.credentialIdentitySha256 ?? "",
    )
  ) {
    throw new Error("production operation alert input preflight failed");
  }
  const receipt = {
    schemaVersion: 1,
    action: "production-operation-bundle-preflight",
    operation: bundle.operation,
    bundleSha256: trustedBundleSha256,
    runtimeSourceCommit: bundle.runtimeSourceCommit,
    contextSha256: sha256(bundle.context),
    clusterUidSha256: sha256(bundle.expectedClusterUid),
    changeAuthorization,
    alertPreflight,
    releasePreflightAction: releasePreflight.receipt.action,
    asOf: now.toISOString(),
    leaseAcquired: false,
    alertDeliveryPerformed: false,
    productionMutationPerformed: false,
    ready: true,
  };
  return {
    ...receipt,
    receiptSha256: sha256(canonicalJson(receipt)),
  };
}

export function executeProductionOperation({
  bundle,
  trustedBundleSha256,
  execFile = execFileSync,
  readFile = readFileSync,
  now = () => new Date(),
  loadReleaseRequest = loadProductionReleaseRequest,
  preflight = preflightProductionOperation,
  executeInitial = deployProduction,
  executeBlueGreen = promoteProductionBlueGreen,
  executeRollback = rollbackProduction,
}) {
  if (
    typeof now !== "function"
    || typeof preflight !== "function"
    || typeof executeInitial !== "function"
    || typeof executeBlueGreen !== "function"
    || typeof executeRollback !== "function"
  ) {
    throw new Error("production operation execution dependencies are invalid");
  }
  const checkedAt = now();
  const preflightReceipt = preflight({
    bundle,
    trustedBundleSha256,
    execFile,
    readFile,
    now: checkedAt,
    loadReleaseRequest,
  });
  if (
    preflightReceipt?.ready !== true
    || preflightReceipt.bundleSha256 !== trustedBundleSha256
    || preflightReceipt.productionMutationPerformed !== false
  ) {
    throw new Error("production operation bundle preflight did not pass");
  }
  const alert = alertOptions(bundle, readFile);
  const common = commonMutationOptions(bundle, alert);
  common.operatorBundlePreflight = preflightReceipt;

  if (bundle.operation === "initial-deployment") {
    return executeInitial({
      ...common,
      ...releaseOptions(
        readFile,
        loadReleaseRequest,
        bundle.inputs.releaseRequestPath,
        bundle.inputs.releaseRequestSha256,
        bundle.runtimeSourceCommit,
      ),
      execFile,
      now,
    });
  }
  if (bundle.operation === "blue-green-update") {
    return executeBlueGreen({
      ...common,
      stableReleaseOptions: releaseOptions(
        readFile,
        loadReleaseRequest,
        bundle.inputs.stableReleaseRequestPath,
        bundle.inputs.stableReleaseRequestSha256,
        bundle.runtimeSourceCommit,
      ),
      candidateReleaseOptions: releaseOptions(
        readFile,
        loadReleaseRequest,
        bundle.inputs.candidateReleaseRequestPath,
        bundle.inputs.candidateReleaseRequestSha256,
        bundle.runtimeSourceCommit,
      ),
      stableEvidencePath: bundle.inputs.stableEvidencePath,
      stableEvidenceSha256: bundle.inputs.stableEvidenceSha256,
      observationSeconds: bundle.inputs.observationSeconds,
      sampleIntervalSeconds: bundle.inputs.sampleIntervalSeconds,
      execFile,
      now,
    });
  }
  return executeRollback({
    ...common,
    currentReleaseOptions: releaseOptions(
      readFile,
      loadReleaseRequest,
      bundle.inputs.currentReleaseRequestPath,
      bundle.inputs.currentReleaseRequestSha256,
      bundle.runtimeSourceCommit,
    ),
    targetReleaseOptions: releaseOptions(
      readFile,
      loadReleaseRequest,
      bundle.inputs.targetReleaseRequestPath,
      bundle.inputs.targetReleaseRequestSha256,
      bundle.runtimeSourceCommit,
    ),
    currentEvidencePath: bundle.inputs.currentEvidencePath,
    currentEvidenceSha256: bundle.inputs.currentEvidenceSha256,
    targetEvidencePath: bundle.inputs.targetEvidencePath,
    targetEvidenceSha256: bundle.inputs.targetEvidenceSha256,
    rollbackAuthorizationOptions: rollbackAuthorizationOptions(bundle, readFile),
    execFile,
    now,
  });
}

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (!["digest", "preflight", "execute"].includes(command)) {
      throw new Error("usage: security-production-operation.mjs digest|preflight|execute --bundle PATH [--bundle-sha256 SHA256]");
    }
    const bundle = readJson(readFileSync, args.bundle, "production operation bundle");
    if (command === "digest") {
      process.stdout.write(`${productionOperationBundleDigest(bundle)}\n`);
    } else {
      const options = {
        bundle,
        trustedBundleSha256: args["bundle-sha256"],
      };
      const result = command === "preflight"
        ? preflightProductionOperation(options)
        : executeProductionOperation(options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
