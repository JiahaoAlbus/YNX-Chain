import { WalletConnectRequestReplayStore, type WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import type { SessionTypes } from "@walletconnect/types";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const KEY="ynx.wallet.walletconnect.security.v1";
type State=Readonly<{version:1;sessions:readonly WalletConnectSessionApproval[];replay:ReturnType<WalletConnectRequestReplayStore["snapshot"]>}>;
type ActiveSession=Pick<SessionTypes.Struct,"topic"|"namespaces">;
export type WalletConnectSessionReconciliation=Readonly<{disconnectTopics:readonly string[];prunedTopics:readonly string[]}>;
export class WalletConnectSecurityStore{
  constructor(private readonly storage:SecureStorageAdapter){}
  async load():Promise<{sessions:readonly WalletConnectSessionApproval[];replayStore:WalletConnectRequestReplayStore}>{const state=await this.#read();return{sessions:state.sessions,replayStore:new WalletConnectRequestReplayStore(state.replay)}}
  async session(topic:string):Promise<WalletConnectSessionApproval|null>{return(await this.#read()).sessions.find(item=>item.topic===topic)??null}
  async saveSession(approval:WalletConnectSessionApproval):Promise<void>{const state=await this.#read(),sessions=[...state.sessions.filter(item=>item.topic!==approval.topic),approval];if(sessions.length>50)throw new Error("WalletConnect session limit reached");await this.#write({version:1,sessions,replay:state.replay})}
  async removeSession(topic:string):Promise<void>{const state=await this.#read();await this.#write({version:1,sessions:state.sessions.filter(item=>item.topic!==topic),replay:state.replay})}
  async reconcileSession(topic:string,namespaces:SessionTypes.Namespaces,account:string):Promise<"current"|"missing"|"changed">{const approval=await this.session(topic);if(!approval)return"missing";const next=normalizedNamespaces(namespaces);const expected=normalizedNamespaces(approval.namespaces as unknown as SessionTypes.Namespaces);return approval.account===account&&JSON.stringify(next)===JSON.stringify(expected)?"current":"changed"}
  async reconcileActiveSessions(activeSessions:readonly ActiveSession[],account:string):Promise<WalletConnectSessionReconciliation>{
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
  async saveReplay(store:WalletConnectRequestReplayStore):Promise<void>{const state=await this.#read();await this.#write({version:1,sessions:state.sessions,replay:store.snapshot()})}
  async #read():Promise<State>{const raw=await this.storage.getItem(KEY);if(raw===null)return Object.freeze({version:1,sessions:Object.freeze([]),replay:Object.freeze([])});if(raw.length>512_000)throw new Error("WalletConnect security state exceeds policy");let value:any;try{value=JSON.parse(raw)}catch{throw new Error("WalletConnect security state is unreadable")};if(!value||value.version!==1||!Array.isArray(value.sessions)||!Array.isArray(value.replay)||Object.keys(value).sort().join(",")!=="replay,sessions,version")throw new Error("WalletConnect security state is invalid");new WalletConnectRequestReplayStore(value.replay);return Object.freeze({version:1,sessions:Object.freeze(value.sessions),replay:Object.freeze(value.replay)})}
  async #write(state:State):Promise<void>{const encoded=JSON.stringify(state);await this.storage.setItem(KEY,encoded);if(await this.storage.getItem(KEY)!==encoded)throw new Error("WalletConnect security state could not be verified")}
}

function normalizedNamespaces(value:SessionTypes.Namespaces):unknown{return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([namespace,entry])=>[namespace,{accounts:[...(entry.accounts??[])].sort(),chains:[...(entry.chains??[])].sort(),events:[...(entry.events??[])].sort(),methods:[...(entry.methods??[])].sort()}]))}
function sameNamespaces(left:SessionTypes.Namespaces,right:SessionTypes.Namespaces):boolean{return JSON.stringify(normalizedNamespaces(left))===JSON.stringify(normalizedNamespaces(right))}
