import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeResourceSample} from './native-resource-sample.mjs';
const sample = () => ({rssWithControlReserveBytes:54755328, threadsWithControlReserve:9, processes:[{pid:76461,readable:true,rssBytes:51216384,threads:7}], host:{scanComplete:true}, memoryPressure:{source:'kern.memorystatus_vm_pressure_level',readable:true,dispatchLevel:1,errno:0}, forkProbe:{available:true,forkSucceeded:true,forkErrno:0,waitErrno:0,childExitCode:0,childSignal:0}});

test('retains real fork failure errno instead of a generic monitor failure', () => {
  const s=sample();
  s.forkProbe={available:false,forkSucceeded:false,forkErrno:35,waitErrno:0,childExitCode:-1,childSignal:0};
  assert.throws(()=>validateNativeResourceSample(s,76461),error=>/ordinary fork probe unavailable/.test(error.message)&&/"forkErrno":35/.test(error.message));
  assert.equal(s.forkProbe.forkErrno,35);
});
test('valid kernel sample remains usable without inventing a process limit diagnosis', () => {
  const s=sample();s.host.processCount=4165;s.host.unreadableBsdInfo=2806;
  assert.doesNotThrow(()=>validateNativeResourceSample(s,76461));
});
test('invalid kernel, missing launcher and incomplete enumeration stay fatal', () => {
  for(const mutate of [s=>s.rssWithControlReserveBytes=NaN,s=>s.rssWithControlReserveBytes=-1,s=>s.threadsWithControlReserve=0,s=>s.processes[0].readable=false,s=>s.host.scanComplete=false,s=>delete s.forkProbe]){
    const s=sample();mutate(s);assert.throws(()=>validateNativeResourceSample(s,76461));
  }
});

// Low free-page bytes alone are not a capacity verdict on macOS.
test('normal native pressure admits a valid sample despite low free-page metadata',()=>{const s=sample();s.freePageBytes=109592576;assert.doesNotThrow(()=>validateNativeResourceSample(s,76461))});
test('warning critical missing unknown and unreadable native pressure fail closed',()=>{for(const level of [0,2,3,4,8,-1,undefined]){const s=sample();s.memoryPressure.dispatchLevel=level;assert.throws(()=>validateNativeResourceSample(s,76461),/native memory pressure is not normal/)}const s=sample();s.memoryPressure.readable=false;assert.throws(()=>validateNativeResourceSample(s,76461));delete s.memoryPressure;assert.throws(()=>validateNativeResourceSample(s,76461))});

test('fast samples skip host enumeration/fork only, retaining kernel and pressure gates',()=>{const s=sample();delete s.host;delete s.forkProbe;assert.doesNotThrow(()=>validateNativeResourceSample(s,76461,{full:false}));assert.throws(()=>validateNativeResourceSample(s,76461));s.memoryPressure.dispatchLevel=2;assert.throws(()=>validateNativeResourceSample(s,76461,{full:false}),/native memory pressure/);s.memoryPressure.dispatchLevel=1;s.processes[0].readable=false;assert.throws(()=>validateNativeResourceSample(s,76461,{full:false}),/launcher task info/)});

test('unreadable owned child cannot disappear from the charged sample',()=>{
  const s=sample();s.processes.push({pid:76462,readable:false,errno:3});
  assert.throws(()=>validateNativeResourceSample(s,76461),/owned task info/);
});

test('expected watched identities reject missing duplicate or unexpected rows',()=>{
  const s=sample();
  assert.throws(()=>validateNativeResourceSample(s,76461,{expectedPIDs:[76461,76462]}),/watched identities/);
  s.processes.push({...s.processes[0]});
  assert.throws(()=>validateNativeResourceSample(s,76461,{expectedPIDs:[76461]}),/duplicate/);
  s.processes[1]={pid:76462,readable:true,rssBytes:100,threads:1};
  assert.throws(()=>validateNativeResourceSample(s,76461,{expectedPIDs:[76461]}),/watched identities/);
});

test('only the explicit client13 normal-02 case admits real warning pressure without relabeling',()=>{
 const s=sample();s.memoryPressure.dispatchLevel=2;
 assert.throws(()=>validateNativeResourceSample(s,76461),/native memory pressure/);
 assert.doesNotThrow(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-02'}));
 assert.equal(s.memoryPressure.dispatchLevel,2);
 for(const level of [0,3,4,8,undefined]){const s=sample();s.memoryPressure.dispatchLevel=level;assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-02'}));}
 for(const key of ['host','forkProbe','memoryPressure']){const s=sample();delete s[key];assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-02'}));}
 assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase:'any-other-task'}));
});

test('normal-03 admits only actual warning pressure and preserves default refusal',()=>{
 const s=sample();s.memoryPressure.dispatchLevel=2;
 assert.throws(()=>validateNativeResourceSample(s,76461));
 assert.doesNotThrow(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-03'}));
 assert.equal(s.memoryPressure.dispatchLevel,2);
 for(const level of [0,3,4,8,undefined]){s.memoryPressure.dispatchLevel=level;assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-03'}));}
});

test('normal-04 keeps pressure and identity failures fatal outside the authorized warning case',()=>{
 const s=sample();s.memoryPressure.dispatchLevel=2;
 assert.doesNotThrow(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-04'}));
 for(const level of [0,3,4,8,undefined]){s.memoryPressure.dispatchLevel=level;assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-04'}));}
 s.memoryPressure.dispatchLevel=2;s.processes[0].readable=false;
 assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase:'client13-normal-04'}));
});

test('normal05 and normal06 pressure exception rejects critical unknown and unreadable telemetry',()=>{
 for(const rootCase of ['client13-normal-05','client13-normal-06','client13-normal-07','client13-normal-08','client13-normal-09','client13-normal-10','client13-normal-11','client13-normal-12','client13-normal-13','client13-normal-14','client13-normal-15','client13-normal-16']){
 const s=sample();s.memoryPressure.dispatchLevel=2;
 assert.doesNotThrow(()=>validateNativeResourceSample(s,76461,{rootCase}));
 for(const level of [0,3,4,8,undefined]){s.memoryPressure.dispatchLevel=level;assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase}));}
 s.memoryPressure.dispatchLevel=2;s.memoryPressure.readable=false;
 assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase}));
 }
});

test('offline baseline case alone admits pressure2 and still rejects4 or unknown',()=>{
 const s=sample();s.memoryPressure.dispatchLevel=2;
 assert.throws(()=>validateNativeResourceSample(s,76461));
 assert.doesNotThrow(()=>validateNativeResourceSample(s,76461,{rootCase:'offline-baseline-stopped-01'}));
 for(const level of [4,0,undefined]){s.memoryPressure.dispatchLevel=level;assert.throws(()=>validateNativeResourceSample(s,76461,{rootCase:'offline-baseline-stopped-01'}));}
});
