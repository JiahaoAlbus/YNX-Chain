var YNXResourceWallet = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // web/wallet-connectivity.js
  var wallet_connectivity_exports = {};
  __export(wallet_connectivity_exports, {
    connectStandardWallet: () => connectStandardWallet,
    productSessionBoundary: () => productSessionBoundary
  });

  // ../../packages/dapp-connect-sdk/src/constants.js
  var YNX_TESTNET = Object.freeze({
    cosmosChainId: "ynx_6423-1",
    evmChainId: 6423,
    evmChainHex: "0x1917",
    nativeAsset: "YNXT",
    externalAccountFormat: "0x-prefixed EVM account only"
  });
  var WALLET_PROTOCOL_REFERENCE = Object.freeze({
    version: "p0-wallet-connection-v1",
    sourceCommit: "66003e76e804da16d472255efde50cb879055b96",
    contractPath: "packages/wallet-auth/integration/p0-wallet-connectivity-candidate.json"
  });
  var EIP1193_METHODS = Object.freeze({
    accounts: "eth_requestAccounts",
    chainId: "eth_chainId",
    addChain: "wallet_addEthereumChain",
    switchChain: "wallet_switchEthereumChain",
    sign: "personal_sign",
    signTypedData: "eth_signTypedData_v4",
    sendTransaction: "eth_sendTransaction"
  });

  // ../../packages/dapp-connect-sdk/src/errors.js
  var EIP1193_CODES = /* @__PURE__ */ new Map([
    [4001, "WALLET_USER_REJECTED"],
    [4100, "WALLET_UNAUTHORIZED"],
    [4200, "WALLET_UNSUPPORTED_METHOD"],
    [4900, "WALLET_DISCONNECTED"],
    [4901, "WALLET_CHAIN_DISCONNECTED"]
  ]);
  var PROTOCOL_CODES = /* @__PURE__ */ new Set(["UNKNOWN_OR_MISSING_FIELD", "NON_CANONICAL_JSON", "INVALID_JSON", "INVALID_FIELD", "INVALID_PROOF_HEADER"]);
  var DEVICE_CODES = /* @__PURE__ */ new Set(["INVALID_DEVICE_PROOF", "INVALID_DEVICE_KEY", "DEVICE_MISMATCH", "SESSION_BINDING_MISMATCH"]);
  var EXPIRY_CODES = /* @__PURE__ */ new Set(["EXPIRED", "INVALID_EXPIRY", "INVALID_TIME", "ISSUED_IN_FUTURE"]);
  var GATEWAY_STATUSES = /* @__PURE__ */ new Set([502, 503, 504]);
  var DAppConnectError = class extends Error {
    constructor(code, message, { cause, requestId, traceId, errorId, details } = {}) {
      super(message, { cause });
      this.name = "DAppConnectError";
      this.code = code;
      this.requestId = requestId;
      this.traceId = traceId;
      this.errorId = errorId;
      this.details = details;
    }
  };
  function classifyWalletError(error) {
    const status = Number(error?.status ?? error?.response?.status);
    const serverCode = error?.code ?? error?.response?.data?.code;
    const correlation = { requestId: error?.requestId ?? error?.response?.headers?.["x-request-id"], traceId: error?.traceId ?? error?.response?.headers?.["x-trace-id"], errorId: error?.errorId ?? error?.response?.headers?.["x-error-id"] };
    if (EIP1193_CODES.has(Number(serverCode))) return new DAppConnectError(EIP1193_CODES.get(Number(serverCode)), error?.message || "Wallet request failed", { cause: error, ...correlation });
    if (DEVICE_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_DEVICE_PROOF_REJECTED", error?.message || "Product Session device proof was rejected", { cause: error, ...correlation });
    if (PROTOCOL_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_PROTOCOL_REJECTED", error?.message || "Product Session protocol was rejected", { cause: error, ...correlation });
    if (EXPIRY_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW", error?.message || "Product Session expired or clock is incorrect", { cause: error, ...correlation });
    if (GATEWAY_STATUSES.has(status) || error?.name === "AbortError" || error?.network === true) return new DAppConnectError("PRODUCT_SESSION_GATEWAY_UNREACHABLE", error?.message || "Product Session gateway is unreachable", { cause: error, ...correlation });
    return new DAppConnectError(serverCode || "WALLET_CONNECTION_FAILED", error?.message || "Wallet connection failed", { cause: error, ...correlation });
  }

  // ../../packages/dapp-connect-sdk/src/provider.js
  function validAddress(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
  }
  function assertProvider(provider) {
    if (!provider || typeof provider.request !== "function") throw new DAppConnectError("PROVIDER_REQUIRED", "A standard EIP-1193 wallet provider is required.");
  }
  var StandardWalletConnection = class {
    constructor(provider, { chain = YNX_TESTNET } = {}) {
      assertProvider(provider);
      this.provider = provider;
      this.chain = chain;
      this.account = null;
      this.chainId = null;
    }
    async connect() {
      try {
        const accounts = await this.provider.request({ method: EIP1193_METHODS.accounts });
        if (!Array.isArray(accounts) || !validAddress(accounts[0])) throw new DAppConnectError("INVALID_EVM_ACCOUNT", "Wallet did not return an approved 0x EVM account.");
        this.account = accounts[0];
        this.chainId = await this.provider.request({ method: EIP1193_METHODS.chainId });
        return { account: this.account, chainId: this.chainId, state: "STANDARD_CONNECTED" };
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async ensureYNXTestnet({ addChain } = {}) {
      try {
        const current = await this.provider.request({ method: EIP1193_METHODS.chainId });
        if (String(current).toLowerCase() === this.chain.evmChainHex) return { chainId: current, switched: false };
        try {
          await this.provider.request({ method: EIP1193_METHODS.switchChain, params: [{ chainId: this.chain.evmChainHex }] });
        } catch (error) {
          if (Number(error?.code) !== 4902 || !addChain) throw error;
          await this.provider.request({ method: EIP1193_METHODS.addChain, params: [addChain] });
        }
        this.chainId = await this.provider.request({ method: EIP1193_METHODS.chainId });
        if (String(this.chainId).toLowerCase() !== this.chain.evmChainHex) throw new DAppConnectError("WRONG_CHAIN", "Wallet did not switch to YNX Testnet.");
        return { chainId: this.chainId, switched: true };
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async signMessage(message, account = this.account) {
      if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.sign, params: [message, account] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async signTypedData(typedData, account = this.account) {
      if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.signTypedData, params: [account, JSON.stringify(typedData)] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async sendTransaction(transaction) {
      if (!this.account) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before sending a transaction.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.sendTransaction, params: [{ ...transaction, from: transaction.from || this.account }] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    on(event, listener) {
      if (typeof this.provider.on !== "function") throw new DAppConnectError("PROVIDER_EVENTS_UNSUPPORTED", "Wallet provider does not expose EIP-1193 events.");
      this.provider.on(event, listener);
      return () => this.provider.removeListener?.(event, listener);
    }
  };

  // ../../packages/dapp-connect-sdk/src/discovery.js
  async function discoverEIP6963(windowLike, { timeoutMs = 250 } = {}) {
    if (!windowLike?.addEventListener || !windowLike?.dispatchEvent) throw new DAppConnectError("DISCOVERY_ENVIRONMENT_REQUIRED", "EIP-6963 discovery requires a browser event target.");
    const providers2 = /* @__PURE__ */ new Map();
    const receive = (event) => {
      const detail = event?.detail;
      if (detail?.info?.uuid && detail?.provider?.request) providers2.set(detail.info.uuid, detail);
    };
    windowLike.addEventListener("eip6963:announceProvider", receive);
    windowLike.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    windowLike.removeEventListener("eip6963:announceProvider", receive);
    return [...providers2.values()];
  }

  // web/wallet-connectivity.js
  async function providers(windowLike) {
    const announced = await discoverEIP6963(windowLike, { timeoutMs: 220 });
    const injected = windowLike.ethereum;
    if (injected?.request && !announced.some((entry) => entry.provider === injected)) {
      announced.push({
        info: { uuid: "legacy-injected", name: injected.isMetaMask ? "MetaMask" : "Injected wallet" },
        provider: injected
      });
    }
    return announced;
  }
  function choose(entries, preference) {
    const pattern = preference === "metamask" ? /metamask/i : /ynx/i;
    return entries.find((entry) => pattern.test(entry.info?.name || "")) || (preference === "ynx" ? entries[0] : null);
  }
  async function connectStandardWallet(windowLike, preference = "ynx") {
    const runtime = windowLike.YNX_RESOURCE_RUNTIME;
    if (!runtime || runtime.manifestStatus !== "ACCEPTED_BUNDLED_CONSUMER_CONTRACT") {
      throw new Error("The accepted YNX endpoint manifest is unavailable. Wallet connection stopped safely.");
    }
    const entry = choose(await providers(windowLike), preference);
    if (!entry) throw new Error(preference === "metamask" ? "MetaMask was not detected. Install MetaMask or connect YNX Wallet." : "YNX Wallet was not detected. Download YNX Wallet or use MetaMask.");
    const connection = new StandardWalletConnection(entry.provider, { chain: YNX_TESTNET });
    const connected = await connection.connect();
    await connection.ensureYNXTestnet({ addChain: {
      chainId: runtime.evmChainHex,
      chainName: "YNX Testnet",
      nativeCurrency: { name: "YNX Testnet", symbol: runtime.nativeAsset, decimals: 18 },
      rpcUrls: [runtime.evmRpc],
      blockExplorerUrls: [runtime.explorer]
    } });
    return { connection, connected, providerName: entry.info?.name || "EVM Wallet" };
  }
  var productSessionBoundary = Object.freeze({
    state: "PRIVATE_SERVICE_DEGRADED",
    localFallbackCreated: false,
    privateSettlementEnabled: false
  });
  return __toCommonJS(wallet_connectivity_exports);
})();
