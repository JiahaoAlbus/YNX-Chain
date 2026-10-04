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
test('optional merchant allowlist is enforced and explicit deny always wins',()=>{
  assert.equal(risk({...base,controls:{...controls,allowedMerchants:['demo']}}),undefined);
  assert.equal(risk({...base,controls:{...controls,allowedMerchants:['another']}}),'MERCHANT_BLOCKED');
  assert.equal(risk({...base,controls:{...controls,allowedMerchants:['demo'],blockedMerchants:['demo']}}),'MERCHANT_BLOCKED');
  assert.equal(risk({...base,controls:{...controls,allowedMerchants:[]}}),undefined);
});
test('emergency block precedes spend and attempt budgets but cannot unfreeze a card',()=>{
  const input={...base,availableWei:'0',previous:Array.from({length:3},()=>prior('DECLINED')),controls:{...controls,emergencyBlock:true}};
  assert.equal(risk(input),'EMERGENCY_BLOCK');
  assert.equal(risk({...input,status:'FROZEN'}),'CARD_FROZEN');
  assert.equal(risk({...input,status:'CLOSED'}),'CARD_CLOSED');
});

test('invalid amounts and controls fail closed instead of producing approval or throwing',()=>{
 for(const amountWei of ['-1','0','01','1.5','1e3','',String(2n**256n),'x'])assert.equal(risk({...base,amountWei}),'INVALID_PROCESSOR_EVENT');
 for(const availableWei of ['-1','invalid',String(2n**256n)])assert.equal(risk({...base,availableWei}),'INVALID_PROCESSOR_EVENT');
 for(const patch of [{velocity:0},{velocity:1.5},{velocity:NaN},{dailyWei:'-1'},{monthlyWei:'invalid'},{online:'yes'},{blockedMcc:null},{emergencyBlock:'yes'},{allowedMerchants:[null]}])assert.equal(risk({...base,controls:{...controls,...patch} as unknown as TestnetRiskControls}),'INVALID_PROCESSOR_EVENT');
});

test('malformed processor history and future authorizations cannot bypass budgets',()=>{
 for(const createdAt of ['invalid','2026-10-03T12:01:00.000Z','2026-10-03T12:00:00+00:00'])assert.equal(risk({...base,previous:[prior('APPROVED',createdAt)]}),'INVALID_PROCESSOR_EVENT');
 for(const amountWei of ['-100','0','invalid',String(2n**256n)])assert.equal(risk({...base,previous:[prior('APPROVED',now,'card-a',amountWei)]}),'INVALID_PROCESSOR_EVENT');
 assert.equal(risk({...base,previous:[{...prior('APPROVED'),status:'CAPTURED' as 'APPROVED'}]}),'INVALID_PROCESSOR_EVENT');
 assert.equal(risk({...base,now:'invalid'}),'INVALID_PROCESSOR_EVENT');
});

test('merchant schema rejects unrecognized channels and noncanonical categories before approval',()=>{
 for(const patch of [{id:''},{mcc:'581'},{mcc:'5812\n'},{country:'us'},{channel:'unrecognized'},{recurring:'yes'}])assert.equal(risk({...base,merchant:{...base.merchant,...patch} as typeof base.merchant}),'INVALID_PROCESSOR_EVENT');
 assert.equal(risk({...base,status:'UNKNOWN' as 'ACTIVE'}),'INVALID_PROCESSOR_EVENT');
});

test('uint256 boundary remains exact and invalid other-card history cannot spend this card budget',()=>{
 const limit=(2n**256n-1n).toString();
 assert.equal(risk({...base,amountWei:limit,availableWei:limit,controls:{...controls,maxSingleWei:limit,dailyWei:limit,monthlyWei:limit}}),undefined);
 assert.equal(risk({...base,previous:[prior('APPROVED','invalid','other-card','invalid')]}),undefined);
 const input={...base,previous:[prior('APPROVED','invalid')]},snapshot=JSON.stringify(input);
 assert.equal(risk(input),'INVALID_PROCESSOR_EVENT');assert.equal(JSON.stringify(input),snapshot);
});
