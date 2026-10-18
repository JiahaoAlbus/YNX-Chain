import {uint64} from "./transaction-durability.mjs";

const HASH=/^0x[0-9a-f]{64}$/,ACCOUNT=/^0x[0-9a-f]{40}$/;
function values(value,fields){
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error("Invalid transaction display");
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==fields.length||keys.some(key=>!fields.includes(key)||!Object.hasOwn(descriptors[key],"value")))throw Error("Invalid transaction display");
  return Object.fromEntries(fields.map(key=>[key,descriptors[key].value]));
}
export function projectPendingTransactions(response,account){
  const ok=Object.getOwnPropertyDescriptor(response??{},"ok");
  if(!ok||!Object.hasOwn(ok,"value"))throw Error("Invalid pending display");
  if(ok.value===false){values(response,["ok","error"]);return null;}
  const envelope=values(response,["ok","value"]);
  if(envelope.ok!==true||typeof account!=="string"||!ACCOUNT.test(account))throw Error("Invalid pending display");
  const rows=envelope.value;
  if(!Array.isArray(rows)||Object.getPrototypeOf(rows)!==Array.prototype)throw Error("Invalid pending rows");
  const descriptors=Object.getOwnPropertyDescriptors(rows),length=descriptors.length?.value;
  // The original validated journal permits at most one unresolved intent per
  // account. Its list(account) is not a paginated or arbitrary iterable feed.
  if(!Number.isSafeInteger(length)||length<0||length>1||Reflect.ownKeys(descriptors).length!==length+1)throw Error("Invalid pending rows");
  const records=[];
  for(let index=0;index<length;index++){
    if(!descriptors[index]||!Object.hasOwn(descriptors[index],"value"))throw Error("Invalid pending row");
    const source=descriptors[index].value,local=Object.getOwnPropertyDescriptor(source??{},"localRetention"),unknown=Object.getOwnPropertyDescriptor(source??{},"signingUnknown");
    if(Object.getOwnPropertyDescriptor(source??{},'kind')){
      const progress=Object.hasOwn(source,'resultStorageConfirmed')||Object.hasOwn(source,'resultHeldInMemory');
      const row=values(source,['hash','account','status','canRetryExact','kind','operationId',...(progress?['resultStorageConfirmed','resultHeldInMemory']:[])]);
      if(row.account!==account||typeof row.hash!=='string'||!HASH.test(row.hash)||!['pq-transfer','pq-migration','pq-revocation','pq-typed-action'].includes(row.kind)||!['pq-signed-unsubmitted','pq-save-unconfirmed','pq-submission-unknown','pq-inclusion-observed','pq-rejection-observed'].includes(row.status)||row.canRetryExact!==false||typeof row.operationId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(row.operationId))throw Error('Invalid PQ pending display');
      if(progress&&(typeof row.resultStorageConfirmed!=='boolean'||typeof row.resultHeldInMemory!=='boolean'))throw Error('Invalid PQ progress storage display');
      records.push(Object.freeze(row));continue;
    }
    if(unknown){const row=values(source,["hash","account","status","canRetryExact","to","amount","signingUnknown"]);if(row.account!==account||row.hash!==null||row.to!==null||row.amount!==null||row.status!=="signing_unknown"||row.canRetryExact!==false||row.signingUnknown!==true)throw Error("Invalid unknown signing display");records.push(Object.freeze(row));continue}
    const record=values(source,["hash","account","status","canRetryExact","to","amount",...(local?["localRetention"]:[])]);
    if(local){
      const flags=Object.hasOwn(record.localRetention,'originalCausePresent')||Object.hasOwn(record.localRetention,'storageCausePresent');
      const retention=values(record.localRetention,["scope","durable","originalCause","storageCause",...(flags?['originalCausePresent','storageCausePresent']:[])]);
      if(flags&&(typeof retention.originalCausePresent!=='boolean'||typeof retention.storageCausePresent!=='boolean'||retention.originalCause!==null&&!retention.originalCausePresent||retention.storageCause!==null&&!retention.storageCausePresent))throw Error('Invalid local cause presence');
      if(retention.scope!=="operation-memory"||retention.durable!==false||record.status!=="signed_unpersisted"||record.canRetryExact!==false)throw Error("Invalid local original");
      for(const cause of [retention.originalCause,retention.storageCause])if(cause!==null){const c=values(cause,["name","code","message"]);if(typeof c.name!=="string"||c.name.length>128||typeof c.message!=="string"||c.message.length>2048||c.code!==null&&(typeof c.code!=="string"||c.code.length>128))throw Error("Invalid local cause")}
      record.localRetention=Object.freeze(retention);
    }
    if(record.account!==account||typeof record.hash!=="string"||!HASH.test(record.hash)||typeof record.to!=="string"||!ACCOUNT.test(record.to)||record.to===account||typeof record.canRetryExact!=="boolean"||
      !["broadcasting","submitted","uncertain","confirmed","failed",...(local?["signed_unpersisted"]:[])].includes(record.status)||typeof record.amount!=="string"||!/^[1-9][0-9]{0,18}\.0$/.test(record.amount)||BigInt(record.amount.slice(0,-2))>9223372036854775807n)throw Error("Unbound pending row");
    records.push(Object.freeze(record));
  }
  return Object.freeze(records);
}
// Presentation of the existing TransactionSubmissions DTO only. This neither
// proves a receipt nor authorizes retry, signing, or clearing the private journal.
export function projectPQOriginalObservation(response,{account,hash,kind}){
  const ok=Object.getOwnPropertyDescriptor(response??{},'ok');if(!ok||!Object.hasOwn(ok,'value'))throw Error('Invalid PQ observation');
  if(ok.value===false){values(response,['ok','error']);return null;}
  const envelope=values(response,['ok','value']),value=envelope.value;
  if(kind==='pq-typed-action'){
    const row=values(value,['account','kind','operationId','hash','memberHash','networkId','actionKind','nonce','reviewExecutionHeight','executionHeight','status','outcome','signatureVerified','classicWitnessValidationRequired','networkQueryPerformed','dataOnly','nativeAdmission','permissionGranted','submitted','canRetryExact','canRetry','clearsOriginal','consensusFinality']);
    const decimal=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
    const networkObservation=['typed-commit-observed','typed-rejection-observed','typed-outcome-unknown'].includes(row.outcome);
    if(envelope.ok!==true||row.account!==account||row.hash!==hash||row.kind!==kind||(!networkObservation&&row.outcome!=='original-verified-locally')||row.networkQueryPerformed!==networkObservation||row.status!=='pq-signed-unsubmitted'||row.signatureVerified!==true||row.dataOnly!==true||typeof row.classicWitnessValidationRequired!=='boolean'||!HASH.test(row.memberHash??'')||!/^[0-9a-f]{64}$/.test(row.networkId??'')||!/^[A-Za-z0-9_-]{1,128}$/.test(row.operationId??'')||!/^[a-z_]{1,64}$/.test(row.actionKind??'')||![row.nonce,row.reviewExecutionHeight,row.executionHeight].every(decimal)||['nativeAdmission','permissionGranted','submitted','canRetryExact','canRetry','clearsOriginal','consensusFinality'].some(k=>row[k]!==false))throw Error('Unbound local typed original');
    return Object.freeze({outcome:row.outcome});
  }
  const row=values(value,['account','hash','kind','outcome','retryAuthorized','clearsOriginal','consensusFinality',...(Object.hasOwn(value??{},'decimalFields')?['decimalFields']:[]),...(Object.hasOwn(value??{},'durability')?['durability']:[])]);
  if(envelope.ok!==true||row.account!==account||row.hash!==hash||row.kind!==kind||!['pending-local-durable','local-inclusion-durable','not-found-observed','outcome-unknown'].includes(row.outcome)||row.retryAuthorized!==false||row.clearsOriginal!==false||row.consensusFinality!==false)throw Error('Unbound PQ observation');
  return Object.freeze({outcome:row.outcome});
}
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
