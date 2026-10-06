import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerCppRun, sourceContext, executeAndWait } = require('./cpp-run.cjs');
const { createBuildTasks, createLaunchConfiguration, installedCompiler } = require('./build-tasks.cjs');
function emitter() { const listeners = new Set(); return { event: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; }, fire: event => { for (const fn of listeners) fn(event); }, count: () => listeners.size }; }
const runtimeRequire = createRequire(new URL('../../../runtime/theia/package.json', import.meta.url));
runtimeRequire('reflect-metadata');
const { Task, ProcessExecution } = runtimeRequire('@theia/plugin-ext/lib/plugin/types-impl');
const converter = runtimeRequire('@theia/plugin-ext/lib/plugin/type-converters');
const { TasksExtImpl } = runtimeRequire('@theia/plugin-ext/lib/plugin/tasks/tasks');
async function fixture() {
 const root = await mkdtemp('/private/tmp/ynx-cpp-first-use-'), path = join(root, 'main.cpp');
 const document = { uri: { scheme: 'file', fsPath: path }, languageId: 'cpp', version: 1, isDirty: false, save: async () => true };
 const folder = { uri: { scheme: 'file', fsPath: root }, name: 'test' }, errors = [], output = [], commands = new Map(), end = emitter(), ended = emitter();
 const token = { isCancellationRequested: false, onCancellationRequested: emitter().event };
 const vscode = { Task, ProcessExecution, ProgressLocation: { Notification: 15 }, env: { language: 'en' }, debug: {}, workspace: { workspaceFolders: [folder], isTrusted: true },
 window: { activeTextEditor: { document }, showQuickPick: async items => { vscode.window.activeTextEditor = { document: { languageId: 'markdown' } }; return items[0]; },
 showInformationMessage: text => output.push(text), showErrorMessage: text => errors.push(text), withProgress: (_options, action) => action({}, token) },
 commands: { registerCommand: (id, handler) => { commands.set(id, handler); return { dispose() {} }; } },
 tasks: { onDidEndTaskProcess: end.event, onDidEndTask: ended.event, fetchTasks: async () => {
  const config = JSON.parse(await readFile(join(root, '.vscode/tasks.json'), 'utf8'));
  return config.tasks.map(item => new Task({ type: 'process' }, folder, item.label, 'Workspace', new ProcessExecution(item.command, item.args || [], item.options || {}), item.problemMatcher || []));
 }, executeTask: async task => {
  const execution = { task, terminate: () => child.kill('SIGTERM') };
  const child = spawn(task.execution.process, task.execution.args, { cwd: task.execution.options.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => output.push(bytes.toString())); child.stderr.on('data', bytes => output.push(bytes.toString()));
  child.once('error', () => { end.fire({ execution, exitCode: undefined }); ended.fire({ execution }); });
  child.once('exit', code => { end.fire({ execution, exitCode: code }); ended.fire({ execution }); });
  return execution;
 } } };
 const env = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: root, YNX_LOCAL_PROJECT_ID: '12345678-1234-1234-1234-123456789abc' };
 const context = { subscriptions: [] }; registerCppRun(vscode, context, env);
 return { root, path, document, folder, vscode, env, errors, output, commands, end, ended };
}
test('normal first-use command chooses actual compiler, captures source despite editor welcome focus, and repeats a fresh build', async () => {
 const f = await fixture(); await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "YNX first 42";}\n');
 await f.commands.get('ynx.cpp.runActive')(); assert.deepEqual(f.errors, []); assert.ok(f.output.includes('YNX first 42'));
 const config = JSON.parse(await readFile(join(f.root, '.vscode/tasks.json'))); assert.ok(config.tasks[0].args.includes('-g')); assert.ok(config.tasks[0].args.includes('-O0')); assert.ok(config.tasks[0].args.includes('-isysroot'));
 f.vscode.window.activeTextEditor = { document: f.document }; f.document.version++; await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "YNX repeat 43";}\n');
 await f.commands.get('ynx.cpp.runActive')(); assert.deepEqual(f.errors, []); assert.ok(f.output.includes('YNX repeat 43'));
});
test('a failed rebuild never runs the previous actual native executable', async () => {
 const f = await fixture(); await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "NEVER REPLAY";}\n');
 await f.commands.get('ynx.cpp.runActive')(); const binary = await readFile(join(f.root, 'main')); f.output.length = 0;
 f.vscode.window.activeTextEditor = { document: f.document }; await writeFile(f.path, 'int main(){INVALID_CPP;}');
 await f.commands.get('ynx.cpp.runActive')(); assert.match(f.errors[0], /Build failed/); assert.ok(!f.output.includes('NEVER REPLAY')); assert.deepEqual(await readFile(join(f.root, 'main')), binary);
});
test('Theia task and launch priority preserves commented user configs and does not create a shadow VSCode config', async () => {
 const f = await fixture(); await mkdir(join(f.root, '.theia')); const tasks = '// keep comments\n{"tasks":[]}'; await writeFile(join(f.root, '.theia/tasks.json'), tasks);
 const result = await createBuildTasks(f.root, {}); assert.equal(result.path, join(f.root, '.theia/tasks.json')); assert.equal(result.created, false); assert.equal(await readFile(result.path, 'utf8'), tasks);
 const launch = '// user launch\n{"configurations":[]}'; await writeFile(join(f.root, '.theia/launch.json'), launch);
 const debug = await createLaunchConfiguration(f.root, result.path, 'cpp'); assert.equal(debug.created, false); assert.equal(await readFile(debug.path, 'utf8'), launch);
});
test('project trust and path guard reject foreign source without reading its contents', async () => {
 const f = await fixture(), foreign = await mkdtemp('/private/tmp/ynx-cpp-foreign-'); await writeFile(f.path, 'int main(){}'); await writeFile(join(foreign, 'other.cpp'), 'int main(){}');
 f.document.uri.fsPath = join(foreign, 'other.cpp'); await assert.rejects(sourceContext(f.vscode, f.env), /Select a saved/);
 f.document.uri.fsPath = f.path; f.vscode.workspace.isTrusted = false; await assert.rejects(sourceContext(f.vscode, f.env), /trusted/);
});
test('fast task completion before executeTask promise and unrelated tasks are handled by execution identity', async () => {
 const end = emitter(), ended = emitter(), execution = {}, token = { isCancellationRequested: false, onCancellationRequested: emitter().event };
 const vscode = { Task, tasks: { onDidEndTaskProcess: end.event, onDidEndTask: ended.event, executeTask: async () => { end.fire({ execution: {}, exitCode: 9 }); end.fire({ execution, exitCode: 0 }); ended.fire({ execution }); return execution; } } };
 assert.equal(await executeAndWait(vscode, new Task({type:"process"}, 2, "test", "Workspace", new ProcessExecution("/usr/bin/true"), []), token), 0); assert.equal(end.count(), 0); assert.equal(ended.count(), 0);
});
test('cancellation terminates only the owned task and waits for its terminal event', async () => {
 const end = emitter(), ended = emitter(), cancel = emitter(); let calls = 0;
 const execution = { terminate() { calls++; ended.fire({ execution }); } }, token = { isCancellationRequested: false, onCancellationRequested: cancel.event };
 const vscode = { Task, tasks: { onDidEndTaskProcess: end.event, onDidEndTask: ended.event, executeTask: async () => execution } };
 const pending = executeAndWait(vscode, new Task({type:"process"}, 2, "test", "Workspace", new ProcessExecution("/usr/bin/true"), []), token); await Promise.resolve(); token.isCancellationRequested = true; cancel.fire();
 assert.equal(await pending, undefined); assert.equal(calls, 1); assert.equal(cancel.count(), 0);
});
test('first debug configuration keeps the real task association and refuses replacing existing launch', async () => {
 const f = await fixture(), tool = await installedCompiler({ sysroot: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', language: 'cpp' });
 const tasks = await createBuildTasks(f.root, tool), launch = await createLaunchConfiguration(f.root, tasks.path, 'cpp');
 assert.equal(launch.configuration.type, 'lldb-dap'); assert.equal(launch.configuration.preLaunchTask, 'YNX: Build active C++');
 const bytes = await readFile(launch.path); assert.equal((await createLaunchConfiguration(f.root, tasks.path, 'cpp')).created, false); assert.deepEqual(await readFile(launch.path), bytes);
});

test('same-name user build with successful exit and no product is never classified as a generated compiler task', async () => {
 const f = await fixture(); await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "STALE MUST NOT RUN";}\n');
 await f.commands.get('ynx.cpp.runActive')(); f.output.length = 0;
 const path = join(f.root, '.vscode/tasks.json'), config = JSON.parse(await readFile(path));
 config.tasks[0].command = '/usr/bin/true'; config.tasks[0].args = []; config.tasks[0].options.cwd = f.root; await writeFile(path, JSON.stringify(config));
 f.vscode.window.activeTextEditor = { document: f.document }; let explicitPicker = false;
 f.vscode.window.showQuickPick = async (items, options) => { explicitPicker = /existing project task/.test(options.title); return items[0]; };
 await f.commands.get('ynx.cpp.runActive')(); assert.equal(explicitPicker, true); assert.ok(!f.output.includes('STALE MUST NOT RUN'));
 assert.ok(f.output.some(text => /Project task/.test(text))); assert.deepEqual(f.errors, []);
});

test('retained TasksMain fetch and converter expose process DTO mismatch; persisted command still builds and repeats', async () => {
 const source = await readFile(runtimeRequire.resolve('@theia/plugin-ext/lib/main/browser/tasks-main'), 'utf8');
 // Execute the retained methods verbatim, excluding unrelated browser widget imports.
 const fetch = source.slice(source.indexOf('    async $fetchTasks('), source.indexOf('    async $executeTask('));
 const from = source.slice(source.indexOf('    fromTaskConfiguration('), source.indexOf('    convertTaskPresentation('));
 const main = Function('return ({' + fetch.trim() + ',' + from.trim() + '})')();
 const f = await fixture(); await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "REAL DTO 42";}\n');
 await createBuildTasks(f.root, await installedCompiler({sysroot:'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',language:'cpp'}));
 const json = JSON.parse(await readFile(join(f.root,'.vscode/tasks.json'),'utf8'));
 main.taskService = {startUserAction:()=>1, getConfiguredTasks:async()=>json.tasks.map(item=>({...item, presentation:undefined, _scope:'file://' + f.root,_source:'Workspace'})),getProvidedTasks:async()=>[]};
 main.taskDefinitionRegistry={getDefinition:()=>undefined};
 const fetched=(await main.$fetchTasks(undefined,'process')).map(converter.toTask);
 assert.equal(fetched.length,2); assert.equal(fetched[0].scope.uri.fsPath,f.root);
 assert.equal(fetched[0].execution instanceof ProcessExecution,false);
 assert.equal(fetched[0].execution.constructor.name,'ShellExecution');
 let fetchCalls=0; f.vscode.tasks.fetchTasks=async()=>{fetchCalls++;return fetched;};
 await f.commands.get('ynx.cpp.runActive')(); assert.deepEqual(f.errors,[]);assert.ok(f.output.includes('REAL DTO 42'));
 f.vscode.window.activeTextEditor={document:f.document}; f.output.length=0;
 // A watcher that has not observed the new file cannot prevent normal first use.
 main.taskService.getConfiguredTasks=async()=>[];f.vscode.tasks.fetchTasks=async()=>{fetchCalls++;return(await main.$fetchTasks()).map(converter.toTask);};
 await f.commands.get('ynx.cpp.runActive')();assert.deepEqual(f.errors,[]);assert.ok(f.output.includes('REAL DTO 42'));assert.equal(fetchCalls,0);
});

test('dirty task editor and config changes during compile never launch an old or new binary',async()=>{
 const f=await fixture();await writeFile(f.path,'int main(){}');
 await createBuildTasks(f.root,await installedCompiler({sysroot:'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',language:'cpp'}));
 const configPath=join(f.root,'.vscode/tasks.json');let executions=0;
 f.vscode.workspace.textDocuments=[{uri:{scheme:'file',fsPath:configPath},isDirty:true}];
 const original=f.vscode.tasks.executeTask;f.vscode.tasks.executeTask=async task=>{executions++;return original(task);};
 await f.commands.get('ynx.cpp.runActive')();assert.equal(executions,0);assert.match(f.errors[0],/Save/);
 f.errors.length=0;f.vscode.workspace.textDocuments=[];f.vscode.window.activeTextEditor={document:f.document};
 f.vscode.tasks.executeTask=async task=>{executions++;const json=JSON.parse(await readFile(configPath));json.tasks[0].detail='user change';await writeFile(configPath,JSON.stringify(json));return original(task);};
 await f.commands.get('ynx.cpp.runActive')();assert.equal(executions,1);assert.match(f.errors[0],/configuration changed/);
});
test('extra fields in otherwise matching user tasks force explicit selection and never run the generated binary',async()=>{
 const f=await fixture();await writeFile(f.path,'int main(){}');
 const {path}=await createBuildTasks(f.root,await installedCompiler({sysroot:'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',language:'cpp'}));
 const config=JSON.parse(await readFile(path));config.tasks[0].detail='my build';await writeFile(path,JSON.stringify(config));
 let asked=false;f.vscode.window.showQuickPick=async(_items,options)=>{asked=/existing project task/.test(options.title);return undefined;};
 f.vscode.tasks.executeTask=async()=>{throw Error('must not execute before explicit choice');};
 await f.commands.get('ynx.cpp.runActive')();assert.equal(asked,true);assert.deepEqual(f.errors,[]);
 assert.equal(JSON.parse(await readFile(path)).tasks[0].detail,'my build');
});
test('first-use debug uses same persisted process build without task discovery and launches captured executable',async()=>{
 const f=await fixture();await writeFile(f.path,'int main(){return 0;}');
 let selected;f.vscode.extensions={getExtension:()=>({activate:async()=>{}})};
 f.vscode.workspace.getConfiguration=()=>({get:()=>'/Library/Developer/CommandLineTools/usr/bin/lldb-dap'});
 f.vscode.tasks.fetchTasks=async()=>{throw Error('task cache must not gate first debug');};
 f.vscode.debug.startDebugging=async(folder,configuration)=>{assert.equal(folder,f.folder);selected=configuration;return true;};
 await f.commands.get('ynx.cpp.debugActive')();assert.deepEqual(f.errors,[]);assert.equal(selected.program,join(f.root,'main'));
 assert.equal(selected.cwd,f.root);assert.equal(selected.preLaunchTask,undefined);assert.ok((await readFile(selected.program)).length>0);
});
test('real TasksExt early process/end lifecycle recreates public execution but settles 127 without kill',async()=>{
 let ext,kills=0;const folder={uri:runtimeRequire('@theia/plugin-ext/lib/plugin/types-impl').URI.file('/private/tmp/project'),name:'project',index:0};
 const task=new Task({type:'process'},folder,'native failed','Workspace',new ProcessExecution('/usr/bin/false',[],{cwd:'/private/tmp'}),[]);
 const proxy={$executeTask:async dto=>{const value={id:42,task:dto};await ext.$onDidStartTask(value,42);ext.$onDidEndTaskProcess(127,42);ext.$onDidEndTask(42);return value;},$terminateTask:()=>{kills++;}};
 ext=new TasksExtImpl({getProxy:()=>proxy},{});
 const token={isCancellationRequested:false,onCancellationRequested:emitter().event};
 assert.equal(await executeAndWait({Task,tasks:ext},task,token),127);assert.equal(kills,0);
 // Task ended before process start must also settle without inventing exit0.
 proxy.$executeTask=async dto=>{const value={id:43,task:dto};await ext.$onDidStartTask(value,43);ext.$onDidEndTask(43);token.isCancellationRequested=true;return value;};
 assert.equal(await executeAndWait({Task,tasks:ext},task,token),undefined);assert.equal(kills,0);
});
for (const difference of ['scope','definition','source','args','marker','missing marker']) test('real TasksExt isolates same-name early '+difference+' task from the pending run',async()=>{
 const {URI}=runtimeRequire('@theia/plugin-ext/lib/plugin/types-impl');let ext,kills=0;
 const task=new Task({type:'process',target:'original'},{uri:URI.file('/private/tmp/own'),name:'own',index:0},'same name','Workspace',new ProcessExecution('/usr/bin/true',[],{cwd:'/private/tmp'}),[]);
 const proxy={$executeTask:async dto=>{
  const other=structuredClone(dto);if(difference==='scope')other.scope='file:///private/tmp/foreign';
  if(difference==='definition')other.target='foreign';if(difference==='source')other.source='Foreign';if(difference==='args')other.args=['foreign'];
  if(difference==='marker')other.__ynxExecutionRequest='other request';if(difference==='missing marker')delete other.__ynxExecutionRequest;
  const foreign={id:81,task:other};await ext.$onDidStartTask(foreign,81);ext.$onDidEndTaskProcess(127,81);ext.$onDidEndTask(81);
  const own={id:82,task:dto};await ext.$onDidStartTask(own,82);
  setImmediate(()=>{ext.$onDidEndTaskProcess(0,82);ext.$onDidEndTask(82);});return own;
 },$terminateTask:()=>{kills++;}};
 ext=new TasksExtImpl({getProxy:()=>proxy},{});
 assert.equal(await executeAndWait({Task,tasks:ext},task,{isCancellationRequested:false,onCancellationRequested:emitter().event}),0);assert.equal(kills,0);
});
test('real TasksExt two identical early completions reject ambiguity without killing already ended tasks',async()=>{
 const {URI}=runtimeRequire('@theia/plugin-ext/lib/plugin/types-impl');let ext,kills=0;
 const task=new Task({type:'process'},{uri:URI.file('/private/tmp/own'),name:'own',index:0},'same','Workspace',new ProcessExecution('/usr/bin/true',[],{cwd:'/private/tmp'}),[]);
 const proxy={$executeTask:async dto=>{for(const id of [91,92]){await ext.$onDidStartTask({id,task:dto},id);ext.$onDidEndTaskProcess(0,id);ext.$onDidEndTask(id);}return{id:92,task:dto};},$terminateTask:()=>{kills++;}};
 ext=new TasksExtImpl({getProxy:()=>proxy},{});
 await assert.rejects(executeAndWait({Task,tasks:ext},task,{isCancellationRequested:false,onCancellationRequested:emitter().event}),/ambiguous/);assert.equal(kills,0);
});
test('request metadata survives real TasksMain DTO methods, backend TaskServer/ProcessTask and late-RPC TasksExt lifecycle',async()=>{
 const source=await readFile(runtimeRequire.resolve('@theia/plugin-ext/lib/main/browser/tasks-main'),'utf8');
 const to=source.slice(source.indexOf('    toTaskConfiguration('),source.indexOf('    fromTaskConfiguration('));
 const from=source.slice(source.indexOf('    fromTaskConfiguration('),source.indexOf('    convertTaskPresentation('));
 const presentation=source.slice(source.indexOf('    convertTaskPresentation('),source.lastIndexOf('\n}'));
 const main=Function('revealKindMap','panelKindMap','return ({'+to.trim()+','+from.trim()+','+presentation.trim()+'})')(new Map([[1,'always'],['always',1]]),new Map([[1,'shared'],['shared',1]]));
 const {TaskServerImpl}=runtimeRequire('@theia/task/lib/node/task-server');
 const {TaskManager}=runtimeRequire('@theia/task/lib/node/task-manager');
 const {ProcessTask}=runtimeRequire('@theia/task/lib/node/process/process-task');
 const {URI}=runtimeRequire('@theia/plugin-ext/lib/plugin/types-impl');
 const logger={debug(){},info(){},warn(){},error(){}};const manager=new TaskManager(logger),server=new TaskServerImpl();
 server.taskManager=manager;server.logger=logger;let ext,completed,finish;const done=new Promise(resolve=>finish=resolve);let seenConfig;
 server.runnerRegistry={getRunner:()=>({run:async config=>{
  seenConfig=config;const child=spawn('/usr/bin/false',[],{stdio:['ignore','pipe','pipe']}),closed=emitter();
  const process={id:7,pid:child.pid,outputStream:child.stdout,onClose:closed.event,kill:()=>child.kill()};
  const native=new ProcessTask(manager,logger,{process,config,command:'/usr/bin/false',context:'local',label:config.label});
  child.on('close',(code,signal)=>closed.fire({code,signal}));return native;
 }})};
 server.clients=[{onTaskCreated:event=>ext.$onDidStartTask({id:event.taskId,task:main.fromTaskConfiguration(event.config)},event.terminalId),
  onDidStartTaskProcess:event=>ext.$onDidStartTaskProcess(event.processId,{id:event.taskId,task:main.fromTaskConfiguration(event.config)}),
  onDidEndTaskProcess:event=>ext.$onDidEndTaskProcess(event.code,event.taskId),onTaskExit:event=>{ext.$onDidEndTask(event.taskId);completed=event.code;finish();}}];
 const proxy={$executeTask:async dto=>{const info=await server.run(main.toTaskConfiguration(dto),'local');await done;return{id:info.taskId,task:main.fromTaskConfiguration(info.config)};},$terminateTask:id=>server.kill(id)};
 ext=new TasksExtImpl({getProxy:()=>proxy},{});
 const task=new Task({type:'process',target:'user target',dependsOn:['build predecessor']},{uri:URI.file('/private/tmp/own'),name:'own',index:0},'user task','User',new ProcessExecution('/usr/bin/false',[],{cwd:'/private/tmp',env:{OWN:'value'}}),['$gcc']);
 task.group={id:'build',isDefault:true};task.presentationOptions={reveal:1};task.runOptions={reevaluateOnRerun:false};task.detail='user detail';
 const result=await executeAndWait({Task,tasks:ext},task,{isCancellationRequested:false,onCancellationRequested:emitter().event});
 assert.equal(result,1);assert.equal(completed,1);assert.match(seenConfig.__ynxExecutionRequest,/^[0-9a-f-]{36}$/);
 assert.equal(task.definition.__ynxExecutionRequest,undefined);assert.deepEqual(seenConfig.dependsOn,['build predecessor']);assert.equal(seenConfig.target,'user target');
 assert.equal(seenConfig.detail,'user detail');assert.deepEqual(seenConfig.options.env,{OWN:'value'});assert.deepEqual(seenConfig.problemMatcher,['$gcc']);assert.equal(seenConfig.group.kind,'build');assert.equal(seenConfig.runOptions.reevaluateOnRerun,false);
 assert.equal(manager.tasks.size,0);server.dispose();
});
test('real TasksExt early success preserves exit0 and native cancellation ends only its own active execution',async()=>{
 const {URI}=runtimeRequire('@theia/plugin-ext/lib/plugin/types-impl');let ext,kills=0;
 const task=new Task({type:'process'},{uri:URI.file('/private/tmp/own'),name:'own',index:0},'own','User',new ProcessExecution('/usr/bin/true'),undefined);
 const cancel=emitter(),token={isCancellationRequested:false,onCancellationRequested:cancel.event};
 const proxy={$executeTask:async dto=>{const value={id:51,task:dto};await ext.$onDidStartTask(value,51);ext.$onDidEndTaskProcess(0,51);ext.$onDidEndTask(51);return value;},$terminateTask:id=>{kills++;ext.$onDidEndTask(id);}};
 ext=new TasksExtImpl({getProxy:()=>proxy},{});
 assert.equal(await executeAndWait({Task,tasks:ext},task,token),0);assert.equal(kills,0);
 proxy.$executeTask=async dto=>{assert.equal(dto.problemMatcher,undefined);const value={id:52,task:dto};await ext.$onDidStartTask(value,52);return value;};
 const pending=executeAndWait({Task,tasks:ext},task,token);await new Promise(resolve=>setImmediate(resolve));
 token.isCancellationRequested=true;cancel.fire();assert.equal(await pending,undefined);assert.equal(kills,1);assert.equal(cancel.count(),0);
});
test('native commented empty Theia launch plus VSCode process tasks debugs captured source twice and preserves launch bytes',async()=>{
 const f=await fixture();await writeFile(f.path,'int main(){return 0;}');await mkdir(join(f.root,'.theia'));
 const launchPath=join(f.root,'.theia/launch.json'),bytes='{\n // Use IntelliSense to learn about possible attributes.\n "version":"0.2.0", "configurations":[]\n}';await writeFile(launchPath,bytes);
 let launches=0;const terminated=emitter();f.vscode.debug.onDidTerminateDebugSession=terminated.event;
 // Re-register to observe the real debug session completion lifecycle.
 registerCppRun(f.vscode,{subscriptions:[]},f.env);
 f.vscode.extensions={getExtension:()=>({activate:async()=>{}})};
 f.vscode.workspace.getConfiguration=()=>({get:()=>'/Library/Developer/CommandLineTools/usr/bin/lldb-dap'});
 f.vscode.tasks.fetchTasks=async()=>{throw Error('empty task discovery must not gate generated build');};
 f.vscode.debug.startDebugging=async(folder,configuration)=>{launches++;assert.equal(configuration.program,join(f.root,'main'));assert.equal(configuration.preLaunchTask,undefined);assert.ok((await readFile(configuration.program)).length>0);return true;};
 for(let i=0;i<2;i++) {f.vscode.window.activeTextEditor={document:f.document};await f.commands.get('ynx.cpp.debugActive')();terminated.fire({workspaceFolder:f.folder,id:'native'});}
 assert.equal(launches,2);assert.deepEqual(f.errors,[]);assert.equal(await readFile(launchPath,'utf8'),bytes);
 await assert.rejects(readFile(join(f.root,'.vscode/launch.json')),{code:'ENOENT'});
});
test('unsaved or edited empty and JS launch configurations never start the transient debug target',async()=>{
 for(const configurations of [[],[{type:'node',request:'launch',name:'JS',program:'${workspaceFolder}/hello.js'}]]) for(const duringBuild of [false,true]) {
  const f=await fixture();await writeFile(f.path,'int main(){}');await mkdir(join(f.root,'.theia'));const path=join(f.root,'.theia/launch.json');await writeFile(path,JSON.stringify({version:'0.2.0',configurations}));
  f.vscode.extensions={getExtension:()=>({activate:async()=>{}})};f.vscode.workspace.getConfiguration=()=>({get:()=>'/Library/Developer/CommandLineTools/usr/bin/lldb-dap'});
  let launched=false;f.vscode.debug.startDebugging=async()=>{launched=true;return true;};
  if(!duringBuild)f.vscode.workspace.textDocuments=[{uri:{scheme:'file',fsPath:path},isDirty:true}];
  else {const execute=f.vscode.tasks.executeTask;f.vscode.tasks.executeTask=async task=>{await writeFile(path,'{"version":"0.2.0","configurations":[{"name":"user target"}]}');return execute(task);};}
  await f.commands.get('ynx.cpp.debugActive')();assert.equal(launched,false);assert.equal(f.errors.length,1);
 }
});

test('mixed JS and existing custom LLDB configurations still select the explicit user target without replacing it',async()=>{
 const f=await fixture();await writeFile(f.path,'int main(){}');await mkdir(join(f.root,'.theia'));
 const custom={type:'lldb-dap',name:'My C++ build',request:'launch',program:'${workspaceFolder}/custom/output',preLaunchTask:'My custom build',args:['user argument']};
 const configurations=[{type:'node',name:'JS',program:'${workspaceFolder}/hello.js'},custom];
 const path=join(f.root,'.theia/launch.json'),bytes=JSON.stringify({version:'0.2.0',configurations});await writeFile(path,bytes);
 f.vscode.extensions={getExtension:()=>({activate:async()=>{}})};
 f.vscode.workspace.getConfiguration=section=>({get:()=>section==='lldb-dap'?'/Library/Developer/CommandLineTools/usr/bin/lldb-dap':configurations});
 let selected,explicit=false;
 f.vscode.window.showQuickPick=async(items,options)=>{if(options.title==='Select the existing project debug configuration'){explicit=true;assert.equal(items.length,1);assert.equal(items[0].configuration,custom);}return items[0];};
 f.vscode.tasks.executeTask=async()=>{throw Error('custom target must keep its own build task');};
 f.vscode.debug.startDebugging=async(_folder,configuration)=>{selected=configuration;return true;};
 await f.commands.get('ynx.cpp.debugActive')();assert.deepEqual(f.errors,[]);assert.equal(explicit,true);assert.match(selected.__ynxCppRunId,/^[a-f0-9-]{36}$/);const {__ynxCppRunId,...actual}=selected;assert.deepEqual(actual,custom);assert.equal(custom.__ynxCppRunId,undefined);assert.equal(await readFile(path,'utf8'),bytes);
});

test('owned LLDB launch failures are shown without blocking or attributing unrelated same-project sessions',async()=>{
 const f=await fixture();await writeFile(f.path,'int main(){}');let factory,tracker,stoppingTracker;
 f.vscode.debug.registerDebugAdapterTrackerFactory=(type,value)=>{assert.equal(type,'lldb-dap');factory=value;return{dispose(){}};};
 registerCppRun(f.vscode,{subscriptions:[]},f.env);
 f.vscode.extensions={getExtension:()=>({activate:async()=>{}})};
 f.vscode.workspace.getConfiguration=()=>({get:()=>'/Library/Developer/CommandLineTools/usr/bin/lldb-dap'});
 f.vscode.window.showInformationMessage=()=>new Promise(()=>{});
 f.vscode.window.showErrorMessage=message=>{f.errors.push(message);return new Promise(()=>{});};
 f.vscode.debug.startDebugging=async(folder,configuration)=>{
  assert.equal(configuration.console,'internalConsole');
  assert.equal(factory.createDebugAdapterTracker({workspaceFolder:folder,configuration:{...configuration,__ynxCppRunId:'foreign'}}),undefined);
  tracker=factory.createDebugAdapterTracker({workspaceFolder:folder,configuration:structuredClone(configuration)});assert.ok(tracker);
  stoppingTracker=factory.createDebugAdapterTracker({workspaceFolder:folder,configuration:structuredClone(configuration)});return true;
 };
 await f.commands.get('ynx.cpp.debugActive')();assert.ok(tracker);
 tracker.onDidSendMessage({type:'response',command:'launch',success:false,body:{error:{format:'native launch failure reason'}}});
 tracker.onError(Error('follow-up connection close'));
 assert.equal(f.errors.length,1);assert.match(f.errors[0],/native launch failure reason/);
 stoppingTracker.onWillStopSession();stoppingTracker.onError(Error('normal disconnect'));assert.equal(f.errors.length,1);
});

test('a mixed JS project can run and debug new C++ twice without replacing its existing launch configuration',async()=>{
 const f=await fixture();await writeFile(f.path,'#include <iostream>\nint main(){std::cout << "MIXED CPP 42";}');await mkdir(join(f.root,'.theia'));
 const launchPath=join(f.root,'.theia/launch.json'),bytes='// Existing JavaScript project\n{"version":"0.2.0","configurations":[{"type":"node","request":"launch","name":"Launch Program","program":"${workspaceFolder}/hello.js"}]}';await writeFile(launchPath,bytes);
 const terminated=emitter();f.vscode.debug.onDidTerminateDebugSession=terminated.event;registerCppRun(f.vscode,{subscriptions:[]},f.env);
 f.vscode.extensions={getExtension:()=>({activate:async()=>{}})};
 f.vscode.workspace.getConfiguration=section=>({get:(_key,fallback)=>section==='lldb-dap'?'/Library/Developer/CommandLineTools/usr/bin/lldb-dap':fallback});
 f.vscode.Uri={file:path=>({fsPath:path})};f.vscode.workspace.openTextDocument=async()=>({});f.vscode.window.showTextDocument=async()=>{};
 let launches=0,emptyPickers=0,compilerChoices=0;
 f.vscode.window.showQuickPick=async(items,options)=>{if(!items.length)emptyPickers++;if(options.title==='Select C/C++ compiler')compilerChoices++;return items[0];};
 f.vscode.tasks.fetchTasks=async()=>{throw Error('unobserved task cache must not gate generated build');};
 f.vscode.debug.startDebugging=async(folder,configuration)=>{launches++;assert.equal(configuration.type,'lldb-dap');assert.equal(configuration.program,join(f.root,'main'));assert.equal(configuration.preLaunchTask,undefined);assert.ok((await readFile(configuration.program)).length>0);return true;};
 for(let i=0;i<2;i++) {
  f.vscode.window.activeTextEditor={document:f.document};await f.commands.get('ynx.cpp.runActive')();
  f.vscode.window.activeTextEditor={document:f.document};await f.commands.get('ynx.cpp.debugActive')();terminated.fire({workspaceFolder:f.folder,id:'mixed'});
 }
 assert.deepEqual(f.errors,[]);assert.equal(emptyPickers,0);assert.equal(launches,2);assert.equal(compilerChoices,1);assert.equal(f.output.filter(text=>text==='MIXED CPP 42').length,2);
 assert.equal(await readFile(launchPath,'utf8'),bytes);await assert.rejects(readFile(join(f.root,'.vscode/launch.json')),{code:'ENOENT'});
});
test('F5 generated C++ target rejects a Python editor before build and offers its real debugger without waiting for notification dismissal',async()=>{
 const f=await fixture(),tool=await installedCompiler({sysroot:'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',language:'cpp'});
 const tasks=await createBuildTasks(f.root,tool),launch=await createLaunchConfiguration(f.root,tasks.path,'cpp');
 const originalTasks=await readFile(tasks.path),originalLaunch=await readFile(launch.path);let provider,choose;const executed=[];
 f.vscode.debug.registerDebugConfigurationProvider=(type,value)=>{assert.equal(type,'lldb-dap');provider=value;return{dispose(){}};};
 f.vscode.window.showErrorMessage=(_message,...actions)=>{assert.ok(actions.includes('Debug Python File'));return new Promise(resolve=>choose=resolve);};
 f.vscode.commands.executeCommand=async name=>{assert.equal(f.vscode.window.activeTextEditor.document,f.document);executed.push(name);};
 const revealed=[];f.vscode.window.showTextDocument=async(uri,options)=>{assert.equal(uri,f.document.uri);assert.equal(options.preserveFocus,false);revealed.push(uri);const editor={document:f.document};f.vscode.window.activeTextEditor=editor;return editor;};
 registerCppRun(f.vscode,{subscriptions:[]},f.env);
 f.document.languageId='python';f.document.uri.fsPath=join(f.root,'hello.py');await writeFile(f.document.uri.fsPath,'print(42)');await writeFile(join(f.root,'hello'),'KEEP PREVIOUS OUTPUT');
 // Exercise retained Theia's exact F5 noDebug=false injection and resolver
 // chain (without loading its unrelated DOM-rendering dependencies in Node).
 const frontend=await readFile(runtimeRequire.resolve('@theia/debug/lib/browser/debug-frontend-application-contribution'),'utf8');
 const service=await readFile(runtimeRequire.resolve('@theia/plugin-ext/lib/main/browser/debug/plugin-debug-service'),'utf8');
 const method=(text,begin,end)=>vm.runInNewContext('({' + text.slice(text.indexOf(begin),text.indexOf(end,text.indexOf(begin))) + '})');
 const start=method(frontend,'    async start(noDebug, debugSessionOptions) {','    async runTo(').start;
 const chain=method(service,'    async resolveDebugConfigurationByResolversChain(config, workspaceFolderUri, resolvers) {','    registerDebugger(').resolveDebugConfigurationByResolversChain;
 let incoming,result;
 await start.call({configurations:{current:{configuration:launch.configuration}},manager:{start:async options=>{incoming=options.configuration;result=await chain.call({logger:{error:e=>{throw e}}},incoming,f.folder,[(folder,config)=>provider.resolveDebugConfiguration(folder,{...config,__sessionId:'framework',debugAdapterExecutable:'/official/lldb-dap'})]);}}},false);
 assert.equal(incoming.noDebug,false);assert.equal(result,undefined);
 const managerSource=await readFile(runtimeRequire.resolve('@theia/debug/lib/browser/debug-session-manager'),'utf8');
 const managerStart=vm.runInNewContext('({' + managerSource.slice(managerSource.indexOf('    async startConfiguration(options) {'),managerSource.indexOf('    async startCompound(options) {')) + '})', {core_1:{nls:{localizeByDefault:value=>value}}}).startConfiguration;
 let opened=0;
 const manager={workspaceTrustService:{requestWorkspaceTrust:async()=>true},progressService:{withProgress:(_title,_area,fn)=>fn()},saveAll:async()=>true,fireWillStartDebugSession:async()=>{},resolveConfiguration:async()=>result,debugConfigurationManager:{openConfiguration:()=>opened++}};
 await managerStart.call(manager,{configuration:incoming});assert.equal(opened,0);
 // Prove this executes the retained manager's null/open behavior as well.
 await managerStart.call({...manager,resolveConfiguration:async()=>null},{configuration:incoming});assert.equal(opened,1);
 assert.equal(await readFile(join(f.root,'hello'),'utf8'),'KEEP PREVIOUS OUTPUT');assert.equal(executed.length,0);
 f.vscode.window.activeTextEditor={document:{languageId:'jsonc',uri:{fsPath:launch.path}}};
 choose('Debug Python File');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(executed,['debugpy.debugInTerminal']);assert.equal(revealed.length,1);
 // A later user action must not start work after trust/workspace changes.
 await provider.resolveDebugConfiguration(f.folder,launch.configuration);f.vscode.workspace.isTrusted=false;choose('Debug Python File');await new Promise(resolve=>setImmediate(resolve));assert.equal(executed.length,1);assert.equal(revealed.length,1);f.vscode.workspace.isTrusted=true;
 assert.deepEqual(await readFile(tasks.path),originalTasks);assert.deepEqual(await readFile(launch.path),originalLaunch);
 f.document.languageId='cpp';assert.equal(await provider.resolveDebugConfiguration(f.folder,launch.configuration),launch.configuration);
 const custom={...launch.configuration,program:'/explicit/project/target'};f.document.languageId='python';assert.equal(await provider.resolveDebugConfiguration(f.folder,custom),custom);
 const config=JSON.parse(originalTasks);config.tasks[0].args[config.tasks[0].args.indexOf('${file}')]='main.cpp';await writeFile(tasks.path,JSON.stringify(config));assert.equal(await provider.resolveDebugConfiguration(f.folder,launch.configuration),launch.configuration);
});

test('clean extension mirror still crosses actual document save RPC before compiling current visible source',async t=>{
 const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));await writeFile(f.path,'#include <iostream>\nint main(){std::cout<<"STALE_DISK";}');
 const {DocumentDataExt}=runtimeRequire('@theia/plugin-ext/lib/plugin/document-data');
 let enter,release,saves=0,executions=0;const reached=new Promise(ok=>enter=ok),gate=new Promise(ok=>release=ok);
 f.document.save=()=>DocumentDataExt.prototype.save.call({disposed:false,uri:f.document.uri,proxy:{$trySaveDocument:async()=>{saves++;enter();await gate;await writeFile(f.path,'#include <iostream>\nint main(){std::cout<<"CURRENT_EDITOR";}');f.document.version++;return true;}}});
 const execute=f.vscode.tasks.executeTask;f.vscode.tasks.executeTask=task=>{executions++;return execute(task)};
 const running=f.commands.get('ynx.cpp.runActive')();
 // No timing sleep: the first observable boundary must be the save RPC.
 await Promise.race([reached,running.then(()=>{throw Error('Run skipped current editor save RPC')})]);
 assert.equal(executions,0);assert.equal(f.document.isDirty,false);release();await running;
 assert.equal(saves,1);assert.deepEqual(f.errors,[]);assert.ok(f.output.includes('CURRENT_EDITOR'));assert.ok(!f.output.includes('STALE_DISK'));
});
test('save cancellation or failure never compiles an old file even when extension mirror says clean',async t=>{
 for(const kind of ['cancel','failure']){const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));await writeFile(f.path,'int main(){}');let executions=0;f.document.save=async()=>{if(kind==='failure')throw Error('Save permission failure');return false};f.vscode.tasks.executeTask=async()=>{executions++;throw Error('Unexpected compile')};await f.commands.get('ynx.cpp.runActive')();assert.equal(executions,0);assert.equal(f.errors.length,1);}
});
