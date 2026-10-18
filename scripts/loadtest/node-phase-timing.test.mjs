import test from 'node:test';
import assert from 'node:assert/strict';
import {readNodePhaseTiming} from './node-phase-timing.mjs';
function fixture(){const stages=Object.fromEntries(['check_tx','prepare_proposal','process_proposal','finalize_block','commit'].map(name=>[name,{calls:1,failedResponses:0,elapsedNs:1,durationBuckets:[0,1,...Array(62).fill(0)]}]));return [{schema:1,sequence:1,reason:'commit',windowElapsedNs:5,valid:true,capped:false,inFlight:0,stages,commit:{height:2,storage:'block-journal-v2',durable:true,elapsedNs:1,payloadBytes:10,stagesNs:{validate:0,delta_encode:0,file_sync:1}}},{schema:1,sequence:2,reason:'shutdown',windowElapsedNs:6,valid:true,capped:false,inFlight:0,stages:structuredClone(stages),commit:null}]}
const log=rows=>rows.map(row=>'YNX_ABCI_PHASE_TIMING '+JSON.stringify(row)).join('\n')+'\n';
test('synthetic node timing decoder preserves stage totals without manufacturing business metrics',()=>{const actual=readNodePhaseTiming(log(fixture()));assert.equal(actual.commitAttempts,1);assert.equal(actual.commitTotalsNs.file_sync,1);assert.equal(actual.stages.check_tx.calls,1);assert.equal('businessTPS'in actual,false)});
test('node timing decoder rejects incomplete failed capped regressed and stale evidence',()=>{
 for(const mutate of [r=>r.pop(),r=>r[0].commit.durable=false,r=>r[0].valid=false,r=>r[1].capped=true,r=>r[1].sequence++,r=>r[1].inFlight=1,r=>r[1].stages.check_tx.calls=0,r=>r[1].stages.check_tx.durationBuckets[1]++,r=>r[0].commit.stagesNs={},r=>r[1].commit=r[0].commit,r=>delete r[1].stages.check_tx]){const rows=fixture();mutate(rows);assert.throws(()=>readNodePhaseTiming(log(rows)))}
 assert.throws(()=>readNodePhaseTiming('no records'));assert.throws(()=>readNodePhaseTiming('x'.repeat(1024*1024+1)));
});

test('non-proposing validator retains true zero prepare calls',()=>{const rows=fixture();for(const row of rows)row.stages.prepare_proposal={calls:0,failedResponses:0,elapsedNs:0,durationBuckets:Array(64).fill(0)};assert.equal(readNodePhaseTiming(log(rows)).stages.prepare_proposal.calls,0)});

test('validation children survive aggregation separately from original Commit stages',()=>{
 const rows=fixture();rows[0].commit.stagesNs.validate=12;
 rows[0].commit.validationStagesNs={semantics:3,app_hash:7};
 const actual=readNodePhaseTiming(log(rows));
 assert.deepEqual(actual.validationTotalsNs,{semantics:3,app_hash:7});
 assert.equal(actual.validationCommitSamples,1);
 assert.equal(actual.commitTotalsNs.validate,12);
 assert.equal('semantics' in actual.commitTotalsNs,false);
 assert.equal('validationTotalsNs' in readNodePhaseTiming(log(fixture())),false);
});

test('validation child decoder refuses malformed partial mixed or double-counted measurements',()=>{
 for(const value of [null,[],{}, {semantics:1}, {semantics:1,app_hash:1,extra:0}, {semantics:-1,app_hash:1}, {semantics:1.5,app_hash:1}, {semantics:2,app_hash:2}]){
  const rows=fixture();rows[0].commit.stagesNs.validate=3;rows[0].commit.validationStagesNs=value;
  assert.throws(()=>readNodePhaseTiming(log(rows)),/validation/);
 }
 const rows=fixture();rows[0].commit.validationStagesNs={semantics:0,app_hash:0};
 const second=structuredClone(rows[0]);delete second.commit.validationStagesNs;second.sequence=2;second.commit.height=3;
 second.stages.commit.calls=2;second.stages.commit.durationBuckets[1]=2;
 rows.splice(1,0,second);rows[2].sequence=3;rows[2].stages=structuredClone(second.stages);
 assert.throws(()=>readNodePhaseTiming(log(rows)),/validation/);
});
