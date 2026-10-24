import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createWorkspaceStore } from '../../workspace-manager/src/store.mjs';
import { createNativeAIStore } from '../../codeoss-service/src/native-ai-store.mjs';
import { createAgentOrchestrator } from '../src/service.mjs';

test('actual agent persists an unselected model without inventing Qwen, then records the actual result', async t => {
  const root=await mkdtemp(join(tmpdir(),'ynx-own-model-'));
  const workspace=createWorkspaceStore({filename:join(root,'workspace.sqlite')});
  const ai=createNativeAIStore({filename:join(root,'ai.sqlite'),keyPath:join(root,'ai.key')});
  workspace.put('PUBLIC-owner','project',{expectedRevision:0,idempotencyKey:'PUBLIC-seed',payload:{name:'Project',files:{'main.ts':'export {};\n'},folders:[],open:['main.ts'],active:'main.ts'}});
  let calls=0;
  const agent=createAgentOrchestrator({filename:join(root,'agent.sqlite'),workspaceStore:workspace,aiStore:ai,ownerForRequest:()=> 'PUBLIC-owner',modelRouter:{async generate(input){
    calls++;
    const saved=ai.get('PUBLIC-owner','project',input.hostedSession);
    assert.equal(saved.model,null);
    assert.equal(saved.requestedModel,'');
    return {provider:'ynx-hosted',model:'PUBLIC-actual-model',text:JSON.stringify({summary:'Greeting',steps:[{title:'Edit',acceptance:'Greeting exists'}],contextPaths:['main.ts']})};
  }}});
  t.after(async()=>{await agent.close();ai.close();workspace.close();await rm(root,{recursive:true,force:true});});
  const request=Readable.from([Buffer.from(JSON.stringify({protocolVersion:'ynx-code-agent/v1',projectId:'project',intent:'Write a greeting',approval:'model-request-once',approvalId:randomUUID()}))]);
  Object.assign(request,{url:'/runtime/agent/runs',method:'POST',headers:{host:'localhost'}});
  const response=new EventEmitter();
  response.writeHead=status=>{response.status=status;return response;};
  response.end=body=>{response.body=JSON.parse(body);response.writableEnded=true;};
  assert.equal(await agent.handler(request,response),true);
  assert.equal(response.status,201,JSON.stringify(response.body));
  assert.equal(calls,1);
  const [record]=ai.list('PUBLIC-owner','project');
  assert.equal(record.model,'PUBLIC-actual-model');
  assert.equal(ai.get('PUBLIC-owner','project',record.id).requestedModel,'');
});
