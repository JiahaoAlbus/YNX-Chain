import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {canonicalJSON, sha256} from "../lib/sdk-release.mjs";
import {
  TESTNET_METADATA_PATH, UNASSIGNED_REGISTRY_STATUS, REGISTERED_REGISTRY_STATUS,
  REGISTERED_ENTRY_MAX_BYTES, readCanonicalJSON, validateTestnetMetadata,
  validateCollisionEvidence, parseRegisteredNetworkEntry, parseRegistryJSON, registeredEntryURL,
  registryEntryGitBlob, projectRegistryMatch, registeredMetadataDifferences,
} from "../lib/chainlist-candidate.mjs";

const AGGREGATE_URL = "https://chainid.network/chains.json";
const REPOSITORY = "https://github.com/ethereum-lists/chains.git";
const TARGET_FILE = "_data/chains/eip155-6423.json";
const AGGREGATE_MAX_BYTES = 16 * 1024 * 1024;

export async function refreshCollisionEvidence({outputPath}) {
  const metadata = readCanonicalJSON(path.resolve(TESTNET_METADATA_PATH)).value;
  validateTestnetMetadata(metadata);
  // These are two independently observed sources. Equality of the selected
  // entry does not assert that the entire mutable aggregate is this Git tree.
  const aggregate = await readRegistryResponse(AGGREGATE_URL, AGGREGATE_MAX_BYTES);
  if (aggregate.status !== 200) throw new Error(`chain registry aggregate returned HTTP ${aggregate.status}`);
  const remote = execFileSync("git", ["ls-remote", REPOSITORY, "HEAD"], {encoding: "utf8", timeout: 20000}).trim();
  if (!/^[0-9a-f]{40}\s+HEAD$/.test(remote)) throw new Error("official chain registry HEAD is invalid");
  const commit = remote.split(/\s+/)[0];
  const target = await readRegistryResponse(registeredEntryURL(commit), REGISTERED_ENTRY_MAX_BYTES);
  const evidence = buildObservedCollisionEvidence({aggregate, registryCommit: commit, target}, metadata);
  const rendered = canonicalJSON(evidence);
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    const allowed = [path.resolve("chain-metadata"), path.resolve("tmp")];
    if (!allowed.some((root) => resolved.startsWith(`${root}${path.sep}`))) throw new Error("collision evidence output must be under chain-metadata/ or tmp/");
    fs.mkdirSync(path.dirname(resolved), {recursive: true});
    fs.writeFileSync(resolved, rendered, {mode: 0o644});
  } else process.stdout.write(rendered);
  return evidence;
}

export function buildObservedCollisionEvidence({aggregate, registryCommit, target}, metadata) {
  validateTestnetMetadata(metadata);
  if (aggregate.url !== AGGREGATE_URL || aggregate.status !== 200 || !Buffer.isBuffer(aggregate.body) || !aggregate.body.length || aggregate.body.length > AGGREGATE_MAX_BYTES) throw new Error("chain registry aggregate response is invalid");
  if (target.url !== registeredEntryURL(registryCommit) || ![200, 404].includes(target.status) || !Buffer.isBuffer(target.body) || target.body.length > REGISTERED_ENTRY_MAX_BYTES) throw new Error("official registry target response is invalid");
  const chains = parseRegistryJSON(new TextDecoder("utf-8", {fatal: true}).decode(aggregate.body));
  if (!Array.isArray(chains) || !chains.length || chains.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) throw new Error("chain registry aggregate is not a non-empty entry array");
  const matches = {
    chainId: chains.filter((entry) => entry.chainId === metadata.chainId || entry.chainId === String(metadata.chainId)).map(projectRegistryMatch),
    name: chains.filter((entry) => lower(entry.name) === lower(metadata.name)).map(projectRegistryMatch),
    shortName: chains.filter((entry) => lower(entry.shortName) === lower(metadata.shortName)).map(projectRegistryMatch),
  };
  const evidence = {
    aggregate: {bytes: aggregate.body.length, chainCount: chains.length, fetchedAt: aggregate.observedAt, sha256: sha256(aggregate.body), url: AGGREGATE_URL},
    candidate: {chainId: metadata.chainId, name: metadata.name, shortName: metadata.shortName},
    matches,
    registry: {commit: registryCommit, repository: REPOSITORY, targetFile: TARGET_FILE, targetFilePresent: target.status === 200},
    status: target.status === 200 ? REGISTERED_REGISTRY_STATUS : UNASSIGNED_REGISTRY_STATUS,
  };
  if (target.status === 200) {
    const body = new TextDecoder("utf-8", {fatal: true}).decode(target.body);
    const entry = parseRegisteredNetworkEntry(body, metadata);
    const own = chains.filter((item) => item.chainId === metadata.chainId);
    if (own.length !== 1 || canonicalJSON(own[0]) !== canonicalJSON(entry)) throw new Error("official aggregate/registered entry mismatch or duplicate chainId");
    const differences = registeredMetadataDifferences(entry, metadata);
    evidence.registeredEntry = {
      url: target.url, body, bytes: target.body.length, sha256: sha256(target.body), gitBlobSha1: registryEntryGitBlob(target.body), observedAt: target.observedAt,
      candidateExactMatch: differences.length === 0, metadataDifferences: differences,
      registeredShortNameMatches: chains.filter((item) => lower(item.shortName) === lower(entry.shortName)).map(projectRegistryMatch),
    };
  }
  // In either branch a foreign match, duplicate, stale observation, or mismatched
  // source stops here, before output can replace any existing evidence file.
  validateCollisionEvidence(evidence, metadata);
  return evidence;
}

export async function readRegistryResponse(url, maximumBytes, {fetchImpl = globalThis.fetch, timeoutMs = 20000, now = () => new Date()} = {}) {
  if (url !== AGGREGATE_URL && !/^https:\/\/raw\.githubusercontent\.com\/ethereum-lists\/chains\/[0-9a-f]{40}\/_data\/chains\/eip155-6423\.json$/.test(url)) throw new Error("unapproved registry response URL");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > AGGREGATE_MAX_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) throw new Error("registry response bound is invalid");
  const controller = new AbortController();
  let reader, finished = false, abort;
  const deadline = new Promise((_, reject) => { abort = () => reject(new Error("registry response deadline exceeded")); controller.signal.addEventListener("abort", abort, {once: true}); });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await Promise.race([fetchImpl(url, {headers: {"user-agent": "YNX-Chain collision-evidence verifier"}, redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal}), deadline]);
    if (response.redirected !== false || response.url !== url) throw new Error("registry response URL or redirect mismatch");
    if (![200, 404].includes(response.status)) throw new Error(`registry response returned HTTP ${response.status}`);
    const body = Buffer.alloc(maximumBytes); let bytes = 0;
    reader = response.body?.getReader();
    if (reader) while (true) {
      const {done, value} = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (!(value instanceof Uint8Array) || bytes + value.byteLength > maximumBytes) throw new Error("registry response exceeds byte limit or is not a byte chunk");
      body.set(value, bytes);
      bytes += value.byteLength;
    }
    const observed = now();
    if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new Error("registry observation clock is invalid");
    const observedAt = new Date(Math.floor(observed.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
    finished = true;
    return {url, status: response.status, body: body.subarray(0, bytes), observedAt};
  } finally {
    clearTimeout(timer); controller.signal.removeEventListener("abort", abort);
    if (!finished) { controller.abort(); if (reader) void reader.cancel().catch(() => {}); }
    else reader?.releaseLock();
  }
}

function lower(value) { return typeof value === "string" ? value.toLowerCase() : ""; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf("--output");
  if (process.argv.length > 2 && (outputIndex !== 2 || !process.argv[3] || process.argv.length !== 4)) throw new Error("usage: refresh-chainlist-collision-evidence.mjs [--output <file>]");
  await refreshCollisionEvidence({outputPath: outputIndex === 2 ? process.argv[3] : undefined});
}
