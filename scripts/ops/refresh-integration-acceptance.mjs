#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const registryPath = "release/integration/product-registry.json";
const matrixPath = "release/integration/acceptance-matrix.json";
const githubEvidencePath = "release/integration/github-evidence.json";
const githubRepository = "JiahaoAlbus/YNX-Chain";
const allowedStatuses = new Set([
  "notStarted",
  "inProgress",
  "implementedLocal",
  "testedLocal",
  "integratedCentral",
  "testnetVerified",
  "publicVerified",
  "externalBlocked",
  "notApplicable",
  "verifiedComplete"
]);
const releaseStateKeys = [
  "implementedLocal",
  "testedLocal",
  "installedLocal",
  "integratedCentral",
  "deployedStaging",
  "deployedPublic",
  "downloadHosted",
  "productionSigned",
  "storeReleased"
];

function fail(message) {
  console.error(`integration acceptance refresh failed: ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: process.env
  });
  if (result.error) {
    if (options.allowFailure) return null;
    throw result.error;
  }
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    const detail = String(result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`${command} ${commandArgs.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout ?? "");
}

function git(commandArgs, options = {}) {
  return run("git", commandArgs, options);
}

function gh(commandArgs, options = {}) {
  return run("gh", commandArgs, options);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeBranchRef(branch) {
  return branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;
}

function refSha(ref) {
  const value = git(["rev-parse", "--verify", ref], { allowFailure: true });
  const sha = value?.trim() ?? "";
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function aheadBehind(left, right) {
  if (!left || !right) return { ahead: null, behind: null };
  const value = git(["rev-list", "--left-right", "--count", `${left}...${right}`], { allowFailure: true });
  if (!value) return { ahead: null, behind: null };
  const [ahead, behind] = value.trim().split(/\s+/).map((entry) => Number.parseInt(entry, 10));
  return {
    ahead: Number.isSafeInteger(ahead) ? ahead : null,
    behind: Number.isSafeInteger(behind) ? behind : null
  };
}

function sanitizeRemote(value) {
  if (typeof value !== "string") return null;
  return value.replace(/\/\/[^/@]+@/, "//[redacted]@").trim();
}

function parseWorktrees(raw) {
  const records = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: line.slice("worktree ".length), head: null, branch: null, detached: false };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch ")) {
      current.branch = normalizeBranchRef(line.slice("branch ".length));
    } else if (current && line === "detached") {
      current.detached = true;
    }
  }
  if (current) records.push(current);
  return records;
}

function inspectWorktree(record) {
  if (!record?.path) {
    return {
      registered: false,
      pathToken: null,
      observedHead: null,
      clean: null,
      changedEntries: null,
      statusError: null
    };
  }
  const status = git(["-C", record.path, "status", "--porcelain=v1", "-z"], { allowFailure: true });
  if (status === null) {
    return {
      registered: true,
      pathToken: path.basename(record.path),
      observedHead: record.head,
      clean: null,
      changedEntries: null,
      statusError: "git status unavailable"
    };
  }
  const entries = status.length === 0 ? [] : status.split("\0").filter(Boolean);
  return {
    registered: true,
    pathToken: path.basename(record.path),
    observedHead: record.head,
    clean: entries.length === 0,
    changedEntries: entries.length,
    statusError: null
  };
}

function treePaths(commit) {
  if (!commit) return [];
  const raw = git(["ls-tree", "-r", "--name-only", commit], { allowFailure: true });
  return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
}

function firstExisting(paths, candidates, basenames = []) {
  for (const candidate of candidates) {
    if (paths.includes(candidate)) return candidate;
  }
  for (const basename of basenames) {
    const matches = paths.filter((entry) => path.posix.basename(entry) === basename).sort();
    if (matches.length > 0) return matches[0];
  }
  return null;
}

function readJsonAtCommit(commit, relativePath) {
  if (!commit || !relativePath) return null;
  const raw = git(["show", `${commit}:${relativePath}`], { allowFailure: true });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sourceBinding(record, tipCommit) {
  const sourceCommit = typeof record?.sourceCommit === "string" ? record.sourceCommit : null;
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "") || !tipCommit) {
    return { sourceCommit, valid: false, exact: false, reachable: false, distance: null };
  }
  const exact = sourceCommit === tipCommit;
  const reachableResult = git(["merge-base", "--is-ancestor", sourceCommit, tipCommit], { allowFailure: true });
  const reachable = exact || reachableResult !== null;
  let distance = null;
  if (reachable) {
    const raw = git(["rev-list", "--count", `${sourceCommit}..${tipCommit}`], { allowFailure: true });
    const parsed = Number.parseInt(raw?.trim() ?? "", 10);
    distance = Number.isSafeInteger(parsed) ? parsed : null;
  }
  return {
    sourceCommit,
    valid: reachable && distance !== null,
    exact,
    reachable,
    distance
  };
}

function extractReleaseStates(record) {
  const result = {};
  for (const key of releaseStateKeys) {
    result[key] = typeof record?.states?.[key] === "boolean" ? record.states[key] : null;
  }
  return result;
}

function extractCoverage(record) {
  const items = Array.isArray(record?.items)
    ? record.items
    : Array.isArray(record?.requirements)
      ? record.requirements
      : [];
  const counts = Object.fromEntries([...allowedStatuses].map((status) => [status, 0]));
  let invalid = 0;
  for (const item of items) {
    if (allowedStatuses.has(item?.status)) counts[item.status] += 1;
    else invalid += 1;
  }
  const open = items.filter((item) => !["verifiedComplete", "externalBlocked", "notApplicable"].includes(item?.status)).length;
  return { total: items.length, open, invalid, counts };
}

function normalizeIdentity(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function recordMatchesProduct(record, product) {
  if (!record || typeof record !== "object") return false;
  const exactCandidates = [
    [record.owner, product.owner],
    [record.productId, product.id],
    [record.id, product.id],
    [record.slug, product.slug],
    [record.productSlug, product.slug],
    [record.branch, product.branch]
  ];
  if (exactCandidates.some(([actual, expected]) => typeof actual === "string" && actual === expected)) return true;
  const expectedProduct = normalizeIdentity(product.product);
  return [record.product, record.productName, record.name]
    .map(normalizeIdentity)
    .some((identity) => identity.length > 0 && identity === expectedProduct);
}

function discoverEvidencePaths(product, paths) {
  const slug = product.slug;
  const integrationProduct = product.id === "29";
  return {
    fullGoalCoverage: firstExisting(paths, [".ai-bridge/full-goal-coverage.json"], ["full-goal-coverage.json"]),
    productRelease: firstExisting(
      paths,
      integrationProduct
        ? ["release/integration/product-release.json", "release/product-release.json", "product-release.json"]
        : [`release/${slug}/product-release.json`, "release/product-release.json", "product-release.json"],
      ["product-release.json"]
    ),
    publicMetadata: firstExisting(
      paths,
      integrationProduct
        ? ["release/integration/public-product-metadata.json", "release/public-product-metadata.json", "public-product-metadata.json"]
        : [`release/${slug}/public-product-metadata.json`, "release/public-product-metadata.json", "public-product-metadata.json"],
      ["public-product-metadata.json"]
    ),
    integrationContract: firstExisting(
      paths,
      integrationProduct
        ? ["release/integration/integration-contract.json", `release/integration/${slug}-contract.json`]
        : [`release/integration/${slug}-contract.json`, "release/integration/integration-contract.json"],
      ["integration-contract.json", `${slug}-contract.json`]
    ),
    integrationHandoff: firstExisting(paths, ["docs/integration/INTEGRATION_HANDOFF.md", `docs/handoffs/${slug}.md`], ["INTEGRATION_HANDOFF.md"]),
    crossProductTestVectors: firstExisting(paths, ["docs/integration/CROSS_PRODUCT_TEST_VECTORS.json", "release/integration/CROSS_PRODUCT_TEST_VECTORS.json"], ["CROSS_PRODUCT_TEST_VECTORS.json"]),
    dependencyAcceptance: firstExisting(paths, ["docs/integration/DEPENDENCY_ACCEPTANCE.md"], ["DEPENDENCY_ACCEPTANCE.md"])
  };
}

function deriveAcceptance({ localExists, remoteExists, synced, worktree, evidence, coverage, bindings, recordMatches }) {
  const blockers = [];
  if (!localExists) blockers.push("local final branch is missing");
  if (!remoteExists) blockers.push("remote final branch is missing");
  if (localExists && remoteExists && !synced) blockers.push("local and remote final branch SHAs differ");
  if (worktree.registered !== true) blockers.push("registered final worktree is missing");
  if (worktree.clean === false) blockers.push("registered final worktree has uncommitted changes");
  if (worktree.clean === null && worktree.registered) blockers.push("registered final worktree status could not be read");

  const requiredEvidence = [
    ["full-goal coverage", evidence.fullGoalCoverage],
    ["product release", evidence.productRelease],
    ["public metadata", evidence.publicMetadata],
    ["integration contract", evidence.integrationContract],
    ["integration handoff", evidence.integrationHandoff],
    ["cross-product test vectors", evidence.crossProductTestVectors],
    ["dependency acceptance", evidence.dependencyAcceptance]
  ];
  for (const [label, value] of requiredEvidence) {
    if (!value) blockers.push(`${label} is missing from the branch tree`);
  }
  for (const [label, matches] of Object.entries(recordMatches)) {
    if (evidence[label] && !matches) blockers.push(`${label} belongs to a different product or authority owner`);
  }
  if (evidence.fullGoalCoverage && (coverage.total === 0 || coverage.invalid > 0)) {
    blockers.push("full-goal coverage is empty or contains an invalid status");
  }
  if (coverage.open > 0) blockers.push(`full-goal coverage has ${coverage.open} autonomous or unresolved items`);
  for (const [label, binding] of Object.entries(bindings)) {
    if (binding.sourceCommit && (!binding.reachable || binding.distance === null)) {
      blockers.push(`${label} sourceCommit is not reachable from the final branch`);
    }
  }

  const branchReady = localExists && remoteExists && synced && worktree.registered && worktree.clean === true;
  const evidenceReady = requiredEvidence.every(([, value]) => Boolean(value)) && Object.values(recordMatches).every(Boolean);
  const sourceBound = [bindings.fullGoalCoverage, bindings.productRelease, bindings.publicMetadata, bindings.integrationContract]
    .filter((binding) => binding.sourceCommit)
    .every((binding) => binding.reachable && binding.distance !== null && binding.distance <= 5);

  if (!localExists && !remoteExists) {
    return {
      status: "notStarted",
      reason: "No local or remote final branch is available for central review.",
      blockers,
      nextAction: "Create and push the declared final branch without changing another worktree."
    };
  }
  if (branchReady && evidenceReady && sourceBound) {
    return {
      status: "implementedLocal",
      reason: "The final branch is synchronized and clean, and the required owner evidence bundle is present and source-reachable; central tests and acceptance remain pending.",
      blockers,
      nextAction: "Run owner contract tests, central negative vectors, artifact verification and dependency acceptance before promotion."
    };
  }
  return {
    status: "inProgress",
    reason: "A candidate final branch exists, but synchronization, worktree protection or the required evidence bundle is incomplete.",
    blockers,
    nextAction: blockers[0] ? `Resolve: ${blockers[0]}.` : "Complete the product evidence bundle and submit it for central review."
  };
}

function validateRegistry(registry) {
  if (registry?.schemaVersion !== "1.0.0") fail("product registry schemaVersion must be 1.0.0");
  if (!Array.isArray(registry.products) || registry.products.length !== 36) fail("product registry must contain exactly 36 products");
  const ids = registry.products.map((product) => product.id);
  const expected = Array.from({ length: 36 }, (_, index) => String(index + 1).padStart(2, "0"));
  if (JSON.stringify(ids) !== JSON.stringify(expected)) fail("product registry IDs must be the ordered range 01 through 36");
  const branches = new Set();
  for (const product of registry.products) {
    if (!/^codex\/final-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.branch ?? "")) fail(`invalid branch for product ${product.id}`);
    if (branches.has(product.branch)) fail(`duplicate final branch ${product.branch}`);
    branches.add(product.branch);
    for (const dependency of product.dependencies ?? []) {
      if (!expected.includes(dependency)) fail(`product ${product.id} references unknown dependency ${dependency}`);
      if (dependency === product.id) fail(`product ${product.id} depends on itself`);
    }
  }
}

function runSelfTest() {
  const parsed = parseWorktrees("worktree /tmp/a\nHEAD 0123456789012345678901234567890123456789\nbranch refs/heads/codex/final-a\n\nworktree /tmp/b\nHEAD 1111111111111111111111111111111111111111\ndetached\n");
  if (parsed.length !== 2 || parsed[0].branch !== "codex/final-a" || parsed[1].detached !== true) fail("worktree parser self-test failed");
  if (sanitizeRemote("https://token@github.com/example/repo.git") !== "https://[redacted]@github.com/example/repo.git") fail("remote sanitization self-test failed");
  const registry = readJson(registryPath);
  validateRegistry(registry);
  const head = refSha("HEAD");
  const binding = sourceBinding({ sourceCommit: head }, head);
  if (!binding.valid || !binding.exact || binding.distance !== 0) fail("source binding self-test failed");
  console.log("integration acceptance refresh self-test passed");
}

function githubQuery(commandArgs, attempts = 2) {
  let error = "GitHub query did not run";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("gh", commandArgs, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: process.env
    });
    if (!result.error && result.status === 0) {
      return { ok: true, stdout: String(result.stdout ?? ""), attempts: attempt, error: null };
    }
    error = String(result.error?.message ?? result.stderr ?? result.stdout ?? `exit ${result.status}`).trim();
  }
  return { ok: false, stdout: "", attempts, error: error.slice(0, 1000) };
}

function parseGithubJson(query, label) {
  if (!query.ok) return { ...query, data: null };
  try {
    return { ...query, data: JSON.parse(query.stdout) };
  } catch (error) {
    return { ...query, ok: false, data: null, error: `${label} JSON parse failed: ${error.message}` };
  }
}

function artifactClassHints(name) {
  const normalized = String(name ?? "").toLowerCase();
  return {
    preview: normalized.includes("preview"),
    simulator: normalized.includes("simulator"),
    unsigned: normalized.includes("unsigned"),
    testSigned: normalized.includes("test-signed") || normalized.includes("test_signed"),
    productionSigned: normalized.includes("production-signed")
  };
}

function collectGithubEvidence(controllerSourceCommit, generatedAt) {
  const runResult = parseGithubJson(githubQuery([
    "run", "list", "--repo", githubRepository, "--limit", "200", "--json",
    "databaseId,name,workflowName,headBranch,headSha,status,conclusion,event,createdAt,updatedAt,url"
  ]), "Actions runs");
  const releaseResult = parseGithubJson(githubQuery([
    "release", "list", "--repo", githubRepository, "--limit", "100", "--json",
    "name,tagName,isDraft,isPrerelease,isImmutable,isLatest,createdAt,publishedAt"
  ]), "Releases");
  const artifactResult = parseGithubJson(githubQuery([
    "api", `repos/${githubRepository}/actions/artifacts`, "--paginate", "--slurp"
  ]), "Artifacts");

  const runs = Array.isArray(runResult.data) ? runResult.data : [];
  const releases = Array.isArray(releaseResult.data) ? releaseResult.data : [];
  const artifactPages = Array.isArray(artifactResult.data) ? artifactResult.data : [];
  const artifacts = artifactPages.flatMap((page) => page?.artifacts ?? []).map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    digest: artifact.digest ?? null,
    sizeInBytes: artifact.size_in_bytes,
    expired: artifact.expired,
    createdAt: artifact.created_at,
    expiresAt: artifact.expires_at,
    headBranch: artifact.workflow_run?.head_branch ?? null,
    headSha: artifact.workflow_run?.head_sha ?? null,
    workflowRunId: artifact.workflow_run?.id ?? null,
    classHints: artifactClassHints(artifact.name)
  }));

  return {
    schemaVersion: "1.0.0",
    owner: "29-integration",
    repository: githubRepository,
    generatedAt,
    controllerSourceCommit,
    limits: {
      runs: 200,
      releases: 100,
      artifactPagination: true
    },
    availability: {
      runs: runResult.ok,
      releases: releaseResult.ok,
      artifacts: artifactResult.ok
    },
    queryAttempts: {
      runs: runResult.attempts,
      releases: releaseResult.attempts,
      artifacts: artifactResult.attempts
    },
    queryErrors: {
      runs: runResult.error,
      releases: releaseResult.error,
      artifacts: artifactResult.error
    },
    summary: {
      runs: runResult.ok ? runs.length : null,
      runsTruncated: runResult.ok ? runs.length === 200 : null,
      successfulRuns: runResult.ok ? runs.filter((run) => run.conclusion === "success").length : null,
      releases: releaseResult.ok ? releases.length : null,
      prereleases: releaseResult.ok ? releases.filter((release) => release.isPrerelease).length : null,
      artifacts: artifactResult.ok ? artifacts.length : null,
      activeArtifacts: artifactResult.ok ? artifacts.filter((artifact) => artifact.expired === false).length : null
    },
    runs,
    releases,
    artifacts
  };
}

function main() {
  if (args.has("--self-test")) {
    runSelfTest();
    return;
  }

  const registry = readJson(registryPath);
  validateRegistry(registry);
  const generatedAt = new Date().toISOString();
  const controllerSourceCommit = refSha("HEAD");
  if (!controllerSourceCommit) fail("unable to resolve HEAD");
  const currentBranch = git(["branch", "--show-current"]).trim();
  const upstreamRefRaw = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowFailure: true });
  const upstreamRef = upstreamRefRaw?.trim() || null;
  const remoteHead = upstreamRef ? refSha(upstreamRef) : null;
  const repositoryDistance = aheadBehind(controllerSourceCommit, remoteHead);
  const currentStatus = git(["status", "--porcelain=v1", "-z"]);
  const origin = sanitizeRemote(git(["remote", "get-url", "origin"], { allowFailure: true })?.trim() ?? null);
  const worktreeRecords = parseWorktrees(git(["worktree", "list", "--porcelain"]));
  const worktreesByBranch = new Map(worktreeRecords.filter((record) => record.branch).map((record) => [record.branch, record]));
  const productRows = [];

  for (const product of registry.products) {
    const localRef = `refs/heads/${product.branch}`;
    const remoteRef = `refs/remotes/origin/${product.branch}`;
    const localSha = refSha(localRef);
    const remoteSha = refSha(remoteRef);
    const distance = aheadBehind(localSha, remoteSha);
    const branchConfigRemote = git(["config", "--get", `branch.${product.branch}.remote`], { allowFailure: true })?.trim() || null;
    const branchConfigMerge = git(["config", "--get", `branch.${product.branch}.merge`], { allowFailure: true })?.trim() || null;
    const expectedMerge = `refs/heads/${product.branch}`;
    const worktree = inspectWorktree(worktreesByBranch.get(product.branch));
    const commitForEvidence = localSha ?? remoteSha;
    const paths = treePaths(commitForEvidence);
    const evidencePaths = discoverEvidencePaths(product, paths);
    const fullGoalCoverage = readJsonAtCommit(commitForEvidence, evidencePaths.fullGoalCoverage);
    const productRelease = readJsonAtCommit(commitForEvidence, evidencePaths.productRelease);
    const publicMetadata = readJsonAtCommit(commitForEvidence, evidencePaths.publicMetadata);
    const integrationContract = readJsonAtCommit(commitForEvidence, evidencePaths.integrationContract);
    const coverage = extractCoverage(fullGoalCoverage);
    const bindings = {
      fullGoalCoverage: sourceBinding(fullGoalCoverage, commitForEvidence),
      productRelease: sourceBinding(productRelease, commitForEvidence),
      publicMetadata: sourceBinding(publicMetadata, commitForEvidence),
      integrationContract: sourceBinding(integrationContract, commitForEvidence)
    };
    const recordMatches = {
      fullGoalCoverage: recordMatchesProduct(fullGoalCoverage, product),
      productRelease: recordMatchesProduct(productRelease, product),
      publicMetadata: recordMatchesProduct(publicMetadata, product),
      integrationContract: recordMatchesProduct(integrationContract, product)
    };
    const localExists = Boolean(localSha);
    const remoteExists = Boolean(remoteSha);
    const synced = localExists && remoteExists && localSha === remoteSha;
    const acceptance = deriveAcceptance({
      localExists,
      remoteExists,
      synced,
      worktree,
      evidence: evidencePaths,
      coverage,
      bindings,
      recordMatches
    });
    const localShaAfter = refSha(localRef);
    const stableDuringScan = localShaAfter === localSha;
    if (!stableDuringScan) acceptance.blockers.unshift("local final branch moved during the central scan");

    productRows.push({
      id: product.id,
      product: product.product,
      branch: product.branch,
      phase: product.phase,
      owner: product.owner,
      dependencies: product.dependencies,
      refs: {
        localExists,
        remoteExists,
        localSha,
        remoteSha,
        ahead: distance.ahead,
        behind: distance.behind,
        upstreamConfigured: branchConfigRemote === "origin" && branchConfigMerge === expectedMerge,
        upstreamRef: branchConfigRemote && branchConfigMerge ? `${branchConfigRemote}/${branchConfigMerge.replace("refs/heads/", "")}` : null,
        synced,
        stableDuringScan
      },
      worktree,
      evidence: {
        paths: evidencePaths,
        coverage,
        recordMatches,
        sourceBindings: bindings,
        claimedReleaseStates: extractReleaseStates(productRelease),
        exactCommitBound: Object.values(bindings).filter((binding) => binding.sourceCommit).every((binding) => binding.exact)
      },
      centralAcceptance: {
        status: acceptance.status,
        reason: acceptance.reason,
        acceptedSourceCommit: null,
        acceptedBy: "29-integration",
        acceptedAt: null
      },
      blockers: acceptance.blockers,
      nextAction: acceptance.nextAction
    });
  }

  const productById = new Map(productRows.map((product) => [product.id, product]));
  for (const product of productRows) {
    const unavailableDependencies = product.dependencies.filter((dependency) => productById.get(dependency)?.refs.remoteExists !== true);
    if (unavailableDependencies.length > 0) {
      product.blockers.push(`required remote dependency branches unavailable: ${unavailableDependencies.join(", ")}`);
    }
  }

  const matrix = {
    $schema: "./schemas/acceptance-matrix.schema.json",
    schemaVersion: "1.0.0",
    owner: "29-integration",
    generatedAt,
    controllerSourceCommit,
    repository: {
      origin,
      currentBranch,
      localHead: controllerSourceCommit,
      upstreamRef,
      remoteHead,
      ahead: repositoryDistance.ahead,
      behind: repositoryDistance.behind,
      clean: currentStatus.length === 0
    },
    summary: {
      totalProducts: productRows.length,
      localBranches: productRows.filter((product) => product.refs.localExists).length,
      remoteBranches: productRows.filter((product) => product.refs.remoteExists).length,
      registeredWorktrees: productRows.filter((product) => product.worktree.registered).length,
      cleanWorktrees: productRows.filter((product) => product.worktree.clean === true).length,
      dirtyWorktrees: productRows.filter((product) => product.worktree.clean === false).length,
      syncedBranches: productRows.filter((product) => product.refs.synced).length,
      upstreamConfigured: productRows.filter((product) => product.refs.upstreamConfigured).length,
      implementedLocalCandidates: productRows.filter((product) => product.centralAcceptance.status === "implementedLocal").length,
      inProgress: productRows.filter((product) => product.centralAcceptance.status === "inProgress").length,
      notStarted: productRows.filter((product) => product.centralAcceptance.status === "notStarted").length,
      centrallyAccepted: productRows.filter((product) => product.centralAcceptance.acceptedSourceCommit !== null).length
    },
    products: productRows
  };

  writeJson(matrixPath, matrix);
  if (args.has("--github")) {
    writeJson(githubEvidencePath, collectGithubEvidence(controllerSourceCommit, generatedAt));
  }
  console.log(`wrote ${matrixPath} for ${matrix.summary.totalProducts} products`);
  if (args.has("--github")) console.log(`wrote ${githubEvidencePath}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
