import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeMomentReportIntents, type MomentReportDraft } from './nativeMomentReportIntents';
const account='ynx1'+'a'.repeat(38), other='ynx1'+'b'.repeat(38);
const draft:MomentReportDraft={targetType:'moment',targetId:'original',category:'spam',detail:'Original explicitly confirmed report',evidenceHashes:['a'.repeat(64)]};
function fixture(){const rows=new Map<string,string>();let sends=0;const storage={read:async(key:string)=>rows.get(key)??null,write:async(key:string,value:string)=>{rows.set(key,value);}};return{rows,storage,open:()=>new NativeMomentReportIntents(async()=> '1'.repeat(32),storage),send:async()=>{sends++;throw new Error('unknown');},sends:()=>sends};}
test('cold review reveals original draft without sending or rewriting',async()=>{
  const f=fixture();await assert.rejects(f.open().run(account,draft,()=>true,f.send));
  const before=JSON.stringify([...f.rows]);
  const review=await f.open().reviewOriginal(account,draft.targetId,()=>true);
  assert.deepEqual(review?.draft,draft);assert.equal(review?.completed,false);
  assert.equal(f.sends(),1);assert.equal(JSON.stringify([...f.rows]),before);
  assert.ok(Object.isFrozen(review?.draft.evidenceHashes));
});
test('another account or target cannot review the original draft',async()=>{
  const f=fixture();await assert.rejects(f.open().run(account,draft,()=>true,f.send));
  assert.equal(await f.open().reviewOriginal(other,draft.targetId,()=>true),undefined);
  assert.equal(await f.open().reviewOriginal(account,'different-target',()=>true),undefined);
  assert.equal(f.sends(),1);
});
test('stale before review has zero private storage reads',async()=>{
  let reads=0;const runner=new NativeMomentReportIntents(async()=> '1'.repeat(32),{read:async()=>{reads++;return null;},write:async()=>{}});
  assert.equal(await runner.reviewOriginal(account,draft.targetId,()=>false),undefined);assert.equal(reads,0);
});
test('authority lost during storage read does not expose original draft',async()=>{
  const f=fixture();await assert.rejects(f.open().run(account,draft,()=>true,f.send));
  let live=true;const runner=new NativeMomentReportIntents(async()=> '1'.repeat(32),{...f.storage,read:async key=>{const raw=await f.storage.read(key);live=false;return raw;}});
  assert.equal(await runner.reviewOriginal(account,draft.targetId,()=>live),undefined);assert.equal(f.sends(),1);
});
