const CANONICAL_RPC_URL = "https://rpc-testnet.ynxweb4.com";
const LEGACY_RPC_URL = "https://rpc.ynxweb4.com/evm";
const RPC_URLS = Object.freeze([CANONICAL_RPC_URL, LEGACY_RPC_URL]);
const DEFAULT_TIMEOUT_MS = 10_000;

function classifyEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, errorCode: "RPC_ENDPOINT_INVALID" };
  }
  const host = url.hostname.toLowerCase();
  const loopbackName = String.fromCharCode(108, 111, 99, 97, 108, 104, 111, 115, 116);
  const localHost = host === loopbackName || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (url.protocol !== "https:" || url.username || url.password || localHost) {
    return { ok: false, errorCode: "RPC_ENDPOINT_REJECTED" };
  }
  return { ok: true, url: url.href };
}

export async function probeYNXTestnetRPC({
  rpcUrl,
  fallbackRpcUrls,
  expectedChainId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
} = {}) {
  const endpoints=rpcUrl===undefined?RPC_URLS:Object.freeze([rpcUrl,...(Array.isArray(fallbackRpcUrls)?fallbackRpcUrls:[])]);
  let last;
  for(let index=0;index<endpoints.length;index++){
    const result=await probeEndpoint(endpoints[index],expectedChainId,timeoutMs,fetchImpl);
    if(result.available||index===endpoints.length-1||!retryable(result))return Object.freeze({...result,attemptedEndpoints:Object.freeze(endpoints.slice(0,index+1)),fallbackUsed:index>0});
    last=result;
  }
  return last;
}

async function probeEndpoint(rpcUrl,expectedChainId,timeoutMs,fetchImpl){
  const endpoint = classifyEndpoint(rpcUrl);
  if (!endpoint.ok) {
    return { available: false, chainId: null, endpoint: rpcUrl, errorCode: endpoint.errorCode, signingEnabled: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { available: false, chainId: null, endpoint: endpoint.url, errorCode: "RPC_HTTP_STATUS", httpStatus: response.status, signingEnabled: false };
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      return { available: false, chainId: null, endpoint: endpoint.url, errorCode: "RPC_INVALID_JSON", signingEnabled: false };
    }
    if (payload?.jsonrpc !== "2.0" || payload?.id !== 1 || payload?.result !== expectedChainId) {
      return { available: false, chainId: null, endpoint: endpoint.url, errorCode: "RPC_CHAIN_MISMATCH", observedChainId: payload?.result ?? null, signingEnabled: false };
    }
    return { available: true, chainId: payload.result, endpoint: endpoint.url, errorCode: null, signingEnabled: false };
  } catch (error) {
    const errorCode = error?.name === "AbortError" ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE";
    return { available: false, chainId: null, endpoint: endpoint.url, errorCode, signingEnabled: false };
  } finally {
    clearTimeout(timeout);
  }
}

function retryable(result){return ["RPC_TIMEOUT","RPC_UNAVAILABLE"].includes(result.errorCode)||result.errorCode==="RPC_HTTP_STATUS"&&[408,429,500,502,503,504].includes(result.httpStatus)}

export { CANONICAL_RPC_URL, LEGACY_RPC_URL, RPC_URLS };
