import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { getSdkError } from "@walletconnect/utils";
import type { SignClientTypes, SessionTypes } from "@walletconnect/types";
import { parseWalletConnectPairingUri, parseWalletConnectRuntimeConfig } from "@ynx-chain/wallet-auth";
import { subscribeNativeRelayDiagnostics } from "./nativeRelayDiagnostics";
import { PendingReviewRecovery,pendingReviewKey,pendingSessionBinding } from "./pendingReviewRecovery";
import type { WalletConnectRequestReview } from "@ynx-chain/wallet-auth";

export const YNX_WALLETCONNECT_CHAIN = "eip155:6423" as const;
export type WalletConnectProposal = SignClientTypes.EventArguments["session_proposal"];
export type WalletConnectRequest = SignClientTypes.EventArguments["session_request"];
export type WalletConnectSessionEvent = Readonly<{ kind: "updated" | "expired" | "deleted"; topic: string; revision: number; namespaces?: SessionTypes.Namespaces }>;
export type WalletConnectSnapshot = Readonly<{
  phase: "disabled" | "starting" | "ready" | "failed";
  error: string | null;
  sessions: readonly SessionTypes.Struct[];
  proposal: WalletConnectProposal | null;
  request: WalletConnectRequest | null;
  sessionEvent: WalletConnectSessionEvent | null;
  retryAvailable: boolean;
  relayTransport: "unknown" | "connecting" | "connected" | "disconnected" | "failed";
  relayErrorCode: string | null;
  relayHTTPStatus: number | null;
  relayRetryAvailable: boolean;
  pairTransportStage: "idle" | "sdk-pair" | "subscribe-pending" | "subscribed" | "proposal-received" | "timed-out" | "canceled" | "failed";
  pairing: boolean;
  pairingCleanup: "none" | "pending" | "sdk-confirmed" | "unconfirmed";
}>;

type Listener = (snapshot: WalletConnectSnapshot) => void;
type RuntimeConfig = Readonly<{ projectId: string; relayUrl?: string }>;
type WalletKitClient = Pick<InstanceType<typeof WalletKit>, "pair" | "approveSession" | "rejectSession" | "respondSessionRequest" | "disconnectSession" | "getActiveSessions"> & {
  getPendingSessionRequests?():readonly WalletConnectRequest[];
  getPendingSessionProposals?():unknown;
  core?: { relayer?: { connected: boolean; connecting: boolean; on(event:string, listener:(value?:any)=>void):unknown; transportOpen():Promise<void>; subscriber?: { topics:readonly string[]; pending:Map<string,unknown>; on(event:string,listener:(value:any)=>void):unknown } }; pairing: { disconnect(args: { topic: string }): Promise<void>; getPairings?(): readonly { topic: string; expiry?: number }[] } };
  on<E extends SignClientTypes.Event>(event:E,listener:(args:SignClientTypes.EventArguments[E])=>void):unknown;
};
type WalletKitFactory = (config: RuntimeConfig) => Promise<WalletKitClient>;
const MAX_START_ATTEMPTS = 3;
export const WALLETCONNECT_PAIR_DEADLINE_MS = 30_000;
const PAIR_CLEANUP_DEADLINE_MS = 3_000;

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
  #reviewGeneration = 0;
  #paused: { account: string; request: WalletConnectRequest | null; proposal: WalletConnectProposal | null; session: string | null; deadline: number } | null = null;
  #requestDeadlines = new WeakMap<WalletConnectRequest,number>();
  #pairTopics = new Map<string, boolean>();
  #pairCleanup = new Map<string, { revision: number; status: "pending" | "sdk-confirmed" | "unconfirmed" }>();
  #relayRetry: Promise<void> | null = null;
  #relayAttempts = 0;
  #pairExpiry = new Map<string, number>();
  #sdkPairPending = new Set<string>();
  #approvedPairTopics = new Set<string>();
  #pairOperation: { topic: string; revision: number; proposalReceived: () => void; cancel: (reason: string) => void } | null = null;
  #pairRevision = 0;
  #pairAttempt: { topic: string; revision: number; stage: WalletConnectSnapshot["pairTransportStage"] } | null = null;
  #receivedAt = new WeakMap<WalletConnectRequest,Date>();
  #account:string|null=null;
  #coldRequests=new Set<string>();#coldProposals=new Set<string>();
  #restoringPending:Promise<void>|null=null;
  constructor(readonly config: RuntimeConfig | null, private readonly factory: WalletKitFactory = createWalletKit, private readonly pairDeadlineMs = WALLETCONNECT_PAIR_DEADLINE_MS, private readonly pairingJournal?: { load(): Promise<readonly string[]>; record(topic: string, expiresAt?: number | null): Promise<void>; retire?(topic: string): Promise<void>; review?(topic:string,expiresAt:number):Promise<void>; canResumeReview?(topic:string):Promise<boolean> },private readonly pendingRecovery?:PendingReviewRecovery) {
    if (!Number.isFinite(pairDeadlineMs) || pairDeadlineMs <= 0 || pairDeadlineMs > WALLETCONNECT_PAIR_DEADLINE_MS) throw new Error("Invalid pairing deadline.");
    this.#snapshot = Object.freeze({ phase: config ? "starting" : "disabled", error: config ? null : "WalletConnect is not configured for this build.", sessions: Object.freeze([]), proposal: null, request: null, sessionEvent: null, retryAvailable: false, relayTransport: "unknown", relayErrorCode: null, relayHTTPStatus: null, relayRetryAvailable: false, pairTransportStage: "idle", pairing: false, pairingCleanup: "none" });
    if (config && factory === createWalletKit) subscribeNativeRelayDiagnostics(value => {
      if (value.failureClass && !this.#client?.core?.relayer?.connected) this.#set({ relayErrorCode: value.failureClass });
    });
  }
  snapshot(): WalletConnectSnapshot { return this.#snapshot; }
  requestReviewTime(event: WalletConnectRequest): Date { const at=this.#receivedAt.get(event);if(!at)throw new Error("Wallet request arrival time is unavailable.");return new Date(at); }
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
  async pair(uri: string): Promise<void> {
    const client = this.#require(), { topic, expiryTimestamp } = parseWalletConnectPairingUri(uri, new Date());
    for (const [old, expiry] of this.#pairExpiry) if (expiry <= Math.floor(Date.now()/1000) && !this.#sdkPairPending.has(old)) { this.#pairTopics.delete(old);this.#pairExpiry.delete(old);this.#pairCleanup.delete(old); }
    if (this.#pairOperation) throw new Error("A pairing attempt is already running. Cancel it before retrying.");
    if (this.#pairTopics.has(topic)) throw new Error("This pairing was already attempted. Request a fresh QR code from the dApp.");
    // Never evict canceled topics: their late proposals must remain quarantined.
    if (this.#sdkPairPending.size >= 100) throw new Error("Too many unresolved SDK operations. No further pairing will be attempted yet.");
    this.#pairTopics.set(topic, false);
    this.#pairExpiry.set(topic, expiryTimestamp ?? Math.floor(Date.now()/1000)+300);
    const attempt={topic,revision:++this.#pairRevision,stage:"sdk-pair" as const};this.#pairAttempt=attempt;
    this.#set({ pairing: true, error: null, pairTransportStage: "sdk-pair" });
    let timer: ReturnType<typeof setTimeout>;
    let canceled = false;
    let proposalReceived!: () => void;
    const received = new Promise<void>(resolve => { proposalReceived = resolve; });
    const interrupted = new Promise<never>((_, reject) => {
      const cancel = (reason: string) => {
        if (canceled) return;
        canceled = true;
        this.#reviewGeneration++;
        this.#pairTopics.set(topic, true);
        this.#quarantinePairProposal(client, topic);
        this.#syncRelay(client);
        this.#pairStage(attempt,reason.includes("timed out") ? "timed-out" : "canceled");
        if(this.#pairAttempt===attempt)this.#set({ pairing: false, error: reason });
        reject(new Error(reason));
        void this.#cleanupPairing(client, topic);
      };
      this.#pairOperation = { topic, revision:attempt.revision, cancel, proposalReceived };
      timer = setTimeout(() => cancel("Pairing timed out. Request a fresh QR code and retry. Remote cleanup is not yet confirmed."), this.pairDeadlineMs);
    });
    const operation = Promise.resolve().then(async () => {
      // Persist before the SDK can create a pairing, including crash/late completion.
      await this.pairingJournal?.record(topic, this.#pairExpiry.get(topic)!);
      if (canceled) throw new Error("Pairing canceled before transport.");
      this.#sdkPairPending.add(topic);
      try { return await client.pair({ uri }); } finally { this.#sdkPairPending.delete(topic); }
    });
    // The SDK cannot be aborted. Clean up again if it settles after cancellation.
    void operation.then(() => { if (this.#pairTopics.get(topic) === true) void this.#cleanupPairing(client, topic); }, () => { if (this.#pairTopics.get(topic) === true) void this.#cleanupPairing(client, topic); });
    try { await Promise.race([operation, interrupted, received]); }
    catch (error) {
      if (!canceled) { this.#pairTopics.set(topic, true); this.#quarantinePairProposal(client, topic); void this.#cleanupPairing(client, topic); }
      this.#syncRelay(client);
      if (!canceled) this.#pairStage(attempt,"failed");
      throw new Error(publicError(error));
    } finally {
      clearTimeout(timer!);
      this.#finishPair(attempt);
    }
  }
  #finishPair(attempt: { revision:number }): void {
    if (this.#pairOperation?.revision !== attempt.revision) return;
    this.#pairOperation = null;
    this.#set({ pairing: false });
  }
  cancelPendingPair(): void { this.cancelPair(true); }
  cancelPair(preserveReviewedProposal = false): void {
    if (this.#client) for (const session of Object.values(this.#client.getActiveSessions())) if (session.pairingTopic) this.#approvedPairTopics.add(session.pairingTopic);
    const retained = preserveReviewedProposal ? this.#snapshot.proposal ?? this.#paused?.proposal : null;
    if (!retained || retained.params.pairingTopic !== this.#pairOperation?.topic) this.#pairOperation?.cancel("Pairing canceled. Remote cleanup is not yet confirmed.");
    for (const [topic, canceled] of this.#pairTopics) {
      if (canceled || this.#approvedPairTopics.has(topic) || retained?.params.pairingTopic === topic) continue;
      this.#pairTopics.set(topic, true);
      void this.pairingJournal?.record(topic,this.#pairExpiry.get(topic)??null).catch(()=>{this.#set({pairingCleanup:"unconfirmed"});});
      if(this.#pairAttempt?.topic===topic)this.#pairStage(this.#pairAttempt,"canceled");
      this.#reviewGeneration++;
      if (this.#client) this.#quarantinePairProposal(this.#client, topic);
      if (this.#client) void this.#cleanupPairing(this.#client, topic);
    }
  }
  async #cleanupPairing(client: WalletKitClient, topic: string): Promise<void> {
    const revision = (this.#pairCleanup.get(topic)?.revision ?? 0) + 1;
    this.#pairCleanup.set(topic, { revision, status: "pending" });
    this.#publishPairCleanup();
    let timer: ReturnType<typeof setTimeout>;
    try {
      if (!client.core?.pairing) throw new Error("Pairing cleanup is unavailable.");
      await Promise.race([client.core.pairing.disconnect({ topic }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Pairing cleanup timed out.")), PAIR_CLEANUP_DEADLINE_MS); })]);
      const pairings=client.core.pairing.getPairings?.();
      if (!pairings || pairings.some(pairing=>pairing.topic===topic)) throw new Error("SDK pairing removal is unconfirmed.");
      if (!this.#sdkPairPending.has(topic)) await this.pairingJournal?.retire?.(topic);
      if (this.#pairCleanup.get(topic)?.revision === revision) this.#pairCleanup.set(topic, { revision, status: "sdk-confirmed" });
    } catch { if (this.#pairCleanup.get(topic)?.revision === revision) this.#pairCleanup.set(topic, { revision, status: "unconfirmed" }); }
    finally { clearTimeout(timer!); this.#publishPairCleanup(); }
  }
  #publishPairCleanup(): void {
    const statuses = [...this.#pairCleanup.values()].map(value => value.status);
    this.#set({ pairingCleanup: statuses.includes("unconfirmed") ? "unconfirmed" : statuses.includes("pending") ? "pending" : statuses.length ? "sdk-confirmed" : "none" });
  }
  #quarantinePairProposal(client: WalletKitClient, topic: string): void {
    const proposal = this.#snapshot.proposal?.params.pairingTopic === topic ? this.#snapshot.proposal : this.#paused?.proposal?.params.pairingTopic === topic ? this.#paused.proposal : null;
    if (!proposal) return;
    if (this.#snapshot.proposal === proposal) this.#set({ proposal: null });
    if (this.#paused?.proposal === proposal) this.#paused.proposal = null;
    void this.pendingRecovery?.end("proposal",proposal).catch(()=>{});
    void client.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") }).catch(() => { this.#pairCleanup.set(topic, { revision: (this.#pairCleanup.get(topic)?.revision ?? 0) + 1, status: "unconfirmed" }); this.#publishPairCleanup(); });
  }
  async approveProposal(namespaces: SessionTypes.Namespaces): Promise<SessionTypes.Struct> {
    const proposal = this.#snapshot.proposal; if (!proposal) throw new Error("No WalletConnect proposal is awaiting review.");
    const client=this.#require(),generation=this.#reviewGeneration;
    this.pendingRecovery&&await this.pendingRecovery.decide("proposal",proposal,()=>{if(this.#snapshot.proposal!==proposal||this.#reviewGeneration!==generation)throw new Error("Proposal changed before approval.");});
    this.#set({proposal:null});
    const session = await client.approveSession({ id: proposal.id, namespaces });
    if(generation!==this.#reviewGeneration){await client.disconnectSession({topic:session.topic,reason:getSdkError("USER_DISCONNECTED")}).catch(()=>{});throw new Error("Wallet locked or authorization changed before connection approval completed.");}
    this.#approvedPairTopics.add(proposal.params.pairingTopic);
    return session;
  }
  async rejectProposal(): Promise<void> {
    const proposal = this.#snapshot.proposal; if (!proposal) return;
    this.pendingRecovery&&await this.pendingRecovery.end("proposal",proposal);this.#set({proposal:null});
    await this.#require().rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
  }
  async respond(result: unknown): Promise<void> {
    const pending = this.#snapshot.request; if (!pending) throw new Error("No WalletConnect request is awaiting review.");
    this.#set({request:null});
    await this.#require().respondSessionRequest({ topic: pending.topic, response: { jsonrpc: "2.0", id: pending.id, result } });
  }
  bindReviewedRequest(review:{topic:string;requestId:number;account:string;method:string;params:unknown;peer:{metadata:{url:string}};expiresAt:string},reviewedEvent:WalletConnectRequest|null) {
    const pending=this.#snapshot.request,client=this.#require(),generation=this.#reviewGeneration;
    if(!pending||pending!==reviewedEvent||pending.topic!==review.topic||pending.id!==review.requestId||pending.params.request.method!==review.method)throw new Error("The reviewed request is no longer current.");
    const original=client.getActiveSessions()[review.topic];
    if(!original)throw new Error("The reviewed session is no longer active.");
    const namespace=JSON.stringify(original.namespaces),origin=new URL(original.peer.metadata.url).origin;
    const assertCurrent=()=>{
      const current=client.getActiveSessions()[review.topic],permissions=current?.namespaces.eip155;
      if(this.#reviewGeneration!==generation||this.#snapshot.request!==pending||(this.#requestDeadlines.get(pending)??0)<=Math.floor(Date.now()/1000)||!current||JSON.stringify(current.namespaces)!==namespace||new URL(current.peer.metadata.url).origin!==origin||origin!==new URL(review.peer.metadata.url).origin||!permissions?.accounts.includes(`eip155:6423:${review.account}`)||!permissions.methods.includes(review.method)||review.expiresAt<=new Date().toISOString())throw new Error("The reviewed request or session authorization changed. Return to the app for a fresh review.");
    };
    assertCurrent();
    return Object.freeze({assertCurrent,respond:async(result:unknown)=>{assertCurrent();if(this.pendingRecovery)await this.pendingRecovery.assertDecided(pending);assertCurrent();this.#set({request:null});await client.respondSessionRequest({topic:pending.topic,response:{jsonrpc:"2.0",id:pending.id,result}})},reject:async(code=5000,message="User rejected the request.")=>{if(this.#reviewGeneration!==generation||this.#snapshot.request!==pending)return;if(this.pendingRecovery)await this.pendingRecovery.end("request",pending);if(this.#reviewGeneration!==generation||this.#snapshot.request!==pending)return;this.#set({request:null});await client.respondSessionRequest({topic:pending.topic,response:{jsonrpc:"2.0",id:pending.id,error:{code,message}}})}});
  }
  async rejectRequest(code = 5000, message = "User rejected the request."): Promise<void> {
    const pending = this.#snapshot.request; if (!pending) return;
    this.#set({request:null});
    await this.#require().respondSessionRequest({ topic: pending.topic, response: { jsonrpc: "2.0", id: pending.id, error: { code, message } } });
  }
  async rejectReviewedEvent(event: WalletConnectRequest, code: number, message: string): Promise<void> {
    if (this.#snapshot.request !== event) return;
    this.pendingRecovery&&await this.pendingRecovery.end("request",event);
    this.#set({ request: null });
    await this.#require().respondSessionRequest({ topic: event.topic, response: { jsonrpc: "2.0", id: event.id, error: { code, message } } });
  }
  async rejectRequestForSession(topic:string,code=5000,message="WalletConnect session is no longer authorized."):Promise<void>{
    const pending=this.#snapshot.request?.topic===topic?this.#snapshot.request:this.#paused?.request;if(!pending||pending.topic!==topic)return;
    this.#clearRequestForTopic(topic);
    this.pendingRecovery&&await this.pendingRecovery.end("request",pending);
    await this.#require().respondSessionRequest({topic:pending.topic,response:{jsonrpc:"2.0",id:pending.id,error:{code,message}}});
  }
  async disconnect(topic: string): Promise<void> { await this.disconnectSessions([topic]) }
  async disconnectSessions(topics:readonly string[]):Promise<void>{
    if(topics.length>50)throw new Error("WalletConnect disconnect limit exceeded.");
    const unique=[...new Set(topics)];if(unique.length!==topics.length)throw new Error("WalletConnect disconnect topics must be unique.");
    const client=this.#require(),pending=this.#snapshot.request;
    if(pending&&unique.includes(pending.topic)){
      this.#set({request:null});
      try{void client.respondSessionRequest({topic:pending.topic,response:{jsonrpc:"2.0",id:pending.id,error:{code:5103,message:"WalletConnect session authorization changed; resend after reconnecting."}}}).catch(()=>{})}catch{}
    }
    const failures:string[]=[];
    try{for(const topic of unique){try{await client.disconnectSession({topic,reason:getSdkError("USER_DISCONNECTED")})}catch{failures.push(topic)}}}
    finally{this.#refreshSessions(client)}
    if(failures.length)throw new Error(`WalletConnect could not disconnect ${failures.length} session${failures.length===1?"":"s"}.`);
  }
  clearSensitiveReview(): void { if (this.#snapshot.request) this.#set({ request: null }); }
  pauseForLock(account: string): void {
    this.#account=account;
    this.cancelPendingPair();
    if (this.#paused) return;
    const {request,proposal}=this.#snapshot;
    this.#reviewGeneration++;
    const session=request?this.#client?.getActiveSessions()[request.topic]:null;
    this.#paused={account,request,proposal,session:session?JSON.stringify({namespaces:session.namespaces,peer:session.peer}):null,deadline:request?this.#requestDeadlines.get(request)??Math.floor(Date.now()/1000):0};
    this.#set({request:null,proposal:null});
  }
  async resumeAfterUnlock(account: string): Promise<boolean> {
    this.#account=account;const paused=this.#paused;if(!paused){await this.#restorePending();return Boolean(this.#snapshot.request||this.#snapshot.proposal);}
    this.#paused=null;this.#reviewGeneration++;const generation=this.#reviewGeneration;
    const client=this.#client,now=Math.floor(Date.now()/1000),session=paused.request?client?.getActiveSessions()[paused.request.topic]:null;
    const sameAccount=paused.account===account;
    let request=paused.request&&sameAccount&&paused.deadline>now&&session&&paused.session===JSON.stringify({namespaces:session.namespaces,peer:session.peer})&&(!session.expiry||session.expiry>now)&&(!paused.request.params.request.expiryTimestamp||paused.request.params.request.expiryTimestamp>now)?paused.request:null;
    let proposal=paused.proposal&&sameAccount&&paused.proposal.params.expiryTimestamp>now?paused.proposal:null;
    if(this.pendingRecovery){if(request)try{await this.pendingRecovery.recover("request",request,account,pendingSessionBinding(session));}catch{request=null;}if(proposal)try{await this.pendingRecovery.recover("proposal",proposal,account,null);if(this.#pairTopics.get(proposal.params.pairingTopic)!==false||!await this.pairingJournal?.canResumeReview?.(proposal.params.pairingTopic))proposal=null;}catch{proposal=null;}}
    if(this.#reviewGeneration!==generation||this.#account!==account||this.#snapshot.request||this.#snapshot.proposal)return Boolean(this.#snapshot.request||this.#snapshot.proposal);
    this.#set({request,proposal});
    if(paused.request&&!request)this.pendingRecovery&&await this.pendingRecovery.end("request",paused.request);
    if(paused.proposal&&!proposal)this.pendingRecovery&&await this.pendingRecovery.end("proposal",paused.proposal);
    if(paused.request&&!request&&client)await client.respondSessionRequest({topic:paused.request.topic,response:{jsonrpc:"2.0",id:paused.request.id,error:{code:5103,message:"Wallet request expired or authorization changed while locked. Return to the app for a new request."}}}).catch(()=>{});
    if(paused.proposal&&!proposal&&client)await client.rejectSession({id:paused.proposal.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});
    if(!request&&!proposal)await this.#restorePending();return Boolean(this.#snapshot.request||this.#snapshot.proposal);
  }
  async rejectPendingForLock(): Promise<void> {
    this.cancelPair();
    const request = this.#snapshot.request??this.#paused?.request, proposal = this.#snapshot.proposal??this.#paused?.proposal;
    this.#paused=null;this.#reviewGeneration++;
    // Invalidate the old approval before awaiting transport. Later SDK events
    // belong to a fresh review and must not be cleared by this operation.
    this.#set({ request: null, proposal: null });
    if (!request && !proposal) return;
    const client = this.#require();
    if (request) await client.respondSessionRequest({ topic: request.topic, response: { jsonrpc: "2.0", id: request.id, error: { code: 5000, message: "Wallet locked before approval." } } }).catch(() => {});
    if (proposal) await client.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") }).catch(() => {});
  }
  async restore(): Promise<void> { await this.start(); this.#refreshSessions();await this.#restorePending(); }
  requestRecovery(event:WalletConnectRequest){return this.pendingRecovery?.get(event)??Promise.resolve(null);}
  rememberReview(event:WalletConnectRequest,review:WalletConnectRequestReview,at:Date){return this.pendingRecovery?.remember(event,review,at,()=>{if(this.#snapshot.request!==event)throw new Error("Request changed before review was saved.");})??Promise.resolve();}
  decideReviewedRequest(event:WalletConnectRequest,assertCurrent:()=>void){return this.pendingRecovery?.decide("request",event,assertCurrent)??Promise.resolve();}
  requestOutcomeUnconfirmed(event:WalletConnectRequest){return this.pendingRecovery?.end("request",event)??Promise.resolve();}
  async #restorePending():Promise<void>{
    if(!this.pendingRecovery||!this.#client||!this.#account)return;if(this.#restoringPending)return this.#restoringPending;
    const client=this.#client,account=this.#account,generation=this.#reviewGeneration;
    this.#restoringPending=(async()=>{
      const requests=client.getPendingSessionRequests?.()??[],proposals=Object.values(client.getPendingSessionProposals?.()??{});
      try{await this.pendingRecovery!.reconcilePending([...requests.map(event=>pendingReviewKey("request",event)),...proposals.map((event:any)=>`proposal:${event.id}`)]);}catch{this.#set({error:"WalletConnect review storage cannot be verified. Keep this Wallet profile and retry storage access; accounts and keys are unchanged."});for(const sdk of requests)await client.respondSessionRequest({topic:sdk.topic,response:{jsonrpc:"2.0",id:sdk.id,error:{code:5103,message:"The original request could not be restored safely. Return to the app for a new request."}}}).catch(()=>{});for(const sdk of proposals as any[])await client.rejectSession({id:sdk.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});return;}
      for(const sdk of requests){if(this.#account!==account||this.#reviewGeneration!==generation)return;if(this.#snapshot.request||this.#paused?.request)break;
        try{const session=client.getActiveSessions()[sdk.topic];if(!session)throw new Error("Session is no longer active.");const record=await this.pendingRecovery!.recover("request",sdk,account,pendingSessionBinding(session));if(this.#account!==account||this.#reviewGeneration!==generation)return;const event=record.event as WalletConnectRequest;this.#receivedAt.set(event,new Date(record.receivedAt));this.#requestDeadlines.set(event,Math.floor(record.deadline/1000));this.#acceptRequest(client,event,Math.floor(record.deadline/1000));}
        catch{await client.respondSessionRequest({topic:sdk.topic,response:{jsonrpc:"2.0",id:sdk.id,error:{code:5103,message:"The original review cannot be restored. Return to the app for a fresh request."}}}).catch(()=>{});this.#set({error:"The original request expired, changed or was already decided. Return to the app for a fresh request."});}
      }
      for(const sdk of proposals as any[]){if(this.#account!==account||this.#reviewGeneration!==generation)return;if(this.#snapshot.proposal||this.#paused?.proposal)break;
        try{const record=await this.pendingRecovery!.recover("proposal",{id:sdk.id,params:sdk},account,null);if(this.#account!==account||this.#reviewGeneration!==generation)return;const event=record.event as WalletConnectProposal;if(this.#pairTopics.get(event.params.pairingTopic)!==false||!await this.pairingJournal?.canResumeReview?.(event.params.pairingTopic))throw new Error("Original pairing is quarantined.");if(this.#paused)this.#paused.proposal=event;else this.#set({proposal:event});}
        catch{await client.rejectSession({id:sdk.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});this.#set({error:"The original connection review cannot be restored. Request a fresh QR code from the app."});}
      }
    })().finally(()=>{this.#restoringPending=null;});return this.#restoringPending;
  }
  refreshSessions():void{this.#refreshSessions()}
  async #initialize(): Promise<void> {
    for (const topic of await this.pairingJournal?.load() ?? []) this.#pairTopics.set(topic, true);
    const client = await this.factory(this.config!);
    for(const event of client.getPendingSessionRequests?.()??[])this.#coldRequests.add(pendingReviewKey("request",event));
    for(const event of Object.values(client.getPendingSessionProposals?.()??{}) as any[])this.#coldProposals.add(`proposal:${event.id}`);
    for (const session of Object.values(client.getActiveSessions())) if (session.pairingTopic) this.#approvedPairTopics.add(session.pairingTopic);
    // Older installed versions had no journal. Quarantine recovered unapproved
    // pairings before listeners; an existing approved session remains intact.
    for (const pairing of client.core?.pairing.getPairings?.() ?? []) {
      if (this.#approvedPairTopics.has(pairing.topic)) continue;
      if(this.pendingRecovery&&[...Object.values(client.getPendingSessionProposals?.()??{}) as any[]].some(proposal=>proposal.pairingTopic===pairing.topic)&&await this.pairingJournal?.canResumeReview?.(pairing.topic)){this.#pairTopics.set(pairing.topic,false);continue;}
      await this.pairingJournal?.record(pairing.topic, pairing.expiry ?? null);
      this.#pairTopics.set(pairing.topic, true);
    }
    client.on("session_proposal", async proposal => {
      if(this.#coldProposals.has(`proposal:${proposal.id}`)){void this.#restorePending();return;}
      if(this.pendingRecovery){try{if(!this.#account)throw new Error("Unlock the selected account first.");await this.pendingRecovery.capture("proposal",proposal,this.#account,null,new Date(),Math.min(proposal.params.expiryTimestamp*1000,Date.now()+300_000),this.#pairTopics.get(proposal.params.pairingTopic)===false);}catch{void client.rejectSession({id:proposal.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});this.#set({error:"Connection review could not be saved. Keep your Wallet data and request a fresh QR code."});return;}}
      const topic=proposal.params.pairingTopic;
      if(this.pendingRecovery){const saved=await this.pendingRecovery.recover("proposal",proposal,this.#account??"",null).catch(()=>null);if(!saved){void client.rejectSession({id:proposal.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});return;}}
      const knownApproved=Object.values(client.getActiveSessions()).some(session=>session.pairingTopic===topic);
      if (this.#pairOperation&&this.#pairOperation.topic!==topic || this.#pairTopics.get(topic) === true || this.#pairTopics.get(topic)!==false&&!knownApproved) {
        void client.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") }).catch(() => { const topic = proposal.params.pairingTopic; this.#pairCleanup.set(topic, { revision: (this.#pairCleanup.get(topic)?.revision ?? 0) + 1, status: "unconfirmed" }); this.#publishPairCleanup(); });
        return;
      }
      if (this.pairingJournal && this.#pairTopics.get(topic)===false) {
        const sdkExpiry=client.core?.pairing.getPairings?.().find(pairing=>pairing.topic===topic)?.expiry;
        const expiry=Math.max(this.#pairExpiry.get(topic)??0,proposal.params.expiryTimestamp??0,sdkExpiry??0);
        this.#pairExpiry.set(topic,expiry);
        try { if(this.pendingRecovery&&this.pairingJournal.review)await this.pairingJournal.review(topic,proposal.params.expiryTimestamp);else await this.pairingJournal.record(topic,expiry||null); }
        catch { this.#set({pairingCleanup:"unconfirmed",error:"Pairing safety state could not be verified."});void client.rejectSession({id:proposal.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});return; }
        if(this.#pairTopics.get(topic)!==false){void this.pairingJournal.record(topic,expiry||null).catch(()=>{});void this.pendingRecovery?.end("proposal",proposal).catch(()=>{});void client.rejectSession({id:proposal.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});return;}
      }
      if(this.#paused&&!this.#paused.proposal&&proposal.params.expiryTimestamp>Math.floor(Date.now()/1000)){this.#paused.proposal=proposal;return;}
      if(this.#paused||this.#snapshot.proposal){void client.rejectSession({id:proposal.id,reason:getSdkError("USER_REJECTED")}).catch(()=>{});return;}
      this.#set({proposal});if(this.#pairAttempt?.topic===topic)this.#pairStage(this.#pairAttempt,"proposal-received");
      if (this.#pairOperation && proposal.params.pairingTopic === this.#pairOperation.topic) this.#pairOperation.proposalReceived();
    });
    client.on("session_request", request => {
      if(this.#coldRequests.has(pendingReviewKey("request",request))){void this.#restorePending();return;}
      const receivedAt=new Date(),deadline=Math.min(request.params.request.expiryTimestamp??Infinity,Math.floor(receivedAt.getTime()/1000)+300);
      this.#receivedAt.set(request,receivedAt);
      if(!this.pendingRecovery){this.#acceptRequest(client,request,deadline);return;}
      const account=this.#account,session=client.getActiveSessions()[request.topic];
      if(!account||!session){void client.respondSessionRequest({topic:request.topic,response:{jsonrpc:"2.0",id:request.id,error:{code:5103,message:"Unlock the selected Wallet account before requesting approval."}}}).catch(()=>{});return;}
      void this.pendingRecovery.capture("request",request,account,pendingSessionBinding(session),receivedAt,deadline*1000).then(record=>{if(this.#account!==account){void this.pendingRecovery!.end("request",request).catch(()=>{});return;}this.#receivedAt.set(request,new Date(record.receivedAt));this.#acceptRequest(client,request,Math.floor(record.deadline/1000));}).catch(()=>{this.#set({error:"Wallet request cannot be restored safely. Return to the app for a fresh request."});void client.respondSessionRequest({topic:request.topic,response:{jsonrpc:"2.0",id:request.id,error:{code:5103,message:"Request expired, changed, was already decided, or could not be saved. Return to the app for a new request."}}}).catch(()=>{});});
    });
    client.on("session_request_expire",event=>{const request=this.#snapshot.request??this.#paused?.request;if(request&&request.id===event.id){void this.pendingRecovery?.end("request",request).catch(()=>{});this.#clearRequestForTopic(request.topic);}});
    client.on("proposal_expire",event=>{const proposal=this.#snapshot.proposal??this.#paused?.proposal;if(proposal?.id===event.id){void this.pendingRecovery?.end("proposal",proposal).catch(()=>{});if(this.#paused)this.#paused.proposal=null;this.#set({proposal:null});}});
    client.on("session_update", event => { void this.rejectRequestForSession(event.topic,5103,"WalletConnect session updated; resend the request after reconciliation.").catch(()=>{});this.#updateSession(event.topic,event.params.namespaces,client); this.#emitSessionEvent({ kind: "updated", topic: event.topic, namespaces: event.params.namespaces }); });
    client.on("session_expire", event => { this.#clearRequestForTopic(event.topic);this.#removeSession(event.topic,client); this.#emitSessionEvent({ kind: "expired", topic: event.topic }); });
    client.on("session_delete", event => { this.#clearRequestForTopic(event.topic);this.#removeSession(event.topic,client); this.#emitSessionEvent({ kind: "deleted", topic: event.topic }); });
    this.#client = client;
    const relayer=client.core?.relayer;
    if(relayer){
      for(const event of ["relayer_connect","relayer_disconnect","relayer_transport_closed","relayer_connection_stalled"]){relayer.on(event,()=>this.#syncRelay(client));}
      relayer.on("relayer_error",error=>{const details=safeRelayError(error);this.#set({relayTransport:"failed",relayErrorCode:details.code??this.#snapshot.relayErrorCode,relayHTTPStatus:details.status,relayRetryAvailable:this.#relayAttempts<3});});
      relayer.subscriber?.on("subscription_created",event=>{if(this.#pairAttempt&&event?.topic===this.#pairAttempt.topic)this.#pairStage(this.#pairAttempt,"subscribed");});
      this.#syncRelay(client);
    }
    this.#refreshSessions(client); this.#set({ phase: "ready", error: null, retryAvailable: false });
  }
  #acceptRequest(client:WalletKitClient,request:WalletConnectRequest,deadline:number):void {
      if(this.#paused&&!this.#paused.request){
        const session=client.getActiveSessions()[request.topic],permissions=session?.namespaces.eip155;
        if(deadline>Math.floor(Date.now()/1000)&&session&&(!session.expiry||session.expiry>Math.floor(Date.now()/1000))&&permissions?.accounts.includes(`eip155:6423:${this.#paused.account}`)&&permissions.methods.includes(request.params.request.method)){
          this.#requestDeadlines.set(request,deadline);this.#paused.request=request;this.#paused.deadline=deadline;this.#paused.session=JSON.stringify({namespaces:session.namespaces,peer:session.peer});return;
        }
      }
      if(this.#paused||this.#snapshot.request){void this.pendingRecovery?.end("request",request).catch(()=>{});void client.respondSessionRequest({topic:request.topic,response:{jsonrpc:"2.0",id:request.id,error:{code:5000,message:"Wallet request is not authorized or another request is awaiting review."}}}).catch(()=>{});return;}
      this.#requestDeadlines.set(request,deadline);this.#set({request});
  }
  #syncRelay(client:WalletKitClient):void {
    const relayer=client.core?.relayer;if(!relayer)return;
    const relayTransport=relayer.connected?"connected":relayer.connecting?"connecting":"disconnected";
    if(relayer.connected)this.#relayAttempts=0;
    const attempt=this.#pairAttempt,subscriber=relayer.subscriber;
    this.#set({relayTransport,relayRetryAvailable:!relayer.connected&&this.#relayAttempts<3,...(relayer.connected?{relayErrorCode:null,relayHTTPStatus:null}:{})});
    if(attempt&&subscriber)this.#pairStage(attempt,subscriber.topics.includes(attempt.topic)?"subscribed":subscriber.pending.has(attempt.topic)?"subscribe-pending":"sdk-pair");
  }
  #pairStage(attempt:{topic:string;revision:number;stage:WalletConnectSnapshot["pairTransportStage"]},next:WalletConnectSnapshot["pairTransportStage"]):void {
    if(this.#pairAttempt!==attempt||["timed-out","canceled","failed"].includes(attempt.stage))return;
    const order=["idle","sdk-pair","subscribe-pending","subscribed","proposal-received"];
    if(!["timed-out","canceled","failed"].includes(next)&&order.indexOf(next)<order.indexOf(attempt.stage))return;
    attempt.stage=next;this.#set({pairTransportStage:next});
  }
  async retryRelay():Promise<void> {
    const client=this.#require(),relayer=client.core?.relayer;
    if(!relayer)throw new Error("Relay transport status is unavailable.");
    if(this.#relayRetry)return this.#relayRetry;
    if(relayer.connected){this.#syncRelay(client);return;}
    if(this.#relayAttempts>=3)throw new Error("Relay retry limit reached. Wait for transport recovery before retrying.");
    this.#relayAttempts++;this.#set({relayTransport:"connecting",relayRetryAvailable:false,relayErrorCode:null,relayHTTPStatus:null});
    let timer:ReturnType<typeof setTimeout>;
    this.#relayRetry=(async()=>{
      try{
        await Promise.race([Promise.resolve().then(()=>relayer.transportOpen()),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("Relay connection timed out."),{code:"RELAY_TIMEOUT"})),this.pairDeadlineMs)})]);
        if(!relayer.connected)throw Object.assign(new Error("Relay transport is still disconnected."),{code:"RELAY_DISCONNECTED"});
        this.#syncRelay(client);
      }catch(error){const details=safeRelayError(error);this.#set({relayTransport:"failed",relayErrorCode:details.code??this.#snapshot.relayErrorCode,relayHTTPStatus:details.status,relayRetryAvailable:this.#relayAttempts<3});throw new Error(publicError(error));}
      finally{clearTimeout(timer!);this.#relayRetry=null;}
    })();return this.#relayRetry;
  }
  #emitSessionEvent(event: Omit<WalletConnectSessionEvent, "revision">): void { this.#revision += 1; this.#set({ sessionEvent: Object.freeze({ ...event, revision: this.#revision }) }); }
  #clearRequestForTopic(topic:string):void{const request=this.#snapshot.request?.topic===topic?this.#snapshot.request:this.#paused?.request?.topic===topic?this.#paused.request:null;if(request)void this.pendingRecovery?.end("request",request).catch(()=>{});if(this.#paused?.request?.topic===topic)this.#paused.request=null;if(this.#snapshot.request?.topic===topic)this.#set({request:null})}
  #updateSession(topic:string,namespaces:SessionTypes.Namespaces,client:WalletKitClient):void{const sessions=Object.values(client.getActiveSessions()).map(session=>session.topic===topic?{...session,namespaces}:session);this.#set({sessions:Object.freeze(sessions)})}
  #removeSession(topic:string,client:WalletKitClient):void{const sessions=Object.values(client.getActiveSessions()).filter(session=>session.topic!==topic);this.#set({sessions:Object.freeze(sessions)})}
  #refreshSessions(client: WalletKitClient | null = this.#client): void { const sessions: SessionTypes.Struct[] = client ? Object.values(client.getActiveSessions()) : []; this.#set({ sessions: Object.freeze(sessions) }); }
  #require(): WalletKitClient { if (!this.#client || this.#snapshot.phase !== "ready") throw new Error(this.#snapshot.error ?? "WalletConnect is not ready."); return this.#client; }
  #set(patch: Partial<WalletConnectSnapshot>): void { this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch }); for (const listener of this.#listeners) listener(this.#snapshot); }
}

export function walletConnectRuntimeConfig(environment: Record<string, string | undefined> = process.env): RuntimeConfig | null {
  // Public application configuration, not a Relay secret or session credential.
  const raw = (environment.EXPO_PUBLIC_REOWN_PROJECT_ID ?? "41857128a14a593ca4e4a7cb7c838d71").trim();
  if (!raw) return null;
  return parseWalletConnectRuntimeConfig({ projectId: raw.toLowerCase() });
}

function safeRelayError(value:any):{code:string|null;status:number|null}{
 const raw=value?.code,code=(typeof raw==="string"&&/^[A-Za-z0-9_-]{1,40}$/.test(raw))||typeof raw==="number"&&Number.isSafeInteger(raw)?String(raw):null;
 const rawStatus=value?.statusCode??value?.response?.status,status=Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599?rawStatus:null;
 return {code,status};
}
function publicError(value: unknown): string { return value instanceof Error && value.message ? value.message.replace(/(?:https?|wss?|wc):\S+/g,"[redacted URL]").replace(/[a-f0-9]{64,}/gi,"[redacted identifier]").slice(0, 240) : "WalletConnect could not start."; }
