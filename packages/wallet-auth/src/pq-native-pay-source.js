// Fixed original Auth image only. Never a Main selector, JS Source brand,
// provider installer, private peer constructor or standalone-addon loader.
import{types}from'node:util';
import{loadOriginalAuthIdentityNativeImage}from'./original-auth-identity-fixed-native-image.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
let selected=null;
function record(v,keys){if(!v||types.isProxy(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('PAY_NATIVE_SOURCE_INPUT_INVALID');const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')))fail('PAY_NATIVE_SOURCE_INPUT_INVALID');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function dataFields(v,required){if(!v||types.isProxy(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('PAY_NATIVE_SOURCE_INPUT_INVALID');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).some(k=>typeof k!=='string'||!Object.hasOwn(d[k],'value'))||required.some(k=>!Object.hasOwn(d,k)))fail('PAY_NATIVE_SOURCE_INPUT_INVALID');return Object.fromEntries(required.map(k=>[k,d[k].value]));}
function input(v){const i=record(v,['request','original','target']);if(i.request!==null&&(typeof i.request!=='object'||types.isProxy(i.request)))fail('PAY_NATIVE_SOURCE_INPUT_INVALID');const o=dataFields(i.original,['account','hash','operationId','typed']),t=dataFields(o.typed,['networkId','memberHash']);if(typeof o.account!=='string'||!/^0x[0-9a-f]{40}$/.test(o.account)||typeof o.hash!=='string'||!/^0x[0-9a-f]{64}$/.test(o.hash)||typeof o.operationId!=='string'||!o.operationId||o.operationId.length>128||typeof t.networkId!=='string'||!/^[0-9a-f]{64}$/.test(t.networkId)||typeof t.memberHash!=='string'||!/^0x[0-9a-f]{64}$/.test(t.memberHash))fail('PAY_NATIVE_SOURCE_INPUT_INVALID');record(i.target,['version','service','kind','intentId','merchant','invoiceId','requestPath']);
 // SAME request/original/target references are retained. Metadata validation
 // never creates a Native owner or substitutes for protected Main capture.
 return Object.freeze(i);}
function fixed(){const image=loadOriginalAuthIdentityNativeImage();if(!image||types.isProxy(image))fail('PAY_NATIVE_FIXED_IMAGE_EXPORTS_NOT_SUPPLIED');if(selected&&selected.image!==image)fail('PAY_NATIVE_FIXED_IMAGE_CHANGED');const a=Object.getOwnPropertyDescriptor(image,'acquireOriginalPaySource'),r=Object.getOwnPropertyDescriptor(image,'isOriginalPaySource');if(!a||!r||!Object.hasOwn(a,'value')||!Object.hasOwn(r,'value')||typeof a.value!=='function'||typeof r.value!=='function'||types.isProxy(a.value)||types.isProxy(r.value))fail('PAY_NATIVE_FIXED_IMAGE_EXPORTS_NOT_SUPPLIED');if(!selected)selected=Object.freeze({image,acquire:a.value,recognize:r.value});return selected;}
function recognized(native,value){if(value===null||typeof value!=='object'||types.isProxy(value))return false;const result=Reflect.apply(native.recognize,native.image,[value]);if(typeof result!=='boolean')fail('PAY_NATIVE_RECOGNIZER_RESULT_INVALID');return result;}
export function acquireOriginalPaySource(...args){if(args.length!==1)fail('PAY_NATIVE_SOURCE_ARGUMENTS');const captured=input(args[0]),native=fixed();let out;
 try{out=Reflect.apply(native.acquire,native.image,[captured]);}
 catch(cause){
  // Actual NAPI has already adopted its native out before pending exceptions.
  // Inspect only an own DATA partial, before anything else about this error.
  // Do not wrap, truth-test or clean an upstream owner/parent permission here.
  if(cause!==null&&['object','function'].includes(typeof cause)&&!types.isProxy(cause)){const d=Object.getOwnPropertyDescriptor(cause,'partial');if(d&&Object.hasOwn(d,'value')&&d.value!==null&&d.value!==undefined){try{recognized(native,d.value);}catch{ /* Identity failure never replaces SAME first error/partial. */ }}}
  throw cause;
 }
 if(!recognized(native,out))fail('PAY_NATIVE_SOURCE_RESULT_INVALID');return out;
}
/** Native identity recognition is also available for a previously adopted
 * partial after current admission is lost, solely to drain that SAME owner.
 * This does not assert currentness/permission and cannot admit a DTO. */
export function isOriginalPaySource(...args){if(args.length!==1)fail('PAY_NATIVE_RECOGNIZER_ARGUMENTS');return selected?recognized(selected,args[0]):false;}
