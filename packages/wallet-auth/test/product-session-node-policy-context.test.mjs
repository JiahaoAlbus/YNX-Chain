import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {p256} from '@noble/curves/nist.js';
import {canonicalJSON} from '../src/canonical.js';
import {ynxAddressFromEVM} from '../src/crypto.js';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {createProductSessionRequest,signProductSessionChallenge,signProductSessionApproval} from '../src/product-session-v2.js';
import {createPQWalletKeyHandle,destroyPQWalletKeyHandle,readPQWalletKeyPublic,signPQWalletProductSessionApproval} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {captureProductSessionAccountPolicy,pqProductSessionRegisteredPublicBinding} from '../src/product-session-account-policy.js';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval} from '../src/product-session-pq-approval.js';
import {createProductSessionReturnURL,parseProductSessionReturnURL} from '../src/product-session-router.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
const at=new Date('2026-10-18T00:00:00.000Z'),device=Buffer.alloc(32,7);
const base={productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['finance.portfolio.read'],purpose:'Explicit account session',nonce:'b'.repeat(43),state:'c'.repeat(43)};
async function serve(host){const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:`http://127.0.0.1:${server.address().port}`};}
async function post(server,path,body,id){const r=await fetch(server.url+path,{method:'POST',headers:{'content-type':'application/json','x-request-id':id},body:canonicalJSON(body)});return {status:r.status,body:await r.json()};}
async function close(server){server.server.closeAllConnections();await new Promise(resolve=>server.server.close(resolve));}
// Actual original NodeHost/atomic filesystem/listener. Source is explicitly
// synthetic QA only; this is neither a live factory nor Native qualification.
test('original NodeHost request-local PQ context persists/cold-recovers without leaking capabilities or allowing old/cached/late entry',async()=>{
 const network={chainId:'71'.repeat(32),owner:'0x'+'11'.repeat(20)},account=ynxAddressFromEVM(network.owner),handle=await createPQWalletKeyHandle(network),dir=mkdtempSync(join(tmpdir(),'ynx-pq-node-'));
 let server;
 try{
  const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));let retired=false;
  const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network.chainId,canonicalOwner:network.owner,checkpoint:{kind:'trusted-node-committed/v1',height:'9007199254740993',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:'1',registeredAt:'10',activeFrom:'20',pkA:keys.pkA,pkB:keys.pkB},observedAt:at.toISOString(),expiresAt:'2026-10-18T00:00:30.000Z'};
  const resource={readOriginal:()=>view,assertCurrent(){if(retired)throw Error('QA retired');},async recheck(){this.assertCurrent();},retire(){retired=true;},async join(){},async close(){}};
  const observation=captureProductSessionAccountPolicy(resource,{networkId:network.chainId,account},at);
  assert.deepEqual(pqProductSessionRegisteredPublicBinding(observation,account,at),readPQWalletKeyPublic(handle));
  const request=createProductSessionRequest(registry,base,at),plan=preparePQProductSessionApproval(registry,request,{account,expiresAt:request.expiresAt},observation,at),approval=signPQWalletProductSessionApproval(handle,plan,at),verified=verifyPQProductSessionApproval(registry,request,approval,observation,at);
  assert(Buffer.byteLength(canonicalJSON({request,approval}))>65536); // Existing Native private budget is NOT silently enlarged.
  const context={observation,verifiedApproval:verified.verifiedApproval,required:true};let mode='normal',late,calls=0,clock=at;
  assert.throws(()=>createProductSessionReturnURL(registry,request,{result:'approved',approval},at),{code:'PQ_SESSION_VERIFICATION_REQUIRED'});
  const callback=createProductSessionReturnURL(registry,request,{result:'approved',approval},at,verified.verifiedApproval);assert(callback.length>4096&&callback.length<=262144);
  assert.deepEqual(parseProductSessionReturnURL(registry,request,callback,at,verified.verifiedApproval).approval,approval);
  assert.throws(()=>parseProductSessionReturnURL(registry,request,callback,at),{code:'CALLBACK_MISMATCH'});
  assert.equal(parseProductSessionReturnURL(registry,request,callback,at,{}).status,'callback-mismatch');
  const wrongCallback=new URL(callback);wrongCallback.searchParams.set('state','z'.repeat(43));assert.equal(parseProductSessionReturnURL(registry,request,wrongCallback.toString(),at,verified.verifiedApproval).status,'callback-mismatch');
  const config={mode:'required',async run(operation,execute){calls++;assert.equal(operation.method,'POST');assert.equal(typeof operation.at,'string');
   if(mode==='missing')return;
   if(mode==='late'){late=execute;return;}
   if(mode==='false-required'){execute({...context,required:false});return;}
   await resource.recheck();if(mode==='advance-clock')clock=new Date('2026-10-18T00:00:31.000Z');assert.equal(execute(context),undefined);
   if(mode==='double'){try{execute(context);}catch{ /* cannot suppress a second execution refusal */ }}
   if(mode==='post-failure')throw Error('QA post-effect current failure');
   await resource.recheck();
  }};
  const options={statePath:join(dir,'state.json'),now:()=>clock,tokenFactory:()=>'d'.repeat(43),accountPolicy:config};
  let host=new ProductSessionGatewayNodeHost(registry,options);server=await serve(host);
  const first=await post(server,'/v2/product-sessions/challenge',{request,approval},'req_node_pq_challenge_01');assert.equal(first.status,200);
  assert.equal(first.body.result.account,account);assert(!JSON.stringify(host.snapshot()).includes('observation'));
  await close(server);server=null;host=new ProductSessionGatewayNodeHost(registry,options);server=await serve(host);
  const completion=signProductSessionChallenge(first.body.result,device.toString('base64url')),body={request,approval,completion};
  const completed=await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01');assert.equal(completed.status,200);assert.equal(completed.body.result.version,'3');
  const session=completed.body.result;
  const current=host.revalidate(session,session.scopes,session.productId,at,false,context);assert.equal(current.active,true);
  const other=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},at);
  const cross=await post(server,'/v2/product-sessions/challenge',{request,approval:other},'req_node_other_account_1');assert.notEqual(cross.status,200);assert.equal(cross.body.error.code,'ACCOUNT_POLICY_OWNER_MISMATCH');
  assert.throws(()=>host.revalidate(session,session.scopes,session.productId,at),{code:'ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED'});
  mode='missing';assert.notEqual((await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01')).status,200);
  mode='false-required';assert.notEqual((await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01')).status,200);
  mode='late';assert.notEqual((await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01')).status,200);
  const beforeLate=JSON.stringify(host.snapshot());assert.throws(()=>late(context),{code:'ACCOUNT_POLICY_EXECUTION_ALREADY_ENTERED'});assert.equal(JSON.stringify(host.snapshot()),beforeLate);
  mode='double';assert.notEqual((await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01')).status,200);
  mode='post-failure';assert.notEqual((await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01')).status,200);
  mode='normal';assert.equal((await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01')).status,200);
  assert.equal(host.snapshot().authority.sessions.length,1);assert(calls>=8);
  mode='advance-clock';const stale=await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01');assert.notEqual(stale.status,200);assert.equal(stale.body.error.code,'ACCOUNT_POLICY_EXPIRED');
  assert.throws(()=>host.revalidate(session,session.scopes,session.productId,at,false,context),{code:'ACCOUNT_POLICY_EXPIRED'}); // Old external at cannot cross the awaited source deadline.
  retired=true;assert.notEqual((await post(server,'/v2/product-sessions/complete',body,'req_node_pq_complete_01')).status,200);
  assert.throws(()=>pqProductSessionRegisteredPublicBinding(observation,account,at),/QA retired/);
 }finally{if(server)await close(server);destroyPQWalletKeyHandle(handle);rmSync(dir,{recursive:true,force:true});}
});
test('required NodeHost preserves lawful unmigrated classic approval but refuses its cached response after PQ activation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ynx-pq-classic-node-'));let server;
 try{
  const request=createProductSessionRequest(registry,base,at),approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},at);
  const expected={networkId:'71'.repeat(32),account:approval.account};let active=false;
  const config={mode:'required',async run(operation,execute){
   const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:expected.networkId,canonicalOwner:'0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:active?'YNX-BATCH/v0.1':'legacy',activeRecord:active?{revision:'1',registeredAt:'10',activeFrom:'20',pkA:'01'.repeat(2592),pkB:'02'.repeat(64)}:null,observedAt:at.toISOString(),expiresAt:'2026-10-18T00:00:30.000Z'};
   const resource={readOriginal:()=>view,assertCurrent(){},async recheck(){},retire(){},async join(){},async close(){}};
   const observation=captureProductSessionAccountPolicy(resource,expected,at);
   if(!active)assert.throws(()=>pqProductSessionRegisteredPublicBinding(observation,approval.account,at),{code:'ACTIVE_PQ_ACCOUNT_REQUIRED'});
   execute({observation,verifiedApproval:null,required:true});
  }};
  const host=new ProductSessionGatewayNodeHost(registry,{now:()=>at,statePath:join(dir,'state.json'),tokenFactory:()=>'d'.repeat(43),accountPolicy:config,centralBrowser:true});server=await serve(host);
  const central=await post(server,'/v2/browser-sessions/bootstrap',{},'req_node_central_no_ctx');assert.notEqual(central.status,200);assert.equal(central.body.error.code,'ACCOUNT_POLICY_CENTRAL_CONTEXT_NOT_SUPPLIED');
  assert.equal((await post(server,'/v2/product-sessions/challenge',{request,approval},'req_node_classic_cached_1')).status,200);
  active=true;
  const denied=await post(server,'/v2/product-sessions/challenge',{request,approval},'req_node_classic_cached_1');
  assert.notEqual(denied.status,200);assert.equal(denied.body.error.code,'ACTIVE_PQ_CLASSIC_SESSION_REFUSED');
 }finally{if(server)await close(server);rmSync(dir,{recursive:true,force:true});}
});
