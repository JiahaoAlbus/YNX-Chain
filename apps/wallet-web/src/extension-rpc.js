export const YNX_RPC_URL = "https://evm.ynxweb4.com";
export const YNX_CHAIN_ID = "0x1917";
export const RPC_TIMEOUT_MS = 12000;
export const RPC_REQUEST_ID = 6423;
export const READ_ONLY_RPC_METHODS=Object.freeze([
  "eth_blockNumber","eth_call","eth_estimateGas","eth_gasPrice","eth_getBalance","eth_getBlockByHash","eth_getBlockByNumber","eth_getCode","eth_getLogs","eth_getStorageAt","eth_getTransactionByHash","eth_getTransactionCount","eth_getTransactionReceipt","eth_maxPriorityFeePerGas","net_version","web3_clientVersion",
]);
const RPC_BODY_LIMIT=2*1024*1024,PARAMS_LIMIT=64*1024;

function rpcFailure(code, message, cause) {
  throw Object.assign(new Error(message), {code, cause});
}

export async function verifyExtensionRpc(fetcher = globalThis.fetch, url = YNX_RPC_URL) {
  const result=await forwardExtensionRpc("eth_chainId",[],fetcher,url);
  if (result !== YNX_CHAIN_ID) rpcFailure("WRONG_NETWORK", "RPC did not prove YNX Testnet chain 6423.");
  return Object.freeze({chainId: result, source: url, responseValidated: true});
}

export async function forwardExtensionRpc(method,params=[],fetcher=globalThis.fetch,url=YNX_RPC_URL){
  if(typeof method!=="string"||!(method==="eth_chainId"||READ_ONLY_RPC_METHODS.includes(method)))rpcFailure(4200,"Unsupported YNX Wallet RPC method.");
  return exactRpcRequest(method,params,fetcher,url);
}

export async function broadcastExtensionTransaction(rawTransaction,fetcher=globalThis.fetch,url=YNX_RPC_URL){
  if(typeof rawTransaction!=="string"||!/^0x[0-9a-fA-F]+$/u.test(rawTransaction)||rawTransaction.length>262146)rpcFailure("INVALID_SIGNED_TRANSACTION","Signed YNX transaction is invalid.");
  const result=await exactRpcRequest("eth_sendRawTransaction",[rawTransaction],fetcher,url);
  if(typeof result!=="string"||!/^0x[0-9a-fA-F]{64}$/u.test(result))rpcFailure("INVALID_TRANSACTION_HASH","YNX Testnet RPC returned an invalid transaction hash.");return result.toLowerCase();
}

async function exactRpcRequest(method,params=[],fetcher=globalThis.fetch,url=YNX_RPC_URL){
  if(!Array.isArray(params)||JSON.stringify(params).length>PARAMS_LIMIT)rpcFailure("INVALID_RPC_PARAMS","YNX Wallet RPC parameters are invalid.");
  if (typeof fetcher !== "function" || url !== YNX_RPC_URL) rpcFailure("RPC_UNAVAILABLE", "YNX Testnet RPC is unavailable.");
  const controller = new AbortController();
  let response, timer;
  try {
    const request = fetcher(url, {
      method: "POST",
      headers: {"content-type": "application/json", accept: "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: RPC_REQUEST_ID, method, params}),
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
    });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("RPC deadline exceeded."), {name:"TimeoutError"})); }, RPC_TIMEOUT_MS); });
    response = await Promise.race([request, deadline]);
  } catch (error) {
    rpcFailure(error?.name === "TimeoutError" ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE", "YNX Testnet RPC is unavailable.", error);
  } finally { clearTimeout(timer); }
  if (!response?.ok) rpcFailure("RPC_UNAVAILABLE", `YNX Testnet RPC failed closed (${response?.status ?? "no status"}).`);
  let body=null;
  if(typeof response.text==="function"){
    const text=await response.text().catch(()=>null);if(typeof text!=="string"||text.length>RPC_BODY_LIMIT)rpcFailure("INVALID_RPC_RESPONSE","RPC returned an invalid JSON-RPC envelope.");
    try{body=JSON.parse(text)}catch{}
  }else body=await response.json().catch(() => null);
  if (!body || body.jsonrpc !== "2.0" || body.id !== RPC_REQUEST_ID || Object.hasOwn(body, "error")) rpcFailure("INVALID_RPC_RESPONSE", "RPC returned an invalid JSON-RPC envelope.");
  if(!Object.hasOwn(body,"result"))rpcFailure("INVALID_RPC_RESPONSE","RPC returned an invalid JSON-RPC envelope.");
  return body.result;
}
