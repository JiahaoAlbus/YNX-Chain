import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeResourceSample} from './native-resource-sample.mjs';
const sample = () => ({rssWithControlReserveBytes:54755328, threadsWithControlReserve:9, processes:[{pid:76461,readable:true}], host:{scanComplete:true}, forkProbe:{available:true,forkSucceeded:true,forkErrno:0,waitErrno:0,childExitCode:0,childSignal:0}});

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
