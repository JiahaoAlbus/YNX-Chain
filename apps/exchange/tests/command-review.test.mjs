import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommandReview} from '../web/command-review.js';
test('existing six handler contracts prepare exact inputs without authority or network',()=>{
  const ctx={account:'owned',withdrawalFeeMicro:2};
  const rows=[['cancel',{order:{id:'a/b',account:'owned',status:'open'}},'/v1/orders/a%2Fb/cancel'],['deposit',{intentId:'intent_1',txHash:'0x'+'a'.repeat(64)},'/v1/deposits'],['withdrawal',{destination:'ynx1abcdefgh',amount:'1.000001'},'/v1/withdrawals/review'],['security',{withdrawalLock:true,orderConfirmation:true,sessionTtlMinutes:60},'/v1/security'],['support',{category:'order',message:'  Please inspect my order.  '},'/v1/support'],['ai',{kind:'order_draft',contextClass:'owned_orders',prompt:'Review these orders',permission:false},'/v1/ai/drafts']];
  for(const [kind,input,path] of rows){const review=buildCommandReview(kind,input,ctx);assert.equal(review.path,path);assert.equal(review.submitted,false);assert.equal(review.executionAuthorized,false);assert.equal(review.boundary,'EXPLICIT_ROUTE_SCOPE_UNAVAILABLE');assert.equal('idempotencyKey' in review.body,false);assert.equal('walletSignature' in review.body,false);assert.ok(Object.isFrozen(review.body));}
  assert.equal(buildCommandReview('withdrawal',rows[2][1],ctx).body.amountMicro,1000001);
});
test('byte limits, exact decimals, ownership and role fail closed',()=>{
  for(const input of [{category:'x',message:'long enough message'},{category:'order',message:'short'},{category:'order',message:'界'.repeat(667)}])assert.throws(()=>buildCommandReview('support',input));
  for(const status of ['filled','cancelled','unknown'])assert.throws(()=>buildCommandReview('cancel',{order:{id:'o',account:'owned',status}},{account:'owned'}));
  assert.throws(()=>buildCommandReview('cancel',{order:{id:'o',account:'other',status:'open'}},{account:'owned'}));
  for(const amount of ['1e3','0','1.0000001','9007199254.740992'])assert.throws(()=>buildCommandReview('withdrawal',{destination:'ynx1abcdefgh',amount}));
  assert.throws(()=>buildCommandReview('withdrawal',{destination:'ynx1abcdefgh',amount:'1'},{withdrawalFeeMicro:1000000}));
  assert.throws(()=>buildCommandReview('ai',{kind:'trade',contextClass:'all_accounts',permission:true,prompt:'Run it'}));
  assert.throws(()=>buildCommandReview('deposit',{intentId:'i',txHash:'z'.repeat(64)}));
});
