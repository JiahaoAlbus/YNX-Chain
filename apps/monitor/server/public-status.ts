import { createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export const PUBLIC_STATUS_SOURCE_SCHEMA='ynx.monitor.public-status-source.v2' as const;
export const PUBLIC_STATUS_SCHEMA='ynx.monitor.public-status.v2' as const;

const serviceStatuses=['operational','degraded','partial_outage','major_outage','maintenance','unknown'] as const;
const incidentStatuses=['investigating','identified','monitoring','resolved'] as const;
const incidentSeverities=['minor','major','critical'] as const;
const serviceStatusRank:Record<PublicServiceStatus,number>={operational:0,maintenance:1,degraded:2,partial_outage:3,major_outage:4,unknown:5};
const forbiddenPublicText=[
  /(?:^|\s)(?:\/(?:Users|home|var|etc|srv|private|tmp)\/|[a-z]:\\)/i,
  /\b(?:authorization|bearer|password|private[_ -]?key|seed phrase|api[_ -]?key)\b/i,
  /\b(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9.-]+\.internal)\b/i,
  /\b(?:audit(?: id| record| detail)?|evidence(?: reference| ref| url)?|backup(?: reference| ref| path)?|stack trace|topology path)\b/i,
];

export type PublicServiceStatus=typeof serviceStatuses[number];
export type PublicIncidentStatus=typeof incidentStatuses[number];
export type PublicIncidentSeverity=typeof incidentSeverities[number];
export type PublicStatusErrorCode='public_status_unavailable'|'public_status_invalid'|'public_status_integrity_invalid'|'public_status_not_approved'|'public_status_source_mismatch'|'public_status_replayed'|'public_status_stale';
export type PublicStatusSource=()=>Promise<unknown>;

export interface PublicStatusService {
  id:string;
  name:string;
  status:PublicServiceStatus;
  asOf:string;
	checkedAt:string;
	sourceCommit:string|null;
	release:string|null;
	startedAt:string|null;
	dependencies:Array<{id:string;status:PublicServiceStatus}>;
  message?:string;
}

export interface PublicStatusIncident {
  id:string;
  title:string;
  severity:PublicIncidentSeverity;
  status:PublicIncidentStatus;
  message:string;
  startedAt:string;
  updatedAt:string;
  affectedServices:string[];
}

export interface PublicStatusSnapshot {
  schemaVersion:typeof PUBLIC_STATUS_SCHEMA;
  availability:'available';
  source:string;
  version:string;
  asOf:string;
  publishedAt:string;
  status:PublicServiceStatus;
  message?:string;
  services:PublicStatusService[];
  incidents:PublicStatusIncident[];
	history:Array<{asOf:string;status:PublicServiceStatus;operational:number;degraded:number;outage:number;unknown:number;transition:'initial'|'unchanged'|'failure'|'recovery'}>;
	historyPersistence:'process-scoped';
}

export class PublicStatusError extends Error {
  constructor(public readonly code:PublicStatusErrorCode){super(code);}
}

export class PublicStatusReplayGuard {
  private last?:{source:string;version:string;asOf:string;publishedAt:string};
	private history:PublicStatusSnapshot['history']=[];
  accept(snapshot:PublicStatusSnapshot){
	if(!this.last){this.last={source:snapshot.source,version:snapshot.version,asOf:snapshot.asOf,publishedAt:snapshot.publishedAt};this.appendHistory(snapshot,'initial');return{...snapshot,history:[...this.history]};}
    const same=snapshot.source===this.last.source&&snapshot.version===this.last.version&&snapshot.asOf===this.last.asOf&&snapshot.publishedAt===this.last.publishedAt;
	if(same)return{...snapshot,history:[...this.history]};
    if(snapshot.source!==this.last.source||Date.parse(snapshot.asOf)<=Date.parse(this.last.asOf)||Date.parse(snapshot.publishedAt)<Date.parse(this.last.publishedAt))throw new PublicStatusError('public_status_replayed');
	const previous=this.history.at(-1)?.status;
	const transition=previous===snapshot.status?'unchanged':serviceStatusRank[snapshot.status]>serviceStatusRank[previous??'unknown']?'failure':'recovery';
    this.last={source:snapshot.source,version:snapshot.version,asOf:snapshot.asOf,publishedAt:snapshot.publishedAt};
	this.appendHistory(snapshot,transition);
	return{...snapshot,history:[...this.history]};
  }
	private appendHistory(snapshot:PublicStatusSnapshot,transition:PublicStatusSnapshot['history'][number]['transition']){
	  const counts={operational:0,degraded:0,outage:0,unknown:0};
	  for(const service of snapshot.services){if(service.status==='operational')counts.operational++;else if(service.status==='degraded'||service.status==='maintenance')counts.degraded++;else if(service.status==='unknown')counts.unknown++;else counts.outage++;}
	  this.history.push({asOf:snapshot.asOf,status:snapshot.status,...counts,transition});
	  if(this.history.length>96)this.history.splice(0,this.history.length-96);
	}
}

type UnknownRecord=Record<string,unknown>;
const identifier=/^[a-z0-9][a-z0-9._:-]*$/i;

function invalid():never { throw new PublicStatusError('public_status_invalid'); }
function record(value:unknown):UnknownRecord {
  if(!value||typeof value!=='object'||Array.isArray(value))invalid();
  return value as UnknownRecord;
}
function exactKeys(value:UnknownRecord,allowed:readonly string[]){
  const set=new Set(allowed);
  if(Object.keys(value).some(key=>!set.has(key)))invalid();
}
function stringValue(value:unknown,max:number,pattern?:RegExp){
  if(typeof value!=='string')invalid();
  const text=value.trim();
  if(!text||text.length>max||(pattern&&!pattern.test(text)))invalid();
  return text;
}
function publicTextValue(value:unknown,max:number){
  const text=stringValue(value,max);
  if(/[\r\n\t]/.test(text)||forbiddenPublicText.some(pattern=>pattern.test(text)))invalid();
  return text;
}
function optionalPublicText(value:unknown,max:number){
  if(value===undefined)return undefined;
  return publicTextValue(value,max);
}
function nullablePublicText(value:unknown,max:number){
	if(value===null)return null;
	return publicTextValue(value,max);
}
function isoValue(value:unknown){
  const text=stringValue(value,80);
  const millis=Date.parse(text);
  if(!Number.isFinite(millis))invalid();
  return new Date(millis).toISOString();
}
function nullableISOValue(value:unknown){return value===null?null:isoValue(value);}
function enumValue<T extends readonly string[]>(value:unknown,allowed:T):T[number]{
  if(typeof value!=='string'||!allowed.includes(value as T[number]))invalid();
  return value as T[number];
}
function boundedArray(value:unknown,max:number){
  if(!Array.isArray(value)||value.length>max)invalid();
  return value;
}
function unique<T>(values:T[]){return new Set(values).size===values.length;}
function canonicalValue(value:unknown):unknown {
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:invalid();
  if(Array.isArray(value))return value.map(canonicalValue);
  if(typeof value==='object'){
    const input=value as UnknownRecord;
    return Object.fromEntries(Object.keys(input).sort().map(key=>[key,canonicalValue(input[key])]));
  }
  return invalid();
}
function canonicalJson(value:unknown){return JSON.stringify(canonicalValue(value));}
function assertIntegrityKey(key:string){if(key.length<32)throw new Error('public status integrity key must contain at least 32 characters');}
function digestPublicStatus(value:unknown,key:string){assertIntegrityKey(key);return createHmac('sha256',key).update(canonicalJson(value)).digest('hex');}

export function signPublicStatusSource(source:UnknownRecord,key:string){
  if('integrity' in source)invalid();
  return {...source,integrity:{algorithm:'hmac-sha256',digest:digestPublicStatus(source,key)}};
}

function verifyPublicStatusIntegrity(input:UnknownRecord,key:string){
  assertIntegrityKey(key);
  let integrity:UnknownRecord;
  try{
    integrity=record(input.integrity);
    exactKeys(integrity,['algorithm','digest']);
  }catch{throw new PublicStatusError('public_status_integrity_invalid');}
  if(integrity.algorithm!=='hmac-sha256'||typeof integrity.digest!=='string'||!/^[a-f0-9]{64}$/.test(integrity.digest))throw new PublicStatusError('public_status_integrity_invalid');
  const unsigned=Object.fromEntries(Object.entries(input).filter(([name])=>name!=='integrity'));
  const expected=Buffer.from(digestPublicStatus(unsigned,key),'hex'),actual=Buffer.from(integrity.digest,'hex');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new PublicStatusError('public_status_integrity_invalid');
}

export function parsePublicStatusSource(raw:unknown,options:{now?:Date;maxAgeSeconds:number;integrityKey:string;expectedSource:string}):PublicStatusSnapshot {
  if(!Number.isFinite(options.maxAgeSeconds)||options.maxAgeSeconds<30||options.maxAgeSeconds>86_400)throw new Error('public status max age must be between 30 and 86400 seconds');
  const now=(options.now??new Date()).getTime();
  const input=record(raw);
  exactKeys(input,['schemaVersion','source','version','asOf','status','message','services','incidents','approval','integrity']);
  verifyPublicStatusIntegrity(input,options.integrityKey);
  if(input.schemaVersion!==PUBLIC_STATUS_SOURCE_SCHEMA)invalid();
  const expectedSource=stringValue(options.expectedSource,120,identifier);
  const source=stringValue(input.source,120,identifier);
  if(source!==expectedSource)throw new PublicStatusError('public_status_source_mismatch');
  const version=stringValue(input.version,120,identifier);
  const asOf=isoValue(input.asOf);
  const asOfMillis=Date.parse(asOf);
  if(asOfMillis>now+300_000)invalid();
  if(now-asOfMillis>options.maxAgeSeconds*1000)throw new PublicStatusError('public_status_stale');
  const status=enumValue(input.status,serviceStatuses);
  const message=optionalPublicText(input.message,500);

  const approval=record(input.approval);
  exactKeys(approval,['status','approvalId','approvedAt','approvedByRole']);
  if(approval.status!=='approved'||approval.approvedByRole!=='incident_commander')throw new PublicStatusError('public_status_not_approved');
  stringValue(approval.approvalId,120,identifier);
  const publishedAt=isoValue(approval.approvedAt);
  const publishedAtMillis=Date.parse(publishedAt);
  if(publishedAtMillis<asOfMillis||publishedAtMillis>now+300_000)invalid();

  const services=boundedArray(input.services,64).map(value=>{
    const item=record(value);
	exactKeys(item,['id','name','status','asOf','checkedAt','sourceCommit','release','startedAt','dependencies','message']);
	const checkedAt=isoValue(item.checkedAt);
	const dependencies=boundedArray(item.dependencies,20).map(value=>{
	  const dependency=record(value);
	  exactKeys(dependency,['id','status']);
	  return {id:stringValue(dependency.id,80,identifier),status:enumValue(dependency.status,serviceStatuses)};
	});
	if(!unique(dependencies.map(dependency=>dependency.id)))invalid();
    return {
      id:stringValue(item.id,80,identifier),
      name:publicTextValue(item.name,120),
      status:enumValue(item.status,serviceStatuses),
      asOf:isoValue(item.asOf),
	  checkedAt,
	  sourceCommit:nullablePublicText(item.sourceCommit,120),
	  release:nullablePublicText(item.release,120),
	  startedAt:nullableISOValue(item.startedAt),
	  dependencies,
      ...(item.message===undefined?{}:{message:publicTextValue(item.message,500)}),
    } satisfies PublicStatusService;
  });
  if(!services.length||!unique(services.map(item=>item.id)))invalid();
  const serviceIds=new Set(services.map(item=>item.id));
	if(services.some(item=>Date.parse(item.asOf)>publishedAtMillis||Date.parse(item.checkedAt)>publishedAtMillis||now-Date.parse(item.asOf)>options.maxAgeSeconds*1000||now-Date.parse(item.checkedAt)>options.maxAgeSeconds*1000))throw new PublicStatusError('public_status_stale');
  if(services.some(item=>serviceStatusRank[item.status]>serviceStatusRank[status]))invalid();

  const incidents=boundedArray(input.incidents,20).map(value=>{
    const item=record(value);
    exactKeys(item,['id','title','severity','status','message','startedAt','updatedAt','affectedServices']);
    const startedAt=isoValue(item.startedAt),updatedAt=isoValue(item.updatedAt);
    if(Date.parse(updatedAt)<Date.parse(startedAt)||Date.parse(updatedAt)>publishedAtMillis)invalid();
    const affectedServices=boundedArray(item.affectedServices,20).map(service=>stringValue(service,80,identifier));
    if(!unique(affectedServices)||affectedServices.some(service=>!serviceIds.has(service)))invalid();
    return {
      id:stringValue(item.id,100,identifier),
      title:publicTextValue(item.title,160),
      severity:enumValue(item.severity,incidentSeverities),
      status:enumValue(item.status,incidentStatuses),
      message:publicTextValue(item.message,1000),
      startedAt,
      updatedAt,
      affectedServices,
    } satisfies PublicStatusIncident;
  });
  if(!unique(incidents.map(item=>item.id)))invalid();
  if(status==='operational'&&incidents.some(item=>item.status!=='resolved'))invalid();

  return {
    schemaVersion:PUBLIC_STATUS_SCHEMA,
    availability:'available',
    source,
    version,
    asOf,
    publishedAt,
    status,
    ...(message===undefined?{}:{message}),
    services,
    incidents,
	history:[],
	historyPersistence:'process-scoped',
  };
}

export function filePublicStatusSource(path:string):PublicStatusSource {
  return async()=>{
    let handle:Awaited<ReturnType<typeof open>>;
    try{handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch{throw new PublicStatusError('public_status_unavailable');}
    try{
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size>262_144)throw new PublicStatusError('public_status_invalid');
      const buffer=Buffer.alloc(262_145);
      let offset=0;
      while(offset<buffer.length){
        const result=await handle.read(buffer,offset,buffer.length-offset,offset);
        if(result.bytesRead===0)break;
        offset+=result.bytesRead;
      }
      if(offset>262_144)throw new PublicStatusError('public_status_invalid');
      try{return JSON.parse(buffer.subarray(0,offset).toString('utf8')) as unknown;}
      catch{throw new PublicStatusError('public_status_invalid');}
    }catch(error){
      if(error instanceof PublicStatusError)throw error;
      throw new PublicStatusError('public_status_unavailable');
    }finally{await handle.close().catch(()=>undefined);}
  };
}

export function publicStatusFailure(code:PublicStatusErrorCode,servedAt=new Date().toISOString()){
  return {schemaVersion:PUBLIC_STATUS_SCHEMA,availability:'unavailable' as const,error:code,servedAt};
}
