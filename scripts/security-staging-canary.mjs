#!/usr/bin/env node
/**
 * Promote a quant-worker staging release through an isolated canary.
 *
 * A previously verified staging receipt anchors the live stable release. Only
 * the quant-worker image and source commit may change. The candidate runs as a
 * separate deployment under the existing sandbox policy, must remain Ready
 * with zero restarts throughout the observation window, and is removed after
 * the complete release manifest is reconciled.
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
  deployStaging,
  preflightStagingDeployment,
  validateStagingReleaseManifest,
} from "./security-deploy.mjs";
import {
  renderStagingReleaseManifest,
  stagingReleaseInputSha256,
  validateStagingReleaseInputs,
} from "./security-stage-release.mjs";
import {
  rollbackStaging,
  validateRollbackTarget,
} from "./security-staging-rollback.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const namespace = "ynx-services-staging";
const stableDeployment = "quant-worker";
const canaryDeployment = "quant-worker-canary";
const canaryFieldManager = "ynx-security-platform-staging-canary";
const immutableInputFields = [
  "schemaVersion",
  "backupOperatorImage",
  "awsRegion",
  "backupOperatorRoleArn",
  "backupEncryptionSecretArn",
  "databaseCredentialSecretArn",
  "chainStateDestination",
  "chainStateReplicaDestination",
  "databaseDestination",
  "objectSourceBucket",
  "objectDestination",
  "chainStatePvcName",
  "awsEndpointCidrs",
  "databaseEndpointCidrs",
  "databasePort",
];

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

function fullCommit(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error(`${label} must be a full Git SHA`);
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

function readDeploymentEvidence(relativePath) {
  try {
    const value = JSON.parse(readFileSync(repositoryPath(relativePath, "evidencePath")));
    return value?.action === "staging-deployment" ? value : null;
  } catch {
    return null;
  }
}

function imageReference(image) {
  return `${image.repository}@${image.digest}`;
}

function exactValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exactValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${exactValue(value[key])}`).join(",")}}`;
}

export function validateCanaryInputs({
  stableInput: rawStableInput,
  candidateInput: rawCandidateInput,
  runtimeSourceCommit,
  observationSeconds = 300,
  sampleIntervalSeconds = 30,
}) {
  const stableInput = validateStagingReleaseInputs(rawStableInput);
  const candidateInput = validateStagingReleaseInputs(rawCandidateInput);
  fullCommit(runtimeSourceCommit, "runtimeSourceCommit");
  if (candidateInput.sourceCommit !== runtimeSourceCommit) {
    throw new Error("candidate sourceCommit must match the executing runtime commit");
  }
  if (stableInput.sourceCommit === candidateInput.sourceCommit) {
    throw new Error("stable and candidate source commits must differ");
  }
  if (imageReference(stableInput.quantWorkerImage) === imageReference(candidateInput.quantWorkerImage)) {
    throw new Error("canary requires a different quant-worker image");
  }
  for (const field of immutableInputFields) {
    if (exactValue(stableInput[field]) !== exactValue(candidateInput[field])) {
      throw new Error(`canary cannot change infrastructure field: ${field}`);
    }
  }
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
  return {
    stableInput,
    candidateInput,
    runtimeSourceCommit,
    observationSeconds,
    sampleIntervalSeconds,
    sampleCount: Math.ceil(observationSeconds / sampleIntervalSeconds) + 1,
  };
}

function manifestDocuments(manifest) {
  return manifest.split(/^---\s*$/m).filter((document) => document.trim());
}

export function buildCanaryManifest(fullManifest, {
  sourceCommit,
  image,
}) {
  fullCommit(sourceCommit, "canary sourceCommit");
  const expectedImage = imageReference(image);
  const deployments = manifestDocuments(fullManifest).filter((document) => (
    /^kind:\s*Deployment$/m.test(document)
    && /\n  name:\s*quant-worker\s*$/m.test(document)
  ));
  if (deployments.length !== 1) throw new Error("release manifest must contain exactly one quant-worker Deployment");
  let canary = deployments[0];
  const sourceName = /(\nmetadata:\n[\s\S]*?\n  name:) quant-worker(\n)/;
  if (!sourceName.test(canary)) throw new Error("quant-worker metadata name is ambiguous");
  canary = canary.replace(sourceName, `$1 ${canaryDeployment}$2`);
  const appLabels = canary.match(/\bapp:\s*quant-worker\b/g) ?? [];
  if (appLabels.length !== 3) throw new Error("quant-worker selectors are not in the expected shape");
  canary = canary.replaceAll("app: quant-worker", `app: ${canaryDeployment}`);
  const topLabels = /\nmetadata:\n  labels:\n/;
  const podLabels = /\n    metadata:\n      labels:\n/;
  if (!topLabels.test(canary) || !podLabels.test(canary)) {
    throw new Error("quant-worker label blocks are missing");
  }
  canary = canary
    .replace(topLabels, "\nmetadata:\n  labels:\n    security.ynx/release-track: canary\n")
    .replace(podLabels, "\n    metadata:\n      labels:\n        security.ynx/release-track: canary\n")
    .replace(/\n  replicas:\s*[0-9]+\b/, "\n  replicas: 1");
  const images = [...canary.matchAll(/\n\s*(?:-\s*)?image:\s*([^\s]+)/g)].map((match) => match[1]);
  if (images.length !== 1 || images[0] !== expectedImage) {
    throw new Error("canary image does not match the candidate quant-worker image");
  }
  if (!new RegExp(`security\\.ynx/source-commit:\\s*${sourceCommit}\\b`).test(canary)) {
    throw new Error("canary is not bound to the candidate sourceCommit");
  }
  if (
    !/\n\s*runAsNonRoot:\s*true\b/.test(canary)
    || !/\n\s*allowPrivilegeEscalation:\s*false\b/.test(canary)
    || !/\n\s*readOnlyRootFilesystem:\s*true\b/.test(canary)
    || !/\n\s*drop:\s*\n\s*- ALL\b/.test(canary)
  ) {
    throw new Error("canary workload hardening is incomplete");
  }
  return `${canary.trim()}\n`;
}

function readPinnedEvidence(relativePath, expectedSha256) {
  digest(expectedSha256, "stableEvidenceSha256");
  const path = repositoryPath(relativePath, "stableEvidencePath");
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error("stable deployment evidence read failed");
  }
  return { bytes, sha256: expectedSha256 };
}

function validateLiveStable(execFile, context, stableInput) {
  const deployment = runJson(execFile, "kubectl", [
    "--context", context, "get", "deployment", stableDeployment,
    "-n", namespace, "-o", "json",
  ], "live stable deployment inspection");
  const expectedImage = imageReference(stableInput.quantWorkerImage);
  const containers = deployment.spec?.template?.spec?.containers ?? [];
  const replicas = Number(deployment.spec?.replicas ?? 1);
  const pass = deployment.metadata?.labels?.["security.ynx/source-commit"] === stableInput.sourceCommit
    && containers.length === 1
    && containers[0]?.image === expectedImage
    && Number(deployment.status?.observedGeneration ?? -1) >= Number(deployment.metadata?.generation ?? 0)
    && Number(deployment.status?.availableReplicas ?? 0) >= replicas;
  if (!pass) throw new Error("live stable deployment does not match the pinned evidence and input");
  return {
    sourceCommit: stableInput.sourceCommit,
    imageDigest: stableInput.quantWorkerImage.digest.slice(7),
    replicas,
  };
}

function canaryHealth(execFile, context, candidateInput) {
  const deployment = runJson(execFile, "kubectl", [
    "--context", context, "get", "deployment", canaryDeployment,
    "-n", namespace, "-o", "json",
  ], "canary deployment health inspection");
  const pods = runJson(execFile, "kubectl", [
    "--context", context, "get", "pods",
    "-n", namespace, "-l", `app=${canaryDeployment}`, "-o", "json",
  ], "canary pod health inspection");
  const expectedImage = imageReference(candidateInput.quantWorkerImage);
  const deploymentContainers = deployment.spec?.template?.spec?.containers ?? [];
  const podItems = pods.items ?? [];
  const checks = [
    {
      id: "source-commit",
      pass: deployment.metadata?.labels?.["security.ynx/source-commit"] === candidateInput.sourceCommit,
    },
    {
      id: "candidate-image",
      pass: deploymentContainers.length === 1 && deploymentContainers[0]?.image === expectedImage,
    },
    {
      id: "deployment-ready",
      pass: Number(deployment.status?.observedGeneration ?? -1) >= Number(deployment.metadata?.generation ?? 0)
        && Number(deployment.status?.availableReplicas ?? 0) >= 1
        && Number(deployment.status?.updatedReplicas ?? 0) >= 1
        && Number(deployment.status?.unavailableReplicas ?? 0) === 0,
    },
    {
      id: "pod-ready",
      pass: podItems.length === 1
        && podItems.every((pod) => (
          pod.metadata?.deletionTimestamp == null
          && pod.status?.phase === "Running"
          && pod.status?.conditions?.some((condition) => (
            condition.type === "Ready" && condition.status === "True"
          ))
        )),
    },
    {
      id: "zero-restarts",
      pass: podItems.length === 1
        && podItems.every((pod) => (
          (pod.status?.containerStatuses ?? []).length > 0
          && pod.status.containerStatuses.every((status) => (
            status.ready === true
            && status.restartCount === 0
            && status.image === expectedImage
            && status.imageID?.endsWith(`@${candidateInput.quantWorkerImage.digest}`)
          ))
        )),
    },
  ];
  return {
    pass: checks.every((check) => check.pass),
    checks,
    pods: podItems.length,
  };
}

function cleanupCanary(execFile, context) {
  const output = runText(execFile, "kubectl", [
    "--context", context, "delete", "deployment", canaryDeployment,
    "-n", namespace,
    "--ignore-not-found=true",
    "--wait=true",
    "--timeout=120s",
  ], "canary cleanup");
  if (output === "") throw new Error("canary cleanup returned no receipt");
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output),
  };
}

function loadStableTarget({
  stableInput,
  stableEvidencePath,
  stableEvidenceSha256,
  runtimeSourceCommit,
}) {
  const pinned = readPinnedEvidence(stableEvidencePath, stableEvidenceSha256);
  const target = validateRollbackTarget({
    input: stableInput,
    evidenceBytes: pinned.bytes,
    expectedEvidenceSha256: pinned.sha256,
    runtimeSourceCommit,
  });
  return {
    ...target,
    evidenceSha256: pinned.sha256,
  };
}

export function preflightStagingCanary({
  stableInput: rawStableInput,
  candidateInput: rawCandidateInput,
  stableEvidencePath,
  stableEvidenceSha256,
  runtimeSourceCommit,
  context,
  expectedClusterUid,
  observationSeconds = 300,
  sampleIntervalSeconds = 30,
  execFile = execFileSync,
  now = new Date(),
}) {
  const inputs = validateCanaryInputs({
    stableInput: rawStableInput,
    candidateInput: rawCandidateInput,
    runtimeSourceCommit,
    observationSeconds,
    sampleIntervalSeconds,
  });
  const stable = loadStableTarget({
    stableInput: inputs.stableInput,
    stableEvidencePath,
    stableEvidenceSha256,
    runtimeSourceCommit,
  });
  const fullManifest = renderStagingReleaseManifest(inputs.candidateInput, { execFile });
  const validation = validateStagingReleaseManifest(fullManifest, {
    sourceCommit: inputs.candidateInput.sourceCommit,
  });
  if (!validation.pass) throw new Error(`candidate release is not deployable: ${validation.failures.join("; ")}`);
  const canaryManifest = buildCanaryManifest(fullManifest, {
    sourceCommit: inputs.candidateInput.sourceCommit,
    image: inputs.candidateInput.quantWorkerImage,
  });
  const candidatePreflight = preflightStagingDeployment({
    context,
    expectedClusterUid,
    sourceCommit: inputs.candidateInput.sourceCommit,
    manifest: fullManifest,
    releaseInputSha256: stagingReleaseInputSha256(inputs.candidateInput),
    execFile,
    now,
  });
  const liveStable = validateLiveStable(execFile, context, inputs.stableInput);
  const canaryDryRun = runText(execFile, "kubectl", [
    "--context", context, "apply",
    "--server-side",
    "--dry-run=server",
    `--field-manager=${canaryFieldManager}`,
    "-f", "-",
  ], "canary server-side dry-run", canaryManifest);
  if (canaryDryRun === "") throw new Error("canary server-side dry-run returned no receipt");
  return {
    fullManifest,
    canaryManifest,
    inputs,
    receipt: {
      ...candidatePreflight.receipt,
      action: "staging-canary-preflight",
      stableSourceCommit: stable.input.sourceCommit,
      stableEvidenceSha256: stable.evidenceSha256,
      stableManifestSha256: stable.manifestSha256,
      stableImageDigest: liveStable.imageDigest,
      canaryManifestSha256: sha256(canaryManifest),
      canaryManifestBytes: Buffer.byteLength(canaryManifest),
      canaryImageDigest: inputs.candidateInput.quantWorkerImage.digest.slice(7),
      observationSeconds: inputs.observationSeconds,
      sampleIntervalSeconds: inputs.sampleIntervalSeconds,
      requiredSamples: inputs.sampleCount,
      canaryServerDryRunPassed: true,
      canaryServerDryRunOutputSha256: sha256(canaryDryRun),
      mutationPerformed: false,
      deployedStaging: false,
    },
  };
}

function defaultWait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function promoteStagingCanary({
  stableInput,
  candidateInput,
  stableEvidencePath,
  stableEvidenceSha256,
  runtimeSourceCommit,
  context,
  expectedClusterUid,
  observationSeconds = 300,
  sampleIntervalSeconds = 30,
  operatorId,
  changeId,
  acknowledge,
  evidencePath,
  rolloutTimeoutSeconds = 300,
  execFile = execFileSync,
  rollback = rollbackStaging,
  wait = defaultWait,
  now = () => new Date(),
}) {
  if (acknowledge !== "promote-staging-canary") {
    throw new Error("canary promotion requires acknowledge=promote-staging-canary");
  }
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(changeId, "changeId");
  if (typeof rollback !== "function" || typeof wait !== "function" || typeof now !== "function") {
    throw new Error("canary rollback, wait, and clock functions are required");
  }
  repositoryPath(evidencePath, "evidencePath");
  const startedAt = now();
  const preflight = preflightStagingCanary({
    stableInput,
    candidateInput,
    stableEvidencePath,
    stableEvidenceSha256,
    runtimeSourceCommit,
    context,
    expectedClusterUid,
    observationSeconds,
    sampleIntervalSeconds,
    execFile,
    now: startedAt,
  });
  const intent = {
    ...preflight.receipt,
    action: "staging-canary-promotion",
    operatorId,
    changeId,
    startedAt: startedAt.toISOString(),
    state: "canary-apply-not-confirmed",
  };
  writeEvidence(evidencePath, intent);

  let canaryApplied = false;
  let promotionAttempted = false;
  let promotionResult;
  const samples = [];
  try {
    const applyOutput = runText(execFile, "kubectl", [
      "--context", context, "apply",
      "--server-side",
      `--field-manager=${canaryFieldManager}`,
      "-f", "-",
    ], "canary server-side apply", preflight.canaryManifest);
    if (applyOutput === "") throw new Error("canary server-side apply returned no receipt");
    canaryApplied = true;
    const rolloutOutput = runText(execFile, "kubectl", [
      "--context", context, "rollout", "status",
      `deployment/${canaryDeployment}`,
      "-n", namespace,
      `--timeout=${rolloutTimeoutSeconds}s`,
    ], "canary rollout verification");
    if (rolloutOutput === "") throw new Error("canary rollout returned no receipt");

    for (let index = 0; index < preflight.inputs.sampleCount; index += 1) {
      const sampledAt = now();
      if (!(sampledAt instanceof Date) || !Number.isFinite(sampledAt.getTime())) {
        throw new Error("canary sample time is invalid");
      }
      const health = canaryHealth(execFile, context, preflight.inputs.candidateInput);
      samples.push({
        index: index + 1,
        asOf: sampledAt.toISOString(),
        pass: health.pass,
        checks: health.checks,
        pods: health.pods,
      });
      if (!health.pass) {
        throw new Error(`canary health failed: ${health.checks.filter((check) => !check.pass).map((check) => check.id).join(",")}`);
      }
      if (index + 1 < preflight.inputs.sampleCount) {
        wait(preflight.inputs.sampleIntervalSeconds * 1000);
      }
    }
    const observedMilliseconds = (
      Date.parse(samples.at(-1).asOf) - Date.parse(samples[0].asOf)
    );
    if (observedMilliseconds < preflight.inputs.observationSeconds * 1000) {
      throw new Error("canary observation window was shorter than required");
    }

    promotionAttempted = true;
    promotionResult = deployStaging({
      context,
      expectedClusterUid,
      sourceCommit: preflight.inputs.candidateInput.sourceCommit,
      manifest: preflight.fullManifest,
      releaseInputSha256: stagingReleaseInputSha256(preflight.inputs.candidateInput),
      operatorId,
      changeId,
      acknowledge: "apply-staging",
      evidencePath,
      rolloutTimeoutSeconds,
      execFile,
      now,
    });
    const cleanup = cleanupCanary(execFile, context);
    const completedAt = now();
    const result = {
      ...promotionResult,
      action: "staging-canary-promotion",
      stableSourceCommit: preflight.receipt.stableSourceCommit,
      stableEvidenceSha256: preflight.receipt.stableEvidenceSha256,
      stableManifestSha256: preflight.receipt.stableManifestSha256,
      canaryManifestSha256: preflight.receipt.canaryManifestSha256,
      canaryImageDigest: preflight.receipt.canaryImageDigest,
      canarySamples: samples,
      canaryObservationPassed: true,
      canaryObservedMilliseconds: observedMilliseconds,
      canaryRemoved: true,
      canaryCleanup: cleanup,
      completedAt: completedAt.toISOString(),
    };
    writeEvidence(evidencePath, result);
    return result;
  } catch (error) {
    const failedPromotion = promotionAttempted && promotionResult === undefined
      ? readDeploymentEvidence(evidencePath)
      : null;
    let cleanup = null;
    let cleanupFailure = null;
    if (canaryApplied) {
      try {
        cleanup = cleanupCanary(execFile, context);
      } catch (cleanupError) {
        cleanupFailure = cleanupError.message;
      }
    }
    let automaticRollback = null;
    let automaticRollbackFailure = null;
    if (failedPromotion?.mutationPerformed === true) {
      try {
        const rollbackResult = rollback({
          input: preflight.inputs.stableInput,
          targetEvidencePath: stableEvidencePath,
          targetEvidenceSha256: stableEvidenceSha256,
          runtimeSourceCommit,
          context,
          expectedClusterUid,
          operatorId,
          changeId,
          acknowledge: "rollback-staging",
          evidencePath,
          rolloutTimeoutSeconds,
          execFile,
          now,
        });
        automaticRollback = {
          state: rollbackResult.state,
          sourceCommit: rollbackResult.sourceCommit,
          manifestSha256: rollbackResult.manifestSha256,
          rollbackTargetEvidenceSha256: rollbackResult.rollbackTargetEvidenceSha256,
          deployedStaging: rollbackResult.deployedStaging,
        };
      } catch (rollbackError) {
        automaticRollbackFailure = rollbackError.message;
      }
    }
    const stableRestored = automaticRollback?.state === "deployed-staging-verified"
      && automaticRollback.deployedStaging === true;
    const failed = {
      ...intent,
      failedAt: now().toISOString(),
      state: stableRestored
        ? "candidate-promotion-failed-stable-restored"
        : (failedPromotion?.mutationPerformed === true
          ? "candidate-promotion-failed-rollback-failed"
          : (promotionResult?.deployedStaging === true
            ? (cleanup !== null
              ? "deployed-staging-verified-canary-cleanup-retried"
              : "deployed-staging-verified-canary-cleanup-failed")
            : "canary-promotion-failed")),
      failure: error.message,
      canaryApplied,
      canarySamples: samples,
      canaryObservationPassed: samples.length === preflight.inputs.sampleCount
        && samples.every((sample) => sample.pass),
      canaryRemoved: canaryApplied ? cleanup !== null : true,
      canaryCleanup: cleanup,
      canaryCleanupFailure: cleanupFailure,
      promotionFailureState: failedPromotion?.state ?? null,
      automaticRollbackAttempted: failedPromotion?.mutationPerformed === true,
      automaticRollback,
      automaticRollbackFailure,
      stableRestored,
      candidateMutationPerformed: promotionResult?.mutationPerformed === true
        || failedPromotion?.mutationPerformed === true,
      mutationPerformed: canaryApplied
        || promotionResult?.mutationPerformed === true
        || failedPromotion?.mutationPerformed === true,
      deployedStaging: stableRestored || promotionResult?.deployedStaging === true,
      deployedPublic: false,
    };
    writeEvidence(evidencePath, failed);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const stableInput = JSON.parse(readFileSync(resolve(args["stable-input"]), "utf8"));
    const candidateInput = JSON.parse(readFileSync(resolve(args["candidate-input"]), "utf8"));
    const common = {
      stableInput,
      candidateInput,
      stableEvidencePath: args["stable-evidence"],
      stableEvidenceSha256: args["stable-evidence-sha256"],
      runtimeSourceCommit: args["runtime-source-commit"],
      context: args.context,
      expectedClusterUid: args["cluster-uid"],
      observationSeconds: Number(args["observation-seconds"] ?? 300),
      sampleIntervalSeconds: Number(args["sample-interval-seconds"] ?? 30),
    };
    let result;
    if (command === "preflight") {
      ({ receipt: result } = preflightStagingCanary(common));
    } else if (command === "promote") {
      result = promoteStagingCanary({
        ...common,
        operatorId: args["operator-id"],
        changeId: args["change-id"],
        acknowledge: args.acknowledge,
        evidencePath: args.evidence,
        rolloutTimeoutSeconds: Number(args["rollout-timeout-seconds"] ?? 300),
      });
    } else {
      throw new Error("usage: security-staging-canary.mjs preflight|promote --stable-input PATH --candidate-input PATH --stable-evidence PATH --stable-evidence-sha256 SHA256 --runtime-source-commit SHA [canary flags]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
