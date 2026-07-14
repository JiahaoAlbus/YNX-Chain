import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadCandidateSources, validateCollisionEvidence} from "../lib/chainlist-candidate.mjs";
import {canonicalJSON} from "../lib/sdk-release.mjs";

export async function verifyLiveChainlistEndpoints({rootDir, outputPath}) {
  const sources = loadCandidateSources(rootDir);
  validateCollisionEvidence(sources.collision.value, sources.metadata.value, {maximumAgeMs: 24 * 60 * 60 * 1000});
  const metadata = sources.metadata.value;
  const config = sources.verification.value;
  const rpcURL = metadata.rpc[0];

  const chainId = await jsonRPC(rpcURL, "eth_chainId", [], config);
  const networkId = await jsonRPC(rpcURL, "net_version", [], config);
  if (chainId !== "0x1917" || networkId !== "6423") throw new Error(`public EVM identity mismatch: chainId=${chainId} networkId=${networkId}`);
  const firstHeight = parseHexQuantity(await jsonRPC(rpcURL, "eth_blockNumber", [], config), "first block height");
  if (firstHeight <= 0) throw new Error("public EVM block height is not positive");
  const growthDeadline = Date.now() + config.blockGrowthTimeoutMs;
  let secondHeight = firstHeight;
  while (Date.now() < growthDeadline && secondHeight <= firstHeight) {
    await delay(config.blockGrowthPollIntervalMs);
    secondHeight = parseHexQuantity(await jsonRPC(rpcURL, "eth_blockNumber", [], config), "second block height");
  }
  if (secondHeight <= firstHeight) throw new Error(`public EVM height did not grow from ${firstHeight} within ${config.blockGrowthTimeoutMs}ms`);

  const rest = await requestJSON(config.restStatusURL, {}, config, "REST status");
  if (rest.chainId !== 6423 || rest.nativeCurrencySymbol !== "YNXT" || rest.publicNetwork !== true || !Number.isSafeInteger(rest.height) || rest.height <= 0) {
    throw new Error("public REST identity/status mismatch");
  }
  if (typeof rest.build?.commit !== "string" || !/^[0-9a-f]{12}$/.test(rest.build.commit) || typeof rest.build?.release !== "string") throw new Error("public REST build identity is missing");

  const faucetURL = new URL(config.faucetHealthPath, `${metadata.faucets[0]}/`).toString();
  const faucet = await requestJSON(faucetURL, {}, config, "Faucet health");
  if (faucet.ok !== true || faucet.upstreamOk !== true || faucet.chainId !== 6423 || faucet.nativeSymbol !== "YNXT" || !Number.isSafeInteger(faucet.height) || faucet.height <= 0) {
    throw new Error("public Faucet identity/health mismatch");
  }

  const explorerBase = metadata.explorers[0].url;
  const explorerHealthURL = new URL(config.explorerHealthPath, `${explorerBase}/`).toString();
  const explorer = await requestJSON(explorerHealthURL, {}, config, "Explorer health");
  if (explorer.ok !== true || explorer.indexerOk !== true || explorer.network?.chainId !== 6423 || explorer.nativeSymbol !== "YNXT") throw new Error("public Explorer identity/health mismatch");
  if (!Number.isSafeInteger(explorer.rpcHeight) || !Number.isSafeInteger(explorer.indexedHeight) || explorer.indexedHeight <= 0 || explorer.indexedHeight > explorer.rpcHeight) {
    throw new Error("public Explorer indexed height is invalid");
  }
  if (!Number.isSafeInteger(explorer.syncLagBlocks) || explorer.syncLagBlocks < 0 || explorer.syncLagBlocks > 100) throw new Error("public Explorer index lag exceeds the candidate bound");
  const searchURL = new URL(config.explorerSearchPath, `${explorerBase}/`);
  searchURL.searchParams.set("q", config.explorerAccountQuery);
  const search = await requestJSON(searchURL, {}, config, "Explorer account search");
  if (search.type !== "account" || search.normalizedAddress !== config.explorerAccountQuery || search.truthfulStatus !== "resolved-from-rpc") {
    throw new Error("public Explorer search boundary mismatch");
  }

  const website = await request(metadata.infoURL, {headers: {accept: "text/html"}}, config, "YNX info URL");
  if (!website.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("YNX info URL did not return HTML");
  const websiteBody = await readBoundedText(website, config, "YNX info URL");
  if (websiteBody.length < 100) throw new Error("YNX info URL returned an unexpectedly small document");

  const proof = {
    chainId,
    chainlistAccepted: false,
    chainlistSubmitted: false,
    checkedAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z"),
    collisionEvidenceCommit: sources.collision.value.registry.commit,
    endpointEvidence: {
      evmRPC: rpcURL,
      explorer: explorerBase,
      faucet: metadata.faucets[0],
      infoURL: metadata.infoURL,
      restStatus: config.restStatusURL,
    },
    evmHeightAfter: secondHeight,
    evmHeightBefore: firstHeight,
    explorerIndexedHeight: explorer.indexedHeight,
    explorerLagBlocks: explorer.syncLagBlocks,
    independentVantage: false,
    networkId,
    operatorControlled: true,
    release: rest.build.release,
    truthfulStatus: "live-read-only-testnet-candidate-proof",
    walletDefaultSupported: false,
  };
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    const allowedRoot = path.resolve(rootDir, "tmp");
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) throw new Error("live Chainlist proof output must be under repository tmp/");
    fs.mkdirSync(path.dirname(resolved), {recursive: true});
    fs.writeFileSync(resolved, canonicalJSON(proof), {mode: 0o644});
  }
  return proof;
}

async function jsonRPC(url, method, params, config) {
  const id = `${method}-ynx-chainlist-check`;
  const response = await requestJSON(url, {
    body: JSON.stringify({id, jsonrpc: "2.0", method, params}),
    headers: {"content-type": "application/json"},
    method: "POST",
  }, config, `EVM ${method}`);
  if (response.jsonrpc !== "2.0" || response.id !== id || response.error || !("result" in response)) throw new Error(`public EVM ${method} returned an invalid JSON-RPC response`);
  return response.result;
}

async function requestJSON(url, options, config, name) {
  const response = await request(url, options, config, name);
  const text = await readBoundedText(response, config, name);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} returned invalid JSON`);
  }
}

async function readBoundedText(response, config, name) {
  let timer;
  let text;
  try {
    text = await Promise.race([
      response.text(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} response body timed out`)), config.requestTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error(`${name} response body exceeds 2 MiB`);
  return text;
}

async function request(url, options, config, name) {
  let lastError;
  for (let attempt = 1; attempt <= config.requestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(url, {...options, redirect: "error", signal: controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < config.requestAttempts) await delay(250 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${name} failed after ${config.requestAttempts} attempts: ${lastError?.message || lastError}`);
}

function parseHexQuantity(value, name) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error(`${name} is not a canonical hex quantity`);
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} exceeds safe integer range`);
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArguments(argv) {
  let outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--output" || !argv[index + 1]) throw new Error("usage: chainlist-live-check.mjs [--output <tmp/file.json>]");
    outputPath = argv[index + 1];
    index += 1;
  }
  return {outputPath};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proof = await verifyLiveChainlistEndpoints({rootDir: process.cwd(), ...parseArguments(process.argv.slice(2))});
  process.stdout.write(`chainlist-live-check passed: chain=${proof.chainId}/${proof.networkId} height=${proof.evmHeightBefore}->${proof.evmHeightAfter} release=${proof.release} submitted=false accepted=false walletDefault=false independentVantage=false\n`);
}
