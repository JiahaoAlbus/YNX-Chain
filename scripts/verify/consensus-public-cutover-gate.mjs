#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";

const requiredCapabilities = [
  "status",
  "block-by-height",
  "account-query",
  "validator-set",
  "native-signed-transaction-http-broadcast",
  "transaction-lookup-and-history",
  "evm-chain-id",
  "evm-block-number",
  "evm-transaction-receipts-and-logs",
  "faucet-state-transition",
  "ai-permission-and-action-state-transitions",
  "pay-state-transitions",
  "trust-and-chain-law-state-transitions",
  "resource-market-state-transitions",
  "ide-contract-state-transitions",
];

async function getJSON(baseURL, path) {
  const response = await fetch(`${baseURL}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function evm(baseURL, method, id) {
  const response = await fetch(`${baseURL}/evm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: [] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`EVM ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error || typeof payload.result !== "string") throw new Error(`EVM ${method} is not cutover compatible`);
  return payload.result;
}

async function verify(baseURL, waitMs = 2200) {
  const health = await getJSON(baseURL, "/health");
  if (health.service !== "ynx-bft-gatewayd" || health.mode !== "cometbft-backed" || health.truthfulStatus !== "cometbft-rpc-and-abci-backed") {
    throw new Error("BFT Gateway identity or truthful status is invalid");
  }
  if (health.publicCutoverReady !== true) throw new Error("BFT Gateway explicitly reports publicCutoverReady=false");
  if (!Array.isArray(health.missingCutoverCapabilities) || health.missingCutoverCapabilities.length !== 0) {
    throw new Error(`BFT Gateway still reports missing cutover capabilities: ${(health.missingCutoverCapabilities || []).join(", ")}`);
  }
  const implemented = new Set(health.implementedCapabilities || []);
  const absent = requiredCapabilities.filter((capability) => !implemented.has(capability));
  if (absent.length) throw new Error(`BFT Gateway capability evidence is incomplete: ${absent.join(", ")}`);
  if (health.chainId !== 6423 || health.nativeSymbol !== "YNXT" || health.cometChainId !== "ynx_6423-1" || health.validatorCount !== 4) {
    throw new Error("BFT Gateway health has the wrong YNX chain identity or validator count");
  }

  const before = await getJSON(baseURL, "/status");
  if (before.chainId !== 6423 || before.nativeCurrencySymbol !== "YNXT" || before.cometChainId !== "ynx_6423-1" || before.consensusEngine !== "cometbft" || before.validatorCount !== 4 || before.publicCutoverReady !== true) {
    throw new Error("BFT Gateway status is not public-cutover ready");
  }
  const validators = await getJSON(baseURL, "/validators");
  if (!Array.isArray(validators.validators) || validators.validators.length !== 4 || validators.validators.some((validator) => validator.active !== true || Number(validator.votingPower) <= 0)) {
    throw new Error("BFT Gateway validator evidence is incomplete");
  }
  const block = await getJSON(baseURL, `/blocks/${before.height}`);
  if (Number(block.height) !== Number(before.height) || !/^[0-9a-f]{64}$/.test(block.hash || "")) {
    throw new Error("BFT Gateway latest block evidence is invalid");
  }
  if ((await evm(baseURL, "eth_chainId", 1)) !== "0x1917") throw new Error("BFT Gateway EVM chain ID mismatch");
  const evmHeight = Number.parseInt(await evm(baseURL, "eth_blockNumber", 2), 16);
  if (evmHeight !== Number(before.height)) throw new Error("BFT Gateway EVM height differs from status height");

  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const after = await getJSON(baseURL, "/status");
  if (Number(after.height) <= Number(before.height)) throw new Error(`BFT Gateway height did not grow: ${before.height} -> ${after.height}`);
  return {
    schemaVersion: 1,
    status: "passed",
    scope: "consensus-public-cutover-capability-gate",
    publicCutoverAuthorized: true,
    chainId: after.cometChainId,
    evmChainId: 6423,
    nativeSymbol: "YNXT",
    validatorCount: 4,
    heightBefore: Number(before.height),
    heightAfter: Number(after.height),
    capabilities: requiredCapabilities,
    checkedAt: new Date().toISOString(),
  };
}

async function withFixture(ready, callback) {
  let height = 30;
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const send = (payload) => response.end(JSON.stringify(payload));
    if (request.url === "/health") return send({
      ok: true,
      service: "ynx-bft-gatewayd",
      mode: "cometbft-backed",
      chainId: 6423,
      nativeSymbol: "YNXT",
      cometChainId: "ynx_6423-1",
      validatorCount: 4,
      publicCutoverReady: ready,
      implementedCapabilities: ready ? requiredCapabilities : ["status"],
      missingCutoverCapabilities: ready ? [] : ["trust-and-chain-law-state-transitions"],
      truthfulStatus: "cometbft-rpc-and-abci-backed",
    });
    if (request.url === "/status") {
      height += 1;
      return send({ chainId: 6423, nativeCurrencySymbol: "YNXT", cometChainId: "ynx_6423-1", consensusEngine: "cometbft", validatorCount: 4, publicCutoverReady: ready, height });
    }
    if (request.url === "/validators") return send({ validators: Array.from({ length: 4 }, (_, index) => ({ address: String(index), active: true, votingPower: 1 })) });
    if (request.url?.startsWith("/blocks/")) return send({ height: Number(request.url.split("/").pop()), hash: "a".repeat(64), transactions: [] });
    if (request.url === "/evm" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const rpc = JSON.parse(body);
        send({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "eth_chainId" ? "0x1917" : `0x${height.toString(16)}` });
      });
      return;
    }
    response.statusCode = 404;
    send({ error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes("--self-test")) {
  await withFixture(true, async (baseURL) => {
    const evidence = await verify(baseURL, 10);
    if (evidence.status !== "passed" || evidence.publicCutoverAuthorized !== true || evidence.heightAfter <= evidence.heightBefore) throw new Error("passing cutover fixture failed");
  });
  await withFixture(false, async (baseURL) => {
    let rejected = false;
    try { await verify(baseURL, 10); } catch { rejected = true; }
    if (!rejected) throw new Error("incomplete BFT Gateway fixture passed cutover gate");
  });
  console.log("consensus-public-cutover-gate self-test passed: complete fixture accepted and incomplete capability fixture rejected");
} else {
  const baseURL = String(process.env.CONSENSUS_PUBLIC_COMPAT_URL || "").replace(/\/$/, "");
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) throw new Error("CONSENSUS_PUBLIC_COMPAT_URL must be an explicit loopback BFT Gateway URL");
  const evidence = await verify(baseURL);
  const output = process.env.CONSENSUS_PUBLIC_CUTOVER_EVIDENCE || "tmp/consensus-public-cutover/capability-evidence.json";
  fs.mkdirSync(new URL(".", `file://${process.cwd()}/${output}`).pathname, { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`consensus public cutover capability gate passed at height ${evidence.heightAfter}; explicit authorization and all capability gates are present`);
}
