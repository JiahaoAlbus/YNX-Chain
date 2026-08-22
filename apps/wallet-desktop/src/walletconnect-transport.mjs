import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { getSdkError } from "@walletconnect/utils";

export const WALLETCONNECT_CHAIN = "eip155:6423";
export const WALLETCONNECT_METHODS = Object.freeze(["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]);
export const WALLETCONNECT_EVENTS = Object.freeze(["accountsChanged", "chainChanged"]);

export class WalletConnectTransport {
  constructor({ projectId, metadata, walletKitFactory = defaultFactory }) {
    this.projectId = projectId?.trim() || null;
    this.metadata = metadata;
    this.walletKitFactory = walletKitFactory;
    this.walletKit = null;
    this.proposals = new Map();
    this.sessionOrigins = new Map();
  }
  status() {
    const started = this.walletKit !== null;
    const relayConnected = this.walletKit?.core?.relayer?.connected === true;
    return Object.freeze({
      configured: this.projectId !== null,
      started,
      relayConnected,
      activeSessionCount: started ? Object.keys(this.walletKit.getActiveSessions?.() ?? {}).length : 0,
      code: !this.projectId ? "WALLETCONNECT_PROJECT_ID_UNAVAILABLE" : relayConnected ? null : "WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED"
    });
  }
  async start(handlers = {}) {
    if (!this.projectId) throw transportError("WALLETCONNECT_PROJECT_ID_UNAVAILABLE", "WalletConnect project ID is not configured");
    this.walletKit = await this.walletKitFactory({ projectId: this.projectId, metadata: this.metadata });
    this.walletKit.on("session_proposal", proposal => { this.proposals.set(String(proposal.id), proposal); handlers.onSessionProposal?.(proposal); });
    this.walletKit.on("session_request", event => handlers.onSessionRequest?.(event));
    this.walletKit.on("session_delete", async event => {
      const origin = this.sessionOrigins.get(event.topic) ?? null;
      try { await handlers.onSessionDelete?.({ ...event, origin }); } finally { this.sessionOrigins.delete(event.topic); }
    });
    this.walletKit.on("session_request_expire", event => handlers.onRequestExpire?.(event));
    for (const session of Object.values(this.walletKit.getActiveSessions?.() ?? {})) handlers.onSessionRestore?.(this.#rememberSession(session));
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
    const approved = validateProposal(proposal);
    const session = await this.walletKit.approveSession({ id: proposal.id, namespaces: {
      eip155: {
        chains: [WALLETCONNECT_CHAIN],
        accounts: [`${WALLETCONNECT_CHAIN}:${account}`],
        methods: approved.methods,
        events: approved.events
      }
    } });
    this.proposals.delete(String(id));
    this.#rememberSession(session);
    return session;
  }
  proposalOrigin(id) {
    const proposal = this.proposals.get(String(id));
    const value = proposal?.params?.proposer?.metadata?.url;
    try { const url = new URL(value); if (url.protocol !== "https:") throw new Error(); return url.origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect proposal has no valid HTTPS origin"); }
  }
  async rejectSession(id) {
    const proposal = this.proposals.get(String(id));
    if (!proposal) throw transportError("UNKNOWN_WALLETCONNECT_PROPOSAL", "WalletConnect proposal is unknown or expired");
    await this.walletKit.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
    this.proposals.delete(String(id));
  }
  async respond(topic, id, response) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    return this.walletKit.respondSessionRequest({ topic, response: response.status === "success"
      ? { id, jsonrpc: "2.0", result: response.result }
      : { id, jsonrpc: "2.0", error: { code: response.code, message: response.message } }
    });
  }
  sessions() {
    if (!this.walletKit) return Object.freeze([]);
    return Object.freeze(Object.values(this.walletKit.getActiveSessions?.() ?? {}).map(session => sanitizeSession(session)));
  }
  async disconnectSession(topic) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    const origin = this.sessionOrigin(topic);
    await this.walletKit.disconnectSession({ topic, reason: getSdkError("USER_DISCONNECTED") });
    this.sessionOrigins.delete(topic);
    return Object.freeze({ topic, origin, disconnected: true });
  }
  async emitAccountAndChainChanged(topic, account) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    if (!/^0x[0-9a-f]{40}$/.test(account)) throw transportError("INVALID_WALLETCONNECT_ACCOUNT", "WalletConnect account is invalid");
    this.sessionOrigin(topic);
    const session = this.walletKit.getActiveSessions?.()?.[topic];
    const events = validateActiveSession(session).events;
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
    try { return new URL(value).origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect peer has no valid HTTPS origin"); }
  }
  #rememberSession(session) {
    const sanitized = sanitizeSession(session);
    this.sessionOrigins.set(sanitized.topic, sanitized.origin);
    return sanitized;
  }
}

async function defaultFactory({ projectId, metadata }) {
  const core = new Core({ projectId });
  return WalletKit.init({ core, metadata });
}
function transportError(code, message) { return Object.assign(new Error(message), { code }); }
function validateProposal(proposal) {
  const required = proposal?.params?.requiredNamespaces?.eip155;
  if (!required || !Array.isArray(required.chains) || required.chains.some(chain => chain !== WALLETCONNECT_CHAIN) || !Array.isArray(required.methods) || required.methods.some(method => !WALLETCONNECT_METHODS.includes(method)) || !Array.isArray(required.events) || required.events.some(event => !WALLETCONNECT_EVENTS.includes(event))) {
    throw transportError("UNSUPPORTED_WALLETCONNECT_NAMESPACE", "WalletConnect proposal requests an unsupported chain, method, or event");
  }
  return Object.freeze({ methods: Object.freeze([...new Set(required.methods)]), events: Object.freeze([...new Set(required.events)]) });
}
function sanitizeSession(session) {
  const topic = session?.topic;
  const metadata = session?.peer?.metadata ?? {};
  let origin;
  try { const url = new URL(metadata.url); if (url.protocol !== "https:") throw new Error(); origin = url.origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect session has no valid HTTPS origin"); }
  if (typeof topic !== "string" || !/^[A-Za-z0-9_-]{3,256}$/.test(topic)) throw transportError("INVALID_WALLETCONNECT_SESSION", "WalletConnect session topic is invalid");
  validateActiveSession(session);
  return Object.freeze({ topic, origin, name: bounded(metadata.name, "Unknown DApp"), url: bounded(metadata.url, origin), expiry: Number.isSafeInteger(session.expiry) ? session.expiry : null });
}
function bounded(value, fallback) { return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : fallback; }
function validateActiveSession(session) {
  const namespace = session?.namespaces?.eip155;
  if (!namespace || !Array.isArray(namespace.accounts) || namespace.accounts.length < 1 || namespace.accounts.some(account => !/^eip155:6423:0x[0-9a-f]{40}$/.test(account)) || !Array.isArray(namespace.methods) || namespace.methods.some(method => !WALLETCONNECT_METHODS.includes(method)) || !Array.isArray(namespace.events) || namespace.events.some(event => !WALLETCONNECT_EVENTS.includes(event))) {
    throw transportError("INVALID_WALLETCONNECT_SESSION", "WalletConnect session exceeds the frozen YNX chain, account, method, or event boundary");
  }
  return namespace;
}
