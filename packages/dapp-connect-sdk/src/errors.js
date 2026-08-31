const EIP1193_CODES = new Map([
  [4001, "WALLET_USER_REJECTED"], [4100, "WALLET_UNAUTHORIZED"], [4200, "WALLET_UNSUPPORTED_METHOD"],
  [4900, "WALLET_DISCONNECTED"], [4901, "WALLET_CHAIN_DISCONNECTED"]
]);

const PROTOCOL_CODES = new Set(["UNKNOWN_OR_MISSING_FIELD", "NON_CANONICAL_JSON", "INVALID_JSON", "INVALID_FIELD", "INVALID_PROOF_HEADER"]);
const DEVICE_CODES = new Set(["INVALID_DEVICE_PROOF", "INVALID_DEVICE_KEY", "DEVICE_MISMATCH", "SESSION_BINDING_MISMATCH"]);
const EXPIRY_CODES = new Set(["EXPIRED", "INVALID_EXPIRY", "INVALID_TIME", "ISSUED_IN_FUTURE"]);
const GATEWAY_STATUSES = new Set([502, 503, 504]);

export class DAppConnectError extends Error {
  constructor(code, message, {cause, requestId, traceId, errorId, details} = {}) {
    super(message, {cause});
    this.name = "DAppConnectError";
    this.code = code;
    this.requestId = requestId;
    this.traceId = traceId;
    this.errorId = errorId;
    this.details = details;
  }
}

export function classifyWalletError(error) {
  const status = Number(error?.status ?? error?.response?.status);
  const serverCode = error?.code ?? error?.response?.data?.code;
  const correlation = {requestId: error?.requestId ?? error?.response?.headers?.["x-request-id"], traceId: error?.traceId ?? error?.response?.headers?.["x-trace-id"], errorId: error?.errorId ?? error?.response?.headers?.["x-error-id"]};
  if (EIP1193_CODES.has(Number(serverCode))) return new DAppConnectError(EIP1193_CODES.get(Number(serverCode)), error?.message || "Wallet request failed", {cause: error, ...correlation});
  if (DEVICE_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_DEVICE_PROOF_REJECTED", error?.message || "Product Session device proof was rejected", {cause: error, ...correlation});
  if (PROTOCOL_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_PROTOCOL_REJECTED", error?.message || "Product Session protocol was rejected", {cause: error, ...correlation});
  if (EXPIRY_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW", error?.message || "Product Session expired or clock is incorrect", {cause: error, ...correlation});
  if (GATEWAY_STATUSES.has(status) || error?.name === "AbortError" || error?.network === true) return new DAppConnectError("PRODUCT_SESSION_GATEWAY_UNREACHABLE", error?.message || "Product Session gateway is unreachable", {cause: error, ...correlation});
  return new DAppConnectError(serverCode || "WALLET_CONNECTION_FAILED", error?.message || "Wallet connection failed", {cause: error, ...correlation});
}

export function productSessionStateFromError(error) {
  const classified = error instanceof DAppConnectError ? error : classifyWalletError(error);
  return {state: "PRIVATE_SERVICE_DEGRADED", code: classified.code, requestId: classified.requestId, traceId: classified.traceId, errorId: classified.errorId};
}
