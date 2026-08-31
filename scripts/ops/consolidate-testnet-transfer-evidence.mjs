#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const batchPath = required(args.batch, "--batch");
const outputPath = required(args.output, "--output");
const rpc = requireURL(args.rpc);
const explorer = requireURL(args.explorer);
const expectedCount = boundedInteger(args.count ?? "100", "--count", 1, 1000);
const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
const sender = String(batch.sender ?? "").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(sender)) throw new Error("batch sender is invalid");
if (batch.status !== "complete") throw new Error("batch evidence is not complete");

const recent = args.recovered
  ? JSON.parse(fs.readFileSync(args.recovered, "utf8"))
  : await getJSON(`${rpc}/txs?limit=${Math.max(expectedCount * 3, 250)}`);
const recentTransactions = Array.isArray(recent.transactions) ? recent.transactions : [];
const recovered = recentTransactions
  .filter((transaction) => String(transaction.from ?? "").toLowerCase() === sender)
  .filter((transaction) => Number(transaction.nonce) < Number(batch.startingNonce))
  .map((transaction) => ({
    sequence: Number(transaction.nonce),
    category: "native-transfer",
    hash: transaction.hash,
    from: sender,
    to: transaction.to,
    amount: Number(transaction.amount),
    fee: Number(transaction.fee),
    nonce: Number(transaction.nonce),
  }));

const candidates = [...recovered, ...batch.transactions]
  .sort((left, right) => left.nonce - right.nonce)
  .filter((transaction, index, all) => index === 0 || transaction.nonce !== all[index - 1].nonce);
if (candidates.length !== expectedCount) throw new Error(`expected ${expectedCount} transactions, found ${candidates.length}`);
for (let index = 0; index < candidates.length; index += 1) {
  if (candidates[index].nonce !== index + 1) throw new Error(`nonce continuity failed at sequence ${index + 1}`);
}

const verified = [];
for (let offset = 0; offset < candidates.length; offset += 10) {
  const slice = candidates.slice(offset, offset + 10);
  verified.push(...await Promise.all(slice.map(verifyTransaction)));
}
const account = await getJSON(`${rpc}/accounts/${sender}`);
if (Number(account?.account?.nonce) !== expectedCount) throw new Error(`sender nonce is ${account?.account?.nonce}, expected ${expectedCount}`);
const bridgeSourceCandidateCount = verified.filter((transaction) => transaction.category === "bridge-source-candidate").length;
const nativeTransferCount = verified.length - bridgeSourceCandidateCount;
const blockDistribution = Object.groupBy(verified, (transaction) => String(transaction.blockNumber));
const evidence = {
  schema: "ynx-testnet-transfer-acceptance/v1",
  generatedAt: new Date().toISOString(),
  status: "complete",
  network: "YNX Testnet",
  chainId: 6423,
  rpc,
  explorer,
  sender,
  transactionCount: verified.length,
  nativeTransferCount,
  bridgeSourceCandidateCount,
  rpcVerifiedCount: verified.filter((transaction) => transaction.rpcVerified).length,
  explorerVerifiedCount: verified.filter((transaction) => transaction.explorerVerified).length,
  startingNonce: 1,
  endingNonce: expectedCount,
  finalAccountNonce: account.account.nonce,
  finalBalanceYNXT: account.account.balance,
  custodyBoundary: "ephemeral owner-controlled mode-0600 key; private key excluded from evidence and repository",
  bridgeBoundary: "The 20 bridge-source-candidate transactions prove only YNX source-chain execution. Bridge status remains read-only and no external-chain settlement is claimed.",
  blockDistribution: Object.fromEntries(Object.entries(blockDistribution).map(([height, transactions]) => [height, transactions.length])),
  transactions: verified,
};
writeJSONAtomic(outputPath, evidence);
console.log(JSON.stringify({ ok: true, output: outputPath, transactionCount: verified.length, nativeTransferCount, bridgeSourceCandidateCount, rpcVerifiedCount: evidence.rpcVerifiedCount, explorerVerifiedCount: evidence.explorerVerifiedCount, finalAccountNonce: evidence.finalAccountNonce }));

async function verifyTransaction(expected) {
  const [rpcBody, explorerBody] = await Promise.all([
    getJSON(`${rpc}/txs/${expected.hash}`),
    getJSON(`${explorer}/api/txs/${expected.hash}`),
  ]);
  const rpcTransaction = rpcBody.transaction ?? rpcBody;
  const explorerTransaction = explorerBody.transaction ?? explorerBody;
  assertBinding(rpcTransaction, expected, "RPC");
  assertBinding(explorerTransaction, expected, "Explorer");
  if (rpcTransaction.blockNumber !== explorerTransaction.blockNumber || rpcTransaction.blockHash !== explorerTransaction.blockHash) {
    throw new Error(`RPC/Explorer block binding differs for ${expected.hash}`);
  }
  return {
    sequence: expected.nonce,
    category: expected.category,
    hash: expected.hash,
    from: sender,
    to: rpcTransaction.to,
    amount: Number(rpcTransaction.amount),
    fee: Number(rpcTransaction.fee),
    nonce: Number(rpcTransaction.nonce),
    blockNumber: Number(rpcTransaction.blockNumber),
    blockHash: rpcTransaction.blockHash,
    timestamp: rpcTransaction.timestamp,
    rpcVerified: true,
    explorerVerified: true,
  };
}

function assertBinding(actual, expected, source) {
  const valid = actual?.hash === expected.hash
    && String(actual?.from ?? "").toLowerCase() === sender
    && Number(actual?.nonce) === expected.nonce
    && Number(actual?.amount) === expected.amount
    && Number.isSafeInteger(Number(actual?.blockNumber))
    && Number(actual.blockNumber) > 0;
  if (!valid) throw new Error(`${source} transaction binding failed for ${expected.hash}`);
}

async function getJSON(url) {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const body = await response.json().catch(() => null);
      if (response.ok && body) return body;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, Math.min(500 * (2 ** (attempt - 1)), 5000)));
  }
  throw new Error(`GET ${url} failed: ${lastError?.message ?? "unknown error"}`);
}

function writeJSONAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}
function parseArgs(argv) { const out = {}; for (let index = 0; index < argv.length; index += 2) { if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument ${argv[index] ?? ""}`); out[argv[index].slice(2)] = argv[index + 1]; } return out; }
function required(value, label) { if (!value) throw new Error(`${label} is required`); return value; }
function boundedInteger(value, label, min, max) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be ${min}..${max}`); return parsed; }
function requireURL(value) { const url = new URL(required(value, "URL")); if (!/^https?:$/.test(url.protocol)) throw new Error("URL must be HTTP(S)"); return url.toString().replace(/\/$/, ""); }
