// Private portable custody controller. It owns returned resources, NOT a Source
// brand. Inputs must be captured by the fixed actual Native host, not JS DTOs.
const roles=Object.freeze(['review','proof','outcome','lookup','source']);
const failure=code=>Object.assign(Error(code),{code});
const object=v=>v!==null&&(typeof v==='object'||typeof v==='function');
function own(v,key){if(!object(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}
export function createOriginalAITaskV6MobileCustodyDATA(){
 const held=[],flights=new Set();let retired=false,closed=false,active=0,drainFlight=null,firstPresent=false,first;
 const remember=c=>{if(!firstPresent){firstPresent=true;first=c}};
 function adopt(role,owner){if(!roles.includes(role))throw failure('AI_V6_MOBILE_CUSTODY_ROLE');if(owner===null||owner===undefined)return null;if(closed)closed=false;const prior=held.find(r=>r.owner===owner);if(prior){if(prior.role!==role)throw failure('AI_V6_MOBILE_CUSTODY_ROLE_REUSED');return prior;}const r={role,owner,retireEntered:false,joined:false,closed:false};held.push(r);return r;}
 function retainFailure(role,cause){remember(cause);const p=own(cause,'partial');if(p!==null&&p!==undefined)adopt(role,p);return cause;}
 function retainOutcome(role,raw){const owner=own(raw,'owner');adopt(role,owner);try{if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)throw failure('AI_V6_MOBILE_NATIVE_OUTCOME');const d=Object.getOwnPropertyDescriptors(raw),keys=Reflect.ownKeys(d);if(!Object.hasOwn(d,'owner')||!Object.hasOwn(d,'errorPresent')||keys.some(k=>!['owner','errorPresent','error'].includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable)||typeof d.errorPresent.value!=='boolean')throw failure('AI_V6_MOBILE_NATIVE_OUTCOME');if(d.errorPresent.value)throw Object.hasOwn(d,'error')?d.error.value:undefined;if(retired)throw failure('AI_V6_MOBILE_CUSTODY_RETIRED');return owner;}catch(cause){remember(cause);throw cause;}}
 // Internal fixed Native call only. Register custody before foreign code can
 // reenter; this callback is NOT a public Source factory/provider port.
 function run(role,fixedNativeCall){if(retired||closed)throw failure('AI_V6_MOBILE_CUSTODY_RETIRED');if(!roles.includes(role)||typeof fixedNativeCall!=='function')throw failure('AI_V6_MOBILE_NATIVE_CALL');let resolve,reject;const flight=new Promise((a,b)=>{resolve=a;reject=b});flights.add(flight);flight.then(()=>flights.delete(flight),()=>flights.delete(flight));active++;try{const raw=fixedNativeCall();Promise.resolve(raw).then(value=>{try{resolve(retainOutcome(role,value));}catch(cause){reject(cause)}},cause=>{try{retainFailure(role,cause);}finally{reject(cause)}});}catch(cause){try{retainFailure(role,cause);}finally{reject(cause)}}finally{active--;}return flight;}

 function call(r,key){const fn=own(r.owner,key);if(typeof fn!=='function')throw failure('AI_V6_MOBILE_NATIVE_LIFECYCLE_NOT_SUPPLIED');return Reflect.apply(fn,r.owner,[]);}
 function retire(){retired=true;if(active)return;for(const r of held){if(r.retireEntered||r.closed)continue;r.retireEntered=true;active++;try{if(call(r,'retire')!==undefined)throw failure('AI_V6_MOBILE_NATIVE_LIFECYCLE_RESULT');}catch(cause){remember(cause);}finally{active--;}}}
 async function drain(){if(active)throw failure('AI_V6_MOBILE_CUSTODY_ACTIVE');if(closed)return;retire();while(flights.size){await Promise.allSettled([...flights]);retire();}for(const role of roles)for(const r of held){if(r.role!==role||r.closed)continue;retire();active++;try{if(!r.joined){if(await call(r,'join')!==undefined)throw failure('AI_V6_MOBILE_NATIVE_LIFECYCLE_RESULT');r.joined=true;}if(await call(r,'close')!==undefined)throw failure('AI_V6_MOBILE_NATIVE_LIFECYCLE_RESULT');r.closed=true;}catch(cause){remember(cause);throw cause;}finally{active--;}}closed=true;}
 function close(){if(active)return Promise.reject(failure('AI_V6_MOBILE_CUSTODY_ACTIVE'));if(drainFlight)return drainFlight;const p=drain();drainFlight=p;p.then(()=>{if(drainFlight===p)drainFlight=null},()=>{if(drainFlight===p)drainFlight=null});return p;}
 const read=()=>Object.freeze({retired,closed,pending:flights.size,retained:held.length,outstanding:held.filter(r=>!r.closed).length,firstCausePresent:firstPresent,firstCause:first,dataOnly:true,SourceAdmission:false,NativeAdmission:false});
 return Object.freeze({retainOutcome,retainFailure,run,retire,join:close,close,read});
}
