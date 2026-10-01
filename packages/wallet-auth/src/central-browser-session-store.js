import {createHash,randomUUID} from 'node:crypto';
import {chmodSync,closeSync,constants,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {hostname} from 'node:os';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';

const MAX_BYTES=8*1024*1024,MAX_RECORDS=10000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const empty=()=>({schemaVersion:1,revision:0,clockHighWaterMs:0,challenges:[],sessions:[],codes:[],grants:[]});
const owner=stat=>typeof process.getuid!=='function'||stat.uid===process.getuid();
const noFollow=constants.O_NOFOLLOW??0;
const host=hostname();
function safe(stat,kind){if(!owner(stat)||(stat.mode&0o077)!==0||stat.isSymbolicLink()||(kind==='file'?(!stat.isFile()||stat.nlink!==1):!stat.isDirectory()))fail('SSO_STATE_PERMISSIONS');}
function validate(state){
  exactFields(state,['schemaVersion','revision','clockHighWaterMs','challenges','sessions','codes','grants',...(state.schemaVersion===2?['families','backendNonces']:[])],'Central durable state');
  if(![1,2].includes(state.schemaVersion)||!Number.isSafeInteger(state.revision)||state.revision<0||!Number.isSafeInteger(state.clockHighWaterMs)||state.clockHighWaterMs<0)fail('SSO_STATE_INVALID');
  for(const key of ['challenges','sessions','codes','grants',...(state.schemaVersion===2?['families','backendNonces']:[])])if(!Array.isArray(state[key])||state[key].length>MAX_RECORDS)fail('SSO_STATE_CAPACITY');
  if(Buffer.byteLength(canonicalJSON(state))>MAX_BYTES)fail('SSO_STATE_CAPACITY');
}

// Each transaction reloads under an exclusive, owner-bound filesystem lock.
// Multiple processes on ONE host share one local filesystem path. This is not
// distributed storage; foreign-host state/locks are rejected, never reclaimed.
// Network/async work must finish BEFORE entering this synchronous transaction.
export class CentralBrowserSessionStore {
  #path;#lock;#marker;
  constructor(path){
    if(typeof path!=='string'||!isAbsolute(path)||path==='/'||dirname(path)==='/')fail('SSO_STATE_PATH');
    this.#path=path;this.#lock=`${path}.lock`;this.#marker=`${path}.initialized`;
    mkdirSync(dirname(path),{recursive:true,mode:0o700});safe(lstatSync(dirname(path)),'directory');
    this.transaction(()=>{});
  }
  transaction(mutate){
    if(typeof mutate!=='function')fail('SSO_STATE_TRANSACTION');
    const lock=this.#acquire();
    try{
      const stored=this.#read(),state=stored?.snapshot??empty(),before=canonicalJSON(state);
      const marked=this.#exists(this.#marker),marker=marked?this.#readBound(this.#marker,512):null;
      if(marker&&marker.raw!==canonicalJSON({host,schemaVersion:1}))fail('SSO_STATE_FOREIGN_HOST');
      if(stored===null&&marked)fail('SSO_STATE_LOST');
      // A crash between first state and marker creation requires explicit owner
      // recovery, just like later marker loss. Never silently reinitialize.
      if(stored!==null&&!marked)fail('SSO_STATE_MARKER_LOST');
      const result=mutate(state);
      if(result&&typeof result.then==='function')fail('SSO_STATE_ASYNC_TRANSACTION');
      validate(state);
      if(canonicalJSON(state)!==before||stored===null){state.revision++;this.#write(state,stored?.identity??null,marker?.identity??null);}
      if(!this.#exists(this.#marker)){
        const marker=openSync(this.#marker,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|noFollow,0o600);
        try{writeFileSync(marker,canonicalJSON({host,schemaVersion:1}));fsyncSync(marker)}finally{closeSync(marker)}
        const dir=openSync(dirname(this.#path),constants.O_RDONLY);try{fsyncSync(dir)}finally{closeSync(dir)}
      }
      return structuredClone(result);
    }finally{
      closeSync(lock.fd);
      const stat=lstatSync(this.#lock);safe(stat,'file');
      if(stat.dev!==lock.dev||stat.ino!==lock.ino)fail('SSO_STATE_LOCK_CHANGED');
      unlinkSync(this.#lock);
    }
  }
  snapshot(){return this.transaction(state=>structuredClone(state));}
  #exists(path=this.#path){try{lstatSync(path);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
  #acquire(recovered=false){
    let fd;
    try{
      fd=openSync(this.#lock,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|noFollow,0o600);
      writeFileSync(fd,canonicalJSON({host,pid:process.pid,id:randomUUID()}));fsyncSync(fd);
      const stat=fstatSync(fd);safe(stat,'file');return {fd,dev:stat.dev,ino:stat.ino};
    }catch(error){
      if(fd!==undefined)closeSync(fd);
      if(error.code!=='EEXIST')throw error;
      let locked;
      try{locked=this.#readBound(this.#lock,512)}catch(caught){
        if(caught.code==='ENOENT'&&!recovered)return this.#acquire(true);
        if(caught.code==='SSO_STATE_TAMPERED')fail('SSO_STATE_BUSY');throw caught;
      }
      const {identity:stat,raw}=locked;
      // O_EXCL makes the file visible just before its tiny owner record write.
      // Empty initializing locks are busy, never permission to steal the lock.
      if(raw==='')fail('SSO_STATE_BUSY');
      let record;try{record=JSON.parse(raw)}catch{fail('SSO_STATE_LOCK_INVALID')}
      exactFields(record,['host','pid','id'],'Central transaction lock');
      if(record.host!==host)fail('SSO_STATE_FOREIGN_HOST');
      if(!Number.isSafeInteger(record.pid)||record.pid<1||typeof record.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.id))fail('SSO_STATE_LOCK_INVALID');
      try{process.kill(record.pid,0)}catch(caught){
        if(caught.code==='ESRCH'&&!recovered){
          const fresh=lstatSync(this.#lock);if(fresh.dev!==stat.dev||fresh.ino!==stat.ino)fail('SSO_STATE_BUSY');
          unlinkSync(this.#lock);return this.#acquire(true);
        }
      }
      fail('SSO_STATE_BUSY');
    }
  }
  #readBound(path,limit=MAX_BYTES){
    const fd=openSync(path,constants.O_RDONLY|noFollow);
    try{const stat=fstatSync(fd);safe(stat,'file');if(stat.size>limit)fail('SSO_STATE_CAPACITY');
      const raw=readFileSync(fd,'utf8'),fresh=lstatSync(path);safe(fresh,'file');
      if(fresh.dev!==stat.dev||fresh.ino!==stat.ino||fresh.size!==stat.size)fail('SSO_STATE_TAMPERED');
      return {raw,identity:{dev:stat.dev,ino:stat.ino,size:stat.size,digest:hash(raw)}};
    }finally{closeSync(fd)}
  }
  #read(){
    try{
      const {raw,identity}=this.#readBound(this.#path),envelope=JSON.parse(raw);
      exactFields(envelope,['host','snapshot','digest'],'Central durable envelope');validate(envelope.snapshot);
      if(envelope.host!==host)fail('SSO_STATE_FOREIGN_HOST');
      if(canonicalJSON(envelope)!==raw||hash(canonicalJSON(envelope.snapshot))!==envelope.digest)fail('SSO_STATE_TAMPERED');
      return {snapshot:envelope.snapshot,identity};
    }catch(error){if(error.code==='ENOENT')return null;throw error}
  }
  #write(snapshot,expected,markerIdentity){
    validate(snapshot);const temporary=`${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    const encoded=canonicalJSON({host,snapshot,digest:hash(canonicalJSON(snapshot))});let fd,renamed=false;
    try{
      fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|noFollow,0o600);
      writeFileSync(fd,encoded);fsyncSync(fd);safe(fstatSync(fd),'file');closeSync(fd);fd=undefined;
      const current=this.#read();
      if(canonicalJSON(current?.identity??null)!==canonicalJSON(expected))fail('SSO_STATE_TAMPERED');
      const marker=this.#exists(this.#marker)?this.#readBound(this.#marker,512):null;
      if(canonicalJSON(marker?.identity??null)!==canonicalJSON(markerIdentity))fail('SSO_STATE_TAMPERED');
      renameSync(temporary,this.#path);renamed=true;chmodSync(this.#path,0o600);
      const directory=openSync(dirname(this.#path),constants.O_RDONLY);try{fsyncSync(directory)}finally{closeSync(directory)}
      const verified=this.#read();if(canonicalJSON(verified?.snapshot)!==canonicalJSON(snapshot))fail('SSO_STATE_TAMPERED');
    }finally{if(fd!==undefined)closeSync(fd);if(!renamed)try{unlinkSync(temporary)}catch(error){if(error.code!=='ENOENT')throw error}}
  }
}
function fail(code){throw new WalletAuthError(code,'Central browser durable transaction failed closed');}
