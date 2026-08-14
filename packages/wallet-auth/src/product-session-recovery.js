import { exactFields, WalletAuthError } from "./canonical.js";
import { createProductSessionRequest, parseProductSession, parseProductSessionRequest } from "./product-session-v2.js";
import { parseProductSessionRegistry, productPlatformBinding } from "./product-session-registry.js";
import { parseProductSessionReturnURL, prepareWalletOpen, walletConnectionChoices, WALLET_ROUTE_STATUS } from "./product-session-router.js";

export const PRODUCT_SESSION_CLIENT_STATE = Object.freeze({
  DISCONNECTED: "disconnected", CONNECTING: "connecting", CONNECTED: "connected", GUEST: "guest",
  NETWORK_UNAVAILABLE: "network-unavailable", RETRY_REQUIRED: "retry-required",
});

export class RecoverableProductSessionClient {
  #registry; #binding; #storage; #gateway; #device; #tokens; #clock; #state; #autoReconnectAttempted; #networkAvailable;
  constructor(config) {
    exactFields(config, ["registry", "productId", "platform", "storage", "gateway", "device", "tokenFactory", "clock"], "Recoverable Product Session client configuration");
    this.#registry = parseProductSessionRegistry(config.registry);
    this.#binding = productPlatformBinding(this.#registry, config.productId, config.platform);
    this.#storage = secureStorage(config.storage);
    this.#gateway = gateway(config.gateway);
    this.#device = device(config.device);
    this.#tokens = tokenFactory(config.tokenFactory);
    this.#clock = clock(config.clock);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "No authoritative Product Session is active");
    this.#autoReconnectAttempted = false;
    this.#networkAvailable = true;
  }

  get current() { return this.#state; }
  get storageKey() { return `ynx.product-session.v2:${this.#binding.productId}:${this.#binding.platform}:${this.#binding.applicationId}`; }

  async restore(networkAvailable = true) {
    this.#networkAvailable = Boolean(networkAvailable);
    if (!this.#networkAvailable) return this.#offline();
    const raw = await this.#storage.get(this.storageKey);
    if (raw !== null) {
      try {
        const session = parseProductSession(JSON.parse(raw));
        const result = await this.#gateway.introspect(session.sessionBinding, this.#context(session.account, session.scopes));
        if (result?.active === true) { this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session restored", { session }); return this.#state; }
        throw new WalletAuthError("SESSION_INACTIVE", "Gateway did not confirm the stored Product Session");
      } catch {
        await this.#storage.remove(this.storageKey);
      }
    }
    if (!this.#autoReconnectAttempted) {
      this.#autoReconnectAttempted = true;
      return this.begin({ walletInstalled: await this.#gateway.walletInstalled(), schemeRegistered: await this.#gateway.schemeRegistered() }, true);
    }
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Stored Product Session is invalid; explicit Retry is required", { actions: ["retry", "guest"] });
    return this.#state;
  }

  async begin(environment, automatic = false) {
    exactFields(environment, ["walletInstalled", "schemeRegistered"], "Product Session connection environment");
    if (!this.#networkAvailable) return this.#offline();
    const now = this.#clock();
    const request = createProductSessionRequest(this.#registry, {
      productId: this.#binding.productId, platform: this.#binding.platform,
      deviceId: this.#device.id, deviceKey: this.#device.key, scopes: this.#device.scopes,
      purpose: this.#device.purpose, nonce: this.#tokens(), state: this.#tokens(),
    }, now);
    await this.#storage.set(`${this.storageKey}:pending`, JSON.stringify(request));
    const route = prepareWalletOpen(this.#registry, request, { networkAvailable: true, walletInstalled: environment.walletInstalled, schemeRegistered: environment.schemeRegistered }, now);
    this.#state = route.status === WALLET_ROUTE_STATUS.READY
      ? state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, automatic ? "Controlled reconnect requires Wallet approval" : "Wallet approval is pending", { request, route, automatic })
      : state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, route.message, { request, route, automatic, actions: route.actions });
    return this.#state;
  }

  async handleReturn(url) {
    if (!this.#networkAvailable) return this.#offline();
    const raw = await this.#storage.get(`${this.storageKey}:pending`);
    if (raw === null) { this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "No pending Wallet request matches this callback", { actions: ["retry", "guest"] }); return this.#state; }
    let request;
    try { request = parseProductSessionRequest(this.#registry, JSON.parse(raw), this.#clock()); } catch { await this.#storage.remove(`${this.storageKey}:pending`); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Pending Wallet request expired or is invalid", { actions: ["retry", "guest"] }); return this.#state; }
    const returned = parseProductSessionReturnURL(this.#registry, request, url, this.#clock());
    if (returned.status === WALLET_ROUTE_STATUS.USER_REJECTED) { await this.#storage.remove(`${this.storageKey}:pending`); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "Wallet approval was rejected; no session was created", { actions: returned.actions }); return this.#state; }
    if (returned.status !== WALLET_ROUTE_STATUS.READY) { this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, returned.message, { actions: returned.actions }); return this.#state; }
    try {
      const session = parseProductSession(await this.#gateway.complete({ request, approval: returned.approval, deviceSecret: this.#device.secret }));
      await this.#gateway.introspect(session.sessionBinding, this.#context(session.account, session.scopes));
      await this.#storage.set(this.storageKey, JSON.stringify(session));
      await this.#storage.remove(`${this.storageKey}:pending`);
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session connected", { session });
      return this.#state;
    } catch {
      await this.#storage.remove(this.storageKey); await this.#storage.remove(`${this.storageKey}:pending`);
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not issue or confirm a valid Product Session", { actions: ["retry", "guest"] });
      return this.#state;
    }
  }

  async retry(environment) { this.#autoReconnectAttempted = false; return this.begin(environment, false); }
  connectionChoices(availability) { return walletConnectionChoices(this.#registry, this.#binding.productId, availability); }
  setNetworkAvailable(available) { this.#networkAvailable = Boolean(available); if (!this.#networkAvailable) return this.#offline(); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Network restored; authoritative re-introspection is required", { actions: ["retry"] }); return this.#state; }
  enterGuest() { this.#state = state(PRODUCT_SESSION_CLIENT_STATE.GUEST, "Guest / Try mode: not signed in; balances, transactions and Chain authority are unavailable", { limitations: ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"] }); return this.#state; }
  async disconnect() { await this.#storage.remove(this.storageKey); await this.#storage.remove(`${this.storageKey}:pending`); this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "Product Session removed from secure storage"); return this.#state; }

  #context(account, requiredScopes) { return { chainId: this.#binding.chainId, productId: this.#binding.productId, clientId: this.#binding.clientId, platform: this.#binding.platform, applicationId: this.#binding.applicationId, bundleId: this.#binding.bundleId, packageId: this.#binding.packageId, origin: this.#binding.origin, callback: this.#binding.callback, account, deviceId: this.#device.id, deviceKey: this.#device.key, requiredScopes }; }
  #offline() { this.#state = state(PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE, "Network unavailable; cached Product Session is not treated as authoritative", { actions: ["retry", "guest"] }); return this.#state; }
}

function state(status, message, extra = {}) { return Object.freeze({ status, message, ...extra, ...(extra.actions ? { actions: Object.freeze(extra.actions) } : {}), ...(extra.limitations ? { limitations: Object.freeze(extra.limitations) } : {}) }); }
function secureStorage(value) { if (!value || !["hardware-backed", "os-protected"].includes(value.securityLevel) || ["get", "set", "remove"].some((name) => typeof value[name] !== "function")) fail("INSECURE_STORAGE", "Product Sessions require injected OS-protected or hardware-backed storage"); return value; }
function gateway(value) { if (!value || ["complete", "introspect", "walletInstalled", "schemeRegistered"].some((name) => typeof value[name] !== "function")) fail("INVALID_GATEWAY", "Product Session client requires a real Gateway adapter"); return value; }
function device(value) { exactFields(value, ["id", "key", "secret", "scopes", "purpose"], "Product Session device configuration"); if (typeof value.id !== "string" || typeof value.key !== "string" || typeof value.secret !== "string" || !Array.isArray(value.scopes) || typeof value.purpose !== "string") fail("INVALID_DEVICE", "Product Session device configuration is invalid"); return Object.freeze({ ...value, scopes: Object.freeze([...value.scopes]) }); }
function tokenFactory(value) { if (typeof value !== "function") fail("INVALID_RANDOM_SOURCE", "Product Session client requires a cryptographic token factory"); return () => { const token = value(); if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) fail("INVALID_RANDOM_SOURCE", "Product Session token factory returned an invalid token"); return token; }; }
function clock(value) { if (typeof value !== "function") fail("INVALID_TIME", "Product Session client requires a clock"); return () => { const result = value(); if (!(result instanceof Date) || !Number.isFinite(result.getTime())) fail("INVALID_TIME", "Product Session clock returned invalid time"); return result; }; }
function fail(code, message) { throw new WalletAuthError(code, message); }
