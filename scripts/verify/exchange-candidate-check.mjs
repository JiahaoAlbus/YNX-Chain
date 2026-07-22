import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {buildExchangeCandidate} from "../package/exchange-candidate.mjs";
import {loadExchangeSources, validateExchangePolicy, validateExchangeVectors} from "../lib/exchange-candidate.mjs";
import {sha256} from "../lib/sdk-release.mjs";
import {verifyExchangeCandidate} from "./exchange-candidate-verify.mjs";

const root = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-exchange-check-"));
fs.mkdirSync(path.join(root, "tmp"), {recursive: true});
const generatedVectorDir = fs.mkdtempSync(path.join(root, "tmp/exchange-vector-check-"));

try {
  const sources = loadExchangeSources(root);
  const generatedVectors = path.join(generatedVectorDir, "generated-vectors.json");
  execFileSync("go", ["run", "./scripts/fixtures/generate-exchange-vectors", "--output", generatedVectors], {cwd: root, stdio: "pipe"});
  assert.deepEqual(fs.readFileSync(generatedVectors), sources.vectors.body, "committed exchange signed vectors are not reproducible");

  const first = path.join(work, "first");
  const second = path.join(work, "second");
  buildExchangeCandidate({rootDir: root, outputDir: first});
  buildExchangeCandidate({rootDir: root, outputDir: second});
  assert.deepEqual(directoryDigests(first), directoryDigests(second), "exchange candidate builds differ");
  verifyExchangeCandidate({candidateDir: first, sourceRoot: root});

  for (const mutation of [
    (value) => { value.status.exchangeListed = true; },
    (value) => { value.status.exchangeSubmitted = true; },
    (value) => { value.status.exchangePartnership = true; },
    (value) => { value.confirmationPolicy.productionCreditThreshold = 12; },
    (value) => { value.confirmationPolicy.reorgResistanceProven = true; },
    (value) => { value.addressPolicy.memoTag = "required"; },
    (value) => { value.broadcastPolicy.standardEthereumRLP = true; },
    (value) => { value.broadcastPolicy.publicAuthoritativeDeployed = false; },
    (value) => { value.rpcCapabilities[10].publicVerified = false; },
  ]) {
    const value = structuredClone(sources.policy.value);
    mutation(value);
    assert.throws(() => validateExchangePolicy(value));
  }
  const vectorMutation = structuredClone(sources.vectors.value);
  vectorMutation.transactions[0].envelope.amount += 1;
  assert.throws(() => validateExchangeVectors(vectorMutation), /payload\/hash mismatch/);

  const tampered = copyCase(first, "tampered");
  fs.appendFileSync(path.join(tampered, "signed-transaction-vectors.json"), " ");
  assert.throws(() => verifyExchangeCandidate({candidateDir: tampered, sourceRoot: root}), /digest or source mismatch/);

  const leaked = copyCase(first, "mainnet-leakage");
  fs.copyFileSync(path.join(root, "chain-metadata/ynx-mainnet-draft.json"), path.join(leaked, "ynx-mainnet-draft.json"));
  assert.throws(() => verifyExchangeCandidate({candidateDir: leaked, sourceRoot: root}), /mainnet\/unreviewed-file leakage/);

  const symlinked = copyCase(first, "symlinked");
  fs.rmSync(path.join(symlinked, "exchange-status.json"));
  fs.symlinkSync(path.join(first, "exchange-status.json"), path.join(symlinked, "exchange-status.json"));
  assert.throws(() => verifyExchangeCandidate({candidateDir: symlinked, sourceRoot: root}), /not a regular file/);

  const unsafeMode = copyCase(first, "unsafe-mode");
  fs.chmodSync(path.join(unsafeMode, "rpc-capabilities.json"), 0o600);
  assert.throws(() => verifyExchangeCandidate({candidateDir: unsafeMode, sourceRoot: root}), /mode is not 0644/);

  const noncanonical = copyCase(first, "noncanonical");
  const manifestPath = path.join(noncanonical, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(JSON.parse(fs.readFileSync(manifestPath))));
  assert.throws(() => verifyExchangeCandidate({candidateDir: noncanonical, sourceRoot: root}), /not canonical JSON/);

  process.stdout.write("exchange-candidate-check passed: reproducible public test vectors, deterministic package, truthful capability/finality status, and tamper/mainnet/false-claim rejection verified\n");
} finally {
  fs.rmSync(work, {recursive: true, force: true});
  fs.rmSync(generatedVectorDir, {recursive: true, force: true});
}

function directoryDigests(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((file) => [file, sha256(fs.readFileSync(path.join(directory, file)))]));
}

function copyCase(source, name) {
  const target = path.join(work, name);
  fs.cpSync(source, target, {recursive: true});
  return target;
}
