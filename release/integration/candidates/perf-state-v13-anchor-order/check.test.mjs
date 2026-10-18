import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCandidate,loadCandidate,SOURCE_COMMIT,INTERNAL_TREE} from './check.mjs';
const original=loadCandidate();
test('exact new source preserves inherited semantics and explicit qualification boundaries',()=>{
 const result=validateCandidate();
 assert.equal(result.sourceCommit,SOURCE_COMMIT);
 assert.equal(result.internalTree,INTERNAL_TREE);
 assert.equal(result.currentSourceFilesMatched,35);
 assert.equal(result.parentOriginalSourceValidated,'2b5c51d3baca54a88510bb9d461807f957063249');
 assert.equal(result.normalMatchingCIVerified,false);
 assert.equal(result.deployed,false);
 assert.equal(result.businessTPS,null);
});
for(const [name,mutate] of [
 ['wrong source commit',d=>{d.contract.sourceCommit='0'.repeat(40)}],
 ['wrong internal tree',d=>{d.contract.internalTree='0'.repeat(40)}],
 ['old parent promoted to current',d=>{d.contract.sourceCommit=d.contract.parentFixedSource}],
 ['measured runtime rebound',d=>{d.contract.measuredRuntimeCommit=SOURCE_COMMIT}],
 ['skip complete semantic qualification',d=>{d.contract.fullGoSourcePassed=false}],
 ['claim normal CI green',d=>{d.contract.normalMatchingCIVerified=true}],
 ['claim deployment',d=>{d.contract.deployed=true}],
 ['claim node cutover',d=>{d.contract.nodeCutover=true}],
 ['infer business TPS from validation time',d=>{d.contract.businessTPS=1000}],
 ['infer network finality',d=>{d.contract.networkFinalityMeasured=true}],
 ['hide failed old gate',d=>{d.contract.evidenceWholeRunConclusion='success'}],
 ['alter frozen Supply source',d=>{d.contract.originalSupplyCandidateUnchanged.sourceCommit=SOURCE_COMMIT}],
 ['omit new regression source',d=>{delete d.map.files['internal/consensus/state_anchor_cost_test.go']}],
 ['forge source hash',d=>{d.map.files['internal/consensus/state.go'].sha256='0'.repeat(64)}],
 ['forge source size',d=>{d.map.files['internal/consensus/state.go'].bytes++}],
 ['backfill old map',d=>{d.map.sourceCommit=d.map.parentFixedSource}],
 ['omit complete internal map identity',d=>{delete d.map.internalTree}],
 ['invent mapped input',d=>{d.map.files['internal/consensus/not-real.go']={bytes:0,sha256:'0'.repeat(64)}}],
 ['hide benchmark allocation cost',d=>{d.evidence.medians.records_first.bytesPerOp=0}],
 ['rewrite old cost',d=>{d.evidence.medians.legacy_anchor_first.nsPerOp=99999999}],
 ['drop slow sample',d=>{d.evidence.samples.records_first.pop()}],
 ['replace real fixture hash',d=>{d.evidence.fixtureSHA256='0'.repeat(64)}],
 ['replace matching migration',d=>{d.evidence.migrationSHA256='0'.repeat(64)}],
 ['change measurement settings',d=>{d.evidence.gomaxprocs=4}],
 ['hide whole CI failure',d=>{d.evidence.runConclusion='success'}],
 ['claim network result',d=>{d.evidence.networkFinality={p95:1}}],
 ['claim pipeline TPS',d=>{d.evidence.businessTPS=1000}],
 ['substitute raw evidence',d=>{d.evidence.rawLogSHA256='0'.repeat(64)}],
])test('reject '+name,()=>{
 const documents=structuredClone(original);mutate(documents);
 assert.throws(()=>validateCandidate({documents}),/anchor qualification|source inventory|validation evidence/);
});
