import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';

const SCHEMA='ynx-finance-endpoint-authority-checkpoint/v1';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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

async function durableReplace(file,value){
  const directory=path.dirname(file),temporary=path.join(directory,`.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}
  await fs.rename(temporary,file);
  const dir=await fs.open(directory,'r');try{await dir.sync();}finally{await dir.close();}
}

async function readLock(lock){
  let handle;
  try{handle=await fs.open(lock,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error?.code==='ELOOP')throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_IDENTITY_INVALID');throw error;}
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||(stat.nlink!==1&&stat.nlink!==2)||stat.size<2||stat.size>4096)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_IDENTITY_INVALID');
    const raw=await handle.readFile('utf8');if(Buffer.byteLength(raw)!==stat.size)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_CHANGED');
    const owner=JSON.parse(raw);
    if(!owner||Object.keys(owner).sort().join(',')!=='nonce,pid,startedAtMs,tempBasename'||!Number.isSafeInteger(owner.pid)||owner.pid<1||!Number.isSafeInteger(owner.startedAtMs)||owner.startedAtMs<0||typeof owner.nonce!=='string'||!/^[a-f0-9-]{36}$/.test(owner.nonce)||owner.tempBasename!==`.checkpoint-lock-${owner.pid}-${owner.nonce}.tmp`)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_INVALID');
    return {owner,raw,stat};
  }finally{await handle.close();}
}

function processAlive(pid){try{process.kill(pid,0);return true;}catch(error){if(error?.code==='ESRCH')return false;if(error?.code==='EPERM')return true;throw error;}}
function sameIdentity(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size;}

async function retireLock(lock,observed){
  const quarantine=`${lock}.retired-${process.pid}-${randomUUID()}`;
  await fs.rename(lock,quarantine);
  const moved=await readLock(quarantine);
  if(!sameIdentity(observed.stat,moved.stat)||moved.raw!==observed.raw)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_SUBSTITUTED');
  if(moved.stat.nlink===2){
    const temporary=path.join(path.dirname(lock),moved.owner.tempBasename),temporaryStat=await fs.lstat(temporary);
    if(!temporaryStat.isFile()||!sameIdentity(moved.stat,temporaryStat))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_TEMP_INVALID');
    await fs.unlink(temporary);
  }
  const finalStat=await fs.lstat(quarantine);
  if(!finalStat.isFile()||finalStat.nlink!==1||!sameIdentity({...moved.stat,nlink:1},finalStat))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_CHANGED');
  await fs.unlink(quarantine);
}

async function acquireLock(lock){
  const nonce=randomUUID(),owner={pid:process.pid,startedAtMs:Date.now(),nonce,tempBasename:`.checkpoint-lock-${process.pid}-${nonce}.tmp`};
  const temporary=path.join(path.dirname(lock),owner.tempBasename),raw=JSON.stringify(owner)+'\n';
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  try{await fs.link(temporary,lock);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
  await fs.unlink(temporary);
  const observed=await readLock(lock);
  if(observed.raw!==raw||observed.owner.pid!==process.pid||observed.owner.nonce!==nonce)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_SUBSTITUTED');
  return observed;
}

async function withLock(file,action){
  const lock=file+'.lock';
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  for(let attempt=0;attempt<80;attempt++){
    let owned;
    try{owned=await acquireLock(lock);}catch(error){
      if(error?.code!=='EEXIST')throw error;
      const observed=await readLock(lock);
      if(!processAlive(observed.owner.pid)){await retireLock(lock,observed);continue;}
      await wait(10);continue;
    }
    try{return await action();}finally{await retireLock(lock,owned);}
  }
  throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOCK_TIMEOUT');
}

export function createNodeCheckpointStore({file,anchor,trustedClockMs}){
  if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_PATH_INVALID');
  const initial=envelope(anchor,0);
  const marker=file+'.initialized';
  const at=()=>{if(!Number.isSafeInteger(trustedClockMs)||trustedClockMs<0)throw new Error('FINANCE_AUTHORITY_V2_CLOCK_INVALID');return trustedClockMs;};
  async function readEnvelope(){
    let value;
    try{value=await readRegularJSON(file);}catch(error){
      if(error?.code!=='ENOENT')throw error;
      try{const handle=await fs.open(marker,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_MARKER_INVALID');}finally{await handle.close();}throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOST');}
      catch(markerError){if(markerError?.code!=='ENOENT')throw markerError;value=initial;}
    }
    if(!value||Object.keys(value).sort().join(',')!=='checkpoint,schemaVersion,trustedClockHighWaterMs'||value.schemaVersion!==SCHEMA)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');
    const checked=envelope(value.checkpoint,value.trustedClockHighWaterMs);
    if(at()<checked.trustedClockHighWaterMs)throw new Error('AUTHORITY_V2_CLOCK_ROLLBACK');
    return checked;
  }
  return Object.freeze({
    async read(){return (await readEnvelope()).checkpoint;},
    async compareAndSwap(previous,next){
      return withLock(file,async()=>{
        const current=await readEnvelope();
        if(!same(current.checkpoint,previous))return false;
        try{const handle=await fs.open(marker,'wx',0o600);try{await handle.writeFile(SCHEMA+'\n');await handle.sync();}finally{await handle.close();}}catch(error){if(error?.code!=='EEXIST')throw error;}
        await durableReplace(file,envelope(next,Math.max(current.trustedClockHighWaterMs,at())));
        return true;
      });
    },
    async inspect(){return readEnvelope();},
  });
}

export async function readTrustedTimeFile(file){
  const value=await readRegularJSON(file);
  if(!value||Object.keys(value).sort().join(',')!=='schemaVersion,unixTimeMs'||value.schemaVersion!=='ynx-trusted-time/v1'||!Number.isSafeInteger(value.unixTimeMs)||value.unixTimeMs<0)throw new Error('FINANCE_AUTHORITY_V2_TRUSTED_TIME_INVALID');
  return value.unixTimeMs;
}

export async function readAuthorityJSON(file){return readRegularJSON(file);}
