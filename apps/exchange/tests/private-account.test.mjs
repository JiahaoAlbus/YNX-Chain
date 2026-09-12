import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPrivateAccountController,validateAccountSnapshot} from '../web/private-account-controller.js';
import {createExchangePrivateAccount,PRIVATE_SDK_SOURCE} from '../web/private-session-entry.js';
const origin='https://exchange.ynxweb4.com',account='ynx1'+'q'.repeat(38),other='ynx1'+'p'.repeat(38);
const snapshot=(owner=account)=>({sourceMetadata:{authority:'YNX-owned deterministic order state',version:'exchange-public-state-v1',classification:'testnet',status:'degraded_single_host',stateBackend:'file_snapshot',multiInstance:false,coverage:'account-ledger-orders-trades-fees-audit',asOf:new Date().toISOString()},balances:[{account:owner,asset:'YUSD_TEST',availableMicro:1234567,reservedMicro:0}],ledger:[],depositIntents:[],orders:[],trades:[],fees:[],deposits:[],withdrawals:[],support:[],ai:[],audit:[],security:{account:owner,withdrawalLock:false,sessionTtlMinutes:15}});
const connected=(owner=account)=>({status:'connected',session:{productId:'exchange',origin,chainId:'ynx_6423-1',account:owner,scopes:['exchange:read'],expiresAt:new Date(Date.now()+60000).toISOString()}});
const pending=()=>({status:'connecting',automatic:false,installation:'unverified',request:{expiresAt:new Date(Date.now()+60000).toISOString()},route:{status:'ready',url:'ynxwallet://authorize?request=exact-offline-fixture'}});
function setup(overrides={}){
  const calls=[],states=[];let proofCount=0;
  const client={restore:async()=>{calls.push('restore');return connected()},beginExplicit:async()=>{calls.push('beginExplicit');return pending()},handleReturn:async url=>{calls.push(['handleReturn',url]);return connected()},retryDetected:async()=>{calls.push('retryDetected');return connected()},disconnect:async()=>{calls.push('disconnect');return {status:'disconnected',revocationConfirmed:true}},enterGuest:()=>calls.push('enterGuest'),setNetworkAvailable:v=>calls.push(['network',v]),...overrides.client};
  const adapter={client,close:()=>calls.push('close'),createIntrospectionProof:async scopes=>{calls.push(['proof',scopes]);return {proofHeader:'fresh-offline-proof-'+(++proofCount)}},...overrides.adapter};
  const controller=createPrivateAccountController({origin,onState:s=>states.push(s),createAdapter:async()=>{calls.push('createAdapter');return adapter},fetchImpl:async(url,options)=>{calls.push(['fetch',url,options]);return new Response(JSON.stringify(snapshot()),{headers:{'content-type':'application/json'}})},...overrides.controller});
  return {controller,calls,states,client};
}
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
test('complete callback URL goes unchanged to SDK then fresh proof only GETs registered account API',async()=>{
  const {controller,calls}=setup();const url=origin+'/wallet-auth/callback?approval=opaque-exact&state=bound#retained';
  const value=await controller.start(url);assert.equal(value.phase,'connected');assert.equal(value.account,account);assert.deepEqual(calls[1],['handleReturn',url]);
  const [_,target,options]=calls.find(x=>Array.isArray(x)&&x[0]==='fetch');assert.equal(target,origin+'/api/v1/account');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers['X-YNX-Product-Session-Proof-V2'],'fresh-offline-proof-1');assert.equal(options.body,undefined);assert.equal(options.headers['X-YNX-Product-Session-Proof'],undefined);controller.close();
});
test('reject and callback retry do not fabricate account or API traffic',async()=>{
  for(const result of [{status:'disconnected'},{status:'retry-required'}]){const {controller,calls}=setup({client:{handleReturn:async()=>result}});const value=await controller.start(origin+'/wallet-auth/callback?reject=opaque');assert.equal(value.account,null);assert.ok(!calls.some(v=>Array.isArray(v)&&v[0]==='fetch'));controller.close()}
});
test('second startup uses restore, every account refresh obtains a fresh proof, never reuses prior header',async()=>{
  const {controller,calls}=setup();await controller.start(origin+'/');await controller.refresh();assert.equal(calls.filter(v=>v==='restore').length,2);assert.deepEqual(calls.filter(v=>Array.isArray(v)&&v[0]==='fetch').map(v=>v[2].headers['X-YNX-Product-Session-Proof-V2']),['fresh-offline-proof-1','fresh-offline-proof-2']);controller.close();
});
test('private network loss clears visible private data; Retry resumes without standard Wallet interaction',async()=>{
  const {controller,calls}=setup();await controller.start(origin+'/');controller.offline();assert.equal(controller.state().phase,'degraded');assert.equal(controller.state().snapshot,null);await controller.online();assert.equal(controller.state().phase,'connected');assert.ok(calls.includes('retryDetected'));assert.ok(!calls.some(v=>/eth_|personal_sign|disconnectWallet/.test(JSON.stringify(v))));controller.close();
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
test('session expiry clears visible account even without an API retry',async()=>{
  const value=connected();value.session.expiresAt=new Date(Date.now()+50).toISOString();const {controller}=setup({client:{restore:async()=>value}});assert.equal((await controller.start(origin+'/')).phase,'connected');await new Promise(resolve=>setTimeout(resolve,75));assert.equal(controller.state().code,'SESSION_EXPIRED');assert.equal(controller.state().snapshot,null);controller.close();
});
test('entry and UI separate standard connection from private read-only scopes and no automatic navigation',()=>{
  const entry=readFileSync(new URL('../web/private-session-entry.js',import.meta.url),'utf8'),app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(entry,/import \{createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter\} from '\.\/vendor\/product-session-browser-9840ef87.mjs'/);
  assert.match(entry,/scopes:\[PRIVATE_READ_SCOPE\]/);assert.doesNotMatch(entry,/exchange:trade|exchange:deposit|localStorage|sessionStorage/);
  const render=app.slice(app.indexOf('function renderPrivateAccount'),app.indexOf('function renderBook'));
  assert.doesNotMatch(render,/disconnectWallet\(|YNXExchangeWebWallet\./);
  for(const forbidden of [/window\.open\(/,/<iframe/i,/location\.(assign|replace)\(/,/location\.href\s*=/])assert.doesNotMatch(app+html,forbidden);
  assert.match(html,/id="private-open" hidden rel="noreferrer"/);assert.match(app,/open.href=value.route/);assert.match(app,/handleReturn|privateAccount.start\(location.href\)/);
});
