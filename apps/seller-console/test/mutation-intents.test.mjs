import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutationIntents} from '../mutation-intents.js';

test('unconfirmed writes keep their key after account reauthentication but cannot cross accounts', async () => {
  let account = 'account-a';
  const intents = createMutationIntents(() => account);
  const original = await intents.prepare('POST', '/seller/stores', {Name: 'Store', Policy: 'Returns accepted'});
  account = '';
  await assert.rejects(intents.prepare('POST', '/seller/stores', original.body));
  account = 'account-b';
  const other = await intents.prepare('POST', '/seller/stores', original.body);
  assert.notEqual(original.key, other.key);
  account = 'account-a';
  const retried = await intents.prepare('POST', '/seller/stores', {Policy: 'Returns accepted', Name: 'Store'});
  assert.equal(retried.key, original.key);
  intents.confirm(retried);
  assert.notEqual((await intents.prepare('POST', '/seller/stores', original.body)).key, original.key);
});

test('a changed decision or target gets a new key without mutating the pending request body', async () => {
  const intents = createMutationIntents(() => 'account-a'), body = {Action: 'shipped', TrackingNumber: 'first'};
  const original = await intents.prepare('POST', '/orders/one/transition', body);
  body.TrackingNumber = 'second';
  const changed = await intents.prepare('POST', '/orders/one/transition', body);
  const otherOrder = await intents.prepare('POST', '/orders/two/transition', original.body);
  assert.equal(original.body.TrackingNumber, 'first');
  assert.notEqual(original.key, changed.key); assert.notEqual(original.key, otherOrder.key);
});
