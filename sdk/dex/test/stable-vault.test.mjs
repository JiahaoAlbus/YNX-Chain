import assert from "node:assert/strict";
import test from "node:test";
import {
  digestVaultRequest,
  quoteStableExactInput,
  quoteStableExactOutput,
} from "../src/index.js";
import {
  buildVaultStableAddLiquidityTx,
  buildVaultStableRemoveLiquidityTx,
  buildVaultStableSwapExactInputTx,
  buildVaultStableSwapExactOutputTx,
  parseIndexedStableVaultAction,
  reconcileIndexedStableVaultAction,
  submitApprovedStableVaultRequest,
} from "../src/stable-vault.js";

const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const current = new Date("2026-07-27T20:00:00.000Z");
const nowSeconds = Math.floor(current.valueOf() / 1000);
const token0 = address(1);
const token1 = address(2);
const pool = stablePool(21, token0, token1);

function stablePool(value, first, second) {
  return {
    address: address(value),
    amplification: 200,
    asOf: current.toISOString(),
    blockNumber: 100,
    chainId: 6423,
    confidence: "confirmed-on-chain",
    contractVersion: "ynx-stableswap-v1",
    coverage: "Confirmed reserves, amplification, fee and precision multipliers",
    failure: null,
    feeBps: 4,
    precisionMultiplier0: "1",
    precisionMultiplier1: "1",
    reserve0: String(1_000_000n * 10n ** 18n),
    reserve1: String(1_000_000n * 10n ** 18n),
    source: "YNX Testnet EVM RPC",
    token0: first,
    token1: second,
    version: "ynx-stable-pool-state-v1",
  };
}

function vaultState() {
  return {
    actionNonce: "7",
    asOf: current.toISOString(),
    chainId: 6423,
    configured: true,
    engine: address(202),
    failure: null,
    killed: false,
    mandate: {
      depegToleranceBps: "100",
      expiresAt: String(nowSeconds + 3_600),
      feeAsset: address(0),
      feeRecipient: address(0),
      maxDailyLossBps: "1000",
      maxDrawdownBps: "2000",
      maxGasPrice: "100000000000",
      maxImpactBps: "500",
      maxSlippageBps: "100",
      maxTradeValue: String(100_000n * 10n ** 18n),
      maxVaultValue: String(1_000_000n * 10n ** 18n),
      minActionInterval: "60",
      oracleMaxAge: "300",
      performanceFeeBps: "0",
    },
    nonceDomain: `0x${"12".repeat(32)}`,
    oracle: address(204),
    owner: address(201),
    paused: false,
    revoked: false,
    router: address(203),
    source: "YNX Testnet EVM RPC",
    vault: address(200),
    version: "ynx-strategy-vault-v1",
  };
}

function selector(high, low) { return `0x${high}${low}`; }

function actionFor(request) {
  return {
    actionNonce: request.args[0],
    afterValue: "9999",
    asOf: current.toISOString(),
    beforeValue: "10000",
    blockHash: `0x${"ef".repeat(32)}`,
    blockNumber: 100,
    confidence: "confirmed-on-chain",
    coverage: "ActionExecuted Vault, nonce, method, values, transaction, block and log identity",
    failure: null,
    logIndex: 3,
    method: request.functionName,
    methodSelector: selector("9295", "2f17"),
    nonceDomain: request.nonceDomain,
    source: "confirmed YNX Testnet EVM logs",
    transactionHash: `0x${"ab".repeat(32)}`,
    vault: request.to,
    version: "ynx-vault-action-v1",
  };
}

test("StableSwap Vault builders bind one direct pool and the limited engine", () => {
  const state = vaultState();
  const deadline = nowSeconds + 300;
  const exactInput = quoteStableExactInput({
    amountIn: 1_000n * 10n ** 18n,
    tokenIn: token0,
    tokenOut: token1,
    pools: [pool],
    now: current,
  });
  const exactOutput = quoteStableExactOutput({
    amountOut: 500n * 10n ** 18n,
    tokenIn: token0,
    tokenOut: token1,
    pools: [pool],
    now: current,
  });
  const inputRequest = buildVaultStableSwapExactInputTx({ state, quote: exactInput, slippageBps: 50, deadline, now: current });
  const outputRequest = buildVaultStableSwapExactOutputTx({ state, quote: exactOutput, slippageBps: 50, deadline, now: current });
  assert.equal(inputRequest.functionName, "stableSwapExactInput");
  assert.deepEqual(inputRequest.args.slice(0, 3), ["7", pool.address, token0]);
  assert.equal(outputRequest.functionName, "stableSwapExactOutput");
  assert.equal(outputRequest.args[1], pool.address);
  assert.equal(inputRequest.executor, state.engine);
  assert.equal(inputRequest.authority, "limited-engine-session");
  assert.equal(inputRequest.approvalRequired, true);
  assert(!Object.hasOwn(inputRequest, "recipient") && !Object.hasOwn(inputRequest, "privateKey"));

  const add = buildVaultStableAddLiquidityTx({ state, pool: pool.address, amount0: 100n, amount1: 100n, minLiquidity: 100n, deadline, now: current });
  const remove = buildVaultStableRemoveLiquidityTx({ state, pool: pool.address, liquidity: 100n, amount0Min: 0n, amount1Min: 0n, deadline, now: current });
  assert.equal(add.functionName, "stableAddLiquidity");
  assert.equal(remove.functionName, "stableRemoveLiquidity");
  assert.equal(remove.args[3], "0");

  const second = stablePool(22, token1, address(3));
  const multihop = quoteStableExactInput({ amountIn: 100n, tokenIn: token0, tokenOut: address(3), pools: [pool, second], now: current });
  assert.throws(
    () => buildVaultStableSwapExactInputTx({ state, quote: multihop, slippageBps: 50, deadline, now: current }),
    (error) => error.code === "INVALID_STABLE_QUOTE",
  );
});

test("StableSwap Vault submission requires the exact canonical Wallet approval", async () => {
  const state = vaultState();
  const quote = quoteStableExactInput({ amountIn: 1_000n, tokenIn: token0, tokenOut: token1, pools: [pool], now: current });
  const request = buildVaultStableSwapExactInputTx({ state, quote, slippageBps: 50, deadline: nowSeconds + 300, now: current });
  const requestDigest = await digestVaultRequest(request);
  const approval = {
    actionNonce: "7",
    approved: true,
    asOf: current.toISOString(),
    chainId: 6423,
    engine: state.engine,
    expiresAt: new Date(current.valueOf() + 60_000).toISOString(),
    failure: null,
    nonceDomain: state.nonceDomain,
    productClientId: "ynx-dex-web-v1",
    requestDigest,
    revoked: false,
    scopes: ["dex:vault:execute"],
    source: "canonical YNX Wallet introspection",
    vault: state.vault,
  };
  let submissions = 0;
  const result = await submitApprovedStableVaultRequest({
    request,
    approval,
    now: current,
    sendTransaction: async (candidate) => {
      submissions++;
      assert.equal(candidate, request);
      return { provider: "YNX Testnet RPC", submittedAt: current.toISOString(), transactionHash: `0x${"cd".repeat(32)}` };
    },
  });
  assert.equal(result.status, "submitted-unconfirmed");
  assert.equal(result.method, "stableSwapExactInput");
  assert.equal(submissions, 1);
  await assert.rejects(
    submitApprovedStableVaultRequest({ request, approval: { ...approval, scopes: ["dex:transaction:request"] }, now: current, sendTransaction: async () => { submissions++; } }),
    (error) => error.code === "APPROVAL_SCOPE",
  );
  assert.equal(submissions, 1);
});

test("StableSwap Vault indexed reconciliation binds the exact ABI selector", () => {
  const state = vaultState();
  const quote = quoteStableExactInput({ amountIn: 1_000n, tokenIn: token0, tokenOut: token1, pools: [pool], now: current });
  const request = buildVaultStableSwapExactInputTx({ state, quote, slippageBps: 50, deadline: nowSeconds + 300, now: current });
  const action = actionFor(request);
  assert.equal(parseIndexedStableVaultAction(action).methodSelector, selector("9295", "2f17"));
  const proof = reconcileIndexedStableVaultAction({ request, action });
  assert.equal(proof.method, "stableSwapExactInput");
  assert.equal(proof.failure, null);
  assert.throws(
    () => parseIndexedStableVaultAction({ ...action, methodSelector: selector("0000", "0000") }),
    (error) => error.code === "INVALID_INDEXED_ACTION",
  );
});
