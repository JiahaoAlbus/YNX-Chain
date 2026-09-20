import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {AUTHORITY_V2_REPOSITORY,AUTHORITY_V2_URLS,authorityV2SigningMessage,canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';
import {prepareAuthorityV2Draft} from '../../../scripts/ops/endpoint-authority-v2.mjs';
import {resolveFinanceBrowserAuthorityConfig,resolveFinancePrivateAuthority} from './adapter.mjs';
import {createNodeCheckpointStore} from './checkpoint-node.mjs';
import {loadFinanceAuthorityConfig} from './config.mjs';

const nowMs=Date.parse('2026-09-21T00:00:00.000Z');
const tempRoot=path.resolve(`apps/finance/.authority-test-tmp-${process.pid}`);await fs.mkdir(tempRoot,{recursive:true,mode:0o700});after(()=>fs.rm(tempRoot,{recursive:true,force:true}));
const iso=value=>new Date(value).toISOString();
const sha=value=>createHash('sha256').update(value).digest('hex');
const transitionPath=(file,previous)=>`${file}.from-${sha(canonicalAuthorityV2(previous))}`;
const copy=value=>structuredClone(value);
const key=generateKeyPairSync('ed25519');
const source={repository:AUTHORITY_V2_REPOSITORY,commit:'1'.repeat(40),tree:'2'.repeat(40)};
const consumer={consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',minimumClientVersion:'1.0.0'};
const root={schemaVersion:'ynx-endpoint-authority-trust/v2',authorityId:'ynx-testnet-endpoints',rootVersion:1,chainId:6423,anchor:{rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)},keys:[{keyId:'finance-test-only',algorithm:'Ed25519',publicKeyBase64url:key.publicKey.export({format:'jwk'}).x,notBefore:iso(nowMs-86400000),notAfter:iso(nowMs+8*86400000),revoked:false}],consumers:[{...consumer,endpoints:['rpc','evmRpc','faucet','walletGateway'],products:['finance']}],maxValiditySeconds:604800};
const observation=url=>({url,httpStatus:200,bodySha256:sha('{}'),observedAt:iso(nowMs-1000),tlsVerified:true,directDNS:true});

function signed({sequence=1,previousPayloadSha256='0'.repeat(64),origin=consumer.origin,tree=source.tree}={}){
  const endpoints=Object.fromEntries(Object.entries(AUTHORITY_V2_URLS).map(([name,url])=>[name,{url,status:'PENDING',evidence:null}]));
  endpoints.walletGateway={url:AUTHORITY_V2_URLS.walletGateway,status:'VERIFIED',evidence:{health:observation(AUTHORITY_V2_URLS.walletGateway+'/health'),version:observation(AUTHORITY_V2_URLS.walletGateway+'/version'),source,chainId:6423,receiptSha256:'a'.repeat(64)}};
  const selectedSource={...source,tree};
  endpoints.walletGateway.evidence.source=selectedSource;
  const draft={schemaVersion:'2.0.0',authorityId:'ynx-testnet-endpoints',manifestVersion:`2.0.0.${sequence}`,sequence,previousPayloadSha256,environment:'testnet',chainId:6423,cosmosChainId:'ynx_6423-1',asset:'YNXT',issuedAt:iso(nowMs-100),expiresAt:iso(nowMs+3600000),issuerSource:selectedSource,consumers:[consumer],endpoints,products:{finance:{status:'VERIFIED',evidence:{origin,source:selectedSource,observedAt:iso(nowMs-1000),receiptSha256:'b'.repeat(64),registrySha256:'c'.repeat(64),callbackContractSha256:'d'.repeat(64),currentPublicSourceAccepted:true,productSessionAccepted:true},officialSandboxVerified:false,providerVerified:false,productionApproved:false}},policy:{mainnetEnabled:false,automaticWriteRetry:false,automaticFailover:false,clientRenewal:false},integrity:{}};
  const manifest=prepareAuthorityV2Draft(draft,'finance-test-only');
  manifest.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(manifest,manifest.integrity.keyId)),key.privateKey).toString('base64url');
  return manifest;
}

async function fixture(t,{manifest=signed(),trustedTimeMs=nowMs}={}){
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-authority-v2-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const files={trustRootFile:path.join(dir,'trust-root.json'),manifestFile:path.join(dir,'manifest.json'),checkpointFile:path.join(dir,'checkpoint'),trustedTimeFile:path.join(dir,'trusted-time.json')};
  await Promise.all([fs.writeFile(files.trustRootFile,JSON.stringify(root)),fs.writeFile(files.manifestFile,JSON.stringify(manifest)),fs.writeFile(files.trustedTimeFile,JSON.stringify({schemaVersion:'ynx-trusted-time/v1',unixTimeMs:trustedTimeMs}))]);
  const env=Object.fromEntries(Object.entries(files).map(([name,value])=>[`YNX_FINANCE_ENDPOINT_AUTHORITY_V2_${name.replace(/File$/,'').replace(/[A-Z]/g,letter=>'_'+letter).toUpperCase()}_FILE`,value]));
  return {dir,files,env,manifest};
}

test('unconfigured and partially configured Finance v2 fail closed before private network',async()=>{
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('network forbidden');};
  try{
    assert.deepEqual(loadFinanceAuthorityConfig({}),{enabled:false,reason:'FINANCE_AUTHORITY_V2_NOT_CONFIGURED'});
    await assert.rejects(resolveFinancePrivateAuthority({env:{}}),/PRIVATE_SERVICE_DEGRADED/);
    assert.throws(()=>loadFinanceAuthorityConfig({YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE:'/tmp/manifest'}),/CONFIGURATION_INCOMPLETE/);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('exact signed Finance v2 selects only Wallet Gateway and keeps provider flags false',async t=>{
  const value=await fixture(t);
  const authority=await resolveFinancePrivateAuthority({env:value.env});
  assert.deepEqual(authority,{walletGateway:'https://wallet-auth.ynxweb4.com',financeOrigin:'https://finance.ynxweb4.com',manifestVersion:'2.0.0.1',payloadSha256:value.manifest.integrity.payloadSha256,officialSandboxVerified:false,providerVerified:false,productionApproved:false});
  const persisted=await createNodeCheckpointStore({file:value.files.checkpointFile,anchor:root.anchor,trustedClockMs:nowMs}).inspect();
  assert.equal(persisted.checkpoint.sequence,1);assert.equal(persisted.trustedClockHighWaterMs,nowMs);
});

test('browser config is server-verified public metadata bound to the durable server checkpoint',async t=>{
  const value=await fixture(t),config=await resolveFinanceBrowserAuthorityConfig({env:value.env});
  assert.equal(config.schemaVersion,'ynx-finance-endpoint-authority-browser-config/v1');assert.deepEqual(config.trustRoot,root);assert.deepEqual(config.manifest,value.manifest);assert.deepEqual(config.serverCheckpoint,{rootVersion:1,sequence:1,payloadSha256:value.manifest.integrity.payloadSha256});assert.equal(config.trustedTimeMs,nowMs);
});

test('persisted history permits a signed root rotation and rejects rotation back to the old root',async t=>{
  const first=signed(),value=await fixture(t,{manifest:first});await resolveFinancePrivateAuthority({env:value.env});
  const root2={...copy(root),rootVersion:2,anchor:{rootVersion:2,sequence:0,payloadSha256:'0'.repeat(64)}},second=signed({sequence:2,previousPayloadSha256:first.integrity.payloadSha256});
  await fs.writeFile(value.files.trustRootFile,JSON.stringify(root2));await fs.writeFile(value.files.manifestFile,JSON.stringify(second));
  const rotated=await resolveFinancePrivateAuthority({env:value.env});assert.equal(rotated.manifestVersion,'2.0.0.2');
  const persisted=await createNodeCheckpointStore({file:value.files.checkpointFile,anchor:root2.anchor,trustedClockMs:nowMs}).read();assert.deepEqual(persisted,{rootVersion:2,sequence:2,payloadSha256:second.integrity.payloadSha256});
  await fs.writeFile(value.files.trustRootFile,JSON.stringify(root));
  await assert.rejects(resolveFinancePrivateAuthority({env:value.env}),/ROOT_ROLLBACK/);
});

test('origin, signature, clock rollback and storage loss/equivocation fail closed',async t=>{
  const wrong=await fixture(t,{manifest:signed({origin:'https://evil.invalid'})});
  await assert.rejects(resolveFinancePrivateAuthority({env:wrong.env}),/FINANCE_ACCEPTANCE/);
  const invalid=signed();invalid.integrity.signature=Buffer.alloc(64).toString('base64url');
  const bad=await fixture(t,{manifest:invalid});await assert.rejects(resolveFinancePrivateAuthority({env:bad.env}),/SIGNATURE_INVALID/);
  const clock=await fixture(t);await resolveFinancePrivateAuthority({env:clock.env});
  await fs.writeFile(clock.files.trustedTimeFile,JSON.stringify({schemaVersion:'ynx-trusted-time/v1',unixTimeMs:nowMs-1}));
  await assert.rejects(resolveFinancePrivateAuthority({env:clock.env}),/CLOCK_ROLLBACK/);
  const forked=signed({tree:'f'.repeat(40)});
  await fs.writeFile(clock.files.trustedTimeFile,JSON.stringify({schemaVersion:'ynx-trusted-time/v1',unixTimeMs:nowMs}));await fs.writeFile(clock.files.manifestFile,JSON.stringify(forked));
  await assert.rejects(resolveFinancePrivateAuthority({env:clock.env}),/EQUIVOCATION/);
  await fs.rm(transitionPath(clock.files.checkpointFile,root.anchor));
  await assert.rejects(resolveFinancePrivateAuthority({env:clock.env}),/CHECKPOINT_LOST/);
});

test('node checkpoint CAS serializes competing process views',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-cas-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'checkpoint'),anchor=copy(root.anchor),nextA={rootVersion:1,sequence:1,payloadSha256:'a'.repeat(64)},nextB={rootVersion:1,sequence:1,payloadSha256:'b'.repeat(64)};
  const stores=[1,2].map(()=>createNodeCheckpointStore({file,anchor,trustedClockMs:nowMs}));
  const results=await Promise.all([stores[0].compareAndSwap(anchor,nextA),stores[1].compareAndSwap(anchor,nextB)]);
  assert.equal(results.filter(Boolean).length,1);
  assert.ok([nextA.payloadSha256,nextB.payloadSha256].includes((await stores[0].read()).payloadSha256));
});

test('append-only initialization fails closed before publish and repairs a missing marker after publish',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-init-crash-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const before=path.join(dir,'before'),after=path.join(dir,'after'),marker=file=>file+'.initialized';
  await fs.writeFile(marker(before),'ynx-finance-endpoint-authority-checkpoint/v1\n');
  await assert.rejects(createNodeCheckpointStore({file:before,anchor:copy(root.anchor),trustedClockMs:nowMs}).read(),/CHECKPOINT_LOST/);
  await fs.writeFile(after+'.genesis',JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-checkpoint-genesis/v1',anchor:root.anchor,trustedClockHighWaterMs:0})+'\n');
  const store=createNodeCheckpointStore({file:after,anchor:copy(root.anchor),trustedClockMs:nowMs});
  assert.deepEqual(await store.read(),root.anchor);
  const markerStat=await fs.stat(marker(after));assert.equal(markerStat.isFile(),true);assert.equal(markerStat.nlink,1);
});

test('append-only CAS ignores a pre-publish SIGKILL and repairs a post-publish SIGKILL',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-crash-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const workerFile=path.join(dir,'crash-worker.mjs');
  await fs.writeFile(workerFile,`import fs from 'node:fs';const [temporary,target,ready,payload,mode]=process.argv.slice(2),fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,Buffer.from(payload,'base64'));fs.fsyncSync(fd);fs.closeSync(fd);if(mode==='after-publish')fs.linkSync(temporary,target);fs.writeFileSync(ready,'ready');setInterval(()=>{},1000);`);
  for(const mode of ['before-publish','after-publish']){
    const file=path.join(dir,mode),ready=file+'.ready',store=createNodeCheckpointStore({file,anchor:copy(root.anchor),trustedClockMs:nowMs}),one={rootVersion:1,sequence:1,payloadSha256:'a'.repeat(64)},crashed={rootVersion:1,sequence:2,payloadSha256:'c'.repeat(64)},two={rootVersion:1,sequence:3,payloadSha256:'b'.repeat(64)};
    assert.equal(await store.compareAndSwap(root.anchor,one),true);
    const target=transitionPath(file,one),temporary=path.join(dir,`.${path.basename(target)}.999.test.tmp`),payload=Buffer.from(canonicalAuthorityV2({schemaVersion:'ynx-finance-endpoint-authority-checkpoint-transition/v1',previous:one,next:crashed,trustedClockHighWaterMs:nowMs})+'\n').toString('base64');
    const child=spawn(process.execPath,[workerFile,temporary,target,ready,payload,mode],{stdio:'ignore'});for(let attempt=0;attempt<1000;attempt++){try{await fs.stat(ready);break}catch(error){if(error.code!=='ENOENT')throw error;if(attempt===999)throw new Error('crash worker not ready');await new Promise(resolve=>setTimeout(resolve,2));}}
    child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve));
    if(mode==='before-publish'){assert.deepEqual(await store.read(),one);assert.equal(await store.compareAndSwap(one,two),true);}
    else{assert.deepEqual(await store.read(),crashed);assert.equal(await store.compareAndSwap(crashed,two),true);}
    assert.deepEqual(await store.read(),two);
  }
});

test('eight processes serialize append-only checkpoint CAS without recovery locks',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-race-')),rounds=20,workers=8;t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const moduleURL=pathToFileURL(path.resolve('apps/finance/authority/checkpoint-node.mjs')).href,workerFile=path.join(dir,'worker.mjs'),barriers=path.join(dir,'barrier');
  await fs.writeFile(workerFile,`import fs from 'node:fs/promises';import {createNodeCheckpointStore} from ${JSON.stringify(moduleURL)};const [base,barriers,rounds,index]=process.argv.slice(2);const anchor={rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)},out=[];for(let r=0;r<Number(rounds);r++){await fs.writeFile(barriers+'.'+r+'.ready.'+index,'');while(true){try{await fs.stat(barriers+'.'+r+'.go');break}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,2));}}try{out.push(await createNodeCheckpointStore({file:base+'.'+r,anchor,trustedClockMs:${nowMs}}).compareAndSwap(anchor,{rootVersion:1,sequence:1,payloadSha256:String(index).repeat(64)}));}catch(error){out.push({error:error.code??error.message});}}process.stdout.write(JSON.stringify(out));`);
  const children=Array.from({length:workers},(_,index)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[workerFile,path.join(dir,'checkpoint'),barriers,String(rounds),String(index)],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(stdout)):reject(new Error(`worker ${index} rc=${code}: ${stderr}`)));}));
  for(let round=0;round<rounds;round++){
    for(let attempt=0;attempt<1000;attempt++){const names=await fs.readdir(dir),ready=names.filter(name=>name.startsWith(`barrier.${round}.ready.`)).length;if(ready===workers)break;if(attempt===999)throw new Error(`workers not ready for round ${round}`);await new Promise(resolve=>setTimeout(resolve,2));}
    await fs.writeFile(`${barriers}.${round}.go`,'go');
  }
  const results=await Promise.all(children);
  for(let round=0;round<rounds;round++){const values=results.map(result=>result[round]);assert.equal(values.filter(value=>value===true).length,1,`round ${round}`);assert.equal(values.filter(value=>value===false).length,workers-1,`round ${round}: ${JSON.stringify(values)}`);}
});

test('authority JSON and checkpoint reads reject symlink substitution',async t=>{
  const value=await fixture(t),target=path.join(value.dir,'replacement.json');await fs.writeFile(target,JSON.stringify(root));
  await fs.rm(value.files.trustRootFile);await fs.symlink(target,value.files.trustRootFile);
  await assert.rejects(resolveFinancePrivateAuthority({env:value.env}),/FILE_IDENTITY_INVALID/);
  await fs.rm(value.files.trustRootFile);await fs.writeFile(value.files.trustRootFile,JSON.stringify(root));await resolveFinancePrivateAuthority({env:value.env});
  await fs.rm(value.files.checkpointFile+'.genesis');await fs.symlink(target,value.files.checkpointFile+'.genesis');
  await assert.rejects(resolveFinancePrivateAuthority({env:value.env}),/CHECKPOINT_IDENTITY_INVALID/);
});

test('checkpoint store rejects symlinked, shared and foreign-owned parent directories before publishing',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-directory-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const anchor=copy(root.anchor),make=file=>createNodeCheckpointStore({file,anchor,trustedClockMs:nowMs}).read();
  const real=path.join(dir,'real');await fs.mkdir(real,{mode:0o700});const linked=path.join(dir,'linked');await fs.symlink(real,linked);
  await assert.rejects(make(path.join(linked,'checkpoint')),/DIRECTORY_SYMLINK_INVALID/);
  const shared=path.join(dir,'shared');await fs.mkdir(shared,{mode:0o700});await fs.chmod(shared,0o750);
  await assert.rejects(make(path.join(shared,'checkpoint')),/DIRECTORY_MODE_INVALID/);
  if(process.geteuid()!==0){const foreign=await fs.realpath('/tmp');await assert.rejects(make(path.join(foreign,'ynx-finance-foreign-checkpoint')),/DIRECTORY_OWNER_INVALID/);}
});

test('checkpoint store rejects writable and symlinked ancestors before publishing',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-ancestor-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const make=file=>createNodeCheckpointStore({file,anchor:copy(root.anchor),trustedClockMs:nowMs}).read(),writable=path.join(dir,'writable'),leaf=path.join(writable,'leaf');await fs.mkdir(leaf,{recursive:true,mode:0o700});await fs.chmod(writable,0o777);
  await assert.rejects(make(path.join(leaf,'checkpoint')),/ANCESTOR_MODE_INVALID/);
  await fs.chmod(writable,0o700);const real=path.join(dir,'real'),realLeaf=path.join(real,'leaf'),alias=path.join(dir,'alias');await fs.mkdir(realLeaf,{recursive:true,mode:0o700});await fs.symlink(real,alias);
  await assert.rejects(make(path.join(alias,'leaf','checkpoint')),/DIRECTORY_SYMLINK_INVALID/);
});

test('atomic publish refuses a pre-existing transition symlink without touching its target',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-symlink-race-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'checkpoint'),store=createNodeCheckpointStore({file,anchor:copy(root.anchor),trustedClockMs:nowMs}),outside=path.join(dir,'outside');await fs.writeFile(outside,'unchanged');await store.read();
  await fs.symlink(outside,transitionPath(file,root.anchor));
  await assert.rejects(store.compareAndSwap(root.anchor,{rootVersion:1,sequence:1,payloadSha256:'d'.repeat(64)}),/CHECKPOINT_IDENTITY_INVALID/);
  assert.equal(await fs.readFile(outside,'utf8'),'unchanged');
});

test('append-only transition files reject root, sequence and trusted-clock rollback',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'ynx-finance-checkpoint-transition-rollback-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const [name,next,clock] of [
    ['root',{rootVersion:0,sequence:2,payloadSha256:'e'.repeat(64)},nowMs],
    ['sequence',{rootVersion:1,sequence:0,payloadSha256:'e'.repeat(64)},nowMs],
    ['clock',{rootVersion:1,sequence:2,payloadSha256:'e'.repeat(64)},nowMs-1],
  ]){
    const file=path.join(dir,name),store=createNodeCheckpointStore({file,anchor:copy(root.anchor),trustedClockMs:nowMs}),one={rootVersion:1,sequence:1,payloadSha256:'a'.repeat(64)};assert.equal(await store.compareAndSwap(root.anchor,one),true);
    const target=transitionPath(file,one),value={schemaVersion:'ynx-finance-endpoint-authority-checkpoint-transition/v1',previous:one,next,trustedClockHighWaterMs:clock};await fs.writeFile(target,canonicalAuthorityV2(value)+'\n');
    await assert.rejects(store.read(),/CHECKPOINT_(?:INVALID|ROLLBACK)/);
  }
});
