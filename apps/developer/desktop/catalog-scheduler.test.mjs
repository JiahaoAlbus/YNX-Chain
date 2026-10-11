import test from 'node:test';
import assert from 'node:assert/strict';
import { duplexPair } from 'node:stream';
import scheduler from '../runtime/ynx-workbench/lib/catalog-scheduler.js';
import channel from '../runtime/ynx-workbench/lib/marketplace-channel.js';

test('UI detail burst crosses the real unchanged pipe quotas without dropped requests', async () => {
  const [parent, child] = duplexPair(); const starts = [];
  const server = channel.serveCatalog(parent, async (_operation, options) => { starts.push(performance.now()); return { extensions: [{ name: options.extensionName }] }; });
  const client = scheduler.scheduleCatalog(channel.catalogClient(child));
  try {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => client.request('query', { extensionName: String(i) })));
    assert.deepEqual(results.map(result => result.extensions[0].name), Array.from({ length: 12 }, (_, i) => String(i)));
    for (let i = 8; i < starts.length; i++) assert.ok(starts[i] - starts[i - 8] >= 1000);
  } finally { client.close(); server.close(); }
});
test('bounded queue captures options, rejects unsupported operations and closes pending reads', async () => {
  const [parent, child] = duplexPair(); let captured;
  const server = channel.serveCatalog(parent, async (_operation, options) => { captured = options; return new Promise(() => {}); });
  const client = scheduler.scheduleCatalog(channel.catalogClient(child));
  try {
    const options = { extensionName: 'original' };
    const pending = [assert.rejects(client.request('query', options), error => error.catalogCategory === 'CHANNEL_UNAVAILABLE')];
    options.extensionName = 'changed';
    for (let i = 1; i < 64; i++) pending.push(assert.rejects(client.request('query'), error => error.catalogCategory === 'CHANNEL_UNAVAILABLE'));
    await assert.rejects(client.request('query'), error => error.catalogCategory === 'QUOTA');
    await assert.rejects(client.request('install'), error => error.catalogCategory === 'POLICY');
    await new Promise(resolve => setImmediate(resolve)); assert.equal(captured.extensionName, 'original');
    client.close(); server.close(); await Promise.all(pending);
    await assert.rejects(client.request('query'), error => error.catalogCategory === 'CHANNEL_UNAVAILABLE');
  } finally { client.close(); server.close(); }
});
test('failed query remains failed without replay and releases a slot for the next query', async () => {
  const calls = []; const failure = new Error('provider refused');
  const client = scheduler.scheduleCatalog({ request: async (_operation, options) => { calls.push(options.extensionName); if (calls.length === 1) throw failure; return 'ok'; }, close() {} });
  try {
    await assert.rejects(client.request('query', { extensionName: 'one' }), error => error === failure);
    assert.equal(await client.request('query', { extensionName: 'two' }), 'ok');
    assert.deepEqual(calls, ['one', 'two']);
  } finally { client.close(); }
});
