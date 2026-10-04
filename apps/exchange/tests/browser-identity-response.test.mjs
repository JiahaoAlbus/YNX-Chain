import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {parseMarketDocument} from '../web/market-data.js';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function browserIdentityRequest('),app.indexOf('\nasync function restoreBrowserIdentity('));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const response=(text,mime='application/json',status=200,extra={})=>new Response(text,{status,headers:{'content-type':mime,...extra}});
function fixture(){
  const calls=[],timers=new Map();let next=0;
  const scope={AbortController,TextDecoder,Uint8Array,parseMarketDocument,fetch:(path,options)=>{const p=deferred();calls.push({path,options,...p});return p.promise},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next},clearTimeout:id=>timers.delete(id)};
  runInNewContext(source+';this.invoke=browserIdentityRequest',scope);return {scope,calls,timers};
}
test('exact identity-only routes settle through stalled fetch/body and never replay a logout',async()=>{
  for(const phase of ['fetch','body'])for(const path of ['config','account','logout']){
    const f=fixture(),body=deferred(),p=f.scope.invoke(path,path==='logout'?{method:'POST',body:'{}',headers:{'X-YNX-SSO-CSRF':'fixture-only'}}:{});
    if(phase==='body'){const value=response('{}');f.calls[0].resolve({ok:true,status:200,headers:value.headers,body:{getReader:()=>({read:()=>body.promise,cancel:()=>new Promise(()=>{}),releaseLock(){}})}});await new Promise(setImmediate)}
    const timer=[...f.timers.values()][0];assert.equal(timer.ms,5000);timer.fn();await assert.rejects(p,{code:'IDENTITY_REQUEST_TIMEOUT'});
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.timers.size,0);
    if(phase==='fetch')f.calls[0].resolve(response('{"revoked":true}'));else body.resolve({done:true});await new Promise(setImmediate);assert.equal(f.calls.length,1);
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

test('identity content-length binds decoded bytes only for identity encoding',async()=>{
  const text=JSON.stringify({note:'é'}),bytes=Buffer.byteLength(text);
  for(const length of [0,bytes-1,bytes+1]){
    const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(response(text,'application/json',200,{'content-length':String(length)}));
    await assert.rejects(p,{code:'IDENTITY_RESPONSE_INVALID'});assert.equal(f.calls.length,1);
  }
  for(const encoding of ['', 'identity', 'gzip']){
    const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(response(text,'application/json',200,{'content-length':String(encoding==='gzip'?bytes+10:bytes),'content-encoding':encoding}));
    assert.equal((await p).data.note,'é');
  }
});

test('identity declared-length excess cancels before another stream read',async()=>{
  const f=fixture();let reads=0,cancels=0,releases=0;
  const p=f.scope.invoke('account');f.calls[0].resolve({headers:new Headers({'content-type':'application/json','content-length':'1'}),body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array([123,125])}},cancel(){cancels++},releaseLock(){releases++}})}});
  await assert.rejects(p,{code:'IDENTITY_RESPONSE_INVALID'});assert.equal(reads,1);assert.equal(cancels,1);assert.equal(releases,1);
});

test('duplicate identity fields, escaped aliases and excessive nesting cannot hide an unverified identity',async()=>{
  for(const text of ['{"account":"A","account":"B"}','{"enabled":false,"enabl\\u0065d":true}','{"nested":{"csrfToken":"A","csrfToken":"B"}}','{"value":'+'['.repeat(65)+'0'+']'.repeat(65)+'}']){
    const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(response(text));await assert.rejects(p,{code:'IDENTITY_RESPONSE_INVALID'});assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  }
  const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(response('{"left":{"code":"A"},"right":{"code":"B"},"note":"é"}'));assert.equal((await p).data.note,'é');
});

test('unbounded undeclared stream stops at the first over-limit chunk without text() or retry',async()=>{
  const f=fixture();let reads=0,cancels=0,releases=0;
  const value={ok:true,status:200,headers:new Headers({'content-type':'application/json'}),text(){throw Error('Unbounded text() forbidden')},body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(65536)}},cancel(){cancels++;return new Promise(()=>{})},releaseLock(){releases++}})}};
  const p=f.scope.invoke('account');f.calls[0].resolve(value);await assert.rejects(p,{code:'IDENTITY_RESPONSE_INVALID'});
  assert.equal(reads,5);assert.equal(cancels,1);assert.equal(releases,1);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
});

test('exact byte limit and split multibyte UTF-8 are accepted; malformed UTF-8 fails closed',async()=>{
  const exact=JSON.stringify({value:'x'.repeat(262132)});assert.equal(Buffer.byteLength(exact),262144);
  const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(response(exact));assert.equal((await p).data.value.length,262132);
  const encoded=new TextEncoder().encode('{"value":"é"}'),cut=encoded.indexOf(195)+1;
  const stream=new ReadableStream({start(controller){controller.enqueue(encoded.slice(0,cut));controller.enqueue(encoded.slice(cut));controller.close()}});
  const g=fixture(),q=g.scope.invoke('account');g.calls[0].resolve(new Response(stream,{headers:{'content-type':'application/json'}}));assert.equal((await q).data.value,'é');
  for(const bytes of [new Uint8Array([123,34,120,34,58,34,255,34,125]),new Uint8Array([123,34,120,34,58,34,195])]){
    const h=fixture(),r=h.scope.invoke('account');h.calls[0].resolve(new Response(bytes,{headers:{'content-type':'application/json'}}));await assert.rejects(r,{code:'IDENTITY_RESPONSE_INVALID'});
  }
});

test('body-less responses fail closed and a late fetch cannot begin reading after deadline',async()=>{
  const f=fixture(),p=f.scope.invoke('account');f.calls[0].resolve(new Response(null,{headers:{'content-type':'application/json'}}));await assert.rejects(p,{code:'IDENTITY_RESPONSE_INVALID'});
  const g=fixture(),q=g.scope.invoke('account');[...g.timers.values()][0].fn();await assert.rejects(q,{code:'IDENTITY_REQUEST_TIMEOUT'});let opened=0;
  g.calls[0].resolve({headers:new Headers({'content-type':'application/json'}),body:{getReader(){opened++;throw Error('Late body')}}});await new Promise(setImmediate);assert.equal(opened,0);assert.equal(g.calls.length,1);
});

test('installed Chrome native response streams enforce the product bound without navigating or requesting accounts',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[];let network=0;
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{network++;return route.abort()});
    await page.setContent('<main>Exchange identity stream controlled verification</main>');
    await page.addScriptTag({content:'const MAX_MARKET_DOCUMENT_BYTES=8*1024*1024;const invalid=()=>new Error("controlled-parser-invalid");'+parseMarketDocument.toString()+';'+source+';window.checkIdentityStream=browserIdentityRequest'});
    const result=await page.evaluate(async()=>{
      let calls=0,pulls=0,cancels=0;
      window.fetch=async()=>{calls++;return new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(65536))},cancel(){cancels++}},{highWaterMark:0}),{headers:{'content-type':'application/json'}})};
      let code;try{await window.checkIdentityStream('account')}catch(e){code=e.code}
      window.fetch=async()=>{calls++;const bytes=new TextEncoder().encode('{"code":"SSO_LOGIN_REQUIRED","note":"é"}');return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close()}}),{status:401,headers:{'content-type':'application/json'}})};
      const refusal=await window.checkIdentityStream('account');
      const duplicateCodes=[];
      for(const text of ['{"account":"A","account":"B"}','{"enabled":false,"enabl\\u0065d":true}','{"nested":{"csrfToken":"A","csrfToken":"B"}}','{"value":'+'['.repeat(65)+'0'+']'.repeat(65)+'}']){
        window.fetch=async()=>{calls++;return new Response(text,{headers:{'content-type':'application/json'}})};
        try{await window.checkIdentityStream('account');duplicateCodes.push('ACCEPTED')}catch(error){duplicateCodes.push(error.code)}
      }
      return {code,pulls,cancels,calls,duplicateCodes,status:refusal.response.status,note:refusal.data.note,url:location.href};
    });
    assert.deepEqual(result,{code:'IDENTITY_RESPONSE_INVALID',pulls:5,cancels:1,calls:6,duplicateCodes:Array(4).fill('IDENTITY_RESPONSE_INVALID'),status:401,note:'é',url:'about:blank'});
    assert.equal(network,0);assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});
