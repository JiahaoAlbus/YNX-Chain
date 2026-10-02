import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {cardCallbackKind} from './providerCallback';

// Synthetic SDK and Provider doubles. No public Gateway, Wallet approval or account is proven.
type Session={status:string};
type Options={ready?:boolean;provider?:'ynx'|'metamask'|'none';request?:(input:{method:string;params:readonly unknown[]})=>Promise<unknown>;returnState?:(url:string)=>Promise<Session>;disconnect?:()=>Promise<void>;fastTimeout?:boolean;financeScope?:boolean;pauseStorage?:'local-throw'|'local-silent'|'both-throw'};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}}
function load(values:Map<string,string>,options:Options={}){
  const calls:{scopes:string[];restored:number;begun:number;returned:string[];retries:number;disconnected:number;closed:number}[]=[];
  const providerCalls:{method:string;params:readonly unknown[]}[]=[];
  const exports:Record<string,any>={};let navigations=0;
  const w={location:{origin:'https://card.ynxweb4.com',href:'https://card.ynxweb4.com/',assign:()=>{navigations++;throw Error('Unexpected navigation')}},isSecureContext:true,navigator:{onLine:true},history:{replaceState(){}},localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}};
  const localSet=w.localStorage.setItem;
  w.localStorage.setItem=(key,value)=>{if(value==='no'&&options.pauseStorage){if(options.pauseStorage==='local-silent')return undefined as any;throw Error('synthetic storage failure');}return localSet(key,value)};
  const sessionStorage={getItem:(key:string)=>values.get('tab:'+key)??null,setItem:(key:string,value:string)=>{if(value==='no'&&options.pauseStorage==='both-throw')throw Error('synthetic tab storage failure');values.set('tab:'+key,value)}};
  Object.assign(w,{sessionStorage});
  const provider={isYNXWallet:true,isMetaMask:false,request:async(input:{method:string;params:readonly unknown[]})=>{providerCalls.push(input);return options.request?.(input)??{version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?productSessionResult=synthetic-approved'}}};
  const sdk={ProductSessionGatewayFetchAdapter:class{},createBrowserProductSessionClient:async(config:any)=>{
    const record={scopes:[...config.scopes],restored:0,begun:0,returned:[] as string[],retries:0,disconnected:0,closed:0};calls.push(record);
    let current:Session={status:'disconnected'},pendingReturn:Promise<Session>|null=null;
    return {close(){record.closed++},client:{get current(){return current},restore:async()=>{record.restored++;return current},beginExplicit:async()=>{record.begun++;current=options.ready?{status:'connecting'}:{status:'disconnected'};return options.ready?{status:'connecting',route:{status:'ready',url:`ynxwallet://authorize?request=synthetic-${record.begun}`}}:current},handleReturn:async(url:string)=>{record.returned.push(url);const operation=(async()=>{current=await (options.returnState?.(url)??Promise.resolve({status:url.includes('rejected')?'disconnected':'connected'}));return current})();pendingReturn=operation;try{return await operation}finally{if(pendingReturn===operation)pendingReturn=null}},retryDetected:async()=>{record.retries++;throw Error('stale retry prohibited')},disconnect:async()=>{record.disconnected++;if(pendingReturn)await pendingReturn.catch(()=>{});await options.disconnect?.();current={status:'disconnected'};return current}}};
  }};
  const source=ts.transpileModule(fs.readFileSync(new URL('./providerSessionWeb.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const schedule=options.fastTimeout?((fn:()=>void,ms:number)=>setTimeout(fn,ms===125_000?0:ms)):setTimeout;
  vm.runInNewContext(source,{exports,window:w,URL,fetch:async()=>{throw Error('No external requests allowed')},setTimeout:schedule,clearTimeout,require:(name:string)=>{if(name==='@ynx-chain/wallet-auth-card-provider-v2')return sdk;if(name.includes('registry-b754'))return {products:[{productId:'card',scopes:['account:read','card:application:write','card:controls:write',...(options.financeScope?['card:finance:share']:[])]}]};if(name==='./providerCallback')return {cardCallbackKind};if(name==='./standardWalletSdk')return {discoverWalletProviders:async()=>({ynx:options.provider==='ynx'?{kind:'ynx-wallet',provider}:null,metamask:options.provider==='metamask'?{kind:'metamask',provider:{isMetaMask:true}}:null}),isSharedWalletProvider:(value:unknown,kind:string)=>kind==='ynx-wallet'&&value===provider};throw Error('Unexpected import '+name)}});
  return {api:exports,calls,providerCalls,get navigations(){return navigations},window:w};
}
const tick=()=>new Promise(done=>setTimeout(done,0));
test('selected Hosted approval and Retry reuse that transport without injected fallback',async()=>{
  const isolated=load(new Map(),{ready:true,provider:'none'}),routes:string[]=[];
  const hosted={requestProductSessionV2:async(url:string)=>{routes.push(url);return {version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?result=approved'};}};
  assert.equal((await isolated.api.beginCardWebSession(false,hosted)).status,'connected');
  assert.equal((await isolated.api.retryCardWebSession(hosted)).status,'connected');
  assert.equal(routes.length,2);assert.notEqual(routes[0],routes[1]);assert.equal(isolated.providerCalls.length,0);assert.equal(isolated.navigations,0);
});
test('selected Hosted unsupported method cannot silently select injected YNX or revoke a grant',async()=>{
  const isolated=load(new Map(),{ready:true,provider:'ynx'});
  const hosted={requestProductSessionV2:async()=>{throw Object.assign(Error('unsupported'),{code:4200});}};
  await assert.rejects(isolated.api.beginCardWebSession(false,hosted),{code:4200});
  assert.equal(isolated.providerCalls.length,0);assert.equal(isolated.calls[0]!.returned.length,0);assert.equal(isolated.calls[0]!.disconnected,0);
});
test('local context cancellation drops late Hosted approval without SDK revocation',async()=>{
  const isolated=load(new Map(),{ready:true}),late=deferred<unknown>();let requested=false;
  const opening=isolated.api.beginCardWebSession(false,{requestProductSessionV2:()=>{requested=true;return late.promise;}});
  while(!requested)await tick();isolated.api.cancelCardWebSessionAttempt();
  late.resolve({version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?result=approved'});
  await assert.rejects(opening,{code:'CARD_WEB_PRIVATE_CONTEXT_CHANGED'});assert.equal(isolated.calls[0]!.disconnected,0);assert.equal(isolated.calls[0]!.returned.length,0);
});

test('Finance scope mode restores its own namespace without a new request',async()=>{
  const storage=new Map<string,string>();const first=load(storage,{financeScope:true});await first.api.beginCardWebSession(true);
  assert.ok(first.calls[0]!.scopes.includes('card:finance:share'));assert.equal(first.calls[0]!.begun,1);
  const reloaded=load(storage,{financeScope:true});await reloaded.api.restoreCardWebSession();assert.ok(reloaded.calls[0]!.scopes.includes('card:finance:share'));assert.equal(reloaded.calls[0]!.restored,1);
  await reloaded.api.beginCardWebSession(false);assert.equal(reloaded.calls.length,2);assert.equal(reloaded.calls[0]!.disconnected,1);assert.ok(!reloaded.calls[1]!.scopes.includes('card:finance:share'));
});
test('legacy local-only intent stays paused with SDK records retained; trusted corrupt mode is rejected',async()=>{
  const storage=new Map([['ynx.card.provider-session.v2.attempted','yes'],['protected-sdk-record','UNCHANGED_TEST_RECORD']]);const legacy=load(storage);assert.equal(await legacy.api.restoreCardWebSession(),null);assert.equal(legacy.calls.length,0);assert.equal(storage.get('protected-sdk-record'),'UNCHANGED_TEST_RECORD');assert.equal(storage.get('ynx.card.provider-session.v2.attempted'),'yes');
  storage.set('tab:ynx.card.provider-session.v2.attempted','yes');
  storage.set('ynx.card.provider-session.v2.scope-mode','arbitrary');const corrupt=load(storage);await assert.rejects(corrupt.api.restoreCardWebSession(),/CARD_SESSION_MODE_INVALID/);assert.equal(corrupt.calls.length,0);
});
test('exact YNX Provider transports the pending request as data and same SDK handles approval',async()=>{
  const isolated=load(new Map(),{ready:true,provider:'ynx'});assert.equal((await isolated.api.beginCardWebSession()).status,'connected');
  assert.equal(isolated.calls[0]!.begun,1);assert.equal(isolated.calls[0]!.returned.length,1);
  assert.deepEqual(isolated.providerCalls.map(call=>call.method),['ynx_requestProductSessionV2']);
  assert.match(String(isolated.providerCalls[0]!.params[0]),/^ynxwallet:\/\/authorize\?request=synthetic-1$/);
  assert.equal(isolated.window.location.href,'https://card.ynxweb4.com/');assert.equal(isolated.navigations,0);
});
test('signed rejection reaches SDK and never becomes a connection',async()=>{
  const isolated=load(new Map(),{ready:true,provider:'ynx',request:async()=>({version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?productSessionResult=synthetic-rejected'})});
  assert.equal((await isolated.api.beginCardWebSession()).status,'disconnected');assert.equal(isolated.calls[0]!.returned.length,1);
});
test('no exact YNX Provider and MetaMask-only browser keep Card visible',async()=>{
  for(const provider of ['none','metamask'] as const){const isolated=load(new Map(),{ready:true,provider});await assert.rejects(isolated.api.beginCardWebSession(),{code:'CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE'});assert.equal(isolated.calls[0]!.begun,1);assert.equal(isolated.providerCalls.length,0);assert.equal(isolated.navigations,0)}
});
test('malformed return, user rejection and account switch never reach SDK completion',async()=>{
  for(const response of [{version:1,returnUrl:'https://card.ynxweb4.com/'},{version:2,returnUrl:''},null]){const isolated=load(new Map(),{ready:true,provider:'ynx',request:async()=>response});await assert.rejects(isolated.api.beginCardWebSession(),{code:'CARD_WEB_PRIVATE_RETURN_INVALID'});assert.equal(isolated.calls[0]!.returned.length,0)}
  for(const code of [4001,'PROVIDER_ACCOUNT_CHANGED','PRIVATE_APPROVAL_CLOSED','PRIVATE_REQUEST_REPLAYED']){const isolated=load(new Map(),{ready:true,provider:'ynx',request:async()=>{throw Object.assign(Error(String(code)),{code})}});await assert.rejects(isolated.api.beginCardWebSession(),{code});assert.equal(isolated.calls[0]!.returned.length,0)}
});
test('watchdog follows extension review deadline and discards approval after timeout',async()=>{
  const late=deferred<unknown>();const isolated=load(new Map(),{ready:true,provider:'ynx',fastTimeout:true,request:async()=>late.promise});
  await assert.rejects(isolated.api.beginCardWebSession(),{code:'CARD_WEB_PRIVATE_TRANSPORT_TIMEOUT'});
  late.resolve({version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?productSessionResult=synthetic-approved'});await tick();
  assert.equal(isolated.calls[0]!.returned.length,0);assert.equal(isolated.navigations,0);
});
test('Retry creates a fresh SDK nonce instead of replaying detected pending data',async()=>{
  let first=true;const isolated=load(new Map(),{ready:true,provider:'ynx',request:async()=>{if(first){first=false;throw Object.assign(Error('replayed'),{code:'PRIVATE_REQUEST_REPLAYED'})}return {version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?productSessionResult=synthetic-approved'}}});
  await assert.rejects(isolated.api.beginCardWebSession(),{code:'PRIVATE_REQUEST_REPLAYED'});
  assert.equal((await isolated.api.retryCardWebSession()).status,'connected');assert.equal(isolated.calls[0]!.begun,2);assert.equal(isolated.calls[0]!.retries,0);assert.notEqual(isolated.providerCalls[0]!.params[0],isolated.providerCalls[1]!.params[0]);
});
test('disconnect drops a late Provider return without granting a Session',async()=>{
  const late=deferred<unknown>(),isolated=load(new Map(),{ready:true,provider:'ynx',request:async()=>late.promise});const opening=isolated.api.beginCardWebSession();while(!isolated.providerCalls.length)await tick();
  assert.equal((await isolated.api.disconnectCardWebSession()).status,'disconnected');late.resolve({version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?productSessionResult=synthetic-approved'});
  await assert.rejects(opening,{code:'CARD_WEB_PRIVATE_CONTEXT_CHANGED'});assert.equal(isolated.calls[0]!.returned.length,0);
});
test('scope switch waits for in-flight Gateway return and revocation before new namespace',async()=>{
  const completion=deferred<Session>(),revocation=deferred<void>();
  const isolated=load(new Map(),{ready:true,provider:'ynx',financeScope:true,returnState:async()=>completion.promise,disconnect:async()=>revocation.promise});
  const opening=isolated.api.beginCardWebSession(false);while(!isolated.calls[0]?.returned.length)await tick();
  const switching=isolated.api.beginCardWebSession(true);await tick();assert.equal(isolated.calls.length,1);assert.equal(isolated.calls[0]!.disconnected,1);
  completion.resolve({status:'connected'});await assert.rejects(opening,{code:'CARD_WEB_PRIVATE_CONTEXT_CHANGED'});assert.equal(isolated.calls.length,1);
  revocation.resolve();assert.equal((await switching).status,'connected');assert.equal(isolated.calls.length,2);assert.equal(isolated.calls[0]!.closed,1);assert.ok(isolated.calls[1]!.scopes.includes('card:finance:share'));
});

test('account-change pause survives a cold reload without revoking or erasing the SDK namespace',async()=>{
 const values=new Map<string,string>([['protected-sdk-record','UNCHANGED_TEST_RECORD']]);const first=load(values,{ready:true,provider:'ynx'});
 await first.api.beginCardWebSession();first.api.cancelCardWebSessionAttempt();assert.equal(first.calls[0]!.disconnected,0);assert.equal(values.get('protected-sdk-record'),'UNCHANGED_TEST_RECORD');
 const reloaded=load(values);assert.equal(await reloaded.api.restoreCardWebSession(),null);assert.equal(reloaded.calls.length,0);
 reloaded.window.location.href='https://card.ynxweb4.com/wallet-auth/callback?result=synthetic-approved';await assert.rejects(reloaded.api.restoreCardWebSession(),{code:'CARD_WEB_PRIVATE_CONTEXT_CHANGED'});assert.equal(reloaded.calls.length,0);
});
test('pause survives failed or silent local writes through a verified tab tombstone',async()=>{
 for(const pauseStorage of ['local-throw','local-silent'] as const){const values=new Map<string,string>(),first=load(values,{ready:true,provider:'ynx',pauseStorage});await first.api.beginCardWebSession();first.api.cancelCardWebSessionAttempt();const next=load(values);assert.equal(await next.api.restoreCardWebSession(),null);assert.equal(next.calls.length,0);assert.equal(first.calls[0]!.disconnected,0);}
});
test('unwritable pause explicitly fails and blocks same-runtime proof without deleting grant',async()=>{
 const values=new Map<string,string>(),first=load(values,{ready:true,provider:'ynx',pauseStorage:'both-throw'});await first.api.beginCardWebSession();assert.throws(()=>first.api.cancelCardWebSessionAttempt(),{code:'CARD_SESSION_PAUSE_STORAGE_FAILED'});assert.equal(await first.api.restoreCardWebSession(),null);await assert.rejects(first.api.cardWebProof(['account:read']),{code:'CARD_WEB_PRIVATE_CONTEXT_CHANGED'});assert.equal(first.calls[0]!.disconnected,0);
 // A browser restart clears tab storage: an old local yes marker cannot restore.
 for(const key of [...values.keys()])if(key.startsWith('tab:'))values.delete(key);
 const cold=load(values);assert.equal(await cold.api.restoreCardWebSession(),null);assert.equal(cold.calls.length,0);
});
test('unsupported sharing cannot revoke the approved base session or silently expand its scope',async()=>{
 const values=new Map<string,string>(),isolated=load(values,{ready:true,provider:'ynx'});await isolated.api.beginCardWebSession(false);
 const before=JSON.stringify([...values]);await assert.rejects(isolated.api.beginCardWebSession(true),{code:'CARD_FINANCE_SCOPE_UNAVAILABLE'});
 assert.equal(isolated.calls.length,1);assert.equal(isolated.calls[0]!.disconnected,0);assert.equal(JSON.stringify([...values]),before);
});
test('local pause still allows an explicit SDK revocation and only returns its confirmed result',async()=>{
 const values=new Map<string,string>(),isolated=load(values,{ready:true,provider:'ynx'});await isolated.api.beginCardWebSession();isolated.api.cancelCardWebSessionAttempt();assert.equal(isolated.calls[0]!.disconnected,0);assert.equal((await isolated.api.disconnectCardWebSession()).status,'disconnected');assert.equal(isolated.calls[0]!.disconnected,1);assert.equal(await isolated.api.restoreCardWebSession(),null);
});
test('failed explicit SDK revocation is not reported as revoked and cannot automatically restore',async()=>{
 const values=new Map<string,string>(),isolated=load(values,{ready:true,provider:'ynx',disconnect:async()=>{throw Object.assign(Error('synthetic revocation unavailable'),{code:'PRODUCT_SESSION_GATEWAY_UNREACHABLE'})}});await isolated.api.beginCardWebSession();await assert.rejects(isolated.api.disconnectCardWebSession(),{code:'PRODUCT_SESSION_GATEWAY_UNREACHABLE'});assert.equal(isolated.calls[0]!.disconnected,1);assert.equal(await load(values).api.restoreCardWebSession(),null);assert.equal(values.get('ynx.card.provider-session.v2.attempted'),'no');
});
