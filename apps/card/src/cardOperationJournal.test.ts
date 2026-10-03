import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalCardOperationInput,parsePendingCardOperation,parseTestnetYnxt} from './cardOperationJournal';
import {cardOperationsCopy} from './cardOperationsCopy';

test('YNXT amounts preserve exact 18 decimal places without floats',()=>{
  assert.equal(parseTestnetYnxt('0.000000000000000001'),'1');
  assert.equal(parseTestnetYnxt('1.123456789012345678'),'1123456789012345678');
  assert.equal(parseTestnetYnxt('9007199254740993'),'9007199254740993000000000000000000');
  for(const input of ['0','-1','1e18','01','1.',' 1','NaN','0.0000000000000000001'])assert.throws(()=>parseTestnetYnxt(input));
});
test('journal canonicalization binds immutable nested input and rejects unsafe values',()=>{
  assert.equal(canonicalCardOperationInput({b:2,a:{z:true,y:['1',null]}}),'{"a":{"y":["1",null],"z":true},"b":2}');
  assert.throws(()=>canonicalCardOperationInput({a:undefined}));
  assert.throws(()=>canonicalCardOperationInput({a:Infinity}));
});
test('pending operations are isolated by owner and require exact resource/key/digest shape',()=>{
  const pending={version:1,owner:'qa-owner',cardId:'card-one',resourceId:'card-one',kind:'freeze',key:'card-op-one',digest:'a'.repeat(64),input:{}};
  assert.deepEqual(parsePendingCardOperation(JSON.stringify(pending),'qa-owner'),pending);
  assert.throws(()=>parsePendingCardOperation(JSON.stringify(pending),'other-owner'));
  for(const change of [{kind:'send-real-payment'},{key:'../key'},{digest:'short'},{input:[]}])assert.throws(()=>parsePendingCardOperation(JSON.stringify({...pending,...change}),'qa-owner'));
});
test('all operation labels have locale parity and English default contains no CJK',()=>{
  for(const labels of Object.values(cardOperationsCopy)){assert.equal(labels.length,24);assert.ok(labels.every(label=>label.length>0));}
  assert.doesNotMatch(cardOperationsCopy.en.join(' '),/[\u3400-\u9fff]/);
  assert.match(cardOperationsCopy.en[20]!,/does not credit a balance/);
});
