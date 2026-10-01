import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {prepareFixedSourceRenewal,nonRenewalProjection,readFreshHTTPS,preflightOnClone,journalSnapshot,activationRecoveryPlan,runWithActivationLock} from './endpoint-authority-maintenance.mjs';
import {AUTHORITY_V2_URLS,AUTHORITY_V2_REPOSITORY,canonicalAuthorityV2,authorityV2SigningMessage,createEndpointAuthorityClient} from '../../sdk/js/endpoint-authority-v2.js';
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
