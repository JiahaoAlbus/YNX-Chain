// Independently recompute public samples and matched scenario comparisons.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [beforeRoot,afterRoot,out]=process.argv.slice(2);
const cases=['slh-c1-sharedfalse','batch-sequential-c1-sharedfalse','batch-existing-pair-c1-sharedfalse','slh-c2-sharedfalse','batch-sequential-c2-sharedfalse','batch-existing-pair-c2-sharedfalse','batch-existing-pair-c2-sharedtrue'];
function check(root,name,candidate){
 const r=JSON.parse(readFileSync(join(root,name+'.json'),'utf8'));
 const n=r.callers*r.samples_per_caller;
 assert.equal(r.samples.length,n);assert.equal(r.verified,n);
 assert(r.tamper_rejected&&r.destroy_rejects);
 assert.equal(r.provider_stats.InFlight,0);
 assert.equal(r.goroutines_before,r.goroutines_after_join);
 assert.equal(r.gomaxprocs,2);assert.equal(r.go,'go1.26.10');
 const ids=new Set();const perCaller=Array.from({length:r.callers},()=>[]);
 for(const sample of r.samples){
  assert(Number.isSafeInteger(sample.nanoseconds)&&sample.nanoseconds>0);
  assert(sample.caller>=0&&sample.caller<r.callers&&sample.sequence>=0&&sample.sequence<r.samples_per_caller);
  const id=sample.caller+':'+sample.sequence;assert(!ids.has(id));ids.add(id);
  perCaller[sample.caller].push(sample.nanoseconds);
 }
 const ns=r.samples.map(s=>s.nanoseconds).sort((a,b)=>a-b);
 const quant=(sorted,p)=>sorted[Math.floor((p*sorted.length+99)/100)-1];
 for(const p of [50,95,99])assert.equal(quant(ns,p),r['p'+p+'_ns']);
 assert(Math.abs(n*1e9/r.wall_ns-r.operations_per_second)<1e-9);
 if(candidate){
  assert(r.provider.includes('experimental scheduled fork'));
  const s=r.experimental_scheduling;
  assert.equal(s.Capacity,1);assert.equal(s.Requests,0);assert.equal(s.Workers,0);assert(s.PeakWorkers<=1);
 }
 return {n,p50_ms:r.p50_ns/1e6,p95_ms:r.p95_ns/1e6,p99_ms:r.p99_ns/1e6,ops_s:r.operations_per_second,cpu_cores:r.cpu_cores_used,allocated_bytes_per_op:r.total_alloc_bytes/n,mallocs_per_op:r.mallocs/n,caller_p95_ms:perCaller.map(v=>quant(v.sort((a,b)=>a-b),95)/1e6),experimental_scheduling:r.experimental_scheduling??null};
}
let totalBefore=0,totalAfter=0;
const rows=cases.map(name=>{
 const before=check(beforeRoot,name,false),after=check(afterRoot,name,true);
 totalBefore+=before.n;totalAfter+=after.n;assert.equal(before.n,after.n);
 const row={case:name,before,after,p95_change_percent:100*(after.p95_ms/before.p95_ms-1),p99_change_percent:100*(after.p99_ms/before.p99_ms-1),throughput_change_percent:100*(after.ops_s/before.ops_s-1)};
 console.log(`${name} N=${after.n} P95 ${before.p95_ms.toFixed(3)} -> ${after.p95_ms.toFixed(3)}ms P99 ${before.p99_ms.toFixed(3)} -> ${after.p99_ms.toFixed(3)}ms ops/s ${before.ops_s.toFixed(3)} -> ${after.ops_s.toFixed(3)} CPU ${before.cpu_cores.toFixed(3)} -> ${after.cpu_cores.toFixed(3)} allocB/op ${before.allocated_bytes_per_op.toFixed(0)} -> ${after.allocated_bytes_per_op.toFixed(0)}`);
 return row;
});
assert.equal(totalBefore,11000);assert.equal(totalAfter,11000);
writeFileSync(out,JSON.stringify({method:'independent integer nearest-rank from actual raw samples; descriptive separate profiled desktop runs; no confidence interval',beforeRoot,afterRoot,totalBefore,totalAfter,rows},null,2)+'\n',{mode:0o600});
