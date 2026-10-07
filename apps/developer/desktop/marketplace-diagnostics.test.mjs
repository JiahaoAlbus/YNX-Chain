import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostics from '../runtime/ynx-workbench/lib/marketplace-diagnostics.js';

test('registry preserves successful results, context and parameters', async () => {
  const options = { query: 'Chinese' }, result = { extensions: [] };
  class Registry { async search(value) { assert.equal(value, options); assert.equal(this.marker, 1); return result; } async query() { return result; } }
  diagnostics.installOn(Registry.prototype); diagnostics.installOn(Registry.prototype);
  const service = new Registry(); service.marker = 1;
  assert.equal(await service.search(options), result); assert.equal(await service.query(), result);
});

test('nested aggregate errors expose only safe diagnostic codes', async () => {
  const privateText = 'https://user:secret@example.org/?query=private-project';
  const denied = Object.assign(new Error(privateText), { code: 'EPERM' });
  const cause = new Error(privateText, { cause: new AggregateError([denied, Object.assign(new Error(privateText), { code: 'secret' })]) });
  denied.cause = cause;
  const messages = [];
  class Registry { async search() { throw cause; } async query() { throw cause; } }
  diagnostics.installOn(Registry.prototype);
  const service = new Registry(); service.logger = { warn: value => messages.push(value) };
  for (const operation of ['search', 'query']) await assert.rejects(service[operation]({ query: privateText }), error => {
    assert.equal(error.cause, cause); assert.match(error.message, /EPERM/); assert.ok(!error.message.includes(privateText)); return true;
  });
  assert.deepEqual(messages, ['YNX_MARKETPLACE operation=search codes=EPERM', 'YNX_MARKETPLACE operation=query codes=EPERM']);
});

test('unknown errors remain failures and failed logging does not mask them', async () => {
  const cause = new Error('secret');
  class Registry { async search() { throw cause; } async query() { throw cause; } }
  diagnostics.installOn(Registry.prototype);
  const service = new Registry(); service.logger = { warn() { throw Error('logging unavailable'); } };
  await assert.rejects(service.search(), error => error.cause === cause && /UNCLASSIFIED/.test(error.message) && !error.message.includes('secret'));
});
