#!/usr/bin/env node
/**
 * Operator-controlled production rollback.
 *
 * The current and target releases must both pass production signature
 * verification and be pinned to prior successful public deployment evidence.
 * The runtime verifies the live current release and cluster identity before a
 * target server dry-run. A failed target rollback triggers reconciliation and
 * direct verification of the signed current release.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectLiveProductionRelease,
  loadProductionReleaseRequest,
  productionManifestInventory,
  readPinnedProductionEvidence,
  reconcileProductionRelease,
  validateProductionDeploymentEvidence,
  validateSignedProductionBundle,
} from "./security-production-blue-green.mjs";
import {
  verifyProductionPublicEndpoints,
  verifyProductionReadiness,
} from "./security-production-deploy.mjs";
import {
  bindProductionRollbackAuthorization,
  consumeProductionApproval,
  productionRollbackResourceReferenceSha256,
} from "./security-production-approval.mjs";
import {
  deliverProductionChangeAlert,
  preflightProductionAlertInputs,
} from "./security-production-alert.mjs";
import { acquireProductionLease } from "./security-production-lease.mjs";
import { bindProductionOperationExecution } from "./security-production-operation-binding.mjs";
import { verifyProductionOperatorRbac } from "./security-production-rbac.mjs";
import { verifyProductionReleaseBundle } from "./security-production-release.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const namespace = "ynx-services";
const productionFieldManager = "ynx-security-platform-production";
const greenDeployment = "quant-worker-green";

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
}

function repositoryPath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath === "") throw new Error(`${label} is required`);
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(`${root}/`)) throw new Error(`${label} must stay inside the repository`);
  return absolute;
}

function runText(execFile, command, args, action, input) {
  try {
    return execFile(command, args, {
      cwd: root,
      encoding: "utf8",
      input,
      maxBuffer: 16 * 1024 * 1024,
      stdio: input === undefined
        ? ["ignore", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`${action} failed`);
  }
}

function writeEvidence(relativePath, value) {
  const output = repositoryPath(relativePath, "evidencePath");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function verifiedBundle(verifyRelease, options, execFile, now, label) {
  return validateSignedProductionBundle(verifyRelease({
    ...options,
    execFile,
    now,
  }), label);
}

export function preflightProductionRollback({
  currentReleaseOptions,
  targetReleaseOptions,
  currentEvidencePath,
  currentEvidenceSha256,
  targetEvidencePath,
  targetEvidenceSha256,
  context,
  expectedClusterUid,
  execFile = execFileSync,
  verifyRelease = verifyProductionReleaseBundle,
  authorize = verifyProductionOperatorRbac,
  now = new Date(),
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("production rollback clock is invalid");
  }
  if (currentReleaseOptions == null || targetReleaseOptions == null) {
    throw new Error("current and target signed release options are required");
  }
  const current = verifiedBundle(
    verifyRelease,
    currentReleaseOptions,
    execFile,
    now,
    "current",
  );
  const target = verifiedBundle(
    verifyRelease,
    targetReleaseOptions,
    execFile,
    now,
    "target",
  );
  if (current.receipt.sourceCommit === target.receipt.sourceCommit) {
    throw new Error("production rollback target must differ from the current release");
  }
  if (current.receipt.productionManifestSha256 === target.receipt.productionManifestSha256) {
    throw new Error("production rollback target manifest must differ from the current release");
  }
  if (current.receipt.publicProbePolicySha256 !== target.receipt.publicProbePolicySha256) {
    throw new Error("production rollback cannot change the signed public probe boundary");
  }
  const currentInventory = productionManifestInventory(current.manifest, "current");
  const targetInventory = productionManifestInventory(target.manifest, "target");
  if (JSON.stringify(currentInventory) !== JSON.stringify(targetInventory)) {
    throw new Error("production rollback requires an identical Kubernetes resource inventory");
  }
  const currentEvidence = readPinnedProductionEvidence(
    currentEvidencePath,
    currentEvidenceSha256,
    "current",
  );
  const targetEvidence = readPinnedProductionEvidence(
    targetEvidencePath,
    targetEvidenceSha256,
    "target",
  );
  validateProductionDeploymentEvidence(
    currentEvidence,
    current,
    context,
    expectedClusterUid,
    "current",
  );
  validateProductionDeploymentEvidence(
    targetEvidence,
    target,
    context,
    expectedClusterUid,
    "target",
  );
  const currentReleasedAt = Date.parse(currentEvidence.value.releasedAt);
  const targetReleasedAt = Date.parse(targetEvidence.value.releasedAt);
  if (
    !Number.isFinite(currentReleasedAt)
    || !Number.isFinite(targetReleasedAt)
    || currentReleasedAt > now.getTime() + 30_000
    || targetReleasedAt >= currentReleasedAt
  ) {
    throw new Error("production rollback target must have been publicly released before the current release");
  }
  const cluster = inspectLiveProductionRelease(
    execFile,
    context,
    expectedClusterUid,
    current,
  );
  if (typeof authorize !== "function") throw new Error("production RBAC verifier is required");
  const operatorAuthorization = authorize({
    context,
    manifest: target.manifest,
    mode: "rollback",
    execFile,
  });
  if (operatorAuthorization?.pass !== true) {
    throw new Error("production operator RBAC preflight did not pass");
  }
  const existingGreen = runText(execFile, "kubectl", [
    "--context", context, "get", "deployment", greenDeployment,
    "-n", namespace, "--ignore-not-found=true", "-o", "json",
  ], "production rollback concurrency inspection");
  if (existingGreen !== "") {
    throw new Error("production rollback refuses an active blue-green update");
  }
  const dryRun = runText(execFile, "kubectl", [
    "--context", context, "apply", "--server-side", "--dry-run=server",
    `--field-manager=${productionFieldManager}`, "-f", "-",
  ], "production rollback server-side dry-run", target.manifest);
  if (dryRun === "") throw new Error("production rollback server-side dry-run returned no receipt");
  return {
    current,
    target,
    receipt: {
      schemaVersion: 1,
      action: "production-manual-rollback-preflight",
      source: "two verified production signatures, two pinned public deployment receipts, and direct cluster preflight",
      asOf: now.toISOString(),
      environment: "production",
      currentSourceCommit: current.receipt.sourceCommit,
      currentVersion: current.receipt.version,
      currentManifestSha256: current.receipt.productionManifestSha256,
      currentEvidenceSha256: currentEvidence.sha256,
      currentReleasedAt: currentEvidence.value.releasedAt,
      targetSourceCommit: target.receipt.sourceCommit,
      targetVersion: target.receipt.version,
      targetManifestSha256: target.receipt.productionManifestSha256,
      targetEvidenceSha256: targetEvidence.sha256,
      targetReleasedAt: targetEvidence.value.releasedAt,
      rollbackAuthorizationScope: "deployment:rollback",
      rollbackAuthorizationResourceId: `production-release:${target.receipt.sourceCommit}`,
      rollbackResourceReferenceSha256: productionRollbackResourceReferenceSha256({
        currentRelease: current,
        targetRelease: target,
        expectedClusterUid,
      }),
      publicProbePolicySha256: target.receipt.publicProbePolicySha256,
      resourceInventorySha256: sha256(currentInventory.join("\n")),
      resourceInventoryCount: currentInventory.length,
      contextSha256: sha256(context),
      clusterUidSha256: sha256(expectedClusterUid),
      serverVersion: cluster.serverVersion,
      operatorAuthorization,
      currentImageDigest: cluster.stableImageDigest,
      serverDryRunPassed: true,
      serverDryRunOutputSha256: sha256(dryRun),
      productionSigned: true,
      mutationPerformed: false,
      deployedPublic: true,
    },
  };
}

export function rollbackProduction({
  currentReleaseOptions,
  targetReleaseOptions,
  currentEvidencePath,
  currentEvidenceSha256,
  targetEvidencePath,
  targetEvidenceSha256,
  context,
  expectedClusterUid,
  operatorId,
  changeId,
  acknowledge,
  evidencePath,
  rollbackAuthorizationOptions,
  rolloutTimeoutSeconds = 600,
  execFile = execFileSync,
  verifyRelease = verifyProductionReleaseBundle,
  verifyReadiness = verifyProductionReadiness,
  verifyPublicEndpoints = verifyProductionPublicEndpoints,
  authorize = verifyProductionOperatorRbac,
  approvalBinder = bindProductionRollbackAuthorization,
  approvalConsumer = consumeProductionApproval,
  alertDispatcher = deliverProductionChangeAlert,
  alertInputPreflight = preflightProductionAlertInputs,
  alertOptions,
  operatorBundlePreflight = null,
  leaseFactory = acquireProductionLease,
  leaseDurationSeconds = 600,
  now = () => new Date(),
}) {
  if (acknowledge !== "rollback-production-release") {
    throw new Error("production rollback requires acknowledge=rollback-production-release");
  }
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(changeId, "changeId");
  repositoryPath(evidencePath, "evidencePath");
  if (!Number.isInteger(rolloutTimeoutSeconds) || rolloutTimeoutSeconds < 60 || rolloutTimeoutSeconds > 1800) {
    throw new Error("rolloutTimeoutSeconds must be between 60 and 1800");
  }
  if (
    typeof verifyRelease !== "function"
    || typeof verifyReadiness !== "function"
    || typeof verifyPublicEndpoints !== "function"
    || typeof leaseFactory !== "function"
    || typeof approvalBinder !== "function"
    || typeof approvalConsumer !== "function"
    || typeof alertDispatcher !== "function"
    || typeof alertInputPreflight !== "function"
    || typeof now !== "function"
  ) {
    throw new Error("production rollback runtime dependencies are invalid");
  }
  const startedAt = now();
  const preflight = preflightProductionRollback({
    currentReleaseOptions,
    targetReleaseOptions,
    currentEvidencePath,
    currentEvidenceSha256,
    targetEvidencePath,
    targetEvidenceSha256,
    context,
    expectedClusterUid,
    execFile,
    verifyRelease,
    authorize,
    now: startedAt,
  });
  const changeApproval = approvalBinder({
    currentRelease: preflight.current,
    targetRelease: preflight.target,
    operatorId,
    changeId,
    expectedClusterUid,
    authorizationOptions: rollbackAuthorizationOptions,
    now: startedAt,
  });
  if (changeApproval?.bound !== true) throw new Error("production rollback approval did not bind");
  const alertPreflight = alertInputPreflight({
    ...alertOptions,
    execFile,
    sourceCommit: preflight.current.receipt.runtimeSourceCommit,
    checkedAt: startedAt,
  });
  if (
    alertPreflight?.ready !== true
    || alertPreflight.alertDeliveryPerformed !== false
    || alertPreflight.productionMutationPerformed !== false
    || alertPreflight.sourceCommit !== preflight.current.receipt.runtimeSourceCommit
    || alertPreflight.credentialBinding?.bound !== true
    || !/^[0-9a-f]{64}$/.test(
      alertPreflight.credentialBinding.credentialIdentitySha256 ?? "",
    )
  ) {
    throw new Error("production alert external input preflight failed");
  }
  const operatorBundleBinding = operatorBundlePreflight === null
    ? null
    : bindProductionOperationExecution({
      preflight: operatorBundlePreflight,
      expectedOperation: "manual-rollback",
      runtimeSourceCommit: preflight.current.receipt.runtimeSourceCommit,
      changeApproval,
      alertInputPreflight: alertPreflight,
    });
  const productionLease = leaseFactory({
    context,
    operatorId,
    changeId,
    action: "production-manual-rollback",
    durationSeconds: leaseDurationSeconds,
    execFile,
    now,
  });
  if (productionLease?.receipt == null || typeof productionLease.renew !== "function" || typeof productionLease.release !== "function") {
    throw new Error("production Lease factory returned an invalid handle");
  }
  const leaseRenewals = [];
  const intent = {
    ...preflight.receipt,
    action: "production-manual-rollback",
    operatorId,
    changeId,
    startedAt: startedAt.toISOString(),
    state: "rollback-apply-not-confirmed",
    productionLease: productionLease.receipt,
    productionLeaseRenewals: leaseRenewals,
    productionLeaseRelease: null,
    productionLeaseReleased: false,
    changeApproval,
    approvalConsumption: null,
    approvalConsumptionAttempted: false,
    alertDelivery: null,
    alertDeliveryAttempted: false,
    alertInputPreflight: alertPreflight,
    operatorBundleBinding,
  };
  writeEvidence(evidencePath, intent);

  let targetApplyAttempted = false;
  let approvalConsumption = null;
  let approvalConsumptionAttempted = false;
  let alertDelivery = null;
  let alertDeliveryAttempted = false;
  try {
    leaseRenewals.push(productionLease.renew());
    alertDeliveryAttempted = true;
    alertDelivery = alertDispatcher({
      approval: changeApproval,
      operatorId,
      expectedClusterUid,
      ...alertOptions,
      execFile,
      sourceCommit: preflight.current.receipt.runtimeSourceCommit,
    });
    if (alertDelivery?.delivered !== true) {
      throw new Error("production change alert was not delivered");
    }
    if (
      alertDelivery.credentialBinding?.credentialIdentitySha256
      !== alertPreflight.credentialBinding.credentialIdentitySha256
    ) {
      throw new Error("production alert credential changed after external input preflight");
    }
    approvalConsumptionAttempted = true;
    approvalConsumption = approvalConsumer({
      context,
      approval: changeApproval,
      execFile,
    });
    if (approvalConsumption?.consumed !== true) {
      throw new Error("production rollback approval was not consumed");
    }
    targetApplyAttempted = true;
    const targetResult = reconcileProductionRelease({
      execFile,
      context,
      release: preflight.target,
      rolloutTimeoutSeconds,
      verifyReadiness,
      verifyPublicEndpoints,
      now,
      action: "production rollback target",
    });
    const completedAt = now();
    let productionLeaseRelease = null;
    let productionLeaseReleaseFailure = null;
    try {
      productionLeaseRelease = productionLease.release();
    } catch (leaseError) {
      productionLeaseReleaseFailure = leaseError.message;
    }
    const result = {
      ...intent,
      sourceCommit: preflight.target.receipt.sourceCommit,
      version: preflight.target.receipt.version,
      productionManifestSha256: preflight.target.receipt.productionManifestSha256,
      completedAt: completedAt.toISOString(),
      releasedAt: completedAt.toISOString(),
      state: productionLeaseRelease === null
        ? "deployed-public-verified-lease-release-pending"
        : "deployed-public-verified",
      ...targetResult,
      rollbackFromSourceCommit: preflight.current.receipt.sourceCommit,
      rollbackTargetEvidenceSha256: targetEvidenceSha256,
      productionLeaseRenewals: leaseRenewals,
      productionLeaseRelease,
      productionLeaseReleaseFailure,
      productionLeaseReleased: productionLeaseRelease !== null,
      changeApproval,
      approvalConsumption,
      approvalConsumptionAttempted,
      alertDelivery,
      alertDeliveryAttempted,
      alertInputPreflight: alertPreflight,
      operatorBundleBinding,
      activeSourceCommit: preflight.target.receipt.sourceCommit,
      currentRestored: false,
      productionSigned: true,
      mutationPerformed: true,
      deployedPublic: true,
    };
    writeEvidence(evidencePath, result);
    return result;
  } catch (error) {
    let leaseOwnershipFailure = null;
    try {
      leaseRenewals.push(productionLease.renew());
    } catch (leaseError) {
      leaseOwnershipFailure = leaseError.message;
    }
    let currentRecovery = null;
    let currentRecoveryFailure = null;
    if (leaseOwnershipFailure === null) {
      try {
        currentRecovery = reconcileProductionRelease({
          execFile,
          context,
          release: preflight.current,
          rolloutTimeoutSeconds,
          verifyReadiness,
          verifyPublicEndpoints,
          now,
          action: "production rollback recovery",
        });
      } catch (recoveryError) {
        currentRecoveryFailure = recoveryError.message;
      }
    }
    const currentRestored = currentRecovery !== null && currentRecoveryFailure === null;
    const failedAt = now();
    let productionLeaseRelease = null;
    let productionLeaseReleaseFailure = null;
    try {
      productionLeaseRelease = productionLease.release();
    } catch (leaseError) {
      productionLeaseReleaseFailure = leaseError.message;
    }
    const failed = {
      ...intent,
      failedAt: failedAt.toISOString(),
      state: currentRestored
        ? "rollback-target-failed-current-restored"
        : "rollback-failed-active-release-unverified",
      failure: error.message,
      targetApplyAttempted,
      currentRecoveryAttempted: true,
      currentRecovery,
      currentRecoveryFailure,
      leaseOwnershipFailure,
      productionLeaseRenewals: leaseRenewals,
      productionLeaseRelease,
      productionLeaseReleaseFailure,
      productionLeaseReleased: productionLeaseRelease !== null,
      changeApproval,
      approvalConsumption,
      approvalConsumptionAttempted,
      alertDelivery,
      alertDeliveryAttempted,
      alertInputPreflight: alertPreflight,
      operatorBundleBinding,
      currentRestored,
      activeSourceCommit: currentRestored ? preflight.current.receipt.sourceCommit : null,
      sourceCommit: currentRestored
        ? preflight.current.receipt.sourceCommit
        : preflight.target.receipt.sourceCommit,
      version: currentRestored
        ? preflight.current.receipt.version
        : preflight.target.receipt.version,
      productionManifestSha256: currentRestored
        ? preflight.current.receipt.productionManifestSha256
        : preflight.target.receipt.productionManifestSha256,
      readiness: currentRecovery?.readiness ?? null,
      publicProbes: currentRecovery?.publicProbes ?? null,
      productionSigned: true,
      mutationPerformed: alertDeliveryAttempted || approvalConsumptionAttempted || targetApplyAttempted,
      deployedPublic: currentRestored,
    };
    writeEvidence(evidencePath, failed);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const common = {
      currentReleaseOptions: loadProductionReleaseRequest(args["current-release-request"]),
      targetReleaseOptions: loadProductionReleaseRequest(args["target-release-request"]),
      currentEvidencePath: args["current-evidence"],
      currentEvidenceSha256: args["current-evidence-sha256"],
      targetEvidencePath: args["target-evidence"],
      targetEvidenceSha256: args["target-evidence-sha256"],
      context: args.context,
      expectedClusterUid: args["cluster-uid"],
    };
    let result;
    if (command === "preflight") {
      ({ receipt: result } = preflightProductionRollback(common));
    } else if (command === "rollback") {
      const approvalPaths = args["authorization-approvals"]?.split(",").filter(Boolean) ?? [];
      if (approvalPaths.length < 2 || approvalPaths.length > 5) {
        throw new Error("production rollback requires 2-5 authorization approval files");
      }
      result = rollbackProduction({
        ...common,
        operatorId: args["operator-id"],
        changeId: args["change-id"],
        acknowledge: args.acknowledge,
        evidencePath: args.evidence,
        alertOptions: {
          endpoint: args["alert-endpoint"],
          expectedHost: args["alert-expected-host"],
          credentialHeaderFile: args["alert-credential-header-file"],
          credentialVersionFile: args["alert-credential-version-file"],
          credentialSecretInventory: JSON.parse(readFileSync(
            resolve(args["alert-secret-inventory"]),
            "utf8",
          )),
          trustedCredentialSecretInventorySha256: args["alert-secret-inventory-sha256"],
        },
        rollbackAuthorizationOptions: {
          request: JSON.parse(readFileSync(resolve(args["authorization-request"]), "utf8")),
          policy: JSON.parse(readFileSync(resolve(args["authorization-policy"]), "utf8")),
          approvals: approvalPaths.map((path) => JSON.parse(readFileSync(resolve(path), "utf8"))),
          trustedPolicySha256: args["trusted-authorization-policy-sha256"],
        },
        rolloutTimeoutSeconds: Number(args["rollout-timeout-seconds"] ?? 600),
        leaseDurationSeconds: Number(args["lease-duration-seconds"] ?? 600),
      });
    } else {
      throw new Error("usage: security-production-rollback.mjs preflight|rollback --current-release-request PATH --target-release-request PATH --current-evidence PATH --current-evidence-sha256 SHA256 --target-evidence PATH --target-evidence-sha256 SHA256 --context NAME --cluster-uid UID [--authorization-request PATH --authorization-policy PATH --authorization-approvals A,B --trusted-authorization-policy-sha256 SHA256] [--alert-endpoint URL --alert-expected-host HOST --alert-credential-header-file /run/secrets/ynx/NAME --alert-credential-version-file /run/secrets/ynx/NAME.version-id --alert-secret-inventory PATH --alert-secret-inventory-sha256 SHA256] [rollback flags]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
