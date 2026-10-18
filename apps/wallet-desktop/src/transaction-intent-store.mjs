import * as filesystem from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrivateFilePolicy } from "./platform-private-file.mjs";
import {readBoundedPrivateFile,PRIVATE_FILE_MAX_BYTES} from "./bounded-private-file-read.mjs";
import { Transaction, toQuantity } from "ethers";
import { parseFeeModel, capabilityFingerprint, capabilityError, assertCompatibleIntentCapabilities } from "./rpc-capabilities.mjs";
import { validateDurableReceipt, uint64, UINT64_MAX } from "./transaction-durability.mjs";
import { CANONICAL_RPC_URL, LEGACY_RPC_URL } from "./rpc.mjs";
import {canonicalJSON,evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {assertDesktopSignedPayStorage,parseDesktopSignedPayRecord} from "./wallet-pay-record.mjs";
import {assertDesktopPayProgress,assertDesktopPayEvidence,parseDesktopPaySettlement} from "./wallet-pay-settlement.mjs";
import {parsePQOriginalRecord,PQ_ORIGINAL_RESERVE_BYTES,PQ_ORIGINAL_KINDS} from './wallet-pq-intent-record.mjs';
import {parseSessionOriginal,SESSION_ORIGINAL_RESERVE_BYTES,sessionOriginalCause} from './wallet-session-original.mjs';

const HASH = /^0x[0-9a-f]{64}$/, ACCOUNT = /^0x[0-9a-f]{40}$/;
const quantity = value => typeof value === "string" && value.length <= 128 && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value);
const invalid = () => capabilityError("TRANSACTION_JOURNAL_INVALID", "The local transaction journal cannot be verified. New transactions are blocked; preserve the journal and check any known transaction hashes.");
export const ORIGINAL_OWNER_LIMIT=8;
const owners=new WeakMap();
const owner=store=>{let slots=owners.get(store);if(!slots){slots=new Map();owners.set(store,slots)}return slots};
const sessionSlots=new WeakMap();
const sessions=store=>{let slots=sessionSlots.get(store);if(!slots){slots=new Map();sessionSlots.set(store,slots);}return slots;};
const freezePublic=value=>{if(value&&typeof value==="object"){for(const child of Object.values(value))freezePublic(child);Object.freeze(value)}return value};
export function publicOriginalCause(error){return error?Object.freeze({name:String(error.name??"Error").slice(0,128),code:typeof error.code==="string"?error.code.slice(0,128):null,message:String(error.message??"Operation failed").slice(0,2048)}):null}
export function originalRetention(slot){return Object.freeze({scope:"operation-memory",durable:false,originalCausePresent:slot.originalCausePresent===true||slot.originalCause!=null,storageCausePresent:slot.storageCausePresent===true||slot.storageCause!=null,originalCause:publicOriginalCause(slot.originalCause),storageCause:publicOriginalCause(slot.storageCause)})}
function validateIntent(record, legacy = false) {
  const keys = legacy ? "account,attempts,capabilities,chainId,hash,nonce,to,value" : "account,attempts,capabilities,chainId,hash,nonce,origin,raw,to,value";
  if (!record || Object.keys(record).sort().join() !== keys || typeof record.account !== "string" || !ACCOUNT.test(record.account) || typeof record.to !== "string" || !ACCOUNT.test(record.to) || record.to === record.account || typeof record.hash !== "string" || !HASH.test(record.hash) || record.chainId !== "0x1917" || !quantity(record.nonce) || !quantity(record.value) || BigInt(record.value) <= 0n || !Number.isSafeInteger(record.attempts) || record.attempts < 1) throw invalid();
  const model = parseFeeModel(record.capabilities), value = BigInt(record.value), quantum = BigInt(model.amountQuantumWei);
  if (!model.enabled || value % quantum !== 0n || value / quantum > 9223372036854775807n || uint64(record.nonce) === UINT64_MAX || capabilityFingerprint(model) !== capabilityFingerprint(record.capabilities)) throw invalid();
  if (!legacy) {
    if (![CANONICAL_RPC_URL,LEGACY_RPC_URL].includes(record.origin) || record.raw !== null && (typeof record.raw !== "string" || record.raw.length > 32_768 || !/^0x(?:[0-9a-f]{2})+$/.test(record.raw))) throw invalid();
    if (record.raw !== null) validateRawIntent(record);
  }
}
export function validateRawIntent(record) {
  try {
    const tx = Transaction.from(record.raw);
    if (!tx.isSigned() || tx.hash !== record.hash || tx.from?.toLowerCase() !== record.account || tx.to?.toLowerCase() !== record.to || tx.chainId !== 6423n || tx.type !== 0 || tx.data !== "0x" || tx.accessList !== null || toQuantity(tx.nonce) !== record.nonce || toQuantity(tx.value) !== record.value || toQuantity(tx.gasPrice) !== record.capabilities.gasPrice || tx.gasLimit < BigInt(record.capabilities.gas) || tx.gasLimit > BigInt(record.capabilities.maxGasLimit)) throw invalid();
    return tx;
  } catch { throw invalid(); }
}
function validateRejection(proof, origin) {
  if (!proof || ![CANONICAL_RPC_URL,LEGACY_RPC_URL].includes(origin) || proof.rpcCode !== -32003 || proof.rpcResponse !== true || proof.rpcHttpSuccess !== true || proof.rpcDefiniteRejection !== true || proof.rpcMethod !== "eth_sendRawTransaction" || proof.rpcOrigin !== origin || !Number.isSafeInteger(proof.rpcRequestId) || proof.outcomeUnknown === true || proof.code !== "RPC_TRANSACTION_REJECTED") throw invalid();
}
export function assertIntentReceipt(intent, receipt, capabilities = intent.capabilities) {
  try { assertCompatibleIntentCapabilities(intent.capabilities, capabilities); return validateDurableReceipt(intent, receipt, capabilities); }
  catch { throw invalid(); }
}
function parseState(data) {
  if (!data || ![1, 2, 3, 4, 5, 6, 7].includes(data.schemaVersion)) throw invalid();
  const legacy = data.schemaVersion === 1;
  const signed = data.schemaVersion >= 3;
  if (Object.keys(data).sort().join() !== (legacy ? "records,rejections,schemaVersion" : data.schemaVersion===7 ? "payHistory,payProgress,pqOriginals,preparations,records,rejections,resolutions,schemaVersion,sessionOriginals,signedPayments" : data.schemaVersion===6 ? "payHistory,payProgress,pqOriginals,preparations,records,rejections,resolutions,schemaVersion,signedPayments" : data.schemaVersion===5 ? "payHistory,payProgress,preparations,records,rejections,resolutions,schemaVersion,signedPayments" : data.schemaVersion===4 ? "payHistory,payProgress,records,rejections,resolutions,schemaVersion,signedPayments" : signed ? "records,rejections,resolutions,schemaVersion,signedPayments" : "records,rejections,resolutions,schemaVersion") || !Array.isArray(data.records) || !Array.isArray(data.rejections) || data.records.length > 1024 || data.rejections.length > 1024 || !legacy && (!Array.isArray(data.resolutions) || data.resolutions.length > 1024)) throw invalid();
  if(data.schemaVersion>=5){
    if(!Array.isArray(data.preparations)||data.preparations.length>ORIGINAL_OWNER_LIMIT||new Set(data.preparations.map(x=>x.account)).size!==data.preparations.length)throw invalid();
    for(const marker of data.preparations)if(!marker||Object.keys(marker).sort().join()!=="account,kind"||!ACCOUNT.test(marker.account??"")||!['native','pay',...(data.schemaVersion>=6?PQ_ORIGINAL_KINDS:[])].includes(marker.kind))throw invalid();
  }
  if(signed){
    if(!Array.isArray(data.signedPayments)||data.signedPayments.length>1024)throw invalid();
    try{data.signedPayments.forEach(assertDesktopSignedPayStorage)}catch{throw invalid()}
    if(new Set(data.signedPayments.map(record=>record.account)).size!==data.signedPayments.length||new Set(data.signedPayments.map(record=>record.transfer.hash)).size!==data.signedPayments.length||data.signedPayments.some(record=>data.records.some(entry=>entry.account===evmAddressFromYNX(record.account))))throw invalid();
  }
  if(data.schemaVersion>=4){
    if(!Array.isArray(data.payProgress)||!Array.isArray(data.payHistory)||data.payProgress.length!==data.signedPayments.length||data.payHistory.length>1024)throw invalid();
    try{[...data.payProgress,...data.payHistory].forEach(assertDesktopPayProgress)}catch{throw invalid()}
    if(new Set(data.payProgress.map(entry=>entry.record.transfer.hash)).size!==data.payProgress.length||
      data.payProgress.some(entry=>!data.signedPayments.some(record=>canonicalJSON(record)===canonicalJSON(entry.record)))||
      data.payHistory.some(entry=>!entry.evidence||!entry.settlement)||
      new Set([...data.payProgress,...data.payHistory].map(entry=>entry.record.transfer.hash)).size!==data.payProgress.length+data.payHistory.length||
      new Set([...data.payProgress,...data.payHistory].map(entry=>canonicalJSON([entry.record.account,entry.record.invoice.id]))).size!==data.payProgress.length+data.payHistory.length)throw invalid();
  }
  data.records.forEach(record => validateIntent(record, legacy));
  if(data.schemaVersion>=6){
    if(!Array.isArray(data.pqOriginals)||data.pqOriginals.length>ORIGINAL_OWNER_LIMIT)throw invalid();
    try{data.pqOriginals.forEach(parsePQOriginalRecord);}catch{throw invalid();}
    if(new Set(data.pqOriginals.map(r=>r.account)).size!==data.pqOriginals.length||new Set(data.pqOriginals.map(r=>r.hash)).size!==data.pqOriginals.length||data.pqOriginals.some(r=>data.records.some(x=>x.account===r.account)||data.signedPayments.some(x=>evmAddressFromYNX(x.account)===r.account)||data.preparations.some(x=>x.account===r.account)))throw invalid();
  }
  if(data.schemaVersion===7){
    if(!Array.isArray(data.sessionOriginals)||data.sessionOriginals.length>ORIGINAL_OWNER_LIMIT)throw invalid();
    try{data.sessionOriginals.forEach(parseSessionOriginal);}catch{throw invalid();}
    if(new Set(data.sessionOriginals.map(row=>row.account+':'+row.requestDigest)).size!==data.sessionOriginals.length)throw invalid();
  }
  for (const entry of data.rejections) { if (!entry || Object.keys(entry).sort().join() !== "intent,proof") throw invalid(); validateIntent(entry.intent, legacy); validateRejection(entry.proof, legacy ? entry.proof?.rpcOrigin : entry.intent.origin); if (entry.intent.attempts !== 1) throw invalid(); }
  if (new Set(data.records.map(record => record.hash)).size !== data.records.length || new Set(data.records.map(record => record.account)).size !== data.records.length) throw invalid();
  if (legacy) {
    // V1 has no signed bytes or durable receipt evidence. Keep pending records as
    // unresolved, and never synthesize a signature or a terminal confirmation.
    const upgrade = (record, origin = CANONICAL_RPC_URL) => ({ ...record, origin, raw: null });
    return { schemaVersion: 2, records: data.records.map(record => upgrade(record)), rejections: data.rejections.map(entry => ({ intent: upgrade(entry.intent, entry.proof.rpcOrigin), proof: entry.proof })), resolutions: [] };
  }
  for (const entry of data.resolutions) {
    if (!entry || Object.keys(entry).sort().join() !== "capabilities,intent,receipt") throw invalid();
    validateIntent(entry.intent); const model = parseFeeModel(entry.capabilities);
    if (capabilityFingerprint(model) !== capabilityFingerprint(entry.capabilities)) throw invalid();
    assertIntentReceipt(entry.intent, entry.receipt, model);
  }
  if (new Set(data.resolutions.map(entry => entry.intent.hash)).size !== data.resolutions.length || data.records.some(record => data.resolutions.some(entry => entry.intent.hash === record.hash))) throw invalid();
  return data;
}
const empty = () => ({ schemaVersion: 2, records: [], rejections: [], resolutions: [] });
const payEntry=(record,broadcastAttempted=true)=>({version:1,record,broadcastAttempted,evidence:null,settlementAttempted:false,settlement:null,consensusFinality:false});
// Earlier schemas cannot prove that an outward effect did NOT start. Migration
// conservatively fences a second POST, and never happens on a read alone.
const paySuccessor=state=>state.schemaVersion>=4?state:{...state,schemaVersion:4,signedPayments:state.signedPayments??[],payProgress:(state.signedPayments??[]).map(record=>payEntry(record)),payHistory:[]};

export class FileTransactionIntentStore {
  #mutations = Promise.resolve();
  constructor({ filePath, io = filesystem, filePolicy = new PrivateFilePolicy({ io }) }) { if (!path.isAbsolute(filePath ?? "")) throw new Error("Transaction journal requires an absolute path"); this.filePath = filePath; this.io = io; this.filePolicy = filePolicy; }
  async sessionOriginalStatus(account,digest){
    if(!ACCOUNT.test(account??'')||typeof digest!=='string')throw invalid();
    const slot=sessions(this).get(account+':'+digest);let actual;
    try{actual=(await this.#read()).sessionOriginals?.find(row=>row.account===account&&row.requestDigest===digest);}
    catch{return Object.freeze({status:'storage-unknown',signed:slot?.captured===true,storageConfirmed:false,cleanupComplete:false,deliveryAttempted:null,requestId:slot?.record.requestId??null});}
    if(!actual&&!slot)return null;
    return Object.freeze({status:actual?.approval?'signed-retained':slot?.captured?'signed-save-unknown':'signing-unknown',signed:Boolean(actual?.approval||slot?.captured),storageConfirmed:Boolean(actual?.approval&&(!slot?.record.approval||canonicalJSON(slot.record.approval)===canonicalJSON(actual.approval))),cleanupComplete:actual?.cleanupComplete===true,deliveryAttempted:actual?.deliveryAttempted??false,requestId:actual?.requestId??slot.record.requestId});
  }
  async readSessionOriginal(account,digest,guard){
    if(!ACCOUNT.test(account??'')||typeof digest!=='string'||typeof guard!=='function')throw invalid();guard();
    const state=await this.#read();guard();const actual=state.sessionOriginals?.find(row=>row.account===account&&row.requestDigest===digest),slot=sessions(this).get(account+':'+digest);
    if(slot?.record.approval&&(!actual?.approval||canonicalJSON(slot.record.approval)!==canonicalJSON(actual.approval)))throw capabilityError('SESSION_ORIGINAL_SAVE_UNKNOWN','The signed original remains in custody; readback did not prove its durable save. Do not sign again.');
    if(slot&&!actual)throw capabilityError('SESSION_ORIGINAL_SAVE_UNKNOWN','The original reservation is unresolved. Do not sign again.');
    return actual?parseSessionOriginal(actual):null;
  }
  async reserveSessionOriginal(input,guard){
    const record=parseSessionOriginal(input),key=record.account+':'+record.requestDigest;
    if(record.approval!==null||record.deliveryAttempted||record.cleanupComplete||record.firstCause!==null||record.storageCause!==null||record.cleanupCause!==null||typeof guard!=='function'||sessions(this).has(key)||sessions(this).size>=ORIGINAL_OWNER_LIMIT)throw invalid();
    const token=Object.freeze(Object.create(null)),slot={token,record,captured:false,saveAttempted:false,firstRawPresent:false,cleanupRawPresent:false};sessions(this).set(key,slot);
    await this.#mutate(async()=>{
      guard();const state=paySuccessor(await this.#read());guard();
      if(state.sessionOriginals?.some(row=>row.account===record.account&&row.requestDigest===record.requestDigest)||(state.sessionOriginals?.length??0)>=ORIGINAL_OWNER_LIMIT||Buffer.byteLength(canonicalJSON(state))+SESSION_ORIGINAL_RESERVE_BYTES*(1+(state.sessionOriginals??[]).filter(row=>!row.approval).length)>PRIVATE_FILE_MAX_BYTES)throw invalid();
      const next={...state,schemaVersion:7,pqOriginals:state.pqOriginals??[],preparations:state.preparations??[],sessionOriginals:[...(state.sessionOriginals??[]),record]};
      guard();await this.#write(next);guard();
    });return token;
  }
  async beginSessionDelivery(account,digest,guard){
    if(!ACCOUNT.test(account??'')||typeof digest!=='string'||typeof guard!=='function')throw invalid();
    return this.#mutate(async()=>{
      guard();const state=await this.#read();guard();const prior=state.sessionOriginals?.find(row=>row.account===account&&row.requestDigest===digest);
      if(!prior?.approval||!prior.cleanupComplete||prior.cleanupCause)throw capabilityError('SESSION_ORIGINAL_REQUIRED','The original signed approval and completed cleanup are required.');
      if(prior.deliveryAttempted)throw capabilityError('SESSION_CALLBACK_DELIVERY_UNKNOWN','The original callback may have been delivered. Preserve its original outcome.');
      const next=parseSessionOriginal({...prior,deliveryAttempted:true});guard();
      await this.#write({...state,sessionOriginals:state.sessionOriginals.map(row=>row===prior?next:row)});guard();
    });
  }
  #sessionSlot(token){const slot=[...sessions(this).values()].find(row=>row.token===token);if(!slot)throw invalid();return slot;}
  captureSessionOriginal(token,approval){
    const slot=this.#sessionSlot(token);if(slot.captured)throw capabilityError('SESSION_ORIGINAL_ALREADY_CAPTURED','The original signature is retained. Do not sign again.');
    // Synchronous capture BEFORE verification, callback encoding, lock fences,
    // or foreign Vault cleanup can throw and hide the returned signature.
    slot.rawApproval=approval;slot.captured=true;
    slot.record=parseSessionOriginal({...slot.record,approval});
  }
  saveSessionOriginal(token){
    const slot=this.#sessionSlot(token);if(!slot.captured||slot.saveAttempted)throw capabilityError('SESSION_ORIGINAL_READBACK_REQUIRED','Recover this original by readback only; do not repeat saving or signing.');
    slot.saveAttempted=true;
    // Storage-only continuation selected by the pre-sign reservation. It may
    // finish after auto-lock, but cannot acquire keys, sign or send anything.
    return this.#mutate(async()=>{
      try{const state=await this.#read(),prior=state.sessionOriginals?.find(row=>row.account===slot.record.account&&row.requestDigest===slot.record.requestDigest);
        if(!prior||prior.approval!==null||prior.requestId!==slot.record.requestId)throw invalid();
        await this.#write({...state,sessionOriginals:state.sessionOriginals.map(row=>row===prior?slot.record:row)});
      }catch(error){if(slot.record.storageCause===null)slot.record=parseSessionOriginal({...slot.record,storageCause:sessionOriginalCause(error)});throw error;}
    });
  }
  async recordSessionFailure(token,{firstPresent=false,first,cleanupPresent=false,cleanup,cleanupComplete=false}={}){
    const slot=this.#sessionSlot(token);
    if(firstPresent&&!slot.firstRawPresent){slot.firstRawPresent=true;slot.firstRaw=first;slot.record=parseSessionOriginal({...slot.record,firstCause:slot.record.firstCause??sessionOriginalCause(first)});}
    if(cleanupPresent&&!slot.cleanupRawPresent){slot.cleanupRawPresent=true;slot.cleanupRaw=cleanup;slot.record=parseSessionOriginal({...slot.record,cleanupCause:slot.record.cleanupCause??sessionOriginalCause(cleanup)});}
    return this.#mutate(async()=>{
      const state=await this.#read(),prior=state.sessionOriginals?.find(row=>row.account===slot.record.account&&row.requestDigest===slot.record.requestDigest);
      if(!prior||canonicalJSON(prior.approval)!==canonicalJSON(slot.record.approval))throw capabilityError('SESSION_ORIGINAL_SAVE_UNKNOWN','Preserve the original; failure metadata could not be reconciled.');
      const next=parseSessionOriginal({...prior,cleanupComplete:prior.cleanupComplete||cleanupComplete,firstCause:prior.firstCause??slot.record.firstCause,storageCause:prior.storageCause??slot.record.storageCause,cleanupCause:prior.cleanupCause??slot.record.cleanupCause});
      await this.#write({...state,sessionOriginals:state.sessionOriginals.map(row=>row===prior?next:row)});
    });
  }
  localOriginal(account){return owner(this).get(account)??null}
  async unresolvedPreparation(account){return (await this.#read()).preparations?.find(x=>x.account===account)??null}
  async assertNoPreparation(account){
    const state=await this.#read();if(owner(this).has(account)||state.preparations?.some(x=>x.account===account)||state.pqOriginals?.some(x=>x.account===account))throw capabilityError("TRANSACTION_SIGNING_RESULT_UNKNOWN","An original signing operation remains unresolved. Do not sign or send a replacement.");
  }
  async reserveOriginal(account,kind){
    if(!ACCOUNT.test(account??"")||!["native","pay",...PQ_ORIGINAL_KINDS].includes(kind))throw invalid();
    const slots=owner(this);if(slots.has(account)||slots.size>=ORIGINAL_OWNER_LIMIT)throw capabilityError("TRANSACTION_SIGNING_RESULT_UNKNOWN","Original operation capacity or account conflict; nothing new was signed.");
    const slot={account,kind,native:null,pay:null,pq:null,originalCause:null,storageCause:null,originalCausePresent:false,storageCausePresent:false};slots.set(account,slot);
    try{await this.#mutate(async()=>{
      const state=paySuccessor(await this.#read());
      if(state.preparations?.some(x=>x.account===account)||state.pqOriginals?.some(x=>x.account===account)||state.records.some(x=>x.account===account)||state.signedPayments.some(x=>evmAddressFromYNX(x.account)===account)||(state.preparations?.length??0)>=ORIGINAL_OWNER_LIMIT)throw invalid();
      const pq=PQ_ORIGINAL_KINDS.includes(kind);
      if(pq&&Buffer.byteLength(JSON.stringify(state))+PQ_ORIGINAL_RESERVE_BYTES*(1+(state.preparations??[]).filter(x=>PQ_ORIGINAL_KINDS.includes(x.kind)).length)>PRIVATE_FILE_MAX_BYTES)throw invalid();
      await this.#write({...state,schemaVersion:pq?Math.max(6,state.schemaVersion):Math.max(5,state.schemaVersion),...(pq?{pqOriginals:state.pqOriginals??[]}:{}),preparations:[...(state.preparations??[]),{account,kind}]});
    });return slot}catch(error){slots.delete(account);throw error}
  }
  captureOriginal(account,value,kind){
    const slot=owner(this).get(account);if(!slot)throw invalid();
    const captured=PQ_ORIGINAL_KINDS.includes(kind)?parsePQOriginalRecord(value):freezePublic(JSON.parse(JSON.stringify(value)));
    if(PQ_ORIGINAL_KINDS.includes(kind)){const parsed=parsePQOriginalRecord(captured);if(parsed.kind!==kind||parsed.account!==account||slot.kind!==kind||slot.pq&&canonicalJSON(slot.pq)!==canonicalJSON(parsed))throw invalid();slot.pq=parsed;}
    else if(kind==="pay"){assertDesktopSignedPayStorage(captured);if(evmAddressFromYNX(captured.account)!==account||slot.kind!=="pay")throw invalid();if(slot.pay&&canonicalJSON(slot.pay)!==canonicalJSON(captured))throw invalid();slot.pay=Object.freeze(captured)}
    else{if(kind!=='native'||PQ_ORIGINAL_KINDS.includes(slot.kind))throw invalid();if(slot.native&&canonicalJSON(slot.native)!==canonicalJSON(captured))throw invalid();slot.native=Object.freeze(captured)}
    return slot;
  }
  originalFailed(account,error,{storage=false}={}){
    const slot=owner(this).get(account);if(!slot)return;
    if(storage){if(!slot.storageCausePresent){slot.storageCause=error;slot.storageCausePresent=true;}return;}
    if(slot.originalCausePresent)return;
    // A storage wrapper is not a second operation failure. Presence, not
    // truthiness, preserves even a thrown null/false/undefined first cause.
    let cause;try{const descriptor=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'cause'):null;if(descriptor&&Object.hasOwn(descriptor,'value'))cause=descriptor;}catch{}
    if(slot.storageCausePresent&&(error===slot.storageCause||cause&&cause.value===slot.storageCause))return;
    slot.originalCause=error;slot.originalCausePresent=true;
  }
  originalSaved(account){owner(this).delete(account)}
  // SAVE is custody only. No producer, RPC or outward-effect capability is
  // consumed here; the renderer cannot provide the original being published.
  async saveOriginal(account,hash,guard,{policy}={}){
    if(typeof guard!=="function"||!ACCOUNT.test(account??"")||!/^0x[0-9a-f]{64}$/.test(hash??""))throw invalid();
    guard();const slot=owner(this).get(account);
    if(PQ_ORIGINAL_KINDS.includes(slot?.kind))return this.#savePQOriginal(account,hash,guard);
    if(!slot)return this.#mutate(async()=>{
      guard();const state=await this.#read();guard();
      if(state.preparations?.some(x=>x.account===account))throw invalid();
      const native=state.records.find(x=>x.account===account&&x.hash===hash),pay=state.signedPayments?.find(x=>evmAddressFromYNX(x.account)===account&&x.transfer.hash===hash);
      const pq=state.pqOriginals?.find(x=>x.account===account&&x.hash===hash);
      if(pq){parsePQOriginalRecord(pq);guard();return Object.freeze({account,hash,savedLocally:true,submitted:false,confirmed:false});}
      if(!native&&!pay)throw invalid();
      // Legacy reads may retain hash-only intents. They cannot prove custody
      // of a complete signed original, even for an idempotent save request.
      if(native){
        if(typeof native.raw!=="string")throw capabilityError("ORIGINAL_SAVE_UNAVAILABLE","The original signed bytes are unavailable. Preserve the journal and check its hash; do not recreate a signature.");
        validateIntent(native);
      }
      if(pay)parseDesktopSignedPayRecord(canonicalJSON(pay),pay.account,policy,guard);
      guard();return Object.freeze({account,hash,savedLocally:true,submitted:false,confirmed:false});
    });
    if(slot.kind==="native"&&!slot.native||slot.kind==="pay"&&!slot.pay)throw capabilityError("ORIGINAL_SAVE_UNAVAILABLE","No complete held original is available. Preserve the unknown journal; do not recreate a signature.");
    const original=slot.kind==="native"?slot.native:slot.pay;
    if((slot.kind==="native"?original.hash:original.transfer.hash)!==hash)throw invalid();
    const current=()=>{guard();if(owner(this).get(account)!==slot)throw invalid()};
    const storage=async action=>{try{return await action()}catch(error){this.originalFailed(account,error.cause??error,{storage:true});throw error}};
    return this.#mutate(async()=>{
      try{
        current();const state=await storage(()=>this.#read());current();
        const marker=state.preparations?.find(x=>x.account===account);
        if(marker&&marker.kind!==slot.kind)throw invalid();
        if(slot.kind==="native"){
          const intent={account,chainId:original.transaction.chainId,nonce:original.transaction.nonce,hash,to:original.transaction.to,value:original.transaction.value,capabilities:original.capabilities,raw:original.raw,origin:CANONICAL_RPC_URL};
          validateIntent({...intent,attempts:1});
          if((state.signedPayments??[]).some(x=>evmAddressFromYNX(x.account)===account)||state.resolutions.some(x=>x.intent.hash===hash))throw invalid();
          const prior=state.records.find(x=>x.account===account);
          if(prior){const {attempts,...body}=prior;if(canonicalJSON(body)!==canonicalJSON(intent))throw invalid()}
          else{if(!marker)throw invalid();state.records.push({...intent,attempts:1})}
        }else{
          const saved=parseDesktopSignedPayRecord(canonicalJSON(original),original.account,policy,current);
          if(state.records.some(x=>x.account===account)||(state.payHistory??[]).some(x=>x.record.account===saved.account&&x.record.invoice.id===saved.invoice.id))throw invalid();
          const prior=(state.signedPayments??[]).find(x=>x.account===saved.account);
          if(prior){if(canonicalJSON(prior)!==canonicalJSON(saved))throw invalid()}
          else{if(!marker)throw invalid();const next=paySuccessor(state);Object.assign(state,next);state.signedPayments.push(saved);state.payProgress.push(payEntry(saved,true))}
        }
        // Matching durable originals are adopted without increasing attempts or
        // rewriting progress. A matching marker is removed only atomically.
        const needsWrite=!!marker;
        if(needsWrite){state.preparations=state.preparations.filter(x=>x.account!==account);current();await storage(()=>this.#write(state));current()}
        const readback=await storage(()=>this.#read());current();
        if(readback.preparations?.some(x=>x.account===account))throw invalid();
        if(slot.kind==="native"){
          const actual=readback.records.find(x=>x.account===account),{attempts,...body}=actual??{};
          const expected={account,chainId:original.transaction.chainId,nonce:original.transaction.nonce,hash,to:original.transaction.to,value:original.transaction.value,capabilities:original.capabilities,raw:original.raw,origin:CANONICAL_RPC_URL};
          if(!actual||canonicalJSON(body)!==canonicalJSON(expected))throw invalid();
        }else{
          const actual=readback.signedPayments?.find(x=>x.account===original.account);
          if(!actual||canonicalJSON(parseDesktopSignedPayRecord(canonicalJSON(actual),original.account,policy,current))!==canonicalJSON(original))throw invalid();
        }
        current();this.originalSaved(account);
        return Object.freeze({account,hash,savedLocally:true,submitted:false,confirmed:false});
      }catch(error){this.originalFailed(account,error);throw error}
    });
  }
  async #savePQOriginal(account,hash,guard){
    return this.#mutate(async()=>{
      guard();const slot=owner(this).get(account);
      if(!PQ_ORIGINAL_KINDS.includes(slot?.kind)||!slot.pq||slot.pq.hash!==hash)throw invalid();
      if(slot.pqSaveAttempted)throw capabilityError('PQ_ORIGINAL_RECONCILE_REQUIRED','Read back this same original; do not repeat its save or signature.');
      const current=()=>{guard();if(owner(this).get(account)!==slot)throw invalid();};
      try{
        const state=await this.#read();current();
        if(state.schemaVersion<6||!state.preparations.some(x=>x.account===account&&x.kind===slot.kind)||state.pqOriginals.some(x=>x.account===account))throw invalid();
        const original=parsePQOriginalRecord(slot.pq);
        const next={...state,pqOriginals:[...state.pqOriginals,original],preparations:state.preparations.filter(x=>x.account!==account)};
        current();slot.pqSaveAttempted=true;await this.#write(next);current();
        const readback=await this.#read();current();
        if(!readback.pqOriginals?.some(x=>canonicalJSON(x)===canonicalJSON(original))||readback.preparations?.some(x=>x.account===account))throw invalid();
        this.originalSaved(account);return Object.freeze({account,hash,savedLocally:true,submitted:false,confirmed:false});
      }catch(error){this.originalFailed(account,error,{storage:true});throw error;}
    });
  }
  async readPQOriginals(account,guard){
    if(!ACCOUNT.test(account??'')||typeof guard!=='function')throw invalid();guard();const state=await this.#read();guard();
    return (state.pqOriginals??[]).filter(x=>x.account===account).map(parsePQOriginalRecord);
  }
  async pqSummaries(account){
    if(!ACCOUNT.test(account??''))throw invalid();const state=await this.#read();
    return (state.pqOriginals??[]).filter(x=>x.account===account).map(row=>{const original=parsePQOriginalRecord(row);return Object.freeze({hash:original.hash,account,kind:original.kind,operationId:original.operationId,status:'pq-signed-unsubmitted',canRetryExact:false});});
  }
  async reconcilePQOriginal(account,hash,guard){
    if(!ACCOUNT.test(account??'')||!HASH.test(hash??'')||typeof guard!=='function')throw invalid();
    return this.#mutate(async()=>{
      guard();const slot=owner(this).get(account),state=await this.#read();guard();
      const actual=state.pqOriginals?.find(x=>x.account===account&&x.hash===hash);
      if(!actual||state.preparations?.some(x=>x.account===account)||slot&&(!slot.pq||canonicalJSON(slot.pq)!==canonicalJSON(actual)))throw invalid();
      parsePQOriginalRecord(actual);guard();if(slot&&owner(this).get(account)!==slot)throw invalid();
      if(slot)this.originalSaved(account);return Object.freeze({account,hash,savedLocally:true,submitted:false,confirmed:false});
    });
  }
  async snapshot() { return (await this.#read()).records; }
  async resolutions() { return (await this.#read()).resolutions; }
  async assertNoSignedPayment(account){
    await this.assertNoPreparation(account);
    const records=(await this.#read()).signedPayments??[];
    if(records.some(record=>evmAddressFromYNX(record.account)===account))throw capabilityError("PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW","A signed Pay original remains retained. Review its original hash and settlement; do not create a replacement transaction.");
  }
  async signedPayment(account,policy,guard){
    guard();const record=((await this.#read()).signedPayments??[]).find(value=>value.account===account);guard();
    return record?parseDesktopSignedPayRecord(canonicalJSON(record),account,policy,guard):null;
  }
  async retainSignedPayment(record,policy,guard,{forBroadcast=false}={}){
    const saved=parseDesktopSignedPayRecord(canonicalJSON(record),record.account,policy,guard);
    return this.#mutate(async()=>{
      guard();const state=await this.#read();guard();
      const prior=(state.signedPayments??[]).find(value=>value.account===saved.account);
      if(prior){if(canonicalJSON(prior)!==canonicalJSON(saved))throw invalid();return parseDesktopSignedPayRecord(canonicalJSON(prior),saved.account,policy,guard)}
      if(state.records.some(value=>value.account===evmAddressFromYNX(saved.account)))throw capabilityError("TRANSACTION_RESOLUTION_REQUIRED","The existing transaction must be resolved before signed Pay.");
      if((state.payHistory??[]).some(entry=>entry.record.account===saved.account&&entry.record.invoice.id===saved.invoice.id))throw capabilityError("PAY_INVOICE_ALREADY_PAID","This invoice already has a retained paid receipt.");
      const next=forBroadcast||state.schemaVersion>=4?paySuccessor(state):{...state,schemaVersion:3,signedPayments:state.signedPayments??[]};
      next.signedPayments=[...next.signedPayments,saved];
      if(next.schemaVersion>=4)next.payProgress=[...next.payProgress,payEntry(saved,!forBroadcast)];
      if(next.preparations)next.preparations=next.preparations.filter(x=>x.account!==evmAddressFromYNX(saved.account));
      await this.#write(next);guard();
      const readback=await this.signedPayment(saved.account,policy,guard);guard();
      if(!readback||canonicalJSON(readback)!==canonicalJSON(saved))throw invalid();return readback;
    });
  }
  async payHistory(account,policy,guard){
    guard();const state=await this.#read();guard();
    return (state.payHistory??[]).filter(entry=>entry.record.account===account).map(entry=>this.#verifiedPayEntry(entry,account,policy,guard));
  }
  async signedPayProgress(account,policy,guard){
    const slot=owner(this).get(evmAddressFromYNX(account));
    if(slot?.pay){guard();const record=parseDesktopSignedPayRecord(canonicalJSON(slot.pay),account,policy,guard);return {...payEntry(record,false),localRetention:originalRetention(slot)}}
    guard();const state=await this.#read();guard();const record=(state.signedPayments??[]).find(value=>value.account===account);
    if(!record)return null;
    return this.#verifiedPayEntry((state.payProgress??[]).find(entry=>entry.record.account===account)??payEntry(record),account,policy,guard);
  }
  #verifiedPayEntry(entry,account,policy,guard){
    const record=parseDesktopSignedPayRecord(canonicalJSON(entry.record),account,policy,guard);assertDesktopPayProgress(entry);guard();return structuredClone({...entry,record});
  }
  async #changePay(account,hash,policy,guard,change){
    return this.#mutate(async()=>{
      guard();const state=paySuccessor(await this.#read());guard();const entry=state.payProgress.find(value=>value.record.account===account&&value.record.transfer.hash===hash);
      if(!entry)throw invalid();this.#verifiedPayEntry(entry,account,policy,guard);change(entry,state);guard();
      await this.#write(state);guard();return structuredClone(entry);
    });
  }
  async claimSignedPayBroadcast(account,hash,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      if(entry.broadcastAttempted)throw capabilityError("PAY_ORIGINAL_CHECK_ONLY","Check the original transaction; no repeated payment broadcast is allowed.");
      entry.broadcastAttempted=true;
    });
  }
  async saveSignedPayEvidence(account,hash,evidence,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      assertDesktopPayEvidence(entry.record,evidence);
      if(entry.evidence&&canonicalJSON(entry.evidence)!==canonicalJSON(evidence))throw invalid();
      entry.evidence=structuredClone(evidence);
    });
  }
  async claimSignedPaySettlement(account,hash,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      if(!entry.evidence||entry.settlementAttempted||entry.settlement)throw capabilityError("PAY_ORIGINAL_RECEIPT_CHECK_ONLY","Read the original settlement receipt; do not submit another result.");
      entry.settlementAttempted=true;
    });
  }
  async saveSignedPaySettlement(account,hash,settlement,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      const verified=parseDesktopPaySettlement(settlement,entry.record,entry.evidence);
      if(entry.settlement&&canonicalJSON(entry.settlement)!==canonicalJSON(verified))throw invalid();
      entry.settlement=verified;
    });
  }
  async archiveSignedPay(account,hash,policy,guard){
    return this.#mutate(async()=>{
      guard();const state=paySuccessor(await this.#read());guard();const prior=state.payHistory.find(entry=>entry.record.account===account&&entry.record.transfer.hash===hash);
      if(prior)return this.#verifiedPayEntry(prior,account,policy,guard);
      const entry=state.payProgress.find(entry=>entry.record.account===account&&entry.record.transfer.hash===hash);
      if(!entry||!entry.settlement||!entry.evidence)throw invalid();this.#verifiedPayEntry(entry,account,policy,guard);
      // One existing private-file replacement atomically links history, the paid
      // invoice marker, and release of the active original. No second vault or
      // transient deletion window can lose a verified receipt.
      state.payHistory.push(entry);state.payProgress=state.payProgress.filter(value=>value!==entry);
      state.signedPayments=state.signedPayments.filter(record=>record.transfer.hash!==hash);guard();await this.#write(state);guard();
      const readback=(await this.payHistory(account,policy,guard)).find(value=>value.record.transfer.hash===hash);
      if(!readback||canonicalJSON(readback)!==canonicalJSON(entry))throw invalid();return readback;
    });
  }
  async #read(filePath = this.filePath) {
    let handle, failed = false, stage = "probe";
    try {
      await this.filePolicy.available(filePath);
      stage = "open";
      handle = await this.io.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      stage = "inspect";
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > PRIVATE_FILE_MAX_BYTES) throw invalid();
      await this.filePolicy.assertPrivate(filePath, stat);
      return structuredClone(parseState(JSON.parse(await readBoundedPrivateFile(handle))));
    } catch (error) { failed = true; if (error?.code === "ENOENT" && stage === "open" && !handle && filePath === this.filePath) return empty(); throw invalid(); }
    finally { try { await handle?.close(); } catch { if (!failed) throw invalid(); } }
  }
  async add(intent, { retry = false } = {}) {
    validateIntent({ ...intent, attempts: 1 });
    if (intent.raw === null) throw invalid(); // Only the explicit V1 read can yield a no-raw pending entry.
    return this.#mutate(async () => {
      const state = await this.#read(), prior = state.records.find(item => item.account === intent.account);
      if(state.pqOriginals?.some(x=>x.account===intent.account)||state.preparations?.some(x=>x.account===intent.account&&PQ_ORIGINAL_KINDS.includes(x.kind)))throw capabilityError('TRANSACTION_SIGNING_RESULT_UNKNOWN','An original PQ operation is unresolved. Do not send a replacement.');
      if((state.signedPayments??[]).some(record=>evmAddressFromYNX(record.account)===intent.account))throw capabilityError("PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW","The retained signed Pay original must be reviewed before another broadcast.");
      if (prior) {
        const { attempts, ...original } = prior;
        if (!retry || capabilityFingerprint(original) !== capabilityFingerprint(intent)) throw capabilityError("TRANSACTION_RESOLUTION_REQUIRED", "A previous transaction for this account is still unresolved.");
        if (attempts >= Number.MAX_SAFE_INTEGER) throw invalid(); prior.attempts++;
      } else {
        if (retry || state.resolutions.some(entry => entry.intent.hash === intent.hash)) throw invalid();
        state.records.push({ ...intent, attempts: 1 });
      }
      if(state.preparations)state.preparations=state.preparations.filter(x=>x.account!==intent.account);
      await this.#write(state);
    });
  }
  async reject(hash, account, proof) {
    return this.#mutate(async () => {
      const state = await this.#read(), intent = state.records.find(item => item.hash === hash);
      if (!intent || intent.account !== account || intent.attempts !== 1) throw invalid();
      validateRejection(proof, intent.origin);
      state.records = state.records.filter(item => item.hash !== hash); state.rejections.push({ intent, proof }); await this.#write(state);
    });
  }
  async resolve(hash, account, receipt, capabilities) {
    return this.#mutate(async () => {
      const state = await this.#read(), record = state.records.find(item => item.hash === hash);
      if (!record || record.account !== account) throw invalid();
      const model = parseFeeModel(capabilities ?? record.capabilities), evidence = assertIntentReceipt(record, receipt, model);
      state.records = state.records.filter(item => item.hash !== hash); state.resolutions.push({ intent: record, receipt: evidence, capabilities: model }); await this.#write(state);
    });
  }
  #mutate(action) { const result = this.#mutations.then(action); this.#mutations = result.catch(() => {}); return result; }
  async #write(state) {
    const directory = path.dirname(this.filePath), temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let file;
    try {
      parseState(state); const encoded = `${JSON.stringify(state)}\n`;
      if (Buffer.byteLength(encoded) > 1024 * 1024) throw invalid();
      await this.filePolicy.directory(directory);
      file = await this.io.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await this.filePolicy.protect(temporary);
      await file.writeFile(encoded, "utf8"); await file.sync(); await file.close(); file = null;
      if (capabilityFingerprint(await this.#read(temporary)) !== capabilityFingerprint(state)) throw invalid();
      await this.filePolicy.replace(temporary, this.filePath);
      if (capabilityFingerprint(await this.#read()) !== capabilityFingerprint(state)) throw invalid();
    } catch (cause) {
      throw Object.assign(capabilityError("TRANSACTION_JOURNAL_WRITE_FAILED", "The transaction journal could not be saved durably. No new broadcast may start; preserve any existing unresolved entry."),{cause});
    } finally { try{await file?.close()}catch{} await this.io.unlink(temporary).catch(() => {}); }
  }
}
