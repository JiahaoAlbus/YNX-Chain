import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelRouter} from '../src/router.mjs';
import {streamText} from './stream-fixture.mjs';
import {createHostedGenerationTransport} from '../src/hosted-generation-transport.mjs';
const session='3428bfc8-c20a-4b6c-b738-a606d0d68278';
const input=()=>({ownerId:'PUBLIC-owner',provider:'ynx-hosted',hostedSession:session,model:'actual-provider:v7',prompt:'PUBLIC selected text',system:'PUBLIC instruction',
  projectBinding:{ownerId:'PUBLIC-owner',projectId:'PUBLIC-project',sessionId:'PUBLIC-core-session',generation:0,identityReference:'PUBLIC-reference'}});
test('independent generation authorization refuses before dispatch despite generic current assertion',async()=>{
  let sends=0;const r=createModelRouter({hostedGenerationSupply:()=>({openGeneration:async()=>({assertCurrent:async()=>({scope:'other'}),request:async()=>sends++})})});
  await assert.rejects(r.generate({...input(),assertCurrent:async()=>true}),e=>e.code==='model_supply_not_supplied');assert.equal(sends,0);
});
test('same normal router uses fixed service body and validated original receipt once',async()=>{
  let sends=0,dispatches=0;const r=createModelRouter({hostedGenerationSupply:()=>({openGeneration:async binding=>({
    assertCurrent:async()=>({...binding,expiresAt:Date.now()+60000}),request:async request=>{sends++;assert.equal(request.path,'/ai/stream');assert.equal(request.body.session,session);assert.equal(request.body.prompt,'PUBLIC instruction\n\nPUBLIC selected text');assert.equal(request.headers,undefined);
      return new Response(streamText('PUBLIC answer').replaceAll('qa-request','ai-0123456789abcdef01234567').replace('qa-session',session),{headers:{'content-type':'text/event-stream','x-ynx-ai-model':'actual-provider:v7','x-ynx-ai-model-confidence':'provider_reported'}});}
  })})});
  assert.equal(r.catalog().hosted.generationAvailable,null);
  const result=await r.generate({...input(),onDispatch:()=>dispatches++});assert.equal(result.text,'PUBLIC answer');assert.equal(result.model,'actual-provider:v7');assert.equal(sends,1);assert.equal(dispatches,1);
});
test('expired or cancelled generation lease never dispatches',async()=>{
  let sends=0;const r=createModelRouter({hostedGenerationSupply:()=>({openGeneration:async b=>({assertCurrent:async()=>({...b,expiresAt:0}),request:async()=>sends++})})});
  await assert.rejects(r.generate(input()),e=>e.code==='model_supply_not_supplied');const c=new AbortController();c.abort();await assert.rejects(r.generate({...input(),signal:c.signal}));assert.equal(sends,0);
});
test('grant expiry during an entered request rejects its late result without retry',async()=>{
  let sends=0,closed=0;const r=createModelRouter({hostedGenerationSupply:()=>({openGeneration:async b=>({
    assertCurrent:async()=>({...b,expiresAt:Date.now()+5}),close:()=>closed++,request:async()=>{sends++;await new Promise(resolve=>setTimeout(resolve,20));return new Response(streamText('PUBLIC late answer'),{headers:{'content-type':'text/event-stream'}});}
  })})});
  await assert.rejects(r.generate(input()));assert.equal(sends,1);assert.equal(closed,1);
});
test('private supplier errors are replaced by bounded public failures',async()=>{
  const r=createModelRouter({hostedGenerationSupply:()=>({openGeneration:async()=>{throw Object.assign(Error('PUBLIC fake internal credential=do-not-project'),{code:'private_supplier_stack'});}})});
  await assert.rejects(r.generate(input()),e=>e.code==='provider_unavailable'&&!e.message.includes('credential=')&&e.stack.includes('hosted-generation-transport'));
});
test('model different from the reviewed selection cannot be accepted',async()=>{
  const r=createModelRouter({hostedGenerationSupply:()=>({openGeneration:async b=>({assertCurrent:async()=>({...b,expiresAt:Date.now()+60000}),request:async()=>new Response(streamText('PUBLIC answer').replaceAll('qa-request','ai-0123456789abcdef01234567').replace('qa-session',session),{headers:{'content-type':'text/event-stream','x-ynx-ai-model':'other-model'}})})})});
  await assert.rejects(r.generate(input()),e=>e.code==='model_response_mismatch');
});
test('queued caller cannot replace its admitted project binding after submission',async()=>{
  let opened;const value=input();const r=createModelRouter({hostedGenerationSupply:()=>({openGeneration:async b=>{opened=b;throw Error('PUBLIC control stops before send');}})});
  const pending=r.generate(value);value.projectBinding.projectId='PUBLIC-mutated-project';await assert.rejects(pending);assert.equal(opened.projectId,'PUBLIC-project');
});
test('synchronous dispatch bookkeeping crossing the fixed deadline never sends',async()=>{
  const originalNow=Date.now;let now=originalNow(),sends=0,dispatches=0,closed=0;
  Date.now=()=>now;
  try {
    const expiresAt=now+1000;
    const transport=createHostedGenerationTransport({getSupply:()=>({openGeneration:async b=>({
      assertCurrent:async()=>({...b,expiresAt}),request:async()=>sends++,close:()=>closed++
    })})});
    await assert.rejects(transport.generate({...input(),onDispatch:()=>{dispatches++;now=expiresAt;}}),e=>e.code==='model_supply_not_supplied');
    assert.equal(dispatches,1);assert.equal(sends,0);assert.equal(closed,1);
  } finally {Date.now=originalNow;}
});
test('synchronous dispatch bookkeeping cancellation never sends',async()=>{
  const controller=new AbortController();let sends=0,closed=0;
  const transport=createHostedGenerationTransport({getSupply:()=>({openGeneration:async b=>({
    assertCurrent:async()=>({...b,expiresAt:Date.now()+60000}),request:async()=>sends++,close:()=>closed++
  })})});
  await assert.rejects(transport.generate({...input(),signal:controller.signal,onDispatch:()=>controller.abort()}),e=>e.code==='model_request_cancelled');
  assert.equal(sends,0);assert.equal(closed,1);
});
test('dispatch bookkeeping failure retains its first cause without exposing it or sending',async()=>{
  const original=Error('PUBLIC private bookkeeping control');let sends=0,closed=0;
  const transport=createHostedGenerationTransport({getSupply:()=>({openGeneration:async b=>({
    assertCurrent:async()=>({...b,expiresAt:Date.now()+60000}),request:async()=>sends++,close:()=>closed++
  })})});
  await assert.rejects(transport.generate({...input(),onDispatch:()=>{throw original;}}),e=>e.code==='provider_unavailable'&&e.cause===original&&!e.message.includes(original.message));
  assert.equal(sends,0);assert.equal(closed,1);
});
