import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateBrokerWireFixtures} from './broker-wire-fixtures.mjs';

const fixture = () => JSON.parse(fs.readFileSync(new URL('./broker-wire-fixtures.json', import.meta.url)));
test('complete public examples have pinned provenance and exact content', () => {
  const report = validateBrokerWireFixtures(fixture());
  assert.equal(report.officialSandboxVerified, false);
});
test('official at and timestamp remain different, with all nullable Order fields', () => {
  const {tradeUpdateNew: event} = fixture();
  assert.notEqual(event.at, event.timestamp);
  assert.equal(event.order.filled_avg_price, null);
  assert.equal(event.order.extended_hours, false);
  assert.equal(event.order.asset_class, 'us_equity');
  assert.equal(Object.keys(event.order).length, 36);
});
test('official high precision provider balance remains a decimal string', () => {
  assert.equal(fixture().tradingAccount.buying_power, '103556.8572572922');
});
for (const [name, mutate] of Object.entries({
  'wrong cash endpoint': v => { v.sources.gettradingaccount.paths = ['/v1/accounts/{account_id}']; },
  'cash injected into AccountExtended schema': v => { v.sources.getaccount.properties.push('cash'); },
  'dropping extended_hours': v => { delete v.tradeUpdateNew.order.extended_hours; },
  'forcing timestamp equality': v => { v.tradeUpdateNew.timestamp = v.tradeUpdateNew.at; },
  'rounding provider precision': v => { v.tradingAccount.buying_power = '103556.857257292'; },
  'promoting official verification': v => { v.officialSandboxVerified = true; },
})) {
  test(`fixture guard rejects ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => validateBrokerWireFixtures(value));
  });
}
