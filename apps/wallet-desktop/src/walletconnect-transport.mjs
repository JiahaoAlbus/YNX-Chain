import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { getSdkError } from "@walletconnect/utils";

export const WALLETCONNECT_CHAIN = "eip155:6423";
export const WALLETCONNECT_METHODS = Object.freeze(["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]);
export const WALLETCONNECT_EVENTS = Object.freeze(["accountsChanged", "chainChanged"]);
const TOMBSTONE_STORAGE_KEY = "ynx-wallet:walletconnect-disconnected-topics:v1";

export class WalletConnectTransport {
  constructor({ projectId, metadata, walletKitFactory = defaultFactory, clock = () => Date.now() }) {
    this.projectId = projectId?.trim() || null;
    this.metadata = metadata;
    this.walletKitFactory = walletKitFactory;
    this.clock = clock;
    this.walletKit = null;
    this.proposals = new Map();
    this.proposalActions = new Set();
    this.sessionOrigins = new Map();
    this.disconnectedTopics = new Set();
    this.tombstoneWrites = Promise.resolve();
  }
  status() {
    const started = this.walletKit !== null;
    const relayConnected = this.walletKit?.core?.relayer?.connected === true;
    return Object.freeze({
      configured: this.projectId !== null,
      started,
      relayConnected,
      activeSessionCount: started ? Object.values(this.walletKit.getActiveSessions?.() ?? {}).filter(session => !this.disconnectedTopics.has(session.topic)).length : 0,
      code: !this.projectId ? "WALLETCONNECT_PROJECT_ID_UNAVAILABLE" : relayConnected ? null : "WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED"
    });
  }
  async start(handlers = {}) {
    if (!this.projectId) throw transportError("WALLETCONNECT_PROJECT_ID_UNAVAILABLE", "WalletConnect project ID is not configured");
    this.walletKit = await this.walletKitFactory({ projectId: this.projectId, metadata: this.metadata });
    try { await this.#restoreDisconnectedTopics(); }
    catch (error) { this.walletKit = null; throw error; }
    this.walletKit.on("session_proposal", proposal => {
      try {
        validateProposal(proposal, this.#nowSeconds());
        proposalHttpsOrigin(proposal);
        this.proposals.set(String(proposal.id), proposal);
        handlers.onSessionProposal?.(proposal);
      } catch (error) {
        handlers.onProposalInvalid?.({ id: proposal?.id ?? null, code: error?.code ?? "INVALID_WALLETCONNECT_PROPOSAL" });
      }
    });
    this.walletKit.on("session_request", event => handlers.onSessionRequest?.(event));
    this.walletKit.on("session_delete", async event => {
      const origin = this.sessionOrigins.get(event.topic) ?? null;
      const persisted = this.#tombstoneTopic(event.topic);
      try { await handlers.onSessionDelete?.({ ...event, origin }); } finally { await persisted; }
    });
    this.walletKit.on("session_request_expire", event => handlers.onRequestExpire?.(event));
    for (const session of Object.values(this.walletKit.getActiveSessions?.() ?? {})) {
      if (this.disconnectedTopics.has(session.topic)) continue;
      const restored = this.#rememberSession(session);
      handlers.onSessionRestore?.(restored);
    }
    return this.status();
  }
  async pair(uri) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    if (typeof uri !== "string" || !/^wc:[0-9a-f-]+@2\?/.test(uri) || uri.length > 8192) throw transportError("INVALID_WALLETCONNECT_URI", "WalletConnect pairing URI is invalid");
    return this.walletKit.pair({ uri });
  }
  async approveSession(id, account) {
    const proposal = this.proposals.get(String(id));
    if (!proposal) throw transportError("UNKNOWN_WALLETCONNECT_PROPOSAL", "WalletConnect proposal is unknown or expired");
    const key = String(id);
    if (this.proposalActions.has(key)) throw transportError("WALLETCONNECT_PROPOSAL_ACTION_IN_PROGRESS", "WalletConnect proposal already has an approval or rejection in progress");
    this.proposalActions.add(key);
    try {
      const approved = validateProposal(proposal, this.#nowSeconds());
      const approvedAccount = normalizeAccount(account);
      const session = await this.walletKit.approveSession({ id: proposal.id, namespaces: {
        eip155: {
          chains: [WALLETCONNECT_CHAIN],
          accounts: [`${WALLETCONNECT_CHAIN}:${approvedAccount}`],
          methods: approved.methods,
          events: approved.events
        }
      } });
      this.proposals.delete(key);
      this.#rememberSession(session);
      return session;
    } finally {
      this.proposalActions.delete(key);
    }
  }
  proposalOrigin(id) {
    const proposal = this.proposals.get(String(id));
    if (!proposal) throw transportError("UNKNOWN_WALLETCONNECT_PROPOSAL", "WalletConnect proposal is unknown or expired");
    validateProposal(proposal, this.#nowSeconds());
    return proposalHttpsOrigin(proposal);
  }
  proposalPermissions(id) {
    const proposal = this.proposals.get(String(id));
    if (!proposal) throw transportError("UNKNOWN_WALLETCONNECT_PROPOSAL", "WalletConnect proposal is unknown or expired");
    const approved = validateProposal(proposal, this.#nowSeconds());
    return Object.freeze({ chains: Object.freeze([WALLETCONNECT_CHAIN]), methods: approved.methods, events: approved.events });
  }
  async rejectSession(id) {
    const proposal = this.proposals.get(String(id));
    if (!proposal) throw transportError("UNKNOWN_WALLETCONNECT_PROPOSAL", "WalletConnect proposal is unknown or expired");
    const key = String(id);
    if (this.proposalActions.has(key)) throw transportError("WALLETCONNECT_PROPOSAL_ACTION_IN_PROGRESS", "WalletConnect proposal already has an approval or rejection in progress");
    this.proposalActions.add(key);
    try {
      validateProposal(proposal, this.#nowSeconds());
      await this.walletKit.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
      this.proposals.delete(key);
    } finally {
      this.proposalActions.delete(key);
    }
  }
  async respond(topic, id, response) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    if (response.status === "success") this.#sessionNamespace(topic);
    return this.walletKit.respondSessionRequest({ topic, response: response.status === "success"
      ? { id, jsonrpc: "2.0", result: response.result }
      : { id, jsonrpc: "2.0", error: { code: response.code, message: response.message } }
    });
  }
  authorizeRequest(event, selectedAccount) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    const topic = event?.topic;
    const namespace = this.#sessionNamespace(topic);
    const chainId = event?.params?.chainId;
    const request = event?.params?.request;
    if (chainId !== WALLETCONNECT_CHAIN) throw transportError("UNSUPPORTED_WALLETCONNECT_CHAIN", "WalletConnect request targets a different chain");
    if (!request || typeof request.method !== "string" || !namespace.methods.includes(request.method)) throw transportError("UNAUTHORIZED_WALLETCONNECT_METHOD", "WalletConnect method was not approved for this session");
    if (!Array.isArray(request.params)) throw transportError("INVALID_WALLETCONNECT_REQUEST", "WalletConnect request parameters must be an array");
    const requestedAccount = requestAccount(request);
    if (requestedAccount !== normalizeAccount(selectedAccount) || !namespace.accounts.some(account => account.toLowerCase() === `${WALLETCONNECT_CHAIN}:${requestedAccount}`)) {
      throw transportError("UNAUTHORIZED_WALLETCONNECT_ACCOUNT", "WalletConnect request account must match this session and the selected Wallet account");
    }
    return Object.freeze({ topic, jsonRpcId: event.id, origin: this.sessionOrigin(topic), method: request.method, params: request.params });
  }
  sessions() {
    if (!this.walletKit) return Object.freeze([]);
    return Object.freeze(Object.values(this.walletKit.getActiveSessions?.() ?? {}).filter(session => !this.disconnectedTopics.has(session.topic)).map(session => sanitizeSession(session, this.#nowSeconds())));
  }
  async disconnectSession(topic) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    if (typeof topic !== "string" || !/^[A-Za-z0-9_-]{3,256}$/.test(topic)) throw transportError("INVALID_WALLETCONNECT_SESSION", "WalletConnect session topic is invalid");
    let origin = null;
    try { origin = this.sessionOrigin(topic); } catch {}
    // Revoke locally before waiting for storage or the relay. A remote failure must
    // never make this topic usable under a later same-origin account permission.
    await this.#tombstoneTopic(topic);
    await this.walletKit.disconnectSession({ topic, reason: getSdkError("USER_DISCONNECTED") });
    return Object.freeze({ topic, origin, disconnected: true });
  }
  async emitAccountAndChainChanged(topic, account) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    account = normalizeAccount(account);
    this.sessionOrigin(topic);
    const namespace = this.#sessionNamespace(topic);
    if (!namespace.accounts.some(value => value.toLowerCase() === `${WALLETCONNECT_CHAIN}:${account}`)) throw transportError("UNAUTHORIZED_WALLETCONNECT_ACCOUNT", "WalletConnect account was not approved for this session");
    const events = namespace.events;
    const emitted = [];
    if (events.includes("accountsChanged")) {
      await this.walletKit.emitSessionEvent({ topic, chainId: WALLETCONNECT_CHAIN, event: { name: "accountsChanged", data: [account] } });
      emitted.push("accountsChanged");
    }
    if (events.includes("chainChanged")) {
      await this.walletKit.emitSessionEvent({ topic, chainId: WALLETCONNECT_CHAIN, event: { name: "chainChanged", data: "0x1917" } });
      emitted.push("chainChanged");
    }
    return Object.freeze({ topic, account, chainId: "0x1917", emitted: Object.freeze(emitted) });
  }
  sessionOrigin(topic) {
    const remembered = this.sessionOrigins.get(topic);
    if (remembered) return remembered;
    const session = this.walletKit?.getActiveSessions?.()?.[topic];
    const value = session?.peer?.metadata?.url;
    try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); return url.origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect peer has no valid HTTPS origin"); }
  }
  #sessionNamespace(topic) {
    if (this.disconnectedTopics.has(topic)) throw transportError("WALLETCONNECT_SESSION_DISCONNECTED", "WalletConnect session was disconnected locally");
    const session = typeof topic === "string" ? this.walletKit.getActiveSessions?.()?.[topic] : null;
    if (!session || session.topic !== topic) throw transportError("UNKNOWN_WALLETCONNECT_SESSION", "WalletConnect request does not belong to an active session");
    return validateActiveSession(session, this.#nowSeconds());
  }
  async #restoreDisconnectedTopics() {
    const storage = this.walletKit?.core?.storage;
    if (!storage?.getItem || !storage?.setItem) return;
    let record;
    try { record = await storage.getItem(TOMBSTONE_STORAGE_KEY); }
    catch { throw transportError("WALLETCONNECT_SESSION_STORAGE_UNAVAILABLE", "WalletConnect local disconnection records could not be read"); }
    if (record === undefined || record === null) return;
    if (record.version !== 1 || !Array.isArray(record.topics) || record.topics.some(topic => typeof topic !== "string" || !/^[A-Za-z0-9_-]{3,256}$/.test(topic))) {
      throw transportError("INVALID_WALLETCONNECT_SESSION_STORAGE", "WalletConnect local disconnection records are invalid");
    }
    for (const topic of record.topics) this.disconnectedTopics.add(topic);
  }
  #tombstoneTopic(topic) {
    this.disconnectedTopics.add(topic);
    this.sessionOrigins.delete(topic);
    const storage = this.walletKit?.core?.storage;
    if (!storage?.setItem) return Promise.resolve();
    const write = this.tombstoneWrites.catch(() => {}).then(async () => {
      try { await storage.setItem(TOMBSTONE_STORAGE_KEY, { version: 1, topics: [...this.disconnectedTopics].sort() }); }
      catch { throw transportError("WALLETCONNECT_SESSION_STORAGE_UNAVAILABLE", "WalletConnect local disconnection could not be saved"); }
    });
    this.tombstoneWrites = write;
    return write;
  }
  #rememberSession(session) {
    if (this.disconnectedTopics.has(session?.topic)) throw transportError("WALLETCONNECT_SESSION_DISCONNECTED", "WalletConnect session was disconnected locally");
    const sanitized = sanitizeSession(session, this.#nowSeconds());
    this.sessionOrigins.set(sanitized.topic, sanitized.origin);
    return sanitized;
  }
  #nowSeconds() { return Math.floor(this.clock() / 1000); }
}

async function defaultFactory({ projectId, metadata }) {
  const core = new Core({ projectId });
  return WalletKit.init({ core, metadata });
}
function transportError(code, message) { return Object.assign(new Error(message), { code }); }
function validateProposal(proposal, nowSeconds) {
  if (!Number.isSafeInteger(proposal?.id) || proposal.id < 0 || !Number.isSafeInteger(proposal?.expiryTimestamp) || proposal.expiryTimestamp <= nowSeconds) {
    throw transportError("EXPIRED_WALLETCONNECT_PROPOSAL", "WalletConnect proposal is invalid or expired");
  }
  const methods = new Set(), events = new Set();
  let supportedChainRequested = false;
  for (const [field, required] of [["requiredNamespaces", true], ["optionalNamespaces", false]]) {
    const namespaces = proposal?.params?.[field] ?? {};
    if (typeof namespaces !== "object" || Array.isArray(namespaces)) unsupportedNamespace();
    for (const [key, namespace] of Object.entries(namespaces)) {
      if (key !== "eip155" && key !== WALLETCONNECT_CHAIN) { if (required) unsupportedNamespace(); else continue; }
      const chains = namespace?.chains ?? (key === WALLETCONNECT_CHAIN ? [WALLETCONNECT_CHAIN] : null);
      if (!Array.isArray(chains) || chains.length === 0 || chains.some(chain => typeof chain !== "string") || !Array.isArray(namespace?.methods) || !Array.isArray(namespace?.events)) unsupportedNamespace();
      if (required && (chains.some(chain => chain !== WALLETCONNECT_CHAIN) || namespace.methods.some(method => !WALLETCONNECT_METHODS.includes(method)) || namespace.events.some(event => !WALLETCONNECT_EVENTS.includes(event)))) unsupportedNamespace();
      if (!chains.includes(WALLETCONNECT_CHAIN)) continue;
      supportedChainRequested = true;
      for (const method of namespace.methods) if (WALLETCONNECT_METHODS.includes(method)) methods.add(method);
      for (const event of namespace.events) if (WALLETCONNECT_EVENTS.includes(event)) events.add(event);
    }
  }
  if (!supportedChainRequested) unsupportedNamespace();
  return Object.freeze({ methods: Object.freeze([...methods]), events: Object.freeze([...events]) });
}
function unsupportedNamespace() { throw transportError("UNSUPPORTED_WALLETCONNECT_NAMESPACE", "WalletConnect proposal requests an unsupported chain, method, or event"); }
function normalizeAccount(account) {
  if (typeof account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account)) throw transportError("INVALID_WALLETCONNECT_ACCOUNT", "WalletConnect requires a valid selected and requested EVM account");
  return account.toLowerCase();
}
function requestAccount(request) {
  if (request.method === "personal_sign" && request.params.length === 2) return normalizeAccount(request.params[1]);
  if (request.method === "eth_signTypedData_v4" && request.params.length === 2) return normalizeAccount(request.params[0]);
  if (request.method === "eth_sendTransaction" && request.params.length === 1 && typeof request.params[0] === "object" && request.params[0] !== null && !Array.isArray(request.params[0])) return normalizeAccount(request.params[0].from);
  throw transportError("INVALID_WALLETCONNECT_REQUEST", "WalletConnect request does not identify its signing account");
}
function proposalHttpsOrigin(proposal) {
  const value = proposal?.params?.proposer?.metadata?.url;
  try { const url = new URL(value); if (url.protocol !== "https:") throw new Error(); return url.origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect proposal has no valid HTTPS origin"); }
}
function sanitizeSession(session, nowSeconds) {
  const topic = session?.topic;
  const metadata = session?.peer?.metadata ?? {};
  let origin;
  try { const url = new URL(metadata.url); if (url.protocol !== "https:") throw new Error(); origin = url.origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect session has no valid HTTPS origin"); }
  if (typeof topic !== "string" || !/^[A-Za-z0-9_-]{3,256}$/.test(topic)) throw transportError("INVALID_WALLETCONNECT_SESSION", "WalletConnect session topic is invalid");
  validateActiveSession(session, nowSeconds);
  return Object.freeze({ topic, origin, name: bounded(metadata.name, "Unknown DApp"), url: bounded(metadata.url, origin), expiry: Number.isSafeInteger(session.expiry) ? session.expiry : null });
}
function bounded(value, fallback) { return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : fallback; }
function validateActiveSession(session, nowSeconds) {
  const namespace = session?.namespaces?.eip155;
  if (!namespace || !Number.isSafeInteger(session?.expiry) || session.expiry <= nowSeconds || !Array.isArray(namespace.accounts) || namespace.accounts.length < 1 || namespace.accounts.some(account => !/^eip155:6423:0x[0-9a-fA-F]{40}$/.test(account)) || !Array.isArray(namespace.methods) || namespace.methods.some(method => !WALLETCONNECT_METHODS.includes(method)) || !Array.isArray(namespace.events) || namespace.events.some(event => !WALLETCONNECT_EVENTS.includes(event))) {
    throw transportError("INVALID_WALLETCONNECT_SESSION", "WalletConnect session exceeds the frozen YNX chain, account, method, or event boundary");
  }
  return namespace;
}
