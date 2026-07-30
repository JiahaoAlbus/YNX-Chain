#!/usr/bin/env node
/**
 * Production change approval binding and one-time consumption.
 *
 * Initial and blue-green releases bind the approval embedded in the externally
 * production-signed attestation. Manual rollback binds a freshly verified,
 * multi-party break-glass authorization. Every accepted authorization is then
 * atomically consumed as a uniquely named immutable Kubernetes ConfigMap.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeBreakGlass } from "./security-break-glass.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ledgerNamespace = "default";
const ledgerPrefix = "ynx-change-approval-";
const releaseActions = new Set(["production-deployment", "production-blue-green-update"]);

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

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
}

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) throw new Error(`${label} must be sha256`);
}

function validDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function releaseIdentity(release, label) {
  const receipt = release?.receipt;
  if (
    typeof receipt?.sourceCommit !== "string"
    || !/^[0-9a-f]{40}$/.test(receipt.sourceCommit)
    || typeof receipt.version !== "string"
    || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(receipt.version)
    || !/^[0-9a-f]{64}$/.test(receipt.productionManifestSha256 ?? "")
  ) {
    throw new Error(`${label} production release identity is invalid`);
  }
  return {
    sourceCommit: receipt.sourceCommit,
    version: receipt.version,
    productionManifestSha256: receipt.productionManifestSha256,
  };
}

function changeResource({
  action,
  expectedClusterUid,
  current = null,
  target,
}) {
  safeIdentifier(action, "production change action");
  safeIdentifier(expectedClusterUid, "expectedClusterUid");
  return {
    schemaVersion: 1,
    action,
    environment: "production",
    clusterUidSha256: sha256(expectedClusterUid),
    current: current === null ? null : releaseIdentity(current, "current"),
    target: releaseIdentity(target, "target"),
  };
}

export function productionRollbackResourceReferenceSha256({
  currentRelease,
  targetRelease,
  expectedClusterUid,
}) {
  return sha256(canonicalJson(changeResource({
    action: "production-manual-rollback",
    expectedClusterUid,
    current: currentRelease,
    target: targetRelease,
  })));
}

function ledgerName(authorizationId) {
  digest(authorizationId, "authorizationId");
  return `${ledgerPrefix}${authorizationId.slice(0, 32)}`;
}

function releaseApproval(release) {
  const approval = release?.attestation?.approval;
  if (
    approval == null
    || typeof approval !== "object"
    || Array.isArray(approval)
    || Object.keys(approval).sort().join(",") !== "approvalId,approvedAt,approvers,expiresAt"
    || typeof approval.approvalId !== "string"
    || !Array.isArray(approval.approvers)
    || approval.approvers.length < 2
    || new Set(approval.approvers).size !== approval.approvers.length
    || approval.approvers.some((approver) => (
      typeof approver !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(approver)
    ))
  ) {
    throw new Error("signed production release approval is invalid");
  }
  return approval;
}

export function bindProductionReleaseApproval({
  release,
  action,
  operatorId,
  changeId,
  expectedClusterUid,
  now = new Date(),
}) {
  if (!releaseActions.has(action)) throw new Error("production release approval action is invalid");
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(changeId, "changeId");
  const approvedAt = validDate(new Date(releaseApproval(release).approvedAt), "production approval approvedAt");
  const expiresAt = validDate(new Date(release.attestation.approval.expiresAt), "production approval expiresAt");
  const current = validDate(now, "production approval binding time");
  const approval = release.attestation.approval;
  if (approval.approvalId !== changeId) {
    throw new Error("production changeId does not match the signed release approval");
  }
  if (approval.approvers.includes(operatorId)) {
    throw new Error("production operator must be independent from release approvers");
  }
  if (approvedAt.getTime() > current.getTime() || expiresAt.getTime() <= current.getTime()) {
    throw new Error("signed production release approval is not currently valid");
  }
  if (expiresAt.getTime() - approvedAt.getTime() > 24 * 60 * 60 * 1000) {
    throw new Error("signed production release approval exceeds 24 hours");
  }
  const resource = changeResource({
    action,
    expectedClusterUid,
    target: release,
  });
  const resourceReferenceSha256 = sha256(canonicalJson(resource));
  const authorizationId = sha256(`ynx-production-release-approval-v1\0${canonicalJson({
    approval,
    resourceReferenceSha256,
  })}`);
  return {
    schemaVersion: 1,
    source: "externally production-signed release approval",
    type: "release-approval",
    action,
    changeId,
    authorizationId,
    resourceReferenceSha256,
    approvalId: approval.approvalId,
    approverCount: approval.approvers.length,
    approversSha256: sha256([...approval.approvers].sort().join("\n")),
    approvedAt: approvedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    immediateAlertRequired: true,
    ledgerName: ledgerName(authorizationId),
    bound: true,
  };
}

export function bindProductionRollbackAuthorization({
  currentRelease,
  targetRelease,
  operatorId,
  changeId,
  expectedClusterUid,
  authorizationOptions,
  authorize = authorizeBreakGlass,
  now = new Date(),
}) {
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(changeId, "changeId");
  validDate(now, "production rollback authorization time");
  if (authorizationOptions == null || typeof authorize !== "function") {
    throw new Error("production rollback multi-party authorization is required");
  }
  const currentIdentity = releaseIdentity(currentRelease, "current");
  const targetIdentity = releaseIdentity(targetRelease, "target");
  const runtimeSourceCommit = currentRelease.receipt.runtimeSourceCommit;
  if (
    !/^[0-9a-f]{40}$/.test(runtimeSourceCommit ?? "")
    || targetRelease.receipt.runtimeSourceCommit !== runtimeSourceCommit
  ) {
    throw new Error("production rollback releases must bind the same executing runtime commit");
  }
  const resourceReferenceSha256 = productionRollbackResourceReferenceSha256({
    currentRelease,
    targetRelease,
    expectedClusterUid,
  });
  const authorization = authorize({
    ...authorizationOptions,
    sourceCommit: runtimeSourceCommit,
    now,
  });
  const authorizationExpiresAt = Date.parse(authorization?.expiresAt);
  const authorizationAuthorizedAt = Date.parse(authorization?.authorizedAt);
  safeIdentifier(authorization?.incidentId, "rollback incidentId");
  if (
    authorization?.action !== "break-glass-authorization"
    || authorization.environment !== "production"
    || authorization.scope !== "deployment:rollback"
    || authorization.product !== "YNX Security Platform"
    || authorization.requestId !== changeId
    || authorization.operatorIdentity !== operatorId
    || authorization.resourceId !== `production-release:${targetIdentity.sourceCommit}`
    || authorization.resourceReferenceSha256 !== resourceReferenceSha256
    || !/^[0-9a-f]{64}$/.test(authorization.requestDigest ?? "")
    || !/^[0-9a-f]{64}$/.test(authorization.policyDigest ?? "")
    || !Number.isInteger(authorization.approvalThreshold)
    || authorization.approvalThreshold < 2
    || !Number.isInteger(authorization.distinctRoleThreshold)
    || authorization.distinctRoleThreshold < 2
    || !Array.isArray(authorization.approvals)
    || authorization.approvals.length < authorization.approvalThreshold
    || authorization.oneTimeUseRequired !== true
    || authorization.consumptionLedgerRequired !== true
    || authorization.automaticExecutionAllowed !== false
    || authorization.immediateAlertRequired !== true
    || !Number.isFinite(authorizationAuthorizedAt)
    || authorizationAuthorizedAt > now.getTime() + 60_000
    || !Number.isFinite(authorizationExpiresAt)
    || authorizationExpiresAt <= now.getTime()
  ) {
    throw new Error("production rollback authorization does not bind the requested change");
  }
  digest(authorization.authorizationId, "rollback authorizationId");
  return {
    schemaVersion: 1,
    source: authorization.source,
    type: "break-glass-authorization",
    action: "production-manual-rollback",
    changeId,
    authorizationId: authorization.authorizationId,
    resourceReferenceSha256,
    requestDigest: authorization.requestDigest,
    policyDigest: authorization.policyDigest,
    approvalThreshold: authorization.approvalThreshold,
    distinctRoleThreshold: authorization.distinctRoleThreshold,
    approvalCount: authorization.approvals?.length,
    incidentId: authorization.incidentId,
    currentSourceCommit: currentIdentity.sourceCommit,
    targetSourceCommit: targetIdentity.sourceCommit,
    authorizedAt: authorization.authorizedAt,
    expiresAt: authorization.expiresAt,
    immediateAlertRequired: true,
    ledgerName: ledgerName(authorization.authorizationId),
    bound: true,
  };
}

function runText(execFile, args, action, input) {
  try {
    return execFile("kubectl", args, {
      cwd: root,
      encoding: "utf8",
      input,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`${action} failed`);
  }
}

export function consumeProductionApproval({
  context,
  approval,
  execFile = execFileSync,
}) {
  safeIdentifier(context, "context");
  if (
    approval?.bound !== true
    || approval.schemaVersion !== 1
    || (!releaseActions.has(approval.action) && approval.action !== "production-manual-rollback")
    || approval.ledgerName !== ledgerName(approval.authorizationId)
  ) {
    throw new Error("bound production approval is invalid");
  }
  safeIdentifier(approval.changeId, "changeId");
  digest(approval.resourceReferenceSha256, "resourceReferenceSha256");
  const document = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: approval.ledgerName,
      namespace: ledgerNamespace,
      labels: {
        "app.kubernetes.io/part-of": "ynx-security-platform",
        "security.ynx/purpose": "production-change-approval-consumption",
      },
      annotations: {
        "security.ynx/action": approval.action,
        "security.ynx/authorization-id-sha256": sha256(approval.authorizationId),
        "security.ynx/change-id-sha256": sha256(approval.changeId),
        "security.ynx/resource-reference-sha256": approval.resourceReferenceSha256,
      },
    },
    immutable: true,
    data: {},
  };
  const output = runText(execFile, [
    "--context", context,
    "create", "-f", "-", "-o", "json",
  ], "production approval consumption", `${JSON.stringify(document)}\n`);
  if (output === "") throw new Error("production approval consumption returned no receipt");
  let accepted;
  try {
    accepted = JSON.parse(output);
  } catch {
    throw new Error("production approval consumption returned invalid JSON");
  }
  if (
    accepted.apiVersion !== "v1"
    || accepted.kind !== "ConfigMap"
    || accepted.metadata?.name !== approval.ledgerName
    || accepted.metadata?.namespace !== ledgerNamespace
    || accepted.immutable !== true
    || accepted.metadata?.annotations?.["security.ynx/authorization-id-sha256"] !== sha256(approval.authorizationId)
    || accepted.metadata?.annotations?.["security.ynx/action"] !== approval.action
    || accepted.metadata?.annotations?.["security.ynx/change-id-sha256"] !== sha256(approval.changeId)
    || accepted.metadata?.annotations?.["security.ynx/resource-reference-sha256"] !== approval.resourceReferenceSha256
    || typeof accepted.metadata?.uid !== "string"
    || accepted.metadata.uid === ""
    || typeof accepted.metadata?.resourceVersion !== "string"
    || accepted.metadata.resourceVersion === ""
    || !Number.isFinite(Date.parse(accepted.metadata?.creationTimestamp))
  ) {
    throw new Error("production approval consumption receipt is invalid");
  }
  const consumedAt = Date.parse(accepted.metadata.creationTimestamp);
  const validFrom = Date.parse(approval.approvedAt ?? approval.authorizedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (
    !Number.isFinite(validFrom)
    || !Number.isFinite(expiresAt)
    || consumedAt < validFrom
    || consumedAt >= expiresAt
  ) {
    throw new Error("production approval consumption time is outside the authorization window");
  }
  return {
    schemaVersion: 1,
    ledger: `${ledgerNamespace}/${approval.ledgerName}`,
    authorizationId: approval.authorizationId,
    resourceReferenceSha256: approval.resourceReferenceSha256,
    consumedAt: new Date(consumedAt).toISOString(),
    uidSha256: sha256(accepted.metadata.uid),
    resourceVersionSha256: sha256(accepted.metadata.resourceVersion),
    immutable: true,
    consumed: true,
  };
}
