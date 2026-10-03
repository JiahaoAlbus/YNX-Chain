import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeMomentReportIntents, type MomentReportDraft } from './nativeMomentReportIntents';
const account = 'ynx1' + 'a'.repeat(38);
const draft: MomentReportDraft = { targetType: 'moment', targetId: 'original-moment', category: 'other', detail: 'Explicit report', evidenceHashes: ['a'.repeat(64)] };
function fixture() {
  const rows = new Map<string,string>(); let nonces=0;
  const storage={read:async(key:string)=>rows.get(key)??null,write:async(key:string,value:string)=>{rows.set(key,value);}};
  return { rows, storage, open:()=>new NativeMomentReportIntents(async()=> (++nonces).toString(16).padStart(32,'0'),storage), nonces:()=>nonces };
}
test('cold unknown report retains exact original payload and nonce',async()=>{
  const f=fixture(); let original='';
  await assert.rejects(f.open().run(account,draft,()=>true,async body=>{original=JSON.stringify(body);throw new Error('unknown');}));
  const receipt={record:{id:'report-original'}};
  assert.equal(await f.open().run(account,draft,()=>true,async body=>{assert.equal(JSON.stringify(body),original);return receipt;}),receipt);
  assert.equal(f.nonces(),1);
});
test('changed pending evidence cannot replace original report',async()=>{
  const f=fixture(); await assert.rejects(f.open().run(account,draft,()=>true,async()=>{throw new Error('unknown');}));
  let sends=0;
  await assert.rejects(f.open().run(account,{...draft,evidenceHashes:['b'.repeat(64)]},()=>true,async()=>{sends++;return {record:{id:'wrong'}};}),/original pending/);
  assert.equal(sends,0); assert.equal(f.nonces(),1);
});
test('storage failure before dispatch sends nothing',async()=>{
  let sends=0;
  const runner=new NativeMomentReportIntents(async()=> '1'.repeat(32),{read:async()=>null,write:async()=>{throw new Error('locked');}});
  await assert.rejects(runner.run(account,draft,()=>true,async()=>{sends++;return {record:{id:'wrong'}};}),/locked/);
  assert.equal(sends,0);
});
test('lost authority after response retains unresolved original',async()=>{
  const f=fixture(); let live=true;
  assert.equal(await f.open().run(account,draft,()=>live,async()=>{live=false;return {record:{id:'original'}};}),undefined);
  const raw=[...f.rows.values()][0]; assert.ok(raw); assert.equal(JSON.parse(raw).completed,false);
});
test('completed identical report reuses original key and rejects changed result',async()=>{
  const f=fixture(); let original='';
  await f.open().run(account,draft,()=>true,async body=>{original=body.idempotencyKey;return {record:{id:'original'}};});
  await assert.rejects(f.open().run(account,draft,()=>true,async body=>{assert.equal(body.idempotencyKey,original);return {record:{id:'substituted'}};}),/result changed/);
  assert.equal(f.nonces(),1);
});
test('malformed retained report is never overwritten or sent',async()=>{
  const f=fixture();await f.open().run(account,draft,()=>true,async()=>({record:{id:'original'}}));
  const key=[...f.rows.keys()][0];assert.ok(key);f.rows.set(key,'{broken');let sends=0;
  await assert.rejects(f.open().run(account,draft,()=>true,async()=>{sends++;return {record:{id:'wrong'}};}),/requires recovery/);
  assert.equal(sends,0);assert.equal(f.rows.get(key),'{broken');
});
