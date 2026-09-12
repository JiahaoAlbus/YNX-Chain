import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createCloudLogin, selectCloudWallet} from '../web/wallet-login.js';
import {authMessages, authT, applyAuthLocale} from '../web/auth-i18n.js';

const entry = kind => ({info:{rdns:kind==='ynx'?'com.ynx.wallet':'io.metamask'},
  provider:{isYNXWallet:kind==='ynx',isMetaMask:kind==='metamask',request(){}}});
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
function harness(entries, options={}) {
  const calls=[],messages=[],busy=[],accepted=[];
  const login=createCloudLogin({discover:options.discover??(async()=>entries),
    createConnection:provider=>({async connect(){calls.push(provider);if(options.connect)return options.connect();return {account:'0x'+'1'.repeat(40)}},
      async ensureYNXTestnet(){calls.push('chain');if(options.chainError)throw options.chainError}}),
    addChain:{chainId:'0x1917'},connected:(...args)=>accepted.push(args),message:(...args)=>messages.push(args),busy:v=>busy.push(v)});
  return {login,calls,messages,busy,accepted};
}
for(const kind of ['ynx','metamask']) {
  test(`missing selected ${kind} never requests the other wallet`,async()=>{
    const h=harness([entry(kind==='ynx'?'metamask':'ynx')]);await h.login.start(kind);
    assert.equal(h.calls.length,0);assert.equal(h.accepted.length,0);
    assert.equal(h.messages.at(-1)[0],kind==='ynx'?'missingYNX':'missingMetaMask');
  });
  for(const reversed of [false,true]) test(`explicit ${kind}, reversed discovery=${reversed}`,async()=>{
    const entries=[entry('ynx'),entry('metamask')];if(reversed)entries.reverse();
    const h=harness(entries);await h.login.start(kind);
    assert.equal(h.calls[0],entries.find(e=>e.provider.isYNXWallet===(kind==='ynx')).provider);
    assert.equal(h.calls.length,2);assert.equal(h.accepted.length,1);assert.equal(h.accepted[0][2],kind);
  });
}
test('display name alone and conflicting identity flags cannot select a wallet',()=>{
  assert.equal(selectCloudWallet([{info:{name:'YNX Wallet'},provider:{request(){}}}],'ynx'),undefined);
  const both=entry('ynx');both.provider.isMetaMask=true;
  assert.equal(selectCloudWallet([both],'ynx'),undefined);assert.equal(selectCloudWallet([both],'metamask'),undefined);
});
for(const code of [4001,4200,'WALLET_USER_REJECTED','WALLET_UNSUPPORTED_METHOD']) {
  test(`${code} rejection never falls back or creates a session`,async()=>{
    const h=harness([entry('ynx'),entry('metamask')],{connect:async()=>{throw {code}}});
    await h.login.start('metamask');assert.equal(h.calls.length,1);assert.equal(h.accepted.length,0);
    assert.equal(h.messages.at(-1)[0],String(code).includes('REJECTED')||code===4001?'rejected':'unsupported');
    assert.deepEqual(h.busy,[true,false]);
  });
}
test('cancel during discovery starts no wallet request',async()=>{
  const d=deferred(),h=harness([],{discover:()=>d.promise});const pending=h.login.start('ynx');
  h.login.cancel();d.resolve([entry('ynx')]);await pending;
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.accepted,[]);assert.equal(h.messages.at(-1)[0],'cancelled');
});
test('cancel after request suppresses late chain switching and result adoption',async()=>{
  const d=deferred(),h=harness([entry('ynx')],{connect:()=>d.promise});const pending=h.login.start('ynx');
  await Promise.resolve();h.login.cancel();d.resolve({account:'0x'+'1'.repeat(40)});await pending;
  assert.equal(h.calls.length,1);assert.equal(h.accepted.length,0);assert.equal(h.messages.at(-1)[0],'cancelled');
});
test('duplicate submissions stay single flight and an explicit later retry works',async()=>{
  const d=deferred(),h=harness([entry('ynx'),entry('metamask')],{connect:()=>d.promise});
  const first=h.login.start('ynx');await Promise.resolve();await h.login.start('metamask');
  assert.equal(h.calls.length,1);h.login.cancel();d.resolve({});await first;
  await h.login.start('metamask');assert.equal(h.calls.length,3);assert.equal(h.accepted.length,1);
});
test('chain failure does not publish a connected result',async()=>{
  const h=harness([entry('ynx')],{chainError:{code:'WRONG_CHAIN'}});await h.login.start('ynx');
  assert.equal(h.accepted.length,0);assert.deepEqual(h.messages.at(-1),['failed',true]);
});
test('retry emits a fresh non-error message before successful completion',async()=>{
  const entries=[],h=harness(entries);await h.login.start('ynx');entries.push(entry('ynx'));await h.login.start('ynx');
  assert.deepEqual(h.messages.slice(-2),[['waiting'],['connected']]);
});
test('English and both Chinese variants have complete independent login messages',()=>{
  const keys=Object.keys(authMessages.en).sort();
  for(const locale of ['en','zh-CN','zh-TW']) {
    assert.deepEqual(Object.keys(authMessages[locale]).sort(),keys);
    for(const key of keys)assert.ok(authT(locale,key)?.trim());
  }
  assert.match(authT('zh-CN','rejected'),/拒绝/);assert.match(authT('zh-TW','cancelled'),/取消/);
  const node={dataset:{authCopy:'cancel'}};
  applyAuthLocale('zh-CN',{querySelectorAll:selector=>selector==='[data-auth-copy]'?[node]:[]});
  assert.equal(node.textContent,'取消并继续浏览');
});

const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
function appHarness() {
  const nodes=new Map();
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{dataset:{},classList:{toggle(){}},replaceChildren(){this.cleared=true},textContent:'private',hidden:false});return nodes.get(selector)};
  let requests=0;
  const context=vm.createContext({document:{documentElement:{lang:'zh-CN'},querySelector:get},
    YNX_CLOUD_RUNTIME:{apiBase:'/api/v1'},YNX_TESTNET:{},authT,applyLocale(){},createCloudLogin:()=>({}),
    fetch:async()=>{requests++;return {ok:false,status:401,headers:{get:()=> 'application/json'},json:async()=>({error:'revoked'})}}});
  vm.runInContext(source.replace(/^import[^\n]*\n/gm,'').split('changeLocale(selectedLocale());')[0],context);
  return {context,nodes,get,requests:()=>requests};
}
test('private 401 clears private contents but preserves the standard connection',async()=>{
  const h=appHarness();vm.runInContext("state.token='expired';state.erasureToken='old';state.standardWallet={account:'0x1111111111111111111111111111111111111111'};state.objects=[{id:'private'}]",h.context);
  await assert.rejects(vm.runInContext("api('/objects')",h.context),/revoked/);
  assert.equal(vm.runInContext('state.token',h.context),'');assert.equal(vm.runInContext('state.erasureToken',h.context),'');
  assert.equal(vm.runInContext('state.objects.length',h.context),0);
  assert.equal(vm.runInContext('state.standardWallet.account',h.context),'0x'+'1'.repeat(40));
  assert.equal(h.get('#files').cleared,true);assert.equal(h.get('#preview').textContent,'');
});
test('guest private operations fail locally without network requests',async()=>{
  const h=appHarness();await assert.rejects(vm.runInContext("api('/objects',{method:'POST'})",h.context),/私有云盘服务/);
  assert.equal(h.requests(),0);
});

test('late private response cannot revive old data or revoke a newer session',async()=>{
  const h=appHarness(),d=deferred();h.context.fetch=()=>d.promise;
  vm.runInContext("state.token='old'",h.context);
  const pending=vm.runInContext("api('/objects')",h.context);
  vm.runInContext("clearPrivateView();state.token='new'",h.context);
  d.resolve({ok:false,status:401,headers:{get:()=> 'application/json'},json:async()=>({error:'old session revoked'})});
  await assert.rejects(pending,error=>error.code==='PRIVATE_CONTEXT_CHANGED');
  assert.equal(vm.runInContext('state.token',h.context),'new');
});
test('provider events clear private context and labels retain selected wallet identity',()=>{
  const h=appHarness(),listeners=new Map();
  h.context.connection={account:'0x'+'1'.repeat(40),provider:{on(){},removeListener(){}},
    on(event,listener){listeners.set(event,listener);return ()=>listeners.delete(event)}};
  vm.runInContext("acceptConnection(connection,{},'metamask');state.token='private';state.objects=[{}]",h.context);
  assert.match(h.get('#wallet').textContent,/^MetaMask/);
  listeners.get('accountsChanged')(['0x'+'2'.repeat(40)]);
  assert.equal(vm.runInContext('state.token',h.context),'');assert.equal(vm.runInContext('state.objects.length',h.context),0);
  assert.match(h.get('#wallet').textContent,/0x222222/);
  listeners.get('chainChanged')('0x1');
  assert.equal(vm.runInContext('state.standardWallet',h.context),null);assert.equal(listeners.size,0);
});
