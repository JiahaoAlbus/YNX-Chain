#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const matrixPath = resolve(process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]) ?? "release/integration/wallet-auth-release-evidence-matrix.json");
const remote = process.argv.includes("--remote");
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const failures = [];
const fail = (message) => failures.push(message);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

if (matrix.schemaVersion !== 1) fail("schemaVersion must be 1");
if (!Array.isArray(matrix.requiredGates) || matrix.requiredGates.length === 0) fail("requiredGates must be non-empty");
const requiredGates = new Set(matrix.requiredGates ?? []);
const evidence = matrix.evidence ?? {};
const owners = new Map();
let remoteBranches = null;
let remoteRuns = null;

if (remote) {
  try {
    const refs = (matrix.ownerSources ?? []).map((owner) => `refs/heads/${owner.branch}`);
    const output = execFileSync("git", ["ls-remote", "--heads", "origin", ...refs], { encoding: "utf8", timeout: 30000 });
    remoteBranches = new Map(output.trim().split("\n").filter(Boolean).map((line) => {
      const [sha, ref] = line.split(/\s+/);
      return [ref, sha];
    }));
  } catch (error) {
    fail(`bounded remote branch snapshot failed: ${error.message}`);
  }
  if (Object.values(evidence).some((item) => item.type === "github-action")) {
    try {
      const actions = JSON.parse(execFileSync("gh", ["api", "repos/JiahaoAlbus/YNX-Chain/actions/runs?per_page=30"], { encoding: "utf8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 }));
      remoteRuns = new Map(actions.workflow_runs.map((run) => [run.id, run]));
    } catch (error) {
      fail(`bounded remote Actions snapshot failed: ${error.message}`);
    }
  }
}

for (const owner of matrix.ownerSources ?? []) {
  if (!owner.owner || owners.has(owner.owner)) fail(`duplicate or missing owner source: ${owner.owner ?? "<missing>"}`);
  owners.set(owner.owner, owner);
  for (const field of ["sourceCommit", "remoteCommitObserved"]) {
    if (!/^[0-9a-f]{40}$/.test(owner[field] ?? "")) fail(`${owner.owner}.${field} must be a full commit SHA`);
  }
  if (owner.branchHeadObserved && !/^[0-9a-f]{40}$/.test(owner.branchHeadObserved)) fail(`${owner.owner}.branchHeadObserved must be a full commit SHA`);
  if (owner.sourceCommit !== owner.remoteCommitObserved) fail(`${owner.owner} was not frozen at the observed remote commit`);
  try {
    git("cat-file", "-e", `${owner.sourceCommit}^{commit}`);
  } catch {
    fail(`${owner.owner} source commit is missing locally: ${owner.sourceCommit}`);
  }
  if (remote && remoteBranches) {
    const liveCommit = remoteBranches?.get(`refs/heads/${owner.branch}`);
    if (!liveCommit) fail(`${owner.owner} remote branch is missing: ${owner.branch}`);
    const expectedHead = owner.branchHeadObserved ?? owner.sourceCommit;
    if (liveCommit && liveCommit !== expectedHead) fail(`${owner.owner} remote branch drifted: expected ${expectedHead}, observed ${liveCommit}`);
    if (liveCommit && liveCommit !== owner.sourceCommit) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", owner.sourceCommit, liveCommit], { stdio: "ignore" });
      } catch {
        fail(`${owner.owner} frozen source is not an ancestor of observed branch head`);
      }
    }
  }
}

const frozenSourceCommits = new Set((matrix.ownerSources ?? []).map((owner) => owner.sourceCommit));
for (const pending of matrix.pendingOwnerCommits ?? []) {
  if (!/^[0-9a-f]{40}$/.test(pending.commit ?? "")) fail(`${pending.owner ?? "pending owner"}.commit must be a full SHA`);
  if (pending.localCommitted !== true || pending.pushPending !== true) fail(`${pending.commit} must remain localCommitted=true and pushPending=true`);
  if (pending.centralIntegrated !== false || pending.consumedForReleaseTruth !== false) fail(`${pending.commit} must not be centrally integrated or consumed for release truth`);
  if (frozenSourceCommits.has(pending.commit)) fail(`${pending.commit} cannot be both push-pending and a frozen remote source`);
}
for (const pending of matrix.pendingOwnerEvidence ?? []) {
  if (pending.consumedForReleaseTruth !== false) fail(`${pending.owner ?? "pending evidence"} must not be consumed for release truth`);
  if (pending.candidateCommit && !/^[0-9a-f]{40}$/.test(pending.candidateCommit)) fail(`${pending.owner}.candidateCommit must be a full SHA`);
  if (pending.candidateCommitAbbrev && !/^[0-9a-f]{7,39}$/.test(pending.candidateCommitAbbrev)) fail(`${pending.owner}.candidateCommitAbbrev must be an abbreviated SHA`);
  if (pending.workflowRunId != null && !Number.isSafeInteger(pending.workflowRunId)) fail(`${pending.owner}.workflowRunId must be an integer`);
  if (pending.remoteReadbackComplete === false || pending.ciComplete === false) {
    const candidate = pending.candidateCommit ?? pending.candidateCommitAbbrev;
    if (candidate && [...frozenSourceCommits].some((source) => source === candidate || source.startsWith(candidate))) fail(`${pending.owner} incomplete evidence cannot be a frozen source`);
  }
}

for (const [id, item] of Object.entries(evidence)) {
  if (item.direct !== true) fail(`${id} must explicitly declare direct=true`);
  if (!Array.isArray(item.supports)) fail(`${id}.supports must be an array`);
  if (item.type === "git-object") {
    if (!/^[0-9a-f]{40}$/.test(item.commit ?? "")) fail(`${id}.commit must be a full SHA`);
    if (!item.path || item.path.startsWith("/") || item.path.split("/").includes("..")) fail(`${id}.path must be repository-relative`);
    try {
      git("cat-file", "-e", `${item.commit}:${item.path}`);
    } catch {
      fail(`${id} git evidence is missing: ${item.commit}:${item.path}`);
    }
  } else if (item.type === "github-action") {
    if (!Number.isSafeInteger(item.runId)) fail(`${id}.runId must be an integer`);
    if (item.url !== `https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/${item.runId}`) fail(`${id}.url does not match runId`);
    if (!/^[0-9a-f]{40}$/.test(item.sourceCommit ?? "")) fail(`${id}.sourceCommit must be a full SHA`);
    if (remote && remoteRuns) {
      const live = remoteRuns?.get(item.runId);
      if (!live) fail(`${id} exact Actions run was not returned by the bounded remote snapshot`);
      if (live?.head_sha !== item.sourceCommit) fail(`${id} remote head SHA differs`);
      if (item.observedStatus === "completed" && live?.status !== "completed") fail(`${id} completed run regressed to ${live?.status}`);
      if (item.observedConclusion === "success" && live?.conclusion !== "success") fail(`${id} successful run differs: ${live?.conclusion}`);
    }
  } else if (item.type === "public-download") {
    if (!/^[0-9a-f]{40}$/.test(item.commit ?? "")) fail(`${id}.commit must be a full SHA`);
    if (!item.path || item.path.startsWith("/") || item.path.split("/").includes("..")) fail(`${id}.path must be repository-relative`);
    try {
      git("cat-file", "-e", `${item.commit}:${item.path}`);
    } catch {
      fail(`${id} git evidence is missing: ${item.commit}:${item.path}`);
    }
    let publicUrl;
    try {
      publicUrl = new URL(item.url);
    } catch {
      fail(`${id}.url must be an absolute URL`);
    }
    if (publicUrl?.protocol !== "https:" || publicUrl?.hostname !== "www.ynxweb4.com") fail(`${id}.url must use the official HTTPS YNX host`);
    if (!Number.isSafeInteger(item.bytes) || item.bytes <= 0) fail(`${id}.bytes must be a positive integer`);
    if (!/^[0-9a-f]{64}$/.test(item.sha256 ?? "")) fail(`${id}.sha256 must be exact`);
    if (!publicUrl?.pathname.includes(item.sha256 ?? "")) fail(`${id}.url must be content-addressed by the exact SHA-256`);
  } else {
    fail(`${id} has unsupported evidence type: ${item.type}`);
  }
}

const platformIds = new Set();
const forbiddenProductionClass = /(temporary|unpacked|simulator|disposable|unsigned|ad-hoc|local)/i;
let trueGateCount = 0;

for (const platform of matrix.platforms ?? []) {
  if (!platform.id || platformIds.has(platform.id)) fail(`duplicate or missing platform id: ${platform.id ?? "<missing>"}`);
  platformIds.add(platform.id);
  if (!owners.has(platform.ownerSource)) fail(`${platform.id} references unknown ownerSource ${platform.ownerSource}`);
  const gateNames = new Set(Object.keys(platform.gates ?? {}));
  const bindingNames = new Set(Object.keys(platform.evidenceBindings ?? {}));
  for (const gate of requiredGates) {
    if (!gateNames.has(gate) || typeof platform.gates[gate] !== "boolean") fail(`${platform.id}.${gate} must be boolean`);
    if (!bindingNames.has(gate) || !Array.isArray(platform.evidenceBindings[gate])) fail(`${platform.id}.${gate} must have an evidence binding array`);
    const bindings = platform.evidenceBindings[gate] ?? [];
    for (const ref of bindings) if (!evidence[ref]) fail(`${platform.id}.${gate} references unknown evidence ${ref}`);
    if (platform.gates[gate] === true) {
      trueGateCount += 1;
      const claim = `${platform.id}.${gate}`;
      if (!bindings.some((ref) => evidence[ref]?.direct === true && evidence[ref]?.supports?.includes(claim))) {
        fail(`${claim}=true lacks direct evidence that explicitly supports the claim`);
      }
    }
  }
  for (const extra of gateNames) if (!requiredGates.has(extra)) fail(`${platform.id} has unknown gate ${extra}`);
  for (const extra of bindingNames) if (!requiredGates.has(extra)) fail(`${platform.id} has unknown evidence binding ${extra}`);
  if (platform.status?.includes("pending") && Object.values(platform.gates ?? {}).some(Boolean)) fail(`${platform.id} pending status cannot contain true gates`);
  if (forbiddenProductionClass.test(platform.artifactClass ?? "")) {
    if (platform.gates?.productionSigned) fail(`${platform.id} forbidden artifact class cannot be productionSigned`);
    if (platform.gates?.storeReleased) fail(`${platform.id} forbidden artifact class cannot be storeReleased`);
  }
  if (platform.capabilities) {
    for (const [name, value] of Object.entries(platform.capabilities)) {
      if (typeof value !== "boolean") fail(`${platform.id}.capabilities.${name} must be boolean`);
    }
  }
  if (platform.gates?.downloadHosted) {
    const claim = `${platform.id}.downloadHosted`;
    const hostedBindings = platform.evidenceBindings?.downloadHosted ?? [];
    if (!hostedBindings.some((ref) => evidence[ref]?.type === "public-download" && evidence[ref]?.supports?.includes(claim))) {
      fail(`${claim}=true requires a public-download evidence type`);
    }
  }
}

if (platformIds.size === 0) fail("platforms must be non-empty");
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`PASS ${matrix.matrixId}: ${platformIds.size} platforms, ${trueGateCount} true gates, ${Object.keys(evidence).length} evidence records${remote ? ", remote checks enabled" : ""}\n`);
