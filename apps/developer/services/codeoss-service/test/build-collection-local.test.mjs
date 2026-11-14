import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildCollection } from '../src/build-collection.mjs';
import { createNativeToolsService } from '../src/tools-service.mjs';
import { compilerReadiness } from '../../../scripts/compiler-pin.mjs';

test('P03-04 actual original pinned solc Worker produces sealed ABI/bytecode, failed source cannot collect',async t=>{
 assert.equal(compilerReadiness().available,true,'Supply the existing reviewed offline compiler; never download/fallback.');
 const directory=await mkdtemp(join(tmpdir(),'ynx-p03-real-build-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const ctx={realm:'ynx',tenant:'qa',actor:'local-qa',actorEpoch:'1',traceId:'local',requestId:'real-solc'};
 const project={realm:'ynx',tenant:'qa',kind:'project',id:'actual-local-compiler',rev:'1'};
 let reads=0;
 const collection=createBuildCollection({directory,authorize:async(c,p)=>{assert.deepEqual(c,ctx);assert.deepEqual(p,project);reads++;}});
 const tools=createNativeToolsService({buildCollection:collection});
 const build=await tools.compileBuild(ctx,{project,gen:'1',commit:'local-source-snapshot',compileArgs:{owner:'local-qa',name:'Hello',source:'pragma solidity 0.8.24; contract Hello { function value() public pure returns(uint) {return 7;} }'}});
 assert.equal(build.exit,0);assert.equal(reads,2);
 const entries=await readdir(directory), artifact=JSON.parse(await readFile(join(directory,entries[0],'artifact.json'),'utf8'));
 assert.ok(artifact.bytecode.length>20);assert.ok(artifact.abi.some(row=>row.name==='value'));assert.equal(artifact.compiler.version,'0.8.24');
 await assert.rejects(tools.compileBuild(ctx,{project,gen:'1',commit:'invalid-source',compileArgs:{owner:'local-qa',name:'Hello',source:'pragma solidity 0.8.24; contract Hello { syntax error; }'}}),{code:'build_failed'});
 assert.equal((await readdir(directory)).length,2);
});

test('existing admitted compile route seals real output with original project binding, no new endpoint',async t=>{
 assert.equal(compilerReadiness().available,true);
 const {Readable}=await import('node:stream');
 const directory=await mkdtemp(join(tmpdir(),'ynx-p03-route-build-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const ctx={realm:'ynx',tenant:'qa',actor:'local-qa',actorEpoch:'1'};
 const project={realm:'ynx',tenant:'qa',kind:'project',id:'route-project',rev:'1'};
 const sessionId='12345678-1234-1234-1234-123456789012', origin='https://developer.ynxweb4.com';let authorized=0;
 const admission={context:{owner:'local-qa',projectId:'route-project',runtimeId:'runtime',sessionId},identity:{account:'qa',generation:1},expiresAt:Date.now()+60000};
 const collection=createBuildCollection({directory,authorize:async(c,p)=>{assert.deepEqual(c,ctx);assert.deepEqual(p,project);authorized++;}});
 const tools=createNativeToolsService({buildCollection:collection,coreService:{authorizeConnection:async()=>{authorized++;return admission;}},
  buildBindingForAdmission:async(value,source)=>{assert.equal(value,admission);assert.match(source.sourceSha256,/^[a-f0-9]{64}$/);return Object.freeze({ctx,project,gen:'7',commit:source.sourceSha256,assertCurrentSource:async()=>{authorized++;}});}});
 async function send(path,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:`/runtime/native-tools/${path}?sessionId=${sessionId}`,method:body?'POST':'GET',headers:{host:'developer.ynxweb4.com',origin,'content-type':'application/json'}});let status,result;const res={writeHead(code){status=code;},end(bytes){result=JSON.parse(bytes);this.writableEnded=true;}};await tools.handler(req,res);return {status,result};}
 const context=await send('context');
 const built=await send('chain/compile',{csrf:context.result.csrf,name:'RouteHello',source:'pragma solidity 0.8.24; contract RouteHello {}'});
 assert.equal(built.status,200,JSON.stringify(built.result));assert.equal(built.result.build.project.id,'route-project');assert.equal(built.result.build.exit,0);assert.equal(built.result.signed,false);assert.ok(authorized>=6);
});
