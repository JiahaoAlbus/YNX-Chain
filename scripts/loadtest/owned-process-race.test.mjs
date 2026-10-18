import test from 'node:test';import assert from 'node:assert/strict';
import {ownedBirthInventory,verifyExitedDuringSample} from './owned-process-race.mjs';
const birth='Sun Oct 18 10:00:00 2026';
const inventory=(extra='')=>ownedBirthInventory(`10 1 10 ${birth}\n20 10 20 ${birth}\n${extra}`,10,20);
const before=()=>inventory(`21 20 20 ${birth}`);
const raw=()=>({processes:[{pid:10,readable:true},{pid:20,readable:true},{pid:21,readable:false,errno:3}]});
test('exact child exit race requires original birth/group, fresh absence and kernel ESRCH',()=>{
 const events=verifyExitedDuringSample(raw(),before(),inventory(),10,20,p=>p===21);
 assert.deepEqual(events,[{pid:21,parent:20,group:20,birth,errno:3,exitedDuringSample:true}]);
 assert.throws(()=>verifyExitedDuringSample(raw(),before(),inventory(),10,20,()=>false));
});
test('PID reuse, unknown inventory, other errno and missing roots remain fatal',()=>{
 assert.throws(()=>verifyExitedDuringSample(raw(),before(),inventory(`21 1 99 Sun Oct 18 10:01:00 2026`),10,20,()=>true));
 const bad=raw();bad.processes[2].errno=1;assert.throws(()=>verifyExitedDuringSample(bad,before(),inventory(),10,20,()=>true));
 const root=raw();root.processes[2].pid=20;assert.throws(()=>verifyExitedDuringSample(root,before(),inventory(),10,20,()=>true));
 const after=inventory();after.identities.get(20).birth='Sun Oct 18 10:02:00 2026';assert.throws(()=>verifyExitedDuringSample(raw(),before(),after,10,20,()=>true));
 assert.throws(()=>ownedBirthInventory('unknown',10,20));
 assert.throws(()=>inventory(`21 20 20 ${birth}\n21 20 20 ${birth}`));
});

test('a readable sibling can exit after the kernel query while the ESRCH child is reconciled',()=>{
 const prior=inventory(`21 20 20 ${birth}\n22 20 20 ${birth}`);
 const sample=raw();sample.processes.push({pid:22,readable:true,rssBytes:123,threads:1});
 const checked=[];
 const events=verifyExitedDuringSample(sample,prior,inventory(),10,20,p=>{checked.push(p);return true;});
 assert.deepEqual(events.map(r=>r.pid),[21,22]);
 assert.deepEqual(checked,[21,22]);
 assert.equal(sample.processes[3].rssBytes,123);
 assert.throws(()=>verifyExitedDuringSample(sample,prior,inventory(),10,20,p=>p===21));
});
