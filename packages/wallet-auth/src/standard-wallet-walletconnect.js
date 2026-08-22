import { providerError } from "./standard-wallet-permissions.js";
import { StandardWalletProviderEngine } from "./standard-wallet-provider-engine.js";

export const STANDARD_WALLET_WALLETCONNECT_CHAIN = "eip155:6423";
export const STANDARD_WALLET_WALLETCONNECT_METHODS = Object.freeze([
  "eth_accounts", "eth_requestAccounts", "eth_chainId", "net_version",
  "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction",
  "wallet_getPermissions", "wallet_requestPermissions", "wallet_switchEthereumChain", "wallet_addEthereumChain",
  "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice", "eth_getBalance",
  "eth_getBlockByHash", "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_getTransactionByHash",
  "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_maxPriorityFeePerGas",
]);
export const STANDARD_WALLET_WALLETCONNECT_EVENTS = Object.freeze(["accountsChanged", "chainChanged", "connect", "disconnect", "message"]);

export class StandardWalletWalletConnectSessionAdapter {
  #engine;
  #topic;
  #approvedMethods = new Set();
  #active = false;
  #approving = false;
  #epoch = 0;

  constructor({ engine, topic }) {
    if (!(engine instanceof StandardWalletProviderEngine)) throw new TypeError("WalletConnect adapter requires the shared Standard Wallet provider engine");
    this.#engine = engine;
    this.#topic = token(topic, "WalletConnect topic");
  }

  get active() { return this.#active; }
  get topic() { return this.#topic; }

  async approve(proposal) {
    if (this.#active || this.#approving) throw providerError(-32000, "WalletConnect session is already active or awaiting approval");
    const namespace = parseProposal(proposal);
    const epoch = this.#epoch;
    this.#approving = true;
    let accounts;
    try { accounts = await this.#engine.request({ method: "eth_requestAccounts" }); }
    finally { this.#approving = false; }
    if (epoch !== this.#epoch) {
      this.#engine.disconnect();
      throw providerError(4900, "WalletConnect approval was cancelled");
    }
    this.#approvedMethods = new Set(namespace.methods); this.#active = true;
    return Object.freeze({
      topic: this.#topic,
      namespaces: Object.freeze({
        eip155: Object.freeze({
          accounts: Object.freeze(accounts.map((address) => `${STANDARD_WALLET_WALLETCONNECT_CHAIN}:${address}`)),
          chains: Object.freeze([STANDARD_WALLET_WALLETCONNECT_CHAIN]),
          methods: Object.freeze([...namespace.methods]),
          events: Object.freeze([...namespace.events]),
        }),
      }),
      authority: "walletconnect-session-approved-accounts-only",
      ynxProductSession: false,
    });
  }

  async request(envelope) {
    if (!this.#active) throw providerError(4900, "WalletConnect session is not active");
    if (!object(envelope) || Object.keys(envelope).some((key) => !["topic", "chainId", "request", "id"].includes(key))) throw providerError(-32600, "WalletConnect request is invalid");
    if (envelope.topic !== this.#topic || envelope.chainId !== STANDARD_WALLET_WALLETCONNECT_CHAIN) throw providerError(4901, "WalletConnect request targets another session or chain");
    if ((!Number.isSafeInteger(envelope.id) && typeof envelope.id !== "string") || !object(envelope.request) || typeof envelope.request.method !== "string") throw providerError(-32600, "WalletConnect request is invalid");
    if (!this.#approvedMethods.has(envelope.request.method)) throw providerError(4100, "WalletConnect method was not approved");
    return this.#engine.request(envelope.request);
  }

  disconnect() {
    this.#epoch += 1;
    if (this.#active) this.#engine.disconnect();
    this.#active = false;
    this.#approvedMethods.clear();
    return Object.freeze({ topic: this.#topic, active: false, authority: "walletconnect-session-terminated" });
  }
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
function token(value, label) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
