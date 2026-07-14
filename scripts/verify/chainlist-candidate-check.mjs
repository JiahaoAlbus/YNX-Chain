import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildChainlistCandidate} from "../package/chainlist-candidate.mjs";
import {
  buildSDKNetworkModule,
  loadCandidateSources,
  readCanonicalJSON,
  validateCollisionEvidence,
  validateMainnetDraft,
  validateTestnetMetadata,
} from "../lib/chainlist-candidate.mjs";
import {canonicalJSON, sha256} from "../lib/sdk-release.mjs";
import {verifyChainlistCandidate} from "./chainlist-candidate-verify.mjs";

const root = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-chainlist-check-"));

try {
  const first = path.join(work, "first");
  const second = path.join(work, "second");
  buildChainlistCandidate({rootDir: root, outputDir: first});
  buildChainlistCandidate({rootDir: root, outputDir: second});
  assert.deepEqual(directoryDigests(first), directoryDigests(second), "Chainlist candidate builds differ");
  verifyChainlistCandidate({candidateDir: first, sourceRoot: root});

  const sources = loadCandidateSources(root);
  assert.equal(fs.readFileSync(path.join(root, "sdk/js/ynx-testnet.js"), "utf8"), buildSDKNetworkModule(sources.metadata.value));
  for (const mutation of [
    (value) => { value.chainId = 1; },
    (value) => { value.nativeCurrency.symbol = "FAKE"; },
    (value) => { value.rpc[0] = "http://localhost:8545"; },
    (value) => { value.explorers[0].standard = "UNKNOWN"; },
    (value) => { value.unknown = true; },
  ]) {
    const value = structuredClone(sources.metadata.value);
    mutation(value);
    assert.throws(() => validateTestnetMetadata(value));
  }

  const mainnet = structuredClone(sources.mainnet.value);
  mainnet.rpc.push("https://mainnet.invalid");
  assert.throws(() => validateMainnetDraft(mainnet), /must not publish endpoints/);

  assert.throws(
    () => validateCollisionEvidence(sources.collision.value, sources.metadata.value, {now: new Date("2026-09-01T00:00:00Z"), maximumAgeMs: 24 * 60 * 60 * 1000}),
    /stale/,
  );
  const conflict = structuredClone(sources.collision.value);
  conflict.matches.chainId.push({chainId: 6423, name: "Conflicting Chain", shortName: "conflict"});
  assert.throws(() => validateCollisionEvidence(conflict, sources.metadata.value), /chainId conflict/);

  const duplicateJSON = path.join(work, "duplicate.json");
  fs.writeFileSync(duplicateJSON, '{"chainId":6423,"chainId":1}\n');
  assert.throws(() => readCanonicalJSON(duplicateJSON), /not canonical JSON/);

  const tampered = copyCase(first, "tampered");
  fs.appendFileSync(path.join(tampered, "eip155-6423.json"), " ");
  assert.throws(() => verifyChainlistCandidate({candidateDir: tampered, sourceRoot: root}), /digest or source mismatch/);

  const leaked = copyCase(first, "mainnet-leakage");
  fs.copyFileSync(path.join(root, "chain-metadata/ynx-mainnet-draft.json"), path.join(leaked, "ynx-mainnet-draft.json"));
  assert.throws(() => verifyChainlistCandidate({candidateDir: leaked, sourceRoot: root}), /mainnet leakage/);

  const symlinked = copyCase(first, "symlinked");
  fs.rmSync(path.join(symlinked, "candidate-status.json"));
  fs.symlinkSync(path.join(first, "candidate-status.json"), path.join(symlinked, "candidate-status.json"));
  assert.throws(() => verifyChainlistCandidate({candidateDir: symlinked, sourceRoot: root}), /not a regular file/);

  const noncanonical = copyCase(first, "noncanonical");
  const manifestPath = path.join(noncanonical, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyChainlistCandidate({candidateDir: noncanonical, sourceRoot: root}), /not canonical JSON/);

  process.stdout.write("chainlist-candidate-check passed: canonical metadata/payload, deterministic testnet-only package, collision freshness, and tamper/mainnet rejection verified\n");
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}

function directoryDigests(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((file) => [file, sha256(fs.readFileSync(path.join(directory, file)))]));
}

function copyCase(source, name) {
  const target = path.join(work, name);
  fs.cpSync(source, target, {recursive: true});
  return target;
}
