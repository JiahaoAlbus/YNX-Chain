import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const response=(status,body={})=>({status,ok:status>=200&&status<300,json:async()=>body});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function page({storage=new Map(),revoke=async()=>response(204),requests={}}={}){
 const nodes=new Map(),calls=[],timers=new Map();
 let reloads=0,nextTimer=0;
 function node(selector){
  if(!nodes.has(selector)){
   const classes=new Set();
   nodes.set(selector,{textContent:'',innerHTML:'',value:'',dataset:{},style:{},handlers:{},
    classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,on){if(on??!classes.has(name))classes.add(name);else classes.delete(name)}},
    addEventListener(type,handler){this.handlers[type]=handler},close(){this.open=false},focus(){}});
  }
  return nodes.get(selector);
 }
 const context=vm.createContext({
  document:{querySelector:node,querySelectorAll:()=>[]},
  sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key),clear:()=>assert.fail('Must not clear unrelated storage')},
  location:{reload:()=>reloads++},AbortController,
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  fetch:async(path,options={})=>{
   calls.push({path,options});
   if(path==='/api/auth/revoke')return revoke(options);
   if(requests[path])return requests[path](options);
   if(path==='/api/auth/session')return response(200,{account:storage.get('ynx-ai-account'),deviceId:storage.get('ynx-ai-device')});
   if(path==='/api/public-status')return response(200,{gatewayReady:true});
   if(path.startsWith('/api/conversations?'))return response(200,{conversations:[]});
   if(path==='/api/privacy')return response(200,{policy:{retentionDays:7,saveEncryptedBody:false,allowedContextTypes:[]}});
   if(path==='/api/provider')return response(200,{});
   throw new Error(`Unexpected request: ${path}`);
  }
 });
 vm.runInContext(source,context);
 return {storage,calls,timers,node,context,get reloads(){return reloads},
  logout:()=>node('#signout').handlers.click(),
  submit:selector=>node(selector).handlers.submit({preventDefault(){}}),
  eval:code=>vm.runInContext(code,context)};
}
const credentials=()=>new Map([['ynx-ai-token','test-token'],['ynx-ai-device','test-device'],['ynx-ai-account','test-account'],['unrelated-key','keep'],['wallet-sdk-state','keep-sdk']]);
function locallySignedOut(p){
 for(const key of ['ynx-ai-token','ynx-ai-device','ynx-ai-account'])assert.equal(p.storage.has(key),false);
 assert.equal(p.storage.get('unrelated-key'),'keep');
 assert.equal(p.storage.get('wallet-sdk-state'),'keep-sdk');
 assert.equal(p.eval('state.token+state.deviceId+state.account'),'');
 assert.equal(p.node('#app').classList.contains('hidden'),true);
}

test('204 confirms only this AI session; local data is cleared before the response; duplicate clicks are inert',async()=>{
 let finish;
 const p=page({storage:credentials(),revoke:()=>new Promise(resolve=>{finish=resolve})});
 await tick();
 p.eval('state.abort=new AbortController();globalThis.generationSignal=state.abort.signal');
 const first=p.logout();
 locallySignedOut(p);
 assert.equal(p.eval('generationSignal.aborted'),true);
 assert.equal(p.node('#signout').disabled,true);
 assert.equal(p.storage.get('ynx-ai-signout-status'),'unconfirmed');
 await p.logout();
 assert.equal(p.calls.filter(c=>c.path==='/api/auth/revoke').length,1);
 const call=p.calls.find(c=>c.path==='/api/auth/revoke');
 assert.equal(call.options.headers.Authorization,'Bearer test-token');
 assert.equal(call.options.headers['X-YNX-Device-ID'],'test-device');
 assert.equal(call.options.redirect,'error');
 const count=p.calls.length;
 await assert.rejects(p.eval("api('/api/provider')"),/session has ended/);
 assert.equal(p.calls.length,count);
 finish(response(204));await first;
 assert.equal(p.storage.get('ynx-ai-signout-status'),'revoked');
 assert.equal(p.reloads,1);
 assert.equal(p.timers.size,0);
 const reloaded=page({storage:p.storage});await tick();
 assert.match(reloaded.node('#auth-error').textContent,/server confirmed revocation of this AI session/);
 assert.deepEqual(reloaded.calls.map(c=>c.path),['/api/public-status']);
 await p.logout();assert.equal(p.reloads,1);
});

for(const status of [401,500,200])test(`HTTP ${status} does not claim the server's 204 revocation confirmation`,async()=>{
 const p=page({storage:credentials(),revoke:async()=>response(status)});await tick();
 await p.logout();locallySignedOut(p);
 assert.equal(p.storage.get('ynx-ai-signout-status'),'unconfirmed');
 assert.match(p.node('#auth-error').textContent,/Server revocation is not confirmed/);
 const reloaded=page({storage:p.storage});await tick();
 assert.match(reloaded.node('#auth-error').textContent,/may still be active on the server/);
});

test('network failure preserves other storage and shows unconfirmed remote revocation',async()=>{
 const p=page({storage:credentials(),revoke:async()=>{throw new TypeError('offline')}});await tick();
 await p.logout();locallySignedOut(p);
 assert.equal(p.storage.get('ynx-ai-signout-status'),'unconfirmed');
 assert.equal(p.reloads,1);
});

test('timeout aborts the revoke request and cannot leave logout waiting forever',async()=>{
 const p=page({storage:credentials(),revoke:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))});await tick();
 const pending=p.logout();
 const timer=[...p.timers.values()].find(t=>t.ms===8000);assert.ok(timer);
 timer.fn();await pending;
 locallySignedOut(p);assert.equal(p.reloads,1);
 assert.equal(p.storage.get('ynx-ai-signout-status'),'unconfirmed');
});

test('late restore failure cannot clear other storage or race the logout reload',async()=>{
 let finishRestore,finishRevoke;
 const p=page({storage:credentials(),requests:{'/api/auth/session':()=>new Promise(resolve=>{finishRestore=resolve})},revoke:()=>new Promise(resolve=>{finishRevoke=resolve})});
 const pending=p.logout();
 finishRestore(response(500));await tick();
 locallySignedOut(p);assert.equal(p.reloads,0);
 finishRevoke(response(204));await pending;
 assert.equal(p.reloads,1);
});

test('late login response cannot repopulate credentials after signout',async()=>{
 let finishLogin;
 const p=page({requests:{'/api/auth/challenges//verify':()=>new Promise(resolve=>{finishLogin=resolve})}});
 const login=p.submit('#verify-form');
 await p.logout();
 finishLogin(response(200,{token:'late-token',deviceId:'late-device',account:'late-account'}));await login;
 assert.equal(p.storage.has('ynx-ai-token'),false);
 assert.equal(p.eval('state.token'),'');
 assert.match(p.node('#auth-error').textContent,/Server revocation is not confirmed/);
 assert.equal(p.calls.some(c=>c.path==='/api/auth/revoke'),false);
});

test('401 readback removes only the expired AI session without an authorization request',async()=>{
 const p=page({storage:credentials(),requests:{'/api/auth/session':async()=>response(401)}});await tick();
 assert.equal(p.storage.has('ynx-ai-token'),false);
 assert.equal(p.storage.get('unrelated-key'),'keep');
 assert.equal(p.storage.get('wallet-sdk-state'),'keep-sdk');
 assert.equal(p.reloads,0);
 assert.equal(p.storage.get('ynx-ai-signout-status'),'expired');
 assert.deepEqual(p.calls.map(c=>c.path),['/api/auth/session']);
});

test('temporary readback failure keeps credentials, hides private UI and permits a single-flight retry',async()=>{
 let attempts=0,finish;
 const p=page({storage:credentials(),requests:{'/api/auth/session':()=>++attempts===1?response(503):new Promise(resolve=>{finish=resolve})}});await tick();
 assert.equal(p.storage.get('ynx-ai-token'),'test-token');
 assert.equal(p.node('#app').classList.contains('hidden'),true);
 assert.match(p.node('#session-recovery-status').textContent,/saved session has been kept/);
 const first=p.node('#session-retry').handlers.click();
 const second=p.node('#session-retry').handlers.click();
 assert.equal(attempts,2);
 finish(response(200,{account:'test-account',deviceId:'test-device'}));await Promise.all([first,second]);
 assert.equal(p.node('#app').classList.contains('hidden'),false);
 assert.equal(p.calls.some(c=>(c.options.method??'GET')!=='GET'),false);
});

test('readback identity substitution is not silently adopted',async()=>{
 const p=page({storage:credentials(),requests:{'/api/auth/session':async()=>response(200,{account:'other-account',deviceId:'test-device'})}});await tick();
 locallySignedOut(p);assert.equal(p.storage.get('ynx-ai-signout-status'),'expired');
 assert.equal(p.calls.length,1);
});

test('workspace loading failure does not erase a verified session',async()=>{
 const p=page({storage:credentials(),requests:{'/api/conversations?archived=false&q=':async()=>response(500)}});await tick();
 assert.equal(p.storage.get('ynx-ai-token'),'test-token');
 assert.equal(p.node('#app').classList.contains('hidden'),false);
 assert.match(p.node('#toast').textContent,/Some workspace data could not be loaded/);
 assert.equal(p.reloads,0);
});

test('provider identity changes clear private AI credentials and discard pending readback',async()=>{
 let finish;
 const p=page({storage:credentials(),requests:{'/api/auth/session':()=>new Promise(resolve=>{finish=resolve})}});
 p.eval('invalidateWalletSession()');
 finish(response(200,{account:'test-account',deviceId:'test-device'}));await tick();
 locallySignedOut(p);
 assert.equal(p.storage.get('ynx-ai-signout-status'),'wallet-changed');
 assert.match(p.node('#auth-error').textContent,/remote revocation is not confirmed/);
 assert.equal(p.calls.length,1);
});
