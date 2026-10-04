import {uint64} from "./transaction-durability.mjs";

const HASH=/^0x[0-9a-f]{64}$/,ACCOUNT=/^0x[0-9a-f]{40}$/;
function values(value,fields){
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error("Invalid transaction display");
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==fields.length||keys.some(key=>!fields.includes(key)||!Object.hasOwn(descriptors[key],"value")))throw Error("Invalid transaction display");
  return Object.fromEntries(fields.map(key=>[key,descriptors[key].value]));
}
// Presentation of the existing TransactionSubmissions DTO only. This neither
// proves a receipt nor authorizes retry, signing, or clearing the private journal.
export function projectTransactionResolution(response,{account,hash,retry=false}){
  const ok=Object.getOwnPropertyDescriptor(response??{},"ok");
  if(!ok||!Object.hasOwn(ok,"value"))throw Error("Invalid transaction display");
  if(ok.value===false){values(response,["ok","error"]);return null;}
  const envelope=values(response,["ok","value"]);
  if(envelope.ok!==true)throw Error("Invalid transaction display");
  const value=envelope.value,confirmed=Object.getOwnPropertyDescriptor(value??{},"confirmed");
  if(!confirmed||!Object.hasOwn(confirmed,"value")||typeof confirmed.value!=="boolean")throw Error("Invalid transaction display");
  const submitted=retry&&Object.getOwnPropertyDescriptor(value,"status")?.value==="submitted";
  const fields=confirmed.value
    ?["hash","account","status","confirmed","successful","actualFee","blockNumber","confirmationScope","consensusFinality","canRetryExact"]
    :submitted?["hash","account","status","confirmed","retriedExactBytes"]
      :["hash","account","status","durabilityStatus","confirmed","consensusFinality","canRetryExact"];
  const record=values(value,fields);
  if(typeof hash!=="string"||!HASH.test(hash)||typeof account!=="string"||!ACCOUNT.test(account)||record.hash!==hash||record.account!==account)throw Error("Unbound transaction display");
  if(record.confirmed){
    if(typeof record.successful!=="boolean"||record.status!==(record.successful?"confirmed":"failed")||record.confirmationScope!=="local-snapshot"||record.consensusFinality!==false||record.canRetryExact!==false||
      typeof record.actualFee!=="string"||record.actualFee.length>128||!/^(?:0|[1-9][0-9]*)\.(?:0|[0-9]{0,17}[1-9])$/.test(record.actualFee))throw Error("Unverified transaction display");
    uint64(record.blockNumber,{positive:true});
  }else if(submitted){
    if(record.retriedExactBytes!==true)throw Error("Unverified exact retry display");
  }else if(!["durable","pending_durable","uncertain","memory_only","not_found"].includes(record.durabilityStatus)||record.status!==(record.durabilityStatus==="pending_durable"?"pending_durable":"uncertain")||record.consensusFinality!==false||typeof record.canRetryExact!=="boolean")throw Error("Unverified pending display");
  return Object.freeze(record);
}
