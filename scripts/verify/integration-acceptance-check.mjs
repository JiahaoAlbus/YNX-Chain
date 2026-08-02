#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const strictRelease = args.has("--release");
const selfTest = args.has("--self-test");
const paths = {
  registry: "release/integration/product-registry.json",
  matrix: "release/integration/acceptance-matrix.json",
  coverage: ".ai-bridge/full-goal-coverage.json",
  contract: "release/integration/integration-contract.json",
  vectors: "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json",
  dependencyAcceptance: "docs/integration/DEPENDENCY_ACCEPTANCE.md",
  handoff: "docs/integration/INTEGRATION_HANDOFF.md",
  productRelease: "release/integration/product-release.json",
  publicMetadata: "release/integration/public-product-metadata.json",
  githubEvidence: "release/integration/github-evidence.json",
  decisions: "release/integration/central-acceptance-decisions.json"
};
const allowedStatuses = [
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
];
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
const terminalCoverageStatuses = new Set(["verifiedComplete", "externalBlocked", "notApplicable"]);
const acceptedCentralStatuses = new Set(["integratedCentral", "testnetVerified", "publicVerified", "verifiedComplete"]);
const expectedIds = Array.from({ length: 36 }, (_, index) => String(index + 1).padStart(2, "0"));
const expectedVectorIds = Array.from({ length: 12 }, (_, index) => `CP-${String(index + 1).padStart(3, "0")}`);

function command(name, commandArgs, allowFailure = false) {
  const result = spawnSync(name, commandArgs, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) {
    if (allowFailure) return null;
    throw result.error;
  }
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(String(result.stderr || result.stdout || `${name} exited ${result.status}`).trim());
  }
  return String(result.stdout ?? "").trim();
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function validSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function reachableFromHead(value) {
  if (!validSha(value)) return false;
  return command("git", ["merge-base", "--is-ancestor", value, "HEAD"], true) !== null;
}

function validDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareArrays(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function makeCollector(prefix = "") {
  const failures = [];
  return {
    failures,
    expect(condition, message) {
      if (!condition) failures.push(prefix ? `${prefix}: ${message}` : message);
    }
  };
}

function validateSourceBinding(collector, owner, sourceCommit) {
  collector.expect(validSha(sourceCommit), `${owner} sourceCommit must be an exact 40-hex SHA`);
  if (validSha(sourceCommit)) collector.expect(reachableFromHead(sourceCommit), `${owner} sourceCommit must be reachable from HEAD`);
}

function validateRegistry(registry, collector) {
  collector.expect(registry?.schemaVersion === "1.0.0", "registry schemaVersion must be 1.0.0");
  collector.expect(registry?.owner === "29-integration", "registry owner must be 29-integration");
  collector.expect(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(registry?.defaultRepository ?? ""), "registry defaultRepository is invalid");
  validateSourceBinding(collector, "registry", registry?.sourceCommit);
  collector.expect(Array.isArray(registry?.products), "registry products must be an array");
  const products = Array.isArray(registry?.products) ? registry.products : [];
  collector.expect(products.length === 36, "registry must contain exactly 36 products");
  collector.expect(compareArrays(products.map((product) => product.id), expectedIds), "registry product IDs must be ordered 01 through 36");
  const branches = new Set();
  const slugs = new Set();
  const ids = new Set(products.map((product) => product.id));
  for (const product of products) {
    const repository = product.repository ?? registry.defaultRepository;
    collector.expect(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), `product ${product.id} has an invalid repository`);
    collector.expect(typeof product.product === "string" && product.product.length > 0, `product ${product.id} lacks a name`);
    collector.expect(/^codex\/final-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.branch ?? ""), `product ${product.id} has an invalid final branch`);
    const branchIdentity = `${repository}#${product.branch}`;
    collector.expect(!branches.has(branchIdentity), `duplicate final branch ${branchIdentity}`);
    branches.add(branchIdentity);
    collector.expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug ?? ""), `product ${product.id} has an invalid slug`);
    collector.expect(!slugs.has(product.slug), `duplicate product slug ${product.slug}`);
    slugs.add(product.slug);
    collector.expect(typeof product.owner === "string" && product.owner.length > 0, `product ${product.id} lacks an owner`);
    collector.expect(Array.isArray(product.dependencies), `product ${product.id} dependencies must be an array`);
    const dependencySet = new Set();
    for (const dependency of product.dependencies ?? []) {
      collector.expect(ids.has(dependency), `product ${product.id} references unknown dependency ${dependency}`);
      collector.expect(dependency !== product.id, `product ${product.id} depends on itself`);
      collector.expect(!dependencySet.has(dependency), `product ${product.id} repeats dependency ${dependency}`);
      dependencySet.add(dependency);
    }
  }
  const integration = products.find((product) => product.id === "29");
  const security = products.find((product) => product.id === "30");
  collector.expect(integration?.branch === "codex/final-integration" && integration?.owner === "29-integration", "product 29 authority mapping is invalid");
  collector.expect(
    security?.repository === "JiahaoAlbus/YNX-Chain"
      && security?.branch === "codex/final-security-platform"
      && security?.owner === "30-security-platform",
    "product 30 authority mapping is invalid"
  );
  collector.expect(compareArrays(registry?.releaseStateKeys, releaseStateKeys), "registry release-state vocabulary differs from the canonical order");
  return new Map(products.map((product) => [product.id, product]));
}

function validateContract(contract, collector) {
  const expectedPhaseOrder = ["RECOVER", "PROTECT", "FREEZE", "INTEGRATE", "TESTNET", "PUBLIC", "EXPAND"];
  collector.expect(contract?.schemaVersion === "1.0.0", "contract schemaVersion must be 1.0.0");
  collector.expect(contract?.owner === "29-integration", "contract owner must be 29-integration");
  collector.expect(contract?.branch === "codex/final-integration", "contract branch must be the Integration final branch");
  validateSourceBinding(collector, "integration contract", contract?.sourceCommit);
  collector.expect(compareArrays(contract?.phaseOrder, expectedPhaseOrder), "contract phase order is invalid");
  collector.expect(expectedPhaseOrder.includes(contract?.currentPhase), "contract currentPhase is invalid");
  collector.expect(compareArrays(contract?.releaseStateKeys, releaseStateKeys), "contract release-state vocabulary is invalid");
  collector.expect(compareArrays(contract?.coverageStatuses, allowedStatuses), "contract coverage-status vocabulary is invalid");
  collector.expect(contract?.acceptanceAuthority?.singleOwner === "29-integration", "Integration must remain the single acceptance owner");
  collector.expect(contract?.conflictPolicy?.dualAuthorityAllowed === false, "dual authority must remain prohibited");
  collector.expect(contract?.conflictPolicy?.failClosed === true, "authority conflicts must fail closed");
  collector.expect(contract?.assetBoundaryPolicy?.enginePrivateKeyAccess === false, "engine private-key access must remain false");
  collector.expect(contract?.assetBoundaryPolicy?.engineWithdrawalAuthority === false, "engine withdrawal authority must remain false");
  collector.expect(Array.isArray(contract?.requiredOwnerBundle) && contract.requiredOwnerBundle.length >= 7, "contract lacks the required owner bundle");
  const serialized = JSON.stringify(contract);
  collector.expect(!serialized.includes("<product-slug>"), "contract contains an unresolved product-slug placeholder");
  const authorities = contract?.authoritativeOwners ?? {};
  for (const owner of ["01-chain-core", "02-wallet-auth", "08-quant-lab", "17-tokenomics", "19-oracle-market-data", "21-bridge", "26-data-fabric", "28-website", "29-integration", "30-security-platform", "31-governance"]) {
    collector.expect(Object.values(authorities).includes(owner), `contract lacks authoritative owner ${owner}`);
  }
}

function validateCoverage(coverage, productMap, collector) {
  collector.expect(coverage?.schemaVersion === "1.0.0", "coverage schemaVersion must be 1.0.0");
  collector.expect(coverage?.owner === "29-integration", "coverage owner must be 29-integration");
  collector.expect(coverage?.product === "YNX Integration / Founder Control", "coverage product identity is invalid");
  validateSourceBinding(collector, "full-goal coverage", coverage?.sourceCommit);
  collector.expect(compareArrays(coverage?.allowedStatuses, allowedStatuses), "coverage allowedStatuses are invalid");
  collector.expect(Array.isArray(coverage?.items), "coverage items must be an array");
  const items = Array.isArray(coverage?.items) ? coverage.items : [];
  collector.expect(items.length >= 68, "coverage must include the full controller and 01–36 product matrix");
  const ids = new Set();
  const requiredFields = ["id", "category", "requirement", "applicability", "status", "evidence", "sourceCommit", "tests", "artifact", "publicProof", "blockedBy", "owner", "nextAction", "lastUpdated"];
  for (const item of items) {
    collector.expect(typeof item.id === "string" && item.id.length > 0, "coverage item lacks id");
    collector.expect(!ids.has(item.id), `duplicate coverage id ${item.id}`);
    ids.add(item.id);
    for (const field of requiredFields) collector.expect(Object.hasOwn(item, field), `${item.id ?? "coverage item"} lacks ${field}`);
    collector.expect(item.applicability === "applicable", `${item.id} has unsupported applicability`);
    collector.expect(allowedStatuses.includes(item.status), `${item.id} has invalid status ${item.status}`);
    collector.expect(item.owner === "29-integration", `${item.id} has the wrong owner`);
    collector.expect(typeof item.requirement === "string" && item.requirement.length > 0, `${item.id} lacks requirement text`);
    collector.expect(typeof item.nextAction === "string" && item.nextAction.length > 0, `${item.id} lacks nextAction`);
    collector.expect(Array.isArray(item.evidence), `${item.id} evidence must be an array`);
    collector.expect(Array.isArray(item.tests), `${item.id} tests must be an array`);
    collector.expect(Array.isArray(item.publicProof), `${item.id} publicProof must be an array`);
    collector.expect(Array.isArray(item.blockedBy), `${item.id} blockedBy must be an array`);
    validateSourceBinding(collector, item.id, item.sourceCommit);
    collector.expect(validDateTime(item.lastUpdated), `${item.id} lastUpdated is invalid`);
    if (item.status === "externalBlocked") collector.expect(item.blockedBy.length > 0, `${item.id} externalBlocked requires a concrete blocker`);
    if (item.status === "notApplicable") collector.expect(item.evidence.length > 0, `${item.id} notApplicable requires product-level technical evidence`);
  }
  for (const productId of productMap.keys()) collector.expect(ids.has(`INT-PRODUCT-${productId}`), `coverage lacks product row ${productId}`);
  if (strictRelease) {
    const nonTerminal = items.filter((item) => !terminalCoverageStatuses.has(item.status));
    collector.expect(nonTerminal.length === 0, `release gate has ${nonTerminal.length} non-terminal coverage items`);
  }
}

function validateVectors(vectors, productMap, collector) {
  collector.expect(vectors?.schemaVersion === "1.0.0", "cross-product vectors schemaVersion must be 1.0.0");
  collector.expect(vectors?.owner === "29-integration", "cross-product vectors owner must be 29-integration");
  validateSourceBinding(collector, "cross-product vectors", vectors?.sourceCommit);
  collector.expect(Array.isArray(vectors?.vectors), "cross-product vectors must be an array");
  const entries = Array.isArray(vectors?.vectors) ? vectors.vectors : [];
  collector.expect(entries.length === 12, "exactly 12 mandatory cross-product vectors are required");
  collector.expect(compareArrays(entries.map((entry) => entry.id), expectedVectorIds), "cross-product vector IDs must be ordered CP-001 through CP-012");
  const flows = new Set();
  for (const vector of entries) {
    collector.expect(typeof vector.flow === "string" && vector.flow.length > 0, `${vector.id} lacks flow`);
    collector.expect(!flows.has(vector.flow), `${vector.id} duplicates flow ${vector.flow}`);
    flows.add(vector.flow);
    collector.expect(Array.isArray(vector.products) && vector.products.length > 0, `${vector.id} lacks products`);
    for (const product of vector.products ?? []) collector.expect(productMap.has(product), `${vector.id} references unknown product ${product}`);
    collector.expect(Array.isArray(vector.happyPath) && vector.happyPath.length >= 3, `${vector.id} happyPath is incomplete`);
    collector.expect(Array.isArray(vector.negativeCases) && vector.negativeCases.length >= 3, `${vector.id} negativeCases are incomplete`);
    collector.expect(Array.isArray(vector.requiredEvidence) && vector.requiredEvidence.length >= 3, `${vector.id} requiredEvidence is incomplete`);
    collector.expect(allowedStatuses.includes(vector.status), `${vector.id} has invalid status ${vector.status}`);
  }
  if (strictRelease) collector.expect(entries.every((vector) => ["testnetVerified", "publicVerified", "verifiedComplete", "notApplicable"].includes(vector.status)), "release gate requires every cross-product vector to be verified or technically inapplicable");
}

function validateMatrix(matrix, productMap, collector) {
  collector.expect(matrix?.schemaVersion === "1.0.0", "acceptance matrix schemaVersion must be 1.0.0");
  collector.expect(matrix?.owner === "29-integration", "acceptance matrix owner must be 29-integration");
  collector.expect(validDateTime(matrix?.generatedAt), "acceptance matrix generatedAt is invalid");
  validateSourceBinding(collector, "acceptance matrix", matrix?.controllerSourceCommit);
  const controller = productMap.get("29");
  const controllerBranch = controller?.controllerBranch ?? controller?.branch;
  collector.expect(matrix?.repository?.currentBranch === controllerBranch, "matrix was not generated on the registered Integration controller branch");
  collector.expect(matrix?.repository?.localHead === matrix?.controllerSourceCommit, "matrix localHead differs from controllerSourceCommit");
  collector.expect(matrix?.repository?.upstreamRef === `origin/${controllerBranch}`, "matrix upstream is invalid");
  collector.expect(Array.isArray(matrix?.products), "matrix products must be an array");
  const products = Array.isArray(matrix?.products) ? matrix.products : [];
  collector.expect(products.length === 36, "matrix must contain exactly 36 products");
  collector.expect(compareArrays(products.map((product) => product.id), expectedIds), "matrix IDs must be ordered 01 through 36");
  for (const product of products) {
    const expected = productMap.get(product.id);
    collector.expect(Boolean(expected), `matrix contains unknown product ${product.id}`);
    collector.expect(product.repository === (expected?.repository ?? "JiahaoAlbus/YNX-Chain"), `matrix product ${product.id} repository differs from registry`);
    const expectedBranch = product.id === "29" ? (expected?.controllerBranch ?? expected?.branch) : expected?.branch;
    collector.expect(product.branch === expectedBranch, `matrix product ${product.id} branch differs from registry`);
    collector.expect(product.owner === expected?.owner, `matrix product ${product.id} owner differs from registry`);
    collector.expect(Array.isArray(product.blockers), `matrix product ${product.id} blockers must be an array`);
    collector.expect(typeof product.nextAction === "string" && product.nextAction.length > 0, `matrix product ${product.id} lacks nextAction`);
    collector.expect(product.centralAcceptance?.acceptedBy === "29-integration", `matrix product ${product.id} acceptedBy is invalid`);
    collector.expect(allowedStatuses.includes(product.centralAcceptance?.status), `matrix product ${product.id} has invalid central status`);
    collector.expect(Object.hasOwn(product.centralAcceptance ?? {}, "decisionEvidence"), `matrix product ${product.id} lacks decisionEvidence`);
    collector.expect(Object.hasOwn(product.centralAcceptance ?? {}, "integrationCommit"), `matrix product ${product.id} lacks integrationCommit`);
    collector.expect(typeof product.refs?.stableDuringScan === "boolean", `matrix product ${product.id} lacks stableDuringScan`);
    collector.expect(!Object.hasOwn(product.worktree ?? {}, "path"), `matrix product ${product.id} leaks an absolute worktree path`);
    const coverageCounts = product.evidence?.coverage?.counts ?? {};
    collector.expect(
      product.evidence?.coverage?.open === (coverageCounts.notStarted ?? 0) + (coverageCounts.inProgress ?? 0),
      `matrix product ${product.id} open coverage must count only notStarted and inProgress items`
    );
    const acceptedCommit = product.centralAcceptance?.acceptedSourceCommit;
    if (acceptedCommit !== null) {
      collector.expect(validSha(acceptedCommit), `matrix product ${product.id} acceptedSourceCommit is invalid`);
      collector.expect(product.refs?.synced === true, `matrix product ${product.id} was accepted without synchronized refs`);
      collector.expect(product.refs?.localSha === acceptedCommit && product.refs?.remoteSha === acceptedCommit, `matrix product ${product.id} accepted commit differs from local or remote ref`);
      collector.expect(product.worktree?.clean === true, `matrix product ${product.id} was accepted with a dirty worktree`);
      collector.expect(product.blockers.length === 0, `matrix product ${product.id} was accepted with blockers`);
      collector.expect(Object.values(product.evidence?.recordMatches ?? {}).every(Boolean), `matrix product ${product.id} was accepted with foreign evidence`);
      collector.expect(Object.values(product.evidence?.sourceBindings ?? {}).every((binding) => binding?.reachable === true), `matrix product ${product.id} was accepted with unreachable evidence`);
      collector.expect(validSha(product.centralAcceptance?.integrationCommit), `matrix product ${product.id} accepted without an integration commit`);
      collector.expect(reachableFromHead(product.centralAcceptance?.integrationCommit), `matrix product ${product.id} integration commit is not reachable`);
      collector.expect(command("git", ["merge-base", "--is-ancestor", acceptedCommit, product.centralAcceptance?.integrationCommit], true) !== null, `matrix product ${product.id} source is not an ancestor of its integration commit`);
      collector.expect(typeof product.centralAcceptance?.decisionEvidence === "string" && exists(product.centralAcceptance.decisionEvidence), `matrix product ${product.id} acceptance receipt is missing`);
    }
    if (acceptedCentralStatuses.has(product.centralAcceptance?.status)) collector.expect(acceptedCommit !== null, `matrix product ${product.id} reached ${product.centralAcceptance.status} without an accepted source commit`);
    if (product.centralAcceptance?.status === "verifiedComplete") collector.expect(product.blockers.length === 0, `matrix product ${product.id} is verifiedComplete with blockers`);
  }
  const recomputed = {
    totalProducts: products.length,
    localBranches: products.filter((product) => product.refs?.localExists).length,
    remoteBranches: products.filter((product) => product.refs?.remoteExists).length,
    registeredWorktrees: products.filter((product) => product.worktree?.registered).length,
    cleanWorktrees: products.filter((product) => product.worktree?.clean === true).length,
    dirtyWorktrees: products.filter((product) => product.worktree?.clean === false).length,
    syncedBranches: products.filter((product) => product.refs?.synced).length,
    upstreamConfigured: products.filter((product) => product.refs?.upstreamConfigured).length,
    implementedLocalCandidates: products.filter((product) => product.centralAcceptance?.status === "implementedLocal").length,
    inProgress: products.filter((product) => product.centralAcceptance?.status === "inProgress").length,
    notStarted: products.filter((product) => product.centralAcceptance?.status === "notStarted").length,
    centrallyAccepted: products.filter((product) => product.centralAcceptance?.acceptedSourceCommit !== null).length
  };
  for (const [key, value] of Object.entries(recomputed)) collector.expect(matrix?.summary?.[key] === value, `matrix summary.${key} must equal ${value}`);
  if (strictRelease) {
    collector.expect(matrix?.repository?.clean === true, "release gate requires a clean Integration worktree observation");
    collector.expect(matrix?.repository?.ahead === 0 && matrix?.repository?.behind === 0, "release gate requires Local SHA equal to Remote SHA");
    collector.expect(products.every((product) => ["verifiedComplete", "externalBlocked", "notApplicable"].includes(product.centralAcceptance?.status)), "release gate requires every product row to be terminal");
  }
}

function validateDecisions(decisions, matrix, productMap, collector) {
  collector.expect(decisions?.schemaVersion === "1.0.0", "central acceptance decisions schemaVersion must be 1.0.0");
  collector.expect(decisions?.owner === "29-integration", "central acceptance decisions owner must be 29-integration");
  collector.expect(Array.isArray(decisions?.decisions), "central acceptance decisions must be an array");
  const rows = Array.isArray(decisions?.decisions) ? decisions.decisions : [];
  const seen = new Set();
  const matrixById = new Map((matrix?.products ?? []).map((product) => [product.id, product]));
  for (const decision of rows) {
    const expected = productMap.get(decision?.productId);
    const observed = matrixById.get(decision?.productId);
    collector.expect(Boolean(expected), `decision references unknown product ${decision?.productId}`);
    collector.expect(!seen.has(decision?.productId), `duplicate central decision for product ${decision?.productId}`);
    seen.add(decision?.productId);
    collector.expect(decision?.status === "integratedCentral", `decision ${decision?.productId} status is invalid`);
    collector.expect(decision?.repository === (expected?.repository ?? "JiahaoAlbus/YNX-Chain"), `decision ${decision?.productId} repository mismatch`);
    collector.expect(decision?.branch === expected?.branch, `decision ${decision?.productId} branch mismatch`);
    collector.expect(validSha(decision?.acceptedSourceCommit), `decision ${decision?.productId} source commit is invalid`);
    collector.expect(validSha(decision?.integrationCommit), `decision ${decision?.productId} integration commit is invalid`);
    collector.expect(validDateTime(decision?.acceptedAt), `decision ${decision?.productId} acceptedAt is invalid`);
    collector.expect(typeof decision?.receipt === "string" && exists(decision.receipt), `decision ${decision?.productId} receipt is missing`);
    collector.expect(observed?.centralAcceptance?.status === "integratedCentral", `decision ${decision?.productId} did not produce integratedCentral`);
    collector.expect(observed?.centralAcceptance?.acceptedSourceCommit === decision?.acceptedSourceCommit, `decision ${decision?.productId} source differs from matrix`);
    collector.expect(observed?.centralAcceptance?.integrationCommit === decision?.integrationCommit, `decision ${decision?.productId} integration commit differs from matrix`);
    collector.expect(observed?.centralAcceptance?.decisionEvidence === decision?.receipt, `decision ${decision?.productId} receipt differs from matrix`);
    if (typeof decision?.receipt === "string" && exists(decision.receipt)) {
      const receipt = readJson(decision.receipt);
      collector.expect(receipt?.status === "passed", `decision ${decision?.productId} receipt did not pass`);
      collector.expect(receipt?.productId === decision?.productId, `decision ${decision?.productId} receipt product mismatch`);
      collector.expect(receipt?.acceptedSourceCommit === decision?.acceptedSourceCommit, `decision ${decision?.productId} receipt source mismatch`);
      collector.expect(receipt?.integrationCommit === decision?.integrationCommit, `decision ${decision?.productId} receipt integration mismatch`);
      collector.expect(receipt?.exactHeadCi?.verified === true && receipt?.exactHeadCi?.sourceCommit === decision?.acceptedSourceCommit, `decision ${decision?.productId} receipt CI mismatch`);
      collector.expect(Array.isArray(receipt?.tests) && receipt.tests.length > 0 && receipt.tests.every((test) => test?.status === "passed"), `decision ${decision?.productId} receipt tests are incomplete`);
    }
  }
}

function validateProductRelease(release, collector) {
  collector.expect(release?.schemaVersion === "1.0.0", "Integration product release schemaVersion must be 1.0.0");
  collector.expect(release?.productId === "29" && release?.owner === "29-integration" && release?.slug === "integration", "Integration product release identity is invalid");
  validateSourceBinding(collector, "Integration product release", release?.sourceCommit);
  for (const key of releaseStateKeys) {
    collector.expect(typeof release?.states?.[key] === "boolean", `Integration product release state ${key} must be boolean`);
    collector.expect(Array.isArray(release?.stateEvidence?.[key]), `Integration product release stateEvidence.${key} must be an array`);
    if (release?.states?.[key] === true) collector.expect(release.stateEvidence[key].length > 0, `Integration product release true state ${key} lacks evidence`);
  }
  collector.expect(release?.websitePublished !== true || release?.runtimeDeployedPublic === true || release?.states?.deployedPublic === false, "Website publication must not imply runtime deployment");
  collector.expect(release?.mainnetAccepted === false, "Mainnet must remain false during this Testnet controller slice");
  if (strictRelease) collector.expect(release?.states?.testedLocal === true, "release gate requires testedLocal evidence");
}

function validatePublicMetadata(metadata, collector) {
  collector.expect(metadata?.schemaVersion === "1.0.0", "Integration public metadata schemaVersion must be 1.0.0");
  collector.expect(metadata?.productId === "29" && metadata?.owner === "29-integration" && metadata?.slug === "integration", "Integration public metadata identity is invalid");
  validateSourceBinding(collector, "Integration public metadata", metadata?.sourceCommit);
  collector.expect(/^\/[a-z0-9-]+$/.test(metadata?.canonicalRoute ?? ""), "Integration canonicalRoute is invalid");
  collector.expect(typeof metadata?.title === "string" && metadata.title.length > 0, "Integration public metadata lacks title");
  collector.expect(typeof metadata?.metaDescription === "string" && metadata.metaDescription.length > 0, "Integration public metadata lacks metaDescription");
  collector.expect(typeof metadata?.h1 === "string" && metadata.h1.length > 0, "Integration public metadata lacks h1");
  for (const key of ["websitePublished", "runtimeDeployedPublic", "downloadHosted", "productionSigned", "storeReleased", "mainnetAccepted"]) collector.expect(typeof metadata?.status?.[key] === "boolean", `Integration public metadata status.${key} must be boolean`);
  const serialized = JSON.stringify(metadata);
  for (const forbidden of ["/Users/", "codex/final-", "localhost", "127.0.0.1", ".ai-bridge", "worktree"]) collector.expect(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `Integration public metadata contains internal value ${forbidden}`);
  for (const [name, value] of Object.entries(metadata?.links ?? {})) collector.expect(value === null || /^https:\/\//.test(value), `Integration public metadata link ${name} must be null or HTTPS`);
}

function validateGithubEvidence(evidence, collector) {
  collector.expect(evidence?.schemaVersion === "1.0.0", "GitHub evidence schemaVersion must be 1.0.0");
  collector.expect(evidence?.owner === "29-integration", "GitHub evidence owner must be 29-integration");
  collector.expect(evidence?.repository === "JiahaoAlbus/YNX-Chain", "GitHub evidence repository is invalid");
  validateSourceBinding(collector, "GitHub evidence", evidence?.controllerSourceCommit);
  collector.expect(validDateTime(evidence?.generatedAt), "GitHub evidence generatedAt is invalid");
  const runs = Array.isArray(evidence?.runs) ? evidence.runs : [];
  const releases = Array.isArray(evidence?.releases) ? evidence.releases : [];
  const artifacts = Array.isArray(evidence?.artifacts) ? evidence.artifacts : [];
  for (const source of ["runs", "releases", "artifacts"]) {
    collector.expect(typeof evidence?.availability?.[source] === "boolean", `GitHub evidence availability.${source} must be boolean`);
    collector.expect(Number.isSafeInteger(evidence?.queryAttempts?.[source]) && evidence.queryAttempts[source] >= 1 && evidence.queryAttempts[source] <= 4, `GitHub evidence queryAttempts.${source} is invalid`);
    if (evidence?.availability?.[source] === true) collector.expect(evidence?.queryErrors?.[source] === null, `GitHub evidence ${source} is available but retains an error`);
    if (evidence?.availability?.[source] === false) collector.expect(typeof evidence?.queryErrors?.[source] === "string" && evidence.queryErrors[source].length > 0, `GitHub evidence ${source} is unavailable without an error`);
  }
  collector.expect(evidence?.summary?.runs === (evidence?.availability?.runs ? runs.length : null), "GitHub evidence run count is inconsistent");
  const recentRunCount = evidence?.summary?.recentRuns ?? runs.length;
  collector.expect(evidence?.summary?.runsTruncated === (evidence?.availability?.runs ? recentRunCount === evidence?.limits?.runs : null), "GitHub evidence run truncation state is inconsistent");
  collector.expect(evidence?.summary?.successfulRuns === (evidence?.availability?.runs ? runs.filter((run) => run.conclusion === "success").length : null), "GitHub evidence successful-run count is inconsistent");
  collector.expect(evidence?.summary?.releases === (evidence?.availability?.releases ? releases.length : null), "GitHub evidence release count is inconsistent");
  collector.expect(evidence?.summary?.prereleases === (evidence?.availability?.releases ? releases.filter((release) => release.isPrerelease).length : null), "GitHub evidence prerelease count is inconsistent");
  collector.expect(evidence?.summary?.artifacts === (evidence?.availability?.artifacts ? artifacts.length : null), "GitHub evidence artifact count is inconsistent");
  collector.expect(evidence?.summary?.activeArtifacts === (evidence?.availability?.artifacts ? artifacts.filter((artifact) => artifact.expired === false).length : null), "GitHub evidence active-artifact count is inconsistent");
  for (const artifact of artifacts) {
    collector.expect(typeof artifact?.classHints?.preview === "boolean", `GitHub artifact ${artifact?.id} lacks class hints`);
    if (artifact?.classHints?.productionSigned === true) collector.expect(String(artifact.name).toLowerCase().includes("production-signed"), `GitHub artifact ${artifact?.id} has an unsupported production-signing hint`);
  }
}

function validateBundle(overrides = {}) {
  const collector = makeCollector();
  const registry = overrides.registry ?? readJson(paths.registry);
  const contract = overrides.contract ?? readJson(paths.contract);
  const coverage = overrides.coverage ?? readJson(paths.coverage);
  const vectors = overrides.vectors ?? readJson(paths.vectors);
  const matrix = overrides.matrix ?? readJson(paths.matrix);
  const decisions = overrides.decisions ?? readJson(paths.decisions);
  const productRelease = overrides.productRelease ?? readJson(paths.productRelease);
  const publicMetadata = overrides.publicMetadata ?? readJson(paths.publicMetadata);
  const productMap = validateRegistry(registry, collector);
  validateContract(contract, collector);
  validateCoverage(coverage, productMap, collector);
  validateVectors(vectors, productMap, collector);
  validateMatrix(matrix, productMap, collector);
  validateDecisions(decisions, matrix, productMap, collector);
  validateProductRelease(productRelease, collector);
  validatePublicMetadata(publicMetadata, collector);
  collector.expect(exists(paths.dependencyAcceptance), "Dependency Acceptance document is missing");
  collector.expect(exists(paths.handoff), "Integration Handoff document is missing");
  if (exists(paths.githubEvidence)) validateGithubEvidence(overrides.githubEvidence ?? readJson(paths.githubEvidence), collector);
  return collector.failures;
}

function runSelfTest() {
  const actualFailures = validateBundle();
  if (actualFailures.length > 0) return actualFailures.map((failure) => `actual bundle: ${failure}`);
  const registry = readJson(paths.registry);
  const duplicateBranch = clone(registry);
  duplicateBranch.products[1].branch = duplicateBranch.products[0].branch;
  const duplicateFailures = validateBundle({ registry: duplicateBranch });
  if (!duplicateFailures.some((failure) => failure.includes("duplicate final branch"))) return ["self-test did not reject a duplicate final branch"];
  const vectors = readJson(paths.vectors);
  const missingNegative = clone(vectors);
  missingNegative.vectors[0].negativeCases = [];
  const vectorFailures = validateBundle({ vectors: missingNegative });
  if (!vectorFailures.some((failure) => failure.includes("negativeCases are incomplete"))) return ["self-test did not reject an incomplete negative vector"];
  const matrix = readJson(paths.matrix);
  const falseAcceptance = clone(matrix);
  falseAcceptance.products[0].centralAcceptance.status = "integratedCentral";
  falseAcceptance.products[0].centralAcceptance.acceptedSourceCommit = null;
  const acceptanceFailures = validateBundle({ matrix: falseAcceptance });
  if (!acceptanceFailures.some((failure) => failure.includes("without an accepted source commit"))) return ["self-test did not reject an unbound central acceptance"];
  const decisions = readJson(paths.decisions);
  const staleDecision = clone(decisions);
  staleDecision.decisions[0].acceptedSourceCommit = "0000000000000000000000000000000000000000";
  const staleDecisionFailures = validateBundle({ decisions: staleDecision });
  if (!staleDecisionFailures.some((failure) => failure.includes("source differs from matrix") || failure.includes("receipt source mismatch"))) {
    return ["self-test did not reject a stale central acceptance decision"];
  }
  return [];
}

try {
  const requiredFiles = [paths.registry, paths.matrix, paths.coverage, paths.contract, paths.vectors, paths.dependencyAcceptance, paths.handoff, paths.productRelease, paths.publicMetadata, paths.decisions];
  const missing = requiredFiles.filter((relativePath) => !exists(relativePath));
  if (missing.length > 0) {
    console.error(`integration acceptance check failed: missing ${missing.join(", ")}`);
    process.exit(1);
  }
  const failures = selfTest ? runSelfTest() : validateBundle();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`integration acceptance check failed with ${failures.length} finding(s)`);
    process.exit(1);
  }
  console.log(selfTest ? "integration acceptance check self-test passed" : strictRelease ? "integration release acceptance check passed" : "integration acceptance check passed");
} catch (error) {
  console.error(`integration acceptance check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
