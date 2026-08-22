import { STANDARD_WALLET_CHAIN_ID, STANDARD_WALLET_PRIVATE_SERVICE } from "./standard-wallet-connect-state.js";
import { StandardWalletProviderEventModel, normalizeStandardWalletAddress } from "./standard-wallet-provider-events.js";
import { StandardWalletJsonRpcRouter, STANDARD_WALLET_NETWORK } from "./standard-wallet-json-rpc.js";
import { StandardWalletPermissionController, canonicalWalletOrigin } from "./standard-wallet-permissions.js";

export const STANDARD_WALLET_PROVIDER_AUTHORITY = "standard-wallet-eip1193";

export class StandardWalletProviderEngine {
  #origin;
  #permissions;
  #router;
  #events;
  #connected = false;
  #rpcStatus = "not-run";
  #privateService = STANDARD_WALLET_PRIVATE_SERVICE.NOT_REQUESTED;

  constructor(config) {
    if (!object(config)) throw new TypeError("Standard Wallet provider configuration is invalid");
    this.#origin = canonicalWalletOrigin(config.origin);
    this.#permissions = new StandardWalletPermissionController({ origin: this.#origin, walletAccounts: config.walletAccounts, approveAccounts: config.approveAccounts, storage: config.permissionStorage });
    this.#router = new StandardWalletJsonRpcRouter({ permissions: this.#permissions, rpcTransport: config.rpcTransport, signMessage: config.signMessage, signTypedData: config.signTypedData, sendTransaction: config.sendTransaction });
    this.#events = new StandardWalletProviderEventModel();
  }

  get isYNXWallet() { return true; }
  get chainId() { return STANDARD_WALLET_CHAIN_ID; }
  get selectedAddress() { return this.#permissions.accounts[0] ?? null; }
  get authority() { return STANDARD_WALLET_PROVIDER_AUTHORITY; }
  get state() {
    return Object.freeze({ origin: this.#origin, connected: this.#connected, chainId: STANDARD_WALLET_CHAIN_ID, accounts: this.#permissions.accounts, rpcStatus: this.#rpcStatus, privateService: this.#privateService, authority: STANDARD_WALLET_PROVIDER_AUTHORITY });
  }

  on(name, listener) { this.#events.on(name, listener); return this; }
  once(name, listener) { this.#events.once(name, listener); return this; }
  removeListener(name, listener) { this.#events.removeListener(name, listener); return this; }

  async request(input) {
    const before = this.#permissions.accounts;
    const output = await this.#router.request(input);
    if (input?.method === "eth_requestAccounts" || input?.method === "wallet_requestPermissions") {
      const becameConnected = !this.#connected && this.#permissions.accounts.length > 0;
      this.#connected = this.#permissions.accounts.length > 0;
      if (!same(before, this.#permissions.accounts) && becameConnected) this.#events.emit("accountsChanged", this.#permissions.accounts);
      if (becameConnected) this.#events.emit("connect", { chainId: STANDARD_WALLET_CHAIN_ID });
    }
    if (input?.method === "wallet_revokePermissions" && before.length > 0) {
      this.#connected = false;
      this.#events.emit("accountsChanged", []);
      this.#events.emit("disconnect", { code: 4900, message: "Wallet permissions were revoked" });
    }
    return output;
  }

  async restorePermissions() {
    const before = this.#permissions.accounts;
    const restored = await this.#permissions.restore();
    const becameConnected = !this.#connected && restored.length > 0;
    this.#connected = restored.length > 0;
    if (!same(before, restored)) this.#events.emit("accountsChanged", restored);
    if (becameConnected) this.#events.emit("connect", { chainId: STANDARD_WALLET_CHAIN_ID });
    return this.state;
  }

  async replaceWalletAccounts(accounts) {
    const before = this.#permissions.accounts;
    const approved = await this.#permissions.replaceWalletAccountsPersisted(accounts);
    if (!same(before, approved)) this.#events.emit("accountsChanged", approved);
    if (approved.length === 0 && this.#connected) this.#disconnect(4900, "Approved Wallet accounts are no longer available", false);
    return this.state;
  }

  setRpcStatus(status) {
    if (status !== "ready" && status !== "degraded") throw new TypeError("Wallet RPC status is invalid");
    this.#rpcStatus = status;
    this.#events.emit("message", { type: "ynx_rpcStatus", data: Object.freeze({ status }) });
    return this.state;
  }

  setPrivateServiceStatus(status) {
    if (!Object.values(STANDARD_WALLET_PRIVATE_SERVICE).includes(status)) throw new TypeError("Private service status is invalid");
    this.#privateService = status;
    this.#events.emit("message", { type: "ynx_privateServiceStatus", data: Object.freeze({ status }) });
    return this.state;
  }

  async notifyChainChanged(chainId) {
    if (typeof chainId !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(chainId)) throw new TypeError("Wallet chainId is invalid");
    const normalized = chainId.toLowerCase();
    this.#events.emit("chainChanged", normalized);
    if (normalized !== STANDARD_WALLET_CHAIN_ID && this.#connected) {
      await this.#permissions.revokePersisted();
      this.#events.emit("accountsChanged", []);
      this.#disconnect(4901, "Wallet changed away from YNX Testnet", false);
    }
    return this.state;
  }

  async disconnect() {
    const hadAccounts = this.#permissions.accounts.length > 0;
    await this.#permissions.revokePersisted();
    this.#connected = false;
    if (hadAccounts) this.#events.emit("accountsChanged", []);
    this.#events.emit("disconnect", { code: 4900, message: "Wallet disconnected" });
    return this.state;
  }

  #disconnect(code, message, revoke) {
    if (revoke) this.#permissions.revoke();
    this.#connected = false;
    if (revoke) this.#events.emit("accountsChanged", []);
    this.#events.emit("disconnect", { code, message });
  }
}

export function standardWalletEip6963Announcement(provider, uuid) {
  if (!(provider instanceof StandardWalletProviderEngine) || typeof uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) throw new TypeError("YNX Wallet EIP-6963 announcement is invalid");
  return Object.freeze({ info: Object.freeze({ uuid: uuid.toLowerCase(), name: "YNX Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "com.ynx.wallet" }), provider });
}

export { STANDARD_WALLET_NETWORK };
function same(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
