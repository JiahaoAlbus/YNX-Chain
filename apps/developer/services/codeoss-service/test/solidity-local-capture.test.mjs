import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
const require=createRequire(import.meta.url), {captureSolidityProject}=require('../../../native/ynx-tools/src/solidity-project.cjs');
const { createSolidityLanguage } = require('../../../native/ynx-tools/src/solidity-language.cjs');
async function fixture(t){
 if(!process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT){t.skip('Supply reviewed compiler extension.');return;}
 const extension=await realpath(process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT),root=await mkdtemp('/private/tmp/ynx-local-imports-');
 const uri=p=>({scheme:'file',fsPath:p,toString:()=>`file://${p}`}),documents=[];
 async function put(name,text){await mkdir(join(root,name,'..'),{recursive:true});await writeFile(join(root,name),text);}
 const vscode={Uri:{file:uri},workspace:{workspaceFolders:[{uri:uri(root)}],textDocuments:documents,findFiles(){throw Error('Import closure must not scan the project.');},async openTextDocument(value){let doc=documents.find(d=>d.uri.fsPath===value.fsPath);if(!doc){doc={uri:value,isClosed:false,version:1,text:await readFile(value.fsPath,'utf8'),getText(){return this.text;},positionAt(offset){return{offset};},offsetAt(position){return position.offset;}};documents.push(doc);}return doc;}}};
 const environment={YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'cccccccc-cccc-cccc-cccc-cccccccccccc'};
 return{root,extension,put,vscode,environment,async capture(){return captureSolidityProject(vscode,environment,await vscode.workspace.openTextDocument(uri(join(root,'Main.sol'))),{compiler:join(extension,'compiler')});}};
}
test('actual pinned parser captures only relative/package import closure and current unsaved documents',async t=>{
 const h=await fixture(t);if(!h)return;
 await h.put('Main.sol','pragma solidity 0.8.24; import "@sample/contracts/Lib.sol"; import "./Local.sol"; contract Main { function ping() public pure returns(uint256) { return Lib.value(); } }');
 await h.put('Local.sol','pragma solidity 0.8.24; contract Local {}');
 await h.put('node_modules/@sample/contracts/Lib.sol','pragma solidity 0.8.24; import "./Inner.sol"; library Lib { function value() internal pure returns(uint256) { return 1; } }');
 await h.put('node_modules/@sample/contracts/Inner.sol','pragma solidity 0.8.24; library Inner {}');
 await h.put('Unrelated.sol','broken and must never be read');
 const doc=await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'Local.sol')));doc.text+=' // unsaved';doc.version++;
 const result=await h.capture();assert.equal(Object.keys(result.snapshot.sources).length,4);assert.equal(result.snapshot.sessionId,undefined);assert.equal(result.snapshot.protocol,'ynx-solidity-local-project/v1');
 assert.match(result.snapshot.sources['Local.sol'].content,/unsaved/);assert.equal(result.documents.get('@sample/contracts/Inner.sol').uri.fsPath,join(h.root,'node_modules/@sample/contracts/Inner.sol'));
 await result.verify();
 const providers={}, subscriptions=[];
 h.vscode.languages=Object.fromEntries(['Definition','Hover','Reference','DocumentSymbol','Rename','CompletionItem'].map(name=>[`register${name}Provider`,(_,provider)=>{providers[name]=provider;return{dispose(){}};}]));
 for(const name of ['onDidChangeTextDocument','onDidCloseTextDocument','onDidChangeWorkspaceFolders'])h.vscode.workspace[name]=()=>({dispose(){}});
 h.vscode.Range=class{constructor(start,end){Object.assign(this,{start,end});}};h.vscode.Location=class{constructor(uri,range){Object.assign(this,{uri,range});}};
 for(const document of h.vscode.workspace.textDocuments){document.offsetAt=position=>position.offset;document.positionAt=offset=>({offset});}
 const language=createSolidityLanguage(h.vscode,{extensionPath:h.extension,subscriptions},h.environment);t.after(()=>language.dispose());
 const main=h.vscode.workspace.textDocuments.find(d=>d.uri.fsPath.endsWith('/Main.sol'));
 const definition=await providers.Definition.provideDefinition(main,{offset:main.text.indexOf('Lib.value')+4});
 assert.equal(definition.uri.fsPath,join(h.root,'node_modules/@sample/contracts/Lib.sol'));
 h.vscode.window={activeTextEditor:{document:main},showTextDocument:async artifact=>artifact};
 const open=h.vscode.workspace.openTextDocument;h.vscode.workspace.openTextDocument=async input=>typeof input.content==='string'?input:open(input);
 const compiled=await language.compileProject();assert.equal(compiled.ok,true);assert.ok(compiled.abi.some(row=>row.name==='ping'));assert.ok(compiled.bytecode.length>2);
 doc.text+=' change';doc.version++;await assert.rejects(result.verify(),/changed during review/);
});
test('local capture rejects symlink packages, outside relative imports, ambiguous files and canonical context',async t=>{
 const h=await fixture(t);if(!h)return;await h.put('Main.sol','pragma solidity 0.8.24; import "./Link.sol"; contract Main {}');await h.put('Real.sol','pragma solidity 0.8.24; contract Real {}');await symlink(join(h.root,'Real.sol'),join(h.root,'Link.sol'));await assert.rejects(h.capture(),/symbolic links/);
 const main=h.vscode.workspace.textDocuments.find(d=>d.uri.fsPath.endsWith('/Main.sol'));main.text='pragma solidity 0.8.24; import "../Outside.sol"; contract Main {}';main.version++;await assert.rejects(h.capture(),/invalid|leave|outside/);
 main.text='pragma solidity 0.8.24; import "pkg/X.sol"; contract Main {}';main.version++;await h.put('pkg/X.sol','pragma solidity 0.8.24; contract X {}');await h.put('node_modules/pkg/X.sol','pragma solidity 0.8.24; contract X {}');await assert.rejects(h.capture(),/ambiguous/);
 h.environment.YNX_CORE_SESSION_ID='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';await assert.rejects(h.capture(),/canonical/);
});
test('local capture handles actual 65-file compiler import graph above canonical limits',async t=>{
 const h=await fixture(t);if(!h)return;for(let i=0;i<64;i++)await h.put(`F${i}.sol`,`pragma solidity 0.8.24; contract C${i} {} /*${'x'.repeat(9000)}*/`);
 await h.put('Main.sol','pragma solidity 0.8.24; '+Array.from({length:64},(_,i)=>`import "./F${i}.sol";`).join(' ')+' contract Main {}');
 const result=await h.capture();assert.equal(Object.keys(result.snapshot.sources).length,65);assert.ok(Object.values(result.snapshot.sources).reduce((n,r)=>n+Buffer.byteLength(r.content),0)>262144);await result.verify();
 const worker=new Worker(join(h.extension,'compiler/compiler-worker.mjs'),{workerData:{mode:'analysis',sourceName:result.snapshot.entryPath,sources:Object.fromEntries(Object.entries(result.snapshot.sources).map(([name,row])=>[name,{content:row.content}]))},env:{YNX_IDE_SOLC_INPUT:join(h.extension,'compiler/node_modules/solc')},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32}});
 try{const analyzed=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});assert.equal(analyzed.ok,true);assert.equal(analyzed.semantics.declarations.filter(row=>row.kind==='ContractDefinition').length,65);}finally{await worker.terminate();}
});
test('partial function buffers retain structural imports without treating comment or string paths as imports',async t=>{
 const h=await fixture(t);if(!h)return;
 await h.put('Main.sol','pragma solidity 0.8.24; import "./Dep\\x2esol"; // import "./Secret.sol";\ncontract Main { function ping() public { uint256 a =');
 await h.put('Dep.sol','pragma solidity 0.8.24; contract Dep {}');
 const result=await h.capture();assert.deepEqual(Object.keys(result.snapshot.sources).sort(),['Dep.sol','Main.sol']);await result.verify();
 const worker=new Worker(join(h.extension,'compiler/compiler-worker.mjs'),{workerData:{mode:'analysis',sourceName:result.snapshot.entryPath,sources:Object.fromEntries(Object.entries(result.snapshot.sources).map(([name,row])=>[name,{content:row.content}]))},env:{YNX_IDE_SOLC_INPUT:join(h.extension,'compiler/node_modules/solc')},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32}});
 try{const analyzed=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});assert.equal(analyzed.ok,false);assert.ok(analyzed.diagnostics.some(row=>row.severity==='error'&&row.sourceLocation?.file==='Main.sol'));}finally{await worker.terminate();}
 const main=h.vscode.workspace.textDocuments.find(d=>d.uri.fsPath.endsWith('/Main.sol'));main.text='pragma solidity 0.8.24; contract Main {}';main.version++;
 await h.put('Main.sol','x'.repeat(262145));await assert.rejects(h.capture(),/before opening/);
});
test('local import closure enforces both 128-file and 2 MiB boundaries',async t=>{
 const h=await fixture(t);if(!h)return;
 for(let i=0;i<128;i++)await h.put(`F${i}.sol`,'pragma solidity 0.8.24; contract C'+i+' {}');
 await h.put('Main.sol','pragma solidity 0.8.24; '+Array.from({length:128},(_,i)=>`import "./F${i}.sol";`).join(' ')+' contract Main {}');
 await assert.rejects(h.capture(),/128 files/);
 const main=h.vscode.workspace.textDocuments.find(d=>d.uri.fsPath.endsWith('/Main.sol'));main.text='pragma solidity 0.8.24; '+Array.from({length:9},(_,i)=>`import "./Big${i}.sol";`).join(' ')+' contract Main {}';main.version++;
 for(let i=0;i<9;i++)await h.put(`Big${i}.sol`,'pragma solidity 0.8.24; contract Big'+i+' {} /*'+'x'.repeat(240000)+'*/');
 await assert.rejects(h.capture(),/2 MiB total/);
});
test('actual language provider reports unfinished imports and absent relative or package dependencies',async t=>{
 for(const item of [
  {source:'pragma solidity 0.8.24; import "./Unfinished',missing:false},
  {source:'pragma solidity 0.8.24; import "./Missing.sol"; contract Main {}',missing:true},
  {source:'pragma solidity 0.8.24; import "@missing/contracts/Dep.sol"; contract Main {}',missing:true},
 ]){
  const h=await fixture(t);if(!h)return;await h.put('Main.sol',item.source);
  const reviewed=await h.capture();assert.deepEqual(Object.keys(reviewed.snapshot.sources),['Main.sol']);
  const main=h.vscode.workspace.textDocuments[0],providers={},subscriptions=[],live={rows:[],clear(){this.rows=[];},set(rows){this.rows=rows;},dispose(){}};
  main.positionAt=offset=>({offset});main.offsetAt=position=>position.offset;
  h.vscode.languages=Object.fromEntries(['Definition','Hover','Reference','DocumentSymbol','Rename'].map(name=>[`register${name}Provider`,(_,provider)=>{providers[name]=provider;return{dispose(){}};}]));
  h.vscode.languages.createDiagnosticCollection=()=>live;
  h.vscode.Range=class{constructor(start,end){Object.assign(this,{start,end});}};
  h.vscode.Diagnostic=class{constructor(range,message,severity){Object.assign(this,{range,message,severity});}};
  h.vscode.DiagnosticSeverity={Error:0,Warning:1,Information:2};
  for(const name of ['onDidChangeTextDocument','onDidCloseTextDocument','onDidChangeWorkspaceFolders'])h.vscode.workspace[name]=()=>({dispose(){}});
  h.vscode.window={activeTextEditor:{document:main}};
  const language=createSolidityLanguage(h.vscode,{extensionPath:h.extension,subscriptions},h.environment);
  try{
   assert.equal(await providers.Definition.provideDefinition(main,{offset:0}),undefined);
   assert.ok(live.rows.some(([uri,rows])=>uri.fsPath===main.uri.fsPath&&rows.some(row=>row.severity===0)));
   if(item.missing)assert.ok(live.rows.some(([,rows])=>rows.some(row=>/not found/i.test(row.message))));
  }finally{language.dispose();}
  if(item.source.includes('./Missing.sol')){await h.put('Missing.sol','pragma solidity 0.8.24; contract Missing {}');await assert.rejects(reviewed.verify(),/dependency appeared/);}
  if(item.source.includes('@missing/')){await h.put('node_modules/@missing/contracts/Dep.sol','pragma solidity 0.8.24; contract Dep {}');await assert.rejects(reviewed.verify(),/dependency appeared/);}
 }
});
function localLanguageHost(h){
 const providers={},events={},subscriptions=[],live={rows:[],clear(){this.rows=[];},set(rows){this.rows=rows;},dispose(){}};
 h.vscode.languages=Object.fromEntries(['Definition','Hover','Reference','DocumentSymbol','Rename'].map(name=>[`register${name}Provider`,(_,provider)=>{providers[name]=provider;return{dispose(){}};}]));
 h.vscode.languages.createDiagnosticCollection=()=>live;
 h.vscode.Range=class{constructor(start,end){Object.assign(this,{start,end});}};h.vscode.Location=class{constructor(uri,range){Object.assign(this,{uri,range});}};
 h.vscode.Diagnostic=class{constructor(range,message,severity){Object.assign(this,{range,message,severity});}};h.vscode.DiagnosticSeverity={Error:0,Warning:1,Information:2};
 for(const [name,key] of [['onDidChangeTextDocument','change'],['onDidCloseTextDocument','close'],['onDidChangeWorkspaceFolders','folders']])h.vscode.workspace[name]=listener=>{events[key]=listener;return{dispose(){}};};
 h.vscode.window={activeTextEditor:{document:h.vscode.workspace.textDocuments.find(d=>d.uri.fsPath.endsWith('/Main.sol'))},showTextDocument:async artifact=>artifact};
 const open=h.vscode.workspace.openTextDocument;h.vscode.workspace.openTextDocument=async input=>typeof input.content==='string'?input:open(input);
 return{providers,events,live,language:createSolidityLanguage(h.vscode,{extensionPath:h.extension,subscriptions},h.environment)};
}
test('build progress covers blocked source capture; cancel stops it and a late editor reply cannot produce an artifact', {timeout:15000}, async t=>{
 const h=await fixture(t);if(!h)return;
 await h.put('Main.sol','pragma solidity 0.8.24; import "./Delayed.sol"; contract Main {}');
 await h.put('Delayed.sol','pragma solidity 0.8.24; library Delayed {}');
 await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'Main.sol')));
 const host=localLanguageHost(h);t.after(()=>host.language.dispose());
 const original=h.vscode.workspace.openTextDocument;
 let signalEntered,lateReply,cancel,progressVisible=false,artifacts=0;
 const entered=new Promise(resolve=>signalEntered=resolve);
 h.vscode.ProgressLocation={Notification:15};
 h.vscode.window.withProgress=async(options,task)=>{assert.equal(options.cancellable,true);progressVisible=true;return task({report(message){assert.equal(typeof message.message,'string');}}, {isCancellationRequested:false,onCancellationRequested(listener){cancel=listener;return{dispose(){cancel=undefined;}};}});};
 h.vscode.workspace.openTextDocument=input=>{
   if(input.content!==undefined){artifacts++;return original(input);}
   if(input.fsPath===join(h.root,'Delayed.sol')){assert.equal(progressVisible,true);signalEntered();return new Promise(resolve=>lateReply=resolve);}
   return original(input);
 };
 const build=host.language.compileProject();await entered;
 await assert.rejects(host.language.compileProject(),/already running/);
 cancel();assert.equal(await build,undefined);assert.equal(artifacts,0);assert.equal(host.language.status().active,0);
 h.vscode.workspace.openTextDocument=original;
 lateReply(await original(h.vscode.Uri.file(join(h.root,'Delayed.sol'))));
 assert.equal((await host.language.compileProject()).ok,true);
});
test('real capture deadline rejects a stalled editor RPC, identifies the dependency, and permits a fresh build', {timeout:25000}, async t=>{
 const h=await fixture(t);if(!h)return;
 await h.put('Main.sol','pragma solidity 0.8.24; import "./Stalled.sol"; contract Main {}');
 await h.put('Stalled.sol','pragma solidity 0.8.24; library Stalled {}');
 await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'Main.sol')));
 const host=localLanguageHost(h);t.after(()=>host.language.dispose());
 const original=h.vscode.workspace.openTextDocument;
 let lateReply,artifacts=0;
 h.vscode.window.showTextDocument=async artifact=>{artifacts++;return artifact;};
 h.vscode.workspace.openTextDocument=input=>{
   if(input.content!==undefined)return original(input);
   if(input.fsPath===join(h.root,'Stalled.sol'))return new Promise(resolve=>lateReply=resolve);
   return original(input);
 };
 const started=Date.now();
 await assert.rejects(host.language.compileProject(),/time limit while waiting for the editor to open Stalled\.sol/);
 assert.ok(Date.now()-started>=15000,'the production deadline was not shortened');
 assert.equal(typeof lateReply,'function');assert.equal(artifacts,0);assert.equal(host.language.status().active,0);
 h.vscode.workspace.openTextDocument=original;
 lateReply(await original(h.vscode.Uri.file(join(h.root,'Stalled.sol'))));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(artifacts,0);
 assert.equal((await host.language.compileProject()).ok,true);assert.equal(artifacts,1);
});
test('actual compiler and providers honor Foundry longest prefix, context, tie order and remapped relative imports',async t=>{
 for(const item of [
  {request:'alias/special/Util.sol',mappings:'alias/=lib/base/\nalias/special/=lib/special/',target:'lib/special/Util.sol'},
  {request:'alias/special/Util.sol',mappings:'alias/special/=lib/special/\nMain.sol:alias/=lib/context/',target:'lib/context/special/Util.sol'},
  {request:'alias/Util.sol',mappings:'alias/=lib/first/\nalias/=lib/last/',target:'lib/last/Util.sol'},
  {request:'./Util.sol',mappings:'Util.sol=./lib/remapped/Util.sol',target:'./lib/remapped/Util.sol'},
  {request:'lib/identity/Util.sol',mappings:'lib/identity/=lib/identity/',target:'lib/identity/Util.sol'},
 ]){
  const h=await fixture(t);if(!h)return;await h.put('remappings.txt',item.mappings);
  await h.put('Main.sol',`pragma solidity 0.8.24; import { Util } from "${item.request}"; contract Main { function value() public pure returns(uint256) { return Util.value(); } }`);
  await h.put(item.target,'pragma solidity 0.8.24; library Util { function value() internal pure returns(uint256) { return 7; } }');
  await h.put(join('node_modules',item.target),'This unrelated mirrored target must never be loaded.');
  const reviewed=await h.capture();assert.equal(reviewed.documents.get(item.target).uri.fsPath,join(h.root,item.target));assert.deepEqual(reviewed.snapshot.remappings,item.mappings.split('\n'));
  const host=localLanguageHost(h),main=h.vscode.window.activeTextEditor.document;
  try{
   const definition=await host.providers.Definition.provideDefinition(main,{offset:main.text.indexOf('Util.value')+5});assert.equal(definition.uri.fsPath,join(h.root,item.target));
   const compiled=await host.language.compileProject();assert.equal(compiled.ok,true);assert.ok(compiled.bytecode.length>2);assert.ok(compiled.abi.some(row=>row.name==='value'));
  }finally{host.language.dispose();}
 }
});
test('unsaved remappings are authoritative and changes, appearance and disappearance retire snapshots',async t=>{
 const h=await fixture(t);if(!h)return;
 await h.put('Main.sol','pragma solidity 0.8.24; import { Util } from "alias/Util.sol"; contract Main { function value() public pure returns(uint256) { return Util.value(); } }');
 await h.put('lib/one/Util.sol','pragma solidity 0.8.24; library Util { function value() internal pure returns(uint256) { return 1; } }');
 await h.put('lib/two/Util.sol','pragma solidity 0.8.24; library Util { function value() internal pure returns(uint256) { return 2; } }');
 const absent=await h.capture();await h.put('remappings.txt','alias/=lib/one/');await assert.rejects(absent.verify(),/configuration appeared/);
 const config=await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'remappings.txt')));config.text='alias/=lib/two/';config.version++;
 const reviewed=await h.capture();assert.ok(reviewed.snapshot.sources['lib/two/Util.sol']);assert.equal(await readFile(join(h.root,'remappings.txt'),'utf8'),'alias/=lib/one/');
 const host=localLanguageHost(h),main=h.vscode.window.activeTextEditor.document,position={offset:main.text.indexOf('Util.value')+5};
 try{
  assert.equal((await host.providers.Definition.provideDefinition(main,position)).uri.fsPath,join(h.root,'lib/two/Util.sol'));
  config.text='alias/=lib/one/';config.version++;host.events.change({document:config});await assert.rejects(reviewed.verify(),/configuration changed/);
  assert.equal((await host.providers.Definition.provideDefinition(main,position)).uri.fsPath,join(h.root,'lib/one/Util.sol'));
  assert.equal((await host.language.compileProject()).ok,true);
 }finally{host.language.dispose();}
 const saved=await h.capture();await unlink(join(h.root,'remappings.txt'));await assert.rejects(saved.verify(),/configuration appeared or disappeared/);
});
test('missing remapped targets preserve compiler diagnostics and reject later creation or unsafe configuration',async t=>{
 const h=await fixture(t);if(!h)return;await h.put('remappings.txt','alias/=lib/missing/');await h.put('Main.sol','pragma solidity 0.8.24; import "alias/Util.sol"; contract Main {}');
 await h.put('node_modules/lib/missing/Util.sol','pragma solidity 0.8.24; library FakeFallback {}');
 const reviewed=await h.capture(),host=localLanguageHost(h),main=h.vscode.window.activeTextEditor.document;
 assert.deepEqual(Object.keys(reviewed.snapshot.sources),['Main.sol']);
 try{assert.equal(await host.providers.Definition.provideDefinition(main,{offset:0}),undefined);assert.ok(host.live.rows.some(([,rows])=>rows.some(row=>row.severity===0&&/not found/i.test(row.message))));}finally{host.language.dispose();}
 await h.put('lib/missing/Util.sol','pragma solidity 0.8.24; library Util {}');await assert.rejects(reviewed.verify(),/dependency appeared/);
 const config=h.vscode.workspace.textDocuments.find(d=>d.uri.fsPath.endsWith('/remappings.txt'));config.text='alias/=../outside/';config.version++;await assert.rejects(h.capture(),/outside this project/);
 config.text='alias/=lib/linked/';config.version++;await symlink(join(h.root,'lib/missing'),join(h.root,'lib/linked'));await assert.rejects(h.capture(),/symbolic links/);
});
test('partial mapped buffers keep actual syntax diagnostics and remappings remain bounded regular files',async t=>{
 const h=await fixture(t);if(!h)return;await h.put('remappings.txt','alias/=lib/real/');await h.put('Main.sol','pragma solidity 0.8.24; import "alias/Util.sol"; contract Main { function unfinished() public { uint256 a =');await h.put('lib/real/Util.sol','pragma solidity 0.8.24; library Util {}');
 const reviewed=await h.capture();assert.ok(reviewed.snapshot.sources['lib/real/Util.sol']);const host=localLanguageHost(h),main=h.vscode.window.activeTextEditor.document;
 try{assert.equal(await host.providers.Definition.provideDefinition(main,{offset:0}),undefined);assert.ok(host.live.rows.some(([uri,rows])=>uri.fsPath===main.uri.fsPath&&rows.some(row=>row.severity===0)));}finally{host.language.dispose();}
 const limits=await fixture(t);await limits.put('Main.sol','pragma solidity 0.8.24; contract Main {}');await limits.put('remappings.txt','x'.repeat(65537));await assert.rejects(limits.capture(),/64 KiB/);
 await limits.put('remappings.txt',Array.from({length:129},(_,i)=>`p${i}/=lib/${i}/`).join('\n'));await assert.rejects(limits.capture(),/128 mappings/);
 const config=limits.vscode.workspace.textDocuments.find(d=>d.uri.fsPath.endsWith('/remappings.txt'));config.text='x'.repeat(1025)+'=lib/';config.version++;await assert.rejects(limits.capture(),/bounded local/);
 await unlink(join(limits.root,'remappings.txt'));await limits.put('config-original.txt','alias/=lib/');await symlink(join(limits.root,'config-original.txt'),join(limits.root,'remappings.txt'));await assert.rejects(limits.capture(),/symbolic links/);
});

test('first-open definition discovers closed callers including own lib, aliases and unsaved callers; all rename edits recompile',async t=>{
 const h=await fixture(t);if(!h)return;
 await h.put('remappings.txt','math/=lib/math/\nalias/=./lib/math/\n');
 await h.put('lib/math/Util.sol','pragma solidity 0.8.24; library Util { function twice(uint256 n) internal pure returns(uint256) { return n * 2; } }');
 await h.put('Main.sol','pragma solidity 0.8.24; import "math/Util.sol"; contract Main { function calculate() external pure returns(uint256) { return Util.twice(2); } }');
 await h.put('src/Other.sol','pragma solidity 0.8.24; import * as Pack from "alias/Util.sol"; contract Other { function calculate() external pure returns(uint256) { return Pack.Util.twice(3); } }');
 await h.put('lib/user/Caller.sol','pragma solidity 0.8.24; import "../math/Util.sol"; contract Caller { function calculate() external pure returns(uint256) { return Util.twice(4); } }');
 await h.put('Unrelated.sol','unfinished unrelated buffer');
 for(let i=0;i<140;i++)await h.put(`lib/vendor/Unused${i}.sol`,`pragma solidity 0.8.24; library Unused${i} {}`);
 const definition=await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'lib/math/Util.sol')));
 const other=await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'src/Other.sol')));other.text=other.text.replace('twice(3)','twice(5) + Pack.Util.twice(6)');other.version++;
 const host=localLanguageHost(h);t.after(()=>host.language.dispose());
 h.vscode.WorkspaceEdit=class{constructor(){this.edits=[];}replace(uri,range,text){this.edits.push({uri,range,text});}};
 const position={offset:definition.text.indexOf('twice(')};
 const references=await host.providers.Reference.provideReferences(definition,position,{includeDeclaration:true});
 assert.ok(references,JSON.stringify({status:host.language.status(),diagnostics:host.live.rows.map(([,rows])=>rows.map(row=>row.message))}));
 assert.equal(references.length,5);assert.equal(references.filter(row=>row.uri.fsPath===definition.uri.fsPath).length,1);
 assert.ok(references.some(row=>row.uri.fsPath===join(h.root,'Main.sol')));assert.ok(references.some(row=>row.uri.fsPath===join(h.root,'lib/user/Caller.sol')));
 const edits=await host.providers.Rename.provideRenameEdits(definition,position,'doubleValue');assert.equal(edits.edits.length,5);
 for(const document of h.vscode.workspace.textDocuments){for(const edit of edits.edits.filter(row=>row.uri.fsPath===document.uri.fsPath).sort((a,b)=>b.range.start.offset-a.range.start.offset))document.text=document.text.slice(0,edit.range.start.offset)+edit.text+document.text.slice(edit.range.end.offset);document.version++;}
 for(const file of ['Main.sol','src/Other.sol','lib/user/Caller.sol','lib/math/Util.sol']){const doc=h.vscode.workspace.textDocuments.find(row=>row.uri.fsPath===join(h.root,file));assert.match(doc.text,/doubleValue/);assert.doesNotMatch(doc.text,/\btwice\b/);await writeFile(doc.uri.fsPath,doc.text);assert.equal(await readFile(doc.uri.fsPath,'utf8'),doc.text);}
 const main=h.vscode.workspace.textDocuments.find(row=>row.uri.fsPath===join(h.root,'Main.sol'));
 const captured=await captureSolidityProject(h.vscode,h.environment,main,{compiler:join(h.extension,'compiler'),projectReferences:true});
 assert.equal(Object.keys(captured.snapshot.sources).some(unit=>unit==='Unrelated.sol'),false);
 const worker=new Worker(join(h.extension,'compiler/compiler-worker.mjs'),{workerData:{mode:'compile',name:'Main',sourceName:captured.snapshot.entryPath,localRemappings:captured.snapshot.remappings,sources:Object.fromEntries(Object.entries(captured.snapshot.sources).map(([unit,row])=>[unit,{content:row.content}]))},env:{YNX_IDE_SOLC_INPUT:join(h.extension,'compiler/node_modules/solc')},execArgv:[]});
 try{const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.abi.some(row=>row.name==='calculate'));assert.ok(result.bytecode.length>2);}finally{await worker.terminate();}
});
test('project reference inventory verifies new/deleted callers and refuses incomplete discovery bounds or symlink trees',async t=>{
 const h=await fixture(t);if(!h)return;await h.put('Main.sol','pragma solidity 0.8.24; contract Main {}');
 const doc=await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'Main.sol'))), options={compiler:join(h.extension,'compiler'),projectReferences:true};
 const captured=await captureSolidityProject(h.vscode,h.environment,doc,options);await h.put('New.sol','pragma solidity 0.8.24; contract New {}');await assert.rejects(captured.verify(),/inventory changed/);
 const second=await captureSolidityProject(h.vscode,h.environment,doc,options);await unlink(join(h.root,'New.sol'));await assert.rejects(second.verify(),/inventory changed/);
 const fresh=await captureSolidityProject(h.vscode,h.environment,doc,options);doc.text+=' // unsaved changed caller';doc.version++;await assert.rejects(fresh.verify(),/changed during review/);
 await symlink(h.root,join(h.root,'linked'));await assert.rejects(captureSolidityProject(h.vscode,h.environment,doc,options),/symbolic links/);await unlink(join(h.root,'linked'));
 for(let i=0;i<1024;i++)await h.put(`lib/C${i}.sol`,`pragma solidity 0.8.24; contract C${i} {}`);
 const host=localLanguageHost(h);t.after(()=>host.language.dispose());await assert.rejects(host.providers.Rename.prepareRename(doc,{offset:doc.text.indexOf('Main')}),/1024 files|1024 source/);
});
test('reference discovery and related compiler limits are independent and excessive related components refuse rename',async t=>{
 const h=await fixture(t);if(!h)return;
 for(let i=0;i<128;i++)await h.put(`Part${i}.sol`,`pragma solidity 0.8.24; library Part${i} {}`);
 await h.put('Main.sol','pragma solidity 0.8.24; '+Array.from({length:128},(_,i)=>`import "./Part${i}.sol";`).join(' ')+' contract Main {}');
 const doc=await h.vscode.workspace.openTextDocument(h.vscode.Uri.file(join(h.root,'Main.sol'))),host=localLanguageHost(h);t.after(()=>host.language.dispose());
 await assert.rejects(host.providers.Rename.prepareRename(doc,{offset:doc.text.indexOf('Main')}),/Related Solidity project exceeds 128 files or 2 MiB/);
});
