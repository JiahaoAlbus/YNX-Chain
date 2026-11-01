import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export const fail=code=>{throw Object.assign(Error(code),{code});};
export const digest=raw=>createHash('sha256').update(raw).digest('hex');
export const PUBLIC_ORIGINAL_UID=0; // Production invariant; fixture compiled variant is explicitly PUBLIC.
export function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))fail('PAIR_RELEASE_SCHEMA');}
export function canonical(v){if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);if(Number.isSafeInteger(v))return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&Object.getPrototypeOf(v)===Object.prototype&&!Object.hasOwn(v,'__proto__'))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';fail('PAIR_RELEASE_CANONICAL');}
export const identity=s=>({device:String(s.dev),inode:String(s.ino),uid:s.uid,gid:s.gid,mode:s.mode&0o7777});
export const same=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
export function canonicalPath(p){if(typeof p!=='string'||p.includes('\0')||!path.isAbsolute(p)||path.resolve(p)!==p||fs.realpathSync(p)!==p)fail('PAIR_RELEASE_PATH');for(let q=p;;q=path.dirname(q)){if(fs.lstatSync(q).isSymbolicLink())fail('PAIR_RELEASE_SYMLINK');if(q==='/')break;}return p;}
export function holdFile(ref,{publicOriginal=false,max=128*1024*1024}={}){
 exact(ref,['path','device','inode','uid','gid','mode','bytes','sha256']);canonicalPath(ref.path);
 if(!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.bytes>max||!/^[0-9a-f]{64}$/.test(ref.sha256)||publicOriginal&&(ref.bytes===0||ref.uid!==PUBLIC_ORIGINAL_UID||![0o400,0o444,0o600].includes(ref.mode)))fail('PAIR_RELEASE_REF');
 const parents=[];for(let p=path.dirname(ref.path);;p=path.dirname(p)){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||publicOriginal&&((s.uid!==0&&s.uid!==process.getuid())||(s.mode&0o022)))fail('PAIR_RELEASE_PARENT');parents.push([p,s]);if(p==='/')break;}
 let fd,st,bytes;try{fd=fs.openSync(ref.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);st=fs.fstatSync(fd);if(!st.isFile()||st.nlink!==1||canonical(identity(st))!==canonical({device:ref.device,inode:ref.inode,uid:ref.uid,gid:ref.gid,mode:ref.mode})||st.size!==ref.bytes)fail('PAIR_RELEASE_TUPLE');bytes=fs.readFileSync(fd);if(digest(bytes)!==ref.sha256)fail('PAIR_RELEASE_SHA');}catch(e){if(fd!==undefined)fs.closeSync(fd);throw e;}
 let selected=false;return{get bytes(){this.current();return Buffer.from(bytes);},current(){if(selected||!same(st,fs.fstatSync(fd))||!same(st,fs.lstatSync(ref.path))||fs.realpathSync(ref.path)!==ref.path)fail('PAIR_RELEASE_CHANGED');for(const[p,s]of parents){const n=fs.lstatSync(p);if(!n.isDirectory()||n.isSymbolicLink()||canonical(identity(n))!==canonical(identity(s)))fail('PAIR_RELEASE_PARENT_CHANGED');}},close(){if(!selected){selected=true;fs.closeSync(fd);}}};
}
// A pin is DATA, not permission to read an unchecked pathname. In particular,
// never follow a raced symlink before the caller's later holdFile validation.
export function ref(p){
 canonicalPath(p);
 const parents=[];
 for(let q=path.dirname(p);;q=path.dirname(q)){
  const s=fs.lstatSync(q);if(!s.isDirectory()||s.isSymbolicLink())fail('PAIR_RELEASE_PARENT');
  parents.push([q,s]);if(q==='/')break;
 }
 const before=fs.lstatSync(p);
 const regular=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&Number.isSafeInteger(s.size)&&s.size>=0&&s.size<=128*1024*1024;
 if(!regular(before))fail('PAIR_RELEASE_PIN_TYPE');
 const current=fd=>{
  if(!regular(fs.fstatSync(fd))||!same(before,fs.fstatSync(fd))||!same(before,fs.lstatSync(p))||fs.realpathSync(p)!==p)fail('PAIR_RELEASE_PIN_CHANGED');
  for(const[q,s]of parents){const n=fs.lstatSync(q);if(!n.isDirectory()||n.isSymbolicLink()||canonical(identity(n))!==canonical(identity(s)))fail('PAIR_RELEASE_PARENT_CHANGED');}
 };
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  current(fd);
  // Bounded reads also reject a file growing after fstat without allocating or
  // reading an unbounded stream. The extra byte detects a concurrent append.
  const buffer=Buffer.alloc(before.size+1);let count=0;
  while(count<buffer.length){const n=fs.readSync(fd,buffer,count,buffer.length-count,count);if(n===0)break;count+=n;}
  current(fd);if(count!==before.size)fail('PAIR_RELEASE_PIN_CHANGED');
  const b=buffer.subarray(0,count);
  return{path:p,...identity(before),bytes:b.length,sha256:digest(b)};
 }finally{fs.closeSync(fd);}
}
export function relativeLeaf(p){return typeof p==='string'&&/^[\x20-\x7e]+$/.test(p)&&!p.includes('\\')&&!p.startsWith('/')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');}
