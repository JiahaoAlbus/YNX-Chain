// PRIVATE normal pre-load Source. No install/adopt/provider/path/Root setter.
// The independently reviewed release supplies ORIGINAL Root/enrollment pins and
// fixed public-record location, not a post-build image hash compiled into itself.
import {constants as F,openSync,closeSync,lstatSync,fstatSync,readSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical} from '../native/original-auth-identity-source-verifier.mjs';
import {dispatchOriginalSourceV2} from '../native/original-auth-source-v2-dispatch.mjs';
import {inspectOriginalAuthRuntimeImageBindingV1DATA} from '../native/original-auth-runtime-image-binding-v1.mjs';
import {OriginalAuthRuntimeImageFilesV1} from './original-auth-runtime-image-files-v1.js';
const released=Object.freeze([]),owners=new WeakSet();let active,opening;
const fail=c=>{throw Object.assign(Error(c),{code:c});},sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
// Directory contents/timestamps may change for unrelated siblings. Identity,
// protected ownership/mode and no-symlink type must not change; held leaf files
// still bind full tuples, nlink, length and bytes independently.
const sameParent=(a,b)=>a.isDirectory()&&b.isDirectory()&&!a.isSymbolicLink()&&!b.isSymbolicLink()&&['dev','ino','uid','gid','mode'].every(k=>a[k]===b[k]);
function parents(path){const rows=[];for(let p=dirname(path);;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail('AUTH_IMAGE_SOURCE_PARENT');rows.push([p,s]);if(p==='/')return rows;}}
function bytes(fd,length){const out=Buffer.alloc(length);let offset=0;while(offset<length){const n=readSync(fd,out,offset,length-offset,offset);if(!n)fail('AUTH_IMAGE_SOURCE_TRUNCATED');offset+=n;}if(readSync(fd,Buffer.alloc(1),0,1,length))fail('AUTH_IMAGE_SOURCE_EXTRA');return out;}
function observe(path,cap,retained){
 for(const[p,stat]of parents(path))if(!retained.some(r=>r.kind==='parent'&&r.path===p)){
  const fd=openSync(p,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK|F.O_DIRECTORY);retained.push({kind:'parent',path:p,fd,stat,closeSelected:false});
  if(!sameParent(stat,fstatSync(fd)))fail('AUTH_IMAGE_SOURCE_PARENT_CHANGED');
 }
 if(realpathSync(path)!==path)fail('AUTH_IMAGE_SOURCE_ALIAS');
 let row=retained.find(r=>r.kind==='file'&&r.path===path);
 if(!row){const fd=openSync(path,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);row={kind:'file',path,fd,stat:null,closeSelected:false};retained.push(row);row.stat=fstatSync(fd);}
 const s=row.stat,fd=row.fd;
 if(!s.isFile()||s.nlink!==1||s.uid!==0||(s.mode&0o022)||s.size<1||s.size>cap)fail('AUTH_IMAGE_SOURCE_FILE');
 if(!same(s,fstatSync(fd))||!same(s,lstatSync(path)))fail('AUTH_IMAGE_SOURCE_CHANGED');
 const b=bytes(fd,s.size);
 if(!same(s,fstatSync(fd))||!same(s,lstatSync(path)))fail('AUTH_IMAGE_SOURCE_CHANGED');
 for(const p of retained.filter(r=>r.kind==='parent')){const n=lstatSync(p.path);if(!sameParent(p.stat,fstatSync(p.fd))||!sameParent(p.stat,n))fail('AUTH_IMAGE_SOURCE_PARENT_CHANGED');}
 return{path,bytes:b.length,sha256:sha(b)};
}
function actualBuildFacts(retained){
 const here=fileURLToPath(import.meta.url);if(realpathSync(here)!==here)fail('AUTH_IMAGE_SOURCE_MODULE_ALIAS');const root=dirname(dirname(here));
 const privatePath=root+'/src/original-http-binary-v5-client-private.js';
 return{version:'1',normalPackageRoot:root,fixedLoader:observe(root+'/src/original-auth-identity-fixed-native-image.js',16384,retained),runtimeManifest:observe(root+'/native/original-ide-auth-runtime-manifest.json',1048576,retained),implementingImage:observe(dirname(dirname(root))+'/apps/wallet-desktop/native/original-auth-identity.node',16777216,retained),privateModule:{...observe(privatePath,16777216,retained),uri:pathToFileURL(privatePath).href}};
}
class PublicOriginalRecord {
 #fd;#path;#stat;#parents=[];#raw;#rawHash;#closed=false;#first;
 constructor(path){this.#path=path;Object.freeze(this);}
 open(){for(const[path,stat]of parents(this.#path)){const fd=openSync(path,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK|F.O_DIRECTORY);this.#parents.push({path,stat,fd});if(!sameParent(stat,fstatSync(fd)))fail('AUTH_IMAGE_SOURCE_PARENT_CHANGED');}if(realpathSync(this.#path)!==this.#path)fail('AUTH_IMAGE_SOURCE_RECORD_ALIAS');this.#fd=openSync(this.#path,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);this.#stat=fstatSync(this.#fd);const s=this.#stat;if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||s.size<1||s.size>2097152)fail('AUTH_IMAGE_SOURCE_RECORD');const raw=bytes(this.#fd,s.size);this.#rawHash=sha(raw);this.#raw=new TextDecoder('utf-8',{fatal:true}).decode(raw);const v=JSON.parse(this.#raw);if(canonical(v)!==this.#raw||Object.keys(v).sort().join('|')!=='enrollmentRaw|headRaw|profileRaw|rootRaw')fail('AUTH_IMAGE_SOURCE_RECORD_SCHEMA');for(const[k,x]of Object.entries(v))if(typeof x!=='string'||!x.length||Buffer.byteLength(x)>(k==='rootRaw'?16384:393216))fail('AUTH_IMAGE_SOURCE_RECORD_CAPACITY');this.current();return Object.freeze(v);}
 current(){if(this.#closed||this.#fd===undefined||!same(this.#stat,fstatSync(this.#fd))||!same(this.#stat,lstatSync(this.#path))||realpathSync(this.#path)!==this.#path||sha(bytes(this.#fd,this.#stat.size))!==this.#rawHash)fail('AUTH_IMAGE_SOURCE_RECORD_CHANGED');for(const{path,stat,fd}of this.#parents){const n=lstatSync(path);if(!sameParent(stat,fstatSync(fd))||!sameParent(stat,n))fail('AUTH_IMAGE_SOURCE_PARENT_CHANGED');}}
 close(){if(this.#closed){if(this.#first)throw this.#first.cause;return;}this.#closed=true;for(const fd of[this.#fd,...this.#parents.map(p=>p.fd).reverse()])try{if(fd!==undefined)closeSync(fd);}catch(cause){this.#first??={cause};}if(this.#first)throw this.#first.cause;}
}
Object.freeze(PublicOriginalRecord.prototype);Object.freeze(PublicOriginalRecord);
class OriginalRuntimeImageAdmissionOwnerV1 {
 #entry;#record;#originals;#files;#binding;#observed=[];#pending=new Set();#checking;#lastObservation;#retired=false;#first;#closing;#closeCause;#closeDone=false;#expires=0;#wall=0;#mono=0;#wallFloor=0;#monoFloor=0;#initializationSelected=false;
 #previous={sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'};
 constructor(entry){this.#entry=structuredClone(entry);owners.add(this);Object.freeze(this);}
 #remember(cause){this.#first??={cause};return this.#first.cause;}
 #live(){if(this.#first)throw this.#first.cause;if(this.#retired)fail('AUTH_IMAGE_SOURCE_RETIRED');}
 async initialize(){try{if(this.#initializationSelected)fail('AUTH_IMAGE_SOURCE_INITIALIZE_SELECTED');this.#initializationSelected=true;this.#record=new PublicOriginalRecord(this.#entry.recordPath);this.#originals=this.#record.open();await this.recheck();return this;}catch(cause){throw this.#remember(cause);}}
 recheck(){this.#live();if(this.#checking)return this.#checking;const work=(async()=>{try{
   this.#live();this.#record.current();const started=Date.now(),mono=performance.now(),expected=actualBuildFacts(this.#observed),e=this.#entry;
   if(!Number.isSafeInteger(started)||!Number.isFinite(mono))fail('AUTH_IMAGE_SOURCE_CLOCK_INVALID');
   inspectOriginalAuthRuntimeImageBindingV1DATA(expected,e.policy.signatureContract.purpose);
   const observed=await dispatchOriginalSourceV2({operation:'auth-source-v2-native-node/v1',node:e.node,...this.#originals,policy:e.policy,previous:this.#previous}),p=observed.projection;
   // Retain original returned evidence BEFORE retirement/late-current fences.
   this.#lastObservation=Object.freeze({currentRaw:observed.currentRaw,projection:structuredClone(p)});
   this.#live();this.#record.current();
   if(p.status!=='active'||p.sourceId!==e.sourceId||p.instanceId!==e.instanceId||!p.runtimeImageBindingV1DATA||canonical(p.runtimeImageBindingV1DATA)!==canonical(expected))fail('AUTH_IMAGE_SOURCE_SIGNED_BINDING');
   if(this.#binding&&canonical(this.#binding)!==canonical(expected))fail('AUTH_IMAGE_SOURCE_IMMUTABLE_BINDING');
   if(!this.#files){this.#binding=expected;this.#files=new OriginalAuthRuntimeImageFilesV1(expected,e.policy.signatureContract.purpose);this.#files.open();}else this.#files.rehash();
   const now=Date.now(),end=performance.now();if(!Number.isSafeInteger(now)||!Number.isFinite(end)||now<started||end<mono||now>=p.expiresAtMs||now<this.#previous.timeFloor)fail('AUTH_IMAGE_SOURCE_POST_CURRENT_EXPIRED');
   this.#previous={sequence:p.sequence,floor:p.floor,head:p.head,timeFloor:now,executionHeight:p.executionHeight};
   // A bounded signed-current lease, never an indefinite startup-cache permit.
   this.#wall=started;this.#mono=mono;this.#expires=Math.min(p.expiresAtMs,started+5000);this.assertPreLoadCurrent();
  }catch(cause){throw this.#remember(cause);}})();this.#checking=work;this.#pending.add(work);const done=()=>{this.#pending.delete(work);if(this.#checking===work)this.#checking=undefined;};work.then(done,done);return work;}
 #leaseTimeCurrent(){const now=Date.now(),mono=performance.now(),elapsed=mono-this.#mono;if(!this.#files||!Number.isSafeInteger(now)||!Number.isFinite(mono)||now<this.#wall||now<this.#wallFloor||mono<this.#monoFloor||elapsed<0||Math.max(now,this.#wall+elapsed)>=this.#expires)fail('AUTH_IMAGE_SOURCE_PRELOAD_EXPIRED');this.#wallFloor=now;this.#monoFloor=mono;}
 assertPreLoadCurrent(){this.#live();this.#leaseTimeCurrent();this.#record.current();this.#files.current();this.#leaseTimeCurrent();this.#live();}
 retire(){this.#retired=true;}
 async join(){if(!this.#retired)fail('AUTH_IMAGE_SOURCE_NOT_RETIRED');while(this.#pending.size)await Promise.allSettled([...this.#pending]);}
 close(){if(!this.#closing)this.#closing=(async()=>{this.retire();await this.join();let first;for(const f of[()=>this.#files?.close(),...this.#observed.slice().reverse().map(row=>()=>{if(row.closeSelected)return;row.closeSelected=true;closeSync(row.fd);}),()=>this.#record?.close()])try{f()}catch(cause){first??={cause};}this.#closeCause=first;this.#closeDone=true;if(first)throw first.cause;})();return this.#closing;}
 statusDATA(){return Object.freeze({retired:this.#retired,pending:this.#pending.size,firstCausePresent:!!this.#first,firstCause:this.#first?.cause,closeSelected:!!this.#closing,closeComplete:this.#closeDone&&!this.#closeCause,closeCausePresent:!!this.#closeCause,closeCause:this.#closeCause?.cause,expiresAtMs:this.#expires,dataOnly:true,SourceAdmission:false,NativeAdmission:false});}
 readOriginalObservationDATA(){return Object.freeze({original:this.#lastObservation?structuredClone(this.#lastObservation):null,dataOnly:true,SourceAdmission:false,NativeAdmission:false});}
}
Object.freeze(OriginalRuntimeImageAdmissionOwnerV1.prototype);
Object.freeze(OriginalRuntimeImageAdmissionOwnerV1);
export function assertOriginalAuthRuntimeImageAdmissionOwnerV1(owner){if(!owners.has(owner))fail('AUTH_IMAGE_SOURCE_ORIGINAL_OWNER_REQUIRED');return owner;}
export function assertOriginalAuthRuntimeImagePreLoadCurrentV1(...args){if(args.length)fail('AUTH_IMAGE_SOURCE_ZERO_INPUT');if(!active)fail('AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED');assertOriginalAuthRuntimeImageAdmissionOwnerV1(active).assertPreLoadCurrent();}
export function acquireOriginalAuthRuntimeImageAdmissionV1(...args){
 if(args.length)return Promise.reject(Object.assign(Error('AUTH_IMAGE_SOURCE_ZERO_INPUT'),{code:'AUTH_IMAGE_SOURCE_ZERO_INPUT'}));
 if(opening)return opening;
 if(active){try{active.assertPreLoadCurrent();return Promise.resolve(Object.freeze({owner:active,error:null}));}catch(cause){return Promise.resolve(Object.freeze({owner:active,error:Object.assign(Error('AUTH_IMAGE_SOURCE_UNRESOLVED'),{code:'AUTH_IMAGE_SOURCE_UNRESOLVED',cause})}));}}
 if(released.length!==1)return Promise.resolve(Object.freeze({owner:null,error:Object.assign(Error('AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED'),{code:'AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED'})}));
 const owner=active=new OriginalRuntimeImageAdmissionOwnerV1(released[0]);
 opening=(async()=>{try{await owner.initialize();return Object.freeze({owner,error:null});}catch(cause){return Object.freeze({owner,error:Object.assign(Error('AUTH_IMAGE_SOURCE_UNRESOLVED'),{code:'AUTH_IMAGE_SOURCE_UNRESOLVED',cause})});}finally{opening=undefined;}})();return opening;
}
