// PRIVATE physical DATA capture. Only the independent compiled Root reader
// qualifies resource. This module does not register a resource, approve a Root,
// sign, renew a checkpoint, or replace the original Root/ledger verifier.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const ROOT_UID=0,ANCESTOR_UIDS=[0];
const wall=()=>Date.now(),mono=()=>performance.now();
const fail=code=>{throw Object.assign(Error(code),{code});};
const digest=b=>createHash('sha256').update(b).digest('hex');
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))fail('ROOT_CURRENT_CAPTURE_SCHEMA');};
const identity=s=>({device:String(s.dev),inode:String(s.ino),uid:s.uid,gid:s.gid,mode:s.mode&0o7777});
const sameIdentity=(a,b)=>['device','inode','uid','gid','mode'].every(k=>a[k]===b[k]);
const sameFile=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const canonical=v=>{
 if(v===null||typeof v==='string'||typeof v==='boolean'||Number.isSafeInteger(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 fail('ROOT_CURRENT_CAPTURE_CANONICAL');
};
const owners=new WeakSet(),openingErrors=new WeakMap();
class Capture{
 #resource;#parents=[];#fd;#stat;#raw;#data;#wallStart;#monoStart;#wallFloor;#monoFloor;#first;#failed=false;#closed=false;#closeFirst;#closeFailed=false;#ready=false;
 constructor(resource){this.#wallStart=this.#wallFloor=wall();this.#monoStart=this.#monoFloor=mono();this.#resource=structuredClone(resource);owners.add(this);Object.freeze(this);}
 #remember(e){if(!this.#failed){this.#failed=true;this.#first=e;}return this.#first;}
 #physical(){
  if(this.#closed)fail('ROOT_CURRENT_CAPTURE_CLOSED');
  if(this.#fd===undefined||!this.#stat||!sameFile(this.#stat,fs.fstatSync(this.#fd))||!sameFile(this.#stat,fs.lstatSync(this.#resource.parent+'/'+this.#resource.leaf)))fail('ROOT_CURRENT_CAPTURE_CHANGED');
  for(const[p,s]of this.#parents){const n=fs.lstatSync(p);if(!n.isDirectory()||n.isSymbolicLink()||!sameIdentity(identity(s),identity(n)))fail('ROOT_CURRENT_CAPTURE_PARENT_CHANGED');}
 }
 #time(){
  const w=wall(),m=mono();
  if(!Number.isSafeInteger(this.#wallStart)||this.#wallStart<0||!Number.isFinite(this.#monoStart)||this.#monoStart<0||!Number.isSafeInteger(w)||w<0||w<this.#wallFloor||!Number.isFinite(m)||m<this.#monoFloor||m<this.#monoStart)fail('ROOT_CURRENT_CAPTURE_CLOCK_ROLLBACK');
  this.#wallFloor=w;this.#monoFloor=m;
  if(this.#data&&(w<this.#data.issuedAtMs||w>=this.#data.expiresAtMs||this.#wallStart+(m-this.#monoStart)>=this.#data.expiresAtMs))fail('ROOT_CURRENT_CAPTURE_EXPIRED');
 }
 open(){
  const r=this.#resource;exact(r,['parent','identity','leaf','manifestSHA256','networkId','registryId']);exact(r.identity,['device','inode','uid','gid','mode']);
  if(typeof r.parent!=='string'||!path.isAbsolute(r.parent)||path.resolve(r.parent)!==r.parent||fs.realpathSync(r.parent)!==r.parent||typeof r.leaf!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(r.leaf)||r.identity.uid!==ROOT_UID||![0o700,0o750,0o755,0o711].includes(r.identity.mode)||!['manifestSHA256','networkId'].every(k=>typeof r[k]==='string'&&/^[a-f0-9]{64}$/.test(r[k]))||typeof r.registryId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(r.registryId))fail('ROOT_CURRENT_CAPTURE_RESOURCE');
  for(let p=r.parent;;p=path.dirname(p)){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||!ANCESTOR_UIDS.includes(s.uid)||(s.mode&0o022))fail('ROOT_CURRENT_CAPTURE_PARENT');this.#parents.push([p,s]);if(p==='/')break;}
  if(!sameIdentity(r.identity,identity(this.#parents[0][1])))fail('ROOT_CURRENT_CAPTURE_PARENT_IDENTITY');
  this.#time();
  const name=r.parent+'/'+r.leaf;
  const before=fs.lstatSync(name);
  const valid=s=>s.isFile()&&!s.isSymbolicLink()&&s.uid===ROOT_UID&&[0o400,0o444,0o600].includes(s.mode&0o7777)&&s.nlink===1&&s.size>0&&s.size<=32768;
  if(!valid(before))fail('ROOT_CURRENT_CAPTURE_FILE');
  this.#fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  this.#stat=fs.fstatSync(this.#fd);
  if(!valid(this.#stat)||!sameFile(before,this.#stat))fail('ROOT_CURRENT_CAPTURE_FILE_CHANGED');
  this.#physical();
  const buf=Buffer.alloc(this.#stat.size+1);let used=0;
  while(used<buf.length){const n=fs.readSync(this.#fd,buf,used,buf.length-used,used);if(n===0)break;used+=n;}
  this.#physical();if(used!==this.#stat.size)fail('ROOT_CURRENT_CAPTURE_FILE_CHANGED');
  this.#raw=buf.subarray(0,used).toString('utf8');
  if(!Buffer.from(this.#raw).equals(buf.subarray(0,used)))fail('ROOT_CURRENT_CAPTURE_UTF8');
  try{this.#data=JSON.parse(this.#raw);}catch{fail('ROOT_CURRENT_CAPTURE_JSON');}
  exact(this.#data,['version','manifestSHA256','networkId','registryId','sequence','head','issuedAtMs','expiresAtMs']);
  const d=this.#data;
  if(canonical(d)!==this.#raw||d.version!=='2'||d.manifestSHA256!==r.manifestSHA256||d.networkId!==r.networkId||d.registryId!==r.registryId||typeof d.sequence!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(d.sequence)||BigInt(d.sequence)>(1n<<64n)-1n||typeof d.head!=='string'||!/^[a-f0-9]{64}$/.test(d.head)||!Number.isSafeInteger(d.issuedAtMs)||!Number.isSafeInteger(d.expiresAtMs)||d.issuedAtMs<0||d.expiresAtMs<=d.issuedAtMs||d.expiresAtMs-d.issuedAtMs>30000)fail('ROOT_CURRENT_CAPTURE_CHECKPOINT');
  this.#time();this.#physical();this.#ready=true;this.current();
 }
 current(){if(openingErrors.has(this))throw openingErrors.get(this);if(this.#failed)throw this.#first;try{if(!this.#ready)fail('ROOT_CURRENT_CAPTURE_NOT_READY');this.#physical();this.#time();this.#physical();}catch(e){throw this.#remember(e);}}
 readOriginal(){this.current();const raw=this.#raw;this.current();return raw;}
 checkpoint(){this.current();const d=Object.freeze({sequence:this.#data.sequence,head:this.#data.head});this.current();return d;}
 get expiresAtMs(){this.current();return this.#data.expiresAtMs;}
 // Nonsecret receipt only, not an enrollment/authority or current replacement.
 receipt(){this.current();return Object.freeze({path:this.#resource.parent+'/'+this.#resource.leaf,...identity(this.#stat),bytes:this.#stat.size,sha256:digest(Buffer.from(this.#raw))});}
 close(){
  if(this.#closed){if(this.#closeFailed)throw this.#closeFirst;return;}
  this.#closed=true;
  if(this.#fd!==undefined)try{fs.closeSync(this.#fd);}catch(e){this.#closeFailed=true;this.#closeFirst=e;throw e;}
 }
}
Object.freeze(Capture.prototype);
export function assertOriginalRootCurrentCaptureV3(owner){if(!owners.has(owner))fail('ROOT_CURRENT_CAPTURE_ORIGINAL_OWNER');return owner;}
export function captureOriginalRootCurrentV3(resource){
 let owner;
 try{owner=new Capture(resource);owner.open();return Object.freeze({owner,error:null});}
 catch(error){const cause=error===null?Object.assign(Error('ROOT_CURRENT_CAPTURE_FAILED_NULL'),{code:'ROOT_CURRENT_CAPTURE_FAILED_NULL',cause:null}):error;if(owner)openingErrors.set(owner,cause);return Object.freeze({owner:owner??null,error:cause});}
}
