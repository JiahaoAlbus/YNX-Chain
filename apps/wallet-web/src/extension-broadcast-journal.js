import {Transaction} from "ethers";
import {readNativeTransferCapability} from "./extension-fee-model.js";
import {verifyDurableNativeReceipt,verifyNativeDurabilityIntent} from "./extension-durability.js";
import {YNX_RPC_URL} from "./extension-rpc.js";
import {publicBridgeError} from "./extension-bridge.js";

// Keep the old key: upgrading must find every original signed transaction.
export const BROADCAST_JOURNAL_PREFIX="ynx.wallet.broadcast.v1.";
const HASH=/^0x[0-9a-f]{64}$/u,PENDING=new Set(["broadcasting","uncertain","acknowledged","unresolved"]),STATUSES=new Set([...PENDING,"confirmed","rejected","cancelled"]);
function failure(code,message,data){return Object.assign(new Error(message),{code,...(data?{data}:{})})}
function canonicalStoredValue(value){
  if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value)){
    const keys=Object.keys(value);
    if(keys.length!==value.length||!keys.every((key,index)=>key===String(index)))throw new Error("Invalid stored array");
    return "["+value.map(canonicalStoredValue).join(",")+"]";
  }
  if(typeof value!=="object"||value===null||Object.getPrototypeOf(value)!==Object.prototype)throw new Error("Invalid stored value");
  if(Reflect.ownKeys(value).length!==Object.keys(value).length)throw new Error("Invalid stored object keys");
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonicalStoredValue(value[key])).join(",")+"}";
}
function uncertain(record,cause){
  if(cause?.data?.transactionHash===record.transactionHash&&(cause.code===-32002&&cause.data.status==="transaction_durability_uncertain"||cause.code===-32004&&cause.data.status==="transaction_durability_unavailable")){const error=publicBridgeError(cause);return failure(error.code,error.message,error.data)}
  return failure(-32002,"The original signed transaction needs confirmation. Open the account vault to check or explicitly retry the same transaction.",{status:record.status==="acknowledged"?"transaction_confirmation_pending":"transaction_durability_uncertain",transactionHash:record.transactionHash})
}
function unresolved(record,reason){const next={...record,status:"unresolved",unknownHistory:true,unresolvedReason:reason};delete next.resolution;delete next.receiptStatus;delete next.blockHash;return next}
function parseRecord(record,account){
  if(record===undefined)return null;
  let tx;
  try{
    if(!record||typeof record.rawTransaction!=="string"||record.rawTransaction.length>262146)throw new Error();
    tx=Transaction.from(record.rawTransaction);
    if(![1,2].includes(record.version)||record.account!==account||record.chainId!=="0x1917"||typeof record.transactionHash!=="string"||!HASH.test(record.transactionHash)||tx.hash!==record.transactionHash||tx.from?.toLowerCase()!==account||tx.chainId!==6423n||!STATUSES.has(record.status))throw new Error();
  }catch{throw failure("BROADCAST_RECORD_INVALID","A stored transaction record cannot be verified. Sending remains disabled; preserve the browser profile for recovery.")}
  if(record.version===1)return unresolved({...record,version:2,legacyVersion:1,rpcOrigin:null,attempt:1},"legacy-evidence-unavailable");
  if(!Number.isSafeInteger(record.attempt)||record.attempt<1||typeof record.unknownHistory!=="boolean"||(record.rpcOrigin!==YNX_RPC_URL&&!(record.rpcOrigin===null&&record.legacyVersion===1)))return unresolved(record,"record-evidence-invalid");
  if(record.status==="confirmed"){
    try{
      const resolution=record.resolution;
      if(resolution?.kind!=="durable-receipt"||resolution.rpcOrigin!==YNX_RPC_URL||record.rpcOrigin===null&&resolution.manualRpcSelection!==true)throw new Error();
      verifyDurableNativeReceipt(resolution.receipt,tx,record.transactionHash,resolution.model);
    }catch{return unresolved(record,"completion-evidence-unverifiable")}
  }else if(record.status==="cancelled"||record.status==="rejected"){
    const resolution=record.resolution,kind=record.status==="cancelled"?"cancelled-before-dispatch":"first-rpc-rejection";
    if(record.legacyVersion===1||record.unknownHistory||record.attempt!==1||resolution?.kind!==kind||resolution.transactionHash!==record.transactionHash||resolution.attempt!==1||record.status==="rejected"&&(resolution.code!==-32003||resolution.rpcOrigin!==YNX_RPC_URL||resolution.rpcResponseValidated!==true))return unresolved(record,"resolution-evidence-unverifiable");
  }else if(record.status==="broadcasting")return{...record,unknownHistory:true};
  return record;
}
function requireTarget(record,expectedHash){if(expectedHash!==undefined&&record?.transactionHash!==expectedHash)throw failure("TRANSACTION_CHANGED","The original transaction changed. Read and review the current record again.")}
function requireRpc(record,selectedRpcOrigin){
  if(record.rpcOrigin===YNX_RPC_URL)return;
  if(record.rpcOrigin!==null||record.legacyVersion!==1||selectedRpcOrigin!==YNX_RPC_URL)throw failure("RECOVERY_RPC_CONFIRMATION_REQUIRED","The older record has no verified RPC origin. Explicitly select the configured YNX Testnet RPC before checking or retrying.");
}
async function currentTransferModel(rpc){
  return(await readNativeTransferCapability(rpc)).durabilityModel;
}
function publicRecord(record){
  const tx=Transaction.from(record.rawTransaction),receipt=record.status==="confirmed"?record.resolution.receipt:null;
  return Object.freeze({account:record.account,transactionHash:record.transactionHash,status:record.status,blocksNewSend:PENDING.has(record.status),receiptStatus:receipt?.status??null,durabilityConfirmed:Boolean(receipt),durabilityScope:receipt?"local-snapshot":null,consensusFinality:false,
    rpcOrigin:record.rpcOrigin,configuredRpcOrigin:YNX_RPC_URL,rpcConfirmationRequired:record.rpcOrigin!==YNX_RPC_URL,sourceOrigin:typeof record.origin==="string"?record.origin:null,legacyEvidenceUnavailable:record.legacyVersion===1,unresolvedReason:record.unresolvedReason??null,
    review:Object.freeze({from:tx.from.toLowerCase(),to:tx.to?.toLowerCase()??null,valueWei:tx.value.toString(),nonce:String(tx.nonce),gasLimit:tx.gasLimit.toString(),gasPriceWei:tx.gasPrice?.toString()??null,maximumFeeWei:tx.gasPrice===null?null:(tx.gasLimit*tx.gasPrice).toString(),chainId:"0x1917",type:tx.type,data:tx.data})});
}
export class ExtensionBroadcastJournal{
  #storage;#active=new Set();
  constructor(storage){this.#storage=storage}
  async read(account){const key=BROADCAST_JOURNAL_PREFIX+account;return parseRecord((await this.#storage.get(key))?.[key],account)}
  async #persist(record){
    const key=BROADCAST_JOURNAL_PREFIX+record.account,historyKey=BROADCAST_JOURNAL_PREFIX+"hash."+record.transactionHash;
    let expected;try{expected=canonicalStoredValue(record)}catch{throw failure("BROADCAST_RECORD_UNAVAILABLE","Signed transaction recovery storage could not be verified.")}
    await this.#storage.set({[key]:record,[historyKey]:record});
    // Browsers may reorder object keys. Compare every original field and type
    // before legacy/uncertain normalization; do not reduce this to a hash check.
    const stored=await this.#storage.get([key,historyKey]);
    let matches=false;try{matches=canonicalStoredValue(stored?.[key])===expected&&canonicalStoredValue(stored?.[historyKey])===expected}catch{}
    if(!matches)throw failure("BROADCAST_RECORD_UNAVAILABLE","Signed transaction recovery storage could not be verified.");
  }
  async #exclusive(account,action){
    if(this.#active.has(account))throw failure("TRANSACTION_IN_PROGRESS","A transaction for this account is already being reviewed, checked or submitted.");
    this.#active.add(account);try{return await action()}finally{this.#active.delete(account)}
  }
  async run(account,action){return this.#exclusive(account,async()=>{const record=await this.read(account);if(record&&PENDING.has(record.status))throw uncertain(record);return action()})}
  async #dispatch(record,broadcast,assertAuthorized,rpc){
    await this.#persist(record);
    try{await assertAuthorized();await currentTransferModel(rpc);await assertAuthorized()}catch(error){
      if(!record.unknownHistory&&record.attempt===1)await this.#persist({...record,status:"cancelled",resolution:{kind:"cancelled-before-dispatch",transactionHash:record.transactionHash,attempt:1}});
      throw error;
    }
    let phase="network";
    try{
      const hash=await broadcast(record.rawTransaction);
      phase="acknowledged";
      if(hash!==record.transactionHash)throw failure("TRANSACTION_HASH_MISMATCH","RPC acknowledged a different transaction hash.");
      await this.#persist({...record,status:"acknowledged",unknownHistory:true});return hash;
    }catch(error){
      // Only a first validated rejection can release a new intent. Once a prior
      // dispatch might exist, no later error code proves that it did not commit.
      if(phase==="network"&&!record.unknownHistory&&record.attempt===1&&error?.code===-32003&&error?.rpcResponseValidated===true){await this.#persist({...record,status:"rejected",resolution:{kind:"first-rpc-rejection",transactionHash:record.transactionHash,attempt:1,code:-32003,rpcOrigin:YNX_RPC_URL,rpcResponseValidated:true}});throw error}
      try{await this.#persist({...record,status:"uncertain",unknownHistory:true})}catch{/* The pre-dispatch record still blocks replacement. */}
      throw uncertain(record,error);
    }
  }
  async broadcast({account,origin,signed,broadcast,assertAuthorized,rpc}){
    await currentTransferModel(rpc);await assertAuthorized();
    const record=parseRecord({version:2,chainId:"0x1917",account,origin,rpcOrigin:YNX_RPC_URL,rawTransaction:signed.rawTransaction,transactionHash:signed.transactionHash,status:"broadcasting",attempt:1,unknownHistory:false,createdAt:Date.now()},account);
    verifyNativeDurabilityIntent(Transaction.from(record.rawTransaction),record.transactionHash);
    // The live first attempt knows no POST has started. A read after a restart
    // treats this same dispatch marker as unknown instead.
    return this.#dispatch({...record,unknownHistory:false},broadcast,assertAuthorized,rpc);
  }
  async retry(account,{transactionHash,selectedRpcOrigin,rpc,broadcast,authorize,assertAuthorized}){
    return this.#exclusive(account,async()=>{
      const record=await this.read(account);requireTarget(record,transactionHash);
      if(!record||!PENDING.has(record.status))throw failure("TRANSACTION_NOT_PENDING","The reviewed original transaction no longer needs a retry.");
      verifyNativeDurabilityIntent(Transaction.from(record.rawTransaction),record.transactionHash);
      requireRpc(record,selectedRpcOrigin);await currentTransferModel(rpc);
      if(!Number.isSafeInteger(record.attempt+1))throw failure("BROADCAST_RECORD_INVALID","The transaction attempt count cannot be safely advanced.");
      await authorize();await assertAuthorized();
      await this.#dispatch({...record,status:"broadcasting",unknownHistory:true,attempt:record.attempt+1},broadcast,assertAuthorized,rpc);
      return publicRecord(await this.read(account));
    });
  }
  async status(account,{rpc,refresh=false,transactionHash,selectedRpcOrigin}={}){
    const action=async()=>{
      let record=await this.read(account);requireTarget(record,transactionHash);if(!record)return null;
      if(refresh&&PENDING.has(record.status)){
        requireRpc(record,selectedRpcOrigin);const model=await currentTransferModel(rpc);
        const receipt=await rpc("eth_getTransactionReceipt",[record.transactionHash]);
        if(receipt!==null){
          const verified=verifyDurableNativeReceipt(receipt,Transaction.from(record.rawTransaction),record.transactionHash,model);
          // Actual endpoint state must still match after the receipt query.
          await currentTransferModel(rpc);
          record={...record,status:"confirmed",resolution:{kind:"durable-receipt",rpcOrigin:YNX_RPC_URL,manualRpcSelection:record.rpcOrigin===null,model,receipt:verified}};
          await this.#persist(record);
        }
      }
      return publicRecord(record);
    };
    return refresh?this.#exclusive(account,action):action();
  }
}
