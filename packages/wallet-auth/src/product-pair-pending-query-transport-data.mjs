// Independent pending-query transport constraints, not a Source or E13 signer.
import {types} from 'node:util';
const fail=()=>{throw Object.assign(Error('PENDING_QUERY_TRANSPORT_DATA_REFUSED'),{code:'PENDING_QUERY_TRANSPORT_DATA_REFUSED'});};
export const PENDING_QUERY_TRANSPORT_RULES=Object.freeze({
 noncePattern:'^[A-Za-z0-9_-]{32,64}$',
 timePattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
 maxWindowMs:30000,normalServiceOrigin:'https://wallet-auth.ynxweb4.com',
 serviceOriginDistinctFromProductOrigin:true,
});
function origin(v){
 if(typeof v!=='string'||v.length>2048)fail();
 let u;try{u=new URL(v);}catch{fail();}
 if(u.protocol!=='https:'||u.username||u.password||u.origin!==v||u.hostname==='')fail();
 return v;
}
function instant(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))fail();
 const n=Date.parse(v);if(!Number.isSafeInteger(n)||new Date(n).toISOString()!==v)fail();return n;
}
// expectedServiceOrigin is independently selected by the genuine server Source;
// equality here checks DATA only and cannot mint that server selection.
export function inspectPendingPairQueryTransportDATA(value,expectedServiceOrigin,atMs){
 if(!Number.isSafeInteger(atMs)||atMs<0||value===null||typeof value!=='object'||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 const keys=['nonce','issuedAt','expiresAt','serviceOrigin'],d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).length!==4||keys.some(k=>!d[k]||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail();
 const v=Object.fromEntries(keys.map(k=>[k,d[k].value]));
 if(typeof v.nonce!=='string'||!/^[A-Za-z0-9_-]{32,64}$/.test(v.nonce)||origin(v.serviceOrigin)!==origin(expectedServiceOrigin))fail();
 const issued=instant(v.issuedAt),expires=instant(v.expiresAt);
 if(expires<=issued||expires-issued>30000||issued>atMs||atMs>=expires)fail();
 return Object.freeze({...v,dataOnly:true,authorized:false,sourceAdmission:false,sessionGranted:false});
}
