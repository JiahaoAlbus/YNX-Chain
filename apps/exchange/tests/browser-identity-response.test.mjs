import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function browserIdentityRequest('),app.indexOf('\nasync function restoreBrowserIdentity('));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const response=(text,mime='application/json',status=200,extra={})=>({ok:status>=200&&status<300,status,headers:new Headers({'content-type':mime,...extra}),text:async()=>text});
function fixture(){
  const calls=[],timers=new Map();let next=0;
  const scope={AbortController,TextEncoder,fetch:(path,options)=>{const p=deferred();calls.push({path,options,...p});return p.promise},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next},clearTimeout:id=>timers.delete(id)};
  runInNewContext(source+';this.invoke=browserIdentityRequest',scope);return {scope,calls,timers};
}
test('exact identity-only routes settle through stalled fetch/body and never replay a logout',async()=>{
  for(const phase of ['fetch','body'])for(const path of ['config','account','logout']){
    const f=fixture(),body=deferred(),p=f.scope.invoke(path,path==='logout'?{method:'POST',body:'{}',headers:{'X-YNX-SSO-CSRF':'fixture-only'}}:{});
    if(phase==='body'){f.calls[0].resolve({...response('{}'),text:()=>body.promise});await new Promise(setImmediate)}
    const timer=[...f.timers.values()][0];assert.equal(timer.ms,5000);timer.fn();await assert.rejects(p,{code:'IDENTITY_REQUEST_TIMEOUT'});
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.timers.size,0);
    if(phase==='fetch')f.calls[0].resolve(response('{"revoked":true}'));else body.resolve('{"revoked":true}');await new Promise(setImmediate);assert.equal(f.calls.length,1);
  }
});
test('same-origin response policy cannot be overridden and original CSRF/body stay intact',async()=>{
  const f=fixture(),p=f.scope.invoke('logout',{credentials:'omit',cache:'force-cache',redirect:'follow',method:'POST',headers:{'X-YNX-SSO-CSRF':'fixture-only'},body:'{}'});
  f.calls[0].resolve(response('{"revoked":true}'));assert.equal((await p).data.revoked,true);
  assert.equal(f.calls[0].path,'/api/v1/sso/logout');assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(f.calls[0].options.cache,'no-store');assert.equal(f.calls[0].options.redirect,'error');assert.equal(f.calls[0].options.body,'{}');assert.equal(f.calls[0].options.headers['X-YNX-SSO-CSRF'],'fixture-only');
});
test('route traversal/business names are rejected before fetch',async()=>{
  for(const path of ['orders','../account','account?scope=exchange:trade','https://attacker.invalid/']){const f=fixture();await assert.rejects(f.scope.invoke(path),/IDENTITY_ROUTE_INVALID/);assert.equal(f.calls.length,0);assert.equal(f.timers.size,0)}
});
for(const [name,value] of [['HTML',response('<html>','text/html')],['corrupt',response('{')],['null',response('null')],['array',response('[]')],['large-declared',response('{}','application/json',200,{'content-length':'262145'})],['invalid-length',response('{}','application/json',200,{'content-length':'x'})],['large-body',response(JSON.stringify({value:'é'.repeat(131072)}))]])test('reject unverified identity '+name,async()=>{
  const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(value);await assert.rejects(p,{code:'IDENTITY_RESPONSE_INVALID'});assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
});
test('JSON HTTP refusal stays a refusal for the existing state machine',async()=>{
  const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(response('{"code":"SSO_LOGIN_REQUIRED"}','application/problem+json',401));const result=await p;assert.equal(result.response.ok,false);assert.equal(result.response.status,401);assert.equal(result.data.code,'SSO_LOGIN_REQUIRED');
});
