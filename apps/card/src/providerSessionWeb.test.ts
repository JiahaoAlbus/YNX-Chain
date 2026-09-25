import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {cardCallbackKind} from './providerCallback';

// Synthetic SDK and Provider doubles. No public Gateway, Wallet approval or account is proven.
type Session={status:string};
type Options={ready?:boolean;provider?:'ynx'|'metamask'|'none';request?:(input:{method:string;params:readonly unknown[]})=>Promise<unknown>;returnState?:(url:string)=>Promise<Session>;disconnect?:()=>Promise<void>;fastTimeout?:boolean};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}}
function load(values:Map<string,string>,options:Options={}){
  const calls:{scopes:string[];restored:number;begun:number;returned:string[];retries:number;disconnected:number;closed:number}[]=[];
  const providerCalls:{method:string;params:readonly unknown[]}[]=[];
  const exports:Record<string,any>={};let navigations=0;
  const w={location:{origin:'https://card.ynxweb4.com',href:'https://card.ynxweb4.com/',assign:()=>{navigations++;throw Error('Unexpected navigation')}},isSecureContext:true,navigator:{onLine:true},history:{replaceState(){}},localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}};
  const provider={isYNXWallet:true,isMetaMask:false,request:async(input:{method:string;params:readonly unknown[]})=>{providerCalls.push(input);return options.request?.(input)??{version:2,returnUrl:'https://card.ynxweb4.com/wallet-auth/callback?productSessionResult=synthetic-approved'}}};
  const sdk={ProductSessionGatewayFetchAdapter:class{},createBrowserProductSessionClient:async(config:any)=>{
    const record={scopes:[...config.scopes],restored:0,begun:0,returned:[] as string[],retries:0,disconnected:0,closed:0};calls.push(record);
    let current:Session={status:'disconnected'},pendingReturn:Promise<Session>|null=null;
    return {close(){record.closed++},client:{get current(){return current},restore:async()=>{record.restored++;return current},beginExplicit:async()=>{record.begun++;current=options.ready?{status:'connecting'}:{status:'disconnected'};return options.ready?{status:'connecting',route:{status:'ready',url:`ynxwallet://authorize?request=synthetic-${record.begun}`}}:current},handleReturn:async(url:string)=>{record.returned.push(url);const operation=(async()=>{current=await (options.returnState?.(url)??Promise.resolve({status:url.includes('rejected')?'disconnected':'connected'}));return current})();pendingReturn=operation;try{return await operation}finally{if(pendingReturn===operation)pendingReturn=null}},retryDetected:async()=>{record.retries++;throw Error('stale retry prohibited')},disconnect:async()=>{record.disconnected++;if(pendingReturn)await pendingReturn.catch(()=>{});await options.disconnect?.();current={status:'disconnected'};return current}}};
  }};
  const source=ts.transpileModule(fs.readFileSync(new URL('./providerSessionWeb.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const schedule=options.fastTimeout?((fn:()=>void,ms:number)=>setTimeout(fn,ms===125_000?0:ms)):setTimeout;
  vm.runInNewContext(source,{exports,window:w,URL,fetch:async()=>{throw Error('No external requests allowed')},setTimeout:schedule,clearTimeout,require:(name:string)=>{if(name==='@ynx-chain/wallet-auth-card-provider-v2')return sdk;if(name.includes('registry-b754'))return {};if(name==='./providerCallback')return {cardCallbackKind};if(name==='./standardWalletSdk')return {discoverWalletProviders:async()=>({ynx:options.provider==='ynx'?{kind:'ynx-wallet',provider}:null,metamask:options.provider==='metamask'?{kind:'metamask',provider:{isMetaMask:true}}:null}),isSharedWalletProvider:(value:unknown,kind:string)=>kind==='ynx-wallet'&&value===provider};throw Error('Unexpected import '+name)}});
  return {api:exports,calls,providerCalls,get navigations(){return navigations},window:w};
}
const tick=()=>new Promise(done=>setTimeout(done,0));

test('Finance scope mode restores its own namespace without a new request',async()=>{
  const storage=new Map<string,string>();const first=load(storage);await first.api.beginCardWebSession(true);
  assert.ok(first.calls[0]!.scopes.includes('card:finance:share'));assert.equal(first.calls[0]!.begun,1);
  const reloaded=load(storage);await reloaded.api.restoreCardWebSession();assert.ok(reloaded.calls[0]!.scopes.includes('card:finance:share'));assert.equal(reloaded.calls[0]!.restored,1);
  await reloaded.api.beginCardWebSession(false);assert.equal(reloaded.calls.length,2);assert.equal(reloaded.calls[0]!.disconnected,1);assert.ok(!reloaded.calls[1]!.scopes.includes('card:finance:share'));
});
test('legacy attempted sessions stay base-only and corrupt mode is rejected',async()=>{
  const storage=new Map([['ynx.card.provider-session.v2.attempted','yes']]);const legacy=load(storage);await legacy.api.restoreCardWebSession();assert.ok(!legacy.calls[0]!.scopes.includes('card:finance:share'));
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
  const isolated=load(new Map(),{ready:true,provider:'ynx',returnState:async()=>completion.promise,disconnect:async()=>revocation.promise});
  const opening=isolated.api.beginCardWebSession(false);while(!isolated.calls[0]?.returned.length)await tick();
  const switching=isolated.api.beginCardWebSession(true);await tick();assert.equal(isolated.calls.length,1);assert.equal(isolated.calls[0]!.disconnected,1);
  completion.resolve({status:'connected'});await assert.rejects(opening,{code:'CARD_WEB_PRIVATE_CONTEXT_CHANGED'});assert.equal(isolated.calls.length,1);
  revocation.resolve();assert.equal((await switching).status,'connected');assert.equal(isolated.calls.length,2);assert.equal(isolated.calls[0]!.closed,1);assert.ok(isolated.calls[1]!.scopes.includes('card:finance:share'));
});
