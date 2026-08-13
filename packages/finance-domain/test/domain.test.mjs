import test from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, FINANCE_DOMAIN_VERSION, MODEL_KINDS, createError, validateDecimal, validateModel, validateWriteHeaders } from "../src/index.js";

const source = Object.freeze({ owner: "oracle", system: "ynx-oracle", version: "v1", asOf: "2026-08-13T12:00:00.000Z", classification: "testnet", status: "live" });
const examples = {
  Asset: { assetId: "ynxt", symbol: "YNXT", decimals: 18, network: "ynx_6423-1", assetClass: "native-testnet" },
  Market: { marketId: "YNXT-YUSDT", baseAssetId: "ynxt", quoteAssetId: "yusdt-test", venue: "ynx-exchange", status: "active-testnet" },
  Quote: { quoteId: "q:1", marketId: "YNXT-YUSDT", side: "buy", price: "1.0", quantity: "2", expiresAt: "2026-08-13T12:00:10.000Z" },
  Candle: { marketId: "YNXT-YUSDT", interval: "1m", openTime: source.asOf, closeTime: "2026-08-13T12:01:00.000Z", open: "1", high: "1", low: "1", close: "1", baseVolume: "2" },
  Order: { orderId: "o:1", accountId: "a:1", marketId: "YNXT-YUSDT", side: "buy", orderType: "limit", quantity: "2", status: "open", idempotencyKey: "idem:1" },
  Trade: { tradeId: "t:1", marketId: "YNXT-YUSDT", price: "1", quantity: "2", executedAt: source.asOf },
  Position: { positionId: "p:1", accountId: "a:1", marketId: "YNXT-YUSDT", quantity: "2", entryPrice: "1" },
  Portfolio: { portfolioId: "pf:1", accountId: "a:1", valuationAssetId: "ynxt", totalValue: "2", holdings: [] },
  LiquidityPool: { poolId: "pool:1", venue: "ynx-dex", assetIds: ["ynxt", "yusdt-test"], reserves: ["10", "10"], feeBps: 30, totalLpShares: "10" },
  Strategy: { strategyId: "s:1", ownerAccountId: "a:1", strategyVersion: "1", lifecycle: "paper", venueAdapters: ["paper"], riskLimitId: "r:1" },
  RiskLimit: { riskLimitId: "r:1", ownerAccountId: "a:1", maxNotional: "10", maxOrderNotional: "2", maxSlippageBps: 100, expiresAt: "2026-08-14T12:00:00.000Z", killSwitch: false },
};

test("all required finance domain models accept source-bound records", () => {
  for (const kind of MODEL_KINDS) assert.equal(validateModel(kind, { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples[kind] }).schemaVersion, FINANCE_DOMAIN_VERSION);
});

test("models fail closed without provenance or required fields", () => {
  assert.throws(() => validateModel("Order", { schemaVersion: FINANCE_DOMAIN_VERSION, ...examples.Order }), /source/);
  assert.throws(() => validateModel("Order", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Order, orderId: undefined }), /required|invalid/);
});

test("money uses strings and write requests require concurrency controls", () => {
  assert.equal(validateDecimal("1000000"), "1000000");
  assert.throws(() => validateDecimal(1.1), /base-10 string/);
  assert.deepEqual(validateWriteHeaders({ requestId: "req:1", idempotencyKey: "idem:1", expectedVersion: "v:7" }), { requestId: "req:1", idempotencyKey: "idem:1", expectedVersion: "v:7" });
  assert.throws(() => validateWriteHeaders({ requestId: "req:1", idempotencyKey: "idem:1" }), /expectedVersion/);
});

test("error envelopes use stable codes and request correlation", () => {
  const value = createError({ code: ERROR_CODES.SOURCE_STALE, message: "Authoritative market data is stale.", requestId: "req:2", retryable: true });
  assert.equal(value.error.code, "FIN_SOURCE_STALE");
  assert.equal(value.error.retryable, true);
  assert.throws(() => createError({ code: "UNKNOWN", message: "x", requestId: "req:3" }), /unknown finance error code/);
});
