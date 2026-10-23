import {types} from 'node:util';
import {parsePQAccountAuthorization,inspectPQAuthorizationView,PQ_MAX_POLICY_RECORDS} from '@ynx-chain/wallet-auth/pq-wallet-policy';
const observations=new WeakSet(),version1='YNX-ACCOUNT-POLICY/v1',version2='YNX-ACCOUNT-POLICY/v2';
const fail=code=>{throw Object.assign(Error(code),{code});};
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const uint=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n)fail('AUTH_POLICY_QUERY_U64');return BigInt(v);};
function exact(v,keys){
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_POLICY_COMET_SCHEMA');
 const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('AUTH_POLICY_COMET_SCHEMA');
}
function array(v,max){
 if(types.isProxy(v)||!Array.isArray(v)||v.length>max||Reflect.ownKeys(v).length!==v.length+1)fail('AUTH_POLICY_COMET_SCHEMA');
 for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('AUTH_POLICY_COMET_SCHEMA');}
 return v;
}
/** A brand for strictly parsed observation DATA only, never Root, a trusted
 * checkpoint, user permission, signing authority or independent finality. */
export function captureCometPolicyObservation(v,authorization){
 exact(v,['kind','source','recordsView','committedHeight','committedAppHash','independentFinality']);
 const height=uint(v.committedHeight),next=uint(inspectPQAuthorizationView(authorization).executionHeight);
 if(v.kind!=='comet-node-observed-app-state/v1'||v.source!=='comet-rpc'||v.recordsView!=='committed'||v.independentFinality!==false||!hex(v.committedAppHash)||height>=9223372036854775807n||next!==height+1n)fail('AUTH_POLICY_COMET_OBSERVATION_INVALID');
 const result=Object.freeze({...v});observations.add(result);return result;
}
export const isCometPolicyObservation=v=>observations.has(v);
export function inspectCometOperatorProjection(body,owner,networkId){
 if(!body||types.isProxy(body))fail('AUTH_POLICY_COMET_SCHEMA');
 const keys=['source','recordsView','policyView','recordsComplete','owner','nativeChainId','networkId','committedHeight','committedAppHash','executionHeight','ledgerNonce','enabled','authorizationStatus','pqSigningEnabled','committedAuthorizationStatus','committedPQSigningEnabled','policy'];
 if(Object.getOwnPropertyDescriptor(body,'enabled')?.value===true)keys.push('globalPolicyVersion');
 exact(body,keys);
 if(body.source!=='comet-rpc'||body.recordsView!=='committed'||body.policyView!=='next_execution'||body.recordsComplete!==true||body.owner!==owner||body.nativeChainId!=='6423'||body.networkId!==networkId||!hex(body.committedAppHash)||typeof body.enabled!=='boolean')fail('AUTH_POLICY_COMET_BINDING');
 const height=uint(body.committedHeight),next=uint(body.executionHeight);uint(body.ledgerNonce);
 if(height>=9223372036854775807n||next!==height+1n)fail('AUTH_POLICY_QUERY_HEIGHT');
 let dto={owner,executionHeight:body.executionHeight,ledgerNonce:body.ledgerNonce,algorithmVersion:'legacy',enabled:body.enabled,records:[]};
 if(!body.enabled){if(body.policy!==null)fail('AUTH_POLICY_COMET_DISABLED_POLICY');}
 else{
  const p=body.policy;if(!p||types.isProxy(p))fail('AUTH_POLICY_COMET_SCHEMA');
  const pv=Object.getOwnPropertyDescriptor(p,'version')?.value;
  if(![version1,version2].includes(pv))fail('AUTH_POLICY_COMET_SCHEMA');
  exact(p,['version','networkId','enableAt','records',...(pv===version2?['revocations']:[])]);
  if(p.networkId!==networkId||![version1,version2].includes(body.globalPolicyVersion)||pv===version2&&body.globalPolicyVersion!==version2)fail('AUTH_POLICY_QUERY_REVOCATION_MISMATCH');
  const records=array(p.records,PQ_MAX_POLICY_RECORDS);let active=null;
  for(const r of records){
   exact(r,['algorithmVersion','owner','pkA','pkB','revision','registeredAt','activeFrom','ledgerNonce']);
   if(typeof r.pkA!=='string'||!/^[0-9a-f]{5184}$/.test(r.pkA)||typeof r.pkB!=='string'||!/^[0-9a-f]{128}$/.test(r.pkB))fail('AUTH_POLICY_COMET_PUBLIC_KEYS');
   if(uint(r.registeredAt)>height)fail('AUTH_POLICY_COMET_RECORD_NOT_COMMITTED');
   if(uint(r.activeFrom)<=next)active=r;
  }
  dto={...dto,records,policyVersion:pv,networkId:p.networkId,enableAt:p.enableAt};
  if(active){dto.algorithmVersion='YNX-BATCH/v0.1';dto.activeRevision=active.revision;}
  if(pv===version2){
   const revocations=array(p.revocations,1);
   for(const r of revocations){exact(r,['owner','authorizingRevision','throughRevision','registeredAt','revokedFrom','ledgerNonce']);if(uint(r.registeredAt)>height)fail('AUTH_POLICY_COMET_RECORD_NOT_COMMITTED');}
   dto.revocations=revocations; // Complete terminal tombstones, not a status bit.
  }
 }
 const authorization=parsePQAccountAuthorization(dto,{chainId:networkId,nativeChainId:'6423',owner});
 const nextView=inspectPQAuthorizationView(authorization),committedView=inspectPQAuthorizationView(authorization,body.committedHeight);
 if(body.authorizationStatus!==nextView.authorizationStatus||body.pqSigningEnabled!==nextView.pqSigningEnabled||body.committedAuthorizationStatus!==committedView.authorizationStatus||body.committedPQSigningEnabled!==committedView.pqSigningEnabled)fail('AUTH_POLICY_QUERY_REVOCATION_STATUS_MISMATCH');
 let committedRecord=null;for(const r of authorization.records)if(uint(r.registeredAt)<=height&&uint(r.activeFrom)<=height)committedRecord=r;
 const observation=captureCometPolicyObservation({kind:'comet-node-observed-app-state/v1',source:body.source,recordsView:body.recordsView,committedHeight:body.committedHeight,committedAppHash:body.committedAppHash,independentFinality:false},authorization);
 return Object.freeze({authorization,committedRecord,nextView,committedView,committedHeight:body.committedHeight,committedAppHash:body.committedAppHash,observation,dataOnly:true,signingAuthorized:false});
}
