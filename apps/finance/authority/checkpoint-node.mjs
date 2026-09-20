import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';

const SCHEMA='ynx-finance-endpoint-authority-checkpoint/v1';
const GENESIS_SCHEMA='ynx-finance-endpoint-authority-checkpoint-genesis/v1';
const TRANSITION_SCHEMA='ynx-finance-endpoint-authority-checkpoint-transition/v1';
const clone=value=>JSON.parse(canonicalAuthorityV2(value));
const same=(a,b)=>canonicalAuthorityV2(a)===canonicalAuthorityV2(b);
const digest=value=>createHash('sha256').update(canonicalAuthorityV2(value)).digest('hex');
const encoded=value=>Buffer.from(canonicalAuthorityV2(value)+'\n');

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

async function syncDirectory(directory){const handle=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await handle.sync();}finally{await handle.close();}}

async function privateDirectoryState(directory){
  if(directory!==path.resolve(directory))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_PATH_INVALID');
  let resolved;try{resolved=await fs.realpath(directory);}catch{throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_INVALID');}
  if(resolved!==directory)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_SYMLINK_INVALID');
  const chain=[];let current=directory;
  while(true){
    const stat=await fs.lstat(current),mode=stat.mode&0o777;
    if(stat.isSymbolicLink())throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_SYMLINK_INVALID');
    if(!stat.isDirectory())throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_INVALID');
    if(current===directory){if(stat.uid!==process.geteuid())throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_OWNER_INVALID');if(mode!==0o700)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_MODE_INVALID');}
    else{if(stat.uid!==0&&stat.uid!==process.geteuid())throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_ANCESTOR_OWNER_INVALID');if((mode&0o022)!==0)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_ANCESTOR_MODE_INVALID');}
    chain.push({path:current,dev:stat.dev,ino:stat.ino,uid:stat.uid,gid:stat.gid,mode});
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
  return chain;
}

const sameDirectory=(a,b)=>a.length===b.length&&a.every((value,index)=>Object.keys(value).every(key=>value[key]===b[index][key]));
const temporaryName=target=>`.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`;

async function repairInterruptedPublish(target,observed){
  if(observed.nlink!==2)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');
  const directory=path.dirname(target),prefix=`.${path.basename(target)}.`,candidates=[];
  for(const name of await fs.readdir(directory)){
    if(!name.startsWith(prefix)||!name.endsWith('.tmp'))continue;
    const candidate=path.join(directory,name);let stat;
    try{stat=await fs.lstat(candidate);}catch(error){if(error?.code==='ENOENT')continue;throw error;}
    if(stat.isFile()&&stat.dev===observed.dev&&stat.ino===observed.ino)candidates.push(candidate);
  }
  if(candidates.length>1)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');
  if(candidates.length===1)await fs.unlink(candidates[0]).catch(error=>{if(error?.code!=='ENOENT')throw error;});
  await syncDirectory(directory);
}

async function readPublishedBytes(target,{missing=false}={}){
  for(let attempt=0;attempt<2;attempt++){
    let handle;
    try{handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error?.code==='ENOENT'&&missing)return null;if(error?.code==='ELOOP')throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');throw error;}
    let stat;
    try{
      stat=await handle.stat();
      if(!stat.isFile()||stat.nlink<1||stat.nlink>2||stat.size<1||stat.size>131072)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');
      if(stat.nlink===1){const bytes=await handle.readFile();if(bytes.length!==stat.size)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_CHANGED_DURING_READ');return bytes;}
    }finally{await handle.close();}
    await repairInterruptedPublish(target,stat);
  }
  throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID');
}

async function publishBytes(target,bytes){
  const directory=path.dirname(target),before=await privateDirectoryState(directory),temporary=path.join(directory,temporaryName(target));let linked=false;
  const handle=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await fs.link(temporary,target);linked=true;}catch(error){if(error?.code!=='EEXIST')throw error;}
  finally{await fs.unlink(temporary).catch(error=>{if(error?.code!=='ENOENT')throw error;});}
  if(linked)await syncDirectory(directory);
  const stored=await readPublishedBytes(target);
  const after=await privateDirectoryState(directory);if(!sameDirectory(before,after))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_CHANGED');
  if(linked&&!stored.equals(bytes))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_PUBLISH_INVALID');
  return {linked,stored};
}

async function markerExists(marker,content){const bytes=await readPublishedBytes(marker,{missing:true});if(bytes===null)return false;if(!bytes.equals(content))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_MARKER_INVALID');return true;}
async function ensureMarker(marker,content){const result=await publishBytes(marker,content);if(!result.stored.equals(content))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_MARKER_INVALID');}

function parseGenesis(bytes){
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');}
  if(!value||Object.keys(value).sort().join(',')!=='anchor,schemaVersion,trustedClockHighWaterMs'||value.schemaVersion!==GENESIS_SCHEMA||value.trustedClockHighWaterMs!==0)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');
  return envelope(value.anchor,0);
}

function parseTransition(bytes,current){
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');}
  if(!value||Object.keys(value).sort().join(',')!=='next,previous,schemaVersion,trustedClockHighWaterMs'||value.schemaVersion!==TRANSITION_SCHEMA||!same(value.previous,current.checkpoint))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');
  const next=assertCheckpoint(value.next);
  if(next.rootVersion<current.checkpoint.rootVersion||next.sequence<=current.checkpoint.sequence||value.trustedClockHighWaterMs<current.trustedClockHighWaterMs)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_ROLLBACK');
  return envelope(value.next,value.trustedClockHighWaterMs);
}

export function createNodeCheckpointStore({file,anchor,trustedClockMs}){
  if(typeof file!=='string'||!path.isAbsolute(file)||file!==path.resolve(file))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_PATH_INVALID');
  const initial=envelope(anchor,0),directory=path.dirname(file),genesis=file+'.genesis',initialized=file+'.initialized',markerContent=Buffer.from(SCHEMA+'\n');
  const at=()=>{if(!Number.isSafeInteger(trustedClockMs)||trustedClockMs<0)throw new Error('FINANCE_AUTHORITY_V2_CLOCK_INVALID');return trustedClockMs;};
  const transitionPath=checkpoint=>`${file}.from-${digest(checkpoint)}`;
  async function prepare(){
    const before=await privateDirectoryState(directory),genesisBytes=await readPublishedBytes(genesis,{missing:true}),marked=await markerExists(initialized,markerContent);
    if(genesisBytes===null&&marked)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOST');
    const genesisEnvelope=genesisBytes===null?parseGenesis((await publishBytes(genesis,encoded({schemaVersion:GENESIS_SCHEMA,anchor:initial.checkpoint,trustedClockHighWaterMs:0}))).stored):parseGenesis(genesisBytes);
    await ensureMarker(initialized,markerContent);
    const after=await privateDirectoryState(directory);if(!sameDirectory(before,after))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_DIRECTORY_CHANGED');
    return genesisEnvelope;
  }
  async function inspect(){
    let current=await prepare();
    for(let depth=0;depth<10000;depth++){
      const target=transitionPath(current.checkpoint),marker=target+'.committed',bytes=await readPublishedBytes(target,{missing:true}),marked=await markerExists(marker,markerContent);
      if(bytes===null){if(marked)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOST');if(at()<current.trustedClockHighWaterMs)throw new Error('AUTHORITY_V2_CLOCK_ROLLBACK');return current;}
      current=parseTransition(bytes,current);await ensureMarker(marker,markerContent);
    }
    throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_CHAIN_TOO_LONG');
  }
  return Object.freeze({
    async read(){return (await inspect()).checkpoint;},
    async compareAndSwap(previous,next){
      const current=await inspect();if(!same(current.checkpoint,previous))return false;
      const checkedNext=assertCheckpoint(next);if(same(current.checkpoint,checkedNext))return true;
      if(checkedNext.rootVersion<current.checkpoint.rootVersion||checkedNext.sequence<=current.checkpoint.sequence)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_ROLLBACK');
      const value={schemaVersion:TRANSITION_SCHEMA,previous:current.checkpoint,next:checkedNext,trustedClockHighWaterMs:Math.max(current.trustedClockHighWaterMs,at())},target=transitionPath(current.checkpoint);
      const published=await publishBytes(target,encoded(value)),stored=parseTransition(published.stored,current);
      await ensureMarker(target+'.committed',markerContent);
      if(published.linked&&!same(stored.checkpoint,next))throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_PUBLISH_INVALID');
      return published.linked;
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
