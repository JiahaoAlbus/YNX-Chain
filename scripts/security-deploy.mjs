#!/usr/bin/env node
/**
 * Operator-controlled Kubernetes staging deployment.
 *
 * CI must never invoke `deploy`. The runtime binds an explicit context and
 * kube-system UID, verifies a clean source commit, requires an actual promoted
 * staging manifest, performs server-side dry-run, applies without force/prune,
 * waits for rollout, and records metadata-only evidence.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRenderedManifest } from "./security-integration.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stagingNamespace = "ynx-services-staging";
const platformNamespace = "ynx-security-platform";
const fieldManager = "ynx-security-platform-staging";

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

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
}

function validateSourceCommit(sourceCommit) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("sourceCommit must be a full Git SHA");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function resolveOverlay(overlay) {
  const absolute = resolve(root, overlay);
  const allowedRoot = resolve(root, "infra/k8s/overlays");
  if (!absolute.startsWith(`${allowedRoot}/`)) throw new Error("overlay must stay under infra/k8s/overlays");
  return {
    absolute,
    relative: absolute.slice(root.length + 1),
  };
}

function manifestDocuments(manifest) {
  return manifest.split(/^---\s*$/m).filter((document) => document.trim());
}

export function validateStagingReleaseManifest(manifest, { sourceCommit } = {}) {
  const base = validateRenderedManifest({
    environment: "staging",
    manifest,
    backupMode: "active",
  });
  const failures = [...base.failures];
  const documents = manifestDocuments(manifest);
  const images = [...manifest.matchAll(/\n\s*(?:-\s*)?image:\s*([^\s]+)/g)].map((match) => match[1]);
  if (images.length === 0) failures.push("staging: release manifest contains no workload images");
  for (const image of images) {
    if (!/@sha256:[0-9a-f]{64}$/.test(image)) failures.push(`staging: image is not digest-pinned: ${image}`);
  }
  if (/security\.ynx\/manifest-class:\s*deployment-candidate\b/.test(manifest)) {
    failures.push("staging: deployment-candidate manifests cannot be applied");
  }
  if (!/security\.ynx\/manifest-class:\s*staging-release\b/.test(manifest)) {
    failures.push("staging: staging-release manifest class is required");
  }
  if (!/^kind:\s*SecretProviderClass\b/m.test(manifest)) {
    failures.push("staging: SecretProviderClass runtime integration is required");
  }
  if (/^kind:\s*Secret\b/m.test(manifest)) failures.push("staging: tracked Kubernetes Secret objects are forbidden");
  if (/^kind:\s*(?:ClusterRole|ClusterRoleBinding|CustomResourceDefinition|PersistentVolume)\b/m.test(manifest)) {
    failures.push("staging: cluster-wide privilege or storage resources are forbidden");
  }
  if (sourceCommit !== undefined) {
    validateSourceCommit(sourceCommit);
    for (const document of documents.filter((value) => /^kind:\s*(?:Deployment|CronJob)\b/m.test(value))) {
      const name = document.match(/\nmetadata:\n(?:[\s\S]*?\n)?\s*name:\s*([^\s]+)/)?.[1] ?? "unknown";
      const boundSourceCommit = document.match(
        /^\s*security\.ynx\/source-commit:\s*([^\s#]+)\s*(?:#.*)?$/m,
      )?.[1];
      if (boundSourceCommit !== sourceCommit) {
        failures.push(`staging: workload ${name} is not bound to sourceCommit`);
      }
    }
  }

  const allowedNamespaces = new Set([stagingNamespace, platformNamespace]);
  for (const document of documents) {
    const kind = document.match(/^kind:\s*([^\s]+)/m)?.[1];
    const name = document.match(/\nmetadata:\n(?:[\s\S]*?\n)?\s*name:\s*([^\s]+)/)?.[1];
    const namespace = kind === "Namespace"
      ? name
      : document.match(/\n\s*namespace:\s*([^\s]+)/)?.[1];
    if (namespace && !allowedNamespaces.has(namespace)) {
      failures.push(`staging: resource targets an unauthorized namespace: ${namespace}`);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    documents: documents.length,
    images,
    bytes: Buffer.byteLength(manifest),
    sha256: sha256(manifest),
  };
}

function gitPreflight(execFile, sourceCommit) {
  const head = runText(execFile, "git", ["rev-parse", "HEAD"], "Git HEAD inspection");
  if (head !== sourceCommit) throw new Error("sourceCommit does not match Git HEAD");
  const dirty = runText(execFile, "git", ["status", "--porcelain=v1"], "Git status inspection");
  if (dirty !== "") throw new Error("deployment requires a clean Git worktree");
}

function clusterPreflight(execFile, context, expectedClusterUid) {
  const currentContext = runText(execFile, "kubectl", ["config", "current-context"], "Kubernetes current-context inspection");
  if (currentContext !== context) throw new Error("active Kubernetes context does not match the acknowledged context");
  const systemNamespace = runJson(execFile, "kubectl", [
    "--context",
    context,
    "get",
    "namespace",
    "kube-system",
    "-o",
    "json",
  ], "Kubernetes cluster identity inspection");
  if (systemNamespace.metadata?.uid !== expectedClusterUid) {
    throw new Error("kube-system UID does not match the acknowledged cluster");
  }
  const version = runJson(execFile, "kubectl", [
    "--context",
    context,
    "version",
    "-o",
    "json",
  ], "Kubernetes server version inspection");
  if (typeof version.serverVersion?.gitVersion !== "string") {
    throw new Error("Kubernetes server version is missing");
  }
  return {
    serverVersion: version.serverVersion.gitVersion,
    clusterUidSha256: sha256(expectedClusterUid),
    contextSha256: sha256(context),
  };
}

export function preflightStagingDeployment({
  context,
  expectedClusterUid,
  sourceCommit,
  runtimeSourceCommit,
  operation = "deploy",
  rollbackTargetEvidenceSha256,
  overlay,
  manifest,
  releaseInputSha256,
  execFile = execFileSync,
  now = new Date(),
}) {
  safeIdentifier(context, "context");
  safeIdentifier(expectedClusterUid, "expectedClusterUid");
  validateSourceCommit(sourceCommit);
  if (!new Set(["deploy", "rollback"]).has(operation)) throw new Error("deployment operation is invalid");
  const executingCommit = runtimeSourceCommit ?? sourceCommit;
  validateSourceCommit(executingCommit);
  if (operation === "deploy" && executingCommit !== sourceCommit) {
    throw new Error("deployment runtime and release source commits must match");
  }
  if (operation === "deploy" && rollbackTargetEvidenceSha256 !== undefined) {
    throw new Error("deployment cannot include rollback evidence");
  }
  if (
    operation === "rollback"
    && (
      executingCommit === sourceCommit
      || !/^[0-9a-f]{64}$/.test(rollbackTargetEvidenceSha256 ?? "")
    )
  ) {
    throw new Error("rollback requires a distinct runtime commit and target evidence digest");
  }
  if (!Number.isFinite(now.getTime())) throw new Error("preflight time is invalid");
  if (manifest !== undefined && overlay !== undefined) {
    throw new Error("manifest and overlay cannot both be selected");
  }
  if (manifest !== undefined && (typeof manifest !== "string" || manifest.trim() === "")) {
    throw new Error("generated staging manifest must not be empty");
  }
  if (manifest !== undefined && !/^[0-9a-f]{64}$/.test(releaseInputSha256 ?? "")) {
    throw new Error("generated staging manifest requires a release input digest");
  }
  const selectedOverlay = manifest === undefined
    ? resolveOverlay(overlay ?? "infra/k8s/overlays/staging")
    : { relative: "generated-from-operator-input" };
  gitPreflight(execFile, executingCommit);
  const cluster = clusterPreflight(execFile, context, expectedClusterUid);
  const renderedManifest = manifest ?? runText(execFile, "kubectl", [
    "kustomize",
    selectedOverlay.relative,
  ], "Kustomize render");
  const validation = validateStagingReleaseManifest(renderedManifest, { sourceCommit });
  if (!validation.pass) throw new Error(`staging manifest is not deployable: ${validation.failures.join("; ")}`);
  const dryRunOutput = runText(execFile, "kubectl", [
    "--context",
    context,
    "apply",
    "--server-side",
    "--dry-run=server",
    `--field-manager=${fieldManager}`,
    "-f",
    "-",
  ], "Kubernetes server-side dry-run", renderedManifest);
  if (dryRunOutput === "") throw new Error("Kubernetes server-side dry-run returned no receipt");

  return {
    manifest: renderedManifest,
    receipt: {
      schemaVersion: 1,
      action: operation === "rollback" ? "staging-rollback-preflight" : "staging-deployment-preflight",
      source: "Git, kubectl kustomize, and Kubernetes API server",
      sourceCommit,
      runtimeSourceCommit: executingCommit,
      version: "1",
      asOf: now.toISOString(),
      confidence: "direct-local-and-cluster-preflight",
      environment: "staging",
      overlay: selectedOverlay.relative,
      ...(releaseInputSha256 === undefined ? {} : { releaseInputSha256 }),
      ...(rollbackTargetEvidenceSha256 === undefined ? {} : { rollbackTargetEvidenceSha256 }),
      namespace: stagingNamespace,
      contextSha256: cluster.contextSha256,
      clusterUidSha256: cluster.clusterUidSha256,
      serverVersion: cluster.serverVersion,
      manifestSha256: validation.sha256,
      manifestBytes: validation.bytes,
      manifestDocuments: validation.documents,
      imageDigests: validation.images.map((image) => image.match(/@sha256:([0-9a-f]{64})$/)?.[1]),
      imageReferenceSha256s: validation.images.map((image) => sha256(image)),
      serverDryRunPassed: true,
      serverDryRunOutputSha256: sha256(dryRunOutput),
      mutationPerformed: false,
      installedLocal: false,
      deployedStaging: false,
      deployedPublic: false,
    },
  };
}

function readinessChecks(execFile, context) {
  const namespace = runJson(execFile, "kubectl", [
    "--context", context, "get", "namespace", stagingNamespace, "-o", "json",
  ], "staging namespace verification");
  const deployments = runJson(execFile, "kubectl", [
    "--context", context, "get", "deployment", "-n", stagingNamespace, "-o", "json",
  ], "staging deployment verification");
  const pods = runJson(execFile, "kubectl", [
    "--context", context, "get", "pods", "-n", stagingNamespace, "-o", "json",
  ], "staging pod verification");
  const policies = runJson(execFile, "kubectl", [
    "--context", context, "get", "networkpolicy", "-n", stagingNamespace, "-o", "json",
  ], "staging network-policy verification");
  const peerAuthentication = runJson(execFile, "kubectl", [
    "--context", context, "get", "peerauthentication", "-n", stagingNamespace, "-o", "json",
  ], "staging mTLS verification");
  const cronJobs = runJson(execFile, "kubectl", [
    "--context", context, "get", "cronjob", "-n", stagingNamespace, "-o", "json",
  ], "staging backup schedule verification");
  const secretProviders = runJson(execFile, "kubectl", [
    "--context", context, "get", "secretproviderclass", "-n", stagingNamespace, "-o", "json",
  ], "staging secret-provider verification");

  const checks = [];
  checks.push({
    id: "namespace-environment",
    pass: namespace.metadata?.labels?.environment === "staging",
  });
  const deploymentItems = deployments.items ?? [];
  checks.push({
    id: "deployments-ready",
    pass: deploymentItems.length > 0 && deploymentItems.every((item) => (
      Number(item.status?.observedGeneration ?? -1) >= Number(item.metadata?.generation ?? 0)
      && Number(item.status?.availableReplicas ?? 0) >= Number(item.spec?.replicas ?? 1)
    )),
  });
  const podItems = pods.items ?? [];
  checks.push({
    id: "pods-ready",
    pass: podItems.length > 0 && podItems.every((pod) => (
      pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True")
    )),
  });
  checks.push({
    id: "default-deny-network-policy",
    pass: (policies.items ?? []).some((item) => item.metadata?.name === "default-deny-all"),
  });
  checks.push({
    id: "strict-mtls",
    pass: (peerAuthentication.items ?? []).some((item) => item.spec?.mtls?.mode === "STRICT"),
  });
  checks.push({
    id: "active-backups",
    pass: (cronJobs.items ?? []).length > 0 && (cronJobs.items ?? []).every((item) => item.spec?.suspend === false),
  });
  checks.push({
    id: "secret-provider-installed",
    pass: (secretProviders.items ?? []).length > 0,
  });
  return {
    pass: checks.every((check) => check.pass),
    checks,
    deployments: deploymentItems.length,
    pods: podItems.length,
    cronJobs: (cronJobs.items ?? []).length,
    secretProviders: (secretProviders.items ?? []).length,
  };
}

function writeEvidence(relativePath, value) {
  const output = resolve(root, relativePath);
  if (!output.startsWith(`${root}/`)) throw new Error("evidence path must stay inside the repository");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function deployStaging({
  context,
  expectedClusterUid,
  sourceCommit,
  runtimeSourceCommit,
  operation = "deploy",
  rollbackTargetEvidenceSha256,
  overlay,
  manifest,
  releaseInputSha256,
  operatorId,
  changeId,
  acknowledge,
  evidencePath,
  rolloutTimeoutSeconds = 300,
  execFile = execFileSync,
  now = () => new Date(),
}) {
  const requiredAcknowledgement = operation === "rollback" ? "rollback-staging" : "apply-staging";
  if (acknowledge !== requiredAcknowledgement) {
    throw new Error(`deployment requires acknowledge=${requiredAcknowledgement}`);
  }
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(changeId, "changeId");
  if (!evidencePath) throw new Error("deployment requires an evidence path");
  if (!Number.isInteger(rolloutTimeoutSeconds) || rolloutTimeoutSeconds < 30 || rolloutTimeoutSeconds > 1800) {
    throw new Error("rolloutTimeoutSeconds must be between 30 and 1800");
  }
  const startedAt = now();
  const preflight = preflightStagingDeployment({
    context,
    expectedClusterUid,
    sourceCommit,
    runtimeSourceCommit,
    operation,
    rollbackTargetEvidenceSha256,
    overlay,
    manifest,
    releaseInputSha256,
    execFile,
    now: startedAt,
  });
  const intent = {
    ...preflight.receipt,
    action: operation === "rollback" ? "staging-rollback" : "staging-deployment",
    operatorId,
    changeId,
    startedAt: startedAt.toISOString(),
    state: "apply-not-confirmed",
  };
  writeEvidence(evidencePath, intent);

  let applyOutput;
  let rolloutOutput;
  try {
    applyOutput = runText(execFile, "kubectl", [
      "--context",
      context,
      "apply",
      "--server-side",
      `--field-manager=${fieldManager}`,
      "-f",
      "-",
    ], "Kubernetes server-side apply", preflight.manifest);
    if (applyOutput === "") throw new Error("Kubernetes server-side apply returned no receipt");
    const liveDiff = runText(execFile, "kubectl", [
      "--context",
      context,
      "diff",
      "--server-side",
      `--field-manager=${fieldManager}`,
      "-f",
      "-",
    ], "Kubernetes live manifest reconciliation", preflight.manifest);
    if (liveDiff !== "") throw new Error("live resources differ from the applied manifest");
    rolloutOutput = runText(execFile, "kubectl", [
      "--context",
      context,
      "rollout",
      "status",
      "deployment",
      "--all",
      "-n",
      stagingNamespace,
      `--timeout=${rolloutTimeoutSeconds}s`,
    ], "Kubernetes rollout verification");
    if (rolloutOutput === "") throw new Error("Kubernetes rollout returned no receipt");
    const readiness = readinessChecks(execFile, context);
    if (!readiness.pass) {
      throw new Error(`staging readiness failed: ${readiness.checks.filter((check) => !check.pass).map((check) => check.id).join(",")}`);
    }
    const completedAt = now();
    const result = {
      ...intent,
      completedAt: completedAt.toISOString(),
      state: "deployed-staging-verified",
      applyOutputSha256: sha256(applyOutput),
      applyOutputBytes: Buffer.byteLength(applyOutput),
      liveManifestReconciled: true,
      rolloutOutputSha256: sha256(rolloutOutput),
      rolloutVerified: true,
      readiness,
      mutationPerformed: true,
      deployedStaging: true,
      deployedPublic: false,
    };
    writeEvidence(evidencePath, result);
    return result;
  } catch (error) {
    writeEvidence(evidencePath, {
      ...intent,
      failedAt: now().toISOString(),
      state: applyOutput === undefined ? "apply-not-confirmed" : "apply-completed-verification-failed",
      applyOutputSha256: applyOutput === undefined ? null : sha256(applyOutput),
      applyOutputBytes: applyOutput === undefined ? null : Buffer.byteLength(applyOutput),
      failure: error.message,
      mutationPerformed: applyOutput !== undefined,
      deployedStaging: false,
      deployedPublic: false,
    });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const common = {
      context: args.context,
      expectedClusterUid: args["cluster-uid"],
      sourceCommit: args["source-commit"],
      overlay: args.overlay,
    };
    if (command === "preflight") {
      const { receipt } = preflightStagingDeployment(common);
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    } else if (command === "deploy") {
      const result = deployStaging({
        ...common,
        operatorId: args["operator-id"],
        changeId: args["change-id"],
        acknowledge: args.acknowledge,
        evidencePath: args.evidence,
        rolloutTimeoutSeconds: Number(args["rollout-timeout-seconds"] ?? 300),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      throw new Error("usage: security-deploy.mjs preflight|deploy --context NAME --cluster-uid UID --source-commit SHA [--overlay PATH] [deploy flags]");
    }
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
