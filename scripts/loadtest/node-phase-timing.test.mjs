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
