import {types} from 'node:util';
// Public failure labels only. Never retain/serialize messages, stacks, raw
// records, accounts, proof, credential or caller-supplied paths in diagnostics.
const own=(v,k)=>{if(!v||typeof v!=='object'||types.isProxy(v))return;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const safe=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(v)?v:null;
const owners=new Set(['admission-entry','wallet','lock','storage-check','namespace','pay-context','product-context','pay-entry','finality','registration','finalization','pq-reviews','ai-review','device-management','device-creation','device-query','ide-peer','project-control','agent-view','standalone-pay','ai-public-parent','pay-product','transaction-cleanup']);
export function createWalletCleanupDiagnostics(){
 const records=new Map();
 function record(owner,stage,cause){
  if(!owners.has(owner)||!['operation','retire','drain','assert','close'].includes(stage))return;
  const key=owner+'/'+stage;if(records.has(key))return;
  const data=own(cause,'data'),code=safe(own(data,'code'))??safe(own(cause,'code'));
  const causeType=cause===null?'null':typeof cause;
  records.set(key,Object.freeze({owner,stage,code:code??'CLEANUP_CAUSE_CODE_NOT_SUPPLIED',causeType}));
 }
 return Object.freeze({record,read:()=>Object.freeze([...records.values()]),format:()=>[...records.values()].map(r=>r.owner+'/'+r.stage+': '+r.code+' ('+r.causeType+')').join('\n')});
}
