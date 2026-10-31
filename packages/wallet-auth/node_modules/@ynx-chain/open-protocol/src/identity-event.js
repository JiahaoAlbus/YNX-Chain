// New OPEN v1 IdentityEvent and role-authentication DATA grammar. Auth retains
// current-head, controller trust, recovery thresholds, replay and signature
// checks. This codec never revives a revoked identity or grants asset custody.
import{encodeFields,decodeFields}from'./framing.js';
export const IDENTITY_EVENT_SCHEMA='YNX-OPEN/IDENTITY-EVENT/1';
export const IDENTITY_ROLE_DOMAINS=Object.freeze({controller:'YNX-OPEN/IDENTITY-CONTROLLER/1',oldPair:'YNX-OPEN/IDENTITY-OLD-PAIR/1',newPoP:'YNX-OPEN/IDENTITY-NEW-POP/1',recovery:'YNX-OPEN/IDENTITY-RECOVERY/1'});
const ACTIONS=['register','rotate','suspend','revoke','recover'],SUITE='YNX-BATCH/v0.1',MAX=0xffffffffffffffffn;
const ta=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(ta,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set;
const utf8=s=>new TextEncoder().encode(s),invalid=()=>{throw Object.assign(Error('invalid OPEN IdentityEvent DATA'),{code:'INVALID'})};
function fixed(v,n){let l,b;try{l=getLength.call(v);b=getBuffer.call(v);}catch{invalid()}if(!(v instanceof Uint8Array)||l!==n||typeof SharedArrayBuffer!=='undefined'&&b instanceof SharedArrayBuffer)invalid();const out=new Uint8Array(n);try{set.call(out,v)}catch{invalid()}return out;}
function equal(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function record(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)invalid();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))invalid();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function number(s){if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(s))invalid();const n=BigInt(s);if(n>MAX)invalid();return n;}
function u64(s){const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,number(s),false);return b;}
function read64(b){const c=fixed(b,8);return new DataView(c.buffer).getBigUint64(0,false).toString();}
function action(s){if(!ACTIONS.includes(s))invalid();return s;}
function text(b){try{return new TextDecoder('utf-8',{fatal:true}).decode(b)}catch{invalid()}}
function network(v){if(Object.getOwnPropertyDescriptor(v??{},'kind')?.value==='offchain'){record(v,['kind']);return encodeFields([utf8('offchain')]);}const n=record(v,['kind','genesis','nativeChainId','networkId']),g=fixed(n.genesis,32);if(n.kind!=='ynx-chain'||g.every(b=>b===0))invalid();return encodeFields([utf8(n.kind),g,u64(n.nativeChainId),fixed(n.networkId,32)]);}
function readNetwork(w){const count=w.length>=4?new DataView(w.buffer,w.byteOffset,w.byteLength).getUint32(0,false):0;if(count===1){const f=decodeFields(w,1);if(!equal(f[0],utf8('offchain')))invalid();return Object.freeze({kind:'offchain'});}const f=decodeFields(w,4),g=fixed(f[1],32);if(!equal(f[0],utf8('ynx-chain'))||g.every(b=>b===0))invalid();return Object.freeze({kind:'ynx-chain',genesis:g,nativeChainId:read64(f[2]),networkId:fixed(f[3],32)});}
function epochs(a,from,to){const f=number(from),t=number(to);if(a==='register'){if(f!==0n||t!==1n)invalid()}else if(f<1n||f===MAX||t!==f+1n)invalid();}
function subject(v){const s=record(v,['realm','tenant','kind','id','rev']);if(s.kind!=='agent')invalid();return encodeFields([fixed(s.realm,16),fixed(s.tenant,16),utf8('agent'),fixed(s.id,16),u64(s.rev)]);}
function readSubject(w){const f=decodeFields(w,5);if(!equal(f[2],utf8('agent')))invalid();return Object.freeze({realm:fixed(f[0],16),tenant:fixed(f[1],16),kind:'agent',id:fixed(f[3],16),rev:read64(f[4])});}
function pair(v){if(v===null)return encodeFields([Uint8Array.of(0)]);const p=record(v,['suite','pkA','pkB']);if(p.suite!==SUITE)invalid();return encodeFields([Uint8Array.of(1),utf8(SUITE),fixed(p.pkA,2592),fixed(p.pkB,64)]);}
function readPair(w){const count=w.length>=4?new DataView(w.buffer,w.byteOffset,w.byteLength).getUint32(0,false):0;if(count===1){const f=decodeFields(w,1);if(!equal(f[0],Uint8Array.of(0)))invalid();return null;}const f=decodeFields(w,4);if(!equal(f[0],Uint8Array.of(1))||!equal(f[1],utf8(SUITE)))invalid();return Object.freeze({suite:SUITE,pkA:fixed(f[2],2592),pkB:fixed(f[3],64)});}
function previous(v){return v===null?encodeFields([Uint8Array.of(0)]):encodeFields([Uint8Array.of(1),fixed(v,16)]);}
function readPrevious(w){const count=w.length>=4?new DataView(w.buffer,w.byteOffset,w.byteLength).getUint32(0,false):0;if(count===1){const f=decodeFields(w,1);if(!equal(f[0],Uint8Array.of(0)))invalid();return null;}const f=decodeFields(w,2);if(!equal(f[0],Uint8Array.of(1)))invalid();return fixed(f[1],16);}
const EVENT_KEYS=['id','subject','action','fromEpoch','toEpoch','newPair','trustId','policyId','previous','bound'];
export function encodeIdentityEventV1DATA(input){
 const e=record(input,EVENT_KEYS),a=action(e.action);epochs(a,e.fromEpoch,e.toEpoch);
 const wantsPair=['register','rotate','recover'].includes(a);if((e.newPair!==null)!==wantsPair||(e.previous===null)!==(a==='register'))invalid();
 const bound=record(e.bound,['bytes','sha3_512','sha512']);
 return encodeFields([fixed(e.id,16),subject(e.subject),utf8(a),u64(e.fromEpoch),u64(e.toEpoch),pair(e.newPair),fixed(e.trustId,16),fixed(e.policyId,16),previous(e.previous),encodeFields([u64(bound.bytes),fixed(bound.sha3_512,64),fixed(bound.sha512,64)])]);
}
export function decodeIdentityEventV1DATA(wire){
 const f=decodeFields(wire,10),b=decodeFields(f[9],3),e={id:fixed(f[0],16),subject:readSubject(f[1]),action:action(text(f[2])),fromEpoch:read64(f[3]),toEpoch:read64(f[4]),newPair:readPair(f[5]),trustId:fixed(f[6],16),policyId:fixed(f[7],16),previous:readPrevious(f[8]),bound:Object.freeze({bytes:read64(b[0]),sha3_512:fixed(b[1],64),sha512:fixed(b[2],64)})};
 if(!equal(encodeIdentityEventV1DATA(e),encodeFields(f)))invalid();return Object.freeze(e);
}
const ROLES=Object.freeze({register:['controller','newPoP'],rotate:['controller','oldPair','newPoP'],suspend:['controller'],revoke:['controller'],recover:['recovery','newPoP']});
const ROLE_KEYS=['role','realm','networkBinding','action','audience','eventOriginal','nonce','notAfter','expectedEpoch','nextEpoch'];
export function encodeIdentityRoleAuthorizationV1DATA(input){
 const r=record(input,ROLE_KEYS),a=action(r.action);if(!ROLES[a].includes(r.role))invalid();
 // Decode to capture the actual original; the canonical encoder then binds
 // the outer action, realm and epochs to this exact typed event.
 const e=decodeIdentityEventV1DATA(r.eventOriginal),original=encodeIdentityEventV1DATA(e),realm=fixed(r.realm,16);
 if(!equal(realm,e.subject.realm)||a!==e.action||r.expectedEpoch!==e.fromEpoch||r.nextEpoch!==e.toEpoch)invalid();
 return encodeFields([utf8(IDENTITY_ROLE_DOMAINS[r.role]),realm,network(r.networkBinding),utf8(a),fixed(r.audience,16),original,fixed(r.nonce,32),u64(r.notAfter),u64(r.expectedEpoch),u64(r.nextEpoch)]);
}
export function decodeIdentityRoleAuthorizationV1DATA(wire){
 const f=decodeFields(wire,10),domain=text(f[0]),role=Object.keys(IDENTITY_ROLE_DOMAINS).find(k=>IDENTITY_ROLE_DOMAINS[k]===domain);if(!role)invalid();
 const r={role,realm:fixed(f[1],16),networkBinding:readNetwork(f[2]),action:action(text(f[3])),audience:fixed(f[4],16),eventOriginal:f[5],nonce:fixed(f[6],32),notAfter:read64(f[7]),expectedEpoch:read64(f[8]),nextEpoch:read64(f[9])};
 if(!equal(encodeIdentityRoleAuthorizationV1DATA(r),encodeFields(f)))invalid();return Object.freeze(r);
}
