import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalShopPayNavigation} from './pay-intent-navigation.mjs';
const operation='npi_'+'ab'.repeat(24);
test('PUBLIC Main port contract: only original typed intent/read recovery, never approval or send',async()=>{
 const calls=[];let available=true;
 const entry={status(){return {available,normalMainEntry:true,paymentAuthorized:false}},async invoke(request){calls.push(request);return {reference:{intentId:operation},intent:{intentId:operation,originalOperation:operation,state:'PREPARED'},clientIndependentFinality:false}}};
 const nav=createOriginalShopPayNavigation({entry,current(){}});
 assert.equal((await nav.openOriginalIntent(operation)).originalOperation,operation);
 assert.equal((await nav.recoverOriginalIntent(operation)).queryOnly,true);
 assert.deepEqual(calls,[{action:'intent',intentId:operation},{action:'intent',intentId:operation}]);
 available=false;await assert.rejects(nav.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'});assert.equal(calls.length,2);
 await assert.rejects(nav.openOriginalIntent({url:'fake',capsule:{approve:true}}),{code:'SHOP_NATIVE_PAY_ORIGINAL_REQUIRED'});
});
test('missing actual Main Source retains its first cause without invoking Main',async()=>{
 let invoked=0;
 const nav=createOriginalShopPayNavigation({entry:{status(){return {available:false,normalMainEntry:true,paymentAuthorized:false,reason:'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE'}},invoke(){invoked++;}},current(){}});
 for(const action of ['openOriginalIntent','recoverOriginalIntent']){
  await assert.rejects(nav[action](operation),error=>error.code==='SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'&&error.cause?.code==='NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');
 }
 assert.equal(invoked,0);
});
test('context revoked during status lookup cannot dispatch the original read',async()=>{
 let revoked=false,invoked=0;
 const nav=createOriginalShopPayNavigation({entry:{async status(){revoked=true;return {available:true,normalMainEntry:true,paymentAuthorized:false}},invoke(){invoked++;}},current(){if(revoked)throw Error('PUBLIC original context revoked')}});
 await assert.rejects(nav.recoverOriginalIntent(operation),/PUBLIC original context revoked/);
 assert.equal(invoked,0);
});
test('late account/Source change or rebound original cannot become navigation success',async()=>{
 let locked=false;
 const entry={status(){return {available:true,normalMainEntry:true,paymentAuthorized:false}},async invoke(){locked=true;return {reference:{intentId:operation},intent:{intentId:operation,originalOperation:operation,state:'ISSUED'},clientIndependentFinality:false}}};
 const nav=createOriginalShopPayNavigation({entry,current(){if(locked)throw Error('PUBLIC original context changed')}});
 await assert.rejects(nav.openOriginalIntent(operation),/PUBLIC original context changed/);
 const wrong=createOriginalShopPayNavigation({entry:{...entry,async invoke(){return {reference:{intentId:'foreign'}}}},current(){}});
 await assert.rejects(wrong.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});
});
