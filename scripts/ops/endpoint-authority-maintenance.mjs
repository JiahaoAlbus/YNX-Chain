// Controlled upkeep for one independently reviewed, fixed deployed source map.
// No user grants, root/key rollover, relaxed expiry, or stored receipt replay.
import fs from 'node:fs/promises';
import {constants,fstatSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalAuthorityV2,assertAuthorityV2TrustRoot,assertAuthorityV2IssuancePolicy,verifySignedEndpointAuthority} from '../../sdk/js/endpoint-authority-v2.js';
import {prepareAuthorityV2Draft,issueAuthorityV2,authorityV2Doctor} from './endpoint-authority-v2.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>canonicalAuthorityV2(a)===canonicalAuthorityV2(b);
const requireFact=(ok,code)=>{if(!ok)throw new Error(code)};
const jsonBytes=x=>Buffer.from(canonicalAuthorityV2(x)+'\n');
export async function prepareFixedSourceRenewal({baseline,root,checkpoint,policy,facts,nowMs}){
 const trust=assertAuthorityV2TrustRoot(root);requireFact(policy.rootSHA256===facts.rootSHA256,'MAINTENANCE_ROOT_CHANGED');
 requireFact(Number.isSafeInteger(nowMs)&&nowMs>=Date.parse(baseline.issuedAt),'MAINTENANCE_CLOCK');
 // Historical cryptographic authentication is separate from current authorization:
 // the expired baseline is never accepted by a live consumer or used as a grant.
 await verifySignedEndpointAuthority(baseline,{trustRoot:trust,checkpoint,consumer:policy.consumer,nowMs:Date.parse(baseline.issuedAt)});
 requireFact(sha(canonicalAuthorityV2(nonRenewalProjection(baseline)))===policy.nonRenewalPayloadSHA256,'MAINTENANCE_NON_RENEWAL_POLICY_CHANGED');
 requireFact(baseline.integrity.keyId===policy.signingKeyId,'MAINTENANCE_SIGNING_KEY_CHANGED');
 requireFact(Number.isSafeInteger(policy.validitySeconds)&&policy.validitySeconds>0&&policy.validitySeconds<=trust.maxValiditySeconds&&policy.validitySeconds*1000<=Date.parse(baseline.expiresAt)-Date.parse(baseline.issuedAt),'MAINTENANCE_VALIDITY_POLICY');
 requireFact(same(baseline.issuerSource,policy.nodeSource)&&same(baseline.products.finance.evidence.source,policy.webSource),'MAINTENANCE_TEMPLATE_SOURCE');
 requireFact(checkpoint.rootVersion===trust.rootVersion&&checkpoint.sequence===baseline.sequence&&checkpoint.payloadSha256===baseline.integrity.payloadSha256,'MAINTENANCE_CHECKPOINT_CONFLICT');
 requireFact(facts.health.observation.httpStatus===200&&facts.version.observation.httpStatus===200&&facts.financeHealth.observation.httpStatus===200,'MAINTENANCE_HEALTH_FAILED');
 requireFact(JSON.parse(facts.version.body).build.sourceCommit===policy.nodeSource.commit&&JSON.parse(facts.financeHealth.body).build.commit===policy.financeBinarySource.commit,'MAINTENANCE_RUNTIME_SOURCE_CHANGED');
 requireFact(facts.assets.length===policy.assets.length&&facts.assets.every((a,i)=>a.httpStatus===200&&a.bodySha256===policy.assets[i].sha256&&a.url===policy.assets[i].url&&a.byteLength===policy.assets[i].size),'MAINTENANCE_PUBLIC_ASSET_CHANGED');
 const issuedAt=new Date(nowMs).toISOString(),expiresAt=new Date(nowMs+policy.validitySeconds*1000).toISOString();
 const g={schemaVersion:'ynx-endpoint-observation/v2',endpoint:'walletGateway',chainId:6423,source:policy.nodeSource,health:facts.health,version:facts.version,controlledReleaseAccepted:true,reviewedFixedSourcePolicySHA256:policy.policySHA256};
 const acceptance={...baseline.products.finance.evidence,observedAt:issuedAt};delete acceptance.receiptSha256;
 const f={schemaVersion:'ynx-finance-public-acceptance/v2',acceptance,binaryRuntime:{source:policy.financeBinarySource,health:facts.financeHealth.observation},currentPublicAssets:facts.assets,reviewedFixedSourcePolicySHA256:policy.policySHA256,officialSandboxVerified:false,providerVerified:false,productionApproved:false,publicUserVerified:false,currentOwnedServicesVerified:false,scope:'previously independently accepted source-and-product-session-contract-only; fresh fixed-source observations'};
 const gatewayBytes=jsonBytes(g),financeBytes=jsonBytes(f),m=structuredClone(baseline);m.sequence=checkpoint.sequence+1;m.manifestVersion=`2.0.0.${m.sequence}`;m.previousPayloadSha256=checkpoint.payloadSha256;m.issuedAt=issuedAt;m.expiresAt=expiresAt;
 m.endpoints.walletGateway.evidence={source:policy.nodeSource,chainId:6423,health:facts.health.observation,version:facts.version.observation,receiptSha256:sha(gatewayBytes)};m.products.finance.evidence={...acceptance,receiptSha256:sha(financeBytes)};
 const draft=prepareAuthorityV2Draft(m,baseline.integrity.keyId);assertAuthorityV2IssuancePolicy(draft,{trustRoot:trust,checkpoint,consumer:policy.consumer,nowMs});
 return{draft,receipts:[{sha256:sha(gatewayBytes),bytes:gatewayBytes},{sha256:sha(financeBytes),bytes:financeBytes}]};
}
/** Exact renewal exclusions. Source, scopes, all other products/endpoints and flags remain pinned. */
export function nonRenewalProjection(baseline){
 const m=structuredClone(baseline);
 for(const key of ['sequence','manifestVersion','previousPayloadSha256','issuedAt','expiresAt'])delete m[key];
 m.integrity={algorithm:m.integrity.algorithm,keyId:m.integrity.keyId};
 const gateway=m.endpoints.walletGateway.evidence;for(const key of ['health','version','receiptSha256'])delete gateway[key];
 delete m.products.finance.evidence.observedAt;delete m.products.finance.evidence.receiptSha256;
 return m;
}
export async function readFreshHTTPS(url,{pin,fetchImpl=fetch,now=Date.now,timeoutMs=12000}={}){
 requireFact(new URL(url).protocol==='https:','MAINTENANCE_HTTPS_REQUIRED');
 const limit=pin?.size??131072;requireFact(Number.isSafeInteger(limit)&&limit>0&&limit<=33554432,'MAINTENANCE_ASSET_SIZE_PIN');
 if(pin)requireFact(pin.url===url&&/^[a-f0-9]{64}$/.test(pin.sha256),'MAINTENANCE_ASSET_PIN');
 requireFact(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=12000,'MAINTENANCE_HTTP_TIMEOUT_BOUND');
 const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs),cache:'no-store'});
 requireFact(r.body&&typeof r.body.getReader==='function','MAINTENANCE_STREAM_REQUIRED');
 const reader=r.body.getReader(),hash=createHash('sha256'),chunks=[];let size=0,complete=false;
 try{
  const declared=r.headers?.get('content-length');if(declared!==null&&declared!==undefined)requireFact(/^\d+$/.test(declared)&&Number(declared)<=limit,'MAINTENANCE_RESPONSE_TOO_LARGE');
  while(true){const {value,done}=await reader.read();if(done){complete=true;break}size+=value.byteLength;requireFact(size<=limit,'MAINTENANCE_RESPONSE_TOO_LARGE');hash.update(value);if(!pin)chunks.push(Buffer.from(value));}
  const digest=hash.digest('hex');if(pin)requireFact(size===pin.size&&digest===pin.sha256,'MAINTENANCE_PUBLIC_ASSET_CHANGED');
  return{body:pin?undefined:Buffer.concat(chunks).toString('utf8'),byteLength:size,observation:{url,httpStatus:r.status,bodySha256:digest,observedAt:new Date(now()).toISOString(),tlsVerified:true,directDNS:true}};
 }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export async function protectedFile(file,uid=0){requireFact(path.isAbsolute(file)&&await fs.realpath(file)===file,'MAINTENANCE_FILE_PATH');const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();requireFact(s.isFile()&&s.nlink===1&&s.uid===uid&&(s.mode&0o777)===0o600&&s.size<=1048576,'MAINTENANCE_FILE_PERMISSIONS');const bytes=await h.readFile();requireFact(bytes.length===s.size,'MAINTENANCE_FILE_CHANGED');return bytes}finally{await h.close()}}
// Only executable/import-closure pins use this ceiling; JSON and HTTP limits stay small.
export const HOST_BINARY_MAX_BYTES=134217728;
export async function verifyPinnedHostBytes(handle,pin){
 requireFact(Number.isSafeInteger(pin.size)&&pin.size>0&&pin.size<=HOST_BINARY_MAX_BYTES&&/^[a-f0-9]{64}$/.test(pin.sha256),'MAINTENANCE_HOST_SIZE_PIN');
 const before=await handle.stat();requireFact(before.size===pin.size,'MAINTENANCE_HOST_SOURCE_CHANGED');
 const hash=createHash('sha256'),buffer=Buffer.alloc(65536),started=performance.now();let size=0;
 while(true){
  requireFact(performance.now()-started<12000,'MAINTENANCE_HOST_READ_TIMEOUT');
  const {bytesRead}=await handle.read(buffer,0,buffer.length,size);if(!bytesRead)break;
  size+=bytesRead;requireFact(size<=pin.size,'MAINTENANCE_HOST_SOURCE_CHANGED');hash.update(buffer.subarray(0,bytesRead));
 }
 const after=await handle.stat();
 requireFact(size===pin.size&&hash.digest('hex')===pin.sha256&&after.size===before.size&&after.ino===before.ino&&after.dev===before.dev&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'MAINTENANCE_HOST_SOURCE_CHANGED');
}
async function pinnedHostFile(pin){
 requireFact(path.isAbsolute(pin.path)&&await fs.realpath(pin.path)===pin.path,'MAINTENANCE_HOST_PATH');
 const h=await fs.open(pin.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await h.stat();requireFact(st.isFile()&&st.uid===0&&st.nlink===1&&(st.mode&0o022)===0,'MAINTENANCE_HOST_PERMISSIONS');await verifyPinnedHostBytes(h,pin)}finally{await h.close()}
}
async function exclusive(file,bytes,uid=0,gid=0){const h=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await h.writeFile(bytes);await h.chown(uid,gid);await h.sync()}finally{await h.close()}await syncDirectory(path.dirname(file))}
function command(program,args,options={}){return execFileSync(program,args,{encoding:'utf8',timeout:12000,maxBuffer:16384,...options,stdio:activationLease?['ignore','pipe','pipe',activationLease.fd]:['ignore','pipe','pipe']})}
function effective(){const pid=command('/usr/bin/systemctl',['show','ynx-finance.service','-p','MainPID','--value']).trim();requireFact(/^[1-9][0-9]*$/.test(pid),'MAINTENANCE_FINANCE_NOT_ACTIVE');return{pid};}
async function currentRuntime(policy){const{pid}=effective(),env=Object.fromEntries((await fs.readFile(`/proc/${pid}/environ`,'utf8')).split('\0').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));requireFact(await fs.realpath(`/proc/${pid}/exe`)===policy.financeExecutable&&env.YNX_FINANCE_WEB_DIR===policy.financeWebDirectory,'MAINTENANCE_DEPLOYMENT_CHANGED');return{pid,env}}
async function checkpoint(policy){
 // Reuse the original owner-aware complete journal reader; never sort/trust loose markers.
 const script="import{readFile}from'node:fs/promises';const{createNodeCheckpointStore}=await import(process.argv[1]);const root=JSON.parse(await readFile(process.argv[2]));const s=createNodeCheckpointStore({file:process.argv[3],anchor:root.anchor,trustedClockMs:Date.now()});console.log(JSON.stringify(await s.read()));";
 return JSON.parse(command('/usr/sbin/runuser',['-u',policy.financeUser,'--','/usr/bin/node','--input-type=module','-e',script,policy.checkpointReader,policy.consumerRootFile,policy.checkpointFile],{env:{PATH:'/usr/bin:/bin'}}));
}
export async function journalSnapshot(directory,uid){
 const st=await fs.lstat(directory);requireFact(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===uid&&(st.mode&0o777)===0o700&&await fs.realpath(directory)===directory,'MAINTENANCE_JOURNAL_DIRECTORY');
 const names=(await fs.readdir(directory)).sort();requireFact(names.length<=4096,'MAINTENANCE_JOURNAL_TOO_LARGE');
 const files=[];let size=0;
 for(const name of names){const file=path.join(directory,name),bytes=await protectedFile(file,uid);size+=bytes.length;requireFact(size<=67108864,'MAINTENANCE_JOURNAL_TOO_LARGE');files.push({name,bytes})}
 return files;
}
const snapshotDigest=files=>sha(JSON.stringify(files.map(({name,bytes})=>[name,sha(bytes)])));
/** Copy every regular journal/time/current-history file, not a guessed latest marker.
 * Only the original pinned reader interprets history. It can repair/advance the clone only. */
export async function preflightOnClone({policy:p,authorityKeys,candidateFile,expectedCheckpoint,runReader=command,rootBytes}){
 const source=path.dirname(p.checkpointFile),parent=path.dirname(source);
 requireFact(path.dirname(p.trustedTimeFile)===source&&p.cloneParent===parent,'MAINTENANCE_CLONE_PARENT');
 requireFact(Array.isArray(p.preflightReaders)&&p.preflightReaders.length>=2&&p.preflightReaders.length<=4&&new Set(p.preflightReaders.map(r=>r.script)).size===p.preflightReaders.length&&p.preflightReaders.some(r=>r.script===authorityKeys.YNX_FINANCE_ENDPOINT_AUTHORITY_V2_SCRIPT),'MAINTENANCE_COMPATIBLE_READERS_REQUIRED');
 const original=await journalSnapshot(source,p.financeUID),originalDigest=snapshotDigest(original);
 const clone=await fs.mkdtemp(path.join(parent,'.authority-maintenance-preflight-'));await fs.chmod(clone,0o700);await fs.chown(clone,p.financeUID,p.financeGID);
 try{
  for(const row of original)await exclusive(path.join(clone,row.name),row.bytes,p.financeUID,p.financeGID);
  const manifest=path.join(clone,'maintenance-candidate.json');await exclusive(manifest,await protectedFile(candidateFile,p.financeUID),p.financeUID,p.financeGID);
  const root=path.join(clone,'maintenance-public-root.json');const publicRootBytes=rootBytes??await protectedFile(p.rootFile);requireFact(sha(publicRootBytes)===p.rootSHA256,'MAINTENANCE_ROOT_CHANGED');await exclusive(root,publicRootBytes,p.financeUID,p.financeGID);
  const env={PATH:'/usr/bin:/bin',...Object.fromEntries(Object.entries(authorityKeys).filter(([k])=>!k.endsWith('NODE_BINARY')&&!k.endsWith('SCRIPT'))),YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE:manifest,YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE:root,YNX_FINANCE_ENDPOINT_AUTHORITY_V2_CHECKPOINT_FILE:path.join(clone,path.basename(p.checkpointFile)),YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUSTED_TIME_FILE:path.join(clone,path.basename(p.trustedTimeFile))};
  for(const reader of p.preflightReaders){
   const bytes=await fs.readFile(reader.script);requireFact(sha(bytes)===reader.sha256&&p.hostFiles.some(pin=>pin.path===reader.script&&pin.sha256===reader.sha256),'MAINTENANCE_READER_CHANGED');
   for(const mode of ['server','browser-config']){
    const out=JSON.parse(await runReader(authorityKeys.YNX_FINANCE_ENDPOINT_AUTHORITY_V2_NODE_BINARY,[reader.script],{uid:p.financeUID,gid:p.financeGID,env:{...env,...(mode==='browser-config'?{YNX_FINANCE_ENDPOINT_AUTHORITY_V2_OUTPUT_MODE:mode}:{})},timeout:3000,maxBuffer:16384}));
    requireFact(mode==='server'?out.status==='VERIFIED':same(out.serverCheckpoint,expectedCheckpoint),'MAINTENANCE_CONSUMER_PRECHECK_FAILED');
   }
  }
  requireFact(snapshotDigest(await journalSnapshot(source,p.financeUID))===originalDigest,'MAINTENANCE_LIVE_JOURNAL_MOVED');
  return{readers:p.preflightReaders.length,modes:2,liveCheckpointAdvanced:false};
 }finally{await fs.rm(clone,{recursive:true,force:true})}
}
/** No old environment is ever restored; in-flight readers may still accept target. */
export function activationRecoveryPlan({previous,accepted,target,currentEnvironment,candidateEnvironment,originalEnvironment}){
 requireFact(Buffer.from(currentEnvironment).equals(Buffer.from(candidateEnvironment)),'MAINTENANCE_ENVIRONMENT_CAS_CONFLICT');
 if(same(accepted,previous))return{action:'KEEP_ENVIRONMENT_OPERATOR_RETRY',bytes:candidateEnvironment,stateRewound:false};
 if(same(accepted,target))return{action:'KEEP_CURRENT_AUTHORITY_OPERATOR_RETRY',bytes:candidateEnvironment,stateRewound:false};
 throw new Error('MAINTENANCE_CHECKPOINT_CAS_CONFLICT');
}
async function syncDirectory(directory){const h=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await h.sync()}finally{await h.close()}}
async function replaceEnvironment(file,expected,bytes,tag){
 assertCommitLease();
 requireFact((await protectedFile(file)).equals(expected),'MAINTENANCE_ENVIRONMENT_CAS_CONFLICT');
 const ready=path.join(path.dirname(file),`.authority-maintenance-${tag}-${randomUUID()}.env`);await exclusive(ready,bytes);
 try{assertCommitLease();requireFact((await protectedFile(file)).equals(expected),'MAINTENANCE_ENVIRONMENT_CAS_CONFLICT');await fs.rename(ready,file);await syncDirectory(path.dirname(file))}finally{await fs.unlink(ready).catch(e=>{if(e.code!=='ENOENT')throw e})}
}
function fixedAuthorityKeys(p,env){
 const keys=Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('YNX_FINANCE_ENDPOINT_AUTHORITY_V2_')));
 requireFact(Object.keys(keys).sort().join(',')===['CHECKPOINT_FILE','MANIFEST_FILE','NODE_BINARY','SCRIPT','TRUSTED_TIME_FILE','TRUST_ROOT_FILE'].map(k=>'YNX_FINANCE_ENDPOINT_AUTHORITY_V2_'+k).sort().join(','),'MAINTENANCE_SIX_KEYS_CHANGED');
 for(const [key,value] of [['CHECKPOINT_FILE',p.checkpointFile],['TRUSTED_TIME_FILE',p.trustedTimeFile],['TRUST_ROOT_FILE',p.consumerRootFile]])requireFact(keys['YNX_FINANCE_ENDPOINT_AUTHORITY_V2_'+key]===value,'MAINTENANCE_CONSUMER_PATH_CHANGED');
 requireFact(p.hostFiles.some(pin=>pin.path===p.checkpointReader),'MAINTENANCE_CHECKPOINT_READER_UNPINNED');
 return keys;
}
// Only completed HTTP 503 responses are retried; authority/network errors fail closed.
export async function readActivationConfig(url,{read=readFreshHTTPS,validate,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 requireFact(typeof validate==='function','MAINTENANCE_ACTIVATION_VALIDATOR_REQUIRED');
 const deadline=now()+6000;let attempts=0;
 while(true){
  const remaining=Math.floor(deadline-now());requireFact(remaining>0&&attempts<25,'MAINTENANCE_ACTIVATION_NOT_READY');attempts++;
  const config=await read(url,{timeoutMs:Math.min(3000,remaining)});requireFact(now()<=deadline,'MAINTENANCE_ACTIVATION_NOT_READY');
  if(config.observation.httpStatus===503){const wait=Math.min(250,Math.floor(deadline-now()));requireFact(wait>0,'MAINTENANCE_ACTIVATION_NOT_READY');await sleep(wait);continue}
  requireFact(config.observation.httpStatus===200,'MAINTENANCE_PUBLIC_CONFIG_FAILED');await validate(config);return config;
 }
}
async function verifyActivation(p,before,consumerFile,target){
 const K='YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE';let after;
 for(let i=0;i<60;i++){try{after=await currentRuntime(p);if(after.env[K]===consumerFile)break}catch{}await new Promise(r=>setTimeout(r,100))}
 requireFact(after?.env[K]===consumerFile,'MAINTENANCE_ACTIVATION_NOT_READY');
 requireFact(Object.entries(before.env).filter(([k])=>k.startsWith('YNX_')&&k!==K).every(([k,v])=>after.env[k]===v),'MAINTENANCE_PROTECTED_CONFIG_CHANGED');
 const config=await readActivationConfig(p.publicConfigURL,{validate:async config=>{const body=JSON.parse(config.body);
 requireFact(same(body.serverCheckpoint,target),'MAINTENANCE_PUBLIC_CHECKPOINT_MISMATCH');requireFact(same(await checkpoint(p),target),'MAINTENANCE_LOCAL_CHECKPOINT_MISMATCH');
 const root=JSON.parse(await protectedFile(p.rootFile));await verifySignedEndpointAuthority(body.manifest,{trustRoot:root,checkpoint:target,consumer:p.consumer,nowMs:Date.now()});
 requireFact(same(body.trustRoot,root),'MAINTENANCE_PUBLIC_ROOT_CHANGED');
 }});return{after,config};
}

// Shared by maintenance AND every Finance ENV activation/rollback writer. Keep the
// protected lock inode permanently; the OS lock, not file existence, owns the lease.
const LOCK_FD_ENV='YNX_AUTHORITY_ACTIVATION_LOCK_FD';
let activationLease;
export function runWithActivationLock({lockFile,helper,program,args,uid=0,env=process.env}){
 requireFact(path.isAbsolute(lockFile)&&path.isAbsolute(helper),'MAINTENANCE_ACTIVATION_LOCK_PATH');
 const python="import os,sys,fcntl,json,stat; p=sys.argv[1]; uid=int(sys.argv[2]); d=os.path.dirname(p); ds=os.stat(d); assert os.path.realpath(d)==d and ds.st_uid==uid and (not(ds.st_mode&0o022) or (uid==0 and ds.st_mode&stat.S_ISVTX)); fd=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600); s=os.fstat(fd); assert stat.S_ISREG(s.st_mode) and s.st_uid==uid and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600;\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: print(json.dumps({'status':'STOPPED_OPERATOR_REQUIRED','code':'MAINTENANCE_ACTIVATION_LOCK_BUSY'}),file=sys.stderr);sys.exit(75)\nos.set_inheritable(fd,True);os.environ['YNX_AUTHORITY_ACTIVATION_LOCK_FD']=str(fd);os.execv(sys.argv[3],sys.argv[3:])";
 const out=spawnSync(helper,['-c',python,lockFile,String(uid),program,...args],{env,stdio:'inherit'});
 requireFact(!out.error,'MAINTENANCE_ACTIVATION_LOCK_HELPER_FAILED');return out.status??(out.signal==='SIGKILL'?137:128);
}
function assertActivationLease(p){
 const fd=Number(process.env[LOCK_FD_ENV]);requireFact(Number.isSafeInteger(fd)&&fd>=3,'MAINTENANCE_SHARED_ACTIVATION_LOCK_REQUIRED');
 const held=fstatSync(fd),onDisk=lstatSync(p.commitLockFile);
 requireFact(held.isFile()&&held.uid===0&&(held.mode&0o777)===0o600&&held.nlink===1&&onDisk.dev===held.dev&&onDisk.ino===held.ino&&!onDisk.isSymbolicLink(),'MAINTENANCE_ACTIVATION_LOCK_IDENTITY');
 // Same open-file description: this proves/reacquires LOCK_EX on the inherited
 // descriptor, rather than trusting a PID string or a lock-file existence test.
 execFileSync(p.lockHelper,['-c','import fcntl;fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)'],{stdio:['ignore','pipe','pipe',fd],timeout:3000});
 activationLease={fd,file:p.commitLockFile,dev:held.dev,ino:held.ino};
}
function assertCommitLease(){
 requireFact(activationLease,'MAINTENANCE_SHARED_ACTIVATION_LOCK_REQUIRED');const held=fstatSync(activationLease.fd),onDisk=lstatSync(activationLease.file);
 requireFact(held.dev===activationLease.dev&&held.ino===activationLease.ino&&onDisk.dev===held.dev&&onDisk.ino===held.ino,'MAINTENANCE_ACTIVATION_LOCK_IDENTITY');
}

export async function runMaintenance(policyFile,expectedPolicySHA256,{recover=false}={}){
 requireFact(process.getuid()===0,'MAINTENANCE_ROOT_OPERATOR_REQUIRED');
 const policyBytes=await protectedFile(policyFile);requireFact(sha(policyBytes)===expectedPolicySHA256,'MAINTENANCE_REVIEWED_POLICY_REQUIRED');const p=JSON.parse(policyBytes);p.policySHA256=expectedPolicySHA256;
 requireFact(p.financeUser==='ynx'&&Number.isSafeInteger(p.financeUID)&&p.financeUID>0&&Number.isSafeInteger(p.financeGID)&&p.consumer.consumerId==='ynx-finance-v1'&&p.consumer.origin==='https://finance.ynxweb4.com','MAINTENANCE_CONSUMER');
 const state=await fs.lstat(p.outputDirectory);requireFact(state.isDirectory()&&!state.isSymbolicLink()&&state.uid===0&&(state.mode&0o777)===0o700&&await fs.realpath(p.outputDirectory)===p.outputDirectory,'MAINTENANCE_DIRECTORY');
 requireFact(p.consumerDirectory===path.dirname(p.checkpointFile)&&/^[a-f0-9]{64}$/.test(p.nonRenewalPayloadSHA256),'MAINTENANCE_POLICY_INCOMPLETE');
 requireFact(p.commitLockFile==='/run/lock/ynx-finance-authority-activation.lock'&&p.sharedActivationProtocol==='ynx-finance-authority-forward-only/v1'&&p.hostFiles.some(pin=>pin.path===p.lockHelper),'MAINTENANCE_SHARED_LOCK_POLICY_REQUIRED');
 await pinnedHostFile(p.hostFiles.find(pin=>pin.path===p.lockHelper));
 if(process.env[LOCK_FD_ENV]===undefined){
  const status=runWithActivationLock({lockFile:p.commitLockFile,helper:p.lockHelper,program:process.execPath,args:[fileURLToPath(import.meta.url),policyFile,expectedPolicySHA256,...(recover?['--recover']:[])]});
  requireFact(status!==75,'MAINTENANCE_ACTIVATION_LOCK_BUSY');requireFact(status===0,'MAINTENANCE_LOCKED_OPERATION_FAILED');return;
 }
 assertActivationLease(p);
 try{
  const pending=path.join(p.outputDirectory,'pending-activation.json');
  for(const pin of p.hostFiles)await pinnedHostFile(pin);
  const rootBytes=await protectedFile(p.rootFile),root=JSON.parse(rootBytes);requireFact(sha(rootBytes)===p.rootSHA256&&sha(await protectedFile(p.consumerRootFile,p.financeUID))===p.rootSHA256,'MAINTENANCE_ROOT_CHANGED');
  if(recover)return await recoverPendingActivation(p,pending,root);
  requireFact(!(await fs.lstat(pending).catch(e=>{if(e.code!=='ENOENT')throw e;return null})),'MAINTENANCE_PENDING_ACTIVATION_REVIEW_REQUIRED');
  const before=await currentRuntime(p),authorityKeys=fixedAuthorityKeys(p,before.env),K='YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE',baseline=JSON.parse(await protectedFile(before.env[K],p.financeUID)),accepted=await checkpoint(p);
  // Baseline bytes from the consumer are not root policy. Verify with the original SDK first.
  await verifySignedEndpointAuthority(baseline,{trustRoot:root,checkpoint:accepted,consumer:p.consumer,nowMs:Date.parse(baseline.issuedAt)});
  requireFact(sha(canonicalAuthorityV2(nonRenewalProjection(baseline)))===p.nonRenewalPayloadSHA256&&baseline.integrity.keyId===p.signingKeyId,'MAINTENANCE_NON_RENEWAL_POLICY_CHANGED');
  const seconds=Math.floor((Date.parse(baseline.expiresAt)-Date.now())/1000);console.log(JSON.stringify({status:seconds<=0?'EXPIRED':seconds<=300?'RENEWAL_DUE':seconds<=900?'EXPIRY_WARNING':'CURRENT',sequence:baseline.sequence,remainingSeconds:seconds}));if(seconds>300)return;
  const[health,version,financeHealth,...assets]=await Promise.all([readFreshHTTPS(p.healthURL),readFreshHTTPS(p.versionURL),readFreshHTTPS(p.financeHealthURL),...p.assets.map(pin=>readFreshHTTPS(pin.url,{pin}))]);
  const facts={rootSHA256:sha(rootBytes),health,version,financeHealth,assets:assets.map(a=>({...a.observation,byteLength:a.byteLength}))},nowMs=Date.now(),prepared=await prepareFixedSourceRenewal({baseline,root,checkpoint:accepted,policy:p,facts,nowMs});
  const run=path.join(p.outputDirectory,`seq-${prepared.draft.sequence}-${prepared.draft.integrity.payloadSha256}`);await fs.mkdir(run,{mode:0o700});const evidence=path.join(run,'evidence');await fs.mkdir(evidence,{mode:0o700});for(const r of prepared.receipts)await exclusive(path.join(evidence,r.sha256+'.json'),r.bytes);
  await exclusive(path.join(run,'unsigned-manifest.json'),jsonBytes(prepared.draft));requireFact(same(await checkpoint(p),accepted),'MAINTENANCE_CHECKPOINT_CAS_CONFLICT');
  const signed=await issueAuthorityV2({draft:prepared.draft,trustRoot:root,checkpoint:accepted,consumer:p.consumer,privateKeyPath:p.privateKeyFile,approvedPayloadSha256:prepared.draft.integrity.payloadSha256,evidenceDirectory:evidence,nowMs});await authorityV2Doctor({manifest:signed,trustRoot:root,checkpoint:accepted,consumer:p.consumer,nowMs});
  const signedBytes=jsonBytes(signed);await exclusive(path.join(run,'signed-manifest.json'),signedBytes);const consumerFile=path.join(p.consumerDirectory,`signed-maintenance-seq-${signed.sequence}-${signed.integrity.payloadSha256}.json`);await exclusive(consumerFile,signedBytes,p.financeUID,p.financeGID);
  const target={rootVersion:root.rootVersion,sequence:signed.sequence,payloadSha256:signed.integrity.payloadSha256};
  await preflightOnClone({policy:p,authorityKeys,candidateFile:consumerFile,expectedCheckpoint:target});
  requireFact(same(await checkpoint(p),accepted),'MAINTENANCE_CHECKPOINT_CAS_CONFLICT');
  const currentEnv=await protectedFile(p.lastEnvironmentFile),candidateEnv=Buffer.concat([currentEnv,Buffer.from(`\n# Controlled fixed-source maintenance; original root and scopes\n${K}=${consumerFile}\n`)]);
  await exclusive(path.join(run,'environment-before'),currentEnv);await exclusive(path.join(run,'environment-candidate'),candidateEnv);
  // Durable intent before replacing the environment or restarting. Never put env values in logs.
  await exclusive(pending,jsonBytes({schemaVersion:1,policySHA256:expectedPolicySHA256,previous:accepted,target,consumerFile,originalManifestFile:before.env[K],run,originalEnvironmentSHA256:sha(currentEnv),candidateEnvironmentSHA256:sha(candidateEnv)}));
  try{
   requireFact(same(await checkpoint(p),accepted),'MAINTENANCE_CHECKPOINT_CAS_CONFLICT');
   const live=await currentRuntime(p);requireFact(live.pid===before.pid&&same(fixedAuthorityKeys(p,live.env),authorityKeys),'MAINTENANCE_RUNTIME_CAS_CONFLICT');
   await replaceEnvironment(p.lastEnvironmentFile,currentEnv,candidateEnv,signed.sequence);command('/usr/bin/systemctl',['restart','ynx-finance.service']);
   const{after,config}=await verifyActivation(p,before,consumerFile,target);
   await exclusive(path.join(run,'activated.json'),jsonBytes({status:'ACTIVATED',...target,expiresAt:signed.expiresAt,policySHA256:expectedPolicySHA256,publicObservation:config.observation,financePID:Number(after.pid),rootChanged:false,userScopeExpanded:false,providerVerified:false,productionApproved:false,stateRewound:false}));
   await fs.unlink(pending);await syncDirectory(p.outputDirectory);console.log(JSON.stringify({status:'ACTIVATED',sequence:signed.sequence,expiresAt:signed.expiresAt}));
  }catch(caught){
   // Forward-only recovery never replaces ENV on failure and never deletes history/time.
   let action='STOPPED_OPERATOR_REQUIRED';
   try{
    const current=await checkpoint(p),env=await protectedFile(p.lastEnvironmentFile);
    if(env.equals(candidateEnv)){
     const plan=activationRecoveryPlan({previous:accepted,accepted:current,target,currentEnvironment:env,candidateEnvironment:candidateEnv,originalEnvironment:currentEnv});action=plan.action;
     // Forward-only: readers may finish accepting target after this observation. No old ENV is restored.
    }else requireFact(env.equals(currentEnv)&&same(current,accepted),'MAINTENANCE_RECOVERY_CAS_CONFLICT');
   }catch{action='STOPPED_OPERATOR_REQUIRED'}
   await exclusive(path.join(run,'failed-'+randomUUID()+'.json'),jsonBytes({status:action,code:/^[A-Z0-9_]+$/.test(caught.message)?caught.message:'MAINTENANCE_OPERATION_FAILED',stateRewound:false}));throw caught;
  }
 }finally{activationLease=undefined}
}
/** Explicit operator retry of an already signed candidate; no signing or history reset. */
async function recoverPendingActivation(p,pending,root){
 const intent=JSON.parse(await protectedFile(pending));requireFact(intent.schemaVersion===1&&intent.policySHA256===p.policySHA256&&path.dirname(intent.run)===p.outputDirectory&&path.dirname(intent.consumerFile)===p.consumerDirectory,'MAINTENANCE_PENDING_IDENTITY');
 const original=await protectedFile(path.join(intent.run,'environment-before')),candidate=await protectedFile(path.join(intent.run,'environment-candidate'));
 requireFact(sha(original)===intent.originalEnvironmentSHA256&&sha(candidate)===intent.candidateEnvironmentSHA256,'MAINTENANCE_RECOVERY_ENVIRONMENT_CHANGED');
 const accepted=await checkpoint(p);requireFact(same(accepted,intent.previous)||same(accepted,intent.target),'MAINTENANCE_CHECKPOINT_CAS_CONFLICT');
 const signed=JSON.parse(await protectedFile(intent.consumerFile,p.financeUID));await verifySignedEndpointAuthority(signed,{trustRoot:root,checkpoint:accepted,consumer:p.consumer,nowMs:Date.now()});
 requireFact(signed.sequence===intent.target.sequence&&signed.integrity.payloadSha256===intent.target.payloadSha256&&root.rootVersion===intent.target.rootVersion&&sha(canonicalAuthorityV2(nonRenewalProjection(signed)))===p.nonRenewalPayloadSHA256,'MAINTENANCE_PENDING_IDENTITY');
 const before=await currentRuntime(p),keys=fixedAuthorityKeys(p,before.env);requireFact([intent.originalManifestFile,intent.consumerFile].includes(keys.YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE),'MAINTENANCE_IMMUTABLE_READER_BOUND_CHANGED');await preflightOnClone({policy:p,authorityKeys:keys,candidateFile:intent.consumerFile,expectedCheckpoint:intent.target});
 requireFact(same(await checkpoint(p),accepted),'MAINTENANCE_CHECKPOINT_CAS_CONFLICT');
 assertCommitLease();const latestRuntime=await currentRuntime(p);requireFact([intent.originalManifestFile,intent.consumerFile].includes(fixedAuthorityKeys(p,latestRuntime.env).YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE),'MAINTENANCE_IMMUTABLE_READER_BOUND_CHANGED');
 const current=await protectedFile(p.lastEnvironmentFile);requireFact(current.equals(original)||current.equals(candidate),'MAINTENANCE_ENVIRONMENT_CAS_CONFLICT');
 if(!current.equals(candidate))await replaceEnvironment(p.lastEnvironmentFile,original,candidate,'operator-retry');
 command('/usr/bin/systemctl',['restart','ynx-finance.service']);await verifyActivation(p,before,intent.consumerFile,intent.target);
 await exclusive(path.join(intent.run,'recovered-'+randomUUID()+'.json'),jsonBytes({status:'RECOVERED_CURRENT_HISTORY',...intent.target,stateRewound:false,signed:false}));await fs.unlink(pending);await syncDirectory(p.outputDirectory);
 return{status:'RECOVERED_CURRENT_HISTORY',sequence:intent.target.sequence,stateRewound:false,signed:false};
}
export async function runDeploymentUnderSharedLock(policyFile,policySHA256,program,args){
 requireFact(process.getuid()===0,'MAINTENANCE_ROOT_OPERATOR_REQUIRED');
 const bytes=await protectedFile(policyFile);requireFact(sha(bytes)===policySHA256,'MAINTENANCE_REVIEWED_POLICY_REQUIRED');const p=JSON.parse(bytes);
 requireFact(p.commitLockFile==='/run/lock/ynx-finance-authority-activation.lock'&&p.sharedActivationProtocol==='ynx-finance-authority-forward-only/v1'&&p.hostFiles.some(pin=>pin.path===p.lockHelper),'MAINTENANCE_SHARED_LOCK_POLICY_REQUIRED');
 await pinnedHostFile(p.hostFiles.find(pin=>pin.path===p.lockHelper));return runWithActivationLock({lockFile:p.commitLockFile,helper:p.lockHelper,program,args});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const execute=async()=>{
  if(process.argv[2]==='--with-activation-lock'){
   requireFact(process.argv[5]==='--'&&process.argv.length>=7,'MAINTENANCE_ARGUMENTS');
   process.exitCode=await runDeploymentUnderSharedLock(process.argv[3],process.argv[4],process.argv[6],process.argv.slice(7));return;
  }
  requireFact(process.argv.length===4||process.argv.length===5&&process.argv[4]==='--recover','MAINTENANCE_ARGUMENTS');
  const result=await runMaintenance(process.argv[2],process.argv[3],{recover:process.argv[4]==='--recover'});if(result)console.log(JSON.stringify(result));
 };
 execute().catch(e=>{console.error(JSON.stringify({status:'STOPPED_OPERATOR_REQUIRED',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'MAINTENANCE_OPERATION_FAILED'}));process.exitCode=1});
}
