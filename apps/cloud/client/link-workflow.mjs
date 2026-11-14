import {constants} from 'node:fs';
import {open,lstat,rename,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';

const hash=x=>createHash('sha256').update(x).digest('hex');
const invalid=()=>{throw Error('Private original capability custody is invalid');};
const unknown=r=>Object.assign(Error('Original capability outcome UNKNOWN; reconcile or cancel the same request, never create another link'),{outcome:'UNKNOWN',requestID:r.requestID});
const isPrivate=s=>s.isFile()&&(s.mode&0o077)===0&&s.nlink===1&&(!process.getuid||s.uid===process.getuid());
async function parent(path){const p=dirname(resolve(path)),s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||process.getuid&&s.uid!==process.getuid())invalid();return p;}
async function sync(path){const f=await open(await parent(path),constants.O_RDONLY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
async function newFile(path,value){await parent(path);const f=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}await sync(path);}
async function read(path,limit=8192){await parent(path);const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
 const s=await f.stat();if(!isPrivate(s)||s.size>limit)invalid();const b=Buffer.alloc(limit+1);let n=0;
 while(n<b.length){const {bytesRead}=await f.read(b,n,b.length-n,null);if(!bytesRead)break;n+=bytesRead;}if(n>limit)invalid();
 const after=await lstat(path);if(!isPrivate(after)||s.ino!==after.ino||s.dev!==after.dev)invalid();
 try{return JSON.parse(b.subarray(0,n).toString('utf8'));}catch{invalid();}
}finally{await f.close();}}
async function save(path,r){await read(path);const tmp=resolve(path)+'.'+randomUUID()+'.tmp';try{await newFile(tmp,r);await rename(tmp,path);await sync(path);}finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
const claimDATA=r=>({requestID:r.requestID,fingerprint:hash(JSON.stringify({endpoint:r.endpoint,account:r.account,product:r.product,selection:r.selection}))});
async function claim(path,r,suffix,mode,create){
 const expected={...claimDATA(r),mode};
 if(create)try{await newFile(path+suffix,expected);return {first:true,mode};}catch(e){if(e.code!=='EEXIST')throw e;}
 let existing;try{existing=await read(path+suffix,1024);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(existing.requestID!==expected.requestID||existing.fingerprint!==expected.fingerprint||!['SUBMIT','CANCEL'].includes(existing.mode)||suffix==='.cancel'&&existing.mode!=='CANCEL')invalid();
 return {first:false,mode:existing.mode};
}

export async function readOriginalLinkFile(path){
 let r=await read(path);
 if(r?.schemaVersion!==1||r.kind!=='original-link-capability'||r.product!=='cloud'||typeof r.account!=='string'||!r.account||!/^share2_[A-Za-z0-9_-]{43}$/.test(r.token??'')||!/^[-A-Za-z0-9_]{16,128}$/.test(r.requestID??'')||r.selection?.action!=='link-create'||r.selection.objectId!==r.objectID||r.selection.tokenSHA256!==hash(r.token)||r.selection.role!=='viewer'||!Number.isSafeInteger(r.version)||r.version<1||!r.binding||!['PREPARED','UNKNOWN','COMMITTED','CANCEL_UNKNOWN','CANCELLED','REVOKED','EXPIRED','UNAVAILABLE'].includes(r.state))invalid();
 const entered=await claim(path,r,'.enter','SUBMIT',false),cancelled=await claim(path,r,'.cancel','CANCEL',false);
 if(r.state==='PREPARED'&&entered)r={...r,state:entered.mode==='CANCEL'?'CANCEL_UNKNOWN':'UNKNOWN'};
 if((entered?.mode==='CANCEL'||cancelled)&&!['CANCELLED','REVOKED','UNAVAILABLE'].includes(r.state))r={...r,state:'CANCEL_UNKNOWN',cancelRequested:true};
 return r;
}
function checkObservation(r,o){
 if(!['COMMITTED','CANCELLED'].includes(o?.outcome)||o.objectId!==r.objectID||JSON.stringify(o.selection)!==JSON.stringify(r.selection))throw unknown(r);
 if(o.outcome==='COMMITTED'&&!o.deleted&&!o.linkUnavailable){
  if((o.version??0)!==r.version||JSON.stringify(o.binding)!==JSON.stringify(r.binding)||o.revision!==r.selection.expectedRevision||!o.link||!/^[-A-Za-z0-9_]{1,160}$/.test(o.link.id??'')||o.link.objectId!==r.objectID||o.link.role!=='viewer'||new Date(o.link.expiresAt).toISOString()!==r.selection.expiresAt||r.linkID&&r.linkID!==o.link.id)throw unknown(r);
 }
}
async function observe(client,path,r,o){
 checkObservation(r,o);
 // A create response can arrive after a concurrent cancel was durably
 // entered/confirmed. Never publish that late response over local retirement.
 const current=await readOriginalLinkFile(path);
 if(current.requestID!==r.requestID||current.endpoint!==r.endpoint||current.account!==r.account||current.token!==r.token||JSON.stringify(current.selection)!==JSON.stringify(r.selection))throw unknown(r);
 if(['CANCELLED','REVOKED','EXPIRED','UNAVAILABLE'].includes(current.state))return current;
 if(current.cancelRequested)r={...r,cancelRequested:true};
 let state;
 if(o.outcome==='CANCELLED')state='CANCELLED';
 else if(o.deleted||o.linkUnavailable)state='UNAVAILABLE';
 else if(o.link.revokedAt)state='REVOKED';
 else if(Date.parse(o.link.expiresAt)<=Date.now())state='EXPIRED';
 else state=r.cancelRequested?'CANCEL_UNKNOWN':'COMMITTED';
 r={...r,state,...(o.link?{linkID:o.link.id}:{})};await save(path,r);return r;
}
function output(path,r){return {outcome:r.state,requestID:r.requestID,...(r.linkID?{linkID:r.linkID}:{}),tokenFile:resolve(path),objectID:r.objectID,version:r.version,binding:r.binding};}

export async function originalLinkWorkflow(client,endpoint,mode,path,{objectID,expiresAt}={}){
 endpoint=new URL(endpoint).href.replace(/\/$/,'');
 const session=await client.currentSession();if(!session.scopes.includes('permissions.manage'))throw Error('Current original permissions.manage scope required');
 let r;
 try{r=await readOriginalLinkFile(path);}catch(e){
  if(e.code!=='ENOENT'||!['prepare','create'].includes(mode))throw e;
  if(!Number.isFinite(Date.parse(expiresAt)))throw Error('Explicit original capability expiry required');expiresAt=new Date(expiresAt).toISOString();
  const obj=await client.get(objectID);if(!obj.binding||!Number.isSafeInteger(obj.version)||obj.version<1)throw Error('Original file binding required');
  const token='share2_'+randomBytes(32).toString('base64url');
  r={schemaVersion:1,kind:'original-link-capability',endpoint,account:session.account,product:'cloud',objectID,version:obj.version,binding:obj.binding,token,requestID:randomUUID(),state:'PREPARED',selection:{action:'link-create',objectId:objectID,expectedRevision:obj.revision,tokenSHA256:hash(token),role:'viewer',expiresAt}};
  await newFile(path,r);
 }
 if(r.endpoint!==endpoint||r.account!==session.account||r.product!==session.product||objectID!==undefined&&r.objectID!==objectID||expiresAt!==undefined&&r.selection.expiresAt!==new Date(expiresAt).toISOString())throw Error('Custody belongs to another original account, endpoint or capability selection');
 if(mode==='prepare')return output(path,r);
 if(mode==='cancel'){
  await claim(path,r,'.enter','CANCEL',true);
  const entered=await claim(path,r,'.cancel','CANCEL',true);
  r={...r,state:'CANCEL_UNKNOWN',cancelRequested:true};await save(path,r);
  if(entered.first){try{r=await observe(client,path,r,await client.cancelOriginalLink(r.requestID,r.selection));}catch{throw unknown(r);}return output(path,r);}
 }else if(mode==='create'&&r.state==='PREPARED'){
  const entered=await claim(path,r,'.enter','SUBMIT',true);
  r={...r,state:entered.mode==='CANCEL'?'CANCEL_UNKNOWN':'UNKNOWN',...(entered.mode==='CANCEL'?{cancelRequested:true}:{})};await save(path,r);
  if(entered.first&&entered.mode==='SUBMIT'){
   try{r=await observe(client,path,r,await client.createOriginalLink(r.requestID,r.selection));}catch{throw unknown(r);}return output(path,r);
  }
 }
 try{r=await observe(client,path,r,await client.lookupOriginal(r.requestID));}catch{throw unknown(r);}
 if(['UNKNOWN','CANCEL_UNKNOWN'].includes(r.state))throw unknown(r);
 return output(path,r);
}
