import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFile,mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import vm from 'node:vm';
const {executeGoTask}=createRequire(import.meta.url)('./go-tasks.cjs');
function fixture(execute){const listeners=new Set(),task={definition:{runId:'owned',stage:'build'}},operation={cancelled:false};const api={tasks:{onDidEndTaskProcess:fn=>{listeners.add(fn);return{dispose:()=>listeners.delete(fn)};},onDidEndTask:()=>({dispose(){}}),executeTask:execute}};return{task,api,operation,end:code=>{for(const f of listeners)f({execution:{task},exitCode:code});},listeners};}
test('cancel before queued launch never starts a task',async()=>{let calls=0;const f=fixture(()=>{calls++;});const pending=executeGoTask(f.api,f.task,f.operation);f.operation.cancelled=true;assert.equal(await pending,undefined);assert.equal(calls,0);assert.equal(f.listeners.size,0);});
test('missing or rejected execution settles instead of keeping Running',async()=>{for(const execute of [async()=>undefined,async()=>{throw Error('launch failed')}]){const f=fixture(execute);await assert.rejects(executeGoTask(f.api,f.task,f.operation),/execution|launch failed/);assert.equal(f.listeners.size,0);}});
test('late execution after cancellation is terminated and cannot advance before process end',async()=>{let reply,calls=0;const f=fixture(()=>new Promise(r=>reply=r));let settled=false;const pending=executeGoTask(f.api,f.task,f.operation).then(value=>{settled=true;return value;});await Promise.resolve();f.operation.cancelled=true;reply({terminate(){calls++;}});await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(settled,false);f.end(undefined);await pending;assert.equal(f.listeners.size,0);});
test('synchronous terminate failure rejects instead of becoming an unhandled promise',async()=>{const f=fixture(async()=>{f.operation.cancelled=true;return{terminate(){throw Error('termination refused')}};});await assert.rejects(executeGoTask(f.api,f.task,f.operation),/termination refused/);assert.equal(f.operation.cleanupPending,true);assert.equal(f.listeners.size,1);f.end(undefined);assert.equal(f.operation.cleanupPending,false);assert.equal(f.listeners.size,0);});

test('repeated package task enumeration retains unique execution IDs and uses reusable task panels',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-go-panel-')));
 const require=createRequire(import.meta.url),module={exports:{}};
 try {
  for(const directory of ['', 'build','cache','modules','gopath','tmp'])await mkdir(join(root,'.ynx-go',directory),{mode:0o700});
  const toolchain={root:'/fixture/go',executable:'/fixture/go/bin/go'};
  // Toolchain admission has separate tests. Keep it deterministic here while
  // exercising the real task provider, filesystem binding and presentation.
  const source=await readFile(new URL('./go-tasks.cjs',import.meta.url),'utf8');
  vm.runInNewContext(source,{module,exports:module.exports,process,AbortController,Buffer,require:name=>name==='./go-toolchain.cjs'?{verifyToolchain:async()=>toolchain}:require(name)});
  let provider;
  const folder={uri:{scheme:'file',fsPath:root}},config={toolchain,target:'.',mode:'package'};
  class Task {constructor(definition,scope,name,source,execution,matchers){Object.assign(this,{definition,scope,name,source,execution,matchers});}}
  class ProcessExecution {constructor(command,args,options){Object.assign(this,{command,args,options});}}
  const api={workspace:{isTrusted:true,workspaceFolders:[folder],getConfiguration:()=>({inspect:()=>({workspaceFolderValue:config})})},tasks:{registerTaskProvider:(type,value)=>{provider=value;return{dispose(){}};}},Task,ProcessExecution,TaskGroup:{Build:'build'},TaskRevealKind:{Always:1},TaskPanelKind:{Shared:1,Dedicated:2}};
  const workflow=module.exports.createGoTasks(api,{subscriptions:[]},{YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001',YNX_WORKSPACE_MODE:'local'});
  const [first]=await provider.provideTasks(),[retry]=await provider.provideTasks();
  assert.notEqual(first.definition.runId,retry.definition.runId);
  assert.equal(first.presentationOptions.panel,api.TaskPanelKind.Shared);
  assert.equal(retry.presentationOptions.panel,api.TaskPanelKind.Shared);
  assert.equal(first.presentationOptions.clear,true);
  assert.equal(first.execution.command,toolchain.executable);
  assert.equal(first.execution.options.cwd,root);
  assert.equal(first.execution.options.env.GOPROXY,'off');
  assert.equal(first.execution.options.env.GOTOOLCHAIN,'local');
  workflow.dispose();
 } finally {await rm(root,{recursive:true,force:true});}
});
