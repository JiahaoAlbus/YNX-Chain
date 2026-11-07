// Fixed protected Source helper, not a new key/signing/Root service. Empty
// locator rows reject BEFORE any file/process. Root math stays in original Go
// SourceAuthority/verifyEnvelope; SDK V4 math/nonce stays in original Host.
import{spawn}from'node:child_process';import{openSync,readSync,fstatSync,lstatSync,constants,closeSync}from'node:fs';import{dirname,isAbsolute}from'node:path';import{createHash}from'node:crypto';
import{canonicalJSON}from'../src/canonical.js';
import{encodeSocialPrincipalRequestFrame,decodeSocialPrincipalResponseFrame,decodeSocialPrincipalBindingOriginal,decodeSocialPrincipalQualifiedOriginal,createSocialPrincipalFrameReaderDATA,nextSocialPrincipalSequence}from'./social-principal-stdio-v1/codec.mjs';
// Private immutable build-selected PUBLIC image locator only. Never a Root
// public key/JSON approval or runtime path/provider configuration.
const reviewedSocialProfileHelpers=Object.freeze([]),retained=new Set();
// Custody recognition is private identity, never object shape/frozen state.
// No constructor or caller-selected row/path factory can mint membership.
const originalSourceServices=new WeakSet(),sourceConstructionPermit=Object.freeze({});
const failure=c=>Object.assign(Error(c),{code:c});
function same(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.gid===b.gid&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
// Events are physical failure observations, never qualification callbacks. All
// listeners remain attached until the SAME child actually closes.
function bindOriginalChildErrors(child,onFailure){for(const stream of[child,child.stdin,child.stdout,child.stderr])stream?.on('error',onFailure);}
class OriginalSocialJointSourceService{
 constructor(permit){if(permit!==sourceConstructionPermit)throw failure('SOCIAL_SOURCE_PRIVATE_CONSTRUCTION');originalSourceServices.add(this);Object.freeze(this);}
 static async acquireOriginal(){
  if(arguments.length)throw failure('SOCIAL_SOURCE_HELPER_ZERO_ARGUMENTS');
  const owner=new OriginalSocialJointSourceService(sourceConstructionPermit);
  if(reviewedSocialProfileHelpers.length!==1){const error=failure('SOCIAL_SOURCE_HELPER_NOT_SUPPLIED');owner.#remember(error);return Object.freeze({owner,errorPresent:true,error});}
  try{await owner.#initialize(reviewedSocialProfileHelpers[0]);return Object.freeze({owner,errorPresent:false});}
  catch(error){owner.#remember(error);owner.#retired=true;return Object.freeze({owner,errorPresent:true,error:owner.#first});}
 }
 #row;#fd=null;#stat;#parents=[];#child;#sequence='0';#pending=null;#reader=createSocialPrincipalFrameReaderDATA();#first;#firstPresent=false;#retired=false;#closed=false;#physicalDone=false;#childExited=false;#exitPromise;#closeSelected=false;#childCloseSelected=false;#binding;#profileOriginal=null;#deadline=0;#wallFloor=0;#startedWall=0;#startedMono=0;#completed=new WeakMap();#responseByCredential=new WeakMap();#responses=new Set();#queue=Promise.resolve();#publicFiles=[];#lastResponse;
 #remember(e){if(!this.#firstPresent){this.#firstPresent=true;this.#first=e;}}
 #readFD(fd,size){const b=Buffer.alloc(size);let at=0;while(at<b.length){const n=readSync(fd,b,at,b.length-at,at);if(n<=0)throw failure('SOCIAL_SOURCE_ORIGINAL_READ_UNKNOWN');at+=n;}return b;}
 #physical(){const r=this.#row;if(!r||process.getuid?.()!==r.processUID||this.#fd===null||!same(this.#stat,fstatSync(this.#fd))||!same(this.#stat,lstatSync(r.helperPath)))throw failure('SOCIAL_SOURCE_HELPER_IMAGE_CHANGED');for(const p of this.#parents)if(!same(p.stat,lstatSync(p.path)))throw failure('SOCIAL_SOURCE_HELPER_PARENT_CHANGED');const b=this.#readFD(this.#fd,this.#stat.size);if(createHash('sha256').update(b).digest('hex')!==r.helperSHA256||!same(this.#stat,fstatSync(this.#fd))||!same(this.#stat,lstatSync(r.helperPath)))throw failure('SOCIAL_SOURCE_HELPER_IMAGE_CHANGED');for(const p of this.#publicFiles){if(!same(p.stat,fstatSync(p.fd))||!same(p.stat,lstatSync(p.path))||!this.#readFD(p.fd,p.stat.size).equals(p.original)||!same(p.stat,fstatSync(p.fd))||!same(p.stat,lstatSync(p.path)))throw failure('SOCIAL_SOURCE_PUBLIC_ORIGINAL_CHANGED');}for(const p of this.#parents)if(!same(p.stat,lstatSync(p.path)))throw failure('SOCIAL_SOURCE_HELPER_PARENT_CHANGED');}
 #holdPublic(path,original){if(!isAbsolute(path)||!Buffer.isBuffer(original)||original.length===0||original.length>65536)throw failure('SOCIAL_SOURCE_PUBLIC_LOCATOR');for(let p=dirname(path);;p=dirname(p)){const stat=lstatSync(p);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))throw failure('SOCIAL_SOURCE_PUBLIC_PARENT');this.#parents.push({path:p,stat});if(p==='/')break;}const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC),p={path,fd,stat:null,original:Buffer.from(original),closeSelected:false};this.#publicFiles.push(p);p.stat=fstatSync(fd);if(!p.stat.isFile()||p.stat.uid!==0||p.stat.nlink!==1||(p.stat.mode&0o022)||p.stat.size!==original.length||!this.#readFD(fd,p.stat.size).equals(original))throw failure('SOCIAL_SOURCE_PUBLIC_ORIGINAL_CHANGED');}
 #live(){try{const now=Date.now();if(this.#retired||this.#closed||this.#firstPresent||!this.#binding||now<this.#wallFloor||now>=this.#binding.expiresMS||performance.now()>=this.#deadline)throw this.#firstPresent?this.#first:failure('SOCIAL_SOURCE_HELPER_NOT_LIVE');this.#wallFloor=now;this.#physical();const end=Date.now();if(end<now||end>=this.#binding.expiresMS||performance.now()>=this.#deadline)throw failure('SOCIAL_SOURCE_HELPER_NOT_LIVE');this.#wallFloor=end;}catch(e){this.#remember(e);this.#retired=true;throw e;}}
 #take(sequence,command,ownerDebt=null){if(this.#pending)throw failure('SOCIAL_SOURCE_HELPER_PENDING');let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});const state={sequence,command,ownerDebt,resolve,reject,promise,frame:null};this.#pending=state;const timer=setTimeout(()=>{if(this.#pending===state){const e=failure('SOCIAL_SOURCE_HELPER_RESPONSE_UNKNOWN');this.#remember(e);reject(e);}},7000);promise.finally(()=>clearTimeout(timer)).catch(()=>{});return promise;}
 #adopt(raw){const p=this.#pending;if(!p)throw failure('SOCIAL_SOURCE_HELPER_UNSOLICITED_FRAME');const frame=decodeSocialPrincipalResponseFrame(raw,p.sequence,p.command);p.frame=frame;this.#lastResponse=frame;if(p.command==='qualify'&&p.ownerDebt)p.ownerDebt.rawOriginal=frame.original;this.#pending=null;if(frame.physicalDone)this.#physicalDone=true;if(frame.errorPresent)this.#remember(frame.error);p.resolve(frame);}
 async #initialize(row){this.#startedWall=Date.now();this.#startedMono=performance.now();this.#wallFloor=this.#startedWall;this.#row=row;retained.add(this);if(!isAbsolute(row.helperPath)||!Number.isInteger(row.processUID)||process.getuid?.()!==row.processUID||!/^[0-9a-f]{64}$/.test(row.helperSHA256))throw failure('SOCIAL_SOURCE_HELPER_SELECTION');for(let p=dirname(row.helperPath);;p=dirname(p)){const stat=lstatSync(p);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))throw failure('SOCIAL_SOURCE_HELPER_PARENT');this.#parents.push({path:p,stat});if(p==='/')break;}
 this.#fd=openSync(row.helperPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC);this.#stat=fstatSync(this.#fd);if(!this.#stat.isFile()||this.#stat.uid!==0||this.#stat.nlink!==1||!(this.#stat.mode&0o111)||(this.#stat.mode&0o222)||this.#stat.size<=0||this.#stat.size>268435456)throw failure('SOCIAL_SOURCE_HELPER_IMAGE');this.#physical();
 const ready=this.#take('0','read');this.#child=spawn(row.helperPath,[],{env:{},stdio:['pipe','pipe','pipe']});bindOriginalChildErrors(this.#child,e=>{this.#remember(e);this.#pending?.reject(e);});this.#exitPromise=new Promise(resolve=>this.#child.once('close',()=>{this.#childExited=true;const ended=this.#reader.finish();if(ended.errorPresent){this.#remember(ended.error);this.#pending?.reject(ended.error);}if(!this.#physicalDone){const e=failure('SOCIAL_SOURCE_HELPER_EXIT_UNKNOWN');this.#remember(e);this.#pending?.reject(e);}resolve();}));this.#child.stdout.on('data',chunk=>{try{const read=this.#reader.push(chunk);for(const frame of read.frames)this.#adopt(frame);if(read.errorPresent)throw read.error;}catch(e){this.#remember(e);this.#pending?.reject(e);}});let diagnostics=0;this.#child.stderr.on('data',chunk=>{diagnostics+=chunk.length;if(diagnostics>16384)this.#remember(failure('SOCIAL_SOURCE_HELPER_DIAGNOSTIC_CAP'));});
 const frame=await ready;if(frame.original!==null){this.#binding=decodeSocialPrincipalBindingOriginal(frame.original);this.#profileOriginal=Buffer.from(this.#binding.profileOriginal,'utf8');}if(frame.errorPresent)throw this.#first;if(this.#binding?.expiresMS<=Date.now()||this.#binding.expiresMS-Date.now()>30000)throw failure('SOCIAL_SOURCE_HELPER_BINDING');
 // Fresh profile bytes belong to this SAME pinned Go child and its retained
 // Native Source/binding/capture. They are not a pre-existing profilePath file
 // (whose fresh nonce/history could never equal this newly captured owner).
 // The public registration FD and helper image remain independently held.
 this.#holdPublic(row.registrationPath,Buffer.from(this.#binding.registrationOriginal));this.#deadline=Math.min(this.#startedMono+this.#binding.expiresMS-this.#startedWall,performance.now()+this.#binding.expiresMS-Date.now());this.#live();await this.#call('current');this.#live();}
 #call(command,payload={},ownerDebt=null){const work=async()=>{if(!['retire','join','close'].includes(command))this.#live();if(this.#pending)throw failure('SOCIAL_SOURCE_HELPER_ORIGINAL_QUERY_PENDING');const sequence=nextSocialPrincipalSequence(this.#sequence);this.#sequence=sequence;const pending=this.#take(sequence,command,ownerDebt),request={version:1,sequence,command,requestOriginal:'',replayKey:'',proofExpiresMS:0,...payload};this.#child.stdin.write(encodeSocialPrincipalRequestFrame(request),e=>{if(e){this.#remember(e);this.#pending?.reject(e);}});const frame=await pending;if(frame.errorPresent)throw this.#first;if(!['retire','join','close'].includes(command))this.#live();return frame;};const p=this.#queue.then(work);this.#queue=p.catch(()=>{});return p;}
 assertSocialDeviceDirectoryPrincipalPurposeV4(){this.#live();}
 async existingSocialDeviceDirectoryPrincipalV4(credential){
  this.#live();
  const{readOriginalSocialDirectoryHTTPCredential,assertOriginalSocialDirectoryHTTPCredentialCompletion}=await import('../src/product-session-gateway-node-host.js');
  const view=await readOriginalSocialDirectoryHTTPCredential(credential);this.#live();
  if(this.#responseByCredential.has(credential))throw failure('SOCIAL_SOURCE_RESPONSE_ALREADY_RETAINED');
  if(canonicalJSON(view.originalRequest.expected)!==canonicalJSON(this.#binding.expected))throw failure('SOCIAL_SOURCE_V4_EXPECTED_CHANGED');
  const entry={credential,readCredential:readOriginalSocialDirectoryHTTPCredential,assertCredential:assertOriginalSocialDirectoryHTTPCredentialCompletion,request:view.originalRequest,requestOriginal:canonicalJSON(view.originalRequest),proofReplayKey:view.proofReplayKey,proofExpiresMS:view.proofExpiresMS,sourceChild:this.#child,rawOriginal:null,result:null,firstPresent:false,first:undefined,loan:null,retired:false,closed:false,inflight:0,closeResult:null};
  // The result debt exists BEFORE foreign qualification/late errors. A genuine
  // credential can retrieve that SAME partial owner even if no result returned.
  this.#responseByCredential.set(credential,entry);this.#responses.add(entry);
  try{
   const frame=await this.#call('qualify',{requestOriginal:entry.requestOriginal,replayKey:entry.proofReplayKey,proofExpiresMS:entry.proofExpiresMS},entry);
   const result=decodeSocialPrincipalQualifiedOriginal(frame.original);
   if(result.profileOriginal!==this.#binding.profileOriginal||result.registrationOriginal!==this.#binding.registrationOriginal||result.requestOriginalSHA256!==createHash('sha256').update(entry.requestOriginal).digest('hex')||result.proofReplayKey!==entry.proofReplayKey||result.expiresMS>entry.proofExpiresMS||result.expiresMS>this.#binding.expiresMS)throw failure('SOCIAL_SOURCE_ORIGINAL_RESPONSE_CHANGED');
   entry.result=Object.freeze({...result});this.#completed.set(entry.result,entry);
   entry.assertCredential(credential);this.#live();await this.#call('current',{},entry);entry.assertCredential(credential);this.#live();return entry.result;
  }catch(error){if(!entry.firstPresent){entry.firstPresent=true;entry.first=error;}throw entry.first;}
 }
 async retainOriginalSocialDeviceDirectoryPrincipalResponseV4(credential,result){
  const entry=this.#responseByCredential.get(credential);
  if(!entry||(result!==null&&(entry.result!==result||this.#completed.get(result)!==entry)))return Object.freeze({owner:null,errorPresent:true,error:failure('SOCIAL_SOURCE_SAME_RESPONSE_REQUIRED')});
  if(!entry.loan)entry.loan=this.#makeResponseLoan(entry);
  const owner=entry.loan; // Adopt nonnull before interpreting any failure.
  try{await owner.current();return Object.freeze({owner,errorPresent:false});}
  catch(error){return Object.freeze({owner,errorPresent:true,error});}
 }
 #makeResponseLoan(entry){
  const remember=error=>{if(!entry.firstPresent){entry.firstPresent=true;entry.first=error;}};
  const paired=(physicalDone)=>Object.freeze({physicalDone,errorPresent:entry.firstPresent,...(entry.firstPresent?{error:entry.first}:{})});
  const live=()=>{if(entry.retired||entry.closed||entry.firstPresent)throw entry.firstPresent?entry.first:failure('SOCIAL_SOURCE_RESPONSE_RETIRED');if(entry.result===null)throw failure('SOCIAL_SOURCE_RESPONSE_NOT_READY');if(entry.sourceChild!==this.#child||!this.#responses.has(entry))throw failure('SOCIAL_SOURCE_RESPONSE_OWNER_CHANGED');if(Date.now()>=entry.result.expiresMS)throw failure('SOCIAL_SOURCE_RESPONSE_EXPIRED');};
  const run=async work=>{let entered=false;try{live();entry.inflight++;entered=true;const value=await work();live();return value;}catch(error){remember(error);throw entry.first;}finally{if(entered)entry.inflight--;}};
  const fence=async()=>{
   live();this.#live();
   const view=await entry.readCredential(entry.credential);live();this.#live();
   if(view.originalRequest!==entry.request||canonicalJSON(view.originalRequest)!==entry.requestOriginal||view.proofReplayKey!==entry.proofReplayKey||view.proofExpiresMS!==entry.proofExpiresMS)throw failure('SOCIAL_SOURCE_RESPONSE_REQUEST_CHANGED');
   await this.#call('current',{},entry);live();
   entry.assertCredential(entry.credential);this.#live();
   // Host completion is not a replacement for the foreign Source/current
   // owner. Recheck after the independent Host boundary before releasing DATA.
   await this.#call('current',{},entry);live();entry.assertCredential(entry.credential);this.#live();
  };
  const retire=()=>{entry.retired=true;};
  const join=async()=>{if(!entry.retired)throw failure('SOCIAL_SOURCE_RESPONSE_RETIRE_REQUIRED');if(entry.inflight!==0||this.#pending?.ownerDebt===entry)throw failure('SOCIAL_SOURCE_RESPONSE_JOIN_PENDING');};
  const close=async()=>{
   retire();if(entry.closed)return entry.closeResult;
   try{await join();}catch(error){remember(error);return paired(false);}
   // Actual release of this original response's single parent debt. No source,
   // SQLite nonce, global helper or another response is closed here.
   if(!this.#responses.delete(entry)){remember(failure('SOCIAL_SOURCE_RESPONSE_DEBT_CHANGED'));return paired(false);}
   entry.closed=true;entry.rawOriginal=null;entry.requestOriginal=null;entry.closeResult=paired(true);return entry.closeResult;
  };
  const copyRetained=async(which)=>{
   let original=entry[which]===null?null:Buffer.from(entry[which],'utf8');
   try{await run(async()=>{await fence();if(entry[which]===null)throw failure('SOCIAL_SOURCE_RESPONSE_ORIGINAL_NOT_SUPPLIED');original=Buffer.from(entry[which],'utf8');await fence();});return Object.freeze({original,errorPresent:false});}
   catch(error){remember(error);return Object.freeze({original,errorPresent:true,error:entry.first});}
  };
  return Object.freeze({
   current:()=>run(fence),
   copyOriginal:()=>copyRetained('rawOriginal'),
   copyRequestOriginal:()=>copyRetained('requestOriginal'),
   retire,join,close,isClosed:()=>entry.closed,
   statusDATA:()=>Object.freeze({retired:entry.retired,closed:entry.closed,inflight:entry.inflight,queryPending:this.#pending?.ownerDebt===entry,firstCausePresent:entry.firstPresent,firstCause:entry.first,originalRetained:entry.rawOriginal!==null,requestRetained:entry.requestOriginal!==null,RootAdmission:false,V4Authentication:false})
  });
 }
 assertOriginalSocialDeviceDirectoryPrincipalCompletionV4(credential,result){const same=this.#completed.get(result);if(!same||same.credential!==credential||same.result!==result||same.retired||same.closed||same.firstPresent||!this.#responses.has(same))throw same?.firstPresent?same.first:failure('SOCIAL_SOURCE_ORIGINAL_COMPLETION_REQUIRED');same.assertCredential(credential);this.#live();}
 retire(){this.#retired=true;}
 async join(){if(this.#pending)throw failure('SOCIAL_SOURCE_HELPER_ORIGINAL_QUERY_PENDING');await this.#queue;if(this.#pending||this.#responses.size!==0)throw failure('SOCIAL_SOURCE_RESPONSE_PARENT_DEBT_PENDING');}
 async #waitChildExit(){if(this.#childExited)return;let timer;try{await Promise.race([this.#exitPromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('SOCIAL_SOURCE_HELPER_CHILD_DRAIN_UNKNOWN')),7000);})]);}catch(e){this.#remember(e);throw e;}finally{clearTimeout(timer);}}
 async close(){this.retire();await this.join();if(this.#closed){if(this.#firstPresent)throw this.#first;return;}if(this.#child&&!this.#physicalDone){if(this.#childCloseSelected)throw this.#firstPresent?this.#first:failure('SOCIAL_SOURCE_HELPER_CLOSE_UNKNOWN');this.#childCloseSelected=true;try{await this.#call('close');}catch(e){this.#remember(e);if(!this.#physicalDone)throw e;}}if(this.#child&&!this.#physicalDone){this.#remember(failure('SOCIAL_SOURCE_HELPER_CLOSE_UNKNOWN'));throw this.#first;}if(this.#child){this.#child.stdin.end();await this.#waitChildExit();}for(let n=this.#publicFiles.length-1;n>=0;n--){const p=this.#publicFiles[n];if(p.fd!==null){if(p.closeSelected)throw this.#firstPresent?this.#first:failure('SOCIAL_SOURCE_PUBLIC_CLOSE_UNKNOWN');p.closeSelected=true;try{closeSync(p.fd);p.fd=null;}catch(e){this.#remember(e);throw e;}}}if(this.#fd!==null){if(this.#closeSelected)throw this.#firstPresent?this.#first:failure('SOCIAL_SOURCE_HELPER_IMAGE_CLOSE_UNKNOWN');this.#closeSelected=true;try{closeSync(this.#fd);this.#fd=null;}catch(e){this.#remember(e);throw e;}}this.#closed=true;retained.delete(this);if(this.#firstPresent)throw this.#first;}
 isClosed(){return this.#closed;}
}
// Seal trusted slots during module evaluation, before any owner can escape.
Object.freeze(OriginalSocialJointSourceService.prototype);
Object.freeze(OriginalSocialJointSourceService);
export function isOriginalSocialJointSourceService(owner){return originalSourceServices.has(owner);}
export function originalSocialJointSourceServiceConfiguredDATA(){return reviewedSocialProfileHelpers.length!==0;}
export async function acquireOriginalSocialJointSourceService(){if(arguments.length)throw failure('SOCIAL_SOURCE_HELPER_ZERO_ARGUMENTS');return OriginalSocialJointSourceService.acquireOriginal();}
