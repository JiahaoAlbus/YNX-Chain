// ../../apps/wallet-web/vendor/product-session-registry-123016847.json
var product_session_registry_123016847_default = {
  schemaVersion: 2,
  chainId: "ynx_6423-1",
  wallet: {
    authorizeCallback: "ynxwallet://authorize",
    downloadUrl: "https://www.ynxweb4.com/dapp/download",
    metaMaskDownloadUrl: "https://metamask.io/download"
  },
  products: [
    {
      productId: "ai",
      clientId: "ynx-ai-v1",
      displayName: "YNX AI",
      applicationId: "com.ynxweb4.ai",
      webOrigin: "https://assistant.ynxweb4.com",
      nativeCallback: "ynxai://wallet-auth/callback",
      legacyCallbacks: ["ynxai://wallet-auth/callback"],
      scopes: ["ai:actions", "ai:attachments", "ai:conversations", "ai:data-control", "ai:generate", "ai:permissions"],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "calendar",
      clientId: "ynx-calendar-v1",
      displayName: "YNX Calendar",
      applicationId: "com.ynxweb4.calendar",
      webOrigin: "https://calendar.ynxweb4.com",
      nativeCallback: "ynxcalendar://wallet-auth/callback",
      legacyCallbacks: ["ynxcalendar", "ynxcalendar://wallet-auth/callback"],
      scopes: ["calendar:account", "calendar:recover"],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "card",
      clientId: "ynx-card-v1",
      displayName: "YNX Card",
      applicationId: "com.ynxweb4.card",
      webOrigin: "https://card.ynxweb4.com",
      nativeCallback: "ynxcard://wallet-auth/callback",
      legacyCallbacks: ["ynxcard", "ynxcard://wallet-auth/callback"],
      scopes: ["account:read", "card:application:write", "card:controls:write", "card:dispute:write", "card:simulation:write", "card:topup:write"],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "cloud",
      clientId: "ynx-cloud-web-v1",
      displayName: "YNX Cloud",
      applicationId: "com.ynxweb4.cloud",
      webOrigin: "https://web4.ynxweb4.com",
      platforms: ["web"],
      nativeCallback: null,
      legacyCallbacks: [],
      scopes: ["files.read", "files.write"],
      evmCompatible: false,
      sessionDurationSeconds: 300
    },
    {
      productId: "creator-studio",
      clientId: "ynx-creator-studio-web-v1",
      displayName: "YNX Creator Studio",
      applicationId: "com.ynxweb4.creator-studio",
      webOrigin: "https://creator.ynxweb4.com",
      nativeCallback: "ynxcreator://wallet-auth/callback",
      legacyCallbacks: ["ynxcreator", "ynxcreator://wallet-auth/callback"],
      scopes: ["creator:account", "creator:publish", "creator:revenue"],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "developer",
      clientId: "ynx-developer-v1",
      displayName: "YNX Developer",
      applicationId: "com.ynxweb4.developer.testnetpreview",
      webOrigin: "https://developer.ynxweb4.com",
      nativeCallback: "ynxdeveloper://wallet-auth/callback",
      legacyCallbacks: ["ynxdeveloper", "ynxdeveloper://wallet-auth/callback"],
      scopes: ["account:read", "developer:deploy"],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "dex",
      clientId: "ynx-dex-v1",
      displayName: "YNX DEX",
      applicationId: "com.ynxweb4.dex",
      webOrigin: "https://dex.ynxweb4.com",
      nativeCallback: "ynxdex://wallet-auth/callback",
      legacyCallbacks: ["ynxdex", "ynxdex://wallet-auth/callback"],
      scopes: ["dex:account", "dex:orders", "dex:trade"],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "docs",
      clientId: "ynx-docs-mobile-v1",
      displayName: "YNX Docs",
      applicationId: "com.ynxweb4.docs",
      webOrigin: "https://docs.ynxweb4.com",
      nativeCallback: "ynxdocs://wallet-auth/callback",
      legacyCallbacks: ["ynxdocs://wallet-auth/callback"],
      scopes: ["docs.read", "docs.write", "files.read", "files.write"],
      evmCompatible: false,
      sessionDurationSeconds: 300
    },
    {
      productId: "exchange",
      clientId: "ynx-exchange-v1",
      displayName: "YNX Exchange",
      applicationId: "com.ynxweb4.exchange",
      webOrigin: "https://exchange.ynxweb4.com",
      nativeCallback: "ynxexchange://wallet-auth/callback",
      legacyCallbacks: ["ynxexchange", "ynxexchange://wallet-auth/callback"],
      scopes: ["exchange:ai", "exchange:deposit", "exchange:read", "exchange:trade", "exchange:withdrawal-review"],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "finance",
      clientId: "ynx-finance-v1",
      displayName: "YNX Finance",
      applicationId: "com.ynxweb4.finance",
      webOrigin: "https://finance.ynxweb4.com",
      nativeCallback: "ynxfinance://wallet-auth/callback",
      legacyCallbacks: ["ynxfinance", "ynxfinance://wallet-auth/callback"],
      scopes: ["finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"],
      evmCompatible: true,
      sessionDurationSeconds: 240
    },
    {
      productId: "pay",
      clientId: "ynx-pay-v1",
      displayName: "YNX Pay",
      applicationId: "com.ynxweb4.pay",
      webOrigin: "https://pay.ynxweb4.com",
      nativeCallback: "ynxpay://wallet-auth/callback",
      legacyCallbacks: ["ynxpay", "ynxpay://wallet-auth/callback"],
      scopes: ["account:read", "pay:case:create", "pay:settlement:submit"],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "quant",
      clientId: "ynx-quant-v1",
      displayName: "YNX Quant",
      applicationId: "com.ynxweb4.quant",
      webOrigin: "https://quant.ynxweb4.com",
      nativeCallback: "ynxquant://wallet-auth/callback",
      legacyCallbacks: ["ynxquant", "ynxquant://wallet-auth/callback"],
      scopes: ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke", "quant:paper:workspace", "quant:records:read"],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "shop",
      clientId: "ynx-shop-v1",
      displayName: "YNX Shop",
      applicationId: "com.ynxweb4.shop",
      webOrigin: "https://shop.ynxweb4.com",
      nativeCallback: "ynxshop://wallet-auth/callback",
      legacyCallbacks: ["ynxshop", "ynxshop://wallet-auth/callback"],
      scopes: ["account:read", "shop:orders:write", "shop:profile:write"],
      evmCompatible: true,
      sessionDurationSeconds: 240
    },
    {
      productId: "social",
      clientId: "ynx-social-v1",
      displayName: "YNX Social",
      applicationId: "com.ynx.social",
      webOrigin: "https://social.ynxweb4.com",
      nativeCallback: "ynx-social://com.ynx.social",
      legacyCallbacks: ["ynx-social", "ynx-social://com.ynx.social"],
      scopes: ["account:read", "profile:link", "social.contacts", "social.messaging", "social.profile"],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "video",
      clientId: "ynx-video-mobile-v1",
      displayName: "YNX Video",
      applicationId: "com.ynxweb4.video",
      webOrigin: "https://video.ynxweb4.com",
      nativeCallback: "ynxvideo://wallet-auth/callback",
      legacyCallbacks: ["ynxvideo", "ynxvideo://wallet-auth/callback"],
      scopes: ["video:account", "video:library", "video:playback"],
      evmCompatible: false,
      sessionDurationSeconds: 300
    }
  ]
};

// src/product-session-registry.js
var PRODUCT_SESSION_PLATFORMS = Object.freeze(["android", "ios", "linux", "macos", "web", "windows"]);

// src/central-browser-session-registry.js
var CENTRAL_BROWSER_ISSUER = "https://wallet-auth.ynxweb4.com";
var ADOPTED = Object.freeze(["finance", "exchange", "quant", "social", "ai", "developer"]);
var ECOSYSTEM_ADOPTED = Object.freeze([...ADOPTED, "calendar", "cloud", "docs", "mail", "shop", "video", "creator-studio"]);
var PROFILE_PRODUCTS = Object.freeze([["finance", "exchange", "quant"], ["finance", "exchange", "quant", "social", "ai"], ["finance", "exchange", "quant", "social", "ai", "developer"], [...ECOSYSTEM_ADOPTED]]);

// src/central-browser-session-contract.js
var CENTRAL_BROWSER_RPC_METHOD = "ynx_requestCentralBrowserSignIn";

// ../../apps/wallet-web/src/hosted-protocol.js
var HOSTED_PROTOCOL = "ynx-hosted-wallet/v1";
var HOSTED_WALLET_ORIGIN = "https://wallet.ynxweb4.com";
var HOSTED_WALLET_PATH = "/hosted/";
var HOSTED_CHAIN_ID = "0x1917";
var HOSTED_TIMEOUT_MS = 12e4;
var HOSTED_SESSION_MS = 60 * 6e4;
var MAX_REQUEST_BYTES = 4096;
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function registeredProduct(origin) {
  if (typeof origin !== "string" || !/^https:\/\/[a-z0-9.-]+$/u.test(origin)) return null;
  if (origin === CENTRAL_BROWSER_ISSUER) return Object.freeze({ productId: "central-browser-identity", webOrigin: origin, evmCompatible: true });
  return product_session_registry_123016847_default.products.find((product) => product.webOrigin === origin && (product.evmCompatible === true || product.productId === "social" && product.clientId === "ynx-social-v1" && product.applicationId === "com.ynx.social" && origin === "https://social.ynxweb4.com" && product.evmCompatible === false || product.productId === "ai" && product.clientId === "ynx-ai-v1" && product.applicationId === "com.ynxweb4.ai" && origin === "https://assistant.ynxweb4.com" && product.evmCompatible === false || product.productId === "video" && product.clientId === "ynx-video-mobile-v1" && product.applicationId === "com.ynxweb4.video" && origin === "https://video.ynxweb4.com" && product.evmCompatible === false || product.productId === "creator-studio" && product.clientId === "ynx-creator-studio-web-v1" && product.applicationId === "com.ynxweb4.creator-studio" && origin === "https://creator.ynxweb4.com" && product.evmCompatible === false)) ?? null;
}
function assertHostedMethodAllowed(origin, method) {
  if (["https://social.ynxweb4.com", "https://assistant.ynxweb4.com", "https://video.ynxweb4.com", "https://creator.ynxweb4.com"].includes(origin) && !["ynx_requestProductSessionV2", "eth_requestAccounts", "eth_accounts", "eth_chainId", "wallet_disconnect", "wallet_revokePermissions", "wallet_addEthereumChain", "wallet_switchEthereumChain"].includes(method)) fail(origin === "https://social.ynxweb4.com" ? "HOSTED_SOCIAL_PRIVATE_ONLY" : origin === "https://assistant.ynxweb4.com" ? "HOSTED_AI_PRIVATE_ONLY" : "HOSTED_NATIVE_PRIVATE_ONLY");
  if (origin === CENTRAL_BROWSER_ISSUER && ![CENTRAL_BROWSER_RPC_METHOD, "eth_requestAccounts", "eth_accounts", "eth_chainId", "wallet_disconnect", "wallet_revokePermissions", "wallet_addEthereumChain", "wallet_switchEthereumChain"].includes(method)) fail("HOSTED_IDENTITY_ONLY");
}
function randomHostedId(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.getRandomValues) fail("HOSTED_CRYPTO_UNAVAILABLE");
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function encodeHostedConnect(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  if (bytes.length > MAX_REQUEST_BYTES) fail("HOSTED_REQUEST_INVALID");
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function hostedEnvelope(request, type, extra = {}, now = Date.now()) {
  if (now >= request.expiresAt) fail("HOSTED_REQUEST_EXPIRED");
  return { protocol: HOSTED_PROTOCOL, requestId: request.requestId, nonce: request.nonce, messageId: randomHostedId(), expiresAt: Math.min(request.expiresAt, now + 3e4), type, ...extra };
}

// ../../apps/wallet-web/src/extension-chain-params.js
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var ownKeys = (value, allowed) => record(value) && Object.keys(value).every((key) => allowed.includes(key));
var trustedSubset = (value, allowed) => Array.isArray(value) && value.length > 0 && value.length <= allowed.length && new Set(value).size === value.length && value.every((url) => typeof url === "string" && allowed.includes(url));
function validateYNXChainMutation(method, params, chain) {
  const input = Array.isArray(params) && params.length === 1 ? params[0] : null;
  let valid = record(input) && input.chainId === chain.chainId;
  if (method === "wallet_switchEthereumChain") valid = valid && ownKeys(input, ["chainId"]);
  else if (method === "wallet_addEthereumChain") {
    valid = valid && ownKeys(input, ["chainId", "chainName", "nativeCurrency", "rpcUrls", "blockExplorerUrls"]) && trustedSubset(input.rpcUrls, chain.rpcUrls) && (!Object.hasOwn(input, "chainName") || input.chainName === chain.chainName) && (!Object.hasOwn(input, "blockExplorerUrls") || trustedSubset(input.blockExplorerUrls, chain.blockExplorerUrls));
    if (valid && Object.hasOwn(input, "nativeCurrency")) {
      const currency = input.nativeCurrency;
      valid = ownKeys(currency, ["name", "symbol", "decimals"]) && [chain.nativeCurrency.name, "YNXT"].includes(currency.name) && currency.symbol === chain.nativeCurrency.symbol && currency.decimals === chain.nativeCurrency.decimals;
    }
  } else valid = false;
  if (!valid) throw Object.assign(new Error("Rejected non-canonical YNX Testnet chain parameters."), { code: "INVALID_CHAIN_PARAMS" });
  return true;
}

// ../../apps/wallet-web/src/hosted-adapter.js
function failure(code) {
  return Object.assign(new Error(code), { code });
}
var CHAIN = Object.freeze({ chainId: HOSTED_CHAIN_ID, chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: ["https://rpc-testnet.ynxweb4.com", "https://evm.ynxweb4.com"], blockExplorerUrls: ["https://explorer.ynxweb4.com"] });
function createHostedWalletAdapter({ window: browserWindow = globalThis.window, walletOrigin = HOSTED_WALLET_ORIGIN } = {}) {
  const origin = browserWindow.location.origin;
  if (!registeredProduct(origin) || walletOrigin !== HOSTED_WALLET_ORIGIN) throw failure("HOSTED_ORIGIN_UNREGISTERED");
  let popup = null, request = null, account = null, connected = false, monitor = null, lastPong = 0, closing = false, helloId = null, grant = null, reservation = null;
  const hintKey = "ynx-hosted-selection-v1";
  const hintStorage = browserWindow.localStorage ?? browserWindow.sessionStorage;
  function remember() {
    try {
      if (grant) hintStorage?.setItem(hintKey, JSON.stringify({ origin, grant }));
      else hintStorage?.removeItem(hintKey);
    } catch {
    }
  }
  try {
    const hint = JSON.parse(hintStorage?.getItem(hintKey) ?? "null"), value = hint?.grant;
    if (hint?.origin === origin && /^[A-Za-z0-9_-]{22,64}$/u.test(value?.id ?? "") && /^0x[0-9a-f]{40}$/u.test(value?.account ?? "") && Number.isSafeInteger(value.epoch) && value.epoch > 0 && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + HOSTED_SESSION_MS) {
      grant = { id: value.id, account: value.account, epoch: value.epoch, expiresAt: value.expiresAt };
      account = grant.account;
    }
  } catch {
  }
  const pending = /* @__PURE__ */ new Map(), listeners = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  function live() {
    return connected && Boolean(popup && !popup.closed && request && Date.now() < request.expiresAt);
  }
  function emit(name, value) {
    for (const callback of [...listeners.get(name) ?? []]) {
      try {
        callback(value);
      } catch {
      }
    }
  }
  function close(code = "HOSTED_DISCONNECTED") {
    if (closing) return;
    closing = true;
    if (monitor) browserWindow.clearInterval(monitor);
    const transportOnly = ["HOSTED_POPUP_CLOSED", "HOSTED_REQUEST_EXPIRED_OR_RELOADED"].includes(code);
    monitor = null;
    connected = false;
    request = null;
    helloId = null;
    reservation = null;
    if (!transportOnly || !grant || grant.expiresAt <= Date.now()) {
      account = null;
      grant = null;
    }
    remember();
    for (const waiter of pending.values()) waiter.reject(failure(code));
    pending.clear();
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
      const hello = hostedEnvelope(request, "hello", grant ? { resume: { id: grant.id, epoch: grant.epoch, account: grant.account } } : {});
      helloId = hello.messageId;
      popup.postMessage(hello, HOSTED_WALLET_ORIGIN);
      return;
    }
    if (data.type === "pong") {
      lastPong = Date.now();
      return;
    }
    if (data.type === "connected") {
      if (!pending.has("connect") || !helloId || data.replyTo !== helloId || !/^0x[0-9a-f]{40}$/u.test(data.account ?? "") || data.chainId !== HOSTED_CHAIN_ID || !Number.isSafeInteger(data.sessionExpiresAt) || data.sessionExpiresAt <= Date.now() || data.sessionExpiresAt > Date.now() + HOSTED_SESSION_MS) return;
      if (grant && (data.account !== grant.account || data.grant?.id !== grant.id || data.grant?.epoch !== grant.epoch)) {
        close("HOSTED_ACCOUNT_CHANGED");
        return;
      }
      if (data.grant && (!/^[A-Za-z0-9_-]{22,64}$/u.test(data.grant.id ?? "") || !Number.isSafeInteger(data.grant.epoch) || data.grant.epoch < 1 || data.grant.account !== data.account || data.grant.expiresAt !== data.sessionExpiresAt)) return;
      const connectedRequest = request, waiter2 = pending.get("connect");
      request = { ...request, expiresAt: data.sessionExpiresAt };
      const previousAccount = account;
      grant = data.grant ? { ...data.grant } : null;
      remember();
      account = data.account;
      connected = true;
      lastPong = Date.now();
      if (previousAccount !== account) emit("accountsChanged", [account]);
      if (!connected || request?.requestId !== connectedRequest.requestId) return;
      emit("connect", { chainId: HOSTED_CHAIN_ID });
      if (!connected || request?.requestId !== connectedRequest.requestId) return;
      waiter2.resolve([account]);
      pending.delete("connect");
      return;
    }
    if (data.type === "rejected") {
      if (!helloId || data.replyTo !== helloId) return;
      const code = ["HOSTED_GRANT_REVOKED_OR_EXPIRED", "HOSTED_ACCOUNT_CHANGED"].includes(data.code) ? data.code : "USER_REJECTED";
      pending.get("connect")?.reject(failure(code));
      pending.delete("connect");
      close(code);
      return;
    }
    if (data.type === "disconnected") {
      close(data.reason === "HOSTED_POPUP_CLOSED" ? "HOSTED_POPUP_CLOSED" : "HOSTED_DISCONNECTED");
      return;
    }
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
    if (grant && grant.expiresAt <= Date.now()) {
      close("HOSTED_GRANT_REVOKED_OR_EXPIRED");
      throw failure("HOSTED_GRANT_REVOKED_OR_EXPIRED");
    }
    if (pending.has("connect")) return pending.get("connect").promise;
    seen.clear();
    helloId = null;
    request = { version: 1, origin, requestId: randomHostedId(), nonce: randomHostedId(), expiresAt: Date.now() + HOSTED_TIMEOUT_MS, chainId: HOSTED_CHAIN_ID };
    const url = `${HOSTED_WALLET_ORIGIN}${HOSTED_WALLET_PATH}#connect=${encodeHostedConnect(request)}`;
    popup = browserWindow.open(url, `ynx-hosted-${request.requestId}`, "popup,width=460,height=720");
    if (!popup) {
      request = null;
      throw failure("HOSTED_POPUP_BLOCKED");
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pending.set("connect", { resolve, reject, promise });
    monitor = browserWindow.setInterval(() => {
      if (popup?.closed || Date.now() >= request?.expiresAt || connected && Date.now() - lastPong > 15e3) {
        close(popup?.closed ? "HOSTED_POPUP_CLOSED" : "HOSTED_REQUEST_EXPIRED_OR_RELOADED");
        return;
      }
      if (connected) popup.postMessage(hostedEnvelope(request, "ping"), HOSTED_WALLET_ORIGIN);
    }, 1e3);
    return promise;
  }
  async function requestMethod({ method, params = [] }) {
    assertHostedMethodAllowed(origin, method);
    if (method === "eth_requestAccounts") return connect();
    if (method === "eth_accounts") return live() ? [account] : [];
    if (method === "eth_chainId") return HOSTED_CHAIN_ID;
    if (method === "wallet_addEthereumChain" || method === "wallet_switchEthereumChain") {
      validateYNXChainMutation(method, params, CHAIN);
      return null;
    }
    if (typeof method !== "string" || method.length > 80 || !Array.isArray(params) || JSON.stringify(params).length > 65536) throw failure("HOSTED_METHOD_INVALID");
    if (!live()) {
      if (connected) close(popup?.closed ? "HOSTED_POPUP_CLOSED" : "HOSTED_REQUEST_EXPIRED_OR_RELOADED");
      if (!grant && !pending.has("connect")) throw failure("HOSTED_DISCONNECTED");
      await (reservation ?? connect());
    }
    if (!live()) throw failure("HOSTED_DISCONNECTED");
    if ([...pending.keys()].some((key) => key !== "connect")) throw failure("HOSTED_REQUEST_PENDING");
    const envelope = hostedEnvelope(request, "request", { method, params });
    return new Promise((resolve, reject) => {
      const timer = browserWindow.setTimeout(() => {
        pending.delete(envelope.messageId);
        reject(failure("HOSTED_REQUEST_TIMEOUT"));
      }, Math.min(3e4, envelope.expiresAt - Date.now()));
      pending.set(envelope.messageId, { resolve: (value) => {
        browserWindow.clearTimeout(timer);
        resolve(value);
      }, reject: (error) => {
        browserWindow.clearTimeout(timer);
        reject(error);
      } });
      popup.postMessage(envelope, HOSTED_WALLET_ORIGIN);
    });
  }
  async function disconnect() {
    try {
      if (popup && !popup.closed && request) popup.postMessage(hostedEnvelope(request, "request", { method: "wallet_disconnect", params: [] }), HOSTED_WALLET_ORIGIN);
    } finally {
      close();
    }
  }
  return Object.freeze({
    connect,
    // This must be invoked by the actual user action, before fetching a
    // challenge. No request data, secrets or approval are sent by reservation.
    reserve: () => {
      reservation = grant || live() ? connect() : Promise.reject(failure("HOSTED_DISCONNECTED"));
      reservation.catch(() => {
      });
      return reservation;
    },
    request: requestMethod,
    restore: async () => live() ? [account] : [],
    disconnect,
    suspend: () => {
      close("HOSTED_POPUP_CLOSED");
      browserWindow.removeEventListener("message", onMessage);
    },
    revoke: async () => {
      const result = await requestMethod({ method: "wallet_revokePermissions", params: [] });
      if (result?.revoked !== true) throw failure("HOSTED_REVOCATION_UNCONFIRMED");
      close();
      return result;
    },
    detach: async () => {
      try {
        await disconnect();
      } finally {
        browserWindow.removeEventListener("message", onMessage);
      }
    },
    on: (name, callback) => {
      if (typeof callback !== "function") throw new TypeError("callback");
      if (!listeners.has(name)) listeners.set(name, /* @__PURE__ */ new Set());
      listeners.get(name).add(callback);
    },
    removeListener: (name, callback) => listeners.get(name)?.delete(callback),
    get connected() {
      return live();
    },
    get account() {
      return live() ? account : null;
    },
    get selection() {
      return grant && grant.expiresAt > Date.now() ? { account: grant.account, chainId: HOSTED_CHAIN_ID, expiresAt: grant.expiresAt } : null;
    }
  });
}
export {
  createHostedWalletAdapter
};
