import test from 'node:test';
import assert from 'node:assert/strict';
import {readAccountResponse} from '../web/private-account-controller.js';

function fixture(chunks,headers={}){
  let reads=0,cancels=0;
  const response={headers:new Headers({'content-type':'application/json',...headers}),body:{getReader:()=>({read:async()=>{reads++;return chunks.length?{value:chunks.shift(),done:false}:{done:true}},cancel:()=>{cancels++;return Promise.resolve()},releaseLock(){}})},text(){throw Error('Unbounded text forbidden')}};
  return {response,inspect:()=>({reads,cancels})};
}
test('private response decodes split UTF-8 without unbounded text and enforces byte rather than character limit',async()=>{
  const encoded=new TextEncoder().encode('{"message":"中文"}');
  const f=fixture([encoded.slice(0,13),encoded.slice(13)]);
  assert.equal(await readAccountResponse(f.response,new AbortController().signal),'{"message":"中文"}');assert.equal(f.inspect().cancels,0);
  const tooLarge=fixture([new TextEncoder().encode('中'.repeat(350000)),new Uint8Array([1])]);
  await assert.rejects(readAccountResponse(tooLarge.response,new AbortController().signal),{code:'INVALID_ACCOUNT_RESPONSE'});assert.deepEqual(tooLarge.inspect(),{reads:1,cancels:1});
});
test('oversize first chunk cancels before any subsequent read even if cancellation never settles',async()=>{
  const f=fixture([new Uint8Array(1024*1024+1),new Uint8Array([1])]);
  f.response.body.getReader=()=>({read:async()=>{f.response.reads=(f.response.reads||0)+1;return {done:false,value:new Uint8Array(1024*1024+1)}},cancel:()=>new Promise(()=>{}),releaseLock(){}});
  await assert.rejects(readAccountResponse(f.response,new AbortController().signal),{code:'INVALID_ACCOUNT_RESPONSE'});assert.equal(f.response.reads,1);
});
test('malformed encoding, incomplete encoding and invalid length declarations fail closed',async()=>{
  for(const bytes of [[0xff],[0xe4,0xb8]]){
    const f=fixture([new Uint8Array(bytes)]);await assert.rejects(readAccountResponse(f.response,new AbortController().signal),{code:'INVALID_ACCOUNT_RESPONSE'});assert.equal(f.inspect().cancels,1);
  }
  for(const length of ['-1','1e3','1.5','1048577','9007199254740992']){
    const f=fixture([new Uint8Array([1])],{'content-length':length});await assert.rejects(readAccountResponse(f.response,new AbortController().signal),{code:'INVALID_ACCOUNT_RESPONSE'});assert.equal(f.inspect().reads,0);
  }
});
test('account retirement cancels a stalled body and never returns its old content',async()=>{
  const controller=new AbortController();let cancelled=0,resolve;
  const response={headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:()=>new Promise(done=>{resolve=done}),cancel:async()=>{cancelled++;resolve({done:true})},releaseLock(){}})}};
  const pending=readAccountResponse(response,controller.signal);controller.abort();await assert.rejects(pending,{code:'PRIVATE_CONTEXT_CHANGED'});assert.ok(cancelled>=1);
});
test('identity responses require exact byte length and excess cancels before another read',async()=>{
  const encoded=new TextEncoder().encode('{"message":"中文"}');
  const exact=fixture([encoded.slice(0,13),encoded.slice(13)],{'content-length':String(encoded.length)});
  assert.equal(await readAccountResponse(exact.response,new AbortController().signal),'{"message":"中文"}');
  for(const declared of [encoded.length-1,encoded.length+1,0]){
    const f=fixture([encoded,new Uint8Array()],{'content-length':String(declared)});
    await assert.rejects(readAccountResponse(f.response,new AbortController().signal),{code:'INVALID_ACCOUNT_RESPONSE'});
    assert.equal(f.inspect().cancels,1);
    if(declared<encoded.length)assert.equal(f.inspect().reads,1);
  }
});
test('compressed representation length is not confused with decoded body length',async()=>{
  for(const encoding of ['gzip','br']){
    const f=fixture([new TextEncoder().encode('{"message":"decoded"}')],{'content-length':'7','content-encoding':encoding});
    assert.equal(await readAccountResponse(f.response,new AbortController().signal),'{"message":"decoded"}');
    assert.equal(f.inspect().cancels,0);
  }
});
