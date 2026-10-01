import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {prepareFixedSourceRenewal,nonRenewalProjection,readFreshHTTPS,preflightOnClone,journalSnapshot,activationRecoveryPlan,runWithActivationLock,verifyPinnedHostBytes,HOST_BINARY_MAX_BYTES,readActivationConfig,verifyPendingConfirmation,archivePendingConfirmation,durableSame} from './endpoint-authority-maintenance.mjs';
import {AUTHORITY_V2_URLS,AUTHORITY_V2_REPOSITORY,canonicalAuthorityV2,authorityV2SigningMessage,createEndpointAuthorityClient,verifySignedEndpointAuthority} from '../../sdk/js/endpoint-authority-v2.js';
import {prepareAuthorityV2Draft} from './endpoint-authority-v2.mjs';
import {createNodeCheckpointStore} from '../../apps/finance/authority/checkpoint-node.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),copy=structuredClone,iso=t=>new Date(t).toISOString();
const now=Date.now(),keys=generateKeyPairSync('ed25519'),consumer={consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0'},source={repository:AUTHORITY_V2_REPOSITORY,commit:'1'.repeat(40),tree:'2'.repeat(40)};
const root={schemaVersion:'ynx-endpoint-authority-trust/v2',authorityId:'ynx-testnet-endpoints',rootVersion:1,chainId:6423,anchor:{rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)},keys:[{keyId:'isolated-fixture',algorithm:'Ed25519',publicKeyBase64url:keys.publicKey.export({format:'jwk'}).x,notBefore:iso(now-86400000),notAfter:iso(now+86400000),revoked:false}],consumers:[{consumerId:consumer.consumerId,origin:consumer.origin,minimumClientVersion:'1.0.0',endpoints:['walletGateway'],products:['finance']}],maxValiditySeconds:3600};
function signed(m){const draft=prepareAuthorityV2Draft(m,'isolated-fixture');draft.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(draft,draft.integrity.keyId)),keys.privateKey).toString('base64url');return draft}
const observation=(url,body='{}',at=now-1000)=>({url,httpStatus:200,bodySha256:sha(body),observedAt:iso(at),tlsVerified:true,directDNS:true});
function fixture(){
 const gateway={url:AUTHORITY_V2_URLS.walletGateway,status:'VERIFIED',evidence:{source,chainId:6423,health:observation(AUTHORITY_V2_URLS.walletGateway+'/health'),version:observation(AUTHORITY_V2_URLS.walletGateway+'/version'),receiptSha256:'a'.repeat(64)}};
 const baseline=signed({schemaVersion:'2.0.0',authorityId:root.authorityId,manifestVersion:'2.0.0.1',sequence:1,previousPayloadSha256:root.anchor.payloadSha256,environment:'testnet',chainId:6423,cosmosChainId:'ynx_6423-1',asset:'YNXT',issuedAt:iso(now-1000),expiresAt:iso(now+3599000),issuerSource:source,consumers:[{consumerId:consumer.consumerId,origin:consumer.origin,minimumClientVersion:'1.0.0'}],endpoints:{...Object.fromEntries(Object.entries(AUTHORITY_V2_URLS).map(([k,url])=>[k,{url,status:'PENDING',evidence:null}])),walletGateway:gateway},products:{finance:{status:'VERIFIED',evidence:{origin:consumer.origin,source,observedAt:iso(now-1000),receiptSha256:'b'.repeat(64),registrySha256:'c'.repeat(64),callbackContractSha256:'d'.repeat(64),currentPublicSourceAccepted:true,productSessionAccepted:true},officialSandboxVerified:false,providerVerified:false,productionApproved:false}},policy:{mainnetEnabled:false,automaticWriteRetry:false,automaticFailover:false,clientRenewal:false}});
 const checkpoint={rootVersion:1,sequence:1,payloadSha256:baseline.integrity.payloadSha256},rootBytes=Buffer.from(JSON.stringify(root));
 const asset={url:'https://finance.ynxweb4.com/large.js',sha256:sha('fixture'),size:7};
 const policy={rootSHA256:sha(rootBytes),nonRenewalPayloadSHA256:sha(canonicalAuthorityV2(nonRenewalProjection(baseline))),signingKeyId:'isolated-fixture',validitySeconds:3600,nodeSource:source,webSource:source,financeBinarySource:source,consumer,assets:[asset],policySHA256:'e'.repeat(64)};
 const versionBody=JSON.stringify({build:{sourceCommit:source.commit}}),financeBody=JSON.stringify({build:{commit:source.commit}});
 const facts={rootSHA256:policy.rootSHA256,health:{body:'{}',observation:observation(gateway.url+'/health','{}',now)},version:{body:versionBody,observation:observation(gateway.url+'/version',versionBody,now)},financeHealth:{body:financeBody,observation:observation(consumer.origin+'/health',financeBody,now)},assets:[{url:asset.url,httpStatus:200,bodySha256:asset.sha256,byteLength:7,observedAt:iso(now),tlsVerified:true,directDNS:true}]};
 return{baseline,root,checkpoint,policy,facts,nowMs:now,rootBytes};
}
test('real SDK verifies signed baseline and renewal preserves every non-renewal field',async()=>{
 const f=fixture(),out=await prepareFixedSourceRenewal(f);assert.equal(out.draft.sequence,2);assert.equal(out.draft.previousPayloadSha256,f.checkpoint.payloadSha256);assert.deepEqual(nonRenewalProjection(out.draft),nonRenewalProjection(f.baseline));assert.equal(out.receipts.length,2);assert.equal(out.draft.policy.clientRenewal,false);
 const expired=fixture();expired.baseline=signed({...expired.baseline,issuedAt:iso(now-3601000),expiresAt:iso(now-1000)});expired.checkpoint.payloadSha256=expired.baseline.integrity.payloadSha256;expired.policy.nonRenewalPayloadSHA256=sha(canonicalAuthorityV2(nonRenewalProjection(expired.baseline)));
 // Evidence must itself remain valid relative to the original issuance; refresh fixture accordingly.
 for(const kind of ['health','version'])expired.baseline.endpoints.walletGateway.evidence[kind].observedAt=expired.baseline.issuedAt;
 expired.baseline.products.finance.evidence.observedAt=expired.baseline.issuedAt;expired.baseline=signed(expired.baseline);expired.checkpoint.payloadSha256=expired.baseline.integrity.payloadSha256;
 assert.equal((await prepareFixedSourceRenewal(expired)).draft.sequence,2);
});
for(const [name,change,code] of [
 ['invalid signature',f=>f.baseline.integrity.signature=Buffer.alloc(64).toString('base64url'),'SIGNATURE_INVALID'],
 ['changed signed consumer minimum',f=>{f.baseline.consumers[0].minimumClientVersion='0.9.0';f.baseline=signed(f.baseline);f.checkpoint.payloadSha256=f.baseline.integrity.payloadSha256},'NON_RENEWAL_POLICY_CHANGED'],
 ['root bytes',f=>f.facts.rootSHA256='f'.repeat(64),'ROOT_CHANGED'],
 ['asset size',f=>f.facts.assets[0].byteLength=8,'PUBLIC_ASSET_CHANGED'],
 ['TTL expansion',f=>f.policy.validitySeconds=3601,'VALIDITY_POLICY'],
 ['key rotation',f=>f.policy.signingKeyId='different','SIGNING_KEY_CHANGED'],
 ['CAS predecessor',f=>f.checkpoint.sequence=3,'ROLLBACK'],
 ])test(`fail closed: ${name}`,async()=>{const f=fixture();change(f);await assert.rejects(prepareFixedSourceRenewal(f),new RegExp(code))});
function streamed(bytes,{chunk=65536,status=200,declared=null,onCancel=()=>{}}={}){let offset=0;return {status,headers:{get:()=>declared},body:new ReadableStream({pull(c){if(offset>=bytes.length)c.close();else{c.enqueue(bytes.subarray(offset,offset+chunk));offset+=chunk}},cancel:onCancel})}}
test('740152-byte pinned public asset streams and hashes without text buffering',async()=>{
 const bytes=Buffer.alloc(740152,3),url='https://finance.ynxweb4.com/bundle.js';const result=await readFreshHTTPS(url,{pin:{url,size:bytes.length,sha256:sha(bytes)},fetchImpl:async()=>streamed(bytes)});assert.equal(result.byteLength,740152);assert.equal(result.body,undefined);assert.equal(result.observation.bodySha256,sha(bytes));
});
test('oversized/deceptive/short/tampered streams fail boundedly and cancel overflow',async()=>{
 const url='https://finance.ynxweb4.com/file',bytes=Buffer.alloc(200000);let canceled=false;
 await assert.rejects(readFreshHTTPS(url,{fetchImpl:async()=>streamed(bytes,{onCancel:()=>{canceled=true}})}),/TOO_LARGE/);assert.equal(canceled,true);
 for(const value of [Buffer.alloc(8),Buffer.alloc(6),Buffer.alloc(7,2)])await assert.rejects(readFreshHTTPS(url,{pin:{url,size:7,sha256:sha(Buffer.alloc(7))},fetchImpl:async()=>streamed(value)}),/TOO_LARGE|PUBLIC_ASSET_CHANGED/);
 await assert.rejects(readFreshHTTPS(url,{fetchImpl:async()=>streamed(Buffer.alloc(1),{declared:'999999999'})}),/TOO_LARGE/);
});
const before={rootVersion:1,sequence:1,payloadSha256:'1'.repeat(64)},target={rootVersion:1,sequence:2,payloadSha256:'2'.repeat(64)};
test('failed activation before/after CAS preserves current history and rejects unknown state',()=>{
 const context={previous:before,target,currentEnvironment:Buffer.from('candidate'),candidateEnvironment:Buffer.from('candidate'),originalEnvironment:Buffer.from('original')};
 assert.equal(activationRecoveryPlan({...context,accepted:before}).action,'KEEP_ENVIRONMENT_OPERATOR_RETRY');
 const after=activationRecoveryPlan({...context,accepted:target});assert.equal(after.action,'KEEP_CURRENT_AUTHORITY_OPERATOR_RETRY');assert.equal(after.stateRewound,false);
 assert.throws(()=>activationRecoveryPlan({...context,accepted:{...target,sequence:3}}),/CHECKPOINT_CAS_CONFLICT/);
 assert.throws(()=>activationRecoveryPlan({...context,accepted:before,currentEnvironment:Buffer.from('third-party')}),/ENVIRONMENT_CAS_CONFLICT/);
});
async function cloneFixture(fn){
 // Original SDK disallows writable /tmp ancestry; use a private same-UID tree.
 const dir=await fs.mkdtemp(path.join(os.homedir(),'.ynx-maintenance-test-'));await fs.chmod(dir,0o700);
 try{
  const live=path.join(dir,'journal');await fs.mkdir(live,{mode:0o700});const f=fixture(),file=path.join(live,'checkpoint.json');
  const store=createNodeCheckpointStore({file,anchor:root.anchor,trustedClockMs:now});await store.compareAndSwap(root.anchor,f.checkpoint);
  await fs.writeFile(path.join(live,'trusted-time.json'),JSON.stringify({schemaVersion:'ynx-trusted-time/v1',unixTimeMs:now}),{mode:0o600});
  const next=signed((await prepareFixedSourceRenewal(f)).draft),target={rootVersion:1,sequence:2,payloadSha256:next.integrity.payloadSha256},candidate=path.join(live,'signed-candidate.json');await fs.writeFile(candidate,JSON.stringify(next),{mode:0o600});
  const reader=path.join(dir,'reader.mjs');const sdk=pathToFileURL(path.resolve('sdk/js/endpoint-authority-v2.js')).href,checkpointSDK=pathToFileURL(path.resolve('apps/finance/authority/checkpoint-node.mjs')).href;
  await fs.writeFile(reader,`import fs from 'node:fs/promises';import{createEndpointAuthorityClient}from '${sdk}';import{createNodeCheckpointStore}from '${checkpointSDK}';const e=process.env,r=JSON.parse(await fs.readFile(e.YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE)),m=JSON.parse(await fs.readFile(e.YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE));const s=createNodeCheckpointStore({file:e.YNX_FINANCE_ENDPOINT_AUTHORITY_V2_CHECKPOINT_FILE,anchor:r.anchor,trustedClockMs:${now}});const c=createEndpointAuthorityClient({trustRoot:r,consumer:${JSON.stringify(consumer)},storage:s,clock:()=>${now}});await c.accept(m,{source:'remote'});await c.financeProductSession();console.log(JSON.stringify(e.YNX_FINANCE_ENDPOINT_AUTHORITY_V2_OUTPUT_MODE==='browser-config'?{serverCheckpoint:await s.read()}:{status:'VERIFIED'}));`,{mode:0o600});
  const compatReader=path.join(dir,'compatible-reader.mjs');await fs.writeFile(compatReader,(await fs.readFile(reader,'utf8'))+'\n// Separately pinned compatible original-consumer harness.\n',{mode:0o600});
  const pin={script:reader,sha256:sha(await fs.readFile(reader))},compatPin={script:compatReader,sha256:sha(await fs.readFile(compatReader))},policy={...f.policy,financeUID:process.getuid(),financeGID:process.getgid(),checkpointFile:file,trustedTimeFile:path.join(live,'trusted-time.json'),cloneParent:dir,rootFile:path.join(dir,'unused-protected-root'),preflightReaders:[pin,compatPin],hostFiles:[{path:reader,sha256:pin.sha256},{path:compatReader,sha256:compatPin.sha256}]};
  const authorityKeys={YNX_FINANCE_ENDPOINT_AUTHORITY_V2_NODE_BINARY:process.execPath,YNX_FINANCE_ENDPOINT_AUTHORITY_V2_SCRIPT:reader};
  await fn({policy,authorityKeys,candidateFile:candidate,expectedCheckpoint:target,rootBytes:f.rootBytes},store,live);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
}
test('original SDK current/history complete-clone server+browser preflight never advances live checkpoint',async()=>cloneFixture(async(args,store,live)=>{
 const before=await journalSnapshot(live,process.getuid()),cp=await store.read();let calls=0;
 const result=await preflightOnClone({...args,runReader:(program,argv,options)=>{calls++;return execFileSync(program,argv,{encoding:'utf8',...options})}});
 assert.equal(calls,4);assert.equal(result.liveCheckpointAdvanced,false);assert.deepEqual(await store.read(),cp);assert.deepEqual(await journalSnapshot(live,process.getuid()),before);
}));
test('failure and concurrent live-journal drift leave checkpoint unchanged and clean only the clone',async()=>cloneFixture(async(args,store,live)=>{
 const cp=await store.read();await assert.rejects(preflightOnClone({...args,runReader:()=>{throw Error('fixture-reader-failed')}}),/fixture-reader-failed/);assert.deepEqual(await store.read(),cp);
 let drift=false;await assert.rejects(preflightOnClone({...args,runReader:async(program,argv,options)=>{const out=execFileSync(program,argv,{encoding:'utf8',...options});if(!drift){drift=true;await fs.writeFile(path.join(live,'external-public-record'),Buffer.from('external'),{mode:0o600})}return out}}),/LIVE_JOURNAL_MOVED/);assert.deepEqual(await store.read(),cp);
 assert.equal((await fs.readdir(args.policy.cloneParent)).some(n=>n.startsWith('.authority-maintenance-preflight-')),false);
}));
test('post-CAS restart accepts current signed authority with original SDK and never rolls back history',async()=>cloneFixture(async(args,store,live)=>{
 const previous=await store.read(),candidate=JSON.parse(await fs.readFile(args.candidateFile)),client=createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>now});
 await client.accept(candidate,{source:'remote'});await client.financeProductSession();const accepted=await store.read(),history=await journalSnapshot(live,process.getuid());
 assert.equal(accepted.sequence,2);assert.equal(activationRecoveryPlan({previous,accepted,target:args.expectedCheckpoint,currentEnvironment:Buffer.from('candidate'),candidateEnvironment:Buffer.from('candidate'),originalEnvironment:Buffer.from('previous')}).action,'KEEP_CURRENT_AUTHORITY_OPERATOR_RETRY');
 const restarted=createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>now});await restarted.accept(candidate,{source:'remote'});await restarted.financeProductSession();assert.deepEqual(await journalSnapshot(live,process.getuid()),history);
 await assert.rejects(restarted.accept(fixture().baseline,{source:'remote'}),/ROLLBACK/);assert.deepEqual(await store.read(),accepted);
}));
test('actual OS lifecycle lock blocks concurrent writer and SIGKILL releases it for explicit recovery',async()=>{
 const dir=await fs.mkdtemp(path.join(os.homedir(),'.ynx-maintenance-lock-test-'));await fs.chmod(dir,0o700);
 const helper=process.env.YNX_QA_PYTHON??'/usr/bin/python3',lock=path.join(dir,'activation.lock'),pidFile=path.join(dir,'holder.pid'),pending=path.join(dir,'pending.json'),environment=path.join(dir,'environment');
 const module=pathToFileURL(path.resolve('scripts/ops/endpoint-authority-maintenance.mjs')).href;
 const fixture=path.join(dir,'fixture.mjs');await fs.writeFile(fixture,`import fs from 'node:fs';const [mode,pid,pending,env]=process.argv.slice(2);if(mode==='hold'){fs.writeFileSync(pending,'signed-candidate-intent');fs.writeFileSync(env,'candidate');fs.writeFileSync(pid,String(process.pid));setInterval(()=>{},1000)}else{if(fs.readFileSync(pending,'utf8')!=='signed-candidate-intent')throw Error('lost-pending');if(fs.readFileSync(env,'utf8')!=='candidate')throw Error('obsolete-environment');fs.writeFileSync(pid,'recovered');}`,{mode:0o600});
 const wrapper=mode=>`import{runWithActivationLock}from ${JSON.stringify(module)};process.exitCode=runWithActivationLock({lockFile:${JSON.stringify(lock)},helper:${JSON.stringify(helper)},program:${JSON.stringify(process.execPath)},args:[${JSON.stringify(fixture)},${JSON.stringify(mode)},${JSON.stringify(pidFile)},${JSON.stringify(pending)},${JSON.stringify(environment)}],uid:${process.getuid()}});`;
 const holder=spawn(process.execPath,['--input-type=module','-e',wrapper('hold')],{stdio:['ignore','pipe','pipe']});let childPID,holderError='';holder.stderr.on('data',bytes=>{holderError+=String(bytes)});
 const done=new Promise(resolve=>holder.on('exit',(code,signal)=>resolve({code,signal})));
 try{
  for(let i=0;i<100;i++){try{childPID=Number(await fs.readFile(pidFile,'utf8'));break}catch{}await new Promise(r=>setTimeout(r,20))}
  assert.ok(Number.isSafeInteger(childPID)&&childPID>0,holderError);
  let blocked;try{execFileSync(process.execPath,['--input-type=module','-e',wrapper('--recover')],{encoding:'utf8'})}catch(e){blocked=e}
  assert.equal(blocked?.status,75);assert.match(String(blocked.stderr),/ACTIVATION_LOCK_BUSY/);
  process.kill(childPID,'SIGKILL');await done;
  // The inode still exists, but unlike mkdir it does not strand the recovery path.
  assert.equal((await fs.stat(lock)).isFile(),true);
  execFileSync(process.execPath,['--input-type=module','-e',wrapper('--recover')],{encoding:'utf8'});
  assert.equal(await fs.readFile(pidFile,'utf8'),'recovered');assert.equal(await fs.readFile(environment,'utf8'),'candidate');
 }finally{if(childPID)try{process.kill(childPID,'SIGKILL')}catch{}holder.kill('SIGKILL');await fs.rm(dir,{recursive:true,force:true})}
});
test('reader advances after failure observation: forward-only plan cannot install obsolete original env',async()=>cloneFixture(async(args,store)=>{
 const previous=await store.read(),candidate=JSON.parse(await fs.readFile(args.candidateFile)),old=Buffer.from('old manifest N'),current=Buffer.from('candidate N+1');
 const plan=activationRecoveryPlan({previous,accepted:previous,target:args.expectedCheckpoint,currentEnvironment:current,candidateEnvironment:current,originalEnvironment:old});
 const consumerClient=createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>now});await consumerClient.accept(candidate,{source:'remote'});
 assert.equal((await store.read()).sequence,2);assert.equal(plan.action,'KEEP_ENVIRONMENT_OPERATOR_RETRY');assert.ok(plan.bytes.equals(current));assert.equal(plan.bytes.equals(old),false);
}));

test('124835376-byte Node-sized host binary verifies through bounded chunks, never readFile',async()=>{
 const size=124835376,block=Buffer.alloc(65536,7),hash=createHash('sha256');for(let n=0;n<size;n+=block.length)hash.update(block.subarray(0,Math.min(block.length,size-n)));
 let largest=0,reads=0;const stat={size,ino:1,dev:1,mtimeMs:1,ctimeMs:1};
 const handle={stat:async()=>stat,readFile:()=>{throw Error('unbounded buffering')},read:async(buffer,offset,length,position)=>{largest=Math.max(largest,length);reads++;const bytesRead=Math.min(length,size-position);buffer.fill(7,offset,offset+bytesRead);return{bytesRead}}};
 await verifyPinnedHostBytes(handle,{size,sha256:hash.digest('hex')});assert.equal(largest,65536);assert.ok(reads>1000);
});
test('host binary exact size pins reject missing, truncated, oversized and changed files',async()=>{
 const bytes=Buffer.alloc(7),pin={size:7,sha256:sha(bytes)},stat={size:7,ino:1,dev:1,mtimeMs:1,ctimeMs:1};
 const handle=(override={})=>({stat:async()=>stat,read:async(buffer,offset,length,position)=>{const bytesRead=Math.max(0,Math.min(length,bytes.length-position));bytes.copy(buffer,offset,position,position+bytesRead);return{bytesRead}},...override});
 for(const size of [undefined,0,HOST_BINARY_MAX_BYTES+1])await assert.rejects(verifyPinnedHostBytes(handle(),{...pin,size}),/HOST_SIZE_PIN/);
 await assert.rejects(verifyPinnedHostBytes(handle({stat:async()=>({...stat,size:6})}),pin),/HOST_SOURCE_CHANGED/);
 await assert.rejects(verifyPinnedHostBytes(handle({read:async()=>({bytesRead:0})}),pin),/HOST_SOURCE_CHANGED/);
 await assert.rejects(verifyPinnedHostBytes(handle({read:async()=>({bytesRead:8})}),pin),/HOST_SOURCE_CHANGED/);
 await assert.rejects(verifyPinnedHostBytes(handle(),{...pin,sha256:sha('wrong')}),/HOST_SOURCE_CHANGED/);
 let count=0;await assert.rejects(verifyPinnedHostBytes(handle({stat:async()=>({...stat,mtimeMs:++count})}),pin),/HOST_SOURCE_CHANGED/);
});
test('real sparse host-sized file is streamed and truncation fails without buffering',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-host-pin-')),file=path.join(directory,'node-sized');
 const size=124835376,block=Buffer.alloc(65536),hash=createHash('sha256');for(let n=0;n<size;n+=block.length)hash.update(block.subarray(0,Math.min(block.length,size-n)));
 const pin={size,sha256:hash.digest('hex')};let handle;
 try{handle=await fs.open(file,'w+');await handle.truncate(size);await verifyPinnedHostBytes(handle,pin);await handle.truncate(size-1);await assert.rejects(verifyPinnedHostBytes(handle,pin),/HOST_SOURCE_CHANGED/)}finally{await handle?.close();await fs.rm(directory,{recursive:true,force:true})}
});

function readinessFixture(statuses){
 let clock=0,calls=0,checks=0;const waits=[],timeouts=[];
 return{options:{now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms},read:async(_url,{timeoutMs})=>{timeouts.push(timeoutMs);const status=statuses[Math.min(calls++,statuses.length-1)];if(status instanceof Error)throw status;return{body:'{}',observation:{httpStatus:status}}},validate:async()=>{checks++}},state:()=>({clock,calls,checks,waits,timeouts})};
}
test('post-restart 503 waits then validates exactly one ready response',async()=>{
 const f=readinessFixture([503,503,200]);assert.equal((await readActivationConfig('https://finance.ynxweb4.com/api/config',f.options)).observation.httpStatus,200);
 assert.deepEqual(f.state(),{clock:500,calls:3,checks:1,waits:[250,250],timeouts:[3000,3000,3000]});
});
test('permanent startup 503 expires within six seconds without accepting authority',async()=>{
 const f=readinessFixture([503]);await assert.rejects(readActivationConfig('https://finance.ynxweb4.com/api/config',f.options),/ACTIVATION_NOT_READY/);
 assert.equal(f.state().clock,6000);assert.equal(f.state().calls,24);assert.equal(f.state().checks,0);assert.ok(f.state().timeouts.every(ms=>ms>0&&ms<=3000));
});
test('non-503 statuses and network errors fail immediately without retry',async()=>{
 for(const status of [400,401,403,404,429,500,502,504,new Error('TLS_FAILED')]){
  const f=readinessFixture([status,200]);await assert.rejects(readActivationConfig('https://finance.ynxweb4.com/api/config',f.options),/PUBLIC_CONFIG_FAILED|TLS_FAILED/);assert.equal(f.state().calls,1);assert.equal(f.state().checks,0);assert.deepEqual(f.state().waits,[]);
 }
});
test('returned signature/checkpoint/source/semantic errors after startup are not retried',async()=>{
 for(const code of ['SIGNATURE_INVALID','PUBLIC_CHECKPOINT_MISMATCH','LOCAL_CHECKPOINT_MISMATCH','PUBLIC_ROOT_CHANGED','SOURCE_CHANGED','SEMANTIC_INVALID']){
  const f=readinessFixture([503,200,200]);f.options.validate=async()=>{throw new Error(code)};
  await assert.rejects(readActivationConfig('https://finance.ynxweb4.com/api/config',f.options),new RegExp(code));assert.equal(f.state().calls,2);assert.deepEqual(f.state().waits,[250]);
 }
});
test('slow responses respect total readiness deadline and remaining fetch budget',async()=>{
 let clock=0,calls=0;const timeouts=[];
 await assert.rejects(readActivationConfig('https://finance.ynxweb4.com/api/config',{now:()=>clock,sleep:async ms=>{clock+=ms},read:async(_,{timeoutMs})=>{timeouts.push(timeoutMs);calls++;clock+=2900;return{observation:{httpStatus:calls===3?200:503}}},validate:async()=>assert.fail('late result accepted')}),/ACTIVATION_NOT_READY/);
 assert.deepEqual(timeouts,[3000,2850]);assert.equal(calls,2);
});

test('503 streaming response then real SDK signature validation accepts only the original signed config',async()=>{
 const f=fixture();let clock=0,calls=0;const body=JSON.stringify({serverCheckpoint:f.checkpoint,manifest:f.baseline,trustRoot:f.root});
 const config=await readActivationConfig('https://finance.ynxweb4.com/api/config',{now:()=>clock,sleep:async ms=>{clock+=ms},read:(url,options)=>readFreshHTTPS(url,{...options,fetchImpl:async(_url,request)=>{assert.equal(request.redirect,'error');assert.ok(request.signal instanceof AbortSignal);calls++;return streamed(Buffer.from(calls===1?'Service unavailable':body),{status:calls===1?503:200})}}),validate:async config=>{const returned=JSON.parse(config.body);assert.deepEqual(returned.serverCheckpoint,f.checkpoint);assert.deepEqual(returned.trustRoot,f.root);await verifySignedEndpointAuthority(returned.manifest,{trustRoot:f.root,checkpoint:f.checkpoint,consumer:f.policy.consumer,nowMs:now})}});
 assert.equal(config.body,body);assert.equal(calls,2);assert.equal(clock,250);
});
test('actual SDK rejects tampered signature after 503 without any third fetch',async()=>{
 const f=fixture();f.baseline.integrity.signature=Buffer.alloc(64).toString('base64url');let calls=0,clock=0;
 await assert.rejects(readActivationConfig('https://finance.ynxweb4.com/api/config',{now:()=>clock,sleep:async ms=>{clock+=ms},read:(url,options)=>readFreshHTTPS(url,{...options,fetchImpl:async()=>{calls++;return streamed(Buffer.from(calls===1?'Not ready':JSON.stringify(f.baseline)),{status:calls===1?503:200})}}),validate:async config=>verifySignedEndpointAuthority(JSON.parse(config.body),{trustRoot:f.root,checkpoint:f.checkpoint,consumer:f.policy.consumer,nowMs:now})}),/SIGNATURE_INVALID/);
 assert.equal(calls,2);assert.equal(clock,250);
});

function confirmationFixture(){
 const f=fixture(),old=copy(f.baseline);old.issuedAt=iso(now-7200000);old.expiresAt=iso(now-3600000);old.endpoints.walletGateway.evidence.health.observedAt=iso(now-7200000);old.endpoints.walletGateway.evidence.version.observedAt=iso(now-7200000);old.products.finance.evidence.observedAt=iso(now-7200000);const pending=signed(old),target={rootVersion:1,sequence:pending.sequence,payloadSha256:pending.integrity.payloadSha256};
 const fresh=copy(pending);fresh.sequence=2;fresh.manifestVersion='2.0.0.2';fresh.previousPayloadSha256=target.payloadSha256;fresh.issuedAt=iso(now-1000);fresh.expiresAt=iso(now+3599000);fresh.endpoints.walletGateway.evidence.health.observedAt=iso(now-1000);fresh.endpoints.walletGateway.evidence.version.observedAt=iso(now-1000);fresh.products.finance.evidence.observedAt=iso(now-1000);const current=signed(fresh),accepted={rootVersion:1,sequence:2,payloadSha256:current.integrity.payloadSha256};
 return{pendingManifest:pending,currentManifest:current,target,accepted,root:f.root,consumer:f.policy.consumer,nonRenewalPayloadSHA256:f.policy.nonRenewalPayloadSHA256,superseded:true,nowMs:now};
}
test('explicit confirmation proves expired pending as history only and current next revision at now',async()=>{
 const f=confirmationFixture();await assert.rejects(verifySignedEndpointAuthority(f.pendingManifest,{trustRoot:f.root,checkpoint:f.target,consumer:f.consumer,nowMs:now}),/EXPIRED_OR_FUTURE/);
 const result=await verifyPendingConfirmation(f);assert.equal(result.status,'CONFIRMED_SUPERSEDED_PENDING');assert.equal(result.sequence,2);assert.equal(result.signed,false);assert.equal(result.stateRewound,false);assert.equal(result.walletGateway,undefined);
});
for(const [name,mutate]of[
 ['old signature',f=>{f.pendingManifest.integrity.signature=Buffer.alloc(64).toString('base64url')}],
 ['old digest',f=>{f.pendingManifest.integrity.payloadSha256='f'.repeat(64)}],
 ['wrong predecessor',f=>{f.currentManifest=signed({...f.currentManifest,previousPayloadSha256:'f'.repeat(64)})}],
 ['skipped revision',f=>{f.accepted.sequence=3}],
 ['wrong current digest',f=>{f.accepted.payloadSha256='f'.repeat(64)}],
 ['current expired',f=>{f.currentManifest=signed({...f.currentManifest,issuedAt:iso(now-7200000),expiresAt:iso(now-3600000)});f.accepted.payloadSha256=f.currentManifest.integrity.payloadSha256}],
 ['key revoked',f=>{f.root=copy(f.root);f.root.keys[0].revoked=true}],
 ['consumer rejected',f=>{f.consumer={...f.consumer,origin:'https://wrong.ynxweb4.com'}}],
 ['non-renewal source changed',f=>{f.currentManifest=signed({...f.currentManifest,issuerSource:{...source,commit:'3'.repeat(40)}});f.accepted.payloadSha256=f.currentManifest.integrity.payloadSha256}],
 ['ordinary timer may not supersede',f=>{f.superseded=false}],
 ['future old issue',f=>{f.pendingManifest=signed({...f.pendingManifest,issuedAt:iso(now+1000),expiresAt:iso(now+3601000)});f.target.payloadSha256=f.pendingManifest.integrity.payloadSha256}]
])test('pending confirmation rejects '+name,async()=>{const f=confirmationFixture();mutate(f);await assert.rejects(verifyPendingConfirmation(f));});
test('valid already accepted target confirms without requiring another issue or restart',async()=>{const f=fixture();const out=await verifyPendingConfirmation({pendingManifest:f.baseline,currentManifest:f.baseline,target:f.checkpoint,accepted:f.checkpoint,root:f.root,consumer:f.policy.consumer,nonRenewalPayloadSHA256:f.policy.nonRenewalPayloadSHA256,nowMs:now});assert.equal(out.status,'CONFIRMED_CURRENT_PENDING');assert.equal(out.signed,false)});
test('completed non200 error contains only bounded safe HTTP phase diagnostics',async()=>{let clock=0;await assert.rejects(readActivationConfig('https://finance.ynxweb4.com/api/config',{now:()=>clock,read:async()=>({observation:{httpStatus:502}}),validate:async()=>assert.fail('must not validate failed response')}),error=>{assert.equal(error.message,'MAINTENANCE_PUBLIC_CONFIG_FAILED');assert.deepEqual(error.safeDiagnostic,{phase:'public-config',httpStatus:502,attempt:1,elapsedMs:0});return true;});});

test('durable confirmation retains original pending across interruption and idempotent retry',async()=>{const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pending-durable-')));try{await fs.chmod(dir,0o700);const pending=path.join(dir,'pending.json'),bytes=Buffer.from('signed-intent\n'),record=Buffer.from('safe-confirmation\n');await fs.writeFile(pending,bytes,{mode:0o600});const args={pending,run:dir,pendingBytes:bytes,record,assertLease:()=>{}};await assert.rejects(archivePendingConfirmation({...args,recheck:async()=>{throw Error('interrupted before unlink')}}),/interrupted/);assert.deepEqual(await fs.readFile(pending),bytes);assert.deepEqual(await fs.readFile(path.join(dir,'retained-pending-'+sha(bytes)+'.json')),bytes);await archivePendingConfirmation({...args,recheck:async()=>{}});await assert.rejects(fs.stat(pending),{code:'ENOENT'});assert.deepEqual(await fs.readFile(path.join(dir,'retained-pending-'+sha(bytes)+'.json')),bytes);}finally{await fs.rm(dir,{recursive:true,force:true})}});
test('pending replacement after durable audit is retained and never unlinked',async()=>{const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pending-cas-')));try{await fs.chmod(dir,0o700);const pending=path.join(dir,'pending.json'),bytes=Buffer.from('first'),replacement=Buffer.from('second');await fs.writeFile(pending,bytes,{mode:0o600});await assert.rejects(archivePendingConfirmation({pending,run:dir,pendingBytes:bytes,record:Buffer.from('safe'),assertLease:()=>{},recheck:async()=>fs.writeFile(pending,replacement,{mode:0o600})}),/PENDING_CAS_CONFLICT/);assert.deepEqual(await fs.readFile(pending),replacement);}finally{await fs.rm(dir,{recursive:true,force:true})}});

test('audit atomic publication never leaves partial final and no-replace retains a conflicting existing record',async()=>{const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pending-atomic-')));try{await fs.chmod(dir,0o700);const final=path.join(dir,'audit.json'),bytes=Buffer.from('complete durable audit');await assert.rejects(durableSame(final,bytes,{beforePublish:async temporary=>{await fs.writeFile(temporary,'partial',{mode:0o600});throw Error('interrupted before publish')}}),/interrupted/);await assert.rejects(fs.stat(final),{code:'ENOENT'});await durableSame(final,bytes);assert.deepEqual(await fs.readFile(final),bytes);await assert.rejects(durableSame(final,Buffer.from('different')),/AUDIT_CHANGED/);assert.deepEqual(await fs.readFile(final),bytes);}finally{await fs.rm(dir,{recursive:true,force:true})}});
test('actual SIGKILL during partial unpublished audit allows a fresh atomic retry',async()=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pending-kill-'))),final=path.join(dir,'audit.json'),ready=path.join(dir,'ready');await fs.chmod(dir,0o700);const bytes=Buffer.from('complete audit');let child;
 try{
  const module=pathToFileURL(path.resolve('scripts/ops/endpoint-authority-maintenance.mjs')).href;
  child=spawn(process.execPath,['--input-type=module','-e',`import fs from'node:fs/promises';import{durableSame}from ${JSON.stringify(module)};await durableSame(${JSON.stringify(final)},Buffer.from('complete audit'),{beforePublish:async temporary=>{await fs.writeFile(temporary,'partial',{mode:0o600});await fs.writeFile(${JSON.stringify(ready)},'ready');await new Promise(()=>{setInterval(()=>{},1000)});}});`],{stdio:'ignore'});
  for(let i=0;i<100;i++){if(await fs.stat(ready).catch(()=>null))break;await new Promise(r=>setTimeout(r,20));}assert.ok(await fs.stat(ready).catch(()=>null));const closed=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await closed;await assert.rejects(fs.stat(final),{code:'ENOENT'});assert.ok((await fs.readdir(dir)).some(n=>n.startsWith('.confirmation-audit-')));await durableSame(final,bytes);assert.deepEqual(await fs.readFile(final),bytes);
 }finally{if(child&&!child.killed)child.kill('SIGKILL');await fs.rm(dir,{recursive:true,force:true})}
});
test('actual SIGKILL after no-replace publication retries the equal path before pending removal',async()=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pending-published-kill-'))),final=path.join(dir,'audit.json'),ready=path.join(dir,'ready');await fs.chmod(dir,0o700);const bytes=Buffer.from('complete audit');let child;
 try{const module=pathToFileURL(path.resolve('scripts/ops/endpoint-authority-maintenance.mjs')).href;
 child=spawn(process.execPath,['--input-type=module','-e',`import fs from'node:fs/promises';import{durableSame}from ${JSON.stringify(module)};await durableSame(${JSON.stringify(final)},Buffer.from('complete audit'),{afterPublish:async()=>{await fs.writeFile(${JSON.stringify(ready)},'ready');await new Promise(()=>{setInterval(()=>{},1000)});}});`],{stdio:'ignore'});
 for(let i=0;i<100;i++){if(await fs.stat(ready).catch(()=>null))break;await new Promise(r=>setTimeout(r,20));}assert.ok(await fs.stat(ready).catch(()=>null));const closed=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await closed;assert.deepEqual(await fs.readFile(final),bytes);await durableSame(final,bytes);assert.deepEqual(await fs.readFile(final),bytes);
 }finally{if(child&&!child.killed)child.kill('SIGKILL');await fs.rm(dir,{recursive:true,force:true})}
});
