#!/usr/bin/env node
/**
 * Break-glass multi-party authorization verifier.
 *
 * This runtime verifies externally produced Ed25519 approvals. It never loads
 * private keys, reads secret values, or executes the requested emergency action.
 */

import {
  createHash,
  createPublicKey,
  verify,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requestFields = new Set([
  "schemaVersion",
  "requestId",
  "incidentId",
  "policyId",
  "sourceCommit",
  "requestedBy",
  "operatorIdentity",
  "product",
  "environment",
  "scope",
  "resourceId",
  "resourceReferenceSha256",
  "reason",
  "createdAt",
  "expiresAt",
  "nonce",
]);
const policyFields = new Set([
  "schemaVersion",
  "policyId",
  "sourceCommit",
  "status",
  "environment",
  "minimumApprovals",
  "minimumDistinctRoles",
  "maxAuthorizationSeconds",
  "allowedScopes",
  "approvers",
]);
const approverFields = new Set([
  "id",
  "role",
  "publicKeyFingerprint",
  "publicKeyJwk",
  "allowedScopes",
  "environments",
  "notBefore",
  "expiresAt",
  "revokedAt",
]);
const approvalFields = new Set([
  "schemaVersion",
  "policyId",
  "requestDigest",
  "approverId",
  "keyFingerprint",
  "signedAt",
  "signatureBase64",
]);
const permittedScopes = new Set([
  "secret-manager:inspect",
  "secret-manager:rotate",
  "secret-manager:detach-previous-stage",
  "service-identity:revoke",
  "deployment:rollback",
  "backup:restore",
  "incident:isolate",
]);

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

function assertExactFields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(",")}`);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value;
}

function safeIdentifier(value, label) {
  requiredString(value, label);
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return parsed;
}

function validateSourceCommit(sourceCommit) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("sourceCommit must be a full Git SHA");
  }
}

function fingerprint(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return `sha256:${sha256(der)}`;
}

function validatePublicJwk(jwk) {
  assertExactFields(jwk, new Set(["kty", "crv", "x", "key_ops", "ext"]), "approver public JWK");
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string" || jwk.x.length < 40) {
    throw new Error("approver public JWK must be an Ed25519 public key");
  }
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  return { publicKey, fingerprint: fingerprint(publicKey) };
}

function validateScope(scope) {
  if (!permittedScopes.has(scope) || scope.includes("*")) {
    throw new Error(`break-glass scope is not permitted: ${scope}`);
  }
}

export function breakGlassSigningPayload(request) {
  assertExactFields(request, requestFields, "break-glass request");
  return Buffer.from(`ynx-break-glass-approval-v1\0${canonicalJson(request)}`, "utf8");
}

export function breakGlassPolicyDigest(policy) {
  assertExactFields(policy, policyFields, "break-glass policy");
  return sha256(Buffer.from(`ynx-break-glass-policy-v1\0${canonicalJson(policy)}`, "utf8"));
}

function validateRequest(request, policy, sourceCommit, nowMs) {
  assertExactFields(request, requestFields, "break-glass request");
  if (request.schemaVersion !== 1) throw new Error("break-glass request schemaVersion must be 1");
  validateSourceCommit(request.sourceCommit);
  if (request.sourceCommit !== sourceCommit) throw new Error("request sourceCommit does not match the runtime");
  for (const field of [
    "requestId",
    "incidentId",
    "policyId",
    "requestedBy",
    "operatorIdentity",
    "product",
    "environment",
    "scope",
    "resourceId",
    "reason",
    "nonce",
  ]) {
    requiredString(request[field], `request ${field}`);
  }
  for (const field of [
    "requestId",
    "incidentId",
    "policyId",
    "requestedBy",
    "operatorIdentity",
    "product",
    "resourceId",
  ]) {
    safeIdentifier(request[field], `request ${field}`);
  }
  if (request.policyId !== policy.policyId) throw new Error("request policyId does not match policy");
  if (request.requestedBy === request.operatorIdentity) {
    throw new Error("requester and isolated operator identity must differ");
  }
  if (!new Set(["staging", "production"]).has(request.environment)) {
    throw new Error("break-glass environment must be staging or production");
  }
  if (!/^[0-9a-f]{64}$/.test(request.resourceReferenceSha256 ?? "")) {
    throw new Error("resourceReferenceSha256 must be a SHA-256 digest");
  }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(request.nonce)) {
    throw new Error("request nonce must be 16-128 safe characters");
  }
  if (request.reason.trim().length < 16 || request.reason.length > 1024 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(request.reason)) {
    throw new Error("break-glass reason must be 16-1024 printable characters");
  }
  validateScope(request.scope);

  const createdAt = timestamp(request.createdAt, "request createdAt");
  const expiresAt = timestamp(request.expiresAt, "request expiresAt");
  if (createdAt > nowMs + 60_000) throw new Error("break-glass request was created in the future");
  if (expiresAt <= nowMs) throw new Error("break-glass request is expired");
  if (expiresAt <= createdAt) throw new Error("break-glass expiry must follow creation");
  if ((expiresAt - createdAt) / 1000 > policy.maxAuthorizationSeconds) {
    throw new Error("break-glass request exceeds the policy lifetime");
  }
  return { createdAt, expiresAt };
}

function validatePolicy(policy, sourceCommit, nowMs) {
  assertExactFields(policy, policyFields, "break-glass policy");
  if (policy.schemaVersion !== 1) throw new Error("break-glass policy schemaVersion must be 1");
  safeIdentifier(policy.policyId, "policyId");
  validateSourceCommit(policy.sourceCommit);
  if (policy.sourceCommit !== sourceCommit) throw new Error("policy sourceCommit does not match the runtime");
  if (policy.status !== "active") throw new Error("break-glass policy is not active");
  if (!new Set(["staging", "production"]).has(policy.environment)) {
    throw new Error("policy environment must be staging or production");
  }
  if (!Number.isInteger(policy.minimumApprovals) || policy.minimumApprovals < 2 || policy.minimumApprovals > 5) {
    throw new Error("policy minimumApprovals must be between 2 and 5");
  }
  if (
    !Number.isInteger(policy.minimumDistinctRoles)
    || policy.minimumDistinctRoles < 2
    || policy.minimumDistinctRoles > policy.minimumApprovals
  ) {
    throw new Error("policy minimumDistinctRoles must be between 2 and minimumApprovals");
  }
  if (
    !Number.isInteger(policy.maxAuthorizationSeconds)
    || policy.maxAuthorizationSeconds < 60
    || policy.maxAuthorizationSeconds > 3600
  ) {
    throw new Error("policy maxAuthorizationSeconds must be between 60 and 3600");
  }
  if (!Array.isArray(policy.allowedScopes) || policy.allowedScopes.length === 0) {
    throw new Error("policy allowedScopes must not be empty");
  }
  const allowedScopeSet = new Set(policy.allowedScopes);
  if (allowedScopeSet.size !== policy.allowedScopes.length) throw new Error("policy allowedScopes must be unique");
  for (const scope of allowedScopeSet) validateScope(scope);
  if (!Array.isArray(policy.approvers) || policy.approvers.length < policy.minimumApprovals) {
    throw new Error("policy does not contain enough approvers");
  }

  const approvers = new Map();
  const fingerprints = new Set();
  for (const approver of policy.approvers) {
    assertExactFields(approver, approverFields, "policy approver");
    safeIdentifier(approver.id, "approver id");
    safeIdentifier(approver.role, "approver role");
    if (approvers.has(approver.id)) throw new Error(`duplicate approver id: ${approver.id}`);
    const validatedKey = validatePublicJwk(approver.publicKeyJwk);
    if (validatedKey.fingerprint !== approver.publicKeyFingerprint) {
      throw new Error(`approver key fingerprint mismatch: ${approver.id}`);
    }
    if (fingerprints.has(validatedKey.fingerprint)) throw new Error("approver keys must be independent");
    fingerprints.add(validatedKey.fingerprint);
    if (!Array.isArray(approver.allowedScopes) || !approver.allowedScopes.every((scope) => allowedScopeSet.has(scope))) {
      throw new Error(`approver scopes exceed policy: ${approver.id}`);
    }
    if (!Array.isArray(approver.environments) || !approver.environments.includes(policy.environment)) {
      throw new Error(`approver environment does not include policy environment: ${approver.id}`);
    }
    const notBefore = timestamp(approver.notBefore, `approver ${approver.id} notBefore`);
    const expiresAt = timestamp(approver.expiresAt, `approver ${approver.id} expiresAt`);
    if (notBefore > nowMs || expiresAt <= nowMs || approver.revokedAt !== null) {
      throw new Error(`approver is not active: ${approver.id}`);
    }
    approvers.set(approver.id, { ...approver, publicKey: validatedKey.publicKey });
  }
  return { approvers, allowedScopeSet };
}

function decodeSignature(value) {
  if (typeof value !== "string" || value.length < 80 || value.length > 120) {
    throw new Error("approval signature must be canonical base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new Error("approval signature must be canonical Ed25519 base64");
  }
  return decoded;
}

export function authorizeBreakGlass({
  request,
  policy,
  approvals,
  sourceCommit,
  trustedPolicySha256,
  now = new Date(),
}) {
  validateSourceCommit(sourceCommit);
  if (!/^[0-9a-f]{64}$/.test(trustedPolicySha256 ?? "")) {
    throw new Error("trustedPolicySha256 must be a SHA-256 digest");
  }
  const policyDigest = breakGlassPolicyDigest(policy);
  if (policyDigest !== trustedPolicySha256) {
    throw new Error("break-glass policy does not match the trusted digest");
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("authorization time is invalid");
  const validatedPolicy = validatePolicy(policy, sourceCommit, nowMs);
  const requestTime = validateRequest(request, policy, sourceCommit, nowMs);
  if (request.environment !== policy.environment) throw new Error("request environment does not match policy");
  if (!validatedPolicy.allowedScopeSet.has(request.scope)) throw new Error("request scope is not allowed by policy");
  if (!Array.isArray(approvals)) throw new Error("approvals must be an array");

  const payload = breakGlassSigningPayload(request);
  const requestDigest = sha256(payload);
  const acceptedApprovals = [];
  const approverIds = new Set();
  const keyFingerprints = new Set();
  const roles = new Set();

  for (const approval of approvals) {
    assertExactFields(approval, approvalFields, "break-glass approval");
    if (approval.schemaVersion !== 1) throw new Error("approval schemaVersion must be 1");
    if (approval.policyId !== policy.policyId) throw new Error("approval policyId does not match policy");
    if (approval.requestDigest !== requestDigest) throw new Error("approval request digest does not match");
    const approver = validatedPolicy.approvers.get(approval.approverId);
    if (!approver) throw new Error(`approval uses an unknown approver: ${approval.approverId}`);
    if (request.requestedBy === approver.id || request.operatorIdentity === approver.id) {
      throw new Error("requester and isolated operator cannot approve their own break-glass request");
    }
    if (approverIds.has(approver.id)) throw new Error(`duplicate approval: ${approver.id}`);
    if (keyFingerprints.has(approval.keyFingerprint)) throw new Error("approval keys must be independent");
    if (approval.keyFingerprint !== approver.publicKeyFingerprint) {
      throw new Error(`approval key fingerprint mismatch: ${approver.id}`);
    }
    if (!approver.allowedScopes.includes(request.scope) || !approver.environments.includes(request.environment)) {
      throw new Error(`approver is not authorized for the requested boundary: ${approver.id}`);
    }
    const signedAt = timestamp(approval.signedAt, `approval ${approver.id} signedAt`);
    if (signedAt < requestTime.createdAt || signedAt > nowMs + 60_000 || signedAt >= requestTime.expiresAt) {
      throw new Error(`approval time is outside the request window: ${approver.id}`);
    }
    if (
      signedAt < timestamp(approver.notBefore, `approver ${approver.id} notBefore`)
      || signedAt >= timestamp(approver.expiresAt, `approver ${approver.id} expiresAt`)
    ) {
      throw new Error(`approval time is outside the approver key validity: ${approver.id}`);
    }
    const decodedSignature = decodeSignature(approval.signatureBase64);
    if (!verify(null, payload, approver.publicKey, decodedSignature)) {
      throw new Error(`approval signature verification failed: ${approver.id}`);
    }
    approverIds.add(approver.id);
    keyFingerprints.add(approver.publicKeyFingerprint);
    roles.add(approver.role);
    acceptedApprovals.push({
      approverId: approver.id,
      role: approver.role,
      keyFingerprint: approver.publicKeyFingerprint,
      signedAt: approval.signedAt,
      signatureSha256: sha256(decodedSignature),
    });
  }

  if (acceptedApprovals.length < policy.minimumApprovals) {
    throw new Error("break-glass approval threshold was not met");
  }
  if (roles.size < policy.minimumDistinctRoles) {
    throw new Error("break-glass distinct-role threshold was not met");
  }
  acceptedApprovals.sort((a, b) => a.approverId.localeCompare(b.approverId));
  const authorizationId = sha256(Buffer.from(canonicalJson({
    requestDigest,
    policyDigest,
    approvals: acceptedApprovals,
  })));

  return {
    schemaVersion: 1,
    action: "break-glass-authorization",
    source: "YNX break-glass multi-party signature verifier",
    sourceCommit,
    version: "1",
    asOf: now.toISOString(),
    confidence: "cryptographically-verified-against-pinned-policy",
    coverage: "authorization only; execution, consumption, alert delivery, and revocation require downstream direct evidence",
    policyId: policy.policyId,
    policyDigest,
    requestId: request.requestId,
    requestDigest,
    authorizationId,
    incidentId: request.incidentId,
    requestedBy: request.requestedBy,
    operatorIdentity: request.operatorIdentity,
    product: request.product,
    environment: request.environment,
    scope: request.scope,
    resourceId: request.resourceId,
    resourceReferenceSha256: request.resourceReferenceSha256,
    reasonSha256: sha256(request.reason),
    authorizedAt: now.toISOString(),
    expiresAt: request.expiresAt,
    approvalThreshold: policy.minimumApprovals,
    distinctRoleThreshold: policy.minimumDistinctRoles,
    approvals: acceptedApprovals,
    oneTimeUseRequired: true,
    oneTimeUseEnforcedByThisReceipt: false,
    consumptionLedgerRequired: true,
    automaticExecutionAllowed: false,
    immediateAlertRequired: true,
    revokeAtExpiryOrEarlierRequired: true,
    touchedCredentialRotationRequired: true,
    postIncidentReviewRequired: true,
    secretValueIncluded: false,
  };
}

function loadJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function writeEvidence(relativePath, value) {
  const output = resolve(root, relativePath);
  if (!output.startsWith(`${root}/`)) throw new Error("evidence path must stay inside the repository");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command !== "authorize") {
      throw new Error("usage: security-break-glass.mjs authorize --request PATH --policy PATH --approval-files A,B --source-commit SHA --trusted-policy-sha256 DIGEST [--evidence PATH]");
    }
    const approvalFiles = requiredString(args["approval-files"], "approval-files")
      .split(",")
      .filter(Boolean);
    const result = authorizeBreakGlass({
      request: loadJson(args.request),
      policy: loadJson(args.policy),
      approvals: approvalFiles.map(loadJson),
      sourceCommit: args["source-commit"],
      trustedPolicySha256: args["trusted-policy-sha256"],
    });
    if (args.evidence) writeEvidence(args.evidence, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
