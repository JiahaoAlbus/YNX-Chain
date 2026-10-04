import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {createPrivateAccountController,validateAccountSnapshot} from '../web/private-account-controller.js';
import {createExchangePrivateAccount,PRIVATE_SDK_SOURCE} from '../web/private-session-entry.js';
const origin='https://exchange.ynxweb4.com',account='ynx1'+'q'.repeat(38),other='ynx1'+'p'.repeat(38);
const snapshot=(owner=account)=>({sourceMetadata:{authority:'YNX-owned deterministic order state',version:'exchange-public-state-v1',classification:'testnet',status:'degraded_single_host',stateBackend:'file-cas-single-host',multiInstance:false,coverage:'account-ledger-orders-trades-fees-audit',asOf:new Date().toISOString()},balances:[{account:owner,asset:'YUSD_TEST',availableMicro:1234567,reservedMicro:0}],ledger:[],depositIntents:[],orders:[],trades:[],fees:[],deposits:[],withdrawals:[],support:[],ai:[],audit:[],security:{account:owner,withdrawalLock:false,sessionTtlMinutes:15}});
const connected=(owner=account)=>({status:'connected',session:{productId:'exchange',origin,chainId:'ynx_6423-1',account:owner,scopes:['exchange:read'],expiresAt:new Date(Date.now()+60000).toISOString()}});
const pending=()=>({status:'connecting',automatic:false,installation:'unverified',request:{expiresAt:new Date(Date.now()+60000).toISOString()},route:{status:'ready',url:'ynxwallet://authorize?request=exact-offline-fixture'}});
test('actual Chromium controller forwards host-only SSO cookie to owned Go API and linked logout fails closed',{skip:process.env.YNX_EXCHANGE_CONTROLLER_HTTP_QA!=='1'&&'Opt-in isolated Go/Chromium boundary QA not requested',timeout:25000},async()=>{
  const {chromium}=await import('playwright'),root=fileURLToPath(new URL('../../../',import.meta.url));
  const child=spawn('go',['test','./internal/exchangeproduct','-run','^TestBrowserSSOV10OwnedReadsAndDurableProductRevocation$','-count=1','-v'],{cwd:root,env:{...process.env,YNX_EXCHANGE_CONTROLLER_HTTP_QA:'1'},stdio:['ignore','pipe','pipe']});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});let browser,base;
  try{
    base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('controller QA startup deadline'))},15000);child.stdout.on('data',chunk=>{output=(output+chunk).slice(-8192);const match=output.match(/EXCHANGE_CONTROLLER_QA_LISTEN=(http:\/\/127\.0\.0\.1:[0-9]+)/u);if(match){clearTimeout(timer);resolve(match[1])}});child.on('close',()=>{clearTimeout(timer);reject(new Error('controller QA ended before readiness'))})});
    browser=await chromium.launch(await financeBrowserLaunchOptions());const context=await browser.newContext(),page=await context.newPage();
    const cdp=await context.newCDPSession(page);await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    cdp.on('Fetch.requestPaused',async({requestId,request})=>{try{
      const url=new URL(request.url);if(url.origin!==origin)throw new Error('unregistered QA network');let response;
      if(url.pathname==='/fixture')response=new Response('<!doctype html><title>Isolated controller boundary QA</title>',{headers:{'content-type':'text/html'}});
      else if(url.pathname==='/controller.js')response=new Response(readFileSync(new URL('../web/private-account-controller.js',import.meta.url),'utf8'),{headers:{'content-type':'text/javascript'}});
      else if(url.pathname==='/market-data.js')response=new Response(readFileSync(new URL('../web/market-data.js',import.meta.url),'utf8'),{headers:{'content-type':'text/javascript'}});
      else{const path=url.pathname==='/api/v1/account'?'/v1/account':url.pathname,headers={...request.headers};for(const key of Object.keys(headers))if(['host','content-length','accept-encoding'].includes(key.toLowerCase()))delete headers[key];response=await fetch(base+path+url.search,{method:request.method,headers,body:request.postData||undefined,redirect:'manual',signal:AbortSignal.timeout(5000)});}
      const responseHeaders=[...response.headers].filter(([key])=>!['transfer-encoding','content-encoding','content-length','set-cookie'].includes(key)).map(([name,value])=>({name,value}));for(const value of response.headers.getSetCookie())responseHeaders.push({name:'set-cookie',value});
      await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders,body:Buffer.from(await response.arrayBuffer()).toString('base64')});
    }catch{await cdp.send('Fetch.failRequest',{requestId,errorReason:'Failed'}).catch(()=>{});}});
    await page.goto(origin+'/fixture');
    const installController=()=>page.evaluate(async()=>{
      const {createPrivateAccountController}=await import('/controller.js');let nonce=0,who='alice';
      const fixture=async()=>await(await fetch('/__qa/proof?who='+who+'&nonce='+String(++nonce).padStart(24,'0'))).json();
      // Original cookie-binding service fixture is not the canonical dual-proof
      // dispatcher. Its extra action header is controlled orchestration only.
      const adapter={client:{restore:async()=>({status:'connected',session:(await fixture()).session})},createBusinessProof:async()=>({introspection:await fixture(),proofHeader:'controlled-action-fixture',body:''}),close(){}};
      window.boundary={setWho:value=>who=value,controller:createPrivateAccountController({origin:location.origin,createAdapter:async()=>adapter,fetchImpl:fetch.bind(window)})};
    });
    await installController();
    await page.evaluate(async()=>{await fetch('/__qa/signin?who=alice')});
    const read=()=>page.evaluate(async()=>{const value=await window.boundary.controller.start(location.origin+'/');return {phase:value.phase,account:value.account,amount:value.snapshot?.balances?.find(row=>row.asset==='YUSD_TEST')?.availableMicro}});
    const owned=await read();assert.equal(owned.phase,'connected');assert.match(owned.account,/^ynx1/u);assert.equal(owned.amount,17000000);
    const count=await page.evaluate(async()=>await(await fetch('/__qa/bindings')).json());
    if(count.count===0){await page.evaluate(async()=>{await fetch('/__qa/global-logout',{method:'POST'})});assert.equal((await read()).phase,'authorization-required','global logout must deny a Web read previously bound to this identity');}
    assert.equal(count.count,1,'Web cookie must create the durable identity association');
    await page.evaluate(()=>window.boundary.setWho('bob'));assert.equal((await read()).phase,'authorization-required','an unlinked native Bob session cannot use Alice browser identity');
    await page.evaluate(()=>window.boundary.setWho('alice'));assert.equal((await read()).account,owned.account);
    await page.evaluate(async()=>{await fetch('/__qa/signin?who=bob')});assert.equal((await read()).phase,'authorization-required');
    await page.evaluate(()=>window.boundary.setWho('bob'));const ownedB=await read();assert.equal(ownedB.amount,31000000);assert.notEqual(ownedB.account,owned.account);
    // Recreate the actual controller after a real navigation. The HttpOnly
    // browser identity must survive, without a fresh signin or native approval.
    await page.reload();await installController();
    assert.equal((await read()).phase,'authorization-required','restored Bob cookie must not authorize default Alice native fixture');
    await page.evaluate(()=>window.boundary.setWho('bob'));
    assert.deepEqual(await read(),ownedB,'reload must recover only the matching Bob account and balance');
    await page.evaluate(async()=>{await fetch('/__qa/global-logout',{method:'POST'})});assert.equal((await read()).phase,'authorization-required');
    // Independent native sessions use no browser identity and retain their old
    // approved read channel. This is an authority fixture, not Wallet E2E.
    const independent=await fetch(base+'/__qa/proof?who=independent&nonce='+('x'.repeat(24)),{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
    const response=await fetch(base+'/v1/account',{headers:{Origin:origin,'X-YNX-Product-Session-Proof-V2':independent.proofHeader},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);assert.equal((await response.json()).balances.find(row=>row.asset==='YUSD_TEST').availableMicro,17000000);
    const framing=await page.evaluate(async()=>{
      const {readAccountResponse}=await import('/controller.js'),body='{"message":"中文"}',bytes=new TextEncoder().encode(body).length,results=[];
      for(const length of [bytes,bytes-1,bytes+1]){
        try{results.push(await readAccountResponse(new Response(body,{headers:{'content-type':'application/json','content-length':String(length)}}),new AbortController().signal))}catch(error){results.push(error.code)}
      }
      results.push(await readAccountResponse(new Response(body,{headers:{'content-type':'application/json','content-length':'7','content-encoding':'gzip'}}),new AbortController().signal));
      return results;
    });
    assert.deepEqual(framing,['{"message":"中文"}','INVALID_ACCOUNT_RESPONSE','INVALID_ACCOUNT_RESPONSE','{"message":"中文"}']);
  }finally{await browser?.close();if(base)await fetch(base+'/__qa/stop',{method:'POST',signal:AbortSignal.timeout(5000)});else child.kill();assert.equal(await done,0)}
});
function setup(overrides={}){
  const calls=[],states=[];let proofCount=0;
  const client={restore:async()=>{calls.push('restore');return connected()},beginExplicit:async()=>{calls.push('beginExplicit');return pending()},handleReturn:async url=>{calls.push(['handleReturn',url]);return connected()},retryDetected:async()=>{calls.push('retryDetected');return connected()},disconnect:async()=>{calls.push('disconnect');return {status:'disconnected',revocationConfirmed:true}},enterGuest:()=>calls.push('enterGuest'),setNetworkAvailable:v=>calls.push(['network',v]),...overrides.client};
  const adapter={client,close:()=>calls.push('close'),createIntrospectionProof:async()=>{throw Error('standalone introspection must not consume the business nonce')},createBusinessProof:async input=>{calls.push(['proof',input.requiredScopes],['businessProof',input]);const index=++proofCount;return {introspection:{proofHeader:'fresh-offline-proof-'+index},proofHeader:'fresh-action-proof-'+index,body:''}},...overrides.adapter};
  const controller=createPrivateAccountController({origin,onState:s=>states.push(s),createAdapter:async()=>{calls.push('createAdapter');return adapter},fetchImpl:async(url,options)=>{calls.push(['fetch',url,options]);return new Response(JSON.stringify(snapshot()),{headers:{'content-type':'application/json'}})},...overrides.controller});
  return {controller,calls,states,client};
}
test('account read requests one SDK-owned dual proof bound to exact wire method path and empty body',async()=>{
  const {controller,calls}=setup();try{
    assert.equal((await controller.start(origin+'/')).phase,'connected');
    assert.deepEqual(calls.find(value=>Array.isArray(value)&&value[0]==='businessProof')[1],{method:'GET',path:'/api/v1/account',body:'',requiredScopes:['exchange:read']});
    const options=calls.find(value=>Array.isArray(value)&&value[0]==='fetch')[2];
    assert.equal(options.headers['X-YNX-Product-Session-Proof-V2'],'fresh-offline-proof-1');
    assert.equal(options.headers['X-YNX-Product-Session-Action-Proof-V2'],'fresh-action-proof-1');
    assert.equal(options.body,undefined);
  }finally{controller.close()}
});
test('missing business factory or malformed dual proof never sends a private HTTP request',async()=>{
  for(const result of [undefined,{}, {proofHeader:'action',body:''}, {introspection:{proofHeader:'identity'},body:''}, {introspection:{proofHeader:'identity'},proofHeader:'action',body:'changed'}, {introspection:{proofHeader:'identity'},proofHeader:'action'}, {introspection:{proofHeader:'identity'},proofHeader:'identity',body:''}, {introspection:{proofHeader:'identity\r\nforged'},proofHeader:'action',body:''}, {introspection:{proofHeader:'identity'},proofHeader:'a'.repeat(16385),body:''}]){
    const adapter=result===undefined?{createBusinessProof:undefined}:{createBusinessProof:async()=>result};
    const {controller,calls}=setup({adapter});try{
      const value=await controller.start(origin+'/');assert.equal(value.phase,'degraded');assert.equal(value.code,'ACTION_PROOF_UNAVAILABLE');
      assert.equal(calls.filter(value=>Array.isArray(value)&&value[0]==='fetch').length,0);
      assert.equal(calls.filter(value=>value==='beginExplicit'||value==='disconnect').length,0);
    }finally{controller.close()}
  }
});
test('canonical read composition gaps are private-service degraded, not a request for fresh Wallet approval',async()=>{
  for(const [code,status] of [['ACTION_PROOF_REQUIRED',401],['EXCHANGE_PROTECTED_PROFILE_UNAVAILABLE',503],['EXPLICIT_ROUTE_SCOPE_UNAVAILABLE',403],['HTTP_BINDING_MISMATCH',403]]){
    let rejection=false;
    const {controller,calls}=setup({controller:{fetchImpl:async()=>rejection?new Response(JSON.stringify({error:code,privateService:'authorization_required'}),{status,headers:{'content-type':'application/json'}}):new Response(JSON.stringify(snapshot()),{headers:{'content-type':'application/json'}})}});
    try{
      assert.equal((await controller.start(origin+'/')).phase,'connected');
      rejection=true;const unavailable=await controller.refresh();
      assert.equal(unavailable.phase,'degraded',code);assert.equal(unavailable.code,code);assert.equal(unavailable.snapshot,null);assert.equal(unavailable.account,null);
      assert.equal(calls.filter(value=>value==='beginExplicit'||value==='disconnect').length,0);
      rejection=false;assert.equal((await controller.refresh()).phase,'connected');
      assert.equal(calls.filter(value=>Array.isArray(value)&&value[0]==='proof').length,3);
    }finally{controller.close()}
  }
});
test('only exact canonical error codes with matching HTTP status are exposed; unknown bodies retain safe rejection',async()=>{
  for(const [body,status,expected] of [
    ['{"error":"ACTION_PROOF_REQUIRED"}',503,'PRIVATE_API_UNAVAILABLE'],
    ['{"error":"unknown secret text"}',401,'AUTHORIZATION_REQUIRED'],
    ['{"error":"ACTION_PROOF_REQUIRED","code":"SESSION_EXPIRED"}',401,'AUTHORIZATION_REQUIRED'],
    ['{"error":"ACTION_PROOF_REQUIRED","error":"HTTP_BINDING_MISMATCH"}',401,'AUTHORIZATION_REQUIRED'],
    ['{"error":["ACTION_PROOF_REQUIRED"],"privateService":"authorization_required"}',401,'AUTHORIZATION_REQUIRED'],
    ['{"error":"ACTION_PROOF_REQUIRED","privateService":"authorization_required","secret":"not for display"}',401,'AUTHORIZATION_REQUIRED'],
    ['not-json',403,'AUTHORIZATION_REQUIRED']
  ]){
    const {controller}=setup({controller:{fetchImpl:async()=>new Response(body,{status,headers:{'content-type':'application/json'}})}});
    try{const rejected=await controller.start(origin+'/');assert.equal(rejected.code,expected);assert.equal(rejected.snapshot,null);assert.equal(rejected.account,null)}finally{controller.close()}
  }
});
test('length mismatch clears unverified account records and explicit refresh recovers only a newly bound snapshot',async()=>{
  let malformed=false,reads=0;
  const {controller,calls}=setup({controller:{fetchImpl:async()=>{
    reads++;const body=JSON.stringify(snapshot());
    return new Response(body,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)+(malformed?1:0))}});
  }}});
  try{
    assert.equal((await controller.start(origin+'/')).phase,'connected');
    malformed=true;const rejected=await controller.refresh();
    assert.equal(rejected.phase,'degraded');assert.equal(rejected.code,'INVALID_ACCOUNT_RESPONSE');
    assert.equal(rejected.snapshot,null);assert.equal(rejected.account,null);assert.equal(reads,2);
    malformed=false;const recovered=await controller.refresh();
    assert.equal(recovered.phase,'connected');assert.equal(recovered.account,account);assert.equal(reads,3);
    assert.deepEqual(calls.filter(v=>Array.isArray(v)&&v[0]==='proof').map(v=>v[1]),[['exchange:read'],['exchange:read'],['exchange:read']]);
    assert.equal(calls.filter(v=>v==='beginExplicit').length,0);
  }finally{controller.close()}
});
test('private SDK and registry are frozen exact 9840; no runtime external imports',()=>{
  assert.equal(PRIVATE_SDK_SOURCE,'9840ef871165eb523c4e7a3d48964dd25f8dee8e');
  for(const [name,bytes,sha]of [['product-session-browser-9840ef87.mjs',214746,'5dc94d97925e4c0271c8c45255e0e409f257258e4e621f71fda26c4e2407a6e0'],['product-session-registry-9840ef87.json',7546,'85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3']]){
    const data=readFileSync(new URL('../web/vendor/'+name,import.meta.url));assert.equal(data.length,bytes);assert.equal(createHash('sha256').update(data).digest('hex'),sha);assert.doesNotMatch(data.toString(),/^import /m);
  }
});
test('real SDK fails closed on nonregistered origin without network or storage fallback',async()=>{
  const controller=createExchangePrivateAccount({scope:{location:{origin:'https://unregistered.invalid'},isSecureContext:true,fetch:()=>assert.fail('no network')}});
  const value=await controller.start('https://unregistered.invalid/');assert.equal(value.phase,'degraded');assert.equal(value.code,'ORIGIN_NOT_ALLOWED');controller.close();
});
test('begin persists via SDK, exposes exact explicit link and never reads private account before callback',async()=>{
  const {controller,calls}=setup();const value=await controller.begin();assert.equal(value.phase,'approval-pending');assert.equal(value.installation,'unverified');assert.equal(value.route,pending().route.url);assert.deepEqual(calls,['createAdapter','beginExplicit']);assert.equal(value.account,null);controller.close();
});
test('selected native Hosted request uses exact SDK route and callback before owned read; restore never signs',async()=>{
  const context={provider:{},status:'connected',providerKind:'ynx-wallet',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};
  const requests=[];const wallet={getPrivateWalletContext:()=>context,requestProductSessionV2:async url=>{requests.push(url);return {version:2,returnUrl:origin+'/wallet-auth/callback?approval=opaque'}}};
  const {controller,calls}=setup({controller:{wallet}});const a=controller.begin(),b=controller.begin();assert.equal(a,b);assert.equal((await a).phase,'connected');assert.equal(requests.length,1);assert.equal(requests[0],pending().route.url);
  assert.ok(calls.some(v=>Array.isArray(v)&&v[0]==='handleReturn'));await controller.refresh();assert.equal(requests.length,1);controller.close();
});
test('selected native reject retires SDK pending without disconnecting standard identity',async()=>{
  const context={provider:{},status:'connected',providerKind:'ynx-wallet',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};
  const wallet={getPrivateWalletContext:()=>context,requestProductSessionV2:async()=>{throw Object.assign(new Error('USER_REJECTED'),{code:'USER_REJECTED'})}};
  const {controller,calls}=setup({controller:{wallet}});assert.equal((await controller.begin()).code,'USER_REJECTED');assert.equal(calls.filter(v=>v==='disconnect').length,1);assert.equal(context.status,'connected');assert.ok(!calls.some(v=>Array.isArray(v)&&v[0]==='fetch'));controller.close();
});
test('verified native read survives typed transport absence; subsequent empty account clears and retires',async()=>{
  let context={provider:{},status:'connected',providerKind:'ynx-wallet',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};const wallet={getPrivateWalletContext:()=>context,requestProductSessionV2:async()=>({version:2,returnUrl:origin+'/wallet-auth/callback?approval=opaque'})};
  const {controller,calls}=setup({controller:{wallet}});await controller.begin();context={...context,status:'transport-unavailable',revision:2};controller.walletChanged(context);assert.equal(controller.state().phase,'connected');await controller.refresh();assert.equal(controller.state().snapshot.balances[0].availableMicro,1234567);
  context={...context,status:'disconnected',account:null,revision:3};controller.walletChanged(context);await new Promise(r=>setImmediate(r));assert.equal(controller.state().snapshot,null);assert.ok(calls.includes('disconnect'));controller.close();
});
test('late native reply after selected account change cannot handle callback or read old subject',async()=>{
  let resolve;const reply=new Promise(r=>resolve=r);let context={provider:{},status:'connected',providerKind:'ynx-wallet',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};
  const wallet={getPrivateWalletContext:()=>context,requestProductSessionV2:()=>reply};const {controller,calls}=setup({controller:{wallet}});const action=controller.begin();await new Promise(r=>setImmediate(r));context={...context,account:'0x'+'b'.repeat(40),revision:2};resolve({version:2,returnUrl:origin+'/wallet-auth/callback?approval=old'});await action;assert.equal(controller.state().code,'PRIVATE_CONTEXT_CHANGED');assert.ok(calls.includes('disconnect'));assert.ok(!calls.some(v=>Array.isArray(v)&&['fetch','handleReturn'].includes(v[0])));controller.close();
});
test('Guest retirement is once-only: late old approval cannot retire or overwrite the newer explicit session',async()=>{
  let release,count=0;const late=new Promise(r=>release=r);const context={provider:{},status:'connected',providerKind:'ynx-wallet',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};
  const wallet={getPrivateWalletContext:()=>context,requestProductSessionV2:()=>++count===1?late:Promise.resolve({version:2,returnUrl:origin+'/wallet-auth/callback?approval=new'})};
  const {controller,calls}=setup({controller:{wallet}});const old=controller.begin();await new Promise(r=>setImmediate(r));controller.guest();assert.equal((await controller.begin()).phase,'connected');release({version:2,returnUrl:origin+'/wallet-auth/callback?approval=old'});await old;
  assert.equal(controller.state().phase,'connected');assert.equal(calls.filter(v=>v==='disconnect').length,1);assert.equal(calls.filter(v=>Array.isArray(v)&&v[0]==='handleReturn').length,1);controller.close();
});
test('cold native restore binds later real transport continuity and clears old owned data on change',async()=>{
  let context={provider:{},status:'connected',providerKind:'ynx-wallet',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};const wallet={getPrivateWalletContext:()=>context};
  const {controller,calls}=setup({controller:{wallet}});await controller.start(origin+'/');context={...context,account:'0x'+'b'.repeat(40),revision:2};controller.walletChanged(context);await new Promise(r=>setImmediate(r));assert.equal(controller.state().snapshot,null);assert.ok(calls.includes('disconnect'));controller.close();
});
test('known popup absence during approval never consumes late return; offline retires pending too',async()=>{
  for(const kind of ['transport','offline']){
    let release;const late=new Promise(r=>release=r);let context={provider:{},status:'connected',providerKind:'ynx-wallet',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};const wallet={getPrivateWalletContext:()=>context,requestProductSessionV2:()=>late};
    const {controller,calls}=setup({controller:{wallet}});const action=controller.begin();await new Promise(r=>setImmediate(r));if(kind==='offline')controller.offline();else{context={...context,status:'transport-unavailable',revision:2};controller.walletChanged(context)}release({version:2,returnUrl:origin+'/wallet-auth/callback?approval=late'});await action;assert.equal(controller.state().snapshot,null);assert.ok(calls.includes('disconnect'));assert.ok(!calls.some(v=>Array.isArray(v)&&v[0]==='handleReturn'));controller.close();
  }
});
test('complete callback URL goes unchanged to SDK then fresh proof only GETs registered account API',async()=>{
  const {controller,calls}=setup();const url=origin+'/wallet-auth/callback?approval=opaque-exact&state=bound#retained';
  const value=await controller.start(url);assert.equal(value.phase,'connected');assert.equal(value.account,account);assert.deepEqual(calls[1],['handleReturn',url]);
  const [_,target,options]=calls.find(x=>Array.isArray(x)&&x[0]==='fetch');assert.equal(target,origin+'/api/v1/account');assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers['X-YNX-Product-Session-Proof-V2'],'fresh-offline-proof-1');assert.equal(options.body,undefined);assert.equal(options.headers['X-YNX-Product-Session-Proof'],undefined);controller.close();
});
test('reject and callback retry do not fabricate account or API traffic',async()=>{
  for(const result of [{status:'disconnected'},{status:'retry-required'}]){const {controller,calls}=setup({client:{handleReturn:async()=>result}});const value=await controller.start(origin+'/wallet-auth/callback?reject=opaque');assert.equal(value.account,null);assert.ok(!calls.some(v=>Array.isArray(v)&&v[0]==='fetch'));controller.close()}
});
test('second startup uses restore, every account refresh obtains a fresh proof, never reuses prior header',async()=>{
  const {controller,calls}=setup();await controller.start(origin+'/');await controller.refresh();assert.equal(calls.filter(v=>v==='restore').length,2);assert.deepEqual(calls.filter(v=>Array.isArray(v)&&v[0]==='fetch').map(v=>v[2].headers['X-YNX-Product-Session-Proof-V2']),['fresh-offline-proof-1','fresh-offline-proof-2']);assert.deepEqual(calls.filter(v=>Array.isArray(v)&&v[0]==='fetch').map(v=>v[2].headers['X-YNX-Product-Session-Action-Proof-V2']),['fresh-action-proof-1','fresh-action-proof-2']);controller.close();
});
test('private network loss clears visible private data; Retry resumes without standard Wallet interaction',async()=>{
  const {controller,calls}=setup();await controller.start(origin+'/');controller.offline();assert.equal(controller.state().phase,'degraded');assert.equal(controller.state().snapshot,null);await controller.online();assert.equal(controller.state().phase,'connected');assert.ok(calls.includes('retryDetected'));assert.ok(!calls.some(v=>/eth_|personal_sign|disconnectWallet/.test(JSON.stringify(v))));controller.close();
});
test('retiring stalled SDK or proof wait settles caller before late completion and isolates retry',async()=>{
  for(const stage of ['restore','proof'])for(const action of ['guest','offline','close','replace']){
    let release,entered,completed=false,count=0;
    const wait=new Promise(resolve=>release=resolve),reached=new Promise(resolve=>entered=resolve);
    const overrides=stage==='restore'?{client:{restore:async()=>{if(++count===1){entered();return wait}return connected()}}}:{adapter:{createBusinessProof:async()=>{if(++count===1){entered();return wait}return {introspection:{proofHeader:'fresh-retry-proof'},proofHeader:'fresh-retry-action',body:''}}}};
    const {controller,calls}=setup(overrides);
    const old=controller.start(origin+'/').then(value=>{completed=true;return value});await reached;
    let next;if(action==='replace')next=controller.refresh();else controller[action]();
    await new Promise(setImmediate);assert.equal(completed,true,`${stage}/${action} must not wait for retired SDK promise`);
    assert.equal((await old).snapshot,null,'retired caller cannot receive stale private data');
    if(action!=='close'){
      if(action==='offline')next=controller.online();else if(action==='guest')next=controller.refresh();
      assert.equal((await next).phase,'connected');
    }
    const requests=calls.filter(item=>Array.isArray(item)&&item[0]==='fetch').length;
    release(stage==='restore'?connected(other):{introspection:{proofHeader:'late-retired-proof'},proofHeader:'late-retired-action',body:''});await new Promise(setImmediate);
    assert.equal(calls.filter(item=>Array.isArray(item)&&item[0]==='fetch').length,requests,'late retired completion must not issue API read');
    assert.equal(controller.state().account,action==='close'?null:account);
    assert.ok(!calls.some(item=>/eth_requestAccounts|personal_sign|disconnectWallet/.test(JSON.stringify(item))));controller.close();
  }
});
test('private response and body cancellation settle callers; retry needs a fresh proof and cannot revive a retired account',async()=>{
  for(const stalled of ['response','body','refusal-body'])for(const action of ['deadline','guest','offline','close']){
    const timers=new Map();let next=0,reads=0,release,completed=false;
    const wait=new Promise(resolve=>release=resolve);
    const {controller,calls}=setup({controller:{
      setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id},clearTimer:id=>timers.delete(id),
      fetchImpl:async()=>{reads++;if(reads>1)return new Response(JSON.stringify(snapshot()),{headers:{'content-type':'application/json'}});
        if(stalled==='response')return wait;
        return {ok:stalled!=='refusal-body',status:stalled==='refusal-body'?401:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:()=>wait.then(body=>({done:false,value:new TextEncoder().encode(body)})),cancel:async()=>{},releaseLock(){}})}};},
    }});
    const running=controller.start(origin+'/').then(value=>{completed=true;return value});
    await new Promise(setImmediate);
    if(action==='deadline'){const deadline=[...timers.values()].find(item=>item.ms===10000);assert.ok(deadline);deadline.fn();}
    else controller[action]();
    await new Promise(setImmediate);assert.equal(completed,true,`${stalled}/${action} caller must settle`);
    const result=await running;assert.equal(result.snapshot,null);
    if(action==='deadline'){assert.equal(result.phase,'degraded');assert.equal(result.code,'PRIVATE_API_UNAVAILABLE');}
    assert.equal(timers.size,0,'retired request must leave no deadline/expiry timer');
    if(action!=='close'){
      assert.equal((await controller.refresh()).phase,'connected');
      assert.equal(calls.filter(item=>Array.isArray(item)&&item[0]==='proof').length,2);
    }
    release(stalled==='response'?new Response(JSON.stringify(snapshot(other)),{headers:{'content-type':'application/json'}}):JSON.stringify(snapshot(other)));
    await new Promise(setImmediate);
    assert.equal(controller.state().account,action==='close'?null:account,'late foreign body must not replace current account');
    controller.close();assert.equal(timers.size,0);
  }
});
test('Guest hides data without claiming revocation and online does not undo deliberate Guest',async()=>{
  const {controller,calls}=setup();await controller.start(origin+'/');controller.guest();const before=calls.length;controller.offline();await controller.online();assert.equal(controller.state().phase,'guest');assert.equal(controller.state().code,'LOCAL_GUEST_NOT_REVOKED');assert.equal(controller.state().snapshot,null);assert.ok(!calls.slice(before).includes('retryDetected'));assert.ok(!calls.includes('disconnect'));controller.close();
});
test('private revocation failure stays unconfirmed; success requires SDK confirmed result',async()=>{
  for(const result of [{status:'retry-required'},{status:'offline'},{status:'expired'},{status:'disconnected',revocationConfirmed:false},{status:'disconnected',revocationConfirmed:true}]){
    const {controller}=setup({client:{disconnect:async()=>result}});await controller.start(origin+'/');const value=await controller.disconnect();assert.equal(value.code==='PRIVATE_REVOCATION_CONFIRMED',result.revocationConfirmed===true);assert.equal(value.account,null);controller.close();
  }
});
test('stale callback/proof completion after Guest cannot fetch or expose an account',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve);
  const {controller,calls}=setup({client:{handleReturn:()=>pending}});const action=controller.start(origin+'/wallet-auth/callback?approval=opaque');await new Promise(resolve=>setImmediate(resolve));controller.guest();release(connected());await action;assert.equal(controller.state().phase,'guest');assert.ok(!calls.some(v=>Array.isArray(v)&&v[0]==='fetch'));controller.close();
});
test('older API response cannot repopulate data after Guest or a newer account',async()=>{
  let release,counter=0;const wait=new Promise(resolve=>release=resolve);
  const {controller}=setup({controller:{fetchImpl:async()=>{counter++;if(counter===1)await wait;return new Response(JSON.stringify(snapshot()),{headers:{'content-type':'application/json'}})}}});
  const action=controller.start(origin+'/');await new Promise(resolve=>setImmediate(resolve));controller.guest();release();await action;assert.equal(controller.state().phase,'guest');assert.equal(controller.state().account,null);controller.close();
});
test('double Begin coalesces one SDK call and Guest permits a distinct new attempt',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);let count=0;
  const {controller}=setup({client:{beginExplicit:async()=>{count++;await wait;return pending()}}});const a=controller.begin(),b=controller.begin();assert.equal(a,b);await new Promise(resolve=>setImmediate(resolve));controller.guest();const c=controller.begin();await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([a,b,c]);assert.equal(count,2);assert.equal(controller.state().phase,'approval-pending');controller.close();
});
test('HTTP auth/unavailable/HTML/oversize/unsafe numeric/cross-account responses fail closed without auto retry',async()=>{
  const invalid=snapshot();invalid.balances[0].availableMicro=9007199254740992;
  for(const response of [new Response('denied',{status:401}),new Response('down',{status:503}),new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'999999999'}}),new Response(JSON.stringify(invalid),{headers:{'content-type':'application/json'}}),new Response(JSON.stringify(snapshot(other)),{headers:{'content-type':'application/json'}})]){
    let calls=0;const {controller}=setup({controller:{fetchImpl:async()=>{calls++;return response}}});const value=await controller.start(origin+'/');assert.notEqual(value.phase,'connected');assert.equal(value.snapshot,null);assert.equal(calls,1);controller.close();
  }
});
test('source status, account ownership and safe integer amounts are validated',()=>{
  assert.equal(validateAccountSnapshot(snapshot(),account).balances[0].availableMicro,1234567);
  for(const change of [v=>v.sourceMetadata.status='live',v=>v.sourceMetadata.asOf='2000-01-01T00:00:00Z',v=>v.security.account=other,v=>v.balances[0].availableMicro='1',v=>v.orders.push({account:other}),v=>v.trades.push({buyer:other,seller:other})]){const value=snapshot();change(value);assert.throws(()=>validateAccountSnapshot(value,account))}
});
test('schema10 CAS provenance modes are exact; legacy aliases and inconsistent multi-instance claims fail closed',()=>{
  assert.equal(validateAccountSnapshot(snapshot(),account).sourceMetadata.stateBackend,'file-cas-single-host');
  const live=snapshot();Object.assign(live.sourceMetadata,{status:'live',stateBackend:'postgres-cas-multi-instance',multiInstance:true});assert.equal(validateAccountSnapshot(live,account),live);
  for(const change of [value=>value.sourceMetadata.stateBackend='file_snapshot',value=>Object.assign(value.sourceMetadata,{status:'live',stateBackend:'postgresql',multiInstance:true}),value=>value.sourceMetadata.multiInstance=true,value=>Object.assign(value.sourceMetadata,{status:'live',stateBackend:'postgres-cas-multi-instance',multiInstance:false})]){const value=snapshot();change(value);assert.throws(()=>validateAccountSnapshot(value,account),{code:'INVALID_ACCOUNT_SOURCE'})}
});
test('session expiry clears visible account even without an API retry',async()=>{
  const value=connected();value.session.expiresAt=new Date(Date.now()+50).toISOString();const {controller}=setup({client:{restore:async()=>value}});assert.equal((await controller.start(origin+'/')).phase,'connected');await new Promise(resolve=>setTimeout(resolve,75));assert.equal(controller.state().code,'SESSION_EXPIRED');assert.equal(controller.state().snapshot,null);controller.close();
});
test('entry and UI separate standard connection from private read-only scopes and no automatic navigation',()=>{
  const entry=readFileSync(new URL('../web/private-session-entry.js',import.meta.url),'utf8'),app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(entry,/import \{createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter\} from '\.\/vendor\/product-session-browser-9840ef87.mjs'/);
  assert.match(entry,/scopes:\[PRIVATE_READ_SCOPE\]/);assert.doesNotMatch(entry,/exchange:trade|exchange:deposit|localStorage|sessionStorage/);
  const render=app.slice(app.indexOf('function renderPrivateAccount'),app.indexOf('function renderBook'));
  assert.doesNotMatch(render,/disconnectWallet\(|YNXExchangeWebWallet\./);
  const quietStart=app.indexOf('async function restoreBrowserIdentityQuietly()'),quietEnd=app.indexOf('function resumeDeferredBrowserIdentity()',quietStart);
  assert.ok(quietStart>=0&&quietEnd>quietStart);const quiet=app.slice(quietStart,quietEnd);
  assert.match(quiet,/browserIdentitySilentAttempted=true/);assert.doesNotMatch(quiet,/browserIdentityRequest\(|location\.(assign|replace)\(/);assert.equal((app.match(/location\.assign\(/g)||[]).length,0);
  for(const forbidden of [/window\.open\(/,/<iframe/i,/location\.(assign|replace)\(/,/location\.href\s*=/])assert.doesNotMatch(app.slice(0,quietStart)+app.slice(quietEnd)+html,forbidden);
  assert.match(html,/id="private-open" hidden rel="noreferrer"/);assert.match(app,/open.href=value.route/);assert.match(app,/handleReturn|privateAccount.start\(location.href\)/);
});
