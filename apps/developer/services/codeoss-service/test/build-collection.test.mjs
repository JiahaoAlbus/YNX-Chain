import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuildCollection } from '../src/build-collection.mjs';
import { createNativeToolsService } from '../src/tools-service.mjs';
const project={realm:'ynx',tenant:'qa',kind:'project',id:'A',rev:'1'};
const ctx={realm:'ynx',tenant:'qa',actor:'qa-user',actorEpoch:'1',traceId:'trace',requestId:'request'};
async function fixture(t) {
 const directory=await mkdtemp(join(tmpdir(),'ynx-build-collection-')); t.after(()=>rm(directory,{recursive:true,force:true}));
 let allowed=true;const calls=[];
 const collection=createBuildCollection({directory,authorize:async(c,p,op)=>{calls.push({c,p,op});if(!allowed)throw Error('revoked');}});
 return {directory,collection,calls,revoke:()=>{allowed=false;}};
}
const evidence={exit:0,artifact:{bytecode:'0x6000'},toolchain:{name:'solc',version:'0.8.24'},logs:[]};
test('sealed actual bytes, independent jobs, restart readback and permission recheck',async t=>{
 const h=await fixture(t), handle=await h.collection.begin(ctx,{project,gen:'1',commit:'source-A'});
 await h.collection.complete(handle,evidence);
 const build=await h.collection.collectBuild(ctx,handle.job,project,'1');
 assert.equal(build.exit,0);assert.equal(build.project.id,'A');assert.match(build.artifact.content.sha3_512,/^[a-f0-9]{128}$/);
 const restarted=createBuildCollection({directory:h.directory,authorize:async()=>{}});
 assert.deepEqual(await restarted.collectBuild(ctx,handle.job,project,'1'),build);
 h.revoke();await assert.rejects(h.collection.collectBuild(ctx,handle.job,project,'1'),/revoked/);
});
test('T-P03-04 late A remains A and cannot replace/read as current B',async t=>{
 const {collection:c}=await fixture(t), b={...project,id:'B'};
 const a=await c.begin(ctx,{project,gen:'1',commit:'a'}), next=await c.begin(ctx,{project:b,gen:'2',commit:'b'});
 await c.complete(next,{...evidence,artifact:{bytecode:'B'}});const expected=await c.collectBuild(ctx,next.job,b,'2');
 await c.complete(a,{...evidence,artifact:{bytecode:'A'}});
 assert.deepEqual(await c.collectBuild(ctx,next.job,b,'2'),expected);
 await assert.rejects(c.collectBuild(ctx,a.job,b,'2'),{code:'build_binding'});
 await assert.rejects(c.collectBuild(ctx,a.job,project,'2'),{code:'build_binding'});
 assert.equal((await c.collectBuild(ctx,a.job,project,'1')).commit,'a');
});
test('failed, cancelled, duplicate and pending builds are not publishable',async t=>{
 const {collection:c,directory}=await fixture(t);
 for(const result of [{...evidence,exit:1},{...evidence,cancelled:true}]) {
  const handle=await c.begin(ctx,{project,gen:'1',commit:'a'});
  await assert.rejects(c.collectBuild(ctx,handle.job,project,'1'),{code:'build_pending'});
  await c.complete(handle,result);
  await assert.rejects(c.collectBuild(ctx,handle.job,project,'1'),{code:'build_failed'});
  await assert.rejects(c.complete(handle,evidence),{code:'build_terminal'});
 }
 for(const dir of await readdir(directory))assert.equal((await readdir(join(directory,dir))).includes('artifact.json'),false);
});
test('identity/strict decimal and tampered sealed bytes reject',async t=>{
 const {collection:c,directory}=await fixture(t);
 await assert.rejects(c.begin(ctx,{project,gen:'01',commit:'a'}),{code:'build_binding'});
 const handle=await c.begin(ctx,{project,gen:'1',commit:'a'});await c.complete(handle,evidence);
 await assert.rejects(c.collectBuild({...ctx,actorEpoch:'2'},handle.job,project,'1'),{code:'build_binding'});
 const dir=(await readdir(directory))[0];await writeFile(join(directory,dir,'artifact.json'),'altered');
 await assert.rejects(c.collectBuild(ctx,handle.job,project,'1'),{code:'build_integrity'});
});
test('original tools entry executes compiler once and seals its actual output',async t=>{
 const {collection:c}=await fixture(t);let count=0;
 const tools=createNativeToolsService({buildCollection:c,compiler:{compile:async()=>{count++;return {ok:true,bytecode:'0x6000',compiler:evidence.toolchain,diagnostics:[]};}}});
 const result=await tools.compileBuild(ctx,{project,gen:'1',commit:'a',compileArgs:{owner:'original-owner'}});
 assert.equal(count,1);assert.equal(result.exit,0);
});
test('late success after abort and thrown compiler failure retain no publishable output',async t=>{
 const {collection:c,directory}=await fixture(t), controller=new AbortController();
 const tools=createNativeToolsService({buildCollection:c,compiler:{compile:async()=>{controller.abort();return {ok:true,compiler:evidence.toolchain,bytecode:'late'};}}});
 await assert.rejects(tools.compileBuild(ctx,{project,gen:'1',commit:'a',compileArgs:{signal:controller.signal}}),{code:'build_failed'});
 const failure=createNativeToolsService({buildCollection:c,compiler:{compile:async()=>{throw Object.assign(Error('tool failed'),{code:'original_failure'});}}});
 await assert.rejects(failure.compileBuild(ctx,{project,gen:'1',commit:'a',compileArgs:{}}),{code:'original_failure'});
 for(const dir of await readdir(directory))assert.equal((await readdir(join(directory,dir))).includes('artifact.json'),false);
});

for (const mutation of ['source', 'admission']) test(`original compile route rejects ${mutation} change before successful sealing`,async t=>{
 const {Readable}=await import('node:stream');
 const h=await fixture(t),sessionId='12345678-1234-1234-1234-123456789012',origin='https://developer.ynxweb4.com';
 let changed=false,start,finish;const started=new Promise(r=>start=r),finished=new Promise(r=>finish=r);
 const original={context:{owner:'qa-user',projectId:'A',runtimeId:'r',sessionId},identity:{account:'qa-user',generation:1},expiresAt:Date.now()+60000};
 const tools=createNativeToolsService({buildCollection:h.collection,
  coreService:{authorizeConnection:async()=>changed&&mutation==='admission'?{...original,context:{...original.context,projectId:'B'}}:original},
  buildBindingForAdmission:async(a,meta)=>{assert.equal(a,original);assert.equal(meta.name,'Hello');assert.equal(meta.source,'original source');return {ctx,project,gen:'1',commit:meta.sourceSha256,assertCurrentSource:async()=>{if(changed&&mutation==='source')throw Object.assign(Error('source changed'),{code:'build_source_changed',status:409});}};},
  compiler:{compile:async()=>{start();await finished;return {ok:true,compiler:evidence.toolchain,bytecode:'old A',diagnostics:[]};}}});
 async function send(path,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:`/runtime/native-tools/${path}?sessionId=${sessionId}`,method:body?'POST':'GET',headers:{host:'developer.ynxweb4.com',origin,'content-type':'application/json'}});let status,result;const res={writeHead(code){status=code;},end(bytes){result=JSON.parse(bytes);this.writableEnded=true;}};await tools.handler(req,res);return {status,result};}
 const context=await send('context');const pending=send('chain/compile',{csrf:context.result.csrf,name:'Hello',source:'original source'});await started;changed=true;finish();
 const response=await pending;assert.equal(response.status,mutation==='source'?409:401);assert.equal(response.result.build,undefined);assert.equal(response.result.bytecode,undefined);
 const directories=await readdir(h.directory);assert.equal(directories.length,1);
 const entries=await readdir(join(h.directory,directories[0]));assert.equal(entries.includes('artifact.json'),false);
 const terminal=JSON.parse(await readFile(join(h.directory,directories[0],'completed.json'),'utf8'));assert.equal(terminal.exit,1);assert.equal(terminal.artifact,undefined);
});

test('publication reads exact sealed bytes after restart and rechecks original authority after IO',async t=>{
 const h=await fixture(t),handle=await h.collection.begin(ctx,{project,gen:'1',commit:'source-A'});await h.collection.complete(handle,evidence);
 const restored=createBuildCollection({directory:h.directory,authorize:async()=>{}});
 const loaded=await restored.readBuildArtifact(ctx,handle.job,project,'1');assert.deepEqual(JSON.parse(loaded.content),evidence.artifact);assert.deepEqual(loaded.build,await restored.collectBuild(ctx,handle.job,project,'1'));
 // Mutating this returned copy never mutates the immutable on-disk artifact.
 loaded.content.fill(0);assert.deepEqual(JSON.parse((await restored.readBuildArtifact(ctx,handle.job,project,'1')).content),evidence.artifact);
 let reads=0;const revoked=createBuildCollection({directory:h.directory,authorize:async()=>{if(++reads===2)throw Error('original authority revoked');}});
 await assert.rejects(revoked.readBuildArtifact(ctx,handle.job,project,'1'),/original authority revoked/);
 const dir=(await readdir(h.directory))[0];await writeFile(join(h.directory,dir,'artifact.json'),'tampered');await assert.rejects(restored.readBuildArtifact(ctx,handle.job,project,'1'),{code:'build_integrity'});
});
