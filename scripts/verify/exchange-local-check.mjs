import {loadExchangeSources} from "../lib/exchange-candidate.mjs";

const restURL = stripTrailingSlash(process.env.YNX_REST_URL || "http://127.0.0.1:6420");
const evmURL = stripTrailingSlash(process.env.YNX_EVM_RPC_URL || `${restURL}/evm`);
const sources = loadExchangeSources(process.cwd());
const vectors = Object.fromEntries(sources.vectors.value.transactions.map((entry) => [entry.purpose, entry]));
const accounts = Object.fromEntries(sources.vectors.value.accounts.map((entry) => [entry.role, entry]));
const depositor = accounts.depositor;
const depositAccount = accounts["exchange-deposit-and-test-hot-wallet"];
const recipient = accounts["withdrawal-recipient"];

const health = await requestJSON(`${restURL}/health`);
if (health.ok !== true || health.network?.chainId !== 6423) throw new Error("local exchange check health/chain identity mismatch");
await assertRPCResult("eth_chainId", [], "0x1917");
await assertRPCResult("net_version", [], "6423");

await requestJSON(`${restURL}/faucet`, {
  body: JSON.stringify({address: depositor.evmAddress, amount: 2_000}),
  headers: {"content-type": "application/json"},
  method: "POST",
  expectedStatus: 201,
});

const depositVector = vectors["deposit-recognition"];
const deposit = await requestJSON(`${restURL}/transactions/broadcast`, {
  body: Buffer.from(depositVector.canonicalPayloadHex.slice(2), "hex"),
  headers: {"content-type": "application/json"},
  method: "POST",
  expectedStatus: 201,
});
if (deposit.replayed !== false || deposit.transaction?.hash !== depositVector.transactionHash) throw new Error("local signed deposit response mismatch");
const depositReplay = await requestJSON(`${restURL}/transactions/broadcast`, {
  body: Buffer.from(depositVector.canonicalPayloadHex.slice(2), "hex"),
  headers: {"content-type": "application/json"},
  method: "POST",
  expectedStatus: 200,
});
if (depositReplay.replayed !== true || depositReplay.transaction?.hash !== depositVector.transactionHash) throw new Error("local signed deposit exact replay mismatch");
const depositReceipt = await waitForConfirmations(depositVector.transactionHash, sources.policy.value.confirmationPolicy.fixtureMinimumConfirmations);
if (depositReceipt.status !== "0x1" || depositReceipt.logs?.length !== 1) throw new Error("local signed deposit receipt mismatch");
await assertRPCResult("eth_getTransactionCount", [depositAccount.evmAddress, "latest"], "0x0");
await assertRPCResult("eth_getBalance", [depositAccount.evmAddress, "latest"], "0x3e8");
await assertHistoricalBlock(depositReceipt, depositVector.transactionHash);

const withdrawalVector = vectors["withdrawal-broadcast"];
const withdrawalHash = await rpc("eth_sendRawTransaction", [withdrawalVector.canonicalPayloadHex]);
if (withdrawalHash !== withdrawalVector.transactionHash) throw new Error("local signed withdrawal hash mismatch");
if (await rpc("eth_sendRawTransaction", [withdrawalVector.canonicalPayloadHex]) !== withdrawalHash) throw new Error("local signed withdrawal exact replay mismatch");
const withdrawalReceipt = await waitForConfirmations(withdrawalHash, sources.policy.value.confirmationPolicy.fixtureMinimumConfirmations);
if (withdrawalReceipt.status !== "0x1" || withdrawalReceipt.logs?.length !== 1 || withdrawalReceipt.from !== depositAccount.evmAddress || withdrawalReceipt.to !== recipient.evmAddress) {
  throw new Error("local signed withdrawal committed receipt mismatch");
}
await assertRPCResult("eth_getTransactionCount", [depositAccount.evmAddress, "pending"], "0x1");
await assertRPCResult("eth_getBalance", [depositAccount.evmAddress, "latest"], "0x36a");
await assertRPCResult("eth_getBalance", [recipient.evmAddress, "latest"], "0x7d");
await assertHistoricalBlock(withdrawalReceipt, withdrawalHash);

const depositByHex = await requestJSON(`${restURL}/accounts/${depositAccount.evmAddress}`);
const depositByYNX = await requestJSON(`${restURL}/accounts/${depositAccount.ynxAddress}`);
if (depositByHex.account?.address !== depositAccount.evmAddress || JSON.stringify(depositByHex.account) !== JSON.stringify(depositByYNX.account)) throw new Error("local dual-address account query mismatch");

const logs = await rpc("eth_getLogs", [{fromBlock: withdrawalReceipt.blockNumber, toBlock: withdrawalReceipt.blockNumber, address: recipient.evmAddress}]);
if (!Array.isArray(logs) || logs.length !== 1 || logs[0].transactionHash !== withdrawalHash || logs[0].removed !== false) throw new Error("local exchange log filter mismatch");
await assertRPCError("eth_sendRawTransaction", ["0x01"], -32003);
await assertRPCError("eth_gasPrice", [], -32601);
if (await rpc("eth_getBlockByNumber", ["0xffffffffffff", false]) !== null) throw new Error("unknown historical height did not return null");
if (await rpc("eth_getBlockByHash", [`0x${"00".repeat(32)}`, false]) !== null) throw new Error("unknown block hash did not return null");

process.stdout.write(`exchange-local-check passed: signed deposit=${depositVector.transactionHash} withdrawal=${withdrawalHash} exact replay, ${sources.policy.value.confirmationPolicy.fixtureMinimumConfirmations}-confirmation fixtures, dual-address identity, historical blocks, receipts, logs, nonce, and false raw-input rejection verified; restart persistence is covered separately by Go integration tests\n`);

async function assertHistoricalBlock(receipt, transactionHash) {
  const byNumber = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (byNumber?.hash !== receipt.blockHash || !byNumber?.transactions?.includes(transactionHash)) throw new Error("historical block-by-number mismatch");
  const byHash = await rpc("eth_getBlockByHash", [receipt.blockHash, true]);
  if (byHash?.number !== receipt.blockNumber || !byHash?.transactions?.some((transaction) => transaction?.hash === transactionHash)) throw new Error("historical block-by-hash mismatch");
}

async function waitForConfirmations(transactionHash, minimum) {
  const deadline = Date.now() + 30_000;
  let receipt;
  while (Date.now() < deadline) {
    receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
    if (receipt) {
      const latest = parseQuantity(await rpc("eth_blockNumber", []));
      const included = parseQuantity(receipt.blockNumber);
      if (latest - included + 1 >= minimum) return receipt;
    }
    await delay(300);
  }
  throw new Error(`transaction ${transactionHash} did not reach ${minimum} local confirmations`);
}

async function assertRPCResult(method, params, expected) {
  const actual = await rpc(method, params);
  if (actual !== expected) throw new Error(`${method} mismatch: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

async function assertRPCError(method, params, expectedCode) {
  const id = `exchange-${method}`;
  const response = await requestJSON(evmURL, {
    body: JSON.stringify({id, jsonrpc: "2.0", method, params}),
    headers: {"content-type": "application/json"},
    method: "POST",
  });
  if (response.jsonrpc !== "2.0" || response.id !== id || response.error?.code !== expectedCode) throw new Error(`${method} did not return RPC error ${expectedCode}`);
}

async function rpc(method, params) {
  const id = `exchange-${method}`;
  const response = await requestJSON(evmURL, {
    body: JSON.stringify({id, jsonrpc: "2.0", method, params}),
    headers: {"content-type": "application/json"},
    method: "POST",
  });
  if (response.jsonrpc !== "2.0" || response.id !== id || response.error || !("result" in response)) throw new Error(`${method} returned an invalid JSON-RPC response: ${JSON.stringify(response)}`);
  return response.result;
}

async function requestJSON(url, options = {}) {
  const expectedStatus = options.expectedStatus ?? 200;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let response;
  try {
    response = await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
  const body = await response.text();
  if (response.status !== expectedStatus) throw new Error(`${url} returned HTTP ${response.status}, expected ${expectedStatus}: ${body}`);
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error(`${url} response exceeds 2 MiB`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${url} returned invalid JSON`);
  }
}

function parseQuantity(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) throw new Error(`invalid RPC quantity ${value}`);
  return Number.parseInt(value.slice(2), 16);
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
