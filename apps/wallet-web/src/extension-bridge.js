import {DURABILITY_MODEL,parseTransactionDurability} from "./extension-durability.js";
export const BRIDGE_VERSION = 1;
export const PAGE_REQUEST = "YNX_PAGE_REQUEST_V1";
export const PAGE_RESPONSE = "YNX_PAGE_RESPONSE_V1";
export const PAGE_EVENT = "YNX_PAGE_EVENT_V1";
export const RUNTIME_REQUEST = "YNX_DAPP_REQUEST_V1";
export const RUNTIME_EVENT = "YNX_DAPP_EVENT_V1";
export const RUNTIME_DOCUMENT_PROBE = "YNX_DAPP_DOCUMENT_PROBE_V1";
export const REQUEST_TIMEOUT_MS = 120000;

export const REQUEST_METHODS = Object.freeze([
  "eth_chainId", "eth_accounts", "eth_requestAccounts", "wallet_getPermissions", "wallet_requestPermissions",
  "wallet_addEthereumChain", "wallet_switchEthereumChain", "wallet_revokePermissions", "personal_sign",
  "eth_signTypedData_v4", "eth_sendTransaction", "ynx_disconnect",
  "ynx_getDurabilityModel","ynx_getTransactionDurability","ynx_getFeeModel","ynx_getBalanceDetails","eth_blockNumber","eth_call","eth_estimateGas","eth_gasPrice","eth_getBalance","eth_getBlockByHash","eth_getBlockByNumber","eth_getCode","eth_getLogs","eth_getStorageAt","eth_getTransactionByHash","eth_getTransactionCount","eth_getTransactionReceipt","eth_maxPriorityFeePerGas","net_version","web3_clientVersion",
]);
export const PROVIDER_EVENTS = Object.freeze(["connect","accountsChanged", "chainChanged", "disconnect"]);

const REQUEST_ID = /^ynx-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function validHttpOrigin(origin) {
  try { const url = new URL(origin); return url.origin === origin && ["http:", "https:"].includes(url.protocol); }
  catch { return false; }
}
export function validRequestId(requestId) { return typeof requestId === "string" && REQUEST_ID.test(requestId); }
export function validDocumentNonce(value) { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value); }
export function validBrowserDocumentId(value,{firefox=false}={}) {
  // Chromium serializes an UnguessableToken as 32 hex characters. Firefox 153+
  // formats its keyed document identifier as a 36-character bracketless UUID.
  // Keep the browser-owned bytes unchanged; neither format authenticates a page.
  return typeof value === "string" && (firefox
    ? /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
    : /^[0-9a-f]{32}$/iu.test(value) && value !== "0".repeat(32));
}
export function documentMessageTarget(lease) {
  const firefox=lease.browserContext?.startsWith("firefox-")===true;
  // Firefox 140 has no documentId. Its frame-0 activation still needs the exact
  // fresh content nonce. An invalid supplied ID must never become frame-only.
  if(firefox&&lease.documentId===undefined)return {frameId:0};
  if(!validBrowserDocumentId(lease.documentId,{firefox}))throw Object.assign(new Error("The requesting browser document identity is invalid."),{code:"DOCUMENT_CHANGED"});
  return {frameId:0,documentId:lease.documentId};
}
export async function readCurrentDappDocument(api,lease,{cryptoImpl=globalThis.crypto,timeoutMs=2000}={}) {
  const fail=()=>Object.assign(new Error("The requesting page is no longer active. Reload the DApp and start a new request."),{code:"DOCUMENT_CHANGED"});
  if(!Number.isInteger(lease.tabId)||lease.tabId<0||!validHttpOrigin(lease.origin))throw fail();
  const challenge=Array.from(cryptoImpl.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,"0")).join("");
  let timer;
  try {
    const result=await Promise.race([api.tabs.sendMessage(lease.tabId,{type:RUNTIME_DOCUMENT_PROBE,version:BRIDGE_VERSION,origin:lease.origin,challenge},documentMessageTarget(lease)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail()),timeoutMs)})]);
    if(!result||typeof result!=="object"||Array.isArray(result)||Object.keys(result).sort().join(",")!=="challenge,documentNonce,origin,version"||result.version!==BRIDGE_VERSION||result.origin!==lease.origin||result.challenge!==challenge||!validDocumentNonce(result.documentNonce))throw fail();
    return result.documentNonce;
  } catch { throw fail(); }
  finally { clearTimeout(timer); }
}
export function validatePageRequest(data, eventOrigin) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (!Object.keys(data).every((key) => ["type", "version", "requestId", "origin", "method", "params"].includes(key))) return false;
  return data.type === PAGE_REQUEST && data.version === BRIDGE_VERSION && validRequestId(data.requestId) &&
    validHttpOrigin(data.origin) && data.origin === eventOrigin && REQUEST_METHODS.includes(data.method) &&
    (data.params === undefined || Array.isArray(data.params));
}
export function validateRuntimeRequest(message, senderUrl) {
  let senderOrigin; try { senderOrigin = new URL(senderUrl).origin; } catch { return false; }
  if (!message || !Object.keys(message).every((key) => ["type", "version", "requestId", "origin", "method", "params", "deadlineAt", "documentNonce"].includes(key))||!validDocumentNonce(message.documentNonce)) return false;
  const pageRequest={type:PAGE_REQUEST,version:message.version,requestId:message.requestId,origin:message.origin,method:message.method,params:message.params};
  return message.type === RUNTIME_REQUEST && validatePageRequest(pageRequest, senderOrigin) && Number.isSafeInteger(message.deadlineAt) && message.deadlineAt > Date.now() && message.deadlineAt <= Date.now()+REQUEST_TIMEOUT_MS+1000;
}
export function publicBridgeError(error) {
  const code = typeof error?.code === "number" || typeof error?.code === "string" ? error.code : "PROVIDER_REQUEST_FAILED";
  const message = typeof error?.message === "string" && error.message.length <= 240 ? error.message : "Wallet request failed closed.";
  // Only public recovery fields cross the page boundary; never raw signed bytes.
  const data=error?.data,publicData={};
  if(typeof data?.status==="string"&&/^[a-z_]{1,64}$/u.test(data.status))publicData.status=data.status;
  if(typeof data?.transactionHash==="string"&&/^0x[0-9a-fA-F]{64}$/u.test(data.transactionHash))publicData.transactionHash=data.transactionHash.toLowerCase();
  if(data?.durabilityVersion===DURABILITY_MODEL.version&&((code===-32002&&data.status==="transaction_durability_uncertain")||(code===-32004&&data.status==="transaction_durability_unavailable"))){
    try{const proof=parseTransactionDurability(data.ynxDurability,data.transactionHash);if(proof.status===(code===-32002?"uncertain":"memory_only")){publicData.durabilityVersion=DURABILITY_MODEL.version;publicData.ynxDurability=proof}}catch{/* Keep public hash/status; malformed inner evidence grants no authority. */}
  }
  if(code===-32004&&data?.status==="native_block_projection_unsupported"){
    for(const key of["blockNumber","feeEquivalentGas","projectionGasLimit"])if(typeof data[key]==="string"&&/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(data[key]))publicData[key]=data[key];
    if(typeof data.blockHash==="string"&&/^0x[0-9a-fA-F]{64}$/u.test(data.blockHash))publicData.blockHash=data.blockHash;
    if(data.gasSemantics==="native fixed-fee accounting; no EVM block gas scheduling")publicData.gasSemantics=data.gasSemantics;
    if(typeof data.nativeBlockPath==="string"&&/^\/blocks\/(?:0|[1-9][0-9]{0,19})$/u.test(data.nativeBlockPath))publicData.nativeBlockPath=data.nativeBlockPath;
  }
  return Object.freeze({code,message,...(Object.keys(publicData).length?{data:Object.freeze(publicData)}:{})});
}
