#!/usr/bin/env node
/**
 * Restore a previously verified staging release as a complete manifest set.
 *
 * The target is reconstructed from its Git commit and non-secret release input.
 * Its input and manifest hashes must match an externally pinned deployment
 * evidence digest before the shared deployment runtime can mutate the cluster.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployStaging, preflightStagingDeployment } from "./security-deploy.mjs";
import {
  renderStagingReleaseManifest,
  stagingReleaseInputSha256,
  validateStagingReleaseInputs,
} from "./security-stage-release.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const maximumTreeFiles = 500;
const maximumTreeBytes = 16 * 1024 * 1024;

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
  return value;
}

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) throw new Error(`${label} must be sha256`);
  return value;
}

function repositoryPath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath === "") throw new Error(`${label} is required`);
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(`${root}/`)) throw new Error(`${label} must stay inside the repository`);
  return absolute;
}

function runText(execFile, command, args, action) {
  try {
    return execFile(command, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: maximumTreeBytes,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`${action} failed`);
  }
}

function runBlob(execFile, args) {
  try {
    const value = execFile("git", args, {
      cwd: root,
      encoding: null,
      maxBuffer: maximumTreeBytes,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  } catch {
    throw new Error("rollback target tree read failed");
  }
}

export function validateRollbackTarget({
  input: rawInput,
  evidenceBytes,
  expectedEvidenceSha256,
  runtimeSourceCommit,
  requireDistinctRuntime = true,
}) {
  const input = validateStagingReleaseInputs(rawInput);
  fullCommit(runtimeSourceCommit, "runtimeSourceCommit");
  digest(expectedEvidenceSha256, "expectedEvidenceSha256");
  if (!Buffer.isBuffer(evidenceBytes)) throw new Error("target evidence bytes are required");
  if (sha256(evidenceBytes) !== expectedEvidenceSha256) {
    throw new Error("target evidence digest does not match the acknowledged value");
  }
  let evidence;
  try {
    evidence = JSON.parse(evidenceBytes);
  } catch {
    throw new Error("target evidence is not valid JSON");
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("target evidence must be an object");
  }
  if (!new Set(["staging-deployment", "staging-rollback", "staging-canary-promotion"]).has(evidence.action)) {
    throw new Error("target evidence is not a staging deployment receipt");
  }
  if (
    evidence.state !== "deployed-staging-verified"
    || evidence.deployedStaging !== true
    || evidence.mutationPerformed !== true
    || evidence.rolloutVerified !== true
    || evidence.liveManifestReconciled !== true
    || evidence.readiness?.pass !== true
  ) {
    throw new Error("target evidence does not prove a verified staging deployment");
  }
  fullCommit(evidence.sourceCommit, "target evidence sourceCommit");
  digest(evidence.releaseInputSha256, "target evidence releaseInputSha256");
  digest(evidence.manifestSha256, "target evidence manifestSha256");
  if (input.sourceCommit !== evidence.sourceCommit) {
    throw new Error("rollback input sourceCommit does not match target evidence");
  }
  if (stagingReleaseInputSha256(input) !== evidence.releaseInputSha256) {
    throw new Error("rollback input does not match target evidence");
  }
  if (requireDistinctRuntime && runtimeSourceCommit === input.sourceCommit) {
    throw new Error("rollback target must differ from the executing runtime commit");
  }
  return {
    input,
    manifestSha256: evidence.manifestSha256,
    targetEvidenceSha256: expectedEvidenceSha256,
  };
}

export function materializeKubernetesTreeAtCommit({
  sourceCommit,
  execFile = execFileSync,
}) {
  fullCommit(sourceCommit, "rollback target sourceCommit");
  runText(execFile, "git", ["cat-file", "-e", `${sourceCommit}^{commit}`], "rollback target commit verification");
  const listing = runText(
    execFile,
    "git",
    ["ls-tree", "-r", sourceCommit, "--", "infra/k8s"],
    "rollback target tree listing",
  );
  const entries = listing === "" ? [] : listing.split("\n").map((line) => {
    const match = line.match(/^(100644|100755) blob [0-9a-f]{40,64}\t(infra\/k8s\/[A-Za-z0-9._/-]+)$/);
    if (!match || match[2].split("/").includes("..")) {
      throw new Error("rollback target tree contains an unsupported entry");
    }
    return { mode: match[1], path: match[2] };
  });
  if (entries.length === 0 || entries.length > maximumTreeFiles) {
    throw new Error("rollback target Kubernetes tree has an invalid file count");
  }
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error("rollback target Kubernetes tree contains duplicate paths");
  }

  const workspace = mkdtempSync(resolve(tmpdir(), "ynx-staging-rollback-tree-"));
  let totalBytes = 0;
  try {
    for (const entry of entries) {
      const content = runBlob(execFile, ["show", `${sourceCommit}:${entry.path}`]);
      totalBytes += content.length;
      if (totalBytes > maximumTreeBytes) throw new Error("rollback target Kubernetes tree exceeds the size limit");
      const output = resolve(workspace, entry.path);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, content, { mode: entry.mode === "100755" ? 0o700 : 0o600 });
    }
    return {
      kubernetesRoot: resolve(workspace, "infra/k8s"),
      files: entries.length,
      bytes: totalBytes,
      cleanup: () => rmSync(workspace, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

function loadRollbackTarget({
  input,
  targetEvidencePath,
  targetEvidenceSha256,
  runtimeSourceCommit,
}) {
  const evidencePath = repositoryPath(targetEvidencePath, "targetEvidencePath");
  let evidenceBytes;
  try {
    evidenceBytes = readFileSync(evidencePath);
  } catch {
    throw new Error("target evidence read failed");
  }
  return validateRollbackTarget({
    input,
    evidenceBytes,
    expectedEvidenceSha256: targetEvidenceSha256,
    runtimeSourceCommit,
  });
}

function renderRollbackManifest({
  target,
  execFile,
  materializeTree,
}) {
  const tree = materializeTree({
    sourceCommit: target.input.sourceCommit,
    execFile,
  });
  try {
    const manifest = renderStagingReleaseManifest(target.input, {
      execFile,
      kubernetesSourceRoot: tree.kubernetesRoot,
    });
    if (sha256(manifest) !== target.manifestSha256) {
      throw new Error("reconstructed rollback manifest does not match target evidence");
    }
    return manifest;
  } finally {
    tree.cleanup();
  }
}

export function preflightStagingRollback({
  input,
  targetEvidencePath,
  targetEvidenceSha256,
  runtimeSourceCommit,
  context,
  expectedClusterUid,
  execFile = execFileSync,
  materializeTree = materializeKubernetesTreeAtCommit,
  now = new Date(),
}) {
  const target = loadRollbackTarget({
    input,
    targetEvidencePath,
    targetEvidenceSha256,
    runtimeSourceCommit,
  });
  const manifest = renderRollbackManifest({ target, execFile, materializeTree });
  return preflightStagingDeployment({
    context,
    expectedClusterUid,
    sourceCommit: target.input.sourceCommit,
    runtimeSourceCommit,
    operation: "rollback",
    rollbackTargetEvidenceSha256: target.targetEvidenceSha256,
    manifest,
    releaseInputSha256: stagingReleaseInputSha256(target.input),
    execFile,
    now,
  });
}

export function rollbackStaging({
  input,
  targetEvidencePath,
  targetEvidenceSha256,
  runtimeSourceCommit,
  context,
  expectedClusterUid,
  operatorId,
  changeId,
  acknowledge,
  evidencePath,
  rolloutTimeoutSeconds = 300,
  execFile = execFileSync,
  materializeTree = materializeKubernetesTreeAtCommit,
  now = () => new Date(),
}) {
  const target = loadRollbackTarget({
    input,
    targetEvidencePath,
    targetEvidenceSha256,
    runtimeSourceCommit,
  });
  const manifest = renderRollbackManifest({ target, execFile, materializeTree });
  return deployStaging({
    context,
    expectedClusterUid,
    sourceCommit: target.input.sourceCommit,
    runtimeSourceCommit,
    operation: "rollback",
    rollbackTargetEvidenceSha256: target.targetEvidenceSha256,
    manifest,
    releaseInputSha256: stagingReleaseInputSha256(target.input),
    operatorId,
    changeId,
    acknowledge,
    evidencePath,
    rolloutTimeoutSeconds,
    execFile,
    now,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const input = JSON.parse(readFileSync(resolve(args.input), "utf8"));
    const common = {
      input,
      targetEvidencePath: args["target-evidence"],
      targetEvidenceSha256: args["target-evidence-sha256"],
      runtimeSourceCommit: args["runtime-source-commit"],
      context: args.context,
      expectedClusterUid: args["cluster-uid"],
    };
    let result;
    if (command === "preflight") {
      ({ receipt: result } = preflightStagingRollback(common));
    } else if (command === "rollback") {
      result = rollbackStaging({
        ...common,
        operatorId: args["operator-id"],
        changeId: args["change-id"],
        acknowledge: args.acknowledge,
        evidencePath: args.evidence,
        rolloutTimeoutSeconds: Number(args["rollout-timeout-seconds"] ?? 300),
      });
    } else {
      throw new Error("usage: security-staging-rollback.mjs preflight|rollback --input PATH --target-evidence PATH --target-evidence-sha256 SHA256 --runtime-source-commit SHA [deployment flags]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
