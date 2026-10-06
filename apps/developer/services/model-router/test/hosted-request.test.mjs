import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockHostedRouter as createModelRouter } from './stream-fixture.mjs';
import { streamText } from './stream-fixture.mjs';
import { existingHostedRequest, validatedModelAttachments } from '../src/hosted-request.mjs';
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

test('selected files are explicit Gateway attachments and preserve exact UTF-8 bytes', async () => {
  const files = [{ id: 'owned-revision-digest', name: 'src/main.ts', mimeType: 'text/plain', text: 'const 汉字 = 1;  \n' }];
  let sent;
  const router = createModelRouter({ fetchImpl: async (_, init) => { sent = JSON.parse(init.body); return new Response(streamText('reviewed').replace('qa-session', session), { headers: { 'content-type': 'text/event-stream' } }); } });
  await router.generate({ hostedSession: session, prompt: 'Review the selected file.', attachments: files });
  assert.deepEqual(sent.attachments, files); assert.deepEqual(sent.includedContext, ['selected_files']);
  assert.equal(sent.excludedContext.includes('selected_files'), false);
  assert.equal(sent.prompt.includes(files[0].text), false);
  assert.throws(() => router.generate({ prompt: 'Review the selected file.', attachments: files }), error => error.code === 'model_session_invalid');
});

test('attachment limits use UTF-8 bytes, reject malformed/duplicate files and bound the encoded body', () => {
  const file = { id: 'owned', name: 'main.ts', mimeType: 'text/plain', text: 'x' };
  assert.equal(validatedModelAttachments([{ ...file, name: '汉'.repeat(53), text: 'x'.repeat(262144) }]).length, 1);
  for (const value of [[...Array(9)].map((_, i) => ({ ...file, name: `file-${i}` })), [file, file], [{ ...file, name: '汉'.repeat(54) }], [{ ...file, text: '汉'.repeat(87382) }], [{ ...file, mimeType: 'image/png' }], [{ ...file, text: '' }]])
    assert.throws(() => validatedModelAttachments(value), error => error.code === 'model_attachments_invalid');
  assert.throws(() => existingHostedRequest({ hostedSession: session, system: '', prompt: 'Explicit context review', attachments: Array.from({ length: 8 }, (_, i) => ({ ...file, name: `${i}.ts`, text: '\\'.repeat(262144) })) }), error => error.code === 'model_context_limit');
});

test('queued generation rechecks its trusted context before any upstream dispatch', async () => {
  let release, seen; const started = new Promise(resolve => { seen = resolve; }), held = new Promise(resolve => { release = resolve; });
  let calls = 0, current = true;
  const router = createModelRouter({ maxConcurrent: 1, maxHostedConcurrent: 1, fetchImpl: async () => {
    calls++; seen(); await held; return new Response(streamText('complete').replace('qa-session', session), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const first = router.generate({ ownerId: 'first', hostedSession: session, prompt: 'First valid reviewed request' }); await started;
  const queued = router.generate({ ownerId: 'second', hostedSession: session, prompt: 'Second valid reviewed request', assertCurrent: async () => {
    if (!current) throw Object.assign(new Error('Context changed'), { code: 'agent_context_changed', status: 409 });
  } });
  const rejected = assert.rejects(queued, error => error.code === 'agent_context_changed');
  current = false; release(); await first; await rejected; assert.equal(calls, 1);
});

test('existing BYOK provider receives the same approved file bytes without losing its request-only key boundary', async () => {
  let sent;
  const file = { id: 'owned', name: 'main.ts', mimeType: 'text/plain', text: 'const selected = 1;\n' };
  const router = createModelRouter({ fetchImpl: async (_, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ output_text: 'done' }), { headers: { 'content-type': 'application/json' } }); } });
  const result = await router.generate({ provider: 'openai', apiKey: 'request-only-fixture-key', prompt: 'Review selected source.', attachments: [file] });
  assert.ok(sent.input.includes(JSON.stringify([file]))); assert.equal(JSON.stringify(sent).includes('request-only-fixture-key'), false);
  assert.equal(result.credentialPersisted, false);
});
test('oversized UTF-8 request is rejected before contacting the existing service', async () => {
  let calls = 0;
  const router = createModelRouter({ fetchImpl: async () => { calls++; throw Error('must not dispatch'); } });
  await assert.rejects(router.generate({ hostedSession: session, prompt: '界'.repeat(2700) }), error => error.code === 'model_prompt_limit');
  assert.equal(calls, 0);
});
