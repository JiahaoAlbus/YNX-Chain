import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { getSdkError } from "@walletconnect/utils";
import { parseProductSessionWalletURL, parseWalletConnectPairingUri } from "@ynx-chain/wallet-auth";
import { PRODUCT_SESSION_REGISTRY } from "./wallet-auth-contract.mjs";
import { CENTRAL_BROWSER_METHOD, parseCentralSignIn } from "./central-browser-sign-in.mjs";
import { createPrivateWalletConnectStorage } from "./walletconnect-private-storage.mjs";

// This desktop main process is Node. The pinned SDK's Node/CJS exports avoid
// its ESM default-import mismatch with keyvaluestorage; mobile uses Metro.
const require = createRequire(import.meta.url);
const { Core } = require("@walletconnect/core");
const { WalletKit } = require("@reown/walletkit");
export function createWalletConnectCore(options) { return new Core(options); }

export const WALLETCONNECT_CHAIN = "eip155:6423";
export const WALLETCONNECT_METHODS = Object.freeze(["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "ynx_requestProductSessionV2", CENTRAL_BROWSER_METHOD]);
export const WALLETCONNECT_EVENTS = Object.freeze(["accountsChanged", "chainChanged"]);
const TOMBSTONE_STORAGE_KEY = "ynx-wallet:walletconnect-disconnected-topics:v1";
const PAIRING_STORAGE_KEY = "ynx-wallet:walletconnect-pairing-quarantine:v1";
const PAIR_DEADLINE_MS=30_000;
const PROPOSAL_STORE="ynx-wallet:walletconnect-proposal-reviews:v1";
const canonical=value=>JSON.stringify(value&&typeof value==="object"?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const proposalDigest=proposal=>createHash("sha256").update(canonical({id:proposal.id,params:proposal.params})).digest("hex");

export class WalletConnectTransport {
  constructor({ projectId, metadata, storagePath, configurationError = null, walletKitFactory = defaultFactory, clock = () => Date.now(), pairDeadlineMs=PAIR_DEADLINE_MS }) {
    if(!Number.isSafeInteger(pairDeadlineMs)||pairDeadlineMs<1||pairDeadlineMs>PAIR_DEADLINE_MS)throw transportError("INVALID_PAIR_DEADLINE","Pair deadline is invalid");
    this.projectId = projectId?.trim() || null;
    this.metadata = metadata;
    this.storagePath = storagePath;
    this.configurationError = configurationError;
    this.walletKitFactory = walletKitFactory;
    this.clock = clock;
    this.walletKit = null;
    this.proposals = new Map();
    this.proposalActions = new Set();this.proposalDecisionLeases=new Set();this.proposalRecords=new Map();this.proposalWrites=Promise.resolve();
    this.sessionOrigins = new Map();
    this.disconnectedTopics = new Set();
    this.tombstoneWrites = Promise.resolve();
    this.starting=null;this.clientPromise=null;this.pairDeadlineMs=pairDeadlineMs;this.pairOperation=null;this.pairRevision=0;this.pairings=new Map();this.sdkPairPending=new Set();this.pairWrites=Promise.resolve();this.pairState={phase:"idle",cleanup:"none"};
  }
  status() {
    const started = this.walletKit !== null;
    const relayConnected = this.walletKit?.core?.relayer?.connected === true;
    return Object.freeze({
      configured: this.projectId !== null,
      started,
      relayConnected,
      pairing: this.pairOperation!==null,
      pair: Object.freeze({...this.pairState}),
      activeSessionCount: started ? Object.values(this.walletKit.getActiveSessions?.() ?? {}).filter(session => !this.disconnectedTopics.has(session.topic)).length : 0,
      code: this.configurationError || (!this.projectId ? "WALLETCONNECT_PROJECT_ID_UNAVAILABLE" : relayConnected ? null : "WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED")
    });
  }
  async start(handlers = {}) {
    if(this.starting)return this.starting;
    if(this.walletKit)return this.status();
    this.starting=this.#start(handlers);try{return await this.starting;}catch(error){this.starting=null;throw error;}
  }
  async #start(handlers) {
    this.handlers=handlers;
    if (this.configurationError) throw transportError(this.configurationError, "WalletConnect public configuration is invalid");
    if (!this.projectId) throw transportError("WALLETCONNECT_PROJECT_ID_UNAVAILABLE", "WalletConnect project ID is not configured");
    if(!this.clientPromise){this.clientPromise=Promise.resolve().then(()=>this.walletKitFactory({projectId:this.projectId,metadata:this.metadata,storagePath:this.storagePath}));this.clientPromise.catch(()=>{this.clientPromise=null;});}
    this.walletKit=await this.clientPromise;
    try { await this.#restoreDisconnectedTopics();await this.#restorePairings();await this.#restoreProposalRecords(); }
    catch (error) { this.walletKit = null; throw error; }
    this.walletKit.on("session_proposal", async raw => {
      let proposal=raw;
      try {
        proposal=normalizeProposal(raw);
        const topic=proposal?.params?.pairingTopic;if(this.pairings.get(topic)?.canceled)throw transportError("WALLETCONNECT_PAIR_CANCELED","This pairing was canceled; request a fresh QR code");
        validateProposal(proposal, this.#nowSeconds());
        proposalHttpsOrigin(proposal);
        if (!this.proposals.has(String(proposal.id)) && this.proposals.size >= 64) throw transportError("WALLETCONNECT_PROPOSAL_LIMIT", "Too many pending connection reviews");
        await this.#captureProposal(proposal);
        if(this.pairings.get(topic)?.canceled)throw transportError("WALLETCONNECT_PAIR_CANCELED","The original pairing ended");
        this.proposals.set(String(proposal.id), proposal);
        if(this.pairOperation&&this.pairOperation.topic===proposal.params.pairingTopic){this.pairOperation.proposal=true;this.pairOperation.resolveProposal({proposalReceived:true});}
        handlers.onSessionProposal?.(proposal);
      } catch (error) {
        void Promise.resolve(this.walletKit.rejectSession?.({id:proposal?.id,reason:getSdkError("USER_REJECTED")})).catch(()=>{});
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
    // Restore public proposals/requests for fresh review, never execute them.
    const proposals = Object.values(this.walletKit.getPendingSessionProposals?.() ?? {});
    for (const raw of proposals) {
      let proposal=raw;
      try {
        proposal=normalizeProposal(raw);const original=this.proposalRecords.get(String(proposal.id));if(this.reviewStorage()&&(!original||original.state!=="undecided"||!original.eligible||original.deadline<=this.clock()||original.digest!==proposalDigest(proposal)))throw transportError("WALLETCONNECT_ORIGINAL_PROPOSAL_UNAVAILABLE","Return to the app for a fresh connection request");if(this.pairings.get(proposal.params.pairingTopic)?.canceled)throw transportError("WALLETCONNECT_FRESH_PAIR_REQUIRED","Request a fresh QR code to review this connection");
        validateProposal(proposal, this.#nowSeconds()); proposalHttpsOrigin(proposal);
        if (!this.proposals.has(String(proposal.id)) && this.proposals.size >= 64) throw transportError("WALLETCONNECT_PROPOSAL_LIMIT", "Too many pending connection reviews");
        proposal={...proposal,verifyContext:original?.verification??proposal.verifyContext};this.proposals.set(String(proposal.id), proposal); handlers.onSessionProposal?.(proposal);
      }
      catch (error) { handlers.onProposalInvalid?.({ id: proposal?.id ?? null, code: error?.code ?? "INVALID_WALLETCONNECT_PROPOSAL" }); }
    }
    const requests = this.walletKit.getPendingSessionRequests?.() ?? [];
    if (!Array.isArray(requests)) throw transportError("INVALID_WALLETCONNECT_PENDING_REQUESTS", "Stored WalletConnect requests cannot be restored safely");
    for (const request of requests) {
      if (this.disconnectedTopics.has(request.topic)) continue;
      handlers.onSessionRequest?.({ ...request, restored: true });
    }
    return this.status();
  }
  async pair(uri) {
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    const parsed=parseWalletConnectPairingUri(uri,new Date(this.clock())),topic=parsed.topic;
    if(this.pairOperation)throw transportError("WALLETCONNECT_PAIR_BUSY","Cancel the current pairing before retrying");
    if(this.sdkPairPending.size>=100)throw transportError("WALLETCONNECT_PAIR_LIMIT","Existing SDK pair attempts have not finished yet");
    if(this.pairings.has(topic))throw transportError("WALLETCONNECT_FRESH_PAIR_REQUIRED","Request a fresh QR code from the app");
    const operation={topic,revision:++this.pairRevision,canceled:false,cancel:null,proposal:false,resolveProposal:null};const received=new Promise(resolve=>operation.resolveProposal=resolve);this.pairOperation=operation;this.pairState={phase:"pairing",cleanup:"none"};this.#notifyPair();
    this.pairings.set(topic,{topic,expiresAt:(parsed.expiryTimestamp??this.#nowSeconds()+300)*1000,canceled:false});
    let timer;const interrupted=new Promise((_,reject)=>{operation.cancel=code=>{if(operation.canceled)return;operation.canceled=true;this.pairings.get(topic).canceled=true;this.pairState={phase:code==="WALLETCONNECT_PAIR_TIMEOUT"?"timed-out":code==="WALLETCONNECT_PAIR_FAILED"?"failed":"canceled",cleanup:"pending"};reject(transportError(code,"Pairing ended. Request a fresh QR code; remote cleanup is not confirmed."));void this.#cleanPair(operation);};timer=setTimeout(()=>operation.cancel("WALLETCONNECT_PAIR_TIMEOUT"),this.pairDeadlineMs);});interrupted.catch(()=>{});
    const sdk=Promise.resolve().then(async()=>{await this.#persistPairings();if(operation.canceled)throw transportError("WALLETCONNECT_PAIR_CANCELED","Pairing canceled before transport");this.sdkPairPending.add(topic);try{return await this.walletKit.pair({uri});}finally{this.sdkPairPending.delete(topic);}});
    sdk.then(()=>{if(operation.canceled)void this.#cleanPair(operation);},()=>{if(operation.canceled)void this.#cleanPair(operation);});
    try{const result=await Promise.race([sdk,interrupted,received]);if(this.pairOperation===operation)this.pairState={phase:operation.proposal?"proposal-received":"submitted",cleanup:"none"};return result??{submitted:true};}
    catch(error){if(!operation.canceled)operation.cancel("WALLETCONNECT_PAIR_FAILED");throw error;}
    finally{clearTimeout(timer);if(this.pairOperation===operation)this.pairOperation=null;this.#notifyPair();}
  }
  cancelPair(preserveReviewedProposal=false){if(this.pairOperation&&!(preserveReviewedProposal&&this.pairOperation.proposal))this.pairOperation.cancel("WALLETCONNECT_PAIR_CANCELED");this.#notifyPair();return this.status();}
  #notifyPair(){this.handlers?.onPairState?.(this.status());}
  pendingRequestKeys(){return (this.walletKit?.getPendingSessionRequests?.()??[]).map(event=>JSON.stringify([event.topic,event.id]));}
  reviewStorage(){return this.walletKit?.core?.storage??null;}
  async #restorePairings(){const storage=this.reviewStorage();if(!storage?.getItem)return;const state=await storage.getItem(PAIRING_STORAGE_KEY);if(state!=null){if(state.version!==1||!Array.isArray(state.records)||state.records.length>100||state.records.some(item=>!item||!/^[a-f0-9]{64}$/.test(item.topic)||!Number.isSafeInteger(item.expiresAt)))throw transportError("WALLETCONNECT_PAIR_STORAGE_UNAVAILABLE","Pairing safety records cannot be verified");for(const item of state.records)if(item.expiresAt>this.clock())this.pairings.set(item.topic,{...item,canceled:item.canceled!==false||item.review!==true});}}
  async #persistPairings(){const work=this.pairWrites.catch(()=>{}).then(async()=>{for(const [topic,item]of this.pairings)if(item.expiresAt<=this.clock()&&this.pairOperation?.topic!==topic&&!this.sdkPairPending.has(topic))this.pairings.delete(topic);if(this.pairings.size>100)throw transportError("WALLETCONNECT_PAIR_LIMIT","Wait for existing pairing requests to expire before retrying");const storage=this.reviewStorage();if(!storage?.setItem){if(this.walletKitFactory===defaultFactory)throw transportError("WALLETCONNECT_PAIR_STORAGE_UNAVAILABLE","Pairing safety storage is unavailable");return;}const state={version:1,records:[...this.pairings.values()]};await storage.setItem(PAIRING_STORAGE_KEY,state);if(JSON.stringify(await storage.getItem(PAIRING_STORAGE_KEY))!==JSON.stringify(state))throw transportError("WALLETCONNECT_PAIR_STORAGE_UNAVAILABLE","Pairing safety write could not be verified");});this.pairWrites=work;return work;}
  async #cleanPair(operation){let timer;try{await this.#persistPairings();if(!this.walletKit.core?.pairing?.disconnect)throw new Error();await Promise.race([this.walletKit.core.pairing.disconnect({topic:operation.topic}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),1500);})]);const pairings=this.walletKit.core.pairing.getPairings?.();if(!pairings||pairings.some(item=>item.topic===operation.topic))throw new Error();if(operation.revision===this.pairRevision)this.pairState={...this.pairState,cleanup:"sdk-confirmed"};}catch{if(operation.revision===this.pairRevision)this.pairState={...this.pairState,cleanup:"unconfirmed"};}finally{clearTimeout(timer);this.#notifyPair();}}
  async #restoreProposalRecords(){const storage=this.reviewStorage();if(!storage?.getItem)return;const state=await storage.getItem(PROPOSAL_STORE);if(state==null)return;
    if(state.version!==1||!Array.isArray(state.records)||state.records.length>256||JSON.stringify(state).length>262144||state.records.some(record=>!record||!Number.isSafeInteger(record.id)||!/^[a-f0-9]{64}$/.test(record.digest)||!Number.isSafeInteger(record.deadline)||typeof record.eligible!=="boolean"||record.account!==null&&typeof record.account!=="string"||!["undecided","decided"].includes(record.state))||new Set(state.records.map(record=>record.id)).size!==state.records.length)throw transportError("WALLETCONNECT_REVIEW_STORAGE_INVALID","Connection review safety records cannot be verified");
    const pending=new Set(Object.values(this.walletKit.getPendingSessionProposals?.()??{}).map(proposal=>proposal.id));for(const record of state.records)if(record.deadline>this.clock()||pending.has(record.id))this.proposalRecords.set(String(record.id),JSON.parse(JSON.stringify(record)));
  }
  #persistProposalRecords(){const work=this.proposalWrites.catch(()=>{}).then(async()=>{const storage=this.reviewStorage();if(!storage?.setItem){if(this.walletKitFactory===defaultFactory)throw transportError("WALLETCONNECT_REVIEW_STORAGE_UNAVAILABLE","Keep Wallet data and retry");return;}const state={version:1,records:[...this.proposalRecords.values()]};await storage.setItem(PROPOSAL_STORE,state);if(JSON.stringify(await storage.getItem(PROPOSAL_STORE))!==JSON.stringify(state))throw transportError("WALLETCONNECT_REVIEW_WRITE_UNCONFIRMED","Connection decision could not be verified");});this.proposalWrites=work;return work;}
  async #captureProposal(proposal){if(!this.reviewStorage())return;const key=String(proposal.id),previous=this.proposalRecords.get(key),digest=proposalDigest(proposal);if(previous){if(previous.state!=="undecided"||previous.digest!==digest||previous.deadline<=this.clock())throw transportError("WALLETCONNECT_PROPOSAL_ALREADY_DECIDED","Request a fresh connection");return;}
    const topic=proposal.params.pairingTopic,pairing=this.pairings.get(topic),knownSession=Object.values(this.walletKit.getActiveSessions?.()??{}).some(session=>session.pairingTopic===topic);if(pairing?.canceled||!pairing&&!knownSession)throw transportError("WALLETCONNECT_FRESH_PAIR_REQUIRED","Request a fresh QR code from the app");
    const pending=new Set(Object.values(this.walletKit.getPendingSessionProposals?.()??{}).map(value=>value.id));for(const [id,record]of this.proposalRecords)if(record.deadline<=this.clock()&&!pending.has(record.id))this.proposalRecords.delete(id);if(this.proposalRecords.size>=256)throw transportError("WALLETCONNECT_PROPOSAL_LIMIT","Wait for existing reviews to expire");
    this.proposalRecords.set(key,{id:proposal.id,digest,deadline:Math.min(proposal.expiryTimestamp*1000,this.clock()+300000),eligible:true,account:null,state:"undecided",decision:null,verification:proposal.verifyContext??null});if(pairing){pairing.review=true;await this.#persistPairings();}await this.#persistProposalRecords();
  }
  async bindProposalAccount(id,account){const record=this.proposalRecords.get(String(id));if(!record){if(this.reviewStorage())throw transportError("WALLETCONNECT_ORIGINAL_PROPOSAL_UNAVAILABLE","Request a fresh connection");return;}if(record.account!==null&&record.account!==account||record.state!=="undecided"||record.deadline<=this.clock())throw transportError("ACCOUNT_CHANGED","The original account or connection review changed");record.account=account;await this.#persistProposalRecords();}
  async decideProposal(id,account,assertCurrent=()=>{}){const proposal=this.proposals.get(String(id)),record=this.proposalRecords.get(String(id));assertCurrent();if(!proposal||this.pairings.get(proposal.params.pairingTopic)?.canceled)throw transportError("WALLETCONNECT_ORIGINAL_PROPOSAL_UNAVAILABLE","Request a fresh connection");if(!record){if(this.reviewStorage())throw transportError("WALLETCONNECT_ORIGINAL_PROPOSAL_UNAVAILABLE","Request a fresh connection");return;}if(record.state!=="undecided"||record.deadline<=this.clock()||record.account!==account||record.digest!==proposalDigest(proposal))throw transportError("WALLETCONNECT_PROPOSAL_ALREADY_DECIDED","The original review ended or changed");if(this.reviewStorage()){const saved=(await this.reviewStorage().getItem(PROPOSAL_STORE))?.records?.find(item=>item.id===proposal.id);if(!saved||saved.state!=="undecided"||saved.digest!==record.digest||saved.account!==account||saved.deadline!==record.deadline)throw transportError("WALLETCONNECT_ORIGINAL_PROPOSAL_UNAVAILABLE","The original connection review is missing");}assertCurrent();record.state="decided";record.decision="approve";await this.#persistProposalRecords();assertCurrent();this.proposalDecisionLeases.add(String(id));}
  proposalReviewDeadline(id){const proposal=this.proposals.get(String(id));return this.proposalRecords.get(String(id))?.deadline??proposal?.expiryTimestamp*1000;}
  async approveSession(id, account,assertCurrent=()=>{}) {
    const proposal = this.proposals.get(String(id));
    if (!proposal) throw transportError("UNKNOWN_WALLETCONNECT_PROPOSAL", "WalletConnect proposal is unknown or expired");
    const key = String(id);
    if (this.proposalActions.has(key)) throw transportError("WALLETCONNECT_PROPOSAL_ACTION_IN_PROGRESS", "WalletConnect proposal already has an approval or rejection in progress");
    this.proposalActions.add(key);
    try {
      assertCurrent();const record=this.proposalRecords.get(key);if(record&&record.deadline<=this.clock())throw transportError("EXPIRED_WALLETCONNECT_PROPOSAL","The original connection review expired");
      const approved = validateProposal(proposal, this.#nowSeconds());
      const approvedAccount = normalizeAccount(account);
      if(this.proposalRecords.get(key)?.state==="undecided")await this.decideProposal(id,account);
      if(this.reviewStorage()&&(!this.proposalDecisionLeases.has(key)||this.proposalRecords.get(key)?.decision!=="approve"))throw transportError("WALLETCONNECT_PROPOSAL_ALREADY_DECIDED","The connection decision was already used. Request a fresh QR code.");
      this.proposalDecisionLeases.delete(key);
      const session = await this.walletKit.approveSession({ id: proposal.id, namespaces: {
        eip155: {
          chains: [WALLETCONNECT_CHAIN],
          accounts: [`${WALLETCONNECT_CHAIN}:${approvedAccount}`],
          methods: approved.methods,
          events: approved.events
        }
      } });
      try{assertCurrent();}catch(error){await this.#tombstoneTopic(session.topic);await this.walletKit.disconnectSession({topic:session.topic,reason:getSdkError("USER_DISCONNECTED")}).catch(()=>{});throw error;}
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
      const record=this.proposalRecords.get(key);if(record){record.state="decided";record.decision="reject";this.proposalDecisionLeases.delete(key);await this.#persistProposalRecords();}else if(this.reviewStorage())throw transportError("WALLETCONNECT_ORIGINAL_PROPOSAL_UNAVAILABLE","The original review is missing");
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
    verifyPeer(event?.verifyContext,this.sessionOrigin(event?.topic));
    if (!this.walletKit) throw transportError("WALLETCONNECT_NOT_STARTED", "WalletConnect transport is not started");
    const topic = event?.topic;
    const namespace = this.#sessionNamespace(topic);
    const chainId = event?.params?.chainId;
    const request = event?.params?.request;
    if (chainId !== WALLETCONNECT_CHAIN) throw transportError("UNSUPPORTED_WALLETCONNECT_CHAIN", "WalletConnect request targets a different chain");
    if (!request || typeof request.method !== "string" || !namespace.methods.includes(request.method)) throw transportError("UNAUTHORIZED_WALLETCONNECT_METHOD", "WalletConnect method was not approved for this session");
    if (!Array.isArray(request.params)) throw transportError("INVALID_WALLETCONNECT_REQUEST", "WalletConnect request parameters must be an array");
    let requestedAccount;
    if(request.method === CENTRAL_BROWSER_METHOD) {
      parseCentralSignIn(request.params, this.sessionOrigin(topic), this.clock());
      requestedAccount = normalizeAccount(selectedAccount);
    } else if(request.method === "ynx_requestProductSessionV2") {
      if(request.params.length !== 1 || typeof request.params[0] !== "string" || request.params[0].length > 32768) throw transportError("INVALID_WALLETCONNECT_REQUEST","Sign-in requires the exact official Wallet route");
      const productRequest = parseProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,request.params[0],new Date(this.clock()));
      if(productRequest.origin !== this.sessionOrigin(topic)) throw transportError("PRODUCT_SESSION_ORIGIN_MISMATCH","The sign-in origin does not match this session");
      requestedAccount = normalizeAccount(selectedAccount);
    } else requestedAccount = requestAccount(request);
    if (requestedAccount !== normalizeAccount(selectedAccount) || !namespace.accounts.some(account => account.toLowerCase() === `${WALLETCONNECT_CHAIN}:${requestedAccount}`)) {
      throw transportError("UNAUTHORIZED_WALLETCONNECT_ACCOUNT", "WalletConnect request account must match this session and the selected Wallet account");
    }
    return Object.freeze({ topic, jsonRpcId: event.id, origin: this.sessionOrigin(topic), method: request.method, params: request.params,sessionBinding:JSON.stringify({namespaces:this.walletKit.getActiveSessions()[topic].namespaces,peer:this.walletKit.getActiveSessions()[topic].peer,expiry:this.walletKit.getActiveSessions()[topic].expiry}) });
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

async function defaultFactory({ projectId, metadata, storagePath }) {
  let storage;
  try { storage = await createPrivateWalletConnectStorage(storagePath); }
  catch { throw transportError("WALLETCONNECT_STORAGE_UNAVAILABLE", "The existing Pair storage could not be verified. Keep this Wallet profile and retry."); }
  const core = createWalletConnectCore({ projectId, storage });
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
function normalizeProposal(value){if(!value||typeof value!=="object")return value;const params=value.params??value;if(params.expiryTimestamp!==undefined&&value.expiryTimestamp!==undefined&&params.expiryTimestamp!==value.expiryTimestamp||params.id!==undefined&&value.id!==params.id)throw transportError("INVALID_WALLETCONNECT_PROPOSAL","WalletConnect proposal fields conflict");const expiry=params.expiryTimestamp??value.expiryTimestamp;return {...value,params,expiryTimestamp:expiry};}
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
function verifyPeer(context,origin){const verified=context?.verified;if(!verified)return;if(verified.isScam===true||verified.validation==="INVALID"||verified.validation==="VALID"&&verified.origin!==origin)throw transportError("UNSAFE_WALLETCONNECT_ORIGIN","The app verification failed. Reject this request and check the app address.");}
function proposalHttpsOrigin(proposal) {
  const value = proposal?.params?.proposer?.metadata?.url;
  try { const url = new URL(value); if (url.protocol !== "https:") throw new Error();verifyPeer(proposal.verifyContext,url.origin);return url.origin; } catch { throw transportError("INVALID_WALLETCONNECT_PEER", "WalletConnect proposal has no valid HTTPS origin"); }
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
