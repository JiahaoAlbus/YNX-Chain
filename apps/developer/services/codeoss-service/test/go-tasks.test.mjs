import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import{spawn}from'node:child_process';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),dev=path.resolve(import.meta.dirname,'../../..');
const types=require(path.join(dev,'runtime/theia/node_modules/@theia/plugin-ext/lib/plugin/types-impl'));
const{TasksExtImpl}=require(path.join(dev,'runtime/theia/node_modules/@theia/plugin-ext/lib/plugin/tasks/tasks'));
const{CancellationTokenSource}=require(path.join(dev,'runtime/theia/node_modules/@theia/core/lib/common/cancellation'));
const{TaskServerImpl}=require(path.join(dev,'runtime/theia/node_modules/@theia/task/lib/node/task-server'));
const{ProcessTask}=require(path.join(dev,'runtime/theia/node_modules/@theia/task/lib/node/process/process-task'));
const{inspectToolchain}=require('../../../native/ynx-go/src/go-toolchain.cjs');
const{createGoTasks}=require('../../../native/ynx-go/src/go-tasks.cjs');
const parent='/Volumes/Data/Users/huangjiahao/.ynx-ide-build-artifacts-v2-20261005';
async function fixture(t){
 assert.ok(process.env.YNX_GO_TEST_ROOT,'Supply the explicitly approved private Go QA snapshot; no implicit host tool fallback.');
 const tool=await inspectToolchain(process.env.YNX_GO_TEST_ROOT),root=await fs.mkdtemp(path.join(parent,'go-task-project-'));await fs.chmod(root,0o700);await fs.mkdir(path.join(root,'.vscode'),{mode:0o700});
 const settingsPath=path.join(root,'.vscode/settings.json');await fs.writeFile(settingsPath,JSON.stringify({'editor.tabSize':3}),{flag:'wx',mode:0o600});await fs.writeFile(path.join(root,'go.mod'),'module ynx.local/taskqa\n\ngo 1.25\n',{flag:'wx'});
 const file=path.join(root,'main.go');await fs.writeFile(file,'package main\nimport "fmt"\nfunc main(){fmt.Println("GO_FIRST_SUCCESS")}\n',{flag:'wx'});
 const uri=fsPath=>({scheme:'file',fsPath,toString:()=>`file://${fsPath}`});let settings=JSON.parse(await fs.readFile(settingsPath,'utf8'));
 const h={root,file,settingsPath,output:[],calls:[],taskOrder:[],children:new Map(),messages:[],pickCount:0};let ext,next=1;
 const bridge={
  $registerTaskProvider(handle,type){h.providerHandle=handle;assert.equal(type,'ynx-go');},$unregisterTaskProvider(){},
  async $executeTask(dto){assert.equal(dto.executionType,'process');h.calls.push(dto);const id=next++,execution={id,task:dto};await ext.$onDidStartTask(execution,100+id);
   const child=spawn(dto.command,dto.args,{cwd:dto.options.cwd,env:{...process.env,...dto.options.env,GOMAXPROCS:'2'},stdio:['ignore','pipe','pipe'],detached:true});h.children.set(id,child);
   child.stdout.on('data',chunk=>{h.output.push(String(chunk));if(h.waitForRunOutput && h.output.join('').includes(h.waitForRunOutput))h.runStarted?.();});child.stderr.on('data',chunk=>h.output.push(String(chunk)));
   child.on('spawn',()=>{ext.$onDidStartTaskProcess(child.pid,execution);if(dto.stage==='run'){h.runPid=child.pid;if(!h.waitForRunOutput)h.runStarted?.();}});
   let finished=false;const finish=(code)=>{if(finished)return;finished=true;h.children.delete(id);const server={logger:{debug(){}},clients:new Set([{onDidEndTaskProcess(event){h.taskOrder.push('process');if(event.code!==undefined && !(dto.stage==='run' && h.omitRunProcessResult))ext.$onDidEndTaskProcess(event.code,event.taskId);},onTaskExit(event){h.taskOrder.push('end');ext.$onDidEndTask(event.taskId);}}])};TaskServerImpl.prototype.fireTaskExitedEvent.call(server,{taskId:id,code},Object.create(ProcessTask.prototype));};
   child.once('error',error=>{h.output.push(error.message);finish(127);});child.once('exit',(code)=>finish(code===null?undefined:code));return execution;},
  $terminateTask(id){const child=h.children.get(id);if(child){try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}}
 };
 ext=new TasksExtImpl({getProxy:()=>bridge},{});h.ext=ext;
 const doc={uri:uri(file),isDirty:false,text:await fs.readFile(file,'utf8'),async save(){await fs.writeFile(file,this.text);this.isDirty=false;return true;}};
 const api={...types,CancellationTokenSource,tasks:ext,ConfigurationTarget:{WorkspaceFolder:3},workspace:{isTrusted:true,workspaceFolders:[{uri:uri(root)}],textDocuments:[doc],onDidChangeWorkspaceFolders(listener){h.folderChanged=listener;return{dispose(){}};},getConfiguration(section,folder){assert.equal(section,'ynx.go');assert.equal(folder.fsPath,root);return{inspect(key){return{workspaceFolderValue:settings[section+'.'+key]};},async update(key,value,target){assert.equal(target,3);settings[section+'.'+key]=value;await fs.writeFile(settingsPath,JSON.stringify(settings));}};}},window:{activeTextEditor:{document:doc},async showQuickPick(items,_options,token){h.pickCount++;h.pickerToken=token;h.pickEntered?.();await h.pickWait;h.afterPick?.();return h.cancelPick?undefined:items[0];},async showInformationMessage(message){h.messages.push(message);}}};
 const environment={YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'cccccccc-cccc-cccc-cccc-cccccccccccc',YNX_IDE_GO_ROOT:tool.root,YNX_IDE_GO_ENTRY:tool.executable,YNX_IDE_GO_VERSION:tool.version,YNX_IDE_GO_SHA:tool.binarySha256};h.api=api;h.environment=environment;h.doc=doc;
 h.reopen=async()=>{h.workflow?.dispose();settings=JSON.parse(await fs.readFile(settingsPath,'utf8'));h.workflow=createGoTasks(api,{subscriptions:[]},environment);};await h.reopen();t.after(()=>h.workflow.dispose());return h;
}
test('real Go TaskExt ProcessExecution compiles/runs, persists config, exits, cancels and retries',{timeout:180000},async t=>{
 const h=await fixture(t);assert.deepEqual(await h.ext.$provideTasks(h.providerHandle),[]);await assert.rejects(fs.stat(path.join(h.root,'.ynx-go')),error=>error.code==='ENOENT');assert.deepEqual(await h.workflow.run(),{exitCode:0});assert.match(h.output.join(''),/GO_FIRST_SUCCESS/);assert.equal(h.pickCount,1);assert.equal(h.ext.taskExecutions.length,0);assert.deepEqual(h.taskOrder,['process','end','process','end']);
 assert.equal(h.calls[0].command,h.environment.YNX_IDE_GO_ENTRY);assert.equal(h.calls[0].options.env.GOPROXY,'off');assert.equal(h.calls[0].options.env.GOTOOLCHAIN,'local');assert.equal(h.calls[0].options.env.CGO_ENABLED,'0');assert.ok(h.calls[0].options.env.GOCACHE.startsWith(h.root+'/'));assert.equal(JSON.parse(await fs.readFile(h.settingsPath,'utf8'))['editor.tabSize'],3);
 await h.reopen();h.doc.text='package main\nimport("fmt";"os")\nfunc main(){fmt.Println("GO_REPEAT_NEW");os.Exit(17)}\n';h.doc.isDirty=true;assert.deepEqual(await h.workflow.run(),{exitCode:17});assert.match(h.output.join(''),/GO_REPEAT_NEW/);assert.equal(h.pickCount,1);assert.equal(h.doc.isDirty,false);
 const previous=h.calls.length;h.doc.text='package main\nfunc main(){ missing_symbol }\n';h.doc.isDirty=true;await assert.rejects(h.workflow.run(),/Go build failed/);assert.equal(h.calls.length,previous+1);assert.match(h.output.join(''),/undefined: missing_symbol/);assert.equal(h.ext.taskExecutions.length,0);
 h.doc.text='package main\nimport("fmt";"time")\nfunc main(){fmt.Println("GO_CANCEL_RUNNING");time.Sleep(30*time.Second)}\n';h.doc.isDirty=true;h.waitForRunOutput='GO_CANCEL_RUNNING';const started=new Promise(resolve=>h.runStarted=resolve);const work=h.workflow.run();await started;assert.equal(h.workflow.cancel(),true);assert.deepEqual(await work,{cancelled:true});assert.equal(h.children.size,0);assert.equal(h.ext.taskExecutions.length,0);assert.match(h.output.join(''),/GO_CANCEL_RUNNING/);assert.throws(()=>process.kill(h.runPid,0),error=>error.code==='ESRCH');
 h.runStarted=undefined;h.waitForRunOutput=undefined;h.doc.text='package main\nimport "fmt"\nfunc main(){fmt.Println("GO_AFTER_CANCEL")}\n';h.doc.isDirty=true;assert.deepEqual(await h.workflow.run(),{exitCode:0});assert.match(h.output.join(''),/GO_AFTER_CANCEL/);assert.equal(h.workflow.status().running,false);h.omitRunProcessResult=true;assert.deepEqual(await h.workflow.run(),{unknown:true});assert.equal(h.ext.taskExecutions.length,0);
});
test('actual library build is reported without executing its archive',{timeout:180000},async t=>{
 const h=await fixture(t);h.doc.text='package example\nfunc Answer()int{return 42}\n';h.doc.isDirty=true;await assert.rejects(h.workflow.run(),/library, not a runnable main package/);assert.equal(h.calls.length,1);assert.equal(h.ext.taskExecutions.length,0);
});
test('missing/forged Go supplier is visible and does not create a task',async t=>{
 const h=await fixture(t);delete h.environment.YNX_IDE_GO_ROOT;await assert.rejects(h.workflow.configure(),/no verified Go toolchain supplier/);assert.equal(h.calls.length,0);h.environment.YNX_IDE_GO_ROOT=process.env.YNX_GO_TEST_ROOT;h.environment.YNX_IDE_GO_SHA='0'.repeat(64);await assert.rejects(h.workflow.configure(),/metadata does not match/);assert.equal(h.calls.length,0);
});
test('cancel/changed project while first picker waits ignores late reply and permits retry',async t=>{
 const h=await fixture(t);let release;h.pickWait=new Promise(resolve=>release=resolve);const entered=new Promise(resolve=>h.pickEntered=resolve);const configuring=h.workflow.configure();await entered;assert.equal(h.workflow.cancel(),true);assert.equal(h.pickerToken.isCancellationRequested,true);assert.equal(await configuring,undefined);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.parse(await fs.readFile(h.settingsPath,'utf8'))['ynx.go.project'],undefined);assert.equal(h.workflow.status().configuring,false);
 h.pickWait=undefined;h.afterPick=()=>h.environment.YNX_LOCAL_PROJECT_ID='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';await assert.rejects(h.workflow.configure(),/Go project changed/);assert.equal(h.calls.length,0);
});

test('workspace target escape and unsafe existing cache reject before any task',async t=>{
 const h=await fixture(t);await h.workflow.configure();const config=JSON.parse(await fs.readFile(h.settingsPath,'utf8'));
 await fs.chmod(path.join(h.root,'.ynx-go'),0o755);await assert.rejects(h.workflow.run(),/private project output/);assert.equal(h.calls.length,0);await fs.chmod(path.join(h.root,'.ynx-go'),0o700);
 // Simulate a persisted setting edit and reopen through the normal API boundary.
 config['ynx.go.project'].target='../outside';await fs.writeFile(h.settingsPath,JSON.stringify(config));await h.reopen();await assert.rejects(h.workflow.run(),/configuration is invalid/);assert.equal(h.calls.length,0);
});
test('concurrent Run requests after configuration admit only one real build/run owner',{timeout:180000},async t=>{
 const h=await fixture(t);await h.workflow.configure();const results=await Promise.allSettled([h.workflow.run(),h.workflow.run()]);
 assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.match(results.find(value=>value.status==='rejected').reason.message,/already running/);
 assert.equal(h.calls.length,2);assert.match(h.output.join(''),/GO_FIRST_SUCCESS/);assert.equal(h.children.size,0);assert.equal(h.workflow.status().running,false);
});
