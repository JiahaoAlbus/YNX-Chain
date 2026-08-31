import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ERROR_CODES, FINANCE_DOMAIN_VERSION, FINANCE_READ_ENVELOPE_VERSION, FINANCE_STREAM_ENVELOPE_VERSION, MODEL_KINDS, ORDER_STATUSES, assertOrderTransition, createError, evaluateWritePrecondition, validateDecimal, validateModel, validateReadEnvelope, validateStreamEnvelope, validateWriteHeaders } from "../src/index.js";

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

test("models reject invalid finance semantics instead of accepting field-shaped records", () => {
  assert.throws(() => validateModel("Asset", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Asset, decimals: -1 }), /Asset.decimals/);
  assert.throws(() => validateModel("Quote", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Quote, quantity: "0.0" }), /positive/);
  assert.throws(() => validateModel("Candle", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Candle, interval: "13m" }), /Candle.interval/);
  assert.throws(() => validateModel("Candle", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Candle, closeTime: source.asOf }), /closeTime must follow/);
  assert.throws(() => validateModel("Order", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Order, orderType: "arbitrary" }), /Order.orderType/);
  assert.throws(() => validateModel("LiquidityPool", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.LiquidityPool, reserves: ["10"] }), /LiquidityPool.reserves/);
  assert.throws(() => validateModel("Strategy", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Strategy, lifecycle: "live" }), /Strategy.lifecycle/);
  assert.throws(() => validateModel("RiskLimit", { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.RiskLimit, maxSlippageBps: 10001 }), /RiskLimit.maxSlippageBps/);
});

test("read envelopes preserve source truth and never carry a mutation capability", () => {
  const data = { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Portfolio };
  const envelope = {
    schemaVersion: FINANCE_READ_ENVELOPE_VERSION,
    kind: "Portfolio",
    requestId: "portfolio-read-1",
    readOnly: true,
    capabilities: ["read"],
    sourceStatus: "live",
    cursor: "page:2",
    data,
  };
  assert.equal(validateReadEnvelope(envelope), envelope);
  assert.throws(() => validateReadEnvelope({ ...envelope, readOnly: false }), /read-only/);
  assert.throws(() => validateReadEnvelope({ ...envelope, capabilities: [] }), /capabilities/);
  assert.throws(() => validateReadEnvelope({ ...envelope, capabilities: ["write"] }), /capabilities/);
  assert.throws(() => validateReadEnvelope({ ...envelope, sourceStatus: "stale" }), /sourceStatus/);
  assert.throws(() => validateReadEnvelope({ ...envelope, cursor: "bad cursor" }), /cursor/);
});

test("stream envelopes are ordered source-bound reads without action semantics", () => {
  const data = { schemaVersion: FINANCE_DOMAIN_VERSION, source, ...examples.Market };
  const envelope = {
    schemaVersion: FINANCE_STREAM_ENVELOPE_VERSION,
    event: "upsert",
    eventId: "event:1",
    requestId: "stream:1",
    sequence: 7,
    emittedAt: source.asOf,
    readOnly: true,
    kind: "Market",
    sourceStatus: "live",
    cursor: "cursor:7",
    data,
  };
  assert.equal(validateStreamEnvelope(envelope), envelope);
  assert.throws(() => validateStreamEnvelope({ ...envelope, readOnly: false }), /read-only/);
  assert.throws(() => validateStreamEnvelope({ ...envelope, event: "order_submitted" }), /event/);
  assert.throws(() => validateStreamEnvelope({ ...envelope, sequence: -1 }), /sequence/);
  assert.throws(() => validateStreamEnvelope({ ...envelope, sourceStatus: "stale" }), /sourceStatus/);
});

test("stream schema is version-locked to the runtime validator and rejects mutation fields", async () => {
  const schemaPath = fileURLToPath(new URL("../../../release/integration/finance-source-stream-envelope-v1.schema.json", import.meta.url));
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  assert.equal(schema.properties.schemaVersion.const, FINANCE_STREAM_ENVELOPE_VERSION);
  assert.deepEqual(schema.properties.event.enum, ["snapshot", "upsert", "reconciled"]);
  assert.equal(schema.properties.readOnly.const, true);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.sequence.maximum, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(schema.properties.kind.enum, MODEL_KINDS);
  assert.match(schema["x-ynx-runtime-validator"], /validateStreamEnvelope/);
  assert.match(schema["x-ynx-cross-field-validation"].join(" "), /no action or mutation capability/);
});

test("money uses strings and write requests require concurrency controls", () => {
  assert.equal(validateDecimal("1000000"), "1000000");
  assert.throws(() => validateDecimal(1.1), /base-10 string/);
  assert.deepEqual(validateWriteHeaders({ requestId: "req:1", idempotencyKey: "idem:1", expectedVersion: "v:7" }), { requestId: "req:1", idempotencyKey: "idem:1", expectedVersion: "v:7" });
  assert.throws(() => validateWriteHeaders({ requestId: "req:1", idempotencyKey: "idem:1" }), /expectedVersion/);
});

test("write preconditions fail closed on conflicts and only replay an exact persisted request", () => {
  const headers = { requestId: "req:3", idempotencyKey: "idem:3", expectedVersion: "v:7" };
  const digest = "a".repeat(64);
  assert.deepEqual(evaluateWritePrecondition({ headers, currentVersion: "v:7", requestDigest: digest }), { action: "create", expectedVersion: "v:7" });
  assert.throws(() => evaluateWritePrecondition({ headers, currentVersion: "v:8", requestDigest: digest }), (error) => error.code === ERROR_CODES.CONCURRENT_MODIFICATION);
  assert.deepEqual(evaluateWritePrecondition({
    headers,
    currentVersion: "v:8",
    requestDigest: digest,
    idempotencyRecord: { idempotencyKey: "idem:3", requestDigest: digest, resourceVersion: "v:8", outcome: "execution_unknown" },
  }), { action: "replay", resourceVersion: "v:8", outcome: "execution_unknown" });
  assert.throws(() => evaluateWritePrecondition({
    headers,
    currentVersion: "v:8",
    requestDigest: "b".repeat(64),
    idempotencyRecord: { idempotencyKey: "idem:3", requestDigest: digest, resourceVersion: "v:8", outcome: "accepted" },
  }), (error) => error.code === ERROR_CODES.IDEMPOTENCY_CONFLICT);
});

test("order transitions preserve terminal states and require authoritative reconciliation after unknown execution", () => {
  assert.equal(ORDER_STATUSES.includes("execution_unknown"), true);
  assert.equal(assertOrderTransition("pending", "open"), "open");
  assert.equal(assertOrderTransition("execution_unknown", "filled"), "filled");
  assert.throws(() => assertOrderTransition("filled", "open"), (error) => error.code === ERROR_CODES.CONCURRENT_MODIFICATION);
  assert.throws(() => assertOrderTransition("open", "rejected"), (error) => error.code === ERROR_CODES.CONCURRENT_MODIFICATION);
});

test("integration contract version-locks the durable write precondition boundary", async () => {
  const contractPath = fileURLToPath(new URL("../../../release/integration/finance-suite-domain-contract-v1.json", import.meta.url));
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  assert.equal(contract.schemaVersion, "1.0.0-candidate.2");
  assert.match(contract.writeProtocol.requiredRequestDigest, /RFC 8785 JCS/);
  assert.match(contract.writeProtocol.idempotency, /atomically/);
  assert.match(contract.writeProtocol.concurrency, /expectedVersion/);
  assert.match(contract.writeProtocol.orderStateMachine, /execution_unknown/);
});

test("error envelopes use stable codes and request correlation", () => {
  const value = createError({ code: ERROR_CODES.SOURCE_STALE, message: "Authoritative market data is stale.", requestId: "req:2", retryable: true });
  assert.equal(value.error.code, "FIN_SOURCE_STALE");
  assert.equal(value.error.retryable, true);
  assert.throws(() => createError({ code: "UNKNOWN", message: "x", requestId: "req:3" }), /unknown finance error code/);
});
