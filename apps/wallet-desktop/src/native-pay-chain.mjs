import {canonicalJSON,evmAddressFromYNX,nativeTransferHash,parseSignedNativeTransfer} from "@ynx-chain/wallet-auth";
import {CANONICAL_RPC_URL} from "./rpc.mjs";
import {parseDurabilityModel,parseDurabilityProof,validateNativeJSONReceipt,durabilityError} from "./transaction-durability.mjs";
const object=value=>!!value&&typeof value==="object"&&!Array.isArray(value);
export class NativePayBroadcastUnknown extends Error{
  constructor(hash){super("Original native payment outcome is unknown. Keep its original bytes; do not pay again.");this.code="NATIVE_BROADCAST_UNKNOWN";this.hash=hash}
}
/** Main-process native adapter for the original Native REST + /evm routes.
 * No renderer endpoint override, Ethereum serialization, implicit write retry,
 * public invoice authority, or admission-ACK-as-finality substitution. */
export class DesktopNativePayChain{
  #sequence=0;
  constructor({fetchImpl=globalThis.fetch}={}){this.fetchImpl=fetchImpl}
  get origin(){return CANONICAL_RPC_URL}
  async #json(path,init){
    const controller=new AbortController();let timer;
    try{return await Promise.race([(async()=>{
      const url=this.origin+path,response=await this.fetchImpl(url,{...init,redirect:"error",signal:controller.signal,headers:{Accept:"application/json",...init.headers}});
      if(response.redirected||response.url&&response.url!==url)throw durabilityError();
      const text=await response.text();if(text.length>262144||!response.ok)throw durabilityError();return JSON.parse(text);
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(durabilityError())},15000)})])}
    finally{clearTimeout(timer);controller.abort()}
  }
  async #rpc(method,params=[]){
    const id=++this.#sequence,value=await this.#json("/evm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params})});
    if(!object(value)||value.jsonrpc!=="2.0"||value.id!==id||Object.hasOwn(value,"result")===Object.hasOwn(value,"error"))throw durabilityError();
    if(Object.hasOwn(value,"error")){if(!object(value.error)||!Number.isSafeInteger(value.error.code)||typeof value.error.message!=="string")throw durabilityError();throw Object.assign(new Error("Native RPC proof unavailable"),{rpcCode:value.error.code,rpcData:value.error.data})}
    return value.result;
  }
  async requireDurabilityCapability(guard=()=>{}){
    guard();if(await this.#rpc("eth_chainId")!=="0x1917")throw durabilityError();guard();
    const model=parseDurabilityModel(await this.#rpc("ynx_getDurabilityModel"));guard();if(await this.#rpc("eth_chainId")!=="0x1917")throw durabilityError();guard();return model;
  }
  async account(account){
    const address=evmAddressFromYNX(account),value=await this.#json("/accounts/"+encodeURIComponent(account),{method:"GET"}),record=value?.account;
    if(!object(record)||record.address!==address||!Number.isSafeInteger(record.balance)||record.balance<0||!Number.isSafeInteger(record.nonce)||record.nonce<0)throw durabilityError();
    return Object.freeze({address,balance:record.balance,nonce:record.nonce});
  }
  async broadcast(payload,expected,expectedHash){
    const parsed=parseSignedNativeTransfer(payload);
    if(canonicalJSON(parsed)!==canonicalJSON(expected)||nativeTransferHash(payload)!==expectedHash||!Number.isSafeInteger(parsed.amount+parsed.fee))throw durabilityError();
    try{
      const value=await this.#json("/transactions/broadcast",{method:"POST",headers:{"Content-Type":"application/json"},body:payload}),tx=value?.transaction;
      if(!object(tx)||typeof value.replayed!=="boolean"||value.truthfulStatus!=="signature-verified-authoritative-native-transfer"||tx.hash!==expectedHash||tx.from!==expected.from||tx.to!==expected.to||tx.amount!==expected.amount||tx.fee!==expected.fee||tx.nonce!==expected.nonce)throw durabilityError();
      return Object.freeze({hash:expectedHash,replayed:value.replayed,truthfulStatus:value.truthfulStatus,durabilityConfirmed:false,durabilityEvidence:null});
    }catch{throw new NativePayBroadcastUnknown(expectedHash)}
  }
  async checkTransferDurability(expected,hash,guard=()=>{}){
    const model=await this.requireDurabilityCapability(guard);guard();const state=parseDurabilityProof(await this.#rpc("ynx_getTransactionDurability",[hash]),hash);guard();
    if(state.status!=="durable")return Object.freeze({status:state.status,evidence:null});
    let receipt;try{receipt=await this.#rpc("eth_getTransactionReceipt",[hash])}catch(error){
      guard();const data=error.rpcData;
      if(data?.transactionHash===hash&&data.durabilityVersion==="ynx-local-durability-v1"){
        const proof=parseDurabilityProof(data.ynxDurability,hash);
        if(error.rpcCode===-32002&&data.status==="transaction_durability_uncertain"&&proof.status==="uncertain"||error.rpcCode===-32004&&data.status==="transaction_durability_unavailable"&&proof.status==="memory_only")return Object.freeze({status:proof.status,evidence:null});
      }throw error;
    }guard();if(receipt===null)return Object.freeze({status:"uncertain",evidence:null});
    const evidence=Object.freeze({version:1,origin:this.origin,chainId:"0x1917",capability:model,receipt:validateNativeJSONReceipt(expected,hash,receipt,model)});
    if(evidence.receipt.blockNumber!==state.blockNumber||evidence.receipt.blockHash!==state.blockHash)throw durabilityError();
    await this.requireDurabilityCapability(guard);guard();return Object.freeze({status:"durable",evidence});
  }
}
