import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createWorkspaceRuntime} from '../src/runtime.mjs';
import {createWorkspaceStore} from '../../workspace-manager/src/store.mjs';
import {pinnedCompilerCLI} from '../../../scripts/compiler-pin.mjs';
import {createWorkspaceFileSave,resumeWorkspaceFileSave} from '../../../frontend/src/runtime/fileSave.ts';

test('normal local API project journey saves, streams real output, stops, retries and restores the same project after reopen',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-product-local-flow-')),sessionKey=randomBytes(32);
 let runtime,store,server,base;
 async function open(){
  store=createWorkspaceStore({filename:join(root,'workspace.sqlite')});
  runtime=createWorkspaceRuntime({root:join(root,'runtime'),workspaceStore:store,guestAdmissionFilename:join(root,'guest.sqlite'),sessionKey,concurrency:1});
  server=createServer((req,res)=>runtime.handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
 }
 async function close(){if(!server)return;runtime.cancelAll();await new Promise(resolve=>server.close(resolve));runtime.closeAdmission();store.close();server=undefined;}
 t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
 await open();
 const health=await fetch(`${base}/runtime/health`),cookie=health.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Normal health admission must issue the session cookie');
 const headers={cookie,'content-type':'application/json'},projectId='normal-local-flow';
 let revision=0,savedFiles={};
 async function save(source,path='main.js'){const workspace={name:'Local real flow',files:{...savedFiles,[path]:source},folders:[],open:[path],active:path};const r=await fetch(`${base}/runtime/workspaces/${projectId}`,{method:'PUT',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',expectedRevision:revision,idempotencyKey:crypto.randomUUID(),workspace})});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));revision=body.workspace.revision;savedFiles=body.workspace.files;return workspace;}
 async function start(workspace){const r=await fetch(`${base}/runtime/tasks/stream`,{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId,activePath:workspace.active,files:workspace.files,approval:'execute-once'})});assert.equal(r.status,200,await (r.status===200?Promise.resolve(''):r.text()));return r;}
 const first=await save('console.log("YNX_NORMAL_FLOW_HELLO")');
 let response=await start(first),events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(events.some(event=>event.type==='output'&&event.data.includes('YNX_NORMAL_FLOW_HELLO')));
 assert.equal(events.at(-1).type,'result',JSON.stringify(events.at(-1)));assert.equal(events.at(-1).value.ok,true);
 const originalTaskId=events.at(-1).value.taskId;
 const originalObservation=await (await fetch(`${base}/runtime/tasks/${originalTaskId}`,{headers})).json();assert.equal(originalObservation.task.projectId,projectId);assert.equal(originalObservation.task.status,'completed');assert.match(originalObservation.task.outcome.result.output,/YNX_NORMAL_FLOW_HELLO/);
 let writes=0;
 const fileIntent={projectId,expectedRevision:revision,path:'源码/你好.js',contents:'console.log("YNX_UNICODE_SINGLE_FILE")',idempotencyKey:crypto.randomUUID()};
 const request=async(path,options)=>{const response=await fetch(base+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),cookie}});if(options.method==='PATCH'){writes++;await response.arrayBuffer();throw Error('simulated lost response after actual server commit');}return response;};
 const saveOperation=createWorkspaceFileSave(fileIntent,{request});assert.equal((await saveOperation.submit()).state,'unknown');
 const later=await fetch(`${base}/runtime/workspaces/${projectId}`,{method:'PATCH',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',expectedRevision:revision+1,idempotencyKey:crypto.randomUUID(),path:'other.js',contents:'console.log("later edit")'})});assert.equal(later.status,200,await(later.status===200?Promise.resolve(''):later.text()));
 const recovered=await resumeWorkspaceFileSave(JSON.parse(JSON.stringify(saveOperation.serialize())),{request}).submit();assert.equal(recovered.state,'saved');assert.equal(recovered.workspace.revision,revision+1);assert.equal(writes,1);
 const currentWorkspace=(await (await fetch(`${base}/runtime/workspaces/${projectId}`,{headers})).json()).workspace;assert.equal(currentWorkspace.revision,revision+2);assert.equal(currentWorkspace.files['other.js'],'console.log("later edit")');assert.equal(currentWorkspace.files[fileIntent.path],fileIntent.contents);revision=currentWorkspace.revision;savedFiles=currentWorkspace.files;
 response=await start({...currentWorkspace,active:fileIntent.path});events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.at(-1).value.ok,true);assert.ok(events.some(event=>event.data?.includes('YNX_UNICODE_SINGLE_FILE')));
 const conflict=createWorkspaceFileSave({...fileIntent,idempotencyKey:crypto.randomUUID()},{request:async(path,options)=>fetch(base+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),cookie}})});assert.equal((await conflict.submit()).code,'revision_conflict');
 const long=await save('console.log("YNX_NORMAL_FLOW_RUNNING");setInterval(()=>{},1000)');
 response=await start(long);const reader=response.body.getReader(),decoder=new TextDecoder();let text='',started=false,finished=false;
 while(!started){const part=await reader.read();assert.equal(part.done,false,'Program must emit its start marker');text+=decoder.decode(part.value,{stream:true});started=text.split('\n').filter(Boolean).some(line=>{try{return JSON.parse(line).data?.includes('YNX_NORMAL_FLOW_RUNNING');}catch{return false;}});}
 const inventory=await (await fetch(`${base}/runtime/tasks/active`,{headers})).json(),active=inventory.tasks.find(task=>task.projectId===projectId);
 assert.ok(active);const stopped=await fetch(`${base}/runtime/tasks/${active.taskId}`,{method:'DELETE',headers});assert.equal(stopped.status,202);
 while(!finished){const part=await reader.read();finished=part.done;if(!part.done)text+=decoder.decode(part.value,{stream:true});}
 events=text.trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.at(-1).type,'result',JSON.stringify(events.at(-1)));assert.equal(events.at(-1).value.ok,false);assert.equal(events.at(-1).value.code,130);
 const cancelledObservation=await (await fetch(`${base}/runtime/tasks/${active.taskId}`,{headers})).json();assert.equal(cancelledObservation.task.status,'cancelled');
 assert.equal((await (await fetch(`${base}/runtime/tasks/active`,{headers})).json()).tasks.length,0);
 const retry=await save('console.log("YNX_NORMAL_FLOW_RETRY")');response=await start(retry);events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.at(-1).value.ok,true);assert.ok(events.some(event=>event.data?.includes('YNX_NORMAL_FLOW_RETRY')));
 for(const [path,source,marker] of [
  ['hello.ts','const value: string = "YNX_NORMAL_TYPESCRIPT"; console.log(value);','YNX_NORMAL_TYPESCRIPT'],
  ['hello.py','print("YNX_NORMAL_PYTHON")','YNX_NORMAL_PYTHON'],
  ['hello.go','package main\nimport "fmt"\nfunc main(){fmt.Println("YNX_NORMAL_GO")}','YNX_NORMAL_GO'],
  ['hello.cpp','#include <iostream>\nint main(){std::cout << "YNX_NORMAL_CPP" << std::endl;}','YNX_NORMAL_CPP']
 ]) {
  const workspace=await save(source,path);response=await start(workspace);events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(events.at(-1).type,'result',path+': '+JSON.stringify(events.at(-1)));
  assert.equal(events.at(-1).value.ok,true,path+': '+JSON.stringify(events.at(-1)));
  assert.ok(events.some(event=>event.data?.includes(marker)),path+' must emit its actual program output');
 }
 const contract=await save('pragma solidity >=0.8.20 <0.9.0; contract Hello { function value() public pure returns (uint) { return 7; } }','Hello.sol');
 response=await start(contract);events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(events.at(-1).type,'result',JSON.stringify(events.at(-1)));const compiled=events.at(-1).value;
 assert.equal(compiled.ok,true,JSON.stringify(compiled));if(process.env.YNX_IDE_SOLC_INPUT)assert.equal(compiled.compiler.version,'0.8.24');else assert.match(compiled.compiler.version,/0\.8\.36/);assert.ok(compiled.artifacts.some(item=>item.path.endsWith('.abi')));assert.ok(compiled.artifacts.some(item=>item.path.endsWith('.bin')));
 await save(retry.files['main.js']);
 await close();await open();
 const restored=await fetch(`${base}/runtime/workspaces/${projectId}`,{headers}),value=await restored.json();assert.equal(restored.status,200,JSON.stringify(value));assert.equal(value.workspace.revision,revision);assert.equal(value.workspace.files['main.js'],retry.files['main.js']);assert.equal(value.workspace.files[fileIntent.path],fileIntent.contents);
 const history=await (await fetch(`${base}/runtime/tasks/${originalTaskId}`,{headers})).json();assert.equal(history.task.status,'completed');assert.equal(history.task.projectId,projectId);assert.match(history.task.outcome.result.output,/YNX_NORMAL_FLOW_HELLO/);
 const otherHealth=await fetch(`${base}/runtime/health`),otherCookie=otherHealth.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(`${base}/runtime/tasks/${originalTaskId}`,{headers:{cookie:otherCookie}})).status,404);
 const db=store.nativeJournalDatabase();db.exec('PRAGMA query_only=ON');
 try {
  const refused=await fetch(`${base}/runtime/tasks/stream`,{method:'POST',headers,body:JSON.stringify({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId,activePath:'main.js',files:{'main.js':'console.log("MUST_NOT_START")'},approval:'execute-once'})});
  assert.equal(refused.status,503);assert.equal((await refused.json()).code,'task_admission_persistence_failed');
  assert.equal((await (await fetch(`${base}/runtime/tasks/active`,{headers})).json()).tasks.length,0);
 } finally {db.exec('PRAGMA query_only=OFF');}

});

test('configured Solidity compiler rejects an unavailable reviewed package without ambient fallback',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ynx-invalid-compiler-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const original=process.env.YNX_IDE_SOLC_INPUT;process.env.YNX_IDE_SOLC_INPUT=directory;
 try {assert.throws(()=>pinnedCompilerCLI(),{code:'compiler_unavailable'});}
 finally {if(original===undefined)delete process.env.YNX_IDE_SOLC_INPUT;else process.env.YNX_IDE_SOLC_INPUT=original;}
});
