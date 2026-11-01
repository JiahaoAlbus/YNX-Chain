// PRIVATE mechanical IO custody. A file set, including its public constructor,
// is NOT Root provenance, Source admission, a loader permit or a Native owner.
// The normal Source must independently verify the original signed profile and
// current before/after using it. No require/import/dlopen happens in this file.
import {openSync, closeSync, lstatSync, fstatSync, readSync, constants as F,
  realpathSync} from 'node:fs';
import {dirname, posix} from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {inspectOriginalAuthRuntimeImageBindingV1DATA} from '../native/original-auth-runtime-image-binding-v1.mjs';

const fail = code => {throw Object.assign(new Error(code), {code});};
const same = (a,b) => ['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const sameParent = (a,b) => ['dev','ino','uid','gid','mode'].every(k=>a[k]===b[k]);
const CAP=268435456, LEAF=16777216;
function record(value,keys) {
  if(!value || types.isProxy(value) || Object.getPrototypeOf(value)!==Object.prototype)fail('AUTH_RUNTIME_FILES_SCHEMA');
  const d=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(d).length!==keys.length || keys.some(k=>!d[k]?.enumerable || !Object.hasOwn(d[k],'value')))fail('AUTH_RUNTIME_FILES_SCHEMA');
}
function trustedParents(path) {
  const parents=[];
  for(let p=dirname(path);;p=dirname(p)) {
    const s=lstatSync(p);
    if(!s.isDirectory() || s.isSymbolicLink() || s.uid!==0 || (s.mode&0o022))fail('AUTH_RUNTIME_FILES_PARENT');
    parents.push([p,s]);if(p==='/')return parents;
  }
}
function readAndHash(fd,bytes,keep) {
  const h=createHash('sha256'),chunks=[];let offset=0;
  while(offset<bytes) {
    const b=Buffer.allocUnsafe(Math.min(65536,bytes-offset));
    const n=readSync(fd,b,0,b.length,offset);
    if(!n)fail('AUTH_RUNTIME_FILES_TRUNCATED');
    h.update(b.subarray(0,n));if(keep)chunks.push(b.subarray(0,n));offset+=n;
  }
  if(readSync(fd,Buffer.alloc(1),0,1,offset)!==0)fail('AUTH_RUNTIME_FILES_LENGTH');
  return {sha256:h.digest('hex'),raw:keep?Buffer.concat(chunks):null};
}

export class OriginalAuthRuntimeImageFilesV1 {
  #binding; #files=new Map(); #parents=new Map(); #retired=false; #opened=false; #first; #closeResult; #total=0;
  constructor(binding,purpose) {
    // Sole SDK DATA grammar, not a second profile or admission parser.
    this.#binding=inspectOriginalAuthRuntimeImageBindingV1DATA(binding,purpose).runtimeImageBindingV1;
    Object.freeze(this);
  }
  #live(){if(this.#first)throw this.#first.cause;if(this.#retired)fail('AUTH_RUNTIME_FILES_RETIRED');}
  #remember(cause){this.#first??={cause};return this.#first.cause;}
  #currentFile(f) {
    if(!same(f.stat,fstatSync(f.fd)) || !same(f.stat,lstatSync(f.pin.path)) || realpathSync(f.pin.path)!==f.pin.path)fail('AUTH_RUNTIME_FILES_CHANGED');
    for(const[p,s]of f.parents) {
      const n=lstatSync(p);
      const held=this.#parents.get(p);
      if(!held || !n.isDirectory() || n.isSymbolicLink() || !sameParent(s,n) || !sameParent(s,fstatSync(held.fd)))fail('AUTH_RUNTIME_FILES_PARENT_CHANGED');
    }
  }
  #hold(pin,keep=false) {
    const previous=this.#files.get(pin.path);
    if(previous) {
      if(previous.pin.bytes!==pin.bytes || previous.pin.sha256!==pin.sha256)fail('AUTH_RUNTIME_FILES_CONFLICT');
      this.#currentFile(previous);return previous.raw;
    }
    if(!Number.isSafeInteger(pin.bytes)||pin.bytes<1||pin.bytes>LEAF||this.#total+pin.bytes>CAP)fail('AUTH_RUNTIME_FILES_CAPACITY');
    const parents=trustedParents(pin.path);
    for(const [path,stat]of parents)if(!this.#parents.has(path)){
      const fd=openSync(path,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK|F.O_DIRECTORY);
      this.#parents.set(path,{fd,stat,closed:false});
      if(!sameParent(stat,fstatSync(fd))||!sameParent(stat,lstatSync(path)))fail('AUTH_RUNTIME_FILES_PARENT_CHANGED');
    }
    if(realpathSync(pin.path)!==pin.path)fail('AUTH_RUNTIME_FILES_ALIAS');
    const fd=openSync(pin.path,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);
    // Adopt immediately: every nonnull partial is retained even on late error.
    const f={pin:{...pin},parents,fd,stat:null,raw:null,closed:false};
    this.#files.set(pin.path,f);this.#total+=pin.bytes;
    f.stat=fstatSync(fd);
    if(!f.stat.isFile() || f.stat.nlink!==1 || f.stat.uid!==0 || (f.stat.mode&0o022) || f.stat.size!==pin.bytes)fail('AUTH_RUNTIME_FILES_TUPLE');
    const result=readAndHash(fd,pin.bytes,keep);
    if(result.sha256!==pin.sha256)fail('AUTH_RUNTIME_FILES_HASH');
    f.raw=result.raw;this.#currentFile(f);return f.raw;
  }
  open() {
    this.#live();if(this.#files.size)fail('AUTH_RUNTIME_FILES_ALREADY_OPEN');
    try {
      const b=this.#binding;
      const raw=this.#hold(b.runtimeManifest,true),m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      record(m,['version','files']);
      if(m.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Array.isArray(m.files)||m.files.length<1||m.files.length>4096)fail('AUTH_RUNTIME_FILES_MANIFEST');
      const required=new Set(['package.json','native/original-auth-identity-source-verifier.mjs','native/original-ide-auth-proof-dispatch.mjs','native/original-auth-identity-v2-contract.mjs','src/auth-identity-verification.js','src/pq-wallet-policy.js','src/pq-wallet-authorization.js',
        'native/original-auth-source-v2-dispatch.mjs','native/original-auth-identity-source-v2-verifier.mjs','native/original-auth-runtime-image-binding-v1.mjs',
        'src/original-auth-runtime-image-source-v1.js','src/original-auth-runtime-image-files-v1.js']);
      let previous='';
      for(const pin of m.files) {
        record(pin,['path','bytes','sha256']);const p=pin.path;
        if(typeof p!=='string'||!p.length||p.length>512||/[^\x20-\x7e]/.test(p)||p.includes('\\')||p.startsWith('/')||p.split('/').some(v=>v==='.'||v==='..'||!v)||posix.normalize(p)!==p||p<=previous||p==='native/original-ide-auth-runtime-manifest.json'||typeof pin.sha256!=='string'||!/^[0-9a-f]{64}$/.test(pin.sha256))fail('AUTH_RUNTIME_FILES_MANIFEST_PATH');
        this.#hold({...pin,path:b.normalPackageRoot+'/'+p});required.delete(p);previous=p;
      }
      if(required.size)fail('AUTH_RUNTIME_FILES_INCOMPLETE');
      // Both normal JS entrypoints must already belong to the held closure.
      for(const pin of[b.fixedLoader,b.privateModule]) {
        const f=this.#files.get(pin.path);
        if(!f||f.pin.bytes!==pin.bytes||f.pin.sha256!==pin.sha256)fail('AUTH_RUNTIME_FILES_ENTRY_NOT_IN_CLOSURE');
      }
      this.#hold(b.implementingImage);this.#opened=true;this.current();return this;
    }catch(cause){this.#opened=false;throw this.#remember(cause);}
  }
  current() {
    this.#live();if(!this.#opened)fail('AUTH_RUNTIME_FILES_NOT_OPEN');try{for(const f of this.#files.values())this.#currentFile(f);}catch(cause){throw this.#remember(cause);}
  }
  rehash() {
    this.current();try {for(const f of this.#files.values()){if(readAndHash(f.fd,f.pin.bytes,false).sha256!==f.pin.sha256)fail('AUTH_RUNTIME_FILES_HASH');this.#currentFile(f);}}catch(cause){throw this.#remember(cause);}
  }
  // Pure comparison DATA only. The normal caller MUST capture actual loaded
  // image identity from its native loader, not accept renderer/request fields.
  compareLoadedImageDATA(actual) {
    this.current();record(actual,['path','device','inode','bytes','sha256','privateModuleURI']);
    const f=this.#files.get(this.#binding.implementingImage.path);
    if(!f || actual.path!==f.pin.path || actual.device!==String(f.stat.dev)||actual.inode!==String(f.stat.ino)||actual.bytes!==f.pin.bytes||actual.sha256!==f.pin.sha256||actual.privateModuleURI!==this.#binding.privateModule.uri)fail('AUTH_RUNTIME_FILES_LOADED_IMAGE_MISMATCH');
    this.rehash();return Object.freeze({matches:true,dataOnly:true,SourceAdmission:false,NativeAdmission:false});
  }
  retire(){this.#retired=true;}
  close() {
    if(this.#closeResult){if(this.#closeResult.failed)throw this.#closeResult.cause;return;}
    this.retire();let first;
    for(const f of [...this.#files.values()].reverse()) {
      if(f.closed)continue;f.closed=true;
      try{closeSync(f.fd);}catch(cause){first??={cause};}
    }
    for(const p of [...this.#parents.values()].reverse()){
      if(p.closed)continue;p.closed=true;
      try{closeSync(p.fd);}catch(cause){first??={cause};}
    }
    this.#closeResult=first?{failed:true,cause:first.cause}:{failed:false};
    if(first)throw first.cause;
  }
  statusDATA(){return Object.freeze({opened:this.#opened,held:this.#files.size,retired:this.#retired,failed:!!this.#first,firstCausePresent:!!this.#first,firstCause:this.#first?.cause,closeSelected:!!this.#closeResult,closeCausePresent:!!this.#closeResult?.failed,closeCause:this.#closeResult?.cause,dataOnly:true,SourceAdmission:false,NativeAdmission:false});}
}
Object.freeze(OriginalAuthRuntimeImageFilesV1.prototype);
Object.freeze(OriginalAuthRuntimeImageFilesV1);
