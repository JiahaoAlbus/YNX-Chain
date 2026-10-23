// Main-only connection correlation. This is neither an Auth permission nor a
// signing capability. Normal transport admission and original Wallet approval
// remain separate gates; renderer DATA cannot reconstruct this private brand.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
const connections=new WeakMap();
export const PQ_CONNECTION_METHODS=Object.freeze(['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']);
const fail=code=>{throw Object.assign(Error(code),{code:4100,data:{code}})};
const digest=value=>createHash('sha256').update(value).digest('hex');
function exact(value,fields){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('PQ_CONNECTION_SCHEMA');
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.length!==fields.length||keys.some(k=>!fields.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail('PQ_CONNECTION_SCHEMA');
 return value;
}
export function canonicalPQConnectionOrigin(value){
 if(typeof value!=='string'||value.length>2048)fail('PQ_CONNECTION_ORIGIN');
 let url;try{url=new URL(value)}catch{fail('PQ_CONNECTION_ORIGIN')}
 if(url.protocol!=='https:'||url.origin!==value||url.username||url.password)fail('PQ_CONNECTION_ORIGIN');return value;
}
export function captureWalletPQConnection({origin,account,sessionBinding,requestKey,assertCurrent}){
 canonicalPQConnectionOrigin(origin);
 if(!/^0x[0-9a-f]{40}$/.test(account??'')||typeof sessionBinding!=='string'||!sessionBinding.length||sessionBinding.length>65536||typeof requestKey!=='string'||!requestKey.length||requestKey.length>512||typeof assertCurrent!=='function')fail('PQ_CONNECTION_SOURCE_REQUIRED');
 const data=Object.freeze({origin,account,sessionBindingHash:digest(sessionBinding),requestKeyHash:digest(requestKey)});
 assertCurrent();const token=Object.freeze(Object.create(null));connections.set(token,{data,assertCurrent});return token;
}
export function readWalletPQConnection(token){
 const state=connections.get(token);if(!state)fail('PQ_CONNECTION_SOURCE_REQUIRED');state.assertCurrent();return state.data;
}
function base64(value,max){
 if(typeof value!=='string'||value.length<4||value.length>4*Math.ceil(max/3)||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('PQ_CONNECTION_MATERIAL_ENCODING');
 const bytes=Buffer.from(value,'base64');if(!bytes.length||bytes.length>max||bytes.toString('base64')!==value)fail('PQ_CONNECTION_MATERIAL_ENCODING');return bytes;
}
/** Closed JSON ABI for the existing authenticated WalletConnect session.
 * Owner, nonce, chain, permission, signer and transport are never accepted. */
export function parsePQConnectionRequest(method,params){
 if(!PQ_CONNECTION_METHODS.includes(method)||!Array.isArray(params)||types.isProxy(params)||params.length!==1||Reflect.ownKeys(params).sort().join()!=='0,length'||!Object.hasOwn(Object.getOwnPropertyDescriptors(params)[0]??{},'value'))fail('PQ_CONNECTION_SCHEMA');
 const input=params[0];
 const reference=method==='ynx_getPQContractOriginal'&&input&&!types.isProxy(input)&&Object.hasOwn(input,'originalRequestKeyHash')?'originalRequestKeyHash':'operationId';
 exact(input,method==='ynx_preparePQContractAction'?['version','account','action']:method==='ynx_getPQContractOriginal'?['version','account',reference,'refresh']:['version','account','operationId']);
 if(input.version!==1||!/^0x[0-9a-f]{40}$/.test(input.account??''))fail('PQ_CONNECTION_ACCOUNT');
 if(method!=='ynx_preparePQContractAction'){
  if(reference==='originalRequestKeyHash'?!/^[0-9a-f]{64}$/.test(input.originalRequestKeyHash??''):typeof input.operationId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(input.operationId))fail('PQ_CONNECTION_SCHEMA');
  if(method==='ynx_getPQContractOriginal'&&typeof input.refresh!=='boolean')fail('PQ_CONNECTION_SCHEMA');
  return Object.freeze({...input});
 }
 const action=input.action;
 if(!action||types.isProxy(action))fail('PQ_CONNECTION_SCHEMA');
 const kd=Object.getOwnPropertyDescriptor(action,'kind');if(!kd||!Object.hasOwn(kd,'value'))fail('PQ_CONNECTION_SCHEMA');
 if(!['contract_deploy','contract_execute'].includes(kd.value))fail('PQ_CONNECTION_CONTRACT_ONLY');
 exact(action,kd.value==='contract_deploy'?['kind','fee','payload','deployment']:['kind','fee','payload']);
 if(action.fee!==(action.kind==='contract_deploy'?'10':'2'))fail('PQ_CONNECTION_CONTRACT_FEE');
 // The sole SDK validates the complete exact payload against current policy.
 // Copy JSON DATA only; do not invoke any nested accessors during capture.
 function json(value,depth=0){
  if(depth>12)fail('PQ_CONNECTION_SCHEMA');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isSafeInteger(value))return value;
  if(!value||types.isProxy(value)||![Object.prototype,Array.prototype].includes(Object.getPrototypeOf(value)))fail('PQ_CONNECTION_SCHEMA');
  const ds=Object.getOwnPropertyDescriptors(value),out=Array.isArray(value)?[]:{};
  if(Array.isArray(value)&&(Reflect.ownKeys(ds).length!==value.length+1||Array.from({length:value.length},(_,i)=>String(i)).some(k=>!Object.hasOwn(ds,k))))fail('PQ_CONNECTION_SCHEMA');
  for(const key of Reflect.ownKeys(ds)){
   if(Array.isArray(value)&&key==='length')continue;
   if(typeof key!=='string'||!ds[key].enumerable||!Object.hasOwn(ds[key],'value')||['__proto__','constructor','prototype'].includes(key))fail('PQ_CONNECTION_SCHEMA');
   out[key]=json(ds[key].value,depth+1);
  }
  return out;
 }
 const payload=json(action.payload);if(Buffer.byteLength(JSON.stringify(payload))>16384)fail('PQ_CONNECTION_SCHEMA');
 if(!payload||!['SampleEVMWriteCounter','SampleYNXTCompatibleERC20'].includes(payload.name))fail('PQ_CONNECTION_CONTRACT_ONLY');
 const result={kind:action.kind,fee:action.fee,payload};
 if(action.kind==='contract_deploy'){
  const d=exact(action.deployment,['source','material']),m=exact(d.material,['artifactFile','buildInfoFile']);
  if(typeof d.source!=='string'||Buffer.byteLength(d.source)>65536)fail('PQ_CONNECTION_SCHEMA');
  result.deployment={source:d.source,material:{artifactFile:base64(m.artifactFile,131072),buildInfoFile:base64(m.buildInfoFile,16777216)}};
 }
 return {version:1,account:input.account,action:result};
}
export function validatePQOriginalInitiator(value){
 exact(value,['origin','sessionBindingHash','requestKeyHash']);canonicalPQConnectionOrigin(value.origin);
 if(!/^[0-9a-f]{64}$/.test(value.sessionBindingHash??'')||!/^[0-9a-f]{64}$/.test(value.requestKeyHash??''))fail('PQ_CONNECTION_SCHEMA');return value;
}
