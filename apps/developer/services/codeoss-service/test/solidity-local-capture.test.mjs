import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, realpath } from 'node:fs/promises';
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
 const vscode={Uri:{file:uri},workspace:{workspaceFolders:[{uri:uri(root)}],textDocuments:documents,findFiles(){throw Error('Import closure must not scan the project.');},async openTextDocument(value){let doc=documents.find(d=>d.uri.fsPath===value.fsPath);if(!doc){doc={uri:value,isClosed:false,version:1,text:await readFile(value.fsPath,'utf8'),getText(){return this.text;}};documents.push(doc);}return doc;}}};
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
  h.vscode.languages=Object.fromEntries(['Definition','Hover','Reference','DocumentSymbol'].map(name=>[`register${name}Provider`,(_,provider)=>{providers[name]=provider;return{dispose(){}};}]));
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
