#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const expectedStates = Object.freeze({
  implementedLocal: true,
  testedLocal: true,
  installedLocal: true,
  integratedCentral: false,
  deployedStaging: false,
  deployedPublic: false,
  downloadHosted: false,
  productionSigned: false,
  storeReleased: false,
});

const coverageStatuses = new Set([
  "notStarted",
  "inProgress",
  "implementedLocal",
  "testedLocal",
  "integratedCentral",
  "testnetVerified",
  "publicVerified",
  "externalBlocked",
  "notApplicable",
  "verifiedComplete",
]);

const requiredCoverageFields = [
  "id",
  "category",
  "requirement",
  "applicability",
  "status",
  "evidence",
  "sourceCommit",
  "tests",
  "artifact",
  "publicProof",
  "blockedBy",
  "owner",
  "nextAction",
  "lastUpdated",
];

const requiredIntegrationFiles = [
  "release/integration/ynx-data-fabric-contract.json",
  "release/data-fabric/operator-inputs.request.json",
  "docs/integration/INTEGRATION_HANDOFF.md",
  "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json",
  "docs/integration/DEPENDENCY_ACCEPTANCE.md",
  ".ai-bridge/current-plan.md",
  ".ai-bridge/agent-status.md",
  ".ai-bridge/decisions.md",
  ".ai-bridge/open-questions.md",
  ".ai-bridge/execution-log.jsonl",
  ".ai-bridge/full-goal-coverage.json",
];

function fail(message) {
  throw new Error(`Data Fabric release truth check failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJSON(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) fail(`${relativePath} is missing`);
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function sameJSON(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function trackedEngineeringFiles(repoRoot) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);

  const exactFiles = new Set([
    "go.mod",
    "go.sum",
    "package.json",
    "package-lock.json",
    "configs/data-fabric.env.example",
    "configs/data-fabric-event-keys.example.json",
    "integration/product-event-contracts.json",
    "scripts/data-fabric/api-capacity/main.go",
    "internal/bftgateway/pay.go",
    "internal/bftgateway/pay_test.go",
    "internal/consensus/action_transaction.go",
    "internal/consensus/action_transaction_test.go",
    "internal/consensus/application.go",
    "internal/consensus/pay_action.go",
    "internal/consensus/pay_action_test.go",
    "internal/consensus/pay_application.go",
    "internal/consensus/state.go",
  ]);
  const prefixes = [
    "cmd/ynx-data-fabric",
    "cmd/ynx-pay-data-fabric-bridge/",
    "internal/datafabric",
    "sdk/datafabric/",
    "sdk/datafabric-typescript/",
    "schemas/data-fabric/",
    "infra/data-fabric/",
  ];

  return tracked.filter((file) => {
    return exactFiles.has(file) || prefixes.some((prefix) => file.startsWith(prefix));
  });
}

export function findExpectedSourceCommit(repoRoot) {
  const release = readJSON(repoRoot, "product-release.json");
  const commit = release.sourceCommit;
  assert(/^[0-9a-f]{40}$/.test(commit || ""), "product release sourceCommit is invalid");

  const files = trackedEngineeringFiles(repoRoot);
  assert(files.length > 0, "no tracked engineering source files were found");
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["diff", "--quiet", commit, "--", ...files], {
      cwd: repoRoot,
      stdio: "ignore",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    fail("engineering source differs from the declared frozen sourceCommit");
  }
  return commit;
}

function verifyCoverage(root, expectedSourceCommit, expectedRelease) {
  const coverage = readJSON(root, ".ai-bridge/full-goal-coverage.json");
  assert(coverage.schemaVersion === 1, "full-goal coverage schemaVersion must be 1");
  assert(coverage.productId === "ynx-data-fabric", "full-goal coverage productId is invalid");
  assert(coverage.sourceCommit === expectedSourceCommit, "full-goal coverage sourceCommit is stale");
  assert(coverage.release === expectedRelease, "full-goal coverage release is stale");
  assert(coverage.phase === "INTEGRATE", "phase must remain INTEGRATE until central acceptance is evidenced");
  assert(coverage.overallStatus === "ACTIVE", "overall status must remain ACTIVE while autonomous work remains");
  assert(Array.isArray(coverage.items) && coverage.items.length >= 24, "full-goal coverage is incomplete");

  const ids = new Set();
  for (const [index, item] of coverage.items.entries()) {
    for (const field of requiredCoverageFields) {
      assert(Object.hasOwn(item, field), `coverage item ${index} is missing ${field}`);
    }
    assert(typeof item.id === "string" && item.id.length > 0, `coverage item ${index} has no id`);
    assert(!ids.has(item.id), `coverage id ${item.id} is duplicated`);
    ids.add(item.id);
    assert(coverageStatuses.has(item.status), `coverage item ${item.id} has invalid status ${item.status}`);
    assert(item.sourceCommit === expectedSourceCommit, `coverage item ${item.id} is not bound to the engineering source commit`);
    assert(Array.isArray(item.evidence), `coverage item ${item.id} evidence must be an array`);
    assert(Array.isArray(item.tests), `coverage item ${item.id} tests must be an array`);
    assert(typeof item.nextAction === "string" && item.nextAction.length > 0, `coverage item ${item.id} has no nextAction`);
    assert(typeof item.owner === "string" && item.owner.length > 0, `coverage item ${item.id} has no owner`);
    if (item.status === "externalBlocked") {
      assert(Array.isArray(item.blockedBy) && item.blockedBy.length > 0, `externalBlocked item ${item.id} has no blocker`);
    }
    if (item.status === "notApplicable") {
      assert(item.applicability === "notApplicable", `notApplicable item ${item.id} has inconsistent applicability`);
      assert(item.evidence.length > 0, `notApplicable item ${item.id} has no product-level reason`);
    }
  }
}

function verifyPublicBoundary(publicMetadata, productRelease) {
  assert(Array.isArray(publicMetadata.downloads) && publicMetadata.downloads.length === 0, "public downloads are claimed without hosting evidence");
  assert(Array.isArray(publicMetadata.screenshots), "public screenshots must be an array");
  assert(publicMetadata.publicURLs && Object.values(publicMetadata.publicURLs).every((value) => value === null), "public URLs are claimed without deployment evidence");
  assert(productRelease.publicHealthURL === null, "public health URL is claimed without deployment evidence");
  assert(Array.isArray(productRelease.artifacts) && productRelease.artifacts.length === 0, "hosted artifacts are claimed without immutable receipts");
}

export function verifyReleaseTruth({ root, expectedSourceCommit, repositoryRoot = root }) {
  const resolvedRoot = path.resolve(root);
  for (const relativePath of requiredIntegrationFiles) {
    assert(existsSync(path.join(resolvedRoot, relativePath)), `${relativePath} is missing`);
  }

  const productRelease = readJSON(resolvedRoot, "product-release.json");
  const releaseRecord = readJSON(resolvedRoot, "release/release-record.json");
  const integrationContract = readJSON(resolvedRoot, "release/integration/ynx-data-fabric-contract.json");
  const eventContracts = readJSON(resolvedRoot, "integration/product-event-contracts.json");
  const publicMetadata = readJSON(resolvedRoot, "public-product-metadata.json");
  const crossProductVectors = readJSON(resolvedRoot, "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json");
  const operatorInputs = readJSON(resolvedRoot, "release/data-fabric/operator-inputs.request.json");

  const releaseName = `ynx-data-fabric-${expectedSourceCommit.slice(0, 12)}`;
  assert(productRelease.schemaVersion === 2, "product release schemaVersion must be 2");
  assert(productRelease.productId === "ynx-data-fabric", "product release productId is invalid");
  assert(productRelease.sourceCommit === expectedSourceCommit, "product release sourceCommit is stale");
  assert(releaseRecord.sourceCommit === expectedSourceCommit, "release record sourceCommit is stale");
  assert(integrationContract.sourceCommit === expectedSourceCommit, "integration contract sourceCommit is stale");
  assert(productRelease.release === releaseName, "product release name is not source-derived");
  assert(releaseRecord.release === releaseName, "release record name is not source-derived");
  assert(integrationContract.release === releaseName, "integration contract release name is not source-derived");
  assert(crossProductVectors.sourceCommit === expectedSourceCommit, "cross-product vectors sourceCommit is stale");
  assert(productRelease.channel === "testnet-preview", "release channel must remain testnet-preview");
  assert(releaseRecord.phase === "INTEGRATE" && releaseRecord.overallStatus === "ACTIVE", "release record phase or status is invalid");
  assert(integrationContract.phase === "INTEGRATE", "integration contract phase is invalid");
  assert(publicMetadata.schemaVersion === 2, "public metadata schemaVersion must be 2");
  assert(publicMetadata.releaseStatus?.release === releaseName, "public metadata release is stale");
  assert(publicMetadata.releaseStatus?.channel === "testnet-preview", "public metadata channel is invalid");
  assert(operatorInputs.product === "ynx-data-fabric", "operator input request product is invalid");
  assert(operatorInputs.handling?.submitSecretsInChat === false, "operator input request must prohibit secrets in chat");
  assert(Array.isArray(operatorInputs.inputs) && operatorInputs.inputs.length >= 7, "operator input request is incomplete");

  assert(sameJSON(productRelease.states, expectedStates), "product release states overclaim or understate verified evidence");
  assert(sameJSON(releaseRecord.states, expectedStates), "release record states drifted from product release");
  assert(sameJSON(integrationContract.releaseStates, expectedStates), "integration contract release states drifted");
  const publicStates = Object.fromEntries(Object.keys(expectedStates).map((state) => [state, publicMetadata.releaseStatus?.[state]]));
  assert(sameJSON(publicStates, expectedStates), "public metadata release states drifted or overclaim evidence");

  assert(productRelease.compatibility?.eventEnvelope === "2.0", "current event envelope must be 2.0");
  assert(sameJSON(productRelease.compatibility?.acceptedEventEnvelopes, ["1.0", "2.0"]), "accepted event envelope versions are invalid");
  assert(productRelease.compatibility?.schemaRegistry === "2.0", "schema registry version must be 2.0");
  assert(productRelease.compatibility?.postgresMigration === 8, "PostgreSQL migration level must be 8");
  assert(eventContracts.schemaVersion === 2, "product event contract schemaVersion must be 2");
  assert(eventContracts.canonicalEnvelope === "schemas/data-fabric/event-envelope-v2.schema.json", "canonical envelope pointer is stale");
  assert(eventContracts.schemaRegistry === "schemas/data-fabric/schema-registry-v2.json", "schema registry pointer is stale");

  const localVerification = productRelease.evidence?.localVerification;
  assert(localVerification?.sourceCommit === expectedSourceCommit, "local verification is not source-bound");
  assert(localVerification?.status === "passed", "local verification is not passed");
  assert(Array.isArray(localVerification?.commands) && localVerification.commands.length >= 5, "local verification command evidence is incomplete");
  const remoteCI = releaseRecord.evidence?.remoteCI;
  const productRemoteCI = productRelease.evidence?.remoteCI;
  assert(remoteCI?.sourceCommit === expectedSourceCommit, "remote CI evidence is not source-bound");
  assert(remoteCI?.workflow === "data-fabric", "remote CI workflow is invalid");
  assert(remoteCI?.artifactsPublished === false, "CI artifacts are overclaimed");
  const remoteCICompleted =
    Number.isInteger(remoteCI?.runId) &&
    /^[0-9a-f]{40}$/.test(remoteCI?.headCommit || "") &&
    remoteCI?.status === "completed" &&
    remoteCI?.conclusion === "success" &&
    typeof remoteCI?.startedAt === "string" &&
    remoteCI.startedAt.length > 0 &&
    typeof remoteCI?.duration === "string" &&
    remoteCI.duration.length > 0;
  const remoteCIPending =
    remoteCI?.runId === null &&
    remoteCI?.headCommit === null &&
    remoteCI?.status === "pending" &&
    remoteCI?.conclusion === null &&
    remoteCI?.startedAt === null &&
    remoteCI?.duration === null &&
    remoteCI?.url === null;
  assert(remoteCICompleted || remoteCIPending, "remote CI evidence is neither truthful pending state nor successful evidence");
  if (remoteCICompleted) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", expectedSourceCommit, remoteCI.headCommit], {
        cwd: path.resolve(repositoryRoot),
        stdio: "ignore",
      });
    } catch {
      fail("remote CI headCommit is not a descendant of the engineering source commit");
    }
  }
  for (const field of ["runId", "workflow", "sourceCommit", "headCommit", "status", "conclusion", "startedAt", "duration", "artifactsPublished", "url"]) {
    assert(productRemoteCI?.[field] === remoteCI?.[field], `product and release record remote CI ${field} drifted`);
  }
  const sourceCandidate = releaseRecord.evidence?.sourceCandidate;
  assert(sameJSON(productRelease.evidence?.sourceCandidate, sourceCandidate), "product and release record source candidate evidence drifted");
  assert(sourceCandidate?.tag === "data-fabric-v0.2.0-source-candidate", "source candidate tag is invalid");
  assert(/^[0-9a-f]{40}$/.test(sourceCandidate?.sourceCommit || ""), "source candidate source commit is invalid");
  assert(Number.isInteger(sourceCandidate?.releaseId) && sourceCandidate.releaseId > 0, "source candidate release ID is invalid");
  assert(/^[0-9a-f]{40}$/.test(sourceCandidate?.targetCommit || ""), "source candidate target commit is invalid");
  assert(sourceCandidate?.assetCount === 7, "source candidate asset inventory is incomplete");
  assert(sourceCandidate?.archive?.name === `ynx-data-fabric-source-${sourceCandidate.targetCommit.slice(0, 12)}.tar.gz`, "source candidate archive name is invalid");
  assert(Number.isSafeInteger(sourceCandidate?.archive?.bytes) && sourceCandidate.archive.bytes > 0, "source candidate archive byte count is invalid");
  assert(/^[0-9a-f]{64}$/.test(sourceCandidate?.archive?.sha256 || ""), "source candidate archive digest is invalid");
  assert(sourceCandidate?.verification === "downloaded-all-assets-and-matched-sha256", "source candidate back-read verification is absent");
  assert(sourceCandidate?.publicStateChanged === false, "source candidate must not change public release states");
  assert(sourceCandidate?.currentSourceIncluded === false, "historical source candidate must not claim to contain the current source");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sourceCandidate.sourceCommit, sourceCandidate.targetCommit], {
      cwd: path.resolve(repositoryRoot),
      stdio: "ignore",
    });
    execFileSync("git", ["merge-base", "--is-ancestor", sourceCandidate.targetCommit, expectedSourceCommit], {
      cwd: path.resolve(repositoryRoot),
      stdio: "ignore",
    });
  } catch {
    fail("historical source candidate lineage does not precede the current engineering source");
  }

  verifyCoverage(resolvedRoot, expectedSourceCommit, releaseName);
  verifyPublicBoundary(publicMetadata, productRelease);
  return { sourceCommit: expectedSourceCommit, release: releaseName, states: expectedStates };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
    const expectedSourceCommit = findExpectedSourceCommit(root);
    const result = verifyReleaseTruth({ root, expectedSourceCommit });
    process.stdout.write(`${JSON.stringify({ status: "verified", ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
