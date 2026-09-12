// wallet-source:canonical.js
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactFields(value, expected, label) {
  if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", `${label} must be a JSON object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) throw new WalletAuthError("UNKNOWN_OR_MISSING_FIELD", `${label} fields do not match the protocol schema`);
}
var WalletAuthError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
  }
};

// wallet-source:standard-wallet-connection.js
var EIP1193_PROVIDER_CODE = Object.freeze({
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  PROVIDER_DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNKNOWN_CHAIN: 4902
});
var STANDARD_WALLET_METHODS = Object.freeze([
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
  "wallet_requestPermissions",
  "wallet_getPermissions",
  "wallet_watchAsset",
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction"
]);
var Eip1193ProviderError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Eip1193ProviderError";
    this.code = code;
  }
};
var StandardWalletConnection = class {
  #provider;
  #origin;
  #metadata;
  #listeners = /* @__PURE__ */ new Set();
  #session = null;
  #generation = 0;
  #accountsVersion = 0;
  #chainVersion = 0;
  #lastAccounts;
  #lastChain;
  #providerHandlers = /* @__PURE__ */ new Map();
  #active = true;
  constructor(config) {
    exactFields(config, ["provider", "origin", "metadata"], "Standard Wallet connection configuration");
    if (!validProvider(config.provider)) throw providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "EIP-1193 provider is unavailable");
    if (!canonicalHttpsOrigin(config.origin)) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "DApp origin must be an exact HTTPS origin");
    if (!metadata(config.metadata)) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "DApp metadata is invalid");
    this.#provider = config.provider;
    this.#origin = config.origin;
    this.#metadata = Object.freeze({ ...config.metadata });
    this.#bindProviderEvents();
  }
  get current() {
    return this.#session;
  }
  async connect() {
    const generation = ++this.#generation, accountsVersion = this.#accountsVersion;
    this.#active = true;
    this.#bindProviderEvents();
    const accounts = await this.request({ method: "eth_requestAccounts" });
    this.#assertCurrentAttempt(generation);
    const chainVersion = this.#chainVersion;
    const chainResponse = await this.request({ method: "eth_chainId" });
    this.#assertCurrentAttempt(generation);
    const account = firstAccount(this.#accountsVersion === accountsVersion ? accounts : this.#lastAccounts);
    const chainId = this.#chainVersion === chainVersion ? chainResponse : this.#lastChain;
    if (!canonicalChain(chainId)) throw providerError(EIP1193_PROVIDER_CODE.CHAIN_DISCONNECTED, "Wallet returned an invalid chain ID");
    this.#session = Object.freeze({
      version: "1.0.0",
      transport: "eip1193",
      origin: this.#origin,
      dappMetadata: this.#metadata,
      selectedAccount: account,
      selectedChain: chainId.toLowerCase(),
      approvedMethods: Object.freeze([...STANDARD_WALLET_METHODS]),
      approvedEvents: Object.freeze(["accountsChanged", "chainChanged", "connect", "disconnect", "message"]),
      connected: true
    });
    return this.#session;
  }
  async request(input) {
    const fields = Object.keys(input ?? {}).sort();
    if (fields.join("\n") !== ["method", ...Object.hasOwn(input ?? {}, "params") ? ["params"] : []].sort().join("\n") || typeof input?.method !== "string") {
      throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "Malformed EIP-1193 request");
    }
    if (input.method === "eth_sign") throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "Raw eth_sign is disabled because blind signing is unsafe");
    if (!STANDARD_WALLET_METHODS.includes(input.method)) throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "EIP-1193 method is not supported by this transport");
    try {
      return await this.#provider.request(Object.hasOwn(input, "params") ? { method: input.method, params: input.params } : { method: input.method });
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }
  disconnect() {
    this.#generation += 1;
    this.#session = null;
    this.#active = false;
    this.#unbindProviderEvents();
    this.#emit("disconnect", Object.freeze({ code: EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, message: "Wallet connection was disconnected" }));
  }
  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Standard Wallet event listener must be a function");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #bindProviderEvents() {
    if (typeof this.#provider.on !== "function") return;
    for (const event of ["accountsChanged", "chainChanged", "connect", "disconnect", "message"]) {
      if (this.#providerHandlers.has(event)) continue;
      const handler = (value) => {
        if (!this.#active) return;
        if (event === "accountsChanged") {
          this.#accountsVersion += 1;
          this.#lastAccounts = Array.isArray(value) ? [...value] : value;
          try {
            const selectedAccount = firstAccount(value);
            if (this.#session !== null) this.#session = Object.freeze({ ...this.#session, selectedAccount });
          } catch {
            this.#generation += 1;
            this.#session = null;
          }
        }
        if (event === "chainChanged") {
          this.#chainVersion += 1;
          this.#lastChain = value;
          if (canonicalChain(value)) {
            if (this.#session !== null) this.#session = Object.freeze({ ...this.#session, selectedChain: value.toLowerCase() });
          } else {
            this.#generation += 1;
            this.#session = null;
          }
        }
        if (event === "disconnect") {
          this.#generation += 1;
          this.#session = null;
        }
        this.#emit(event, value);
      };
      this.#provider.on(event, handler);
      this.#providerHandlers.set(event, handler);
    }
  }
  #unbindProviderEvents() {
    if (typeof this.#provider.removeListener !== "function") return;
    for (const [event, handler] of this.#providerHandlers) this.#provider.removeListener(event, handler);
    this.#providerHandlers.clear();
  }
  #assertCurrentAttempt(generation) {
    if (generation !== this.#generation) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet connection attempt was cancelled or account access changed");
  }
  #emit(event, value) {
    for (const listener of this.#listeners) {
      try {
        listener(Object.freeze({ event, value }));
      } catch {
      }
    }
  }
};
function validProvider(value) {
  try {
    return typeof value === "object" && value !== null && typeof value.request === "function";
  } catch {
    return false;
  }
}
function canonicalHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}
function metadata(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join("\n") === ["name", "url"].join("\n") && typeof value.name === "string" && value.name.trim() === value.name && value.name.length >= 1 && value.name.length <= 128 && canonicalHttpsOrigin(value.url);
}
function canonicalChain(value) {
  return typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value);
}
function firstAccount(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1024 || typeof value[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value[0])) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet did not approve a valid EVM account");
  return value[0].toLowerCase();
}
function providerError(code, message) {
  return new Eip1193ProviderError(code, message);
}
function normalizeProviderError(error) {
  const code = (() => {
    try {
      return Number(error?.code);
    } catch {
      return NaN;
    }
  })();
  if (Object.values(EIP1193_PROVIDER_CODE).includes(code)) return providerError(code, safeMessage(error?.message));
  return providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "EIP-1193 provider request failed");
}
function safeMessage(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 ? value : "EIP-1193 provider request failed";
}

// wallet-source:wallet-provider-discovery.js
var WALLET_PROVIDER_DISCOVERY_AUTHORITY = "unverified-injected-candidate";
var WALLET_PROVIDER_KIND = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });
var YNX_RDNS = /* @__PURE__ */ new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
var METAMASK_RDNS = /* @__PURE__ */ new Set(["io.metamask", "io.metamask.flask"]);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var discoveryStates = /* @__PURE__ */ new WeakMap();
function discoverInjectedWalletProviders(scope = globalThis) {
  const ethereum = safely(() => scope?.ethereum);
  const declaredProviders = safely(() => ethereum?.providers);
  const raw = Array.isArray(declaredProviders) ? declaredProviders : ethereum === void 0 ? [] : [ethereum];
  return selectWalletProviderCandidates(raw.map((provider) => candidate(provider, safely(() => provider?.providerInfo), "legacy-injected")).filter(Boolean));
}
async function discoverEip6963WalletProviders(scope = globalThis, waitMs = 160) {
  validWait(waitMs);
  const add = safely(() => scope?.addEventListener), dispatch = safely(() => scope?.dispatchEvent);
  if (typeof add !== "function" || typeof dispatch !== "function") return selectWalletProviderCandidates([]);
  let state = discoveryStates.get(scope);
  try {
    if (!state) {
      state = { byUuid: /* @__PURE__ */ new Map(), conflicted: /* @__PURE__ */ new Set(), announcedProviders: /* @__PURE__ */ new WeakSet() };
      const { byUuid, conflicted, announcedProviders } = state;
      const listener = (event) => {
        const detail = safely(() => event?.detail), info = safely(() => detail?.info), provider = safely(() => detail?.provider);
        if (validProvider2(provider)) announcedProviders.add(provider);
        const item = candidate(provider, info, "eip6963");
        const uuid = canonicalUuid(safely(() => info?.uuid));
        if (!item || uuid === null || conflicted.has(uuid)) return;
        const previous = byUuid.get(uuid);
        if (previous && previous.provider !== provider) {
          byUuid.delete(uuid);
          conflicted.add(uuid);
          return;
        }
        byUuid.set(uuid, item);
      };
      add.call(scope, "eip6963:announceProvider", listener);
      discoveryStates.set(scope, state);
    }
    const EventConstructor = safely(() => scope?.Event) ?? globalThis.Event;
    if (typeof EventConstructor !== "function") return selectWalletProviderCandidates([]);
    dispatch.call(scope, new EventConstructor("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } catch {
    return selectWalletProviderCandidates([]);
  }
  return selectWalletProviderCandidates([...state.byUuid.values()], state.conflicted.size);
}
async function discoverWalletProviders(scope = globalThis, waitMs = 160) {
  const announced = await discoverEip6963WalletProviders(scope, waitMs);
  const injected = discoverInjectedWalletProviders(scope);
  const announcedProviders = discoveryStates.get(scope)?.announcedProviders;
  return selectWalletProviderCandidates(uniqueProviders([
    announced.ynx,
    announced.metamask,
    ...announced.candidates,
    ...injected.candidates.filter((item) => !announcedProviders?.has(item.provider))
  ].filter(Boolean)), announced.conflictedAnnouncements + injected.conflictedAnnouncements);
}
function selectWalletProviderCandidates(input, conflictedAnnouncements = 0) {
  if (!Array.isArray(input) || !Number.isSafeInteger(conflictedAnnouncements) || conflictedAnnouncements < 0) throw new TypeError("Wallet provider candidates are invalid");
  const candidates = uniqueProviders(input.filter(validCandidate));
  const ynxCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.YNX);
  const metaMaskCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.METAMASK);
  const ambiguities = [];
  if (ynxCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.YNX);
  if (metaMaskCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.METAMASK);
  return Object.freeze({
    ynx: ynxCandidates.length === 1 ? ynxCandidates[0] : null,
    metamask: metaMaskCandidates.length === 1 ? metaMaskCandidates[0] : null,
    candidates: Object.freeze(candidates),
    ambiguities: Object.freeze(ambiguities),
    conflictedAnnouncements,
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY
  });
}
function candidate(provider, info, source) {
  if (!validProvider2(provider) || source !== "eip6963" && source !== "legacy-injected") return null;
  const providerInfo = object(info) ? info : null;
  const announcedRdns = canonicalRdns(safely(() => providerInfo?.rdns));
  const embeddedRdnsValue = safely(() => provider?.providerInfo?.rdns) ?? safely(() => provider?.rdns);
  const embeddedRdns = canonicalRdns(embeddedRdnsValue);
  if (embeddedRdnsValue !== void 0 && embeddedRdnsValue !== null && embeddedRdns === null) return null;
  if (source === "eip6963" && announcedRdns !== null && embeddedRdns !== null && announcedRdns !== embeddedRdns) return null;
  const rdns = source === "eip6963" ? announcedRdns : embeddedRdns;
  const ynxFlag = safely(() => provider?.isYNXWallet) === true || safely(() => provider?.isYnxWallet) === true;
  const metaMaskFlag = safely(() => provider?.isMetaMask) === true;
  if (rdns !== null && YNX_RDNS.has(rdns) && !ynxFlag || rdns !== null && METAMASK_RDNS.has(rdns) && ynxFlag) return null;
  const ynx = rdns !== null && YNX_RDNS.has(rdns) && ynxFlag;
  const metamask = !ynx && !ynxFlag && (rdns !== null && METAMASK_RDNS.has(rdns) || source === "legacy-injected" && rdns === null && metaMaskFlag);
  if (!ynx && !metamask) return null;
  if (ynxFlag && metaMaskFlag) return null;
  const uuid = source === "eip6963" ? canonicalUuid(safely(() => providerInfo?.uuid)) : null;
  if (source === "eip6963" && uuid === null) return null;
  return Object.freeze({
    kind: ynx ? WALLET_PROVIDER_KIND.YNX : WALLET_PROVIDER_KIND.METAMASK,
    provider,
    source,
    uuid,
    rdns,
    name: canonicalName(safely(() => providerInfo?.name)),
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY
  });
}
function uniqueProviders(input) {
  const seen = /* @__PURE__ */ new Set(), output = [];
  for (const item of input) if (validCandidate(item) && !seen.has(item.provider)) {
    seen.add(item.provider);
    output.push(item);
  }
  return output;
}
function validCandidate(value) {
  return object(value) && validProvider2(safely(() => value.provider)) && Object.values(WALLET_PROVIDER_KIND).includes(safely(() => value.kind)) && safely(() => value.authority) === WALLET_PROVIDER_DISCOVERY_AUTHORITY;
}
function validProvider2(value) {
  return object(value) && typeof safely(() => value.request) === "function";
}
function canonicalUuid(value) {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
function canonicalRdns(value) {
  return typeof value === "string" && value === value.toLowerCase() && /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/.test(value) && value.length <= 253 ? value : null;
}
function canonicalName(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 64 && value.trim() === value ? value : null;
}
function validWait(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2e3) throw new TypeError("Wallet provider discovery wait must be between 0 and 2000 milliseconds");
}
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safely(read) {
  try {
    return read();
  } catch {
    return void 0;
  }
}
export {
  StandardWalletConnection,
  discoverWalletProviders
};
