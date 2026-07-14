import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {canonicalJSON, sha256} from "../lib/sdk-release.mjs";

const AGGREGATE_URL = "https://chainid.network/chains.json";
const REPOSITORY = "https://github.com/ethereum-lists/chains.git";
const TARGET = {chainId: 6423, name: "YNX Testnet", shortName: "ynxt"};
const TARGET_FILE = "_data/chains/eip155-6423.json";

export async function refreshCollisionEvidence({outputPath}) {
  const response = await boundedFetch(AGGREGATE_URL);
  if (!response.ok) throw new Error(`chain registry aggregate returned HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > 16 * 1024 * 1024) throw new Error("chain registry aggregate size is invalid");
  const chains = JSON.parse(body);
  if (!Array.isArray(chains) || chains.length < 1) throw new Error("chain registry aggregate is not a non-empty array");
  const matches = {
    chainId: chains.filter((entry) => entry.chainId === TARGET.chainId).map(projectMatch),
    name: chains.filter((entry) => lower(entry.name) === lower(TARGET.name)).map(projectMatch),
    shortName: chains.filter((entry) => lower(entry.shortName) === lower(TARGET.shortName)).map(projectMatch),
  };
  if (Object.values(matches).some((entries) => entries.length > 0)) throw new Error(`official chain registry collision detected: ${JSON.stringify(matches)}`);
  const remote = execFileSync("git", ["ls-remote", REPOSITORY, "HEAD"], {encoding: "utf8", timeout: 20000}).trim();
  const commit = remote.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("official chain registry HEAD is invalid");
  const targetURL = `https://raw.githubusercontent.com/ethereum-lists/chains/${commit}/${TARGET_FILE}`;
  const targetResponse = await boundedFetch(targetURL);
  if (targetResponse.status !== 404) throw new Error(`official registry target file check returned HTTP ${targetResponse.status}; expected absence`);
  const fetchedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const evidence = {
    aggregate: {bytes: body.length, chainCount: chains.length, fetchedAt, sha256: sha256(body), url: AGGREGATE_URL},
    candidate: TARGET,
    matches,
    registry: {commit, repository: REPOSITORY, targetFile: TARGET_FILE, targetFilePresent: false},
    status: "unassigned-at-observation; refresh-before-submission",
  };
  const rendered = canonicalJSON(evidence);
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    const allowed = [path.resolve("chain-metadata"), path.resolve("tmp")];
    if (!allowed.some((root) => resolved.startsWith(`${root}${path.sep}`))) throw new Error("collision evidence output must be under chain-metadata/ or tmp/");
    fs.mkdirSync(path.dirname(resolved), {recursive: true});
    fs.writeFileSync(resolved, rendered, {mode: 0o644});
  } else {
    process.stdout.write(rendered);
  }
  return evidence;
}

async function boundedFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, {headers: {"user-agent": "YNX-Chain collision-evidence verifier"}, redirect: "error", signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

function projectMatch(entry) {
  return {chainId: entry.chainId, name: entry.name, shortName: entry.shortName};
}

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf("--output");
  if (process.argv.length > 2 && (outputIndex !== 2 || !process.argv[3] || process.argv.length !== 4)) throw new Error("usage: refresh-chainlist-collision-evidence.mjs [--output <file>]");
  await refreshCollisionEvidence({outputPath: outputIndex === 2 ? process.argv[3] : undefined});
}
