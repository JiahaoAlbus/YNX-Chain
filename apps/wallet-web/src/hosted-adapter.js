/** Explicit first-party browser adapter. It does not install window.ethereum. */
import { HOSTED_CHAIN_ID, HOSTED_PROTOCOL, HOSTED_TIMEOUT_MS, HOSTED_WALLET_ORIGIN, HOSTED_WALLET_PATH, encodeHostedConnect, hostedEnvelope, randomHostedId, registeredProduct } from "./hosted-protocol.js";
import { validateYNXChainMutation } from "./extension-chain-params.js";

function failure(code) { return Object.assign(new Error(code), { code }); }
const CHAIN = Object.freeze({ chainId: HOSTED_CHAIN_ID, chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: ["https://rpc-testnet.ynxweb4.com", "https://evm.ynxweb4.com"], blockExplorerUrls: ["https://explorer.ynxweb4.com"] });

export function createHostedWalletAdapter({ window: browserWindow = globalThis.window, walletOrigin = HOSTED_WALLET_ORIGIN } = {}) {
  const origin = browserWindow.location.origin;
  if (!registeredProduct(origin) || walletOrigin !== HOSTED_WALLET_ORIGIN) throw failure("HOSTED_ORIGIN_UNREGISTERED");
  let popup = null, request = null, account = null, connected = false, monitor = null, lastPong = 0;
  const pending = new Map(), listeners = new Map(), seen = new Set();
  function emit(name, value) { for (const callback of listeners.get(name) ?? []) callback(value); }
  function close(code = "HOSTED_DISCONNECTED") {
    if (monitor) browserWindow.clearInterval(monitor);
    monitor = null; connected = false; account = null; request = null;
    for (const waiter of pending.values()) waiter.reject(failure(code));
    pending.clear(); emit("accountsChanged", []); emit("disconnect", { code });
  }
  function onMessage(event) {
    if (!request || !popup || event.source !== popup || event.origin !== HOSTED_WALLET_ORIGIN) return;
    const data = event.data;
    if (!data || data.protocol !== HOSTED_PROTOCOL || data.requestId !== request.requestId || data.nonce !== request.nonce || !/^[A-Za-z0-9_-]{22,64}$/u.test(data.messageId ?? "") || seen.has(data.messageId) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > request.expiresAt) return;
    seen.add(data.messageId);
    if (data.type === "ready") {
      popup.postMessage(hostedEnvelope(request, "hello"), HOSTED_WALLET_ORIGIN);
      return;
    }
    if (data.type === "pong") { lastPong = Date.now(); return; }
    if (data.type === "connected") {
      if (!pending.has("connect") || !/^0x[0-9a-f]{40}$/u.test(data.account ?? "") || data.chainId !== HOSTED_CHAIN_ID) return;
      account = data.account; connected = true; lastPong = Date.now(); emit("accountsChanged", [account]); emit("connect", { chainId: HOSTED_CHAIN_ID });
      pending.get("connect")?.resolve([account]); pending.delete("connect"); return;
    }
    if (data.type === "rejected") { pending.get("connect")?.reject(failure("USER_REJECTED")); pending.delete("connect"); close("USER_REJECTED"); return; }
    if (data.type === "disconnected") { close(); return; }
    if (data.type !== "response" || typeof data.replyTo !== "string") return;
    const waiter = pending.get(data.replyTo);
    if (!waiter) return;
    pending.delete(data.replyTo);
    if (data.ok === true) waiter.resolve(data.result);
    else waiter.reject(failure(typeof data.code === "string" || Number.isInteger(data.code) ? data.code : "HOSTED_REQUEST_FAILED"));
  }
  browserWindow.addEventListener("message", onMessage);
  async function connect() {
    if (connected && popup && !popup.closed) return [account];
    if (pending.has("connect")) return pending.get("connect").promise;
    seen.clear();
    request = { version: 1, origin, requestId: randomHostedId(), nonce: randomHostedId(), expiresAt: Date.now() + HOSTED_TIMEOUT_MS, chainId: HOSTED_CHAIN_ID };
    const url = `${HOSTED_WALLET_ORIGIN}${HOSTED_WALLET_PATH}#connect=${encodeHostedConnect(request)}`;
    popup = browserWindow.open(url, `ynx-hosted-${request.requestId}`, "popup,width=460,height=720");
    if (!popup) { request = null; throw failure("HOSTED_POPUP_BLOCKED"); }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending.set("connect", { resolve, reject, promise });
    monitor = browserWindow.setInterval(() => {
      if (popup?.closed || Date.now() >= request?.expiresAt || connected && Date.now() - lastPong > 5000) { close(popup?.closed ? "HOSTED_POPUP_CLOSED" : "HOSTED_REQUEST_EXPIRED_OR_RELOADED"); return; }
      if (connected) popup.postMessage(hostedEnvelope(request, "ping"), HOSTED_WALLET_ORIGIN);
    }, 1000);
    return promise;
  }
  async function requestMethod({ method, params = [] }) {
    if (method === "eth_requestAccounts") return connect();
    if (method === "eth_accounts") return connected && popup && !popup.closed ? [account] : [];
    if (method === "eth_chainId") return HOSTED_CHAIN_ID;
    if (method === "wallet_addEthereumChain" || method === "wallet_switchEthereumChain") { validateYNXChainMutation(method, params, CHAIN); return null; }
    if (!connected || !popup || popup.closed || !request) throw failure("HOSTED_DISCONNECTED");
    if (typeof method !== "string" || method.length > 80 || !Array.isArray(params) || JSON.stringify(params).length > 65536) throw failure("HOSTED_METHOD_INVALID");
    const envelope = hostedEnvelope(request, "request", { method, params });
    return new Promise((resolve, reject) => {
      const timer = browserWindow.setTimeout(() => { pending.delete(envelope.messageId); reject(failure("HOSTED_REQUEST_TIMEOUT")); }, Math.min(30_000, envelope.expiresAt - Date.now()));
      pending.set(envelope.messageId, { resolve: value => { browserWindow.clearTimeout(timer); resolve(value); }, reject: error => { browserWindow.clearTimeout(timer); reject(error); } });
      popup.postMessage(envelope, HOSTED_WALLET_ORIGIN);
    });
  }
  async function disconnect() { try { if (popup && !popup.closed && request) popup.postMessage(hostedEnvelope(request, "request", { method: "wallet_disconnect", params: [] }), HOSTED_WALLET_ORIGIN); } finally { close(); } }
  return Object.freeze({
    connect,
    request: requestMethod,
    restore: async () => connected && popup && !popup.closed ? [account] : [],
    disconnect,
    revoke: disconnect,
    detach: async () => { try { await disconnect(); } finally { browserWindow.removeEventListener("message", onMessage); } },
    on: (name, callback) => { if (typeof callback !== "function") throw new TypeError("callback"); if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeListener: (name, callback) => listeners.get(name)?.delete(callback),
    get connected() { return connected && Boolean(popup && !popup.closed); },
    get account() { return connected ? account : null; },
  });
}
