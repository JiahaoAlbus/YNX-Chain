#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyManifestSignature } from "./security-artifact.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function fail(errors, message) {
  errors.push(message);
}

export function verifyTruthRecord(policy, record) {
  const errors = [];
  for (const field of policy.requiredTruthStates) {
    if (typeof record.states?.[field] !== "boolean") {
      fail(errors, `truth state ${field} must be boolean`);
      continue;
    }
    if (record.states[field] === true) {
      const evidence = record.evidence?.[field];
      if (!Array.isArray(evidence) || evidence.length === 0) {
        fail(errors, `truth state ${field}=true requires evidence`);
      }
    }
  }
  for (const field of Object.keys(record.states ?? {})) {
    if (!policy.requiredTruthStates.includes(field)) {
      fail(errors, `unknown truth state ${field}`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(record.sourceCommit ?? "")) {
    fail(errors, "sourceCommit must be a full Git SHA");
  }
  return errors;
}

export function verifyArtifactRegistry(policy, registry, filesystemRoot = root, verificationTime = new Date()) {
  const errors = [];
  const ids = new Set();
  for (const artifact of registry.artifacts ?? []) {
    if (!artifact.id || ids.has(artifact.id)) fail(errors, `artifact id is missing or duplicated: ${artifact.id ?? ""}`);
    ids.add(artifact.id);
    if (!policy.artifactKinds.includes(artifact.kind)) fail(errors, `artifact ${artifact.id}: invalid kind`);
    if (!/^[0-9a-f]{40}$/.test(artifact.sourceCommit ?? "")) fail(errors, `artifact ${artifact.id}: invalid sourceCommit`);
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")) fail(errors, `artifact ${artifact.id}: invalid sha256`);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) fail(errors, `artifact ${artifact.id}: invalid bytes`);
    if (!policy.signingClasses.includes(artifact.signingClass)) fail(errors, `artifact ${artifact.id}: invalid signingClass`);
    for (const field of ["buildRun", "sbom", "provenance", "minimumOs", "installEvidence", "revocation", "expiry"]) {
      if (typeof artifact[field] !== "string" || artifact[field].trim() === "") fail(errors, `artifact ${artifact.id}: missing ${field}`);
    }
    if (artifact.path) {
      const path = resolve(filesystemRoot, artifact.path);
      try {
        const bytes = statSync(path).size;
        const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
        if (bytes !== artifact.bytes) fail(errors, `artifact ${artifact.id}: byte count mismatch`);
        if (digest !== artifact.sha256) fail(errors, `artifact ${artifact.id}: digest mismatch`);
      } catch {
        fail(errors, `artifact ${artifact.id}: local path cannot be verified`);
      }
    }

    const legacyBlocked = Boolean(artifact.revokedAt) && artifact.verificationStatus === "blocked-unverifiable-legacy";
    if (legacyBlocked) {
      for (const field of ["revocationReason", "verificationBlocker"]) {
        if (typeof artifact[field] !== "string" || artifact[field].trim() === "") fail(errors, `artifact ${artifact.id}: legacy block missing ${field}`);
      }
      if (artifact.publicReleaseEligible !== false) fail(errors, `artifact ${artifact.id}: unverifiable legacy artifact must not be public-release eligible`);
      continue;
    }

    if (artifact.signingClass !== "unsigned-local") {
      for (const field of ["manifest", "signature", "verificationStatus", "publicKeyFingerprint"]) {
        if (typeof artifact[field] !== "string" || artifact[field].trim() === "") fail(errors, `artifact ${artifact.id}: signed artifact missing ${field}`);
      }
      if (artifact.manifest && artifact.signature) {
        try {
          const result = verifyManifestSignature({
            manifestPath: resolve(filesystemRoot, artifact.manifest),
            signaturePath: resolve(filesystemRoot, artifact.signature),
            trustedFingerprints: artifact.publicKeyFingerprint ? [artifact.publicKeyFingerprint] : [],
            now: verificationTime,
          });
          if (result.signingClass !== artifact.signingClass) fail(errors, `artifact ${artifact.id}: signing class mismatch`);
          const manifest = JSON.parse(readFileSync(resolve(filesystemRoot, artifact.manifest), "utf8"));
          const manifestDigest = manifest.artifact?.sha256 ?? manifest.sha256;
          const manifestBytes = manifest.artifact?.bytes ?? manifest.bytes;
          if (manifestDigest !== artifact.sha256 || manifestBytes !== artifact.bytes || manifest.sourceCommit !== artifact.sourceCommit) {
            fail(errors, `artifact ${artifact.id}: signed manifest does not match registry`);
          }
          if (manifest.signing?.class && manifest.signing.class !== artifact.signingClass) fail(errors, `artifact ${artifact.id}: manifest signing class mismatch`);
          if (manifest.signing?.publicKeyFingerprint && manifest.signing.publicKeyFingerprint !== artifact.publicKeyFingerprint) {
            fail(errors, `artifact ${artifact.id}: manifest signer fingerprint mismatch`);
          }
          const sbomBytes = readFileSync(resolve(filesystemRoot, artifact.sbom));
          const provenanceBytes = readFileSync(resolve(filesystemRoot, artifact.provenance));
          if (createHash("sha256").update(sbomBytes).digest("hex") !== manifest.sbom?.sha256) fail(errors, `artifact ${artifact.id}: SBOM digest mismatch`);
          if (createHash("sha256").update(provenanceBytes).digest("hex") !== manifest.provenance?.sha256) fail(errors, `artifact ${artifact.id}: provenance digest mismatch`);
          const sbom = JSON.parse(sbomBytes.toString("utf8"));
          const provenance = JSON.parse(provenanceBytes.toString("utf8"));
          if (sbom.bomFormat !== "CycloneDX" || sbom.metadata?.properties?.[0]?.value !== artifact.sourceCommit) fail(errors, `artifact ${artifact.id}: SBOM source identity mismatch`);
          if (provenance.subject?.[0]?.digest?.sha256 !== artifact.sha256) fail(errors, `artifact ${artifact.id}: provenance subject mismatch`);
        } catch (error) {
          fail(errors, `artifact ${artifact.id}: signature verification failed: ${error.message}`);
        }
      }
    }
  }
  return errors;
}

export function verifySecretInventory(policy, inventory) {
  const errors = [];
  const ids = new Set();
  const requiredTypes = new Set([
    "validator-key", "faucet-key", "deploy-key", "treasury-key", "provider-credential", "database-credential",
    "api-credential", "artifact-signing-key", "mobile-signing-key", "tls-key", "backup-encryption-key", "recovery-key",
  ]);
  const configuredTypes = new Set(inventory.requiredSecretTypes ?? []);
  if (inventory.valueMaterialStored !== false) fail(errors, "secret inventory must assert valueMaterialStored=false");
  for (const type of requiredTypes) if (!configuredTypes.has(type)) fail(errors, `secret inventory is missing required type ${type}`);
  for (const type of configuredTypes) if (!requiredTypes.has(type)) fail(errors, `secret inventory has unknown required type ${type}`);
  if ((inventory.secrets ?? []).length === 0 && inventory.status !== "not-configured") {
    fail(errors, "empty secret inventory must remain status=not-configured");
  }
  for (const secret of inventory.secrets ?? []) {
    if (!secret.id || ids.has(secret.id)) fail(errors, `secret id is missing or duplicated: ${secret.id ?? ""}`);
    ids.add(secret.id);
    if (!policy.secretClasses.includes(secret.class)) fail(errors, `secret ${secret.id}: invalid class`);
    for (const field of [
      "secretType", "owner", "product", "environment", "purpose", "provider", "managerReference", "storageLocation",
      "accessPolicy", "createdAt", "expiresAt", "lastRotatedAt", "nextRotationAt", "revocationStatus", "breakGlassPolicy",
      "auditStatus", "backupStatus", "recoveryBoundary", "rotationRunbook", "lastRotationEvidence",
    ]) {
      if (typeof secret[field] !== "string" || secret[field].trim() === "") fail(errors, `secret ${secret.id}: missing ${field}`);
    }
    if (!Number.isInteger(secret.rotationPeriodDays) || secret.rotationPeriodDays < 1 || secret.rotationPeriodDays > 730) {
      fail(errors, `secret ${secret.id}: invalid rotationPeriodDays`);
    }
    const serialized = JSON.stringify(secret);
    if (/privateKey|seedPhrase|mnemonic|secretValue|credentialValue/i.test(serialized)) {
      fail(errors, `secret ${secret.id}: inventory contains forbidden value-bearing field`);
    }
  }
  return errors;
}

export function verifyProductRelease(release, registry) {
  const errors = [];
  const artifacts = new Map((registry.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  const selected = [];
  for (const id of release.artifacts ?? []) {
    const artifact = artifacts.get(id);
    if (!artifact) {
      fail(errors, `release references unknown artifact ${id}`);
      continue;
    }
    selected.push(artifact);
    if (artifact.revokedAt) fail(errors, `release references revoked artifact ${id}`);
    if (artifact.sourceCommit !== release.sourceCommit) fail(errors, `release artifact ${id} source commit mismatch`);
    if (typeof artifact.publicReleaseEligible !== "boolean") fail(errors, `release artifact ${id} has ambiguous public eligibility`);
  }
  if (release.productionSigned === true && (selected.length === 0 || selected.some((artifact) => artifact.signingClass !== "production-signed"))) {
    fail(errors, "productionSigned=true requires only production-signed artifacts");
  }
  if (release.deployedPublic === true && (typeof release.releasedAt !== "string" || release.releasedAt.trim() === "")) {
    fail(errors, "deployedPublic=true requires releasedAt");
  }
  if (!/^[0-9a-f]{40}$/.test(release.sourceCommit ?? "")) fail(errors, "release sourceCommit must be a full Git SHA");
  return errors;
}

export function verifyCompletionAudit(audit) {
  const errors = [];
  const allowed = new Set(["proven", "partial", "contradicted", "missing", "not-applicable"]);
  const items = audit.requirements ?? [];
  const ids = new Set();
  if (items.length !== 22) fail(errors, `completion audit must contain 22 constitutional requirements, found ${items.length}`);
  for (const item of items) {
    if (!Number.isInteger(item.id) || item.id < 1 || item.id > 22 || ids.has(item.id)) fail(errors, `completion audit has invalid or duplicate id ${item.id}`);
    ids.add(item.id);
    if (!allowed.has(item.status)) fail(errors, `completion audit ${item.id}: invalid status`);
    if (typeof item.requirement !== "string" || item.requirement.trim() === "") fail(errors, `completion audit ${item.id}: missing requirement`);
    if (["proven", "partial", "contradicted"].includes(item.status) && (!Array.isArray(item.evidence) || item.evidence.length === 0)) {
      fail(errors, `completion audit ${item.id}: ${item.status} requires evidence`);
    }
    if (["partial", "contradicted", "missing"].includes(item.status) && (!Array.isArray(item.missingEvidence) || item.missingEvidence.length === 0)) {
      fail(errors, `completion audit ${item.id}: ${item.status} requires missingEvidence`);
    }
    if (item.status === "proven" && Array.isArray(item.missingEvidence) && item.missingEvidence.length > 0) fail(errors, `completion audit ${item.id}: proven cannot retain missingEvidence`);
  }
  for (let id = 1; id <= 22; id += 1) if (!ids.has(id)) fail(errors, `completion audit missing id ${id}`);
  return errors;
}

export function verifyExerciseMatrix(matrix) {
  const errors = [];
  const required = [
    "secret-rotation", "compromised-service", "artifact-tamper", "ddos", "region-failure", "database-loss",
    "object-loss", "ci-supply-chain-failure", "backup-restore", "rollback", "search-noindex-incident",
    "quant-worker-escape-attempt", "public-security-evidence",
  ];
  const allowed = new Set(["passed-local", "passed-remote", "partial", "failed", "not-run"]);
  const exercises = new Map((matrix.exercises ?? []).map((item) => [item.id, item]));
  for (const id of required) {
    const item = exercises.get(id);
    if (!item) { fail(errors, `exercise matrix missing ${id}`); continue; }
    if (!allowed.has(item.status)) fail(errors, `exercise ${id}: invalid status`);
    if (["passed-local", "passed-remote", "partial", "failed"].includes(item.status) && (!Array.isArray(item.evidence) || item.evidence.length === 0)) {
      fail(errors, `exercise ${id}: ${item.status} requires evidence`);
    }
    if (item.status === "not-run" && (typeof item.nextAction !== "string" || item.nextAction.trim() === "")) fail(errors, `exercise ${id}: not-run requires nextAction`);
  }
  for (const id of exercises.keys()) if (!required.includes(id)) fail(errors, `exercise matrix has unknown exercise ${id}`);
  return errors;
}

export function verifyKpiFramework(framework) {
  const errors = [];
  const required = [
    "activation", "retention-7d", "retention-30d", "task-completion", "crash-free-session", "support-load",
    "abuse-rate", "provider-cost", "gross-margin-candidate", "public-testnet-usage", "conversion", "kill-scale-decision",
  ];
  const metrics = new Map((framework.metrics ?? []).map((item) => [item.id, item]));
  for (const id of required) {
    const metric = metrics.get(id);
    if (!metric) { fail(errors, `KPI framework missing ${id}`); continue; }
    for (const field of ["definition", "formula", "window", "source", "owner"]) {
      if (typeof metric[field] !== "string" || metric[field].trim() === "") fail(errors, `KPI ${id}: missing ${field}`);
    }
    if (!new Set(["unmeasured", "measured"]).has(metric.status)) fail(errors, `KPI ${id}: invalid status`);
    if (metric.status === "unmeasured" && metric.currentValue !== null) fail(errors, `KPI ${id}: unmeasured value must be null`);
    if (metric.status === "measured" && (metric.currentValue === null || !metric.evidence)) fail(errors, `KPI ${id}: measured requires value and evidence`);
  }
  for (const id of metrics.keys()) if (!required.includes(id)) fail(errors, `KPI framework has unknown metric ${id}`);
  return errors;
}

export function verifyCapacityEvidence(evidence) {
  const errors = [];
  const required = ["policyGate", "signatureVerify", "encryptedBackupCreate", "encryptedBackupRestore"];
  if (!/^[0-9a-f]{40}$/.test(evidence.sourceCommit ?? "")) fail(errors, "capacity evidence sourceCommit must be a full Git SHA");
  if (typeof evidence.coverage !== "string" || !evidence.coverage.includes("not public capacity evidence")) fail(errors, "capacity evidence must retain its local-only limitation");
  for (const id of required) {
    const metric = evidence.measurements?.[id];
    if (!metric) { fail(errors, `capacity evidence missing ${id}`); continue; }
    if (!Number.isInteger(metric.samples) || metric.samples < 1) fail(errors, `capacity ${id}: invalid sample count`);
    if (![metric.p50, metric.p95, metric.p99, metric.mean, metric.throughputPerSecond].every((value) => Number.isFinite(value) && value >= 0)) fail(errors, `capacity ${id}: invalid numeric measurement`);
    if (!(metric.p50 <= metric.p95 && metric.p95 <= metric.p99)) fail(errors, `capacity ${id}: percentile ordering invalid`);
    if (metric.errors !== 0) fail(errors, `capacity ${id}: benchmark contains errors`);
  }
  return errors;
}

export function verifyProviderInventory(inventory) {
  const errors = [];
  const ids = new Set();
  const reviewStates = new Set(["reviewed", "not-reviewed", "not-applicable"]);
  for (const provider of inventory.providers ?? []) {
    if (!provider.id || ids.has(provider.id)) fail(errors, `provider id is missing or duplicated: ${provider.id ?? ""}`);
    ids.add(provider.id);
    for (const field of ["name", "authority", "authentication", "rateLimit", "dataRetention", "dataRights", "version", "health", "fallback", "outageBehavior"]) {
      if (typeof provider[field] !== "string" || provider[field].trim() === "") fail(errors, `provider ${provider.id}: missing ${field}`);
    }
    for (const field of ["licenseReview", "termsReview", "jurisdictionReview"]) {
      if (!reviewStates.has(provider[field])) fail(errors, `provider ${provider.id}: invalid ${field}`);
    }
    if (provider.credential || provider.secret || provider.token) fail(errors, `provider ${provider.id}: inventory must not contain credential values`);
  }
  if (ids.size === 0) fail(errors, "provider inventory must not be empty");
  return errors;
}

export function scanTrackedFiles(policy, files = trackedFiles()) {
  const errors = [];
  const pathPatterns = policy.prohibitedTrackedFilePatterns.map((value) => new RegExp(value));
  const contentPatterns = policy.prohibitedContentPatterns.map((value) => new RegExp(value, "i"));
  const exemptPrefixes = policy.contentScanExemptPrefixes ?? [];
  const exemptFiles = new Set(policy.contentScanExemptFiles ?? []);
  for (const relativePath of files) {
    if (pathPatterns.some((pattern) => pattern.test(relativePath))) {
      fail(errors, `prohibited tracked file: ${relativePath}`);
      continue;
    }
    if (exemptFiles.has(relativePath) || exemptPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue;
    const path = resolve(root, relativePath);
    let content;
    try {
      if (statSync(path).size > 2_000_000) continue;
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (contentPatterns.some((pattern) => pattern.test(content))) fail(errors, `secret-like content: ${relativePath}`);
  }
  return errors;
}

export function verify() {
  const policy = load("security-platform/platform-policy.json");
  const registry = load("release/security-platform/artifact-registry.json");
  const errors = [
    ...verifyTruthRecord(policy, load("release/security-platform/platform-status.json")),
    ...verifyArtifactRegistry(policy, registry),
    ...verifyProductRelease(load("release/security-platform/product-release.json"), registry),
    ...verifyCompletionAudit(load("release/security-platform/completion-audit.json")),
    ...verifyExerciseMatrix(load("security-platform/exercises.json")),
    ...verifyKpiFramework(load("security-platform/kpis.json")),
    ...verifyCapacityEvidence(load("evidence/security-platform/LOCAL_CAPACITY_2026-07-22.json")),
    ...verifyProviderInventory(load("security-platform/providers.json")),
    ...verifySecretInventory(policy, load("security-platform/secret-inventory.json")),
    ...scanTrackedFiles(policy),
  ];
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("PASS security platform policy, truth, artifacts, secret metadata, and tracked-file gates\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "verify") {
    process.stderr.write("usage: node scripts/security-platform.mjs verify\n");
    process.exitCode = 2;
  } else {
    verify();
  }
}
