import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateAccountController,validateAccountSnapshot} from '../web/private-account-controller.js';

const account='ynx1'+'q'.repeat(38),origin='https://exchange.ynxweb4.com';
// Controlled proof objects only: the real consumer now requires both SDK
// proofs bound to the exact wire read. Never weaken it to standalone introspection.
function readAdapter(){
  let sequence=0;
  return {close(){},
    createIntrospectionProof:async()=>{throw new Error('Standalone introspection cannot authorize this business read')},
    createBusinessProof:async input=>{
      assert.deepEqual(input,{method:'GET',path:'/api/v1/account',body:'',requiredScopes:['exchange:read']});
      const n=++sequence;
      return {introspection:{proofHeader:'isolated-introspection-'+n},proofHeader:'isolated-action-'+n,body:''};
    },
    client:{restore:async()=>({status:'connected',session:{productId:'exchange',origin,chainId:'ynx_6423-1',account,scopes:['exchange:read'],expiresAt:new Date(Date.now()+60000).toISOString()}})},
  };
}
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
test('owned source timestamps require real RFC3339 dates with bounded past age and future skew',t=>{
  const now=Date.parse('2026-10-01T00:00:00Z');t.mock.method(Date,'now',()=>now);
  for(const asOf of ['2026-09-31T00:00:00Z','2026-10-01 00:00:00','10/01/2026','2026-10-01T00:00:00','2026-10-01T00:00:00+24:00',new Date(now),null,now,new Date(now+5001).toISOString(),new Date(now-120001).toISOString()]){
    const value=snapshot();value.sourceMetadata.asOf=asOf;
    assert.throws(()=>validateAccountSnapshot(value,account),{code:'INVALID_ACCOUNT_SOURCE'},String(asOf));
  }
  for(const asOf of ['2026-10-01T00:00:00Z','2026-10-01T00:00:00.123456789Z','2026-10-01T02:00:00+02:00',new Date(now+5000).toISOString(),new Date(now-120000).toISOString()]){
    const value=snapshot();value.sourceMetadata.asOf=asOf;assert.equal(validateAccountSnapshot(value,account),value);
  }
});
test('raw duplicate JSON keys cannot conceal account or amount fields and recovery requires one explicit fresh read',async()=>{
  const standard={status:'connected',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};
  const valid=JSON.stringify(snapshot());let raw=valid,reads=0;
  const controller=createPrivateAccountController({wallet:{getPrivateWalletContext:()=>standard},
    createAdapter:async()=>readAdapter(),
    fetchImpl:async()=>{reads++;return new Response(raw,{headers:{'content-type':'application/json'}})},
  });
  try{
    assert.equal((await controller.start(origin+'/')).phase,'connected');
    for(const malformed of ['{"balances":[],'+valid.slice(1),valid.replace('"availableMicro":1234567','"availableMicro":-1,"available\\u004dicro":1234567'),valid.replace('"account":','"account":"not-the-owned-account","account":'),valid.slice(0,-1)+',"extra":{"nested":1,"nested":2}}']){
      raw=malformed;const before=reads,rejected=await controller.refresh();
      assert.equal(rejected.phase,'degraded');assert.equal(rejected.code,'INVALID_ACCOUNT_RESPONSE');assert.equal(rejected.snapshot,null);assert.equal(rejected.account,null);
      assert.equal(reads,before+1);assert.equal(standard.status,'connected');assert.equal(standard.revision,1);
      raw=valid;assert.equal(reads,before+1,'replacing the response never triggers an automatic read');
      assert.equal((await controller.refresh()).phase,'connected');assert.equal(reads,before+2);
    }
  }finally{controller.close()}
});
test('malformed refresh clears owned read data, preserves Standard Wallet and recovers only on a verified new read',async()=>{
  const standard={provider:{},status:'connected',chainId:'0x1917',account:'0x'+'a'.repeat(40),revision:1};
  let body=snapshot(),reads=0;
  const controller=createPrivateAccountController({wallet:{getPrivateWalletContext:()=>standard},
    createAdapter:async()=>readAdapter(),
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
test('standalone or unbound dual proof cannot reach the owned account read',async()=>{
  for(const mode of ['missing-business','same-proof','nonempty-body','missing-introspection','whitespace-action']){
    let reads=0;const adapter=readAdapter();
    if(mode==='missing-business')delete adapter.createBusinessProof;
    else adapter.createBusinessProof=async()=>({introspection:mode==='missing-introspection'?null:{proofHeader:'isolated-introspection'},proofHeader:mode==='same-proof'?'isolated-introspection':mode==='whitespace-action'?'unsafe action':'isolated-action',body:mode==='nonempty-body'?'{}':''});
    const controller=createPrivateAccountController({createAdapter:async()=>adapter,fetchImpl:async()=>{reads++;throw new Error('Unbound proof reached HTTP')}});
    try{
      const result=await controller.start(origin+'/');
      assert.equal(result.phase,'degraded',mode);assert.equal(result.code,'ACTION_PROOF_UNAVAILABLE',mode);
      assert.equal(result.account,null);assert.equal(result.snapshot,null);assert.equal(reads,0);
    }finally{controller.close()}
  }
});
