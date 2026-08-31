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
const decisionsPath = "release/integration/central-acceptance-decisions.json";
const githubRepository = "JiahaoAlbus/YNX-Chain";
const finalWorktreesRoot = path.dirname(root);
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

function validSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function safeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.split(/[\\/]/).includes("..");
}

function validateDecisions(decisions, registry) {
  if (decisions?.schemaVersion !== "1.0.0") fail("central acceptance decisions schemaVersion must be 1.0.0");
  if (decisions?.owner !== "29-integration") fail("central acceptance decisions owner must be 29-integration");
  if (!Array.isArray(decisions?.decisions)) fail("central acceptance decisions must contain a decisions array");
  const products = new Map(registry.products.map((product) => [product.id, product]));
  const seen = new Set();
  for (const decision of decisions.decisions) {
    const product = products.get(decision?.productId);
    if (!product) fail(`central acceptance decision references unknown product ${decision?.productId}`);
    if (seen.has(decision.productId)) fail(`duplicate central acceptance decision for product ${decision.productId}`);
    seen.add(decision.productId);
    if (decision.status !== "integratedCentral") fail(`central acceptance decision ${decision.productId} has unsupported status`);
    if (decision.repository !== (product.repository ?? registry.defaultRepository)) fail(`central acceptance decision ${decision.productId} repository mismatch`);
    if (decision.branch !== product.branch) fail(`central acceptance decision ${decision.productId} branch mismatch`);
    if (!validSha(decision.acceptedSourceCommit)) fail(`central acceptance decision ${decision.productId} source commit is invalid`);
    if (!validSha(decision.integrationCommit)) fail(`central acceptance decision ${decision.productId} integration commit is invalid`);
    if (Number.isNaN(Date.parse(decision.acceptedAt ?? ""))) fail(`central acceptance decision ${decision.productId} acceptedAt is invalid`);
    if (!safeRelativePath(decision.receipt)) fail(`central acceptance decision ${decision.productId} receipt path is invalid`);
  }
  return new Map(decisions.decisions.map((decision) => [decision.productId, decision]));
}

function exactHeadCi(githubEvidence, repository, sourceCommit) {
  if (githubEvidence?.repository !== repository || githubEvidence?.availability?.runs !== true) {
    return { verified: false, runs: [] };
  }
  const runs = (githubEvidence.runs ?? []).filter((run) => run.headSha === sourceCommit);
  return {
    verified: runs.length > 0
      && runs.every((run) => run.status === "completed")
      && runs.every((run) => ["success", "skipped", "neutral"].includes(run.conclusion)),
    runs
  };
}

function applyCentralDecision({ acceptance, decision, product, localSha, remoteSha, worktree, controllerSourceCommit, githubEvidence }) {
  if (!decision) {
    return {
      ...acceptance,
      acceptedSourceCommit: null,
      acceptedAt: null,
      decisionEvidence: null,
      integrationCommit: null
    };
  }

  const failures = [];
  if (acceptance.status !== "implementedLocal" || acceptance.blockers.length > 0) failures.push("owner candidate is not acceptance-ready");
  if (decision.acceptedSourceCommit !== localSha || decision.acceptedSourceCommit !== remoteSha) failures.push("decision source differs from synchronized owner refs");
  if (worktree.clean !== true) failures.push("owner worktree is not clean");
  if (git(["merge-base", "--is-ancestor", decision.acceptedSourceCommit, decision.integrationCommit], { allowFailure: true }) === null) {
    failures.push("accepted source is not an ancestor of the integration commit");
  }
  if (git(["merge-base", "--is-ancestor", decision.integrationCommit, controllerSourceCommit], { allowFailure: true }) === null) {
    failures.push("integration commit is not reachable from the controller head");
  }
  const ci = exactHeadCi(githubEvidence, decision.repository, decision.acceptedSourceCommit);
  if (!ci.verified) failures.push("all exact-head owner CI runs are not terminal and successful");
  const receiptPath = path.join(root, decision.receipt);
  let receipt = null;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch {
    failures.push("central acceptance receipt is missing or invalid");
  }
  if (receipt) {
    if (receipt.status !== "passed") failures.push("central acceptance receipt did not pass");
    if (receipt.productId !== product.id) failures.push("central acceptance receipt product mismatch");
    if (receipt.acceptedSourceCommit !== decision.acceptedSourceCommit) failures.push("central acceptance receipt source mismatch");
    if (receipt.integrationCommit !== decision.integrationCommit) failures.push("central acceptance receipt integration commit mismatch");
    if (!Array.isArray(receipt.tests) || receipt.tests.length === 0 || receipt.tests.some((test) => test?.status !== "passed")) {
      failures.push("central acceptance receipt tests are incomplete");
    }
    if (receipt.exactHeadCi?.verified !== true || receipt.exactHeadCi?.sourceCommit !== decision.acceptedSourceCommit) {
      failures.push("central acceptance receipt exact-head CI is incomplete");
    }
  }

  if (failures.length > 0) {
    return {
      status: "inProgress",
      reason: "A central acceptance decision exists but failed closed against current source, integration, CI, or test evidence.",
      blockers: [...new Set([...acceptance.blockers, ...failures])],
      nextAction: `Repair or revoke the stale central decision for Product ${product.id}.`,
      acceptedSourceCommit: null,
      acceptedAt: null,
      decisionEvidence: decision.receipt,
      integrationCommit: decision.integrationCommit
    };
  }

  return {
    status: "integratedCentral",
    reason: "The synchronized owner source, clean worktree, required evidence, exact-head CI, central merge ancestry and central test receipt all passed.",
    blockers: [],
    nextAction: "Keep source acceptance locked and proceed to shared Testnet verification without implying staging, public, signing, store or Mainnet release.",
    acceptedSourceCommit: decision.acceptedSourceCommit,
    acceptedAt: decision.acceptedAt,
    decisionEvidence: decision.receipt,
    integrationCommit: decision.integrationCommit
  };
}

function normalizeBranchRef(branch) {
  return branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;
}

function refSha(ref, cwd = root) {
  const value = git(["rev-parse", "--verify", ref], { allowFailure: true, cwd });
  const sha = value?.trim() ?? "";
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function aheadBehind(left, right, cwd = root) {
  if (!left || !right) return { ahead: null, behind: null };
  const value = git(["rev-list", "--left-right", "--count", `${left}...${right}`], { allowFailure: true, cwd });
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

function repositoryFromRemote(value) {
  const sanitized = sanitizeRemote(value);
  if (!sanitized) return null;
  const match = sanitized.match(/github\.com(?::|\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
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

function treePaths(commit, cwd = root) {
  if (!commit) return [];
  const raw = git(["ls-tree", "-r", "--name-only", commit], { allowFailure: true, cwd });
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

function readJsonAtCommit(commit, relativePath, cwd = root) {
  if (!commit || !relativePath) return null;
  const raw = git(["show", `${commit}:${relativePath}`], { allowFailure: true, cwd });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sourceBinding(record, tipCommit, cwd = root) {
  const sourceCommit = [
    record?.sourceCommit,
    record?.product?.sourceCommit,
    record?.release?.sourceCommit,
    record?.metadata?.sourceCommit,
    record?.current?.sourceCommit,
    record?.source?.implementationCommit
  ].find((value) => typeof value === "string") ?? null;
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "") || !tipCommit) {
    return { sourceCommit, valid: false, exact: false, reachable: false, distance: null };
  }
  const exact = sourceCommit === tipCommit;
  const reachableResult = git(["merge-base", "--is-ancestor", sourceCommit, tipCommit], { allowFailure: true, cwd });
  const reachable = exact || reachableResult !== null;
  let distance = null;
  if (reachable) {
    const raw = git(["rev-list", "--count", `${sourceCommit}..${tipCommit}`], { allowFailure: true, cwd });
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
  const nestedCandidates = [record?.states, record?.releaseStates, record?.releaseStatus];
  const states = nestedCandidates.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate))
    ?? record
    ?? {};
  for (const key of releaseStateKeys) {
    result[key] = typeof states?.[key] === "boolean" ? states[key] : null;
  }
  return result;
}

function extractCoverage(record) {
  const items = Array.isArray(record?.items)
    ? record.items
    : Array.isArray(record?.requirements)
      ? record.requirements
      : Array.isArray(record?.entries)
        ? record.entries
        : [];
  const counts = Object.fromEntries([...allowedStatuses].map((status) => [status, 0]));
  let invalid = 0;
  for (const item of items) {
    if (allowedStatuses.has(item?.status)) counts[item.status] += 1;
    else invalid += 1;
  }
  const openItems = items.filter((item) => ["notStarted", "inProgress"].includes(item?.status));
  const downstreamCategories = new Set([
    "central-integration",
    "testnet-e2e",
    "shared-testnet",
    "public-release",
    "public-deployment",
    "final-preflight"
  ]);
  const downstreamOpen = openItems.filter((item) => downstreamCategories.has(item?.category)).length;
  const autonomousOpen = openItems.length - downstreamOpen;
  const milestoneStatus = new Set(["testedLocal", "integratedCentral", "testnetVerified", "publicVerified", "verifiedComplete"]);
  const milestone = (pattern) => items.some((item) => {
    const searchable = [item?.id, item?.title, item?.category, item?.domain, item?.requirement]
      .filter((value) => typeof value === "string")
      .join(" ");
    return pattern.test(searchable) && milestoneStatus.has(item?.status);
  });
  return {
    total: items.length,
    open: openItems.length,
    autonomousOpen,
    downstreamOpen,
    invalid,
    counts,
    milestones: {
      builtLocal: milestone(/build|package|bundle|artifact/i),
      migrationVerified: milestone(/migration|schema|upgrade/i),
      restoreVerified: milestone(/restore|backup|recovery/i)
    }
  };
}

function normalizeIdentity(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function recordMatchesProduct(record, product) {
  if (!record || typeof record !== "object") return false;
  const nestedProduct = record.product && typeof record.product === "object" ? record.product : {};
  const exactCandidates = [
    [record.owner, product.owner],
    [record.productId, product.id],
    [record.id, product.id],
    [record.slug, product.slug],
    [record.productSlug, product.slug],
    [record.branch, product.branch],
    [nestedProduct.owner, product.owner],
    [String(nestedProduct.number ?? ""), product.id],
    [nestedProduct.slug, product.slug],
    [nestedProduct.branch, product.branch]
  ];
  if (exactCandidates.some(([actual, expected]) => typeof actual === "string" && actual === expected)) return true;
  const expectedIdentities = new Set([
    product.product,
    product.slug,
    product.owner,
    product.id,
    product.branch,
    ...(product.aliases ?? [])
  ].map(normalizeIdentity).filter(Boolean));
  return [
    typeof record.product === "string" ? record.product : null,
    record.productName,
    record.name,
    record.owner,
    record.slug,
    record.productSlug,
    record.productId,
    nestedProduct.id,
    nestedProduct.name,
    nestedProduct.owner,
    nestedProduct.slug
  ]
    .map(normalizeIdentity)
    .some((identity) => identity.length > 0 && expectedIdentities.has(identity));
}

function discoverEvidencePaths(product, paths) {
  const slug = product.slug;
  const integrationProduct = product.id === "29";
  return {
    fullGoalCoverage: firstExisting(paths, [product.fullGoalCoveragePath, ".ai-bridge/full-goal-coverage.json"].filter(Boolean), ["full-goal-coverage.json"]),
    productRelease: firstExisting(
      paths,
      integrationProduct
        ? ["release/integration/product-release.json", "release/product-release.json", "product-release.json"]
        : [product.productReleasePath, `release/${slug}/product-release.json`, `apps/${slug}/product-release.json`, `docs/${slug}/product-release.json`, slug === "governance" ? "release/governance/product-release.json" : null, "release/product-release.json", "product-release.json"].filter(Boolean)
    ),
    publicMetadata: firstExisting(
      paths,
      integrationProduct
        ? ["release/integration/public-product-metadata.json", "release/public-product-metadata.json", "public-product-metadata.json"]
        : [product.publicMetadataPath, `release/${slug}/public-product-metadata.json`, `apps/${slug}/public-product-metadata.json`, `docs/${slug}/public-product-metadata.json`, slug === "governance" ? "release/governance/public-product-metadata.json" : null, "release/public-product-metadata.json", "public-product-metadata.json"].filter(Boolean)
    ),
    integrationContract: firstExisting(
      paths,
      integrationProduct
        ? ["release/integration/integration-contract.json", `release/integration/${slug}-contract.json`]
        : [product.integrationContractPath, `release/integration/${slug}-contract.json`, `release/integration/ynx-${slug}-contract.json`, "release/integration/integration-contract.json"].filter(Boolean)
    ),
    integrationHandoff: firstExisting(paths, [product.integrationHandoffPath, "docs/integration/INTEGRATION_HANDOFF.md", `docs/handoffs/${slug}.md`].filter(Boolean), ["INTEGRATION_HANDOFF.md"]),
    crossProductTestVectors: firstExisting(paths, [product.crossProductTestVectorsPath, "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json", "release/integration/CROSS_PRODUCT_TEST_VECTORS.json"].filter(Boolean), ["CROSS_PRODUCT_TEST_VECTORS.json"]),
    dependencyAcceptance: firstExisting(paths, [product.dependencyAcceptancePath, "docs/integration/DEPENDENCY_ACCEPTANCE.md"].filter(Boolean), ["DEPENDENCY_ACCEPTANCE.md"])
    ,
    releaseState: firstExisting(paths, [product.releaseStatePath].filter(Boolean)),
    artifactRegistry: firstExisting(paths, [product.artifactRegistryPath].filter(Boolean))
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
  if (coverage.autonomousOpen > 0) {
    blockers.push(`full-goal coverage has ${coverage.autonomousOpen} autonomous or unresolved items`);
  }
  for (const [label, binding] of Object.entries(bindings)) {
    if (evidence[label] && !binding.sourceCommit) {
      blockers.push(`${label} lacks an exact sourceCommit`);
    } else if (binding.sourceCommit && (!binding.reachable || binding.distance === null)) {
      blockers.push(`${label} sourceCommit is not reachable from the final branch`);
    }
  }

  const branchReady = localExists && remoteExists && synced && worktree.registered && worktree.clean === true;
  const evidenceReady = requiredEvidence.every(([, value]) => Boolean(value)) && Object.values(recordMatches).every(Boolean);
  const sourceBound = [bindings.fullGoalCoverage, bindings.productRelease, bindings.publicMetadata, bindings.integrationContract]
    .filter((binding) => binding.sourceCommit)
    .every((binding) => binding.reachable && binding.distance !== null);

  if (!localExists && !remoteExists) {
    return {
      status: "notStarted",
      reason: "No local or remote final branch is available for central review.",
      blockers,
      nextAction: "Create and push the declared final branch without changing another worktree."
    };
  }
  if (branchReady && evidenceReady && sourceBound && blockers.length === 0) {
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
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(registry.defaultRepository ?? "")) fail("product registry defaultRepository is invalid");
  const ids = registry.products.map((product) => product.id);
  const expected = Array.from({ length: 36 }, (_, index) => String(index + 1).padStart(2, "0"));
  if (JSON.stringify(ids) !== JSON.stringify(expected)) fail("product registry IDs must be the ordered range 01 through 36");
  const branches = new Set();
  for (const product of registry.products) {
    const repository = product.repository ?? registry.defaultRepository;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail(`invalid repository for product ${product.id}`);
    if (!/^codex\/final-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.branch ?? "")) fail(`invalid branch for product ${product.id}`);
    const branchIdentity = `${repository}#${product.branch}`;
    if (branches.has(branchIdentity)) fail(`duplicate final branch ${branchIdentity}`);
    branches.add(branchIdentity);
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
  validateDecisions(readJson(decisionsPath), registry);
  const head = refSha("HEAD");
  const binding = sourceBinding({ sourceCommit: head }, head);
  if (!binding.valid || !binding.exact || binding.distance !== 0) fail("source binding self-test failed");
  const directStates = extractReleaseStates({ testedLocal: true, releaseStatus: "source-candidate" });
  if (directStates.testedLocal !== true) fail("direct release-state extraction self-test failed");
  const nestedStates = extractReleaseStates({ releaseStatus: { testedLocal: true } });
  if (nestedStates.testedLocal !== true) fail("nested release-state extraction self-test failed");
  console.log("integration acceptance refresh self-test passed");
}

function githubQuery(commandArgs, attempts = 4) {
  let error = "GitHub query did not run";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("gh", commandArgs, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
      timeout: 30_000,
      killSignal: "SIGTERM"
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

function collectGithubEvidence(controllerSourceCommit, generatedAt, decisions) {
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

  const recentRuns = Array.isArray(runResult.data) ? runResult.data : [];
  const exactHeadQueries = {};
  const supplementalRuns = [];
  for (const decision of decisions.decisions) {
    if (recentRuns.some((run) => run.headSha === decision.acceptedSourceCommit)) {
      exactHeadQueries[decision.productId] = {
        branch: decision.branch,
        sourceCommit: decision.acceptedSourceCommit,
        queried: false,
        availableInRecentWindow: true,
        ok: true,
        attempts: 0,
        error: null,
        matchingRuns: recentRuns.filter((run) => run.headSha === decision.acceptedSourceCommit).length
      };
      continue;
    }
    const exactResult = parseGithubJson(githubQuery([
      "run", "list", "--repo", githubRepository, "--branch", decision.branch, "--limit", "100", "--json",
      "databaseId,name,workflowName,headBranch,headSha,status,conclusion,event,createdAt,updatedAt,url"
    ]), `Actions runs for ${decision.branch}`);
    const matchingRuns = Array.isArray(exactResult.data)
      ? exactResult.data.filter((run) => run.headSha === decision.acceptedSourceCommit)
      : [];
    supplementalRuns.push(...matchingRuns);
    exactHeadQueries[decision.productId] = {
      branch: decision.branch,
      sourceCommit: decision.acceptedSourceCommit,
      queried: true,
      availableInRecentWindow: false,
      ok: exactResult.ok,
      attempts: exactResult.attempts,
      error: exactResult.error,
      matchingRuns: matchingRuns.length
    };
  }
  const runsById = new Map();
  for (const run of [...recentRuns, ...supplementalRuns]) runsById.set(run.databaseId, run);
  const runs = [...runsById.values()];
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
      exactHeadRunsPerBranch: 100,
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
      exactHeadRuns: exactHeadQueries,
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
      recentRuns: runResult.ok ? recentRuns.length : null,
      supplementalExactHeadRuns: runResult.ok ? supplementalRuns.length : null,
      runsTruncated: runResult.ok ? recentRuns.length === 200 : null,
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
  const decisions = readJson(decisionsPath);
  const decisionsByProduct = validateDecisions(decisions, registry);
  const generatedAt = new Date().toISOString();
  const controllerSourceCommit = refSha("HEAD");
  if (!controllerSourceCommit) fail("unable to resolve HEAD");
  const githubEvidence = args.has("--github")
    ? collectGithubEvidence(controllerSourceCommit, generatedAt, decisions)
    : readJson(githubEvidencePath);
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
    const repository = product.repository ?? registry.defaultRepository;
    const externalRepository = repository !== registry.defaultRepository;
    const separateWorktree = externalRepository || product.separateWorktree === true;
    const productBranch = product.id === "29" && product.controllerBranch
      ? product.controllerBranch
      : product.branch;
    const expectedExternalWorktree = path.join(finalWorktreesRoot, product.worktreeSlug);
    const repositoryRoot = separateWorktree ? expectedExternalWorktree : root;
    const repositoryOrigin = repositoryFromRemote(git(["remote", "get-url", "origin"], { allowFailure: true, cwd: repositoryRoot })?.trim() ?? null);
    const repositoryMatches = repositoryOrigin === repository;
    const localRef = `refs/heads/${productBranch}`;
    const remoteRef = `refs/remotes/origin/${productBranch}`;
    const localSha = refSha(localRef, repositoryRoot);
    const remoteSha = refSha(remoteRef, repositoryRoot);
    const distance = aheadBehind(localSha, remoteSha, repositoryRoot);
    const branchConfigRemote = git(["config", "--get", `branch.${productBranch}.remote`], { allowFailure: true, cwd: repositoryRoot })?.trim() || null;
    const branchConfigMerge = git(["config", "--get", `branch.${productBranch}.merge`], { allowFailure: true, cwd: repositoryRoot })?.trim() || null;
    const expectedMerge = `refs/heads/${productBranch}`;
    const externalHead = refSha("HEAD", repositoryRoot);
    const externalBranch = git(["branch", "--show-current"], { allowFailure: true, cwd: repositoryRoot })?.trim() || null;
    const worktreeRecord = separateWorktree
      ? (repositoryMatches ? { path: repositoryRoot, head: externalHead, branch: externalBranch, detached: false } : null)
      : worktreesByBranch.get(productBranch);
    const worktree = inspectWorktree(worktreeRecord);
    const commitForEvidence = localSha ?? remoteSha;
    const paths = treePaths(commitForEvidence, repositoryRoot);
    const evidencePaths = discoverEvidencePaths(product, paths);
    const fullGoalCoverage = readJsonAtCommit(commitForEvidence, evidencePaths.fullGoalCoverage, repositoryRoot);
    const productRelease = readJsonAtCommit(commitForEvidence, evidencePaths.productRelease, repositoryRoot);
    const releaseStateRecord = readJsonAtCommit(commitForEvidence, evidencePaths.releaseState ?? evidencePaths.productRelease, repositoryRoot);
    const artifactRegistry = readJsonAtCommit(commitForEvidence, evidencePaths.artifactRegistry, repositoryRoot);
    const publicMetadata = readJsonAtCommit(commitForEvidence, evidencePaths.publicMetadata, repositoryRoot);
    const integrationContract = readJsonAtCommit(commitForEvidence, evidencePaths.integrationContract, repositoryRoot);
    const coverage = extractCoverage(fullGoalCoverage);
    const bindings = {
      fullGoalCoverage: sourceBinding(fullGoalCoverage, commitForEvidence, repositoryRoot),
      productRelease: sourceBinding(productRelease, commitForEvidence, repositoryRoot),
      publicMetadata: sourceBinding(publicMetadata, commitForEvidence, repositoryRoot),
      integrationContract: sourceBinding(integrationContract, commitForEvidence, repositoryRoot)
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
    const candidateAcceptance = deriveAcceptance({
      localExists,
      remoteExists,
      synced,
      worktree,
      evidence: evidencePaths,
      coverage,
      bindings,
      recordMatches
    });
    if (!repositoryMatches) candidateAcceptance.blockers.unshift(`repository origin does not match ${repository}`);
    const localShaAfter = refSha(localRef, repositoryRoot);
    const stableDuringScan = localShaAfter === localSha;
    if (!stableDuringScan) candidateAcceptance.blockers.unshift("local final branch moved during the central scan");
    const acceptance = applyCentralDecision({
      acceptance: candidateAcceptance,
      decision: decisionsByProduct.get(product.id),
      product,
      localSha,
      remoteSha,
      worktree,
      controllerSourceCommit,
      githubEvidence
    });

    productRows.push({
      id: product.id,
      product: product.product,
      repository,
      branch: productBranch,
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
        repositoryMatches,
        synced,
        stableDuringScan
      },
      worktree,
      evidence: {
        paths: evidencePaths,
        coverage,
        recordMatches,
        sourceBindings: bindings,
        release: productRelease ? {
          product: productRelease.product ?? null,
          version: productRelease.version ?? null,
          channel: productRelease.channel ?? null,
          environment: productRelease.environment ?? null,
          sourceCommit: productRelease.sourceCommit ?? null,
          releasedAt: productRelease.releasedAt ?? null,
          releaseStatus: productRelease.releaseStatus ?? null,
          publicEvidence: Array.isArray(productRelease.publicEvidence) ? productRelease.publicEvidence : []
        } : null,
        claimedReleaseStates: extractReleaseStates(releaseStateRecord ?? productRelease),
        artifacts: Array.isArray(artifactRegistry?.artifacts) ? artifactRegistry.artifacts : [],
        exactCommitBound: Object.values(bindings).filter((binding) => binding.sourceCommit).every((binding) => binding.exact)
      },
      centralAcceptance: {
        status: acceptance.status,
        reason: acceptance.reason,
        acceptedSourceCommit: acceptance.acceptedSourceCommit,
        acceptedBy: "29-integration",
        acceptedAt: acceptance.acceptedAt,
        decisionEvidence: acceptance.decisionEvidence,
        integrationCommit: acceptance.integrationCommit
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
  if (args.has("--github")) writeJson(githubEvidencePath, githubEvidence);
  console.log(`wrote ${matrixPath} for ${matrix.summary.totalProducts} products`);
  if (args.has("--github")) console.log(`wrote ${githubEvidencePath}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
