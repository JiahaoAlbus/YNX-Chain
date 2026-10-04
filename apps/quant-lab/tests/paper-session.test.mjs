import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Execute the owned draft itself. SDK/session/provider facades are controlled
// fixtures, not real approval, public deployment or engine execution evidence.
const source=await readFile(new URL('../web/paper-session.js',import.meta.url),'utf8');
function setup(){
  const events=new Map(),storage=new Map(),calls=[];
  let proofHook=async()=>({proofHeader:'fixture-only'}),responseHook=async()=>new Response(JSON.stringify(payload()),{headers:{'content-type':'application/json'}});
  const context={provider:{},account:'0x'+'1'.repeat(40),chainId:'0x1917',providerKind:'ynx-wallet',revision:0,status:'connected'};
  const current={status:'connected',session:{account:'ynx-fixture-owner',sessionBinding:'fixture-binding'}};
  function payload(){return {account:current.session.account,sessionBinding:current.session.sessionBinding,paper:{},strategies:{},experiments:{},audit:[],access:{paperWorkspaceAuthorized:true,statefulPreview:false,nativeExecutionEnabled:false,scheduleAuthorized:false}};}
  const client={current,restore:async()=>current,disconnect:async()=>({status:'disconnected',revocationConfirmed:true})};
  const elements=new Map(['paper-authorize','paper-refresh','paper-revoke','paper-session-status','locale'].map(id=>[id,{dataset:{},addEventListener(){}}]));
  const window={YNXQuantWallet:{getPrivateWalletContext:()=>({...context})},addEventListener:(name,fn)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);},dispatchEvent:event=>{for(const fn of events.get(event.type)||[])fn(event);}};
  const realm=vm.createContext({window,document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[]},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},navigator:{onLine:true},registry:{},privateSessionCopy:()=>({pending:'pending',connected:'connected',guest:'guest',unavailable:'unavailable'}),paperSessionCopy:()=>({authorize:'authorize',refresh:'refresh',revoke:'revoke',boundary:'simulation only'}),ProductSessionGatewayFetchAdapter:class{},createBrowserProductSessionClient:async()=>({client,close(){},createIntrospectionProof:()=>proofHook()}),fetch:async(...args)=>{calls.push(args);return responseHook(...args);},Response,TextDecoder,TextEncoder,Uint8Array,AbortController,setTimeout,clearTimeout,queueMicrotask,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},console});
  storage.set('ynx.quant.paper-workspace-session.v1.started','true');
  realm.URL=URL;
  vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nglobalThis.qa={mountPaperSession,paperWorkspaceRequest,revokePaperSession,getPaperSessionState,getPaperWorkspaceSnapshot};',realm);
  realm.qa.mountPaperSession();
  return {qa:realm.qa,calls,context,payload,window,proof:fn=>{proofHook=fn;},response:fn=>{responseHook=fn;},ready:async()=>{for(let i=0;i<20&&realm.qa.getPaperSessionState().status!=='connected';i++)await new Promise(resolve=>setTimeout(resolve,0));assert.equal(realm.qa.getPaperSessionState().status,'connected');}};
}
test('Paper reads use the separate approved scope and owner receipt; failures leave Standard Wallet intact',async()=>{
  const f=setup();await f.ready();await f.qa.paperWorkspaceRequest('/v1/wallet/paper/snapshot');
  assert.equal(f.qa.getPaperSessionState().ready,true);assert.equal(f.calls[0][1].credentials,'same-origin');
  f.response(async()=>new Response('{}',{status:503}));
  await assert.rejects(f.qa.paperWorkspaceRequest('/v1/wallet/paper/snapshot'),{code:'PAPER_SERVICE_UNAVAILABLE'});
  assert.equal(f.context.status,'connected');assert.equal(f.qa.getPaperSessionState().ready,false);
  f.response(async()=>new Response(JSON.stringify({...f.payload(),account:'foreign-owner'}),{headers:{'content-type':'application/json'}}));
  await assert.rejects(f.qa.paperWorkspaceRequest('/v1/wallet/paper/snapshot'),{code:'PAPER_BINDING_MISMATCH'});
});
test('revoke while proof is pending prevents HTTP and clears cached ownership',async()=>{
  const f=setup();await f.ready();let release;
  f.proof(()=>new Promise(resolve=>{release=resolve;}));
  const pending=f.qa.paperWorkspaceRequest('/v1/wallet/paper/snapshot');
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  await f.qa.revokePaperSession();release({proofHeader:'late'});
  await assert.rejects(pending,{code:'PRIVATE_OPERATION_SUPERSEDED'});assert.equal(f.calls.length,0);assert.equal(f.context.status,'connected');
});
test('Paper POST freezes request bytes before asynchronous proof creation',async()=>{
  const f=setup();await f.ready();let release;
  f.proof(()=>new Promise(resolve=>{release=resolve;}));
  const options={method:'POST',body:'{"side":"buy"}'};
  const pending=f.qa.paperWorkspaceRequest('/v1/wallet/paper/orders',options);
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  options.body='{"side":"sell"}';release({proofHeader:'fixture'});await pending;
  assert.equal(f.calls[0][1].body,'{"side":"buy"}');
});
test('oversized Paper response cancels at the limit instead of reading the whole stream',async()=>{
  const f=setup();await f.ready();let cancelled=false,reads=0;
  f.response(async()=>({ok:true,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(2097153)};},cancel:async()=>{cancelled=true;},releaseLock(){}})},text:async()=>{reads=999;return ' '.repeat(2097153);}}));
  await assert.rejects(f.qa.paperWorkspaceRequest('/v1/wallet/paper/snapshot'),{code:'PAPER_BINDING_MISMATCH'});
  assert.equal(cancelled,true);assert.equal(reads,1);assert.equal(f.qa.getPaperSessionState().ready,false);
});
test('unsupported operations and invalid POST bytes fail before HTTP',async()=>{
  const f=setup();await f.ready();
  await assert.rejects(f.qa.paperWorkspaceRequest('/v1/risk/kill',{method:'POST',body:'{}'}),{code:'PAPER_OPERATION_NOT_AUTHORIZED'});
  await assert.rejects(f.qa.paperWorkspaceRequest('/v1/wallet/paper/orders',{method:'POST',body:{side:'buy'}}),{code:'PAPER_OPERATION_NOT_AUTHORIZED'});
  assert.equal(f.calls.length,0);
});
test('bounded read selectors reject injection/duplicate/unsafe offsets before HTTP; detail never replaces workspace',async()=>{
 const f=setup();await f.ready();for(const path of ['https://other.example/v1/wallet/paper/snapshot','/v1/wallet/paper/snapshot?history=bounded_v1&account=foreign','/v1/wallet/paper/snapshot?history=bounded_v1&offset=1','/v1/wallet/paper/snapshot?history=bounded_v1&offset=9007199254741000','/v1/wallet/paper/snapshot?history=bounded_v1&history=bounded_v1','/v1/wallet/paper/experiment?id=x'])await assert.rejects(f.qa.paperWorkspaceRequest(path),{code:'PAPER_OPERATION_NOT_AUTHORIZED'});assert.equal(f.calls.length,0);
 await f.qa.paperWorkspaceRequest('/v1/wallet/paper/snapshot');const previous=f.qa.getPaperWorkspaceSnapshot();assert.equal(f.calls[0][0],'/api/v1/wallet/paper/snapshot?history=bounded_v1');
 f.response(async()=>new Response(JSON.stringify({account:previous.account,sessionBinding:previous.sessionBinding,revision:'revision',experiment:{id:'saved'}}),{headers:{'content-type':'application/json'}}));await f.qa.paperWorkspaceRequest('/v1/wallet/paper/experiment?id=saved&revision=revision');assert.equal(f.qa.getPaperWorkspaceSnapshot(),previous);
 f.response(async()=>new Response(JSON.stringify({account:previous.account,sessionBinding:previous.sessionBinding,revision:'stale',experiment:{id:'saved'}}),{headers:{'content-type':'application/json'}}));await assert.rejects(f.qa.paperWorkspaceRequest('/v1/wallet/paper/experiment?id=saved&revision=revision'),{code:'PAPER_BINDING_MISMATCH'});assert.equal(f.context.status,'connected');
});
