import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
require('reflect-metadata');
assert.equal(require('@theia/plugin-ext/package.json').version,'1.76.0');
const types=require('@theia/plugin-ext/lib/plugin/types-impl');
const {TasksExtImpl}=require('@theia/plugin-ext/lib/plugin/tasks/tasks');
const {executeGoTask}=require('../../../native/ynx-go/src/go-tasks.cjs');
// Exercise the installed framework event/conversion/handle implementation.
// The PUBLIC RPC peer emits events only; no compiler or process is executed.
test('actual framework start followed by a lost reply retains and terminates only its owned Go task',async()=>{
 let ext;const terminated=[],failure=Error('PUBLIC reply lost after observed start');
 const bridge={$executeTask:async dto=>{
  await ext.$onDidStartTask({id:177,task:dto},177);
  await ext.$onDidStartTask({id:178,task:{...dto,runId:'PUBLIC-foreign'}},178);
  throw failure;
 },$terminateTask:id=>terminated.push(id)};
 ext=new TasksExtImpl({getProxy:()=>bridge},{});
 const task=new types.Task({type:'ynx-go',runId:'PUBLIC-owned',stage:'build'},types.TaskScope.Workspace,'PUBLIC build','YNX Go',new types.ProcessExecution('/PUBLIC/never-executed',[]));
 const operation={cancelled:false};let released=0;operation.onCleanup=()=>released++;
 await assert.rejects(executeGoTask({tasks:ext},task,operation),error=>error===failure);
 assert.equal(ext.taskExecutions.length,2);assert.equal(operation.cleanupPending,true);assert.equal(operation.failure,failure);
 assert.deepEqual(terminated,[177]);operation.execution.terminate();assert.deepEqual(terminated,[177]);
 ext.$onDidEndTask(178);assert.equal(operation.cleanupPending,true);assert.equal(released,0);
 ext.$onDidEndTask(177);assert.equal(operation.cleanupPending,false);assert.equal(operation.execution,undefined);assert.equal(released,1);assert.equal(ext.taskExecutions.length,0);
});
