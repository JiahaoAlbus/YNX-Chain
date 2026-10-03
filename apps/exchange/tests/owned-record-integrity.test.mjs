import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateAccountController,validateAccountSnapshot} from '../web/private-account-controller.js';

const account='ynx1'+'q'.repeat(38),origin='https://exchange.ynxweb4.com';
function snapshot(){
  return {
    sourceMetadata:{authority:'YNX-owned deterministic order state',version:'exchange-public-state-v1',classification:'testnet',status:'degraded_single_host',stateBackend:'file-cas-single-host',multiInstance:false,coverage:'account-ledger-orders-trades-fees-audit',asOf:new Date().toISOString()},
    balances:[{account,asset:'YUSD_TEST',availableMicro:1234567,reservedMicro:0}],
    ledger:[{id:'l1',account,asset:'YUSD_TEST',availableDelta:-1234567,reservedDelta:1234567}],
    orders:[{id:'o1',account,priceMicro:0,amountMicro:1234567,filledMicro:4567,reservedMicro:0,status:'future_venue_status'}],
    trades:[{id:'t1',buyer:account,seller:account,priceMicro:1200000,amountMicro:4567,buyerFeeMicro:0,sellerFeeMicro:1}],
    fees:[{id:'f1',account,amountMicro:1}],deposits:[{id:'d1',account,amountMicro:1234567}],
    withdrawals:[{id:'w1',account,amountMicro:1234567,feeMicro:1000000,receiveMicro:234567}],
    depositIntents:[],support:[],ai:[],audit:[],security:{account,withdrawalLock:false,sessionTtlMinutes:480},
  };
}
test('owned records preserve signed ledger deltas, zero market price, unknown venue status and exact safe integers',()=>{
  const value=snapshot();value.balances[0].availableMicro=Number.MAX_SAFE_INTEGER;
  assert.equal(validateAccountSnapshot(value,account),value);
  assert.equal(value.ledger[0].availableDelta,-1234567);
  assert.equal(value.orders[0].status,'future_venue_status');
});
test('missing, negative and inconsistent quantities never produce apparently verified account totals',()=>{
  const mutations=[
    v=>delete v.balances[0].availableMicro,v=>v.balances[0].reservedMicro=-1,
    v=>v.orders[0].filledMicro=v.orders[0].amountMicro+1,v=>delete v.orders[0].amountMicro,
    v=>v.trades[0].amountMicro=-1,v=>delete v.trades[0].buyerFeeMicro,
    v=>v.fees[0].amountMicro=-1,v=>v.deposits[0].amountMicro=-1,
    v=>v.withdrawals[0].receiveMicro++,v=>delete v.withdrawals[0].feeMicro,
    v=>delete v.ledger[0].availableDelta,v=>v.ledger[0].reservedDelta='123',
    v=>v.balances[0].availableMicro=Number.MAX_SAFE_INTEGER+1,
  ];
  for(const mutate of mutations){const value=snapshot();mutate(value);assert.throws(()=>validateAccountSnapshot(value,account),{code:'UNSAFE_ACCOUNT_AMOUNT'})}
});
test('duplicate assets and per-table record IDs fail closed instead of silently double-counting',()=>{
  for(const key of ['balances','ledger','orders','trades','fees','deposits','withdrawals']){
    const value=snapshot();value[key].push({...value[key][0]});
    assert.throws(()=>validateAccountSnapshot(value,account),{code:'INVALID_ACCOUNT_RESPONSE'});
  }
  for(const key of ['depositIntents','support','ai','audit']){
    const value=snapshot();value[key]=[{account,id:'duplicate'},{account,id:'duplicate'}];
    assert.throws(()=>validateAccountSnapshot(value,account),{code:'INVALID_ACCOUNT_RESPONSE'});
  }
  const value=snapshot();delete value.trades[0].id;assert.throws(()=>validateAccountSnapshot(value,account),{code:'INVALID_ACCOUNT_RESPONSE'});
});
test('withdrawal arithmetic is exact even when adding safe integers would overflow Number precision',()=>{
  const value=snapshot();value.withdrawals[0]={...value.withdrawals[0],amountMicro:Number.MAX_SAFE_INTEGER,feeMicro:1,receiveMicro:Number.MAX_SAFE_INTEGER-1};
  assert.equal(validateAccountSnapshot(value,account),value);
  value.withdrawals[0].receiveMicro=Number.MAX_SAFE_INTEGER;assert.throws(()=>validateAccountSnapshot(value,account),{code:'UNSAFE_ACCOUNT_AMOUNT'});
});
test('security display cannot coerce false strings or invent a default for missing/out-of-policy TTL',()=>{
  for(const mutate of [v=>v.security.withdrawalLock='false',v=>delete v.security.sessionTtlMinutes,v=>v.security.sessionTtlMinutes=0,v=>v.security.sessionTtlMinutes=481]){
    const value=snapshot();mutate(value);assert.throws(()=>validateAccountSnapshot(value,account),{code:'INVALID_ACCOUNT_RESPONSE'});
  }
});
test('malformed refresh clears owned read data, preserves Standard Wallet and recovers only on a verified new read',async()=>{
  const standard={provider:{},status:'connected',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};
  let body=snapshot(),reads=0;
  const controller=createPrivateAccountController({wallet:{getPrivateWalletContext:()=>standard},
    createAdapter:async()=>({close(){},createIntrospectionProof:async()=>({proofHeader:'isolated-test-proof'}),client:{restore:async()=>({status:'connected',session:{productId:'exchange',origin,chainId:'ynx_6423-1',account,scopes:['exchange:read'],expiresAt:new Date(Date.now()+60000).toISOString()}})}}),
    fetchImpl:async()=>{reads++;return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})},
  });
  try{
    assert.equal((await controller.start(origin+'/')).phase,'connected');
    body.balances[0].availableMicro=-1;
    const rejected=await controller.refresh();assert.equal(rejected.phase,'degraded');assert.equal(rejected.code,'UNSAFE_ACCOUNT_AMOUNT');assert.equal(rejected.snapshot,null);assert.equal(rejected.account,null);
    assert.equal(standard.status,'connected');assert.equal(standard.revision,1);
    body=snapshot();assert.equal((await controller.refresh()).phase,'connected');assert.equal(reads,3);
  }finally{controller.close()}
});
