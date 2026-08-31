import { exactFields, WalletAuthError } from "./canonical.js";
import { MetaMaskEvmConnectionAdapter } from "./metamask-evm-adapter.js";
import { PRODUCT_SESSION_CLIENT_STATE, RecoverableProductSessionClient } from "./product-session-recovery.js";
import { migrateLegacyCallback, parseProductSessionRegistry, productPlatformBinding } from "./product-session-registry.js";
import { discoverWalletProviders, walletAvailabilityFromDiscovery } from "./wallet-provider-discovery.js";

export const WALLET_CONNECTION_COORDINATOR_STATUS = Object.freeze({
  OPTIONS_READY: "options-ready",
  SESSION_STATE: "session-state",
  WALLET_OPENED: "wallet-opened",
  WALLET_OPEN_FAILED: "wallet-open-failed",
  YNX_WALLET_PREFERRED: "ynx-wallet-preferred",
  EVM_CONNECTED: "evm-connected",
  EVM_UNAVAILABLE: "evm-unavailable",
});

export class WalletConnectionCoordinator {
  #registry; #productId; #client; #scope; #waitMs; #openWallet; #openTimeoutMs; #openOperation; #ynxOperation;
  constructor(config) {
    exactFields(config, ["registry", "productId", "sessionClient", "scope", "discoveryWaitMs", "openWallet", "openTimeoutMs"], "Wallet connection coordinator configuration");
    this.#registry = parseProductSessionRegistry(config.registry);
    if (typeof config.productId !== "string" || !this.#registry.products.some((item) => item.productId === config.productId)) fail("UNKNOWN_PRODUCT", "Wallet connection product is not registered");
    if (!(config.sessionClient instanceof RecoverableProductSessionClient) || config.sessionClient.connectionBinding.productId !== config.productId) fail("CROSS_PRODUCT_REUSE", "Wallet connection coordinator requires the exact product session client");
    const binding = productPlatformBinding(this.#registry, config.productId, config.sessionClient.connectionBinding.platform);
    if (binding.platform !== "web" && !new URL(binding.callback).protocol.startsWith("ynx")) fail("INVALID_CALLBACK_SCHEME", "Wallet connection callbacks must use the registered YNX application scheme");
    if ((typeof config.scope !== "object" && typeof config.scope !== "function") || config.scope === null) fail("INVALID_WALLET_SCOPE", "Wallet provider discovery scope is invalid");
    if (!Number.isSafeInteger(config.discoveryWaitMs) || config.discoveryWaitMs < 0 || config.discoveryWaitMs > 2000) fail("INVALID_WALLET_SCOPE", "Wallet provider discovery wait is invalid");
    if (typeof config.openWallet !== "function") fail("INVALID_WALLET_OPENER", "Wallet connection coordinator requires a platform opener");
    if (!Number.isSafeInteger(config.openTimeoutMs) || config.openTimeoutMs < 10 || config.openTimeoutMs > 30000) fail("INVALID_WALLET_OPENER", "Wallet opener timeout is invalid");
    this.#productId = config.productId; this.#client = config.sessionClient; this.#scope = config.scope; this.#waitMs = config.discoveryWaitMs; this.#openWallet = config.openWallet; this.#openTimeoutMs = config.openTimeoutMs; this.#openOperation = null; this.#ynxOperation = null;
  }

  get current() { return this.#client.current; }
  get storageKey() { return this.#client.storageKey; }
  get connectionBinding() { return this.#client.connectionBinding; }

  async options() {
    const [discovery, environment] = await Promise.all([discoverWalletProviders(this.#scope, this.#waitMs), this.#client.detectWalletEnvironment()]);
    const injected = walletAvailabilityFromDiscovery(discovery);
    const availability = Object.freeze({ ynxWalletInstalled: environment.walletInstalled || injected.ynxWalletInstalled, metaMaskAvailable: injected.metaMaskAvailable });
    const choices = this.#client.connectionChoices(availability);
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.OPTIONS_READY, discovery, environment, availability, choices });
  }

  async restore(networkAvailable = true) { return this.#runYNXOperation(() => this.#client.restore(networkAvailable)); }
  async beginYNX() { return this.#runYNXOperation(() => this.#client.beginDetected(false)); }
  async beginLegacyYNX(legacyCallback) {
    let migration;
    try {
      migration = migrateLegacyCallback(this.#registry, legacyCallback, { productId: this.#productId, platform: this.#client.connectionBinding.platform });
    } catch (error) {
      if (error instanceof WalletAuthError && (error.code === "UNKNOWN_LEGACY_SCHEME" || error.code === "CALLBACK_MISMATCH")) {
        const code = "SCHEME_NOT_REGISTERED";
        return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPEN_FAILED, code, message: coordinatorErrorMessage(code), actions: coordinatorActions(code) });
      }
      throw error;
    }
    return frozen({ ...(await this.beginYNX()), migration });
  }
  async retryYNX() { return this.#runYNXOperation(() => this.#client.retryDetected()); }
  async handleReturn(url) { return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: await this.#runYNXReturn(url) }); }
  setNetworkAvailable(available) { return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: this.#client.setNetworkAvailable(available) }); }
  enterGuest() { return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: this.#client.enterGuest() }); }
  async disconnect() { return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: await this.#client.disconnect() }); }

  async connectMetaMask() {
    const optionState = await this.options(), { discovery, environment, choices } = optionState;
    if (environment.walletInstalled || discovery.ynx !== null) return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.YNX_WALLET_PREFERRED, code: "YNX_WALLET_PREFERRED", message: "YNX Wallet is available and remains the preferred Wallet", actions: ["open-ynx-wallet", "guest", "return-to-product"], discovery, environment, choices });
    if (discovery.metamask === null) {
      const ambiguous = discovery.ambiguities.includes("metamask"), download = choices.find((item) => item.id === "metamask" && item.action === "download-evm-wallet");
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.EVM_UNAVAILABLE, code: ambiguous ? "AMBIGUOUS_WALLET_PROVIDER" : "WALLET_PROVIDER_NOT_INJECTED", message: ambiguous ? "Multiple MetaMask providers require an explicit platform chooser" : "MetaMask was not injected into this page; unlock or enable the extension, grant site access, and retry", actions: ambiguous ? ["retry", "guest", "return-to-product"] : ["unlock-extension", "grant-site-access", "enable-extension", "retry", "download-metamask", "guest", "return-to-product"], ...(download ? { downloadUrl: download.url } : {}), discovery, environment, choices });
    }
    try {
      const connection = await new MetaMaskEvmConnectionAdapter({ registry: this.#registry, productId: this.#productId, provider: discovery.metamask.provider }).connect();
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.EVM_CONNECTED, connection, discovery, environment, choices });
    } catch (error) {
      const code = error instanceof WalletAuthError ? error.code : "WALLET_UNAVAILABLE";
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.EVM_UNAVAILABLE, code, message: coordinatorErrorMessage(code), actions: coordinatorActions(code), discovery, environment, choices });
    }
  }

  async #openIfConnecting(sessionState) {
    if (sessionState.status !== PRODUCT_SESSION_CLIENT_STATE.CONNECTING) return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState });
    if (this.#openOperation?.nonce === sessionState.request.nonce) return this.#openOperation.promise;
    const operation = this.#open(sessionState);
    this.#openOperation = Object.freeze({ nonce: sessionState.request.nonce, promise: operation });
    try { return await operation; }
    finally { if (this.#openOperation?.promise === operation) this.#openOperation = null; }
  }
  async #open(sessionState) {
    const route = sessionState.route, requestId = `req_ps_open_${sessionState.request.nonce}`;
    try {
      const result = await withTimeout(this.#openWallet(Object.freeze({ url: route.url, request: sessionState.request, requestId, automatic: sessionState.automatic === true, productId: this.#productId, platform: this.#client.connectionBinding.platform })), this.#openTimeoutMs);
      exactFields(result, result?.opened === true ? ["opened"] : ["opened", "code"], "Wallet opener result");
      if (result.opened !== true) fail(openerCode(result.code), "Platform did not open the registered Wallet route");
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED, requestId, url: route.url, automatic: sessionState.automatic === true, sessionState });
    } catch (error) {
      const code = error instanceof WalletAuthError ? error.code : "WALLET_OPEN_FAILED";
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPEN_FAILED, requestId, code, message: coordinatorErrorMessage(code), actions: coordinatorActions(code), sessionState });
    }
  }
  async #runYNXOperation(start) {
    const active = this.#ynxOperation;
    if (active !== null) {
      if (active.kind === "start") return active.promise;
      await active.promise;
      if (this.#client.current.status === PRODUCT_SESSION_CLIENT_STATE.CONNECTED) return this.#openIfConnecting(this.#client.current);
    }
    const operation = (async () => this.#openIfConnecting(await start()))();
    this.#ynxOperation = Object.freeze({ kind: "start", promise: operation });
    try { return await operation; }
    finally { if (this.#ynxOperation?.promise === operation) this.#ynxOperation = null; }
  }
  async #runYNXReturn(url) {
    const active = this.#ynxOperation;
    if (active !== null) {
      if (active.kind === "return" && active.url === url) return active.promise;
      await active.promise;
    }
    const operation = this.#client.handleReturn(url);
    this.#ynxOperation = Object.freeze({ kind: "return", url, promise: operation });
    try { return await operation; }
    finally { if (this.#ynxOperation?.promise === operation) this.#ynxOperation = null; }
  }
}

function openerCode(value) { return ["WALLET_NOT_INSTALLED", "SCHEME_NOT_REGISTERED", "NETWORK_UNAVAILABLE", "USER_REJECTED"].includes(value) ? value : "WALLET_OPEN_FAILED"; }
function coordinatorActions(code) { if (code === "WALLET_NOT_INSTALLED" || code === "METAMASK_NOT_INSTALLED") return ["download", "guest", "return-to-product"]; if (code === "WALLET_PROVIDER_NOT_INJECTED") return ["unlock-extension", "grant-site-access", "enable-extension", "retry", "download", "guest", "return-to-product"]; if (code === "SCHEME_NOT_REGISTERED") return ["download", "retry", "return-to-product"]; if (code === "USER_REJECTED") return ["guest", "retry", "return-to-product"]; return ["retry", "return-to-product"]; }
function coordinatorErrorMessage(code) { return ({ WALLET_NOT_INSTALLED: "Wallet is not installed", SCHEME_NOT_REGISTERED: "Wallet scheme is not registered", NETWORK_UNAVAILABLE: "Network is unavailable", USER_REJECTED: "Wallet connection was rejected; no session was created", WALLET_OPEN_TIMEOUT: "Wallet did not answer before the platform timeout", METAMASK_NOT_INSTALLED: "MetaMask is not installed", WALLET_PROVIDER_NOT_INJECTED: "Wallet provider was not injected; unlock or enable it, grant site access, and retry", AMBIGUOUS_WALLET_PROVIDER: "Wallet provider selection is ambiguous", EVM_NOT_SUPPORTED: "This product is not registered for an EVM Wallet connection", WRONG_NETWORK: "Wallet did not switch to YNX EVM chain 6423", WALLET_UNAVAILABLE: "Wallet provider is unavailable" })[code] ?? "Wallet route could not be opened"; }
async function withTimeout(promise, timeoutMs) { let timer; try { return await Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new WalletAuthError("WALLET_OPEN_TIMEOUT", "Wallet opener timed out")), timeoutMs); })]); } finally { clearTimeout(timer); } }
function frozen(input) { const output = { ...input }; if (Array.isArray(output.actions)) output.actions = Object.freeze([...output.actions]); return Object.freeze(output); }
function fail(code, message) { throw new WalletAuthError(code, message); }
