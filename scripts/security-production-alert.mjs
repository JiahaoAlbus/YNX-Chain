#!/usr/bin/env node
/**
 * Fail-closed delivery of production change alerts.
 *
 * The credential is supplied as a curl header file from the runtime Secret
 * Manager mount. Its value is read only to validate the single-header boundary;
 * it is never placed in argv, persisted in evidence, or included in an error.
 * The receiver must return a bounded receipt that proves acceptance of the
 * exact event digest and idempotency key.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectAwsManagedSecret,
  parseAwsManagerReference,
} from "./security-secret-manager.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const actions = new Set([
  "production-deployment",
  "production-blue-green-update",
  "production-manual-rollback",
]);
const responseFields = [
  "acceptedAt",
  "alertId",
  "eventDigestSha256",
  "idempotencyEnforced",
  "providerEventId",
  "schemaVersion",
  "status",
];
const secretMetadataFields = [
  "accessPolicy",
  "auditStatus",
  "backupStatus",
  "breakGlassPolicy",
  "class",
  "createdAt",
  "environment",
  "expiresAt",
  "id",
  "lastRotatedAt",
  "lastRotationEvidence",
  "managerReference",
  "nextRotationAt",
  "owner",
  "product",
  "provider",
  "purpose",
  "recoveryBoundary",
  "revocationStatus",
  "rotationPeriodDays",
  "rotationRunbook",
  "secretType",
  "storageLocation",
];
const secretInventoryFields = [
  "asOf",
  "blockedBy",
  "requiredSecretTypes",
  "schema",
  "schemaVersion",
  "secrets",
  "separationRules",
  "source",
  "status",
  "valueMaterialStored",
];

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
}

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) throw new Error(`${label} must be sha256`);
  return value;
}

function validDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validateEndpoint(endpoint, expectedHost) {
  if (
    typeof expectedHost !== "string"
    || expectedHost.length > 253
    || expectedHost === "localhost"
    || isIP(expectedHost) !== 0
    || !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(expectedHost)
  ) {
    throw new Error("production alert expected host must be a public DNS name");
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("production alert endpoint is invalid");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== expectedHost
    || (url.port !== "" && url.port !== "443")
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname === "/"
    || url.pathname.includes("//")
  ) {
    throw new Error("production alert endpoint is not an exact pinned HTTPS target");
  }
  return url.toString();
}

function validateCredentialHeaderFile(path) {
  if (
    typeof path !== "string"
    || !/^\/run\/secrets\/ynx\/[a-z0-9][a-z0-9._-]{2,127}$/.test(path)
  ) {
    throw new Error("production alert credential must be a named Secret Manager header mount");
  }
  return path;
}

function validateCredentialHeader(readFile, path) {
  let value;
  try {
    value = readFile(path, "utf8");
  } catch {
    throw new Error("production alert credential header read failed");
  }
  if (
    typeof value !== "string"
    || value.length < 43
    || value.length > 4096
    || !/^Authorization: Bearer [A-Za-z0-9._~+/=-]{20,4050}\n?$/.test(value)
  ) {
    throw new Error("production alert credential header boundary is invalid");
  }
  return value;
}

function validatePrivateMount(statFile, path, minimumSize, maximumSize, label) {
  let stat;
  try {
    stat = statFile(path);
  } catch {
    throw new Error(`${label} stat failed`);
  }
  if (
    typeof stat?.isFile !== "function"
    || !stat.isFile()
    || !Number.isInteger(stat.size)
    || stat.size < minimumSize
    || stat.size > maximumSize
    || !Number.isInteger(stat.mode)
    || (stat.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} must be a private regular Secret Manager mount`);
  }
}

function parseTime(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO timestamp`);
  return time;
}

function validateCredentialSecret(secret, credentialHeaderFile, expectedHost, checkedAt) {
  if (
    secret == null
    || typeof secret !== "object"
    || Array.isArray(secret)
    || Object.keys(secret).sort().join(",") !== secretMetadataFields.join(",")
    || secret.id !== "production-change-alert-delivery"
    || secret.class !== "provider"
    || secret.secretType !== "provider-credential"
    || typeof secret.owner !== "string"
    || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(secret.owner)
    || secret.product !== "30-security-platform"
    || secret.environment !== "production"
    || secret.purpose !== `production change alert delivery to ${expectedHost}`
    || secret.provider !== "aws-secrets-manager"
    || secret.storageLocation !== credentialHeaderFile
    || secret.revocationStatus !== "active"
    || secret.auditStatus !== "verified"
    || secret.backupStatus !== "prohibited"
    || typeof secret.breakGlassPolicy !== "string"
    || secret.breakGlassPolicy.length < 3
    || typeof secret.recoveryBoundary !== "string"
    || secret.recoveryBoundary.length < 3
    || !Number.isInteger(secret.rotationPeriodDays)
    || secret.rotationPeriodDays < 1
    || secret.rotationPeriodDays > 90
  ) {
    throw new Error("production alert credential inventory metadata is invalid");
  }
  const createdAt = parseTime(secret.createdAt, "credential createdAt");
  const lastRotatedAt = parseTime(secret.lastRotatedAt, "credential lastRotatedAt");
  const nextRotationAt = parseTime(secret.nextRotationAt, "credential nextRotationAt");
  const expiresAt = parseTime(secret.expiresAt, "credential expiresAt");
  if (
    createdAt > lastRotatedAt
    || lastRotatedAt > checkedAt.getTime()
    || nextRotationAt <= checkedAt.getTime()
    || nextRotationAt > expiresAt
    || nextRotationAt - lastRotatedAt > secret.rotationPeriodDays * 24 * 60 * 60 * 1000
  ) {
    throw new Error("production alert credential lifecycle is invalid");
  }
}

export function productionAlertSecretInventoryDigest(inventory) {
  return sha256(canonicalJson(inventory));
}

function selectCredentialSecret(inventory, trustedInventorySha256, checkedAt) {
  digest(trustedInventorySha256, "trusted production alert secret inventory digest");
  const inventoryAsOf = Date.parse(inventory?.asOf);
  if (
    inventory == null
    || typeof inventory !== "object"
    || Array.isArray(inventory)
    || Object.keys(inventory).sort().join(",") !== secretInventoryFields.join(",")
    || inventory.schemaVersion !== 1
    || inventory.schema !== "security-platform/secret-inventory.schema.json"
    || typeof inventory.source !== "string"
    || inventory.source.length < 3
    || !["partial", "configured"].includes(inventory.status)
    || inventory.valueMaterialStored !== false
    || !Array.isArray(inventory.secrets)
    || !Number.isFinite(inventoryAsOf)
    || inventoryAsOf > checkedAt.getTime() + 60_000
    || checkedAt.getTime() - inventoryAsOf > 90 * 24 * 60 * 60 * 1000
    || productionAlertSecretInventoryDigest(inventory) !== trustedInventorySha256
  ) {
    throw new Error("production alert secret inventory is not trusted and current");
  }
  const matches = inventory.secrets.filter((entry) => entry?.id === "production-change-alert-delivery");
  if (
    matches.length !== 1
    || new Set(inventory.secrets.map((entry) => entry?.id)).size !== inventory.secrets.length
  ) {
    throw new Error("production alert secret is not unique in the trusted inventory");
  }
  return {
    secret: matches[0],
    inventoryAsOf: new Date(inventoryAsOf).toISOString(),
  };
}

export function bindProductionAlertCredential({
  secretInventory,
  trustedSecretInventorySha256,
  sourceCommit,
  expectedHost,
  credentialHeaderFile,
  credentialVersionFile,
  checkedAt,
  inspectSecret = inspectAwsManagedSecret,
  execFile = execFileSync,
  readFile = readFileSync,
  statFile = statSync,
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("production alert credential sourceCommit must be a full Git SHA");
  }
  if (
    typeof inspectSecret !== "function"
    || typeof execFile !== "function"
    || typeof readFile !== "function"
    || typeof statFile !== "function"
  ) {
    throw new Error("production alert credential runtime dependencies are invalid");
  }
  const current = validDate(checkedAt, "production alert credential check time");
  const selected = selectCredentialSecret(
    secretInventory,
    trustedSecretInventorySha256,
    current,
  );
  const { secret } = selected;
  const headerPath = validateCredentialHeaderFile(credentialHeaderFile);
  if (credentialVersionFile !== `${headerPath}.version-id`) {
    throw new Error("production alert credential version mount is not adjacent to the header");
  }
  validateCredentialSecret(secret, headerPath, expectedHost, current);
  validatePrivateMount(statFile, headerPath, 43, 4096, "production alert credential header");
  validatePrivateMount(statFile, credentialVersionFile, 32, 65, "production alert credential version");
  validateCredentialHeader(readFile, headerPath);
  let mountedVersion;
  try {
    mountedVersion = readFile(credentialVersionFile, "utf8").trim();
  } catch {
    throw new Error("production alert credential version read failed");
  }
  if (!/^[A-Za-z0-9-]{32,64}$/.test(mountedVersion)) {
    throw new Error("production alert mounted version is invalid");
  }
  const reference = parseAwsManagerReference(secret.managerReference);
  const inspection = inspectSecret({
    secret,
    sourceCommit,
    now: () => current,
    execFile,
  });
  if (
    inspection?.schemaVersion !== 1
    || inspection.action !== "secret-manager-metadata-inspection"
    || inspection.result !== "passed-manager-metadata"
    || inspection.sourceCommit !== sourceCommit
    || inspection.secretId !== secret.id
    || inspection.secretType !== secret.secretType
    || inspection.owner !== secret.owner
    || inspection.product !== secret.product
    || inspection.environment !== "production"
    || inspection.provider !== "aws-secrets-manager"
    || inspection.managerReferenceSha256 !== reference.referenceSha256
    || !/^[0-9a-f]{64}$/.test(inspection.kmsKeySha256 ?? "")
    || inspection.currentVersionSha256 !== sha256(mountedVersion)
    || inspection.rotationEnabled !== true
    || inspection.nextRotationAt !== secret.nextRotationAt
    || inspection.deletionScheduled !== false
    || inspection.secretValueRequested !== false
    || inspection.secretValueRecorded !== false
    || inspection.asOf !== current.toISOString()
    || !Array.isArray(inspection.requiredTagBindingsVerified)
    || inspection.requiredTagBindingsVerified.sort().join(",") !== [
      "ynx:environment",
      "ynx:owner",
      "ynx:product",
      "ynx:purpose",
    ].join(",")
  ) {
    throw new Error("production alert credential does not bind inventory, provider, and mount");
  }
  const binding = {
    schemaVersion: 1,
    secretId: secret.id,
    secretInventorySha256: trustedSecretInventorySha256,
    secretInventoryAsOf: selected.inventoryAsOf,
    owner: secret.owner,
    provider: secret.provider,
    managerReferenceSha256: inspection.managerReferenceSha256,
    kmsKeySha256: inspection.kmsKeySha256,
    currentVersionSha256: inspection.currentVersionSha256,
    mountPathSha256: sha256(headerPath),
    providerHostSha256: sha256(expectedHost),
    inspectedAt: inspection.asOf,
    rotationEnabled: true,
    nextRotationAt: inspection.nextRotationAt,
    privateMountVerified: true,
    secretValueRecorded: false,
    bound: true,
  };
  const identity = {
    secretId: binding.secretId,
    secretInventorySha256: binding.secretInventorySha256,
    managerReferenceSha256: binding.managerReferenceSha256,
    kmsKeySha256: binding.kmsKeySha256,
    currentVersionSha256: binding.currentVersionSha256,
    mountPathSha256: binding.mountPathSha256,
    providerHostSha256: binding.providerHostSha256,
  };
  return {
    ...binding,
    credentialIdentitySha256: sha256(canonicalJson(identity)),
    bindingSha256: sha256(canonicalJson(binding)),
  };
}

export function preflightProductionAlertInputs({
  endpoint,
  expectedHost,
  credentialHeaderFile,
  credentialVersionFile,
  credentialSecretInventory,
  trustedCredentialSecretInventorySha256,
  sourceCommit,
  execFile = execFileSync,
  readFile = readFileSync,
  statFile = statSync,
  inspectSecret = inspectAwsManagedSecret,
  checkedAt = new Date(),
}) {
  const current = validDate(checkedAt, "production alert input preflight time");
  const target = validateEndpoint(endpoint, expectedHost);
  const credentialBinding = bindProductionAlertCredential({
    secretInventory: credentialSecretInventory,
    trustedSecretInventorySha256: trustedCredentialSecretInventorySha256,
    sourceCommit,
    expectedHost,
    credentialHeaderFile,
    credentialVersionFile,
    checkedAt: current,
    inspectSecret,
    execFile,
    readFile,
    statFile,
  });
  const receipt = {
    schemaVersion: 1,
    action: "production-change-alert-input-preflight",
    sourceCommit,
    asOf: current.toISOString(),
    endpointSha256: sha256(target),
    providerHostSha256: sha256(expectedHost),
    credentialBinding,
    providerMetadataInspected: true,
    secretValueRequested: false,
    alertDeliveryPerformed: false,
    productionMutationPerformed: false,
    ready: true,
  };
  return {
    ...receipt,
    receiptSha256: sha256(canonicalJson(receipt)),
  };
}

function runCurl(execFile, args, input) {
  try {
    return execFile("curl", args, {
      cwd: root,
      encoding: "utf8",
      input,
      maxBuffer: 64 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error("production change alert delivery failed");
  }
}

export function buildProductionChangeAlert({
  approval,
  operatorId,
  expectedClusterUid,
  createdAt,
}) {
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(expectedClusterUid, "expectedClusterUid");
  const timestamp = validDate(createdAt, "production alert creation time");
  if (
    approval?.bound !== true
    || approval.schemaVersion !== 1
    || approval.immediateAlertRequired !== true
    || !actions.has(approval.action)
  ) {
    throw new Error("production alert requires a bound alert-required approval");
  }
  safeIdentifier(approval.changeId, "changeId");
  digest(approval.authorizationId, "authorizationId");
  digest(approval.resourceReferenceSha256, "resourceReferenceSha256");
  const expiresAt = Date.parse(approval.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= timestamp.getTime()) {
    throw new Error("production alert approval is expired");
  }
  const alertId = sha256(`ynx-production-change-alert-v1\0${canonicalJson({
    action: approval.action,
    authorizationId: approval.authorizationId,
    changeId: approval.changeId,
    resourceReferenceSha256: approval.resourceReferenceSha256,
  })}`);
  const event = {
    schemaVersion: 1,
    eventType: "ynx.production.change.authorized",
    severity: approval.action === "production-manual-rollback" ? "critical" : "high",
    environment: "production",
    action: approval.action,
    alertId,
    changeId: approval.changeId,
    authorizationId: approval.authorizationId,
    authorizationType: approval.type,
    resourceReferenceSha256: approval.resourceReferenceSha256,
    operatorIdentity: operatorId,
    clusterUidSha256: sha256(expectedClusterUid),
    incidentId: approval.incidentId ?? null,
    createdAt: timestamp.toISOString(),
    authorizationExpiresAt: approval.expiresAt,
    secretValueIncluded: false,
  };
  return {
    event,
    eventDigestSha256: sha256(canonicalJson(event)),
  };
}

export function deliverProductionChangeAlert({
  approval,
  operatorId,
  expectedClusterUid,
  endpoint,
  expectedHost,
  credentialHeaderFile,
  credentialVersionFile,
  credentialSecretInventory,
  trustedCredentialSecretInventorySha256,
  sourceCommit,
  execFile = execFileSync,
  readFile = readFileSync,
  statFile = statSync,
  inspectSecret = inspectAwsManagedSecret,
  now = () => new Date(),
}) {
  if (
    typeof execFile !== "function"
    || typeof readFile !== "function"
    || typeof statFile !== "function"
    || typeof inspectSecret !== "function"
    || typeof now !== "function"
  ) {
    throw new Error("production alert runtime dependencies are invalid");
  }
  const target = validateEndpoint(endpoint, expectedHost);
  const startedAt = validDate(now(), "production alert dispatch start");
  const inputPreflight = preflightProductionAlertInputs({
    endpoint: target,
    expectedHost,
    credentialHeaderFile,
    credentialVersionFile,
    credentialSecretInventory,
    trustedCredentialSecretInventorySha256,
    sourceCommit,
    checkedAt: startedAt,
    inspectSecret,
    execFile,
    readFile,
    statFile,
  });
  const { credentialBinding } = inputPreflight;
  const alert = buildProductionChangeAlert({
    approval,
    operatorId,
    expectedClusterUid,
    createdAt: startedAt,
  });
  const credentialHeaderBeforeDelivery = validateCredentialHeader(
    readFile,
    credentialHeaderFile,
  );
  const output = runCurl(execFile, [
    "--silent",
    "--show-error",
    "--max-time", "10",
    "--connect-timeout", "5",
    "--proto", "=https",
    "--tlsv1.2",
    "--request", "POST",
    "--header", "Content-Type: application/json",
    "--header", "Accept: application/json",
    "--header", `Idempotency-Key: ${alert.event.alertId}`,
    "--header", `X-YNX-Event-SHA256: ${alert.eventDigestSha256}`,
    "--header", `@${credentialHeaderFile}`,
    "--data-binary", "@-",
    "--write-out", "\n%{http_code}",
    target,
  ], `${JSON.stringify(alert)}\n`);
  const credentialHeaderAfterDelivery = validateCredentialHeader(
    readFile,
    credentialHeaderFile,
  );
  let mountedVersionAfterDelivery;
  try {
    mountedVersionAfterDelivery = readFile(credentialVersionFile, "utf8").trim();
  } catch {
    throw new Error("production alert credential version read failed");
  }
  if (
    credentialHeaderAfterDelivery !== credentialHeaderBeforeDelivery
    || sha256(mountedVersionAfterDelivery) !== credentialBinding.currentVersionSha256
  ) {
    throw new Error("production alert credential mount changed during delivery");
  }
  const splitAt = output.lastIndexOf("\n");
  if (splitAt < 0 || output.slice(splitAt + 1).trim() !== "202") {
    throw new Error("production change alert was not accepted");
  }
  let receipt;
  try {
    receipt = JSON.parse(output.slice(0, splitAt));
  } catch {
    throw new Error("production change alert receipt is invalid JSON");
  }
  const completedAt = validDate(now(), "production alert dispatch completion");
  const acceptedAt = Date.parse(receipt?.acceptedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (
    receipt == null
    || typeof receipt !== "object"
    || Array.isArray(receipt)
    || Object.keys(receipt).sort().join(",") !== responseFields.join(",")
    || receipt.schemaVersion !== 1
    || receipt.status !== "accepted"
    || receipt.alertId !== alert.event.alertId
    || receipt.eventDigestSha256 !== alert.eventDigestSha256
    || receipt.idempotencyEnforced !== true
    || typeof receipt.providerEventId !== "string"
    || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(receipt.providerEventId)
    || !Number.isFinite(acceptedAt)
    || acceptedAt < startedAt.getTime() - 60_000
    || acceptedAt > completedAt.getTime() + 60_000
    || acceptedAt >= expiresAt
  ) {
    throw new Error("production change alert receipt does not bind the dispatched event");
  }
  return {
    schemaVersion: 1,
    alertId: alert.event.alertId,
    eventDigestSha256: alert.eventDigestSha256,
    providerHostSha256: sha256(expectedHost),
    providerEventIdSha256: sha256(receipt.providerEventId),
    acceptedAt: new Date(acceptedAt).toISOString(),
    idempotencyEnforced: true,
    inputPreflightSha256: inputPreflight.receiptSha256,
    credentialBinding,
    credentialSource: "direct provider metadata and private version-bound mount",
    secretValueIncluded: false,
    delivered: true,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command !== "preflight") {
      throw new Error("usage: security-production-alert.mjs preflight --endpoint URL --expected-host HOST --credential-header-file /run/secrets/ynx/NAME --credential-version-file /run/secrets/ynx/NAME.version-id --secret-inventory PATH --secret-inventory-sha256 SHA256 --source-commit SHA");
    }
    const result = preflightProductionAlertInputs({
      endpoint: args.endpoint,
      expectedHost: args["expected-host"],
      credentialHeaderFile: args["credential-header-file"],
      credentialVersionFile: args["credential-version-file"],
      credentialSecretInventory: JSON.parse(readFileSync(
        resolve(args["secret-inventory"]),
        "utf8",
      )),
      trustedCredentialSecretInventorySha256: args["secret-inventory-sha256"],
      sourceCommit: args["source-commit"],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
