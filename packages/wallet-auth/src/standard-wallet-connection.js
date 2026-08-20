import { exactFields } from "./canonical.js";

export const EIP1193_PROVIDER_CODE = Object.freeze({
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  PROVIDER_DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNKNOWN_CHAIN: 4902,
});

export const STANDARD_WALLET_METHODS = Object.freeze([
  "wallet_addEthereumChain", "wallet_switchEthereumChain", "wallet_requestPermissions", "wallet_getPermissions", "wallet_watchAsset",
  "eth_requestAccounts", "eth_accounts", "eth_chainId", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction",
]);

export class Eip1193ProviderError extends Error {
  constructor(code, message) { super(message); this.name = "Eip1193ProviderError"; this.code = code; }
}

/**
 * Gateway-independent EIP-1193 transport for external and first-party DApps.
 * It deliberately has no Product Registry, Product Session, device proof, or
 * YNX callback input. Private YNX APIs must separately upgrade through the
 * Product Session client after this standard connection is established.
 */
export class StandardWalletConnection {
  #provider; #origin; #metadata; #listeners = new Set(); #session = null;

  constructor(config) {
    exactFields(config, ["provider", "origin", "metadata"], "Standard Wallet connection configuration");
    if (!validProvider(config.provider)) throw providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "EIP-1193 provider is unavailable");
    if (!canonicalHttpsOrigin(config.origin)) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "DApp origin must be an exact HTTPS origin");
    if (!metadata(config.metadata)) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "DApp metadata is invalid");
    this.#provider = config.provider; this.#origin = config.origin; this.#metadata = Object.freeze({ ...config.metadata });
    this.#bindProviderEvents();
  }

  get current() { return this.#session; }

  async connect() {
    const accounts = await this.request({ method: "eth_requestAccounts" });
    const chainId = await this.request({ method: "eth_chainId" });
    const account = firstAccount(accounts);
    this.#session = Object.freeze({
      version: "1.0.0", transport: "eip1193", origin: this.#origin, dappMetadata: this.#metadata,
      selectedAccount: account, selectedChain: chainId, approvedMethods: Object.freeze([...STANDARD_WALLET_METHODS]),
      approvedEvents: Object.freeze(["accountsChanged", "chainChanged", "connect", "disconnect", "message"]),
      connected: true,
    });
    return this.#session;
  }

  async request(input) {
    const fields = Object.keys(input ?? {}).sort();
    if (fields.join("\n") !== ["method", ...(Object.hasOwn(input ?? {}, "params") ? ["params"] : [])].sort().join("\n") || typeof input?.method !== "string") {
      throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "Malformed EIP-1193 request");
    }
    if (input.method === "eth_sign") throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "Raw eth_sign is disabled because blind signing is unsafe");
    if (!STANDARD_WALLET_METHODS.includes(input.method)) throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "EIP-1193 method is not supported by this transport");
    try { return await this.#provider.request(Object.hasOwn(input, "params") ? { method: input.method, params: input.params } : { method: input.method }); }
    catch (error) { throw normalizeProviderError(error); }
  }

  disconnect() {
    this.#session = null;
    this.#emit("disconnect", Object.freeze({ code: EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, message: "Wallet connection was disconnected" }));
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Standard Wallet event listener must be a function");
    this.#listeners.add(listener); return () => this.#listeners.delete(listener);
  }

  #bindProviderEvents() {
    if (typeof this.#provider.on !== "function") return;
    for (const event of ["accountsChanged", "chainChanged", "connect", "disconnect", "message"]) {
      this.#provider.on(event, (value) => {
        if (event === "accountsChanged" && this.#session !== null) {
          try { this.#session = Object.freeze({ ...this.#session, selectedAccount: firstAccount(value) }); }
          catch { this.disconnect(); return; }
        }
        if (event === "chainChanged" && this.#session !== null && canonicalChain(value)) this.#session = Object.freeze({ ...this.#session, selectedChain: value.toLowerCase() });
        if (event === "disconnect") this.#session = null;
        this.#emit(event, value);
      });
    }
  }
  #emit(event, value) { for (const listener of this.#listeners) { try { listener(Object.freeze({ event, value })); } catch {} } }
}

function validProvider(value) { try { return typeof value === "object" && value !== null && typeof value.request === "function"; } catch { return false; } }
function canonicalHttpsOrigin(value) { try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && !url.username && !url.password; } catch { return false; } }
function metadata(value) { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join("\n") === ["name", "url"].join("\n") && typeof value.name === "string" && value.name.trim() === value.name && value.name.length >= 1 && value.name.length <= 128 && canonicalHttpsOrigin(value.url); }
function canonicalChain(value) { return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value); }
function firstAccount(value) { if (!Array.isArray(value) || value.length < 1 || value.length > 1024 || typeof value[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value[0])) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet did not approve a valid EVM account"); return value[0].toLowerCase(); }
function providerError(code, message) { return new Eip1193ProviderError(code, message); }
function normalizeProviderError(error) {
  const code = (() => { try { return Number(error?.code); } catch { return NaN; } })();
  if (Object.values(EIP1193_PROVIDER_CODE).includes(code)) return providerError(code, safeMessage(error?.message));
  return providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "EIP-1193 provider request failed");
}
function safeMessage(value) { return typeof value === "string" && value.length >= 1 && value.length <= 256 ? value : "EIP-1193 provider request failed"; }
