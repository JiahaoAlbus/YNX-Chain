#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outputPath = "release/integration/PRODUCT_RELEASE_MATRIX.json";
const acceptancePath = "release/integration/acceptance-matrix.json";
const registryPath = "release/integration/product-registry.json";
const githubEvidencePath = "release/integration/github-evidence.json";
const readinessClasses = [
  "READY_FOR_PUBLIC_TESTNET",
  "READY_FOR_SOURCE_RELEASE",
  "HOLD_FOR_RECOVERY"
];
const stateKeys = [
  "recovered",
  "implementedLocal",
  "testedLocal",
  "builtLocal",
  "installedLocal",
  "migrationVerified",
  "restoreVerified",
  "integratedCentral",
  "sharedTestnetVerified",
  "deployedStaging",
  "deployedPublic",
  "releasePublished",
  "artifactHosted",
  "productionSigned",
  "storeReleased",
  "mainnetReleased",
  "externallyBlocked"
];

function fail(message) {
  console.error(`product release matrix refresh failed: ${message}`);
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
    env: process.env
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return null;
    throw result.error ?? new Error(String(result.stderr || result.stdout || `exit ${result.status}`).trim());
  }
  return String(result.stdout ?? "").trim();
}

function ghJson(args) {
  let lastError = "GitHub query failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = spawnSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
      env: process.env
    });
    if (!result.error && result.status === 0) {
      try {
        return { available: true, data: JSON.parse(String(result.stdout ?? "")), error: null };
      } catch (error) {
        lastError = `GitHub JSON parse failed: ${error.message}`;
      }
    } else {
      lastError = String(result.error?.message ?? result.stderr ?? result.stdout ?? `exit ${result.status}`).trim();
    }
  }
  return { available: false, data: [], error: lastError.slice(0, 1000) };
}

function boolean(value) {
  return value === true;
}

function remoteShaIsTruthful(product) {
  if (/^[0-9a-f]{40}$/.test(product.remoteSha ?? "")) return true;
  return product.remoteSha === null && product.blockers?.includes("remote final branch is missing");
}

function directStates(row, releaseContext = {}) {
  const claimed = row?.evidence?.claimedReleaseStates ?? {};
  const coverage = row?.evidence?.coverage ?? {};
  const refs = row?.refs ?? {};
  const worktree = row?.worktree ?? {};
  const accepted = row?.centralAcceptance?.acceptedSourceCommit !== null;
  const testedCoverage = (coverage?.counts?.testedLocal ?? 0) > 0 || (coverage?.counts?.verifiedComplete ?? 0) > 0;
  const releasePublished = Array.isArray(releaseContext.githubReleases)
    && releaseContext.githubReleases.some((release) => release.isDraft !== true && Boolean(release.publishedAt));
  const artifactHosted = releasePublished
    && Array.isArray(releaseContext.hostedArtifacts)
    && releaseContext.hostedArtifacts.some((artifact) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(artifact.downloadUrl ?? ""));
  return {
    recovered: refs.repositoryMatches === true && refs.localExists === true && refs.remoteExists === true && worktree.registered === true,
    implementedLocal: boolean(claimed.implementedLocal),
    testedLocal: boolean(claimed.testedLocal) && testedCoverage,
    builtLocal: boolean(coverage?.milestones?.builtLocal),
    installedLocal: boolean(claimed.installedLocal),
    migrationVerified: boolean(coverage?.milestones?.migrationVerified),
    restoreVerified: boolean(coverage?.milestones?.restoreVerified),
    integratedCentral: accepted,
    sharedTestnetVerified: ["testnetVerified", "publicVerified", "verifiedComplete"].includes(row?.centralAcceptance?.status) && accepted,
    deployedStaging: boolean(claimed.deployedStaging),
    deployedPublic: boolean(claimed.deployedPublic),
    releasePublished,
    artifactHosted,
    productionSigned: boolean(claimed.productionSigned),
    storeReleased: boolean(claimed.storeReleased),
    mainnetReleased: false,
    externallyBlocked: (coverage?.counts?.externalBlocked ?? 0) > 0
  };
}

function classify(row, states, ci) {
  const blockers = [...(row.blockers ?? [])];
  if (row.refs?.repositoryMatches !== true) blockers.push("repository identity is not verified");
  if (row.refs?.synced !== true) blockers.push("Local SHA does not equal Remote SHA");
  if (row.worktree?.clean !== true) blockers.push("Worktree is not clean");
  if (!states.testedLocal) blockers.push("testedLocal is not directly proven by release metadata and coverage");
  if (ci.exactHeadSuccess !== true) blockers.push("exact-head successful CI is not proven");
  if (states.productionSigned && !states.artifactHosted) blockers.push("production signing cannot precede hosted artifact evidence");

  const sourceReady = blockers.length === 0;
  const publicReady = sourceReady
    && states.integratedCentral
    && states.sharedTestnetVerified
    && !states.externallyBlocked;
  if (publicReady) {
    return {
      classification: "READY_FOR_PUBLIC_TESTNET",
      blockers,
      reason: "Source, exact-head CI, central acceptance and shared Testnet evidence are all directly present."
    };
  }
  if (sourceReady) {
    return {
      classification: "READY_FOR_SOURCE_RELEASE",
      blockers,
      reason: "Source and exact-head CI are protected; central Testnet or public-runtime gates remain separate."
    };
  }
  return {
    classification: "HOLD_FOR_RECOVERY",
    blockers: [...new Set(blockers)],
    reason: "At least one repository, synchronization, clean-tree, test, CI or evidence gate remains unproven."
  };
}

function validate(matrix) {
  if (matrix?.schemaVersion !== "1.0.0") throw new Error("schemaVersion must be 1.0.0");
  if (matrix?.owner !== "29-integration") throw new Error("owner must be 29-integration");
  if (!Array.isArray(matrix.products) || matrix.products.length !== 36) throw new Error("matrix must contain exactly 36 products");
  const expectedIds = Array.from({ length: 36 }, (_, index) => String(index + 1).padStart(2, "0"));
  if (JSON.stringify(matrix.products.map((product) => product.productNumber)) !== JSON.stringify(expectedIds)) {
    throw new Error("productNumber must be the ordered range 01 through 36");
  }
  for (const product of matrix.products) {
    if (!readinessClasses.includes(product.classification)) throw new Error(`product ${product.productNumber} has invalid classification`);
    for (const key of stateKeys) {
      if (typeof product.states?.[key] !== "boolean") throw new Error(`product ${product.productNumber} state ${key} is not boolean`);
    }
    if (!/^[0-9a-f]{40}$/.test(product.localSha ?? "")) throw new Error(`product ${product.productNumber} localSha is invalid`);
    if (!remoteShaIsTruthful(product)) throw new Error(`product ${product.productNumber} remoteSha is invalid or unaccounted for`);
    if (product.states.integratedCentral && !/^[0-9a-f]{40}$/.test(product.centralAcceptance?.acceptedSourceCommit ?? "")) {
      throw new Error(`product ${product.productNumber} claims central integration without an accepted commit`);
    }
    if (product.states.productionSigned && product.states.artifactHosted !== true) {
      throw new Error(`product ${product.productNumber} claims production signing without a hosted artifact`);
    }
    if (product.states.releasePublished && (!Array.isArray(product.release?.githubReleases) || product.release.githubReleases.length === 0)) {
      throw new Error(`product ${product.productNumber} claims a published release without direct GitHub release evidence`);
    }
    if (product.states.artifactHosted && !product.artifacts.some((artifact) => artifact.hostedStatus && artifact.downloadUrl)) {
      throw new Error(`product ${product.productNumber} claims a hosted artifact without a directly registered download`);
    }
  }
}

function selfTest() {
  const row = {
    refs: { repositoryMatches: true, localExists: true, remoteExists: true, synced: true },
    worktree: { registered: true, clean: true },
    evidence: {
      claimedReleaseStates: { implementedLocal: true, testedLocal: true },
      coverage: { counts: { testedLocal: 1, externalBlocked: 0 } }
    },
    centralAcceptance: { status: "implementedLocal", acceptedSourceCommit: null },
    blockers: []
  };
  const states = directStates(row);
  const ready = classify(row, states, { exactHeadSuccess: true });
  if (ready.classification !== "READY_FOR_SOURCE_RELEASE") throw new Error("source-ready self-test failed");
  const publishedStates = directStates(row, {
    githubReleases: [{ isDraft: false, publishedAt: "2026-07-29T00:00:00Z" }],
    hostedArtifacts: [{
      downloadUrl: "https://github.com/JiahaoAlbus/YNX-Chain/releases/download/test/example.tar"
    }]
  });
  if (!publishedStates.releasePublished || !publishedStates.artifactHosted) {
    throw new Error("direct release evidence self-test failed");
  }
  if (!remoteShaIsTruthful({ remoteSha: null, blockers: ["remote final branch is missing"] })) {
    throw new Error("missing remote truth self-test failed");
  }
  if (remoteShaIsTruthful({ remoteSha: null, blockers: [] })) {
    throw new Error("unaccounted missing remote self-test failed");
  }
  const dirty = structuredClone(row);
  dirty.worktree.clean = false;
  if (classify(dirty, directStates(dirty), { exactHeadSuccess: true }).classification !== "HOLD_FOR_RECOVERY") {
    throw new Error("dirty-tree fail-closed self-test failed");
  }
  console.log("product release matrix self-test passed");
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  if (process.argv.includes("--check")) {
    validate(readJson(outputPath));
    console.log("product release matrix check passed");
    return;
  }

  const acceptance = readJson(acceptancePath);
  const registry = readJson(registryPath);
  const githubEvidence = readJson(githubEvidencePath);
  const productRegistry = new Map(registry.products.map((product) => [product.id, product]));
  const repositories = [...new Set(acceptance.products.map((product) => product.repository))];
  const repositoryEvidence = new Map();

  for (const repository of repositories) {
    const pullRequests = ghJson([
      "pr", "list", "--repo", repository, "--state", "all", "--limit", "200",
      "--json", "number,state,isDraft,title,url,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,reviewDecision"
    ]);
    const main = ghJson(["api", `repos/${repository}/commits/main`, "--jq", "{sha:.sha}"]);
    const runs = repository === githubEvidence.repository
      ? { available: githubEvidence.availability?.runs === true, data: githubEvidence.runs ?? [], error: githubEvidence.queryErrors?.runs ?? null }
      : ghJson([
          "run", "list", "--repo", repository, "--limit", "200",
          "--json", "databaseId,name,workflowName,headBranch,headSha,status,conclusion,event,createdAt,updatedAt,url"
        ]);
    const artifacts = repository === githubEvidence.repository
      ? { available: githubEvidence.availability?.artifacts === true, data: githubEvidence.artifacts ?? [], error: githubEvidence.queryErrors?.artifacts ?? null }
      : { available: false, data: [], error: "artifact inventory not collected for external repository" };
    const releases = repository === githubEvidence.repository
      ? { available: githubEvidence.availability?.releases === true, data: githubEvidence.releases ?? [], error: githubEvidence.queryErrors?.releases ?? null }
      : ghJson([
          "release", "list", "--repo", repository, "--limit", "100",
          "--json", "tagName,name,isDraft,isPrerelease,publishedAt"
        ]);
    repositoryEvidence.set(repository, {
      pullRequests,
      mainSha: main.available ? main.data?.sha ?? null : null,
      mainError: main.error,
      runs,
      artifacts,
      releases
    });
  }

  const products = acceptance.products.map((row) => {
    const registered = productRegistry.get(row.id);
    const repository = row.repository;
    const repoEvidence = repositoryEvidence.get(repository);
    const headRuns = (repoEvidence?.runs?.data ?? []).filter((run) => run.headSha === row.refs.localSha);
    const exactHeadComplete = headRuns.length > 0 && headRuns.every((run) => run.status === "completed");
    const exactHeadSuccess = exactHeadComplete && headRuns.every((run) => ["success", "skipped", "neutral"].includes(run.conclusion));
    const pullRequest = (repoEvidence?.pullRequests?.data ?? []).find((pr) => pr.headRefName === row.branch) ?? null;
    const identityTokens = [
      registered?.slug,
      registered?.owner,
      registered?.product,
      ...(registered?.aliases ?? [])
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-"))
      .filter((value) => value.length >= 3);
    const githubArtifacts = (repoEvidence?.artifacts?.data ?? []).filter((artifact) => {
      if (artifact.headSha !== row.refs.localSha) return false;
      const normalized = String(artifact.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return identityTokens.some((token) => normalized.includes(token));
    });
    const localArtifacts = Array.isArray(row.evidence?.artifacts) ? row.evidence.artifacts : [];
    const declaredReleaseTags = new Set([
      ...localArtifacts.map((artifact) => artifact.releaseTag).filter(Boolean),
      ...(row.evidence?.release?.publicEvidence ?? [])
        .map((value) => String(value).match(/\/releases\/tag\/([^/?#]+)/)?.[1])
        .filter(Boolean)
    ]);
    const githubReleases = (repoEvidence?.releases?.data ?? []).filter((release) => {
      if (declaredReleaseTags.has(release.tagName)) return true;
      const normalized = `${release.tagName ?? ""} ${release.name ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return declaredReleaseTags.size === 0 && identityTokens.some((token) => normalized.includes(token));
    });
    const hostedArtifacts = localArtifacts.filter((artifact) =>
      artifact.hostedStatus
      && artifact.hostedStatus !== "not-hosted"
      && typeof artifact.downloadUrl === "string"
      && declaredReleaseTags.has(artifact.releaseTag)
    );
    const artifactNames = [
      ...githubArtifacts.map((artifact) => artifact.name),
      ...localArtifacts.flatMap((artifact) => [artifact.path, artifact.sbom, artifact.provenance]).filter(Boolean)
    ];
    const states = directStates(row, { githubReleases, hostedArtifacts });
    const ci = {
      available: repoEvidence?.runs?.available === true,
      exactHeadSha: row.refs.localSha,
      exactHeadComplete,
      exactHeadSuccess,
      runs: headRuns.map((run) => ({
        id: run.databaseId,
        workflow: run.workflowName ?? run.name,
        conclusion: run.conclusion,
        url: run.url
      })),
      error: repoEvidence?.runs?.error ?? null
    };
    const readiness = classify(row, states, ci);
    const worktreeToken = registered?.worktreeSlug ?? row.worktree?.pathToken ?? null;
    return {
      productNumber: row.id,
      productName: row.product,
      classification: readiness.classification,
      classificationReason: readiness.reason,
      expectedRepository: repository,
      actualRepository: row.refs.repositoryMatches ? repository : null,
      expectedWorktree: worktreeToken ? `YNX Final Worktrees/${worktreeToken}` : null,
      actualWorktree: row.worktree?.pathToken ?? null,
      expectedRemote: `https://github.com/${repository}.git`,
      actualRemote: row.refs.repositoryMatches ? `https://github.com/${repository}.git` : null,
      branch: row.branch,
      localSha: row.refs.localSha,
      remoteSha: row.refs.remoteSha,
      mainSha: repoEvidence?.mainSha ?? null,
      dirty: row.worktree?.clean !== true,
      ahead: row.refs.ahead,
      behind: row.refs.behind,
      tests: {
        coverage: row.evidence.coverage,
        sourceBindings: row.evidence.sourceBindings,
        requiredEvidencePaths: row.evidence.paths
      },
      ci,
      pullRequest,
      release: {
        evidencePath: row.evidence.paths.productRelease,
        record: row.evidence.release ?? null,
        claimedStates: row.evidence.claimedReleaseStates,
        directQueryAvailable: repoEvidence?.releases?.available === true,
        githubReleases: githubReleases.map((release) => ({
          tagName: release.tagName,
          name: release.name,
          isDraft: release.isDraft,
          isPrerelease: release.isPrerelease,
          publishedAt: release.publishedAt
        }))
      },
      artifacts: [
        ...githubArtifacts.map((artifact) => ({
          source: "github-actions",
          id: artifact.id,
          name: artifact.name,
          digest: artifact.digest ?? null,
          sizeInBytes: artifact.sizeInBytes,
          expired: artifact.expired
        })),
        ...localArtifacts.map((artifact) => ({
          source: "repository-registry",
          id: artifact.id ?? null,
          name: artifact.path ?? artifact.id ?? null,
          digest: artifact.sha256 ? `sha256:${artifact.sha256}` : null,
          sizeInBytes: artifact.bytes ?? null,
          expired: artifact.revocationStatus === "revoked",
          sourceCommit: artifact.sourceCommit ?? null,
          signingClass: artifact.signingClass ?? null,
          hostedStatus: artifact.hostedStatus ?? null,
          downloadUrl: artifact.downloadUrl ?? null,
          releaseTag: artifact.releaseTag ?? null
        }))
      ],
      sbom: {
        available: artifactNames.some((name) => /sbom|spdx|cyclonedx|cdx/i.test(name)),
        evidence: artifactNames.filter((name) => /sbom|spdx|cyclonedx|cdx/i.test(name))
      },
      provenance: {
        available: artifactNames.some((name) => /provenance|attestation|intoto/i.test(name)),
        evidence: artifactNames.filter((name) => /provenance|attestation|intoto/i.test(name))
      },
      integrationContract: row.evidence.paths.integrationContract,
      dependencyAcceptance: row.evidence.paths.dependencyAcceptance,
      websiteRoutes: [],
      publicRuntimeSha: null,
      states,
      centralAcceptance: row.centralAcceptance,
      blockers: readiness.blockers,
      nextAction: readiness.blockers[0] ? `Resolve: ${readiness.blockers[0]}.` : row.nextAction,
      updatedAt: acceptance.generatedAt
    };
  });

  const matrix = {
    schemaVersion: "1.0.0",
    owner: "29-integration",
    authority: "release/integration/product-registry.json",
    generatedAt: acceptance.generatedAt,
    controllerSourceCommit: acceptance.controllerSourceCommit,
    readinessClasses,
    stateKeys,
    summary: {
      totalProducts: products.length,
      readyForPublicTestnet: products.filter((product) => product.classification === "READY_FOR_PUBLIC_TESTNET").length,
      readyForSourceRelease: products.filter((product) => product.classification === "READY_FOR_SOURCE_RELEASE").length,
      holdForRecovery: products.filter((product) => product.classification === "HOLD_FOR_RECOVERY").length,
      synced: products.filter((product) => product.localSha === product.remoteSha).length,
      clean: products.filter((product) => product.dirty === false).length,
      exactHeadCiSuccess: products.filter((product) => product.ci.exactHeadSuccess).length,
      centrallyAccepted: products.filter((product) => product.states.integratedCentral).length
    },
    repositoryQueries: Object.fromEntries([...repositoryEvidence].map(([repository, evidence]) => [
      repository,
      {
        pullRequestsAvailable: evidence.pullRequests.available,
        runsAvailable: evidence.runs.available,
        artifactsAvailable: evidence.artifacts.available,
        releasesAvailable: evidence.releases.available,
        mainSha: evidence.mainSha,
        errors: [evidence.pullRequests.error, evidence.runs.error, evidence.artifacts.error, evidence.releases.error, evidence.mainError].filter(Boolean)
      }
    ])),
    products
  };

  validate(matrix);
  fs.writeFileSync(path.join(root, outputPath), `${JSON.stringify(matrix, null, 2)}\n`);
  console.log(`wrote ${outputPath} for ${products.length} products`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
