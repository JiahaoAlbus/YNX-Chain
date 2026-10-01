/** Explicit first-party browser adapter. It does not install window.ethereum. */
import { HOSTED_CHAIN_ID, HOSTED_PROTOCOL, HOSTED_SESSION_MS, HOSTED_TIMEOUT_MS, HOSTED_WALLET_ORIGIN, HOSTED_WALLET_PATH, encodeHostedConnect, hostedEnvelope, randomHostedId, registeredProduct, assertHostedMethodAllowed } from "./hosted-protocol.js";
import { validateYNXChainMutation } from "./extension-chain-params.js";

function failure(code) { return Object.assign(new Error(code), { code }); }
const CHAIN = Object.freeze({ chainId: HOSTED_CHAIN_ID, chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: ["https://rpc-testnet.ynxweb4.com", "https://evm.ynxweb4.com"], blockExplorerUrls: ["https://explorer.ynxweb4.com"] });

export function createHostedWalletAdapter({ window: browserWindow = globalThis.window, walletOrigin = HOSTED_WALLET_ORIGIN } = {}) {
  const origin = browserWindow.location.origin;
  if (!registeredProduct(origin) || walletOrigin !== HOSTED_WALLET_ORIGIN) throw failure("HOSTED_ORIGIN_UNREGISTERED");
  let popup = null, request = null, account = null, connected = false, monitor = null, lastPong = 0, closing = false, helloId = null, grant = null, reservation = null;
  const hintKey = "ynx-hosted-selection-v1";
  const hintStorage=browserWindow.localStorage??browserWindow.sessionStorage;
  function remember() { try { if (grant) hintStorage?.setItem(hintKey,JSON.stringify({origin,grant})); else hintStorage?.removeItem(hintKey); } catch { /* A hint is optional, never authority. */ } }
  try {
    const hint = JSON.parse(hintStorage?.getItem(hintKey) ?? "null"), value = hint?.grant;
    if (hint?.origin === origin && /^[A-Za-z0-9_-]{22,64}$/u.test(value?.id ?? "") && /^0x[0-9a-f]{40}$/u.test(value?.account ?? "") && Number.isSafeInteger(value.epoch) && value.epoch > 0 && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now()+HOSTED_SESSION_MS) { grant={id:value.id,account:value.account,epoch:value.epoch,expiresAt:value.expiresAt};account=grant.account; }
  } catch { /* A malformed DApp hint cannot create a connection. */ }
  const pending = new Map(), listeners = new Map(), seen = new Set();
  function live() { return connected && Boolean(popup && !popup.closed && request && Date.now() < request.expiresAt); }
  function emit(name, value) { for (const callback of [...listeners.get(name) ?? []]) { try { callback(value); } catch { /* A consumer callback cannot interrupt custody or channel state. */ } } }
  function close(code = "HOSTED_DISCONNECTED") {
    if (closing) return;
    closing = true;
    if (monitor) browserWindow.clearInterval(monitor);
    const transportOnly = ["HOSTED_POPUP_CLOSED", "HOSTED_REQUEST_EXPIRED_OR_RELOADED"].includes(code);
    monitor = null; connected = false; request = null; helloId = null; reservation = null;
    if (!transportOnly || !grant || grant.expiresAt <= Date.now()) { account = null; grant = null; }
    remember();
    for (const waiter of pending.values()) waiter.reject(failure(code));
    pending.clear();
    // A closed signing transport is not revocation of a separately approved product session.
    if (!["HOSTED_POPUP_CLOSED", "HOSTED_REQUEST_EXPIRED_OR_RELOADED"].includes(code)) emit("accountsChanged", []);
    emit("disconnect", { code });
    closing = false;
  }
  function onMessage(event) {
    if (!request || !popup || event.source !== popup || event.origin !== HOSTED_WALLET_ORIGIN) return;
    const data = event.data;
    if (!data || data.protocol !== HOSTED_PROTOCOL || data.requestId !== request.requestId || data.nonce !== request.nonce || !/^[A-Za-z0-9_-]{22,64}$/u.test(data.messageId ?? "") || seen.has(data.messageId) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > request.expiresAt) return;
    seen.add(data.messageId);
    if (data.type === "ready") {
      if (helloId) return;
      const hello = hostedEnvelope(request, "hello", grant ? {resume:{id:grant.id,epoch:grant.epoch,account:grant.account}} : {});
      helloId = hello.messageId;
      popup.postMessage(hello, HOSTED_WALLET_ORIGIN);
      return;
    }
    if (data.type === "pong") { lastPong = Date.now(); return; }
    if (data.type === "connected") {
      if (!pending.has("connect") || !helloId || data.replyTo !== helloId || !/^0x[0-9a-f]{40}$/u.test(data.account ?? "") || data.chainId !== HOSTED_CHAIN_ID || !Number.isSafeInteger(data.sessionExpiresAt) || data.sessionExpiresAt <= Date.now() || data.sessionExpiresAt > Date.now() + HOSTED_SESSION_MS) return;
      if (grant && (data.account !== grant.account || data.grant?.id !== grant.id || data.grant?.epoch !== grant.epoch)) { close("HOSTED_ACCOUNT_CHANGED"); return; }
      if (data.grant && (!/^[A-Za-z0-9_-]{22,64}$/u.test(data.grant.id ?? "") || !Number.isSafeInteger(data.grant.epoch) || data.grant.epoch < 1 || data.grant.account !== data.account || data.grant.expiresAt !== data.sessionExpiresAt)) return;
      const connectedRequest = request, waiter = pending.get("connect");
      request = { ...request, expiresAt: data.sessionExpiresAt };
      const previousAccount = account;
      grant = data.grant ? {...data.grant} : null;
      remember();
      account = data.account; connected = true; lastPong = Date.now(); if (previousAccount !== account) emit("accountsChanged", [account]);
      if (!connected || request?.requestId !== connectedRequest.requestId) return;
      emit("connect", { chainId: HOSTED_CHAIN_ID });
      if (!connected || request?.requestId !== connectedRequest.requestId) return;
      waiter.resolve([account]); pending.delete("connect"); return;
    }
    if (data.type === "rejected") { if (!helloId || data.replyTo !== helloId) return; const code = ["HOSTED_GRANT_REVOKED_OR_EXPIRED","HOSTED_ACCOUNT_CHANGED"].includes(data.code) ? data.code : "USER_REJECTED"; pending.get("connect")?.reject(failure(code)); pending.delete("connect"); close(code); return; }
    if (data.type === "disconnected") { close(data.reason === "HOSTED_POPUP_CLOSED" ? "HOSTED_POPUP_CLOSED" : "HOSTED_DISCONNECTED"); return; }
    if (data.type !== "response" || typeof data.replyTo !== "string") return;
    const waiter = pending.get(data.replyTo);
    if (!waiter) return;
    pending.delete(data.replyTo);
    if (data.ok === true) waiter.resolve(data.result);
    else waiter.reject(failure(typeof data.code === "string" || Number.isInteger(data.code) ? data.code : "HOSTED_REQUEST_FAILED"));
  }
  browserWindow.addEventListener("message", onMessage);
  async function connect() {
    if (live()) return [account];
    if (connected) close("HOSTED_REQUEST_EXPIRED_OR_RELOADED");
    if (grant && grant.expiresAt <= Date.now()) { close("HOSTED_GRANT_REVOKED_OR_EXPIRED"); throw failure("HOSTED_GRANT_REVOKED_OR_EXPIRED"); }
    if (pending.has("connect")) return pending.get("connect").promise;
    seen.clear(); helloId = null;
    request = { version: 1, origin, requestId: randomHostedId(), nonce: randomHostedId(), expiresAt: Date.now() + HOSTED_TIMEOUT_MS, chainId: HOSTED_CHAIN_ID };
    const url = `${HOSTED_WALLET_ORIGIN}${HOSTED_WALLET_PATH}#connect=${encodeHostedConnect(request)}`;
    popup = browserWindow.open(url, `ynx-hosted-${request.requestId}`, "popup,width=460,height=720");
    if (!popup) { request = null; throw failure("HOSTED_POPUP_BLOCKED"); }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending.set("connect", { resolve, reject, promise });
    monitor = browserWindow.setInterval(() => {
      if (popup?.closed || Date.now() >= request?.expiresAt || connected && Date.now() - lastPong > 15_000) { close(popup?.closed ? "HOSTED_POPUP_CLOSED" : "HOSTED_REQUEST_EXPIRED_OR_RELOADED"); return; }
      if (connected) popup.postMessage(hostedEnvelope(request, "ping"), HOSTED_WALLET_ORIGIN);
    }, 1000);
    return promise;
  }
  async function requestMethod({ method, params = [] }) {
    assertHostedMethodAllowed(origin, method);
    if (method === "eth_requestAccounts") return connect();
    if (method === "eth_accounts") return live() ? [account] : [];
    if (method === "eth_chainId") return HOSTED_CHAIN_ID;
    if (method === "wallet_addEthereumChain" || method === "wallet_switchEthereumChain") { validateYNXChainMutation(method, params, CHAIN); return null; }
    if (typeof method !== "string" || method.length > 80 || !Array.isArray(params) || JSON.stringify(params).length > 65536) throw failure("HOSTED_METHOD_INVALID");
    if (!live()) {
      if (connected) close(popup?.closed ? "HOSTED_POPUP_CLOSED" : "HOSTED_REQUEST_EXPIRED_OR_RELOADED");
      if (!grant && !pending.has("connect")) throw failure("HOSTED_DISCONNECTED");
      // connect() opens synchronously before its first await. Consumers that
      // prepare a challenge asynchronously reserve this window at the click.
      await (reservation ?? connect());
    }
    if (!live()) throw failure("HOSTED_DISCONNECTED");
    if ([...pending.keys()].some(key => key !== "connect")) throw failure("HOSTED_REQUEST_PENDING");
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
    // This must be invoked by the actual user action, before fetching a
    // challenge. No request data, secrets or approval are sent by reservation.
    reserve: () => {
      reservation = grant || live() ? connect() : Promise.reject(failure("HOSTED_DISCONNECTED"));
      // Keep a rejected reservation until the next user click; do not open a
      // second popup later from an asynchronous challenge continuation.
      reservation.catch(() => {});
      return reservation;
    },
    request: requestMethod,
    restore: async () => live() ? [account] : [],
    disconnect,
    suspend: () => { close("HOSTED_POPUP_CLOSED"); browserWindow.removeEventListener("message",onMessage); },
    revoke: async () => { const result = await requestMethod({method:"wallet_revokePermissions",params:[]}); if (result?.revoked !== true) throw failure("HOSTED_REVOCATION_UNCONFIRMED"); close(); return result; },
    detach: async () => { try { await disconnect(); } finally { browserWindow.removeEventListener("message", onMessage); } },
    on: (name, callback) => { if (typeof callback !== "function") throw new TypeError("callback"); if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeListener: (name, callback) => listeners.get(name)?.delete(callback),
    get connected() { return live(); },
    get account() { return live() ? account : null; },
    get selection() { return grant && grant.expiresAt > Date.now() ? {account:grant.account,chainId:HOSTED_CHAIN_ID,expiresAt:grant.expiresAt} : null; },
  });
}
