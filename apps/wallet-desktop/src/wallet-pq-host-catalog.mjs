import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
const fail=code=>{throw Object.assign(Error(code),{code});};
const invalid=()=>fail('PQ_HOST_CATALOG_UNVERIFIED');
const statKeys=['dev','ino','size','mode','uid','nlink','mtimeMs','ctimeMs'];
function same(before,after){if(statKeys.some(k=>before[k]!==after[k]))invalid();}
function registration(value){
 if(value===null||value===undefined)fail('PQ_HOST_SOURCE_NOT_SUPPLIED');
 if(types.isProxy(value)||!value||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(keys.length!==2||keys.some(k=>!['catalogPath','catalogSha256'].includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))invalid();
 const catalogPath=d.catalogPath.value,catalogSha256=d.catalogSha256.value;
 if(typeof catalogPath!=='string'||!path.isAbsolute(catalogPath)||path.normalize(catalogPath)!==catalogPath||catalogPath===path.parse(catalogPath).root||catalogPath.includes('\0')||Buffer.byteLength(catalogPath)>4096||Buffer.from(catalogPath).toString()!==catalogPath||typeof catalogSha256!=='string'||!/^[a-f0-9]{64}$/.test(catalogSha256)||/^0{64}$/.test(catalogSha256))invalid();
 return Object.freeze({catalogPath,catalogSha256});
}
/** Private Main receiver of the ORIGINAL Protocol registration result pair.
 * The independent pair is a source-owned commissioning dependency: never read
 * it from this catalog, ENV, renderer, RPC or an adjacent self-manifest. The
 * digest establishes bytes only, NOT permission, Root or finality. Protocol's
 * original selector still validates business binding and Host current/trust.
 * Bounded synchronous IO avoids creating an unretained asynchronous loader
 * resource between Main guard and original process-owner capture. Read-only:
 * no create/repair/chmod, producer invocation or fallback on any error.
 */
export function readOriginalPQHostSourceCatalog(independentRegistration){
 const selected=registration(independentRegistration);let fd,result,cause,failed=false;
 try{
  if(typeof process.getuid!=='function'||process.getuid()===0)invalid();
  const uid=process.getuid(),file=selected.catalogPath,dir=path.dirname(file);
  if(fs.realpathSync(dir)!==dir||fs.realpathSync(file)!==file)invalid();
  const parent=fs.lstatSync(dir);
  if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==uid||(parent.mode&0o7777)!==0o700)invalid();
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.nlink!==1||before.uid!==uid||(before.mode&0o7777)!==0o600||before.size<1||before.size>16384)invalid();
  const bytes=Buffer.alloc(before.size);let at=0;
  while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,null);if(!n)invalid();at+=n;}
  if(createHash('sha256').update(bytes).digest('hex')!==selected.catalogSha256)invalid();
  same(before,fs.fstatSync(fd));same(before,fs.lstatSync(file));same(parent,fs.lstatSync(dir));
  if(fs.realpathSync(dir)!==dir||fs.realpathSync(file)!==file)invalid();
  result=selected;
 }catch(error){failed=true;cause=error;}
 finally{if(fd!==undefined)try{fs.closeSync(fd);}catch(error){if(failed){if(cause&&typeof cause==='object'&&!Object.hasOwn(cause,'cleanupCause'))cause.cleanupCause=error;}else{failed=true;cause=error;}}}
 if(failed)throw Object.assign(Error('Original private Protocol catalog could not be verified.'),{code:'PQ_HOST_CATALOG_UNVERIFIED',cause});
 return result;
}
