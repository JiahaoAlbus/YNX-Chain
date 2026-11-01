// Concrete original authority resource owner. ONE store/connection is opened
// here; V6, original TaskGrant service and projection borrow the same object.
import fs from'node:fs';import path from'node:path';
import{openProductPairSessionV4Store}from'./inherited/product-pair-session-v4-store.js';
const fail=c=>{throw Object.assign(Error(c),{code:c});},same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.gid===b.gid;
const active=new Map();
const held=new Map();
// Same canonical module/connection as normal server bootstrap, NOT a second DB.
// This borrows storage only; Root/session/agent/approval remain independent AND.
export function borrowExistingOriginalTaskAuthoritySQLite(resource){
 const r=held.get(resource?.path);if(!r)return null;
 if(!resource||Object.keys(resource).sort().join('|')!=='identity|namespace|path'||resource.namespace!==r.resource.namespace||resource.path!==r.resource.path||!resource.identity||Object.keys(resource.identity).sort().join('|')!=='device|gid|inode|uid'||['device','gid','inode','uid'].some(k=>resource.identity[k]!==r.resource.identity[k]))fail('TASK_V6_SQLITE_EXISTING_BINDING');
 r.owner.current();const original=r.owner.borrowOriginalAuthorityStore();let closed=false;
 return Object.freeze({store:original.store,current(){if(closed)fail('TASK_V6_SQLITE_CHILD_CLOSED');original.current();},close(){if(closed)return;original.close();closed=true;}});
}
function ancestors(p){if(!path.isAbsolute(p)||path.resolve(p)!==p)fail('TASK_V6_SQLITE_PATH');for(let here=path.parse(p).root,parts=path.dirname(p).split(path.sep).filter(Boolean),i=-1;i<parts.length;i++){if(i>=0)here=path.join(here,parts[i]);const s=fs.lstatSync(here);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022)||(s.uid!==0&&s.uid!==process.getuid()))fail('TASK_V6_SQLITE_PARENT');}}
// PRIVATE normal-bootstrap operand, not exported by the normal package API.
// `resource` is selected only from original Root release, never ENV/request.
export function openOriginalTaskAuthoritySQLite(resource){
 let store,fd,initial,first,retired=false,closed=false,closeSelected=false,closeFailure,children=0,storeCloseSelected=false,fdCloseSelected=false,cleanupUnknown=false;const token=Object.freeze({});
 const drain=()=>{if(children)fail('TASK_V6_SQLITE_CHILDREN_RETAINED');if(cleanupUnknown){if(closeFailure)throw closeFailure.cause;fail('TASK_V6_SQLITE_CLOSE_UNKNOWN');}if(store&&!storeCloseSelected){storeCloseSelected=true;try{store.close();}catch(cause){cleanupUnknown=true;throw cause;}}if(fd!==undefined&&!fdCloseSelected){fdCloseSelected=true;try{fs.closeSync(fd);fd=undefined;}catch(cause){cleanupUnknown=true;throw cause;}}closed=true;if(active.get(resource?.path)===token){active.delete(resource.path);held.delete(resource.path);}};
 const current=()=>{if(first)throw first.cause;if(retired||closed)fail('TASK_V6_SQLITE_RETIRED');ancestors(resource.path);const f=fs.fstatSync(fd),n=fs.lstatSync(resource.path);if(!same(f,initial)||!same(n,initial)||!n.isFile()||n.nlink!==1||(n.mode&0o777)!==0o600||n.uid!==process.getuid())fail('TASK_V6_SQLITE_REPLACED');store.assertOriginalCurrent();};
 const owner=Object.freeze({
  current(){try{return current();}catch(cause){first??={cause};throw first.cause;}},
  borrowOriginalAuthorityStore(){owner.current();children++;let released=false;return Object.freeze({store,current:()=>{if(released)fail('TASK_V6_SQLITE_CHILD_CLOSED');owner.current();},close(){if(released)return;released=true;children--;}});},
  retire(){retired=true;},join(){if(!retired)fail('TASK_V6_SQLITE_RETIRE_REQUIRED');if(children)fail('TASK_V6_SQLITE_CHILDREN_RETAINED');},
  close(){if(closeSelected){if(closeFailure)throw closeFailure.cause;return;}closeSelected=true;retired=true;try{drain();}catch(cause){closeFailure={cause};throw cause;}},
  drainPartial(){if(!closeSelected)fail('TASK_V6_SQLITE_CLOSE_REQUIRED');drain();if(closeFailure)throw closeFailure.cause;},
 });
 try{if(!resource||Object.keys(resource).sort().join('|')!=='identity|namespace|path'||typeof resource.namespace!=='string')fail('TASK_V6_SQLITE_RESOURCE');if(active.has(resource.path))fail('TASK_V6_SQLITE_ORIGINAL_ALREADY_HELD');ancestors(resource.path);const p=fs.lstatSync(path.dirname(resource.path));if(p.uid!==process.getuid()||(p.mode&0o777)!==0o700)fail('TASK_V6_SQLITE_PRIVATE_PARENT');fd=fs.openSync(resource.path,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);initial=fs.fstatSync(fd);const i=resource.identity;if(!i||Object.keys(i).sort().join('|')!=='device|gid|inode|uid'||initial.dev!==i.device||initial.ino!==i.inode||initial.uid!==i.uid||initial.gid!==i.gid||!initial.isFile()||initial.nlink!==1||(initial.mode&0o777)!==0o600)fail('TASK_V6_SQLITE_ORIGINAL_IDENTITY');active.set(resource.path,token);store=openProductPairSessionV4Store({path:resource.path,namespace:resource.namespace});owner.current();held.set(resource.path,{resource:structuredClone(resource),owner});return Object.freeze({owner,errorPresent:false});}catch(cause){first={cause};return Object.freeze({owner,errorPresent:true,error:cause});}
}
