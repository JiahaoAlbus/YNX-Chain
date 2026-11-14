import {YNXCloudDeploymentUnknownError} from '../sdk/index.js';

const fields=['instanceId','period','sampleSeq','cpuNanos','cpuMs','memoryBytes','storedBytes','egressBytes','observedAt'];
const integer=value=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>18446744073709551615n)throw Error('Invalid original meter integer');return BigInt(value);};
function observedNanos(raw){
 const m=typeof raw==='string'&&raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/);
 if(!m)throw Error('Canonical UTC original meter time required');
 const milliseconds=Date.parse(m[1]+'Z');
 if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString().slice(0,19)!==m[1])throw Error('Invalid original meter time');
 const value=BigInt(milliseconds)*1000000n+BigInt((m[2]??'').padEnd(9,'0'));
 if(value<1n||value>9223372036854775807n)throw Error('Original meter time out of range');return value;
}

// Detached product DATA validation, never Source, tariff or payment authority.
export function assertOriginalUsageRecordDATA(record,{requestId,instanceId,storedBytes}){
 try{
  if(record?.requestId!==requestId||record.instanceId!==instanceId||!['UNPRICED','PERIOD_BILLS'].includes(record.billingState)||!record.samples||typeof record.samples!=='object'||Array.isArray(record.samples)||!record.latest)throw Error('Original usage scope differs');
  const entries=Object.entries(record.samples);if(!entries.length||entries.length>1024)throw Error('Original usage bound');
  const samples=entries.map(([key,s])=>{
   if(!s||s.instanceId!==instanceId||key!==`${s.period}/${s.sampleSeq}`||s.storedBytes!==storedBytes)throw Error('Original sample scope differs');
   for(const name of ['sampleSeq','cpuNanos','cpuMs','memoryBytes','storedBytes','egressBytes'])integer(s[name]);
   const sequence=observedNanos(s.observedAt);
   if(BigInt(s.sampleSeq)!==sequence||s.period!==s.observedAt.slice(0,10)||BigInt(s.cpuMs)!==BigInt(s.cpuNanos)/1000000n)throw Error('Original sample units/time differ');
   return {sample:s,sequence};
  }).sort((a,b)=>a.sequence<b.sequence?-1:a.sequence>b.sequence?1:0);
  for(let i=1;i<samples.length;i++){
   const a=samples[i-1],b=samples[i];
   if(b.sequence<=a.sequence||BigInt(b.sample.cpuNanos)<BigInt(a.sample.cpuNanos)||BigInt(b.sample.egressBytes)<BigInt(a.sample.egressBytes))throw Error('Original cumulative meter regressed');
  }
  const latest=samples.at(-1).sample;
  if(fields.some(k=>latest[k]!==record.latest[k]))throw Error('Original latest sample differs');
  return record;
 }catch{throw new YNXCloudDeploymentUnknownError(requestId);}
}
