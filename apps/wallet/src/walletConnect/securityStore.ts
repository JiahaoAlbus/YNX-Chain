import { createWalletConnectRequestReview, finalizeWalletConnectRequestReview, WalletConnectRequestReplayStore, type WalletConnectRequestReview, type WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import type { SessionTypes } from "@walletconnect/types";
import { keccak256, toUtf8Bytes } from "ethers";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const KEY="ynx.wallet.walletconnect.security.v1";
const MAX_STATE_CHARS=512_000,MAX_OUTBOX_RECORDS=128,MAX_RESPONSE_CHARS=128_000;
const HEX_32=/^[0-9a-f]{64}$/,ADDRESS=/^0x[0-9a-f]{40}$/,SIGNATURE=/^0x[0-9a-f]{130}$/,TX_HASH=/^0x[0-9a-f]{64}$/;
const METHODS=new Set(["eth_accounts","eth_requestAccounts","eth_chainId","wallet_switchEthereumChain","wallet_addEthereumChain","personal_sign","eth_signTypedData_v4","eth_sendTransaction","wallet_request_unreviewed"]);
const operationQueues=new WeakMap<object,Promise<void>>();
type ReplaySnapshot=ReturnType<WalletConnectRequestReplayStore["snapshot"]>;
export type WalletConnectJsonRpcResponse=Readonly<{jsonrpc:"2.0";id:number;result:unknown}|{jsonrpc:"2.0";id:number;error:Readonly<{code:number;message:string}>}>;
export type WalletConnectResponseStage="reviewing"|"authorized"|"executing"|"ready"|"delivered"|"quarantined";
export type WalletConnectResponseRecord=Readonly<{version:1;key:string;topic:string;requestId:number;sessionBinding:string;account:string;chainId:"eip155:6423";requestDigest:string;method:string;expiresAt:string;decision:"pending"|"approved"|"rejected";stage:WalletConnectResponseStage;response:WalletConnectJsonRpcResponse|null;responseDigest:string|null;attempts:number;createdAt:string;updatedAt:string}>;
type State=Readonly<{version:3;sessions:readonly WalletConnectSessionApproval[];pendingTopics:readonly string[];replay:ReplaySnapshot;outbox:readonly WalletConnectResponseRecord[]}>;
type ActiveSession=Pick<SessionTypes.Struct,"topic"|"namespaces">;
export type WalletConnectSessionReconciliation=Readonly<{disconnectTopics:readonly string[];prunedTopics:readonly string[]}>;
export class WalletConnectFinalizationUnknownError extends Error{constructor(){super("WalletConnect approval outcome is uncertain. Reopen WalletConnect and verify the session before retrying.");this.name="WalletConnectFinalizationUnknownError"}}

export class WalletConnectSecurityStore{
  constructor(private readonly storage:SecureStorageAdapter){}

  load():Promise<{sessions:readonly WalletConnectSessionApproval[];replayStore:WalletConnectRequestReplayStore}>{return this.#enqueue(async()=>{const state=await this.#read();return{sessions:state.sessions.filter(item=>!state.pendingTopics.includes(item.topic)),replayStore:new WalletConnectRequestReplayStore(state.replay)}})}
  session(topic:string):Promise<WalletConnectSessionApproval|null>{return this.#enqueue(async()=>authorizedSession(await this.#read(),topic)??null)}
  pendingSessionTopics():Promise<readonly string[]>{return this.#enqueue(async()=>Object.freeze([...(await this.#read()).pendingTopics]))}
  outbox():Promise<readonly WalletConnectResponseRecord[]>{return this.#enqueue(async()=>(await this.#read()).outbox)}
  saveSession(approval:WalletConnectSessionApproval):Promise<void>{return this.#enqueue(async()=>{const state=await this.#read();if(state.pendingTopics.includes(approval.topic))throw new Error("WalletConnect pending session cannot be promoted by legacy save");const previous=state.sessions.find(item=>item.topic===approval.topic),sessions=[...state.sessions.filter(item=>item.topic!==approval.topic),approval];if(sessions.length>50)throw new Error("WalletConnect session limit reached");const changed=previous&&(previous.sessionBinding!==approval.sessionBinding||previous.account!==approval.account);await this.#write({...state,sessions,outbox:changed?quarantineTopic(state.outbox,approval.topic,new Date()):state.outbox})})}
  /** The grant and its denial marker are written in one secure-storage record. */
  stageSession(approval:WalletConnectSessionApproval):Promise<void>{return this.#enqueue(async()=>{const state=await this.#read();if(!HEX_32.test(approval.topic)||!HEX_32.test(approval.sessionBinding)||state.sessions.some(item=>item.topic===approval.topic)||state.pendingTopics.includes(approval.topic))throw new Error("WalletConnect staged session identity is invalid or already used");if(state.sessions.length>=50)throw new Error("WalletConnect session limit reached");await this.#write({...state,sessions:Object.freeze([...state.sessions,approval]),pendingTopics:Object.freeze([...state.pendingTopics,approval.topic])})})}
  /** Removing the denial marker is the final approval commit point. No lease
   * assertion may be placed after this method returns. */
  finalizeStagedSession(topic:string,binding:string,assertCurrent:()=>void):Promise<void>{return this.#enqueue(async()=>{const state=await this.#read(),approval=state.sessions.find(item=>item.topic===topic);if(!state.pendingTopics.includes(topic)||approval?.sessionBinding!==binding)throw new Error("WalletConnect staged session is no longer current");assertCurrent();const next={...state,pendingTopics:Object.freeze(state.pendingTopics.filter(item=>item!==topic))};try{await this.#write(next)}catch(caught){let observed:State|null=null;try{observed=await this.#read()}catch{}if(observed&&!observed.pendingTopics.includes(topic)&&authorizedSession(observed,topic)?.sessionBinding===binding)return;if(observed?.pendingTopics.includes(topic))throw caught;throw new WalletConnectFinalizationUnknownError()} })}
  removeSession(topic:string):Promise<void>{return this.#enqueue(async()=>{const state=await this.#read();await this.#write({...state,sessions:state.sessions.filter(item=>item.topic!==topic),pendingTopics:state.pendingTopics.filter(item=>item!==topic),outbox:quarantineTopic(state.outbox,topic,new Date())})})}
  reconcileSession(topic:string,namespaces:SessionTypes.Namespaces,account:string):Promise<"current"|"missing"|"changed">{return this.#enqueue(async()=>{const approval=authorizedSession(await this.#read(),topic);if(!approval)return"missing";const next=normalizedNamespaces(namespaces),expected=normalizedNamespaces(approval.namespaces as unknown as SessionTypes.Namespaces);return approval.account===account&&JSON.stringify(next)===JSON.stringify(expected)?"current":"changed"})}
  reconcileActiveSessions(activeSessions:readonly ActiveSession[],account:string):Promise<WalletConnectSessionReconciliation>{
    if(activeSessions.length>50)return Promise.reject(new Error("WalletConnect active session limit exceeded"));
    const activeByTopic=new Map(activeSessions.map(session=>[session.topic,session]));if(activeByTopic.size!==activeSessions.length)return Promise.reject(new Error("WalletConnect active sessions contain duplicate topics"));
    return this.#enqueue(async()=>{const state=await this.#read(),approved=state.sessions.filter(approval=>!state.pendingTopics.includes(approval.topic)&&(()=>{const active=activeByTopic.get(approval.topic);return Boolean(active&&approval.account===account&&sameNamespaces(active.namespaces,approval.namespaces as unknown as SessionTypes.Namespaces))})()),retainedTopics=new Set(approved.map(approval=>approval.topic)),retained=state.sessions.filter(approval=>state.pendingTopics.includes(approval.topic)||retainedTopics.has(approval.topic)),disconnectTopics=activeSessions.filter(session=>!retainedTopics.has(session.topic)).map(session=>session.topic),prunedTopics=state.sessions.filter(approval=>!state.pendingTopics.includes(approval.topic)&&!retainedTopics.has(approval.topic)).map(approval=>approval.topic);if(retained.length!==state.sessions.length){const removed=new Set(prunedTopics);await this.#write({...state,sessions:retained,outbox:state.outbox.map(item=>removed.has(item.topic)?quarantined(item,new Date()):item)})}return Object.freeze({disconnectTopics:Object.freeze(disconnectTopics),prunedTopics:Object.freeze(prunedTopics)})});
  }
  saveReplay(store:WalletConnectRequestReplayStore):Promise<void>{const requested=store.snapshot();return this.#enqueue(async()=>{const state=await this.#read(),merged=new Map(state.replay.map(item=>[item.key,item]));for(const item of requested){const existing=merged.get(item.key);if(existing&&(existing.requestDigest!==item.requestDigest||existing.expiresAt!==item.expiresAt||existing.status==="consumed"&&item.status!=="consumed")||state.outbox.some(record=>record.key===item.key&&record.stage==="reviewing"&&item.status!=="reserved"))throw new Error("WalletConnect replay state cannot be replaced");merged.set(item.key,item)}await this.#write({...state,replay:new WalletConnectRequestReplayStore([...merged.values()]).snapshot()})})}

  reserveRequest(input:unknown,account:string,at=new Date()):Promise<WalletConnectRequestReview>{
    return this.#enqueue(async()=>{
      const state=await this.#read(),now=authorityTime(at),retained=state.outbox.filter(item=>item.expiresAt>now.toISOString());
      const topic=plainObject(input,"WalletConnect request").topic;
      const session=authorizedSession(state,topic);
      if(!session||session.account!==account||session.expiresAt<=now.toISOString())throw new Error("WalletConnect session is no longer authorized for this request");
      const replayStore=new WalletConnectRequestReplayStore(state.replay);
      const review=createWalletConnectRequestReview(input,{session,now,replayStore});
      if(retained.some(item=>item.key===`${review.topic}:${review.requestId}`))throw new Error("WalletConnect response outbox already contains this request");
      if(retained.length>=MAX_OUTBOX_RECORDS)throw new Error("WalletConnect response outbox limit reached");
      const record=parseOutboxRecord({version:1,key:`${review.topic}:${review.requestId}`,topic:review.topic,requestId:review.requestId,sessionBinding:review.sessionBinding,account:review.account,chainId:review.chainId,requestDigest:review.requestDigest,method:review.method,expiresAt:review.expiresAt,decision:"pending",stage:"reviewing",response:null,responseDigest:null,attempts:0,createdAt:now.toISOString(),updatedAt:now.toISOString()});
      await this.#write({...state,replay:replayStore.snapshot(),outbox:Object.freeze([...retained,record])});
      return review;
    });
  }

  rejectUnreviewedRequest(input:unknown,account:string,at=new Date(),rejection:Readonly<{code:number;message:string}>={code:-32602,message:"Invalid or unsupported WalletConnect request."}):Promise<WalletConnectResponseRecord>{
    return this.#enqueue(async()=>{
      const now=authorityTime(at),value=requestIdentity(input),topic=value.topic,id=value.id;
      if(typeof topic!=="string"||!HEX_32.test(topic)||!Number.isSafeInteger(id)||id<1)throw new Error("WalletConnect invalid request has no safe response identity");
      const state=await this.#read(),session=authorizedSession(state,topic),retained=state.outbox.filter(item=>item.expiresAt>now.toISOString()),replayStore=new WalletConnectRequestReplayStore(state.replay);replayStore.prune(now);
      if(!session||session.account!==account||session.expiresAt<=now.toISOString())throw new Error("WalletConnect invalid request has no current approved session");
      const overBudget=requestExceedsPolicy(value),encoded=overBudget?null:JSON.stringify(value);
      if(!overBudget&&typeof encoded!=="string")throw new Error("WalletConnect invalid request exceeds policy");
      const oversized=overBudget||encoded!.length>65_536||utf8Length(encoded!)>65_536;
      const requestDigest=keccak256(toUtf8Bytes(JSON.stringify(oversized?{domain:"YNX_WALLETCONNECT_UNREVIEWED_OVERSIZE_V1",sessionBinding:session.sessionBinding,topic,id}:{domain:"YNX_WALLETCONNECT_UNREVIEWED_REQUEST_V1",sessionBinding:session.sessionBinding,request:encoded}))).slice(2),key=`${topic}:${id}`;
      const existing=retained.find(item=>item.key===key);if(existing){if(existing.method==="wallet_request_unreviewed"&&existing.requestDigest===requestDigest&&existing.stage==="ready"&&existing.decision==="rejected")return existing;throw new Error("WalletConnect request identity was already used")}
      if(replayStore.snapshot().some(item=>item.key===key)||retained.length>=MAX_OUTBOX_RECORDS)throw new Error("WalletConnect invalid request cannot replace prior review");
      const expiresAt=new Date(Math.min(Date.parse(session.expiresAt),now.getTime()+300_000)).toISOString(),response=rpcError(id,rejection.code,rejection.message);
      const record=parseOutboxRecord({version:1,key,topic,requestId:id,sessionBinding:session.sessionBinding,account,chainId:"eip155:6423",requestDigest,method:"wallet_request_unreviewed",expiresAt,decision:"rejected",stage:"ready",response,responseDigest:responseDigest({topic,requestId:id,sessionBinding:session.sessionBinding,account,chainId:"eip155:6423",requestDigest,method:"wallet_request_unreviewed",expiresAt},response),attempts:0,createdAt:now.toISOString(),updatedAt:now.toISOString()});
      const replay=new WalletConnectRequestReplayStore([...replayStore.snapshot(),{key,requestDigest,expiresAt,status:"consumed"}]).snapshot();
      await this.#write({...state,replay,outbox:Object.freeze([...retained,record])});return record;
    });
  }

  /** Invalidates a pending review before an updated session can authorize its old result.
   * Approved work or attempted Relay delivery has an uncertain outcome, so the
   * caller must disconnect and quarantine rather than advertise a safe retry. */
  async rejectPendingForSessionUpdate(input:unknown,account:string,at=new Date()):Promise<WalletConnectResponseRecord>{
    if(requestExceedsPolicy(input))throw new Error("WalletConnect updated request exceeds policy");
    const pending=requestIdentity(input),key=`${pending.topic}:${pending.id}`;
    const current=(await this.outbox()).find(item=>item.key===key);
    if(!current)return this.rejectUnreviewedRequest(input,account,at,{code:5103,message:"WalletConnect session updated; resend the request after reconciliation."});
    return this.#enqueue(async()=>{
      const state=await this.#read(),now=authorityTime(at),record=state.outbox.find(item=>item.key===key),session=authorizedSession(state,pending.topic);
      if(!record||record.topic!==pending.topic||record.requestId!==pending.id||record.account!==account||record.sessionBinding!==session?.sessionBinding||session.expiresAt<=now.toISOString()||record.expiresAt<=now.toISOString()||record.decision==="approved"||!(record.stage==="reviewing"&&record.decision==="pending"&&record.attempts===0||record.stage==="ready"&&record.decision==="rejected"))throw new Error("WalletConnect updated request cannot be safely replaced");
      const replay=state.replay.find(item=>item.key===key);
      if(!replay||replay.requestDigest!==record.requestDigest||replay.expiresAt!==record.expiresAt||replay.status!==(record.stage==="reviewing"?"reserved":"consumed"))throw new Error("WalletConnect updated request replay binding is invalid");
      if(record.method!=="wallet_request_unreviewed"){
        const candidate=createWalletConnectRequestReview(input,{session,now:reviewReconstructionTime(input,session,record.expiresAt,now),replayStore:new WalletConnectRequestReplayStore(state.replay.filter(item=>item.key!==key))});
        if(candidate.topic!==record.topic||candidate.requestId!==record.requestId||candidate.sessionBinding!==record.sessionBinding||candidate.account!==record.account||candidate.chainId!==record.chainId||candidate.method!==record.method||candidate.requestDigest!==record.requestDigest||candidate.expiresAt!==record.expiresAt)throw new Error("WalletConnect updated request does not match its saved review");
      }else throw new Error("WalletConnect unreviewed request cannot be safely replaced");
      if(record.stage==="ready")return record;
      const response=rpcError(record.requestId,5103,"WalletConnect session updated; resend the request after reconciliation.");
      const replacement=parseOutboxRecord({...record,decision:"rejected",stage:"ready",response,responseDigest:responseDigest(record,response),updatedAt:now.toISOString()});
      const nextReplay=new WalletConnectRequestReplayStore(state.replay.map(item=>item.key===key?{...item,status:"consumed" as const}:item)).snapshot();
      await this.#write({...state,replay:nextReplay,outbox:Object.freeze(state.outbox.map(item=>item.key===key?replacement:item))});
      return replacement;
    });
  }

  recoverOrphanReservation(input:unknown,account:string,at=new Date()):Promise<WalletConnectResponseRecord>{
    return this.#enqueue(async()=>{
      const pending=requestIdentity(input),key=`${pending.topic}:${pending.id}`;
      const state=await this.#read(),now=authorityTime(at),replay=state.replay.find(item=>item.key===key),retained=state.outbox.filter(item=>item.expiresAt>now.toISOString());
      if(!replay||replay.status!=="reserved"||replay.expiresAt<=now.toISOString()||retained.some(item=>item.key===key)||retained.length>=MAX_OUTBOX_RECORDS)throw new Error("WalletConnect orphan reservation is not recoverable");
      const separator=key.lastIndexOf(":"),topic=key.slice(0,separator),id=Number(key.slice(separator+1));
      if(!HEX_32.test(topic)||!Number.isSafeInteger(id)||id<1||key!==`${topic}:${id}`)throw new Error("WalletConnect orphan reservation identity is invalid");
      const session=authorizedSession(state,topic);
      if(!session||session.account!==account||session.expiresAt<=now.toISOString())throw new Error("WalletConnect orphan reservation has no current approved session");
      if(requestExceedsPolicy(input))throw new Error("WalletConnect orphan request exceeds policy");
      const candidate=createWalletConnectRequestReview(input,{session,now:reviewReconstructionTime(input,session,replay.expiresAt,now),replayStore:new WalletConnectRequestReplayStore(state.replay.filter(item=>item.key!==key))});
      if(candidate.topic!==topic||candidate.requestId!==id||candidate.account!==account||candidate.chainId!=="eip155:6423"||candidate.sessionBinding!==session.sessionBinding||candidate.requestDigest!==replay.requestDigest||candidate.expiresAt!==replay.expiresAt)throw new Error("WalletConnect orphan reservation does not match the current request");
      const response=rpcError(id,-32002,"Wallet review was interrupted. Review a fresh request.");
      const record=parseOutboxRecord({version:1,key,topic,requestId:id,sessionBinding:session.sessionBinding,account,chainId:"eip155:6423",requestDigest:replay.requestDigest,method:"wallet_request_unreviewed",expiresAt:replay.expiresAt,decision:"rejected",stage:"ready",response,responseDigest:responseDigest({topic,requestId:id,sessionBinding:session.sessionBinding,account,chainId:"eip155:6423",requestDigest:replay.requestDigest,method:"wallet_request_unreviewed",expiresAt:replay.expiresAt},response),attempts:0,createdAt:now.toISOString(),updatedAt:now.toISOString()});
      const nextReplay=new WalletConnectRequestReplayStore(state.replay.map(item=>item.key===key?{...item,status:"consumed" as const}:item)).snapshot();
      await this.#write({...state,replay:nextReplay,outbox:Object.freeze([...retained,record])});return record;
    });
  }

  commitRequestDecision(review:WalletConnectRequestReview,approved:boolean,at=new Date(),rejection:Readonly<{code:number;message:string}>={code:5000,message:"User rejected the request."}):Promise<WalletConnectResponseRecord>{
    return this.#enqueue(async()=>{const state=await this.#read(),now=authorityTime(at),key=`${review.topic}:${review.requestId}`,retained=state.outbox.filter(item=>item.expiresAt>now.toISOString()),session=authorizedSession(state,review.topic);if(!sessionMatchesReview(session,review,now))throw new Error("WalletConnect session is no longer authorized for this request");const existing=retained.find(item=>item.key===key);if(existing&&(existing.stage!=="reviewing"||existing.requestDigest!==review.requestDigest||existing.sessionBinding!==review.sessionBinding))throw new Error("WalletConnect response outbox already contains this request");const replayStore=new WalletConnectRequestReplayStore(state.replay);finalizeWalletConnectRequestReview(review,{approved},replayStore,now);if(!existing&&retained.length>=MAX_OUTBOX_RECORDS)throw new Error("WalletConnect response outbox limit reached");const response=approved?null:rpcError(review.requestId,rejection.code,rejection.message);const record=parseOutboxRecord({version:1,key,topic:review.topic,requestId:review.requestId,sessionBinding:review.sessionBinding,account:review.account,chainId:review.chainId,requestDigest:review.requestDigest,method:review.method,expiresAt:review.expiresAt,decision:approved?"approved":"rejected",stage:approved?"authorized":"ready",response,responseDigest:response===null?null:responseDigest(review,response),attempts:0,createdAt:existing?.createdAt??now.toISOString(),updatedAt:now.toISOString()});await this.#write({...state,replay:replayStore.snapshot(),outbox:Object.freeze([...retained.filter(item=>item.key!==key),record])});return record});
  }
  beginRequestExecution(key:string,at=new Date()):Promise<WalletConnectResponseRecord>{return this.#updateOutbox(key,at,item=>{if(item.stage!=="authorized"||item.decision!=="approved")throw new Error("WalletConnect response is not authorized for execution");return{...item,stage:"executing"}})}
  recoverReviewingResponse(key:string,at=new Date()):Promise<WalletConnectResponseRecord>{return this.#enqueue(async()=>{const state=await this.#read(),now=authorityTime(at),current=state.outbox.find(item=>item.key===key);if(!current||current.stage!=="reviewing"||current.decision!=="pending"||current.expiresAt<=now.toISOString())throw new Error("WalletConnect review is not recoverable");const replay=state.replay.find(item=>item.key===key);if(!replay||replay.status!=="reserved"||replay.requestDigest!==current.requestDigest||replay.expiresAt!==current.expiresAt)throw new Error("WalletConnect review replay binding is invalid");const response=rpcError(current.requestId,-32002,"Wallet review was interrupted. Review a fresh request.");const record=parseOutboxRecord({...current,decision:"rejected",stage:"ready",response,responseDigest:responseDigest(current,response),updatedAt:now.toISOString()});const nextReplay=new WalletConnectRequestReplayStore(state.replay.map(item=>item.key===key?{...item,status:"consumed" as const}:item)).snapshot();await this.#write({...state,replay:nextReplay,outbox:Object.freeze(state.outbox.map(item=>item.key===key?record:item))});return record})}
  recoverIncompleteResponse(key:string,at=new Date()):Promise<WalletConnectResponseRecord>{return this.#updateOutbox(key,at,item=>{if(!["authorized","executing"].includes(item.stage)||item.decision!=="approved")throw new Error("WalletConnect response is not recoverable");const message=item.stage==="authorized"?"Wallet approval was interrupted before execution. Review a fresh request.":item.method==="eth_sendTransaction"?"Wallet transaction outcome is uncertain. Check transaction status before requesting again.":"Wallet signing outcome was interrupted. Review a fresh request.";const response=rpcError(item.requestId,-32002,message);return{...item,stage:"ready",response,responseDigest:responseDigest(item,response)}})}
  completeRequestResponse(key:string,response:WalletConnectJsonRpcResponse,at=new Date()):Promise<WalletConnectResponseRecord>{return this.#updateOutbox(key,at,item=>{if(item.stage!=="executing"||item.decision!=="approved")throw new Error("WalletConnect response is not executing");const exact=validateResponse(response,item),encoded=JSON.stringify(exact);if(utf8Length(encoded)>MAX_RESPONSE_CHARS)throw new Error("WalletConnect response exceeds policy");return{...item,stage:"ready",response:exact,responseDigest:responseDigest(item,exact)}})}
  recordDeliveryAttempt(key:string,at=new Date()):Promise<WalletConnectResponseRecord>{return this.#updateOutbox(key,at,item=>{if(item.stage!=="ready"||item.response===null)throw new Error("WalletConnect response is not ready for delivery");if(item.attempts>=1_000)throw new Error("WalletConnect response delivery retry limit reached");return{...item,attempts:item.attempts+1}})}
  markResponseDelivered(key:string,claim:Readonly<{attempt:number;responseDigest:string}>,at=new Date()):Promise<WalletConnectResponseRecord>{return this.#updateOutbox(key,at,item=>{if(item.stage!=="ready"||item.response===null||item.attempts<1||item.attempts!==claim.attempt||item.responseDigest!==claim.responseDigest)throw new Error("WalletConnect response delivery claim is stale");return{...item,stage:"delivered"}})}
  readyResponses(at=new Date()):Promise<readonly WalletConnectResponseRecord[]>{return this.#enqueue(async()=>{const iso=authorityTime(at).toISOString();return Object.freeze((await this.#read()).outbox.filter(item=>item.stage==="ready"&&item.expiresAt>iso))})}
  quarantineTopic(topic:string,at=new Date()):Promise<void>{return this.#enqueue(async()=>{const state=await this.#read();await this.#write({...state,outbox:quarantineTopic(state.outbox,topic,authorityTime(at))})})}

  #updateOutbox(key:string,at:Date,change:(item:WalletConnectResponseRecord)=>Record<string,unknown>):Promise<WalletConnectResponseRecord>{return this.#enqueue(async()=>{const state=await this.#read(),index=state.outbox.findIndex(item=>item.key===key);if(index<0)throw new Error("WalletConnect response outbox record is missing");const now=authorityTime(at),current=state.outbox[index]!;if(current.expiresAt<=now.toISOString())throw new Error("WalletConnect response outbox record is expired");const next=parseOutboxRecord({...change(current),updatedAt:now.toISOString()}),outbox=[...state.outbox];outbox[index]=next;await this.#write({...state,outbox:Object.freeze(outbox)});return next})}
  #enqueue<T>(operation:()=>Promise<T>):Promise<T>{const key=this.storage as object,previous=operationQueues.get(key)??Promise.resolve(),result=previous.then(operation);operationQueues.set(key,result.then(()=>undefined,()=>undefined));return result}
  async #read():Promise<State>{
    const raw=await this.storage.getItem(KEY);if(raw===null)return emptyState();if(utf8Length(raw)>MAX_STATE_CHARS)throw new Error("WalletConnect security state exceeds policy");let value:any;try{value=JSON.parse(raw)}catch{throw new Error("WalletConnect security state is unreadable")}
    if(!value||!Array.isArray(value.sessions)||!Array.isArray(value.replay))throw new Error("WalletConnect security state is invalid");new WalletConnectRequestReplayStore(value.replay);const sessions=validateSessions(value.sessions);
    if(value.version===1&&Object.keys(value).sort().join(",")==="replay,sessions,version")return Object.freeze({version:3,sessions,pendingTopics:Object.freeze([]),replay:Object.freeze(value.replay),outbox:Object.freeze([])});
    const v2=value.version===2&&Object.keys(value).sort().join(",")==="outbox,replay,sessions,version";
    const v3=value.version===3&&Object.keys(value).sort().join(",")==="outbox,pendingTopics,replay,sessions,version";
    if(!(v2||v3)||!Array.isArray(value.outbox)||value.outbox.length>MAX_OUTBOX_RECORDS)throw new Error("WalletConnect security state is invalid");
    const pendingTopics:readonly string[]=v2?Object.freeze([]):validatePendingTopics(value.pendingTopics,sessions);
    const outbox=Object.freeze((value.outbox as unknown[]).map(parseOutboxRecord));if(new Set(outbox.map(item=>item.key)).size!==outbox.length)throw new Error("WalletConnect response outbox contains duplicates");validateStateBindings(sessions.filter(item=>!pendingTopics.includes(item.topic)),value.replay,outbox);return Object.freeze({version:3,sessions,pendingTopics,replay:Object.freeze(value.replay),outbox});
  }
  async #write(state:State):Promise<void>{const encoded=JSON.stringify(state);if(utf8Length(encoded)>MAX_STATE_CHARS)throw new Error("WalletConnect security state exceeds policy");await this.storage.setItem(KEY,encoded);if(await this.storage.getItem(KEY)!==encoded)throw new Error("WalletConnect security state could not be verified")}
}

function emptyState():State{return Object.freeze({version:3,sessions:Object.freeze([]),pendingTopics:Object.freeze([]),replay:Object.freeze([]),outbox:Object.freeze([])})}
function authorizedSession(state:State,topic:string):WalletConnectSessionApproval|undefined{return state.pendingTopics.includes(topic)?undefined:state.sessions.find(item=>item.topic===topic)}
function validatePendingTopics(value:unknown,sessions:readonly WalletConnectSessionApproval[]):readonly string[]{if(!Array.isArray(value)||value.length>50||new Set(value).size!==value.length||value.some(item=>typeof item!=="string"||!HEX_32.test(item)||!sessions.some(session=>session.topic===item)))throw new Error("WalletConnect pending sessions are invalid");return Object.freeze(value)}
function reviewReconstructionTime(input:unknown,session:WalletConnectSessionApproval,expiresAt:string,now:Date):Date{
  const params=typeof input==="object"&&input!==null?Object.getOwnPropertyDescriptor(input,"params")?.value:undefined;
  const request=typeof params==="object"&&params!==null?Object.getOwnPropertyDescriptor(params,"request")?.value:undefined;
  if(typeof request==="object"&&request!==null&&Object.hasOwn(request,"expiryTimestamp"))return now;
  const originalSecond=Math.max(Date.parse(session.approvedAt),Date.parse(expiresAt)-300_000);
  if(!Number.isFinite(originalSecond)||originalSecond>now.getTime())throw new Error("WalletConnect saved request expiry cannot be reconstructed");
  return new Date(originalSecond);
}
function requestIdentity(value:unknown):Record<string,any>{
  if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error("WalletConnect request identity is invalid");
  for(const key of ["topic","id"]){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor?.enumerable||!("value" in descriptor))throw new Error("WalletConnect request identity is invalid")}
  return value as Record<string,any>;
}
function requestExceedsPolicy(input:unknown):boolean{
  const pending:[unknown,number][]=[[input,0]],seen=new Set<object>();let nodes=0,characters=0;
  while(pending.length){const [value,depth]=pending.pop()!;if(++nodes>4_096||depth>24)return true;
    if(typeof value==="string"){characters+=value.length;if(characters>65_536)return true;continue}
    if(value===null||typeof value==="boolean"||typeof value==="number")continue;
    if(typeof value!=="object"||seen.has(value))return true;
    seen.add(value);const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(prototype!==(array?Array.prototype:Object.prototype)&&prototype!==null)return true;
    if(array&&value.length>4_096||Object.getOwnPropertyDescriptor(value,"toJSON"))return true;
    let keys=0;
    for(const key in value){if(!Object.hasOwn(value,key))continue;if(++keys>4_096)return true;const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value" in descriptor))return true;characters+=key.length;if(characters>65_536)return true;pending.push([descriptor.value,depth+1])}
  }
  return false;
}
function authorityTime(value:Date):Date{if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new Error("WalletConnect response time is invalid");return value}
function rpcError(id:number,code:number,message:string):WalletConnectJsonRpcResponse{return Object.freeze({jsonrpc:"2.0",id,error:Object.freeze({code,message})})}
function validateResponse(input:WalletConnectJsonRpcResponse,record:WalletConnectResponseRecord):WalletConnectJsonRpcResponse{
  const value=plainObject(input,"WalletConnect response"),keys=Object.keys(value).sort().join(",");if(value.jsonrpc!=="2.0"||value.id!==record.requestId||!(keys==="id,jsonrpc,result"||keys==="error,id,jsonrpc"))throw new Error("WalletConnect response is invalid");
  if(keys==="error,id,jsonrpc"){const error=plainObject(value.error,"WalletConnect response error");if(Object.keys(error).sort().join(",")!=="code,message"||!Number.isSafeInteger(error.code)||typeof error.message!=="string"||error.message.length<1||error.message.length>240)return invalidResponse();return rpcError(record.requestId,error.code as number,error.message)}
  const result=value.result;if(["eth_accounts","eth_requestAccounts"].includes(record.method)){if(!Array.isArray(result)||result.length!==1||result[0]!==record.account)return invalidResponse();return Object.freeze({jsonrpc:"2.0",id:record.requestId,result:Object.freeze([record.account])})}
  if(record.method==="eth_chainId"){if(result!=="0x1917")return invalidResponse()}
  else if(["wallet_switchEthereumChain","wallet_addEthereumChain"].includes(record.method)){if(result!==null)return invalidResponse()}
  else if(["personal_sign","eth_signTypedData_v4"].includes(record.method)){if(typeof result!=="string"||!SIGNATURE.test(result))return invalidResponse()}
  else if(record.method==="eth_sendTransaction"){if(typeof result!=="string"||!TX_HASH.test(result))return invalidResponse()}
  else return invalidResponse();return Object.freeze({jsonrpc:"2.0",id:record.requestId,result})
}
function invalidResponse():never{throw new Error("WalletConnect response is invalid")}
function parseOutboxRecord(input:unknown):WalletConnectResponseRecord{
  const value=plainObject(input,"WalletConnect response outbox record"),fields=["version","key","topic","requestId","sessionBinding","account","chainId","requestDigest","method","expiresAt","decision","stage","response","responseDigest","attempts","createdAt","updatedAt"];if(Object.keys(value).sort().join(",")!==[...fields].sort().join(",")||value.version!==1||typeof value.topic!=="string"||!HEX_32.test(value.topic)||!Number.isSafeInteger(value.requestId)||Number(value.requestId)<1||value.key!==`${value.topic}:${value.requestId}`||typeof value.sessionBinding!=="string"||!HEX_32.test(value.sessionBinding)||typeof value.account!=="string"||!ADDRESS.test(value.account)||value.chainId!=="eip155:6423"||typeof value.requestDigest!=="string"||!HEX_32.test(value.requestDigest)||typeof value.method!=="string"||!METHODS.has(value.method)||!iso(value.expiresAt)||!["pending","approved","rejected"].includes(String(value.decision))||!["reviewing","authorized","executing","ready","delivered","quarantined"].includes(String(value.stage))||!Number.isSafeInteger(value.attempts)||Number(value.attempts)<0||Number(value.attempts)>1_000||!iso(value.createdAt)||!iso(value.updatedAt)||String(value.updatedAt)<String(value.createdAt))throw new Error("WalletConnect response outbox record is invalid");
  const base={version:1 as const,key:String(value.key),topic:String(value.topic),requestId:Number(value.requestId),sessionBinding:String(value.sessionBinding),account:String(value.account),chainId:"eip155:6423" as const,requestDigest:String(value.requestDigest),method:String(value.method),expiresAt:String(value.expiresAt),decision:value.decision as "pending"|"approved"|"rejected",stage:value.stage as WalletConnectResponseStage,attempts:Number(value.attempts),createdAt:String(value.createdAt),updatedAt:String(value.updatedAt)};if(base.expiresAt<=base.createdAt)throw new Error("WalletConnect response outbox expiry is invalid");
  const noResponse=value.response===null&&value.responseDigest===null,requiresResponse=["ready","delivered"].includes(base.stage);if(base.stage==="quarantined"&&!noResponse||base.stage==="reviewing"&&(base.decision!=="pending"||!noResponse||base.attempts!==0)||["authorized","executing"].includes(base.stage)&&(base.decision!=="approved"||!noResponse)||requiresResponse&&noResponse||base.decision==="pending"&&!["reviewing","quarantined"].includes(base.stage)||base.decision==="rejected"&&!["ready","delivered","quarantined"].includes(base.stage))throw new Error("WalletConnect response outbox state is invalid");
  const response=noResponse?null:validateResponse(value.response as WalletConnectJsonRpcResponse,{...base,response:null,responseDigest:null} as WalletConnectResponseRecord),encoded=response===null?null:JSON.stringify(response),digest=response===null?null:responseDigest(base,response);if(encoded!==null&&utf8Length(encoded)>MAX_RESPONSE_CHARS||value.responseDigest!==digest)throw new Error("WalletConnect response outbox digest is invalid");if(base.decision==="rejected"&&response!==null&&!Object.hasOwn(response,"error"))throw new Error("WalletConnect rejected response must contain an error");return Object.freeze({...base,response,responseDigest:digest});
}
function plainObject(value:unknown,label:string):Record<string,any>{if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error(`${label} is invalid`);for(const key of Reflect.ownKeys(value)){if(typeof key!=="string")throw new Error(`${label} is invalid`);const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor?.enumerable||!("value" in descriptor))throw new Error(`${label} is invalid`)}return value as Record<string,any>}
function validateSessions(input:unknown[]):readonly WalletConnectSessionApproval[]{if(input.length>50)throw new Error("WalletConnect session limit exceeded");const topics=new Set<string>();for(const item of input){const value=plainObject(item,"WalletConnect session"),namespaces=plainObject(value.namespaces,"WalletConnect namespaces"),evm=plainObject(namespaces.eip155,"WalletConnect EVM namespace");if(value.kind!=="walletconnect_session_approval"||value.protocolVersion!==2||typeof value.topic!=="string"||!HEX_32.test(value.topic)||typeof value.sessionBinding!=="string"||!HEX_32.test(value.sessionBinding)||typeof value.account!=="string"||!ADDRESS.test(value.account)||!iso(value.approvedAt)||!iso(value.expiresAt)||value.expiresAt<=value.approvedAt||!Array.isArray(evm.chains)||evm.chains.length!==1||evm.chains[0]!=="eip155:6423"||!Array.isArray(evm.accounts)||!evm.accounts.includes(`eip155:6423:${value.account}`)||!Array.isArray(evm.methods)||evm.methods.some((method:unknown)=>typeof method!=="string"||!METHODS.has(method))||!Array.isArray(evm.events)||topics.has(value.topic))throw new Error("WalletConnect session is invalid");topics.add(value.topic)}return Object.freeze(input) as readonly WalletConnectSessionApproval[]}
function iso(value:unknown):boolean{return typeof value==="string"&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value}
function utf8Length(value:string):number{return toUtf8Bytes(value).length}
function responseDigest(binding:Pick<WalletConnectResponseRecord,"topic"|"requestId"|"sessionBinding"|"account"|"chainId"|"requestDigest"|"method"|"expiresAt">,response:WalletConnectJsonRpcResponse):string{return keccak256(toUtf8Bytes(JSON.stringify({domain:"YNX_WALLETCONNECT_RESPONSE_OUTBOX_V1",topic:binding.topic,requestId:binding.requestId,sessionBinding:binding.sessionBinding,account:binding.account,chainId:binding.chainId,requestDigest:binding.requestDigest,method:binding.method,expiresAt:binding.expiresAt,response})))}
function sessionMatchesReview(session:WalletConnectSessionApproval|undefined,review:WalletConnectRequestReview,at:Date):boolean{const namespace=session?.namespaces.eip155;return Boolean(session&&session.topic===review.topic&&session.sessionBinding===review.sessionBinding&&session.account===review.account&&session.expiresAt>=review.expiresAt&&session.expiresAt>at.toISOString()&&namespace?.chains.includes(review.chainId)&&namespace.accounts.includes(`${review.chainId}:${review.account}`)&&namespace.methods.includes(review.method))}
function validateStateBindings(sessions:readonly WalletConnectSessionApproval[],replay:ReplaySnapshot,outbox:readonly WalletConnectResponseRecord[]):void{const replayByKey=new Map(replay.map(item=>[item.key,item]));for(const item of outbox){const replayItem=replayByKey.get(item.key),expected=item.stage==="reviewing"||item.stage==="quarantined"&&item.decision==="pending"?"reserved":"consumed";if(!replayItem||replayItem.status!==expected||replayItem.requestDigest!==item.requestDigest||replayItem.expiresAt!==item.expiresAt)throw new Error("WalletConnect response outbox replay binding is invalid");if(!["delivered","quarantined"].includes(item.stage)){const session=sessions.find(value=>value.topic===item.topic),namespace=session?.namespaces.eip155;if(!session||session.sessionBinding!==item.sessionBinding||session.account!==item.account||!namespace?.chains.includes(item.chainId)||!namespace.accounts.includes(`${item.chainId}:${item.account}`)||item.method!=="wallet_request_unreviewed"&&!namespace.methods.includes(item.method))throw new Error("WalletConnect response outbox session binding is invalid")}}}
function quarantined(item:WalletConnectResponseRecord,at:Date):WalletConnectResponseRecord{const updatedAt=at.toISOString()>item.updatedAt?at.toISOString():item.updatedAt;return parseOutboxRecord({...item,stage:"quarantined",response:null,responseDigest:null,updatedAt})}
function quarantineTopic(items:readonly WalletConnectResponseRecord[],topic:string,at:Date):readonly WalletConnectResponseRecord[]{return Object.freeze(items.map(item=>item.topic===topic?quarantined(item,at):item))}
function normalizedNamespaces(value:SessionTypes.Namespaces):unknown{return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([namespace,entry])=>[namespace,{accounts:[...(entry.accounts??[])].sort(),chains:[...(entry.chains??[])].sort(),events:[...(entry.events??[])].sort(),methods:[...(entry.methods??[])].sort()}]))}
function sameNamespaces(left:SessionTypes.Namespaces,right:SessionTypes.Namespaces):boolean{return JSON.stringify(normalizedNamespaces(left))===JSON.stringify(normalizedNamespaces(right))}
