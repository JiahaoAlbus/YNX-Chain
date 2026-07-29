const DEFAULT_TIMEOUT_MS = 10_000;
const YNX_ADDRESS_HRP = "ynx";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_REVERSE = Object.freeze(Object.fromEntries([...BECH32_CHARSET].map((character, index) => [character, index])));

export {ynxTestnet} from "./ynx-testnet.js";
export {YNXWalletError, ensureYNXTestnet, ynxTestnetAddEthereumChainParameter} from "./wallet.js";
export {createStrategyMandate, createUserOperation, sessionScope, userOperationDigest} from "./primitives.js";

export class YNXSDKError extends Error {
  constructor(message, {cause, status, code} = {}) {
    super(message, {cause});
    this.name = "YNXSDKError";
    this.status = status;
    this.code = code;
  }
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

async function requestJSON(url, {body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch} = {}) {
  if (typeof fetchImpl !== "function") throw new YNXSDKError("fetch is not available");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new YNXSDKError("timeoutMs must be a positive integer");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
      throw new YNXSDKError(`YNX endpoint returned invalid JSON (${response.status})`, {cause, status: response.status});
    }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.message || response.statusText;
      throw new YNXSDKError(`YNX endpoint failed (${response.status}): ${detail}`, {status: response.status});
    }
    return data;
  } catch (cause) {
    if (cause instanceof YNXSDKError) throw cause;
    if (cause?.name === "AbortError") throw new YNXSDKError(`YNX endpoint timed out after ${timeoutMs}ms`, {cause});
    throw new YNXSDKError(`YNX endpoint request failed: ${cause?.message || cause}`, {cause});
  } finally {
    clearTimeout(timeout);
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
  if (response?.jsonrpc !== "2.0" || response?.id !== id) {
    throw new YNXSDKError("YNX EVM returned a mismatched JSON-RPC response");
  }
  if (response.error) {
    throw new YNXSDKError(`YNX EVM error ${response.error.code}: ${response.error.message}`, {code: response.error.code});
  }
  if (!("result" in response)) throw new YNXSDKError("YNX EVM response is missing result");
  return response.result;
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
  constructor({restUrl, evmUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch}) {
    this.restUrl = endpoint(restUrl).toString();
    this.evmUrl = endpoint(evmUrl).toString();
    this.options = {timeoutMs, fetchImpl};
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
