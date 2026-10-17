import {createPublicKey,createPrivateKey,sign,KeyObject,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,basename} from 'node:path';
import {readFileSync,lstatSync,openSync,constants,closeSync,fstatSync,realpathSync} from 'node:fs';
import {canonical,sha,originalSignatureContract,verifySourceEnrollment,verifySourceProfile,verifySourceTransitionOriginal} from '../native/original-auth-identity-source-verifier.mjs';

// PRIVATE Auth-current producer; a signature from this domain is NOT a Social
// floor/NativeCore domain, ordinary QA, SSO or a four-op account permission.
const requireNative=createRequire(import.meta.url),services=new WeakSet(),sourceServiceDebt=new Set();
const fail=code=>{throw Object.assign(new Error(code),{code});};
// Actual independently admitted service registrations are release-owned.
// No default root, key, caller provider, ENV override or enrollment is created.
const admittedSourceServices=Object.freeze([]);
const nonce=()=>randomBytes(32).toString('base64url');
function sameKey(privateKey,expected){return privateKey instanceof KeyObject&&privateKey.type==='private'&&privateKey.asymmetricKeyType==='ed25519'&&createPublicKey(privateKey).equals(expected);}
function publicFile(path,digest){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{
  const before=fstatSync(fd),named=lstatSync(path);if(!before.isFile()||before.nlink!==1||(before.mode&0o022)||before.dev!==named.dev||before.ino!==named.ino||before.size<1||before.size>32768)fail('AUTH_SOURCE_PUBLIC_ORIGINAL_INVALID');
  const raw=readFileSync(fd,'utf8'),after=fstatSync(fd),end=lstatSync(path);if(sha(raw)!==digest||before.dev!==end.dev||before.ino!==end.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('AUTH_SOURCE_PUBLIC_ORIGINAL_CHANGED');return raw;
 }finally{closeSync(fd);}
}
const signed=(body,key,policy)=>canonical({body,signature:sign(null,Buffer.from(originalSignatureContract(policy).currentFrame+canonical(body)),key).toString('base64url')});

// Kernel is testable CODE, not an enrollment factory. Production mounting
// accepts only instances branded by the fixed release-selection factory below.
export class OriginalAuthSourceCurrentKernel {
 #root;#enrollment;#policy;#key;#profiles=new Map();#io;#loan;#rows=new Map();#retired=false;#entered=false;#unknown=false;#first;#firstPresent=false;#closing=false;#closed=false;#cleanupCause;#cleanupCausePresent=false;#clockFloor=0;#clock;#nonces=new Map();
 constructor(rootRaw,enrollmentRaw,profiles,privateKey,policy,nativeIO,now,clock=Date.now){
  if(typeof clock!=='function')fail('AUTH_SOURCE_CURRENT_CLOCK_UNAVAILABLE');this.#clock=clock;
  this.#root=rootRaw;this.#enrollment=enrollmentRaw;this.#policy=Object.freeze({...policy,signatureContract:Object.freeze({...policy.signatureContract})});this.#key=privateKey;this.#io=nativeIO;
  const role=verifySourceEnrollment(rootRaw,enrollmentRaw,policy,now);if(!sameKey(privateKey,role.currentKey))fail('AUTH_SOURCE_CURRENT_KEY_NOT_SUPPLIED');
  for(const raw of profiles){const p=verifySourceProfile(rootRaw,enrollmentRaw,raw,policy,now);const digest=sha(raw);if(this.#profiles.has(digest))fail('AUTH_SOURCE_PROFILE_DUPLICATE');this.#profiles.set(digest,{raw,body:p.profile});}
  if(this.#profiles.size===0||this.#profiles.size>32)fail('AUTH_SOURCE_PROFILES_NOT_SUPPLIED');
  // Caller retains this object before initialize() can acquire partial IO.
 }
 #remember(cause){this.#unknown=true;if(!this.#firstPresent){this.#firstPresent=true;this.#first=cause;}}
 #time(now){if(!Number.isSafeInteger(now)||now<0||now<this.#clockFloor)fail('AUTH_SOURCE_CURRENT_CLOCK_ROLLBACK');this.#clockFloor=now;return now;}
 #check(now){if(this.#retired||this.#unknown)fail('AUTH_SOURCE_CURRENT_UNRESOLVED');this.#time(now);verifySourceEnrollment(this.#root,this.#enrollment,this.#policy,now);if(this.#io.ready(this.#loan)!==undefined)fail('AUTH_SOURCE_CURRENT_CUSTODY_CHANGED');}
 initialize(now){
  if(this.#loan||this.#unknown)fail('AUTH_SOURCE_CURRENT_ALREADY_SELECTED');
  try{
   const role=verifySourceEnrollment(this.#root,this.#enrollment,this.#policy,this.#time(now));
   this.#loan=this.#io.open(dirname(role.body.currentStatePath),basename(role.body.currentStatePath));this.#check(now);
   const names=this.#io.list(this.#loan);if(!Array.isArray(names)||names.length>128||new Set(names).size!==names.length)fail('AUTH_SOURCE_CURRENT_HISTORY_INVALID');
   const events=[];
   for(const name of names){if(!/^[a-f0-9]{64}\.(entered|terminal)$/.test(name))fail('AUTH_SOURCE_CURRENT_HISTORY_INVALID');if(!name.endsWith('.entered'))continue;
    const key=name.slice(0,64);if(!names.includes(key+'.terminal'))fail('AUTH_SOURCE_CURRENT_COLD_UNKNOWN');
    const eventRaw=this.#io.read(this.#loan,name),terminalRaw=this.#io.read(this.#loan,key+'.terminal');let event,terminal;try{event=JSON.parse(eventRaw);terminal=JSON.parse(terminalRaw);}catch{fail('AUTH_SOURCE_CURRENT_HISTORY_INVALID');}
    if(canonical(event)!==eventRaw||canonical(terminal)!==terminalRaw||terminal.eventDigest!==sha(eventRaw)||Object.keys(terminal).sort().join('|')!=='eventDigest|version'||terminal.version!==1)fail('AUTH_SOURCE_CURRENT_HISTORY_INVALID');
    const profile=this.#profiles.get(event.profileDigest);if(!profile||Object.keys(event).sort().join('|')!=='currentRaw|previousDigest|profileDigest|version'||event.version!==1)fail('AUTH_SOURCE_CURRENT_HISTORY_INVALID');
    const statement=JSON.parse(event.currentRaw).body;
    // Old journal statement proves original signed transition, NOT freshness.
    const projection=verifySourceTransitionOriginal(this.#root,this.#enrollment,profile.raw,event.currentRaw,this.#policy,statement.nonce,{sequence:0,floor:0,head:'',timeFloor:0},statement.issuedAtMs);
    if(sha(canonical({profileDigest:event.profileDigest,sequence:projection.sequence}))!==key)fail('AUTH_SOURCE_CURRENT_HISTORY_INVALID');events.push({eventRaw,event,projection,statement});
   }
   if(names.length!==events.length*2)fail('AUTH_SOURCE_CURRENT_COLD_UNKNOWN');events.sort((a,b)=>a.projection.sequence-b.projection.sequence);
   for(const row of events){const old=this.#rows.get(row.event.profileDigest),profile=this.#profiles.get(row.event.profileDigest);if(row.projection.sequence!==(old?old.sequence+1:profile.body.minimumSequence)||row.event.previousDigest!==(old?.recordDigest??'')||old&&(row.projection.floor<old.floor||old.status!=='active'&&row.statement.status!==old.status))fail('AUTH_SOURCE_CURRENT_HISTORY_ROLLBACK');this.#rows.set(row.event.profileDigest,{...row.projection,status:row.statement.status,recordDigest:sha(row.eventRaw)});}
   this.#check(this.#clock());return undefined;
  }catch(cause){this.#remember(cause);throw cause;}
 }
 // Protected admin caller only, never an HTTP mutation endpoint. Every state
 // transition is signed by the already-enrolled current key and fsync/read back
 // before a nonce-bound current statement can be returned.
 transition(profileDigest,{status,floor,head},now){
  if(this.#entered)fail('AUTH_SOURCE_CURRENT_REENTRANT');this.#entered=true;
  try{
   this.#check(now);const profile=this.#profiles.get(profileDigest);if(!profile)fail('AUTH_SOURCE_PROFILE_NOT_REGISTERED');verifySourceProfile(this.#root,this.#enrollment,profile.raw,this.#policy,now);
   const old=this.#rows.get(profileDigest),sequence=old?old.sequence+1:profile.body.minimumSequence;
   if(!['active','revoked','retired'].includes(status)||!Number.isSafeInteger(floor)||floor<Math.max(profile.body.minimumFloor,old?.floor??0)||floor>sequence||sequence<profile.body.minimumSequence||!/^[a-f0-9]{64}$/.test(head)||old&&old.status!=='active'&&status!==old.status)fail('AUTH_SOURCE_CURRENT_TRANSITION_INVALID');
   const current=this.#body(profileDigest,profile.body,{status,floor,sequence,head},nonce(),now),event={version:1,profileDigest,previousDigest:old?.recordDigest??'',currentRaw:signed(current,this.#key,this.#policy)};
   const raw=canonical(event),key=sha(canonical({profileDigest,sequence}));if(Buffer.byteLength(raw)>8192)fail('AUTH_SOURCE_CURRENT_CAPACITY');
   this.#unknown=true; // Before first write/signature can escape as a result.
   this.#io.write(this.#loan,key+'.entered',raw);this.#io.write(this.#loan,key+'.terminal',canonical({version:1,eventDigest:sha(raw)}));
   if(this.#io.read(this.#loan,key+'.entered')!==raw||this.#io.read(this.#loan,key+'.terminal')!==canonical({version:1,eventDigest:sha(raw)}))fail('AUTH_SOURCE_CURRENT_READBACK_UNKNOWN');
   this.#unknown=false;const post=this.#clock();this.#check(post);if(post>=current.expiresAtMs)fail('AUTH_SOURCE_CURRENT_EXPIRED');this.#rows.set(profileDigest,{sequence,floor,head,status,recordDigest:sha(raw)});return undefined;
  }catch(cause){this.#remember(cause);throw cause;}finally{this.#entered=false;}
 }
 #body(profileDigest,profile,state,challenge,now){const role=verifySourceEnrollment(this.#root,this.#enrollment,this.#policy,now).body;return {version:1,purpose:originalSignatureContract(this.#policy).purpose,sourceId:profile.sourceId,enrollmentDigest:this.#policy.enrollmentDigest,profileDigest,instanceId:profile.instanceId,generation:profile.generation,sequence:state.sequence,floor:state.floor,head:state.head,status:state.status,nonce:challenge,issuedAtMs:now,expiresAtMs:Math.min(now+30000,profile.expiresAtMs,role.expiresAtMs)};}
 current(profileDigest,challenge,now){
  if(typeof challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(challenge)||Buffer.from(challenge,'base64url').toString('base64url')!==challenge)fail('AUTH_SOURCE_CURRENT_NONCE_INVALID');
  const profile=this.#profiles.get(profileDigest),state=this.#rows.get(profileDigest);if(!profile||!state)fail('AUTH_SOURCE_PROFILE_NOT_REGISTERED');
  for(const [key,time] of this.#nonces)if(now-time>=30000)this.#nonces.delete(key);
  const nonceKey=profileDigest+':'+challenge;if(this.#nonces.has(nonceKey)||this.#nonces.size>=4096)fail('AUTH_SOURCE_CURRENT_RATE_OR_REPLAY_REFUSED');
  if(this.#entered)fail('AUTH_SOURCE_CURRENT_REENTRANT');this.#entered=true;
  try{
   this.#check(now);this.#nonces.set(nonceKey,now);verifySourceProfile(this.#root,this.#enrollment,profile.raw,this.#policy,now);
   const key=sha(canonical({profileDigest,sequence:state.sequence})),raw=this.#io.read(this.#loan,key+'.entered'),terminal=this.#io.read(this.#loan,key+'.terminal');
   if(sha(raw)!==state.recordDigest||terminal!==canonical({version:1,eventDigest:state.recordDigest}))fail('AUTH_SOURCE_CURRENT_HISTORY_CHANGED');
   const body=this.#body(profileDigest,profile.body,state,challenge,now),signedRaw=signed(body,this.#key,this.#policy);const post=this.#clock();this.#check(post);if(post>=body.expiresAtMs)fail('AUTH_SOURCE_CURRENT_EXPIRED');return signedRaw;
  }catch(cause){this.#remember(cause);throw cause;}finally{this.#entered=false;}
 }
 retire(){this.#retired=true;}
 join(){if(!this.#retired||this.#entered)fail('AUTH_SOURCE_CURRENT_JOIN_PENDING');}
 close(){
  if(this.#closing){if(this.#cleanupCausePresent)throw this.#cleanupCause;if(!this.#closed)fail('AUTH_SOURCE_CURRENT_CLOSE_UNKNOWN');return;}
  this.retire();this.join();this.#closing=true;
  try{if(this.#loan&&this.#io.close(this.#loan)!==undefined)fail('AUTH_SOURCE_CURRENT_CLOSE_UNKNOWN');this.#closed=true;if(!this.#unknown)sourceServiceDebt.delete(this);}
  catch(cause){this.#cleanupCausePresent=true;this.#cleanupCause=cause;this.#remember(cause);throw cause;}
 }
 status(){return Object.freeze({unknown:this.#unknown,firstCausePresent:this.#firstPresent,firstCause:this.#first,closed:this.#closed,cleanupCausePresent:this.#cleanupCausePresent,cleanupCause:this.#cleanupCause});}
}
export function acquireOriginalAuthSourceCurrentService(sourceId,protectedSigningKey,now=Date.now()){
 const entry=admittedSourceServices.find(value=>value.sourceId===sourceId);if(!entry)fail('AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_SUPPLIED');
 const rootRaw=publicFile(entry.rootPath,entry.policy.rootDigest),enrollmentRaw=publicFile(entry.enrollmentPath,entry.policy.enrollmentDigest),profiles=entry.profiles.map(value=>publicFile(value.path,value.sha256));
 const io=requireNative(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-source-current-dirfd.node',import.meta.url)));
 const kernel=new OriginalAuthSourceCurrentKernel(rootRaw,enrollmentRaw,profiles,protectedSigningKey,entry.policy,io,now);
 // Return partial owner BEFORE any IO acquisition. Normal caller invokes
 // initialize, captures error and closes the SAME kernel; never auto-retries.
 services.add(kernel);sourceServiceDebt.add(kernel);return kernel;
}
// Normal daemon startup only. No ENV/key generator/default identity. With no
// independently admitted release row it returns null BEFORE any key read.
export function loadOriginalAuthSourceCurrentService(){
 if(admittedSourceServices.length===0)return null;if(admittedSourceServices.length!==1)fail('AUTH_SOURCE_CURRENT_RELEASE_AMBIGUOUS');
 const entry=admittedSourceServices[0],now=Date.now();
 const rootRaw=publicFile(entry.rootPath,entry.policy.rootDigest),enrollmentRaw=publicFile(entry.enrollmentPath,entry.policy.enrollmentDigest),role=verifySourceEnrollment(rootRaw,enrollmentRaw,entry.policy,now);
 if(typeof entry.keyPath!=='string'||realpathSync(entry.keyPath)!==entry.keyPath)fail('AUTH_SOURCE_CURRENT_KEY_NOT_SUPPLIED');
 const parent=lstatSync(dirname(entry.keyPath));if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o077))fail('AUTH_SOURCE_CURRENT_KEY_NOT_SUPPLIED');
 const fd=openSync(entry.keyPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let raw,key;
 try{const a=fstatSync(fd),named=lstatSync(entry.keyPath);if(!a.isFile()||a.nlink!==1||a.uid!==process.getuid()||(a.mode&0o077)||a.size<1||a.size>4096||a.dev!==named.dev||a.ino!==named.ino)fail('AUTH_SOURCE_CURRENT_KEY_NOT_SUPPLIED');raw=readFileSync(fd);const end=fstatSync(fd),path=lstatSync(entry.keyPath);if(a.dev!==path.dev||a.ino!==path.ino||a.size!==end.size||a.mtimeMs!==end.mtimeMs||a.ctimeMs!==end.ctimeMs)fail('AUTH_SOURCE_CURRENT_KEY_CHANGED');key=createPrivateKey({key:raw,format:'der',type:'pkcs8'});if(!sameKey(key,role.currentKey))fail('AUTH_SOURCE_CURRENT_KEY_MISMATCH');}
 finally{raw?.fill(0);closeSync(fd);}
 const service=acquireOriginalAuthSourceCurrentService(entry.sourceId,key,now);
 try{service.initialize(now);return service;}catch(cause){
  // Return same cleanup owner alongside the first failure to original main.
  return Object.freeze({partial:service,error:cause});
 }
}
export function handleOriginalAuthSourceCurrent(service,method,url,now=Date.now()){
 if(!services.has(service))fail('AUTH_SOURCE_CURRENT_SERVICE_NOT_CONFIGURED');
 const parsed=new URL(url,'https://wallet-auth.ynxweb4.com');if(method!=='GET'||parsed.origin!=='https://wallet-auth.ynxweb4.com'||parsed.pathname!=='/v1/auth-identity/source-current'||parsed.hash||[...parsed.searchParams.keys()].sort().join('|')!=='nonce|profile')fail('AUTH_SOURCE_CURRENT_REQUEST_INVALID');
 return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:service.current(parsed.searchParams.get('profile'),parsed.searchParams.get('nonce'),now)};
}
