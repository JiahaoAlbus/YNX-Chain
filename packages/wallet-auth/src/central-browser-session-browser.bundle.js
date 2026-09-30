(() => {
  // node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function abytes(value, length, title = "") {
    const bytes = isBytes(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes ? `length=${len}` : `type=${typeof value}`;
      const message2 = prefix + "expected Uint8Array" + ofLen + ", got " + got;
      if (!bytes)
        throw new TypeError(message2);
      throw new RangeError(message2);
    }
    return value;
  }
  var hasHexBuiltin = /* @__PURE__ */ (() => (
    // @ts-ignore
    typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
  ))();
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += hexes[bytes[i]];
    }
    return hex;
  }

  // src/canonical.js
  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }
  function exactFields(value, expected, label) {
    if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", `${label} must be a JSON object`);
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.join("\n") !== wanted.join("\n")) throw new WalletAuthError("UNKNOWN_OR_MISSING_FIELD", `${label} fields do not match the protocol schema`);
  }
  function canonicalJSON(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new WalletAuthError("INVALID_NUMBER", "Protocol numbers must be safe integers");
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
    if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", "Protocol value is not canonical JSON");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  }
  var WalletAuthError = class extends Error {
    constructor(code, message2) {
      super(message2);
      this.name = "WalletAuthError";
      this.code = code;
    }
  };

  // src/protocol.js
  var MAX_REQUEST_LIFETIME_MS = 5 * 60 * 1e3;

  // src/crypto.js
  var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function evmAddressFromYNX(account) {
    if (typeof account !== "string" || account !== account.toLowerCase() || !account.startsWith("ynx1")) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account is invalid");
    const encoded = account.slice(4);
    const values = [...encoded].map((character) => CHARSET.indexOf(character));
    if (values.length !== 38 || values.some((value) => value < 0) || polymod([...hrpExpand("ynx"), ...values]) !== 1) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account checksum is invalid");
    const data = values.slice(0, -6);
    const payload = convertBitsStrict(data, 5, 8);
    if (payload.length !== 20) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account payload is invalid");
    return `0x${bytesToHex(Uint8Array.from(payload))}`;
  }
  function convertBitsStrict(data, fromBits, toBits) {
    let accumulator = 0, bits = 0;
    const result = [], maxValue = (1 << toBits) - 1, maxAccumulator = (1 << fromBits + toBits - 1) - 1;
    for (const value of data) {
      if (!Number.isInteger(value) || value < 0 || value >= 1 << fromBits) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account data is invalid");
      accumulator = (accumulator << fromBits | value) & maxAccumulator;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        result.push(accumulator >> bits & maxValue);
      }
    }
    if (bits >= fromBits || (accumulator << toBits - bits & maxValue) !== 0) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account padding is invalid");
    return result;
  }
  function hrpExpand(hrp) {
    return [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  }
  function polymod(values) {
    const generators = [996825010, 642813549, 513874426, 1027748829, 705979059];
    let checksum = 1;
    for (const value of values) {
      const top = checksum >>> 25;
      checksum = ((checksum & 33554431) << 5 ^ value) >>> 0;
      generators.forEach((generator, index) => {
        if (top >>> index & 1) checksum = (checksum ^ generator) >>> 0;
      });
    }
    return checksum >>> 0;
  }

  // src/standard-wallet-connection.js
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
    "wallet_revokePermissions",
    "wallet_watchAsset",
    "eth_requestAccounts",
    "eth_accounts",
    "eth_chainId",
    "personal_sign",
    "eth_signTypedData_v4",
    "eth_sendTransaction"
  ]);
  var Eip1193ProviderError = class extends Error {
    constructor(code, message2, data) {
      super(message2);
      this.name = "Eip1193ProviderError";
      this.code = code;
      if (data) this.data = Object.freeze(data);
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
    // Access-loss events cancel reads; only explicit intents supersede revocation,
    // whose expected effects include accountsChanged([]) and disconnect events.
    #intent = 0;
    #revocation = null;
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
    connect() {
      return this.#establish("eth_requestAccounts", false);
    }
    /** Silently query only the constructor-selected provider; never request a grant. */
    restore() {
      return this.#establish("eth_accounts", true);
    }
    async #establish(method, allowEmpty) {
      this.#intent += 1;
      const generation = ++this.#generation, accountsVersion = this.#accountsVersion;
      this.#active = true;
      this.#bindProviderEvents();
      const accounts = await this.#requestForAttempt({ method }, generation);
      this.#assertCurrentAttempt(generation);
      const observedAccounts = this.#accountsVersion === accountsVersion ? accounts : this.#lastAccounts;
      if (allowEmpty && Array.isArray(observedAccounts) && observedAccounts.length === 0) {
        this.#session = null;
        return null;
      }
      firstAccount(observedAccounts);
      const chainVersion = this.#chainVersion;
      const chainResponse = await this.#requestForAttempt({ method: "eth_chainId" }, generation);
      this.#assertCurrentAttempt(generation);
      const account = firstAccount(this.#accountsVersion === accountsVersion ? accounts : this.#lastAccounts);
      const chainId = this.#chainVersion === chainVersion ? chainResponse : this.#lastChain;
      if (!canonicalChain(chainId)) throw providerError(EIP1193_PROVIDER_CODE.CHAIN_DISCONNECTED, "Wallet returned an invalid chain ID");
      this.#session = Object.freeze({
        version: "1.0.0",
        transport: "eip1193",
        origin: this.#origin,
        dappMetadata: this.#metadata,
        // Legacy capability fields do not assert that all listed methods are granted.
        selectedAccount: account,
        selectedChain: chainId.toLowerCase(),
        approvedMethods: Object.freeze([...STANDARD_WALLET_METHODS]),
        approvedEvents: Object.freeze(["accountsChanged", "chainChanged", "connect", "disconnect", "message"]),
        connected: true
      });
      return this.#session;
    }
    async #requestForAttempt(input, generation) {
      this.#assertCurrentAttempt(generation);
      try {
        return await this.request(input);
      } catch (error) {
        this.#assertCurrentAttempt(generation);
        throw error;
      }
    }
    /**
     * Explicitly revoke eth_accounts, then confirm both empty account exposure
     * and absence of its permission. A locked wallet can hide still-granted accounts.
     * permissionRevoked=false means unconfirmed, not that a remote grant remains.
     * disconnect() is a separate local action. Neither revokes token approvals.
     */
    revoke() {
      if (this.#revocation?.intent === this.#intent) return this.#revocation.promise;
      const operation = { intent: ++this.#intent, promise: null };
      this.#generation += 1;
      this.#revocation = operation;
      operation.promise = Promise.resolve().then(() => this.#revoke(operation)).finally(() => {
        if (this.#revocation === operation) this.#revocation = null;
      });
      return operation.promise;
    }
    async #revoke(operation) {
      let stage = "revoke";
      try {
        this.#assertRevocation(operation);
        const response = await this.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
        this.#assertRevocation(operation);
        if (!revokeAcknowledged(response)) throw providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "Wallet returned an invalid revocation acknowledgement");
        stage = "readback";
        const accountsVersion = this.#accountsVersion;
        const accounts = await this.request({ method: "eth_accounts" });
        this.#assertRevocation(operation);
        const assertAccountsAbsent = () => {
          if (!Array.isArray(accounts) || accounts.length !== 0 || accountsVersion !== this.#accountsVersion && (!Array.isArray(this.#lastAccounts) || this.#lastAccounts.length !== 0)) {
            throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet account revocation was not confirmed");
          }
        };
        assertAccountsAbsent();
        this.#assertRevocation(operation);
        const permissions = await this.request({ method: "wallet_getPermissions" });
        this.#assertRevocation(operation);
        if (!accountPermissionAbsent(permissions)) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet permission revocation was not confirmed");
        assertAccountsAbsent();
        this.#assertRevocation(operation);
        this.#revocation = null;
        this.disconnect();
        return this.#revokeResult("revoked", true);
      } catch (error) {
        if (operation.intent !== this.#intent) return this.#revokeResult(
          "superseded",
          false,
          providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet revocation was superseded by a newer connection intent")
        );
        const normalized = normalizeProviderError(error);
        const status2 = stage === "revoke" && normalized.code === EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD ? "unsupported" : stage === "revoke" && normalized.code === EIP1193_PROVIDER_CODE.USER_REJECTED ? "rejected" : "failed";
        return this.#revokeResult(status2, false, normalized);
      }
    }
    #assertRevocation(operation) {
      if (operation.intent !== this.#intent) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet revocation was superseded");
    }
    #revokeResult(status2, permissionRevoked, error) {
      return Object.freeze({
        status: status2,
        permissionRevoked,
        locallyDisconnected: this.#session === null,
        ...error ? { error: Object.freeze({ code: error.code, message: error.message }) } : {}
      });
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
        throw normalizeProviderError(error, this.#provider, input.method);
      }
    }
    disconnect() {
      this.#intent += 1;
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
          if (!this.#active || this.#providerHandlers.get(event) !== handler) return;
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
        this.#providerHandlers.set(event, handler);
        this.#provider.on(event, handler);
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
  function revokeAcknowledged(value) {
    return value === null || typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Object.keys(value).length === 0;
  }
  function accountPermissionAbsent(value) {
    if (!Array.isArray(value) || value.length > 1024) return false;
    for (let i = 0; i < value.length; i++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(i));
      if (!entry || !Object.hasOwn(entry, "value")) return false;
      const item = entry.value;
      if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
      const field = Object.getOwnPropertyDescriptor(item, "parentCapability");
      if (!field || !Object.hasOwn(field, "value")) return false;
      const capability = field.value;
      if (typeof capability !== "string" || capability.length < 1 || capability.length > 256 || capability === "eth_accounts") return false;
    }
    return true;
  }
  function providerError(code, message2, data) {
    return new Eip1193ProviderError(code, message2, data);
  }
  function ynxAccountRecovery(error, provider, method) {
    if (method !== "eth_requestAccounts" && method !== "wallet_requestPermissions") return false;
    try {
      return error?.code === "PROVIDER_ACCOUNT_UNAVAILABLE" && provider?.__ynxCompanion === true && provider.isYNXWallet === true && provider.isMetaMask === false && provider.providerInfo?.rdns === "com.ynx.wallet";
    } catch {
      return false;
    }
  }
  function normalizeProviderError(error, provider, method) {
    if (ynxAccountRecovery(error, provider, method)) {
      return providerError(
        EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED,
        "Open the YNX Wallet extension account vault to check existing accounts, or create or restore one if none is available, then retry.",
        { walletCode: "PROVIDER_ACCOUNT_UNAVAILABLE", stage: method, recovery: "open-wallet-vault" }
      );
    }
    const code = (() => {
      try {
        return Number(error?.code);
      } catch {
        return NaN;
      }
    })();
    if (code === -32601) return providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "EIP-1193 method is not supported by this provider");
    if (Object.values(EIP1193_PROVIDER_CODE).includes(code)) return providerError(code, safeMessage(error?.message));
    return providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "EIP-1193 provider request failed");
  }
  function safeMessage(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 256 ? value : "EIP-1193 provider request failed";
  }

  // src/product-session-registry.js
  var PRODUCT_SESSION_PLATFORMS = Object.freeze(["android", "ios", "linux", "macos", "web", "windows"]);

  // src/metamask-evm-adapter.js
  var METAMASK_EVM_CONNECTION_STATUS = Object.freeze({
    CONNECTED: "connected-evm"
  });
  var METAMASK_EVM_CHAIN_QUANTITY = "0x1917";
  var METAMASK_EVM_CHAIN = Object.freeze({
    chainId: METAMASK_EVM_CHAIN_QUANTITY,
    chainName: "YNX Testnet",
    nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
    rpcUrls: Object.freeze(["https://rpc-testnet.ynxweb4.com", "https://evm.ynxweb4.com"]),
    blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"])
  });
  var LIMITATIONS = Object.freeze([
    "evm-provider-only",
    "no-ynx-product-session",
    "no-wallet-ai-gateway-session",
    "no-native-ynx-account-authority"
  ]);

  // src/wallet-provider-discovery.js
  var WALLET_PROVIDER_DISCOVERY_AUTHORITY = "unverified-injected-candidate";
  var WALLET_PROVIDER_KIND = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });
  var YNX_RDNS = /* @__PURE__ */ new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
  var METAMASK_RDNS = /* @__PURE__ */ new Set(["io.metamask", "io.metamask.flask"]);
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function createWalletProviderDiscovery(scope = globalThis) {
    const add = safely(() => scope?.addEventListener), remove = safely(() => scope?.removeEventListener);
    const dispatch = safely(() => scope?.dispatchEvent);
    const byUuid = /* @__PURE__ */ new Map(), conflicted = /* @__PURE__ */ new Set(), announcedProviders = /* @__PURE__ */ new WeakSet(), listeners = /* @__PURE__ */ new Set();
    let disposed = false, revision2 = 0;
    const snapshot = () => selectWalletProviderCandidates(uniqueProviders([
      ...byUuid.values(),
      ...discoverInjectedWalletProviders(scope).candidates.filter((item) => !announcedProviders.has(item.provider))
    ]), conflicted.size);
    const publish = () => {
      const value = Object.freeze({ ...snapshot(), revision: ++revision2 });
      for (const listener of [...listeners]) listener(value);
      return value;
    };
    const announce = (event) => {
      if (disposed) return;
      const detail = safely(() => event?.detail), info = safely(() => detail?.info), provider = safely(() => detail?.provider);
      if (validProvider2(provider)) announcedProviders.add(provider);
      const item = candidate(provider, info, "eip6963"), uuid = canonicalUuid(safely(() => info?.uuid));
      if (!item || uuid === null || conflicted.has(uuid)) return;
      const previous = byUuid.get(uuid);
      if (previous?.provider === provider) return;
      if (previous && previous.provider !== provider) {
        byUuid.delete(uuid);
        conflicted.add(uuid);
        publish();
        return;
      }
      byUuid.set(uuid, item);
      publish();
    };
    if (typeof add === "function") add.call(scope, "eip6963:announceProvider", announce);
    const request2 = () => {
      if (disposed) throw new TypeError("Wallet provider discovery is disposed");
      const EventConstructor = safely(() => scope?.Event) ?? globalThis.Event;
      if (typeof dispatch === "function" && typeof EventConstructor === "function") {
        dispatch.call(scope, new EventConstructor("eip6963:requestProvider"));
      }
      return snapshot();
    };
    const subscribe = (listener, options = {}) => {
      if (disposed || typeof listener !== "function") throw new TypeError("Wallet provider discovery listener is invalid");
      listeners.add(listener);
      if (options.emitCurrent !== false) listener(Object.freeze({ ...snapshot(), revision: revision2 }));
      return () => listeners.delete(listener);
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      byUuid.clear();
      conflicted.clear();
      if (typeof remove === "function") remove.call(scope, "eip6963:announceProvider", announce);
    };
    request2();
    return Object.freeze({ request: request2, snapshot, subscribe, dispose, get disposed() {
      return disposed;
    } });
  }
  function discoverInjectedWalletProviders(scope = globalThis) {
    const ethereum = safely(() => scope?.ethereum);
    const declaredProviders = safely(() => ethereum?.providers);
    const raw = Array.isArray(declaredProviders) ? declaredProviders : ethereum === void 0 ? [] : [ethereum];
    return selectWalletProviderCandidates(raw.map((provider) => candidate(provider, safely(() => provider?.providerInfo), "legacy-injected")).filter(Boolean));
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

  // src/central-browser-session-registry.js
  var CENTRAL_BROWSER_ISSUER = "https://wallet-auth.ynxweb4.com";
  var ADOPTED = Object.freeze(["finance", "exchange", "quant"]);
  function centralBrowserClient(registry, input) {
    exactFields(input, ["clientId", "origin", "redirectUri"], "Central browser client");
    const client = registry.find((value) => value.clientId === input.clientId);
    if (!client || client.origin !== input.origin || client.redirectUri !== input.redirectUri) fail("SSO_CLIENT_NOT_REGISTERED");
    return client;
  }
  function fail(code) {
    throw new WalletAuthError(code, "Central browser client is not exactly registered");
  }

  // src/central-browser-session-contract.js
  var CENTRAL_BROWSER_PURPOSE = "Sign in to registered YNX official apps in this browser. Identity only; no automatic signing, transfers or sensitive product scopes.";
  var token = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
  function parseCentralBrowserSignInChallenge(challenge2, registry, { peerOrigin, now = Date.now() } = {}) {
    exactFields(challenge2, ["version", "issuer", "purpose", "challengeId", "browserBinding", "nonce", "initiator", "clients", "issuedAt", "expiresAt"], "Central browser challenge");
    if (challenge2.version !== 1 || challenge2.issuer !== CENTRAL_BROWSER_ISSUER || peerOrigin !== CENTRAL_BROWSER_ISSUER || challenge2.purpose !== CENTRAL_BROWSER_PURPOSE || !token(challenge2.challengeId) || !token(challenge2.nonce) || typeof challenge2.browserBinding !== "string" || !/^[a-f0-9]{64}$/.test(challenge2.browserBinding)) fail2("SSO_CHALLENGE_INVALID");
    const initiator = challenge2.initiator;
    exactFields(initiator, ["clientId", "origin", "redirectUri", "state", "codeChallenge", "codeChallengeMethod"], "Central browser initiator");
    centralBrowserClient(registry, { clientId: initiator.clientId, origin: initiator.origin, redirectUri: initiator.redirectUri });
    if (!token(initiator.state) || !token(initiator.codeChallenge) || initiator.codeChallengeMethod !== "S256") fail2("SSO_TRANSACTION_INVALID");
    const clients = registry.map((value) => ({ clientId: value.clientId, origin: value.origin, audience: value.audience, scopes: [...value.scopes] })).sort((a, b) => a.clientId.localeCompare(b.clientId));
    if (canonicalJSON(challenge2.clients) !== canonicalJSON(clients)) fail2("SSO_CLIENTS_MISMATCH");
    const issued = Date.parse(challenge2.issuedAt), expires = Date.parse(challenge2.expiresAt);
    if (!Number.isSafeInteger(now) || !Number.isFinite(issued) || !Number.isFinite(expires) || new Date(issued).toISOString() !== challenge2.issuedAt || new Date(expires).toISOString() !== challenge2.expiresAt || issued > now + 3e4 || expires <= now || expires <= issued || expires - issued > 12e4) fail2("SSO_CHALLENGE_EXPIRED");
    return Object.freeze(structuredClone(challenge2));
  }
  function parseCentralBrowserSignInApproval(approval) {
    exactFields(approval, ["challengeId", "account", "accountPublicKey", "walletSignature"], "Central browser approval");
    if (!token(approval.challengeId) || typeof approval.account !== "string" || !/^ynx1[a-z0-9]{38}$/.test(approval.account) || typeof approval.accountPublicKey !== "string" || !/^0[23][a-f0-9]{64}$/.test(approval.accountPublicKey) || typeof approval.walletSignature !== "string" || !/^([a-f0-9]{128})$/.test(approval.walletSignature)) fail2("SSO_SIGNATURE_INVALID");
    return Object.freeze({ ...approval });
  }
  function fail2(code) {
    throw new WalletAuthError(code, "Central browser sign-in contract was rejected");
  }

  // src/central-browser-session-browser.js
  var context = JSON.parse(document.getElementById("context").textContent);
  var challenge = parseCentralBrowserSignInChallenge(context.challenge, context.registry, { peerOrigin: location.origin });
  var picker = document.getElementById("wallet");
  var approve = document.getElementById("approve");
  var cancel = document.getElementById("cancel");
  var status = document.getElementById("status");
  var discovery = createWalletProviderDiscovery(window);
  var restart = document.createElement("button");
  restart.id = "restart";
  restart.hidden = true;
  restart.textContent = "Return to product and retry";
  cancel.after(restart);
  restart.addEventListener("click", () => cancel.click());
  var providers = [];
  var selected = null;
  var pending = null;
  var revision = 0;
  var cancelled = false;
  var message = (value) => {
    status.textContent = value;
  };
  var request = async (path, input) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1e4);
    try {
      const response = await fetch(`/v2/browser-sessions/${path}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-ynx-browser-csrf": context.csrfToken }, body: canonicalJSON(input), signal: controller.signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.code ?? "SSO_REQUEST_FAILED");
      return value;
    } finally {
      clearTimeout(timer);
    }
  };
  discovery.subscribe((snapshot) => {
    providers = snapshot.candidates.filter((value) => value.kind === WALLET_PROVIDER_KIND.YNX).map((value) => value.provider);
    const previous = selected;
    picker.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose YNX Wallet";
    picker.append(placeholder);
    providers.forEach((provider, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `YNX Wallet ${index + 1}`;
      picker.append(option);
    });
    if (previous && providers.includes(previous)) {
      picker.value = String(providers.indexOf(previous));
    } else if (previous) {
      selected = null;
      revision++;
    }
    approve.disabled = !selected || cancelled;
    if (!providers.length) message("YNX Wallet is not available. Install or unlock it, then try again.");
  });
  picker.addEventListener("change", () => {
    selected = picker.value === "" ? null : providers[Number(picker.value)];
    revision++;
    approve.disabled = !selected || cancelled;
    message(pending ? "Finish or cancel the current request before switching wallets." : "Connection is separate from browser sign-in approval.");
  });
  approve.addEventListener("click", () => {
    if (pending) {
      message("Your request is already open in YNX Wallet.");
      return;
    }
    if (!selected || cancelled) return;
    const provider = selected, epoch = revision;
    let account = null, chain = null, invalid = false, unsubscribe = () => {
    };
    const operationAbort = new AbortController();
    const walletWait = async (work) => {
      let timer, onAbort;
      try {
        return await Promise.race([work, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("SSO_REQUEST_TIMEOUT")), Math.max(1, Math.min(3e4, Date.parse(challenge.expiresAt) - Date.now())));
          onAbort = () => reject(new Error("SSO_CONTEXT_CHANGED"));
          operationAbort.signal.addEventListener("abort", onAbort, { once: true });
        })]);
      } finally {
        clearTimeout(timer);
        operationAbort.signal.removeEventListener("abort", onAbort);
      }
    };
    const connection = new StandardWalletConnection({ provider, origin: location.origin, metadata: { name: "YNX browser sign-in", url: location.origin } });
    const changed = () => {
      invalid = true;
      revision++;
      operationAbort.abort();
    };
    const assert = () => {
      if (cancelled || invalid || epoch !== revision || selected !== provider) throw new Error("SSO_CONTEXT_CHANGED");
      if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error("SSO_CHALLENGE_EXPIRED");
    };
    message("Opening YNX Wallet. Unlock and review browser sign-in.");
    approve.setAttribute("aria-busy", "true");
    pending = (async () => {
      assert();
      await walletWait(connection.connect());
      assert();
      if (connection.current?.selectedChain !== METAMASK_EVM_CHAIN.chainId) {
        try {
          await walletWait(connection.request({ method: "wallet_switchEthereumChain", params: [{ chainId: METAMASK_EVM_CHAIN.chainId }] }));
        } catch (error) {
          assert();
          if (Number(error?.code) !== 4902) throw error;
          await walletWait(connection.request({ method: "wallet_addEthereumChain", params: [METAMASK_EVM_CHAIN] }));
          assert();
          await walletWait(connection.request({ method: "wallet_switchEthereumChain", params: [{ chainId: METAMASK_EVM_CHAIN.chainId }] }));
        }
        assert();
        await walletWait(connection.restore());
        assert();
      }
      account = connection.current?.selectedAccount;
      chain = connection.current?.selectedChain;
      if (!account || chain !== METAMASK_EVM_CHAIN.chainId) throw new Error("PROVIDER_WRONG_CHAIN");
      unsubscribe = connection.subscribe((event) => {
        if (["accountsChanged", "chainChanged", "disconnect"].includes(event.event)) changed();
      });
      const approval = parseCentralBrowserSignInApproval(await walletWait(provider.request({ method: "ynx_requestCentralBrowserSignIn", params: [challenge] })));
      assert();
      const current = await walletWait(provider.request({ method: "eth_accounts" })), currentChain = await walletWait(provider.request({ method: "eth_chainId" }));
      assert();
      if (!Array.isArray(current) || current[0]?.toLowerCase() !== account || currentChain !== chain || approval.challengeId !== challenge.challengeId || evmAddressFromYNX(approval.account).toLowerCase() !== account) throw new Error("SSO_CONTEXT_CHANGED");
      await request("complete", approval);
      assert();
      message("Sign-in approved. Returning to your product.");
      location.reload();
    })().catch(async (error) => {
      if (error?.message === "SSO_REQUEST_TIMEOUT" || error?.message === "SSO_CHALLENGE_EXPIRED") {
        invalid = true;
        revision++;
        operationAbort.abort();
        approve.disabled = true;
        restart.hidden = false;
      }
      if (invalid || cancelled || epoch !== revision) {
        approve.disabled = true;
        restart.hidden = false;
        try {
          await request("cancel", { challengeId: challenge.challengeId });
        } catch {
        }
      }
      if (!cancelled) message(error?.code === 4001 || error?.code === "USER_REJECTED" ? "Sign-in was declined. Your existing product permissions are unchanged." : `Sign-in could not finish (${error?.message === "SSO_CONTEXT_CHANGED" ? "context changed" : error?.message === "SSO_CHALLENGE_EXPIRED" ? "request expired" : error?.message === "SSO_REQUEST_TIMEOUT" ? "request timed out" : "wallet or service unavailable"}). Retry or cancel.`);
    }).finally(() => {
      operationAbort.abort();
      unsubscribe();
      connection.disconnect();
      pending = null;
      approve.removeAttribute("aria-busy");
    });
  });
  cancel.addEventListener("click", async () => {
    if (cancelled) return;
    cancelled = true;
    revision++;
    approve.disabled = true;
    cancel.disabled = true;
    message("Cancelling this sign-in request\u2026");
    try {
      const result = await request("cancel", { challengeId: challenge.challengeId });
      const redirect = new URL(result.redirectUri);
      if (redirect.origin !== challenge.initiator.origin || redirect.pathname !== new URL(challenge.initiator.redirectUri).pathname || redirect.searchParams.get("state") !== challenge.initiator.state || redirect.searchParams.get("error") !== "access_denied") throw new Error("SSO_REDIRECT_INVALID");
      location.assign(redirect.href);
    } catch {
      message("Cancellation is not confirmed. Retry cancellation; no late approval will be used on this page.");
      cancelled = false;
      cancel.disabled = false;
    }
  });
  window.addEventListener("pagehide", () => {
    revision++;
    cancelled = true;
    discovery.dispose();
  });
})();
