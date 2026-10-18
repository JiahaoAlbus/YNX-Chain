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
test('native Go picker cancellation crosses command RPC as a normal result, permitting retry without launch',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-go-native-cancel-')));
 try {
  const {createGoTasks}=createRequire(import.meta.url)('./go-tasks.cjs');let selections=0,launches=0,writes=0;
  const api={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:root}}],getConfiguration:()=>({inspect:()=>({}),update:()=>{writes++;}})},
   CancellationTokenSource:class{token={};cancel(){}dispose(){}},
   commands:{executeCommand:async()=>JSON.parse(JSON.stringify(await selectNativeGoToolchain({ynxDesktopGo:{selectToolchain:async()=>{selections++;throw Object.assign(Error('Go toolchain selection cancelled.'),{cancelled:true});}}})))},
   tasks:{registerTaskProvider:()=>({dispose(){}}),executeTask:()=>{launches++;}}};
  const workflow=createGoTasks(api,{subscriptions:[]},{YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001',YNX_WORKSPACE_MODE:'local'});
  try {await workflow.run();await workflow.run();assert.equal(selections,2);assert.equal(launches,0);assert.equal(writes,0);assert.deepEqual(workflow.status(),{running:false,configuring:false});}
  finally{workflow.dispose();}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('native Go selection preserves real errors instead of interpreting their text as cancellation',async()=>{
 const failure=Error('Go toolchain selection cancelled.');
 await assert.rejects(selectNativeGoToolchain({ynxDesktopGo:{selectToolchain:async()=>{throw failure;}}}),error=>error===failure);
});
test('actual injected native Go bridge cancellation becomes a serializable result, then selects on retry',async()=>{
 const source=await readFile(new URL('../../../desktop/macos/main.m',import.meta.url),'utf8');
 const injected=source.match(/NSString \*goScript=@"(.*)";/)[1];const posted=[];let sequence=0;
 const target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>posted.push(value)}}}};
 vm.runInNewContext(injected,{window:target,location:{pathname:'/'},crypto:{randomUUID:()=>String(++sequence)},addEventListener(){}});
 const first=selectNativeGoToolchain(target);
 target.__ynxNativeGoReply({id:posted[0].requestId,status:'cancelled',error:'Go toolchain selection cancelled.'});
 assert.deepEqual(JSON.parse(JSON.stringify(await first)),{cancelled:true});
 const retry=selectNativeGoToolchain(target);
 target.__ynxNativeGoReply({id:posted[0].requestId,status:'selected',version:'late'});
 target.__ynxNativeGoReply({id:posted[1].requestId,status:'selected',version:'go version go1.25.7 darwin/arm64'});
 assert.equal((await retry).effective,'after-reopen');assert.equal(posted.length,2);
});

async function requestFixture() {
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-go-request-'))),require=createRequire(import.meta.url),module={exports:{}};
 const toolchain={root:'/fixture/go',executable:'/fixture/go/bin/go'},helpers=require('./go-toolchain.cjs'),hooks={buildExit:0};
 const originalFS=require('node:fs/promises'),observedFS={...originalFS,async open(...args){const handle=await originalFS.open(...args);const read=handle.read.bind(handle);handle.read=async(...values)=>{await hooks.headerRead?.();return read(...values);};return handle;}};
 vm.runInNewContext(await readFile(new URL('./go-tasks.cjs',import.meta.url),'utf8'),{module,exports:module.exports,process,AbortController,Buffer,require:name=>name==='node:fs/promises'?observedFS:name==='./go-toolchain.cjs'?{...helpers,admittedToolchain:async()=>toolchain,verifyToolchain:async saved=>{if(hooks.verify)return hooks.verify(saved,toolchain);if(saved?.root!==toolchain.root)return helpers.verifyToolchain(saved,{YNX_IDE_GO_ROOT:toolchain.root});return toolchain;}}:require(name)});
 const file=join(root,'hello.go');await writeFile(file,'package main; func main() {}');
 const document={uri:{scheme:'file',fsPath:file},version:1,isDirty:false,isClosed:false,save:async()=>true},folder={uri:{scheme:'file',fsPath:root}},listeners=new Set(),startListeners=new Set(),editorListeners=new Set();
 let saved,picks=0,notices=0,workflow;
 const executions=[],submitted=[];
 class Task {constructor(definition,scope,name,source,execution,matchers){Object.assign(this,{definition,scope,name,source,execution,matchers});}}
 class ProcessExecution {constructor(command,args,options){Object.assign(this,{command,args,options});}}
 const api={workspace:{isTrusted:true,workspaceFolders:[folder],textDocuments:[],getConfiguration:()=>({inspect:()=>({workspaceFolderValue:saved}),update:async(key,value)=>{saved=value;await hooks.update?.();}})},
  window:{activeTextEditor:{document},onDidChangeActiveTextEditor:fn=>{editorListeners.add(fn);return{dispose:()=>editorListeners.delete(fn)};},showQuickPick:async items=>{picks++;return hooks.pick?hooks.pick(items):items[0];},showInformationMessage:()=>{notices++;hooks.notice?.();return new Promise(()=>{});}},
  CancellationTokenSource:class {token={};cancel(){}dispose(){}},ConfigurationTarget:{WorkspaceFolder:3},Task,ProcessExecution,TaskGroup:{Build:'build',Test:'test'},TaskRevealKind:{Always:1},TaskPanelKind:{Shared:1},
  tasks:{registerTaskProvider:()=>({dispose(){}}),onDidStartTask:fn=>{startListeners.add(fn);return{dispose:()=>startListeners.delete(fn)};},onDidEndTaskProcess:fn=>{listeners.add(fn);return{dispose:()=>listeners.delete(fn)};},onDidEndTask:()=>({dispose(){}}),executeTask:async task=>{
   executions.push(task.definition.stage);submitted.push(task);const execution={task,terminate(){}};
   if(hooks.signalStart)for(const fn of startListeners)fn({execution});
   if(hooks.execute)return hooks.execute(task,execution,listeners);
   if(task.definition.stage==='build' && hooks.buildExit===0){const output=task.execution.args[task.execution.args.indexOf('-o')+1];await writeFile(output,Buffer.from('cffaedfe','hex'));await chmod(output,0o700);}
   setImmediate(()=>{for(const fn of listeners)fn({execution,exitCode:task.definition.stage==='build'?hooks.buildExit:task.definition.stage==='test'?(hooks.testExit??0):0});});return execution;
  }} };
 const environment={YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001',YNX_WORKSPACE_MODE:'local'};
 const open=()=>workflow=module.exports.createGoTasks(api,{subscriptions:[]},environment);open();
 return {api,hooks,executions,submitted,get saved(){return saved;},set saved(value){saved=value;},get workflow(){return workflow;},open,counts:()=>({picks,notices}),switchEditor(value){api.window.activeTextEditor=value?{document:value}:undefined;for(const fn of editorListeners)fn(api.window.activeTextEditor);},document,async close(){workflow.dispose();await rm(root,{recursive:true,force:true});}};
}

test('Go Project Test first configuration continues once with its notice open and uses the offline task terminal',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  await writeFile(f.document.uri.fsPath,'package library\nfunc Value() int { return 42 }\n');
  assert.equal((await f.workflow.test()).exitCode,0);assert.deepEqual(f.executions,['test']);assert.deepEqual(f.counts(),{picks:1,notices:1});
  const task=f.submitted[0];assert.equal(task.execution.command,'/fixture/go/bin/go');assert.deepEqual(Array.from(task.execution.args),['test','-count=1','-v','.']);
  assert.equal(task.execution.options.cwd,join(f.document.uri.fsPath,'..'));assert.equal(task.execution.options.env.GOPROXY,'off');assert.equal(task.execution.options.env.GOSUMDB,'off');assert.equal(task.execution.options.env.GOTOOLCHAIN,'local');assert.equal(task.execution.options.env.CGO_ENABLED,'0');
  assert.equal(task.group,'test');assert.equal(task.presentationOptions.panel,1);assert.equal(task.presentationOptions.reveal,1);assert.deepEqual(Array.from(task.matchers),['$ynx-go-compile']);
  assert.equal((await f.workflow.run()).exitCode,0);assert.deepEqual(f.executions,['test','build','run']);assert.equal(f.counts().picks,1);
  f.workflow.dispose();f.open();await f.workflow.test();assert.equal(f.counts().picks,1);assert.equal(f.executions.at(-1),'test');assert.equal(f.workflow.status().running,false);
 }finally{await f.close();}
});

test('Go Project Test does not execute after configuration cancel or failed source save and can retry',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  f.hooks.pick=async()=>undefined;await f.workflow.test();assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
  delete f.hooks.pick;f.document.isDirty=true;f.document.save=async()=>false;f.api.workspace.textDocuments=[f.document];
  await assert.rejects(f.workflow.test(),/Save the Go sources/);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
  f.document.save=async()=>{f.document.isDirty=false;return true;};await f.workflow.test();assert.deepEqual(f.executions,['test']);
 }finally{await f.close();}
});

test('Go Project Test rejects file switching and lost permission during configuration before launching',{timeout:2000},async()=>{
 for(const change of ['file','trust']){const f=await requestFixture();try {
  f.hooks.update=()=>{if(change==='trust')f.api.workspace.isTrusted=false;else {f.switchEditor({uri:{scheme:'file',fsPath:f.document.uri.fsPath+'-other.go'}});f.switchEditor(f.document);}};
  if(change==='trust')await assert.rejects(f.workflow.test(),/changed/);else await f.workflow.test();
  assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
  f.api.workspace.isTrusted=true;delete f.hooks.update;await f.workflow.test();assert.deepEqual(f.executions,['test']);
 }finally{await f.close();}}
});

test('Go Project Test shares Run ownership and terminates a late task handle once after cancellation',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  let deliver,terminated=0;
  f.hooks.execute=(task,execution,listeners)=>new Promise(resolve=>{execution.terminate=()=>{terminated++;for(const fn of listeners)fn({execution,exitCode:143});};deliver=()=>resolve(execution);});
  const pending=f.workflow.test();while(!deliver)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.workflow.run(),/already running/);await assert.rejects(f.workflow.test(),/already running/);assert.equal(f.workflow.cancel(),true);deliver();
  assert.equal((await pending).cancelled,true);assert.equal(terminated,1);assert.deepEqual(f.executions,['test']);assert.equal(f.workflow.status().running,false);
  delete f.hooks.execute;await f.workflow.test();assert.deepEqual(f.executions,['test','test']);assert.equal(terminated,1);
 }finally{await f.close();}
});

test('Go Project Test reports failure, releases Running and reruns with a distinct execution id',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  f.hooks.testExit=1;assert.equal((await f.workflow.test()).exitCode,1);assert.equal(f.workflow.status().running,false);
  f.hooks.testExit=0;assert.equal((await f.workflow.test()).exitCode,0);assert.notEqual(f.submitted[0].definition.runId,f.submitted[1].definition.runId);assert.deepEqual(f.executions,['test','test']);
 }finally{await f.close();}
});

test('Go Project Test metadata and real extension command reach the test lifecycle and localized failure output',async()=>{
 const require=createRequire(import.meta.url),metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(metadata.activationEvents.includes('onCommand:ynx.go.test'));assert.ok(metadata.contributes.commands.some(x=>x.command==='ynx.go.test'));
 assert.ok(metadata.contributes.menus['editor/context'].some(x=>x.command==='ynx.go.test'&&x.when.includes('resourceExtname == .go')));
 assert.equal(metadata.contributes.problemMatchers.some(x=>x.name==='ynx-go-test'),false); // Verbose log lines have no failed-test discriminator.
 const en=JSON.parse(await readFile(new URL('../package.nls.json',import.meta.url),'utf8')),zh=JSON.parse(await readFile(new URL('../package.nls.zh-cn.json',import.meta.url),'utf8'));assert.equal(en['command.test'],'Test Go Project');assert.equal(zh['command.test'],'测试 Go 项目');
 const commands=new Map(),warnings=[];let tests=0;const module={exports:{}},api={commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return{dispose(){}};}},window:{showWarningMessage:async message=>warnings.push(message),showErrorMessage:async message=>{throw Error(message);}}};
 vm.runInNewContext(await readFile(new URL('./extension.cjs',import.meta.url),'utf8'),{module,exports:module.exports,process,require:name=>name==='vscode'?api:name==='./go-tasks.cjs'?{createGoTasks:()=>({test:async()=>{tests++;return{exitCode:1};}})}:require(name)});
 module.exports.activate({subscriptions:[]});assert.equal((await commands.get('ynx.go.test')()).exitCode,1);assert.equal(tests,1);assert.deepEqual(warnings,['Go tests failed with code 1. See its task terminal output.']);
});

test('Go Test F1 verbose success and skip logs are not Problems while compiler errors and failed exit remain',{timeout:2000},async()=>{
 const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const matchers=metadata.contributes.problemMatchers;
 const f=await requestFixture();try {
  for(const sample of [
   {exitCode:0,output:['=== RUN   TestPass','    counter_test.go:12: connected to fixture','--- PASS: TestPass (0.00s)','PASS']},
   {exitCode:0,output:['=== RUN   TestSkip','    counter_test.go:18: optional fixture not available','--- SKIP: TestSkip (0.00s)','PASS']},
   {exitCode:1,output:['=== RUN   TestFail','    counter_test.go:24: got 41, want 42','--- FAIL: TestFail (0.00s)','FAIL']}
  ]) {
   f.hooks.testExit=sample.exitCode;
   assert.equal((await f.workflow.test()).exitCode,sample.exitCode);
   const task=f.submitted.at(-1);
   assert.deepEqual(Array.from(task.matchers),['$ynx-go-compile']);
   assert.ok(Array.from(task.execution.args).includes('-v')); // Full verbose output remains on the original process Task.
   assert.equal(task.presentationOptions.panel,1);assert.equal(f.workflow.status().running,false);
   for(const id of task.matchers){const matcher=matchers.find(x=>'$'+x.name===id);assert.ok(matcher);
    for(const line of sample.output)assert.equal(new RegExp(matcher.pattern.regexp).test(line),false,'Unclassified verbose log must remain terminal text: '+line);
   }
  }
  const matcher=matchers.find(x=>x.name==='ynx-go-compile');
  const compiler=new RegExp(matcher.pattern.regexp).exec('counter_test.go:31:2: undefined: missing');
  assert.equal(compiler[matcher.pattern.file],'counter_test.go');assert.equal(compiler[matcher.pattern.line],'31');assert.equal(compiler[matcher.pattern.column],'2');assert.equal(compiler[matcher.pattern.message],'undefined: missing');
 }finally{await f.close();}
});

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
    window:{activeTextEditor:{document:{uri:{scheme:'file',fsPath:file},version:1,isDirty:false,isClosed:false,save:async()=>true}},showQuickPick:async items=>items[0],showInformationMessage:()=>{notices++;return notification();}},
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

test('Run and Test cross the save RPC even while the dirty mirror is clean and a false save never launches',{timeout:2000},async()=>{
 for(const method of ['run','test']){const f=await requestFixture();try{
  let saves=0;f.document.isDirty=false;f.document.save=async()=>{saves++;return false;};f.api.workspace.textDocuments=[f.document];
  await assert.rejects(f.workflow[method](),/Save the Go sources/);assert.equal(saves,1);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
  f.document.save=async()=>{saves++;return true;};await f.workflow[method]();assert.equal(saves,2);assert.deepEqual(f.executions,method==='run'?['build','run']:['test']);
 }finally{await f.close();}}
});
test('Run and Test refuse closed or still dirty sources after the normal save reply',{timeout:2000},async()=>{
 for(const method of ['run','test'])for(const state of ['closed','dirty']){const f=await requestFixture();try{
  f.document.isDirty=true;f.api.workspace.textDocuments=[f.document];f.document.save=async()=>{f.document.isDirty=state==='dirty';f.document.isClosed=state==='closed';return true;};
  await assert.rejects(f.workflow[method](),/Save the Go sources/);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
 }finally{await f.close();}}
});
test('save cancellation settles without its late reply launching a task and retry remains usable',{timeout:2000},async()=>{
 const f=await requestFixture();try{let reply;f.document.isDirty=true;f.document.save=()=>new Promise(resolve=>reply=resolve);f.api.workspace.textDocuments=[f.document];
  const pending=f.workflow.run();while(!reply)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.workflow.cancel(),true);
  assert.equal((await pending).cancelled,true);assert.equal(f.workflow.status().running,false);assert.deepEqual(f.executions,[]);
  f.document.isDirty=false;reply(true);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.executions,[]);
  f.document.save=async()=>true;await f.workflow.run();assert.deepEqual(f.executions,['build','run']);
 }finally{await f.close();}
});
test('all project Go files cross save while foreign and non-Go documents stay untouched',{timeout:2000},async()=>{
 const f=await requestFixture();try{let currentSaves=0,otherSaves=0,foreignSaves=0;f.document.save=async()=>{currentSaves++;return true;};
  const other={uri:{scheme:'file',fsPath:join(f.document.uri.fsPath,'..','other.go')},version:1,isDirty:false,save:async()=>{otherSaves++;return true;}};
  const outside={uri:{scheme:'file',fsPath:join(f.document.uri.fsPath,'..','..','foreign.go')},isDirty:true,save:async()=>{foreignSaves++;return true;}};
  const readme={uri:{scheme:'file',fsPath:join(f.document.uri.fsPath,'..','README.md')},save:outside.save};
  f.api.workspace.textDocuments=[f.document,other,outside,readme];await f.workflow.test();assert.equal(currentSaves,1);assert.equal(otherSaves,1);assert.equal(foreignSaves,0);assert.deepEqual(f.executions,['test']);
 }finally{await f.close();}
});
test('edits to an already saved source during another save invalidate the same request',{timeout:2000},async()=>{
 const f=await requestFixture();try{f.document.isDirty=false;f.document.version=1;f.document.save=async()=>true;
  const other={uri:{scheme:'file',fsPath:join(f.document.uri.fsPath,'..','other.go')},version:1,isDirty:false,save:async()=>{f.document.version++;return true;}};
  f.api.workspace.textDocuments=[f.document,other];await assert.rejects(f.workflow.test(),/Save the Go sources/);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
 }finally{await f.close();}
});

test('an edit during Go compilation prevents running the completed older binary',{timeout:2000},async()=>{
 const f=await requestFixture();try{const execute=f.api.tasks.executeTask;f.api.tasks.executeTask=async task=>{const result=await execute(task);if(task.definition.stage==='build')f.document.version++;return result;};
  await assert.rejects(f.workflow.run(),/Save the Go sources/);assert.deepEqual(f.executions,['build']);assert.equal(f.workflow.status().running,false);
  f.api.tasks.executeTask=execute;await f.workflow.run();assert.deepEqual(f.executions,['build','build','run']);
 }finally{await f.close();}
});
test('switching editor during a pending save cancels the old request without waiting for its reply',{timeout:2000},async()=>{
 const f=await requestFixture();try{let reply;f.document.save=()=>new Promise(resolve=>reply=resolve);const pending=f.workflow.test();while(!reply)await new Promise(resolve=>setImmediate(resolve));
  f.switchEditor({uri:{scheme:'file',fsPath:f.document.uri.fsPath+'-other.go'}});f.switchEditor(f.document);assert.equal((await pending).cancelled,true);assert.equal(f.workflow.status().running,false);
  reply(true);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.executions,[]);f.document.save=async()=>true;await f.workflow.test();assert.deepEqual(f.executions,['test']);
 }finally{await f.close();}
});

// R36 joins the real generic Run handler, real Go extension registration and
// retained requestFixture's original Go workflow/task callbacks. Toolchain and
// task-process boundaries stay fixture controls, not a real compiler or App run.
async function currentGoButtonFixture() {
 const f=await requestFixture(),require=createRequire(import.meta.url),handlers=new Map(),calls=[],warnings=[],errors=[];
 const api=f.api;
 api.window.showWarningMessage=async message=>warnings.push(message);api.window.showErrorMessage=async message=>errors.push(message);
 api.commands={registerCommand:(id,execute)=>{handlers.set(id,{execute});return{dispose(){}};},executeCommand:async(id,...args)=>{calls.push(id);const handler=handlers.get(id);if(!handler)throw Error('Unexpected fallback: '+id);return handler.execute(...args);},isEnabled:id=>handlers.has(id)};
 const module={exports:{}};
 vm.runInNewContext(await readFile(new URL('./extension.cjs',import.meta.url),'utf8'),{module,exports:module.exports,process,require:name=>name==='vscode'?api:name==='./go-tasks.cjs'?{createGoTasks:()=>f.workflow}:require(name)});
 module.exports.activate({subscriptions:[]});
 const {DebugSelectionContribution}=require('../../../runtime/ynx-workbench/lib/debug-selection.js');
 const editors={currentEditor:{editor:{uri:{scheme:'file'},document:{languageId:'go'}}}},configurations={};
 const contribution=new DebugSelectionContribution(api.commands,editors,configurations);
 contribution.registerCommands({registerCommand:(command,handler)=>handlers.set(command.id,handler)});
 return {...f,api,handlers,calls,warnings,errors,editors,configurations,contribution,workflow:f.workflow};
}
test('R36 normal generic Run reaches original Go task terminal, cwd and repeat result with first notice open',{timeout:2000},async()=>{
 const f=await currentGoButtonFixture();try {
  const run=f.handlers.get('ynx.workbench.runCurrentFile');assert.equal(run.isEnabled(),true);
  assert.equal((await run.execute()).exitCode,0);assert.deepEqual(f.executions,['build','run']);assert.deepEqual(f.counts(),{picks:1,notices:1});
  for(const task of f.submitted){assert.equal(task.execution.options.cwd,join(f.document.uri.fsPath,'..'));assert.equal(task.presentationOptions.reveal,f.api.TaskRevealKind.Always);assert.equal(task.presentationOptions.panel,f.api.TaskPanelKind.Shared);}
  const first=f.submitted[0].definition.runId;assert.equal((await run.execute()).exitCode,0);assert.deepEqual(f.executions,['build','run','build','run']);assert.notEqual(f.submitted[2].definition.runId,first);
  assert.deepEqual(f.counts(),{picks:1,notices:1});assert.deepEqual(f.errors,[]);assert.deepEqual(f.warnings,[]);assert.equal(f.workflow.status().running,false);assert.deepEqual(f.calls,['ynx.go.run','ynx.go.run']);
 }finally{await f.close();}
});
test('R36 generic Run retains owned cancel, terminal exit and retry instead of starting stale run',{timeout:2000},async()=>{
 const f=await currentGoButtonFixture();try {
  let deliver,terminated=0,entered;
  const entry=new Promise(resolve=>{entered=resolve;});
  f.hooks.execute=(task,execution,listeners)=>new Promise(resolve=>{execution.terminate=()=>{terminated++;for(const fn of listeners)fn({execution,exitCode:143});};deliver=()=>resolve(execution);entered();});
  const pending=f.handlers.get('ynx.workbench.runCurrentFile').execute();
  // Abort quickly on the old incorrect fallback, without a timeout polling loop.
  await Promise.race([pending.then(()=>{throw Error('Run returned before Go task entry');}),entry]);
  assert.equal(await f.handlers.get('ynx.go.cancel').execute(),true);deliver();assert.equal((await pending).cancelled,true);assert.equal(terminated,1);assert.deepEqual(f.executions,['build']);assert.equal(f.workflow.status().running,false);
  delete f.hooks.execute;assert.equal((await f.handlers.get('ynx.workbench.runCurrentFile').execute()).exitCode,0);assert.deepEqual(f.executions,['build','build','run']);assert.deepEqual(f.errors,[]);assert.equal(f.workflow.status().running,false);
 }finally{await f.close();}
});
test('R36 generic Go Run preserves explicit launch ownership and unconfigured debug selection',async()=>{
 const f=await currentGoButtonFixture();try {
  assert.equal(f.contribution.currentFileCommand(true),'select.debug.configuration');
  f.configurations.current={name:'TEST_ONLY_user_launch'};
  assert.equal(f.contribution.currentFileCommand(false),'workbench.action.debug.run');assert.equal(f.contribution.currentFileCommand(true),'workbench.action.debug.start');assert.deepEqual(f.executions,[]);
 }finally{await f.close();}
});

test('Go final launch refuses source, editor or permission changes during executable inspection and permits retry',{timeout:5000},async()=>{
 for(const change of ['source','editor','trust']){
  const f=await requestFixture();try {
   f.hooks.headerRead=()=>{
    if(change==='source'){f.document.version++;f.document.isDirty=true;}
    if(change==='editor')f.switchEditor({uri:{scheme:'file',fsPath:f.document.uri.fsPath+'-other.go'}});
    if(change==='trust')f.api.workspace.isTrusted=false;
   };
   await assert.rejects(f.workflow.run(),change==='source'?/Save the Go sources/:/changed/);
   assert.deepEqual(f.executions,['build'],'Invalidated request must not launch the old program');
   assert.equal(f.workflow.status().running,false);
   delete f.hooks.headerRead;f.document.isDirty=false;f.api.workspace.isTrusted=true;f.switchEditor(f.document);
   assert.equal((await f.workflow.run()).exitCode,0);
   assert.deepEqual(f.executions,['build','build','run']);assert.equal(f.counts().picks,1);
  }finally{await f.close();}
 }
});

test('stale saved Go root reconfigures from admitted toolchain and continues the original Run once', {timeout:2000}, async()=>{
 const f=await requestFixture();try {
  await f.workflow.run();f.executions.length=0;
  f.saved={...f.saved,toolchain:{...f.saved.toolchain,root:'/old/runtime/go'}};
  assert.equal((await f.workflow.run()).exitCode,0);assert.deepEqual(f.executions,['build','run']);
  assert.equal(f.saved.toolchain.root,'/fixture/go');assert.equal(f.counts().picks,2);
  await f.workflow.run();assert.equal(f.counts().picks,2);assert.equal(f.executions.length,4);
 }finally{await f.close();}
});
test('stale Go recovery cancellation preserves the old setting and does not run, then retries', {timeout:2000},async()=>{
 const f=await requestFixture();try {
  await f.workflow.run();f.executions.length=0;
  const stale={...f.saved,toolchain:{...f.saved.toolchain,root:'/old/runtime/go'}};f.saved=stale;
  f.hooks.pick=async()=>undefined;await f.workflow.run();assert.equal(f.saved,stale);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
  delete f.hooks.pick;await f.workflow.run();assert.deepEqual(f.executions,['build','run']);
 }finally{await f.close();}
});
test('stale Go recovery cannot revive a cancelled or switched original request', {timeout:2000},async()=>{
 for(const change of ['cancel','file','trust']){const f=await requestFixture();try {
  await f.workflow.run();f.executions.length=0;const stale={...f.saved,toolchain:{...f.saved.toolchain,root:'/old/runtime/go'}};f.saved=stale;
  f.hooks.pick=async items=>{if(change==='cancel')f.workflow.cancel();if(change==='file')f.switchEditor({uri:{scheme:'file',fsPath:f.document.uri.fsPath+'other.go'}});if(change==='trust')f.api.workspace.isTrusted=false;return items[0];};
  if(change==='trust')await assert.rejects(f.workflow.run(),/changed/);else await f.workflow.run();
  assert.equal(f.saved,stale);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
 }finally{await f.close();}}
});
test('runtime Go verification failure is not mistaken for stale project configuration', {timeout:2000},async()=>{
 const f=await requestFixture();try {
  await f.workflow.run();f.executions.length=0;const saved=f.saved,picks=f.counts().picks;
  f.hooks.verify=async()=>{throw Error('runtime metadata does not match installed binary');};
  await assert.rejects(f.workflow.run(),/metadata does not match/);assert.equal(f.saved,saved);assert.equal(f.counts().picks,picks);assert.deepEqual(f.executions,[]);assert.equal(f.workflow.status().running,false);
 }finally{await f.close();}
});

test('persisted Go choice without current runtime admission uses native selection, preserving settings until reopen',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-go-stale-no-admission-')));
 try {
  const {createGoTasks}=createRequire(import.meta.url)('./go-tasks.cjs');let selections=0,launches=0,writes=0;
  const old={mode:'package',target:'.',toolchain:{root:'/old/runtime/go'}};
  const api={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:root}}],getConfiguration:()=>({inspect:()=>({workspaceFolderValue:old}),update:()=>{writes++;}})},
   CancellationTokenSource:class{token={};cancel(){}dispose(){}},
   commands:{executeCommand:async id=>{assert.equal(id,'ynx.workbench.selectGoToolchain');selections++;return{effective:'after-reopen'};}},
   tasks:{registerTaskProvider:()=>({dispose(){}}),executeTask:()=>{launches++;}}};
  const workflow=createGoTasks(api,{subscriptions:[]},{YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001',YNX_WORKSPACE_MODE:'local'});
  await workflow.run();assert.equal(selections,1);assert.equal(launches,0);assert.equal(writes,0);assert.equal(workflow.status().running,false);workflow.dispose();
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a started Go task with a lost reply keeps ownership, terminates once and releases only on its own end',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  let end,foreignEnd,terminations=0;const failure=Error('accepted task reply lost');f.hooks.signalStart=true;
  f.hooks.execute=async(task,execution,listeners)=>{execution.terminate=()=>{terminations++;};end=()=>{for(const fn of listeners)fn({execution,exitCode:143});};foreignEnd=()=>{for(const fn of listeners)fn({execution:{task:{definition:{...task.definition,runId:'foreign'}}},exitCode:0});};throw failure;};
  await assert.rejects(f.workflow.run(),error=>error===failure);assert.equal(terminations,1);assert.equal(f.workflow.status().running,true);
  await assert.rejects(f.workflow.run(),/already running/);foreignEnd();assert.equal(f.workflow.status().running,true);
  assert.equal(f.workflow.cancel(),true);assert.equal(terminations,1);end();assert.equal(f.workflow.status().running,false);
  delete f.hooks.execute;await f.workflow.run();assert.deepEqual(f.executions,['build','build','run']);assert.equal(terminations,1);
 }finally{await f.close();}
});
test('cancellation after observed start stops once before a late reply and never revives the old request',{timeout:2000},async()=>{
 const f=await requestFixture();try {
  let reply,terminations=0;f.hooks.signalStart=true;
  f.hooks.execute=(task,execution,listeners)=>new Promise(resolve=>{reply=()=>resolve(execution);execution.terminate=()=>{terminations++;for(const fn of listeners)fn({execution,exitCode:143});};});
  const pending=f.workflow.run();while(!reply)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.workflow.cancel(),true);
  assert.equal((await pending).cancelled,true);assert.equal(terminations,1);assert.equal(f.workflow.status().running,false);
  delete f.hooks.execute;await f.workflow.run();reply();await new Promise(resolve=>setImmediate(resolve));assert.equal(terminations,1);assert.deepEqual(f.executions,['build','build','run']);assert.equal(f.workflow.status().running,false);
 }finally{await f.close();}
});
test('a started task missing its reply handle retains first failure when owned termination also fails',async()=>{
 const task={definition:{runId:'owned',stage:'build'}},operation={cancelled:false},ends=new Set();let start,terminated=0;
 const api={tasks:{onDidStartTask:fn=>{start=fn;return{dispose(){}};},onDidEndTaskProcess:fn=>{ends.add(fn);return{dispose:()=>ends.delete(fn)};},onDidEndTask:()=>({dispose(){}}),executeTask:async()=>{start({execution:{task,terminate(){terminated++;throw Error('cleanup refused');}}});return undefined;}}};
 await assert.rejects(executeGoTask(api,task,operation),/did not return a live execution/);
 assert.match(operation.failure.message,/did not return/);assert.equal(operation.cleanupFailure.message,'cleanup refused');assert.equal(operation.cleanupPending,true);assert.equal(terminated,1);
 operation.execution.terminate();assert.equal(terminated,1);for(const fn of ends)fn({execution:{task},exitCode:143});assert.equal(operation.cleanupPending,false);assert.equal(ends.size,0);
});
