#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateInheritedProfile } from "./inherited-profile.mjs";

export const SOURCE_COMMIT = "f17643a802423649dd970364e2a062e8c0e2c12c";
export const INTERNAL_TREE = "1f99b28575b63877470a94ab46fb2671508b4bf1";
export const EXPECTED_SEAL_EVIDENCE = {"sourceCommit":"8782774edb3034a316294e844d96e33936908640","internalTree":"0223c12969236080e86ad7534ec98bd8e43180cb","runId":39118758324,"runConclusion":"failure","failureGate":"old SDK candidate.3 exact internal identity, not source or phase tests","fullGoSourceGate":"success","phaseAndMutationTests":"success","measurement":{"app_hash":"319286dab91464e63ab63dcd1f30236259abcf5172b484845d98e262c1ac5e65","business_tps":null,"fee_events":1024,"finality_latency":null,"inclusion_latency":null,"measurement":"retained_real_1024_state_seal_ABBA_and_atomic_persistence","rows":[{"atomic_commit_elapsed_ns":14719763,"atomic_commit_stages_ns":{"close_file":9037,"directory_sync":183020,"file_sync":3813715,"json_encode":6391748,"prepare_file":40946,"rename":131475,"validate":3917147,"write":214991},"guarded":false,"order":0,"payload_bytes":812656,"seal_allocated_bytes":1159392,"seal_allocations":11071,"seal_elapsed_ns":6708558,"seal_stages_ns":{"clone_and_materialize":637638,"final_hash":2063373,"initial_hash":2731068,"semantic_validate":1275396,"witness_compare":201,"witness_copy":220},"second_hash_executed":true},{"atomic_commit_elapsed_ns":10849964,"atomic_commit_stages_ns":{"close_file":7945,"directory_sync":208098,"file_sync":838222,"json_encode":6553549,"prepare_file":40315,"rename":24816,"validate":2967548,"write":199031},"guarded":true,"order":1,"payload_bytes":812656,"seal_allocated_bytes":1249968,"seal_allocations":8913,"seal_elapsed_ns":5381936,"seal_stages_ns":{"clone_and_materialize":475797,"initial_hash":2573454,"semantic_validate":1534689,"witness_compare":176289,"witness_copy":621107},"second_hash_executed":false},{"atomic_commit_elapsed_ns":11401812,"atomic_commit_stages_ns":{"close_file":6532,"directory_sync":150771,"file_sync":1001566,"json_encode":6749444,"prepare_file":36749,"rename":24045,"validate":3200713,"write":221883},"guarded":true,"order":2,"payload_bytes":812656,"seal_allocated_bytes":1250000,"seal_allocations":8914,"seal_elapsed_ns":4817145,"seal_stages_ns":{"clone_and_materialize":493670,"initial_hash":3112218,"semantic_validate":951683,"witness_compare":172882,"witness_copy":85960},"second_hash_executed":false},{"atomic_commit_elapsed_ns":10295721,"atomic_commit_stages_ns":{"close_file":6983,"directory_sync":145020,"file_sync":740690,"json_encode":6025426,"prepare_file":91780,"rename":24756,"validate":3048790,"write":202067},"guarded":false,"order":3,"payload_bytes":812656,"seal_allocated_bytes":1159248,"seal_allocations":11069,"seal_elapsed_ns":5245453,"seal_stages_ns":{"clone_and_materialize":148356,"final_hash":2120441,"initial_hash":2062082,"semantic_validate":913522,"witness_compare":120,"witness_copy":250},"second_hash_executed":true}],"runtime_candidate_enabled":false},"means":{"original":{"seal_elapsed_ns":5977005.5,"seal_allocated_bytes":1159320,"seal_allocations":11070,"atomic_commit_elapsed_ns":12507742,"seal_stages_mean_ns":{"clone_and_materialize":392997,"final_hash":2091907,"semantic_validate":1094459,"initial_hash":2396575,"witness_copy":235,"witness_compare":160.5},"atomic_commit_stages_mean_ns":{"json_encode":6208587,"write":208529,"validate":3482968.5,"prepare_file":66363,"close_file":8010,"directory_sync":164020,"file_sync":2277202.5,"rename":78115.5}},"guarded":{"seal_elapsed_ns":5099540.5,"seal_allocated_bytes":1249984,"seal_allocations":8913.5,"atomic_commit_elapsed_ns":11125888,"seal_stages_mean_ns":{"clone_and_materialize":484733.5,"semantic_validate":1243186,"initial_hash":2842836,"witness_copy":353533.5,"witness_compare":174585.5},"atomic_commit_stages_mean_ns":{"json_encode":6651496.5,"write":210457,"validate":3084130.5,"prepare_file":38532,"close_file":7238.5,"directory_sync":179434.5,"file_sync":919894,"rename":24430.5}}},"sealElapsedChangePercent":-14.68067914610418,"allocationBytesChangePercent":7.820446468619546,"rawLogBytes":378512,"rawLogSHA256":"f3d069bc32f704a0c316cc179b28de2f58cbc67069f0b9aa917b1acc6f71eb2c","limits":["Two short samples per mode in ABBA order on retained actual 1024-transfer state; not sustained workload or TPS.","Atomic snapshot persistence is measured unchanged; guarded seal only targets local Finalize sealing.","Both modes use identical canonical hash and complete state bytes; original runtime default remains active.","No network inclusion or BFT finality measurement in this case."]};
export const EXPECTED_RECOVERY_PERFORMANCE = {"sourceCommit":"1db2c267fbc47b48dd514a20f09ad0306bfd8972","internalTree":"42b2289a323fd487e4d62a76de0845abcb66ec79","runId":39116956504,"runConclusion":"success","scope":"same-process original versus explicitly invoked revised experiment; retained actual1024-transfer snapshot; not business TPS or BFT finality","activeRuntimeHash":"original borrowed encoder","experimentalAutomaticallyActive":false,"fixtureSHA256":"ea203b08c94178ec0132b71f3ec16d731de8e44595f6fd742e331b41d80caf56","fixtureBytes":812656,"gomaxprocs":1,"gogc":50,"goMemoryTarget":"160MiB","benchTimePerSample":"200ms","samples":{"original_borrowed_encoder":[{"iterations":136,"nsPerOp":1718595.0,"bytesPerOp":76994.0,"allocsPerOp":2055.0},{"iterations":138,"nsPerOp":1718381.0,"bytesPerOp":76994.0,"allocsPerOp":2055.0},{"iterations":138,"nsPerOp":1720538.0,"bytesPerOp":76994.0,"allocsPerOp":2055.0}],"fee_chunked_encoder":[{"iterations":100,"nsPerOp":2137304.0,"bytesPerOp":77406.0,"allocsPerOp":2067.0},{"iterations":100,"nsPerOp":2143255.0,"bytesPerOp":77406.0,"allocsPerOp":2067.0},{"iterations":100,"nsPerOp":2125582.0,"bytesPerOp":77406.0,"allocsPerOp":2067.0}]},"medians":{"original_borrowed_encoder":{"nsPerOp":1718595.0,"bytesPerOp":76994.0,"allocsPerOp":2055.0},"fee_chunked_encoder":{"nsPerOp":2137304.0,"bytesPerOp":77406.0,"allocsPerOp":2067.0}},"candidateChangePercent":{"nsPerOp":24.36344804913315,"bytesPerOp":0.535106631685589,"allocsPerOp":0.5839416058394109},"rawLogBytes":371630,"rawLogSHA256":"b08ffcbc293f6b174a02bc495705daef457712724df2c022d85ae84f00cf5d03","previousNegativeRunRetained":39114847427,"limits":["Three short sequential Go benchmark samples per mode, no sustained throughput or application pipeline result.","B/op is total Go allocation, not peak RSS.","Both functions reproduce the original AppHash; experiment is not the runtime default.","Do not compare absolute cross-run timings as a controlled speedup."]};
export const EXPECTED_LARGE_HISTORY_VALIDATION = {"sourceCommit":"f17643a802423649dd970364e2a062e8c0e2c12c","testName":"TestSealGuardedActualLargeHistoryPhases","executed":false,"measured":false,"businessTps":null,"finalityMeasured":false};
const VERSION = "1.13.0-source-candidate.4";
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
  if (!condition) throw new Error(`perf-v13-seal-guarded-candidate: ${message}`);
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
    kernel.predecessorSourceCommit === "78071d90b4be0883849b420290d70a74651bdabc" && kernel.predecessorInternalTree === "42b2289a323fd487e4d62a76de0845abcb66ec79" &&
    kernel.kernelCommit === "f17643a802423649dd970364e2a062e8c0e2c12c" && kernel.performanceMeasured === false, "kernel derivation identity or performance claim drift");
  requireValue(git("rev-parse", `${kernel.kernelCommit}:internal`).trim() === INTERNAL_TREE, "kernel commit does not supply the fixed complete internal tree");
  requireValue(isDeepStrictEqual(Object.keys(kernel.kernelFiles).sort(), kernelPaths), "kernel source inventory omitted or substituted");
  for (const path of kernelPaths) {
    const source = readSource(path);
    requireValue(isDeepStrictEqual(kernel.kernelFiles[path], {sha256: sha256(source), bytes: Buffer.byteLength(source)}), `kernel source hash/size mismatch: ${path}`);
  }
  const kernelTests = readSource("internal/consensus/state_hash_streaming_test.go");
  for (const name of ["TestStateHashFeeChunkingMatchesEveryCanonicalByte", "TestStateHashFeeChunkingRejectsLateErrorsAndInvalidFraming", "TestStateHashFeeBoundsIgnoreNestedNamesAndEscapedValues", "TestStateHashFeeChunkingRealSignedHistoryPreservesRestartAndAudit"]) {
    requireValue(kernelTests.includes(`func ${name}(t *testing.T)`), `kernel regression source missing: ${name}`);
  }
  const sealPaths = ["internal/consensus/state.go", "internal/consensus/state_seal_guard.go", "internal/consensus/state_seal_guard_test.go", "docs/performance/fixtures/state-hash-real-1024-migration.json", "docs/performance/fixtures/state-hash-real-1024.json", "docs/performance/fixtures/state-hash-real-1024.manifest.json", "internal/consensus/state_seal_large_history_test.go", "docs/performance/evidence/seal-guarded-phases-ci-39118758324-actual.json"];
  const seal = map.sealWitnessDerivation;
  requireValue(seal && isDeepStrictEqual(Object.keys(seal).sort(), ["sourceCommit", "predecessorSourceCommit", "predecessorInternalTree", "runtimeEnabled", "files"].sort()) && seal.sourceCommit === SOURCE_COMMIT && seal.predecessorSourceCommit === "78071d90b4be0883849b420290d70a74651bdabc" && seal.predecessorInternalTree === "42b2289a323fd487e4d62a76de0845abcb66ec79" && seal.runtimeEnabled === false, "seal witness derivation identity or activation drift");
  requireValue(isDeepStrictEqual(Object.keys(seal.files).sort(), [...sealPaths].sort()), "seal witness source inventory drift");
  for (const path of sealPaths) {
    const source = readSource(path);
    requireValue(isDeepStrictEqual(seal.files[path], {sha256:sha256(source),bytes:Buffer.byteLength(source)}), `seal witness source hash/size mismatch: ${path}`);
  }
  requireValue(isDeepStrictEqual(release.sealWitnessEvidence, EXPECTED_SEAL_EVIDENCE) && isDeepStrictEqual(contract.sealWitnessEvidence, EXPECTED_SEAL_EVIDENCE), "seal witness measured evidence scope or metrics drift");
  requireValue(isDeepStrictEqual(release.previousRecoveryPerformance, EXPECTED_RECOVERY_PERFORMANCE) && isDeepStrictEqual(contract.previousRecoveryPerformance, EXPECTED_RECOVERY_PERFORMANCE), "second negative experiment evidence changed");
  const sealSource = readSource("internal/consensus/state.go");
  const defaultStart = sealSource.indexOf("func sealCommittedState(");
  const defaultEnd = sealSource.indexOf("\nfunc sealCommittedStateMeasured(", defaultStart);
  const defaultBody = sealSource.slice(defaultStart, defaultEnd).replace(/\/\/[^\n]*/g, "").trim();
  requireValue(/^func sealCommittedState\(migration chain.ConsensusMigrationState, height int64, execution executionState\) \(CommittedState, error\) \{\s*return sealCommittedStateMeasured\(migration, height, execution, false, nil\)\s*\}$/.test(defaultBody), "public seal must keep guarded experiment inactive");
  const validateStart = sealSource.indexOf("func (s CommittedState) Validate(");
  const validateEnd = sealSource.indexOf("\nfunc (s CommittedState) validateSemantics(", validateStart);
  const validateBody = sealSource.slice(validateStart, validateEnd);
  requireValue(validateBody.includes("s.validateSemantics(migration)") && validateBody.includes("return s.validateAppHash(migration)"), "public validation must retain semantic and complete AppHash checks");
  const sealTests = readSource("internal/consensus/state_seal_guard_test.go");
  for(const name of ["TestSealWitnessRejectsEveryRecordAndValueMutation", "TestSealGuardedRealStateMatchedPhases", "TestSealGuardPreservesFirstErrorAndCommitTamperRejection"]) requireValue(sealTests.includes(`func ${name}(t *testing.T)`), `seal witness regression source missing: ${name}`);
  requireValue(isDeepStrictEqual(release.largeHistoryValidation, EXPECTED_LARGE_HISTORY_VALIDATION) && isDeepStrictEqual(contract.largeHistoryValidation, EXPECTED_LARGE_HISTORY_VALIDATION), "large history execution or performance claim drift");
  requireValue(isDeepStrictEqual(JSON.parse(readSource("docs/performance/evidence/seal-guarded-phases-ci-39118758324-actual.json")), EXPECTED_SEAL_EVIDENCE), "committed short history proof differs from measured source evidence");
  requireValue(readSource("internal/consensus/state_seal_large_history_test.go").includes("func TestSealGuardedActualLargeHistoryPhases(t *testing.T)"), "large history regression source missing");
  const performance = {measured: false, claimedTps: null, speedupRatio: null, finalityMeasured: false};
  requireValue(isDeepStrictEqual(release.candidatePerformance, performance) && isDeepStrictEqual(contract.candidatePerformance, performance), "unmeasured kernel performance or finality claim");
  const activation = {publicHash: "original-borrowed-encoder", experimentalFeeChunks: "direct-call-and-benchmark-only", automaticActivation: false};
  requireValue(isDeepStrictEqual(release.candidateActivation, activation) && isDeepStrictEqual(contract.candidateActivation, activation), "borrowed recovery activation boundary drift");
  const previousPerformance = {sourceCommit: "2dbfc1146a0ca23fdd7ce10dccd4ab80dec5be49", integrationCommit: "2509fd612f2f602a901c534b544c20a272d72c4e", internalTree: "f1342d3123f2366797e71c65a4e160cac377c9f2", measurementRun: 39114847427, outcome: "regression", activationWithdrawn: true};
  requireValue(isDeepStrictEqual(release.previousCandidatePerformance, previousPerformance) && isDeepStrictEqual(contract.previousCandidatePerformance, previousPerformance), "previous negative performance evidence or withdrawal changed");
  const kernelSource = readSource("internal/consensus/state_hash_json.go");
  const publicStart = kernelSource.indexOf("func hashCommittedStateDocument(");
  const publicEnd = kernelSource.indexOf("\nfunc hashSingleBufferDocument(", publicStart);
  const publicBody = kernelSource.slice(publicStart, publicEnd).replace(/\/\/[^\n]*/g, "").trim();
  requireValue(publicStart >= 0 && publicEnd > publicStart && /^func hashCommittedStateDocument\(doc committedStateHashDocument\) \(string, error\) \{\s*return hashSingleBufferDocument\(doc\)\s*\}$/.test(publicBody), "public state hash must use borrowed default only");
  requireValue(readSource("internal/consensus/state_hash_json_test.go").includes('{"fee_chunked_encoder", hashFeeChunkedDocument}'), "experimental benchmark must call the distinct experimental encoder");
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
  return { ...result, internalTree: INTERNAL_TREE, sourceFiles: expectedPaths.length, kernelSourceFiles: kernelPaths.length, sealSourceFiles: sealPaths.length, sealRuntimeEnabled: false, localSealMeasured: true, publicHash: activation.publicHash, experimentalAutomaticallyActive: false, performanceMeasured: false, validation: "node-source-contract-only", goRuntimeTestsRun: false, published: false };
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
