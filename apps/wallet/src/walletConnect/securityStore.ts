import { WalletConnectRequestReplayStore, type WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import type { SessionTypes } from "@walletconnect/types";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const KEY="ynx.wallet.walletconnect.security.v1";
type State=Readonly<{version:1;sessions:readonly WalletConnectSessionApproval[];replay:ReturnType<WalletConnectRequestReplayStore["snapshot"]>}>;
type ActiveSession=Pick<SessionTypes.Struct,"topic"|"namespaces">;
export type WalletConnectSessionReconciliation=Readonly<{disconnectTopics:readonly string[];prunedTopics:readonly string[]}>;
export class WalletConnectSecurityStore{
  constructor(private readonly storage:SecureStorageAdapter){}
  #pending:Promise<void>=Promise.resolve();
  #serialize<T>(operation:()=>Promise<T>):Promise<T>{const result=this.#pending.then(operation);this.#pending=result.then(()=>{},()=>{});return result}
  async updateReplay<T>(update:(store:WalletConnectRequestReplayStore,sessions:readonly WalletConnectSessionApproval[])=>T,assertCurrent:()=>void=()=>{}):Promise<T>{return this.#serialize(async()=>{const state=await this.#read();assertCurrent();const replay=new WalletConnectRequestReplayStore(state.replay),result=update(replay,state.sessions);assertCurrent();await this.#write({version:1,sessions:state.sessions,replay:replay.snapshot()});assertCurrent();return result})}
  async load():Promise<{sessions:readonly WalletConnectSessionApproval[];replayStore:WalletConnectRequestReplayStore}>{await this.#pending;const state=await this.#read();return{sessions:state.sessions,replayStore:new WalletConnectRequestReplayStore(state.replay)}}
  async session(topic:string):Promise<WalletConnectSessionApproval|null>{await this.#pending;return(await this.#read()).sessions.find(item=>item.topic===topic)??null}
  async saveSession(approval:WalletConnectSessionApproval):Promise<void>{return this.#serialize(()=>this.#saveSession(approval))}
  async #saveSession(approval:WalletConnectSessionApproval):Promise<void>{const state=await this.#read(),sessions=[...state.sessions.filter(item=>item.topic!==approval.topic),approval];if(sessions.length>50)throw new Error("WalletConnect session limit reached");await this.#write({version:1,sessions,replay:state.replay})}
  async removeSession(topic:string):Promise<void>{return this.#serialize(()=>this.#removeSession(topic))}
  async #removeSession(topic:string):Promise<void>{const state=await this.#read();await this.#write({version:1,sessions:state.sessions.filter(item=>item.topic!==topic),replay:state.replay})}
  async reconcileSession(topic:string,namespaces:SessionTypes.Namespaces,account:string):Promise<"current"|"missing"|"changed">{const approval=await this.session(topic);if(!approval)return"missing";const next=normalizedNamespaces(namespaces);const expected=normalizedNamespaces(approval.namespaces as unknown as SessionTypes.Namespaces);return approval.account===account&&JSON.stringify(next)===JSON.stringify(expected)?"current":"changed"}
  async reconcileActiveSessions(activeSessions:readonly ActiveSession[],account:string):Promise<WalletConnectSessionReconciliation>{return this.#serialize(()=>this.#reconcileActiveSessions(activeSessions,account))}
  async #reconcileActiveSessions(activeSessions:readonly ActiveSession[],account:string):Promise<WalletConnectSessionReconciliation>{
    if(activeSessions.length>50)throw new Error("WalletConnect active session limit exceeded");
    const state=await this.#read(),activeByTopic=new Map(activeSessions.map(session=>[session.topic,session]));
    if(activeByTopic.size!==activeSessions.length)throw new Error("WalletConnect active sessions contain duplicate topics");
    const retained=state.sessions.filter(approval=>{const active=activeByTopic.get(approval.topic);return Boolean(active&&approval.account===account&&sameNamespaces(active.namespaces,approval.namespaces as unknown as SessionTypes.Namespaces))});
    const retainedTopics=new Set(retained.map(approval=>approval.topic));
    const disconnectTopics=activeSessions.filter(session=>!retainedTopics.has(session.topic)).map(session=>session.topic);
    const prunedTopics=state.sessions.filter(approval=>!retainedTopics.has(approval.topic)).map(approval=>approval.topic);
    if(retained.length!==state.sessions.length)await this.#write({version:1,sessions:retained,replay:state.replay});
    return Object.freeze({disconnectTopics:Object.freeze(disconnectTopics),prunedTopics:Object.freeze(prunedTopics)});
  }
  async saveReplay(store:WalletConnectRequestReplayStore):Promise<void>{return this.#serialize(async()=>{const state=await this.#read(),incoming=new Map(store.snapshot().map(record=>[record.key,record]));for(const existing of state.replay){const next=incoming.get(existing.key);if(next&&(next.requestDigest!==existing.requestDigest||next.expiresAt!==existing.expiresAt||existing.status==="consumed"&&next.status!=="consumed"))throw new Error("WalletConnect replay state cannot move backwards");incoming.set(existing.key,next??existing)}const merged=new WalletConnectRequestReplayStore([...incoming.values()]);await this.#write({version:1,sessions:state.sessions,replay:merged.snapshot()})})}
  async #read():Promise<State>{const raw=await this.storage.getItem(KEY);if(raw===null)return Object.freeze({version:1,sessions:Object.freeze([]),replay:Object.freeze([])});if(raw.length>512_000)throw new Error("WalletConnect security state exceeds policy");let value:any;try{value=JSON.parse(raw)}catch{throw new Error("WalletConnect security state is unreadable")};if(!value||value.version!==1||!Array.isArray(value.sessions)||!Array.isArray(value.replay)||Object.keys(value).sort().join(",")!=="replay,sessions,version")throw new Error("WalletConnect security state is invalid");new WalletConnectRequestReplayStore(value.replay);return Object.freeze({version:1,sessions:Object.freeze(value.sessions),replay:Object.freeze(value.replay)})}
  async #write(state:State):Promise<void>{const encoded=JSON.stringify(state);await this.storage.setItem(KEY,encoded);if(await this.storage.getItem(KEY)!==encoded)throw new Error("WalletConnect security state could not be verified")}
}

function normalizedNamespaces(value:SessionTypes.Namespaces):unknown{return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([namespace,entry])=>[namespace,{accounts:[...(entry.accounts??[])].sort(),chains:[...(entry.chains??[])].sort(),events:[...(entry.events??[])].sort(),methods:[...(entry.methods??[])].sort()}]))}
function sameNamespaces(left:SessionTypes.Namespaces,right:SessionTypes.Namespaces):boolean{return JSON.stringify(normalizedNamespaces(left))===JSON.stringify(normalizedNamespaces(right))}

// Separate key preserves the existing session/replay schema and installed wallets.
const PAIRING_QUARANTINE_KEY="ynx.wallet.walletconnect.pairing-quarantine.v1";
export class WalletConnectPairingJournal {
  #pending:Promise<void>=Promise.resolve();
  constructor(private readonly storage:SecureStorageAdapter,private readonly now=()=>Math.floor(Date.now()/1000)){}
  async load():Promise<readonly string[]> {await this.#pending;return(await this.#read()).filter(item=>item.expiresAt===null||item.expiresAt>this.now()).map(item=>item.topic)}
  async #read():Promise<{topic:string;expiresAt:number|null}[]> {
    const raw=await this.storage.getItem(PAIRING_QUARANTINE_KEY);if(raw===null)return [];
    if(raw.length>20_000)throw new Error("Pairing quarantine exceeds policy.");
    let value:any;try{value=JSON.parse(raw)}catch{throw new Error("Pairing quarantine is unreadable.")}
    // Unpublished v1 QA may still be restored: retain unknown expiry conservatively.
    if(value?.version===1&&Object.keys(value).sort().join(",")==="topics,version"&&Array.isArray(value.topics)&&value.topics.length<=100&&new Set(value.topics).size===value.topics.length&&value.topics.every((topic:unknown)=>typeof topic==="string"&&/^[a-f0-9]{64}$/.test(topic)))return value.topics.map((topic:string)=>({topic,expiresAt:null}));
    if(!value||value.version!==2||Object.keys(value).sort().join(",")!=="records,version"||!Array.isArray(value.records)||value.records.length>100||new Set(value.records.map((item:any)=>item?.topic)).size!==value.records.length||value.records.some((item:any)=>!item||Object.keys(item).sort().join(",")!=="expiresAt,topic"||typeof item.topic!=="string"||!/^[a-f0-9]{64}$/.test(item.topic)||item.expiresAt!==null&&(!Number.isSafeInteger(item.expiresAt)||item.expiresAt<=0)))throw new Error("Pairing quarantine is invalid.");
    return value.records;
  }
  #mutate(update:(records:{topic:string;expiresAt:number|null}[])=>{topic:string;expiresAt:number|null}[]):Promise<void> {
    const operation=this.#pending.then(async()=>{
      const records=update((await this.#read()).filter(item=>item.expiresAt===null||item.expiresAt>this.now()));
      if(records.length>100)throw new Error("Too many live pairings. Wait for their actual expiry before retrying.");
      const encoded=JSON.stringify({version:2,records});await this.storage.setItem(PAIRING_QUARANTINE_KEY,encoded);
      if(await this.storage.getItem(PAIRING_QUARANTINE_KEY)!==encoded)throw new Error("Pairing quarantine could not be verified.");
    });this.#pending=operation.then(()=>{},()=>{});return operation;
  }
  record(topic:string,expiresAt:number|null=this.now()+300):Promise<void> {
    if(!/^[a-f0-9]{64}$/.test(topic)||expiresAt!==null&&(!Number.isSafeInteger(expiresAt)||expiresAt<=0))return Promise.reject(new Error("Invalid pairing quarantine record."));
    return this.#mutate(records=>{const prior=records.find(item=>item.topic===topic);return[...records.filter(item=>item.topic!==topic),{topic,expiresAt:expiresAt===null?prior?.expiresAt??null:Math.max(prior?.expiresAt??0,expiresAt)}]});
  }
  retire(topic:string):Promise<void> {return this.#mutate(records=>records.filter(item=>item.topic!==topic))}
}
