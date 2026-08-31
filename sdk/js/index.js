import {ynxTestnet} from "./ynx-testnet.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const YNX_ADDRESS_HRP = "ynx";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_REVERSE = Object.freeze(Object.fromEntries([...BECH32_CHARSET].map((character, index) => [character, index])));

export {ynxTestnet} from "./ynx-testnet.js";
export {YNXWalletError, ensureYNXTestnet, ynxTestnetAddEthereumChainParameter} from "./wallet.js";

export const ynxPublicEndpoints = Object.freeze({
  authorityCommit: "d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59",
  authoritySha256: "d344c607c2bbbf7bb0d9d3662b424976d0d6c4ff20428025dd1e2fb92bf31392",
  rpcUrl: "https://rpc.ynxweb4.com/evm",
  restUrl: "https://rest.ynxweb4.com",
  faucetUrl: "https://faucet.ynxweb4.com",
  websiteUrl: "https://www.ynxweb4.com/dapp/wallet",
  explorerUrl: "https://explorer.ynxweb4.com",
  walletCallbackUrl: null,
  allRequiredServicesAvailable: false,
  allRequiredServicesCorsReady: false,
  integratedCentral: false,
});

export const ynxNetworkConfig = Object.freeze({nativeChainId: "ynx_6423-1", chainIdDecimal: 6423, evmChainId: "0x1917", nativeCurrency: "YNXT"});

export class YNXSDKError extends Error {
  constructor(message, {cause, status, code, rpcCode} = {}) {
    super(message, {cause});
    this.name = "YNXSDKError";
    this.status = status;
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

export const ynxErrorCodes = Object.freeze({
  accountNotFound: "ACCOUNT_NOT_FOUND",
  httpError: "HTTP_ERROR",
  malformedResponse: "MALFORMED_RESPONSE",
  jsonRPCError: "JSON_RPC_ERROR",
  rpcUnavailable: "RPC_UNAVAILABLE",
  transportCancelled: "TRANSPORT_CANCELLED",
  transportTLS: "TRANSPORT_TLS",
  transportTimeout: "TRANSPORT_TIMEOUT",
  wrongChain: "WRONG_CHAIN",
});

const ERROR_DIAGNOSTICS = Object.freeze({
  [ynxErrorCodes.accountNotFound]: Object.freeze({summary: "The account was not found.", remediation: "VERIFY_ACCOUNT_AND_RETRY"}),
  [ynxErrorCodes.httpError]: Object.freeze({summary: "The endpoint rejected the request.", remediation: "CHECK_ENDPOINT_STATUS"}),
  [ynxErrorCodes.jsonRPCError]: Object.freeze({summary: "The RPC returned an application error.", remediation: "CHECK_RPC_METHOD_SUPPORT"}),
  [ynxErrorCodes.malformedResponse]: Object.freeze({summary: "The endpoint response was invalid.", remediation: "VERIFY_RPC_RESPONSE"}),
  [ynxErrorCodes.rpcUnavailable]: Object.freeze({summary: "The RPC service is unavailable.", remediation: "CHECK_NETWORK_AND_RETRY"}),
  [ynxErrorCodes.transportCancelled]: Object.freeze({summary: "The request was cancelled.", remediation: "RETRY_WHEN_READY"}),
  [ynxErrorCodes.transportTimeout]: Object.freeze({summary: "The request timed out.", remediation: "CHECK_NETWORK_AND_RETRY"}),
  [ynxErrorCodes.transportTLS]: Object.freeze({summary: "TLS validation failed.", remediation: "CHECK_SYSTEM_TIME_AND_CERTIFICATES"}),
  [ynxErrorCodes.wrongChain]: Object.freeze({summary: "The RPC is not YNX Testnet 6423 (0x1917).", remediation: "USE_YNX_TESTNET_6423"}),
});

export function ynxErrorDiagnostic(code) {
  return ERROR_DIAGNOSTICS[code] ?? Object.freeze({summary: "The request failed.", remediation: "CHECK_INPUT_AND_RETRY"});
}

export function redactYNXSDKError(error) {
  if (!(error instanceof YNXSDKError)) return Object.freeze({name: "YNXSDKError", code: "INTERNAL_ERROR"});
  const code = typeof error.code === "string" ? error.code : "INTERNAL_ERROR";
  const diagnostic = {name: error.name, code, ...ynxErrorDiagnostic(code)};
  if (Number.isInteger(error.status)) diagnostic.status = error.status;
  if (Number.isInteger(error.rpcCode)) diagnostic.rpcCode = error.rpcCode;
  return Object.freeze(diagnostic);
}

export function validateYNXTestnetConfig({nativeChainId, chainIdDecimal, evmChainId, nativeCurrency = "YNXT"} = {}) {
  if (nativeChainId !== "ynx_6423-1" || chainIdDecimal !== 6423 || evmChainId !== "0x1917" || nativeCurrency !== "YNXT") {
    throw new YNXSDKError("YNX network configuration must use ynx_6423-1 / 6423 / 0x1917 / YNXT", {code: ynxErrorCodes.wrongChain});
  }
  return Object.freeze({nativeChainId, chainIdDecimal, evmChainId, nativeCurrency});
}

export function classifyYNXHTTPFailure(status, data, {accountLookup = false} = {}) {
  if (!Number.isInteger(status) || status < 400 || status > 599) throw new YNXSDKError("HTTP failure status must be between 400 and 599");
  if (!accountLookup || status !== 404 || data === null || typeof data !== "object" || Array.isArray(data)) {
    return [502, 503, 504].includes(status) ? ynxErrorCodes.rpcUnavailable : ynxErrorCodes.httpError;
  }
  const code = data.code ?? data.error?.code;
  const message = data.message ?? data.error?.message ?? data.error;
  if (code === ynxErrorCodes.accountNotFound || (typeof message === "string" && /^account not found$/i.test(message.trim()))) return ynxErrorCodes.accountNotFound;
  return ynxErrorCodes.httpError;
}

function causeChain(cause) {
  const result = [];
  const seen = new Set();
  while (cause && (typeof cause === "object" || typeof cause === "function") && !seen.has(cause) && result.length < 8) {
    seen.add(cause);
    result.push(cause);
    cause = cause.cause;
  }
  return result;
}

function timeoutFailure(cause) {
  return causeChain(cause).some((item) => {
    const name = typeof item?.name === "string" ? item.name.toUpperCase() : "";
    const code = typeof item?.code === "string" ? item.code.toUpperCase() : "";
    const message = typeof item?.message === "string" ? item.message.toLowerCase() : "";
    return name === "ABORTERROR" || name === "TIMEOUTERROR" || code === "ETIMEDOUT" || code.includes("CONNECT_TIMEOUT") || message.includes("timed out") || message.includes("timeout");
  });
}

function tlsFailure(cause) {
  return causeChain(cause).some((item) => {
    const code = typeof item?.code === "string" ? item.code.toUpperCase() : "";
    const message = typeof item?.message === "string" ? item.message.toLowerCase() : "";
    return code.includes("TLS") || code.includes("CERT") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || message.includes("tls handshake") || message.includes("certificate");
  });
}

function convertAddressBits(data, fromBits, toBits, pad) {
  let accumulator = 0;
  let bits = 0;
  const result = [];
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new YNXSDKError("address payload value exceeds conversion bit width");
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  if (!pad && (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0)) {
    throw new YNXSDKError("address payload has invalid Bech32 padding");
  }
  return result;
}

function bech32HRPExpand(hrp) {
  return [...hrp].map((character) => character.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((character) => character.charCodeAt(0) & 31));
}

function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    generators.forEach((generator, index) => {
      if ((top >>> index) & 1) checksum = (checksum ^ generator) >>> 0;
    });
  }
  return checksum >>> 0;
}

function decodeHexAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value.trim())) {
    throw new YNXSDKError("account address must be 0x-prefixed with 40 hex characters");
  }
  const normalized = value.trim().slice(2).toLowerCase();
  return Array.from({length: 20}, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
}

export function toYNXAddress(value) {
  const payload = decodeHexAddress(toEVMAddress(value));
  const data = convertAddressBits(payload, 8, 5, true);
  const expanded = bech32HRPExpand(YNX_ADDRESS_HRP).concat(data, [0, 0, 0, 0, 0, 0]);
  const checksum = bech32Polymod(expanded) ^ 1;
  const checksumValues = Array.from({length: 6}, (_, index) => (checksum >>> (5 * (5 - index))) & 31);
  return `${YNX_ADDRESS_HRP}1${data.concat(checksumValues).map((item) => BECH32_CHARSET[item]).join("")}`;
}

export function toEVMAddress(value) {
  if (typeof value !== "string") throw new YNXSDKError("account address must be a string");
  value = value.trim();
  if (!value.toLowerCase().startsWith(`${YNX_ADDRESS_HRP}1`)) {
    return `0x${decodeHexAddress(value).map((item) => item.toString(16).padStart(2, "0")).join("")}`;
  }
  if (value.length > 90) throw new YNXSDKError("YNX address exceeds Bech32 maximum length");
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new YNXSDKError("YNX address must not mix uppercase and lowercase");
  }
  value = value.toLowerCase();
  const separator = value.lastIndexOf("1");
  if (separator <= 0 || separator + 7 > value.length) throw new YNXSDKError("YNX address has an invalid Bech32 separator or checksum length");
  if (value.slice(0, separator) !== YNX_ADDRESS_HRP) throw new YNXSDKError('YNX address HRP must be "ynx"');
  const data = [...value.slice(separator + 1)].map((character) => {
    const decoded = BECH32_REVERSE[character];
    if (decoded === undefined) throw new YNXSDKError("YNX address contains an invalid Bech32 character");
    return decoded;
  });
  if (bech32Polymod(bech32HRPExpand(YNX_ADDRESS_HRP).concat(data)) !== 1) {
    throw new YNXSDKError("YNX address checksum is invalid");
  }
  const payload = convertAddressBits(data.slice(0, -6), 5, 8, false);
  if (payload.length !== 20) throw new YNXSDKError("YNX address payload must be 20 bytes");
  return `0x${payload.map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeYNXAddress(value) {
  const evmAddress = toEVMAddress(value);
  return Object.freeze({evmAddress, ynxAddress: toYNXAddress(evmAddress)});
}

function endpoint(baseUrl, path = "") {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new YNXSDKError(`unsupported endpoint protocol: ${url.protocol}`);
  }
  if (path) url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  return url;
}

async function requestJSON(url, {accountLookup = false, body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch, signal, network = ynxNetworkConfig} = {}) {
  validateYNXTestnetConfig(network);
  if (typeof fetchImpl !== "function") throw new YNXSDKError("fetch is not available");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new YNXSDKError("timeoutMs must be a positive integer");
  if (signal !== undefined && (typeof signal !== "object" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function" || typeof signal.aborted !== "boolean")) {
    throw new YNXSDKError("signal must be an AbortSignal");
  }
  if (signal?.aborted) throw new YNXSDKError("YNX endpoint request was cancelled", {code: ynxErrorCodes.transportCancelled});

  const controller = new AbortController();
  let abortCode = null;
  const cancel = () => {
    abortCode ??= ynxErrorCodes.transportCancelled;
    controller.abort();
  };
  signal?.addEventListener("abort", cancel, {once: true});
  const timeout = setTimeout(() => {
    abortCode ??= ynxErrorCodes.transportTimeout;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : {"content-type": "application/json"},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (cause) {
      throw new YNXSDKError(`YNX endpoint returned invalid JSON (${response.status})`, {cause, status: response.status, code: ynxErrorCodes.malformedResponse});
    }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.message || response.statusText;
      const code = classifyYNXHTTPFailure(response.status, data, {accountLookup});
      if (code === ynxErrorCodes.accountNotFound) {
        throw new YNXSDKError(`YNX account does not exist (${response.status})`, {status: response.status, code: ynxErrorCodes.accountNotFound});
      }
      throw new YNXSDKError(`YNX endpoint failed (${response.status}): ${detail}`, {status: response.status, code});
    }
    return data;
  } catch (cause) {
    if (cause instanceof YNXSDKError) throw cause;
    if (abortCode === ynxErrorCodes.transportCancelled) {
      throw new YNXSDKError("YNX endpoint request was cancelled", {cause, code: ynxErrorCodes.transportCancelled});
    }
    if (abortCode === ynxErrorCodes.transportTimeout) {
      throw new YNXSDKError(`YNX endpoint timed out after ${timeoutMs}ms`, {cause, code: ynxErrorCodes.transportTimeout});
    }
    if (timeoutFailure(cause)) {
      throw new YNXSDKError(`YNX endpoint timed out after ${timeoutMs}ms`, {cause, code: ynxErrorCodes.transportTimeout});
    }
    if (tlsFailure(cause)) throw new YNXSDKError("YNX endpoint TLS validation failed", {cause, code: ynxErrorCodes.transportTLS});
    throw new YNXSDKError(`YNX endpoint request failed: ${cause?.message || cause}`, {cause, code: ynxErrorCodes.rpcUnavailable});
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function getYNXStatus(baseUrl, options = {}) {
  return requestJSON(endpoint(baseUrl, "/status"), options);
}

export async function callYNXEVM(evmUrl, method, params = [], options = {}) {
  if (typeof method !== "string" || method.length === 0) throw new YNXSDKError("JSON-RPC method is required");
  if (!Array.isArray(params)) throw new YNXSDKError("JSON-RPC params must be an array");
  const id = options.id ?? 1;
  const response = await requestJSON(endpoint(evmUrl), {
    ...options,
    body: {jsonrpc: "2.0", id, method, params},
  });
  if (response === null || typeof response !== "object" || Array.isArray(response) || response.jsonrpc !== "2.0" || response.id !== id) {
    throw new YNXSDKError("YNX EVM returned a mismatched JSON-RPC response", {code: ynxErrorCodes.malformedResponse});
  }
  const keys = Object.keys(response).sort().join("\n");
  if ("error" in response) {
    if (keys !== "error\nid\njsonrpc" || response.error === null || typeof response.error !== "object" || Array.isArray(response.error) || !Number.isInteger(response.error.code) || typeof response.error.message !== "string" || response.error.message.length === 0) {
      throw new YNXSDKError("YNX EVM returned a malformed JSON-RPC error", {code: ynxErrorCodes.malformedResponse});
    }
    throw new YNXSDKError(`YNX EVM error ${response.error.code}: ${response.error.message}`, {code: ynxErrorCodes.jsonRPCError, rpcCode: response.error.code});
  }
  if (keys !== "id\njsonrpc\nresult") throw new YNXSDKError("YNX EVM response is malformed", {code: ynxErrorCodes.malformedResponse});
  return response.result;
}

export async function proveYNXTestnetRPC(evmUrl = ynxPublicEndpoints.rpcUrl, options = {}) {
  validateYNXTestnetConfig(options.network ?? ynxNetworkConfig);
  let url;
  try {
    url = new URL(evmUrl);
  } catch (cause) {
    throw new YNXSDKError("YNX Testnet RPC must be an absolute HTTPS URL", {cause, code: "RPC_HTTPS_REQUIRED"});
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new YNXSDKError("YNX Testnet RPC must be an absolute HTTPS URL without userinfo", {code: "RPC_HTTPS_REQUIRED"});
  }
  const chainId = await callYNXEVM(url.href, "eth_chainId", [], options);
  if (typeof chainId !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(chainId)) {
    throw new YNXSDKError("RPC returned a malformed eth_chainId result", {code: ynxErrorCodes.malformedResponse});
  }
  if (chainId !== ynxTestnet.chainId) {
    throw new YNXSDKError(`RPC did not prove YNX Testnet chain ${ynxTestnet.chainId}`, {code: ynxErrorCodes.wrongChain});
  }
  return Object.freeze({chainId, connected: true, network: ynxTestnet.chainName, rpc: url.href});
}

function parseHexQuantity(value, name) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new YNXSDKError(`${name} is not a canonical hex quantity`);
  }
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed)) throw new YNXSDKError(`${name} exceeds JavaScript safe integer range`);
  return parsed;
}

export class YNXClient {
  constructor({restUrl, evmUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch, network = ynxNetworkConfig}) {
    validateYNXTestnetConfig(network);
    this.restUrl = endpoint(restUrl).toString();
    this.evmUrl = endpoint(evmUrl).toString();
    this.options = {timeoutMs, fetchImpl, network};
  }

  getStatus() {
    return getYNXStatus(this.restUrl, this.options);
  }

  callEVM(method, params = []) {
    return callYNXEVM(this.evmUrl, method, params, this.options);
  }

  async getChainSnapshot() {
    const [status, evmChainId, evmBlockHex] = await Promise.all([
      this.getStatus(),
      this.callEVM("eth_chainId"),
      this.callEVM("eth_blockNumber"),
    ]);
    return {
      status,
      evmChainId,
      evmBlockHex,
      evmBlockNumber: parseHexQuantity(evmBlockHex, "eth_blockNumber"),
    };
  }
}

export function assertYNXTestnetSnapshot(snapshot, {maximumHeightLag = 30} = {}) {
  if (snapshot?.status?.chainId !== 6423) throw new YNXSDKError("REST chain ID is not 6423");
  if (snapshot.status.nativeCurrencySymbol !== "YNXT") throw new YNXSDKError("native currency symbol is not YNXT");
  if (snapshot.status.publicNetwork !== true) throw new YNXSDKError("REST endpoint is not marked as a public network");
  if (snapshot.evmChainId !== "0x1917") throw new YNXSDKError("EVM chain ID is not 0x1917");
  if (!Number.isInteger(snapshot.status.height) || snapshot.status.height < 0) throw new YNXSDKError("REST height is invalid");
  if (!Number.isInteger(snapshot.evmBlockNumber) || snapshot.evmBlockNumber < 0) throw new YNXSDKError("EVM height is invalid");
  if (Math.abs(snapshot.status.height - snapshot.evmBlockNumber) > maximumHeightLag) {
    throw new YNXSDKError(`REST/EVM height difference exceeds ${maximumHeightLag} blocks`);
  }
  return snapshot;
}
