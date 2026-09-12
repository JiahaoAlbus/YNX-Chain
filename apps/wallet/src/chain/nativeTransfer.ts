import { evmAddressFromYNX, nativeTransferHash, parseSignedNativeTransfer, type SignedNativeTransfer } from "@ynx-chain/wallet-auth";
import { createNativeDurabilityEvidence, NativeDurabilityInvalid, parseNativeDurabilityModel, parseNativeDurabilityState, type NativeDurabilityCheck } from "./nativeDurability";

export const DEFAULT_CHAIN_API="https://rpc.ynxweb4.com";
export type ChainAccount=Readonly<{address:string;balance:number;nonce:number}>;
export type ChainActivity=Readonly<{hash:string;type:string;from:string;to:string;amount:number;fee:number;nonce:number;timestamp?:string}>;
export type BroadcastResult=Readonly<{hash:string;replayed:boolean;truthfulStatus:"signature-verified-authoritative-native-transfer";durabilityConfirmed:boolean;durabilityEvidence:Readonly<Record<string,unknown>>|null}>;
class NativeDurabilityRPCError extends Error {constructor(readonly code:number,readonly data:unknown){super("The node has not supplied a verified local durability receipt.")}}
export class NativeBroadcastUnknown extends Error {
  readonly code="NATIVE_BROADCAST_UNKNOWN";
  constructor(readonly hash:string,message="Transfer confirmation is unavailable. Keep the original transaction and retry only that transaction.",readonly httpStatus?:number,readonly reportedHash?:string){super(message)}
}
export type NativeChainState=Readonly<{phase:"loading"|"ready"|"unrecorded"|"failed";account?:ChainAccount;error?:string;activityPhase:"loading"|"ready"|"failed";activity:readonly ChainActivity[];activityError?:string}>;
type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;

export class NativeReadCancelled extends Error{
  readonly code="NATIVE_READ_CANCELLED";
  constructor(){super("The balance refresh was cancelled.");this.name="NativeReadCancelled"}
}
export function isNativeReadCancelled(value:unknown):value is NativeReadCancelled{return value instanceof NativeReadCancelled}
export class NativeReadError extends Error{
  constructor(readonly code:"NATIVE_READ_TIMEOUT"|"NATIVE_READ_UNAVAILABLE"|"NATIVE_READ_HTTP"|"NATIVE_READ_INVALID_RESPONSE",message:string,readonly retryable=false,readonly httpStatus?:number){super(message);this.name="NativeReadError"}
}
const READ_TIMEOUT_MS=15_000,READ_RETRY_DELAY_MS=250;
const RETRYABLE_READ_STATUS=new Set([408,429,500,502,503,504]);

export class AccountNotRecordedError extends Error{
  readonly account:string;
  constructor(account:string){super("This address has no on-chain account record yet. Receive testnet YNXT to get started.");this.name="AccountNotRecordedError";this.account=account}
}

export async function loadNativeChainState(client:NativeChainClient,selectedAccount:string,signal?:AbortSignal):Promise<NativeChainState>{
  assertReadActive(signal);
  const [account,activity]=await Promise.allSettled([client.account(selectedAccount,signal),client.activity(selectedAccount,signal)]);
  assertReadActive(signal);
  const accountState=account.status==="fulfilled"?{phase:"ready" as const,account:account.value}:account.reason instanceof AccountNotRecordedError&&account.reason.account===selectedAccount?{phase:"unrecorded" as const}:{phase:"failed" as const,error:failureMessage(account.reason)};
  const activityState=activity.status==="fulfilled"?{activityPhase:"ready" as const,activity:activity.value}:{activityPhase:"failed" as const,activity:Object.freeze([]),activityError:failureMessage(activity.reason)};
  return Object.freeze({...accountState,...activityState});
}

export class NativeChainClient{
  readonly #baseURL:string;readonly #fetch:FetchLike;
  private rpcSequence=0;
  constructor(baseURL=DEFAULT_CHAIN_API,fetcher:FetchLike=fetch){this.#baseURL=base(baseURL);this.#fetch=fetcher}
  get origin():string{return this.#baseURL}

  async requireDurabilityCapability():Promise<void>{
    if(await this.#rpc("eth_chainId",[])!=="0x1917")throw new NativeDurabilityInvalid();
    parseNativeDurabilityModel(await this.#rpc("ynx_getDurabilityModel",[]));
    // A model request can itself span a node replacement.
    if(await this.#rpc("eth_chainId",[])!=="0x1917")throw new NativeDurabilityInvalid();
  }

  async account(account:string,signal?:AbortSignal):Promise<ChainAccount>{
    assertReadActive(signal);
    const address=evmAddressFromYNX(account);
    const value=await this.#readJSON(`/accounts/${encodeURIComponent(account)}`,signal,account);
    assertReadActive(signal);
    const record=object(value)&&object(value.account)?value.account:null;
    if(!record||typeof record.address!=="string"||!/^0x[0-9a-f]{40}$/.test(record.address)||!Number.isSafeInteger(record.balance)||record.balance<0||!Number.isSafeInteger(record.nonce)||record.nonce<0)throw new Error("Authoritative account response is invalid");
    if(record.address!==address)throw new Error("Authoritative account identity does not match the selected ynx1 account");
    return Object.freeze({address:record.address,balance:record.balance,nonce:record.nonce});
  }

  async activity(account:string,signal?:AbortSignal):Promise<readonly ChainActivity[]>{
    assertReadActive(signal);
    const address=evmAddressFromYNX(account);
    const value=await this.#readJSON("/txs?limit=25",signal);
    assertReadActive(signal);
    if(!object(value)||!Array.isArray(value.transactions))throw new Error("Authoritative activity response is invalid");
    return Object.freeze(value.transactions.filter((item)=>object(item)&&(item.from===address||item.to===address)).map(parseActivity));
  }

  // Only these two GET routes use recovery. RPC and transaction POSTs retain
  // their original single-attempt transport and outbox semantics below.
  async #readJSON(path:string,signal?:AbortSignal,requestedAccount?:string):Promise<unknown>{
    for(let attempt=0;attempt<2;attempt++){
      assertReadActive(signal);
      try{return await this.#readAttempt(path,signal,requestedAccount)}
      catch(error){
        assertReadActive(signal);
        if(attempt===1||!(error instanceof NativeReadError)||!error.retryable)throw error;
        await readRetryDelay(signal);
      }
    }
    throw new NativeReadError("NATIVE_READ_UNAVAILABLE","The network is unavailable. Please refresh again.");
  }

  async #readAttempt(path:string,signal?:AbortSignal,requestedAccount?:string):Promise<unknown>{
    assertReadActive(signal);
    const controller=new AbortController();let rejectStopped!:(error:Error)=>void,stopReason:Error|undefined;
    const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject});
    // Settle our typed result before notifying native fetch. Its raw CANCEL
    // rejection must not turn a caller cancellation or deadline into node text.
    const stop=(reason:Error)=>{stopReason??=reason;rejectStopped(stopReason);controller.abort()};
    const assertAttemptActive=()=>{assertReadActive(signal);if(stopReason)throw stopReason};
    const cancel=()=>stop(new NativeReadCancelled());
    signal?.addEventListener("abort",cancel,{once:true});
    const timeout=setTimeout(()=>stop(new NativeReadError("NATIVE_READ_TIMEOUT","The network request timed out. Please refresh again.",true)),READ_TIMEOUT_MS);
    try{
      assertAttemptActive();
      return await Promise.race([(async()=>{
        const url=`${this.#baseURL}${path}`;
        const response=await this.#fetch(url,{method:"GET",redirect:"error",signal:controller.signal,headers:{Accept:"application/json"}});
        assertAttemptActive();
        if(response.redirected||response.url&&response.url!==url)throw new NativeReadError("NATIVE_READ_INVALID_RESPONSE","YNX chain response origin changed");
        if(!response.ok&&RETRYABLE_READ_STATUS.has(response.status))throw new NativeReadError("NATIVE_READ_HTTP",`The YNX node is temporarily unavailable (${response.status}). Please refresh again.`,true,response.status);
        const text=await response.text();assertAttemptActive();
        if(text.length>262144)throw new NativeReadError("NATIVE_READ_INVALID_RESPONSE","YNX chain response exceeds the supported size");
        let value:unknown;
        try{value=JSON.parse(text)}catch{throw new NativeReadError("NATIVE_READ_INVALID_RESPONSE",`YNX chain returned non-JSON (${response.status})`)}
        if(!response.ok){
          if(requestedAccount!==undefined&&response.status===404&&object(value)&&Object.keys(value).length===1&&value.error==="account not found")throw new AccountNotRecordedError(requestedAccount);
          throw new NativeReadError("NATIVE_READ_HTTP",`The YNX node could not complete this read (${response.status}). Please refresh again.`,false,response.status);
        }
        return value;
      })(),stopped]);
    }catch(error){
      assertReadActive(signal);
      if(error instanceof NativeReadError||error instanceof AccountNotRecordedError)throw error;
      throw new NativeReadError("NATIVE_READ_UNAVAILABLE","The network connection was interrupted. Please refresh again.",true);
    }finally{clearTimeout(timeout);signal?.removeEventListener("abort",cancel);controller.abort()}
  }

  async broadcast(payload:string,expected:SignedNativeTransfer,expectedHash:string):Promise<BroadcastResult>{
    const parsed=parseSignedNativeTransfer(payload);
    if(JSON.stringify(parsed)!==JSON.stringify(expected)||nativeTransferHash(payload)!==expectedHash||!Number.isSafeInteger(parsed.amount+parsed.fee))throw new Error("The signed native transfer does not match its reviewed identity and safe whole-YNXT total");
    let value:unknown;
    try{value=await this.#json("/transactions/broadcast",{method:"POST",headers:{"Content-Type":"application/json"},body:payload},undefined,expectedHash)}catch(error){if(error instanceof NativeBroadcastUnknown)throw error;throw new NativeBroadcastUnknown(expectedHash)}
    if(!object(value)||!object(value.transaction)||typeof value.replayed!=="boolean"||value.truthfulStatus!=="signature-verified-authoritative-native-transfer")throw new NativeBroadcastUnknown(expectedHash,"Authoritative broadcast response is invalid");
    const tx=value.transaction;
    if(tx.hash!==expectedHash||tx.from!==expected.from||tx.to!==expected.to||tx.amount!==expected.amount||tx.fee!==expected.fee||tx.nonce!==expected.nonce)throw new NativeBroadcastUnknown(expectedHash,"Authoritative broadcast response does not match the signed transfer");
    // An ACK, including replay, can describe only pending admission. Only a
    // separate exact durable mined receipt can complete the local outbox.
    return Object.freeze({hash:expectedHash,replayed:value.replayed,truthfulStatus:value.truthfulStatus,durabilityConfirmed:false,durabilityEvidence:null});
  }

  async checkTransferDurability(expected:SignedNativeTransfer,expectedHash:string):Promise<NativeDurabilityCheck>{
    if(await this.#rpc("eth_chainId",[])!=="0x1917")throw new NativeDurabilityInvalid();
    let model:unknown;
    try{model=await this.#rpc("ynx_getDurabilityModel",[])}catch(error){if(error instanceof NativeDurabilityRPCError&&error.code===-32601)return Object.freeze({status:"unsupported",evidence:null});throw error}
    parseNativeDurabilityModel(model);
    const state=parseNativeDurabilityState(await this.#rpc("ynx_getTransactionDurability",[expectedHash]),expectedHash);
    if(state.status!=="durable")return Object.freeze({status:state.status,evidence:null});
    let receipt:unknown;
    try{receipt=await this.#rpc("eth_getTransactionReceipt",[expectedHash])}catch(error){
      if(error instanceof NativeDurabilityRPCError&&object(error.data)&&error.data.transactionHash===expectedHash&&error.data.durabilityVersion==="ynx-local-durability-v1"){
        const fallback=parseNativeDurabilityState(error.data.ynxDurability,expectedHash);
        if(error.code===-32002&&error.data.status==="transaction_durability_uncertain"&&fallback.status==="uncertain"||error.code===-32004&&error.data.status==="transaction_durability_unavailable"&&fallback.status==="memory_only")return Object.freeze({status:fallback.status,evidence:null});
      }
      throw error;
    }
    if(receipt===null)return Object.freeze({status:"uncertain",evidence:null});
    const evidence=createNativeDurabilityEvidence(this.origin,model,receipt,expected,expectedHash);
    const proof=(evidence.receipt as any).ynxDurability;
    if(proof.blockNumber!==state.blockNumber||proof.blockHash!==state.blockHash)throw new NativeDurabilityInvalid();
    // Receipt I/O may span a node replacement. The original capability and
    // actual chain must still be present before this proof can release an intent.
    await this.requireDurabilityCapability();
    return Object.freeze({status:"durable",evidence});
  }

  async #rpc(method:string,params:readonly unknown[]):Promise<unknown>{
    const id=++this.rpcSequence;
    const response=await this.#json("/evm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params})});
    if(!object(response)||response.jsonrpc!=="2.0"||response.id!==id||Object.hasOwn(response,"result")===Object.hasOwn(response,"error"))throw new NativeDurabilityInvalid();
    if(Object.hasOwn(response,"error")){if(!object(response.error)||!Number.isSafeInteger(response.error.code)||typeof response.error.message!=="string")throw new NativeDurabilityInvalid();throw new NativeDurabilityRPCError(response.error.code,response.error.data)}
    return response.result;
  }

  async #json(path:string,init:RequestInit,requestedAccount?:string,broadcastHash?:string):Promise<unknown>{
    const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
      return await Promise.race([(async()=>{
      const url=`${this.#baseURL}${path}`;
      const response=await this.#fetch(url,{...init,redirect:"error",signal:controller.signal,headers:{Accept:"application/json",...(init.headers??{})}});
      if(response.redirected||response.url&&response.url!==url)throw new Error("YNX chain response origin changed");
      const text=await response.text();if(text.length>262144)throw new Error("YNX chain response exceeds the supported size");let value:unknown;try{value=JSON.parse(text)}catch{throw new Error(`YNX chain returned non-JSON (${response.status})`)}
      if(!response.ok){
        // Native HTTP errors currently have no versioned, request-bound rejection
        // proof. Even a 400/403 must not release an already signed transaction.
        if(broadcastHash)throw new NativeBroadcastUnknown(broadcastHash,`YNX chain has not confirmed the transfer (${response.status}).`,response.status,object(value)&&typeof value.transactionHash==="string"&&/^0x[0-9a-f]{64}$/.test(value.transactionHash)?value.transactionHash:undefined);
        if(requestedAccount!==undefined&&init.method==="GET"&&path===`/accounts/${encodeURIComponent(requestedAccount)}`&&response.status===404&&object(value)&&Object.keys(value).length===1&&value.error==="account not found")throw new AccountNotRecordedError(requestedAccount);
        throw new Error(`YNX chain rejected the request (${response.status}): ${errorMessage(value)}`);
      }
      return value;
      })(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error("YNX chain request timed out"))},15_000)})]);
    }finally{clearTimeout(timeout)}
  }
}

function parseActivity(value:unknown):ChainActivity{if(!object(value)||typeof value.hash!=="string"||!/^0x[0-9a-f]{64}$/.test(value.hash)||typeof value.type!=="string"||typeof value.from!=="string"||typeof value.to!=="string"||!Number.isSafeInteger(value.amount)||!Number.isSafeInteger(value.fee)||!Number.isSafeInteger(value.nonce)||value.timestamp!==undefined&&typeof value.timestamp!=="string")throw new Error("Authoritative activity entry is invalid");return Object.freeze({hash:value.hash,type:value.type,from:value.from,to:value.to,amount:value.amount,fee:value.fee,nonce:value.nonce,...(value.timestamp?{timestamp:value.timestamp}:{})})}
function base(value:string){if(typeof value!=="string")throw new Error("YNX chain API URL is invalid");const parsed=new URL(value);if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=="/"&&parsed.pathname!=="")throw new Error("YNX chain API URL must be an origin");if(parsed.protocol!=="https:"&&!(parsed.protocol==="http:"&&["127.0.0.1","localhost","10.0.2.2"].includes(parsed.hostname)))throw new Error("YNX chain API requires HTTPS except local development");return parsed.origin}
function object(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function errorMessage(value:unknown){return object(value)&&typeof value.error==="string"?value.error:"unknown error"}
function failureMessage(value:unknown){return value instanceof Error?value.message:String(value)}
function assertReadActive(signal?:AbortSignal):void{if(signal?.aborted)throw new NativeReadCancelled()}
async function readRetryDelay(signal?:AbortSignal):Promise<void>{
  assertReadActive(signal);
  let timer:ReturnType<typeof setTimeout>|undefined,cancel=()=>{};
  try{
    await new Promise<void>((resolve,reject)=>{
      cancel=()=>reject(new NativeReadCancelled());
      signal?.addEventListener("abort",cancel,{once:true});
      if(signal?.aborted){cancel();return}
      timer=setTimeout(resolve,READ_RETRY_DELAY_MS);
    });
    assertReadActive(signal);
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",cancel)}
}
