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
 const document={uri:{scheme:'file',fsPath:join(root,'Counter.sol')},version:1,isDirty:false,save:async()=>true};await writeFile(document.uri.fsPath,'contract Counter {}');
 class ProcessExecution{constructor(command,args,options){Object.assign(this,{command,args,options});}}
 class Task{constructor(definition,scope,name,source,execution){Object.assign(this,{definition,scope,name,source,execution});}}
 const api={workspace:{workspaceFolders:[folder],isTrusted:true,textDocuments:[document],saveAll:async()=>true},window:{showQuickPick:async options=>options[0]},ProcessExecution,Task,TaskRevealKind:{Always:1},TaskPanelKind:{Dedicated:2},tasks:{onDidEndTask:fn=>{onEnd=fn;return{dispose(){}};},executeTask:async task=>{const execution={task,terminated:0,terminate(){this.terminated++;}};calls.push(execution);return execution;}}};
 const app=createEvmProject(api,{subscriptions},{YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:root});
 async function hardhat(version='3.0.0'){await writeFile(join(root,'hardhat.config.ts'),'export default {};');const dir=join(root,'node_modules/hardhat');await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({name:'hardhat',version,bin:{hardhat:'cli.cjs'}}));await writeFile(join(dir,'cli.cjs'),'');}
 try{await fn({root,api,app,calls,document,hardhat,end:execution=>onEnd({execution}),dispose:()=>subscriptions.forEach(s=>s.dispose())});}finally{app.cancel();await rm(root,{recursive:true,force:true});}
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
 await assert.rejects(f.app.build(),/No Foundry/);await writeFile(join(f.root,'hardhat.config.js'),'');await assert.rejects(f.app.build(),/not installed/);await writeFile(join(f.root,'foundry.toml'),'');f.document.save=async()=>false;await assert.rejects(f.app.build(),/Save/);f.api.workspace.isTrusted=false;await assert.rejects(f.app.build(),/trusted/);assert.equal(f.calls.length,0);
}));
test('Hardhat executable symlink outside project is refused',()=>fixture(async f=>{
 await f.hardhat();const cli=join(f.root,'node_modules/hardhat/cli.cjs');await rm(cli);await symlink(process.execPath,cli);await assert.rejects(f.app.build(),/outside its package/);assert.equal(f.calls.length,0);
}));

test('Stop waits for matching end; unrelated end cannot unlock the project',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');await f.app.build();f.app.cancel();f.app.cancel();assert.equal(f.calls[0].terminated,1);await assert.rejects(f.app.test(),/already running/);f.end({terminate(){}});await assert.rejects(f.app.build(),/already running/);f.end(f.calls[0]);await f.app.test();assert.equal(f.calls.length,2);
}));

test('EVM saves only the admitted project and does not use the global save gate',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const saved=[];f.document.save=async()=>{saved.push('project');return true;};
 f.api.workspace.textDocuments.push({uri:{scheme:'file',fsPath:join(f.root,'..','foreign.sol')},save:async()=>{saved.push('foreign');return false;}});
 f.api.workspace.saveAll=async()=>{saved.push('global');return false;};await f.app.build();assert.deepEqual(saved,['project']);assert.equal(f.calls.length,1);
}));

test('EVM cancellation retires a pending save before its reply and permits retry',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');let reply,result;const save=()=>new Promise(resolve=>reply=resolve);f.document.save=save;f.api.workspace.saveAll=save;
 const pending=f.app.build().then(()=>{result='unexpected';},e=>{result=e.message;});while(!reply)await new Promise(r=>setImmediate(r));f.app.cancel();
 try{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.match(result||'',/cancelled/);
  f.document.save=async()=>false;f.api.workspace.saveAll=async()=>false;await assert.rejects(f.app.build(),/Save/);reply(true);await pending;assert.equal(f.calls.length,0);
 }finally{reply(false);await pending;}
}));

test('EVM disposal retires the save request without awaiting its late reply',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');let reply;f.document.save=()=>new Promise(resolve=>reply=resolve);
 const pending=f.app.build().then(()=> 'unexpected',e=>e.message);while(!reply)await new Promise(r=>setImmediate(r));f.dispose();assert.match(await pending,/cancelled/);
 reply(true);await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,0);
}));

test('EVM preserves the original save failure and permits a normal retry',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const failure=Object.assign(Error('document RPC failed'),{code:'ENOENT'});f.document.save=async()=>{throw failure;};
 await assert.rejects(f.app.build(),e=>e===failure);assert.equal(f.calls.length,0);f.document.save=async()=>true;await f.app.build();assert.equal(f.calls.length,1);
}));

test('EVM closed, dirty or moved documents cannot launch a build after saving',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const original=f.document.uri.fsPath;
 for(const state of ['closed','dirty','moved']){
  f.document.isClosed=false;f.document.isDirty=false;f.document.uri.fsPath=original;
  f.document.save=async()=>{f.document.isClosed=state==='closed';f.document.isDirty=state==='dirty';if(state==='moved')f.document.uri.fsPath=join(f.root,'Other.sol');return true;};
  await assert.rejects(f.app.build(),/files changed after saving/);assert.equal(f.calls.length,0);
 }
 f.document.isClosed=false;f.document.isDirty=false;f.document.uri.fsPath=original;f.document.save=async()=>true;await f.app.build();assert.equal(f.calls.length,1);
}));

test('EVM late cancelled save cannot release or terminate a newer owned build',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');let reply;f.document.save=()=>new Promise(resolve=>reply=resolve);const first=f.app.build().then(()=> 'unexpected',e=>e.message);
 while(!reply)await new Promise(r=>setImmediate(r));f.app.cancel();assert.match(await first,/cancelled/);f.document.save=async()=>true;await f.app.build();const newer=f.calls[0];
 reply(true);await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);assert.equal(newer.terminated,0);await assert.rejects(f.app.build(),/already running/);
 f.app.cancel();assert.equal(newer.terminated,1);await assert.rejects(f.app.build(),/already running/);f.end(newer);await f.app.build();assert.equal(f.calls.length,2);
}));

test('EVM changed saved source during a later configuration save never launches',()=>fixture(async f=>{
 const config=join(f.root,'foundry.toml');await writeFile(config,'');f.api.workspace.textDocuments.push({uri:{scheme:'file',fsPath:config},version:1,isDirty:false,save:async()=>{f.document.version++;return true;}});
 await assert.rejects(f.app.build(),/files changed after saving/);assert.equal(f.calls.length,0);
}));

test('EVM trust loss or a project switch during saving refuses continuation',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const folders=f.api.workspace.workspaceFolders;
 f.document.save=async()=>{f.api.workspace.isTrusted=false;return true;};await assert.rejects(f.app.build(),/trusted/);assert.equal(f.calls.length,0);
 f.api.workspace.isTrusted=true;f.document.save=async()=>{f.api.workspace.workspaceFolders=[];return true;};await assert.rejects(f.app.build(),/project changed/);assert.equal(f.calls.length,0);
 f.api.workspace.workspaceFolders=folders;f.document.save=async()=>true;await f.app.build();assert.equal(f.calls.length,1);
}));

test('EVM refuses a linked foreign document before saving its contents',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');const outside=await mkdtemp(join(tmpdir(),'ynx-evm-foreign-'));try{
  const target=join(outside,'secret.sol'),linked=join(f.root,'linked.sol');await writeFile(target,'untouched');await symlink(target,linked);let saves=0;
  f.api.workspace.textDocuments.push({uri:{scheme:'file',fsPath:linked},version:1,isDirty:true,save:async()=>{saves++;return true;}});
  await assert.rejects(f.app.build(),/outside this project/);assert.equal(saves,0);assert.equal(f.calls.length,0);assert.equal(await readFile(target,'utf8'),'untouched');
 }finally{await rm(outside,{recursive:true,force:true});}
}));

test('EVM cancellation before queued project saving prevents the save RPC',()=>fixture(async f=>{
 await writeFile(join(f.root,'foundry.toml'),'');let saves=0;f.document.save=async()=>{saves++;return true;};const pending=f.app.build();f.app.cancel();
 await assert.rejects(pending,/cancelled/);assert.equal(saves,0);assert.equal(f.calls.length,0);
}));
