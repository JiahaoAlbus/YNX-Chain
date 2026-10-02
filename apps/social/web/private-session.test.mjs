import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createSocialPrivateSession, SOCIAL_AUTHORITY, SOCIAL_PRIVATE_SCOPES, SOCIAL_CHAT_SCOPES } from "./private-session.js";

function fixture(options = {}) {
  const calls = [];
  const controller = createSocialPrivateSession({
    environment: { navigator: { onLine: true }, async fetch() { calls.push("registry"); return { ok: true, json: async () => ({}) }; } },
    factory: async config => {
      assert.equal(config.productId, "social");
      assert.deepEqual(config.scopes, ["account:read", "profile:link"]);
      return { storage: {get: async () => null}, client: {
        storageKey: "synthetic-session",
        async beginExplicit() { calls.push("beginExplicit"); return {status:"connecting",installation:"unverified",automatic:false}; },
        async restore(value) { calls.push(["restore", value]); return {status:"connected",session:{account:"test-identity"}}; },
        async handleReturn(value) { calls.push(["return",value]); return {status:"disconnected"}; },
        async disconnect() { calls.push("revoke"); return {status:"disconnected"}; },
      }};
    }, ...options,
  });
  return {calls, controller};
}

test("private artifacts match the frozen owner bytes", async () => {
  for(const [name,size,sha] of [
    ["product-session-browser.mjs",214746,"5dc94d97925e4c0271c8c45255e0e409f257258e4e621f71fda26c4e2407a6e0"],
    ["product-session-registry.json",7546,"85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3"],
  ]) {
    const data = await readFile(new URL(`./vendor/${name}`, import.meta.url));
    assert.equal(data.length,size); assert.equal(createHash("sha256").update(data).digest("hex"),sha);
  }
});
test("guest controller construction creates no keys or authority requests", () => {
  const {calls} = fixture(); assert.deepEqual(calls,[]);
  assert.equal(SOCIAL_AUTHORITY,"https://wallet-auth.ynxweb4.com");
  assert.deepEqual(SOCIAL_PRIVATE_SCOPES,["account:read","profile:link"]);
});
test("explicit launch uses official unverified entry without installation probes", async () => {
  const {calls,controller}=fixture();
  const pending=await controller.begin();
  assert.equal(pending.installation,"unverified");
  assert.equal(pending.automatic,false);
  assert.deepEqual(calls,["registry","beginExplicit"]);
});
test("restore and revoke call shared private lifecycle independently", async () => {
  const {calls,controller}=fixture();
  assert.equal((await controller.restore()).status,"connected");
  assert.equal((await controller.disconnect()).status,"disconnected");
  assert.deepEqual(calls,["registry",["restore",true],"revoke"]);
});
test("registered callback is passed intact and foreign callback is refused", async () => {
  const {calls,controller}=fixture();
  const url="https://social.ynxweb4.com/wallet-auth/callback?state=synthetic&approval=synthetic";
  await controller.handleReturn(url);
  await assert.rejects(controller.handleReturn("https://other.example/wallet-auth/callback"));
  assert.deepEqual(calls,["registry",["return",url]]);
});
test("pending-only retry cannot rotate the official pending nonce", async () => {
  let restores=0;
  const {controller}=fixture({factory:async()=>({storage:{get:async()=>'{"nonce":"pending-synthetic"}'},client:{storageKey:"synthetic-session",restore:async()=>{restores++;}}})});
  const result=await controller.restore();
  assert.equal(result.status,"connecting");
  assert.equal(result.automatic,false);
  assert.equal(restores,0);
});
test("callback document assets resolve from root and launch is user-only", async () => {
  const html=await readFile(new URL("./index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("./private-session-ui.js",import.meta.url),"utf8");
  assert.match(html,/<base href="\/"/);
  assert.match(ui,/privateSession\.handleReturn\(location\.href\)/);
  assert.doesNotMatch(ui,/window\.open|location\.(href|assign)\s*=/);
});

test('chat scopes require their explicit entry and do not widen the identity entry',async()=>{
  let selected;
  const {controller}=fixture({scopes:SOCIAL_CHAT_SCOPES,factory:async config=>{selected=config;return {client:{beginExplicit:async()=>({status:'connecting'})}}}});
  await controller.begin();
  assert.deepEqual(selected.scopes,['account:read','profile:link','social.contacts','social.messaging','social.profile']);
  assert.match(selected.purpose,/encrypted chat/);
  assert.throws(()=>createSocialPrivateSession({scopes:['identity:read','social.messaging']}),/Unsupported/);
});
test('disconnect intent blocks an already pending proof before SDK revocation completes',async()=>{
  let finish,started;
  const ready=new Promise(resolve=>{started=resolve});
  const {controller}=fixture({factory:async()=>({createIntrospectionProof:async()=>{started();return new Promise(resolve=>{finish=resolve})},client:{disconnect:async()=>({status:'disconnected'})}})});
  const pending=controller.proof(['social.messaging']);
  await ready;const disconnect=controller.disconnect();finish({proofHeader:'must-not-be-used'});
  await assert.rejects(pending,/suspended/);await disconnect;
});

test('selected Wallet reserves at click then reviews exact SDK route and validated callback',async()=>{
 const calls=[],account='ynx1synthetic';let revision=1;
 const environment={navigator:{onLine:true},fetch:async()=>({ok:true,json:async()=>({})}),YNXSocialWallet:{hasSelection:()=>true,reserve:()=>{calls.push('reserve');return Promise.resolve()},getRevision:()=>revision,available:()=>true,accountMatches:value=>value===account,requestProductSessionV2:async route=>{calls.push(['review',route]);return {returnUrl:'https://social.ynxweb4.com/wallet-auth/callback?state=fixture'}}}};
 const controller=createSocialPrivateSession({environment,factory:async()=>({client:{beginExplicit:async()=>{calls.push('begin');return {status:'connecting',route:{status:'ready',url:'ynxwallet://authorize?request=fixture'}}},handleReturn:async url=>{calls.push(['return',url]);return {status:'connected',session:{account}}},disconnect:async()=>{calls.push('revoke')}}})});
 const task=controller.begin();assert.deepEqual(calls,['reserve']);assert.equal((await task).status,'connected');assert.equal(calls[1],'begin');assert.equal(calls[2][0],'review');assert.equal(calls[3][0],'return');
});
test('selected Wallet changed during approval cannot accept private identity',async()=>{
 let revision=1,returns=0;const environment={navigator:{onLine:true},fetch:async()=>({ok:true,json:async()=>({})}),YNXSocialWallet:{hasSelection:()=>true,reserve:()=>Promise.resolve(),getRevision:()=>revision,available:()=>true,accountMatches:()=>true,requestProductSessionV2:async()=>{revision++;return {returnUrl:'https://social.ynxweb4.com/wallet-auth/callback?state=fixture'}}}};
 const controller=createSocialPrivateSession({environment,factory:async()=>({client:{beginExplicit:async()=>({status:'connecting',route:{status:'ready',url:'ynxwallet://authorize?request=fixture'}}),handleReturn:async()=>{returns++;return {status:'connected'}}}})});await assert.rejects(controller.begin(),/SOCIAL_CONTEXT_CHANGED/);assert.equal(returns,0);
});

test('cancel or wallet switch during reservation cannot begin private authorization',async()=>{for(const action of ['cancel','switch']){let release,intent=1,begins=0;const gate=new Promise(r=>release=r);const wallet={hasSelection:()=>true,reserve:()=>gate,getIntentRevision:()=>intent,getRevision:()=>intent,available:()=>true};const {controller}=fixture({environment:{navigator:{onLine:true},fetch:async()=>({ok:true,json:async()=>({})}),YNXSocialWallet:wallet},factory:async()=>({client:{beginExplicit:async()=>{begins++;return {status:'connecting'}}}})});const task=controller.begin();intent++;release();await assert.rejects(task,/SOCIAL_CONTEXT_CHANGED/);assert.equal(begins,0,action);}});
test('own reservation commit may change transport revision without changing private click intent',async()=>{let revision=1,begins=0;const wallet={hasSelection:()=>true,reserve:()=>{revision++;return Promise.resolve()},getIntentRevision:()=>7,getRevision:()=>revision,available:()=>false};const {controller}=fixture({environment:{navigator:{onLine:true},fetch:async()=>({ok:true,json:async()=>({})}),YNXSocialWallet:wallet},factory:async()=>({client:{beginExplicit:async()=>{begins++;return {status:'connecting'}}}})});await controller.begin();assert.equal(begins,1);});

function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function observeRegistry(promise,ms=100){return new Promise(resolve=>{const timer=setTimeout(()=>resolve({code:'TEST_WINDOW_UNSETTLED'}),ms);promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);resolve(error)})})}
function registryAdapter(){return {storage:{get:async()=>null},client:{storageKey:'registry-engineering',restore:async()=>({status:'connected',session:{account:'engineering-only'}})}}}
for(const phase of ['headers','body'])test('registry '+phase+' deadline prevents late factory and preserves the newer adapter',async()=>{
 const block=gate();let reads=0,bodies=0,factories=0,oldSignal;
 const controller=createSocialPrivateSession({registryTimeoutMs:20,environment:{navigator:{onLine:true},fetch:async(url,options)=>{reads++;if(reads===1){oldSignal=options.signal;if(phase==='headers')return block.promise;return {ok:true,json:()=>block.promise}}return {ok:true,json:async()=>({})}}},factory:async()=>{factories++;return registryAdapter()}});
 const result=await observeRegistry(controller.restore());assert.equal(result.code,'SOCIAL_REGISTRY_TIMEOUT');assert.equal(result.retryable,true);assert.equal(oldSignal.aborted,true);assert.equal(factories,0);
 assert.equal((await controller.restore()).status,'connected');assert.equal(factories,1);block.resolve(phase==='headers'?{ok:true,json:async()=>{bodies++;return {}}}:{});await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await controller.restore()).status,'connected');assert.equal(reads,2);assert.equal(factories,1);assert.equal(bodies,0);
});
test('registry network failure is accurately retryable and does not poison the serial queue',async()=>{let reads=0,factories=0;const controller=createSocialPrivateSession({registryTimeoutMs:20,environment:{navigator:{onLine:true},fetch:async()=>{if(++reads===1)throw Error('synthetic network failure');return {ok:true,json:async()=>({})}}},factory:async()=>{factories++;return registryAdapter()}});const failure=await observeRegistry(controller.restore());assert.equal(failure.code,'SOCIAL_REGISTRY_NETWORK_UNAVAILABLE');assert.equal(failure.retryable,true);assert.equal(factories,0);assert.equal((await controller.restore()).status,'connected');assert.equal(factories,1)});
test('read-only registry deadline never races the writable factory or creates another same-store client',async()=>{const block=gate();let reads=0,factories=0;const controller=createSocialPrivateSession({registryTimeoutMs:10,environment:{navigator:{onLine:true},fetch:async()=>{reads++;return {ok:true,json:async()=>({})}}},factory:async()=>{factories++;await block.promise;return registryAdapter()}});const pending=controller.restore();assert.equal((await observeRegistry(pending,40)).code,'TEST_WINDOW_UNSETTLED');assert.equal(reads,1);assert.equal(factories,1);block.resolve();assert.equal((await pending).status,'connected');await controller.restore();assert.equal(reads,1);assert.equal(factories,1)});
test('failed read releases the original serial operation for its queued successor',async()=>{const old=gate();let reads=0,factories=0;const controller=createSocialPrivateSession({registryTimeoutMs:20,environment:{navigator:{onLine:true},fetch:async()=>++reads===1?old.promise:{ok:true,json:async()=>({})}},factory:async()=>{factories++;return registryAdapter()}});const first=observeRegistry(controller.restore()),next=controller.restore();assert.equal((await first).code,'SOCIAL_REGISTRY_TIMEOUT');assert.equal((await next).status,'connected');assert.equal(reads,2);assert.equal(factories,1);old.resolve({ok:true,json:async()=>({})});await new Promise(resolve=>setImmediate(resolve));await controller.restore();assert.equal(reads,2);assert.equal(factories,1)});
for(const phase of ['http','json'])test('registry '+phase+' failure remains accurately retryable without creating a factory',async()=>{let factories=0;const controller=createSocialPrivateSession({registryTimeoutMs:20,environment:{fetch:async()=>phase==='http'?{ok:false}:{ok:true,json:async()=>{throw new SyntaxError('synthetic malformed registry')}}},factory:async()=>{factories++;return registryAdapter()}});const error=await observeRegistry(controller.restore());assert.equal(error.code,phase==='http'?'SOCIAL_REGISTRY_UNAVAILABLE':'SOCIAL_REGISTRY_INVALID');assert.equal(error.retryable,true);assert.equal(factories,0)});
for(const phase of ['headers','body'])test('real loopback HTTP stalled '+phase+' is bounded and a fresh read recovers (engineering only)',async()=>{
 let healthy=false,requests=0,factories=0;
 const server=createServer((request,response)=>{requests++;if(healthy){response.setHeader('Content-Type','application/json');response.end('{}');return}if(phase==='body'){response.setHeader('Content-Type','application/json');response.write('{"unfinished":');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const controller=createSocialPrivateSession({registryTimeoutMs:60,environment:{navigator:{onLine:true},fetch:async(url,options)=>{assert.ok(url.pathname.endsWith('/vendor/product-session-registry.json'));assert.equal(options.credentials,'omit');return globalThis.fetch(`http://127.0.0.1:${server.address().port}/registry`,options)}},factory:async()=>{factories++;return registryAdapter()}});
 const result=await observeRegistry(controller.restore(),250);assert.equal(result.code,'SOCIAL_REGISTRY_TIMEOUT');assert.equal(result.retryable,true);assert.equal(requests,1);assert.equal(factories,0);healthy=true;assert.equal((await controller.restore()).status,'connected');assert.equal(requests,2);assert.equal(factories,1);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
for(const phase of ['timeout','network','http','json'])test('caught '+phase+' connection error is readable without internal implementation terms',async()=>{const controller=createSocialPrivateSession({registryTimeoutMs:10,environment:{fetch:async()=>{if(phase==='timeout')return new Promise(()=>{});if(phase==='network')throw Error('synthetic network failure');if(phase==='http')return {ok:false};return {ok:true,json:async()=>{throw new SyntaxError('synthetic malformed body')}}}},factory:async()=>{throw Error('Failure must not reach factory')}});const error=await observeRegistry(controller.restore());assert.equal(error.retryable,true);assert.match(error.message,/connect|sign.in/i);assert.match(error.message,/retry|try again/i);assert.match(error.message,/account data.*retained/i);assert.doesNotMatch(error.message,/product session|registry|gateway|introspect|adapter|SDK/i);assert.ok(error.code.startsWith('SOCIAL_REGISTRY_'))});
