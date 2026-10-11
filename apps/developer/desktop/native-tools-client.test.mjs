import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeToolsClient } from './native-tools-client.mjs';
const binding = { projectId: 'PUBLIC-project', workspace: '/PUBLIC/project', launch: '12345678-1234-1234-1234-123456789abc' };
const state = () => ({ localProjectId: binding.projectId, workspace: binding.workspace, launch: binding.launch,
  sessionId: '22222222-1234-1234-1234-123456789abc', generation: 'PUBLIC-generation', expiresAt: Date.now()+60000 });
test('absent supply and four-op Wallet assertion cannot grant native tools', () => {
  assert.equal(createNativeToolsClient(), null);
  assert.throws(() => createNativeToolsClient({ supply: { assertCurrent() {} } }), e => e.code === 'AI_NOT_SUPPLIED');
});
test('normal client binds one project and forwards only fixed authenticated service request', async () => {
  const sent=[]; let opened=0; const lease=state();
  const client=createNativeToolsClient({supply:{async openProject(){opened++;return {assertCurrent:async()=>lease,request:async r=>{sent.push(r);return {csrf:'PUBLIC-ticket'};}};}}});
  await client.assertCurrent(binding);await client.request('context',{});
  assert.equal(opened,1);assert.deepEqual(sent[0],{method:'GET',path:'/runtime/native-tools/context?sessionId='+lease.sessionId});
  await assert.rejects(client.assertCurrent({...binding,workspace:'/PUBLIC/other'}),e=>e.code==='AI_RETIRED');
  await assert.rejects(client.request('https://other.invalid',{}));assert.equal(sent.length,1);
});
test('cancel or changed admission after approved send cannot return success',async()=>{
  let calls=0;let lease=state();const controller=new AbortController();
  const client=createNativeToolsClient({supply:{openProject:async()=>({assertCurrent:async()=>lease,request:async()=>{calls++;controller.abort();return {text:'PUBLIC'};}})}});
  await client.assertCurrent(binding);await assert.rejects(client.request('approve',{csrf:'PUBLIC',proposalId:'PUBLIC'},{signal:controller.signal}));assert.equal(calls,1);
  client.close();await assert.rejects(client.assertCurrent(binding),e=>e.code==='AI_RETIRED');
});
test('supplier mutation of a previously returned binding cannot hide account generation change',async()=>{
  const lease=state();let calls=0;const client=createNativeToolsClient({supply:{openProject:async()=>({assertCurrent:async()=>lease,request:async()=>{calls++;lease.generation='changed';return {};}})}});
  await client.assertCurrent(binding);await assert.rejects(client.request('approve',{csrf:'PUBLIC',proposalId:'PUBLIC'}),e=>e.code==='AI_UNKNOWN');assert.equal(calls,1);
});
test('closing during project admission closes late owner handle and cannot revive client',async()=>{
  let finish,closed=0;const client=createNativeToolsClient({supply:{openProject:()=>new Promise(resolve=>{finish=resolve;})}});
  const pending=client.assertCurrent(binding);await Promise.resolve();client.close();finish({close:()=>closed++,assertCurrent:async()=>state(),request:async()=>({})});await assert.rejects(pending,e=>e.code==='AI_RETIRED');assert.equal(closed,1);
});
