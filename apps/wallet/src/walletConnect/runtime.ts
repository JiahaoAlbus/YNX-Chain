import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { getSdkError } from "@walletconnect/utils";
import type { SignClientTypes, SessionTypes } from "@walletconnect/types";
import { parseWalletConnectRuntimeConfig } from "@ynx-chain/wallet-auth";
import type { WalletConnectJsonRpcResponse } from "./securityStore";

export const YNX_WALLETCONNECT_CHAIN = "eip155:6423" as const;
export type WalletConnectProposal = SignClientTypes.EventArguments["session_proposal"];
export type WalletConnectRequest = SignClientTypes.EventArguments["session_request"];
export type WalletConnectSessionEvent = Readonly<{ kind: "updated" | "expired" | "deleted"; topic: string; revision: number; namespaces?: SessionTypes.Namespaces; pendingRequest?: WalletConnectRequest }>;
export type WalletConnectSnapshot = Readonly<{
  phase: "disabled" | "starting" | "ready" | "failed";
  error: string | null;
  sessions: readonly SessionTypes.Struct[];
  proposal: WalletConnectProposal | null;
  request: WalletConnectRequest | null;
  sessionEvent: WalletConnectSessionEvent | null;
  retryAvailable: boolean;
}>;

type Listener = (snapshot: WalletConnectSnapshot) => void;
type RuntimeConfig = Readonly<{ projectId: string; relayUrl?: string }>;
type WalletKitClient = Pick<InstanceType<typeof WalletKit>, "pair" | "approveSession" | "rejectSession" | "respondSessionRequest" | "disconnectSession" | "getActiveSessions"> & {
  on<E extends SignClientTypes.Event>(event:E,listener:(args:SignClientTypes.EventArguments[E])=>void):unknown;
};
type WalletKitFactory = (config: RuntimeConfig) => Promise<WalletKitClient>;
const MAX_START_ATTEMPTS = 3;

async function createWalletKit(config: RuntimeConfig): Promise<WalletKitClient> {
  const core = new Core({ projectId: config.projectId, ...(config.relayUrl ? { relayUrl: config.relayUrl } : {}) });
  return WalletKit.init({ core, metadata: { name: "YNX Wallet", description: "YNX Testnet self-custody wallet", url: "https://wallet.ynxweb4.com", icons: ["https://wallet.ynxweb4.com/icon.png"], redirect: { native: "ynxwallet://wc" } } }) as unknown as WalletKitClient;
}

/** WalletKit transport only. Request/session policy is deliberately supplied by
 * @ynx-chain/wallet-auth and the approval UI; this class never auto-approves. */
export class WalletConnectRuntime {
  #client: WalletKitClient | null = null;
  #listeners = new Set<Listener>();
  #snapshot: WalletConnectSnapshot;
  #start: Promise<void> | null = null;
  #attempts = 0;
  #revision = 0;
  constructor(readonly config: RuntimeConfig | null, private readonly factory: WalletKitFactory = createWalletKit) {
    this.#snapshot = Object.freeze({ phase: config ? "starting" : "disabled", error: config ? null : "WalletConnect is not configured for this build.", sessions: Object.freeze([]), proposal: null, request: null, sessionEvent: null, retryAvailable: false });
  }
  snapshot(): WalletConnectSnapshot { return this.#snapshot; }
  subscribe(listener: Listener): () => void { this.#listeners.add(listener); listener(this.#snapshot); return () => this.#listeners.delete(listener); }
  async start(): Promise<void> {
    if (!this.config) return;
    if (this.#snapshot.phase === "failed") throw new Error(this.#snapshot.error ?? "WalletConnect start failed. Use explicit retry.");
    return this.#beginStart();
  }
  async retryStart(): Promise<void> {
    if (!this.config) return;
    if (this.#snapshot.phase !== "failed") throw new Error("WalletConnect retry is only available after initialization fails.");
    if (this.#attempts >= MAX_START_ATTEMPTS) throw new Error("WalletConnect initialization retry limit reached. Restart the app before trying again.");
    this.#set({ phase: "starting", error: null, retryAvailable: false });
    return this.#beginStart();
  }
  async #beginStart(): Promise<void> {
    if (this.#start) return this.#start;
    this.#attempts += 1;
    this.#start = this.#initialize().catch(error => {
      this.#client = null;
      this.#start = null;
      this.#set({ phase: "failed", error: publicError(error), retryAvailable: this.#attempts < MAX_START_ATTEMPTS });
      throw error;
    });
    return this.#start;
  }
  async pair(uri: string): Promise<void> { const client = this.#require(); await client.pair({ uri }); }
  async approveProposal(expected: WalletConnectProposal, namespaces: SessionTypes.Namespaces): Promise<SessionTypes.Struct> {
    const proposal = this.#snapshot.proposal;
    if (!proposal || proposal !== expected) throw new Error("WalletConnect proposal changed before approval.");
    const session = await this.#require().approveSession({ id: proposal.id, namespaces });
    if(this.#snapshot.proposal===proposal)this.#set({proposal:null});
    return session;
  }
  async rejectProposal(expected?:WalletConnectProposal): Promise<void> {
    const proposal = this.#snapshot.proposal; if (!proposal) return;
    if(expected&&proposal!==expected)throw new Error("WalletConnect proposal changed before rejection.");
    this.#set({proposal:null});
    await this.#require().rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
  }
  async sendStoredResponse(topic: string, response: WalletConnectJsonRpcResponse): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(topic) || !Number.isSafeInteger(response.id) || response.id < 1) throw new Error("Stored WalletConnect response identity is invalid.");
    const pending = this.#snapshot.request;
    if (pending?.topic === topic && pending.id === response.id) this.#set({ request: null });
    await this.#require().respondSessionRequest({ topic, response });
  }
  async disconnect(topic: string): Promise<void> { await this.disconnectSessions([topic]) }
  async disconnectSessions(topics:readonly string[]):Promise<void>{
    if(topics.length>50)throw new Error("WalletConnect disconnect limit exceeded.");
    const unique=[...new Set(topics)];if(unique.length!==topics.length)throw new Error("WalletConnect disconnect topics must be unique.");
    const client=this.#require(),pending=this.#snapshot.request;
    if(pending&&unique.includes(pending.topic))this.#set({request:null});
    const failures:string[]=[];
    try{for(const topic of unique){try{await client.disconnectSession({topic,reason:getSdkError("USER_DISCONNECTED")})}catch{failures.push(topic)}}}
    finally{this.#refreshSessions(client)}
    if(failures.length)throw new Error(`WalletConnect could not disconnect ${failures.length} session${failures.length===1?"":"s"}.`);
  }
  clearSensitiveReview(): void {
    const event=this.#snapshot.sessionEvent;
    if(event?.pendingRequest){const {pendingRequest:_,...cleared}=event;this.#set({request:null,sessionEvent:Object.freeze(cleared)})}
    else if(this.#snapshot.request)this.#set({request:null});
  }
  clearPersistedSessionUpdateRequest(revision:number):void{
    const event=this.#snapshot.sessionEvent;
    if(event?.kind==="updated"&&event.revision===revision&&event.pendingRequest){const {pendingRequest:_,...cleared}=event;this.#set({sessionEvent:Object.freeze(cleared)})}
  }
  async restore(): Promise<void> { await this.start(); this.#refreshSessions(); }
  refreshSessions():void{this.#refreshSessions()}
  async #initialize(): Promise<void> {
    const client = await this.factory(this.config!);
    client.on("session_proposal", proposal => { if (this.#snapshot.proposal) { void client.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") }).catch(error=>this.#set({error:publicError(error)})); return; } this.#set({ proposal }); });
    client.on("session_request", request => { if (this.#snapshot.request) { void client.respondSessionRequest({ topic: request.topic, response: { jsonrpc: "2.0", id: request.id, error: { code: 5000, message: "Another Wallet request is already under review." } } }).catch(async error=>{this.#set({error:publicError(error)});await this.disconnect(request.topic).catch(disconnectError=>this.#set({error:publicError(disconnectError)}))}); return; } this.#set({ request }); });
    client.on("session_update", event => {
      const pending=this.#snapshot.request?.topic===event.topic?this.#snapshot.request:null;
      const sessions=Object.values(client.getActiveSessions()).map(session=>session.topic===event.topic?{...session,namespaces:event.params.namespaces}:session);
      this.#revision+=1;
      this.#set({request:pending?null:this.#snapshot.request,sessions:Object.freeze(sessions),sessionEvent:Object.freeze({kind:"updated",topic:event.topic,namespaces:event.params.namespaces,revision:this.#revision,...(pending?{pendingRequest:pending}:{})})});
    });
    client.on("session_expire", event => { this.#clearRequestForTopic(event.topic);this.#removeSession(event.topic,client); this.#emitSessionEvent({ kind: "expired", topic: event.topic }); });
    client.on("session_delete", event => { this.#clearRequestForTopic(event.topic);this.#removeSession(event.topic,client); this.#emitSessionEvent({ kind: "deleted", topic: event.topic }); });
    this.#client = client;
    this.#refreshSessions(client); this.#set({ phase: "ready", error: null, retryAvailable: false });
  }
  #emitSessionEvent(event: Omit<WalletConnectSessionEvent, "revision">): void { this.#revision += 1; this.#set({ sessionEvent: Object.freeze({ ...event, revision: this.#revision }) }); }
  #clearRequestForTopic(topic:string):void{if(this.#snapshot.request?.topic===topic)this.#set({request:null})}
  #removeSession(topic:string,client:WalletKitClient):void{const sessions=Object.values(client.getActiveSessions()).filter(session=>session.topic!==topic);this.#set({sessions:Object.freeze(sessions)})}
  #refreshSessions(client: WalletKitClient | null = this.#client): void { const sessions: SessionTypes.Struct[] = client ? Object.values(client.getActiveSessions()) : []; this.#set({ sessions: Object.freeze(sessions) }); }
  #require(): WalletKitClient { if (!this.#client || this.#snapshot.phase !== "ready") throw new Error(this.#snapshot.error ?? "WalletConnect is not ready."); return this.#client; }
  #set(patch: Partial<WalletConnectSnapshot>): void { this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch }); for (const listener of this.#listeners) listener(this.#snapshot); }
}

export function walletConnectRuntimeConfig(environment: Record<string, string | undefined> = process.env): RuntimeConfig | null {
  const raw = environment.EXPO_PUBLIC_REOWN_PROJECT_ID?.trim();
  if (!raw) return null;
  return parseWalletConnectRuntimeConfig({ projectId: raw.toLowerCase() });
}

function publicError(value: unknown): string { return value instanceof Error && value.message ? value.message.slice(0, 240) : "WalletConnect could not start."; }
