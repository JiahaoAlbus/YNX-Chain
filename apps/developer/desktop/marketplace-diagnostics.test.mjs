import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostics from '../runtime/ynx-workbench/lib/marketplace-diagnostics.js';
import { createRequire } from 'node:module';

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
    assert.equal(error.cause, undefined); assert.match(error.message, /EPERM/); assert.ok(!error.message.includes(privateText)); return true;
  });
  assert.deepEqual(messages, ['YNX_MARKETPLACE operation=search codes=EPERM', 'YNX_MARKETPLACE operation=query codes=EPERM']);
});

test('unknown errors remain failures and failed logging does not mask them', async () => {
  const cause = new Error('secret');
  class Registry { async search() { throw cause; } async query() { throw cause; } }
  diagnostics.installOn(Registry.prototype);
  const service = new Registry(); service.logger = { warn() { throw Error('logging unavailable'); } };
  await assert.rejects(service.search(), error => error.cause === undefined && /UNCLASSIFIED/.test(error.message) && !error.message.includes('secret'));
});

test('actual retained Theia RPC error codec does not serialize nested private causes', async () => {
  const require = createRequire(new URL('../runtime/theia/package.json', import.meta.url));
  const { defaultMsgPack } = require('@theia/core/lib/common/message-rpc/rpc-message-encoder');
  const secret = 'https://user:private-token@example.org/?query=private-project';
  class Registry { async search() { throw new Error(secret, { cause: Object.assign(new Error(secret), { code: 'EPERM' }) }); } async query() {} }
  diagnostics.installOn(Registry.prototype);
  try { await new Registry().search(); assert.fail('must fail'); }
  catch (error) {
    const encoded = defaultMsgPack.encode({ type: 4, id: 1, err: error });
    assert.ok(!Buffer.from(encoded).includes(Buffer.from(secret)));
    const decoded = defaultMsgPack.decode(encoded); assert.match(decoded.err.message, /EPERM/); assert.equal(decoded.err.cause, undefined);
  }
});
