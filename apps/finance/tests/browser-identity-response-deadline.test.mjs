import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {chromium} from '../../quant-lab/node_modules/playwright/index.mjs';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function browserSSOFetch('),app.indexOf('function browserWalletMismatch('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(){
  const calls=[],timers=new Map();let next=0;
  const scope={AbortController,TextEncoder,fetch:(path,options)=>{const pending=deferred();calls.push({path,options,...pending});return pending.promise},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next},clearTimeout:id=>timers.delete(id)};
  runInNewContext(source+';this.invoke=browserSSOFetch',scope);
  return {scope,calls,timers};
}
const reply=(body,mime='application/json',status=200,extra={})=>({status,ok:status>=200&&status<300,headers:new Headers({'content-type':mime,...extra}),text:async()=>body});
test('identity fetch and body deadline settle once even if abort is ignored; no logout/config replay',async()=>{
  for(const phase of ['fetch','body'])for(const path of ['/api/sso/config','/api/sso/account','/api/sso/logout']){
    const f=fixture(),body=deferred(),pending=f.scope.invoke(path,path.endsWith('logout')?{method:'POST',body:'{}'}:{});
    if(phase==='body'){f.calls[0].resolve({...reply('{}'),text:()=>body.promise});await new Promise(setImmediate)}
    const timer=[...f.timers.values()][0];assert.equal(timer.ms,5000);timer.fn();
    await assert.rejects(pending,{code:'BROWSER_SSO_REQUEST_TIMEOUT'});
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);assert.equal(f.calls[0].options.signal.aborted,true);
    if(phase==='fetch')f.calls[0].resolve(reply('{"revoked":true}'));else body.resolve('{"revoked":true}');
    await new Promise(setImmediate);assert.equal(f.calls.length,1);
  }
});
test('SSO response remains same-origin/no-store/no-redirect and preserves explicit logout body without expanding permission',async()=>{
  const f=fixture(),pending=f.scope.invoke('/api/sso/logout',{method:'POST',headers:{'X-YNX-SSO-CSRF':'controlled-fixture-only'},body:'{}'});
  f.calls[0].resolve(reply('{"revoked":true}'));const result=await pending;
  assert.equal(result.data.revoked,true);assert.equal(result.response.status,200);
  assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(f.calls[0].options.redirect,'error');assert.equal(f.calls[0].options.cache,'no-store');
  assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[0].options.body,'{}');assert.equal(f.timers.size,0);
});
for(const [name,response] of [
  ['HTML fallback',reply('<html>Not identity</html>','text/html')],
  ['malformed JSON',reply('{')],['null',reply('null')],['array',reply('[]')],
  ['declared oversize',reply('{}','application/json',200,{'content-length':'262145'})],
  ['invalid length',reply('{}','application/json',200,{'content-length':'bad'})],
  ['actual oversize',reply(JSON.stringify({value:'é'.repeat(131072)}))],
])test('identity response fails closed on '+name,async()=>{
  const f=fixture(),pending=f.scope.invoke('/api/sso/account');f.calls[0].resolve(response);
  await assert.rejects(pending,{code:'BROWSER_SSO_RESPONSE_INVALID'});assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
});
test('typed JSON HTTP rejection is returned for the existing caller authorization state machine, never converted to login success',async()=>{
  const f=fixture(),pending=f.scope.invoke('/api/sso/account');f.calls[0].resolve(reply('{"error":"unauthorized","silentRestoreAllowed":false}','application/problem+json',401));
  const result=await pending;assert.equal(result.response.ok,false);assert.equal(result.response.status,401);assert.equal(result.data.silentRestoreAllowed,false);assert.equal(f.calls.length,1);
});
test('actual Chrome logout deadline unlocks an explicit same-session retry without false revoke or standard disconnect',async()=>{
  const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  const logout=app.slice(app.indexOf('async function logoutBrowserIdentity('),app.indexOf("document.addEventListener('click',event=>",app.indexOf('async function logoutBrowserIdentity(')));
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);let browserIdentity={csrfToken:'controlled-local-only'},browserIdentityLogoutPending=null,browserSSOIntentGeneration=0,browserIdentityExplicitIntent=false,browserIdentityRestoreDeferred=false,browserSSORevision=0;window.calls=[];window.deadlines=[];window.notices=[];window.disconnects=0;window.clears=0;const clearLoginIntent=()=>{},clearPrivateView=()=>{clears++},renderBrowserWalletIdentity=()=>{},financeText=k=>k,notify=k=>notices.push(k),browserSSOChannel={postMessage:()=>{}};window.YNXFinanceWallet={disconnect:async()=>{disconnects++}};const setTimeout=(fn,ms)=>{deadlines.push({fn,ms});return deadlines.length},clearTimeout=()=>{};window.fetch=(path,options)=>new Promise(resolve=>calls.push({path,options,resolve}));${source}${logout}$('#browser-signin-logout').hidden=false;$('#browser-signin-logout').onclick=logoutBrowserIdentity;window.expire=()=>deadlines.at(-1).fn();window.reply=i=>calls[i].resolve({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),text:async()=>'{"revoked":true}'});window.logoutPending=()=>!!browserIdentityLogoutPending;`});
    // Normal boot reveals this parent only when browser SSO is enabled.
    await page.locator('#browser-signin').evaluate(element=>element.hidden=false);
    const button=page.locator('#browser-signin-logout');await button.click();assert.equal(await button.isDisabled(),true);
    await page.evaluate(()=>expire());await page.waitForFunction(()=>!document.querySelector('#browser-signin-logout').disabled);
    assert.equal(await page.evaluate(()=>logoutPending()),true);assert.equal(await page.evaluate(()=>disconnects),0);assert.deepEqual(await page.evaluate(()=>notices),['privateLogoutUnconfirmed']);
    await page.evaluate(()=>reply(0));assert.equal(await page.evaluate(()=>logoutPending()),true);assert.equal(await page.evaluate(()=>disconnects),0);
    await button.click();assert.equal(await page.evaluate(()=>calls.length),2);
    assert.deepEqual(await page.evaluate(()=>calls.map(c=>({path:c.path,method:c.options.method,body:c.options.body,csrf:c.options.headers['X-YNX-SSO-CSRF']}))),Array(2).fill({path:'/api/sso/logout',method:'POST',body:'{}',csrf:'controlled-local-only'}));
    await page.evaluate(()=>reply(1));await page.waitForFunction(()=>!logoutPending());assert.equal(await page.evaluate(()=>disconnects),1);assert.equal(await button.isHidden(),true);assert.equal(page.context().pages().length,1);
  }finally{await browser.close()}
});
