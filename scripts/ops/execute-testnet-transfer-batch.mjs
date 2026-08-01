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
  const response = await fetch(`${rpc}/transactions/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.from(signed.payloadHex.slice(2), "hex"),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.transaction?.hash) throw new Error(`broadcast ${index + 1} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  if (body.transaction.hash !== signed.hash || body.transaction.nonce !== startNonce + index) throw new Error(`broadcast ${index + 1} response binding failed`);
  results.push({
    sequence: index + 1,
    category: bridgeCandidate ? "bridge-source-candidate" : "native-transfer",
    hash: signed.hash,
    from: sender,
    to: recipient,
    amount,
    fee: 1,
    nonce: startNonce + index,
    blockNum: body.transaction.blockNum ?? 0,
  });
}

const after = await waitForCommit(rpc, sender, startNonce + count - 1);
for (let offset = 0; offset < results.length; offset += 20) {
  const slice = results.slice(offset, offset + 20);
  const committed = await Promise.all(slice.map((item) => getJSON(`${rpc}/txs/${item.hash}`)));
  committed.forEach((body, index) => {
    const transaction = body.transaction ?? body;
    if (transaction.hash !== slice[index].hash || !Number.isSafeInteger(transaction.blockNum) || transaction.blockNum <= 0) {
      throw new Error(`committed transaction binding failed for ${slice[index].hash}`);
    }
    slice[index].blockNum = transaction.blockNum;
  });
}
const blockGroups = Object.groupBy(results, (item) => String(item.blockNum || "pending"));
const evidence = {
  schema: "ynx-testnet-transfer-batch-evidence/v1",
  generatedAt: new Date().toISOString(),
  startedAt,
  network: "YNX Testnet",
  chainId: 6423,
  rpc,
  sender,
  count,
  bridgeSourceCandidateCount: bridgeCount,
  signedTransactionCount: results.length,
  amountPerTransferYNXT: amount,
  feePerTransferYNXT: 1,
  startingNonce: startNonce,
  endingNonce: startNonce + count - 1,
  finalAccountNonce: after.account.nonce,
  finalBalanceYNXT: after.account.balance,
  custodyBoundary: "ephemeral-owner-controlled-mode-0600-key; private key excluded from evidence",
  bridgeBoundary: "bridge-source-candidate labels require separate coordinator evidence and do not prove external-chain execution",
  blockDistribution: Object.fromEntries(Object.entries(blockGroups).map(([height, items]) => [height, items.length])),
  transactions: results,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, output: outputPath, sender, count, bridgeCount, startNonce, endNonce: evidence.endingNonce, finalNonce: evidence.finalAccountNonce, blockDistribution: evidence.blockDistribution }));

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
async function getJSON(url) { const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }); const body = await response.json().catch(() => null); if (!response.ok || !body) throw new Error(`GET ${url} failed: HTTP ${response.status}`); return body; }
async function waitForCommit(base, account, nonce) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await getJSON(`${base}/accounts/${account}`);
    if (Number(state?.account?.nonce) >= nonce) return state;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`transaction batch did not commit through nonce ${nonce}`);
}
