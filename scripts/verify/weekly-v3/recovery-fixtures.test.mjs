import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRecoveryFixtures, recoveryAccountA, recoveryAccountB} from './recovery-fixtures.mjs';

test('unknown order target exists only beyond the first 500 results', () => {
  const v = makeRecoveryFixtures();
  assert.equal(v.firstPage.length, 500); assert.equal(v.secondPage.length, 1);
  assert(!v.firstPage.some(o => o.client_order_id === v.targetClientOrderId));
  assert.equal(v.secondPage[0].client_order_id, v.targetClientOrderId);
  assert.equal(new Set([...v.firstPage, ...v.secondPage].map(o => o.id)).size, 501);
});
test('paging sample retains complete Order fields, nullable values and exact decimal strings', () => {
  const v = makeRecoveryFixtures();
  for (const order of [...v.firstPage, ...v.secondPage]) {
    assert.equal(Object.keys(order).length, 36);
    assert.equal(order.extended_hours, false); assert.equal(order.filled_avg_price, null);
    assert.equal(typeof order.limit_price, 'string'); assert.equal(typeof order.qty, 'string');
  }
});
test('different orders may have the same occurrence time but distinct increasing cursors', () => {
  const [a, b] = makeRecoveryFixtures().sameTimeDifferentOrders;
  assert.equal(a.timestamp, b.timestamp); assert.equal(a.at, b.at);
  assert.notEqual(a.order.id, b.order.id); assert(a.event_id < b.event_id);
});
test('multi-user stream has explicit separate provider account ownership', () => {
  const events = makeRecoveryFixtures().mixedAccounts;
  assert.deepEqual(events.map(e => e.account_id), [recoveryAccountA, recoveryAccountB, recoveryAccountA]);
  assert.equal(new Set(events.map(e => e.order.client_order_id)).size, 3);
});
test('duplicate and delayed-after-fill vectors are not silently de-duplicated or sorted', () => {
  const v = makeRecoveryFixtures();
  assert.deepEqual(v.duplicateReplay[0], v.duplicateReplay[1]);
  assert.equal(v.delayedAfterFill[0].event, 'fill');
  assert(v.delayedAfterFill[0].timestamp > v.delayedAfterFill[1].timestamp);
  assert.equal(v.delayedAfterFill[0].order.id, v.delayedAfterFill[1].order.id);
});
test('resume token is provider cursor, not synthetic reconciliation hash', () => {
  const {savedProviderCursor, next} = makeRecoveryFixtures().resumeAfterFirst;
  assert.match(savedProviderCursor, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert(next.every(e => e.event_id > savedProviderCursor));
});
test('unsafe quote vectors explicitly require zero provider writes', () => {
  const cases = makeRecoveryFixtures().quoteCases;
  assert.equal(cases.filter(c => c.expected === 'no_provider_post').length, 3);
});
test('vectors are fresh copies and never claim official verification', () => {
  const first = makeRecoveryFixtures(); first.firstPage[0].symbol = 'MUTATED';
  const fresh = makeRecoveryFixtures();
  assert.equal(fresh.firstPage[0].symbol, 'ACME'); assert.equal(fresh.officialSandboxVerified, false);
});
