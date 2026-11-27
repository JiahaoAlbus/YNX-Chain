import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {decodeStoredWorkspaceRecord} from './taskStorageDecode';

test('missing journal is distinct from empty or corrupt stored data',()=>{
 assert.equal(decodeStoredWorkspaceRecord(null),null);
 for(const raw of ['', '{', 'null', '{}'])assert.throws(()=>decodeStoredWorkspaceRecord(raw),/TASK_JOURNAL_INVALID/);
});

test('an original unknown delivery survives decoding',()=>{
 const original={selectedTask:'task-a',runId:'run-a',deliveries:[{id:'original-op',binding:'same-binding',action:'dispatch',taskId:'task-a',state:'UNKNOWN'}]};
 assert.deepEqual(decodeStoredWorkspaceRecord(JSON.stringify(original)),original);
});
