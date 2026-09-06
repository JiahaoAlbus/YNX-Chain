import {Transaction} from "ethers";
import {NATIVE_FEE_MODEL,readFeeModel,requireNativeTransfer} from "./extension-fee-model.js";

export const BROADCAST_JOURNAL_PREFIX="ynx.wallet.broadcast.v1.";
const HASH=/^0x[0-9a-f]{64}$/u,PENDING=new Set(["broadcasting","uncertain","acknowledged"]);
function failure(code,message,data){return Object.assign(new Error(message),{code,...(data?{data}:{})})}
function uncertain(record){return failure(-32002,"The original signed transaction needs confirmation. Open the account vault and check its hash before another send.",{status:record.status==="acknowledged"?"transaction_confirmation_pending":"transaction_durability_uncertain",transactionHash:record.transactionHash})}
function parseRecord(record,account){
  if(record===undefined)return null;
  try{
    const tx=Transaction.from(record.rawTransaction);
    if(record.version!==1||record.account!==account||record.chainId!=="0x1917"||!HASH.test(record.transactionHash)||tx.hash!==record.transactionHash||tx.from?.toLowerCase()!==account||tx.chainId!==6423n||!["broadcasting","uncertain","acknowledged","confirmed","rejected","cancelled"].includes(record.status))throw new Error();
    return record;
  }catch{throw failure("BROADCAST_RECORD_INVALID","A stored transaction record cannot be verified. Sending remains disabled; preserve the browser profile for recovery.")}
}
export class ExtensionBroadcastJournal{
  #storage;#active=new Set();
  constructor(storage){this.#storage=storage}
  async read(account){const key=BROADCAST_JOURNAL_PREFIX+account;return parseRecord((await this.#storage.get(key))?.[key],account)}
  async #persist(record){
    const key=BROADCAST_JOURNAL_PREFIX+record.account,historyKey=BROADCAST_JOURNAL_PREFIX+"hash."+record.transactionHash;
    await this.#storage.set({[key]:record,[historyKey]:record});
    const history=(await this.#storage.get(historyKey))?.[historyKey];
    if(JSON.stringify(await this.read(record.account))!==JSON.stringify(record)||JSON.stringify(history)!==JSON.stringify(record))throw failure("BROADCAST_RECORD_UNAVAILABLE","Signed transaction recovery storage could not be verified.");
  }
  async run(account,action){
    if(this.#active.has(account))throw failure("TRANSACTION_IN_PROGRESS","A transaction for this account is already being reviewed or submitted.");
    this.#active.add(account);
    try{const record=await this.read(account);if(record&&PENDING.has(record.status))throw uncertain(record);return await action()}finally{this.#active.delete(account)}
  }
  async broadcast({account,origin,signed,broadcast,assertAuthorized}){
    const record=parseRecord({version:1,chainId:"0x1917",account,origin,rawTransaction:signed.rawTransaction,transactionHash:signed.transactionHash,status:"broadcasting",createdAt:Date.now()},account);
    // Store exact bytes and read back before the first network submission. A worker
    // crash anywhere after this point blocks a replacement signature after restart.
    await this.#persist(record);
    try{await assertAuthorized()}catch(error){await this.#persist({...record,status:"cancelled"});throw error}
    try{
      const hash=await broadcast(record.rawTransaction);
      if(hash!==record.transactionHash)throw failure("TRANSACTION_HASH_MISMATCH","RPC acknowledged a different transaction hash.");
      await this.#persist({...record,status:"acknowledged"});return hash;
    }catch(error){
      // Core -32003 is a definite verification/submission rejection. Timeouts,
      // malformed ACKs, mismatching hashes and -32002 are not proof of rejection.
      if(error?.code===-32003&&error?.rpcResponseValidated===true){await this.#persist({...record,status:"rejected"});throw error}
      try{await this.#persist({...record,status:"uncertain"})}catch{/* The pre-broadcast record still blocks replacement. */}
      throw uncertain(record);
    }
  }
  async status(account,{rpc,refresh=false}={}){
    if(refresh&&this.#active.has(account))throw failure("TRANSACTION_IN_PROGRESS","Wait for the active transaction review or submission before checking its status.");
    if(refresh)this.#active.add(account);
    try{
    let record=await this.read(account);if(!record)return null;
    if(refresh&&PENDING.has(record.status)){
      requireNativeTransfer(await readFeeModel(rpc));
      const receipt=await rpc("eth_getTransactionReceipt",[record.transactionHash]);
      if(receipt!==null){
        const signed=Transaction.from(record.rawTransaction);
        if(receipt?.transactionHash?.toLowerCase()!==record.transactionHash||!HASH.test(receipt?.blockHash||"")||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(receipt?.blockNumber||"")||!["0x0","0x1"].includes(receipt?.status)
          ||receipt?.from?.toLowerCase()!==signed.from?.toLowerCase()||receipt?.to?.toLowerCase()!==signed.to?.toLowerCase()
          ||signed.type!==0||receipt.type!==NATIVE_FEE_MODEL.transactionType||receipt.contractAddress!==null
          ||receipt.gasUsed!==NATIVE_FEE_MODEL.gas||receipt.effectiveGasPrice!==NATIVE_FEE_MODEL.gasPrice||receipt.ynxFeeWei!==NATIVE_FEE_MODEL.feeWei
          ||BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)!==BigInt(receipt.ynxFeeWei)
          ||BigInt(receipt.gasUsed)>signed.gasLimit||BigInt(receipt.effectiveGasPrice)!==signed.gasPrice)throw failure("INVALID_RPC_RESPONSE","RPC receipt does not match the original sender, recipient and proven fixed native transfer fee.");
        // This records an observed mined receipt; it does not claim disk durability.
        record={...record,status:"confirmed",receiptStatus:receipt.status,blockHash:receipt.blockHash};await this.#persist(record);
      }
    }
    return Object.freeze({transactionHash:record.transactionHash,status:record.status,blocksNewSend:PENDING.has(record.status),receiptStatus:record.receiptStatus??null});
    }finally{if(refresh)this.#active.delete(account)}
  }
}
