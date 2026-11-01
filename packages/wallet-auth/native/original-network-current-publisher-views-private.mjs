// Fixed same-owner fresh issuer evidence and actual in-process registration views.
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {fetchOriginalNativeAuthorization} from './original-ide-auth-proof-dispatch.mjs';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {verifyOriginalAuthSourceCurrentV2} from './original-auth-identity-source-v2-verifier.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
function result(r){if(!r||!Object.hasOwn(r,'error')||Object.hasOwn(r,'errorPresent')&&typeof r.errorPresent!=='boolean')fail('NETWORK_PUBLISHER_NATIVE_RESULT');if(r.errorPresent===true||r.error!==null)throw r.error;}
const packet=v=>{const r={};for(const k of ['rootRaw','enrollmentRaw','profileRaw','currentRaw','policy','expectedNonce','previous'])r[k]=v[k];return JSON.parse(canonical(r));};
const roots=v=>canonical({rootRaw:v.rootRaw,enrollmentRaw:v.enrollmentRaw,profileRaw:v.profileRaw,policy:v.policy});
export async function retainOriginalNetworkCurrentPublisherViewsV1(rawCapture,row){
 const entry=row.loaderEntry,node=entry?.node;
 if(!entry||sha(canonical(entry))!==row.loaderEntryDigest||!node||Object.keys(node).sort().join(',')!=='nativeChainId,origin,spki')fail('NETWORK_PUBLISHER_NODE_NOT_SELECTED');
 if(typeof rawCapture.readFreshIssuerSourceInputs!=='function')fail('NETWORK_PUBLISHER_FRESH_ISSUER_GETTER_NOT_SUPPLIED');
 const initial=rawCapture.readOriginals(),i=packet(initial.issuerSourceInputs),initialTuple=canonical(i),rootTuple=roots(i);
 if(sha(i.rootRaw)!==row.rootDigest||sha(i.enrollmentRaw)!==row.enrollmentDigest||sha(i.profileRaw)!==row.profileDigest||canonical(i.policy)!==canonical(row.policy))fail('NETWORK_PUBLISHER_COMPILED_SELECTION_DIFFERS');
 // Hints route only original fixed-node public GETs; sole full math follows.
 const root=JSON.parse(i.rootRaw),enrollment=JSON.parse(Buffer.from(JSON.parse(i.enrollmentRaw).body,'base64url').toString('utf8')),profile=JSON.parse(Buffer.from(JSON.parse(i.profileRaw).body,'base64url').toString('utf8'));
 const owners=[root.rootOwner,enrollment.profileOwner,enrollment.currentOwner,profile.subjectOwner];
 if(owners.some(v=>typeof v!=='string'||!/^0x[a-f0-9]{40}$/.test(v))||owners[2]!==owners[3])fail('NETWORK_PUBLISHER_REGISTERED_OWNER_BINDING');
 let initialViews,latestViews,freshPacket,lastProjection,retired=false,busy=false,clockFloor=-1,failurePresent=false,failure;
 const alive=()=>{if(failurePresent)throw failure;};
 const poison=e=>{if(!failurePresent){failurePresent=true;failure=e;}};
 const now=()=>{const n=Date.now();if(!Number.isSafeInteger(n)||n<0||n<clockFloor)fail('NETWORK_PUBLISHER_CLOCK_ROLLBACK');clockFloor=n;return n;};
 const observe=async()=>{
  const unique=[...new Set(owners)],values=await Promise.all(unique.map(async owner=>[owner,parsePQAccountAuthorization(await fetchOriginalNativeAuthorization(node,owner),{chainId:root.networkId,nativeChainId:node.nativeChainId,owner})]));
  const byOwner=new Map(values),views=Object.fromEntries(['root','profile','current','subject'].map((role,n)=>[role,byOwner.get(owners[n])]));
  const height=views.root.executionHeight;if(Object.values(views).some(v=>v.executionHeight!==height))fail('NETWORK_PUBLISHER_REGISTERED_HEIGHT_CHANGED');
  for(const prior of [initialViews,latestViews])if(prior)for(const role of ['root','profile','current','subject'])assertPQAuthorizationCurrent(prior[role],views[role]);
  return Object.freeze(views);
 };
 const baseline=previous=>{
  const p=JSON.parse(canonical(previous));if(!lastProjection)return p;
  const last=lastProjection;if(p.sequence===last.sequence&&p.head&&p.head!==last.head)fail('NETWORK_PUBLISHER_SOURCE_HEAD_EQUIVOCATION');
  return {sequence:Math.max(p.sequence,last.sequence),floor:Math.max(p.floor,last.floor),head:p.sequence>last.sequence?p.head:last.head,timeFloor:Math.max(p.timeFloor,last.timeFloor),executionHeight:BigInt(p.executionHeight)>BigInt(last.executionHeight)?p.executionHeight:last.executionHeight};
 };
 const math=(v,views,previous)=>verifyOriginalAuthSourceCurrentV2(v.rootRaw,v.enrollmentRaw,v.profileRaw,v.currentRaw,v.policy,views,v.expectedNonce,previous,now());
 const readInitial=()=>{if(!initialViews)fail('NETWORK_PUBLISHER_REGISTERED_VIEWS_NOT_READY');const v=rawCapture.readOriginals();if(canonical(packet(v.issuerSourceInputs))!==initialTuple)fail('NETWORK_PUBLISHER_INITIAL_CAPTURE_CHANGED');return {...v,issuerSourceInputs:{...i,registrations:initialViews},registeredCurrent:initialViews.current};};
 const fresh=()=>{alive();if(!freshPacket||!latestViews)fail('NETWORK_PUBLISHER_FRESH_ISSUER_NOT_READY');return {...packet(freshPacket),registrations:latestViews};};
 const completed=()=>{
  alive();try{
  if(retired||busy)fail('NETWORK_PUBLISHER_CAPTURE_RETIRED_OR_BUSY');result(rawCapture.assertCompletedCurrent());
  if(canonical(packet(rawCapture.readFreshIssuerSourceInputs()))!==canonical(freshPacket))fail('NETWORK_PUBLISHER_FRESH_COMPLETION_CHANGED');
  math(freshPacket,latestViews,baseline(freshPacket.previous));return {errorPresent:false,error:null};
  }catch(error){poison(error);throw error;}
 };
 const current=async()=>{
  alive();if(retired||busy)fail('NETWORK_PUBLISHER_CAPTURE_RETIRED_OR_BUSY');busy=true;
  try{
   result(await rawCapture.current());const v=packet(rawCapture.readFreshIssuerSourceInputs());if(roots(v)!==rootTuple)fail('NETWORK_PUBLISHER_FRESH_ROOT_CHANGED');
   const views=await observe();if(retired)fail('NETWORK_PUBLISHER_CAPTURE_RETIRED_OR_BUSY');const previous=baseline(v.previous);math(v,views,previous);
   result(rawCapture.assertCompletedCurrent());if(canonical(packet(rawCapture.readFreshIssuerSourceInputs()))!==canonical(v))fail('NETWORK_PUBLISHER_FRESH_COMPLETION_CHANGED');
   const projection=math(v,views,previous);initialViews??=views;latestViews=views;freshPacket=v;lastProjection=projection;readInitial();return {errorPresent:false,error:null};
  }catch(error){poison(error);throw error;}finally{busy=false;}
 };
 await current();
 return Object.freeze({current,assertCompletedCurrent:completed,readOriginals:readInitial,readFreshIssuerSourceInputs:fresh,
  clockMs(){return rawCapture.clockMs();},
  retainSigningIntentOnce(...args){if(retired||busy)fail('NETWORK_PUBLISHER_CAPTURE_RETIRED_OR_BUSY');return rawCapture.retainSigningIntentOnce(...args);},
  querySameOriginal(){return rawCapture.querySameOriginal();},
  retire(){retired=true;return rawCapture.retire();},join(){return rawCapture.join();},close(){retired=true;return rawCapture.close();}
 });
}
