import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkspaceResponse } from '../frontend/src/codeoss/workspaceResponse.ts';
test('empty unavailable and successful HTML responses fail closed with readable connection errors', async () => {
  for (const response of [new Response('', {status:503}), new Response('<html>proxy page</html>', {status:200}), new Response('null',{status:200}),new Response('[]',{status:200})]) {
    await assert.rejects(readWorkspaceResponse(response), error => error.code === 'WORKSPACE_RESPONSE_UNREADABLE' && error.status === response.status && /workspace connection is unavailable/.test(error.message));
  }
});
test('an unreadable 401 retains its status for the existing identity retirement path', async () => {
  await assert.rejects(readWorkspaceResponse(new Response('',{status:401})),error=>error.status===401);
});
test('existing successful catalogs and typed backend refusal bodies remain unchanged', async () => {
  for (const body of [{account:'fixture',walletProjects:[],configured:false},{error:'Session expired',code:'SESSION_EXPIRED'}]) assert.deepEqual(await readWorkspaceResponse(new Response(JSON.stringify(body))),body);
});
