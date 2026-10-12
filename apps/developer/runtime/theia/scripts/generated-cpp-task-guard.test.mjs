import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
require('reflect-metadata');
const roots=[];test.after(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});
const {GeneratedCppTaskGuard}=require('../../ynx-workbench/lib/generated-cpp-task-guard');
const {taskConfiguration}=require('../../../native/ynx-cpp/src/build-tasks.cjs');
const code=await readFile(require.resolve('@theia/task/lib/browser/process/process-task-resolver'),'utf8');
const ActualResolver=vm.runInNewContext('('+code.slice(code.indexOf('class ProcessTaskResolver'),code.indexOf('\n};',code.indexOf('class ProcessTaskResolver'))+2)+')',{uri_1:{default:require('@theia/core/lib/common/uri').default}});
const configCode=await readFile(require.resolve('@theia/task/lib/browser/task-configurations'),'utf8');
const ActualConfigurations=vm.runInNewContext('('+configCode.slice(configCode.indexOf('class TaskConfigurations'),configCode.indexOf('\n};',configCode.indexOf('class TaskConfigurations'))+2)+')',{common_1:require('@theia/task/lib/common')});
async function fixture(language='cpp') {
 const root=await mkdtemp('/private/tmp/ynx-task-language-'),source=root+'/hello.'+(language==='c'?'c':'cpp');
 roots.push(root);
 const raw=taskConfiguration({language,compiler:'/Library/Developer/CommandLineTools/usr/bin/'+(language==='c'?'clang':'clang++'),sdk:'/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk'}).tasks;
 const state={raw,source},messages=[],actions=[];const resolver=new ActualResolver();
 resolver.variableResolverService={resolve:async value=>Array.isArray(value)?Promise.all(value.map(x=>resolver.variableResolverService.resolve(x))):typeof value==='string'?value.replaceAll('${file}',state.source).replaceAll('${fileDirname}',root).replaceAll('${fileBasenameNoExtension}',state.source.split('/').pop().replace(/\.[^.]+$/,'')):value};
 const configurations=Object.create(ActualConfigurations.prototype);configurations.rawTaskConfigurations=new Map([['file://'+root,raw]]);configurations.taskDefinitionRegistry={getDefinition:()=>undefined};
 const guard=new GeneratedCppTaskGuard(resolver,configurations,{error:(...args)=>{messages.push(args);return new Promise(()=>{});}},{executeCommand:async id=>actions.push(id)},'en');
 const task=index=>configurations.getTransformedRawTask(state.raw[index],'file://'+root);
 await writeFile(root+'/hello','KEEP PREVIOUS OUTPUT');return{guard,resolver,state,root,task,messages,actions};
}
test('real process resolver admits generated C/C++ builds and run dependencies with framework metadata',async()=>{
 for(const language of ['c','cpp']){const f=await fixture(language);const build=await f.guard.resolveTask(f.task(0));assert.equal(build.args[6],f.state.source);assert.equal(build.args[8],f.root+'/hello');const run=await f.guard.resolveTask(f.task(1));assert.equal(run.command,f.root+'/hello');assert.equal(run.args,undefined);}
});
test('Python active file blocks both direct build and dependent run without touching same-basename output',async()=>{
 const f=await fixture();f.state.source=f.root+'/hello.py';
 for(const index of [0,1])await assert.rejects(f.guard.resolveTask(f.task(index)),/does not match/);
 assert.equal(await readFile(f.root+'/hello','utf8'),'KEEP PREVIOUS OUTPUT');assert.equal(f.messages.length,2);assert.ok(f.messages[0].includes('Debug Python File'));
});
test('user task changes, fixed sources and other task types retain mature resolver behavior',async()=>{
 for(const edit of [raw=>raw[0].args[6]='main.cpp',raw=>raw[0].options.env={USER_OPTION:'yes'},raw=>raw[0].type='shell']){
 const f=await fixture();edit(f.state.raw);f.state.source=f.root+'/hello.py';const result=await f.guard.resolveTask(f.task(0));assert.equal(result.command,f.state.raw[0].command);assert.equal(f.messages.length,0);}
});
test('configuration changes during async variable resolution cancel admission',async()=>{
 const f=await fixture(),resolve=f.resolver.variableResolverService.resolve;let changed=false;
 f.resolver.variableResolverService.resolve=async value=>{if(!changed){changed=true;f.state.raw[0].args[0]='-std=c++20';}return resolve(value);};
 await assert.rejects(f.guard.resolveTask(f.task(0)),/configuration changed/);assert.match(f.messages[0][0],/cancelled/);
});
test('mature TaskService resolving a mismatched generated task never reaches runResolvedTask',async()=>{
 const f=await fixture();f.state.source=f.root+'/hello.py';
 const serviceCode=await readFile(require.resolve('@theia/task/lib/browser/task-service'),'utf8');
 const start=serviceCode.indexOf('    async doRunTask(task, option) {'),end=serviceCode.indexOf('\n    /**',start);
 const method=vm.runInNewContext('({'+serviceCode.slice(start,end)+'})').doRunTask;
 const service={addRecentTasks(){},taskResolverRegistry:{getTaskResolver:async()=>undefined,getExecutionResolver:()=>f.guard},removeProblemMarkers:async()=>assert.fail('must stop before markers/run'),runResolvedTask:async()=>assert.fail('must not execute compiler'),logger:{error(){}}};
 assert.equal(await method.call(service,f.task(0)),undefined);assert.equal(await method.call(service,f.task(1)),undefined);
});
