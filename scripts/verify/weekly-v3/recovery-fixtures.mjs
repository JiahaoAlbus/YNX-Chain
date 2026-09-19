import fs from 'node:fs';
import {validateBrokerWireFixtures} from './broker-wire-fixtures.mjs';

const publicWire = JSON.parse(fs.readFileSync(new URL('./broker-wire-fixtures.json', import.meta.url)));
validateBrokerWireFixtures(publicWire);
export const recoveryAccountA = '01234567-89ab-4cde-8fab-0123456789ab';
export const recoveryAccountB = '11234567-89ab-4cde-8fab-0123456789ab';
const syntheticId = (prefix, index) => `${prefix}-2222-4333-8444-${String(index).padStart(12, '0')}`;

// Pure deterministic vectors, not a provider implementation. Consumers must
// bind these to the owner's frozen paging/recovery contract before claiming
// product acceptance. The official shape is retained; synthetic values change.
export function makeRecoveryFixtures() {
  const orders = Array.from({length: 501}, (_, index) => ({
    ...structuredClone(publicWire.tradeUpdateNew.order),
    id: syntheticId('22222222', index + 1),
    client_order_id: syntheticId('aaaaaaaa', index + 1),
    asset_id: '11111111-2222-4333-8444-555555555555',
    symbol: 'ACME', side: 'buy', qty: '2', filled_qty: '0',
    limit_price: '125.34', commission: '0', status: 'new',
    created_at: new Date(Date.UTC(2026, 8, 18, 14, 0, index)).toISOString(),
    submitted_at: new Date(Date.UTC(2026, 8, 18, 14, 0, index)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 8, 18, 14, 0, index)).toISOString(),
    expires_at: '2026-09-18T20:00:00Z',
  }));
  const makeEvent = (account, index, orderIndex, event = 'partial_fill') => ({
    ...structuredClone(publicWire.tradeUpdateNew),
    account_id: account,
    event_id: `01K5G3YEKRXAXKDZK3AABK68T${index}`,
    event,
    at: '2026-09-18T14:20:00.002Z',
    timestamp: '2026-09-18T14:20:00.001Z',
    order: {...structuredClone(orders[orderIndex]), status: event === 'fill' ? 'filled' : 'partially_filled', filled_qty: event === 'fill' ? '2' : '1', updated_at: '2026-09-18T14:20:00.001Z'},
    qty: '1', position_qty: event === 'fill' ? '2' : '1', price: '125.34',
  });
  const first = makeEvent(recoveryAccountA, 1, 0);
  const secondSameTime = makeEvent(recoveryAccountA, 2, 1);
  const otherAccount = makeEvent(recoveryAccountB, 3, 2);
  const fill = makeEvent(recoveryAccountA, 4, 0, 'fill');
  fill.at = '2026-09-18T14:20:01.002Z';
  fill.timestamp = '2026-09-18T14:20:01.001Z';
  fill.order.updated_at = fill.timestamp;
  return {
    scope: 'synthetic-local-recovery-vectors-not-official-results',
    officialSandboxVerified: false,
    firstPage: orders.slice(0, 500), secondPage: orders.slice(500),
    targetClientOrderId: orders[500].client_order_id,
    sameTimeDifferentOrders: [first, secondSameTime],
    mixedAccounts: [first, otherAccount, secondSameTime],
    duplicateReplay: [structuredClone(first), structuredClone(first)],
    delayedAfterFill: [fill, structuredClone(first)],
    resumeAfterFirst: {savedProviderCursor: first.event_id, next: [secondSameTime, fill]},
    quoteCases: [
      {name: 'fresh', ageSeconds: 30, entitled: true, expected: 'usable'},
      {name: 'stale', ageSeconds: 121, entitled: true, expected: 'no_provider_post'},
      {name: 'future', ageSeconds: -10, entitled: true, expected: 'no_provider_post'},
      {name: 'missing_entitlement', ageSeconds: 0, entitled: false, expected: 'no_provider_post'},
    ],
  };
}
