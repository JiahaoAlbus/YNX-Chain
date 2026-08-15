import {PUBLIC_ENDPOINT_BINDING} from "./public-endpoint-consumer.js";

export const YNX_RPC_URL = PUBLIC_ENDPOINT_BINDING.rpcUrl;
export const YNX_CHAIN_ID = "0x1917";
export const RPC_TIMEOUT_MS = 12000;
export const RPC_REQUEST_ID = 6423;

function rpcFailure(code, message, cause) {
  throw Object.assign(new Error(message), {code, cause});
}

export async function verifyExtensionRpc(fetcher = globalThis.fetch, url = YNX_RPC_URL) {
  if (typeof fetcher !== "function" || url !== YNX_RPC_URL) rpcFailure("RPC_UNAVAILABLE", "YNX Testnet RPC verification is unavailable.");
  const controller = new AbortController();
  let response, timer;
  try {
    const request = fetcher(url, {
      method: "POST",
      headers: {"content-type": "application/json", accept: "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: RPC_REQUEST_ID, method: "eth_chainId", params: []}),
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
  const body = await response.json().catch(() => null);
  if (!body || body.jsonrpc !== "2.0" || body.id !== RPC_REQUEST_ID || Object.hasOwn(body, "error")) rpcFailure("INVALID_RPC_RESPONSE", "RPC returned an invalid JSON-RPC envelope.");
  if (body.result !== YNX_CHAIN_ID) rpcFailure("WRONG_NETWORK", "RPC did not prove YNX Testnet chain 6423.");
  return Object.freeze({chainId: body.result, source: url, responseValidated: true});
}
