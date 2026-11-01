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
 assert.deepEqual(calls,[{action:'intent',intentId:operation},{action:'recover-intent',intentId:operation}]);
 available=false;await assert.rejects(nav.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'});assert.equal(calls.length,2);
 await assert.rejects(nav.openOriginalIntent({url:'fake',capsule:{approve:true}}),{code:'SHOP_NATIVE_PAY_ORIGINAL_REQUIRED'});
});
test('late account/Source change or rebound original cannot become navigation success',async()=>{
 let locked=false;
 const entry={status(){return {available:true,normalMainEntry:true,paymentAuthorized:false}},async invoke(){locked=true;return {reference:{intentId:operation},intent:{intentId:operation,originalOperation:operation,state:'ISSUED'},clientIndependentFinality:false}}};
 const nav=createOriginalShopPayNavigation({entry,current(){if(locked)throw Error('PUBLIC original context changed')}});
 await assert.rejects(nav.openOriginalIntent(operation),/PUBLIC original context changed/);
 const wrong=createOriginalShopPayNavigation({entry:{...entry,async invoke(){return {reference:{intentId:'foreign'}}}},current(){}});
 await assert.rejects(wrong.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});
});
