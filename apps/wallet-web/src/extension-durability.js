// Core 0468d65c: one node's completed local snapshot checkpoint. This is not
// consensus finality, a server signature, or a remote replication attestation.
export const DURABILITY_MODEL=Object.freeze({version:"ynx-local-durability-v1",scope:"local-snapshot",receiptField:"ynxDurability",transactionStatusMethod:"ynx_getTransactionDurability",nativeTransactionField:"ynxNativeTransaction",minedStatus:"durable",pendingStatus:"pending_durable",consensusFinality:false});
const HASH=/^0x[0-9a-f]{64}$/u,ADDRESS=/^0x[0-9a-fA-F]{40}$/u,UINT64=(1n<<64n)-1n,INT64_MIN=-(1n<<63n),INT64_MAX=(1n<<63n)-1n,UNIT=10n**18n;
const COMMON=["version","scope","status","transactionHash"],BLOCK=["blockNumber","blockHash"],CHECKPOINT=["checkpointBlockNumber","checkpointBlockHash","snapshotIntegrity"];
function isHash(value){return typeof value==="string"&&HASH.test(value)}
function fail(message){throw Object.assign(new Error(message),{code:"DURABILITY_UNCONFIRMED"})}
function exact(value,keys){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail("Durability evidence has unknown or missing fields.");return value}
export function durabilityQuantity(value,{positive=false}={}){if(typeof value!=="string"||!/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/u.test(value))fail("Durability height or nonce is not a canonical uint64 quantity.");const parsed=BigInt(value);if(parsed>UINT64||positive&&parsed===0n)fail("Durability height or nonce is outside uint64 policy.");return parsed}
export function durabilityInt64(value){if(typeof value!=="string"||value.length>20||!/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u.test(value))fail("Native amount or fee is not a canonical int64 decimal string.");const parsed=BigInt(value);if(parsed<INT64_MIN||parsed>INT64_MAX)fail("Native amount or fee exceeds int64.");return parsed}
export function parseDurabilityModel(value){exact(value,Object.keys(DURABILITY_MODEL));if(Object.entries(DURABILITY_MODEL).some(([key,expected])=>value[key]!==expected))fail("RPC has not proven the reviewed local durability model.");return DURABILITY_MODEL}
export async function readDurabilityModel(rpc){let model;try{model=await rpc("ynx_getDurabilityModel",[])}catch{fail("RPC local durability support is unavailable. The original transaction remains unresolved.")}return parseDurabilityModel(model)}
export function parseTransactionDurability(value,expectedHash){
  if(!isHash(expectedHash)||!value||value.transactionHash!==expectedHash||value.version!==DURABILITY_MODEL.version||value.scope!==DURABILITY_MODEL.scope)fail("Durability proof does not match the exact original transaction.");
  const hasBlock=Object.hasOwn(value,"blockNumber")||Object.hasOwn(value,"blockHash");
  if(value.status==="durable")exact(value,[...COMMON,...BLOCK,...CHECKPOINT]);
  else if(value.status==="pending_durable")exact(value,[...COMMON,...CHECKPOINT]);
  else if(value.status==="uncertain"||value.status==="memory_only")exact(value,[...COMMON,...(hasBlock?BLOCK:[])]);
  else if(value.status==="not_found")exact(value,COMMON);
  else fail("Unknown local durability status.");
  if(hasBlock){durabilityQuantity(value.blockNumber,{positive:true});if(!isHash(value.blockHash))fail("Durability mined block hash is invalid.")}
  if(value.status==="durable"||value.status==="pending_durable"){
    const checkpoint=durabilityQuantity(value.checkpointBlockNumber);
    if(!isHash(value.checkpointBlockHash)||!isHash(value.snapshotIntegrity))fail("Durability checkpoint identity is invalid.");
    if(value.status==="durable"){
      const mined=durabilityQuantity(value.blockNumber,{positive:true});
      if(checkpoint<mined||(checkpoint===mined)!==(value.checkpointBlockHash===value.blockHash))fail("Durability checkpoint does not cover the exact mined block.");
    }
  }
  return Object.freeze({...value});
}
export function verifyNativeDurabilityIntent(signed,expectedHash){
  if(typeof expectedHash!=="string"||!isHash(expectedHash)||signed.hash!==expectedHash||signed.chainId!==6423n||signed.type!==0||signed.data!=="0x"||!signed.to||!Number.isSafeInteger(signed.nonce)||signed.nonce<0||signed.value<=0n||signed.value%UNIT!==0n||signed.value/UNIT>INT64_MAX||signed.gasPrice!==40000000000000n||signed.gasLimit<25000n)fail("Durable receipt must bind the original signed whole-YNXT transfer.");
}
export function verifyDurableNativeReceipt(receipt,signed,expectedHash,model){
  parseDurabilityModel(model);verifyNativeDurabilityIntent(signed,expectedHash);
  if(!receipt||typeof receipt!=="object"||Array.isArray(receipt)||receipt.transactionHash!==expectedHash)fail("Receipt hash differs from the original transaction.");
  const proof=parseTransactionDurability(receipt.ynxDurability,expectedHash);
  if(proof.status!=="durable")fail("The transaction has no durable mined checkpoint yet.");
  const native=exact(receipt.ynxNativeTransaction,["type","amountYNXT","feeYNXT","nonce"]);
  const amount=durabilityInt64(native.amountYNXT),fee=durabilityInt64(native.feeYNXT),nonce=durabilityQuantity(native.nonce);
  if(native.type!=="transfer"||amount<=0n||amount!==signed.value/UNIT||fee!==1n||nonce!==BigInt(signed.nonce)+1n)fail("Native amount, fee or nonce does not match the signed Ethereum intent.");
  if(typeof receipt.from!=="string"||typeof receipt.to!=="string"||!ADDRESS.test(receipt.from)||!ADDRESS.test(receipt.to)||receipt.from.toLowerCase()!==signed.from?.toLowerCase()||receipt.to.toLowerCase()!==signed.to.toLowerCase()||receipt.blockNumber!==proof.blockNumber||receipt.blockHash!==proof.blockHash||receipt.status!=="0x1"||receipt.type!=="0x0"||receipt.contractAddress!==null||receipt.gasUsed!=="0x61a8"||receipt.effectiveGasPrice!=="0x246139ca8000"||receipt.ynxFeeWei!=="0xde0b6b3a7640000"||BigInt(receipt.gasUsed)>signed.gasLimit||signed.gasPrice!==40000000000000n||BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)!==UNIT)fail("Receipt identity, mined block or fixed fee differs from the signed transfer.");
  // Persist only the reviewed standard fields and exact bounded inner objects;
  // unrelated outer receipt metadata/logs do not become recovery authority.
  return Object.freeze({transactionHash:expectedHash,from:receipt.from.toLowerCase(),to:receipt.to.toLowerCase(),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status:receipt.status,type:receipt.type,contractAddress:null,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,ynxFeeWei:receipt.ynxFeeWei,ynxDurability:proof,ynxNativeTransaction:Object.freeze({...native})});
}
