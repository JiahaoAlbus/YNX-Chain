import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertControlledWorkerExit} from './native-owned-inventory-check.mjs';

test('actual worker1 cannot qualify an otherwise successful host differential',()=>{
  const actual=JSON.parse(fs.readFileSync(new URL('./fixtures/native-owned-worker-exit.json',import.meta.url)));
  assert.equal(actual.job.code,1);
  assert.throws(()=>assertControlledWorkerExit(actual.job),/not qualified/);
  assert.equal(actual.job.code,1);
});
test('only observed clean worker termination qualifies',()=>{
  assert.doesNotThrow(()=>assertControlledWorkerExit({exited:true,code:0,signal:null}));
  for(const job of [undefined,{exited:false,code:0,signal:null},{exited:true,code:null,signal:null},{exited:true,code:null,signal:'SIGTERM'},{exited:true,code:1,signal:null}])assert.throws(()=>assertControlledWorkerExit(job));
});
