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
  assert.deepEqual(result, { vectorCount: 76, sourceCommit: SOURCE_COMMIT, stateVersion: 13, applicationVersion: 19, internalTree: INTERNAL_TREE, sourceFiles: 23, validation: "node-source-contract-only", goRuntimeTestsRun: false, published: false });
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
