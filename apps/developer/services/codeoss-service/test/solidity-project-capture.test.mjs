import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const require=createRequire(import.meta.url),{captureSolidityProject}=require('../../../native/ynx-tools/src/solidity-project.cjs');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'ynx-solidity-capture-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'lib'));
 const uri=path=>({scheme:'file',fsPath:path,toString:()=>`file://${path}`});
 const documents=[];for(const name of ['PinCheck.sol','lib/Math.sol']){const path=join(root,name);await writeFile(path,'saved source differs');documents.push({uri:uri(path),version:3,isClosed:false,text:`unsaved ${name}`,getText(){return this.text;}});}
 const environment={YNX_CORE_SESSION_ID:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',YNX_CORE_WORKSPACE:root};
 const vscode={window:{activeTextEditor:{document:documents[0],selection:{isEmpty:true}}},workspace:{workspaceFolders:[{uri:uri(root)}],textDocuments:documents,async findFiles(pattern,exclude,max){assert.equal(pattern,'**/*.sol');assert.match(exclude,/node_modules/);assert.equal(max,33);return documents.map(doc=>doc.uri);},async openTextDocument(uri){return documents.find(doc=>doc.uri.toString()===uri.toString());}}};
 return{root,documents,environment,vscode};
}
test('captures unsaved buffers under canonical project root and rechecks every version before copying',async t=>{
 const h=await fixture(t),captured=await captureSolidityProject(h.vscode,h.environment);
 assert.equal(captured.snapshot.entryPath,'PinCheck.sol');assert.equal(captured.snapshot.sources['lib/Math.sol'].content,'unsaved lib/Math.sol');await captured.verify();
 h.documents[1].text+=' edit';h.documents[1].version++;await assert.rejects(captured.verify(),/changed during review/);
});
test('runtime changes, foreign roots, and source symlink escapes never produce a snapshot',async t=>{
 const h=await fixture(t),captured=await captureSolidityProject(h.vscode,h.environment);h.environment.YNX_CORE_SESSION_ID='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';await assert.rejects(captured.verify(),/runtime changed/);
 h.environment.YNX_CORE_SESSION_ID=captured.snapshot.sessionId;
 const outside=await mkdtemp(join(tmpdir(),'ynx-solidity-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));await writeFile(join(outside,'Secret.sol'),'outside private source');
 await rm(join(h.root,'lib/Math.sol'));await symlink(join(outside,'Secret.sol'),join(h.root,'lib/Math.sol'));
 await assert.rejects(captureSolidityProject(h.vscode,h.environment),/outside this project/);
 h.vscode.workspace.workspaceFolders.push({uri:h.documents[0].uri});await assert.rejects(captureSolidityProject(h.vscode,h.environment),/one active YNX project/);
});
test('local desktop capture has a distinct project protocol and cannot become an online session',async t=>{
 const h=await fixture(t);delete h.environment.YNX_CORE_SESSION_ID;delete h.environment.YNX_CORE_WORKSPACE;
 Object.assign(h.environment,{YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:h.root,YNX_LOCAL_PROJECT_ID:'cccccccc-cccc-cccc-cccc-cccccccccccc'});
 const captured=await captureSolidityProject(h.vscode,h.environment);
 assert.equal(captured.snapshot.protocol,'ynx-solidity-local-project/v1');assert.equal(captured.snapshot.projectId,h.environment.YNX_LOCAL_PROJECT_ID);assert.equal(captured.snapshot.sessionId,undefined);await captured.verify();
 h.environment.YNX_CORE_SESSION_ID='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';await assert.rejects(captured.verify(),/runtime changed/);await assert.rejects(captureSolidityProject(h.vscode,h.environment),/cannot use a canonical/);
 delete h.environment.YNX_CORE_SESSION_ID;h.environment.YNX_WORKSPACE_MODE='online';await assert.rejects(captured.verify(),/runtime changed/);
});
test('actual registered project command copies only after unchanged-source review and opens a source-free locator',async t=>{
 const h=await fixture(t),commands=new Map(),calls=[],errors=[];
 h.vscode.languages={createDiagnosticCollection:()=>({set:()=>{},clear:()=>{},dispose:()=>{}})};h.vscode.workspace.onDidChangeTextDocument=()=>({});h.vscode.workspace.onDidChangeWorkspaceFolders=()=>({});
 h.vscode.window.onDidChangeActiveTextEditor=()=>({});h.vscode.window.onDidChangeTextEditorSelection=()=>({});
 h.vscode.commands={executeCommand:async()=>{},registerCommand:(name,action)=>{commands.set(name,action);return{};}};
 h.vscode.Uri={parse:value=>value};h.vscode.env={clipboard:{writeText:async value=>calls.push({kind:'copy',value})},openExternal:async value=>calls.push({kind:'open',value})};
 h.vscode.workspace.registerTextDocumentContentProvider=()=>({});h.vscode.workspace.onDidCloseTextDocument=()=>({});
 h.vscode.window.registerTreeDataProvider=()=>({});h.vscode.window.showErrorMessage=message=>errors.push(message);
 h.vscode.window.showInformationMessage=async()=>'Copy project sources';
 const module={exports:{}};vm.runInNewContext(await readFile(new URL('../../../native/ynx-tools/src/extension.cjs',import.meta.url),'utf8'),{module,require:name=>name==='vscode'?h.vscode:require('../../../native/ynx-tools/src/'+name.slice(2)),process:{env:h.environment},Buffer});module.exports.activate({subscriptions:[]});
 await commands.get('ynx.copySolidityProject')();assert.deepEqual(errors,[]);assert.deepEqual(calls.map(item=>item.kind),['copy','open']);assert.equal(JSON.parse(calls[0].value).sources['PinCheck.sol'].documentVersion,3);assert.match(calls[1].value,/^https:\/\/developer\.ynxweb4\.com\/native-tools\?sessionId=[a-f0-9-]+#compile$/);assert.doesNotMatch(calls[1].value,/unsaved|source|sha256/);
 calls.length=0;h.vscode.window.showInformationMessage=async()=>{h.documents[0].version++;return'Copy project sources';};await commands.get('ynx.copySolidityProject')();assert.equal(calls.length,0);assert.match(errors[0],/changed during review/);
});
