// MAIN-ONLY original initial Source factory. No endpoint/pin/Genesis/approved
// DTO is accepted from IPC. Only independently release-admitted literal rows
// may select an operator and original Genesis. Ordinary TX Source is separate.
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {openSync,fstatSync,lstatSync,readSync,closeSync,constants} from 'node:fs';
import {dirname,isAbsolute,normalize} from 'node:path';
import {performance} from 'node:perf_hooks';
import {types} from 'node:util';
import {bindAccountInitialPermissionRequest} from './account-initial-permission-kernel.mjs';
import {inspectCometOperatorProjection} from './comet-projection.mjs';
import {captureAuthorizationHTTPOriginal} from './operator-policy-original.mjs';
import {decodePQAccountInitialRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const sha=b=>createHash('sha256').update(b).digest('hex');
// Empty until ORIGINAL Root/Protocol ops independently admits a new epoch's
// exact protected Genesis/pin and operator identity. CODE fixtures do not add
// production rows. Do not copy the old 65efa operator/old asset policy here.
const admittedAccountInitialReleases=Object.freeze([]);
const branded=new WeakSet();
export const isOriginalWalletAccountInitialSource=v=>branded.has(v);
function same(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.gid===b.gid&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
function parents(path){
 if(!isAbsolute(path)||normalize(path)!==path||/[\x00\r\n]/.test(path))fail('AUTH_INITIAL_SOURCE_PATH');
 for(let p=dirname(path);;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.mode&0o022||![0,process.getuid()].includes(s.uid))fail('AUTH_INITIAL_SOURCE_PARENT');if(p===dirname(p))break;}
}
function checkGenesis(s){
 parents(s.release.genesis.path);const original=s.genesisStat,held=fstatSync(s.fd),named=lstatSync(s.release.genesis.path);
 if(!held.isFile()||named.isSymbolicLink()||held.nlink!==1||!same(original,held)||!same(held,named))fail('AUTH_INITIAL_SOURCE_GENESIS_CHANGED');
 const out=Buffer.alloc(s.release.genesis.bytes);let n=0;while(n<out.length){const got=readSync(s.fd,out,n,out.length-n,n);if(!got)fail('AUTH_INITIAL_SOURCE_GENESIS_CHANGED');n+=got;}
 if(sha(out)!==s.release.genesis.sha256||!same(held,fstatSync(s.fd))||!same(held,lstatSync(s.release.genesis.path)))fail('AUTH_INITIAL_SOURCE_GENESIS_CHANGED');return out;
}
function window(s){
 const wall=Date.now(),mono=performance.now();if(s.retired||s.closed||s.firstPresent)throw s.firstPresent?s.first:Error('AUTH_INITIAL_SOURCE_RETIRED');
 if(!Number.isSafeInteger(wall)||wall<s.wallFloor||mono<s.monoFloor||wall>=s.expires||mono>=s.monoDeadline)fail('AUTH_INITIAL_SOURCE_EXPIRED');s.wallFloor=wall;s.monoFloor=mono;
}
function remember(s,e){if(!s.firstPresent){s.firstPresent=true;s.first=e;}return e;}
function selectedRelease(request){
 const rows=admittedAccountInitialReleases.filter(r=>r.networkId===request.networkId);
 if(rows.length!==1)fail('AUTH_INITIAL_SOURCE_ADMITTED_EPOCH_REQUIRED');
 const r=rows[0],g=r.genesis;
 if(r.kind!=='YNX-WALLET-ACCOUNT-INITIAL-SOURCE/v1'||typeof r.sourceId!=='string'||!r.sourceId||r.nativeChainId!=='6423'||!r.rootAdmissionSHA256?.match(/^[a-f0-9]{64}$/)||r.origin!=='https://rpc.ynxweb4.com'||!r.spkiSHA256?.match(/^[a-f0-9]{64}$/)||!g||!Number.isSafeInteger(g.bytes)||g.bytes<1||g.bytes>8<<20||!g.sha256?.match(/^[a-f0-9]{64}$/)||!Number.isInteger(g.uid)||!Number.isInteger(g.gid)||!Number.isInteger(g.mode)||g.mode&0o022)fail('AUTH_INITIAL_SOURCE_RELEASE_INVALID');
 return r;
}
function getAccount(s){
 window(s);const deadline=Math.max(1,Math.min(5000,s.expires-Date.now()));
 return new Promise((resolve,reject)=>{
  let done=false,size=0,timer;const chunks=[];const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(v);};
  const q=httpsRequest(new URL('/accounts/'+s.request.account+'/authorization',s.release.origin),{method:'GET',agent:false,signal:s.controller.signal,rejectUnauthorized:true,headers:{accept:'application/json','cache-control':'no-cache'},checkServerIdentity(host,cert){
   const error=checkServerIdentity(host,cert);if(error)return error;
   try{if(sha(new X509Certificate(cert.raw).publicKey.export({format:'der',type:'spki'}))!==s.release.spkiSHA256)return Error('AUTH_INITIAL_SOURCE_TLS_PIN');}catch{return Error('AUTH_INITIAL_SOURCE_TLS_PIN');}
  }},response=>{
   const type=String(response.headers['content-type']??'').split(';')[0].trim().toLowerCase(),noStore=String(response.headers['cache-control']??'').toLowerCase().split(',').some(v=>v.trim()==='no-store');
   if(response.statusCode!==200||type!=='application/json'||!noStore){response.destroy();finish(Error('AUTH_INITIAL_SOURCE_HTTP'));return;}
   response.on('data',b=>{size+=b.length;if(size>8<<20){response.destroy();finish(Error('AUTH_INITIAL_SOURCE_SIZE'));}else chunks.push(b);});response.on('error',e=>finish(e));response.on('aborted',()=>finish(Error('AUTH_INITIAL_SOURCE_ABORTED')));
   response.on('end',()=>{try{window(s);finish(null,new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));}catch(e){finish(e);}});
  });
  timer=setTimeout(()=>{finish(Error('AUTH_INITIAL_SOURCE_TIMEOUT'));q.destroy();},deadline);q.on('error',e=>finish(e));q.end();
 });
}
function bindOccupancy(s,text){
 const raw=captureAuthorizationHTTPOriginal(text),view=inspectCometOperatorProjection(raw.body,s.request.account,s.request.networkId),a=view.authorization;
 // Empty ORIGINAL committed record set + same response nonce/H. Not an active
 // policy stub and not a404/zero-filled owner synthesized from an error body.
 if(!a.enabled||a.records.length!==0||a.ledgerNonce!=='0'||view.nextView.authorizationStatus!=='legacy'||view.nextView.pqSigningEnabled||view.committedView.pqSigningEnabled||a.revocations?.length||BigInt(a.executionHeight)<=0n||BigInt(s.request.intent.activateAt)<=BigInt(a.executionHeight))fail('AUTH_INITIAL_SOURCE_OWNER_NOT_UNUSED');
 if(s.request.action==='broadcast'&&s.request.executionHeight!==a.executionHeight)fail('AUTH_INITIAL_SOURCE_ORIGINAL_HEIGHT_CHANGED');
 return {text,occupancy:Object.freeze({chainId:s.request.networkId,owner:s.request.account,executionHeight:a.executionHeight,registered:false,ledgerNonce:'0'}),observation:view.observation};
}
export async function acquireOriginalWalletAccountInitialSource(value,originalMember=null){
 const s={request:null,release:null,fd:null,genesisStat:null,genesis:null,occupancy:null,observation:null,raw:null,member:null,wallFloor:Date.now(),monoFloor:performance.now(),expires:0,monoDeadline:0,controller:new AbortController(),pending:new Set(),retired:false,closed:false,firstPresent:false,first:undefined,joining:null,closing:null};
 const assert=()=>{try{window(s);if(s.fd===null||!s.occupancy)fail('AUTH_INITIAL_SOURCE_NOT_READY');checkGenesis(s);}catch(e){throw remember(s,e);}};
 const read=()=>{assert();const result={genesisBytes:Uint8Array.from(s.genesis),genesisSHA256:s.release.genesis.sha256,executionHeight:s.occupancy.executionHeight,occupancy:s.occupancy,memberBytes:s.member?Uint8Array.from(s.member):null};assert();return result;};
 const refresh=async()=>{window(s);checkGenesis(s);const fresh=bindOccupancy(s,await getAccount(s));window(s);checkGenesis(s);if(s.raw!==null&&fresh.text!==s.raw)fail('AUTH_INITIAL_SOURCE_REVIEW_CHANGED');s.raw=fresh.text;s.occupancy=fresh.occupancy;s.observation=fresh.observation;};
 const track=fn=>{const p=Promise.resolve().then(fn).catch(e=>{throw remember(s,e);});s.pending.add(p);void p.then(()=>s.pending.delete(p),()=>s.pending.delete(p));return p;};
 const owner=Object.freeze({
  assertCurrent:assert,readOriginal:read,recheck:()=>track(refresh),
  copyOriginalGenesisBytes(){assert();const v=Uint8Array.from(s.genesis);assert();return v;},
  observation(){assert();return s.observation;},
  retire(){s.retired=true;s.controller.abort();},
  join(){if(!s.joining)s.joining=Promise.resolve().then(async()=>{await Promise.allSettled([...s.pending]);});return s.joining;},
  close(){
   if(s.closing)return s.closing;s.retired=true;s.controller.abort();
   s.closing=Promise.resolve().then(async()=>{await owner.join();if(s.fd!==null){const fd=s.fd;closeSync(fd);s.fd=null;}s.closed=true;});void s.closing.catch(()=>{});return s.closing;
  },
  outcome:()=>Object.freeze({firstCausePresent:s.firstPresent,firstCause:s.first,closed:s.closed,sourceId:s.release?.sourceId??null,independentFinality:false,effectRetryAuthorized:false}),
 });
 try{
  s.request=bindAccountInitialPermissionRequest(value);s.release=selectedRelease(s.request);const now=Date.now();s.expires=Math.min(Date.parse(s.request.expiresAt),now+30000);s.monoDeadline=s.monoFloor+Math.max(0,s.expires-now);
  if(now<Date.parse(s.request.createdAt)||now>=s.expires)fail('AUTH_INITIAL_SOURCE_EXPIRED');
  const g=s.release.genesis;parents(g.path);s.fd=openSync(g.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC);s.genesisStat=fstatSync(s.fd);
  const stat=s.genesisStat;if(!stat.isFile()||stat.nlink!==1||stat.size!==g.bytes||stat.uid!==g.uid||stat.gid!==g.gid||(stat.mode&0o777)!==g.mode)fail('AUTH_INITIAL_SOURCE_GENESIS_TUPLE');s.genesis=checkGenesis(s);
  if(s.request.action==='sign'){if(originalMember!==null)fail('AUTH_INITIAL_SOURCE_UNEXPECTED_MEMBER');}
  else{
   if(!originalMember||types.isProxy(originalMember)||!types.isUint8Array(originalMember)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(originalMember)))fail('AUTH_INITIAL_SOURCE_MEMBER_REQUIRED');
   const proto=Object.getPrototypeOf(Uint8Array.prototype),b=Object.getOwnPropertyDescriptor(proto,'buffer').get.call(originalMember),n=Object.getOwnPropertyDescriptor(proto,'byteLength').get.call(originalMember),o=Object.getOwnPropertyDescriptor(proto,'byteOffset').get.call(originalMember);
   if(types.isSharedArrayBuffer(b)||!n||n>98304)fail('AUTH_INITIAL_SOURCE_MEMBER_REQUIRED');s.member=Buffer.from(new Uint8Array(b,o,n));
   const d=decodePQAccountInitialRequest(s.member,{chainId:s.request.networkId,owner:s.request.account,pkA:s.request.intent.pkA,pkB:s.request.intent.pkB,executionHeight:s.request.executionHeight});if(sha(d.intentBytes)!==s.request.requestDigest||d.transportHash!==s.request.transportHash||d.abciTransactionHash!==s.request.abciTransactionHash)fail('AUTH_INITIAL_SOURCE_MEMBER_CHANGED');
  }
  await track(refresh);assert();branded.add(owner);return owner;
 }catch(cause){remember(s,cause);const e=Object.assign(Error('AUTH_WALLET_INITIAL_SOURCE_NOT_SUPPLIED',{cause}),{code:'AUTH_WALLET_INITIAL_SOURCE_NOT_SUPPLIED'});Object.defineProperty(e,'partial',{value:owner});throw e;}
}
