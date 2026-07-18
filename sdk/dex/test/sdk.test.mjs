import assert from "node:assert/strict";
import test from "node:test";
import {
  DexSdkError, amountIn, amountOut, assertFreshQuote, buildSwapExactInputTx,
  maximumInput, minimumOutput, parsePool, quoteExactInput, quoteExactOutput,
} from "../src/index.js";

const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const token = (value, symbol) => ({ address: address(value), chainId: 6423, decimals: 18, name: `Token ${symbol}`, symbol, verified: true });
const A = token(1, "A"); const B = token(2, "B"); const C = token(3, "C");
const pool = (value, token0, token1, reserve0, reserve1) => ({ address: address(value), feeBps: 30, reserve0: String(reserve0), reserve1: String(reserve1), token0, token1, updatedAt: "2026-07-18T06:00:00.000Z" });
const pools = [pool(11, A, B, 1_000_000n, 1_000_000n), pool(12, B, C, 1_000_000n, 2_000_000n), pool(13, A, C, 1_000_000n, 1_500_000n)];
const now = new Date("2026-07-18T06:00:05.000Z");

test("exact-input routing chooses the best deterministic route", () => {
  const quote = quoteExactInput({ amountIn: 10_000n, tokenIn: A.address, tokenOut: C.address, pools, now });
  assert.deepEqual(quote.path, [A.address, B.address, C.address]);
  assert(quote.amountOut > 0n);
  assert.equal(assertFreshQuote(quote, { now: new Date("2026-07-18T06:00:10.000Z") }), quote);
});

test("exact-output routing minimizes required input", () => {
  const quote = quoteExactOutput({ amountOut: 10_000n, tokenIn: A.address, tokenOut: C.address, pools, now });
  assert(quote.amountIn > 0n);
  assert.equal(quote.amountOut, 10_000n);
});

test("slippage and transaction builder preserve fail-closed bounds", () => {
  assert.equal(minimumOutput(10_000n, 50), 9_950n);
  assert.equal(maximumInput(10_000n, 50), 10_050n);
  const quote = quoteExactInput({ amountIn: 1_000n, tokenIn: A.address, tokenOut: B.address, pools, now: new Date() });
  const tx = buildSwapExactInputTx({ router: address(99), quote, recipient: address(100), slippageBps: 50, deadline: Math.floor(Date.now() / 1000) + 300 });
  assert.equal(tx.chainId, 6423);
  assert.equal(tx.functionName, "swapExactInput");
  assert.equal(tx.args[1], minimumOutput(quote.amountOut, 50).toString());
});

test("constant-product rounding never drains reserves across deterministic property vectors", () => {
  for (let i = 1n; i <= 500n; i++) {
    const reserveIn = 10_000n + i * 97n;
    const reserveOut = 20_000n + i * 193n;
    const input = i * 13n;
    const output = amountOut(input, reserveIn, reserveOut);
    assert(output > 0n && output < reserveOut);
    const required = amountIn(output, reserveIn, reserveOut);
    assert(required <= input);
    assert((reserveIn + input) * (reserveOut - output) >= reserveIn * reserveOut);
  }
});

test("schema, stale, unsupported and liquidity errors are explicit", () => {
  assert.throws(() => parsePool({ ...pools[0], unknown: true }), (error) => error instanceof DexSdkError && error.code === "INVALID_SCHEMA");
  assert.throws(() => quoteExactInput({ amountIn: 1n, tokenIn: A.address, tokenOut: address(999), pools, now }), (error) => error.code === "NO_ROUTE");
  const quote = quoteExactInput({ amountIn: 1_000n, tokenIn: A.address, tokenOut: B.address, pools, now });
  assert.throws(() => assertFreshQuote(quote, { now: new Date("2026-07-18T06:01:00.000Z") }), (error) => error.code === "STALE_QUOTE");
  assert.throws(() => amountOut(1n, 0n, 1n), (error) => error.code === "INVALID_AMOUNT");
});
