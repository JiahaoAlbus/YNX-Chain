import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,realpath,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const {createEvmProject}=createRequire(import.meta.url)('./evm-project.cjs');
async function fixture(fn){
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-evm-'))), calls=[], subscriptions=[];
 const folder={uri:{scheme:'file',fsPath:root}};let onEnd;
 class ProcessExecution{constructor(command,args,options){Object.assign(this,{command,args,options});}}
 class Task{constructor(definition,scope,name,source,execution){Object.assign(this,{definition,scope,name,source,execution});}}
 const api={workspace:{workspaceFolders:[folder],isTrusted:true,saveAll:async()=>true},window:{showQuickPick:async options=>options[0]},ProcessExecution,Task,TaskRevealKind:{Always:1},TaskPanelKind:{Dedicated:2},tasks:{onDidEndTask:fn=>{onEnd=fn;return{dispose(){}};},executeTask:async task=>{const execution={task,terminated:0,terminate(){this.terminated++;}};calls.push(execution);return execution;}}};
 const app=createEvmProject(api,{subscriptions},{YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:root});
 async function hardhat(version='3.0.0'){await writeFile(join(root,'hardhat.config.ts'),'export default {};');const dir=join(root,'node_modules/hardhat');await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({name:'hardhat',version,bin:{hardhat:'cli.cjs'}}));await writeFile(join(dir,'cli.cjs'),'');}
 try{await fn({root,api,app,calls,hardhat,end:execution=>onEnd({execution}),dispose:()=>subscriptions.forEach(s=>s.dispose())});}finally{app.cancel();await rm(root,{recursive:true,force:true});}
}
test('Foundry uses owned terminal task, offline flag, preserves configuration, allows repeat after exit',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'[profile.default]\n');await mkdir(join(f.root,'.vscode'));const file=join(f.root,'.vscode/tasks.json');await writeFile(file,'{"tasks":[]}');
 await f.app.build();assert.deepEqual(f.calls[0].task.execution.args,['build','--offline']);assert.equal(f.calls[0].task.execution.command,'forge');
 await assert.rejects(f.app.test(),/already running/);f.end(f.calls[0]);await f.app.test();assert.deepEqual(f.calls[1].task.execution.args,['test','--offline']);assert.equal(await readFile(file,'utf8'),'{"tasks":[]}');f.app.cancel();assert.equal(f.calls[1].terminated,1);
}));
test('Hardhat 2 compile and Hardhat 3 build use existing local package without npx/install',()=>fixture(async f=>{
 await f.hardhat('2.26.0');await f.app.build();assert.equal(f.calls[0].task.execution.command,process.execPath);assert.equal(f.calls[0].task.execution.args[1],'compile');f.end(f.calls[0]);
 await f.hardhat();await f.app.build();assert.equal(f.calls[1].task.execution.args[1],'build');f.end(f.calls[1]);await f.app.test();assert.equal(f.calls[2].task.execution.args[1],'test');
}));
test('early task exit cannot leave a permanent active task',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const execute=f.api.tasks.executeTask;f.api.tasks.executeTask=async task=>{const e=await execute(task);f.end(e);return e;};await f.app.build();await f.app.build();assert.equal(f.calls.length,2);
}));
test('cancel during execute terminates only late owned result, then retry works',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const execute=f.api.tasks.executeTask;let resolve;
 f.api.tasks.executeTask=async task=>{const e=await execute(task);return new Promise(r=>resolve=()=>r(e));};const pending=f.app.build();while(!resolve)await new Promise(r=>setImmediate(r));f.app.cancel();resolve();await pending;assert.equal(f.calls[0].terminated,1);f.api.tasks.executeTask=execute;await assert.rejects(f.app.build(),/already running/);f.end(f.calls[0]);await f.app.build();assert.equal(f.calls.length,2);
}));
test('trust revoked while task starts terminates the owned execution',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const execute=f.api.tasks.executeTask;f.api.tasks.executeTask=async task=>{const e=await execute(task);f.api.workspace.isTrusted=false;return e;};await assert.rejects(f.app.build(),/trusted/);assert.equal(f.calls[0].terminated,1);
}));
test('missing project, missing package, rejected save and trust do not launch tasks',()=>fixture(async f=>{
 await assert.rejects(f.app.build(),/No Foundry/);await writeFile(join(f.root,'hardhat.config.js'),'');await assert.rejects(f.app.build(),/not installed/);await writeFile(join(f.root,'foundry.toml'),'');f.api.workspace.saveAll=async()=>false;await assert.rejects(f.app.build(),/Save/);f.api.workspace.isTrusted=false;await assert.rejects(f.app.build(),/trusted/);assert.equal(f.calls.length,0);
}));
test('Hardhat executable symlink outside project is refused',()=>fixture(async f=>{
 await f.hardhat();const cli=join(f.root,'node_modules/hardhat/cli.cjs');await rm(cli);await symlink(process.execPath,cli);await assert.rejects(f.app.build(),/outside its package/);assert.equal(f.calls.length,0);
}));

test('Stop waits for matching end; unrelated end cannot unlock the project',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');await f.app.build();f.app.cancel();f.app.cancel();assert.equal(f.calls[0].terminated,1);await assert.rejects(f.app.test(),/already running/);f.end({terminate(){}});await assert.rejects(f.app.build(),/already running/);f.end(f.calls[0]);await f.app.test();assert.equal(f.calls.length,2);
}));
