import { DappBrowserController, browserSessionIdForOrigin, type DappBrowserPort, type DappBrowserResponse, type DappBrowserSnapshot, type PendingConnect } from "./dappBrowserController";
import { restoreEip1193Request, restoreEip1193Session, type Eip1193Request, type Eip1193Session } from "./eip1193Provider";
import type { SecureStorageAdapter } from "../storage/walletRepository";

export const DAPP_BROWSER_STATE_KEY="ynx.wallet.dapp-browser.v1";
type PendingState=Readonly<{kind:"connection";value:PendingConnect}|{kind:"request";value:Eip1193Request}|{kind:"executing";value:Eip1193Request}>;
type StoredState=Readonly<{schemaVersion:1;selectedAccount:string;activeOrigin:string;sessions:readonly Eip1193Session[];pending:PendingState|null}>;

export class PersistentDappBrowserController {
  private controller:DappBrowserController;
  private selectedAccount:string|null=null;
  private activeOrigin:string|null=null;
  private outbound:Array<Readonly<{kind:"response";value:DappBrowserResponse}|{kind:"event";name:"accountsChanged"|"chainChanged";data:unknown}>>=[];
  private sequence:Promise<void>=Promise.resolve();
  private poisoned=false;
  private replayRequired=false;

  constructor(private readonly port:DappBrowserPort,private readonly storage:SecureStorageAdapter,private readonly now:()=>Date=()=>new Date()){this.controller=this.emptyController()}

  pendingConnection(){return this.controller.pendingConnection()}
  pendingRequest(){return this.controller.pendingRequest()}
  activeOrigins(){return this.controller.activeOrigins()}
  canApprovePending(){return !this.replayRequired}

  restore(selectedAccount:string,fallbackOrigin:string):Promise<Readonly<{activeOrigin:string;restoredPending:boolean}>>{
    return this.enqueue(async()=>{
      const fallback=strictOrigin(fallbackOrigin),at=validNow(this.now());this.selectedAccount=selectedAccount;this.activeOrigin=fallback;this.poisoned=false;this.replayRequired=false;this.outbound=[];this.controller=this.emptyController();
      const serialized=await this.storage.getItem(DAPP_BROWSER_STATE_KEY);if(serialized===null)return Object.freeze({activeOrigin:fallback,restoredPending:false});
      let decoded:ReturnType<typeof decodeState>;
      try{decoded=decodeState(serialized,selectedAccount,at)}catch(caught){await this.storage.deleteItem(DAPP_BROWSER_STATE_KEY);throw failCause("DAPP_BROWSER_STATE_INVALID","DApp Browser secure state failed verification and was removed",caught)}
      if(decoded.accountDrift){await this.storage.deleteItem(DAPP_BROWSER_STATE_KEY);return Object.freeze({activeOrigin:fallback,restoredPending:false})}
      this.activeOrigin=decoded.state.activeOrigin;this.controller.restoreSnapshot(decoded.snapshot);this.replayRequired=decoded.snapshot.connection!==null||decoded.snapshot.request!==null;
      if(decoded.cleaned)await this.save();
      return Object.freeze({activeOrigin:this.activeOrigin,restoredPending:this.pendingConnection()!==null||this.pendingRequest()!==null});
    });
  }

  receive(origin:string,name:string,raw:string){return this.mutate(async()=>{this.assertOrigin(origin);if(this.replayRequired){const result=this.controller.confirmPendingReplay(origin,name,raw);this.replayRequired=false;return result}return this.controller.receive(origin,name,raw)})}
  approveConnection(selectedAccount:string,origin:string){return this.mutate(async()=>{this.assertReplayConfirmed();this.assertAccount(selectedAccount);this.assertOrigin(origin);return this.controller.approveConnection(selectedAccount,origin)})}
  rejectConnection(){return this.mutate(async()=>{const result=this.controller.rejectConnection();this.replayRequired=false;return result})}

  approveRequest(origin:string,boundary:Parameters<DappBrowserController["approveRequest"]>[1]):Promise<string>{
    return this.enqueue(async()=>{
      this.assertUsable();this.assertReplayConfirmed();this.assertOrigin(origin);const request=this.controller.pendingRequest();if(!request)fail("REQUEST_MISSING","DApp Browser request is missing");
      this.outbound=[];await this.save(Object.freeze({kind:"executing",value:request}));
      try{const result=await this.controller.approveRequest(origin,boundary);await this.save();this.flush();return result}catch(caught){
        try{if(this.controller.pendingRequest())this.controller.rejectRequest();await this.save();this.flush()}catch(cleanup){this.poisoned=true;this.outbound=[];throw failCause("DAPP_BROWSER_STATE_UNSAFE","DApp Browser approval cleanup failed closed",cleanup)}
        throw caught;
      }
    });
  }

  rejectRequest(){return this.mutate(async()=>{const result=this.controller.rejectRequest();this.replayRequired=false;return result})}
  navigated(origin:string){return this.enqueue(async()=>{this.assertUsable();const exact=strictOrigin(origin);this.outbound=[];this.controller.navigated(exact);this.activeOrigin=exact;if(!this.controller.pendingConnection()&&!this.controller.pendingRequest())this.replayRequired=false;try{await this.save()}catch(caught){this.poisoned=true;this.outbound=[];throw caught}this.flush()})}
  disconnect(origin:string){return this.mutate(async()=>{const result=this.controller.disconnect(origin);if(!this.controller.pendingConnection()&&!this.controller.pendingRequest())this.replayRequired=false;return result})}

  private mutate<T>(operation:()=>Promise<T>|T):Promise<T>{return this.enqueue(async()=>{this.assertUsable();this.outbound=[];const result=await operation();try{await this.save()}catch(caught){this.poisoned=true;this.outbound=[];throw caught}this.flush();return result})}
  private emptyController(){return new DappBrowserController({respond:value=>this.outbound.push(Object.freeze({kind:"response",value})),emit:(name,data)=>this.outbound.push(Object.freeze({kind:"event",name,data}))},this.now)}
  private flush(){const values=this.outbound;this.outbound=[];for(const item of values){if(item.kind==="response")this.port.respond(item.value);else this.port.emit?.(item.name,item.data)}}
  private assertUsable(){if(this.selectedAccount===null||this.activeOrigin===null)fail("DAPP_BROWSER_NOT_RESTORED","DApp Browser secure state is not restored");if(this.poisoned)fail("DAPP_BROWSER_STATE_UNSAFE","DApp Browser state persistence failed; close and unlock Wallet again")}
  private assertOrigin(origin:string){if(strictOrigin(origin)!==this.activeOrigin)fail("ORIGIN_DRIFT","DApp Browser active origin differs from the approval origin")}
  private assertAccount(account:string){if(account!==this.selectedAccount)fail("ACCOUNT_DRIFT","Selected Wallet account changed before DApp approval")}
  private assertReplayConfirmed(){if(this.replayRequired)fail("PENDING_REPLAY_REQUIRED","Restored DApp approval requires an exact request replay from the active origin")}
  private async save(pendingOverride:PendingState|null|undefined=undefined){this.assertUsable();const snapshot=this.controller.snapshot(),pending=pendingOverride===undefined?pendingFrom(snapshot):pendingOverride,state:StoredState=Object.freeze({schemaVersion:1,selectedAccount:this.selectedAccount!,activeOrigin:this.activeOrigin!,sessions:snapshot.sessions,pending});await this.storage.setItem(DAPP_BROWSER_STATE_KEY,JSON.stringify(state))}
  private enqueue<T>(operation:()=>Promise<T>):Promise<T>{const result=this.sequence.then(operation);this.sequence=result.then(()=>undefined,()=>undefined);return result}
}

function decodeState(serialized:string,selectedAccount:string,now:Date):Readonly<{accountDrift:boolean;cleaned:boolean;state:StoredState;snapshot:DappBrowserSnapshot}>{
  if(serialized.length>1_048_576)fail("STATE_TOO_LARGE","DApp Browser state is too large");let parsed:unknown;try{parsed=JSON.parse(serialized)}catch{fail("STATE_UNREADABLE","DApp Browser state is unreadable")};const value=record(parsed,"DApp Browser state");exact(value,["schemaVersion","selectedAccount","activeOrigin","sessions","pending"],"DApp Browser state");
  if(value.schemaVersion!==1||typeof value.selectedAccount!=="string"||!Array.isArray(value.sessions)||value.sessions.length>32)fail("STATE_INVALID","DApp Browser state is invalid");const activeOrigin=strictOrigin(value.activeOrigin as string);
  if(value.selectedAccount!==selectedAccount){const empty=Object.freeze({schemaVersion:1 as const,selectedAccount,activeOrigin,sessions:Object.freeze([]),pending:null});return Object.freeze({accountDrift:true,cleaned:true,state:empty,snapshot:Object.freeze({sessions:Object.freeze([]),connection:null,request:null})})}
  let cleaned=false;const sessions:Eip1193Session[]=[];for(const raw of value.sessions){const expiresAt=record(raw,"DApp Browser session").expiresAt;if(expired(expiresAt,now)){cleaned=true;continue}const session=restoreEip1193Session(raw,selectedAccount,now);if(session.sessionId!==browserSessionIdForOrigin(session.origin))fail("SESSION_RESTORE_MISMATCH","Persisted DApp Browser session ID is invalid");sessions.push(session)}
  sessions.sort((a,b)=>a.origin.localeCompare(b.origin));if(new Set(sessions.map(item=>item.origin)).size!==sessions.length)fail("STATE_INVALID","DApp Browser state contains duplicate origins");
  let pending:PendingState|null=null,connection:PendingConnect|null=null,request:Eip1193Request|null=null;
  if(value.pending!==null){const item=record(value.pending,"DApp Browser pending state");exact(item,["kind","value"],"DApp Browser pending state");if(item.kind==="connection"){const restored=restoreConnection(item.value,now);if(Date.parse(restored.expiresAt)<=now.getTime())cleaned=true;else{pending=Object.freeze({kind:"connection",value:restored});connection=restored}}else if(item.kind==="request"||item.kind==="executing"){const raw=record(item.value,"DApp Browser request"),session=sessions.find(candidate=>candidate.origin===raw.origin);if(!session)fail("STATE_INVALID","DApp Browser pending request session is missing");const restored=restoreEip1193Request(raw,session,now);if(item.kind==="executing"||Date.parse(restored.expiresAt)<=now.getTime())cleaned=true;else{pending=Object.freeze({kind:"request",value:restored});request=restored}}else fail("STATE_INVALID","DApp Browser pending kind is invalid")}
  const bound=(connection??request);if(bound&&bound.origin!==activeOrigin)fail("ORIGIN_DRIFT","DApp Browser pending origin drifted");const state=Object.freeze({schemaVersion:1 as const,selectedAccount,activeOrigin,sessions:Object.freeze(sessions),pending});const snapshot=Object.freeze({sessions:Object.freeze(sessions),connection,request});return Object.freeze({accountDrift:false,cleaned,state,snapshot});
}
function pendingFrom(snapshot:DappBrowserSnapshot):PendingState|null{if(snapshot.connection&&snapshot.request)fail("STATE_AMBIGUOUS","DApp Browser has multiple pending approvals");if(snapshot.connection)return Object.freeze({kind:"connection",value:snapshot.connection});if(snapshot.request)return Object.freeze({kind:"request",value:snapshot.request});return null}
function restoreConnection(input:unknown,now:Date):PendingConnect{const value=record(input,"DApp Browser connection request");exact(value,["origin","name","id","issuedAt","expiresAt"],"DApp Browser connection request");const origin=strictOrigin(value.origin as string),name=strictName(value.name),id=value.id;if(!(typeof id==="string"||Number.isSafeInteger(id)))fail("STATE_INVALID","DApp Browser connection ID is invalid");const issued=time(value.issuedAt,"connection issue"),expires=time(value.expiresAt,"connection expiry");if(issued.getTime()>now.getTime()+30_000||expires.getTime()<=issued.getTime()||expires.getTime()>issued.getTime()+5*60_000)fail("INVALID_EXPIRY","DApp Browser connection lifetime is invalid");return Object.freeze({origin,name,id:id as string|number,issuedAt:issued.toISOString(),expiresAt:expires.toISOString()})}
function expired(value:unknown,now:Date){return time(value,"session expiry").getTime()<=now.getTime()}
function time(value:unknown,label:string){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))fail("INVALID_TIME",`${label} is invalid`);const parsed=new Date(value);if(parsed.toISOString()!==value)fail("INVALID_TIME",`${label} is invalid`);return parsed}
function strictOrigin(value:string){let url:URL;try{url=new URL(value)}catch{fail("INVALID_ORIGIN","DApp Browser origin is invalid")};if(url.protocol!=="https:"||url.origin!==value||url.username||url.password||url.port)fail("INVALID_ORIGIN","DApp Browser requires a canonical HTTPS origin");return value}
function strictName(value:unknown){if(typeof value!=="string"||value.trim()!==value||value.length<1||value.length>96||/[\u0000-\u001f\u007f]/.test(value))fail("INVALID_NAME","DApp Browser name is invalid");return value}
function validNow(value:Date){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","DApp Browser clock is invalid");return value}
function record(value:unknown,label:string):Record<string,unknown>{if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail("STATE_INVALID",`${label} is invalid`);return value as Record<string,unknown>}
function exact(value:Record<string,unknown>,keys:readonly string[],label:string){if(Object.keys(value).sort().join(",")!==[...keys].sort().join(","))fail("STATE_INVALID",`${label} has unknown or missing fields`)}
function failCause(code:string,message:string,cause:unknown){return Object.assign(new Error(message,{cause}),{code})}
function fail(code:string,message:string):never{throw Object.assign(new Error(message),{code})}
