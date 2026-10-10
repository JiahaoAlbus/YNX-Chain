import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,mkdir,realpath,rm,chmod} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import vm from 'node:vm';
const {executeGoTask}=createRequire(import.meta.url)('./go-tasks.cjs');
const {selectNativeGoToolchain}=createRequire(import.meta.url)('../../../runtime/ynx-workbench/lib/native-workbench-commands.js');
function fixture(execute){const listeners=new Set(),task={definition:{runId:'owned',stage:'build'}},operation={cancelled:false};const api={tasks:{onDidEndTaskProcess:fn=>{listeners.add(fn);return{dispose:()=>listeners.delete(fn)};},onDidEndTask:()=>({dispose(){}}),executeTask:execute}};return{task,api,operation,end:code=>{for(const f of listeners)f({execution:{task},exitCode:code});},listeners};}
test('first-use Go uses native admission without granting or launching in the old sandbox',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-go-native-first-use-')));
 try {
  const {createGoTasks}=createRequire(import.meta.url)('./go-tasks.cjs');
  let selections=0,launches=0,writes=0;
  const api={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:root}}],getConfiguration:()=>({inspect:()=>({}),update:()=>{writes++;}})},
   CancellationTokenSource:class{token={};cancel(){}dispose(){}},
   commands:{executeCommand:async id=>{assert.equal(id,'ynx.workbench.selectGoToolchain');selections++;return selectNativeGoToolchain({ynxDesktopGo:{selectToolchain:async()=>({effective:'after-reopen',version:'go version go1.25.7 darwin/arm64'})}});}},
   tasks:{registerTaskProvider:()=>({dispose(){}}),executeTask:()=>{launches++;}}};
  const environment={YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001',YNX_WORKSPACE_MODE:'local'};
  const workflow=createGoTasks(api,{subscriptions:[]},environment);
  await workflow.run();assert.equal(selections,1);assert.equal(launches,0);assert.equal(writes,0);assert.equal(environment.YNX_IDE_GO_ROOT,undefined);assert.deepEqual(workflow.status(),{running:false,configuring:false});
  api.workspace.isTrusted=false;await assert.rejects(workflow.run(),/trusted/);assert.equal(selections,1);
  api.workspace.isTrusted=true;environment.YNX_IDE_GO_ROOT='/partial-unverified';await assert.rejects(workflow.run(),/verified Go toolchain/);assert.equal(selections,1);
  delete environment.YNX_IDE_GO_ROOT;
  let reply;api.commands.executeCommand=()=>new Promise(resolve=>reply=resolve);
  const pending=workflow.run();while(!reply)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(workflow.cancel(),true);await pending;reply({effective:'after-reopen',version:'late'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(launches,0);assert.equal(writes,0);assert.deepEqual(workflow.status(),{running:false,configuring:false});workflow.dispose();
 } finally {await rm(root,{recursive:true,force:true});}
});

async function requestFixture() {
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-go-request-'))),require=createRequire(import.meta.url),module={exports:{}};
 const toolchain={root:'/fixture/go',executable:'/fixture/go/bin/go'},helpers=require('./go-toolchain.cjs');
 vm.runInNewContext(await readFile(new URL('./go-tasks.cjs',import.meta.url),'utf8'),{module,exports:module.exports,process,AbortController,Buffer,require:name=>name==='./go-toolchain.cjs'?{...helpers,admittedToolchain:async()=>toolchain,verifyToolchain:async()=>toolchain}:require(name)});
 const file=join(root,'hello.go');await writeFile(file,'package main; func main() {}');
 const document={uri:{scheme:'file',fsPath:file}},folder={uri:{scheme:'file',fsPath:root}},listeners=new Set(),editorListeners=new Set();
 let saved,picks=0,notices=0,workflow;
 const executions=[],hooks={buildExit:0};
 class Task {constructor(definition,scope,name,source,execution,matchers){Object.assign(this,{definition,scope,name,source,execution,matchers});}}
 class ProcessExecution {constructor(command,args,options){Object.assign(this,{command,args,options});}}
 const api={workspace:{isTrusted:true,workspaceFolders:[folder],textDocuments:[],getConfiguration:()=>({inspect:()=>({workspaceFolderValue:saved}),update:async(key,value)=>{saved=value;await hooks.update?.();}})},
  window:{activeTextEditor:{document},onDidChangeActiveTextEditor:fn=>{editorListeners.add(fn);return{dispose:()=>editorListeners.delete(fn)};},showQuickPick:async items=>{picks++;return hooks.pick?hooks.pick(items):items[0];},showInformationMessage:()=>{notices++;hooks.notice?.();return new Promise(()=>{});}},
  CancellationTokenSource:class {token={};cancel(){}dispose(){}},ConfigurationTarget:{WorkspaceFolder:3},Task,ProcessExecution,TaskGroup:{Build:'build'},TaskRevealKind:{Always:1},TaskPanelKind:{Shared:1},
  tasks:{registerTaskProvider:()=>({dispose(){}}),onDidEndTaskProcess:fn=>{listeners.add(fn);return{dispose:()=>listeners.delete(fn)};},onDidEndTask:()=>({dispose(){}}),executeTask:async task=>{
   executions.push(task.definition.stage);const execution={task,terminate(){}};
   if(task.definition.stage==='build' && hooks.buildExit===0){const output=task.execution.args[task.execution.args.indexOf('-o')+1];await writeFile(output,Buffer.from('cffaedfe','hex'));await chmod(output,0o700);}
   setImmediate(()=>{for(const fn of listeners)fn({execution,exitCode:task.definition.stage==='build'?hooks.buildExit:0});});return execution;
  }} };
 const environment={YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001',YNX_WORKSPACE_MODE:'local'};
 const open=()=>workflow=module.exports.createGoTasks(api,{subscriptions:[]},environment);open();
 return {api,hooks,executions,get workflow(){return workflow;},open,counts:()=>({picks,notices}),switchEditor(value){api.window.activeTextEditor=value?{document:value}:undefined;for(const fn of editorListeners)fn(api.window.activeTextEditor);},document,async close(){workflow.dispose();await rm(root,{recursive:true,force:true});}};
}

test('one original Run continues once with notice open, then reuses persisted configuration after reopen',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  assert.equal((await f.workflow.run()).exitCode,0);assert.deepEqual(f.executions,['build','run']);assert.deepEqual(f.counts(),{picks:1,notices:1});
  await f.workflow.run();assert.deepEqual(f.executions,['build','run','build','run']);assert.equal(f.counts().picks,1);
  f.workflow.dispose();f.open();await f.workflow.run();assert.equal(f.counts().picks,1);assert.equal(f.executions.length,6);
 }finally{await f.close();}
});

test('configuration picker cancellation and cancellation at completion never execute the original request',{timeout:2000},async()=>{
 for(const stage of ['picker','completion']){const f=await requestFixture();try {
  if(stage==='picker')f.hooks.pick=async()=>undefined;else f.hooks.notice=()=>f.workflow.cancel();
  await f.workflow.run();assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);assert.equal(f.workflow.status().configuring,false);
  delete f.hooks.pick;delete f.hooks.notice;await f.workflow.run();assert.deepEqual(f.executions,['build','run']);
 }finally{await f.close();}}
});

test('switching file away and back while saving configuration invalidates the original Run',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  f.hooks.update=()=>{f.switchEditor({uri:{scheme:'file',fsPath:f.document.uri.fsPath+'-other.go'}});f.switchEditor(f.document);};
  await f.workflow.run();assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
  delete f.hooks.update;await f.workflow.run();assert.deepEqual(f.executions,['build','run']);
 }finally{await f.close();}
});

test('lost project permission after configuration save refuses continuation; retry remains possible',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  f.hooks.update=()=>{f.api.workspace.isTrusted=false;};await assert.rejects(f.workflow.run(),/changed/);assert.deepEqual(f.executions,[]);
  f.api.workspace.isTrusted=true;delete f.hooks.update;await f.workflow.run();assert.deepEqual(f.executions,['build','run']);
 }finally{await f.close();}
});

test('concurrent Run during first configuration cannot take ownership or cause duplicate execution',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  let release;f.hooks.pick=items=>new Promise(resolve=>{release=()=>resolve(items[0]);});const pending=f.workflow.run();
  while(!release)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.workflow.run(),/already running/);release();await pending;
  assert.deepEqual(f.executions,['build','run']);
 }finally{await f.close();}
});

test('compiler failure ends the owned request and permits retry without repeating configuration',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  f.hooks.buildExit=1;await assert.rejects(f.workflow.run(),/Go build failed/);assert.equal(f.workflow.status().running,false);
  f.hooks.buildExit=0;await f.workflow.run();assert.deepEqual(f.executions,['build','build','run']);assert.equal(f.counts().picks,1);
 }finally{await f.close();}
});

test('configuration save failure or workspace replacement cannot launch a task',{timeout:2000},async()=>{
 for(const reason of ['save','workspace']){const f=await requestFixture();try {
  const original=f.api.workspace.workspaceFolders;
  f.hooks.update=()=>{if(reason==='save')throw Error('settings save failed');f.api.workspace.workspaceFolders=[{uri:original[0].uri}];};
  await assert.rejects(f.workflow.run(),reason==='save'?/settings save failed/:/changed/);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
  f.api.workspace.workspaceFolders=original;delete f.hooks.update;await f.workflow.run();assert.deepEqual(f.executions,['build','run']);
 }finally{await f.close();}}
});
test('native Go selection rejects absent bridge, supplied paths and unverified responses',async()=>{
 let calls=0;const target={ynxDesktopGo:{selectToolchain:async()=>{calls++;return{};}}};
 await assert.rejects(selectNativeGoToolchain({}),/native YNX/);
 await assert.rejects(selectNativeGoToolchain(target,'/supplied/path'),/no supplied paths/);assert.equal(calls,0);
 await assert.rejects(selectNativeGoToolchain(target),/verified selection/);assert.equal(calls,1);
});
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

test('first Go run proceeds while its informational notification stays open or rejects',{timeout:2000},async()=>{
 for(const notification of [()=>new Promise(()=>{}),()=>Promise.reject(Error('notification unavailable'))]) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-go-first-run-')));
  const require=createRequire(import.meta.url),module={exports:{}};
  try {
   const toolchain={root:'/fixture/go',executable:'/fixture/go/bin/go'};
   const helpers=require('./go-toolchain.cjs');
   const source=await readFile(new URL('./go-tasks.cjs',import.meta.url),'utf8');
   vm.runInNewContext(source,{module,exports:module.exports,process,AbortController,Buffer,require:name=>name==='./go-toolchain.cjs'?{...helpers,admittedToolchain:async()=>toolchain,verifyToolchain:async()=>toolchain}:require(name)});
   const file=join(root,'hello.go');await writeFile(file,'package main; func main() {}');
   const folder={uri:{scheme:'file',fsPath:root}},listeners=new Set();let saved,launches=0,notices=0;
   class Task {constructor(definition,scope,name,source,execution,matchers){Object.assign(this,{definition,scope,name,source,execution,matchers});}}
   class ProcessExecution {constructor(command,args,options){Object.assign(this,{command,args,options});}}
   const api={
    workspace:{isTrusted:true,workspaceFolders:[folder],textDocuments:[],getConfiguration:()=>({inspect:()=>({workspaceFolderValue:saved}),update:async(key,value)=>{saved=value;}})},
    window:{activeTextEditor:{document:{uri:{scheme:'file',fsPath:file}}},showQuickPick:async items=>items[0],showInformationMessage:()=>{notices++;return notification();}},
    CancellationTokenSource:class {token={};cancel(){}dispose(){}},ConfigurationTarget:{WorkspaceFolder:3},
    tasks:{registerTaskProvider:()=>({dispose(){}}),onDidEndTaskProcess:fn=>{listeners.add(fn);return{dispose:()=>listeners.delete(fn)};},onDidEndTask:()=>({dispose(){}}),executeTask:async task=>{launches++;const execution={task,terminate(){}};setImmediate(()=>{for(const fn of listeners)fn({execution,exitCode:1});});return execution;}},
    Task,ProcessExecution,TaskGroup:{Build:'build'},TaskRevealKind:{Always:1},TaskPanelKind:{Shared:1,Dedicated:2}
   };
   const workflow=module.exports.createGoTasks(api,{subscriptions:[]},{YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001',YNX_WORKSPACE_MODE:'local'});
   // A deliberate compiler failure proves the real first-run continuation
   // reaches task execution, settles and can retry without closing the toast.
   await assert.rejects(workflow.run(),/Go build failed/);
   assert.equal(notices,1);assert.equal(launches,1);
   assert.equal(workflow.status().configuring,false);assert.equal(workflow.status().running,false);
   await assert.rejects(workflow.run(),/Go build failed/);
   assert.equal(notices,1);assert.equal(launches,2);assert.equal(listeners.size,0);
   workflow.dispose();
  } finally {await rm(root,{recursive:true,force:true});}
 }
});
