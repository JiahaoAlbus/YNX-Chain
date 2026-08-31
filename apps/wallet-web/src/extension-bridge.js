export const BRIDGE_VERSION = 1;
export const PAGE_REQUEST = "YNX_PAGE_REQUEST_V1";
export const PAGE_RESPONSE = "YNX_PAGE_RESPONSE_V1";
export const PAGE_EVENT = "YNX_PAGE_EVENT_V1";
export const RUNTIME_REQUEST = "YNX_DAPP_REQUEST_V1";
export const RUNTIME_EVENT = "YNX_DAPP_EVENT_V1";
export const REQUEST_TIMEOUT_MS = 120000;

export const REQUEST_METHODS = Object.freeze([
  "eth_chainId", "eth_accounts", "eth_requestAccounts", "wallet_getPermissions", "wallet_requestPermissions",
  "wallet_addEthereumChain", "wallet_switchEthereumChain", "wallet_revokePermissions", "personal_sign",
  "eth_signTypedData_v4", "eth_sendTransaction", "ynx_disconnect",
  "eth_blockNumber","eth_call","eth_estimateGas","eth_gasPrice","eth_getBalance","eth_getBlockByHash","eth_getBlockByNumber","eth_getCode","eth_getLogs","eth_getStorageAt","eth_getTransactionByHash","eth_getTransactionCount","eth_getTransactionReceipt","eth_maxPriorityFeePerGas","net_version","web3_clientVersion",
]);
export const PROVIDER_EVENTS = Object.freeze(["connect","accountsChanged", "chainChanged", "disconnect"]);

const REQUEST_ID = /^ynx-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function validHttpOrigin(origin) {
  try { const url = new URL(origin); return url.origin === origin && ["http:", "https:"].includes(url.protocol); }
  catch { return false; }
}
export function validRequestId(requestId) { return typeof requestId === "string" && REQUEST_ID.test(requestId); }
export function validatePageRequest(data, eventOrigin) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (!Object.keys(data).every((key) => ["type", "version", "requestId", "origin", "method", "params"].includes(key))) return false;
  return data.type === PAGE_REQUEST && data.version === BRIDGE_VERSION && validRequestId(data.requestId) &&
    validHttpOrigin(data.origin) && data.origin === eventOrigin && REQUEST_METHODS.includes(data.method) &&
    (data.params === undefined || Array.isArray(data.params));
}
export function validateRuntimeRequest(message, senderUrl) {
  let senderOrigin; try { senderOrigin = new URL(senderUrl).origin; } catch { return false; }
  if (!message || !Object.keys(message).every((key) => ["type", "version", "requestId", "origin", "method", "params", "deadlineAt"].includes(key))) return false;
  const pageRequest={type:PAGE_REQUEST,version:message.version,requestId:message.requestId,origin:message.origin,method:message.method,params:message.params};
  return message.type === RUNTIME_REQUEST && validatePageRequest(pageRequest, senderOrigin) && Number.isSafeInteger(message.deadlineAt) && message.deadlineAt > Date.now() && message.deadlineAt <= Date.now()+REQUEST_TIMEOUT_MS+1000;
}
export function publicBridgeError(error) {
  const code = typeof error?.code === "number" || typeof error?.code === "string" ? error.code : "PROVIDER_REQUEST_FAILED";
  const message = typeof error?.message === "string" && error.message.length <= 240 ? error.message : "Wallet request failed closed.";
  return Object.freeze({code, message});
}
