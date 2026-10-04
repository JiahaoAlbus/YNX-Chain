import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTestnetSpendControls} from './cardSpendControls';
import {cardSpendControlsCopy} from './cardSpendControlsCopy';
test('explicit controls preserve exact amounts and allow emergency-only changes',()=>{
  assert.deepEqual(buildTestnetSpendControls('','',true),{allowedMerchants:[],emergencyBlock:true});
  assert.deepEqual(buildTestnetSpendControls('0.000000000000000001','demo_one, demo-two',false),{maxSingleWei:'1',allowedMerchants:['demo_one','demo-two'],emergencyBlock:false});
});
test('merchant input rejects unknown syntax, empty entries, duplicates and excessive lists',()=>{
  for(const input of ['a/a','a,,b','a,a','a,',Array(101).fill('a').join(','),'a'.repeat(101)])assert.throws(()=>buildTestnetSpendControls('',input,false));
});
test('all control labels are translated with matching shape and English has no CJK',()=>{
  for(const copy of Object.values(cardSpendControlsCopy)){assert.equal(copy.length,5);assert.ok(copy.every(text=>text.length>0));}
  assert.doesNotMatch(cardSpendControlsCopy.en.join(' '),/[\u3400-\u9fff]/);
});
