// PRIVATE normal SDK helper, not a public Source/provider setter. Only its
// same-module selectedParent closure supplies the fixed native implementation.
// Mapping DATA never grants E11, GET, workspace, a project or business rights.
const fail=code=>Object.assign(new Error(code),{code});
import {types} from 'node:util';
function data(v,depth=0){
 if(depth>12)throw fail('IDE_CLOUD_DATA_DEPTH');
 if(v&&types.isProxy(v))throw fail('IDE_CLOUD_DATA_PROXY');
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v))return v;
 if(Array.isArray(v)){const a=[];if(Reflect.ownKeys(v).length!==v.length+1)throw fail('IDE_CLOUD_DATA_ARRAY');for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw fail('IDE_CLOUD_DATA_ARRAY');a.push(data(d.value,depth+1));}return a;}
 if(!v||Object.getPrototypeOf(v)!==Object.prototype)throw fail('IDE_CLOUD_DATA_REQUIRED');
 const result={};for(const key of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!d||!d.enumerable||!Object.hasOwn(d,'value')||['__proto__','constructor','prototype'].includes(key))throw fail('IDE_CLOUD_DATA_PROPERTY');Object.defineProperty(result,key,{value:data(d.value,depth+1),enumerable:true,writable:true,configurable:true});}return result;
}
class OriginalProjectLookup {
 #native;#handle;#retired=false;#closed=false;#firstPresent=false;#first;#closeSelected=false;#closeFailed=false;#closeCause;
 constructor(native,handle){this.#native=native;this.#handle=handle;}
 remember(cause){if(!this.#firstPresent){this.#firstPresent=true;this.#first=cause;}return cause;}
 assertCurrent(){if(this.#retired||this.#closed||this.#firstPresent)throw this.#firstPresent?this.#first:fail('IDE_CLOUD_LOOKUP_RETIRED');try{if(this.#native.assertOriginalIDECloudProjectLookupCurrent(this.#handle)!==undefined)throw fail('IDE_CLOUD_LOOKUP_CURRENT_RESULT');}catch(e){this.remember(e);throw e;}}
 readOriginalMappingDATA(){this.assertCurrent();try{const v=data(this.#native.readOriginalIDECloudProjectLookupDATA(this.#handle));this.assertCurrent();return v;}catch(e){this.remember(e);throw e;}}
 retire(){if(this.#retired)return;this.#retired=true;try{if(this.#native.retireOriginalIDECloudProjectLookup(this.#handle)!==undefined)throw fail('IDE_CLOUD_LOOKUP_RETIRE_RESULT');}catch(e){this.remember(e);throw e;}}
 join(){if(!this.#retired)throw fail('IDE_CLOUD_LOOKUP_NOT_RETIRED');if(this.#closed)return;try{if(this.#native.joinOriginalIDECloudProjectLookup(this.#handle)!==undefined)throw fail('IDE_CLOUD_LOOKUP_JOIN_PENDING');}catch(e){this.remember(e);throw e;}}
 close(){if(this.#closed)return;if(this.#closeSelected){if(this.#closeFailed)throw this.#closeCause;return;}this.retire();this.join();this.#closeSelected=true;try{if(this.#native.closeOriginalIDECloudProjectLookup(this.#handle)!==undefined)throw fail('IDE_CLOUD_LOOKUP_CLOSE_UNKNOWN');this.#closed=true;}catch(e){this.#closeFailed=true;this.#closeCause=e;this.remember(e);throw e;}}
 statusDATA(){return Object.freeze({retired:this.#retired,closed:this.#closed,firstCausePresent:this.#firstPresent,firstCause:this.#first,closeSelected:this.#closeSelected,closeFailed:this.#closeFailed,RootAdmission:false,CloudGETAuthority:false,E11Authority:false});}
}
Object.freeze(OriginalProjectLookup.prototype);
export function captureOriginalIDECloudProjectLookupPrivate(native,actualParent,actualWorkspaceSelection){
 let owner=null,held=null;
 try{
  const handle=native.acquireOriginalIDECloudProjectLookup(actualParent,actualWorkspaceSelection);
  if(handle===null||handle===undefined)throw fail('IDE_CLOUD_LOOKUP_NOT_SUPPLIED');
  held=new OriginalProjectLookup(native,handle); // adopt nonnull partial FIRST
  // P03's retained original caller freezes OWN lifecycle methods. A prototype
  // method alone is intentionally not accepted as a partial custody contract.
  owner=Object.freeze({assertCurrent:()=>held.assertCurrent(),readOriginalMappingDATA:()=>held.readOriginalMappingDATA(),retire:()=>held.retire(),join:()=>held.join(),close:()=>held.close(),statusDATA:()=>held.statusDATA()});
  owner.assertCurrent();return Object.freeze({owner,failed:false,error:null});
 }catch(error){held?.remember(error);return Object.freeze({owner,failed:true,error});}
}
