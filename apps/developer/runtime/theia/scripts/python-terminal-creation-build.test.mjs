import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pythonTerminalCreationPlugin, transformTerminalCreation, PIN } from './python-terminal-creation-build.mjs';
const require = createRequire(import.meta.url);require('reflect-metadata');
const esbuild = require('esbuild');
const { Emitter } = require('@theia/core/lib/common/event');
const vendor = require.resolve('@theia/plugin-ext/lib/plugin/terminal-ext');
const root = await mkdtemp('/private/tmp/ynx-python-terminal-build-');
const outdir = join(root,'lib/backend');await mkdir(outdir,{recursive:true});
await copyFile(new URL('../../ynx-workbench/lib/python-terminal-creation.js',import.meta.url),join(outdir,'python-terminal-creation.js'));
// The entry is the actual retained class. Its unaffected dependencies resolve
// to retained inputs; the inserted helper alone is packaged beside the output.
await esbuild.build({entryPoints:{'plugin-host':vendor,'plugin-vscode-init':vendor},bundle:true,platform:'node',format:'cjs',outdir,
 plugins:[pythonTerminalCreationPlugin(),{name:'retained-input-boundaries',setup(build){build.onResolve({filter:/.*/},args=>{
  if(!args.importer)return;return{path:createRequire(args.importer).resolve(args.path),external:true};
 });}}]});
const compiled = require(join(outdir,'plugin-host.js'));
const helper = require(join(outdir,'python-terminal-creation.js'));
test('same external helper cache receives two real compiled TerminalExt creations; ordinary PTY is unchanged',async()=>{
 const received=[],writes=new Emitter(),closes=new Emitter();
 const mainSource=await readFile(require.resolve('@theia/plugin-ext/lib/main/browser/terminal-main'),'utf8');
 const method=mainSource.slice(mainSource.indexOf('    async $createTerminal('),mainSource.indexOf('    getTerminalLocation('));
 const main=Function('return ({'+method.trim()+'})')();
 main.toIconClass=()=>undefined;main.getTerminalLocation=()=>undefined;
 main.terminals={newTerminal:async options=>{received.push(options);return{id:options.id,start(){}};}};
 let service;const proxy={$createTerminal:(...args)=>{const result=main.$createTerminal(...args);service.$terminalCreated(args[0],args[1].name);return result;}};
 service=new compiled.TerminalServiceExtImpl({getProxy:()=>proxy});
 const api={window:{createTerminal:options=>service.createTerminal({model:{id:'ms-python.debugpy'}},options)}};
 const create=helper.createPythonTerminalFactory(api),pty={onDidWrite:writes.event,onDidClose:closes.event,open(){},close(){}};
 const one=create('11111111-1111-4111-8111-111111111111',{name:'identical',pty});
 const two=create('22222222-2222-4222-8222-222222222222',{name:'identical',pty});
 const ordinary=api.window.createTerminal({name:'identical',pty,attributes:{'ynx-debug-terminal-creation':'unmarked'}});
 assert.equal(received[0].id,await one.id.promise);assert.equal(received[1].id,await two.id.promise);assert.equal(received[2].id,await ordinary.id.promise);
 assert.equal(received[0].attributes['ynx-debug-terminal-creation'],'11111111-1111-4111-8111-111111111111');
 assert.equal(received[1].attributes['ynx-debug-terminal-creation'],'22222222-2222-4222-8222-222222222222');assert.equal(received[2].attributes,undefined);
 const secondBundle=require(join(outdir,'plugin-vscode-init.js'));
 service=new secondBundle.TerminalServiceExtImpl({getProxy:()=>proxy});
 const third=create('77777777-7777-4777-8777-777777777777',{name:'second bundle',pty});
 assert.equal(received[3].id,await third.id.promise);assert.equal(received[3].attributes['ynx-debug-terminal-creation'],'77777777-7777-4777-8777-777777777777');
 assert.equal(helper,require(join(outdir,'python-terminal-creation.js')));assert.equal(helper.CONTRACT,PIN);
});
test('owned creation refuses synchronous reentry and restores its closure after exceptions',()=>{
 let service;const proxy={$createTerminal:id=>service.$terminalCreated(id,'Python')};service=new compiled.TerminalServiceExtImpl({getProxy:()=>proxy});
 const api={window:{createTerminal:options=>service.createTerminal({model:{id:'ms-python.debugpy'}},options)}};
 const create=helper.createPythonTerminalFactory(api);let caught;
 const event=listener=>{try{create('33333333-3333-4333-8333-333333333333',{name:'nested',pty:{onDidWrite:()=>({dispose(){}})}});}catch(error){caught=error;}return{dispose(){}};};
 create('44444444-4444-4444-8444-444444444444',{name:'outer',pty:{onDidWrite:event}});assert.match(caught.message,/reentrant/);
 proxy.$createTerminal=()=>{throw Error('native creation failed');};
 assert.throws(()=>create('55555555-5555-4555-8555-555555555555',{name:'fail',pty:{onDidWrite:()=>({dispose(){}})}}),/native creation failed/);
 proxy.$createTerminal=id=>service.$terminalCreated(id,'Python');assert.ok(create('66666666-6666-4666-8666-666666666666',{name:'next',pty:{onDidWrite:()=>({dispose(){}})}}));
});
test('changed retained source and missing packaged helper reject instead of silently disabling correlation',async()=>{
 const original=await readFile(vendor,'utf8');assert.throws(()=>transformTerminalCreation(original+'\n'),/source changed/);
 assert.throws(()=>helper.registerCompiledCreationContract('wrong'),/Unsupported/);
 await unlink(join(outdir,'python-terminal-creation.js'));
 const child=spawnSync(process.execPath,['-e','require('+JSON.stringify(join(outdir,'plugin-host.js'))+')'],{encoding:'utf8'});
 assert.notEqual(child.status,0);assert.match(child.stderr,/Cannot find module '.\/python-terminal-creation'/);
 assert.equal(await readFile(vendor,'utf8'),original);
});
test('actual producer seal block copies helper and its receipt detects missing or mismatched compiled bytes',async()=>{
 const { composedTreeDigest }=await import('../../../services/codeoss-service/src/composed-runtime.mjs');
 const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
 const runtime=await mkdtemp('/private/tmp/ynx-python-terminal-seal-'),source=join(runtime,'source');await mkdir(join(source,'lib'),{recursive:true});await mkdir(join(runtime,'lib/backend'),{recursive:true});
 for(const name of ['plugin-vscode-init-adapter','python-terminal-creation'])await copyFile(new URL('../../ynx-workbench/lib/'+name+'.js',import.meta.url),join(source,'lib',name+'.js'));
 await fs.writeFile(join(runtime,'package.json'),'{}');await fs.writeFile(join(runtime,'package-lock.json'),'{}');
 const script=await readFile(new URL('./sync-owned-workbench.mjs',import.meta.url),'utf8');const block=script.slice(script.indexOf('if (seal) {')+12,script.lastIndexOf('}'));
 const regular=async path=>{for(const name of await fs.readdir(path)){const stat=await fs.lstat(join(path,name));assert.ok(!stat.isSymbolicLink()&&(stat.isDirectory()||stat.isFile()));if(stat.isDirectory())await regular(join(path,name));}};
 const seal=new (Object.getPrototypeOf(async function(){}).constructor)('assert','cp','lstat','readFile','writeFile','createHash','join','runtime','source','digest','regular','composedTreeDigest',block);
 await seal(assert,fs.cp,fs.lstat,fs.readFile,fs.writeFile,crypto.createHash,join,runtime,source,'owned-test-source',regular,composedTreeDigest);
 const receipt=JSON.parse(await readFile(join(runtime,'.ynx-owned-build.json'),'utf8'));assert.equal(receipt.compiledTreeSha256,await composedTreeDigest(join(runtime,'lib')));
 await unlink(join(runtime,'lib/backend/python-terminal-creation.js'));assert.notEqual(receipt.compiledTreeSha256,await composedTreeDigest(join(runtime,'lib')));
 await fs.writeFile(join(runtime,'lib/backend/python-terminal-creation.js'),'wrong');assert.notEqual(receipt.compiledTreeSha256,await composedTreeDigest(join(runtime,'lib')));
 await unlink(join(source,'lib/python-terminal-creation.js'));await assert.rejects(seal(assert,fs.cp,fs.lstat,fs.readFile,fs.writeFile,crypto.createHash,join,runtime,source,'owned-test-source',regular,composedTreeDigest),{code:'ENOENT'});
});
test('actual esbuild refuses a nested worker output importing the adjacent backend helper',async()=>{
 await assert.rejects(esbuild.build({entryPoints:{'worker/wrong-location':vendor},bundle:true,platform:'node',format:'cjs',outdir,logLevel:'silent',
 plugins:[pythonTerminalCreationPlugin(),{name:'retained-input-boundaries',setup(build){build.onResolve({filter:/.*/},args=>{if(args.importer)return{path:createRequire(args.importer).resolve(args.path),external:true};});}}]}),/helper import escaped/);
});
