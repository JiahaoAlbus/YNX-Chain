import fs from "node:fs";
import path from "node:path";
import {toYNXAddress} from "../../sdk/js/index.js";
import {canonicalJSON} from "../lib/sdk-release.mjs";
import {loadExchangeSources} from "../lib/exchange-candidate.mjs";
import {verifyLiveChainlistEndpoints} from "./chainlist-live-check.mjs";

const rootDir = process.cwd();
const {outputPath} = parseArguments(process.argv.slice(2));
const sources = loadExchangeSources(rootDir);
const metadata = JSON.parse(fs.readFileSync(path.join(rootDir, "chain-metadata/ynx-testnet.json"), "utf8"));
const verification = JSON.parse(fs.readFileSync(path.join(rootDir, "chain-metadata/ynx-testnet-verification.json"), "utf8"));
const rpcURL = metadata.rpc[0];
const restURL = new URL(verification.restStatusURL).origin;

const chainlistProof = await verifyLiveChainlistEndpoints({rootDir});
const recent = await requestJSON(`${restURL}/txs?limit=20`, {}, "public REST transactions");
const transaction = recent.transactions?.find((entry) =>
  /^0x[0-9a-f]{64}$/.test(entry?.hash) && Number.isSafeInteger(entry?.blockNumber) && entry.blockNumber > 0 && /^[0-9a-f]{64}$/.test(entry?.blockHash),
);
if (!transaction) throw new Error("public REST did not return a committed transaction suitable for read-only exchange verification");

const accountHex = verification.explorerAccountQuery;
const accountYNX = toYNXAddress(accountHex);
const [accountByHex, accountByYNX] = await Promise.all([
  requestJSON(`${restURL}/accounts/${accountHex}`, {}, "public canonical account"),
  requestJSON(`${restURL}/accounts/${accountYNX}`, {}, "public ynx1 account"),
]);
if (accountByHex.account?.address !== accountHex || canonicalJSON(accountByHex.account) !== canonicalJSON(accountByYNX.account)) {
  throw new Error("public REST account representations do not resolve to one canonical account");
}

const byTransactionHash = await rpc("eth_getTransactionByHash", [transaction.hash]);
const receipt = await rpc("eth_getTransactionReceipt", [transaction.hash]);
const signedVectorEvidence = [];
for (const vector of sources.vectors.value.transactions) {
  const vectorTransaction = await rpc("eth_getTransactionByHash", [vector.transactionHash]);
  const vectorReceipt = await rpc("eth_getTransactionReceipt", [vector.transactionHash]);
  if (vectorTransaction?.hash !== vector.transactionHash || vectorReceipt?.transactionHash !== vector.transactionHash || vectorReceipt?.status !== "0x1") {
    throw new Error(`public signed vector evidence is missing for ${vector.purpose}`);
  }
  signedVectorEvidence.push({blockNumber: vectorReceipt.blockNumber, purpose: vector.purpose, transactionHash: vector.transactionHash});
}
const historicalByNumber = await rpc("eth_getBlockByNumber", [`0x${transaction.blockNumber.toString(16)}`, false]);
const historicalByHash = await rpc("eth_getBlockByHash", [`0x${transaction.blockHash}`, false]);
const transactionCount = await rpcResponse("eth_getTransactionCount", [accountHex, "latest"]);
const logs = await rpc("eth_getLogs", [{fromBlock: `0x${transaction.blockNumber.toString(16)}`, toBlock: `0x${transaction.blockNumber.toString(16)}`}]);
if (!Array.isArray(logs)) throw new Error("public eth_getLogs did not return an array");

const capabilities = {
  canonicalReceiptBlockHash: typeof receipt?.blockHash === "string" && /^0x[0-9a-f]{64}$/.test(receipt.blockHash),
  exactBlockByHash: historicalByHash?.number === `0x${transaction.blockNumber.toString(16)}` && historicalByHash?.hash === `0x${transaction.blockHash}`,
  exactBlockByNumber: historicalByNumber?.number === `0x${transaction.blockNumber.toString(16)}` && historicalByNumber?.hash === `0x${transaction.blockHash}`,
  getLogsAvailable: true,
  getTransactionByHashAvailable: byTransactionHash?.hash === transaction.hash,
  getTransactionCountAvailable: !transactionCount.error && typeof transactionCount.result === "string",
  receiptAvailable: receipt?.transactionHash === transaction.hash,
};
const candidatePublicRuntimeDeployed = capabilities.canonicalReceiptBlockHash && capabilities.exactBlockByHash && capabilities.exactBlockByNumber && capabilities.getTransactionCountAvailable && signedVectorEvidence.length === 2;
if (candidatePublicRuntimeDeployed !== sources.policy.value.broadcastPolicy.publicAuthoritativeDeployed) {
  throw new Error("public exchange runtime capability no longer matches exchange/ynx-testnet-policy.json; update policy and evidence before claiming deployment");
}

const proof = {
  accountRepresentations: {canonical: accountHex, equivalent: true, ynx: accountYNX},
  candidatePublicRuntimeDeployed,
  capabilities,
  chainId: chainlistProof.chainId,
  checkedAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z"),
  exchangeListed: false,
  exchangePartnership: false,
  exchangeSubmitted: false,
  independentExchangeVerified: false,
  independentVantage: false,
  networkId: chainlistProof.networkId,
  observedCommittedTransaction: {blockNumber: transaction.blockNumber, hash: transaction.hash},
  operatorControlled: true,
  publicHeightAfter: chainlistProof.evmHeightAfter,
  publicHeightBefore: chainlistProof.evmHeightBefore,
  release: chainlistProof.release,
  schema: "ynx-exchange-live-proof/v1",
  signedVectorEvidence,
  standardEthereumRLPBroadcastSupported: false,
  truthfulStatus: candidatePublicRuntimeDeployed ? "operator-controlled-candidate-runtime-read-proof" : "operator-controlled-pre-candidate-runtime-read-proof",
};
writeOutput(outputPath, proof);
process.stdout.write(`exchange-live-check passed: release=${proof.release} height=${proof.publicHeightBefore}->${proof.publicHeightAfter} transaction=${transaction.hash} candidatePublicRuntimeDeployed=${candidatePublicRuntimeDeployed} submitted=false listed=false partnered=false independentVantage=false\n`);

async function rpc(method, params) {
  const response = await rpcResponse(method, params);
  if (response.error || !("result" in response)) throw new Error(`public ${method} failed: ${JSON.stringify(response.error || response)}`);
  return response.result;
}

async function rpcResponse(method, params) {
  const id = `exchange-live-${method}`;
  const response = await requestJSON(rpcURL, {
    body: JSON.stringify({id, jsonrpc: "2.0", method, params}),
    headers: {"content-type": "application/json"},
    method: "POST",
  }, `public ${method}`);
  if (response.jsonrpc !== "2.0" || response.id !== id || (!("result" in response) && !response.error)) throw new Error(`public ${method} returned an invalid JSON-RPC response`);
  return response;
}

async function requestJSON(url, options, name) {
  let lastError;
  for (let attempt = 1; attempt <= verification.requestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), verification.requestTimeoutMs);
    try {
      const response = await fetch(url, {...options, redirect: "error", signal: controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error("response exceeds 2 MiB");
      return JSON.parse(body);
    } catch (error) {
      lastError = error;
      if (attempt < verification.requestAttempts) await delay(attempt * 250);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${name} failed after ${verification.requestAttempts} attempts: ${lastError?.message || lastError}`);
}

function writeOutput(value, proof) {
  if (!value) return;
  const resolved = path.resolve(value);
  const allowedRoot = path.resolve(rootDir, "tmp");
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) throw new Error("exchange live proof output must be under repository tmp/");
  fs.mkdirSync(path.dirname(resolved), {recursive: true});
  fs.writeFileSync(resolved, canonicalJSON(proof), {mode: 0o644});
}

function parseArguments(argv) {
  if (argv.length === 0) return {};
  if (argv.length !== 2 || argv[0] !== "--output") throw new Error("usage: exchange-live-check.mjs [--output <tmp/file.json>]");
  return {outputPath: argv[1]};
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
