import fs from 'node:fs/promises';
import {closeSync,constants,fstatSync,fsyncSync,openSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';

const SCHEMA='ynx-finance-endpoint-authority-checkpoint/v1';
const TABLE='authority_checkpoint';
const clone=value=>JSON.parse(canonicalAuthorityV2(value));
const same=(a,b)=>canonicalAuthorityV2(a)===canonicalAuthorityV2(b);

function assertCheckpoint(value){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(',')!=='payloadSha256,rootVersion,sequence'||!Number.isSafeInteger(value.rootVersion)||value.rootVersion<1||!Number.isSafeInteger(value.sequence)||value.sequence<0||typeof value.payloadSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.payloadSha256))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');
  return clone(value);
}

function envelope(checkpoint,trustedClockHighWaterMs){
  if(!Number.isSafeInteger(trustedClockHighWaterMs)||trustedClockHighWaterMs<0)throw new Error('FINANCE_AUTHORITY_V2_CLOCK_INVALID');
  return {schemaVersion:SCHEMA,checkpoint:assertCheckpoint(checkpoint),trustedClockHighWaterMs};
}

async function readRegularJSON(file,{missing}={}){
  let handle;
  try{handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error?.code==='ENOENT'&&missing!==undefined)return clone(missing);if(error?.code==='ELOOP')throw new Error('FINANCE_AUTHORITY_V2_FILE_IDENTITY_INVALID');throw error;}
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.nlink!==1)throw new Error('FINANCE_AUTHORITY_V2_FILE_IDENTITY_INVALID');
    if(stat.size===0||stat.size>131072)throw new Error('FINANCE_AUTHORITY_V2_FILE_SIZE_INVALID');
    const bytes=await handle.readFile();
    if(bytes.length!==stat.size)throw new Error('FINANCE_AUTHORITY_V2_FILE_CHANGED_DURING_READ');
    return JSON.parse(bytes.toString('utf8'));
  }finally{await handle.close();}
}

async function regularFileState(file){
  let handle;
  try{handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error?.code==='ENOENT')return false;if(error?.code==='ELOOP')throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');throw error;}
  try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');return true;}finally{await handle.close();}
}

async function markerExists(marker){
  let handle;
  try{handle=await fs.open(marker,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error?.code==='ENOENT')return false;if(error?.code==='ELOOP')throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_MARKER_INVALID');throw error;}
  try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_MARKER_INVALID');return true;}finally{await handle.close();}
}

async function openDatabase(file,marker){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const exists=await regularFileState(file);
  if(!exists&&await markerExists(marker))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOST');
  let database;
  try{
    database=new DatabaseSync(file);
    database.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS ${TABLE} (singleton INTEGER PRIMARY KEY CHECK(singleton=1), envelope TEXT NOT NULL);`);
  }catch(error){database?.close();throw Object.assign(new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DATABASE_INVALID'),{cause:error});}
  if(!await regularFileState(file)){database.close();throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');}
  if(database.prepare(`SELECT 1 AS present FROM ${TABLE} WHERE singleton=1`).get()&&!await markerExists(marker))ensureMarker(marker);
  return database;
}

function readEnvelope(database,initial,at,initialized=false){
  const row=database.prepare(`SELECT envelope FROM ${TABLE} WHERE singleton=1`).get();
  if(!row){if(initialized)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOST');return initial;}
  let value;try{value=JSON.parse(row.envelope);}catch{throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');}
  if(!value||Object.keys(value).sort().join(',')!=='checkpoint,schemaVersion,trustedClockHighWaterMs'||value.schemaVersion!==SCHEMA)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');
  const checked=envelope(value.checkpoint,value.trustedClockHighWaterMs);
  if(at()<checked.trustedClockHighWaterMs)throw new Error('AUTHORITY_V2_CLOCK_ROLLBACK');
  return checked;
}

function ensureMarker(marker){
  let descriptor;
  try{
    try{
      descriptor=openSync(marker,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      writeFileSync(descriptor,SCHEMA+'\n');fsyncSync(descriptor);
    }catch(error){
      if(error?.code!=='EEXIST')throw error;
      if(descriptor!==undefined){closeSync(descriptor);descriptor=undefined;}
      try{descriptor=openSync(marker,constants.O_RDONLY|constants.O_NOFOLLOW);}catch{throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_MARKER_INVALID');}
    }
    const stat=fstatSync(descriptor);
    if(!stat.isFile()||stat.nlink!==1)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_MARKER_INVALID');
  }
  finally{if(descriptor!==undefined)closeSync(descriptor);}
}

export function createNodeCheckpointStore({file,anchor,trustedClockMs}){
  if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_PATH_INVALID');
  const initial=envelope(anchor,0),marker=file+'.initialized';
  const at=()=>{if(!Number.isSafeInteger(trustedClockMs)||trustedClockMs<0)throw new Error('FINANCE_AUTHORITY_V2_CLOCK_INVALID');return trustedClockMs;};
  async function inspect(){const database=await openDatabase(file,marker);try{return readEnvelope(database,initial,at,await markerExists(marker));}finally{database.close();}}
  return Object.freeze({
    async read(){return (await inspect()).checkpoint;},
    async compareAndSwap(previous,next){
      const database=await openDatabase(file,marker),initialized=await markerExists(marker);let transaction=false;
      try{
        database.exec('BEGIN IMMEDIATE');transaction=true;
        const current=readEnvelope(database,initial,at,initialized);
        if(!same(current.checkpoint,previous)){database.exec('ROLLBACK');transaction=false;return false;}
        database.prepare(`INSERT INTO ${TABLE}(singleton,envelope) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET envelope=excluded.envelope`).run(JSON.stringify(envelope(next,Math.max(current.trustedClockHighWaterMs,at()))));
        database.exec('COMMIT');transaction=false;
        ensureMarker(marker);
        return true;
      }catch(error){if(transaction)try{database.exec('ROLLBACK');}catch{}if(error?.code==='ERR_SQLITE_ERROR'&&/locked|busy/i.test(String(error.message)))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_TIMEOUT');throw error;}
      finally{database.close();}
    },
    async inspect(){return inspect();},
  });
}

export async function readTrustedTimeFile(file){
  const value=await readRegularJSON(file);
  if(!value||Object.keys(value).sort().join(',')!=='schemaVersion,unixTimeMs'||value.schemaVersion!=='ynx-trusted-time/v1'||!Number.isSafeInteger(value.unixTimeMs)||value.unixTimeMs<0)throw new Error('FINANCE_AUTHORITY_V2_TRUSTED_TIME_INVALID');
  return value.unixTimeMs;
}

export async function readAuthorityJSON(file){return readRegularJSON(file);}
