import {
  DexSdkError,
  assertExecutableVaultState,
  assertFreshQuote,
  digestVaultRequest,
  maximumInput,
  minimumOutput,
} from "./index.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const SELECTOR = /^0x[0-9a-fA-F]{8}$/;
const CHAIN_ID = 6423;
const PRODUCT_CLIENT_ID = "ynx-dex-web-v1";
const APPROVAL_SCOPE = "dex:vault:execute";
const SOURCE = "fresh confirmed YNX Testnet StableSwap RPC state";
const VERSION = "ynx-stable-route-quote-v1";
const METHODS = new Set([
  "stableSwapExactInput",
  "stableSwapExactOutput",
  "stableAddLiquidity",
  "stableRemoveLiquidity",
]);
const METHOD_SELECTORS = Object.freeze({
  stableSwapExactInput: publicSelector("9295", "2f17"),
  stableSwapExactOutput: publicSelector("ed9e", "7942"),
  stableAddLiquidity: publicSelector("3e4d", "75b2"),
  stableRemoveLiquidity: publicSelector("b3df", "3838"),
});

export function buildVaultStableSwapExactInputTx({ state, quote, slippageBps, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  quote = validateDirectStableQuote(quote, "exact-input", now);
  validateDeadline(deadline, state, now);
  return vaultRequest(state, "stableSwapExactInput", [
    state.actionNonce.toString(),
    quote.steps[0].pool,
    quote.steps[0].tokenIn,
    quote.amountIn.toString(),
    minimumOutput(quote.amountOut, slippageBps).toString(),
    deadline,
  ]);
}

export function buildVaultStableSwapExactOutputTx({ state, quote, slippageBps, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  quote = validateDirectStableQuote(quote, "exact-output", now);
  validateDeadline(deadline, state, now);
  return vaultRequest(state, "stableSwapExactOutput", [
    state.actionNonce.toString(),
    quote.steps[0].pool,
    quote.steps[0].tokenIn,
    quote.amountOut.toString(),
    maximumInput(quote.amountIn, slippageBps).toString(),
    deadline,
  ]);
}

export function buildVaultStableAddLiquidityTx({ state, pool, amount0, amount1, minLiquidity, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  validatePool(pool);
  validateDeadline(deadline, state, now);
  return vaultRequest(state, "stableAddLiquidity", [
    state.actionNonce.toString(),
    pool.toLowerCase(),
    positive(amount0).toString(),
    positive(amount1).toString(),
    positive(minLiquidity).toString(),
    deadline,
  ]);
}

export function buildVaultStableRemoveLiquidityTx({ state, pool, liquidity, amount0Min, amount1Min, deadline, now = new Date() }) {
  state = assertExecutableVaultState(state, { now });
  validatePool(pool);
  validateDeadline(deadline, state, now);
  return vaultRequest(state, "stableRemoveLiquidity", [
    state.actionNonce.toString(),
    pool.toLowerCase(),
    positive(liquidity).toString(),
    positive(amount0Min, true).toString(),
    positive(amount1Min, true).toString(),
    deadline,
  ]);
}

export async function submitApprovedStableVaultRequest({ request, approval, sendTransaction, now = new Date() }) {
  validateStableVaultRequest(request);
  if (typeof sendTransaction !== "function") fail("INVALID_TRANSPORT", "an explicit limited-engine transport is required");
  exactObject(approval, [
    "actionNonce", "approved", "asOf", "chainId", "engine", "expiresAt", "failure", "nonceDomain",
    "productClientId", "requestDigest", "revoked", "scopes", "source", "vault",
  ]);
  if (
    approval.approved !== true || approval.revoked !== false || approval.failure !== null
      || approval.chainId !== CHAIN_ID || approval.productClientId !== PRODUCT_CLIENT_ID
      || approval.source !== "canonical YNX Wallet introspection"
  ) fail("INVALID_APPROVAL", "canonical Wallet approval is not active");
  if (
    !ADDRESS.test(approval.vault) || !ADDRESS.test(approval.engine) || !HASH.test(approval.nonceDomain)
      || approval.vault.toLowerCase() !== request.to || approval.engine.toLowerCase() !== request.executor
      || approval.nonceDomain.toLowerCase() !== request.nonceDomain
      || String(approval.actionNonce) !== String(request.args[0])
  ) fail("APPROVAL_MISMATCH", "approval identity does not match the StableSwap Vault request");
  if (!Array.isArray(approval.scopes) || approval.scopes.length !== 1 || approval.scopes[0] !== APPROVAL_SCOPE) {
    fail("APPROVAL_SCOPE", "approval scope must be exact");
  }
  if (!HASH.test(approval.requestDigest) || approval.requestDigest.toLowerCase() !== await digestVaultRequest(request)) {
    fail("APPROVAL_MISMATCH", "approval digest does not match the StableSwap Vault request");
  }
  const asOf = new Date(approval.asOf);
  const expiresAt = new Date(approval.expiresAt);
  if (!Number.isFinite(asOf.valueOf()) || !Number.isFinite(expiresAt.valueOf()) || asOf > now || expiresAt <= now) {
    fail("APPROVAL_EXPIRED", "approval timing is invalid");
  }
  const result = await sendTransaction(request);
  exactObject(result, ["provider", "submittedAt", "transactionHash"]);
  if (!bounded(result.provider, 1, 80) || !HASH.test(result.transactionHash) || !Number.isFinite(new Date(result.submittedAt).valueOf())) {
    fail("INVALID_SUBMISSION", "transport returned invalid submission evidence");
  }
  return Object.freeze({
    status: "submitted-unconfirmed",
    source: "caller-supplied YNX limited-engine transport",
    asOf: new Date(result.submittedAt).toISOString(),
    version: "ynx-stable-vault-submission-v1",
    failure: null,
    provider: result.provider,
    transactionHash: result.transactionHash.toLowerCase(),
    vault: request.to,
    nonceDomain: request.nonceDomain,
    actionNonce: String(request.args[0]),
    requestDigest: approval.requestDigest.toLowerCase(),
    method: request.functionName,
  });
}

export function parseIndexedStableVaultAction(value) {
  exactObject(value, [
    "actionNonce", "afterValue", "asOf", "beforeValue", "blockHash", "blockNumber", "confidence", "coverage",
    "failure", "logIndex", "method", "methodSelector", "nonceDomain", "source", "transactionHash", "vault", "version",
  ]);
  if (
    !ADDRESS.test(value.vault) || !HASH.test(value.nonceDomain) || !HASH.test(value.transactionHash)
      || !HASH.test(value.blockHash) || !SELECTOR.test(value.methodSelector)
      || METHOD_SELECTORS[value.method] !== value.methodSelector.toLowerCase()
      || !Number.isSafeInteger(value.blockNumber) || value.blockNumber < 1
      || !Number.isSafeInteger(value.logIndex) || value.logIndex < 0
  ) fail("INVALID_INDEXED_ACTION", "invalid indexed StableSwap Vault action identity");
  positive(value.actionNonce, true);
  positive(value.beforeValue, true);
  positive(value.afterValue, true);
  const asOf = new Date(value.asOf);
  if (
    !Number.isFinite(asOf.valueOf()) || value.source !== "confirmed YNX Testnet EVM logs"
      || value.version !== "ynx-vault-action-v1" || value.confidence !== "confirmed-on-chain"
      || !bounded(value.coverage, 20, 500) || value.failure !== null
  ) fail("INVALID_INDEXED_ACTION", "indexed StableSwap Vault action provenance is not authoritative");
  return Object.freeze({
    ...value,
    vault: value.vault.toLowerCase(),
    nonceDomain: value.nonceDomain.toLowerCase(),
    transactionHash: value.transactionHash.toLowerCase(),
    blockHash: value.blockHash.toLowerCase(),
    methodSelector: value.methodSelector.toLowerCase(),
    actionNonce: String(value.actionNonce),
    beforeValue: String(value.beforeValue),
    afterValue: String(value.afterValue),
    asOf: asOf.toISOString(),
  });
}

export function reconcileIndexedStableVaultAction({ request, action }) {
  validateStableVaultRequest(request);
  action = parseIndexedStableVaultAction(action);
  if (
    request.to !== action.vault || request.nonceDomain !== action.nonceDomain
      || request.functionName !== action.method || String(request.args[0]) !== action.actionNonce
  ) fail("RECEIPT_MISMATCH", "indexed StableSwap action does not match the approved request");
  return Object.freeze({
    source: action.source,
    asOf: action.asOf,
    version: "ynx-stable-vault-indexed-reconciliation-v1",
    coverage: action.coverage,
    confidence: action.confidence,
    failure: null,
    transactionHash: action.transactionHash,
    blockHash: action.blockHash,
    blockNumber: action.blockNumber,
    logIndex: action.logIndex,
    vault: action.vault,
    nonceDomain: action.nonceDomain,
    actionNonce: action.actionNonce,
    method: action.method,
    beforeValue: action.beforeValue,
    afterValue: action.afterValue,
  });
}

function validateDirectStableQuote(quote, kind, now) {
  assertFreshQuote(quote, { now });
  exactObject(quote, ["amountIn", "amountOut", "confidence", "failure", "kind", "path", "quotedAt", "source", "steps", "version"]);
  if (
    quote.kind !== kind || quote.source !== SOURCE || quote.version !== VERSION
      || quote.confidence !== "deterministic-preflight" || quote.failure !== null
      || !Array.isArray(quote.path) || quote.path.length !== 2 || !Array.isArray(quote.steps) || quote.steps.length !== 1
  ) fail("INVALID_STABLE_QUOTE", "StableSwap Vault execution requires one fresh direct authoritative route");
  const step = quote.steps[0];
  exactObject(step, [
    "amplification", "amountIn", "amountOut", "contractVersion", "feeBps", "pool", "reserveIn", "reserveOut", "tokenIn", "tokenOut",
  ]);
  if (
    !ADDRESS.test(step.pool) || !ADDRESS.test(step.tokenIn) || !ADDRESS.test(step.tokenOut)
      || step.contractVersion !== "ynx-stableswap-v1" || !Number.isInteger(step.amplification)
      || step.amplification < 10 || step.amplification > 10_000 || !Number.isInteger(step.feeBps)
      || step.feeBps < 1 || step.feeBps > 100 || quote.path[0] !== step.tokenIn || quote.path[1] !== step.tokenOut
  ) fail("INVALID_STABLE_QUOTE", "StableSwap quote identity or immutable parameters are invalid");
  const amountIn = positive(quote.amountIn);
  const amountOut = positive(quote.amountOut);
  if (positive(step.amountIn) !== amountIn || positive(step.amountOut) !== amountOut) {
    fail("INVALID_STABLE_QUOTE", "StableSwap step amounts do not bind the route totals");
  }
  positive(step.reserveIn);
  positive(step.reserveOut);
  return Object.freeze({ ...quote, amountIn, amountOut });
}

function validateStableVaultRequest(request) {
  exactObject(request, [
    "approvalRequired", "args", "authority", "chainId", "executor", "functionName", "nonceDomain", "sourceStateAsOf", "to", "value",
  ]);
  if (
    request.chainId !== CHAIN_ID || !ADDRESS.test(request.to) || !ADDRESS.test(request.executor)
      || !HASH.test(request.nonceDomain) || !METHODS.has(request.functionName)
      || request.authority !== "limited-engine-session" || request.approvalRequired !== true
      || request.value !== "0" || !Number.isFinite(new Date(request.sourceStateAsOf).valueOf()) || !Array.isArray(request.args)
  ) fail("INVALID_TRANSACTION", "invalid StableSwap Vault request identity");
  if (request.args.length !== 6 || !ADDRESS.test(request.args[1])) fail("INVALID_TRANSACTION", "invalid StableSwap Vault arguments");
  positive(request.args[0], true);
  if (request.functionName.startsWith("stableSwap")) {
    if (!ADDRESS.test(request.args[2])) fail("INVALID_TRANSACTION", "invalid StableSwap input token");
    positive(request.args[3]);
    positive(request.args[4]);
  } else {
    positive(request.args[2]);
    positive(request.args[3], request.functionName === "stableRemoveLiquidity");
    positive(request.args[4], request.functionName === "stableRemoveLiquidity");
  }
  if (!Number.isInteger(request.args[5]) || request.args[5] < 1) fail("INVALID_DEADLINE", "invalid StableSwap Vault deadline");
  return request;
}

function vaultRequest(state, functionName, args) {
  return Object.freeze({
    chainId: CHAIN_ID,
    to: state.vault,
    executor: state.engine,
    functionName,
    args: Object.freeze(args),
    value: "0",
    authority: "limited-engine-session",
    approvalRequired: true,
    nonceDomain: state.nonceDomain,
    sourceStateAsOf: state.asOf,
  });
}

function validateDeadline(deadline, state, now) {
  const nowSeconds = Math.floor(now.valueOf() / 1000);
  if (!Number.isInteger(deadline) || deadline <= nowSeconds || deadline > nowSeconds + 3_600 || BigInt(deadline) > state.mandate.expiresAt) {
    fail("INVALID_DEADLINE", "deadline must be within one hour and the Vault mandate expiry");
  }
}

function validatePool(pool) {
  if (!ADDRESS.test(pool) || pool.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    fail("INVALID_POOL", "invalid StableSwap pool address");
  }
}

function positive(value, allowZero = false) {
  let parsed;
  try { parsed = typeof value === "bigint" ? value : BigInt(value); }
  catch { fail("INVALID_AMOUNT", "amount is not an integer"); }
  if (parsed < 0n || (!allowZero && parsed === 0n)) fail("INVALID_AMOUNT", "amount must be positive");
  return parsed;
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    fail("INVALID_SCHEMA", "unknown or missing fields");
  }
}

function publicSelector(high, low) { return `0x${high}${low}`; }
function bounded(value, min, max) { return typeof value === "string" && value.length >= min && value.length <= max; }
function fail(code, message) { throw new DexSdkError(code, message); }
