export const FINANCE_DOMAIN_VERSION = "ynx-finance-domain-v1";
export const FINANCE_READ_ENVELOPE_VERSION = "ynx-finance-read-envelope-v1";
export const FINANCE_STREAM_ENVELOPE_VERSION = "ynx-finance-stream-envelope-v1";

export const MODEL_KINDS = Object.freeze([
  "Asset",
  "Market",
  "Quote",
  "Candle",
  "Order",
  "Trade",
  "Position",
  "Portfolio",
  "LiquidityPool",
  "Strategy",
  "RiskLimit",
]);

export const ORDER_STATUSES = Object.freeze([
  "pending",
  "open",
  "partially_filled",
  "filled",
  "cancelled",
  "rejected",
  "expired",
  "execution_unknown",
]);

export const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "FIN_INVALID_REQUEST",
  UNAUTHENTICATED: "FIN_UNAUTHENTICATED",
  FORBIDDEN: "FIN_FORBIDDEN",
  IDEMPOTENCY_CONFLICT: "FIN_IDEMPOTENCY_CONFLICT",
  CONCURRENT_MODIFICATION: "FIN_CONCURRENT_MODIFICATION",
  RATE_LIMITED: "FIN_RATE_LIMITED",
  SOURCE_UNAVAILABLE: "FIN_SOURCE_UNAVAILABLE",
  SOURCE_STALE: "FIN_SOURCE_STALE",
  RISK_REJECTED: "FIN_RISK_REJECTED",
  CONFIRMATION_REQUIRED: "FIN_CONFIRMATION_REQUIRED",
  EXECUTION_UNKNOWN: "FIN_EXECUTION_UNKNOWN",
  INTERNAL: "FIN_INTERNAL",
});

const requiredByKind = Object.freeze({
  Asset: ["assetId", "symbol", "decimals", "network", "assetClass"],
  Market: ["marketId", "baseAssetId", "quoteAssetId", "venue", "status"],
  Quote: ["quoteId", "marketId", "side", "price", "quantity", "expiresAt"],
  Candle: ["marketId", "interval", "openTime", "closeTime", "open", "high", "low", "close", "baseVolume"],
  Order: ["orderId", "accountId", "marketId", "side", "orderType", "quantity", "status", "idempotencyKey"],
  Trade: ["tradeId", "marketId", "price", "quantity", "executedAt"],
  Position: ["positionId", "accountId", "marketId", "quantity", "entryPrice"],
  Portfolio: ["portfolioId", "accountId", "valuationAssetId", "totalValue", "holdings"],
  LiquidityPool: ["poolId", "venue", "assetIds", "reserves", "feeBps", "totalLpShares"],
  Strategy: ["strategyId", "ownerAccountId", "strategyVersion", "lifecycle", "venueAdapters", "riskLimitId"],
  RiskLimit: ["riskLimitId", "ownerAccountId", "maxNotional", "maxOrderNotional", "maxSlippageBps", "expiresAt", "killSwitch"],
});

const decimalPattern = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const zeroDecimalPattern = /^0(?:\.0+)?$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const orderTransitions = Object.freeze({
  pending: Object.freeze(["open", "cancelled", "rejected", "execution_unknown"]),
  open: Object.freeze(["partially_filled", "filled", "cancelled", "expired", "execution_unknown"]),
  partially_filled: Object.freeze(["filled", "cancelled", "expired", "execution_unknown"]),
  execution_unknown: Object.freeze(["open", "partially_filled", "filled", "cancelled", "rejected", "expired"]),
  filled: Object.freeze([]),
  cancelled: Object.freeze([]),
  rejected: Object.freeze([]),
  expired: Object.freeze([]),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, code, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function assertID(value, field) {
  assert(typeof value === "string" && idPattern.test(value), ERROR_CODES.INVALID_REQUEST, `${field} is invalid`);
  return value;
}

function assertTimestamp(value, field) {
  assert(typeof value === "string" && Number.isFinite(Date.parse(value)), ERROR_CODES.INVALID_REQUEST, `${field} is invalid`);
  return value;
}

function assertInteger(value, field, minimum, maximum) {
  assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum, ERROR_CODES.INVALID_REQUEST, `${field} is invalid`);
  return value;
}

function assertDecimal(value, field, positive = false) {
  validateDecimal(value, field);
  assert(!positive || !zeroDecimalPattern.test(value), ERROR_CODES.INVALID_REQUEST, `${field} must be positive`);
  return value;
}

function assertStringArray(value, field, minimum = 1) {
  assert(Array.isArray(value) && value.length >= minimum && value.every((item) => typeof item === "string" && item.length > 0), ERROR_CODES.INVALID_REQUEST, `${field} is invalid`);
  return value;
}

export function validateSource(source) {
  assert(isRecord(source), ERROR_CODES.INVALID_REQUEST, "source must be an object");
  assertID(source.owner, "source.owner");
  assertID(source.system, "source.system");
  assert(typeof source.version === "string" && source.version.length <= 128, ERROR_CODES.INVALID_REQUEST, "source.version is invalid");
  assertTimestamp(source.asOf, "source.asOf");
  assert(["authoritative", "verified-index", "reference", "testnet"].includes(source.classification), ERROR_CODES.INVALID_REQUEST, "source.classification is invalid");
  assert(["live", "stale", "unavailable", "partial"].includes(source.status), ERROR_CODES.INVALID_REQUEST, "source.status is invalid");
  return source;
}

export function validateDecimal(value, field = "value") {
  assert(typeof value === "string" && decimalPattern.test(value), ERROR_CODES.INVALID_REQUEST, `${field} must be a non-negative base-10 string`);
  return value;
}

export function compareDecimal(left, right) {
  validateDecimal(left, "left decimal");
  validateDecimal(right, "right decimal");
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  if (leftWhole.length !== rightWhole.length) return leftWhole.length > rightWhole.length ? 1 : -1;
  if (leftWhole !== rightWhole) return leftWhole > rightWhole ? 1 : -1;
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(precision, "0");
  const normalizedRight = rightFraction.padEnd(precision, "0");
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? 1 : -1;
}

export function validateModel(kind, value) {
  assert(MODEL_KINDS.includes(kind), ERROR_CODES.INVALID_REQUEST, "unknown finance model kind");
  assert(isRecord(value), ERROR_CODES.INVALID_REQUEST, `${kind} must be an object`);
  assert(value.schemaVersion === FINANCE_DOMAIN_VERSION, ERROR_CODES.INVALID_REQUEST, `${kind}.schemaVersion is invalid`);
  validateSource(value.source);
  for (const field of requiredByKind[kind]) {
    assert(Object.hasOwn(value, field) && value[field] !== undefined && value[field] !== null, ERROR_CODES.INVALID_REQUEST, `${kind}.${field} is required`);
  }
  switch (kind) {
    case "Asset":
      assertID(value.assetId, "Asset.assetId");
      assert(typeof value.symbol === "string" && /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(value.symbol), ERROR_CODES.INVALID_REQUEST, "Asset.symbol is invalid");
      assertInteger(value.decimals, "Asset.decimals", 0, 36);
      assertID(value.network, "Asset.network");
      assertID(value.assetClass, "Asset.assetClass");
      break;
    case "Market":
      assertID(value.marketId, "Market.marketId");
      assertID(value.baseAssetId, "Market.baseAssetId");
      assertID(value.quoteAssetId, "Market.quoteAssetId");
      assertID(value.venue, "Market.venue");
      assertID(value.status, "Market.status");
      break;
    case "Quote":
      assertID(value.quoteId, "Quote.quoteId");
      assertID(value.marketId, "Quote.marketId");
      assert(["buy", "sell"].includes(value.side), ERROR_CODES.INVALID_REQUEST, "Quote.side is invalid");
      assertDecimal(value.price, "Quote.price", true);
      assertDecimal(value.quantity, "Quote.quantity", true);
      assertTimestamp(value.expiresAt, "Quote.expiresAt");
      break;
    case "Candle":
      assertID(value.marketId, "Candle.marketId");
      assert(typeof value.interval === "string" && /^(1m|5m|15m|30m|1h|4h|1d|1w)$/.test(value.interval), ERROR_CODES.INVALID_REQUEST, "Candle.interval is invalid");
      assertTimestamp(value.openTime, "Candle.openTime");
      assertTimestamp(value.closeTime, "Candle.closeTime");
      assert(Date.parse(value.closeTime) > Date.parse(value.openTime), ERROR_CODES.INVALID_REQUEST, "Candle.closeTime must follow openTime");
      for (const field of ["open", "high", "low", "close", "baseVolume"]) assertDecimal(value[field], `Candle.${field}`);
      break;
    case "Order":
      assertID(value.orderId, "Order.orderId");
      assertID(value.accountId, "Order.accountId");
      assertID(value.marketId, "Order.marketId");
      assert(["buy", "sell"].includes(value.side), ERROR_CODES.INVALID_REQUEST, "Order.side is invalid");
      assert(["limit", "market", "stop", "trigger"].includes(value.orderType), ERROR_CODES.INVALID_REQUEST, "Order.orderType is invalid");
      assertDecimal(value.quantity, "Order.quantity", true);
      assert(ORDER_STATUSES.includes(value.status), ERROR_CODES.INVALID_REQUEST, "Order.status is invalid");
      assertID(value.idempotencyKey, "Order.idempotencyKey");
      break;
    case "Trade":
      assertID(value.tradeId, "Trade.tradeId");
      assertID(value.marketId, "Trade.marketId");
      assertDecimal(value.price, "Trade.price", true);
      assertDecimal(value.quantity, "Trade.quantity", true);
      assertTimestamp(value.executedAt, "Trade.executedAt");
      break;
    case "Position":
      assertID(value.positionId, "Position.positionId");
      assertID(value.accountId, "Position.accountId");
      assertID(value.marketId, "Position.marketId");
      assertDecimal(value.quantity, "Position.quantity");
      assertDecimal(value.entryPrice, "Position.entryPrice");
      break;
    case "Portfolio":
      assertID(value.portfolioId, "Portfolio.portfolioId");
      assertID(value.accountId, "Portfolio.accountId");
      assertID(value.valuationAssetId, "Portfolio.valuationAssetId");
      assertDecimal(value.totalValue, "Portfolio.totalValue");
      assert(Array.isArray(value.holdings), ERROR_CODES.INVALID_REQUEST, "Portfolio.holdings is invalid");
      break;
    case "LiquidityPool":
      assertID(value.poolId, "LiquidityPool.poolId");
      assertID(value.venue, "LiquidityPool.venue");
      assertStringArray(value.assetIds, "LiquidityPool.assetIds", 2);
      assert(Array.isArray(value.reserves) && value.reserves.length === value.assetIds.length, ERROR_CODES.INVALID_REQUEST, "LiquidityPool.reserves is invalid");
      value.reserves.forEach((reserve) => assertDecimal(reserve, "LiquidityPool.reserve"));
      assertInteger(value.feeBps, "LiquidityPool.feeBps", 0, 10_000);
      assertDecimal(value.totalLpShares, "LiquidityPool.totalLpShares");
      break;
    case "Strategy":
      assertID(value.strategyId, "Strategy.strategyId");
      assertID(value.ownerAccountId, "Strategy.ownerAccountId");
      assert(typeof value.strategyVersion === "string" && value.strategyVersion.length > 0 && value.strategyVersion.length <= 128, ERROR_CODES.INVALID_REQUEST, "Strategy.strategyVersion is invalid");
      assert(["draft", "paper", "testnet", "paused", "stopped", "completed"].includes(value.lifecycle), ERROR_CODES.INVALID_REQUEST, "Strategy.lifecycle is invalid");
      assertStringArray(value.venueAdapters, "Strategy.venueAdapters");
      assertID(value.riskLimitId, "Strategy.riskLimitId");
      break;
    case "RiskLimit":
      assertID(value.riskLimitId, "RiskLimit.riskLimitId");
      assertID(value.ownerAccountId, "RiskLimit.ownerAccountId");
      assertDecimal(value.maxNotional, "RiskLimit.maxNotional");
      assertDecimal(value.maxOrderNotional, "RiskLimit.maxOrderNotional");
      assertInteger(value.maxSlippageBps, "RiskLimit.maxSlippageBps", 0, 10_000);
      assertTimestamp(value.expiresAt, "RiskLimit.expiresAt");
      assert(typeof value.killSwitch === "boolean", ERROR_CODES.INVALID_REQUEST, "RiskLimit.killSwitch is invalid");
      break;
  }
  return value;
}

// Product APIs may use this envelope for a source-bound financial read. It is
// deliberately not a Data Fabric event format and contains no mutation grant.
export function validateReadEnvelope(value) {
  assert(isRecord(value), ERROR_CODES.INVALID_REQUEST, "read envelope must be an object");
  assert(value.schemaVersion === FINANCE_READ_ENVELOPE_VERSION, ERROR_CODES.INVALID_REQUEST, "read envelope schemaVersion is invalid");
  assert(MODEL_KINDS.includes(value.kind), ERROR_CODES.INVALID_REQUEST, "read envelope kind is invalid");
  assertID(value.requestId, "read envelope requestId");
  assert(value.readOnly === true, ERROR_CODES.FORBIDDEN, "read envelope must be read-only");
  assert(Array.isArray(value.capabilities) && value.capabilities.length > 0 && value.capabilities.every((capability) => capability === "read"), ERROR_CODES.FORBIDDEN, "read envelope capabilities are invalid");
  validateModel(value.kind, value.data);
  assert(value.sourceStatus === value.data.source.status, ERROR_CODES.INVALID_REQUEST, "read envelope sourceStatus must match model provenance");
  if (value.cursor !== undefined) assertID(value.cursor, "read envelope cursor");
  return value;
}

// WebSocket/SSE messages carry only a source-bound read model. They never
// authorize an order, signature, strategy lifecycle transition, or transfer.
export function validateStreamEnvelope(value) {
  assert(isRecord(value), ERROR_CODES.INVALID_REQUEST, "stream envelope must be an object");
  assert(value.schemaVersion === FINANCE_STREAM_ENVELOPE_VERSION, ERROR_CODES.INVALID_REQUEST, "stream envelope schemaVersion is invalid");
  assert(["snapshot", "upsert", "reconciled"].includes(value.event), ERROR_CODES.INVALID_REQUEST, "stream envelope event is invalid");
  assertID(value.eventId, "stream envelope eventId");
  assertID(value.requestId, "stream envelope requestId");
  assertInteger(value.sequence, "stream envelope sequence", 0, Number.MAX_SAFE_INTEGER);
  assertTimestamp(value.emittedAt, "stream envelope emittedAt");
  assert(value.readOnly === true, ERROR_CODES.FORBIDDEN, "stream envelope must be read-only");
  assert(MODEL_KINDS.includes(value.kind), ERROR_CODES.INVALID_REQUEST, "stream envelope kind is invalid");
  validateModel(value.kind, value.data);
  assert(value.sourceStatus === value.data.source.status, ERROR_CODES.INVALID_REQUEST, "stream envelope sourceStatus must match model provenance");
  if (value.cursor !== undefined) assertID(value.cursor, "stream envelope cursor");
  return value;
}

export function createError({ code, message, requestId, retryable = false, details = undefined }) {
  assert(Object.values(ERROR_CODES).includes(code), ERROR_CODES.INVALID_REQUEST, "unknown finance error code");
  assert(typeof message === "string" && message.length > 0 && message.length <= 500, ERROR_CODES.INVALID_REQUEST, "error message is invalid");
  assert(typeof requestId === "string" && idPattern.test(requestId), ERROR_CODES.INVALID_REQUEST, "requestId is invalid");
  return Object.freeze({
    schemaVersion: FINANCE_DOMAIN_VERSION,
    error: Object.freeze({ code, message, requestId, retryable: Boolean(retryable), ...(details === undefined ? {} : { details }) }),
  });
}

export function validateWriteHeaders(headers) {
  assert(isRecord(headers), ERROR_CODES.INVALID_REQUEST, "headers must be an object");
  assert(typeof headers.requestId === "string" && idPattern.test(headers.requestId), ERROR_CODES.INVALID_REQUEST, "requestId is invalid");
  assert(typeof headers.idempotencyKey === "string" && idPattern.test(headers.idempotencyKey), ERROR_CODES.INVALID_REQUEST, "idempotencyKey is invalid");
  assert(typeof headers.expectedVersion === "string" && idPattern.test(headers.expectedVersion), ERROR_CODES.INVALID_REQUEST, "expectedVersion is invalid");
  return headers;
}

// This is a pure boundary check. Product services must persist the
// idempotency record and the resulting state transition atomically with the
// effect; this package neither stores nor claims an action outcome.
export function evaluateWritePrecondition({ headers, currentVersion, requestDigest, idempotencyRecord = undefined }) {
  validateWriteHeaders(headers);
  assertID(currentVersion, "currentVersion");
  assert(typeof requestDigest === "string" && sha256Pattern.test(requestDigest), ERROR_CODES.INVALID_REQUEST, "requestDigest must be a lowercase SHA-256 hex digest");

  if (idempotencyRecord !== undefined) {
    assert(isRecord(idempotencyRecord), ERROR_CODES.INVALID_REQUEST, "idempotencyRecord must be an object");
    assertID(idempotencyRecord.idempotencyKey, "idempotencyRecord.idempotencyKey");
    assert(typeof idempotencyRecord.requestDigest === "string" && sha256Pattern.test(idempotencyRecord.requestDigest), ERROR_CODES.INVALID_REQUEST, "idempotencyRecord.requestDigest is invalid");
    assertID(idempotencyRecord.resourceVersion, "idempotencyRecord.resourceVersion");
    assert(["accepted", "rejected", "execution_unknown"].includes(idempotencyRecord.outcome), ERROR_CODES.INVALID_REQUEST, "idempotencyRecord.outcome is invalid");
    assert(idempotencyRecord.idempotencyKey === headers.idempotencyKey, ERROR_CODES.IDEMPOTENCY_CONFLICT, "idempotency record key does not match request");
    assert(idempotencyRecord.requestDigest === requestDigest, ERROR_CODES.IDEMPOTENCY_CONFLICT, "idempotency key was already used for a different request");
    return Object.freeze({ action: "replay", outcome: idempotencyRecord.outcome, resourceVersion: idempotencyRecord.resourceVersion });
  }

  assert(headers.expectedVersion === currentVersion, ERROR_CODES.CONCURRENT_MODIFICATION, "expectedVersion does not match currentVersion");
  return Object.freeze({ action: "create", expectedVersion: currentVersion });
}

export function assertOrderTransition(fromStatus, toStatus) {
  assert(ORDER_STATUSES.includes(fromStatus), ERROR_CODES.INVALID_REQUEST, "fromStatus is invalid");
  assert(ORDER_STATUSES.includes(toStatus), ERROR_CODES.INVALID_REQUEST, "toStatus is invalid");
  assert(orderTransitions[fromStatus].includes(toStatus), ERROR_CODES.CONCURRENT_MODIFICATION, `order transition ${fromStatus} -> ${toStatus} is not allowed`);
  return toStatus;
}

// A product must invoke this before it persists or submits a Quant/Exchange/DEX
// strategy action. It is an authorization guard only: it cannot start a
// strategy, sign, transfer, or submit an order.
export function assertStrategyRiskAuthorization({ strategy, riskLimit, requestedNotional, requestedSlippageBps, evaluatedAt, maxRiskSourceAgeMs }) {
  validateModel("Strategy", strategy);
  validateModel("RiskLimit", riskLimit);
  assert(strategy.ownerAccountId === riskLimit.ownerAccountId, ERROR_CODES.FORBIDDEN, "strategy and risk limit owners must match");
  assert(["paper", "testnet"].includes(strategy.lifecycle), ERROR_CODES.FORBIDDEN, "strategy lifecycle is not executable");
  assert(strategy.source.status === "live", ERROR_CODES.SOURCE_STALE, "strategy source is not live");
  assert(riskLimit.source.status === "live", ERROR_CODES.SOURCE_STALE, "risk limit source is not live");
  assert(["authoritative", "verified-index", "testnet"].includes(strategy.source.classification), ERROR_CODES.SOURCE_STALE, "strategy source is not execution-authoritative");
  assert(["authoritative", "verified-index", "testnet"].includes(riskLimit.source.classification), ERROR_CODES.SOURCE_STALE, "risk limit source is not execution-authoritative");
  assert(riskLimit.killSwitch === false, ERROR_CODES.RISK_REJECTED, "risk kill switch is enabled");
  assertTimestamp(evaluatedAt, "evaluatedAt");
  assertInteger(maxRiskSourceAgeMs, "maxRiskSourceAgeMs", 1, 86_400_000);
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const newestRiskInputMs = Math.max(Date.parse(strategy.source.asOf), Date.parse(riskLimit.source.asOf));
  assert(newestRiskInputMs <= evaluatedAtMs, ERROR_CODES.SOURCE_STALE, "risk input source time is ahead of evaluation time");
  assert(evaluatedAtMs - newestRiskInputMs <= maxRiskSourceAgeMs, ERROR_CODES.SOURCE_STALE, "risk input source exceeds the configured freshness window");
  assert(Date.parse(evaluatedAt) < Date.parse(riskLimit.expiresAt), ERROR_CODES.RISK_REJECTED, "risk limit has expired");
  assertDecimal(requestedNotional, "requestedNotional", true);
  assertInteger(requestedSlippageBps, "requestedSlippageBps", 0, 10_000);
  assert(compareDecimal(requestedNotional, riskLimit.maxNotional) <= 0, ERROR_CODES.RISK_REJECTED, "requested notional exceeds maxNotional");
  assert(compareDecimal(requestedNotional, riskLimit.maxOrderNotional) <= 0, ERROR_CODES.RISK_REJECTED, "requested notional exceeds maxOrderNotional");
  assert(requestedSlippageBps <= riskLimit.maxSlippageBps, ERROR_CODES.RISK_REJECTED, "requested slippage exceeds maxSlippageBps");
  return Object.freeze({ ownerAccountId: strategy.ownerAccountId, strategyId: strategy.strategyId, riskLimitId: riskLimit.riskLimitId, evaluatedAt });
}
