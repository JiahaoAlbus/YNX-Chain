import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {types} from 'node:util';
import {PrivateFilePolicy} from './platform-private-file.mjs';
import {encodeIDEIdentityPeerDecision} from './wallet-ide-identity-peer-wire.mjs';
const owners=new WeakSet(),magic=Buffer.from('YNXIDEID1\n'),maximum=1<<20;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,hex=/^[a-f0-9]{64}$/;
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=code=>{throw Object.assign(Error(code),{code});};
function exact(v,fields){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_IDENTITY_EVIDENCE_INVALID');const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);if(keys.length!==fields.length||keys.some(k=>!fields.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('AUTH_IDENTITY_EVIDENCE_INVALID');}
function rawText(v){if(typeof v!=='string'||!v.length||Buffer.byteLength(v)>16384||Buffer.from(v).toString()!==v)fail('AUTH_IDENTITY_EVIDENCE_INVALID');return v;}
function copied(v){if(types.isProxy(v)||!types.isUint8Array(v)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(v))||['buffer','byteLength','byteOffset','length'].some(k=>Object.hasOwn(v,k))||types.isSharedArrayBuffer(v.buffer)||!v.byteLength||v.byteLength>262144)fail('AUTH_IDENTITY_EVIDENCE_INVALID');return Buffer.from(v);}
function causeData(v,present){
 if(!present)return {present:false};
 if(v===null||['undefined','boolean','number','bigint'].includes(typeof v))return {present:true,type:v===null?'null':typeof v,value:typeof v==='number'||typeof v==='bigint'?String(v):v??null};
 const text=s=>{const b=Buffer.from(s);return {bytes:b.length,sha256:hash(b),base64:b.subarray(0,4096).toString('base64'),truncated:b.length>4096};};
 if(typeof v==='string')return {present:true,type:'string',value:text(v)};
 const fields={};if(v&&typeof v==='object'&&!types.isProxy(v))for(const k of ['name','code','message']){const d=Object.getOwnPropertyDescriptor(v,k);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')fields[k]=text(d.value);}
 return {present:true,type:typeof v,fields};
}
function capture(v){
 exact(v,['reviewId','requestOriginal','expectedOriginal','purpose','decision','phase','wire','payload','firstCausePresent','firstCause','handoffAuthorized']);
 if(!uuid.test(v.reviewId)||rawText(v.requestOriginal)!==rawText(v.expectedOriginal)||!['AUTH-IDENTITY-RECEIVE','AUTH-IDENTITY-RECOVER','AUTH-PROTECTED-KEY-CALL'].includes(v.purpose)||!['approve','reject','cancel'].includes(v.decision)||!['recorded-unhanded','signed-outcome-unknown','decision-outcome-unknown'].includes(v.phase)||typeof v.firstCausePresent!=='boolean'||v.handoffAuthorized!==false)fail('AUTH_IDENTITY_EVIDENCE_INVALID');
 const wire=v.wire===null?null:copied(v.wire);if(wire!==null&&v.decision!=='approve'||v.phase==='signed-outcome-unknown'&&wire===null)fail('AUTH_IDENTITY_EVIDENCE_INVALID');
 let payload=null;if(v.payload!==null){exact(v.payload,['kind','bytes']);const expected=encodeIDEIdentityPeerDecision({decision:v.decision,requestRaw:v.requestOriginal,proof:wire}),b=copied(v.payload.bytes);if(v.payload.kind!==expected.kind||!b.equals(expected.payload))fail('AUTH_IDENTITY_EVIDENCE_INVALID');payload={kind:expected.kind,base64:b.toString('base64')};}
 if(v.phase==='recorded-unhanded'&&payload===null)fail('AUTH_IDENTITY_EVIDENCE_INVALID');
 const body=Buffer.from(JSON.stringify({version:'YNX-WALLET-IDE-IDENTITY-EVIDENCE/v1',reviewId:v.reviewId,requestOriginal:v.requestOriginal,expectedOriginal:v.expectedOriginal,purpose:v.purpose,decision:v.decision,phase:v.phase,wire:wire?.toString('base64')??null,payload,firstCause:causeData(v.firstCause,v.firstCausePresent),dataOnly:true,handoffAuthorized:false,retryAuthorized:false}));
 if(body.length>maximum)fail('AUTH_IDENTITY_EVIDENCE_INVALID');return {body,reviewId:v.reviewId,requestSha256:hash(Buffer.from(v.requestOriginal)),sha256:hash(body)};
}
function reference(v){exact(v,['eventId','attemptId','reviewId','requestSha256','bytes','sha256']);if(![v.eventId,v.attemptId,v.reviewId].every(x=>typeof x==='string'&&uuid.test(x))||!hex.test(v.requestSha256)||!hex.test(v.sha256)||!Number.isSafeInteger(v.bytes)||v.bytes<1||v.bytes>maximum)fail('AUTH_IDENTITY_EVIDENCE_INVALID');return Object.freeze({...v});}
function capturePeer(v){
 exact(v,['operationId','sequence','account','requestOriginal','invocationOriginal','reviewId','phase','decision','wire','sendSelected','sendStarted','sendReturned','closed','firstCausePresent','firstCause','cleanupCausePresent','cleanupCause','storageCausePresent','storageCause']);
 if(typeof v.sequence!=='string'||! /^[1-9][0-9]{0,15}$/.test(v.sequence)||BigInt(v.sequence)>BigInt(Number.MAX_SAFE_INTEGER)||!uuid.test(v.operationId)||typeof v.account!=='string'||!/^0x[0-9a-f]{40}$/.test(v.account)||v.reviewId!==null&&!uuid.test(v.reviewId)||!['launch-selected','request-captured','review-ready','decision-selected','send-selected','send-returned','failed','retired','closed'].includes(v.phase)||![null,'approve','reject','cancel'].includes(v.decision)||['sendSelected','sendStarted','sendReturned','closed','firstCausePresent','cleanupCausePresent','storageCausePresent'].some(k=>typeof v[k]!=='boolean'))fail('AUTH_IDENTITY_EVIDENCE_INVALID');
 const raw=v.requestOriginal===null?null:rawText(v.requestOriginal),invocation=v.invocationOriginal===null?null:rawText(v.invocationOriginal),wire=v.wire===null?null:copied(v.wire);
 if(raw===null&&(invocation!==null||v.decision!==null||v.reviewId!==null)||wire!==null&&v.decision!=='approve'||v.sendReturned&&!v.sendStarted||v.sendStarted&&!v.sendSelected||v.sendSelected&&(v.decision===null||raw===null)||v.phase==='closed'&&!v.closed)fail('AUTH_IDENTITY_EVIDENCE_INVALID');
 const body=Buffer.from(JSON.stringify({version:'YNX-WALLET-IDE-PEER-EVIDENCE/v1',operationId:v.operationId,sequence:v.sequence,account:v.account,requestOriginal:raw,invocationOriginal:invocation,reviewId:v.reviewId,phase:v.phase,decision:v.decision,wire:wire?.toString('base64')??null,sendSelected:v.sendSelected,sendStarted:v.sendStarted,sendReturned:v.sendReturned,closed:v.closed,firstCause:causeData(v.firstCause,v.firstCausePresent),cleanupCause:causeData(v.cleanupCause,v.cleanupCausePresent),storageCause:causeData(v.storageCause,v.storageCausePresent),dataOnly:true,handoffAuthorized:false,retryAuthorized:false}));
 if(body.length>maximum)fail('AUTH_IDENTITY_EVIDENCE_INVALID');return {body,reviewId:v.operationId,requestSha256:hash(Buffer.from(raw??'')),sha256:hash(body)};
}
function peerBody(body,ref){
 exact(body,['version','operationId','sequence','account','requestOriginal','invocationOriginal','reviewId','phase','decision','wire','sendSelected','sendStarted','sendReturned','closed','firstCause','cleanupCause','storageCause','dataOnly','handoffAuthorized','retryAuthorized']);
 if(body.operationId!==ref.reviewId||hash(Buffer.from(body.requestOriginal??''))!==ref.requestSha256||body.dataOnly!==true||body.handoffAuthorized!==false||body.retryAuthorized!==false)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');
 let wire=null;if(body.wire!==null){if(typeof body.wire!=='string'||body.wire.length>4*Math.ceil(262144/3))fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');wire=Buffer.from(body.wire,'base64');if(wire.toString('base64')!==body.wire)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');}
 capturePeer({operationId:body.operationId,sequence:body.sequence,account:body.account,requestOriginal:body.requestOriginal,invocationOriginal:body.invocationOriginal,reviewId:body.reviewId,phase:body.phase,decision:body.decision,wire,sendSelected:body.sendSelected,sendStarted:body.sendStarted,sendReturned:body.sendReturned,closed:body.closed,firstCausePresent:false,firstCause:undefined,cleanupCausePresent:false,cleanupCause:undefined,storageCausePresent:false,storageCause:undefined});
 return Object.freeze({...body,rawStored:true});
}
export const isWalletIDEIdentityEvidence=value=>owners.has(value);
/** Actual private immutable result storage. Local evidence is never a user
 * approval, Native Source, handoff grant or permission to regenerate proof.
 * All writes are new exclusive attempts; failed/UNKNOWN partials stay intact.
 */
export class WalletIDEIdentityEvidence {
 #held=null;#active=false;#persisting=false;#readers=0;#closeDebt=false;#closeCause;#hasCloseCause=false;
 constructor({directory,io=fs,platform=process.platform,policy=new PrivateFilePolicy({io,platform})}){if(typeof directory!=='string'||!path.isAbsolute(directory)||path.normalize(directory)!==directory||directory===path.parse(directory).root)fail('AUTH_IDENTITY_EVIDENCE_DIRECTORY_REQUIRED');this.directory=directory;this.io=io;this.policy=policy;this.platform=platform;owners.add(this);}
 assertSafeToClose(){if(this.#held||this.#active||this.#persisting||this.#readers||this.#closeDebt)fail('AUTH_IDENTITY_EVIDENCE_UNCONFIRMED');}
 #rememberClose(cause){this.#closeDebt=true;if(!this.#hasCloseCause){this.#hasCloseCause=true;this.#closeCause=cause;}}
 pending(){const h=this.#held;return h?Object.freeze({eventId:h.eventId,reviewId:h.reviewId,requestSha256:h.requestSha256,sha256:h.sha256,firstCausePresent:h.failed,closeUnknown:this.#closeDebt}):null;}
 #file(ref){return path.join(this.directory,ref.eventId+'.'+ref.attemptId+'.ideid');}
 async #directory(){await this.policy.directory(this.directory);if(await this.io.realpath(this.directory)!==this.directory)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');const s=await this.io.lstat(this.directory);if(!s.isDirectory()||s.isSymbolicLink()||this.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid()))fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');}
 async #read(ref){
  let handle,failed=false,cause,body;
  try{const file=this.#file(ref);handle=await this.io.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));const before=await handle.stat();await this.policy.assertPrivate(file,before);if(this.platform!=='win32'&&before.uid!==process.getuid())fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');
   const meta=Buffer.from(JSON.stringify({version:1,reference:ref}));if(before.size!==magic.length+4+meta.length+ref.bytes||meta.length>8192)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');
   // The stat is only a snapshot: readFile could allocate without bound if the
   // file grows after that snapshot. Read exactly the pinned length, then EOF.
   const all=Buffer.alloc(before.size);let at=0;while(at<all.length){const r=await handle.read(all,at,all.length-at,null);if(!Number.isSafeInteger(r.bytesRead)||r.bytesRead<1||r.bytesRead>all.length-at)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');at+=r.bytesRead;}
   const tail=await handle.read(Buffer.alloc(1),0,1,null);if(tail.bytesRead!==0)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');
   if(!all.subarray(0,magic.length).equals(magic)||all.readUInt32BE(magic.length)!==meta.length||!all.subarray(magic.length+4,magic.length+4+meta.length).equals(meta))fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');
   body=all.subarray(magic.length+4+meta.length);const after=await handle.stat();await this.policy.assertPrivate(file,after);if(hash(body)!==ref.sha256||['dev','ino','size','mode','uid','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]))fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');
  }catch(e){failed=true;cause=e;}finally{if(handle){const owned=handle;handle=null;try{await owned.close();}catch(e){this.#rememberClose(e);if(!failed){failed=true;cause=e;}}}}
  if(failed)throw cause;return Buffer.from(body);
 }
 async #flush(){
  const h=this.#held;if(!h||this.#active||this.#closeDebt)fail('AUTH_IDENTITY_EVIDENCE_UNCONFIRMED');this.#active=true;
  const ref=reference({eventId:h.eventId,attemptId:randomUUID(),reviewId:h.reviewId,requestSha256:h.requestSha256,bytes:h.body.length,sha256:h.sha256});let handle,failed=false,cause;
  try{await this.#directory();const file=this.#file(ref),meta=Buffer.from(JSON.stringify({version:1,reference:ref})),length=Buffer.alloc(4);length.writeUInt32BE(meta.length);
   handle=await this.io.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);await this.policy.protect(file);await this.policy.assertPrivate(file,await handle.stat());await handle.writeFile(Buffer.concat([magic,length,meta,h.body]));await handle.sync();
   const owned=handle;handle=null;try{await owned.close();}catch(e){this.#rememberClose(e);throw e;}
   if(this.platform!=='win32'){const dir=await this.io.open(this.directory,'r');let syncFailed=false,syncCause;try{await dir.sync();}catch(e){syncFailed=true;syncCause=e;}try{await dir.close();}catch(e){this.#rememberClose(e);if(!syncFailed){syncFailed=true;syncCause=e;}}if(syncFailed)throw syncCause;}
   await this.#read(ref);this.#held=null;
  }catch(e){failed=true;cause=e;if(!h.failed){h.failed=true;h.cause=e;}}
  finally{if(handle){const owned=handle;handle=null;try{await owned.close();}catch(e){this.#rememberClose(e);if(!failed){failed=true;cause=e;if(!h.failed){h.failed=true;h.cause=e;}}}}this.#active=false;}
  if(failed)throw Object.assign(Error('AUTH_IDENTITY_EVIDENCE_UNCONFIRMED'),{code:'AUTH_IDENTITY_EVIDENCE_UNCONFIRMED',cause:h.failed?h.cause:cause,eventId:h.eventId,cleanupCausePresent:this.#hasCloseCause,cleanupCause:this.#closeCause});
 }
 persist(record){return this.#persistRecord(record,capture);}
 persistPeer(record){return this.#persistRecord(record,capturePeer);}
 async #persistRecord(record,captureRecord){
  if(this.#active||this.#persisting||this.#readers||this.#closeDebt)fail('AUTH_IDENTITY_EVIDENCE_UNCONFIRMED');this.#persisting=true;
  try{const next=captureRecord(record);
   if(this.#held){const h=this.#held;if(h.reviewId!==next.reviewId||h.requestSha256!==next.requestSha256)fail('AUTH_IDENTITY_EVIDENCE_UNCONFIRMED');await this.#flush();if(h.sha256===next.sha256)return;}
   this.#held={...next,eventId:randomUUID(),failed:false,cause:undefined};await this.#flush();
  }finally{this.#persisting=false;}
 }
 async read(value){const ref=reference(value);if(this.#active||this.#persisting)fail('AUTH_IDENTITY_EVIDENCE_UNCONFIRMED');this.#readers++;try{await this.#directory();const raw=await this.#read(ref),text=new TextDecoder('utf-8',{fatal:true}).decode(raw),body=JSON.parse(text);if(JSON.stringify(body)!==text)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');if(body.version==='YNX-WALLET-IDE-PEER-EVIDENCE/v1')return peerBody(body,ref);exact(body,['version','reviewId','requestOriginal','expectedOriginal','purpose','decision','phase','wire','payload','firstCause','dataOnly','handoffAuthorized','retryAuthorized']);if(JSON.stringify(body)!==text||body.version!=='YNX-WALLET-IDE-IDENTITY-EVIDENCE/v1'||body.reviewId!==ref.reviewId||hash(Buffer.from(rawText(body.requestOriginal)))!==ref.requestSha256||body.dataOnly!==true||body.handoffAuthorized!==false||body.retryAuthorized!==false)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');const decode=s=>{if(typeof s!=='string'||!s.length||s.length>4*Math.ceil(262144/3))fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');const b=Buffer.from(s,'base64');if(b.toString('base64')!==s)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');return b;};let payload=null;if(body.payload!==null){exact(body.payload,['kind','base64']);payload={kind:body.payload.kind,bytes:decode(body.payload.base64)};}capture({reviewId:body.reviewId,requestOriginal:body.requestOriginal,expectedOriginal:body.expectedOriginal,purpose:body.purpose,decision:body.decision,phase:body.phase,wire:body.wire===null?null:decode(body.wire),payload,firstCausePresent:false,firstCause:undefined,handoffAuthorized:false});return Object.freeze({...body,rawStored:true,handoffAuthorized:false,retryAuthorized:false});}finally{this.#readers--;}}
 async candidates(){
  if(this.#active||this.#persisting)fail('AUTH_IDENTITY_EVIDENCE_UNCONFIRMED');this.#readers++;try{await this.#directory();const names=await this.io.readdir(this.directory);if(names.length>1024)fail('AUTH_IDENTITY_EVIDENCE_CAPACITY');const refs=[];let unreadable=0;
  for(const name of names.sort()){let handle;try{if(!/^[a-f0-9-]+\.[a-f0-9-]+\.ideid$/.test(name))fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');const file=path.join(this.directory,name);handle=await this.io.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));await this.policy.assertPrivate(file,await handle.stat());
    const prefix=Buffer.alloc(magic.length+4);let at=0;while(at<prefix.length){const r=await handle.read(prefix,at,prefix.length-at,null);if(!r.bytesRead)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');at+=r.bytesRead;}const n=prefix.readUInt32BE(magic.length);if(!prefix.subarray(0,magic.length).equals(magic)||n<1||n>8192)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');const b=Buffer.alloc(n);at=0;while(at<n){const r=await handle.read(b,at,n-at,null);if(!r.bytesRead)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');at+=r.bytesRead;}const meta=JSON.parse(b.toString('utf8'));exact(meta,['version','reference']);if(meta.version!==1||JSON.stringify(meta)!==b.toString('utf8'))fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');const ref=reference(meta.reference);if(path.basename(this.#file(ref))!==name)fail('AUTH_IDENTITY_EVIDENCE_UNVERIFIED');refs.push(ref);
   }catch{unreadable++;}finally{if(handle){const owned=handle;handle=null;try{await owned.close();}catch(e){this.#rememberClose(e);unreadable++;}}}}
  return Object.freeze({candidates:Object.freeze(refs),unreadable,closeUnknown:this.#closeDebt});}finally{this.#readers--;}
 }
}
