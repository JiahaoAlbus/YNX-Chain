import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestContext, contextChanged} from '../request-context.js';
import {streamJob} from '../ai-stream.js';

test('a late stream chunk cannot update a different account or selected store', async () => {
  let subject = 'A/storeA', controller, cancelled = false;
  const requests = createRequestContext(() => subject), statuses = [];
  const response = new Response(new ReadableStream({start(c) {controller = c;}, cancel() {cancelled = true;}}));
  const pending = streamJob(requests, '/ai/stream', {}, s => statuses.push(s), async () => response);
  await Promise.resolve(); await Promise.resolve();
  subject = 'B/storeB'; requests.invalidate();
  controller.enqueue(new TextEncoder().encode('data: {"Status":"old private result"}\n\n'));
  await assert.rejects(pending, contextChanged);
  assert.deepEqual(statuses, []); assert.equal(cancelled, true);
});

test('split CRLF events render once and service failures remain visible', async () => {
  const requests = createRequestContext(() => 'A'), statuses = [], encoder = new TextEncoder();
  const response = new Response(new ReadableStream({start(c) {for (const chunk of ['data: {"Status":', '"running"}\r\n\r', '\ndata: {"Status":"done"}\n\n']) c.enqueue(encoder.encode(chunk)); c.close();}}));
  await streamJob(requests, '/stream', {}, s => statuses.push(s.Status), async () => response);
  assert.deepEqual(statuses, ['running', 'done']);
  await assert.rejects(streamJob(requests, '/stream', {}, () => {}, async () => new Response('{"error":"provider unavailable"}', {status:503})), e => e.status === 503);
});
