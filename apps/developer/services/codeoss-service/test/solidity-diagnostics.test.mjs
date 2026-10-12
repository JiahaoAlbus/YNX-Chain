import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {mkdtemp,writeFile,rm,symlink,unlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {solidityDiagnosticsBundle} from '../../../frontend/src/codeoss/solidityDiagnostics.ts';
import {createSolidityCompiler} from '../src/solidity-compiler.mjs';import {compilerReadiness} from '../../../scripts/compiler-pin.mjs';
const require=createRequire(import.meta.url),{parseDiagnostics,byteOffset,createSolidityDiagnostics}=require('../../../native/ynx-tools/src/solidity-diagnostics.cjs'),{digest}=require('../../../native/ynx-tools/src/guards.cjs');
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
async function fixture(t,content='// 中文😀\ncontract Broken { broken }'){
 const root=await mkdtemp(join(tmpdir(),'ynx-solidity-problems-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=join(root,'Broken.sol');await writeFile(file,content);
 const uri=path=>({scheme:'file',fsPath:path,toString:()=> 'file://'+path});const document={uri:uri(file),version:2,getText:()=>content,positionAt:offset=>{const lines=content.slice(0,offset).split('\n');return {line:lines.length-1,character:lines.at(-1).length};}};
 const events={},published=[],clears=[];const environment={YNX_CORE_SESSION_ID:id,YNX_CORE_WORKSPACE:root};const snapshot={protocol:'ynx-solidity-project/v1',sessionId:id,entryPath:'Broken.sol',sources:{'Broken.sol':{content,sha256:digest(content),documentVersion:2}}};
 let clipboard=JSON.stringify({protocol:'ynx-solidity-diagnostics/v1',snapshot,diagnostics:[{file:'Broken.sol',start:Buffer.byteLength(content.slice(0,content.indexOf('broken'))),end:Buffer.byteLength(content.slice(0,content.indexOf('broken')+6)),severity:'error',message:'Real source problem',code:'123'}]});
 const vscode={Uri:{file:uri},Range:class{constructor(start,end){this.start=start;this.end=end;}},Diagnostic:class{constructor(range,message,severity){Object.assign(this,{range,message,severity});}},DiagnosticSeverity:{Error:0,Warning:1,Information:2},languages:{createDiagnosticCollection:()=>({set:rows=>published.push(rows),clear:()=>clears.push(true),dispose:()=>{}})},env:{clipboard:{readText:async()=>clipboard}},window:{onDidChangeActiveTextEditor:fn=>{events.active=fn;return{};}},workspace:{workspaceFolders:[{uri:uri(root)}],textDocuments:[document],openTextDocument:async()=>document,onDidChangeTextDocument:fn=>{events.edit=fn;return{};},onDidCloseTextDocument:fn=>{events.close=fn;return{};},onDidChangeWorkspaceFolders:fn=>{events.folders=fn;return{};}}};
 const manager=createSolidityDiagnostics(vscode,{subscriptions:[]},environment);return {root,file,document,snapshot,vscode,environment,events,published,clears,manager,get clipboard(){return clipboard;},set clipboard(value){clipboard=value;}};
}
test('real compiler Unicode byte offsets map to precise editor Problems ranges',async t=>{
 if(!compilerReadiness().available)return t.skip('Supply reviewed compiler closure.');
 const content='// SPDX-License-Identifier: MIT\n// 中文😀\npragma solidity 0.8.24;\ncontract Broken { broken }';const h=await fixture(t,content),compiler=createSolidityCompiler();const result=await compiler.compile({owner:'controlled-owner',name:'Broken',source:content});assert.equal(result.ok,false);
 h.clipboard=JSON.stringify(solidityDiagnosticsBundle(h.snapshot,result.diagnostics));await h.manager.importCopied();assert.equal(h.published.length,1);const rows=h.published[0][0][1],error=rows.find(row=>row.severity===0);assert.ok(error);assert.equal(error.source,'YNX Solidity');const location=result.diagnostics.find(row=>row.severity==='error').formattedMessage.match(/Broken\.sol:(\d+):(\d+):/);assert.ok(location);assert.equal(error.range.start.line,Number(location[1])-1);assert.equal(error.range.start.character,Number(location[2])-1);assert.equal(await import('node:fs/promises').then(fs=>fs.readFile(h.file,'utf8')),content);assert.equal(compiler.status().active,0);
});
test('foreign, changed, oversized, split-Unicode or unknown-file messages cannot publish or erase existing Problems',async t=>{
 const h=await fixture(t),valid=JSON.parse(h.clipboard);await h.manager.importCopied();
 const invalid=[{...valid,snapshot:{...valid.snapshot,sessionId:'foreign'}},{...valid,diagnostics:[{...valid.diagnostics[0],file:'../outside.sol'}]},{...valid,diagnostics:[{...valid.diagnostics[0],file:['Broken.sol']}]},{...valid,diagnostics:[{...valid.diagnostics[0],message:'x'.repeat(8193)}]},{...valid,diagnostics:[{...valid.diagnostics[0],start:4,end:4}]},{...valid,snapshot:{...valid.snapshot,sources:{'Broken.sol':{...valid.snapshot.sources['Broken.sol'],content:'changed'}}}}];
 for(const value of invalid){h.clipboard=JSON.stringify(value);await assert.rejects(h.manager.importCopied());}
 h.clipboard='unrelated private clipboard';await assert.rejects(h.manager.importCopied(),error=>!error.message.includes('private'));assert.equal(h.published.length,1);assert.equal(h.clears.length,0);
});
test('a dependency edit or close retires the complete imported compiler review',async t=>{
 const h=await fixture(t);await h.manager.importCopied();h.document.version++;h.events.edit({document:h.document});assert.equal(h.clears.length,1);await assert.rejects(h.manager.importCopied(),/source changed/);assert.equal(h.published.length,1);
 h.document.version--;await h.manager.importCopied();h.events.close(h.document);assert.equal(h.clears.length,2);h.events.folders();assert.equal(h.clears.length,3);
});
test('same-content symlink swaps are refused by real file identity before publishing',async t=>{
 const h=await fixture(t),first=join(h.root,'First.sol'),second=join(h.root,'Second.sol');await writeFile(first,h.document.getText());await writeFile(second,h.document.getText());await unlink(h.file);await symlink(first,h.file);
 h.vscode.workspace.openTextDocument=async()=>{await unlink(h.file);await symlink(second,h.file);return h.document;};await assert.rejects(h.manager.importCopied(),/path changed/);assert.equal(h.published.length,0);
});
test('runtime retirement while clipboard is pending cannot read sources or publish',async t=>{
 const h=await fixture(t);let release;h.vscode.env.clipboard.readText=()=>new Promise(resolve=>{release=resolve;});const pending=h.manager.importCopied();h.environment.YNX_CORE_SESSION_ID='retired';release(h.clipboard);await assert.rejects(pending,/project changed/);assert.equal(h.published.length,0);
});
test('source-free compiler messages remain separate and UTF8 boundaries reject surrogate interiors',()=>{
 assert.equal(byteOffset('中😀x',7),3);assert.throws(()=>byteOffset('中😀x',4));const snapshot={sources:{'A.sol':{}}};const bundle=solidityDiagnosticsBundle(snapshot,[{severity:'error',message:'global message'},{severity:'warning',message:'located',sourceLocation:{file:'A.sol',start:-1,end:-1}}]);assert.equal(bundle.diagnostics.length,1);
});
