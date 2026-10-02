import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelRouter } from '../src/router.mjs';
import { streamText } from './stream-fixture.mjs';
const session = '3428bfc8-c20a-4b6c-b738-a606d0d68278';
test('server-owned conversation uses exact existing Gateway schema and binds response session', async () => {
  let sent;
  const router = createModelRouter({ fetchImpl: async (_, init) => {
    sent = JSON.parse(init.body);
    return new Response(streamText('complete answer').replace('qa-session', session), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await router.generate({ ownerId: 'actual-owner', hostedSession: session, system: 'Reviewed instruction.', prompt: 'selected text  \n' });
  assert.equal(result.text, 'complete answer');
  assert.deepEqual(sent, { session, prompt: 'Reviewed instruction.\n\nselected text  \n', outputLanguage: 'en', includedContext: [], excludedContext: ['conversation','selected_files','selected_chain_records','selected_trust_records','selected_product_context'], attachments: [], productContexts: [], continueFrom: '' });
  const mismatched = createModelRouter({ fetchImpl: async () => new Response(streamText('wrong conversation'), { headers: { 'content-type': 'text/event-stream' } }) });
  await assert.rejects(mismatched.generate({ hostedSession: session, prompt: 'review this text' }), error => error.code === 'model_stream_invalid');
});
test('oversized UTF-8 request is rejected before contacting the existing service', async () => {
  let calls = 0;
  const router = createModelRouter({ fetchImpl: async () => { calls++; throw Error('must not dispatch'); } });
  await assert.rejects(router.generate({ hostedSession: session, prompt: '界'.repeat(2700) }), error => error.code === 'model_prompt_limit');
  assert.equal(calls, 0);
});
