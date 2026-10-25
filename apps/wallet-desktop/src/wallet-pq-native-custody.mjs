import {createRequire} from 'node:module';
import {types} from 'node:util';
import {validatePQPublicBinding,exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
const require=createRequire(import.meta.url);
const names=['originalPQOpen','originalPQCurrent','originalPQRetire','originalPQTransactionOnce','originalPQCopyOutcome','originalPQClose','originalPQReleaseClosed','originalPQCapabilities'];
const failure=(code,status)=>Object.assign(Error(code),{code,...(status===undefined?{}:{nativeStatus:status})});
const buffer=(value,max)=>Buffer.isBuffer(value)&&!(value.buffer instanceof SharedArrayBuffer)&&value.length>0&&value.length<=max;
function fixedNative(){if(process.platform!=='darwin')throw failure('PQ_NATIVE_PLATFORM_NOT_SUPPLIED');return require('../native/original-auth-identity.node');}
// Sole Main-private fixed addon. An owner ID is custody, never Source or user
// approval. No portable fallback, store, renderer/preload export or async pool.
export function createOriginalNativePQCustody({load=fixedNative}={}){
 let native;const held=new Set();
 function available(){native??=load();if(names.some(name=>typeof native?.[name]!=='function')||(native.originalPQCapabilities()&1)!==1)throw failure('PQ_NATIVE_MATCHED_BINDING_REQUIRED');return native;}
 function open(wire,credential,expected){
  const api=available(),binding=validatePQPublicBinding(expected);
  if(!buffer(wire,196608)||typeof credential!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(credential))throw failure('PQ_NATIVE_BACKUP_BINDING_REQUIRED');
  const password=Buffer.from(credential,'ascii');let packet;
  try{packet=api.originalPQOpen(wire,password,Buffer.from(JSON.stringify(binding)));}finally{password.fill(0);}
  // Retain the original returned ID before inspecting status/currentness.
  const id=Object.getOwnPropertyDescriptor(packet??{},'ownerId')?.value;
  let selected=false,retired=false,released=false,firstOutcome=null,notified=false,closeResult=null,closeEntered=false,debt=false;
  const owner={};if(typeof id==='bigint'&&id>0n)held.add(owner);
  const check=code=>{if(code!==0)throw failure('PQ_NATIVE_CUSTODY_FAILED',code);};
  function current(){if(retired||released||closeEntered)throw failure('PQ_NATIVE_RETIRED');check(api.originalPQCurrent(id));}
  function retain(raw,capture){
   exactPQRecord(raw,['callStatus','copyStatus','primitiveStatus','cleanupStatus','selected','member']);
   if(!Number.isInteger(raw.callStatus)||!Number.isInteger(raw.copyStatus)||!Number.isInteger(raw.primitiveStatus)||![0,1,2,3].includes(raw.cleanupStatus)||typeof raw.selected!=='boolean'||!types.isUint8Array(raw.member)||raw.member.buffer instanceof SharedArrayBuffer||raw.member.byteLength>98304)throw failure('PQ_NATIVE_OUTCOME_INVALID');
   check(raw.copyStatus);
   const value=Object.freeze({...raw,member:Buffer.from(raw.member)});
   if(firstOutcome&&(firstOutcome.primitiveStatus!==value.primitiveStatus||firstOutcome.cleanupStatus!==value.cleanupStatus||firstOutcome.selected!==value.selected||!firstOutcome.member.equals(value.member)))throw failure('PQ_NATIVE_ORIGINAL_OUTCOME_CHANGED');
   if(value.selected)firstOutcome??=value;
   if(value.selected&&![1,2].includes(value.cleanupStatus))debt=true;
   if(value.member.length&&!notified){notified=true;capture(value);}
   return firstOutcome??value;
  }
  function copy(capture){return retain(api.originalPQCopyOutcome(id),capture);}
  function retire(){if(released||retired)return;retired=true;try{check(api.originalPQRetire(id));}catch(error){debt=true;throw error;}}
  function transaction(request,capture){
   if(typeof capture!=='function')throw failure('PQ_NATIVE_ORIGINAL_CAPTURE_REQUIRED');current();if(selected)throw failure('PQ_NATIVE_SIGN_ONCE');
   exactPQRecord(request,['messageOriginal','policyOriginal','nativeChainId','keyVersion','executionHeight']);
   if(!buffer(request.messageOriginal,8192)||!buffer(request.policyOriginal,8388608)||typeof request.nativeChainId!=='string'||! /^[1-9][0-9]{0,19}$/.test(request.nativeChainId)||BigInt(request.nativeChainId)>18446744073709551615n||![request.keyVersion,request.executionHeight].every(v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n))throw failure('PQ_NATIVE_TRANSACTION_BINDING_REQUIRED');
   selected=true;let raw,failed=false,cause;
   try{raw=api.originalPQTransactionOnce(id,request.messageOriginal,request.policyOriginal,BigInt(request.nativeChainId),Buffer.from(request.keyVersion),Buffer.from(request.executionHeight));retain(raw,capture);}catch(error){failed=true;cause=error;}
   if(failed){try{copy(capture);}catch{}throw cause;}
   check(raw.callStatus);if(raw.primitiveStatus!==0||raw.cleanupStatus!==2||raw.selected!==true||!raw.member.length)throw failure('PQ_NATIVE_SIGN_RESULT_UNCONFIRMED',raw.primitiveStatus);
   return firstOutcome;
  }
  function close(capture){
   if(closeEntered){if(closeResult?.failed)throw closeResult.cause;return;}
   closeEntered=true;let failed=false,cause,retained=false;
   const attempt=fn=>{try{fn();}catch(error){if(!failed){failed=true;cause=error;}}};
   attempt(()=>{try{copy(capture);retained=true;}catch(error){debt=true;throw error;}});attempt(()=>retire());
   let code;attempt(()=>{code=api.originalPQClose(id);check(code);});
   // Copy after close as well: a Native error cannot hide an existing Member.
   attempt(()=>{try{copy(capture);retained=true;}catch(error){debt=true;throw error;}});
   if(retained&&!debt)attempt(()=>{check(api.originalPQReleaseClosed(id));released=true;held.delete(owner);});
   if(!released)debt=true;
   if(debt&&!failed){failed=true;cause=failure('PQ_NATIVE_CLEANUP_UNRESOLVED');}
   closeResult={failed,cause};if(failed)throw cause;
  }
  Object.assign(owner,{assertCurrent:current,transactionOnce:transaction,retire,close,cleanupUnresolved:()=>debt||!released,copyOutcome:copy});Object.freeze(owner);
  if(typeof id!=='bigint'||id<=0n||packet?.status!==0){const error=failure('PQ_NATIVE_OPEN_FAILED',packet?.status);if(typeof id==='bigint'&&id>0n)Object.defineProperty(error,'partial',{value:owner});throw error;}
  return owner;
 }
 return Object.freeze({assertAvailable:()=>{available();},open,cleanupUnresolved:()=>held.size!==0});
}
