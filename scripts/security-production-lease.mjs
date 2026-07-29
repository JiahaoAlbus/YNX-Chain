#!/usr/bin/env node
/**
 * Kubernetes Lease-backed mutex for production release mutations.
 *
 * Acquisition uses create-or-resourceVersion-replace, renewal and release use
 * compare-and-swap replacement, and release leaves an already-expired Lease so
 * no delete race can remove a successor holder.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const namespace = "default";
const leaseName = "ynx-production-release-lock";
const releasedHolder = "ynx-released";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
}

function validTime(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function runText(execFile, args, action, input) {
  try {
    return execFile("kubectl", args, {
      cwd: root,
      encoding: "utf8",
      input,
      maxBuffer: 1024 * 1024,
      stdio: input === undefined
        ? ["ignore", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`${action} failed`);
  }
}

function parseJson(output, action) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${action} returned invalid JSON`);
  }
}

function getLease(execFile, context) {
  const output = runText(execFile, [
    "--context", context,
    "get", "lease", leaseName,
    "-n", namespace,
    "--ignore-not-found=true",
    "-o", "json",
  ], "production Lease inspection");
  return output === "" ? null : parseJson(output, "production Lease inspection");
}

function leaseTimestamp(lease) {
  const value = lease.spec?.renewTime ?? lease.spec?.acquireTime;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("existing production Lease timestamp is invalid");
  return timestamp;
}

function leaseDuration(lease) {
  const value = lease.spec?.leaseDurationSeconds;
  if (!Number.isInteger(value) || value < 1 || value > 3600) {
    throw new Error("existing production Lease duration is invalid");
  }
  return value;
}

function isExpired(lease, at) {
  return leaseTimestamp(lease) + (leaseDuration(lease) * 1000) <= at.getTime();
}

function metadata(resourceVersion, action, changeId, holderIdentity) {
  return {
    name: leaseName,
    namespace,
    ...(resourceVersion === undefined ? {} : { resourceVersion }),
    labels: {
      "app.kubernetes.io/part-of": "ynx-security-platform",
      "security.ynx/purpose": "production-release-lock",
    },
    annotations: {
      "security.ynx/action": action,
      "security.ynx/change-id-sha256": sha256(changeId),
      "security.ynx/holder-sha256": sha256(holderIdentity),
    },
  };
}

function leaseDocument({
  resourceVersion,
  action,
  changeId,
  holderIdentity,
  acquiredAt,
  renewedAt,
  durationSeconds,
  transitions,
}) {
  return {
    apiVersion: "coordination.k8s.io/v1",
    kind: "Lease",
    metadata: metadata(resourceVersion, action, changeId, holderIdentity),
    spec: {
      holderIdentity,
      acquireTime: acquiredAt.toISOString(),
      renewTime: renewedAt.toISOString(),
      leaseDurationSeconds: durationSeconds,
      leaseTransitions: transitions,
    },
  };
}

function mutation(execFile, context, command, document, action) {
  const output = runText(execFile, [
    "--context", context,
    command,
    "-f", "-",
    "-o", "json",
  ], action, `${JSON.stringify(document)}\n`);
  if (output === "") throw new Error(`${action} returned no receipt`);
  return parseJson(output, action);
}

function validateReceipt(lease, holderIdentity, durationSeconds, action) {
  if (
    lease.apiVersion !== "coordination.k8s.io/v1"
    || lease.kind !== "Lease"
    || lease.metadata?.name !== leaseName
    || lease.metadata?.namespace !== namespace
    || typeof lease.metadata?.resourceVersion !== "string"
    || lease.metadata.resourceVersion === ""
    || lease.spec?.holderIdentity !== holderIdentity
    || lease.spec?.leaseDurationSeconds !== durationSeconds
  ) {
    throw new Error(`${action} receipt does not bind the requested Lease`);
  }
}

function publicReceipt(lease, acquiredAt, renewedAt, durationSeconds) {
  return {
    schemaVersion: 1,
    lock: `${namespace}/${leaseName}`,
    holderIdentitySha256: sha256(lease.spec.holderIdentity),
    resourceVersionSha256: sha256(lease.metadata.resourceVersion),
    acquiredAt: acquiredAt.toISOString(),
    renewedAt: renewedAt.toISOString(),
    expiresAt: new Date(renewedAt.getTime() + (durationSeconds * 1000)).toISOString(),
    leaseDurationSeconds: durationSeconds,
  };
}

export function acquireProductionLease({
  context,
  operatorId,
  changeId,
  action,
  durationSeconds = 600,
  execFile = execFileSync,
  now = () => new Date(),
  uuid = randomUUID,
}) {
  safeIdentifier(context, "context");
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(changeId, "changeId");
  safeIdentifier(action, "action");
  if (!Number.isInteger(durationSeconds) || durationSeconds < 300 || durationSeconds > 1800) {
    throw new Error("production Lease durationSeconds must be between 300 and 1800");
  }
  if (typeof execFile !== "function" || typeof now !== "function" || typeof uuid !== "function") {
    throw new Error("production Lease runtime dependencies are invalid");
  }
  const token = uuid();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error("production Lease token generator returned an invalid UUID");
  }
  const holderIdentity = `ynx:${operatorId}:${changeId}:${token}`;
  if (holderIdentity.length > 256) throw new Error("production Lease holder identity is too long");
  const acquiredAt = validTime(now(), "production Lease acquisition time");
  const existing = getLease(execFile, context);
  let accepted;
  if (existing === null) {
    accepted = mutation(execFile, context, "create", leaseDocument({
      action,
      changeId,
      holderIdentity,
      acquiredAt,
      renewedAt: acquiredAt,
      durationSeconds,
      transitions: 0,
    }), "production Lease creation");
  } else {
    if (!isExpired(existing, acquiredAt)) {
      throw new Error("production release mutation is locked by another active operator");
    }
    const resourceVersion = existing.metadata?.resourceVersion;
    if (typeof resourceVersion !== "string" || resourceVersion === "") {
      throw new Error("existing production Lease resourceVersion is invalid");
    }
    const transitions = Number(existing.spec?.leaseTransitions ?? 0);
    if (!Number.isInteger(transitions) || transitions < 0) {
      throw new Error("existing production Lease transition count is invalid");
    }
    accepted = mutation(execFile, context, "replace", leaseDocument({
      resourceVersion,
      action,
      changeId,
      holderIdentity,
      acquiredAt,
      renewedAt: acquiredAt,
      durationSeconds,
      transitions: transitions + 1,
    }), "expired production Lease takeover");
  }
  validateReceipt(accepted, holderIdentity, durationSeconds, "production Lease acquisition");
  let active = true;
  let resourceVersion = accepted.metadata.resourceVersion;
  let renewedAt = acquiredAt;

  function currentLease(actionLabel) {
    if (!active) throw new Error("production Lease is no longer active");
    const current = getLease(execFile, context);
    if (
      current === null
      || current.spec?.holderIdentity !== holderIdentity
      || current.metadata?.resourceVersion !== resourceVersion
    ) {
      throw new Error(`${actionLabel} lost production Lease ownership`);
    }
    return current;
  }

  return {
    receipt: publicReceipt(accepted, acquiredAt, renewedAt, durationSeconds),
    renew() {
      const renewed = validTime(now(), "production Lease renewal time");
      if (renewed.getTime() < renewedAt.getTime()) {
        throw new Error("production Lease renewal time moved backwards");
      }
      const current = currentLease("production Lease renewal");
      if (isExpired(current, renewed)) {
        throw new Error("production Lease expired before renewal");
      }
      const replacement = leaseDocument({
        resourceVersion: current.metadata.resourceVersion,
        action,
        changeId,
        holderIdentity,
        acquiredAt,
        renewedAt: renewed,
        durationSeconds,
        transitions: current.spec.leaseTransitions,
      });
      const acceptedRenewal = mutation(
        execFile,
        context,
        "replace",
        replacement,
        "production Lease renewal",
      );
      validateReceipt(acceptedRenewal, holderIdentity, durationSeconds, "production Lease renewal");
      resourceVersion = acceptedRenewal.metadata.resourceVersion;
      renewedAt = renewed;
      return publicReceipt(acceptedRenewal, acquiredAt, renewedAt, durationSeconds);
    },
    release() {
      const releasedAt = validTime(now(), "production Lease release time");
      if (releasedAt.getTime() < renewedAt.getTime()) {
        throw new Error("production Lease release time moved backwards");
      }
      const current = currentLease("production Lease release");
      if (isExpired(current, releasedAt)) {
        throw new Error("production Lease expired before release");
      }
      const expiredAt = new Date(releasedAt.getTime() - 2000);
      const replacement = leaseDocument({
        resourceVersion: current.metadata.resourceVersion,
        action: "released",
        changeId,
        holderIdentity: releasedHolder,
        acquiredAt,
        renewedAt: expiredAt,
        durationSeconds: 1,
        transitions: current.spec.leaseTransitions,
      });
      const acceptedRelease = mutation(
        execFile,
        context,
        "replace",
        replacement,
        "production Lease release",
      );
      validateReceipt(acceptedRelease, releasedHolder, 1, "production Lease release");
      active = false;
      return {
        releasedAt: releasedAt.toISOString(),
        lock: `${namespace}/${leaseName}`,
        releasedHolderSha256: sha256(releasedHolder),
        resourceVersionSha256: sha256(acceptedRelease.metadata.resourceVersion),
        expired: isExpired(acceptedRelease, releasedAt),
      };
    },
  };
}
