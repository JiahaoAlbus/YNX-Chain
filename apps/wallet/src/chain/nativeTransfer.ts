import { evmAddressFromYNX, type SignedNativeTransfer } from "@ynx-chain/wallet-auth";

export const DEFAULT_CHAIN_API="https://rpc.ynxweb4.com";
export type ChainAccount=Readonly<{address:string;balance:number;nonce:number}>;
export type ChainActivity=Readonly<{hash:string;type:string;from:string;to:string;amount:number;fee:number;nonce:number;timestamp?:string}>;
export type BroadcastResult=Readonly<{hash:string;replayed:boolean;truthfulStatus:"signature-verified-authoritative-native-transfer"}>;
type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;

export class NativeChainClient{
  readonly #baseURL:string;readonly #fetch:FetchLike;
  constructor(baseURL=DEFAULT_CHAIN_API,fetcher:FetchLike=fetch){this.#baseURL=base(baseURL);this.#fetch=fetcher}

  async account(account:string):Promise<ChainAccount>{
    const value=await this.#json(`/accounts/${encodeURIComponent(account)}`,{method:"GET"});
    const record=object(value)&&object(value.account)?value.account:null;
    if(!record||typeof record.address!=="string"||!/^0x[0-9a-f]{40}$/.test(record.address)||!Number.isSafeInteger(record.balance)||record.balance<0||!Number.isSafeInteger(record.nonce)||record.nonce<0)throw new Error("Authoritative account response is invalid");
    if(record.address!==evmAddressFromYNX(account))throw new Error("Authoritative account identity does not match the selected ynx1 account");
    return Object.freeze({address:record.address,balance:record.balance,nonce:record.nonce});
  }

  async activity(account:string):Promise<readonly ChainActivity[]>{
    const value=await this.#json("/txs?limit=25",{method:"GET"});
    if(!object(value)||!Array.isArray(value.transactions))throw new Error("Authoritative activity response is invalid");
    const address=evmAddressFromYNX(account);
    return Object.freeze(value.transactions.filter((item)=>object(item)&&(item.from===address||item.to===address)).map(parseActivity));
  }

  async broadcast(payload:string,expected:SignedNativeTransfer,expectedHash:string):Promise<BroadcastResult>{
    const value=await this.#json("/transactions/broadcast",{method:"POST",headers:{"Content-Type":"application/json"},body:payload});
    if(!object(value)||!object(value.transaction)||typeof value.replayed!=="boolean"||value.truthfulStatus!=="signature-verified-authoritative-native-transfer")throw new Error("Authoritative broadcast response is invalid");
    const tx=value.transaction;
    if(tx.hash!==expectedHash||tx.from!==expected.from||tx.to!==expected.to||tx.amount!==expected.amount||tx.fee!==expected.fee||tx.nonce!==expected.nonce)throw new Error("Authoritative broadcast response does not match the signed transfer");
    return Object.freeze({hash:expectedHash,replayed:value.replayed,truthfulStatus:value.truthfulStatus});
  }

  async #json(path:string,init:RequestInit):Promise<unknown>{
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15_000);
    try{const response=await this.#fetch(`${this.#baseURL}${path}`,{...init,signal:controller.signal,headers:{Accept:"application/json",...(init.headers??{})}});const text=await response.text();let value:unknown;try{value=JSON.parse(text)}catch{throw new Error(`YNX chain returned non-JSON (${response.status})`)}if(!response.ok)throw new Error(`YNX chain rejected the request (${response.status}): ${errorMessage(value)}`);return value}finally{clearTimeout(timeout)}
  }
}

function parseActivity(value:unknown):ChainActivity{if(!object(value)||typeof value.hash!=="string"||!/^0x[0-9a-f]{64}$/.test(value.hash)||typeof value.type!=="string"||typeof value.from!=="string"||typeof value.to!=="string"||!Number.isSafeInteger(value.amount)||!Number.isSafeInteger(value.fee)||!Number.isSafeInteger(value.nonce)||value.timestamp!==undefined&&typeof value.timestamp!=="string")throw new Error("Authoritative activity entry is invalid");return Object.freeze({hash:value.hash,type:value.type,from:value.from,to:value.to,amount:value.amount,fee:value.fee,nonce:value.nonce,...(value.timestamp?{timestamp:value.timestamp}:{})})}
function base(value:string){if(typeof value!=="string")throw new Error("YNX chain API URL is invalid");const parsed=new URL(value);if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=="/"&&parsed.pathname!=="")throw new Error("YNX chain API URL must be an origin");if(parsed.protocol!=="https:"&&!(parsed.protocol==="http:"&&["127.0.0.1","localhost","10.0.2.2"].includes(parsed.hostname)))throw new Error("YNX chain API requires HTTPS except local development");return parsed.origin}
function object(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function errorMessage(value:unknown){return object(value)&&typeof value.error==="string"?value.error:"unknown error"}
