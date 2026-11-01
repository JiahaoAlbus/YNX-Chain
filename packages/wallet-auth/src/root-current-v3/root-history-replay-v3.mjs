// PRIVATE read-only replay of the ORIGINAL V2 records/permits/member grammar.
// This DATA helper never qualifies a Root/producer or authorizes a new effect.
import {canonical,sha,inspectRootManifestV2,rootExact,verifyPQRegisteredMemberData} from './original-sdk.mjs';
import {rootCanonical,rootU64,inspectRootPermitV2,registryKeyV2,ROOT_AND_SUITE} from '../../native/original-source-root-contract-v2.mjs';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
export function replayOriginalRootHistoryV3(manifestRaw,io,loan,registeredView,at){
 const manifest=inspectRootManifestV2(manifestRaw,at),names=io.list(loan);
 if(!Array.isArray(names)||names.length>128||new Set(names).size!==names.length||names.some(n=>!/^[a-f0-9]{64}\.(entered|terminal)$/.test(n)))fail('ROOT_V3_HISTORY_INVENTORY');
 const events=[];for(const name of names.filter(n=>n.endsWith('.entered'))){
  const key=name.slice(0,64);if(!names.includes(key+'.terminal'))fail('ROOT_V3_HISTORY_UNKNOWN');const entered=io.read(loan,name),terminal=io.read(loan,key+'.terminal'),e=rootCanonical(entered,65536),t=rootCanonical(terminal,393216);
  rootExact(e,['version','manifestSHA256','permitOriginal','bodyOriginal','enteredAtMs']);rootExact(t,['version','entrySHA256','envelopeOriginal']);if(e.version!=='2'||e.manifestSHA256!==sha(manifestRaw)||t.version!=='2'||t.entrySHA256!==sha(entered)||!Number.isSafeInteger(e.enteredAtMs))fail('ROOT_V3_HISTORY_RECORD');
  const v=inspectRootPermitV2(e.permitOriginal,manifestRaw,e.bodyOriginal,e.enteredAtMs),env=rootCanonical(t.envelopeOriginal,350000);rootExact(env,['version','algorithm','manifestSHA256','permitOriginal','bodyOriginal','member']);
  if(env.version!=='2'||env.algorithm!==ROOT_AND_SUITE||env.manifestSHA256!==e.manifestSHA256||env.permitOriginal!==e.permitOriginal||env.bodyOriginal!==e.bodyOriginal||typeof env.member!=='string'||env.member.length>131072||!/^[A-Za-z0-9_-]+$/.test(env.member))fail('ROOT_V3_HISTORY_ENVELOPE');
  const wire=Buffer.from(env.member,'base64url');if(wire.toString('base64url')!==env.member)fail('ROOT_V3_HISTORY_ENCODING');
  const verified=verifyPQRegisteredMemberData(registeredView,wire,{chainId:manifest.networkId,owner:manifest.rootOwner,keyVersion:manifest.rootRevision,executionHeight:registeredView.executionHeight,purpose:v.permit.operation==='issue-read-release'?'SOURCE-ROOT-READ-V2':'SOURCE-DEVICE-REVOKE-V2',message:v.transcript});if(verified.memberCount!==1||verified.memberIndex!==0)fail('ROOT_V3_N1_REQUIRED');
  if(key!==sha(canonical({registryId:manifest.registryId,sequence:v.permit.sequence})))fail('ROOT_V3_HISTORY_KEY');events.push({view:v,terminalHash:sha(terminal)});
 }
 if(names.length!==events.length*2)fail('ROOT_V3_HISTORY_UNKNOWN');events.sort((a,b)=>rootU64(a.view.permit.sequence)<rootU64(b.view.permit.sequence)?-1:1);
 let sequence=0n,head='0'.repeat(64);const permits=new Set(),revoked=new Map(),heads=new Map([['0',head]]);
 for(const {view:v,terminalHash}of events){const p=v.permit;if(rootU64(p.sequence)!==sequence+1n||p.previousSHA256!==head||permits.has(p.permitId))fail('ROOT_V3_HISTORY_CHAIN');if(p.operation==='revoke-device-through-generation'){const key=registryKeyV2(v.body.canonicalOwner,v.body.deviceId),generation=rootU64(v.body.throughGeneration);if(generation<=(revoked.get(key)??0n))fail('ROOT_V3_REVOKE_ROLLBACK');revoked.set(key,generation);}permits.add(p.permitId);sequence=rootU64(p.sequence);head=terminalHash;heads.set(p.sequence,head);}
 return {sequence:sequence.toString(),head,heads,revoked,dataOnly:true,authorized:false};
}
