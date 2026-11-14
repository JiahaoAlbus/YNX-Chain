import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,stat,writeFile,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadWorkspaceSessionKey} from '../src/session-key.mjs';
test('normal standalone entry persists project and task output across process restart and protects private state',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-normal-entry-')),external=await mkdtemp(join(tmpdir(),'ynx-unselected-input-'));await writeFile(join(external,'unselected.txt'),'PUBLIC_QA_NON_SECRET');let child,base,errors='';
 const env={...process.env,PORT:'0',YNX_CODE_STATE_DIR:root};delete env.YNX_CODE_WORKSPACE_SESSION_KEY;
 async function start(){child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});errors='';child.stderr.on('data',bytes=>{errors+=String(bytes);});
  base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Normal workspace startup timed out: '+errors)),10000);child.once('exit',()=>{clearTimeout(timer);reject(Error('Normal workspace service exited: '+errors));});child.stdout.on('data',bytes=>{output+=String(bytes);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
 }
 async function stop(){if(!child)return;const process=child;child=undefined;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.kill('SIGKILL');reject(Error('Owned QA server did not drain'));},8000);process.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Owned QA service shutdown failed: '+errors));});process.kill('SIGTERM');});}
 t.after(async()=>{await stop();await rm(root,{recursive:true,force:true});await rm(external,{recursive:true,force:true});});await start();
 const health=await fetch(base+'/runtime/health'),cookie=health.headers.get('set-cookie').split(';')[0];assert.equal((await health.json()).workspacePersistence,'sqlite-wal');
 const headers={cookie,'content-type':'application/json'},project='normal-entry-project';
 const source='console.log("NORMAL_ENTRY_OUTPUT")';
 const saved=await fetch(`${base}/runtime/workspaces/${project}`,{method:'PUT',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',expectedRevision:0,idempotencyKey:'normal-entry-first-save',workspace:{name:'normal entry',files:{'main.js':source},folders:[],open:['main.js'],active:'main.js'}})});assert.equal(saved.status,200,await(saved.status===200?Promise.resolve(''):saved.text()));
 const run=await fetch(base+'/runtime/tasks',{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId:project,activePath:'main.js',files:{'main.js':source},approval:'execute-once'})});const result=await run.json();assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.output,/NORMAL_ENTRY_OUTPUT/);
 for(const [path,contents,marker] of [
  ['源码/你好.js','console.log("NORMAL_ENTRY_UNICODE")','NORMAL_ENTRY_UNICODE'],
  ['hello.ts','const word: string = "NORMAL_ENTRY_TYPESCRIPT"; console.log(word);','NORMAL_ENTRY_TYPESCRIPT'],
  ['hello.py','print("NORMAL_ENTRY_PYTHON")','NORMAL_ENTRY_PYTHON'],
  ['hello.go','package main\nimport "fmt"\nfunc main(){fmt.Println("NORMAL_ENTRY_GO")}','NORMAL_ENTRY_GO'],
  ['hello.cpp','#include <iostream>\nint main(){std::cout << "NORMAL_ENTRY_CPP" << std::endl;}','NORMAL_ENTRY_CPP']
 ]) {
  const task=await fetch(base+'/runtime/tasks',{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId:project,activePath:path,files:{[path]:contents},approval:'execute-once'})});const output=await task.json();assert.equal(output.ok,true,path+': '+JSON.stringify(output));assert.match(output.output,new RegExp(marker));
 }
 // A failed process must retain its real cause and leave the normal entry reusable.
 const fault=await fetch(base+'/runtime/tasks',{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId:project,activePath:'fail.js',files:{'fail.js':'console.log("BEFORE_SIGNAL");process.kill(process.pid,"SIGTERM");'},approval:'execute-once'})});const failure=await fault.json();assert.equal(failure.ok,false);assert.equal(failure.code,143);assert.match(failure.output,/BEFORE_SIGNAL[\s\S]*Process terminated by SIGTERM/);assert.doesNotMatch(failure.output,/timed out/);
 const retry=await fetch(base+'/runtime/tasks',{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId:project,activePath:'main.js',files:{'main.js':source},approval:'execute-once'})});assert.equal((await retry.json()).ok,true);
 const compiled=await fetch(base+'/runtime/tasks',{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId:project,activePath:'Hello.sol',files:{'Hello.sol':'pragma solidity >=0.8.20 <0.9.0; contract Hello { function value() public pure returns(uint){return 7;} }'},approval:'execute-once'})});const solidity=await compiled.json();assert.equal(solidity.ok,true,JSON.stringify(solidity));assert.ok(solidity.artifacts.some(file=>file.path.endsWith('.abi')));
 const blockedSource=`try {require('node:fs').readFileSync(${JSON.stringify(join(root,'workspace-session.key'))});console.log('PRIVATE_STATE_READ');} catch(e) {console.log('PRIVATE_STATE_DENIED:'+e.code);}`;
 const privacy=await fetch(base+'/runtime/tasks',{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId:project,activePath:'check.js',files:{'check.js':blockedSource},approval:'execute-once'})});const checked=await privacy.json();assert.equal(checked.ok,true,JSON.stringify(checked));assert.doesNotMatch(checked.output,/PRIVATE_STATE_READ/);assert.match(checked.output,/PRIVATE_STATE_DENIED:(EPERM|EACCES|ENOENT)/);
 const unselectedSource=`try{require('node:fs').readFileSync(${JSON.stringify(join(external,'unselected.txt'))});console.log('UNSELECTED_READ');}catch(e){console.log('UNSELECTED_DENIED:'+e.code);}`;
 const unselected=await fetch(base+'/runtime/tasks',{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId:project,activePath:'check.js',files:{'check.js':unselectedSource},approval:'execute-once'})});const denied=await unselected.json();assert.equal(denied.ok,true,JSON.stringify(denied));assert.doesNotMatch(denied.output,/UNSELECTED_READ/);assert.match(denied.output,/UNSELECTED_DENIED:(EPERM|EACCES|ENOENT)/);
 assert.equal((await stat(join(root,'workspace-session.key'))).mode&0o777,0o600);
 await stop();await start();
 const reopened=await fetch(`${base}/runtime/workspaces/${project}`,{headers});assert.equal(reopened.status,200);assert.equal((await reopened.json()).workspace.files['main.js'],source);
 const observation=await fetch(`${base}/runtime/tasks/${result.taskId}`,{headers});assert.equal(observation.status,200);assert.match((await observation.json()).task.outcome.result.output,/NORMAL_ENTRY_OUTPUT/);
});
test('existing desktop cookie key format is retained, concurrent startup agrees and symlink is refused',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-key-format-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'workspace-session.key');
 const keys=await Promise.all([loadWorkspaceSessionKey(path),loadWorkspaceSessionKey(path)]);assert.equal(keys[0],keys[1]);assert.match(keys[0],/^[a-f0-9]{64}$/);
 const existing='c'.repeat(64);await writeFile(path,existing+'\n');assert.equal(await loadWorkspaceSessionKey(path),existing);assert.equal(await readFile(path,'utf8'),existing+'\n');
 await symlink(path,join(root,'alias.key'));await assert.rejects(loadWorkspaceSessionKey(join(root,'alias.key')));assert.equal(await readFile(path,'utf8'),existing+'\n');
});
