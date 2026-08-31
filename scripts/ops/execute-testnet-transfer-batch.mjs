#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const rpc = requireURL(args.rpc);
const keyPath = required(args.key, "--key");
const signerPath = required(args.signer, "--signer");
const sender = required(args.sender, "--sender").toLowerCase();
const outputPath = required(args.output, "--output");
const count = boundedInteger(args.count, "--count", 1, 1000);
const bridgeCount = boundedInteger(args["bridge-count"] ?? "0", "--bridge-count", 0, count);
const amount = boundedInteger(args.amount ?? "1", "--amount", 1, Number.MAX_SAFE_INTEGER);
const requestTimeoutMs = boundedInteger(args["request-timeout-ms"] ?? "15000", "--request-timeout-ms", 1000, 120000);
const retryCount = boundedInteger(args.retries ?? "8", "--retries", 1, 30);
const keyStat = fs.statSync(keyPath);
if (!keyStat.isFile() || (keyStat.mode & 0o077) !== 0) throw new Error("--key must be a mode-0600 regular file");
if (!/^0x[0-9a-f]{40}$/.test(sender)) throw new Error("--sender must be a lowercase EVM compatibility address");
const signerStat = fs.statSync(signerPath);
if (!signerStat.isFile() || (signerStat.mode & 0o111) === 0) throw new Error("--signer must be an executable regular file");
const before = await getJSON(`${rpc}/accounts/${sender}`);
const startNonce = Number(before?.account?.nonce) + 1;
const requiredBalance = count * (amount + 1);
if (!Number.isSafeInteger(startNonce) || startNonce <= 0) throw new Error("authoritative account nonce is invalid");
if (Number(before?.account?.balance) < requiredBalance) throw new Error(`account balance is below required ${requiredBalance} YNXT`);

const startedAt = new Date().toISOString();
const results = [];
for (let index = 0; index < count; index += 1) {
  const bridgeCandidate = index >= count - bridgeCount;
  const recipient = bridgeCandidate ? bridgeRecipientAt(index) : recipientAt(index);
  const signed = JSON.parse(execFileSync(signerPath, ["-key", keyPath, "-chain-id", "6423", "-to", recipient, "-amount", String(amount), "-nonce", String(startNonce + index), "-format", "json"], { encoding: "utf8" }));
  if (signed.from !== sender || signed.nonce !== startNonce + index || signed.to !== recipient) throw new Error(`local signer binding failed at ${index + 1}`);
  const transaction = await broadcastAndConfirm(signed, index + 1);
  results.push({
    sequence: index + 1,
    category: bridgeCandidate ? "bridge-source-candidate" : "native-transfer",
    hash: signed.hash,
    from: sender,
    to: recipient,
    amount,
    fee: 1,
    nonce: startNonce + index,
    blockNum: blockHeightOf(transaction),
  });
  writeEvidence("in-progress");
}

const after = await waitForCommit(rpc, sender, startNonce + count - 1);
for (let offset = 0; offset < results.length; offset += 20) {
  const slice = results.slice(offset, offset + 20);
  const committed = await Promise.all(slice.map((item) => getJSON(`${rpc}/txs/${item.hash}`, retryCount)));
  committed.forEach((body, index) => {
    const transaction = body.transaction ?? body;
    const blockNum = blockHeightOf(transaction);
    if (transaction.hash !== slice[index].hash || blockNum <= 0) {
      throw new Error(`committed transaction binding failed for ${slice[index].hash}`);
    }
    slice[index].blockNum = blockNum;
  });
}
const evidence = buildEvidence("complete", after);
writeJSONAtomic(outputPath, evidence);
console.log(JSON.stringify({ ok: true, output: outputPath, sender, count, bridgeCount, startNonce, endNonce: evidence.endingNonce, finalNonce: evidence.finalAccountNonce, blockDistribution: evidence.blockDistribution }));

function buildEvidence(status, accountState = null) {
  const blockGroups = Object.groupBy(results, (item) => String(item.blockNum || "pending"));
  return {
    schema: "ynx-testnet-transfer-batch-evidence/v1",
    status,
    generatedAt: new Date().toISOString(),
    startedAt,
    network: "YNX Testnet",
    chainId: 6423,
    rpc,
    sender,
    count,
    bridgeSourceCandidateCount: bridgeCount,
    requestedTransactionCount: count,
    signedTransactionCount: results.length,
    amountPerTransferYNXT: amount,
    feePerTransferYNXT: 1,
    startingNonce: startNonce,
    endingNonce: results.at(-1)?.nonce ?? startNonce - 1,
    finalAccountNonce: accountState?.account?.nonce ?? null,
    finalBalanceYNXT: accountState?.account?.balance ?? null,
    custodyBoundary: "ephemeral-owner-controlled-mode-0600-key; private key excluded from evidence",
    bridgeBoundary: "bridge-source-candidate labels require separate coordinator evidence and do not prove external-chain execution",
    blockDistribution: Object.fromEntries(Object.entries(blockGroups).map(([height, items]) => [height, items.length])),
    transactions: results,
  };
}

function writeEvidence(status) {
  writeJSONAtomic(outputPath, buildEvidence(status));
}

function writeJSONAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

async function broadcastAndConfirm(signed, sequence) {
  let lastError;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(`${rpc}/transactions/broadcast`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.from(signed.payloadHex.slice(2), "hex"),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.transaction?.hash === signed.hash && body.transaction.nonce === signed.nonce) return body.transaction;
      if (response.status !== 409) throw new Error(`HTTP ${response.status} ${JSON.stringify(body)}`);
    } catch (error) {
      lastError = error;
    }
    const committed = await lookupTransaction(signed.hash);
    if (committed) {
      if (committed.hash !== signed.hash || committed.nonce !== signed.nonce || committed.from?.toLowerCase() !== sender) {
        throw new Error(`committed transaction binding failed for ${signed.hash}`);
      }
      return committed;
    }
    if (attempt < retryCount) await delay(Math.min(500 * (2 ** (attempt - 1)), 5000));
  }
  throw new Error(`broadcast ${sequence} failed after ${retryCount} attempts: ${lastError?.message ?? "transaction not found"}`);
}

async function lookupTransaction(hash) {
  try {
    const body = await getJSON(`${rpc}/txs/${hash}`, 1);
    return body.transaction ?? body;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) throw new Error(`invalid argument ${argv[i] ?? ""}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
function required(value, label) { if (!value) throw new Error(`${label} is required`); return value; }
function boundedInteger(value, label, min, max) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be ${min}..${max}`); return parsed; }
function requireURL(value) { const url = new URL(required(value, "--rpc")); if (!/^https?:$/.test(url.protocol)) throw new Error("--rpc must be HTTP(S)"); return url.toString().replace(/\/$/, ""); }
function recipientAt(index) { return `0x${(index + 1).toString(16).padStart(40, "0")}`; }
function bridgeRecipientAt(index) { return `0x${(0xb000 + index + 1).toString(16).padStart(40, "0")}`; }
async function getJSON(url, attempts = retryCount) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
      const body = await response.json().catch(() => null);
      if (response.ok && body) return body;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await delay(Math.min(250 * (2 ** (attempt - 1)), 3000));
  }
  throw new Error(`GET ${url} failed after ${attempts} attempts: ${lastError?.message ?? "unknown error"}`);
}
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function blockHeightOf(transaction) {
  const height = Number(transaction?.blockNum ?? transaction?.blockNumber ?? 0);
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}
async function waitForCommit(base, account, nonce) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await getJSON(`${base}/accounts/${account}`);
    if (Number(state?.account?.nonce) >= nonce) return state;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`transaction batch did not commit through nonce ${nonce}`);
}
