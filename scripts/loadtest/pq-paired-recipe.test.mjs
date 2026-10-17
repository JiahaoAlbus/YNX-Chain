import test from 'node:test';
import assert from 'node:assert/strict';
import {pqPairedRecipe} from './pq-paired-recipe.mjs';
const args=()=>({sourceRoot:'/candidate',commit:'a'.repeat(40),head:'a'.repeat(40),dirty:'',baseAncestor:true,successFixture:'func pqBatchSuccessDiskSnapshot(t *testing.T,d *Devnet) {}',overlaySource:'/owner/bench.go.in',outputDir:'/evidence/new-case',n:64,trial:1});
test('one exact-source overlay case preserves checkout and is not execution authority',()=>{
  const p=pqPairedRecipe(args());assert.equal(p.executionAuthorized,false);assert.equal(p.overlay.Replace['/candidate/internal/chain/pq_paired_performance_test.go'],'/evidence/new-case/pq_paired_performance_test.go.in');assert.equal(p.environment.YNX_PQ_PAIR_N,'64');assert.equal(p.proposedBudget.privateDataBytes,33554432);assert.ok(p.command.includes('^TestPQPairedPersistentPerformance$'));
});
test('dirty drift missing frozen fixture and unrelated production base refuse preparation',()=>{
  for(const mutate of [a=>a.head='b'.repeat(40),a=>a.dirty='?? pq_batch_success_test.go',a=>a.successFixture='',a=>a.baseAncestor=false,a=>a.commit='aa97f102',a=>a.targetExists=true]){const a=args();mutate(a);assert.throws(()=>pqPairedRecipe(a));}
});
test('larger cases unsupported repetitions and relative paths are not silently admitted',()=>{
  for(const mutate of [a=>a.n=1024,a=>a.n=16.5,a=>a.trial=0,a=>a.trial=4,a=>a.sourceRoot='candidate',a=>a.outputDir='existing',a=>a.overlaySource='bench.go.in']){const a=args();mutate(a);assert.throws(()=>pqPairedRecipe(a));}
});
