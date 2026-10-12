import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRouter } from '../src/router.mjs';
import { readHostedCompletion } from '../src/hosted-completion.mjs';
import { assertNoSelectedSecrets } from '../src/context-secrets.mjs';
import { streamText } from './stream-fixture.mjs';

const requestId = 'ai-0123456789abcdef01234567', sessionId = '3428bfc8-c20a-4b6c-b738-a606d0d68278';
const raw = text => streamText(text).replaceAll('qa-request', requestId).replace('qa-session', sessionId);
const headers = { 'content-type': 'text/event-stream', 'x-request-id': requestId, 'x-ynx-ai-model': 'actual-provider:v7',
  'x-ynx-ai-model-confidence': 'provider_reported', 'x-ynx-ai-usage-confidence': 'provider_reported', 'x-ynx-ai-cost-confidence': 'unknown' };

test('normal hosted callers cannot send context using an owner or generic current assertion', async () => {
  let fetches = 0, callbacks = 0;
  const router = createModelRouter({ fetchImpl: async () => { fetches++; throw Error('must not fetch'); }, ownerForRequest: () => 'owner' });
  for (const extra of [{}, { assertCurrent: async () => true }, { authorization: 'forged', generationAuthority: { available: true } }])
    await assert.rejects(router.generate({ ownerId: 'owner', hostedSession: sessionId, prompt: 'Selected context for review', onDispatch: () => callbacks++, ...extra }), e => e.code === 'model_supply_not_supplied');
  assert.equal(fetches, 0); assert.equal(callbacks, 0);
  assert.equal(router.catalog().hosted.model, null); assert.equal(router.catalog().hosted.generationAvailable, false);
});

test('Go health reports reachable configuration without claiming generation or actual model', async () => {
  const router = createModelRouter({ fetchImpl: async () => Response.json({ ok: true, service: 'ynx-ai-gatewayd', upstreamOk: true, providerConfigured: true, model: 'configured-model', active: 0 }) });
  const health = await router.hostedHealth();
  assert.equal(health.serviceReachable, true); assert.equal(health.providerConfigured, true); assert.equal(health.configuredModel, 'configured-model');
  assert.equal(health.available, false); assert.equal(health.model, null); assert.equal(health.actualModel, null); assert.equal(health.queued, null);
  for (const response of [new Response('invalid json'), Response.json({}), Response.json([]), Response.json({ available: true })]) {
    const value = await createModelRouter({ fetchImpl: async () => response }).hostedHealth();
    assert.equal(value.available, false); assert.equal(value.model, null);
  }
});

test('strict supplied response preserves request/model/confidence but never fabricates counts or finality', async () => {
  const seen = [], result = await readHostedCompletion(new Response(raw('exact answer'), { headers }), { sessionId, onOperation: value => seen.push(value) });
  assert.equal(result.requestId, requestId); assert.equal(result.model, 'actual-provider:v7'); assert.equal(result.modelConfidence, 'provider_reported');
  assert.equal(result.usageConfidence, 'provider_reported'); assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, totalTokens: null });
  assert.equal(seen[0].delivery, 'UNKNOWN'); assert.equal(result.operation.delivery, 'completed');
  for (const field of ['state', 'remoteOutcome', 'nodeFinality']) assert.equal(result.operation[field], 'UNKNOWN');
  assert.equal(result.operation.cancellation, 'unsupported');
  const absent = await readHostedCompletion(new Response(raw('answer'), { headers: { 'content-type': 'text/event-stream' } }), { sessionId });
  assert.equal(absent.model, null); assert.equal(absent.modelConfidence, 'unknown');
});

test('request header conflicts and usage SSE are rejected before accepting a completed answer', async () => {
  let callbacks = 0;
  await assert.rejects(readHostedCompletion(new Response(raw('answer'), { headers: { ...headers, 'x-request-id': 'ai-ffffffffffffffffffffffff' } }), { sessionId, onOperation: () => callbacks++ }), e => e.code === 'model_receipt_invalid');
  assert.equal(callbacks, 0);
  await assert.rejects(readHostedCompletion(new Response(raw('answer').replace('event: done', 'event: usage\ndata: {"prompt_tokens":0}\n\nevent: done'), { headers }), { sessionId }), e => e.code === 'model_stream_invalid');
});

test('partial stream cancellation retains only validated same-session metadata', async () => {
  const caller = new AbortController(), seen = [];
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(raw('partial').split('event: done')[0])); } }), { headers });
  const pending = readHostedCompletion(response, { signal: caller.signal, callerSignal: caller.signal, sessionId, onOperation: value => seen.push(value) });
  await new Promise(resolve => setImmediate(resolve)); caller.abort();
  await assert.rejects(pending, e => e.code === 'model_request_cancelled');
  assert.equal(seen.length, 1); assert.equal(seen[0].requestId, requestId); assert.equal(seen[0].delivery, 'UNKNOWN');
  await assert.rejects(readHostedCompletion(new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('upstream body connection failed')); } }), { headers }), { sessionId }), e => e.code === 'provider_unavailable' && e.status === 502);
});

test('content guard rejects recognizable credentials without leaking them and permits public hashes/placeholders', () => {
  const values = ['-----BEGIN PRIVATE KEY-----\nprivate fixture bytes', 'OPENAI_API_KEY="sk-proj-0123456789abcdefghijklmnop"', 'password="a-long-sensitive-fixture"', 'Bearer abcdefghijklmnopqrstuvwxyz012345', 'mnemonic="one two six seven eight nine ten red blue green black white"', '私钥="0x' + 'a'.repeat(64) + '"',
    'mnemonic: ' + Array(11).fill('abandon').join(' ') + ' about',
    ...[12, 15, 18, 21, 24].flatMap(count => ['seed_phrase', '助记词'].map(label => `${label}="${Array(count).fill('abandon').join(' ')}"`))];
  for (const secret of values) {
    assert.throws(() => assertNoSelectedSecrets(secret), error => error.code === 'model_context_secret' && !error.message.includes(secret));
    let sent = 0;
    const router = createModelRouter({ fetchImpl: async () => { sent++; } });
    assert.throws(() => router.generate({ prompt: 'Review this selected context', attachments: [{ id: 'selected', name: 'selected.txt', mimeType: 'text/plain', text: secret }], hostedSession: sessionId }), e => e.code === 'model_context_secret');
    assert.throws(() => router.generate({ provider: 'openai', apiKey: 'only-fixture-key-12345', prompt: `Review this selected context:\n${secret}` }), e => e.code === 'model_context_secret');
    assert.equal(sent, 0);
  }
  assert.doesNotThrow(() => assertNoSelectedSecrets('const txHash = "0x' + 'a'.repeat(64) + '"; const publicKey = "' + 'b'.repeat(64) + '"; api_key=""; token="<REDACTED>"; apiKey=process.env.API_KEY; api_key="EXAMPLE_KEY_HERE";'));
});

test('coded reader failures never expose raw messages or arbitrary status and code fields', async () => {
  const sensitive = 'SENSITIVE_FIXTURE_READER_CONTEXT';
  for (const code of ['ECONNRESET', 'arbitrary_upstream_code', 'model_stream_invalid', 'model_receipt_invalid', 'model_output_too_large']) {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(Object.assign(new Error(sensitive), { code, status: 418 })); } }), { headers });
    await assert.rejects(readHostedCompletion(response, { sessionId }), error => {
      assert.equal(error.code, code.startsWith('model_') ? code : 'provider_unavailable');
      assert.equal(error.status, 502); assert.equal(error.message.includes(sensitive), false);
      assert.equal(JSON.stringify(error).includes(sensitive), false);
      return true;
    });
  }
  for (const cancelled of [false, true]) {
    const controller = new AbortController();
    controller.abort(Object.assign(new Error(sensitive), { code: 'ECONNRESET', status: 418 }));
    await assert.rejects(readHostedCompletion(new Response(raw('answer'), { headers }), { sessionId, signal: controller.signal, ...(cancelled ? { callerSignal: controller.signal } : {}) }), error => {
      assert.equal(error.code, cancelled ? 'model_request_cancelled' : 'model_timeout');
      assert.equal(error.message.includes(sensitive), false); return true;
    });
  }
});
