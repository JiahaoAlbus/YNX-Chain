import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {AUTHORITY_V2_URLS,AUTHORITY_V2_REPOSITORY,canonicalAuthorityV2Payload,authorityV2SigningMessage,assertAuthorityV2Manifest,assertAuthorityV2TrustRoot,verifySignedEndpointAuthority,selectSignedAuthorityEndpoint,financeProductSessionAuthority,createEndpointAuthorityClient} from './endpoint-authority-v2.js';
import {validateEndpointAuthority,selectAuthorityEndpoint} from './endpoint-authority.js';
import {bundledEndpointAuthority,endpointAuthorityPin} from './endpoint-authority-bundle.js';
import {prepareAuthorityV2Draft,issueAuthorityV2,authorityV2Doctor,validateAuthorityV2ReceiptFiles} from '../../scripts/ops/endpoint-authority-v2.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const key=generateKeyPairSync('ed25519'),nowMs=Date.parse('2026-09-20T10:00:00.000Z');
const iso=x=>new Date(x).toISOString(),copy=x=>structuredClone(x);
const consumer={consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.2.0'};
const root={schemaVersion:'ynx-endpoint-authority-trust/v2',authorityId:'ynx-testnet-endpoints',rootVersion:1,chainId:6423,anchor:{rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)},keys:[{keyId:'test-ephemeral-only',algorithm:'Ed25519',publicKeyBase64url:key.publicKey.export({format:'jwk'}).x,notBefore:iso(nowMs-86400000),notAfter:iso(nowMs+8*86400000),revoked:false}],consumers:[{...consumer,minimumClientVersion:'1.0.0',endpoints:['rpc','walletGateway'],products:['finance']}],maxValiditySeconds:604800};
delete root.consumers[0].clientVersion;
const source={repository:AUTHORITY_V2_REPOSITORY,commit:'1'.repeat(40),tree:'2'.repeat(40)};
const observation=(url,body='{}')=>({url,httpStatus:200,bodySha256:sha(body),observedAt:iso(nowMs-1000),tlsVerified:true,directDNS:true});
function draft(){
 const endpoints=Object.fromEntries(Object.entries(AUTHORITY_V2_URLS).map(([k,url])=>[k,{url,status:'PENDING',evidence:null}]));
 for(const k of ['rpc','walletGateway'])endpoints[k]={url:AUTHORITY_V2_URLS[k],status:'VERIFIED',evidence:{health:observation(AUTHORITY_V2_URLS[k]+(k==='rpc'?'/status':'/health')),version:observation(AUTHORITY_V2_URLS[k]+(k==='rpc'?'/status':'/version')),source,chainId:6423,receiptSha256:'a'.repeat(64)}};
 return {schemaVersion:'2.0.0',authorityId:'ynx-testnet-endpoints',manifestVersion:'2.0.0.1',sequence:1,previousPayloadSha256:'0'.repeat(64),environment:'testnet',chainId:6423,cosmosChainId:'ynx_6423-1',asset:'YNXT',issuedAt:iso(nowMs-100),expiresAt:iso(nowMs+3600000),issuerSource:copy(source),consumers:[{...consumer,minimumClientVersion:'1.0.0'}],endpoints,products:{finance:{status:'VERIFIED',evidence:{origin:consumer.origin,source,observedAt:iso(nowMs-1000),receiptSha256:'b'.repeat(64),registrySha256:'c'.repeat(64),callbackContractSha256:'d'.repeat(64),currentPublicSourceAccepted:true,productSessionAccepted:true},officialSandboxVerified:false,providerVerified:false,productionApproved:false}},policy:{mainnetEnabled:false,automaticWriteRetry:false,automaticFailover:false,clientRenewal:false},integrity:{}};
}
function signed(d=draft(),k=key){delete d.consumers[0].clientVersion;const m=prepareAuthorityV2Draft(d,'test-ephemeral-only');m.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(m,m.integrity.keyId)),k.privateKey).toString('base64url');return m;}
const options=(changes={})=>({trustRoot:copy(root),checkpoint:copy(root.anchor),consumer:copy(consumer),nowMs,...changes});
const next=m=>({rootVersion:1,sequence:m.sequence,payloadSha256:m.integrity.payloadSha256});
function storage(initial=root.anchor){let state=copy(initial);return {read:async()=>copy(state),compareAndSwap:async(a,b)=>{if(a.rootVersion!==state.rootVersion||a.sequence!==state.sequence||a.payloadSha256!==state.payloadSha256)return false;state=copy(b);return true;}};}
function following(m){const d=draft();d.sequence=m.sequence+1;d.manifestVersion=`2.0.0.${d.sequence}`;d.previousPayloadSha256=m.integrity.payloadSha256;return signed(d);}
test('signed v2 dispatch permits private endpoint scope while immutable v1 stays blocked',async()=>{
 const v=await validateEndpointAuthority(signed(),{...options(),source:'remote'});
 assert.equal(selectAuthorityEndpoint(v,'walletGateway',{checkpoint:next(v),nowMs}),AUTHORITY_V2_URLS.walletGateway);
 assert.equal(financeProductSessionAuthority(v,{checkpoint:next(v),nowMs}).officialSandboxVerified,false);
 const old=await validateEndpointAuthority(bundledEndpointAuthority,{trustedPin:endpointAuthorityPin,nowMs,digestSHA256:sha});
 assert.throws(()=>selectAuthorityEndpoint(old,'walletGateway',{nowMs}),/NOT_VERIFIED/);
 await assert.rejects(validateEndpointAuthority(bundledEndpointAuthority,{trustedPin:endpointAuthorityPin,nowMs,source:'remote'}),/REMOTE_FORBIDDEN/);
});
test('tampered payload, self-rehashed payload, signature and signer substitution fail',async()=>{
 const m=signed();m.issuerSource.tree='3'.repeat(40);await assert.rejects(verifySignedEndpointAuthority(m,options()),/DIGEST_MISMATCH/);
 m.integrity.payloadSha256=sha(canonicalAuthorityV2Payload(m));await assert.rejects(verifySignedEndpointAuthority(m,options()),/SIGNATURE_INVALID/);
 const bad=signed();bad.integrity.signature=Buffer.alloc(64).toString('base64url');await assert.rejects(verifySignedEndpointAuthority(bad,options()),/SIGNATURE_INVALID/);
 const r=copy(root);r.keys.push({...r.keys[0],keyId:'test-other-id'});const b=signed();b.integrity.keyId='test-other-id';await assert.rejects(verifySignedEndpointAuthority(b,options({trustRoot:r})),/SIGNATURE_INVALID/);
});
for(const which of ['missing','unknown','revoked'])test(`trusted key ${which} fails closed`,async()=>{const r=copy(root);if(which==='missing')r.keys=[];if(which==='unknown')r.keys[0].keyId='different-key';if(which==='revoked')r.keys[0].revoked=true;await assert.rejects(verifySignedEndpointAuthority(signed(),options({trustRoot:r})),/UNKNOWN_OR_REVOKED_KEY/);});
for(const [name,mutation,code] of [
 ['expired',d=>d.expiresAt=iso(nowMs),'EXPIRED_OR_FUTURE'],
 ['future',d=>d.issuedAt=iso(nowMs+100),'EXPIRED_OR_FUTURE'],
 ['too long',d=>d.expiresAt=iso(nowMs+8*86400000),'VALIDITY'],
 ['chain',d=>d.chainId=1,'WRONG_CHAIN'],
 ['version',d=>d.manifestVersion='2.0.0.9','VERSION'],
 ['source',d=>d.issuerSource.repository='https://evil.invalid','SOURCE_IDENTITY'],
 ['tls',d=>d.endpoints.walletGateway.evidence.health.tlsVerified=false,'PUBLIC_EVIDENCE'],
 ['health only',d=>d.endpoints.walletGateway.evidence.version.url=AUTHORITY_V2_URLS.walletGateway+'/health','PUBLIC_EVIDENCE'],
 ['old evidence',d=>d.endpoints.walletGateway.evidence.version.observedAt=iso(nowMs-2*86400000),'STALE_EVIDENCE'],
 ['unverified source',d=>d.products.finance.evidence.currentPublicSourceAccepted=false,'FINANCE_ACCEPTANCE'],
 ['provider status',d=>d.products.finance.providerVerified=true,'PROVIDER_BOUNDARY'],
 ['mainnet flag',d=>d.policy.mainnetEnabled=true,'POLICY'],
 ['unknown field',d=>d.alternateAuthority=true,'FIELDS'],
 ])test(`signed malformed ${name} is rejected`,async()=>{const d=draft();mutation(d);await assert.rejects(verifySignedEndpointAuthority(signed(d),options()),new RegExp(code));});
test('consumer ID, exact Origin and both minimum versions are enforced',async()=>{
 for(const ctx of [{...consumer,consumerId:'other'},{...consumer,origin:'https://evil.invalid'},{...consumer,clientVersion:'0.9.9'}])await assert.rejects(verifySignedEndpointAuthority(signed(),options({consumer:ctx})),/WRONG_CONSUMER|CLIENT_TOO_OLD/);
 const d=draft();d.consumers[0].minimumClientVersion='2.0.0';await assert.rejects(verifySignedEndpointAuthority(signed(d),options()),/CLIENT_TOO_OLD/);
 const r=copy(root);r.consumers[0].minimumClientVersion='2.0.0';await assert.rejects(verifySignedEndpointAuthority(signed(),options({trustRoot:r})),/CLIENT_TOO_OLD/);
});
test('pending private product is valid signed metadata but never active',async()=>{
 const d=draft();d.products.finance.status='PENDING';d.products.finance.evidence=null;d.endpoints.walletGateway.status='PENDING';d.endpoints.walletGateway.evidence=null;
 const m=await verifySignedEndpointAuthority(signed(d),options());assert.throws(()=>selectSignedAuthorityEndpoint(m,'walletGateway',{checkpoint:next(m),nowMs}),/NOT_AUTHORIZED/);assert.throws(()=>financeProductSessionAuthority(m,{checkpoint:next(m),nowMs}),/NOT_AUTHORIZED/);
});
test('sequence rollback, same-version equivocation, wrong predecessor and skipped sequence reject',async()=>{
 const one=signed(),two=following(one),checkpoint=next(two);
 await assert.rejects(verifySignedEndpointAuthority(one,options({checkpoint})),/ROLLBACK/);
 const fork=draft();fork.sequence=2;fork.manifestVersion='2.0.0.2';fork.previousPayloadSha256=one.integrity.payloadSha256;fork.issuerSource.tree='f'.repeat(40);
 await assert.rejects(verifySignedEndpointAuthority(signed(fork),options({checkpoint})),/EQUIVOCATION/);
 const wrong=following(one);wrong.previousPayloadSha256='e'.repeat(64);await assert.rejects(verifySignedEndpointAuthority(signed(wrong),options({checkpoint:next(one)})),/PREDECESSOR/);
 await assert.rejects(verifySignedEndpointAuthority(two,options()),/PREDECESSOR/);
 assert.equal((await verifySignedEndpointAuthority(two,options({checkpoint}))).sequence,2);
});
test('root anchor, version rollback and minimum key validity fail closed',async()=>{
 const one=signed(),r=copy(root);r.anchor=next(one);
 await assert.rejects(verifySignedEndpointAuthority(one,options({trustRoot:r})),/ANCHOR_ROLLBACK/);
 await assert.rejects(verifySignedEndpointAuthority(one,options({checkpoint:{...next(one),rootVersion:2}})),/ROOT_ROLLBACK/);
 const k=copy(root);k.keys[0].notAfter=iso(nowMs+100);await assert.rejects(verifySignedEndpointAuthority(one,options({trustRoot:k})),/KEY_WINDOW/);
});
test('trust root rotation can anchor a missed version, without accepting an old root again',async()=>{
 const one=signed(),two=following(one),r=copy(root);r.rootVersion=2;r.anchor={...next(one),rootVersion:2};
 const m=await verifySignedEndpointAuthority(two,options({trustRoot:r}));assert.equal(m.sequence,2);
 await assert.rejects(verifySignedEndpointAuthority(one,options({checkpoint:{...next(two),rootVersion:2}})),/ROOT_ROLLBACK/);
});
test('snapshots are immutable across crypto awaits; clone is not branded',async()=>{
 const m=signed(),o=options(),promise=verifySignedEndpointAuthority(m,o);m.endpoints.walletGateway.url='https://evil.invalid';o.trustRoot.keys=[];o.consumer.origin='https://evil.invalid';o.checkpoint.sequence=100;
 const v=await promise;assert(Object.isFrozen(v.endpoints.walletGateway));assert.equal(selectSignedAuthorityEndpoint(v,'walletGateway',{checkpoint:next(v),nowMs}),AUTHORITY_V2_URLS.walletGateway);
 assert.throws(()=>selectSignedAuthorityEndpoint(copy(v),'walletGateway',{checkpoint:next(v),nowMs}),/NOT_VERIFIED/);
});
test('endpoint use requires exact durable high-water mark, scope and fresh time',async()=>{
 const v=await verifySignedEndpointAuthority(signed(),options());
 assert.throws(()=>selectSignedAuthorityEndpoint(v,'walletGateway',{checkpoint:root.anchor,nowMs}),/NOT_CURRENT/);
 assert.throws(()=>selectSignedAuthorityEndpoint(v,'monitor',{checkpoint:next(v),nowMs}),/NOT_AUTHORIZED/);
 assert.throws(()=>selectSignedAuthorityEndpoint(v,'rpc',{checkpoint:next(v),nowMs:Date.parse(v.expiresAt)}),/EXPIRED_OR_FUTURE/);
});
test('durable client handles restart, exact replay, concurrent supersession and no fallback',async()=>{
 const store=storage(),one=signed(),two=following(one);let at=nowMs;
 const client=()=>createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>at});const a=client();
 await assert.rejects(a.endpoint('rpc'),/NOT_ACTIVE/);await a.accept(one,{source:'remote'});assert.equal(await a.endpoint('rpc'),AUTHORITY_V2_URLS.rpc);
 const b=client();await b.accept(one,{source:'bundled'});await b.accept(two,{source:'remote'});
 await assert.rejects(a.endpoint('rpc'),/NOT_CURRENT/);await assert.rejects(a.accept(one,{source:'remote'}),/ROLLBACK/);
 assert.equal((await b.financeProductSession()).manifestVersion,'2.0.0.2');at=Date.parse(two.expiresAt);await assert.rejects(b.endpoint('rpc'),/EXPIRED_OR_FUTURE/);
});
test('failed CAS and expiry while CAS awaits never expose endpoint',async()=>{
 let at=nowMs;const m=signed();const store=storage();
 const a=createEndpointAuthorityClient({trustRoot:root,consumer,clock:()=>at,storage:{read:store.read,compareAndSwap:async()=>false}});
 await assert.rejects(a.accept(m,{source:'remote'}),/CHECKPOINT_CONFLICT/);await assert.rejects(a.endpoint('rpc'),/NOT_ACTIVE/);
 const b=createEndpointAuthorityClient({trustRoot:root,consumer,clock:()=>at,storage:{read:store.read,compareAndSwap:async()=>{at=Date.parse(m.expiresAt);return true;}}});
 await assert.rejects(b.accept(m,{source:'remote'}),/EXPIRED_OR_FUTURE/);await assert.rejects(b.endpoint('rpc'),/NOT_ACTIVE/);
});
test('two simultaneous accepts share atomic checkpoint and cannot fork same sequence',async()=>{
 const store=storage();const clients=[1,2].map(()=>createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>nowMs}));const d=draft();d.issuerSource.tree='e'.repeat(40);
 const outcomes=await Promise.allSettled([clients[0].accept(signed(),{source:'remote'}),clients[1].accept(signed(d),{source:'remote'})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
});
test('accessors/unknown symbols do not execute and empty public-key example cannot activate',async()=>{
 let calls=0;const m=signed();Object.defineProperty(m,'hostile',{enumerable:true,get(){calls++;return 1;}});await assert.rejects(verifySignedEndpointAuthority(m,options()),/ACCESSOR/);assert.equal(calls,0);
 const r=JSON.parse(fs.readFileSync(new URL('../../chain-metadata/endpoint-authority/v2/trust-root.example.json',import.meta.url)));assert.equal((await authorityV2Doctor({trustRoot:r})).status,'BLOCKED_NO_PROTECTED_PUBLIC_KEY');
});
function receiptFixture(dir){
 const d=draft();delete d.consumers[0].clientVersion;
 function put(r){const body=JSON.stringify(r)+'\n',digest=sha(body);fs.writeFileSync(path.join(dir,digest+'.json'),body);return digest;}
 for(const [endpoint,e] of Object.entries(d.endpoints))if(e.status==='VERIFIED')e.evidence.receiptSha256=put({schemaVersion:'ynx-endpoint-observation/v2',endpoint,source:e.evidence.source,chainId:6423,controlledReleaseAccepted:true,health:{observation:e.evidence.health,body:'{}'},version:{observation:e.evidence.version,body:'{}'}});
 const acceptance={...d.products.finance.evidence};delete acceptance.receiptSha256;
 d.products.finance.evidence.receiptSha256=put({schemaVersion:'ynx-finance-public-acceptance/v2',acceptance,officialSandboxVerified:false,providerVerified:false,productionApproved:false});return prepareAuthorityV2Draft(d,'test-ephemeral-only');
}
test('offline issuer signs only external matching private file + reviewed digest + receipt bytes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-authority-v2-test-'));
 try{
  const d=receiptFixture(dir),keyPath=path.join(dir,'ephemeral-test-key.pem');fs.writeFileSync(keyPath,key.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
  const o={draft:d,trustRoot:root,checkpoint:root.anchor,consumer,privateKeyPath:keyPath,approvedPayloadSha256:d.integrity.payloadSha256,evidenceDirectory:dir,nowMs};
  const m=await issueAuthorityV2(o);assert.equal((await verifySignedEndpointAuthority(m,options())).sequence,1);
  assert.equal((await authorityV2Doctor({manifest:m,...options()})).status,'VERIFIED_NOT_ACTIVATED');
  await assert.rejects(issueAuthorityV2({...o,approvedPayloadSha256:'0'.repeat(64)}),/REVIEWED_DIGEST/);
  fs.chmodSync(keyPath,0o644);await assert.rejects(issueAuthorityV2(o),/KEY_FILE_PERMISSIONS/);fs.chmodSync(keyPath,0o600);
  const link=path.join(dir,'symlink.pem');fs.symlinkSync(keyPath,link);await assert.rejects(issueAuthorityV2({...o,privateKeyPath:link}));
  fs.appendFileSync(path.join(dir,d.endpoints.walletGateway.evidence.receiptSha256+'.json'),' ');assert.throws(()=>validateAuthorityV2ReceiptFiles(d,dir),/RECEIPT_HASH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI doctor prints no secret and does not fetch or activate',()=>{
 const p=new URL('../../scripts/ops/endpoint-authority-v2.mjs',import.meta.url);const r=new URL('../../chain-metadata/endpoint-authority/v2/trust-root.example.json',import.meta.url);
 const out=JSON.parse(execFileSync(process.execPath,[fileURLToPath(p),'doctor','--trust-root',fileURLToPath(r)],{encoding:'utf8'}));assert.equal(out.activated,false);assert.equal(out.networkCalls,0);assert.equal(out.status,'BLOCKED_NO_PROTECTED_PUBLIC_KEY');
 const failed=spawnSync(process.execPath,[fileURLToPath(p),'issue','--trust-root',fileURLToPath(r)],{encoding:'utf8'});assert.equal(failed.status,1);assert.equal(JSON.parse(failed.stderr).activated,false);
});
test('array accessors are rejected without invoking them',async()=>{
 let calls=0;const m=signed();Object.defineProperty(m.consumers,'0',{enumerable:true,get(){calls++;return consumer;}});
 await assert.rejects(verifySignedEndpointAuthority(m,options()),/ACCESSOR/);assert.equal(calls,0);
});
test('invalidate while checkpoint lookup is pending prevents stale endpoint exposure',async()=>{
 const store=storage(),m=signed();let deferred=null;
 const client=createEndpointAuthorityClient({trustRoot:root,consumer,clock:()=>nowMs,storage:{...store,read:()=>deferred?new Promise(resolve=>{deferred.resolve=resolve;}):store.read()}});
 await client.accept(m,{source:'remote'});deferred={};const pending=client.endpoint('walletGateway');client.invalidate();deferred.resolve(next(m));await assert.rejects(pending,/SUPERSEDED/);
});
test('client snapshots manifest before asynchronous checkpoint load',async()=>{
 const m=signed(),store=storage();let release;
 const c=createEndpointAuthorityClient({trustRoot:root,consumer,clock:()=>nowMs,storage:{...store,read:()=>new Promise(resolve=>release=resolve)}});
 const pending=c.accept(m,{source:'remote'});m.issuerSource.tree='a'.repeat(40);release(copy(root.anchor));assert.equal((await pending).issuerSource.tree,'2'.repeat(40));
});
test('published v2 schemas preserve exact manifest/trust fields and signature scopes',()=>{
 const schema=JSON.parse(fs.readFileSync(new URL('../../chain-metadata/endpoint-authority/v2/schema.json',import.meta.url)));
 const trust=JSON.parse(fs.readFileSync(new URL('../../chain-metadata/endpoint-authority/v2/trust-root.schema.json',import.meta.url)));
 assert.deepEqual([...schema.required].sort(),Object.keys(signed()).sort());assert.deepEqual([...trust.required].sort(),Object.keys(root).sort());
 assert.deepEqual(Object.keys(schema.properties.endpoints.properties).sort(),Object.keys(AUTHORITY_V2_URLS).sort());
 assert.equal(schema.properties.integrity.properties.algorithm.const,'Ed25519');
 for(const variant of schema.properties.products.properties.finance.oneOf)for(const k of ['officialSandboxVerified','providerVerified','productionApproved'])assert.equal(variant.properties[k].const,false);
});
test('unpaired Unicode is rejected and valid surrogate pairs canonicalize',()=>{
 const m=signed();m.issuerSource.repository='bad\ud800';assert.throws(()=>assertAuthorityV2Manifest(m,{nowMs}),/INVALID_UNICODE/);
 m.issuerSource.repository='bad\udc00';assert.throws(()=>assertAuthorityV2Manifest(m,{nowMs}),/INVALID_UNICODE/);
 assert.equal(canonicalAuthorityV2Payload({text:'\ud83d\ude00',integrity:{}}),' {"text":"😀"}'.trim());
});
test('shared v2 validate cannot fill missing trusted time from Date.now',async()=>{
 const m=signed(),o=options();delete o.nowMs;
 const original=Date.now;Date.now=()=>nowMs;
 try{
  await assert.rejects(verifySignedEndpointAuthority(m,o),/CLOCK_REQUIRED/);
  await assert.rejects(validateEndpointAuthority(m,{...o,source:'remote'}),/CLOCK_REQUIRED/);
  await assert.rejects(validateEndpointAuthority(m,{...o,source:'bundled'}),/CLOCK_REQUIRED/);
  await assert.rejects(validateEndpointAuthority(m,{...o,nowMs:undefined}),/CLOCK_REQUIRED/);
  assert.equal((await validateEndpointAuthority(m,options())).sequence,1);
 }finally{Date.now=original;}
});
test('shared v2 select cannot fill missing trusted time from Date.now',async()=>{
 const m=await verifySignedEndpointAuthority(signed(),options());
 const original=Date.now;Date.now=()=>nowMs;
 try{
  assert.throws(()=>selectSignedAuthorityEndpoint(m,'rpc',{checkpoint:next(m)}),/CLOCK_REQUIRED/);
  assert.throws(()=>selectAuthorityEndpoint(m,'rpc',{checkpoint:next(m)}),/CLOCK_REQUIRED/);
  assert.throws(()=>selectAuthorityEndpoint(m,'rpc',{checkpoint:next(m),nowMs:undefined}),/CLOCK_REQUIRED/);
  assert.throws(()=>selectAuthorityEndpoint(m,'rpc',{checkpoint:next(m),nowMs:Date.parse(m.expiresAt)}),/EXPIRED_OR_FUTURE/);
 }finally{Date.now=original;}
});
test('controlled client clock regression invalidates active and in-flight use',async()=>{
 let at=nowMs,reads=0;const store=storage(),m=signed();
 const client=createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>{reads++;return at;}});
 await client.accept(m,{source:'remote'});assert.equal(reads,3);
 at=nowMs+100;await client.endpoint('rpc');assert.equal(reads,4);
 at=nowMs;await assert.rejects(client.financeProductSession(),/CLOCK_ROLLBACK/);
 await assert.rejects(client.endpoint('rpc'),/NOT_ACTIVE/);
 client.invalidate();await assert.rejects(client.accept(m,{source:'remote'}),/CLOCK_ROLLBACK/);
 at=nowMs+200;await client.accept(m,{source:'remote'});assert.equal(await client.endpoint('rpc'),AUTHORITY_V2_URLS.rpc);
});
test('clock rollback cannot revive an observed expired authority',async()=>{
 let at=nowMs;const store=storage(),m=signed();
 const client=createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>at});
 await client.accept(m,{source:'remote'});
 at=Date.parse(m.expiresAt);await assert.rejects(client.endpoint('rpc'),/EXPIRED_OR_FUTURE/);
 at=nowMs;await assert.rejects(client.endpoint('rpc'),/CLOCK_ROLLBACK/);
 await assert.rejects(client.accept(m,{source:'remote'}),/CLOCK_ROLLBACK/);
 at=Date.parse(m.expiresAt);await assert.rejects(client.accept(m,{source:'remote'}),/EXPIRED_OR_FUTURE/);
});
test('clock regression during durable CAS cannot expose a verified candidate',async()=>{
 let at=nowMs;const store=storage(),m=signed();
 const client=createEndpointAuthorityClient({trustRoot:root,consumer,clock:()=>at,storage:{read:store.read,compareAndSwap:async(previous,next)=>{const committed=await store.compareAndSwap(previous,next);at--;return committed;}}});
 await assert.rejects(client.accept(m,{source:'remote'}),/CLOCK_ROLLBACK/);
 await assert.rejects(client.endpoint('rpc'),/NOT_ACTIVE/);
 assert.equal((await store.read()).sequence,1); // The durable high-water mark is never undone.
});
test('clock-provider lifecycle invalidation cannot reactivate a candidate',async()=>{
 const store=storage(),m=signed();let reads=0,client;
 client=createEndpointAuthorityClient({trustRoot:root,consumer,storage:store,clock:()=>{if(++reads===3)client.invalidate();return nowMs;}});
 await assert.rejects(client.accept(m,{source:'remote'}),/SUPERSEDED/);await assert.rejects(client.endpoint('rpc'),/NOT_ACTIVE/);
});
