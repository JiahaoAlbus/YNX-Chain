// Private custody facade, not a Native/Source brand or public factory/provider.
import {types} from 'node:util';
import {acquireOriginalWPRMaterializationLoanV1} from './original-wpr-materialization-native-entry.mjs';
import {assembleOriginalWPRMaterializationDATA} from './original-wpr-materialization-host-data-private.mjs';
const methods=['readCapturedPublicOriginals','readIndependentMaterializationOriginals','assertCurrent','recheck','retire','join','close','isClosed'];
const fault=code=>Object.assign(Error(code),{code}),zero=args=>{if(args.length)throw fault('WPR_REQUIRED_LOAN_ZERO_ARGUMENTS')};
function descriptors(x){if(!x||types.isProxy(x)||Object.getPrototypeOf(x)!==Object.prototype)throw fault('WPR_NATIVE_MODEL_INVALID');return Object.getOwnPropertyDescriptors(x)}
function values(ds,keys){if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))throw fault('WPR_NATIVE_MODEL_INVALID');return Object.fromEntries(keys.map(k=>[k,ds[k].value]))}
// This constructor is private and callable only after the fixed actual Native
// acquisition returns. MODEL fixtures reach it only by isolated source staging.
function retain(rawOwner){
 let refs={},modelError=null;try{const d=descriptors(rawOwner);values(d,methods);for(const k of methods){if(typeof d[k].value!=='function')throw fault('WPR_NATIVE_MODEL_INVALID');refs[k]=d[k].value}}catch(e){modelError=e;try{const d=descriptors(rawOwner);for(const k of methods)if(d[k]&&Object.hasOwn(d[k],'value')&&typeof d[k].value==='function')refs[k]=d[k].value}catch{}}
 let active=0,retired=false,retireRequested=false,retireSent=false,physicalDone=false,firstPresent=false,first=null,lastValue=null,facade;
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e}},live=()=>{if(firstPresent)throw first;if(physicalDone)throw fault('WPR_REQUIRED_LOAN_CLOSED');if(retired)throw fault('WPR_REQUIRED_LOAN_RETIRED')};
 function call(name){if(typeof refs[name]!=='function')throw modelError??fault('WPR_NATIVE_MODEL_INVALID');let raw;try{raw=Reflect.apply(refs[name],rawOwner,[])}catch(e){remember(e);throw e}
  // Methods are formally synchronous. Retain the SAME owner on a protocol
  // mismatch; observe actual Promise rejection without treating it as ready.
  if(types.isPromise(raw)){Promise.prototype.then.call(raw,()=>{},()=>{});throw fault('WPR_NATIVE_MODEL_INVALID')}
  const d=descriptors(raw);if(d.value&&Object.hasOwn(d.value,'value'))lastValue=d.value.value;
  const v=values(d,['value','errorPresent','error','physicalDone']);if(typeof v.errorPresent!=='boolean'||typeof v.physicalDone!=='boolean')throw fault('WPR_NATIVE_MODEL_INVALID');if(v.physicalDone)physicalDone=true;
  if(v.errorPresent){remember(v.error);throw v.error}return v.value;
 }
 function flushRetire(){if(active||!retireRequested||retireSent||physicalDone)return;retireSent=true;active++;try{call('retire')}catch(e){remember(e)}finally{active--}}
 function run(fn){if(active)throw fault('WPR_REQUIRED_LOAN_BUSY');active++;try{return fn()}catch(e){remember(e);throw first}finally{active--;flushRetire()}}
 const same=self=>{if(self!==facade)throw fault('WPR_REQUIRED_LOAN_SAME_RECEIVER')};
 function read(name,assemble){return run(()=>{live();call('assertCurrent');live();let result,errorPresent=false,error;try{const raw=call(name);live();result=assemble(raw)}catch(e){errorPresent=true;error=e;remember(e)}try{call('assertCurrent');live()}catch(e){remember(e);if(!errorPresent){errorPresent=true;error=e}}if(errorPresent)throw error;live();return result})}
 const captured=value=>{const v=values(descriptors(value),['root','enrollment','profile','acquisitionHead']);for(const [k,cap] of [['root',16384],['enrollment',393216],['profile',393216],['acquisitionHead',393216]])if(typeof v[k]!=='string'||!v[k]||!v[k].isWellFormed()||Buffer.byteLength(v[k])>cap)throw fault('WPR_NATIVE_CAPTURED_ORIGINALS_INVALID');return Object.freeze(v)};
 async function cleanup(name){if(active)throw fault('WPR_REQUIRED_LOAN_BUSY');retired=true;retireRequested=true;flushRetire();if(!physicalDone)run(()=>call(name));if(firstPresent)throw first;}
 facade=Object.freeze({
  readCapturedPublicOriginals(){same(this);zero(arguments);return read('readCapturedPublicOriginals',captured)},
  readIndependentMaterializationDATA(){same(this);zero(arguments);return read('readIndependentMaterializationOriginals',raw=>assembleOriginalWPRMaterializationDATA(raw).data)},
  assertCurrent(){same(this);zero(arguments);return run(()=>{live();call('assertCurrent');live()})},
  async recheck(){same(this);zero(arguments);run(()=>{live();call('recheck');live()})},
  retire(){same(this);zero(arguments);if(physicalDone)return;retired=true;retireRequested=true;flushRetire();if(firstPresent)throw first;},
  async join(){same(this);zero(arguments);await cleanup('join')},
  async close(){same(this);zero(arguments);await cleanup('close')},
  isClosed(){same(this);zero(arguments);if(physicalDone)return true;if(active)return false;return run(()=>{if(typeof refs.isClosed!=='function')throw modelError??fault('WPR_NATIVE_MODEL_INVALID');const r=Reflect.apply(refs.isClosed,rawOwner,[]);if(typeof r!=='boolean')throw fault('WPR_NATIVE_MODEL_INVALID');if(r)physicalDone=true;return physicalDone})}
 });
 return{owner:facade,remember,get errorPresent(){return firstPresent},get error(){return first},modelError};
}
export function acquireRequiredWPRIssuerPublicOriginalLoanV1(){zero(arguments);let held=null;try{
 const raw=acquireOriginalWPRMaterializationLoanV1(),d=descriptors(raw);
 // Custody is established before errorPresent/other result schema is inspected.
 if(d.owner&&Object.hasOwn(d.owner,'value')&&d.owner.value!==null&&d.owner.value!==undefined)held=retain(d.owner.value);
 const v=values(d,['owner','errorPresent','error']);if(typeof v.errorPresent!=='boolean')throw fault('WPR_NATIVE_MODEL_INVALID');
 if(v.errorPresent){if(held)held.remember(v.error);return Object.freeze({owner:held?.owner??null,errorPresent:true,error:v.error})}
 if(!held)throw fault('WPR_NATIVE_MODEL_INVALID');if(held.modelError){held.remember(held.modelError);return Object.freeze({owner:held.owner,errorPresent:true,error:held.modelError})}
 return Object.freeze({owner:held.owner,errorPresent:false});
 }catch(e){if(held)held.remember(e);return Object.freeze({owner:held?.owner??null,errorPresent:true,error:e})}}
