import { evmAddressFromYNX, nativeTransferHash, parseSignedNativeTransfer, type SignedNativeTransfer } from "@ynx-chain/wallet-auth";

export const DEFAULT_CHAIN_API="https://rpc.ynxweb4.com";
export type ChainAccount=Readonly<{address:string;balance:number;nonce:number}>;
export type ChainActivity=Readonly<{hash:string;type:string;from:string;to:string;amount:number;fee:number;nonce:number;timestamp?:string}>;
export type BroadcastResult=Readonly<{hash:string;replayed:boolean;truthfulStatus:"signature-verified-authoritative-native-transfer";durabilityConfirmed:boolean;durabilityEvidence:Readonly<Record<string,unknown>>|null}>;
export type NativeDurabilityVerifier=(response:Readonly<Record<string,unknown>>,expected:SignedNativeTransfer,hash:string)=>boolean;
// The existing public Core does not supply a verifiable durable checkpoint.
// Replace this only with the reviewed, versioned Core contract once available.
export const verifyNativeDurability:NativeDurabilityVerifier=()=>false;
export class NativeBroadcastUnknown extends Error {
  readonly code="NATIVE_BROADCAST_UNKNOWN";
  constructor(readonly hash:string,message="Transfer confirmation is unavailable. Keep the original transaction and retry only that transaction.",readonly httpStatus?:number,readonly reportedHash?:string){super(message)}
}
export type NativeChainState=Readonly<{phase:"loading"|"ready"|"unrecorded"|"failed";account?:ChainAccount;error?:string;activityPhase:"loading"|"ready"|"failed";activity:readonly ChainActivity[];activityError?:string}>;
type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;

export class AccountNotRecordedError extends Error{
  readonly account:string;
  constructor(account:string){super("This address has no on-chain account record yet. Receive testnet YNXT to get started.");this.name="AccountNotRecordedError";this.account=account}
}

export async function loadNativeChainState(client:NativeChainClient,selectedAccount:string):Promise<NativeChainState>{
  const [account,activity]=await Promise.allSettled([client.account(selectedAccount),client.activity(selectedAccount)]);
  const accountState=account.status==="fulfilled"?{phase:"ready" as const,account:account.value}:account.reason instanceof AccountNotRecordedError&&account.reason.account===selectedAccount?{phase:"unrecorded" as const}:{phase:"failed" as const,error:failureMessage(account.reason)};
  const activityState=activity.status==="fulfilled"?{activityPhase:"ready" as const,activity:activity.value}:{activityPhase:"failed" as const,activity:Object.freeze([]),activityError:failureMessage(activity.reason)};
  return Object.freeze({...accountState,...activityState});
}

export class NativeChainClient{
  readonly #baseURL:string;readonly #fetch:FetchLike;
  constructor(baseURL=DEFAULT_CHAIN_API,fetcher:FetchLike=fetch,private readonly verifyDurability:NativeDurabilityVerifier=verifyNativeDurability){this.#baseURL=base(baseURL);this.#fetch=fetcher}
  get origin():string{return this.#baseURL}

  async account(account:string):Promise<ChainAccount>{
    const address=evmAddressFromYNX(account);
    const value=await this.#json(`/accounts/${encodeURIComponent(account)}`,{method:"GET"},account);
    const record=object(value)&&object(value.account)?value.account:null;
    if(!record||typeof record.address!=="string"||!/^0x[0-9a-f]{40}$/.test(record.address)||!Number.isSafeInteger(record.balance)||record.balance<0||!Number.isSafeInteger(record.nonce)||record.nonce<0)throw new Error("Authoritative account response is invalid");
    if(record.address!==address)throw new Error("Authoritative account identity does not match the selected ynx1 account");
    return Object.freeze({address:record.address,balance:record.balance,nonce:record.nonce});
  }

  async activity(account:string):Promise<readonly ChainActivity[]>{
    const value=await this.#json("/txs?limit=25",{method:"GET"});
    if(!object(value)||!Array.isArray(value.transactions))throw new Error("Authoritative activity response is invalid");
    const address=evmAddressFromYNX(account);
    return Object.freeze(value.transactions.filter((item)=>object(item)&&(item.from===address||item.to===address)).map(parseActivity));
  }

  async broadcast(payload:string,expected:SignedNativeTransfer,expectedHash:string):Promise<BroadcastResult>{
    const parsed=parseSignedNativeTransfer(payload);
    if(JSON.stringify(parsed)!==JSON.stringify(expected)||nativeTransferHash(payload)!==expectedHash||!Number.isSafeInteger(parsed.amount+parsed.fee))throw new Error("The signed native transfer does not match its reviewed identity and safe whole-YNXT total");
    let value:unknown;
    try{value=await this.#json("/transactions/broadcast",{method:"POST",headers:{"Content-Type":"application/json"},body:payload},undefined,expectedHash)}catch(error){if(error instanceof NativeBroadcastUnknown)throw error;throw new NativeBroadcastUnknown(expectedHash)}
    if(!object(value)||!object(value.transaction)||typeof value.replayed!=="boolean"||value.truthfulStatus!=="signature-verified-authoritative-native-transfer")throw new NativeBroadcastUnknown(expectedHash,"Authoritative broadcast response is invalid");
    const tx=value.transaction;
    if(tx.hash!==expectedHash||tx.from!==expected.from||tx.to!==expected.to||tx.amount!==expected.amount||tx.fee!==expected.fee||tx.nonce!==expected.nonce)throw new NativeBroadcastUnknown(expectedHash,"Authoritative broadcast response does not match the signed transfer");
    // A legacy success (and GET /txs/hash) can reflect only in-memory state.
    // A compiled, exact Core checkpoint verifier is required to release the outbox.
    let durabilityConfirmed=false;try{durabilityConfirmed=this.verifyDurability(value,expected,expectedHash)===true}catch{}
    return Object.freeze({hash:expectedHash,replayed:value.replayed,truthfulStatus:value.truthfulStatus,durabilityConfirmed,durabilityEvidence:durabilityConfirmed?JSON.parse(JSON.stringify(value)):null});
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
