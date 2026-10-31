// New OPEN compatibility WIRE for the existing private/v1 DATA contract.
// No policy verifier, authority store, signer, service route or effect engine.
import{types}from'node:util';
import{encodeFields,decodeFields}from'./framing.js';
export const BOUND_GRANT_DOMAIN='YNX-OPEN/BOUND-GRANT/1';
export const GRANT_EFFECT_DOMAIN='YNX-OPEN/GRANT-EFFECT/1';
export const BOUND_GRANT_DATA_VERSION='AUTH-BOUND-GRANT-PRIVATE/v1';
const MAX=1048576,U64=0xffffffffffffffffn,utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const fail=(reason,code='INVALID')=>{throw Object.assign(new Error(reason),{code})};
function capture(v,depth=0,budget={n:0}){
 if(depth>16)fail('DATA nesting','BOUNDS');if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string'){budget.n+=utf8.encode(v).length;if(budget.n>MAX)fail('DATA budget','BOUNDS');return v}
 if(!v||typeof v!=='object'||types.isProxy(v))fail('plain DATA required');
 if(Array.isArray(v)){if(v.length>1024||Reflect.ownKeys(v).length!==v.length+1)fail('list bounds','BOUNDS');const out=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value'))fail('data list required');out.push(capture(d.value,depth+1,budget))}return Object.freeze(out)}
 if(Object.getPrototypeOf(v)!==Object.prototype)fail('plain record required');const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);if(keys.length>128||keys.some(k=>typeof k!=='string'))fail('record bounds','BOUNDS');const out={};for(const k of keys){if(['__proto__','constructor','prototype'].includes(k)||!Object.hasOwn(ds[k],'value'))fail('data record required');budget.n+=utf8.encode(k).length;if(budget.n>MAX)fail('DATA budget','BOUNDS');out[k]=capture(ds[k].value,depth+1,budget)}return Object.freeze(out);
}
function exact(v,keys){if(!v||Array.isArray(v)||typeof v!=='object'||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('exact record required');return v}
const legacy=(v,max=256)=>{if(typeof v!=='string'||v.length>max||!/^[A-Za-z0-9._:/-]+$/.test(v))fail('legacy ASCII identifier');return utf8.encode(v)};
function text(b){try{return decoder.decode(b)}catch{fail('invalid UTF8')}}
function uint(v){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>U64)fail('canonical uint64');return BigInt(v)}
function u64(v){const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,uint(v),false);return b}
function read64(b){if(b.length!==8)fail('uint64 width');return new DataView(b.buffer,b.byteOffset,b.byteLength).getBigUint64(0,false).toString()}
function hex(v,n){if(typeof v!=='string'||v.length!==n*2||!/^[a-f0-9]+$/.test(v))fail('canonical hex bytes');const b=new Uint8Array(n);for(let i=0;i<n;i++)b[i]=parseInt(v.slice(i*2,i*2+2),16);return b}
function readHex(b,n){if(b.length!==n)fail('fixed bytes width');let s='';for(let i=0;i<n;i++)s+=b[i].toString(16).padStart(2,'0');return s}
function cmp(a,b){for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return a.length-b.length}
function equal(a,b){return cmp(a,b)===0}
function ordered(rows){for(let i=1;i<rows.length;i++)if(cmp(rows[i-1],rows[i])>=0)fail('unordered or duplicate set')}
function list(v,nonempty=false){if(!Array.isArray(v)||v.length>1024||nonempty&&v.length===0)fail('list bounds','BOUNDS');return v}
function readList(w,nonempty=false){if(w.length<4)fail('list frame');const n=new DataView(w.buffer,w.byteOffset,w.byteLength).getUint32(0,false);if(n>1024||nonempty&&n===0)fail('list count','BOUNDS');return decodeFields(w,n)}
function ref(v){exact(v,['realm','tenant','kind','id','rev']);return encodeFields([legacy(v.realm),legacy(v.tenant),legacy(v.kind),legacy(v.id),u64(v.rev)])}
function readRef(w){const f=decodeFields(w,5);return Object.freeze({realm:text(f[0]),tenant:text(f[1]),kind:text(f[2]),id:text(f[3]),rev:read64(f[4])})}
function bind(v){exact(v,['bytes','sha3_512','sha512']);return encodeFields([u64(v.bytes),hex(v.sha3_512,64),hex(v.sha512,64)])}
function readBind(w){const f=decodeFields(w,3);return Object.freeze({bytes:read64(f[0]),sha3_512:readHex(f[1],64),sha512:readHex(f[2],64)})}
function field(v){if(typeof v!=='string'||!v.length||v.length>128||v.includes('*'))fail('field selector');for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const low=v.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))fail('unpaired surrogate')}else if(c>=0xdc00&&c<=0xdfff)fail('unpaired surrogate')}const b=utf8.encode(v);if(b.length>512)fail('field UTF8 bounds','BOUNDS');return b}
function source(v){exact(v,['ref','fields','label','binding']);const fields=list(v.fields,true).map(field);ordered(fields);if(!['PUBLIC','TENANT','RESTRICTED','VAULT'].includes(v.label))fail('unknown data label');return encodeFields([ref(v.ref),encodeFields(fields),utf8.encode(v.label),bind(v.binding)])}
function readSource(w){const f=decodeFields(w,4);return Object.freeze({ref:readRef(f[0]),fields:Object.freeze(readList(f[1],true).map(text)),label:text(f[2]),binding:readBind(f[3])})}
function sink(v){const keys=['service','tenant','origin','path','region','operation'];exact(v,keys);return encodeFields(keys.map(k=>legacy(v[k])))}
function readSink(w){const f=decodeFields(w,6),keys=['service','tenant','origin','path','region','operation'];return Object.freeze(Object.fromEntries(keys.map((k,i)=>[k,text(f[i])])))}
const STEP=['task','generation','stepId','input','tool','target','purpose','risk','holderSession','sources'];
function step(v){exact(v,STEP);exact(v.tool,['id','version','schema']);exact(v.holderSession,['id','epoch','channel']);if(!['read','write','asset'].includes(v.risk))fail('risk enum');const sources=list(v.sources).map(source),refs=v.sources.map(s=>ref(s.ref));ordered(refs);return encodeFields([ref(v.task),u64(v.generation),legacy(v.stepId),bind(v.input),encodeFields([legacy(v.tool.id),u64(v.tool.version),bind(v.tool.schema)]),sink(v.target),legacy(v.purpose),utf8.encode(v.risk),encodeFields([legacy(v.holderSession.id),u64(v.holderSession.epoch),legacy(v.holderSession.channel)]),encodeFields(sources)])}
function readStep(w){const f=decodeFields(w,10),tool=decodeFields(f[4],3),session=decodeFields(f[8],3);return Object.freeze({task:readRef(f[0]),generation:read64(f[1]),stepId:text(f[2]),input:readBind(f[3]),tool:Object.freeze({id:text(tool[0]),version:read64(tool[1]),schema:readBind(tool[2])}),target:readSink(f[5]),purpose:text(f[6]),risk:text(f[7]),holderSession:Object.freeze({id:text(session[0]),epoch:read64(session[1]),channel:text(session[2])}),sources:Object.freeze(readList(f[9]).map(readSource))})}
const GRANT=['version','id','realm','tenant','issuer','issuerEpoch','holder','holderEpoch','audience','operation','resources','cap','singleMax','validFrom','expires','nonce','rev','nonDelegable','approvalId','binding'];
function grant(g){
 exact(g,GRANT);if(g.version!==BOUND_GRANT_DATA_VERSION||g.nonDelegable!==true)fail('version or nondelegable flag');const issuer=ref(g.issuer),holder=ref(g.holder),resources=list(g.resources,true).map(ref);ordered(resources);const binding=step(g.binding);
 if(g.holder.kind!=='agent'||g.issuer.kind==='agent'||g.issuer.realm!==g.realm||g.holder.realm!==g.realm||g.issuer.tenant!==g.tenant||g.holder.tenant!==g.tenant||uint(g.singleMax)>uint(g.cap)||uint(g.expires)<=uint(g.validFrom))fail('grant structural scope');
 for(const r of g.resources)if(r.realm!==g.realm||r.tenant!==g.tenant)fail('resource realm/tenant');
 if(g.binding.task.realm!==g.realm||g.binding.task.tenant!==g.tenant||g.binding.target.tenant!==g.tenant||g.binding.target.service!==g.audience)fail('task/target realm/tenant/audience');
 const selectedResources=new Set(resources.map(r=>readHex(r,r.length)));
 for(const s of g.binding.sources)if(s.ref.realm!==g.realm||s.ref.tenant!==g.tenant||!selectedResources.has(readHex(ref(s.ref),ref(s.ref).length)))fail('source scope');
 return encodeFields([utf8.encode(BOUND_GRANT_DOMAIN),utf8.encode(g.version),hex(g.id,16),legacy(g.realm),legacy(g.tenant),issuer,u64(g.issuerEpoch),holder,u64(g.holderEpoch),legacy(g.audience),legacy(g.operation),encodeFields(resources),u64(g.cap),u64(g.singleMax),u64(g.validFrom),u64(g.expires),hex(g.nonce,16),u64(g.rev),Uint8Array.of(1),legacy(g.approvalId),binding]);
}
/** Sync bytes are intentionally await-compatible with the original Auth codec ports. */
export function encodeBoundGrant(input){return grant(capture(input))}
export function decodeBoundGrant(wire){
 const f=decodeFields(wire,21);if(text(f[0])!==BOUND_GRANT_DOMAIN||f[18].length!==1||f[18][0]!==1)fail('grant domain or boolean');
 const g=Object.freeze({version:text(f[1]),id:readHex(f[2],16),realm:text(f[3]),tenant:text(f[4]),issuer:readRef(f[5]),issuerEpoch:read64(f[6]),holder:readRef(f[7]),holderEpoch:read64(f[8]),audience:text(f[9]),operation:text(f[10]),resources:Object.freeze(readList(f[11],true).map(readRef)),cap:read64(f[12]),singleMax:read64(f[13]),validFrom:read64(f[14]),expires:read64(f[15]),nonce:readHex(f[16],16),rev:read64(f[17]),nonDelegable:true,approvalId:text(f[19]),binding:readStep(f[20])});
 if(!equal(grant(g),encodeFields(f)))fail('noncanonical grant');return g;
}
export function encodeGrantEffect(input,stepInput){const g=capture(input),s=capture(stepInput),full=grant(g),selected=step(s);if(!equal(selected,step(g.binding)))fail('effect step differs from signed grant');return encodeFields([utf8.encode(GRANT_EFFECT_DOMAIN),full,selected])}
export function decodeGrantEffect(wire){const f=decodeFields(wire,3);if(text(f[0])!==GRANT_EFFECT_DOMAIN)fail('effect domain');const g=decodeBoundGrant(f[1]),s=readStep(f[2]);if(!equal(encodeGrantEffect(g,s),encodeFields(f)))fail('noncanonical effect');return Object.freeze({grant:g,step:s})}
