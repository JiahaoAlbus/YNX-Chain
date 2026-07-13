const DEFAULT_TIMEOUT_MS = 10_000;

export class YNXSDKError extends Error {
  constructor(message, {cause, status, code} = {}) {
    super(message, {cause});
    this.name = "YNXSDKError";
    this.status = status;
    this.code = code;
  }
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

export const ynxTestnet = Object.freeze({
  chainId: "0x1917",
  chainIdDecimal: 6423,
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({name: "YNXT", symbol: "YNXT", decimals: 18}),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
  restUrls: Object.freeze(["https://rpc.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});
