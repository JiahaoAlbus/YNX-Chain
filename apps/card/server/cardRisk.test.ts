import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTestnetAuthorizationRisk as risk,type TestnetRiskControls} from './cardRisk.ts';

const now='2026-10-03T12:00:00.000Z';
const controls:TestnetRiskControls={maxSingleWei:'100',dailyWei:'200',monthlyWei:'300',online:true,recurring:true,international:true,blockedMcc:[],allowedMcc:[],blockedMerchants:[],blockedCountries:[],allowedCountries:[],velocity:3};
const base={cardId:'card-a',status:'ACTIVE' as const,availableWei:'1000',amountWei:'10',merchant:{id:'demo',mcc:'5812',country:'YN',channel:'online' as const,recurring:false},controls,previous:[],now};
const prior=(status:'APPROVED'|'DECLINED',createdAt=now,cardId='card-a',amountWei='10')=>({status,createdAt,cardId,amountWei});

test('declined attempts reach the throttle even with insufficient funds',()=>{
  assert.equal(risk({...base,availableWei:'0',previous:[prior('DECLINED'),prior('DECLINED'),prior('DECLINED')]}),'VELOCITY_EXCEEDED');
  assert.equal(risk({...base,availableWei:'0',previous:[prior('DECLINED')]}),'INSUFFICIENT_BALANCE');
});
test('attempt windows exclude other cards and expire at exactly five minutes',()=>{
  assert.equal(risk({...base,previous:[prior('DECLINED',now,'card-b'),prior('DECLINED',now,'card-b'),prior('DECLINED',now,'card-b')]}),undefined);
  assert.equal(risk({...base,previous:Array.from({length:3},()=>prior('DECLINED','2026-10-03T11:55:00.000Z'))}),undefined);
});
test('freeze and closed lifecycle take precedence over throttling',()=>{
  const previous=Array.from({length:3},()=>prior('DECLINED'));
  assert.equal(risk({...base,status:'FROZEN',previous}),'CARD_FROZEN');
  assert.equal(risk({...base,status:'CLOSED',previous}),'CARD_CLOSED');
});
test('balances remain exact bigint amounts and decline max single transactions',()=>{
  assert.equal(risk({...base,amountWei:'1001'}),'INSUFFICIENT_BALANCE');
  assert.equal(risk({...base,amountWei:'101'}),'MAX_TRANSACTION_EXCEEDED');
  assert.equal(risk({...base,amountWei:'9007199254740993',availableWei:'9007199254740993',controls:{...controls,maxSingleWei:'9007199254740993',dailyWei:'9007199254740993',monthlyWei:'9007199254740993'}}),undefined);
});
test('all existing merchant and channel controls remain enforced',()=>{
  for(const [patch,reason] of [
    [{online:false},'ONLINE_DISABLED'],[{recurring:false},'RECURRING_DISABLED'],
    [{international:false},'INTERNATIONAL_DISABLED'],[{blockedMcc:['5812']},'MCC_BLOCKED'],
    [{allowedMcc:['5411']},'MCC_BLOCKED'],[{blockedMerchants:['demo']},'MERCHANT_BLOCKED'],
    [{blockedCountries:['US']},'COUNTRY_BLOCKED'],[{allowedCountries:['YN']},'COUNTRY_BLOCKED']
  ] as [Partial<TestnetRiskControls>,string][]) {
    assert.equal(risk({...base,merchant:{...base.merchant,country:'US',recurring:true},controls:{...controls,...patch}}),reason);
  }
});
test('UTC daily and monthly approved budgets do not count declines or foreign cards',()=>{
  assert.equal(risk({...base,previous:[prior('APPROVED',now,'card-a','195')]}),'DAILY_LIMIT_EXCEEDED');
  assert.equal(risk({...base,previous:[prior('APPROVED','2026-10-02T12:00:00.000Z','card-a','295')]}),'MONTHLY_LIMIT_EXCEEDED');
  assert.equal(risk({...base,previous:[prior('DECLINED',now,'card-a','999'),prior('APPROVED',now,'card-b','999')]}),undefined);
});
test('risk classification never mutates balances, merchant history or controls',()=>{
  const input={...base,previous:[prior('DECLINED')]},before=JSON.stringify(input);
  assert.equal(risk(input),undefined);assert.equal(JSON.stringify(input),before);
});
