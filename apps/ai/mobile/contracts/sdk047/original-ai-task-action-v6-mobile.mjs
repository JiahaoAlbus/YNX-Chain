// Fixed RN CxxTurboModule adapter. Native intrinsic inventory is the ONLY brand.
// Local arrays retain/deduplicate custody; they never confer Source authority.
import {TurboModuleRegistry} from 'react-native';
const MODULE='YNXOriginalAIMobileV6';
const fail=code=>{throw Object.assign(Error(code),{code});};
const object=v=>v!==null&&(typeof v==='object'||typeof v==='function');
function owned(raw,adopt){
 if(!object(raw))fail('AI_V6_MOBILE_NATIVE_OWNED');
 const d=Object.getOwnPropertyDescriptors(raw),names=Reflect.ownKeys(d);
 if(!d.owner||!Object.hasOwn(d.owner,'value'))fail('AI_V6_MOBILE_NATIVE_OWNED');
 // Custody is installed before interpreting ANY late error, including code0.
 if(d.owner.value!==null&&d.owner.value!==undefined)adopt(d.owner.value);
 if(names.length!==3||names.some(k=>!['owner','errorPresent','error'].includes(k)||!Object.hasOwn(d[k],'value'))||typeof d.errorPresent?.value!=='boolean')fail('AI_V6_MOBILE_NATIVE_OWNED');
 if(d.errorPresent.value)throw d.error.value;
 if(d.owner.value===null||d.owner.value===undefined)fail('AI_V6_MOBILE_NATIVE_OWNER_MISSING');
 return d.owner.value;
}
function recoveryDATA(value,operationId){
 const keys=['operationId','evidenceOriginal','dataOnly','RootAdmission','NativeAdmission','operationVerified','replayAuthorized'];
 if(!object(value))fail('AI_V6_MOBILE_ORIGINAL_EVIDENCE_NOT_SUPPLIED');
 const d=Object.getOwnPropertyDescriptors(value);
 if(!d.evidenceOriginal||!Object.hasOwn(d.evidenceOriginal,'value'))fail('AI_V6_MOBILE_ORIGINAL_EVIDENCE_NOT_SUPPLIED');
 let n,buffer,tag;const ta=Object.getPrototypeOf(Uint8Array.prototype);
 try{tag=Object.getOwnPropertyDescriptor(ta,Symbol.toStringTag).get.call(d.evidenceOriginal.value);n=Object.getOwnPropertyDescriptor(ta,'byteLength').get.call(d.evidenceOriginal.value);buffer=Object.getOwnPropertyDescriptor(ta,'buffer').get.call(d.evidenceOriginal.value);Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(buffer);}catch{fail('AI_V6_MOBILE_ORIGINAL_EVIDENCE_NOT_SUPPLIED');}
 if(tag!=='Uint8Array'||!n||n>1048576)fail('AI_V6_MOBILE_ORIGINAL_EVIDENCE_NOT_SUPPLIED');
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value'))||d.operationId.value!==operationId||d.dataOnly.value!==true||['RootAdmission','NativeAdmission','operationVerified','replayAuthorized'].some(k=>d[k].value!==false))fail('AI_V6_MOBILE_RECOVERY_DATA');
 const copy=new Uint8Array(n);Uint8Array.prototype.set.call(copy,d.evidenceOriginal.value);
 return Object.freeze({operationId,evidenceOriginal:copy,dataOnly:true,RootAdmission:false,NativeAdmission:false,operationVerified:false,replayAuthorized:false});
}
function checkFailure(v){if(!v||typeof v.present!=='boolean'||!Number.isInteger(v.code)||v.code< -2147483648||v.code>2147483647)fail('AI_V6_MOBILE_NATIVE_FAILURE');return v;}
export async function openOriginalAITaskActionClientV6(...args){
 if(args.length)fail('AI_V6_ZERO_INPUT');
 const binding=TurboModuleRegistry.get(MODULE);
 if(!binding)fail('AI_V6_MOBILE_INSTALLER_NOT_REGISTERED');
 const invoke=(name,...a)=>{if(typeof binding[name]!=='function')fail('AI_V6_MOBILE_NATIVE_INTRINSIC_MISSING:'+name);return binding[name](...a);};
 let source=null,firstPresent=false,first,closed=false,retired=false,closing=null;
 const held=[],packets=[],recoveries=[];
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e;}};
 const clientBrand=()=>{if(!source||invoke('isOriginalClientV6',source)!==true)fail('AI_V6_MOBILE_NATIVE_CLIENT_BRAND');};
 const retain=(role,owner,packet=null)=>{
  held.push({role,owner}); // even malformed partial stays retained for diagnosis.
  const valid=role==='source'?invoke('isOriginalClientV6',owner):role==='packet'?invoke('isOriginalPacketV6',source,owner):role==='review'?invoke('isOriginalReviewV6',source,packet,owner):role==='recovery'?invoke('isOriginalRecoveryV6',source,owner):role==='context'?invoke('isOriginalContextV6',source,owner):false;
  if(valid!==true)fail('AI_V6_MOBILE_NATIVE_'+role.toUpperCase()+'_BRAND');
  if(role==='source')source=owner;
 };
 const live=()=>{clientBrand();if(retired||closed)fail('AI_V6_MOBILE_CLIENT_RETIRED');};
 const packetState=p=>{live();if(invoke('isOriginalPacketV6',source,p)!==true)fail('AI_V6_MOBILE_NATIVE_PACKET_BRAND');const r=packets.find(x=>x.packet===p);if(!r)fail('AI_V6_MOBILE_PACKET_NOT_OWNED');return r;};
 const context=(c,kind)=>{live();const x=invoke('captureOriginalContextV6',source,c,kind);retain('context',x);return x;};
 async function drain(){
  retired=true;
  if(closed){if(firstPresent)throw first;return;}
  clientBrand();
  try{const rc=source.requestCancel();if(rc!==0)remember(rc);}catch(e){remember(e);}
  // Native source owns all C children/producers and drains them before Source.
  // Same HostObject close performs one bounded actor pass; no JS pointer release.
  try{const result=checkFailure(await source.close());if(result.present)remember(result.code);}catch(e){remember(e);}
  try{const st=source.ownerState();if(!st||st.version!==6||typeof st.closed!=='boolean')fail('AI_V6_MOBILE_NATIVE_OWNER_STATE');checkFailure(st.originalFailure);checkFailure(st.closeFailure);if(st.originalFailure.present)remember(st.originalFailure.code);if(st.closeFailure.present)remember(st.closeFailure.code);closed=st.closed;}catch(e){remember(e);}
  if(!closed){if(firstPresent)throw first;fail('AI_V6_MOBILE_CLEANUP_PENDING');}
  if(firstPresent)throw first;
 }
 const close=()=>{if(closing)return closing;closing=drain().finally(()=>{if(!closed)closing=null;});return closing;};
 try{owned(await invoke('acquireOriginalClientV6'),o=>retain('source',o));clientBrand();}
 catch(e){remember(e);if(source){try{await close();}catch{}}throw first;}
 return Object.freeze({
  prepare(intent){live();let packet=null;try{const c=context(intent,1);owned(source.prepare(intent,c),o=>{packet=o;retain('packet',o);});const r={packet,review:null,proof:null,send:null};packets.push(r);return packet;}catch(e){remember(e);throw e;}},
  prove(packet){const r=packetState(packet);if(r.proof)return r.proof;
   r.proof=(async()=>{try{
    const review=owned(await invoke('prepareOriginalReviewV6',source,packet),o=>{r.review=o;retain('review',o,packet);});
    if(invoke('isOriginalReviewV6',source,packet,review)!==true)fail('AI_V6_MOBILE_NATIVE_REVIEW_BRAND');
    // Native retains/adopts the operation before returning; SDK returns SAME packet.
    // Native prove enforces exact packet/context/review and calls C arg4 review.
    const result=await source.prove(packet,review);
    owned(result,o=>{held.push({role:'operation',owner:o});if(invoke('isOriginalOperationV6',source,packet,review,o)!==true)fail('AI_V6_MOBILE_NATIVE_OPERATION_BRAND');});return packet;
   }catch(e){remember(e);throw e;}})();return r.proof;
  },
  send(packet){const r=packetState(packet);if(!r.proof)fail('AI_V6_MOBILE_SAME_REVIEW_REQUIRED');if(r.send)return r.send;
   r.send=(async()=>{try{await r.proof;return await source.send(packet);}catch(e){remember(e);throw e;}})();return r.send;
  },
  read(packet){packetState(packet);try{return source.read(packet);}catch(e){remember(e);throw e;}},
  lookupOriginal(operationId,abortContext){live();const prior=recoveries.find(r=>r.operationId===operationId&&r.abortContext===abortContext);if(prior)return prior.flight;
   const r={operationId,abortContext,owner:null,flight:null};recoveries.push(r);
   r.flight=(async()=>{try{const c=context(abortContext,2);return owned(await source.lookupOriginal(operationId,c),o=>{r.owner=o;retain('recovery',o);});}catch(e){remember(e);throw e;}})();return r.flight;
  },
  readRecovery(token){live();if(invoke('isOriginalRecoveryV6',source,token)!==true||!recoveries.some(r=>r.owner===token))fail('AI_V6_MOBILE_NATIVE_RECOVERY_BRAND');try{return recoveryDATA(source.readRecovery(token),recoveries.find(r=>r.owner===token).operationId);}catch(e){remember(e);throw e;}},
  close
 });
}
