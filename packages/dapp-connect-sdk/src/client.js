import {YNX_TESTNET} from "./constants.js";
import {discoverEIP6963} from "./discovery.js";
import {DAppConnectError, classifyWalletError} from "./errors.js";
import {loadBundledManifest, diagnostics as endpointDiagnostics} from "./endpoints.js";
import {StandardWalletConnection, connectWithWalletConnect} from "./provider.js";
import {enhanceWithProductSession} from "./session.js";

function requireConnection(connection) {
  if (!connection) throw new DAppConnectError("CONNECTION_REQUIRED", "Connect a standard EIP-1193 wallet first.");
  return connection;
}

/**
 * One consumer-facing surface for standard wallets. It owns no keys and never
 * turns an optional Product Session or endpoint candidate into a requirement.
 */
export class DAppConnectClient {
  constructor({provider, chain = YNX_TESTNET, endpointManifest, productSession, opener} = {}) {
    this.chain = chain;
    this.connection = provider ? new StandardWalletConnection(provider, {chain}) : null;
    this.endpointManifest = endpointManifest;
    this.productSession = productSession;
    this.opener = opener;
    this.listeners = new Set();
  }

  emit(event) { for (const listener of this.listeners) listener(Object.freeze({...event})); }
  watchConnection(listener) { if (typeof listener !== "function") throw new DAppConnectError("CONNECTION_LISTENER_REQUIRED", "A connection listener is required."); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getConnection() { return this.connection; }
  async discoverWallets(windowLike, options) { return discoverEIP6963(windowLike, options); }
  async connectWallet({provider, walletConnect, request, addChain} = {}) {
    try {
      if (walletConnect) this.connection = await connectWithWalletConnect(walletConnect, request);
      else if (provider) this.connection = new StandardWalletConnection(provider, {chain: this.chain});
      const connection = requireConnection(this.connection);
      const result = await connection.connect();
      if (addChain) await connection.ensureYNXTestnet({addChain});
      this.emit({type: "connected", ...result});
      return result;
    } catch (error) { throw classifyWalletError(error); }
  }
  async reconnectWallet(options) { return this.connectWallet(options); }
  async disconnectWallet({disconnectWalletConnect} = {}) {
    const previous = this.connection;
    if (disconnectWalletConnect) await disconnectWalletConnect();
    this.connection = null;
    this.emit({type: "disconnected", account: previous?.account ?? null});
    return {state: "STANDARD_DISCONNECTED"};
  }
  getAccounts() { return this.connection?.account ? [this.connection.account] : []; }
  async requestAccounts() { return (await requireConnection(this.connection).connect()).account ? this.getAccounts() : []; }
  async getChainId() { return requireConnection(this.connection).provider.request({method: "eth_chainId"}); }
  async switchChain(chainId = this.chain.evmChainHex, options = {}) { if (String(chainId).toLowerCase() !== this.chain.evmChainHex) throw new DAppConnectError("WRONG_CHAIN", "Only the configured YNX chain can be selected by this helper."); return requireConnection(this.connection).ensureYNXTestnet(options); }
  async addChain(chain) { return requireConnection(this.connection).provider.request({method: "wallet_addEthereumChain", params: [chain]}); }
  async getPermissions() { return requireConnection(this.connection).provider.request({method: "wallet_getPermissions"}); }
  async requestPermissions(permissions) { return requireConnection(this.connection).provider.request({method: "wallet_requestPermissions", params: [permissions]}); }
  signMessage(...args) { return requireConnection(this.connection).signMessage(...args); }
  signTypedData(...args) { return requireConnection(this.connection).signTypedData(...args); }
  sendTransaction(...args) { return requireConnection(this.connection).sendTransaction(...args); }
  watchAsset(asset) { return requireConnection(this.connection).provider.request({method: "wallet_watchAsset", params: asset}); }
  async openWallet(target) { if (typeof this.opener !== "function") throw new DAppConnectError("WALLET_OPEN_UNAVAILABLE", "Provide an approved wallet opener for this platform."); return this.opener(target); }
  async openWalletFaucet(target) { const manifest = await this.loadEndpointManifest(); if (!manifest?.endpoints?.faucet) throw new DAppConnectError("FAUCET_DEEP_LINK_NOT_ACCEPTED", "Faucet deep links remain unavailable until the signed endpoint manifest is accepted."); return this.openWallet(target || manifest.endpoints.faucet); }
  async upgradeToYNXProductSession({complete} = {}) { const result = await enhanceWithProductSession({standardConnection: requireConnection(this.connection), complete: complete || this.productSession?.complete}); if (result.state === "PRODUCT_SESSION_READY") this.productSession = {...this.productSession, session: result.session}; this.emit({type: "product-session", ...result}); return result; }
  async revokeYNXProductSession({revoke} = {}) { const operation = revoke || this.productSession?.revoke; if (typeof operation !== "function") throw new DAppConnectError("PRODUCT_SESSION_REVOKE_UNAVAILABLE", "A Product Session revoke operation is required."); const result = await operation(this.productSession?.session); this.productSession = null; this.emit({type: "product-session-revoked"}); return result ?? {state: "PRODUCT_SESSION_REVOKED"}; }
  getServiceStatus() { return {standardConnection: this.connection?.account ? "CONNECTED" : "DISCONNECTED", productSession: this.productSession?.session ? "READY" : "NOT_ACTIVE", endpointManifest: endpointDiagnostics(this.endpointManifest)}; }
  async loadEndpointManifest(options = {}) { return loadBundledManifest(this.endpointManifest, options); }
  async runConnectivityDiagnostics(options = {}) { return endpointDiagnostics(this.endpointManifest, {...options, connection: this.connection}); }
}
