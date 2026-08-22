import { providerError } from "./standard-wallet-permissions.js";
import { StandardWalletProviderEngine } from "./standard-wallet-provider-engine.js";
import {
  createStandardWalletWalletConnectSessionSnapshot,
  parseStandardWalletWalletConnectSessionSnapshot,
  STANDARD_WALLET_WALLETCONNECT_CHAIN,
  validateStandardWalletWalletConnectSessionStorage,
  walletConnectTopic,
} from "./standard-wallet-walletconnect-storage.js";

export { STANDARD_WALLET_WALLETCONNECT_CHAIN } from "./standard-wallet-walletconnect-storage.js";
export const STANDARD_WALLET_WALLETCONNECT_METHODS = Object.freeze([
  "eth_accounts", "eth_requestAccounts", "eth_chainId", "net_version",
  "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction",
  "wallet_getPermissions", "wallet_requestPermissions", "wallet_revokePermissions", "wallet_switchEthereumChain", "wallet_addEthereumChain",
  "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice", "eth_getBalance",
  "eth_getBlockByHash", "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_getTransactionByHash",
  "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_maxPriorityFeePerGas",
]);
export const STANDARD_WALLET_WALLETCONNECT_EVENTS = Object.freeze(["accountsChanged", "chainChanged", "connect", "disconnect", "message"]);

export class StandardWalletWalletConnectSessionAdapter {
  #engine;
  #topic;
  #approvedMethods = new Set();
  #approvedEvents = new Set();
  #active = false;
  #approving = false;
  #epoch = 0;
  #storage;
  #emit;
  #listeners = new Map();
  #storageOperation = Promise.resolve();
  #closed = false;

  constructor({ engine, topic, sessionStorage, emit }) {
    if (!(engine instanceof StandardWalletProviderEngine)) throw new TypeError("WalletConnect adapter requires the shared Standard Wallet provider engine");
    if (emit !== undefined && typeof emit !== "function") throw new TypeError("WalletConnect event callback is invalid");
    this.#engine = engine;
    this.#topic = walletConnectTopic(topic);
    this.#storage = validateStandardWalletWalletConnectSessionStorage(sessionStorage);
    this.#emit = emit ?? (() => {});
    for (const event of STANDARD_WALLET_WALLETCONNECT_EVENTS) {
      const listener = (payload) => this.#handleProviderEvent(event, payload);
      this.#listeners.set(event, listener);
      this.#engine.on(event, listener);
    }
  }

  get active() { return this.#active; }
  get topic() { return this.#topic; }

  async restore() {
    this.#requireOpen();
    if (this.#active || this.#approving) throw providerError(-32000, "WalletConnect session is already active or awaiting approval");
    await this.#engine.restorePermissions();
    if (this.#storage === null) return null;
    let stored;
    try { stored = await this.#storage.load({ topic: this.#topic }); }
    catch { throw providerError(4100, "WalletConnect session storage could not be read"); }
    if (stored === null || stored === undefined) return null;
    let snapshot;
    try { snapshot = parseStandardWalletWalletConnectSessionSnapshot(stored, this.#topic); }
    catch (error) { await this.#failClosedRestore(); throw error; }
    if (!same(snapshot.accounts, this.#engine.state.accounts)) {
      await this.#failClosedRestore();
      throw providerError(4100, "WalletConnect session account authority does not match protected permission state");
    }
    this.#approvedMethods = new Set(snapshot.methods);
    this.#approvedEvents = new Set(snapshot.events);
    this.#active = true;
    return this.#session(snapshot.accounts);
  }

  async approve(proposal) {
    this.#requireOpen();
    if (this.#active || this.#approving) throw providerError(-32000, "WalletConnect session is already active or awaiting approval");
    const namespace = parseProposal(proposal);
    const epoch = this.#epoch;
    this.#approving = true;
    let accounts;
    try { accounts = await this.#engine.request({ method: "eth_requestAccounts" }); }
    catch (error) { if (epoch !== this.#epoch) throw providerError(4900, "WalletConnect approval was cancelled"); throw error; }
    finally { this.#approving = false; }
    if (epoch !== this.#epoch) {
      await this.#engine.disconnect();
      throw providerError(4900, "WalletConnect approval was cancelled");
    }
    const snapshot = createStandardWalletWalletConnectSessionSnapshot({ topic: this.#topic, methods: namespace.methods, events: namespace.events, accounts });
    if (this.#storage !== null) try { await this.#storage.save(snapshot); }
    catch { await this.#engine.disconnect(); throw providerError(4100, "WalletConnect session storage could not be updated"); }
    this.#approvedMethods = new Set(snapshot.methods);
    this.#approvedEvents = new Set(snapshot.events);
    this.#active = true;
    return this.#session(snapshot.accounts);
  }

  async reject(proposal) {
    this.#requireOpen();
    if (this.#active || this.#approving) throw providerError(-32000, "WalletConnect session is already active or awaiting approval");
    parseProposal(proposal);
    await this.#engine.disconnect();
    await this.#clearStored();
    return Object.freeze({ topic: this.#topic, rejected: true, code: 4001, authority: "walletconnect-proposal-rejected-no-authority" });
  }

  async request(envelope) {
    this.#requireOpen();
    await this.#flushStorage();
    if (!this.#active) throw providerError(4900, "WalletConnect session is not active");
    if (!object(envelope) || Object.keys(envelope).some((key) => !["topic", "chainId", "request", "id"].includes(key))) throw providerError(-32600, "WalletConnect request is invalid");
    if (envelope.topic !== this.#topic || envelope.chainId !== STANDARD_WALLET_WALLETCONNECT_CHAIN) throw providerError(4901, "WalletConnect request targets another session or chain");
    if ((!Number.isSafeInteger(envelope.id) && typeof envelope.id !== "string") || !object(envelope.request) || typeof envelope.request.method !== "string") throw providerError(-32600, "WalletConnect request is invalid");
    if (!this.#approvedMethods.has(envelope.request.method)) throw providerError(4100, "WalletConnect method was not approved");
    const result = await this.#engine.request(envelope.request);
    await this.#flushStorage();
    return result;
  }

  async disconnect() {
    this.#requireOpen();
    this.#epoch += 1;
    this.#active = false;
    await this.#engine.disconnect();
    await this.#clearStored();
    this.#approvedMethods.clear();
    this.#approvedEvents.clear();
    return Object.freeze({ topic: this.#topic, active: false, authority: "walletconnect-session-terminated" });
  }

  close() {
    if (this.#closed) return Object.freeze({ closed: false });
    for (const [event, listener] of this.#listeners) this.#engine.removeListener(event, listener);
    this.#listeners.clear();
    this.#closed = true;
    return Object.freeze({ closed: true });
  }

  #session(accounts) {
    return Object.freeze({
      topic: this.#topic,
      namespaces: Object.freeze({ eip155: Object.freeze({
        accounts: Object.freeze(accounts.map((address) => `${STANDARD_WALLET_WALLETCONNECT_CHAIN}:${address}`)),
        chains: Object.freeze([STANDARD_WALLET_WALLETCONNECT_CHAIN]),
        methods: Object.freeze([...this.#approvedMethods]),
        events: Object.freeze([...this.#approvedEvents]),
      }) }),
      authority: "walletconnect-session-approved-accounts-only",
      ynxProductSession: false,
    });
  }

  #handleProviderEvent(event, payload) {
    const wasActive = this.#active;
    if (!wasActive && this.#approvedMethods.size === 0) return;
    if (event === "accountsChanged" && Array.isArray(payload)) {
      if (payload.length === 0) {
        this.#active = false;
        this.#queueClear();
      } else this.#queueSave(payload);
    }
    if (event === "disconnect") {
      this.#active = false;
      this.#queueClear();
    }
    if (this.#approvedEvents.has(event)) try { this.#emit(Object.freeze({ topic: this.#topic, chainId: STANDARD_WALLET_WALLETCONNECT_CHAIN, event, payload })); } catch {}
    if (event === "disconnect") { this.#approvedMethods.clear(); this.#approvedEvents.clear(); }
  }

  #queueSave(accounts) {
    if (this.#storage === null) return;
    const snapshot = createStandardWalletWalletConnectSessionSnapshot({ topic: this.#topic, methods: [...this.#approvedMethods], events: [...this.#approvedEvents], accounts });
    this.#storageOperation = this.#storageOperation.then(() => this.#storage.save(snapshot));
  }
  #queueClear() { if (this.#storage !== null) this.#storageOperation = this.#storageOperation.then(() => this.#storage.clear({ topic: this.#topic })); }
  async #flushStorage() { try { await this.#storageOperation; } catch { throw providerError(4100, "WalletConnect session storage could not be updated"); } }
  async #clearStored() {
    await this.#flushStorage();
    if (this.#storage !== null) try { await this.#storage.clear({ topic: this.#topic }); }
    catch { throw providerError(4100, "WalletConnect session storage could not be cleared"); }
  }
  async #failClosedRestore() {
    try { await this.#engine.disconnect(); } finally { try { await this.#storage?.clear({ topic: this.#topic }); } catch {} }
  }
  #requireOpen() { if (this.#closed) throw providerError(4900, "WalletConnect adapter is closed"); }
}

function parseProposal(proposal) {
  if (!object(proposal) || !object(proposal.requiredNamespaces) || Object.keys(proposal.requiredNamespaces).join(",") !== "eip155") throw providerError(5100, "WalletConnect proposal must request only the eip155 namespace");
  const namespace = proposal.requiredNamespaces.eip155;
  if (!object(namespace) || Object.keys(namespace).some((key) => !["chains", "methods", "events"].includes(key))) throw providerError(5100, "WalletConnect namespace is invalid");
  if (!Array.isArray(namespace.chains) || namespace.chains.length !== 1 || namespace.chains[0] !== STANDARD_WALLET_WALLETCONNECT_CHAIN) throw providerError(5100, "WalletConnect proposal must target only YNX EVM chain 6423");
  const methods = exactSubset(namespace.methods, STANDARD_WALLET_WALLETCONNECT_METHODS, "WalletConnect methods");
  const events = exactSubset(namespace.events, STANDARD_WALLET_WALLETCONNECT_EVENTS, "WalletConnect events");
  if (!methods.includes("eth_accounts") || !methods.includes("eth_requestAccounts")) throw providerError(5100, "WalletConnect proposal must include account methods");
  return { methods, events };
}
function exactSubset(value, allowed, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length || new Set(value).size !== value.length || value.some((item) => !allowed.includes(item))) throw providerError(5100, `${label} are invalid`);
  return value;
}
function same(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
