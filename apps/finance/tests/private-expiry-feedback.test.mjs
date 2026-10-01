import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const entry=fs.readFileSync(new URL('../web/private-wallet-entry.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
function extract(source,name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);let end=source.indexOf('{',start),depth=1;for(end++;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
test('typed private expiry clears usable authority and presents reauthorization, preserving other failure codes',()=>{
  const rows=[];const context=vm.createContext({publish:(state,code)=>rows.push({state,code})});
  vm.runInContext(extract(entry,'code')+'\n'+extract(entry,'reportFailure'),context);
  for(const code of ['SESSION_EXPIRED','SESSION_REVOKED','FINANCE_ACCOUNT_MISMATCH','NETWORK_UNAVAILABLE']){
    context.error={code};vm.runInContext('reportFailure(error)',context);
    assert.equal(rows.at(-1).code,code);assert.equal(rows.at(-1).state.session,null);
    assert.equal(rows.at(-1).state.status,code==='SESSION_EXPIRED'?'expired':'degraded');
  }
});
test('actual owned workspace 401 preserves expiry enum rather than replacing it with service failure',async()=>{
  const calls=[];const error=Object.assign(new Error('expired'),{status:401,code:'SESSION_EXPIRED'});
  const context=vm.createContext({state:{context:7},window:{YNXFinanceWallet:{ready:Promise.resolve(),connected:()=>true,reportPrivateFailure:value=>calls.push(value)}},renderBrowserWalletIdentity:()=>true,sourceStatus:()=>{},api:async()=>{throw error;},clearPrivateView:()=>{},notify:()=>{},financeText:x=>x});
  vm.runInContext('async '+extract(app,'loadOwnedWorkspace'),context);
  await vm.runInContext('loadOwnedWorkspace(7)',context);
  assert.equal(calls.length,1);assert.equal(calls[0],error);
});
test('expired presentation uses existing localized reauthorization text and explicit controls',()=>{
  assert.ok(extract(entry,'render').includes("current.status==='expired'?'privateReauthorize'"));
  assert.ok(entry.includes("document.querySelector('#private-retry')?.addEventListener('click',retry)"));
});
