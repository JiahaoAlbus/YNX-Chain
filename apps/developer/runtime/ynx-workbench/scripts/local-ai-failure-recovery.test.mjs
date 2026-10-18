import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createLocalAIToolsHost } from '../../../desktop/local-ai-tools-host.mjs';
const proposalBody = { csrf: 'PUBLIC_TEST_CONTEXT', prompt: 'change public text', context: 'public selected text' };
function fixture(reason) {
  const context = { id: randomUUID(), workspace: '/public/qa/project' }, sessionId = randomUUID(), expiresAt = Date.now() + 60000;
  let failed = false, calls = 0;
  const host = createLocalAIToolsHost(context, { client: {
    assertCurrent: () => ({ localProjectId: context.id, workspace: context.workspace, sessionId, expiresAt, generation: 'PUBLIC_TEST_ONLY' }),
    request(action, body) {
      calls++;
      if (failed) { failed = false; return Promise.reject(reason); }
      if (action === 'context') return { csrf: 'PUBLIC_TEST_CONTEXT', expiresAt, configuredModel: 'public-test-model' };
      return { ...body, proposalId: 'public-proposal', csrf: 'PUBLIC_TEST_APPROVE', model: 'public-test-model', wirePrompt: body.prompt,
        requestBytes: Buffer.byteLength(body.prompt), contextBytes: Buffer.byteLength(body.context), expiresAt };
    },
  } });
  return { host, fail: () => { failed = true; }, calls: () => calls };
}
// Public failure injection only: no production identity, provider, network or
// model response is supplied by these tests.
for (const reason of [null, undefined]) {
  test(`host context rejecting ${String(reason)} reports a safe error and allows an explicit new request`, async () => {
    const f = fixture(reason);
    try {
      f.fail(); await assert.rejects(f.host.call('context', {}), { code: 'AI_UNAVAILABLE' });
      assert.equal((await f.host.call('context', {})).available, true); assert.equal(f.calls(), 2);
    } finally { f.host.close(); }
  });
  test(`host approval rejecting ${String(reason)} remains UNKNOWN without replay`, async () => {
    const f = fixture(reason);
    try {
      const proposal = await f.host.call('proposals', proposalBody);
      const approval = { csrf: proposal.csrf, proposalId: proposal.proposalId, approval: 'send-reviewed-context-once' };
      f.fail(); await assert.rejects(f.host.call('approve', approval), { code: 'AI_UNKNOWN' });
      await assert.rejects(f.host.call('approve', approval), { code: 'AI_RETIRED' }); assert.equal(f.calls(), 2);
    } finally { f.host.close(); }
  });
  test(`actual duplex server returns a finite ${String(reason)} failure and preserves the next request`, () => {
    const moduleURL = new URL('../lib/local-ai-tools-channel.js', import.meta.url).href;
    const script = `import {Duplex} from 'node:stream'; import assert from 'node:assert/strict'; import channel from ${JSON.stringify(moduleURL)};
let a,b;a=new Duplex({read(){},write(data,_enc,done){b.push(Buffer.from(data));done();}});b=new Duplex({read(){},write(data,_enc,done){a.push(Buffer.from(data));done();}});
let calls=0;const server=channel.serve(a,{call(){if(++calls===1)return Promise.reject(${String(reason)});return {available:false,code:'AI_NOT_SUPPLIED'};},close(){}}),client=channel.client(b);
try{await assert.rejects(client.request('context'),{code:'AI_UNAVAILABLE'});assert.equal((await client.request('context')).code,'AI_NOT_SUPPLIED');assert.equal(calls,2);console.log('PUBLIC_FAILURE_RECOVERED');}finally{client.close();server.close();}`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 3000 });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /PUBLIC_FAILURE_RECOVERED/);
  });
}
test('unknown provider error does not expose supplier message or create a model response', async () => {
  const f = fixture({ code: 'PRIVATE_UNKNOWN', message: 'TEST_ONLY_SECRET' });
  try { f.fail(); await assert.rejects(f.host.call('context', {}), error => error.code === 'AI_UNAVAILABLE' && !error.message.includes('SECRET')); }
  finally { f.host.close(); }
});
