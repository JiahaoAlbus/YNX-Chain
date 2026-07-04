#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const evidencePath = process.env.YNX_REMOTE_EVIDENCE_PATH || path.join(repoRoot, "tmp/remote-smoke-test/evidence.json");
const timeoutMs = Number(process.env.YNX_REMOTE_TIMEOUT_MS || 12000);
const growthDelayMs = Number(process.env.YNX_REMOTE_BLOCK_GROWTH_DELAY_MS || 2500);
const expected = {
  cosmosChainId: process.env.YNX_COSMOS_CHAIN_ID || "ynx_6423-1",
  evmChainId: Number(process.env.YNX_EVM_CHAIN_ID || 6423),
  evmChainIdHex: String(process.env.YNX_EVM_CHAIN_ID_HEX || "0x1917").toLowerCase(),
  nativeSymbol: process.env.YNX_NATIVE_COIN_SYMBOL || "YNXT",
  minValidators: Number(process.env.YNX_EXPECTED_VALIDATOR_COUNT || 3),
};
const endpoints = {
  rpc: trimSlash(process.env.PUBLIC_RPC_URL || "https://rpc.ynxweb4.com"),
  evm: trimSlash(process.env.PUBLIC_EVM_RPC_URL || "https://evm.ynxweb4.com"),
  rest: trimSlash(process.env.PUBLIC_REST_URL || "https://rest.ynxweb4.com"),
  faucet: trimSlash(process.env.PUBLIC_FAUCET_URL || "https://faucet.ynxweb4.com"),
  indexer: trimSlash(process.env.PUBLIC_INDEXER_URL || "https://indexer.ynxweb4.com"),
  explorer: trimSlash(process.env.PUBLIC_EXPLORER_URL || "https://explorer.ynxweb4.com"),
  ai: trimSlash(process.env.PUBLIC_AI_URL || "https://ai.ynxweb4.com"),
  web4: trimSlash(process.env.PUBLIC_WEB4_URL || "https://web4.ynxweb4.com"),
};
const sampleAddress = process.env.YNX_REMOTE_SMOKE_ADDRESS || `ynx_remote_smoke_${Date.now()}`;

const checks = [];
const evidence = {
  proofType: "remote-public-testnet-smoke",
  generatedAt: new Date().toISOString(),
  gitCommit: readGitCommit(),
  expected,
  endpoints,
  sampleAddress,
  observed: {},
  checks,
};

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function readGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function clip(value, max = 1600) {
  const out = typeof value === "string" ? value : JSON.stringify(value);
  return out.length > max ? `${out.slice(0, max)}...` : out;
}

function record(name, ok, detail, observed) {
  checks.push({ name, ok, detail, observed });
  const status = ok ? "ok" : "FAIL";
  console.log(`${status} ${name}: ${detail}`);
}

async function request(name, url, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Keep the raw body for diagnostics.
    }
    evidence.observed[name] = { url, status: res.status, ok: res.ok, body: json ?? clip(text) };
    if (!res.ok) {
      return { ok: false, status: res.status, text, json, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, text, json };
  } catch (err) {
    evidence.observed[name] = { url, ok: false, error: err.message };
    return { ok: false, status: 0, text: "", json: null, error: err.message };
  }
}

async function getJson(name, url) {
  const res = await request(name, url);
  if (!res.ok) {
    record(name, false, res.error || "request failed", evidence.observed[name]);
    return null;
  }
  if (!res.json) {
    record(name, false, "response is not JSON", evidence.observed[name]);
    return null;
  }
  record(name, true, `HTTP ${res.status}`, evidence.observed[name]);
  return res.json;
}

async function postJson(name, url, body) {
  const res = await request(name, url, { method: "POST", body });
  if (!res.ok) {
    record(name, false, res.error || "request failed", evidence.observed[name]);
    return null;
  }
  if (!res.json) {
    record(name, false, "response is not JSON", evidence.observed[name]);
    return null;
  }
  record(name, true, `HTTP ${res.status}`, evidence.observed[name]);
  return res.json;
}

function chainIdOf(json) {
  return json?.chainId ?? json?.chain_id ?? json?.network?.chainId ?? json?.network?.chain_id ??
    json?.status?.chainId ?? json?.result?.node_info?.network ?? null;
}

function nativeSymbolOf(json) {
  return json?.nativeSymbol ?? json?.native_symbol ?? json?.network?.nativeCurrencySymbol ??
    json?.network?.nativeSymbol ?? json?.denom ?? json?.native?.symbol ?? null;
}

function heightOf(json) {
  const raw = json?.height ?? json?.latestBlockHeight ?? json?.latest_block_height ??
    json?.latestBlock?.height ?? json?.result?.sync_info?.latest_block_height ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function txHashOf(json) {
  return json?.transaction?.hash ?? json?.txHash ?? json?.tx_hash ?? json?.hash ?? null;
}

function chainMatches(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).toLowerCase();
  if (text === expected.cosmosChainId.toLowerCase()) return true;
  if (text === expected.evmChainIdHex) return true;
  if (Number(text) === expected.evmChainId) return true;
  return false;
}

function checkChain(name, json) {
  const chainId = chainIdOf(json);
  const ok = chainMatches(chainId);
  record(name, ok, ok ? `chain id ${chainId}` : `expected ${expected.cosmosChainId} or ${expected.evmChainId}, got ${chainId}`, { chainId });
  return ok;
}

function checkNative(name, json) {
  const native = nativeSymbolOf(json);
  const ok = native === null || native === expected.nativeSymbol;
  record(name, ok, ok ? `native ${native ?? "not reported"}` : `expected ${expected.nativeSymbol}, got ${native}`, { native });
  return ok;
}

function checkTxHash(name, json) {
  const hash = txHashOf(json);
  const ok = typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash);
  record(name, ok, ok ? `tx ${hash}` : `missing valid tx hash: ${hash}`, { hash });
  return ok;
}

function checkValidators(json) {
  const validators = Array.isArray(json?.validators) ? json.validators : [];
  const active = validators.filter((validator) => validator?.active !== false);
  const ok = active.length >= expected.minValidators;
  record(
    "rpc.validators.count",
    ok,
    ok ? `${active.length} active validators` : `expected at least ${expected.minValidators} active validators, got ${active.length}`,
    { count: active.length, validators }
  );
  const hasAddresses = active.every((validator) => typeof validator.address === "string" && validator.address.length > 0);
  record("rpc.validators.addresses", hasAddresses, hasAddresses ? "all validators have addresses" : "one or more validators lack address", { validators });
  const hasMonikers = active.length > 0 && active.every((validator) => typeof validator.moniker === "string" && validator.moniker.length > 0);
  record("rpc.validators.monikers", hasMonikers, hasMonikers ? "all validators have monikers" : "one or more validators lack moniker", { validators });
  return ok && hasAddresses && hasMonikers;
}

function checkEvmResult(name, json, expectedValue) {
  const result = String(json?.result ?? "").toLowerCase();
  const ok = result === expectedValue.toLowerCase();
  record(name, ok, ok ? `result ${result}` : `expected ${expectedValue}, got ${result}`, { result });
  return ok;
}

function checkHexQuantity(name, json) {
  const result = String(json?.result ?? "");
  const ok = /^0x[0-9a-fA-F]+$/.test(result) && Number.parseInt(result, 16) > 0;
  record(name, ok, ok ? `result ${result}` : `invalid block quantity ${result}`, { result });
  return ok;
}

function checkTruthfulServiceHealth(name, json) {
  const okField = json?.ok;
  const oldChain = String(chainIdOf(json) ?? "").toLowerCase() === "ynx_9102-1";
  const ok = okField !== false && !oldChain;
  record(name, ok, ok ? "service health is not old-chain proof" : `old-chain or unhealthy response (${clip(json)})`, json);
  return ok;
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });

  const rpcStatus1 = await getJson("rpc.status.initial", `${endpoints.rpc}/status`);
  const rpcChainOk = rpcStatus1 ? checkChain("rpc.status.chain", rpcStatus1) : false;
  const height1 = rpcStatus1 ? heightOf(rpcStatus1) : null;
  record("rpc.status.height.initial", height1 !== null, height1 !== null ? `height ${height1}` : "missing latest height", { height: height1 });

  await new Promise((resolve) => setTimeout(resolve, growthDelayMs));
  const rpcStatus2 = await getJson("rpc.status.second", `${endpoints.rpc}/status`);
  const height2 = rpcStatus2 ? heightOf(rpcStatus2) : null;
  const grew = height1 !== null && height2 !== null && height2 > height1;
  record("rpc.status.height.growth", grew, grew ? `${height1} -> ${height2}` : `height did not grow (${height1} -> ${height2})`, { height1, height2 });

  const validators = await getJson("rpc.validators", `${endpoints.rpc}/validators`);
  const validatorsOk = validators ? checkValidators(validators) : false;

  const evmChain = await postJson("evm.eth_chainId", endpoints.evm, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
  const evmChainOk = evmChain ? checkEvmResult("evm.eth_chainId.result", evmChain, expected.evmChainIdHex) : false;
  const evmBlock = await postJson("evm.eth_blockNumber", endpoints.evm, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  const evmBlockOk = evmBlock ? checkHexQuantity("evm.eth_blockNumber.result", evmBlock) : false;

  const restStatus = await getJson("rest.status", `${endpoints.rest}/status`);
  const restChainOk = restStatus ? checkChain("rest.status.chain", restStatus) : false;

  const faucetHealth = await getJson("faucet.health", `${endpoints.faucet}/health`);
  const faucetChainOk = faucetHealth ? checkChain("faucet.health.chain", faucetHealth) : false;
  const faucetNativeOk = faucetHealth ? checkNative("faucet.health.native", faucetHealth) : false;

  const indexerOverview = await getJson("indexer.overview", `${endpoints.indexer}/ynx/overview`);
  if (indexerOverview) {
    checkChain("indexer.overview.chain", indexerOverview);
    checkNative("indexer.overview.native", indexerOverview);
  }

  const explorerHealth = await getJson("explorer.health", `${endpoints.explorer}/health`);
  if (explorerHealth) checkTruthfulServiceHealth("explorer.health.truthful", explorerHealth);
  const explorerSummary = await getJson("explorer.summary", `${endpoints.explorer}/api/summary`);
  if (explorerSummary) {
    checkChain("explorer.summary.chain", explorerSummary);
    checkNative("explorer.summary.native", explorerSummary);
    const count = Number(explorerSummary.validatorCount ?? 0);
    record("explorer.summary.validators", count >= expected.minValidators, `validatorCount ${count}`, { validatorCount: count });
  }

  const aiHealth = await getJson("ai.health", `${endpoints.ai}/health`);
  if (aiHealth) {
    checkTruthfulServiceHealth("ai.health.truthful", aiHealth);
    if (chainIdOf(aiHealth) !== null) checkChain("ai.health.chain", aiHealth);
  }
  const web4Health = await getJson("web4.health", `${endpoints.web4}/health`);
  if (web4Health) {
    checkTruthfulServiceHealth("web4.health.truthful", web4Health);
    if (chainIdOf(web4Health) !== null) checkChain("web4.health.chain", web4Health);
  }

  const publicChainReady = rpcChainOk && grew && validatorsOk && evmChainOk && evmBlockOk && restChainOk && faucetChainOk && faucetNativeOk;
  if (!publicChainReady) {
    record("mutable.remote.actions", false, "skipped faucet/pay/trust/resource/IDE mutations because public endpoints are not verified as the new YNX Testnet", {});
  } else {
    const faucetTx = await postJson("faucet.request", `${endpoints.faucet}/request`, { address: sampleAddress, amount: 1 });
    if (faucetTx) checkTxHash("faucet.request.tx", faucetTx);

    const txHash = txHashOf(faucetTx);
    if (txHash) {
      const explorerTx = await getJson("explorer.faucetTx", `${endpoints.explorer}/api/txs/${txHash}`);
      if (explorerTx) checkTxHash("explorer.faucetTx.hash", explorerTx?.transaction ?? explorerTx);
    }

    const pay = await postJson("pay.intent", `${endpoints.rest}/pay/intents`, { merchant: "remote_smoke", amount: 1 });
    record("pay.intent.created", Boolean(pay?.id), pay?.id ? `intent ${pay.id}` : "missing pay intent id", pay);

    const trust = await getJson("trust.trace", `${endpoints.rest}/trust/trace/${sampleAddress}`);
    record("trust.trace.address", trust?.address === sampleAddress, trust?.address ? `trace ${trust.address}` : "missing trust trace", trust);

    const quote = await getJson("resource.quote", `${endpoints.rest}/resource-market/quote?address=${encodeURIComponent(sampleAddress)}&bandwidth=1&compute=1&aiCredits=1&trustCredits=1`);
    record("resource.quote.available", Boolean(quote), quote ? "resource quote returned" : "resource quote missing", quote);

    const source = "pragma solidity ^0.8.24; contract RemoteSmoke { function ping() public pure returns (uint256) { return 1; } }";
    const compile = await postJson("ide.compile", `${endpoints.rest}/ide/compile`, { name: "RemoteSmoke", source });
    record("ide.compile.ok", compile?.ok === true, compile?.ok === true ? "compile preflight ok" : "compile preflight failed", compile);
  }

  const ok = checks.every((check) => check.ok);
  evidence.status = ok ? "passed" : "failed";
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`remote evidence written: ${evidencePath}`);
  if (!ok) {
    const failed = checks.filter((check) => !check.ok).map((check) => check.name).join(", ");
    console.error(`remote-smoke-test failed checks: ${failed}`);
    process.exit(1);
  }
}

main().catch((err) => {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  evidence.status = "error";
  evidence.error = err.stack || err.message;
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(err.stack || err.message);
  process.exit(1);
});
