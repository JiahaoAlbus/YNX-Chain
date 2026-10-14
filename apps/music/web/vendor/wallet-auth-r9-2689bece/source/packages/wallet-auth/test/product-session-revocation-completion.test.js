import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';import {randomBytes} from 'node:crypto';import {createServer} from 'node:http';import {p256} from '@noble/curves/nist.js';
import {createCentralBrowserSessionRegistry,centralBrowserClient} from '../src/central-browser-session-registry.js';
import {pathToFileURL} from 'node:url';
const nativeAPI=process.env.YNX_NATIVE_QA_ARTIFACT?await import(pathToFileURL(resolve(process.env.YNX_NATIVE_QA_ARTIFACT)).href):await import('@ynx-chain/wallet-auth/product-session-native');
const {createNativeProductSessionClient}=nativeAPI;
import {ProductSessionGatewayFetchAdapter as SourceGatewayFetchAdapter} from '../src/product-session-gateway-client.js';import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';import {signProductSessionApproval} from '../src/product-session-v2.js';import {createProductSessionReturnURL} from '../src/product-session-router.js';import {walletIdentity} from '../src/crypto.js';import {canonicalJSON} from '../src/canonical.js';import {httpBodyDigest} from '../src/session-proof.js';import {verifyProductSessionProofV2} from '../src/product-session-proof-v2.js';import {createRevocationIntent,parseRevocationIntent,revocationSessionMatches} from '../src/product-session-revocation-intent.js';
const ProductSessionGatewayFetchAdapter=process.env.YNX_NATIVE_QA_ARTIFACT?nativeAPI.ProductSessionGatewayFetchAdapter:SourceGatewayFetchAdapter;
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url))),walletSecret='1'.padStart(64,'0');
const evidence=resolve(process.env.YNX_NATIVE_QA_DIR||'/tmp/ynx-durable-revocation-qa');mkdirSync(evidence,{recursive:true});let fixtureId=0;const observations=[];
async function fixture(platform='android',productId='social',scopes=['account:read','profile:link','social.ai','social.contacts','social.feed','social.messaging','social.profile']){
 const now=new Date(),directory=join(evidence,'case-'+ ++fixtureId+'-'+randomBytes(4).toString('hex'));mkdirSync(directory,{recursive:true,mode:0o700});const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'gateway-state.json'),now:()=>now,tokenFactory:()=>randomBytes(32).toString('base64url')});const server=createServer(host.handler());await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,values=new Map(),pending=new Map(),device=randomBytes(32),calls=[],deviceKey=Buffer.from(p256.getPublicKey(device,true)).toString('base64url');let generation=1,account=walletIdentity(walletSecret).account,late=null;
 const getContext=()=>({platform,applicationId:registry.products.find(p=>p.productId===productId).applicationId,deviceId:'native_'+randomDeviceId,deviceKey,securityLevel:'os-protected',generation,account});const randomDeviceId=randomBytes(32).toString('base64url');const map=n=>{if(!values.has(n))values.set(n,new Map());return values.get(n)};const guard=expected=>assert.equal(canonicalJSON(getContext()),canonicalJSON(expected));
 const storage={async get(n,k,c){guard(c);return map(n).get(k)??null},async set(n,k,v,c){guard(c);map(n).set(k,v)},async remove(n,k,c){guard(c);map(n).delete(k)},requestRevocation(n,c){guard(c);pending.set(n,true)},revocationRequested(n,c){guard(c);return pending.get(n)===true},async saveRevocationIntent(n,k,raw,c){guard(c);const previous=map(n).get(k);if(previous){const a=JSON.parse(previous),b=JSON.parse(raw);if(a.intentId===b.intentId&&a.session===null&&b.session!==null)map(n).set(k,raw);return map(n).get(k)}map(n).set(k,raw);return raw},async finishRevocationIntent(n,k,raw,c){guard(c);assert.equal(map(n).get(k),raw);const intent=JSON.parse(raw),key=k.slice(0,-7),current=map(n).get(key)??null;if(current===null||revocationSessionMatches(current,intent.session)){map(n).delete(key);for(const suffix of ['pending','return','completion'])map(n).delete(key+':'+suffix)}map(n).delete(k);pending.set(n,false)}};
 const runtime={readContext:getContext,randomBytes:n=>new Uint8Array(randomBytes(n)),storage,async sign(input,c){guard(c);calls.push(input.purpose);if(late)await late.promise;guard(c);return Buffer.from(p256.sign(Buffer.from(input.payload,'base64url'),device,{format:'der'})).toString('base64url')},async openWallet(input,c){guard(c);calls.push('open-wallet');assert.ok(input.url.startsWith('ynxwallet://authorize?'));return{opened:true}}};
 const gateway=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:async(url,options)=>{const response=await fetch(base+new URL(url).pathname,options);return response},walletInstalled:async()=>true,schemeRegistered:async()=>true,timeoutMs:5000});const config={registry,productId,platform,scopes,purpose:'Explicit Native private product use',gateway,runtime,clock:()=>now};
 const returned=request=>createProductSessionReturnURL(registry,request,{result:'approved',approval:signProductSessionApproval(registry,request,{accountSecret:walletSecret,scopes:request.scopes,expiresAt:request.expiresAt},now)},now);
 return{config,runtime,gateway,host,values,calls,returned,clearSignal(n){pending.set(n,false)},async client(){return createNativeProductSessionClient(config)},flip(){generation++},accountChange(){account=walletIdentity('2'.padStart(64,'0')).account},stall(){let release;late={promise:new Promise(r=>release=r)};return()=>{late=null;release()}},close:()=>new Promise(r=>server.close(r))};
}

import {productPlatformBinding} from '../src/product-session-registry.js';
import {appendRevocationCompletion,readRevocationCompletions,parseRevocationCompletion} from '../src/product-session-revocation-intent.js';
function atomicPorts(f,{crash=false,lie=false}={}){
 const binding=productPlatformBinding(registry,f.config.productId,f.config.platform),ctx=f.runtime.readContext(),device={id:ctx.deviceId,key:ctx.deviceKey,scopes:f.config.scopes};
 const maps=n=>f.values.get(n),guard=c=>assert.equal(canonicalJSON(f.runtime.readContext()),canonicalJSON(c));
 return {...f.runtime.storage,
 async getRevocationCompletions(n,k,c){guard(c);return maps(n)?.get(k)??null},
 async acknowledgeRevocationCompletion(n,k,raw,c){guard(c);const records=readRevocationCompletions(maps(n)?.get(k)??null,binding,device),r=parseRevocationCompletion(raw,binding,device),match=records.find(x=>x.intentId===r.intentId);if(match)assert.equal(canonicalJSON(match),raw);maps(n).set(k,canonicalJSON(records.filter(x=>x.intentId!==r.intentId)))},
 async finishRevocationIntentWithCompletion(n,k,raw,receipt,c){guard(c);if(lie)return receipt;const map=maps(n),key=k.slice(0,-7),historyKey=key+':revoke-completions';assert.equal(map.get(k),raw);const history=appendRevocationCompletion(map.get(historyKey)??null,receipt,binding,device);const intent=JSON.parse(raw),current=map.get(key)??null;
 if(current===null||revocationSessionMatches(current,intent.session)){map.delete(key);for(const suffix of ['pending','return','completion'])map.delete(key+':'+suffix)}
 // Controlled port model: all updates occur synchronously at one commit point.
 // A real OS store must supply its own durable transaction, not this Map.
 map.set(historyKey,history);map.delete(k);f.clearSignal(n);if(crash)throw Error('QA crash after atomic protected commit, before JS return');return receipt}
 };
}
test('durable completion survives crash after atomic target cleanup, cold client reads exact server-revoked target',async()=>{
 const f=await fixture();try{
 const runtime={...f.runtime,storage:atomicPorts(f,{crash:true})},c=await createNativeProductSessionClient({...f.config,runtime}),pending=await c.beginExplicit();await c.handleReturn(f.returned(pending.request));const binding=c.current.session.sessionBinding;
 assert.equal((await c.disconnect()).status,'retry-required');assert.equal(f.host.snapshot().authority.revokedSessions.length,1);
 const cold=await createNativeProductSessionClient({...f.config,runtime:{...f.runtime,storage:atomicPorts(f)}}),records=await cold.getRevocationCompletions();assert.equal(records.length,1);assert.equal(records[0].outcome,'server-revoked');assert.equal(records[0].sessionBinding,binding);
 assert.deepEqual(await cold.getRevocationCompletion(records[0].intentId),records[0]);assert.equal(await cold.getRevocationCompletion('z'.repeat(43)),null);
 const forged={...records[0],targetDigest:'1'.repeat(64)};await assert.rejects(cold.acknowledgeRevocationCompletion(forged));assert.equal((await cold.getRevocationCompletions()).length,1);
 await cold.acknowledgeRevocationCompletion(records[0]);assert.equal((await cold.getRevocationCompletions()).length,0);
 }finally{await f.close()}
});
test('lying atomic completion port cannot release success or delete retained original target',async()=>{
 const f=await fixture();try{const c=await createNativeProductSessionClient({...f.config,runtime:{...f.runtime,storage:atomicPorts(f,{lie:true})}}),pending=await c.beginExplicit();await c.handleReturn(f.returned(pending.request));const s=await c.disconnect();assert.equal(s.revocationPending,true);assert.equal((await c.getRevocationCompletions()).length,0);assert.ok([...f.values.values()].some(m=>[...m.keys()].some(k=>k.endsWith(':revoke'))))}finally{await f.close()}
});
test('legacy ports explicitly lack durable history; incomplete capability and changed context are rejected',async()=>{
 const f=await fixture();try{const old=await f.client();await assert.rejects(old.getRevocationCompletions(),{code:'DURABLE_REVOCATION_COMPLETION_UNSUPPORTED'});
 await assert.rejects(createNativeProductSessionClient({...f.config,runtime:{...f.runtime,storage:{...f.runtime.storage,getRevocationCompletions:async()=>null}}}),{code:'INSECURE_STORAGE'});
 const current=await createNativeProductSessionClient({...f.config,runtime:{...f.runtime,storage:atomicPorts(f)}});f.flip();await assert.rejects(current.getRevocationCompletions(),{code:'NATIVE_CONTEXT_CHANGED'});
 }finally{await f.close()}
});
test('local-only durable cleanup never claims server revocation',async()=>{
 const f=await fixture();try{const c=await createNativeProductSessionClient({...f.config,runtime:{...f.runtime,storage:atomicPorts(f)}});const s=await c.disconnect();assert.equal(s.revocationConfirmed,false);assert.equal(s.revocationCompletion.outcome,'local-only');assert.equal(s.revocationCompletion.targetDigest,null);assert.equal(f.host.snapshot().authority.revokedSessions.length,0)}finally{await f.close()}
});

import vm from 'node:vm';
import {createRevocationCompletion} from '../src/product-session-revocation-intent.js';
import {WalletAuthError} from '../src/canonical.js';
test('exact Browser storage handlers atomically preserve completion; bounded full history keeps intent and newer session',async()=>{
 const f=await fixture();try{
 const c=await f.client(),pending=await c.beginExplicit();await c.handleReturn(f.returned(pending.request));const session=c.current.session,binding=productPlatformBinding(registry,'social','android'),context=f.runtime.readContext(),device={id:context.deviceId,key:context.deviceKey,scopes:f.config.scopes};
 const raw=canonicalJSON(createRevocationIntent(binding,device,'a'.repeat(43),session)),receipt=canonicalJSON(createRevocationCompletion(raw,binding,device,'server-revoked'));
 const storageKey='qa.storage',revocationKey=storageKey+':revoke',completionKey=storageKey+':revoke-completions',namespace='qa.namespace';let committed={values:{[storageKey]:canonicalJSON(session),[revocationKey]:raw}},abort=false;
 const stateOperation=async(mode,operation)=>{const state=structuredClone(committed);const result=operation({state,states:{put(){}}});if(mode==='readwrite'){if(abort)throw Error('QA transaction abort');committed=state}return result};
 const browser=readFileSync(new URL('../src/product-session-browser.js',import.meta.url),'utf8');const body=browser.slice(browser.indexOf('    const storage = Object.freeze({'),browser.indexOf('    const client = new RecoverableProductSessionClient('));
 const ports=vm.runInNewContext(body+';storage',{BROWSER_PRODUCT_SESSION_SECURITY_LEVEL:'webcrypto-nonextractable',binding,device,storageKey,revocationKey,completionKey,namespace,stateOperation,canonicalJSON,parseRevocationIntent,revocationSessionMatches,createRevocationCompletion,parseRevocationCompletion,readRevocationCompletions,appendRevocationCompletion,signals:{finish(){}},fail:(code,message)=>{throw new WalletAuthError(code,message)},assertStorageKey(){},assertStoredValue(){},revocationAttempted:false});
 abort=true;await assert.rejects(ports.finishRevocationIntentWithCompletion(revocationKey,raw,receipt));assert.equal(committed.values[revocationKey],raw);assert.equal(committed.values[completionKey],undefined);abort=false;
 await ports.finishRevocationIntentWithCompletion(revocationKey,raw,receipt);assert.equal(committed.values[storageKey],undefined);assert.equal(committed.values[revocationKey],undefined);assert.equal(await ports.getRevocationCompletion(completionKey,'a'.repeat(43)),receipt);
 // A cold consumer reads persisted history without network or reissuing revoke.
 assert.equal(readRevocationCompletions(await ports.getRevocationCompletions(completionKey),binding,device).length,1);
 const local=canonicalJSON(createRevocationIntent(binding,device,'b'.repeat(43),null)),localReceipt=canonicalJSON(createRevocationCompletion(local,binding,device,'local-only'));committed.values[revocationKey]=local;committed.values[storageKey]=canonicalJSON(session);committed.values[storageKey+':pending']='NEWER_REQUEST';await ports.finishRevocationIntentWithCompletion(revocationKey,local,localReceipt);assert.equal(committed.values[storageKey],canonicalJSON(session));assert.equal(committed.values[storageKey+':pending'],'NEWER_REQUEST');
 const records=Array.from({length:64},(_,i)=>createRevocationCompletion(canonicalJSON(createRevocationIntent(binding,device,('id'+i).padEnd(43,'x'),null)),binding,device,'local-only'));committed.values[completionKey]=canonicalJSON(records);committed.values[revocationKey]=local;
 await assert.rejects(ports.finishRevocationIntentWithCompletion(revocationKey,local,localReceipt),{code:'REVOCATION_COMPLETION_FULL'});assert.equal(committed.values[revocationKey],local);assert.equal(readRevocationCompletions(committed.values[completionKey],binding,device).length,64);
 }finally{await f.close()}
});

test('SDK blocks forged acknowledgement before a defective delete-by-ID native port can lose the original receipt',async()=>{
 const f=await fixture();try{
 const ports=atomicPorts(f);let calls=0;
 ports.acknowledgeRevocationCompletion=async(n,k,raw,c)=>{calls++;assert.equal(canonicalJSON(c),canonicalJSON(f.runtime.readContext()));const records=JSON.parse(f.values.get(n).get(k));f.values.get(n).set(k,canonicalJSON(records.filter(r=>r.intentId!==JSON.parse(raw).intentId)))};
 const c=await createNativeProductSessionClient({...f.config,runtime:{...f.runtime,storage:ports}}),pending=await c.beginExplicit();await c.handleReturn(f.returned(pending.request));await c.disconnect();const receipt=(await c.getRevocationCompletions())[0];
 await assert.rejects(c.acknowledgeRevocationCompletion({...receipt,targetDigest:'9'.repeat(64)}),{code:'REVOCATION_CHANGED'});assert.equal(calls,0);assert.deepEqual((await c.getRevocationCompletions())[0],receipt);
 await c.acknowledgeRevocationCompletion(receipt);assert.equal(calls,1);assert.equal((await c.getRevocationCompletions()).length,0);await c.acknowledgeRevocationCompletion(receipt);assert.equal(calls,1);
 }finally{await f.close()}
});
