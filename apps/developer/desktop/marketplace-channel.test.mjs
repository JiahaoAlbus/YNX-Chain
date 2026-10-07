import test from 'node:test';
import assert from 'node:assert/strict';
import { duplexPair } from 'node:stream';
import channel from '../runtime/ynx-workbench/lib/marketplace-channel.js';

test('catalog pipe correlates concurrent responses without exposing general operations', async () => {
  const [parent, child] = duplexPair();
  const server = channel.serveCatalog(parent, async (op, options) => ({ extensions: [{ name: options.name }], op }));
  const client = channel.catalogClient(child);
  try {
    const results = await Promise.all([client.request('search', { name: 'one' }), client.request('query', { name: 'two' })]);
    assert.deepEqual(results.map(x => x.extensions[0].name), ['one', 'two']);
    await assert.rejects(client.request('install'));
  } finally { client.close(); server.close(); }
});

test('closing a session aborts its outstanding catalog work and rejects pending client requests', async () => {
  const [parent, child] = duplexPair(); let started;
  const begun = new Promise(resolve => { started = resolve; }); let signal;
  const server = channel.serveCatalog(parent, async (_op, _options, current) => { signal = current; started(); return new Promise(() => {}); });
  const client = channel.catalogClient(child);
  const pending = assert.rejects(client.request('search'), /unavailable/);
  await begun; server.close(); client.close(); await pending;
  assert.equal(signal.aborted, true);
  await assert.rejects(client.request('search'), /unavailable/);
});

test('timeout retires a session and late provider results cannot revive it', async () => {
  const [parent, child] = duplexPair(); let complete;
  const server = channel.serveCatalog(parent, () => new Promise(resolve => { complete = resolve; }));
  const client = channel.catalogClient(child, 15);
  try {
    await assert.rejects(client.request('search'), /unavailable/);
    complete?.({ extensions: [] });
    await assert.rejects(client.request('query'), /unavailable/);
  } finally { server.close(); client.close(); }
});

test('malformed and oversized request frames never reach a provider', async () => {
  for (const frame of ['{"id":1,"operation":"install","options":{}}\n', '{"id":1,"operation":"search","options":{},"project":"another"}\n', 'x'.repeat(8193)]) {
    const [parent, child] = duplexPair(); let calls = 0;
    const server = channel.serveCatalog(parent, async () => { calls++; });
    child.on('error', () => {}); child.write(frame);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0); assert.equal(parent.destroyed, true); child.destroy(); server.close();
  }
});

test('per-session concurrency is bounded without a request queue', async () => {
  const [parent, child] = duplexPair(); let calls = 0;
  const server = channel.serveCatalog(parent, async () => { calls++; return new Promise(() => {}); });
  const client = channel.catalogClient(child);
  const requests = Array.from({ length: 4 }, () => assert.rejects(client.request('search')));
  await assert.rejects(client.request('query'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 4);
  server.close(); client.close(); await Promise.all(requests);
});
