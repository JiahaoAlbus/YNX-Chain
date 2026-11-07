// PRIVATE normal SDK helper, not a public Source/provider setter. Only its
// same-module selectedParent closure supplies the fixed native implementation.
// Mapping DATA never grants E11, GET, workspace, a project or business rights.
const fail=code=>Object.assign(new Error(code),{code});
import {types} from 'node:util';
const mappingFields=Object.freeze(['version','account','catalogProjectId','registeredCloudFullRef','resourceApprovalRef','projectRevision','catalogRevision','currentReference','issuedAtMs','expiresAtMs']);
const refFields=Object.freeze(['realm','tenant','kind','id','rev']);
function exactCopy(v,fields){
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)throw fail('IDE_CLOUD_LOOKUP_DATA_RECORD');
 const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);
 if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))throw fail('IDE_CLOUD_LOOKUP_DATA_FIELDS');
 return Object.fromEntries(fields.map(k=>[k,d[k].value]));
}
// Native text rule: nonempty UTF8 at most 256 bytes, no whitespace/newlines.
// This DATA check does not reconstruct or authenticate any parent/selection.
function text(v){return typeof v==='string'&&v.length>0&&v.isWellFormed()&&Buffer.byteLength(v,'utf8')<=256&&!/\p{White_Space}/u.test(v);}
function u64(v){return typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;}
/** Pure shape/copy DATA only. No clock, Source brand, endpoint or qualification.
 * Native retains actual account/project/current/window and protected fullref
 * selection bindings. Fresh Native current is required by the normal getter. */
export function inspectOriginalIDECloudProjectLookupDATA(value){
 const m=exactCopy(value,mappingFields),r=exactCopy(m.registeredCloudFullRef,refFields);
 if(m.version!=='YNX-IDE-CLOUD-PROJECT-LOOKUP/v1')throw fail('IDE_CLOUD_LOOKUP_DATA_VERSION');
 if(!['account','catalogProjectId','resourceApprovalRef','projectRevision','catalogRevision','currentReference'].every(k=>text(m[k]))||!['realm','tenant','kind','id'].every(k=>text(r[k])))throw fail('IDE_CLOUD_LOOKUP_DATA_TEXT');
 if(!u64(r.rev))throw fail('IDE_CLOUD_LOOKUP_DATA_REVISION');
 if(!Number.isSafeInteger(m.issuedAtMs)||m.issuedAtMs<1||!Number.isSafeInteger(m.expiresAtMs)||m.expiresAtMs<=m.issuedAtMs)throw fail('IDE_CLOUD_LOOKUP_DATA_WINDOW');
 return Object.freeze({...m,registeredCloudFullRef:Object.freeze(r)});
}
class OriginalProjectLookup {
 #native;#handle;#retired=false;#closed=false;#firstPresent=false;#first;#closeSelected=false;#closeFailed=false;#closeCause;
 constructor(native,handle){this.#native=native;this.#handle=handle;}
 remember(cause){if(!this.#firstPresent){this.#firstPresent=true;this.#first=cause;}return cause;}
 assertCurrent(){if(this.#retired||this.#closed||this.#firstPresent)throw this.#firstPresent?this.#first:fail('IDE_CLOUD_LOOKUP_RETIRED');try{if(this.#native.assertOriginalIDECloudProjectLookupCurrent(this.#handle)!==undefined)throw fail('IDE_CLOUD_LOOKUP_CURRENT_RESULT');}catch(e){this.remember(e);throw e;}}
 readOriginalMappingDATA(){this.assertCurrent();try{const v=inspectOriginalIDECloudProjectLookupDATA(this.#native.readOriginalIDECloudProjectLookupDATA(this.#handle));this.assertCurrent();return v;}catch(e){this.remember(e);throw e;}}
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
