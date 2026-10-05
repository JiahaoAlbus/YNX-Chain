import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { prepareLocalGoToolchain } from './local-go-toolchain-supplier.mjs';
import { inspectWorkspacePathIdentity, assertWorkspacePathIdentity } from './workspace-path-identity.mjs';
const admissions=new WeakMap();
const contextIdentity=context=>({id:context.id,workspace:context.workspace,profile:context.profile,temporary:context.temporary});
export async function assertAdmittedLocalGoToolchain(toolchain,context){
 const admission=admissions.get(toolchain);if(!admission||!same(admission.context,contextIdentity(context)))throw Error('Go toolchain was not verified for this local project.');
 await admission.assertCurrent();await assertWorkspacePathIdentity(admission.snapshot);return toolchain;
}
const ANY=0x20000000,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=data=>createHash('sha256').update(data).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity=s=>({dev:String(s.dev),ino:String(s.ino),uid:Number(s.uid),mode:Number(s.mode)});
const exact=p=>typeof p==='string'&&p.length<=4096&&path.isAbsolute(p)&&path.normalize(p)===p&&!/[\0\r\n]/.test(p);
async function privateRoot(root){
 if(!exact(root)||await fs.realpath(root)!==root)throw Error('Go selection storage requires a canonical private directory.');
 for(let p=root;;p=path.dirname(p)){const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||![0,process.getuid()].includes(s.uid)||(s.mode&0o022))throw Error('Go selection storage has an unsafe directory ancestor.');if(p===root&&(s.uid!==process.getuid()||(s.mode&0o777)!==0o700))throw Error('Go selection storage must be private.');if(p==='/')break;}
}
async function child(root,name){await privateRoot(root);const p=path.join(root,name);try{await fs.mkdir(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await privateRoot(p);return p;}
async function readPrivate(p){const h=await fs.open(p,constants.O_RDONLY|ANY);try{const before=await h.stat({bigint:true});if(!before.isFile()||before.uid!==BigInt(process.getuid())||before.nlink!==1n||(Number(before.mode)&0o777)!==0o600||before.size>32768n)throw Error('Go selection metadata is unsafe. Existing data was retained.');const bytes=await h.readFile();const after=await h.stat({bigint:true}),current=await fs.lstat(p,{bigint:true});if(!same(identity(before),identity(after))||!same(identity(before),identity(current))||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||before.size!==after.size)throw Error('Go selection metadata changed while reading.');return {bytes,identity:identity(before),sha:hash(bytes)};}finally{await h.close();}}
async function writeExclusive(p,bytes){const h=await fs.open(p,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|ANY,0o600);try{await h.chmod(0o600);await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
export function nativeGoSelectionRequest(body,context){
 if(!body||typeof body!=='object'||Array.isArray(body)||!UUID.test(body.id||'')||body.projectId!==context.id||body.workspace!==context.workspace)return false;
 const fields=body.action==='prepare-go'?['action','id','projectId','workspace','selectedRoot']:body.action==='cancel-go'?['action','id','projectId','workspace']:[];
 return fields.length>0&&same(Object.keys(body).sort(),fields.sort())&&(body.action!=='prepare-go'||exact(body.selectedRoot));
}
/** Called only by the native-parent control pipe, never an HTTP/extension RPC. */
export async function createLocalGoSelectionStore({supportRoot,context,pathIdentityHelper}){
 if(!UUID.test(context?.id||'')||!exact(context.workspace))throw Error('Go selection requires an admitted local project.');
 await privateRoot(supportRoot);const key=hash(context.workspace);
 if(context.profile!==path.join(supportRoot,'local-projects',key,'profile')||context.temporary!==path.join(supportRoot,'local-projects',key,'tmp'))throw Error('Go selection profile does not match this project.');
 const workspace=await inspectWorkspacePathIdentity({helper:pathIdentityHelper,path:context.workspace});
 const support=await inspectWorkspacePathIdentity({helper:pathIdentityHelper,path:supportRoot});
 const writableRoots=[context.workspace,context.profile,context.temporary];
 for(const root of writableRoots){const proof=await inspectWorkspacePathIdentity({helper:pathIdentityHelper,path:root});const vnode=p=>p.dev+':'+p.ino;
  if(support.snapshots.some(p=>vnode(p)===vnode(proof.identity)))throw Error('Go selection storage is covered by this project or another writable root.');}
 const selections=await child(supportRoot,'go-selections'),directory=await child(selections,key),recordPath=path.join(directory,'selection.json');
 const directoryProof=await inspectWorkspacePathIdentity({helper:pathIdentityHelper,path:directory});
 const assertCurrent=async()=>{await privateRoot(supportRoot);await privateRoot(directory);await assertWorkspacePathIdentity(support);await assertWorkspacePathIdentity(workspace);await assertWorkspacePathIdentity(directoryProof);};
 const binding={projectId:context.id,workspace:context.workspace,workspaceIdentity:workspace.identity};
 const supplierOptions={supportRoot,writableRoots,pathIdentityHelper};
 const admit=async result=>{await assertCurrent();const snapshot=await inspectWorkspacePathIdentity({helper:pathIdentityHelper,path:result.root});const toolchain=Object.freeze({...result});admissions.set(toolchain,{context:contextIdentity(context),assertCurrent,snapshot});return toolchain;};
 const readRecord=async()=>{await assertCurrent();let old;try{old=await readPrivate(recordPath);}catch(e){if(e.code==='ENOENT')return;throw e;}const data=JSON.parse(old.bytes);
  if(data.schemaVersion!==1||!same(data.binding,binding)||!exact(data.selectedRoot)||!data.toolchain||Object.keys(data).length!==4)throw Error('The retained Go selection belongs to another project or is invalid.');return {old,data};};
 const load=async()=>{const record=await readRecord();if(!record)return;const result=await prepareLocalGoToolchain({...supplierOptions,selectedRoot:record.data.selectedRoot});await assertCurrent();if(!same(result,record.data.toolchain))throw Error('The selected Go toolchain changed. Select it again before running Go.');return admit(result);};
 const prepare=async(selectedRoot,{signal,onProgress}={})=>{if(!exact(selectedRoot))throw Error('Select a canonical installed GOROOT in the native folder picker.');await assertCurrent();const previous=await readRecord();
  const result=await prepareLocalGoToolchain({...supplierOptions,selectedRoot,signal,onProgress});signal?.throwIfAborted();await assertCurrent();const current=await readRecord();
  if(!same(previous?.old?.sha,current?.old?.sha))throw Error('Go selection changed during preparation. Existing selection was retained.');
  const data={schemaVersion:1,binding,selectedRoot,toolchain:result},pending=path.join(directory,'.selection-'+randomUUID());
  await writeExclusive(pending,JSON.stringify(data)+'\n');
  try{signal?.throwIfAborted();await assertCurrent();const final=await readRecord();if(!same(previous?.old?.sha,final?.old?.sha))throw Error('Go selection changed before publication.');await fs.rename(pending,recordPath);}
  catch(error){const owned=await readPrivate(pending);if(owned.sha===hash(JSON.stringify(data)+'\n'))await fs.unlink(pending);throw error;}
  return admit(result);
 };
 const controlDirectory=async instance=>{if(!UUID.test(instance||''))throw Error('Invalid native Go control instance.');await assertCurrent();return child(await child(supportRoot,'native-go-controls'),instance);};
 const writeResult=async(directory,id,result)=>{if(!UUID.test(id||'')||!UUID.test(path.basename(directory))||path.dirname(directory)!==path.join(supportRoot,'native-go-controls'))throw Error('Invalid Go result location.');await assertCurrent();await privateRoot(directory);const bytes=JSON.stringify({id,projectId:context.id,...result})+'\n';if(Buffer.byteLength(bytes)>16384)throw Error('Go result exceeded its bound.');await writeExclusive(path.join(directory,id+'.json'),bytes);};
 return Object.freeze({binding:Object.freeze(binding),recordPath,load,prepare,controlDirectory,writeResult});
}
/** Finite native stdin schema; sandbox children never inherit this pipe. */
export function attachNativeGoSelectionChannel({input,store,context,directory,onError=()=>{}}){
 let buffer='',active,closed=false;const completed=new Set();
 const failure=e=>String(e?.message||'Go selection failed.').slice(0,240);
 const receive=async body=>{if(!nativeGoSelectionRequest(body,context))return;
  if(body.action==='cancel-go'){if(active?.id===body.id)active.abort.abort();return;}
  if(completed.has(body.id)||active||completed.size>=32){await store.writeResult(directory,body.id,{status:'error',error:'Another Go selection is pending or this request was already completed.'}).catch(onError);return;}
  const job={id:body.id,abort:new AbortController()};active=job;
  try{const result=await store.prepare(body.selectedRoot,{signal:job.abort.signal});if(!closed)await store.writeResult(directory,job.id,{status:'selected',effective:'after-reopen',version:result.version,root:result.root});}
  catch(e){if(!closed)await store.writeResult(directory,job.id,{status:job.abort.signal.aborted?'cancelled':'error',error:failure(e)}).catch(onError);}
  finally{completed.add(job.id);if(active===job)active=undefined;}
 };
 const data=bytes=>{if(closed)return;buffer+=bytes.toString('utf8');if(Buffer.byteLength(buffer)>32768){close();onError(Error('Native Go control input exceeded its bound.'));return;}let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try{void receive(JSON.parse(line)).catch(onError);}catch{onError(Error('Invalid native Go control request.'));}}};
 const close=()=>{if(closed)return;closed=true;active?.abort.abort();input.removeListener('data',data);input.removeListener('end',close);input.pause();};
 input.on('data',data);input.once('end',close);input.resume();return Object.freeze({close});
}
