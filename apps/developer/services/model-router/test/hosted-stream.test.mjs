import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createMockHostedRouter as createModelRouter } from './stream-fixture.mjs';
import { streamText } from './stream-fixture.mjs';

const response = raw => new Response(raw, { headers: { 'content-type': 'text/event-stream' } });
const generate = raw => createModelRouter({ fetchImpl: async () => response(raw) }).generate({ prompt: 'Review selected text' });
const invalid = error => error.code === 'model_stream_invalid' && error.status === 502;

test('truncated, malformed, out-of-order and post-terminal answers never succeed', async () => {
  const good = streamText('answer');
  for (const raw of [
    good.slice(0, good.indexOf('event: done')),
    good.replace('{"text":"answer"}', '{broken'),
    good.replace('event: token', 'event: unknown'),
    good.replace('event: metadata', 'event: token'),
    good + 'event: token\ndata: {"text":"late"}\n\n',
    good + 'event: token',
    good.replace('event: done\ndata: {"requestId":"qa-request"}', 'event: done\ndata: {"requestId":"other-request"}'),
    'data: {"text":"unframed answer"}\n\n',
  ]) await assert.rejects(generate(raw), invalid);
  await assert.rejects(createModelRouter({ fetchImpl: async () => new Response(good) }).generate({ prompt: 'Review selected text' }), invalid);
});

test('real HTTP fragmented UTF-8/CRLF stream completes; stalled body times out', async t => {
  const server = http.createServer((request, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (request.url.startsWith('/stall/')) {
      res.write('event: metadata\ndata: {"requestId":"qa-request","sessionId":"qa-session"}\n\n');
      return;
    }
    const bytes = Buffer.from(streamText('中文 answer').replace(/\n/g, '\r\n'));
    let n = 0;
    const send = () => { if (n === bytes.length) res.end(); else { res.write(bytes.subarray(n, ++n)); setImmediate(send); } };
    send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const good = createModelRouter({ hostedBaseURL: base, timeoutMs: 1000 });
  assert.equal((await good.generate({ prompt: 'Review selected text' })).text, '中文 answer');
  const stalled = createModelRouter({ hostedBaseURL: base + '/stall', timeoutMs: 50 });
  await assert.rejects(stalled.generate({ prompt: 'Review selected text' }), e => e.code === 'model_timeout' && e.status === 504);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stalled.catalog().active, 0);
});

test('cancellation retires a stalled injected body and does not accept partial text', async () => {
  let cancelled = false;
  const router = createModelRouter({ fetchImpl: async () => response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from(streamText('partial').split('event: done')[0])); },
    cancel() { cancelled = true; },
  })) });
  const controller = new AbortController();
  const result = router.generate({ prompt: 'Review selected text', signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(result, e => e.code === 'model_request_cancelled');
  assert.equal(cancelled, true);
});

test('bounded stream cancels oversized input before accepting completion', async () => {
  let cancelled = false, pulls = 0;
  const router = createModelRouter({ fetchImpl: async () => response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(Buffer.alloc(1024 * 1024, 32)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(router.generate({ prompt: 'Review selected text' }), e => e.code === 'model_output_too_large');
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6);
  await assert.rejects(generate(streamText('x'.repeat(2 * 1024 * 1024 + 1))), e => e.code === 'model_output_too_large');
});
