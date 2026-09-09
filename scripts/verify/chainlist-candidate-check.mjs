import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildChainlistCandidate} from "../package/chainlist-candidate.mjs";
import {
  buildSDKNetworkModule,
  buildCandidateStatus, registeredEntryURL, registryEntryGitBlob,
  registeredMetadataDifferences,
  loadCandidateSources,
  readCanonicalJSON,
  validateCollisionEvidence,
  validateMainnetDraft,
  validateTestnetMetadata,
} from "../lib/chainlist-candidate.mjs";
import {canonicalJSON, sha256} from "../lib/sdk-release.mjs";
import {buildObservedCollisionEvidence, readRegistryResponse} from "../ops/refresh-chainlist-collision-evidence.mjs";
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
    () => validateCollisionEvidence(sources.collision.value, sources.metadata.value, {now: new Date(new Date(sources.collision.value.aggregate.fetchedAt).getTime() + 2 * 24 * 60 * 60 * 1000), maximumAgeMs: 24 * 60 * 60 * 1000}),
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

  // Exercise the actual observation builder and validator with the frozen
  // official entry carried by the source evidence. No network or publication.
  const actual = sources.collision.value;
  const metadata = sources.metadata.value;
  assert.equal(actual.registry.targetFilePresent, true);
  const registered = JSON.parse(actual.registeredEntry.body);
  let registeredCases = 0;
  function checkCase(label, fn) { fn(); registeredCases++; }
  function rewritten(mutate) {
    const value = structuredClone(actual), entry = JSON.parse(value.registeredEntry.body);
    mutate(entry);
    const body = Buffer.from(canonicalJSON(entry));
    Object.assign(value.registeredEntry, {body: body.toString("utf8"), bytes: body.length, sha256: sha256(body), gitBlobSha1: registryEntryGitBlob(body), metadataDifferences: registeredMetadataDifferences(entry, metadata)});
    value.registeredEntry.candidateExactMatch = value.registeredEntry.metadataDifferences.length === 0;
    return value;
  }
  function observation(chains, entry = registered, targetStatus = 200) {
    const observedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z");
    const body = Buffer.from(canonicalJSON(entry));
    return buildObservedCollisionEvidence({
      aggregate: {url: "https://chainid.network/chains.json", status: 200, body: Buffer.from(JSON.stringify(chains)), observedAt},
      registryCommit: actual.registry.commit,
      target: {url: registeredEntryURL(actual.registry.commit), status: targetStatus, body: targetStatus === 200 ? body : Buffer.from("Not Found"), observedAt},
    }, metadata);
  }
  checkCase("actual registered metadata update stays unaccepted", () => {
    const value = observation([registered]);
    assert.equal(value.registeredEntry.candidateExactMatch, false);
    assert.deepEqual(value.registeredEntry.metadataDifferences.map((item) => item.field), ["faucets", "features", "icon", "infoURL", "shortName", "slip44", "status"]);
    const state = buildCandidateStatus(value, metadata);
    assert.equal(state.candidateKind, "registered-metadata-update");
    for (const field of ["chainlistAccepted", "chainlistSubmitted", "walletDefaultSupported", "mainnetIncluded"]) assert.equal(state[field], false);
  });
  checkCase("wholly identical registered entry is a separate observation mode", () => {
    const value = observation([metadata], metadata);
    assert.equal(value.registeredEntry.candidateExactMatch, true);
    assert.equal(buildCandidateStatus(value, metadata).candidateKind, "registered-exact-observation");
    assert.equal(buildCandidateStatus(value, metadata).chainlistAccepted, false);
  });
  checkCase("unregistered branch still requires both absent sources", () => {
    const value = observation([{chainId: 1, name: "Other", shortName: "other"}], registered, 404);
    assert.equal(value.registry.targetFilePresent, false);
    assert.equal(Object.hasOwn(value, "registeredEntry"), false);
    assert.equal(buildCandidateStatus(value, metadata).candidateKind, "new-entry");
    assert.throws(() => observation([registered], registered, 404), /conflict/);
  });
  for (const [label, mutate] of [
    ["different chain", (entry) => { entry.chain = "OTHER"; }],
    ["different chainId", (entry) => { entry.chainId = 1; }],
    ["different networkId", (entry) => { entry.networkId = 1; }],
    ["different name", (entry) => { entry.name = "Other"; }],
    ["different RPC", (entry) => { entry.rpc = ["https://other.invalid"]; }],
    ["extra RPC", (entry) => { entry.rpc.push("https://other.invalid"); }],
    ["currency name", (entry) => { entry.nativeCurrency.name = "Other"; }],
    ["currency symbol", (entry) => { entry.nativeCurrency.symbol = "OTHER"; }],
    ["currency decimals", (entry) => { entry.nativeCurrency.decimals = 6; }],
    ["explorer", (entry) => { entry.explorers[0].url = "https://other.invalid"; }],
    ["unobserved short name", (entry) => { entry.shortName = "other"; }],
    ["unobserved faucet", (entry) => { entry.faucets = ["https://other.invalid"]; }],
    ["unobserved info", (entry) => { entry.infoURL = "https://other.invalid"; }],
    ["slip44 conflict", (entry) => { entry.slip44 = 1; }],
    ["feature removed", (entry) => { entry.features = []; }],
    ["feature field removed", (entry) => { delete entry.features; }],
    ["unknown feature", (entry) => { entry.features.push({name: "Other"}); }],
    ["different icon", (entry) => { entry.icon = "other"; }],
    ["status conflict", (entry) => { entry.status = "deprecated"; }],
    ["unobserved mixed presence", (entry) => { entry.status = "active"; }],
    ["unknown field", (entry) => { entry.extra = true; }],
  ]) checkCase(label, () => assert.throws(() => validateCollisionEvidence(rewritten(mutate), metadata), /identity|unreviewed|fields/));
  for (const [label, mutate] of [
    ["wrong digest", (value) => { value.registeredEntry.sha256 = "0".repeat(64); }],
    ["wrong blob", (value) => { value.registeredEntry.gitBlobSha1 = "0".repeat(40); }],
    ["wrong raw length", (value) => { value.registeredEntry.bytes++; }],
    ["wrong ref binding", (value) => { value.registry.commit = "0".repeat(40); }],
    ["wrong path", (value) => { value.registeredEntry.url += "?other=1"; }],
    ["fake absence", (value) => { value.registry.targetFilePresent = false; }],
    ["fake exact flag", (value) => { value.registeredEntry.candidateExactMatch = true; }],
    ["hidden differences", (value) => { value.registeredEntry.metadataDifferences = []; }],
    ["foreign old short name", (value) => { value.registeredEntry.registeredShortNameMatches.push({chainId: 1, name: "Other", shortName: "ynxtest"}); }],
    ["raw size cap", (value) => { value.registeredEntry.body += " ".repeat(65536); }],
  ]) checkCase(label, () => { const value = structuredClone(actual); mutate(value); assert.throws(() => validateCollisionEvidence(value, metadata)); });
  for (const [label, foreign] of [
    ["duplicate own ID", registered],
    ["foreign same ID", {...registered, name: "Other"}],
    ["foreign same name", {...registered, chainId: 1, shortName: "other", name: "ynx testnet"}],
    ["foreign proposed short name", {...registered, chainId: 1, name: "Other", shortName: "YNXT"}],
    ["foreign registered short name", {...registered, chainId: 1, name: "Other", shortName: "YNXTEST"}],
  ]) checkCase(label, () => assert.throws(() => observation([registered, foreign]), /conflict|duplicate/));
  checkCase("aggregate identity cannot differ from immutable raw", () => assert.throws(() => observation([{...registered, rpc: ["https://other.invalid"]}]), /aggregate\/registered/));
  checkCase("escaped duplicate aggregate key cannot hide a second chain ID", () => {
    const body = Buffer.from(String.raw`[${JSON.stringify(registered)},{"chainId":6423,"ch\u0061inId":999,"name":"Other","shortName":"other"}]`);
    const observedAt = actual.aggregate.fetchedAt;
    assert.throws(() => buildObservedCollisionEvidence({aggregate: {url: "https://chainid.network/chains.json", status: 200, body, observedAt}, registryCommit: actual.registry.commit, target: {url: registeredEntryURL(actual.registry.commit), status: 200, body: Buffer.from(actual.registeredEntry.body), observedAt}}, metadata), /duplicate JSON/);
  });
  checkCase("duplicate raw fields rejected even with recomputed digests", () => {
    const value = structuredClone(actual);
    const body = Buffer.from(value.registeredEntry.body.replace('"chainId": 6423', '"chainId": 6423, "chainId": 6423'));
    Object.assign(value.registeredEntry, {body: body.toString(), bytes: body.length, sha256: sha256(body), gitBlobSha1: registryEntryGitBlob(body)});
    assert.throws(() => validateCollisionEvidence(value, metadata), /duplicate JSON/);
  });
  checkCase("both observations must be fresh", () => {
    const now = new Date(new Date(actual.aggregate.fetchedAt).getTime() + 31 * 24 * 60 * 60 * 1000);
    assert.throws(() => validateCollisionEvidence(actual, metadata, {now}), /stale/);
    const value = structuredClone(actual); value.registeredEntry.observedAt = "2026-01-01T00:00:00Z";
    assert.throws(() => validateCollisionEvidence(value, metadata), /stale/);
  });
  checkCase("freshness context cannot be NaN", () => {
    assert.throws(() => validateCollisionEvidence(actual, metadata, {now: new Date(NaN)}), /freshness context/);
    assert.throws(() => validateCollisionEvidence(actual, metadata, {maximumAgeMs: NaN}), /freshness context/);
  });
  const requestURL = registeredEntryURL(actual.registry.commit);
  function response(stream, url = requestURL) { const result = new Response(stream, {status: 200}); Object.defineProperty(result, "url", {value: url}); return result; }
  let cancelled = false, requestOptions;
  const stalled = response(new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([123])); }, cancel() { cancelled = true; }}));
  await assert.rejects(readRegistryResponse(requestURL, 1024, {timeoutMs: 10, fetchImpl: async (_url, options) => { requestOptions = options; return stalled; }}), /deadline/);
  assert.equal(cancelled, true); assert.equal(requestOptions.redirect, "error"); assert.equal(requestOptions.credentials, "omit"); registeredCases++;
  const large = response(new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(40)); controller.enqueue(new Uint8Array(40)); }}));
  await assert.rejects(readRegistryResponse(requestURL, 64, {fetchImpl: async () => large}), /byte limit/); registeredCases++;
  await assert.rejects(readRegistryResponse(requestURL, 1024, {fetchImpl: async () => response("{}", "https://other.invalid")}), /URL or redirect/); registeredCases++;
  await assert.rejects(readRegistryResponse("https://other.invalid", 1024), /unapproved/); registeredCases++;
  let produced = 0;
  const tinyChunks = response(new ReadableStream({pull(controller) { if (produced === 16384) controller.close(); else controller.enqueue(new Uint8Array([produced++ % 251])); }}));
  const tiny = await readRegistryResponse(requestURL, 16384, {fetchImpl: async () => tinyChunks});
  assert.equal(tiny.body.length, 16384);
  for (let index = 0; index < tiny.body.length; index++) assert.equal(tiny.body[index], index % 251);
  registeredCases++;
  process.stdout.write(`registered-entry boundary checks passed: ${registeredCases} cases; zero network requests, original/new/update status and body deadline enforced\n`);

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
