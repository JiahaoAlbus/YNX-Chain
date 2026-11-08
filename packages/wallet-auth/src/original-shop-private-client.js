// Fixed-image Node custody/transport only. Shop's original caller owns its business validator.
import {types} from 'node:util';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
const states=new WeakMap(),retained=new Set(),permit=Symbol('private construction');
let selected=null,slot=null;
function descriptors(v){if(!v||typeof v!=='object'||types.isProxy(v))fail('SHOP_NATIVE_MODEL_INVALID');return Object.getOwnPropertyDescriptors(v);}
function record(v,keys){const d=descriptors(v),names=Reflect.ownKeys(d);if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')))fail('SHOP_NATIVE_MODEL_INVALID');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function fixed(){
 const image=loadOriginalAuthIdentityNativeImage();if(!image||types.isProxy(image))fail('SHOP_NATIVE_EXPORTS_NOT_SUPPLIED');
 const d=Object.getOwnPropertyDescriptors(image),a=d.acquireOriginalShopPrivateClient,r=d.isOriginalShopPrivateClient;
 if(!a||!r||!Object.hasOwn(a,'value')||!Object.hasOwn(r,'value')||typeof a.value!=='function'||typeof r.value!=='function'||types.isProxy(a.value)||types.isProxy(r.value))fail('SHOP_NATIVE_EXPORTS_NOT_SUPPLIED');
 if(selected&&(selected.image!==image||selected.acquire!==a.value||selected.recognize!==r.value))fail('SHOP_NATIVE_FIXED_IMAGE_CHANGED');
 return selected??=Object.freeze({image,acquire:a.value,recognize:r.value});
}
function remember(s,error){if(!s.first)s.first={error};return s.first.error;}
function capture(raw,names){const out={};let error;try{const d=descriptors(raw);for(const name of names){const v=d[name];if(!v||!Object.hasOwn(v,'value')||typeof v.value!=='function'||types.isProxy(v.value)){error??=Object.assign(Error('SHOP_NATIVE_METHOD_NOT_SUPPLIED'),{code:'SHOP_NATIVE_METHOD_NOT_SUPPLIED'});continue;}out[name]=v.value;}}catch(e){error=e;}return{refs:Object.freeze(out),error};}
function call(s,raw,refs,name,args=[]){if(typeof refs[name]!=='function')fail('SHOP_NATIVE_METHOD_NOT_SUPPLIED');s.active++;try{return Reflect.apply(refs[name],raw,args);}finally{s.active--;}}
function invoke(s,name,args=[]){return call(s,s.raw,s.refs,name,args);}
function state(owner){const s=states.get(owner);if(!s)fail('SHOP_NATIVE_SAME_OWNER_REQUIRED');return s;}
function recognize(s){s.active++;try{return Reflect.apply(s.native.recognize,s.native.image,[s.raw]);}finally{s.active--;}}
function genuine(s){const v=recognize(s);if(typeof v!=='boolean')fail('SHOP_NATIVE_RECOGNIZER_RESULT_INVALID');if(!v)fail('SHOP_NATIVE_ORIGINAL_CLIENT_REQUIRED');}
function current(s){if(s.first)throw s.first.error;if(s.retired||s.closed)fail('SHOP_NATIVE_RETIRED');genuine(s);if(invoke(s,'current')!==undefined)fail('SHOP_NATIVE_SYNC_VOID_REQUIRED');}
function custody(s,raw=s.raw,refs=s.refs){const v=record(call(s,raw,refs,'readOriginalCustodyDATA'),['selected','unknown','physicalDone']);if(Object.values(v).some(x=>typeof x!=='boolean'))fail('SHOP_NATIVE_CUSTODY_INVALID');return Object.freeze(v);}
function closed(s){if(s.closed)return true;if(s.responses.size||s.inflight||s.active)return false;const c=custody(s);if(c.physicalDone){s.closed=true;retained.delete(s);if(slot===s)slot=null;}return s.closed;}
const ta=Object.getPrototypeOf(Uint8Array.prototype),byteLength=Object.getOwnPropertyDescriptor(ta,'byteLength').get,byteBuffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set,resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
function copy(v,cap){if(types.isProxy(v)||!types.isUint8Array(v))fail('SHOP_NATIVE_BYTES_INVALID');const n=byteLength.call(v),b=byteBuffer.call(v);if(!n||n>cap||types.isSharedArrayBuffer(b)||resizable?.call(b))fail('SHOP_NATIVE_BYTES_BOUND');const out=new Uint8Array(n);set.call(out,v);return out;}
function utf8(v,cap){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(copy(v,cap));}
// Generic bounded JSON validation; no invoice/business field names or authority.
function json(raw,cap){
 const text=utf8(raw,cap);let i=0,nodes=0;const ws=()=>{while(i<text.length&&/[ \r\n\t]/.test(text[i]))i++;};
 function string(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"'){const v=JSON.parse(text.slice(start,i));if(!v.isWellFormed())fail('SHOP_NATIVE_JSON_STRING');return v;}}fail('SHOP_NATIVE_JSON_EOF');}
 function value(depth){
  if(depth>32||++nodes>20000)fail('SHOP_NATIVE_JSON_BOUND');ws();const c=text[i];if(c==='"'){string();return;}
  if(c==='{'||c==='['){const object=c==='{',seen=new Set();i++;ws();if(text[i]===(object?'}':']')){i++;return;}for(;;){if(object){if(text[i]!=='"')fail('SHOP_NATIVE_JSON_KEY');const key=string();if(seen.has(key)||['__proto__','prototype','constructor'].includes(key))fail('SHOP_NATIVE_JSON_DUPLICATE_OR_PROTOTYPE');seen.add(key);ws();if(text[i++]!==':')fail('SHOP_NATIVE_JSON_COLON');}value(depth+1);ws();if(text[i]===(object?'}':']')){i++;return;}if(text[i++]!==',')fail('SHOP_NATIVE_JSON_COMMA');ws();}}
  const start=i;while(i<text.length&&!/[ \r\n\t,}\]]/.test(text[i]))i++;if(i===start)fail('SHOP_NATIVE_JSON_VALUE');const v=JSON.parse(text.slice(start,i));if(typeof v==='number'&&(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v)))fail('SHOP_NATIVE_JSON_NUMBER');
 }
 value(0);ws();if(i!==text.length)fail('SHOP_NATIVE_JSON_TRAILING');const parsed=JSON.parse(text);function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}return freeze(parsed);
}
function guard(fn){
 if(typeof fn!=='function'||types.isProxy(fn))fail('SHOP_NATIVE_CURRENT_REQUIRED');const d=Object.getOwnPropertyDescriptor(fn,'signal');if(!d||!Object.hasOwn(d,'value')||types.isProxy(d.value))fail('SHOP_NATIVE_CURRENT_REQUIRED');
 const signal=d.value,get=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;get.call(signal);
 return{fn,signal,check(s){const now=Object.getOwnPropertyDescriptor(fn,'signal');if(!now||!Object.hasOwn(now,'value')||now.value!==signal)fail('SHOP_NATIVE_CURRENT_CHANGED');if(get.call(signal))fail('SHOP_NATIVE_ABORTED');s.active++;try{if(Reflect.apply(fn,undefined,[])!==undefined)fail('SHOP_NATIVE_SYNC_VOID_REQUIRED');}finally{s.active--;}if(get.call(signal))fail('SHOP_NATIVE_ABORTED');}};
}
function packet(raw,adopt){const d=descriptors(raw);let owner=null;if(d.owner&&Object.hasOwn(d.owner,'value')&&d.owner.value!==null&&d.owner.value!==undefined)owner=adopt(d.owner.value);if(!Object.hasOwn(d.errorPresent??{},'value')||typeof d.errorPresent.value!=='boolean')fail('SHOP_NATIVE_MODEL_INVALID');const v=record(raw,d.errorPresent.value?['owner','errorPresent','error']:['owner','errorPresent']);return{owner,errorPresent:v.errorPresent,error:v.error};}
function adoptResponse(s,raw){const c={raw,refs:{},modelError:null,selectedPromise:null,busy:null,done:false,original:null};s.responses.add(c);const captured=capture(raw,['readOriginalTransportDATA','release','readOriginalCustodyDATA']);c.refs=captured.refs;c.modelError=captured.error;return c;}
async function releaseResponse(s,c){
 if(c.done)return;if(c.busy)return c.busy;
 c.busy=Promise.resolve().then(async()=>{let observed;try{observed=custody(s,c.raw,c.refs);if(observed.physicalDone){c.done=true;s.responses.delete(c);return;}
  let p=c.selectedPromise;if(!p){if(observed.unknown)fail('SHOP_NATIVE_RESPONSE_DEBT_UNKNOWN');p=call(s,c.raw,c.refs,'release');if(!types.isPromise(p))fail('SHOP_NATIVE_RELEASE_PROMISE_REQUIRED');try{const after=custody(s,c.raw,c.refs);if(after.unknown||after.physicalDone)c.selectedPromise=p;}catch(error){remember(s,error);c.selectedPromise=p;}}
  try{await p;}catch(error){remember(s,error);}
  observed=custody(s,c.raw,c.refs);if(observed.physicalDone){c.done=true;s.responses.delete(c);}else fail('SHOP_NATIVE_RESPONSE_DEBT_PENDING');
 }catch(error){remember(s,error);throw error;}});const active=c.busy;try{return await active;}finally{if(c.busy===active)c.busy=null;}
}
function transport(s,c,order){
 if(c.modelError)throw c.modelError;const r=record(call(s,c.raw,c.refs,'readOriginalTransportDATA'),['status','methodOriginal','pathOriginal','contentTypeOriginal','bodyOriginal']);
 c.original=Object.freeze({status:r.status,methodOriginal:copy(r.methodOriginal,8),pathOriginal:copy(r.pathOriginal,256),contentTypeOriginal:copy(r.contentTypeOriginal,128),bodyOriginal:copy(r.bodyOriginal,1<<20)});s.observations.set(order,c.original);
 if(r.status!==200||utf8(c.original.methodOriginal,8)!=='GET'||utf8(c.original.pathOriginal,256)!=='/v5/shop/source/shop.order/invoice-intents/'+order||utf8(c.original.contentTypeOriginal,128)!=='application/json')fail('SHOP_NATIVE_TRANSPORT_BINDING');
 return json(c.original.bodyOriginal,1<<20);
}
async function read(s,order,g){let child=null,result;try{current(s);g.check(s);const p=invoke(s,'readOriginalShopInvoiceTransport',[order,g.fn]);if(!types.isPromise(p))fail('SHOP_NATIVE_READ_PROMISE_REQUIRED');const out=packet(await p,v=>(child=adoptResponse(s,v)));if(out.errorPresent)throw out.error;if(!child)fail('SHOP_NATIVE_RESPONSE_NOT_SUPPLIED');g.check(s);current(s);result=transport(s,child,order);g.check(s);current(s);}catch(error){remember(s,error);}finally{if(child)try{await releaseResponse(s,child);}catch(error){remember(s,error);}s.inflight--;}
 if(s.first)throw s.first.error;try{g.check(s);current(s);}catch(error){throw remember(s,error);}return result;
}
async function drainChildren(s){for(const c of [...s.responses])try{await releaseResponse(s,c);}catch(error){remember(s,error);}if(s.responses.size)throw s.first?s.first.error:Object.assign(Error('SHOP_NATIVE_RESPONSE_DEBT_PENDING'),{code:'SHOP_NATIVE_RESPONSE_DEBT_PENDING'});}
class ShopClient {
 constructor(key,s){if(key!==permit)fail('SHOP_NATIVE_PRIVATE_CONSTRUCTOR');states.set(this,s);Object.freeze(this);}
 current(){if(arguments.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');return current(state(this));}
 readOriginalScopeDATA(){if(arguments.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');const s=state(this);current(s);try{const v=json(invoke(s,'readOriginalScopeDATA'),32768);current(s);return v;}catch(error){throw remember(s,error);}}
 readOriginalShopNativeInvoiceRequestDATA(order,callerCurrent){
  const s=state(this);if(arguments.length!==2||typeof order!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(order))fail('SHOP_NATIVE_ORDER_INVALID');const g=guard(callerCurrent);
  const previous=s.reads.get(order);if(previous){if(previous.status!=='rejected'){current(s);g.check(s);}return previous.promise;}if(s.inflight||s.cleanupBusy||s.active)fail('SHOP_NATIVE_OPERATION_PENDING');if(s.reads.size>=64)fail('SHOP_NATIVE_READ_HISTORY_BOUND');s.inflight++;const entry={promise:null,guard:g.fn,signal:g.signal,status:'pending'};const p=Promise.resolve().then(()=>read(s,order,g)).then(value=>{entry.status='fulfilled';return value;},error=>{entry.status='rejected';throw error;});entry.promise=p;s.reads.set(order,entry);return p;
 }
 retire(){if(arguments.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');const s=state(this);s.retired=true;if(s.retireSelected){if(s.retireError)throw s.retireError.error;return;}s.retireSelected=true;try{if(invoke(s,'retire')!==undefined)fail('SHOP_NATIVE_SYNC_VOID_REQUIRED');}catch(error){s.retireError={error};throw remember(s,error);}}
 readOriginalCustodyDATA(){if(arguments.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');return custody(state(this));}
 async join(){
  if(arguments.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');const s=state(this);if(s.cleanupBusy||s.inflight||s.active)fail('SHOP_NATIVE_CLEANUP_PENDING');s.cleanupBusy=true;s.retired=true;
  try{await drainChildren(s);const p=invoke(s,'join');if(!types.isPromise(p))fail('SHOP_NATIVE_JOIN_PROMISE_REQUIRED');await p;}catch(error){remember(s,error);}finally{s.cleanupBusy=false;}if(s.first)throw s.first.error;
 }
 async close(){
  if(arguments.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');const s=state(this);if(s.closed){if(s.first)throw s.first.error;return;}if(s.cleanupBusy||s.inflight||s.active)fail('SHOP_NATIVE_CLEANUP_PENDING');
  try{this.retire();}catch(error){remember(s,error);}s.cleanupBusy=true;
  try{await drainChildren(s);const before=custody(s);if(!before.physicalDone){let p=s.closePromise;if(!p){p=invoke(s,'close');if(!types.isPromise(p))fail('SHOP_NATIVE_CLOSE_PROMISE_REQUIRED');const after=custody(s);if(after.unknown||after.physicalDone)s.closePromise=p;}try{await p;}catch(error){remember(s,error);}}closed(s);if(!s.closed)fail('SHOP_NATIVE_PARENT_DEBT_PENDING');}catch(error){remember(s,error);}finally{s.cleanupBusy=false;}if(s.first)throw s.first.error;
 }
 isClosed(){if(arguments.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');return closed(state(this));}
}
Object.freeze(ShopClient.prototype);Object.freeze(ShopClient);
export function acquireOriginalShopPrivateClient(...args){
 if(args.length)fail('SHOP_NATIVE_ZERO_ARGUMENTS');if(slot)fail('SHOP_NATIVE_ORIGINAL_OWNER_DRAIN_PENDING');slot={uncertain:true};let n,raw,called=false;
 try{n=fixed();called=true;raw=Reflect.apply(n.acquire,n.image,[]);}catch(error){if(!called)slot=null;throw error;}
 let held=null,out;try{out=packet(raw,v=>{const s={raw:v,native:n,refs:{},first:null,modelError:null,responses:new Set(),reads:new Map(),observations:new Map(),inflight:0,active:0,retired:false,retireSelected:false,retireError:null,cleanupBusy:false,closePromise:null,closed:false};held=s;slot=s;retained.add(s);s.owner=new ShopClient(permit,s);const c=capture(v,['current','readOriginalScopeDATA','readOriginalShopInvoiceTransport','retire','join','close','readOriginalCustodyDATA']);s.refs=c.refs;s.modelError=c.error;return s.owner;});if(out.errorPresent){if(held)remember(held,out.error);}else if(!held||held.modelError)throw held?.modelError??Object.assign(Error('SHOP_NATIVE_OWNER_REQUIRED'),{code:'SHOP_NATIVE_OWNER_REQUIRED'});}catch(error){if(held)remember(held,error);return Object.freeze({owner:held?.owner??null,errorPresent:true,error:held?.first?held.first.error:error});}
 if(!held)slot=null;return Object.freeze({owner:out.owner,errorPresent:out.errorPresent,...(out.errorPresent?{error:held?.first?held.first.error:out.error}:{})});
}
/** Actual Native custody identity only; Source/current/permission remain independent. */
export function isOriginalShopPrivateClient(value){if(arguments.length!==1)fail('SHOP_NATIVE_RECOGNIZER_ARGUMENTS');const s=states.get(value);if(!s)return false;const v=recognize(s);if(typeof v!=='boolean')fail('SHOP_NATIVE_RECOGNIZER_RESULT_INVALID');return v;}
