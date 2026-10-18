import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { INTERNAL_TREE, SOURCE_COMMIT, loadCandidate, validateCandidate } from "./check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../../..");
const original = loadCandidate();
const hash = (b) => createHash("sha256").update(b).digest("hex");
const publishedBefore = Object.keys(original.map.publishedPredecessorFiles).map((path) => ({ path, present: existsSync(join(repository, path)), hash: existsSync(join(repository, path)) ? hash(readFileSync(join(repository, path))) : null }));
const changeCompatibility = (documents, fn) => {
  fn(documents.contract.candidateCompatibility);
  documents.release.candidateCompatibility = structuredClone(documents.contract.candidateCompatibility);
};

test("actual fixed Perf source passes all inherited assertions and candidate boundaries", () => {
  const result = validateCandidate({ repository, documents: structuredClone(original) });
  assert.deepEqual(result, { vectorCount: 76, sourceCommit: SOURCE_COMMIT, stateVersion: 13, applicationVersion: 19, internalTree: INTERNAL_TREE, sourceFiles: 23, kernelSourceFiles: 3, sealSourceFiles: 8, sealRuntimeEnabled: false, localSealMeasured: true, performanceMeasured: false, publicHash: "original-borrowed-encoder", experimentalAutomaticallyActive: false, validation: "node-source-contract-only", goRuntimeTestsRun: false, published: false });
});

const negatives = [
  ["wrong-source-commit", (d) => { d.release.source.implementationCommit = d.contract.sourceCommit = d.vectors.sourceCommit = "a50f7bc4fd28ca5a17780c1be674c54c66657c1b"; }, /source substitution/],
  ["wrong-internal-tree", (d) => { d.map.internalTree = "0".repeat(40); }, /source map identity/],
  ["forged-source-digest", (d) => { d.map.files["internal/consensus/state.go"].sha256 = "0".repeat(64); }, /source hash\/size/],
  ["omitted-runtime-source", (d) => { delete d.map.files["internal/consensus/snapshot.go"]; }, /source map omitted/],
  ["published-predecessor-pin-replaced", (d) => { d.map.publishedPredecessorFiles["release/chain-core/product-release.json"].sha256 = "0".repeat(64); }, /predecessor pin drift/],
  ["state-schema-12-retained", (d) => { d.contract.stateSchema.committedStateVersion = 12; }, /contract committed-state version/],
  ["app-version-18-retained", (d) => { d.contract.stateSchema.applicationVersion = 18; }, /contract ABCI application version/],
  ["wrong-apphash-domain", (d) => { d.contract.stateSchema.appHashDomain = "YNX_ABCI_STATE_V12"; }, /contract AppHash domain/],
  ["protocol-17-conflation", (d) => { changeCompatibility(d, (c) => { c.committedStateVersion = 17; c.applicationVersion = 15; }); }, /performance schema\/domain\/app/],
  ["cross-stream-interchangeability-claim", (d) => { changeCompatibility(d, (c) => { c.protocolStream.interchangeable = true; }); }, /Protocol stream/],
  ["skip-original-v12-hash", (d) => { changeCompatibility(d, (c) => { c.diskUpgrade.validateOriginalAppHashBeforeUpgrade = false; }); }, /disk upgrade boundary/],
  ["invent-v12-dex-records", (d) => { changeCompatibility(d, (c) => { c.diskUpgrade.emptyNewDEXCollections = false; }); }, /disk upgrade boundary/],
  ["accept-v12-state-sync", (d) => { changeCompatibility(d, (c) => { c.stateSync.acceptsVersion12Snapshot = true; }); }, /state-sync version/],
  ["untrusted-state-sync", (d) => { changeCompatibility(d, (c) => { c.stateSync.trustedAppHashRequired = false; }); }, /state-sync version/],
  ["replay-allowed", (d) => { changeCompatibility(d, (c) => { c.replay.nonceReplayRejected = false; }); }, /replay or rollback/],
  ["self-sealed-rollback-proof-claim", (d) => { changeCompatibility(d, (c) => { c.replay.arbitrarySnapshotRollbackProven = true; }); }, /replay or rollback/],
  ["mixed-app-consensus-claim", (d) => { changeCompatibility(d, (c) => { c.replay.mixedApplicationVersionConsensusSupported = true; }); }, /replay or rollback/],
  ["remove-original-replay-negative", (d) => { d.vectors.vectors = d.vectors.vectors.filter((v) => v.id !== "native-transfer-replay-reject"); }, /predecessor vectors/],
  ["weaken-original-replay-negative", (d) => { d.vectors.vectors.find((v) => v.id === "native-transfer-replay-reject").expected = "accept"; }, /predecessor vectors/],
  ["fabricate-go-pass", (d) => { d.release.releaseStatus.testedLocal = d.contract.releaseStatus.testedLocal = true; }, /unperformed tests/],
  ["fabricate-public-deployment", (d) => { d.release.releaseStatus.deployedPublic = d.contract.releaseStatus.deployedPublic = true; }, /deployment/],
  ["fabricate-download", (d) => { d.release.releaseStatus.downloadHosted = d.contract.releaseStatus.downloadHosted = true; }, /packaging/],
  ["replace-original-release-tag", (d) => { d.release.sourceRelease.tag = "chain-core-v0.2.0-source-candidate"; }, /existing published source release/],
  ["claim-inherited-results-as-new", (d) => { changeCompatibility(d, (c) => { c.evidence.historicalCapabilityClaimsAreNewRuntimeTestResults = true; }); }, /evidence overclaim/],
  ["weaken-original-wallet-auth-gate", (d) => { d.contract.authBoundary.failClosed = false; }, /Wallet\/Auth dependency/],
  ["weaken-original-receipt-audit", (d) => { d.contract.evmRpc.committedBroadcastEvidence.receiptAuditMustMatchBlockTransaction = false; }, /broadcast transaction evidence/]
];


// Additional borrowed-recovery derivative identity: preserve the inherited 23-source
// map and all 26 earlier negative controls; these three kernel pins are separate.
const kernelPaths = ['internal/consensus/state_hash_json.go', 'internal/consensus/state_hash_json_test.go', 'internal/consensus/state_hash_streaming_test.go'];
negatives.push(
  ['old-perf-source-and-fc5-tree-backfilled', (d) => {
    d.map.sourceCommit = d.release.source.implementationCommit = d.contract.sourceCommit = d.vectors.sourceCommit = 'd47b0fb8bf817093d1da0cd0dc8b08725bfae0f7';
    d.map.internalTree = d.release.source.internalTree = 'fc5ccab4e9aa6923bc61a2dc7ac518343ac56703';
  }, /source map identity|source substitution/],
  ['kernel-predecessor-source-replaced', (d) => { d.map.kernelDerivation.predecessorSourceCommit = SOURCE_COMMIT; }, /kernel derivation/],
  ['kernel-predecessor-tree-replaced', (d) => { d.map.kernelDerivation.predecessorInternalTree = INTERNAL_TREE; }, /kernel derivation/],
  ['kernel-commit-replaced', (d) => { d.map.kernelDerivation.kernelCommit = 'eb6e3199280adde67426e1c04a5403fc1e31d16a'; }, /kernel derivation/],
  ['kernel-performance-measured-claim', (d) => { d.map.kernelDerivation.performanceMeasured = true; }, /kernel derivation identity or performance claim drift/],
  ['candidate-performance-measured-claim', (d) => { d.release.candidatePerformance.measured = d.contract.candidatePerformance.measured = true; }, /unmeasured kernel performance or finality claim/],
  ['candidate-declared-throughput-claim', (d) => { d.release.candidatePerformance.claimedTps = d.contract.candidatePerformance.claimedTps = 1000000; }, /unmeasured kernel performance or finality claim/],
  ['candidate-declared-speedup-claim', (d) => { d.release.candidatePerformance.speedupRatio = d.contract.candidatePerformance.speedupRatio = 2; }, /unmeasured kernel performance or finality claim/],
  ['candidate-declared-finality-claim', (d) => { d.release.candidatePerformance.finalityMeasured = d.contract.candidatePerformance.finalityMeasured = true; }, /unmeasured kernel performance or finality claim/],
  ['kernel-extra-leaf-added', (d) => { d.map.kernelDerivation.kernelFiles['internal/consensus/state.go'] = structuredClone(d.map.files['internal/consensus/state.go']); }, /kernel/]
);


// The previous fee-chunks candidate remains historical negative performance
// evidence. Recovery metadata cannot silently reactivate it or rewrite its run.
negatives.push(
  ['previous-fee-chunks-source-and-tree-backfilled', (d) => {
    d.map.sourceCommit = d.release.source.implementationCommit = d.contract.sourceCommit = d.vectors.sourceCommit = '2dbfc1146a0ca23fdd7ce10dccd4ab80dec5be49';
    d.map.internalTree = d.release.source.internalTree = 'f1342d3123f2366797e71c65a4e160cac377c9f2';
  }, /source map identity|source substitution/],
  ['recovery-public-hash-reactivates-fee-chunks', (d) => { d.release.candidateActivation.publicHash = d.contract.candidateActivation.publicHash = 'experimental-fee-chunks'; }, /borrowed recovery activation boundary drift/],
  ['recovery-experimental-mode-reactivated', (d) => { d.release.candidateActivation.experimentalFeeChunks = d.contract.candidateActivation.experimentalFeeChunks = 'automatic-public-hash'; }, /borrowed recovery activation boundary drift/],
  ['recovery-automatic-activation-claim', (d) => { d.release.candidateActivation.automaticActivation = d.contract.candidateActivation.automaticActivation = true; }, /borrowed recovery activation boundary drift/]
);
for (const [field, replacement] of [
  ['sourceCommit', SOURCE_COMMIT],
  ['integrationCommit', '0'.repeat(40)],
  ['internalTree', INTERNAL_TREE],
  ['measurementRun', 39114847428],
  ['outcome', 'improvement'],
  ['activationWithdrawn', false]
]) negatives.push([`previous-negative-performance-evidence-replaced:${field}`, (d) => {
  d.release.previousCandidatePerformance[field] = d.contract.previousCandidatePerformance[field] = replacement;
}, /previous negative performance evidence or withdrawal changed/]);


// Seal witness supply does not automatically activate a runtime path. Its
// local short ABBA measurements retain both costs and their scope boundaries.
const sealPaths = [
  'internal/consensus/state.go',
  'internal/consensus/state_seal_guard.go',
  'internal/consensus/state_seal_guard_test.go',
  'internal/consensus/state_seal_large_history_test.go',
  'docs/performance/evidence/seal-guarded-phases-ci-39118758324-actual.json',
  'docs/performance/fixtures/state-hash-real-1024-migration.json',
  'docs/performance/fixtures/state-hash-real-1024.json',
  'docs/performance/fixtures/state-hash-real-1024.manifest.json'
];
negatives.push(
  ['seal-derivation-omitted', (d) => { delete d.map.sealWitnessDerivation; }, /seal witness derivation identity or activation drift/],
  ['seal-current-source-backfilled-with-predecessor', (d) => { d.map.sealWitnessDerivation.sourceCommit = '78071d90b4be0883849b420290d70a74651bdabc'; }, /seal witness derivation identity or activation drift/],
  ['seal-predecessor-source-substituted', (d) => { d.map.sealWitnessDerivation.predecessorSourceCommit = SOURCE_COMMIT; }, /seal witness derivation identity or activation drift/],
  ['seal-predecessor-tree-substituted', (d) => { d.map.sealWitnessDerivation.predecessorInternalTree = INTERNAL_TREE; }, /seal witness derivation identity or activation drift/],
  ['seal-runtime-default-enabled', (d) => { d.map.sealWitnessDerivation.runtimeEnabled = true; }, /seal witness derivation identity or activation drift/],
  ['seal-extra-source-added', (d) => { d.map.sealWitnessDerivation.files['internal/consensus/state_hash_json.go'] = structuredClone(d.map.kernelDerivation.kernelFiles['internal/consensus/state_hash_json.go']); }, /seal witness source inventory drift/]
);
for (const path of sealPaths) negatives.push(
  [`seal-source-omitted:${path}`, (d) => { delete d.map.sealWitnessDerivation.files[path]; }, /seal witness source inventory drift/],
  [`seal-source-digest-changed:${path}`, (d) => { d.map.sealWitnessDerivation.files[path].sha256 = '0'.repeat(64); }, /seal witness source hash\/size mismatch/],
  [`seal-source-size-changed:${path}`, (d) => { d.map.sealWitnessDerivation.files[path].bytes++; }, /seal witness source hash\/size mismatch/]
);
const sealEvidenceNegatives = [
  ['ABBA-mode-replaced', (e) => { e.measurement.rows[0].guarded = true; }],
  ['ABBA-order-replaced', (e) => { e.measurement.rows[2].order = 0; }],
  ['sample-count-reduced', (e) => { e.measurement.rows.pop(); }],
  ['runtime-default-enabled', (e) => { e.measurement.runtime_candidate_enabled = true; }],
  ['business-TPS-fabricated', (e) => { e.measurement.business_tps = 1000000; }],
  ['finality-fabricated', (e) => { e.measurement.finality_latency = 1; }],
  ['inclusion-fabricated', (e) => { e.measurement.inclusion_latency = 1; }],
  ['same-AppHash-replaced', (e) => { e.measurement.app_hash = '0'.repeat(64); }],
  ['canonical-payload-size-replaced', (e) => { e.measurement.rows[1].payload_bytes++; }],
  ['guarded-second-hash-claim-replaced', (e) => { e.measurement.rows[1].second_hash_executed = true; }],
  ['allocation-growth-hidden', (e) => { e.allocationBytesChangePercent = -7.820446468619546; }],
  ['allocation-mean-replaced', (e) => { e.means.guarded.seal_allocated_bytes = 1; }],
  ['seal-benefit-exaggerated', (e) => { e.sealElapsedChangePercent = -99; }],
  ['atomic-IO-stage-replaced', (e) => { e.measurement.rows[1].atomic_commit_stages_ns.file_sync = 0; }],
  ['atomic-IO-attribution-changed', (e) => { e.limits[1] = 'Guarded sealing accelerates atomic snapshot persistence.'; }],
  ['short-local-scope-upgraded', (e) => { e.limits[0] = 'Sustained network performance proven.'; }]
];
for (const [name, mutate] of sealEvidenceNegatives) negatives.push([`seal-measured-evidence:${name}`, (d) => {
  mutate(d.release.sealWitnessEvidence);d.contract.sealWitnessEvidence = structuredClone(d.release.sealWitnessEvidence);
}, /seal witness measured evidence scope or metrics drift/]);
for (const [name, mutate] of [
  ['evidence-omitted', (e) => { delete e.samples; }],
  ['negative-timing-hidden', (e) => { e.candidateChangePercent.nsPerOp = -24.36344804913315; }],
  ['allocation-growth-hidden', (e) => { e.candidateChangePercent.bytesPerOp = -1; }],
  ['second-run-replaced', (e) => { e.runId = 39116956505; }],
  ['first-negative-run-removed', (e) => { e.previousNegativeRunRetained = null; }],
  ['runtime-experiment-reactivated', (e) => { e.experimentalAutomaticallyActive = true; }]
]) negatives.push([`second-negative-performance-evidence:${name}`, (d) => {
  mutate(d.release.previousRecoveryPerformance);d.contract.previousRecoveryPerformance = structuredClone(d.release.previousRecoveryPerformance);
}, /second negative experiment evidence changed/]);


// Newly supplied >16MiB real-history test source is not an execution receipt.
for (const [field, replacement] of [
  ['sourceCommit', '8782774edb3034a316294e844d96e33936908640'],
  ['testName', 'TestSealGuardedFabricatedLargeHistory'],
  ['executed', true],
  ['measured', true],
  ['businessTps', 1000000],
  ['finalityMeasured', true]
]) negatives.push([`large-history-unexecuted-boundary:${field}`, (d) => {
  d.release.largeHistoryValidation[field] = d.contract.largeHistoryValidation[field] = replacement;
}, /large history execution or performance claim drift/]);

for (const path of kernelPaths) negatives.push(
  [`kernel-leaf-omitted:${path}`, (d) => { delete d.map.kernelDerivation.kernelFiles[path]; }, /kernel/],
  [`kernel-leaf-digest-changed:${path}`, (d) => { d.map.kernelDerivation.kernelFiles[path].sha256 = '0'.repeat(64); }, /kernel/],
  [`kernel-leaf-size-changed:${path}`, (d) => { d.map.kernelDerivation.kernelFiles[path].bytes++; }, /kernel/]
);

for (const [name, mutate, error] of negatives) {
  test(`reject ${name}`, () => {
    const documents = structuredClone(original);
    mutate(documents);
    assert.throws(() => validateCandidate({ repository, documents }), error);
  });
}

test("CLI runs the fixed source checker outside the repository cwd", () => {
  const result = JSON.parse(execFileSync(process.execPath, [join(here, "check.mjs"), "--repository", repository], { cwd: "/tmp", encoding: "utf8" }));
  assert.equal(result.sourceCommit, SOURCE_COMMIT);
  assert.equal(result.internalTree, INTERNAL_TREE);
});

test("published predecessor objects and any checkout copies retain exact bytes", () => {
  for (const before of publishedBefore) {
    assert.equal(existsSync(join(repository, before.path)), before.present);
    if (before.present) assert.equal(hash(readFileSync(join(repository, before.path))), before.hash);
    const raw = execFileSync("git", ["-C", repository, "show", `${SOURCE_COMMIT}:${before.path}`]);
    assert.equal(hash(raw), original.map.publishedPredecessorFiles[before.path].sha256);
  }
});
