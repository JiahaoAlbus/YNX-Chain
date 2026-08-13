export const FINANCE_DOMAIN_VERSION = "ynx-finance-domain-v1";

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

export function validateSource(source) {
  assert(isRecord(source), ERROR_CODES.INVALID_REQUEST, "source must be an object");
  assert(typeof source.owner === "string" && idPattern.test(source.owner), ERROR_CODES.INVALID_REQUEST, "source.owner is invalid");
  assert(typeof source.system === "string" && idPattern.test(source.system), ERROR_CODES.INVALID_REQUEST, "source.system is invalid");
  assert(typeof source.version === "string" && source.version.length <= 128, ERROR_CODES.INVALID_REQUEST, "source.version is invalid");
  assert(typeof source.asOf === "string" && Number.isFinite(Date.parse(source.asOf)), ERROR_CODES.INVALID_REQUEST, "source.asOf is invalid");
  assert(["authoritative", "verified-index", "reference", "testnet"].includes(source.classification), ERROR_CODES.INVALID_REQUEST, "source.classification is invalid");
  assert(["live", "stale", "unavailable", "partial"].includes(source.status), ERROR_CODES.INVALID_REQUEST, "source.status is invalid");
  return source;
}

export function validateDecimal(value, field = "value") {
  assert(typeof value === "string" && decimalPattern.test(value), ERROR_CODES.INVALID_REQUEST, `${field} must be a non-negative base-10 string`);
  return value;
}

export function validateModel(kind, value) {
  assert(MODEL_KINDS.includes(kind), ERROR_CODES.INVALID_REQUEST, "unknown finance model kind");
  assert(isRecord(value), ERROR_CODES.INVALID_REQUEST, `${kind} must be an object`);
  assert(value.schemaVersion === FINANCE_DOMAIN_VERSION, ERROR_CODES.INVALID_REQUEST, `${kind}.schemaVersion is invalid`);
  validateSource(value.source);
  for (const field of requiredByKind[kind]) {
    assert(Object.hasOwn(value, field) && value[field] !== undefined && value[field] !== null, ERROR_CODES.INVALID_REQUEST, `${kind}.${field} is required`);
  }
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
