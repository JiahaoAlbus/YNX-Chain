import { evmAddressFromYNX, type SignedNativeTransfer } from "@ynx-chain/wallet-auth";

export const DEFAULT_CHAIN_API="https://rest.ynxweb4.com";
export const DEFAULT_CHAIN_RPC="https://rpc.ynxweb4.com/evm";
export const YNX_EVM_CHAIN_ID="0x1917";
export type ChainAccount=Readonly<{address:string;balance:number;nonce:number;source:"native-rest"|"evm-json-rpc";materialized:boolean}>;
export type ChainActivity=Readonly<{hash:string;type:string;from:string;to:string;amount:number;fee:number;nonce:number;timestamp?:string}>;
export type BroadcastResult=Readonly<{hash:string;replayed:boolean;truthfulStatus:"signature-verified-authoritative-native-transfer"}>;
type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;

export class ChainNetworkError extends Error{
  readonly code="RPC_UNAVAILABLE" as const;
  constructor(readonly reason:"timeout"|"transport"){
    super(`RPC_UNAVAILABLE: YNX Testnet transport ${reason=== "timeout" ? "timed out" : "is unavailable"}`);
    this.name="ChainNetworkError";
  }
}

export class NativeChainClient{
  readonly #baseURL:string;readonly #rpcURL:string;readonly #fetch:FetchLike;readonly #requestTimeoutMS:number;
  constructor(baseURL=DEFAULT_CHAIN_API,rpcURL=DEFAULT_CHAIN_RPC,fetcher:FetchLike=fetch,requestTimeoutMS=15_000){this.#baseURL=base(baseURL);this.#rpcURL=rpcEndpoint(rpcURL);this.#fetch=fetcher;if(!Number.isSafeInteger(requestTimeoutMS)||requestTimeoutMS<1||requestTimeoutMS>30_000)throw new Error("YNX chain request timeout is invalid");this.#requestTimeoutMS=requestTimeoutMS}

  async account(account:string):Promise<ChainAccount>{
    const address=evmAddressFromYNX(account);
    try{
      const value=await this.#json(`/accounts/${encodeURIComponent(account)}`,{method:"GET"});
      const record=object(value)&&object(value.account)?value.account:null;
      if(!record||typeof record.address!=="string"||!/^0x[0-9a-f]{40}$/.test(record.address)||!Number.isSafeInteger(record.balance)||record.balance<0||!Number.isSafeInteger(record.nonce)||record.nonce<0)throw new Error("Authoritative account response is invalid");
      if(record.address!==address)throw new Error("Authoritative account identity does not match the selected ynx1 account");
      return Object.freeze({address:record.address,balance:record.balance,nonce:record.nonce,source:"native-rest",materialized:true});
    }catch(error){
      if(!(error instanceof ChainHTTPError)||error.status!==404||!isAccountNotFound(error.payload))throw error;
      return this.#rpcAccount(address);
    }
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
    const response=await this.#request(`${this.#baseURL}${path}`,{...init,headers:{Accept:"application/json",...(init.headers??{})}});const text=await response.text();let value:unknown;try{value=JSON.parse(text)}catch{throw new Error(`YNX chain returned non-JSON (${response.status})`)}if(!response.ok)throw new ChainHTTPError(response.status,value);return value
  }

  async #rpcAccount(address:string):Promise<ChainAccount>{
    const chainId=await this.#rpc("eth_chainId",[],1);
    if(chainId!==YNX_EVM_CHAIN_ID)throw new Error("YNX EVM RPC chain identity does not match YNX Testnet 0x1917");
    const[balanceValue,nonceValue]=await Promise.all([this.#rpc("eth_getBalance",[address,"latest"],2),this.#rpc("eth_getTransactionCount",[address,"latest"],3)]);
    return Object.freeze({address,balance:quantity(balanceValue,"balance"),nonce:quantity(nonceValue,"nonce"),source:"evm-json-rpc",materialized:false});
  }

  async #rpc(method:"eth_chainId"|"eth_getBalance"|"eth_getTransactionCount",params:readonly unknown[],id:number):Promise<unknown>{
    const body=JSON.stringify({jsonrpc:"2.0",id,method,params});
    let lastTransportError:unknown;
    for(let attempt=0;attempt<2;attempt+=1){
      try{
        const response=await this.#request(this.#rpcURL,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body});
        const text=await response.text();let value:unknown;try{value=JSON.parse(text)}catch{throw new Error(`YNX EVM RPC returned non-JSON (${response.status})`)}
        if(!response.ok)throw new Error(`YNX EVM RPC rejected the request (${response.status})`);
        if(!object(value)||value.jsonrpc!=="2.0"||value.id!==id||"error" in value||!("result" in value))throw new Error(`YNX EVM RPC ${method} response is invalid`);
        return value.result;
      }catch(error){
        if(!isTransportError(error)||attempt===1)throw error;
        lastTransportError=error;
      }
    }
    throw lastTransportError;
  }

  async #request(url:string,init:RequestInit):Promise<Response>{
    const controller=new AbortController();
    let timeout:ReturnType<typeof setTimeout>|undefined;
    const request=Promise.resolve().then(()=>this.#fetch(url,{...init,signal:controller.signal}));
    const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new ChainNetworkError("timeout"))},this.#requestTimeoutMS)});
    try{return await Promise.race([request,deadline])}
    catch(error){
      if(error instanceof ChainNetworkError)throw error;
      // React Native's platform fetch rejects DNS/TLS failures as generic
      // Error instances (for example UnknownHostException), not TypeError.
      // This boundary only wraps the fetch invocation, so every rejection is
      // a transport failure and must expose the same user-safe code.
      throw new ChainNetworkError(controller.signal.aborted?"timeout":"transport");
    }finally{if(timeout!==undefined)clearTimeout(timeout)}
  }
}

class ChainHTTPError extends Error{readonly status:number;readonly payload:unknown;constructor(status:number,payload:unknown){super(`YNX chain rejected the request (${status}): ${errorMessage(payload)}`);this.name="ChainHTTPError";this.status=status;this.payload=payload}}

function parseActivity(value:unknown):ChainActivity{if(!object(value)||typeof value.hash!=="string"||!/^0x[0-9a-f]{64}$/.test(value.hash)||typeof value.type!=="string"||typeof value.from!=="string"||typeof value.to!=="string"||!Number.isSafeInteger(value.amount)||!Number.isSafeInteger(value.fee)||!Number.isSafeInteger(value.nonce)||value.timestamp!==undefined&&typeof value.timestamp!=="string")throw new Error("Authoritative activity entry is invalid");return Object.freeze({hash:value.hash,type:value.type,from:value.from,to:value.to,amount:value.amount,fee:value.fee,nonce:value.nonce,...(value.timestamp?{timestamp:value.timestamp}:{})})}
function base(value:string){if(typeof value!=="string")throw new Error("YNX chain API URL is invalid");const parsed=new URL(value);if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=="/"&&parsed.pathname!=="")throw new Error("YNX chain API URL must be an origin");if(parsed.protocol!=="https:"&&!(parsed.protocol==="http:"&&["127.0.0.1","localhost","10.0.2.2"].includes(parsed.hostname)))throw new Error("YNX chain API requires HTTPS except local development");return parsed.origin}
function rpcEndpoint(value:string){if(typeof value!=="string")throw new Error("YNX EVM RPC URL is invalid");const parsed=new URL(value);if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error("YNX EVM RPC URL is invalid");if(parsed.protocol!=="https:"&&!(parsed.protocol==="http:"&&["127.0.0.1","localhost","10.0.2.2"].includes(parsed.hostname)))throw new Error("YNX EVM RPC requires HTTPS except local development");return parsed.toString().replace(/\/$/,"")}
function object(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function errorMessage(value:unknown){return object(value)&&typeof value.error==="string"?value.error:"unknown error"}
function isAccountNotFound(value:unknown){if(!object(value)||typeof value.error!=="string")return false;return ["account not found","account_not_found"].includes(value.error.trim().toLowerCase())}
function quantity(value:unknown,label:string){if(typeof value!=="string"||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value))throw new Error(`YNX EVM RPC ${label} is not a canonical quantity`);const parsed=BigInt(value);if(parsed>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(`YNX EVM RPC ${label} exceeds the exact Wallet range`);return Number(parsed)}
function isTransportError(error:unknown){return error instanceof ChainNetworkError||error instanceof TypeError||error instanceof Error&&error.name==="AbortError"}
