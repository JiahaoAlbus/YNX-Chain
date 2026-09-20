import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { getSdkError } from "@walletconnect/utils";
import type { SignClientTypes, SessionTypes } from "@walletconnect/types";
import { parseWalletConnectRuntimeConfig } from "@ynx-chain/wallet-auth";

export const YNX_WALLETCONNECT_CHAIN = "eip155:6423" as const;
export type WalletConnectProposal = SignClientTypes.EventArguments["session_proposal"];
export type WalletConnectRequest = SignClientTypes.EventArguments["session_request"];
export type WalletConnectSnapshot = Readonly<{
  phase: "disabled" | "starting" | "ready" | "failed";
  error: string | null;
  sessions: readonly SessionTypes.Struct[];
  proposal: WalletConnectProposal | null;
  request: WalletConnectRequest | null;
}>;

type Listener = (snapshot: WalletConnectSnapshot) => void;
type RuntimeConfig = Readonly<{ projectId: string; relayUrl?: string }>;

/** WalletKit transport only. Request/session policy is deliberately supplied by
 * @ynx-chain/wallet-auth and the approval UI; this class never auto-approves. */
export class WalletConnectRuntime {
  #client: InstanceType<typeof WalletKit> | null = null;
  #listeners = new Set<Listener>();
  #snapshot: WalletConnectSnapshot;
  #start: Promise<void> | null = null;
  constructor(readonly config: RuntimeConfig | null) {
    this.#snapshot = Object.freeze({ phase: config ? "starting" : "disabled", error: config ? null : "WalletConnect is not configured for this build.", sessions: Object.freeze([]), proposal: null, request: null });
  }
  snapshot(): WalletConnectSnapshot { return this.#snapshot; }
  subscribe(listener: Listener): () => void { this.#listeners.add(listener); listener(this.#snapshot); return () => this.#listeners.delete(listener); }
  async start(): Promise<void> {
    if (!this.config) return;
    if (this.#start) return this.#start;
    this.#start = this.#initialize().catch(error => { this.#set({ phase: "failed", error: publicError(error) }); throw error; });
    return this.#start;
  }
  async pair(uri: string): Promise<void> { const client = this.#require(); await client.pair({ uri }); }
  async approveProposal(namespaces: SessionTypes.Namespaces): Promise<SessionTypes.Struct> {
    const proposal = this.#snapshot.proposal; if (!proposal) throw new Error("No WalletConnect proposal is awaiting review.");
    const session = await this.#require().approveSession({ id: proposal.id, namespaces }); this.#set({ proposal: null }); this.#refreshSessions(); return session;
  }
  async rejectProposal(): Promise<void> {
    const proposal = this.#snapshot.proposal; if (!proposal) return;
    await this.#require().rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") }); this.#set({ proposal: null });
  }
  async respond(result: unknown): Promise<void> {
    const pending = this.#snapshot.request; if (!pending) throw new Error("No WalletConnect request is awaiting review.");
    await this.#require().respondSessionRequest({ topic: pending.topic, response: { jsonrpc: "2.0", id: pending.id, result } }); this.#set({ request: null });
  }
  async rejectRequest(code = 5000, message = "User rejected the request."): Promise<void> {
    const pending = this.#snapshot.request; if (!pending) return;
    await this.#require().respondSessionRequest({ topic: pending.topic, response: { jsonrpc: "2.0", id: pending.id, error: { code, message } } }); this.#set({ request: null });
  }
  async disconnect(topic: string): Promise<void> { await this.#require().disconnectSession({ topic, reason: getSdkError("USER_DISCONNECTED") }); this.#refreshSessions(); }
  clearSensitiveReview(): void { if (this.#snapshot.request) this.#set({ request: null }); }
  async rejectPendingForLock(): Promise<void> {
    const request = this.#snapshot.request, proposal = this.#snapshot.proposal;
    if (request) await this.rejectRequest(5000, "Wallet locked before approval.").catch(() => {});
    if (proposal) await this.rejectProposal().catch(() => {});
    this.#set({ request: null, proposal: null });
  }
  async restore(): Promise<void> { await this.start(); this.#refreshSessions(); }
  async #initialize(): Promise<void> {
    const core = new Core({ projectId: this.config!.projectId, ...(this.config!.relayUrl ? { relayUrl: this.config!.relayUrl } : {}) });
    const client = await WalletKit.init({ core, metadata: { name: "YNX Wallet", description: "YNX Testnet self-custody wallet", url: "https://wallet.ynxweb4.com", icons: ["https://wallet.ynxweb4.com/icon.png"], redirect: { native: "ynxwallet://wc" } } });
    this.#client = client;
    client.on("session_proposal", proposal => { if (this.#snapshot.proposal) { void client.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") }); return; } this.#set({ proposal }); });
    client.on("session_request", request => { if (this.#snapshot.request) { void client.respondSessionRequest({ topic: request.topic, response: { jsonrpc: "2.0", id: request.id, error: { code: 5000, message: "Another Wallet request is already under review." } } }); return; } this.#set({ request }); });
    client.on("session_delete", () => this.#refreshSessions());
    this.#set({ phase: "ready", error: null }); this.#refreshSessions();
  }
  #refreshSessions(): void { const sessions: SessionTypes.Struct[] = this.#client ? Object.values(this.#client.getActiveSessions()) : []; this.#set({ sessions: Object.freeze(sessions) }); }
  #require(): InstanceType<typeof WalletKit> { if (!this.#client || this.#snapshot.phase !== "ready") throw new Error(this.#snapshot.error ?? "WalletConnect is not ready."); return this.#client; }
  #set(patch: Partial<WalletConnectSnapshot>): void { this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch }); for (const listener of this.#listeners) listener(this.#snapshot); }
}

export function walletConnectRuntimeConfig(environment: Record<string, string | undefined> = process.env): RuntimeConfig | null {
  const raw = environment.EXPO_PUBLIC_REOWN_PROJECT_ID?.trim();
  if (!raw) return null;
  return parseWalletConnectRuntimeConfig({ projectId: raw.toLowerCase() });
}

function publicError(value: unknown): string { return value instanceof Error && value.message ? value.message.slice(0, 240) : "WalletConnect could not start."; }
