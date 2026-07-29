#!/usr/bin/env node
/**
 * Operator-controlled production blue-green update.
 *
 * Both the active and candidate releases must pass the production signature
 * verifier. The active release is additionally pinned to a successful public
 * deployment receipt. A separate green quant-worker is observed before the
 * complete signed candidate manifest is reconciled. Any failure after cutover
 * starts restores and verifies the pinned active manifest.
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
  verifyProductionPublicEndpoints,
  verifyProductionReadiness,
} from "./security-production-deploy.mjs";
import {
  bindProductionReleaseApproval,
  consumeProductionApproval,
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
const stableDeployment = "quant-worker";
const greenDeployment = "quant-worker-green";
const productionFieldManager = "ynx-security-platform-production";
const greenFieldManager = "ynx-security-platform-production-green";

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

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) throw new Error(`${label} must be sha256`);
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

function runJson(execFile, command, args, action) {
  const output = runText(execFile, command, args, action);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${action} returned invalid JSON`);
  }
}

function writeEvidence(relativePath, value) {
  const output = repositoryPath(relativePath, "evidencePath");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function readPinnedProductionEvidence(relativePath, expectedSha256, label = "deployment") {
  digest(expectedSha256, `${label}EvidenceSha256`);
  let bytes;
  try {
    bytes = readFileSync(repositoryPath(relativePath, `${label}EvidencePath`));
  } catch {
    throw new Error(`${label} production evidence read failed`);
  }
  if (sha256(bytes) !== expectedSha256) throw new Error(`${label} production evidence digest mismatch`);
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error(`${label} production evidence is invalid JSON`);
  }
  return { value, sha256: expectedSha256 };
}

function quantWorkerReference(release, label) {
  const matches = (release.attestation?.images ?? []).filter((image) => image.role === "quant-worker");
  if (matches.length !== 1 || !/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(matches[0].reference ?? "")) {
    throw new Error(`${label} release must bind one immutable quant-worker image`);
  }
  return matches[0].reference;
}

export function validateSignedProductionBundle(release, label) {
  if (
    release?.receipt?.productionSigned !== true
    || release.receipt.deployedPublic !== false
    || typeof release.receipt.sourceCommit !== "string"
    || typeof release.receipt.version !== "string"
    || typeof release.receipt.productionManifestSha256 !== "string"
    || typeof release.receipt.publicProbePolicySha256 !== "string"
    || typeof release.manifest !== "string"
    || release.manifest.trim() === ""
    || release.attestation == null
    || release.publicProbePolicy == null
  ) {
    throw new Error(`${label} release verification did not return a signed deployable bundle`);
  }
  return release;
}

export function validateProductionDeploymentEvidence(
  pinned,
  release,
  context,
  expectedClusterUid,
  label = "stable",
) {
  const evidence = pinned.value;
  const validAction = evidence.action === "production-deployment"
    || evidence.action === "production-blue-green-update"
    || evidence.action === "production-manual-rollback";
  if (
    !validAction
    || evidence.state !== "deployed-public-verified"
    || evidence.productionSigned !== true
    || evidence.deployedPublic !== true
    || evidence.mutationPerformed !== true
    || evidence.productionLeaseReleased !== true
    || evidence.operatorAuthorization?.pass !== true
    || evidence.changeApproval?.bound !== true
    || evidence.approvalConsumption?.consumed !== true
    || evidence.alertDelivery?.delivered !== true
    || evidence.alertInputPreflight?.ready !== true
    || evidence.readiness?.pass !== true
    || evidence.publicProbes?.pass !== true
    || evidence.sourceCommit !== release.receipt.sourceCommit
    || evidence.version !== release.receipt.version
    || evidence.productionManifestSha256 !== release.receipt.productionManifestSha256
    || evidence.publicProbePolicySha256 !== release.receipt.publicProbePolicySha256
    || evidence.contextSha256 !== sha256(context)
    || evidence.clusterUidSha256 !== sha256(expectedClusterUid)
  ) {
    throw new Error(`${label} production evidence does not bind the signed release and cluster`);
  }
}

function manifestDocuments(manifest) {
  return manifest.split(/^---\s*$/m).filter((document) => document.trim());
}

export function productionManifestInventory(manifest, label) {
  const identities = manifestDocuments(manifest).map((document) => {
    const kind = document.match(/^kind:\s*([A-Za-z0-9.]+)\s*$/m)?.[1];
    const lines = document.split("\n");
    const metadataStart = lines.findIndex((line) => line === "metadata:");
    if (kind === undefined || metadataStart === -1) {
      throw new Error(`${label} manifest contains a resource without kind or metadata`);
    }
    let name;
    let resourceNamespace = "";
    for (let index = metadataStart + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line !== "" && !line.startsWith(" ")) break;
      if (/^  name:\s*\S+\s*$/.test(line)) name = line.replace(/^  name:\s*/, "").trim();
      if (/^  namespace:\s*\S+\s*$/.test(line)) {
        resourceNamespace = line.replace(/^  namespace:\s*/, "").trim();
      }
    }
    if (name === undefined) throw new Error(`${label} manifest contains a resource without metadata.name`);
    return `${kind}/${resourceNamespace}/${name}`;
  }).sort();
  if (new Set(identities).size !== identities.length) {
    throw new Error(`${label} manifest contains duplicate resource identities`);
  }
  return identities;
}

export function buildProductionGreenManifest(candidateManifest, candidateRelease) {
  const expectedImage = quantWorkerReference(candidateRelease, "candidate");
  const deployments = manifestDocuments(candidateManifest).filter((document) => (
    /^kind:\s*Deployment$/m.test(document)
    && /\n  name:\s*quant-worker\s*$/m.test(document)
  ));
  if (deployments.length !== 1) {
    throw new Error("candidate manifest must contain exactly one quant-worker Deployment");
  }
  let green = deployments[0];
  const metadataName = /(\nmetadata:\n[\s\S]*?\n  name:) quant-worker(\n)/;
  if (!metadataName.test(green)) throw new Error("candidate quant-worker metadata name is ambiguous");
  green = green.replace(metadataName, `$1 ${greenDeployment}$2`);
  const appLabels = green.match(/\bapp:\s*quant-worker\b/g) ?? [];
  if (appLabels.length !== 3) throw new Error("candidate quant-worker selectors are not in the expected shape");
  green = green.replaceAll("app: quant-worker", `app: ${greenDeployment}`);
  const topLabels = /\nmetadata:\n  labels:\n/;
  const podLabels = /\n    metadata:\n      labels:\n/;
  if (!topLabels.test(green) || !podLabels.test(green)) {
    throw new Error("candidate quant-worker label blocks are missing");
  }
  green = green
    .replace(topLabels, "\nmetadata:\n  labels:\n    security.ynx/release-track: green\n")
    .replace(podLabels, "\n    metadata:\n      labels:\n        security.ynx/release-track: green\n");
  const images = [...green.matchAll(/\n\s*(?:-\s*)?image:\s*([^\s]+)/g)].map((match) => match[1]);
  if (images.length !== 1 || images[0] !== expectedImage) {
    throw new Error("green deployment image does not match the signed candidate");
  }
  if (
    !new RegExp(`security\\.ynx/source-commit:\\s*${candidateRelease.receipt.sourceCommit}\\b`).test(green)
    || !/\n\s*replicas:\s*3\b/.test(green)
    || !/\n\s*runAsNonRoot:\s*true\b/.test(green)
    || !/\n\s*allowPrivilegeEscalation:\s*false\b/.test(green)
    || !/\n\s*readOnlyRootFilesystem:\s*true\b/.test(green)
    || !/\n\s*drop:\s*\n\s*- ALL\b/.test(green)
  ) {
    throw new Error("green deployment security or release binding is incomplete");
  }
  return `${green.trim()}\n`;
}

export function inspectLiveProductionRelease(execFile, context, expectedClusterUid, release) {
  safeIdentifier(context, "context");
  safeIdentifier(expectedClusterUid, "expectedClusterUid");
  const currentContext = runText(
    execFile,
    "kubectl",
    ["config", "current-context"],
    "Kubernetes current-context inspection",
  );
  if (currentContext !== context) throw new Error("active Kubernetes context does not match the acknowledged context");
  const systemNamespace = runJson(execFile, "kubectl", [
    "--context", context, "get", "namespace", "kube-system", "-o", "json",
  ], "Kubernetes cluster identity inspection");
  if (systemNamespace.metadata?.uid !== expectedClusterUid) {
    throw new Error("kube-system UID does not match the acknowledged production cluster");
  }
  const server = runJson(execFile, "kubectl", [
    "--context", context, "version", "-o", "json",
  ], "Kubernetes server version inspection");
  if (typeof server.serverVersion?.gitVersion !== "string") {
    throw new Error("Kubernetes server version is missing");
  }
  const deployment = runJson(execFile, "kubectl", [
    "--context", context, "get", "deployment", stableDeployment,
    "-n", namespace, "-o", "json",
  ], "active production deployment inspection");
  const containers = deployment.spec?.template?.spec?.containers ?? [];
  const replicas = Number(deployment.spec?.replicas ?? 0);
  if (
    deployment.metadata?.labels?.["security.ynx/source-commit"] !== release.receipt.sourceCommit
    || containers.length !== 1
    || containers[0].image !== quantWorkerReference(release, "active")
    || replicas < 3
    || Number(deployment.status?.observedGeneration ?? -1) < Number(deployment.metadata?.generation ?? 0)
    || Number(deployment.status?.availableReplicas ?? 0) < replicas
  ) {
    throw new Error("live production deployment does not match the signed active release");
  }
  return {
    serverVersion: server.serverVersion.gitVersion,
    replicas,
    stableImageDigest: containers[0].image.match(/@sha256:([0-9a-f]{64})$/)[1],
  };
}

function clusterPreflight(execFile, context, expectedClusterUid, stable, candidate) {
  const cluster = inspectLiveProductionRelease(execFile, context, expectedClusterUid, stable);
  if (quantWorkerReference(stable, "stable") === quantWorkerReference(candidate, "candidate")) {
    throw new Error("candidate quant-worker image must differ from the active release");
  }
  const existingGreen = runText(execFile, "kubectl", [
    "--context", context, "get", "deployment", greenDeployment,
    "-n", namespace, "--ignore-not-found=true", "-o", "json",
  ], "existing green deployment inspection");
  if (existingGreen !== "") throw new Error("a production green deployment already exists");
  return cluster;
}

function validateWindow(observationSeconds, sampleIntervalSeconds) {
  if (!Number.isInteger(observationSeconds) || observationSeconds < 60 || observationSeconds > 1800) {
    throw new Error("observationSeconds must be between 60 and 1800");
  }
  if (
    !Number.isInteger(sampleIntervalSeconds)
    || sampleIntervalSeconds < 10
    || sampleIntervalSeconds > 300
    || sampleIntervalSeconds > observationSeconds / 2
  ) {
    throw new Error("sampleIntervalSeconds must produce at least three bounded samples");
  }
  return Math.ceil(observationSeconds / sampleIntervalSeconds) + 1;
}

export function preflightProductionBlueGreen({
  stableReleaseOptions,
  candidateReleaseOptions,
  stableEvidencePath,
  stableEvidenceSha256,
  context,
  expectedClusterUid,
  observationSeconds = 300,
  sampleIntervalSeconds = 30,
  execFile = execFileSync,
  verifyRelease = verifyProductionReleaseBundle,
  authorize = verifyProductionOperatorRbac,
  now = new Date(),
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("production blue-green clock is invalid");
  }
  if (stableReleaseOptions == null || candidateReleaseOptions == null) {
    throw new Error("stable and candidate signed release options are required");
  }
  const stable = validateSignedProductionBundle(verifyRelease({
    ...stableReleaseOptions,
    execFile,
    now,
  }), "stable");
  const candidate = validateSignedProductionBundle(verifyRelease({
    ...candidateReleaseOptions,
    execFile,
    now,
  }), "candidate");
  if (stable.receipt.sourceCommit === candidate.receipt.sourceCommit) {
    throw new Error("stable and candidate source commits must differ");
  }
  if (stable.receipt.productionManifestSha256 === candidate.receipt.productionManifestSha256) {
    throw new Error("candidate production manifest must differ from the active release");
  }
  if (stable.receipt.publicProbePolicySha256 !== candidate.receipt.publicProbePolicySha256) {
    throw new Error("blue-green update cannot change the signed public probe boundary");
  }
  const stableInventory = productionManifestInventory(stable.manifest, "stable");
  const candidateInventory = productionManifestInventory(candidate.manifest, "candidate");
  if (JSON.stringify(stableInventory) !== JSON.stringify(candidateInventory)) {
    throw new Error("blue-green update requires an identical Kubernetes resource inventory");
  }
  const requiredSamples = validateWindow(observationSeconds, sampleIntervalSeconds);
  const pinned = readPinnedProductionEvidence(stableEvidencePath, stableEvidenceSha256, "stable");
  validateProductionDeploymentEvidence(pinned, stable, context, expectedClusterUid, "stable");
  const cluster = clusterPreflight(execFile, context, expectedClusterUid, stable, candidate);
  if (typeof authorize !== "function") throw new Error("production RBAC verifier is required");
  const operatorAuthorization = authorize({
    context,
    manifest: candidate.manifest,
    mode: "blue-green",
    execFile,
  });
  if (operatorAuthorization?.pass !== true) {
    throw new Error("production operator RBAC preflight did not pass");
  }
  const greenManifest = buildProductionGreenManifest(candidate.manifest, candidate);
  const greenDryRun = runText(execFile, "kubectl", [
    "--context", context, "apply", "--server-side", "--dry-run=server",
    `--field-manager=${greenFieldManager}`, "-f", "-",
  ], "production green server-side dry-run", greenManifest);
  if (greenDryRun === "") throw new Error("production green server-side dry-run returned no receipt");
  const candidateDryRun = runText(execFile, "kubectl", [
    "--context", context, "apply", "--server-side", "--dry-run=server",
    `--field-manager=${productionFieldManager}`, "-f", "-",
  ], "production candidate server-side dry-run", candidate.manifest);
  if (candidateDryRun === "") throw new Error("production candidate server-side dry-run returned no receipt");
  return {
    stable,
    candidate,
    greenManifest,
    receipt: {
      schemaVersion: 1,
      action: "production-blue-green-preflight",
      source: "two verified production signatures, pinned stable deployment evidence, and direct cluster preflight",
      asOf: now.toISOString(),
      environment: "production",
      stableSourceCommit: stable.receipt.sourceCommit,
      stableVersion: stable.receipt.version,
      stableManifestSha256: stable.receipt.productionManifestSha256,
      stableEvidenceSha256: pinned.sha256,
      candidateSourceCommit: candidate.receipt.sourceCommit,
      candidateVersion: candidate.receipt.version,
      candidateManifestSha256: candidate.receipt.productionManifestSha256,
      resourceInventorySha256: sha256(stableInventory.join("\n")),
      resourceInventoryCount: stableInventory.length,
      publicProbePolicySha256: candidate.receipt.publicProbePolicySha256,
      greenManifestSha256: sha256(greenManifest),
      greenManifestBytes: Buffer.byteLength(greenManifest),
      stableImageDigest: cluster.stableImageDigest,
      candidateImageDigest: quantWorkerReference(candidate, "candidate").match(/@sha256:([0-9a-f]{64})$/)[1],
      contextSha256: sha256(context),
      clusterUidSha256: sha256(expectedClusterUid),
      serverVersion: cluster.serverVersion,
      operatorAuthorization,
      observationSeconds,
      sampleIntervalSeconds,
      requiredSamples,
      greenServerDryRunPassed: true,
      greenServerDryRunOutputSha256: sha256(greenDryRun),
      candidateServerDryRunPassed: true,
      candidateServerDryRunOutputSha256: sha256(candidateDryRun),
      productionSigned: true,
      mutationPerformed: false,
      deployedPublic: true,
    },
  };
}

function greenHealth(execFile, context, candidate) {
  const deployment = runJson(execFile, "kubectl", [
    "--context", context, "get", "deployment", greenDeployment,
    "-n", namespace, "-o", "json",
  ], "green deployment health inspection");
  const pods = runJson(execFile, "kubectl", [
    "--context", context, "get", "pods", "-n", namespace,
    "-l", `app=${greenDeployment}`, "-o", "json",
  ], "green pod health inspection");
  const expectedImage = quantWorkerReference(candidate, "candidate");
  const containers = deployment.spec?.template?.spec?.containers ?? [];
  const replicas = Number(deployment.spec?.replicas ?? 0);
  const podItems = pods.items ?? [];
  const checks = [
    {
      id: "candidate-binding",
      pass: deployment.metadata?.labels?.["security.ynx/source-commit"] === candidate.receipt.sourceCommit
        && deployment.metadata?.labels?.["security.ynx/release-track"] === "green"
        && containers.length === 1
        && containers[0].image === expectedImage,
    },
    {
      id: "deployment-ready",
      pass: replicas >= 3
        && Number(deployment.status?.observedGeneration ?? -1) >= Number(deployment.metadata?.generation ?? 0)
        && Number(deployment.status?.availableReplicas ?? 0) >= replicas
        && Number(deployment.status?.updatedReplicas ?? 0) >= replicas
        && Number(deployment.status?.unavailableReplicas ?? 0) === 0,
    },
    {
      id: "pods-ready-zero-restarts",
      pass: podItems.length >= replicas
        && podItems.every((pod) => (
          pod.metadata?.deletionTimestamp == null
          && pod.status?.phase === "Running"
          && pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True")
          && (pod.status?.containerStatuses ?? []).length > 0
          && pod.status.containerStatuses.every((status) => (
            status.ready === true
            && status.restartCount === 0
            && status.image === expectedImage
            && status.imageID?.endsWith(`@${expectedImage.split("@")[1]}`)
          ))
        )),
    },
  ];
  return { pass: checks.every((check) => check.pass), checks, pods: podItems.length };
}

function cleanupGreen(execFile, context) {
  const output = runText(execFile, "kubectl", [
    "--context", context, "delete", "deployment", greenDeployment,
    "-n", namespace, "--ignore-not-found=true", "--wait=true", "--timeout=120s",
  ], "production green cleanup");
  if (output === "") throw new Error("production green cleanup returned no receipt");
  return { outputSha256: sha256(output), outputBytes: Buffer.byteLength(output) };
}

export function reconcileProductionRelease({
  execFile,
  context,
  release,
  rolloutTimeoutSeconds,
  verifyReadiness,
  verifyPublicEndpoints,
  now,
  action,
}) {
  const applyOutput = runText(execFile, "kubectl", [
    "--context", context, "apply", "--server-side",
    `--field-manager=${productionFieldManager}`, "-f", "-",
  ], `${action} server-side apply`, release.manifest);
  if (applyOutput === "") throw new Error(`${action} server-side apply returned no receipt`);
  const diff = runText(execFile, "kubectl", [
    "--context", context, "diff", "--server-side",
    `--field-manager=${productionFieldManager}`, "-f", "-",
  ], `${action} live manifest reconciliation`, release.manifest);
  if (diff !== "") throw new Error(`${action} live resources differ from the signed manifest`);
  const rollout = runText(execFile, "kubectl", [
    "--context", context, "rollout", "status", "deployment", "--all",
    "-n", namespace, `--timeout=${rolloutTimeoutSeconds}s`,
  ], `${action} rollout verification`);
  if (rollout === "") throw new Error(`${action} rollout returned no receipt`);
  const readiness = verifyReadiness(execFile, context, release);
  if (readiness?.pass !== true) throw new Error(`${action} readiness failed`);
  const probedAt = now();
  const publicProbes = verifyPublicEndpoints(execFile, release, probedAt);
  if (publicProbes?.pass !== true) throw new Error(`${action} public probes failed`);
  return {
    applyOutputSha256: sha256(applyOutput),
    applyOutputBytes: Buffer.byteLength(applyOutput),
    liveManifestReconciled: true,
    rolloutOutputSha256: sha256(rollout),
    rolloutVerified: true,
    readiness,
    publicProbes,
  };
}

function defaultWait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function promoteProductionBlueGreen({
  stableReleaseOptions,
  candidateReleaseOptions,
  stableEvidencePath,
  stableEvidenceSha256,
  context,
  expectedClusterUid,
  observationSeconds = 300,
  sampleIntervalSeconds = 30,
  rolloutTimeoutSeconds = 600,
  operatorId,
  changeId,
  acknowledge,
  evidencePath,
  execFile = execFileSync,
  verifyRelease = verifyProductionReleaseBundle,
  verifyReadiness = verifyProductionReadiness,
  verifyPublicEndpoints = verifyProductionPublicEndpoints,
  authorize = verifyProductionOperatorRbac,
  approvalBinder = bindProductionReleaseApproval,
  approvalConsumer = consumeProductionApproval,
  alertDispatcher = deliverProductionChangeAlert,
  alertInputPreflight = preflightProductionAlertInputs,
  alertOptions,
  operatorBundlePreflight = null,
  leaseFactory = acquireProductionLease,
  leaseDurationSeconds = 600,
  wait = defaultWait,
  now = () => new Date(),
}) {
  if (acknowledge !== "promote-production-blue-green") {
    throw new Error("production update requires acknowledge=promote-production-blue-green");
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
    || typeof wait !== "function"
    || typeof now !== "function"
  ) {
    throw new Error("production blue-green runtime dependencies are invalid");
  }
  const startedAt = now();
  const preflight = preflightProductionBlueGreen({
    stableReleaseOptions,
    candidateReleaseOptions,
    stableEvidencePath,
    stableEvidenceSha256,
    context,
    expectedClusterUid,
    observationSeconds,
    sampleIntervalSeconds,
    execFile,
    verifyRelease,
    authorize,
    now: startedAt,
  });
  const changeApproval = approvalBinder({
    release: preflight.candidate,
    action: "production-blue-green-update",
    operatorId,
    changeId,
    expectedClusterUid,
    now: startedAt,
  });
  if (changeApproval?.bound !== true) throw new Error("production change approval did not bind");
  const alertPreflight = alertInputPreflight({
    ...alertOptions,
    execFile,
    sourceCommit: preflight.candidate.receipt.runtimeSourceCommit,
    checkedAt: startedAt,
  });
  if (
    alertPreflight?.ready !== true
    || alertPreflight.alertDeliveryPerformed !== false
    || alertPreflight.productionMutationPerformed !== false
    || alertPreflight.sourceCommit !== preflight.candidate.receipt.runtimeSourceCommit
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
      expectedOperation: "blue-green-update",
      runtimeSourceCommit: preflight.candidate.receipt.runtimeSourceCommit,
      changeApproval,
      alertInputPreflight: alertPreflight,
    });
  const productionLease = leaseFactory({
    context,
    operatorId,
    changeId,
    action: "production-blue-green-update",
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
    action: "production-blue-green-update",
    operatorId,
    changeId,
    startedAt: startedAt.toISOString(),
    state: "green-apply-not-confirmed",
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

  let greenApplyAttempted = false;
  let candidateApplyAttempted = false;
  let greenCleanup = null;
  let approvalConsumption = null;
  let approvalConsumptionAttempted = false;
  let alertDelivery = null;
  let alertDeliveryAttempted = false;
  const samples = [];
  try {
    leaseRenewals.push(productionLease.renew());
    alertDeliveryAttempted = true;
    alertDelivery = alertDispatcher({
      approval: changeApproval,
      operatorId,
      expectedClusterUid,
      ...alertOptions,
      execFile,
      sourceCommit: preflight.candidate.receipt.runtimeSourceCommit,
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
      throw new Error("production change approval was not consumed");
    }
    greenApplyAttempted = true;
    const greenApply = runText(execFile, "kubectl", [
      "--context", context, "apply", "--server-side",
      `--field-manager=${greenFieldManager}`, "-f", "-",
    ], "production green server-side apply", preflight.greenManifest);
    if (greenApply === "") throw new Error("production green server-side apply returned no receipt");
    const greenRollout = runText(execFile, "kubectl", [
      "--context", context, "rollout", "status", `deployment/${greenDeployment}`,
      "-n", namespace, `--timeout=${rolloutTimeoutSeconds}s`,
    ], "production green rollout verification");
    if (greenRollout === "") throw new Error("production green rollout returned no receipt");

    for (let index = 0; index < preflight.receipt.requiredSamples; index += 1) {
      leaseRenewals.push(productionLease.renew());
      const sampledAt = now();
      if (!(sampledAt instanceof Date) || !Number.isFinite(sampledAt.getTime())) {
        throw new Error("production green sample time is invalid");
      }
      const health = greenHealth(execFile, context, preflight.candidate);
      samples.push({
        index: index + 1,
        asOf: sampledAt.toISOString(),
        pass: health.pass,
        checks: health.checks,
        pods: health.pods,
      });
      if (!health.pass) {
        throw new Error(`production green health failed: ${health.checks.filter((check) => !check.pass).map((check) => check.id).join(",")}`);
      }
      if (index + 1 < preflight.receipt.requiredSamples) {
        wait(preflight.receipt.sampleIntervalSeconds * 1000);
      }
    }
    const observedMilliseconds = Date.parse(samples.at(-1).asOf) - Date.parse(samples[0].asOf);
    if (observedMilliseconds < preflight.receipt.observationSeconds * 1000) {
      throw new Error("production green observation window was shorter than required");
    }

    leaseRenewals.push(productionLease.renew());
    candidateApplyAttempted = true;
    const candidateResult = reconcileProductionRelease({
      execFile,
      context,
      release: preflight.candidate,
      rolloutTimeoutSeconds,
      verifyReadiness,
      verifyPublicEndpoints,
      now,
      action: "production candidate",
    });
    greenCleanup = cleanupGreen(execFile, context);
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
      sourceCommit: preflight.candidate.receipt.sourceCommit,
      version: preflight.candidate.receipt.version,
      productionManifestSha256: preflight.candidate.receipt.productionManifestSha256,
      completedAt: completedAt.toISOString(),
      releasedAt: completedAt.toISOString(),
      state: productionLeaseRelease === null
        ? "deployed-public-verified-lease-release-pending"
        : "deployed-public-verified",
      greenApplyOutputSha256: sha256(greenApply),
      greenRolloutOutputSha256: sha256(greenRollout),
      greenSamples: samples,
      greenObservationPassed: true,
      greenObservedMilliseconds: observedMilliseconds,
      greenRemoved: true,
      greenCleanup,
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
      ...candidateResult,
      activeSourceCommit: preflight.candidate.receipt.sourceCommit,
      stableRestored: false,
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
    let cleanupFailure = null;
    if (leaseOwnershipFailure === null && greenApplyAttempted && greenCleanup == null) {
      try {
        greenCleanup = cleanupGreen(execFile, context);
      } catch (cleanupError) {
        cleanupFailure = cleanupError.message;
      }
    }
    let stableVerification = null;
    let automaticRollbackFailure = null;
    if (leaseOwnershipFailure === null) {
      try {
        stableVerification = candidateApplyAttempted
          ? reconcileProductionRelease({
            execFile,
            context,
            release: preflight.stable,
            rolloutTimeoutSeconds,
            verifyReadiness,
            verifyPublicEndpoints,
            now,
            action: "automatic stable rollback",
          })
          : {
            readiness: verifyReadiness(execFile, context, preflight.stable),
            publicProbes: verifyPublicEndpoints(execFile, preflight.stable, now()),
          };
        if (stableVerification.readiness?.pass !== true || stableVerification.publicProbes?.pass !== true) {
          throw new Error("stable production verification failed");
        }
      } catch (rollbackError) {
        automaticRollbackFailure = rollbackError.message;
      }
    }
    const stableRestored = stableVerification !== null && automaticRollbackFailure === null;
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
      state: stableRestored
        ? (candidateApplyAttempted
          ? "candidate-failed-stable-restored"
          : "green-failed-stable-preserved")
        : "production-update-failed-active-release-unverified",
      failure: error.message,
      greenApplyAttempted,
      greenSamples: samples,
      greenObservationPassed: samples.length === preflight.receipt.requiredSamples
        && samples.every((sample) => sample.pass),
      greenRemoved: greenApplyAttempted ? greenCleanup !== null : true,
      greenCleanup,
      greenCleanupFailure: cleanupFailure,
      candidateApplyAttempted,
      automaticRollbackAttempted: candidateApplyAttempted,
      automaticRollback: stableVerification,
      automaticRollbackFailure,
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
      stableRestored,
      activeSourceCommit: stableRestored ? preflight.stable.receipt.sourceCommit : null,
      sourceCommit: stableRestored ? preflight.stable.receipt.sourceCommit : preflight.candidate.receipt.sourceCommit,
      version: stableRestored ? preflight.stable.receipt.version : preflight.candidate.receipt.version,
      productionManifestSha256: stableRestored
        ? preflight.stable.receipt.productionManifestSha256
        : preflight.candidate.receipt.productionManifestSha256,
      readiness: stableVerification?.readiness ?? null,
      publicProbes: stableVerification?.publicProbes ?? null,
      productionSigned: true,
      mutationPerformed: alertDeliveryAttempted
        || approvalConsumptionAttempted
        || greenApplyAttempted
        || candidateApplyAttempted,
      deployedPublic: stableRestored,
    };
    writeEvidence(evidencePath, failed);
    throw error;
  }
}

export function loadProductionReleaseRequest(path) {
  let request;
  try {
    request = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    throw new Error("signed release request read failed");
  }
  const required = [
    "stagingInputPath",
    "productionInputPath",
    "stagingEvidencePath",
    "stagingEvidenceSha256",
    "runtimeSourceCommit",
    "version",
    "imageEvidencePath",
    "approvalPath",
    "trustedSignerFingerprint",
    "signerPolicyPath",
    "signerPolicySha256",
    "publicProbePolicyPath",
    "publicProbePolicySha256",
    "attestationPath",
    "attestationSha256",
    "signaturePath",
    "signatureSha256",
  ];
  if (
    request?.schemaVersion !== 1
    || Object.keys(request).length !== required.length + 1
    || required.some((field) => typeof request[field] !== "string" || request[field] === "")
  ) {
    throw new Error("signed release request boundary is invalid");
  }
  return {
    stagingInput: JSON.parse(readFileSync(resolve(request.stagingInputPath), "utf8")),
    productionInput: JSON.parse(readFileSync(resolve(request.productionInputPath), "utf8")),
    stagingEvidencePath: request.stagingEvidencePath,
    stagingEvidenceSha256: request.stagingEvidenceSha256,
    runtimeSourceCommit: request.runtimeSourceCommit,
    version: request.version,
    imageEvidence: JSON.parse(readFileSync(resolve(request.imageEvidencePath), "utf8")),
    approval: JSON.parse(readFileSync(resolve(request.approvalPath), "utf8")),
    trustedSignerFingerprint: request.trustedSignerFingerprint,
    signerPolicyPath: request.signerPolicyPath,
    signerPolicySha256: request.signerPolicySha256,
    publicProbePolicyPath: request.publicProbePolicyPath,
    publicProbePolicySha256: request.publicProbePolicySha256,
    attestationPath: request.attestationPath,
    attestationSha256: request.attestationSha256,
    signaturePath: request.signaturePath,
    signatureSha256: request.signatureSha256,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const common = {
      stableReleaseOptions: loadProductionReleaseRequest(args["stable-release-request"]),
      candidateReleaseOptions: loadProductionReleaseRequest(args["candidate-release-request"]),
      stableEvidencePath: args["stable-evidence"],
      stableEvidenceSha256: args["stable-evidence-sha256"],
      context: args.context,
      expectedClusterUid: args["cluster-uid"],
      observationSeconds: Number(args["observation-seconds"] ?? 300),
      sampleIntervalSeconds: Number(args["sample-interval-seconds"] ?? 30),
    };
    let result;
    if (command === "preflight") {
      ({ receipt: result } = preflightProductionBlueGreen(common));
    } else if (command === "promote") {
      result = promoteProductionBlueGreen({
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
        rolloutTimeoutSeconds: Number(args["rollout-timeout-seconds"] ?? 600),
        leaseDurationSeconds: Number(args["lease-duration-seconds"] ?? 600),
      });
    } else {
      throw new Error("usage: security-production-blue-green.mjs preflight|promote --stable-release-request PATH --candidate-release-request PATH --stable-evidence PATH --stable-evidence-sha256 SHA256 --context NAME --cluster-uid UID [--alert-endpoint URL --alert-expected-host HOST --alert-credential-header-file /run/secrets/ynx/NAME --alert-credential-version-file /run/secrets/ynx/NAME.version-id --alert-secret-inventory PATH --alert-secret-inventory-sha256 SHA256] [promotion flags]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
