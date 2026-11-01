import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
const fail=c=>{throw Object.assign(Error(c),{code:c});},sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.gid===b.gid&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
function boundedOriginal(fd,ref,before){
 const b=Buffer.alloc(ref.bytes+1);let count=0;
 while(count<b.length){const n=fs.readSync(fd,b,count,b.length-count,count);if(n===0)break;count+=n;}
 const f=fs.fstatSync(fd),named=fs.lstatSync(ref.path);
 if(count!==ref.bytes||!same(f,before)||!same(named,before)||named.isSymbolicLink()||sha(b.subarray(0,count))!==ref.sha256)fail('AI_TASK_V6_HELD_FILE_CHANGED');
 return b.subarray(0,count);
}
function ancestors(p,code){if(typeof process.getuid!=='function')fail('AI_TASK_V6_PLATFORM_FILE_OWNER_NOT_SUPPLIED');if(!path.isAbsolute(p)||path.resolve(p)!==p)fail('AI_TASK_V6_CANONICAL_PATH');for(let here=path.parse(p).root,parts=path.dirname(p).split(path.sep).filter(Boolean),i=-1;i<parts.length;i++){if(i>=0)here=path.join(here,parts[i]);const s=fs.lstatSync(here);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022)||(code?s.uid!==0:s.uid!==0&&s.uid!==process.getuid()))fail('AI_TASK_V6_PROTECTED_ANCESTOR');}}
export function holdOriginalAITaskPublicFile(ref,{code=false,cap=393216}={}){
 let fd,before,raw,first,closed=false,closeFailure;const owner=Object.freeze({
  current(){if(first)throw first.cause;if(closed||fd===undefined||!before)fail('AI_TASK_V6_FILE_CLOSED');try{ancestors(ref.path,code);const f=fs.fstatSync(fd),n=fs.lstatSync(ref.path);if(!same(f,before)||!same(n,before)||n.isSymbolicLink())fail('AI_TASK_V6_HELD_FILE_CHANGED');boundedOriginal(fd,ref,before);ancestors(ref.path,code);}catch(cause){first??={cause};throw first.cause;}},
  readOriginal(){owner.current();return Buffer.from(raw);},
  close(){if(closed){if(closeFailure)throw closeFailure.cause;return;}closed=true;if(fd!==undefined)try{fs.closeSync(fd);}catch(cause){closeFailure={cause};throw cause;}},
 });
 try{if(!ref||Object.keys(ref).sort().join('|')!=='bytes|path|sha256'||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>cap||!/^[a-f0-9]{64}$/.test(ref.sha256))fail('AI_TASK_V6_PUBLIC_REF');ancestors(ref.path,code);const named=fs.lstatSync(ref.path);if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1||named.size!==ref.bytes||(named.mode&0o022)||(code?named.uid!==0:named.uid!==0&&named.uid!==process.getuid()))fail('AI_TASK_V6_PUBLIC_IDENTITY');fd=fs.openSync(ref.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);before=fs.fstatSync(fd);if(!same(named,before))fail('AI_TASK_V6_PUBLIC_IDENTITY');raw=boundedOriginal(fd,ref,before);owner.current();return Object.freeze({owner,errorPresent:false});}catch(cause){first={cause};return Object.freeze({owner,errorPresent:true,error:cause});}
}
// Code images must be the independently installed ROOT-owned closed tree,
// not a devpath/hash supplied by a caller. Manifest/pins alone are not admission:
// only the private compiled normal release supplies this operand.
export async function loadOriginalAITaskV6Image(plan){
 const held=[],namespaces={},seen=new Set();let first,retired=false,closing;const current=()=>{if(first)throw first.cause;if(retired)fail('AI_TASK_V6_IMAGE_RETIRED');for(const f of held)f.current();};
 const owner=Object.freeze({current,namespaces,retire(){retired=true;},join(){},close(){return closing??=(async()=>{let error;for(const f of [...held].reverse())try{f.close();}catch(cause){error??={cause};}if(error)throw error.cause;})();}});
 try{if(!plan||fs.realpathSync(process.execPath)!==plan.implementingImage?.path)fail('AI_TASK_V6_ACTUAL_IMPLEMENTING_IMAGE_REQUIRED');for(const ref of[plan.implementingImage,plan.privateModule]){const f=holdOriginalAITaskPublicFile(ref,{code:true,cap:268435456});held.push(f.owner);if(f.errorPresent)throw f.error;}
  const m=holdOriginalAITaskPublicFile(plan.manifest,{code:true,cap:1048576});held.push(m.owner);if(m.errorPresent)throw m.error;const bytes=m.owner.readOriginal(),manifest=JSON.parse(bytes);if(manifest.version!=='AUTH-AI-TASK-V6-CLOSED-IMAGE/v1'||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>4096||!manifest.entries||!path.isAbsolute(manifest.directory)||path.resolve(manifest.directory)!==manifest.directory)fail('AI_TASK_V6_IMAGE_MANIFEST');
  for(const ref of manifest.files){if(seen.has(ref.path)||!ref.path.startsWith(manifest.directory+'/'))fail('AI_TASK_V6_IMAGE_CLOSURE');seen.add(ref.path);const f=holdOriginalAITaskPublicFile(ref,{code:true,cap:268435456});held.push(f.owner);if(f.errorPresent)throw f.error;}
  // No unlisted package.json/import leaf may participate in Node resolution.
  const observed=new Set();function walk(p){const st=fs.lstatSync(p);if(st.isSymbolicLink())fail('AI_TASK_V6_IMAGE_SYMLINK');if(st.isDirectory()){ancestors(p+'/entry',true);for(const n of fs.readdirSync(p))walk(path.join(p,n));}else if(st.isFile()){if(p!==plan.manifest.path)observed.add(p);}else fail('AI_TASK_V6_IMAGE_SPECIAL_FILE');}walk(manifest.directory);if(observed.size!==seen.size||[...observed].some(p=>!seen.has(p)))fail('AI_TASK_V6_IMAGE_UNLISTED_FILE');
  const client=Object.hasOwn(manifest.entries,'sdkPeer')||Object.hasOwn(manifest.entries,'mainApproval');
  for(const name of ['dispatch','contract','codec','keyFile','batch',...(client?['sdkPeer','mainApproval']:[]),...(Object.hasOwn(manifest.entries,'link')?['link']:[])]){const p=manifest.entries[name];if(typeof p!=='string'||!seen.has(p))fail('AI_TASK_V6_IMAGE_ENTRY');if(name==='sdkPeer'&&!p.endsWith('/packages/wallet-auth/src/original-ai-task-action-v6-client-private.js'))fail('AI_V6_FIXED_SDK_PEER_SLOT');if(name==='mainApproval'&&!p.endsWith('/apps/wallet-desktop/src/original-policy-supplier/ai-task-v6-approval.mjs'))fail('AI_V6_FIXED_MAIN_APPROVAL_SLOT');current();namespaces[name]=await import(pathToFileURL(p).href);current();}
  return Object.freeze({owner,errorPresent:false});
 }catch(cause){first={cause};return Object.freeze({owner,errorPresent:true,error:cause});}
}
