import fs from 'node:fs/promises';
import {constants,linkSync,unlinkSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openBundledWalletIdentityPeerCall} from './wallet-admission-startup.mjs';

// Normal App parent-pipe transport only. These messages select a user action,
// never a Native owner, expected statement, Root, proof, provider or key call.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const actions=Object.freeze({'native-identity-receive':'receive','native-identity-recover':'recover'});
const fields=['action','document','id','instance','projectId','workspace'];
const codeOf=error=>{let value;try{value=Object.getOwnPropertyDescriptor(error,'code')?.value;}catch{}return typeof value==='string'&&/^[A-Z0-9_]{1,100}$/.test(value)?value:'IDE_IDENTITY_REQUEST_FAILED';};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
const fail=code=>Object.assign(Error(code),{code});
export async function attachNativeIdentityChannel(options){
  const allowed=['control','instance','context','directory','runningBackendModuleURL','onError'];
  if(!options||Object.getPrototypeOf(options)!==Object.prototype||Object.keys(options).some(k=>!allowed.includes(k)))throw fail('IDE_IDENTITY_TRANSPORT_INVALID');
  const {control,instance,directory,runningBackendModuleURL,onError=()=>{}}=options;
  const context=Object.freeze({id:options.context?.id,workspace:options.context?.workspace});
  if(!UUID.test(instance||'')||!UUID.test(context.id||'')||typeof context.workspace!=='string'||!path.isAbsolute(context.workspace)||path.normalize(context.workspace)!==context.workspace||typeof runningBackendModuleURL!=='string')throw fail('IDE_IDENTITY_TRANSPORT_INVALID');
  const project=await fs.lstat(context.workspace),initial=await fs.lstat(directory);
  if(!project.isDirectory()||project.isSymbolicLink()||await fs.realpath(context.workspace)!==context.workspace)throw fail('IDE_IDENTITY_PROJECT_CHANGED');
  async function current(){
    const now=await fs.lstat(context.workspace),dir=await fs.lstat(directory);
    if(!now.isDirectory()||now.isSymbolicLink()||!same(now,project)||await fs.realpath(context.workspace)!==context.workspace)throw fail('IDE_IDENTITY_PROJECT_CHANGED');
    if(!dir.isDirectory()||dir.isSymbolicLink()||!same(dir,initial)||dir.uid!==process.getuid()||(dir.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw fail('IDE_IDENTITY_TRANSPORT_CHANGED');
    for(let item=directory;;item=path.dirname(item)){
      const stat=await fs.lstat(item);
      if(!stat.isDirectory()||stat.isSymbolicLink()||![0,process.getuid()].includes(stat.uid)||(stat.mode&0o022)||same(stat,project))throw fail('IDE_IDENTITY_TRANSPORT_UNSAFE');
      if(item==='/')break;
    }
  }
  await current();
  const rows=new Map(),pending=new Set();let closed=false,active,cleanupFailed=false,cleanupCause;
  const report=error=>{try{onError(error);}catch{}};
  const cleanupFailure=error=>{if(!cleanupFailed){cleanupFailed=true;cleanupCause=error;}report(error);};
  const track=promise=>{pending.add(promise);void promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
  const live=row=>!closed&&!row.cancelled&&rows.get(row.id)===row;
  const retirePeer=row=>{try{row.peer?.retire();}catch(error){if(!row.retireFailed){row.retireFailed=true;row.retireCause=error;}cleanupFailure(error);throw error;}};
  async function publish(row,suffix,phase,error){
    if(!live(row))return;
    await current();
    const value={schema:'ynx-ide-native-identity-status/v1',id:row.id,document:row.document,instance,projectId:context.id,workspace:context.workspace,kind:row.kind,phase,dataOnly:true,authorized:false,...(phase==='failed'?{errorCode:codeOf(error)}:{})};
    const target=path.join(directory,'identity-'+row.id+suffix+'.json'),staging=path.join(directory,'.identity-'+row.id+'-'+randomUUID());
    const file=await fs.open(staging,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await file.chmod(0o600);await file.writeFile(JSON.stringify(value)+'\n');await file.sync();}finally{await file.close();}
    await current();
    const fence=()=>{const dir=lstatSync(directory),ws=lstatSync(context.workspace);if(!live(row)||!same(dir,initial)||!same(ws,project)||!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o777)!==0o700||!ws.isDirectory()||ws.isSymbolicLink())throw fail('IDE_IDENTITY_REQUEST_RETIRED');};
    // No JS callback may interleave the final ownership fence/publication. An
    // uncertain post-link fence retains nlink=2 for Native to reject.
    fence();linkSync(staging,target);fence();unlinkSync(staging);
  }
  async function dispose(row){
    if(row.cleanup)return row.cleanup;
    row.cleanup=(async()=>{
      if(!row.peer)return;
      try{retirePeer(row);}catch{}
      try{await row.peer.close();}catch(error){cleanupFailure(error);throw error;}
      if(row.retireFailed)throw row.retireCause;
      row.cleaned=true;if(active===row)active=undefined;
    })();void row.cleanup.catch(()=>{});return row.cleanup;
  }
  async function execute(row){
    try{
      await current();if(!live(row))return;
      // Keep the returned facade before begin can enter a genuine Native owner.
      row.peer=await openBundledWalletIdentityPeerCall(runningBackendModuleURL);
      if(!live(row)){retirePeer(row);return;}
      await current();if(!live(row))return;
      await publish(row,'.pending','requesting');
      await row.peer.begin(row.kind,undefined);
      if(!live(row))return;
      await current();await publish(row,'.request','awaiting-wallet');
      // The result is opaque and backend-only. Response arrival does not grant
      // project permissions, assert SSO or claim a deploy/sign effect succeeded.
      row.opaqueResult=await row.peer.waitForReturn();
      if(!live(row))return;
      await current();row.responseReceived=true;
      await publish(row,'','response-received');
    }catch(error){
      if(!row.failed){row.failed=true;row.firstCause=error;}report(error);
      if(!closed&&!row.cancelled)try{await publish(row,'','failed',error);}catch(cause){cleanupFailure(cause);}
    }finally{
      // A successful opaque result retains its owner until explicit cancel or
      // shutdown. Do not invent a result schema or dispose a possible borrow.
      if(row.failed||row.cancelled||closed)await dispose(row).catch(()=>{});
      if(!row.peer&&active===row)active=undefined;
    }
  }
  function retire(){
    if(closed)return;closed=true;
    for(const row of rows.values()){row.cancelled=true;try{retirePeer(row);}catch{}}
  }
  const finishCleanup=async()=>{
    retire();while(pending.size)await Promise.allSettled([...pending]);
    for(const row of rows.values())await dispose(row).catch(()=>{});
    return Object.freeze({complete:!cleanupFailed,firstFailurePresent:cleanupFailed,firstFailure:cleanupCause});
  };
  const subscription=control.subscribe({actions:[...Object.keys(actions),'native-identity-cancel'],maxFrameBytes:16384,
    receive(body){
      if(closed||!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).sort().join(',')!==fields.join(',')||!UUID.test(body.id||'')||!UUID.test(body.document||'')||body.instance!==instance||body.projectId!==context.id||body.workspace!==context.workspace)return;
      if(body.action==='native-identity-cancel'){
        const row=rows.get(body.id);if(!row||row.document!==body.document)return;row.cancelled=true;
        try{retirePeer(row);}catch{}
        // execute owns any entered import/begin/return. A cancel before the
        // facade arrives must not cache an empty cleanup and lose the partial.
        return track(Promise.resolve(row.execution).then(()=>dispose(row)).catch(cleanupFailure));
      }
      if(!Object.hasOwn(actions,body.action)||rows.has(body.id)||rows.size>=32||cleanupFailed)return;
      const row={id:body.id,document:body.document,kind:actions[body.action],cancelled:false};rows.set(row.id,row);
      if(active){row.failed=true;return track(publish(row,'','failed',fail('IDE_IDENTITY_REQUEST_BUSY')).catch(cleanupFailure));}
      active=row;row.execution=track(execute(row));return row.execution;
    },onClose(){retire();return finishCleanup();}});
  return Object.freeze({close(){retire();subscription.close();},finishCleanup,status:()=>Object.freeze({closed,requests:rows.size,busy:!!active,cleanupFailure:cleanupFailed})});
}
