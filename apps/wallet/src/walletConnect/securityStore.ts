import { WalletConnectRequestReplayStore, type WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const KEY="ynx.wallet.walletconnect.security.v1";
type State=Readonly<{version:1;sessions:readonly WalletConnectSessionApproval[];replay:ReturnType<WalletConnectRequestReplayStore["snapshot"]>}>;
export class WalletConnectSecurityStore{
  constructor(private readonly storage:SecureStorageAdapter){}
  async load():Promise<{sessions:readonly WalletConnectSessionApproval[];replayStore:WalletConnectRequestReplayStore}>{const state=await this.#read();return{sessions:state.sessions,replayStore:new WalletConnectRequestReplayStore(state.replay)}}
  async session(topic:string):Promise<WalletConnectSessionApproval|null>{return(await this.#read()).sessions.find(item=>item.topic===topic)??null}
  async saveSession(approval:WalletConnectSessionApproval):Promise<void>{const state=await this.#read(),sessions=[...state.sessions.filter(item=>item.topic!==approval.topic),approval];if(sessions.length>50)throw new Error("WalletConnect session limit reached");await this.#write({version:1,sessions,replay:state.replay})}
  async removeSession(topic:string):Promise<void>{const state=await this.#read();await this.#write({version:1,sessions:state.sessions.filter(item=>item.topic!==topic),replay:state.replay})}
  async saveReplay(store:WalletConnectRequestReplayStore):Promise<void>{const state=await this.#read();await this.#write({version:1,sessions:state.sessions,replay:store.snapshot()})}
  async #read():Promise<State>{const raw=await this.storage.getItem(KEY);if(raw===null)return Object.freeze({version:1,sessions:Object.freeze([]),replay:Object.freeze([])});if(raw.length>512_000)throw new Error("WalletConnect security state exceeds policy");let value:any;try{value=JSON.parse(raw)}catch{throw new Error("WalletConnect security state is unreadable")};if(!value||value.version!==1||!Array.isArray(value.sessions)||!Array.isArray(value.replay)||Object.keys(value).sort().join(",")!=="replay,sessions,version")throw new Error("WalletConnect security state is invalid");new WalletConnectRequestReplayStore(value.replay);return Object.freeze({version:1,sessions:Object.freeze(value.sessions),replay:Object.freeze(value.replay)})}
  async #write(state:State):Promise<void>{const encoded=JSON.stringify(state);await this.storage.setItem(KEY,encoded);if(await this.storage.getItem(KEY)!==encoded)throw new Error("WalletConnect security state could not be verified")}
}
