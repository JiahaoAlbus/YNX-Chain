import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pqBatchMemberHash,classifyPQBatchReceipt} from './pq-batch-receipt.mjs';

// Parser fixtures only: no valid PQ signature or business acceptance is implied.
function fixture(){
  const wire=Buffer.from('unsigned parser-only fixture');
  const batchHash='0x'+createHash('sha256').update(wire).digest('hex');
  const expected=[{amount:'9007199254740993',fee:'1',nonce:'2'},{amount:'1',fee:'1',nonce:'2'},{amount:'1',fee:'1',nonce:'9007199254740993'},{amount:'2',fee:'1',nonce:'3'}];
  const response={batchHash,wireHash:batchHash,status:'durable',replayed:false,executionHeight:'2',results:expected.map((e,index)=>({index,batchHash,wireHash:batchHash,outcome:index===1||index===3?'admitted':'rejected',transactionHash:index===1||index===3?pqBatchMemberHash(batchHash,index):'',error:index===1||index===3?'':'business rejected',decimalFields:{...e,executionHeight:'2'}}))};
  return {wire,response,expected};
}
test('member hash matches fixed application framing vectors in aa97f102',()=>{
  const zero='0x'+'0'.repeat(64);
  for(const [i,want] of [[0,'0xc3734379b242cee7e34589669a060798062b01f809b6b749af0ad0ee7c6652c9'],[1,'0x6754ab3d53902b48068d49f9d0974b8e1f8125f3399830b9f4da66c809b6a6bf'],[1023,'0x2e976c0c8997192623c73de89594605ac8d1c1d6d9dabbc48a41deb65950d53d']])assert.equal(pqBatchMemberHash(zero,i),want);
  for(const [h,i] of [[zero,1024],[zero,-1],[zero,0.5],['0x'+'A'.repeat(64),0]])assert.throws(()=>pqBatchMemberHash(h,i));
});
test('partial checkpoint response counts members, withholding actual inclusion/finality',()=>{
  const f=fixture(),r=classifyPQBatchReceipt(f.wire,f.response,f.expected);
  assert.equal(r.serverReportedAdmitted,2);assert.equal(r.serverReportedRejected,2);assert.equal(r.newServerReportedDurableMembers,2);assert.equal(r.verifiedEffectiveInclusions,null);assert.equal(r.verifiedFinalCommits,null);
});
test('replay memory uncertain and not-committed cannot count new durable business',()=>{
  for(const status of ['durable','memory','uncertain','not_committed']){
    const f=fixture();f.response.status=status;f.response.replayed=status==='durable';
    assert.equal(classifyPQBatchReceipt(f.wire,f.response,f.expected).newServerReportedDurableMembers,0);
  }
});
test('wrong wire identity result ordering and rejected execution identities fail',()=>{
  for(const mutate of [f=>f.response.batchHash='0x'+'0'.repeat(64),f=>f.response.results.reverse(),f=>f.response.results[0].transactionHash=pqBatchMemberHash(f.response.batchHash,0),f=>f.response.results[1].transactionHash='0x'+'1'.repeat(64),f=>f.response.results.pop(),f=>f.response.status='accepted',f=>f.response.status='rejected']){const f=fixture();mutate(f);assert.throws(()=>classifyPQBatchReceipt(f.wire,f.response,f.expected));}
});
test('decimal values stay exact strings beyond JS safe integer range',()=>{
  for(const mutate of [f=>f.response.results[0].decimalFields.amount=9007199254740993,f=>f.response.results[0].decimalFields.amount='9007199254740992',f=>f.expected[0].nonce='02',f=>f.expected[0].amount='18446744073709551616',f=>f.response.executionHeight='02']){const f=fixture();mutate(f);assert.throws(()=>classifyPQBatchReceipt(f.wire,f.response,f.expected));}
});
test('N=1024 with repeated business nonce is one server admission, not 1024',()=>{
  const f=fixture();f.expected=Array.from({length:1024},()=>({amount:'1',fee:'1',nonce:'2'}));f.response.results=f.expected.map((e,index)=>({index,batchHash:f.response.batchHash,wireHash:f.response.batchHash,outcome:index===0?'admitted':'rejected',transactionHash:index===0?pqBatchMemberHash(f.response.batchHash,index):'',error:index===0?'':'nonce',decimalFields:{...e,executionHeight:'2'}}));
  const r=classifyPQBatchReceipt(f.wire,f.response,f.expected);assert.equal(r.serverReportedAdmitted,1);assert.equal(r.serverReportedRejected,1023);assert.equal(r.newServerReportedDurableMembers,1);
});
