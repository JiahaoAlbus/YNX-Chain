import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {PrivateFilePolicy} from './platform-private-file.mjs';
import {readBoundedPrivateFile} from './bounded-private-file-read.mjs';
// Original SDK envelope only. Never write a credential, custom wrapper, key
// material, overwrite an existing file or remove an uncertain partial export.
const LIMIT=196608;
const fail=code=>{throw Object.assign(Error(code),{code});};
export class PQBackupFile {
 constructor({io=fs,platform=process.platform,policy=new PrivateFilePolicy({io,platform})}={}){this.io=io;this.platform=platform;this.policy=policy;}
 async read(filePath,guard){
  let handle,failed=false;
  try{
   guard.assert();handle=await this.io.open(filePath,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
   const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>LIMIT)fail('PQ_BACKUP_FILE_INVALID');
   await this.policy.assertPrivate(filePath,stat);guard.assert();
   const text=await readBoundedPrivateFile(handle,LIMIT);guard.assert();
   return new TextEncoder().encode(text);
  }catch{failed=true;fail('PQ_BACKUP_FILE_UNVERIFIED');}
  finally{try{await handle?.close();}catch{if(!failed)fail('PQ_BACKUP_FILE_UNVERIFIED');}}
 }
 async write(filePath,wire,guard){
  let handle,created=false,failed=false;
  try{
   if(!(wire instanceof Uint8Array)||wire.buffer instanceof SharedArrayBuffer||wire.length<1||wire.length>LIMIT)fail('PQ_BACKUP_FILE_INVALID');
   guard.assert();await this.policy.available(filePath);
   const parent=await this.io.lstat(path.dirname(filePath));
   if(!parent.isDirectory()||parent.isSymbolicLink()||this.platform!=='win32'&&(parent.mode&0o022)!==0)fail('PQ_BACKUP_FILE_INVALID');
   guard.assert();handle=await this.io.open(filePath,'wx',0o600);created=true;
   await this.policy.protect(filePath);guard.assert();await handle.writeFile(wire);await handle.sync();
   await this.policy.assertPrivate(filePath,await handle.stat());guard.assert();
   if(this.platform!=='win32'){const directory=await this.io.open(path.dirname(filePath),'r');try{await directory.sync();}finally{await directory.close();}}
   guard.assert();
  }catch{failed=true;throw Object.assign(Error('PQ_BACKUP_EXPORT_UNCONFIRMED'),{code:'PQ_BACKUP_EXPORT_UNCONFIRMED',fileCreated:created});}
  finally{try{await handle?.close();}catch{if(!failed)throw Object.assign(Error('PQ_BACKUP_EXPORT_UNCONFIRMED'),{code:'PQ_BACKUP_EXPORT_UNCONFIRMED',fileCreated:created});}}
 }
}
