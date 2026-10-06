import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createJsCurrentFile}=require('./js-current-file.cjs');
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'ynx-js-entry-'));
 const uri=p=>({scheme:'file',fsPath:p,toString:()=>`file://${p}`});
 const document={uri:uri(join(root,'hello.js')),languageId:'javascript',save:async()=>true};
 await writeFile(document.uri.fsPath,'console.log(42);\n');
 const folder={uri:uri(root)},calls=[];
 const vscode={workspace:{isTrusted:true,getWorkspaceFolder:()=>folder},window:{activeTextEditor:{document}},extensions:{getExtension:()=>({activate:async()=>{}})},debug:{startDebugging:async(...args)=>{calls.push(args);return true;}}};
 const run=createJsCurrentFile(vscode,{YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:root});
 try{await fn({root,document,folder,calls,vscode,run});}finally{await rm(root,{recursive:true,force:true});}
}
test('current-file Run and Debug hand literal file/cwd to official extension without writing project configuration',()=>fixture(async f=>{
 await f.run(true);await f.run(false);
 assert.equal(f.calls.length,2);
 for(const [folder,configuration,options] of f.calls){assert.equal(folder,f.folder);assert.equal(configuration.type,'pwa-node');assert.equal(configuration.program,f.document.uri.fsPath);assert.equal(configuration.cwd,f.root);assert.equal(configuration.console,'integratedTerminal');assert.equal(configuration.runtimeExecutable,undefined);assert.equal(configuration.noDebug,options.noDebug);}
 assert.equal(f.calls[0][1].noDebug,true);assert.equal(f.calls[1][1].noDebug,false);
 const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(f.root),['hello.js']);
}));
test('save cancellation, changed focus and revoked trust never launch; rejection releases start lock for retry',()=>fixture(async f=>{
 f.document.save=async()=>false;assert.equal(await f.run(),false);
 f.document.save=async()=>{f.vscode.window.activeTextEditor=undefined;return true;};await assert.rejects(f.run(),/active file changed/);
 f.vscode.window.activeTextEditor={document:f.document};f.document.save=async()=>{f.vscode.workspace.isTrusted=false;return true;};await assert.rejects(f.run(),/Trust/);
 assert.equal(f.calls.length,0);f.vscode.workspace.isTrusted=true;f.document.save=async()=>true;assert.equal(await f.run(),true);
}));
test('duplicate pending clicks admit once and false start can be retried',()=>fixture(async f=>{
 let resolve;f.document.save=()=>new Promise(ok=>resolve=ok);const pending=f.run();assert.equal(await f.run(),false);resolve(true);await pending;assert.equal(f.calls.length,1);
 f.document.save=async()=>true;f.vscode.debug.startDebugging=async()=>false;await assert.rejects(f.run(),/cancelled or failed/);
 f.vscode.debug.startDebugging=async()=>true;assert.equal(await f.run(),true);
}));
test('TSX, TypeScript, Python and disabled js-debug are rejected without fallback execution',()=>fixture(async f=>{
 for(const language of ['typescript','typescriptreact','python']){f.document.languageId=language;await assert.rejects(f.run(),/JavaScript file/);}f.document.languageId='javascript';f.vscode.extensions.getExtension=()=>undefined;await assert.rejects(f.run(),/JavaScript Debugger/);assert.equal(f.calls.length,0);
}));
test('changing workspace during extension activation cancels; user launch configuration remains byte-identical',()=>fixture(async f=>{
 const {mkdir,readFile}=await import('node:fs/promises');await mkdir(join(f.root,'.vscode'));
 const config='{"configurations":[{"type":"lldb-dap","name":"user target"}]}';await writeFile(join(f.root,'.vscode','launch.json'),config);
 f.vscode.extensions.getExtension=()=>({activate:async()=>{f.vscode.workspace.getWorkspaceFolder=()=>undefined;}});
 await assert.rejects(f.run(),/active local project/);assert.equal(f.calls.length,0);assert.equal(await readFile(join(f.root,'.vscode','launch.json'),'utf8'),config);
}));
test('editing during asynchronous debugger activation cannot run stale disk contents',()=>fixture(async f=>{
 f.document.version=1;f.document.isDirty=false;
 f.vscode.extensions.getExtension=()=>({activate:async()=>{f.document.version=2;f.document.isDirty=true;}});
 await assert.rejects(f.run(),/changed after saving/);assert.equal(f.calls.length,0);
 f.vscode.extensions.getExtension=()=>({activate:async()=>{}});f.document.isDirty=false;assert.equal(await f.run(),true);
}));
