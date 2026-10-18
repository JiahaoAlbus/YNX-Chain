#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateInheritedProfile } from "./inherited-profile.mjs";

export const SOURCE_COMMIT = "2dbfc1146a0ca23fdd7ce10dccd4ab80dec5be49";
export const INTERNAL_TREE = "f1342d3123f2366797e71c65a4e160cac377c9f2";
const VERSION = "1.13.0-source-candidate.2";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const FILES = {
  release: "product-release.json",
  contract: "chain-core-contract.json",
  vectors: "cross-product-test-vectors.json",
  map: "source-map.json"
};
const BASELINE = {
  "release/chain-core/product-release.json": "release",
  "release/integration/chain-core-contract.json": "contract",
  "docs/integration/CHAIN_CORE_CROSS_PRODUCT_TEST_VECTORS.json": "vectors"
};
const requireValue = (condition, message) => {
  if (!condition) throw new Error(`perf-v13-fee-chunks-candidate: ${message}`);
};
const sha256 = (raw) => createHash("sha256").update(raw).digest("hex");

export function loadCandidate(directory = HERE) {
  return Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, JSON.parse(readFileSync(join(directory, name), "utf8"))]));
}

// Always reads immutable Git objects at the exact Perf commit. Current HEAD,
// working source files and the independent Protocol schema 15/16/17 are not inputs.
export function validateCandidate({ repository = ROOT, documents = loadCandidate() } = {}) {
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "pipe"] });
  requireValue(git("rev-parse", `${SOURCE_COMMIT}^{commit}`).trim() === SOURCE_COMMIT, "fixed source commit unavailable");
  requireValue(git("rev-parse", `${SOURCE_COMMIT}:internal`).trim() === INTERNAL_TREE, "fixed internal tree differs");
  const cache = new Map();
  const readSource = (path) => {
    requireValue(typeof path === "string" && !path.startsWith("/") && !path.split("/").includes(".."), "unsafe source path");
    if (!cache.has(path)) cache.set(path, git("show", `${SOURCE_COMMIT}:${path}`));
    return cache.get(path);
  };
  const { release, contract, vectors, map } = documents;
  requireValue(map.schema === "ynx-fixed-source-integration-map/v1" && map.sourceCommit === SOURCE_COMMIT && map.internalTree === INTERNAL_TREE, "source map identity drift");
  const originalChecker = readSource("scripts/verify/integration-contract-check.mjs");
  const expectedPaths = [...new Set([...originalChecker.matchAll(/(?:readFileSync|readJSON)\("([^"]+)"/g)].map((m) => m[1]).concat("scripts/verify/integration-contract-check.mjs", "internal/consensus/dex_action_test.go", "internal/consensus/state_hash_json_test.go", "internal/consensus/snapshot_test.go"))].sort();
  requireValue(isDeepStrictEqual(Object.keys(map.files).sort(), expectedPaths), "source map omitted or substituted a runtime input");
  for (const path of expectedPaths) {
    const source = readSource(path);
    requireValue(isDeepStrictEqual(map.files[path], { sha256: sha256(source), bytes: Buffer.byteLength(source) }), `source hash/size mismatch: ${path}`);
  }
  const kernel = map.kernelDerivation;
  const kernelPaths = ["internal/consensus/state_hash_json.go", "internal/consensus/state_hash_json_test.go", "internal/consensus/state_hash_streaming_test.go"];
  requireValue(kernel && isDeepStrictEqual(Object.keys(kernel).sort(), ["kernelCommit", "kernelFiles", "performanceMeasured", "predecessorInternalTree", "predecessorSourceCommit"].sort()) &&
    kernel.predecessorSourceCommit === "d47b0fb8bf817093d1da0cd0dc8b08725bfae0f7" && kernel.predecessorInternalTree === "fc5ccab4e9aa6923bc61a2dc7ac518343ac56703" &&
    kernel.kernelCommit === "eb6e3199280adde67426e1c04a5403fc1e31d16a" && kernel.performanceMeasured === false, "kernel derivation identity or performance claim drift");
  requireValue(git("rev-parse", `${kernel.kernelCommit}:internal`).trim() === INTERNAL_TREE, "kernel commit does not supply the fixed complete internal tree");
  requireValue(isDeepStrictEqual(Object.keys(kernel.kernelFiles).sort(), kernelPaths), "kernel source inventory omitted or substituted");
  for (const path of kernelPaths) {
    const source = readSource(path);
    requireValue(isDeepStrictEqual(kernel.kernelFiles[path], {sha256: sha256(source), bytes: Buffer.byteLength(source)}), `kernel source hash/size mismatch: ${path}`);
  }
  const kernelTests = readSource("internal/consensus/state_hash_streaming_test.go");
  for (const name of ["TestStateHashFeeChunkingMatchesEveryCanonicalByte", "TestStateHashFeeChunkingRejectsLateErrorsAndInvalidFraming", "TestStateHashFeeChunkingRealSignedHistoryPreservesRestartAndAudit"]) {
    requireValue(kernelTests.includes(`func ${name}(t *testing.T)`), `kernel regression source missing: ${name}`);
  }
  const performance = {measured: false, claimedTps: null, speedupRatio: null, finalityMeasured: false};
  requireValue(isDeepStrictEqual(release.candidatePerformance, performance) && isDeepStrictEqual(contract.candidatePerformance, performance), "unmeasured kernel performance or finality claim");
  requireValue(isDeepStrictEqual(Object.keys(map.publishedPredecessorFiles).sort(), Object.keys(BASELINE).sort()), "published predecessor list drift");
  for (const path of Object.keys(BASELINE)) {
    requireValue(isDeepStrictEqual(map.publishedPredecessorFiles[path], map.files[path]), `published predecessor pin drift: ${path}`);
    // A checkout containing the published originals must retain their bytes.
    // Some Protocol checkouts do not contain those files; the Git objects are
    // still pinned above and are never recreated or written by this checker.
    if (existsSync(join(repository, path))) {
      requireValue(sha256(readFileSync(join(repository, path))) === map.files[path].sha256, `published predecessor was changed in checkout: ${path}`);
    }
  }
  requireValue(release.source.implementationCommit === SOURCE_COMMIT && release.source.internalTree === INTERNAL_TREE && contract.sourceCommit === SOURCE_COMMIT && vectors.sourceCommit === SOURCE_COMMIT, "candidate source substitution");
  requireValue(release.source.committedStateVersion === 13 && release.source.applicationVersion === 19 && vectors.candidateContractVersion === VERSION, "candidate release/vector version drift");
  const expectedStatus = { implementedLocal: true, testedLocal: false, installedLocal: false, integratedCentral: false, deployedStaging: false, deployedPublic: false, downloadHosted: false, productionSigned: false, storeReleased: false };
  requireValue(isDeepStrictEqual(release.releaseStatus, expectedStatus) && isDeepStrictEqual(contract.releaseStatus, expectedStatus), "candidate claimed unperformed tests, packaging or deployment");
  requireValue(release.sourceRelease.targetCommit === SOURCE_COMMIT && release.sourceRelease.tag === null && release.sourceRelease.url === null && release.sourceRelease.productionSigned === false, "candidate cannot replace the existing published source release");
  const c = contract.candidateCompatibility;
  requireValue(isDeepStrictEqual(c, release.candidateCompatibility), "candidate compatibility documents differ");
  requireValue(c.sourceStream === "performance" && c.committedStateVersion === 13 && c.applicationVersion === 19 && c.appHashDomain === "YNX_ABCI_STATE_V13", "performance schema/domain/app drift");
  requireValue(isDeepStrictEqual(c.publishedPredecessor, { sourceCommit: "cb20b1591f81328a26ce5c412600135ffb6894bb", contractVersion: "1.12.0", committedStateVersion: 12, applicationVersion: 18, appHashDomain: "YNX_ABCI_STATE_V12" }), "published predecessor identity drift");
  requireValue(isDeepStrictEqual(c.protocolStream, { baseCommittedStateVersion: 15, applicationVersion: 15, validatorRegistryStateVersion: 16, pqEngineScheduleStateVersion: 17, interchangeable: false }), "independent Protocol stream conflated with Perf");
  requireValue(isDeepStrictEqual(c.diskUpgrade, { fromCommittedStateVersion: 12, toCommittedStateVersion: 13, validateOriginalAppHashBeforeUpgrade: true, originalHashDomain: "YNX_ABCI_STATE_V12", emptyNewDEXCollections: true, preserveExistingAccountsAndHistory: true, trustedMigrationAnchorRequired: true }), "disk upgrade boundary drift");
  requireValue(isDeepStrictEqual(c.stateSync, { acceptedCommittedStateVersion: 13, acceptsVersion12Snapshot: false, trustedAppHashRequired: true }), "state-sync version or trusted-root boundary drift");
  requireValue(isDeepStrictEqual(c.replay, { nonceReplayRejected: true, mixedApplicationVersionConsensusSupported: false, arbitrarySnapshotRollbackProven: false, independentTrustedCheckpointRequired: true }), "replay or rollback boundary drift");
  requireValue(isDeepStrictEqual(c.evidence, { validatorKind: "node-source-contract-check", goTestsRunByThisCandidate: false, liveDeployment: false, inheritedCapabilityEvidenceSource: "cb20b1591f81328a26ce5c412600135ffb6894bb", historicalCapabilityClaimsAreNewRuntimeTestResults: false }), "candidate evidence overclaim");
  const predecessorVectors = JSON.parse(readSource("docs/integration/CHAIN_CORE_CROSS_PRODUCT_TEST_VECTORS.json")).vectors;
  requireValue(vectors.vectors.length === predecessorVectors.length + 5 && predecessorVectors.every((v, i) => isDeepStrictEqual(v, vectors.vectors[i])), "predecessor vectors or negative assertions were removed/changed");
  const addedIDs = ["candidate-perf-v13-source-binding-accept", "candidate-v12-disk-upgrade-boundary-accept", "candidate-protocol-v17-substitution-reject", "candidate-v12-state-sync-reject", "candidate-untrusted-replay-claim-reject"];
  requireValue(isDeepStrictEqual(vectors.vectors.slice(predecessorVectors.length).map((v) => v.id), addedIDs), "candidate boundary vectors missing");
  const state = readSource("internal/consensus/state.go");
  const upgradeStart = state.indexOf("if state.Version == 12 {");
  const upgradeEnd = state.indexOf("if err := state.Validate(migration)", upgradeStart);
  requireValue(upgradeStart >= 0 && upgradeEnd > upgradeStart, "actual v12 loader upgrade is missing");
  const upgrade = state.slice(upgradeStart, upgradeEnd);
  const hashAt = upgrade.indexOf('state.calculateHashFor("YNX_ABCI_STATE_V12", 12)');
  const rejectAt = upgrade.indexOf('errors.New("v12 committed state app hash is invalid")');
  const versionAt = upgrade.indexOf("state.Version = CommittedStateVersion");
  requireValue(hashAt >= 0 && rejectAt > hashAt && versionAt > rejectAt, "v12 original hash must be verified before changing versions");
  for (const [field, type] of [["DexAssets", "BFTDexAsset"], ["DexBalances", "BFTDexBalance"], ["DexPools", "BFTDexPool"], ["DexEvents", "BFTDexEvent"]]) {
    requireValue(upgrade.includes(`state.${field} = []${type}{}`), `v12 upgrade must initialize empty ${field}`);
  }
  requireValue(!/state\.(?:Accounts|FeeEvents|Contracts|EVMReceipts|EVMLogs)\s*=/.test(upgrade), "v12 upgrade rewrites original account/history fields");
  requireValue(readSource("internal/consensus/dex_action_test.go").includes("func TestCommittedStateMigratesVersion12WithoutInventingDEXRecords"), "real v12 runtime regression source missing");
  const snapshot = readSource("internal/consensus/snapshot.go");
  requireValue(snapshot.includes("metadata.StateVersion != CommittedStateVersion") && snapshot.includes("!bytes.Equal(metadataAppHash, req.AppHash)") && snapshot.includes("state.Validate(a.migration)") && snapshot.includes("!bytes.Equal(stateAppHash, restore.expectedAppHash)"), "state sync must bind exact version, validated state and external AppHash");
  const readJSON = (path) => BASELINE[path] ? documents[BASELINE[path]] : JSON.parse(readSource(path));
  const result = validateInheritedProfile(readJSON, readSource);
  return { ...result, internalTree: INTERNAL_TREE, sourceFiles: expectedPaths.length, kernelSourceFiles: kernelPaths.length, performanceMeasured: false, validation: "node-source-contract-only", goRuntimeTestsRun: false, published: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    requireValue((args[i] === "--repository" || args[i] === "--bundle") && args[i + 1], "usage: check.mjs [--repository PATH] [--bundle PATH]");
    if (args[i] === "--repository") options.repository = resolve(args[i + 1]);
    else options.documents = loadCandidate(resolve(args[i + 1]));
  }
  console.log(JSON.stringify(validateCandidate(options), null, 2));
}
