import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseMicro, feeMicro, validateTradingRules, buildOrderPreview, MAX_RULE_AGE_MS} from '../web/order-preview.js';

const rules = {schemaVersion:'exchange-limit-rules-v1', market:'YNXT-YUSD_TEST', orderTypes:['limit'], scale:'1000000', minPriceMicro:'1', maxPriceMicro:'1000000000000', minAmountMicro:'1', maxAmountMicro:'1000000000000', maxOrderNotionalMicro:'100000000000', makerFeeBps:17, takerFeeBps:43, notionalRounding:'floor_micro', feeRounding:'ceil_micro_per_fill', quoteAssetType:'venue_only_test_credit_not_token', admissionMinimumQuote:'not_enforced_by_engine'};
const now = Date.parse('2026-09-12T12:00:00Z');
const source = {asOf:new Date(now).toISOString(), authority:'YNX-owned deterministic order state', classification:'testnet', status:'degraded_single_host'};
const input = (changes={}) => ({price:'2.000001', amount:'3.000001', side:'buy', rules, source, marketPhase:'live', now, ...changes});

test('exact decimals retain micros without floating point or notation normalization', () => {
  assert.equal(parseMicro('0.000001'), 1n);
  assert.equal(parseMicro('1000000.000000'), 1000000000000n);
  assert.equal(parseMicro('9007199254.740993'), 9007199254740993n);
  for (const value of ['1e6','1E6','1.0000001','1,000',' 1','1 ','+1','-1','.1','1.','01','1\n','Infinity','NaN',null,1, '9'.repeat(27)]) {
    assert.throws(() => parseMicro(value), {code:'DECIMAL_INVALID'}, String(value));
  }
});
test('configured fees and initial reservation use exact floor then ceil semantics', () => {
  const buy = buildOrderPreview(input());
  assert.equal(buy.notionalMicro, 6000005n);
  assert.equal(buy.makerFeeMicro, 10201n);
  assert.equal(buy.takerFeeMicro, 25801n);
  assert.equal(buy.initialReservationMicro, 6025806n);
  const sell = buildOrderPreview(input({side:'sell'}));
  assert.equal(sell.initialReservationMicro, 3000001n);
  assert.equal(sell.reservationAsset, 'YNXT');
  for (const key of ['submitted','fundsVerified','executionAuthorized']) assert.equal(buy[key], false);
});
test('fee arithmetic stays exact beyond Number safe integer multiplication', () => {
  assert.equal(feeMicro(9007199254740993n, 43), 38730956795387n);
  assert.equal(feeMicro(1n, 43), 1n);
  assert.equal(feeMicro(0n, 43), 0n);
  assert.equal(feeMicro(10n, 0), 0n);
  for (const bps of [-1,1001,1.1,NaN]) assert.throws(() => feeMicro(10n,bps), {code:'FEE_INVALID'});
});
test('venue bounds and UI zero-quote guard fail closed; no invented engine minimum', () => {
  for (const [changes,code] of [[{price:'0'},'PRICE_LIMIT'],[{amount:'0'},'AMOUNT_LIMIT'],[{price:'1000000.000001'},'PRICE_LIMIT'],[{amount:'1000000.000001'},'AMOUNT_LIMIT'],[{price:'1000000',amount:'1000000'},'NOTIONAL_LIMIT'],[{price:'0.000001',amount:'0.000001'},'ZERO_QUOTE_UNSAFE'],[{side:'market'},'SIDE_INVALID']]) assert.throws(() => buildOrderPreview(input(changes)), {code});
  assert.equal(buildOrderPreview(input({price:'100',amount:'1000'})).notionalMicro,100000000000n);
  assert.equal(rules.admissionMinimumQuote,'not_enforced_by_engine');
});
test('preview requires recent verified rules and cannot execute from stale cached data', () => {
  for (const phase of ['offline','reconnecting','unavailable','loading']) assert.throws(() => buildOrderPreview(input({marketPhase:phase})), {code:'RULES_STALE'});
  assert.throws(() => buildOrderPreview(input({now:now+MAX_RULE_AGE_MS+1})), {code:'RULES_STALE'});
  assert.throws(() => buildOrderPreview(input({source:{...source,asOf:new Date(now+5001).toISOString()}})), {code:'RULES_STALE'});
  assert.equal(buildOrderPreview(input({marketPhase:'polling'})).sourceStatus,'degraded_single_host');
});
test('unversioned, unsupported and rounded numeric rule limits are rejected', () => {
  for (const changes of [{schemaVersion:'next'}, {makerFeeBps:44}, {takerFeeBps:1001}, {maxOrderNotionalMicro:100000000000}, {maxOrderNotionalMicro:'1e11'}, {maxOrderNotionalMicro:'9223372036854775808'}, {maxPriceMicro:'1000000000001'}, {feeRounding:'floor'}, {orderTypes:['market']}, {quoteAssetType:'stablecoin'}]) assert.throws(() => validateTradingRules({...rules,...changes}), {code:'RULES_INVALID'});
});
test('real UI offers a read-only editable preview without posting or Wallet access', () => {
  const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8'), html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  const handler=app.slice(app.indexOf('async function reviewOrder'),app.indexOf('function cancelOrder'));
  assert.match(handler,/await marketFeed.retry\(\)/);assert.match(handler,/order-preview-dialog/);
  assert.doesNotMatch(handler,/requireProductSession\(|connectWallet\(|fetch\(|\.request\(|\.sign\(|method:\s*['"]POST/);
  assert.doesNotMatch(app,/Math.round\(Number|q\*\.002/);
  assert.doesNotMatch(html,/0\.10% \/ 0\.20%/);
  for(const phrase of ['Not submitted.','Available venue balance','Unknown — Exchange account proof required','fees']) assert.ok((app+html).toLowerCase().includes(phrase.toLowerCase()));
  assert.match(html,/Single-fill estimates are not a maximum/);
});
