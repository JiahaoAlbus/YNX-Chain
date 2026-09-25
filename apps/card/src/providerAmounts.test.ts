import test from 'node:test';
import assert from 'node:assert/strict';
import {formatProviderAmount,parseProviderLimit,providerBlockState} from './providerAmounts';
test('provider precision is explicit and retains large amounts and refund signs',()=>{
  assert.equal(formatProviderAmount('12345',2,'USD'),'123.45 USD');
  assert.equal(formatProviderAmount('-1',2,'USD'),'-0.01 USD');
  assert.equal(formatProviderAmount('1000000000000000001',18,'TEST'),'1.000000000000000001 TEST');
  for(const digits of [undefined,null,NaN,Infinity,1.5,-1,37])assert.equal(formatProviderAmount('1',digits,'USD'),null);
  assert.equal(formatProviderAmount('1',2,''),null);assert.equal(formatProviderAmount(undefined,2,'USD'),null);
});
test('user-facing limit converts exactly once to minor units without rounding',()=>{
  assert.equal(parseProviderLimit('100',2),'10000');assert.equal(parseProviderLimit('0.01',2),'1');assert.equal(parseProviderLimit('100',0),'100');
  for(const amount of ['0','-1','1.001','1e2','1,000',' 100','01'])assert.throws(()=>parseProviderLimit(amount,2),/CARD_LIMIT_INVALID/);
});
test('missing block state cannot be displayed as an unfrozen card',()=>{
  for(const value of [null,undefined,'false',0])assert.equal(providerBlockState(value),'unknown');
  assert.equal(providerBlockState(false),'unfrozen');assert.equal(providerBlockState(true),'frozen');
});
