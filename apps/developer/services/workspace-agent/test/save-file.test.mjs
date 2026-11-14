import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp,rm,mkdir,symlink,readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceRuntime } from '../src/runtime.mjs';
import { createWorkspaceStore } from '../../workspace-manager/src/store.mjs';
import { materializeSnapshot,readTextSnapshot } from '../src/workspace-files.mjs';
const protocolVersion='ynx-code/v1';
const initial={name:'文件保存',folders:[],files:{'main.js':'console.log("original")','keep.txt':'original other file'},open:['main.js'],active:'main.js'};
async function fixture(t,options={}){const root=await mkdtemp(join(tmpdir(),'ynx-save-file-http-')),store=createWorkspaceStore({filename:join(root,'original.sqlite')}),runtime=createWorkspaceRuntime({root:join(root,'runtime'),workspaceStore:store,sessionKey:Buffer.alloc(32,35),...options});const server=createServer((req,res)=>runtime.handler(req,res).then(handled=>{if(!handled)res.writeHead(404).end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{runtime.cancelAll();await new Promise(r=>server.close(r));runtime.closeAdmission();store.close();await rm(root,{recursive:true,force:true});});const url=`http://127.0.0.1:${server.address().port}`;
 async function session(){const r=await fetch(url+'/runtime/health');return r.headers.get('set-cookie').split(';')[0];}
 const cookie=await session();async function request(path,method='GET',body,who=cookie){const response=await fetch(url+path,{method,headers:{cookie:who,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};}
 assert.equal((await request('/runtime/workspaces/project','PUT',{protocolVersion,expectedRevision:0,idempotencyKey:'create-original-project',workspace:initial})).status,200);
 return {root,store,runtime,request,session,cookie,url,server};}
test('original signed HTTP PATCH saves Unicode text, receipt recovers original intent and real sandbox runs it',async t=>{
 const h=await fixture(t),intent={protocolVersion,expectedRevision:1,idempotencyKey:'save-original-unicode',path:'源代码/你好.js',contents:'console.log("Hello 世界 from saved file")\n'};
 const saved=await h.request('/runtime/workspaces/project','PATCH',intent);assert.equal(saved.status,200);assert.equal(saved.value.workspace.files['keep.txt'],initial.files['keep.txt']);
 assert.equal((await h.request('/runtime/workspaces/project','PATCH',{...intent,expectedRevision:2,idempotencyKey:'other-file-later-save',path:'keep.txt',contents:'later'})).status,200);
 const receipt=await h.request('/runtime/workspaces/project?view=mutation&idempotencyKey='+intent.idempotencyKey);assert.equal(receipt.status,200);assert.equal(receipt.value.receipt.revision,2);
 const hash=createHash('sha256').update(JSON.stringify({domain:'YNX_WORKSPACE_FILE_SAVE_V1',expectedRevision:intent.expectedRevision,path:intent.path,contents:intent.contents})).digest('hex');assert.equal(receipt.value.receipt.requestHash,hash);
 const original=await h.request('/runtime/workspaces/project?view=snapshot&revision=2');assert.equal(original.value.workspace.files['keep.txt'],'original other file');
 const replay=await h.request('/runtime/workspaces/project','PATCH',intent);assert.equal(replay.status,200);assert.equal(replay.value.workspace.replayed,true);assert.equal(replay.value.workspace.revision,2);
 const ran=await h.request('/runtime/tasks','POST',{protocolVersion,task:'build-run-active',approval:'execute-once',projectId:'project',activePath:intent.path,files:original.value.workspace.files});assert.equal(ran.status,200,JSON.stringify(ran.value));assert.equal(ran.value.code,0);assert.match(ran.value.output,/Hello 世界 from saved file/);
 const stored=await h.request('/runtime/tasks/'+ran.value.taskId);assert.equal(stored.status,200);assert.equal(stored.value.task.outcome.result.output,ran.value.output);
});
test('owner isolation, missing mutation and unknown wire version do not expose or change original files',async t=>{
 const h=await fixture(t),other=await h.session(),intent={protocolVersion,expectedRevision:1,idempotencyKey:'save-owner-isolation',path:'main.js',contents:'new'};
 assert.equal((await h.request('/runtime/workspaces/project','PATCH',intent,other)).status,404);
 assert.equal((await h.request('/runtime/workspaces/project','PATCH',{...intent,protocolVersion:'ynx-code/v99'})).value.code,'protocol_mismatch');
 assert.equal((await h.request('/runtime/workspaces/project?view=mutation&idempotencyKey='+intent.idempotencyKey)).value.code,'workspace_mutation_not_found');
 const bad=await h.request('/runtime/workspaces/project?view=mutation&idempotencyKey=secret%20key');assert.equal(bad.status,400);assert.equal(JSON.stringify(bad.value).includes('secret key'),false);
 assert.equal((await h.request('/runtime/workspaces/project')).value.workspace.revision,1);
});
test('PATCH never accepts a writer token and cannot bypass active or native-only project guards',async t=>{
 const h=await fixture(t),owner=h.runtime.ownerForRequest({headers:{cookie:h.cookie}}),writerToken='a'.repeat(64);
 h.store.claimWriter(owner,'project',{writerToken,sessionId:'12345678-1234-1234-1234-123456789012',expectedRevision:1});
 const intent={protocolVersion,expectedRevision:1,idempotencyKey:'writer-guard-save',path:'main.js',contents:'new'};
 assert.equal((await h.request('/runtime/workspaces/project','PATCH',intent)).value.code,'core_writer_active');
 assert.equal((await h.request('/runtime/workspaces/project','PATCH',{...intent,writerToken})).value.code,'workspace_file_schema');
 h.store.markNativeProject(owner,'project',writerToken);h.store.releaseWriter(owner,'project',writerToken);
 assert.equal((await h.request('/runtime/workspaces/project','PATCH',intent)).value.code,'core_native_project');assert.equal(h.store.get(owner,'project').revision,1);
});
test('shared Unicode path boundary materializes actual files and rejects symlink/escape without external writes',async t=>{
 const h=await fixture(t),root=join(h.root,'materialized'),outside=join(h.root,'outside');await mkdir(root);await mkdir(outside);
 const snapshot={name:'unicode',folders:['源代码'],files:{'源代码/你好.js':'你好','e\u0301.txt':'combining'},open:['源代码/你好.js'],active:'源代码/你好.js'};
 await materializeSnapshot(root,snapshot);assert.equal(await readFile(join(root,'源代码/你好.js'),'utf8'),'你好');const roundtrip=await readTextSnapshot(root,snapshot);assert.deepEqual(roundtrip.files,snapshot.files);
 await symlink(outside,join(root,'链接'));await assert.rejects(materializeSnapshot(root,{...snapshot,folders:[],files:{'链接/逃逸.js':'bad'}}),{code:'workspace_symlink'});assert.deepEqual(await readdir(outside),[]);
 await assert.rejects(readTextSnapshot(root,snapshot),{code:'workspace_symlink'});
});
test('revocation during partial save, restore and execution uploads is rechecked before effects',{timeout:15000},async t=>{
 for(const [path,method,mutation] of [
  ['/runtime/workspaces/project','PATCH',{protocolVersion,expectedRevision:1,idempotencyKey:'revoked-partial-upload',path:'main.js',contents:'must not save'}],
  ['/runtime/workspaces/project','PUT',{protocolVersion,expectedRevision:1,idempotencyKey:'revoked-whole-upload',workspace:{...initial,files:{'main.js':'must not save'}}}],
  ['/runtime/workspaces/project','POST',{protocolVersion,action:'restore',approval:'restore-workspace-once',expectedRevision:1,sourceRevision:1,idempotencyKey:'revoked-restore-upload',approvalId:'revoked-restore-approval'}],
  ['/runtime/tasks/stream','POST',{protocolVersion,task:'build-run-active',approval:'execute-once',projectId:'project',activePath:'main.js',files:{'main.js':'console.log("MUST_NOT_RUN")'}}]
 ]) {
  const h=await fixture(t),body=JSON.stringify(mutation);
  const result=new Promise((resolve,reject)=>{
   const request=httpRequest(h.url+path,{method,headers:{cookie:h.cookie,'content-type':'application/json'}},response=>{let value='';response.on('data',chunk=>value+=chunk);response.on('end',()=>resolve({status:response.statusCode,value:JSON.parse(value)}));});request.on('error',reject);
   h.server.once('request',incoming=>incoming.once('data',()=>{h.runtime.revokeGuestAdmission({headers:{cookie:h.cookie}});request.end(body.slice(-1));}));request.write(body.slice(0,-1));
  });
  const response=await result;assert.equal(response.status,401,method+' '+path);assert.equal(response.value.code,'workspace_session_expired');
  const row=h.store.nativeJournalDatabase().prepare('SELECT revision,payload FROM workspaces').get();assert.equal(row.revision,1);assert.equal(JSON.parse(row.payload).files['main.js'],'console.log("original")');assert.equal(h.runtime.status().active,0);
 }
});

test('revoking one real session stops its active and queued programs while another owner continues',{timeout:15000},async t=>{
 const h=await fixture(t,{concurrency:2}),other=await h.session();
 const task=(projectId,marker)=>({protocolVersion,task:'build-run-active',approval:'execute-once',projectId,activePath:'main.js',files:{'main.js':`console.log("${marker}");setInterval(()=>{},1000)`}});
 const begin=async(body,cookie)=>{const response=await fetch(h.url+'/runtime/tasks/stream',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  while(!text.includes('READY_')){const part=await reader.read();assert.equal(part.done,false);text+=decoder.decode(part.value,{stream:true});}
  return {async finish(){while(true){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});}return text.trim().split('\n').map(line=>JSON.parse(line));}};
 };
 const b=await begin(task('other-owner-running','READY_B'),other),a=await begin(task('revoked-owner-running','READY_A'),h.cookie);
 const queuedArrived=new Promise(resolve=>h.server.once('request',incoming=>incoming.once('end',()=>setImmediate(resolve))));
 const queued=fetch(h.url+'/runtime/tasks/stream',{method:'POST',headers:{cookie:h.cookie,'content-type':'application/json'},body:JSON.stringify(task('revoked-owner-queued','MUST_NOT_START'))});await queuedArrived;
 assert.equal(h.runtime.status().queued,1);h.runtime.revokeGuestAdmission({headers:{cookie:h.cookie}});
 const rejected=await queued;assert.equal(rejected.status,401);assert.equal((await rejected.json()).code,'workspace_session_expired');
 const ended=await a.finish();assert.equal(ended.at(-1).type,'error');assert.equal(ended.at(-1).code,'workspace_session_expired');
 const inventory=await h.request('/runtime/tasks/active','GET',undefined,other);assert.equal(inventory.status,200);assert.equal(inventory.value.tasks.length,1);assert.equal(inventory.value.tasks[0].projectId,'other-owner-running');
 assert.equal((await h.request('/runtime/tasks/'+inventory.value.tasks[0].taskId,'DELETE',undefined,other)).status,202);
 const otherEnded=await b.finish();assert.equal(otherEnded.at(-1).value.code,130);assert.equal(h.runtime.status().queued,0);
});
