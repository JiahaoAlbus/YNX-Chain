const CHAIN_ID = "ynx_6423-1";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const METHODS = new Set(["place_order", "cancel_order", "reduce_position", "rebalance", "settle"]);

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

function positiveInteger(value, name, {allowZero = false} = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new TypeError(`${name} must be a safe ${allowZero ? "non-negative" : "positive"} integer`);
  return value;
}

function normalizedSet(values, name) {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError(`${name} must be a non-empty array`);
  const normalized = [...new Set(values.map((value) => requiredString(value, name).toLowerCase()))].sort();
  if (normalized.length !== values.length) throw new TypeError(`${name} must not contain duplicates`);
  return normalized;
}

function isoTime(value, name) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${name} must be an ISO timestamp`);
  return date.toISOString();
}

export function createStrategyMandate(input) {
  const mandate = {
    schemaVersion: 1,
    chainId: CHAIN_ID,
    id: requiredString(input.id, "id"),
    owner: requiredString(input.owner, "owner"),
    engineIdentity: requiredString(input.engineIdentity, "engineIdentity"),
    strategyHash: requiredString(input.strategyHash, "strategyHash").toLowerCase(),
    strategyVersion: positiveInteger(input.strategyVersion, "strategyVersion"),
    venues: normalizedSet(input.venues, "venues"),
    assets: normalizedSet(input.assets, "assets"),
    markets: normalizedSet(input.markets, "markets"),
    methods: normalizedSet(input.methods, "methods"),
    capitalLimitYnxt: positiveInteger(input.capitalLimitYnxt, "capitalLimitYnxt"),
    positionLimitYnxt: positiveInteger(input.positionLimitYnxt, "positionLimitYnxt"),
    maxLeverageBps: positiveInteger(input.maxLeverageBps, "maxLeverageBps"),
    maxSlippageBps: positiveInteger(input.maxSlippageBps, "maxSlippageBps", {allowZero: true}),
    dailyLossLimitYnxt: positiveInteger(input.dailyLossLimitYnxt, "dailyLossLimitYnxt"),
    drawdownLimitBps: positiveInteger(input.drawdownLimitBps, "drawdownLimitBps", {allowZero: true}),
    validAfter: isoTime(input.validAfter, "validAfter"),
    expiresAt: isoTime(input.expiresAt, "expiresAt"),
    nonceDomain: requiredString(input.nonceDomain, "nonceDomain"),
    nextNonce: positiveInteger(input.nextNonce ?? 0, "nextNonce", {allowZero: true}),
    createdAt: isoTime(input.createdAt, "createdAt"),
  };
  if (!SHA256_HEX.test(mandate.strategyHash)) throw new TypeError("strategyHash must be lowercase SHA-256 hex");
  if (mandate.methods.some((method) => !METHODS.has(method))) throw new TypeError("methods contain a forbidden strategy capability");
  if (mandate.maxLeverageBps < 10_000 || mandate.maxLeverageBps > 1_000_000 || mandate.maxSlippageBps > 10_000 || mandate.drawdownLimitBps > 10_000) throw new TypeError("mandate basis-point limits are invalid");
  if (Date.parse(mandate.expiresAt) <= Date.parse(mandate.validAfter) || Date.parse(mandate.validAfter) < Date.parse(mandate.createdAt)) throw new TypeError("mandate validity window is invalid");
  return Object.freeze(mandate);
}

export function createUserOperation(input) {
  const calls = input.calls?.map((call) => ({
    target: requiredString(call.target, "call.target").toLowerCase(),
    method: requiredString(call.method, "call.method").toLowerCase(),
    valueYnxt: positiveInteger(call.valueYnxt ?? 0, "call.valueYnxt", {allowZero: true}),
    ...(call.asset ? {asset: requiredString(call.asset, "call.asset").toLowerCase()} : {}),
    payloadHash: requiredString(call.payloadHash, "call.payloadHash").toLowerCase(),
  }));
  if (!Array.isArray(calls) || calls.length === 0 || calls.some((call) => !SHA256_HEX.test(call.payloadHash))) throw new TypeError("calls must contain valid payload hashes");
  const operation = {
    version: 1,
    chainId: CHAIN_ID,
    account: requiredString(input.account, "account"),
    productId: requiredString(input.productId, "productId").toLowerCase(),
    nonceDomain: requiredString(input.nonceDomain, "nonceDomain"),
    nonce: positiveInteger(input.nonce ?? 0, "nonce", {allowZero: true}),
    calls,
    maxFeeYnxt: positiveInteger(input.maxFeeYnxt ?? 0, "maxFeeYnxt", {allowZero: true}),
    validAfter: isoTime(input.validAfter, "validAfter"),
    validUntil: isoTime(input.validUntil, "validUntil"),
    ...(input.sessionKeyId ? {sessionKeyId: requiredString(input.sessionKeyId, "sessionKeyId")} : {}),
    ...(input.paymasterPolicy ? {paymasterPolicy: requiredString(input.paymasterPolicy, "paymasterPolicy")} : {}),
  };
  if (Date.parse(operation.validUntil) <= Date.parse(operation.validAfter)) throw new TypeError("user operation validity window is invalid");
  return Object.freeze(operation);
}

export async function userOperationDigest(operation, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new TypeError("Web Crypto SHA-256 is required");
  const payload = new TextEncoder().encode(`YNX_USER_OPERATION_V1\0${JSON.stringify(operation)}`);
  return new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", payload));
}

export function sessionScope(call) {
  return `${requiredString(call.target, "call.target").toLowerCase()}:${requiredString(call.method, "call.method").toLowerCase()}`;
}
