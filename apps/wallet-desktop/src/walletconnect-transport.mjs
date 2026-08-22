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
  }
  status() {
    return Object.freeze({ configured: this.projectId !== null, connected: this.walletKit !== null, code: this.projectId ? null : "WALLETCONNECT_PROJECT_ID_UNAVAILABLE" });
  }
  async start(handlers) {
    if (!this.projectId) throw transportError("WALLETCONNECT_PROJECT_ID_UNAVAILABLE", "WalletConnect project ID is not configured");
    this.walletKit = await this.walletKitFactory({ projectId: this.projectId, metadata: this.metadata });
    this.walletKit.on("session_proposal", proposal => { this.proposals.set(String(proposal.id), proposal); handlers.onSessionProposal(proposal); });
    this.walletKit.on("session_request", handlers.onSessionRequest);
    this.walletKit.on("session_delete", handlers.onSessionDelete);
    this.walletKit.on("session_request_expire", handlers.onRequestExpire);
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
    validateProposal(proposal);
    const session = await this.walletKit.approveSession({ id: proposal.id, namespaces: {
      eip155: {
        chains: [WALLETCONNECT_CHAIN],
        accounts: [`${WALLETCONNECT_CHAIN}:${account}`],
        methods: [...WALLETCONNECT_METHODS],
        events: [...WALLETCONNECT_EVENTS]
      }
    } });
    this.proposals.delete(String(id));
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
  sessionOrigin(topic) {
    const session = this.walletKit?.getActiveSessions?.()?.[topic];
    const value = session?.peer?.metadata?.url;
    try { return new URL(value).origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect peer has no valid HTTPS origin"); }
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
}
