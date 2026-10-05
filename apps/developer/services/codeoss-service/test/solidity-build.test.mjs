import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CancellationTokenSource } = require('../../../runtime/theia/node_modules/@theia/core/lib/common/cancellation');
const { createSolidityLanguage } = require('../../../native/ynx-tools/src/solidity-language.cjs');
const { createSolidityBuild, validBuild } = require('../../../native/ynx-tools/src/solidity-build.cjs');
async function fixture(t) {
  assert.ok(process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT, 'Supply the retained compiler bundle; this suite must not skip actual compilation.');
  const extensionPath = await realpath(process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT);
  assert.ok(extensionPath.includes('/apps/developer/.ynx-developer-candidates/'));
  const root = await mkdtemp('/private/tmp/ynx-solidity-build-'), docs = [], subscriptions = [];
  const uri = fsPath => ({scheme:'file',fsPath,toString:()=>`file://${fsPath}`});
  const rows = {Main:'pragma solidity 0.8.24; import "./Lib.sol"; contract Main { function value() public pure returns(uint) {return Lib.value();} } contract Other {}',Lib:'pragma solidity 0.8.24; library Lib { function value() internal pure returns(uint) {return 9;} }'};
  for (const [name,content] of Object.entries(rows)) await writeFile(join(root,name+'.sol'),content,{flag:'wx'});
  await mkdir(join(root,'.vscode')); const settingsPath=join(root,'.vscode/settings.json');
  await writeFile(settingsPath,JSON.stringify({'editor.tabSize':3}),{flag:'wx'});
  const h={root,docs,artifact:[],messages:[],commands:[],pickCount:0,cancelProgress:false,phaseCancel:undefined,changeAtPick:undefined};
  const collection={rows:[],clear(){this.rows=[];},set(value){this.rows=value;},dispose(){}};h.diagnostics=collection;
  let settings=JSON.parse(await readFile(settingsPath,'utf8'));
  const api={Uri:{file:uri}, CancellationTokenSource, ConfigurationTarget:{WorkspaceFolder:3}, ProgressLocation:{Notification:15},
    DiagnosticSeverity:{Error:0,Warning:1,Information:2},
    Range:class{constructor(start,end){Object.assign(this,{start,end});}},Diagnostic:class{constructor(range,message,severity){Object.assign(this,{range,message,severity});}},
    commands:{async executeCommand(id){h.commands.push(id);}},
    workspace:{isTrusted:true,workspaceFolders:[{uri:uri(root)}],textDocuments:docs,
      async openTextDocument(input){if(typeof input.content==='string'){h.artifact.push(JSON.parse(input.content));return input;}let doc=docs.find(d=>d.uri.fsPath===input.fsPath);if(!doc){doc={uri:input,version:1,isClosed:false,text:await readFile(input.fsPath,'utf8'),getText(){return this.text;},positionAt(offset){return {offset};},offsetAt(position){return position.offset;}};docs.push(doc);}return doc;},
      getConfiguration(section,folder){assert.equal(section,'ynx.solidity');assert.equal(folder.fsPath,root);return {inspect(key){return {workspaceFolderValue:settings['ynx.solidity.'+key]};},async update(key,value,target){assert.equal(target,3);settings['ynx.solidity.'+key]=value;await writeFile(settingsPath,JSON.stringify(settings));await h.afterConfigUpdate?.();}};},
      onDidChangeTextDocument:()=>({dispose(){}}),onDidCloseTextDocument:()=>({dispose(){}}),onDidChangeWorkspaceFolders:()=>({dispose(){}})},
    languages:{createDiagnosticCollection:()=>collection,...Object.fromEntries(['Definition','Hover','Reference','DocumentSymbol'].map(name=>['register'+name+'Provider',()=>({dispose(){}})]))},
    window:{async showTextDocument(input){h.shown=input;},async showQuickPick(items,_options,token){h.pickToken=token;h.pickCount++;h.pickReached?.();await h.pickWait;await h.changeAtPick?.();return h.cancelPick ? undefined : items.find(item=>item.label===(h.pickName||'Main'));},async showInformationMessage(message){h.messages.push(message);},async withProgress(options,action){assert.equal(options.cancellable,true);let listener;const token={isCancellationRequested:false,onCancellationRequested(fn){listener=fn;return {dispose(){listener=undefined;}};}};return action({report(value){if(h.progressThrows)throw Error('Progress transport failed');if(value.message===h.phaseCancel){if(h.explicitCancel) assert.equal(h.build.cancel(),true); else {token.isCancellationRequested=true;listener?.();}}}},token);}}
  };
  const environment={YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:'cccccccc-cccc-cccc-cccc-cccccccccccc'};
  api.window.activeTextEditor={document:await api.workspace.openTextDocument(uri(join(root,'Main.sol')))};
  h.api=api;h.environment=environment;h.settingsPath=settingsPath;h.rows=rows;
  h.reopen=async()=>{settings=JSON.parse(await readFile(settingsPath,'utf8'));h.language?.dispose();h.language=createSolidityLanguage(api,{extensionPath,subscriptions},environment);h.build=createSolidityBuild(api,h.language,environment);};
  await h.reopen(); t.after(()=>h.language.dispose());
  h.setConfig=async value=>{settings['ynx.solidity.build']=value;await writeFile(settingsPath,JSON.stringify(settings));};
  return h;
}
test('first real local build captures unopened imports, persists entry/contract and reopen reuses it',async t=>{
 const h=await fixture(t);assert.equal(h.docs.length,1);const result=await h.build.compile();
 assert.equal(result.ok,true);assert.equal(result.contractName,'Main');assert.equal(result.compiler.version,'0.8.24');assert.ok(result.bytecode.length>20);assert.ok(result.abi.some(item=>item.name==='value'));
 assert.ok(h.docs.some(d=>d.uri.fsPath.endsWith('/Lib.sol')));assert.equal(h.pickCount,1);
 const settings=JSON.parse(await readFile(h.settingsPath,'utf8'));assert.equal(settings['editor.tabSize'],3);assert.deepEqual(settings['ynx.solidity.build'],{entryPath:'Main.sol',contractName:'Main'});
 await h.reopen();await h.build.compile();assert.equal(h.pickCount,1);assert.equal(h.artifact.length,2);assert.match(h.messages.at(-1),/does not submit a transaction/);
});
test('actual unsaved import error publishes fresh navigable Problems and repeat build recovers',async t=>{
 const h=await fixture(t);const lib=await h.api.workspace.openTextDocument(h.api.Uri.file(join(h.root,'Lib.sol')));lib.text=h.rows.Lib.replace('return 9;','return unknown;');lib.version++;
 await assert.rejects(h.build.compile(),/Problems/);assert.equal(h.artifact.length,0);assert.ok(h.commands.includes('workbench.actions.view.problems'));
 const error=h.diagnostics.rows.find(([uri])=>uri.fsPath.endsWith('/Lib.sol'))[1].find(row=>row.severity===0);assert.ok(error);assert.equal(error.range.start.offset,lib.text.indexOf('unknown'));assert.equal(error.range.end.offset,error.range.start.offset+7);
 lib.text=h.rows.Lib;lib.version++;assert.equal((await h.build.compile()).ok,true);assert.ok(h.diagnostics.rows.every(([,rows])=>rows.every(row=>row.severity!==0)));
});
test('picker cancellation creates no configuration or artifact and immediately permits repeat',async t=>{
 const h=await fixture(t);h.cancelPick=true;assert.equal(await h.build.compile(),undefined);assert.equal(h.language.status().active,0);assert.equal(JSON.parse(await readFile(h.settingsPath,'utf8'))['ynx.solidity.build'],undefined);
 h.cancelPick=false;assert.equal((await h.build.compile()).ok,true);
});
test('actual analysis/compile Worker cancellation retires slot before immediate repeat',async t=>{
 const h=await fixture(t);
 for(const phase of ['Checking Solidity sources','Producing ABI and bytecode']) {h.phaseCancel=phase;h.explicitCancel=phase==='Producing ABI and bytecode';assert.equal(await h.build.compile(),undefined);assert.equal(h.language.status().active,0);assert.equal(h.artifact.length,0);}
 h.phaseCancel=undefined;assert.equal((await h.build.compile()).ok,true);assert.equal(h.build.cancel(),false);
});
test('missing or malformed saved contract has clear configure repair, no wrong-contract build',async t=>{
 const h=await fixture(t);await h.setConfig({entryPath:'Main.sol',contractName:'Missing'});await assert.rejects(h.build.compile(),/Configure Solidity Build/);assert.equal(h.artifact.length,0);
 await h.setConfig({entryPath:'../outside.sol',contractName:'Main'});await assert.rejects(h.build.compile(),/configuration is invalid/);
 assert.equal((await h.build.configure()).contractName,'Main');assert.equal(h.artifact.length,0);assert.equal((await h.build.compile()).ok,true);
});
test('changed editor text or project at contract selection cannot save or produce stale artifact',async t=>{
 const h=await fixture(t);h.changeAtPick=async()=>{const doc=h.api.window.activeTextEditor.document;doc.text+=' // changed';doc.version++;};
 await assert.rejects(h.build.compile(),/source changed/);assert.equal(h.artifact.length,0);assert.equal(JSON.parse(await readFile(h.settingsPath,'utf8'))['ynx.solidity.build'],undefined);
 h.changeAtPick=async()=>{h.environment.YNX_LOCAL_PROJECT_ID='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';};await assert.rejects(h.build.compile(),/runtime changed|trusted local/);assert.equal(h.artifact.length,0);
});
test('project setting grammar is bounded and rejects inherited extra fields',()=>{
 assert.equal(validBuild({entryPath:'src/A.sol',contractName:'A'}),true);
 for(const value of [{entryPath:'../A.sol',contractName:'A'},{entryPath:'A.sol',contractName:'a;delete'},{entryPath:'A.sol',contractName:'A',compiler:'untrusted'},null])assert.ok(!validBuild(value));
});

test('opening the real compiler artifact changes focus without rejecting the completed build',async t=>{
 const h=await fixture(t), source=h.api.window.activeTextEditor.document;
 h.api.window.showTextDocument=async input=>{h.shown=input;h.api.window.activeTextEditor={document:{uri:{scheme:'untitled'},isClosed:false}};};
 const result=await h.build.compile();
 assert.equal(result.ok,true);assert.ok(result.bytecode.length>20);assert.equal(h.artifact.length,1);
 assert.equal(source.isClosed,false);assert.match(h.messages.at(-1),/does not submit a transaction/);
});

test('artifact focus change does not allow a changed project to report build success',async t=>{
 const h=await fixture(t);
 h.api.window.showTextDocument=async()=>{h.environment.YNX_LOCAL_PROJECT_ID='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';h.api.window.activeTextEditor={document:{uri:{scheme:'untitled'},isClosed:false}};};
 await assert.rejects(h.build.compile(),/trusted local/);assert.equal(h.messages.length,0);
});

test('cancel while picker waits prevents its late reply from configuring or compiling',async t=>{
 const h=await fixture(t);let release;h.pickWait=new Promise(resolve=>{release=resolve;});const reached=new Promise(resolve=>{h.pickReached=resolve;});
 const task=h.build.compile();await reached;assert.equal(h.build.cancel(),true);assert.equal(h.pickToken.isCancellationRequested,true);assert.equal(await task,undefined);assert.equal(h.language.status().active,0);release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.artifact.length,0);assert.equal(JSON.parse(await readFile(h.settingsPath,'utf8'))['ynx.solidity.build'],undefined);h.pickWait=undefined;h.pickReached=undefined;assert.equal((await h.build.compile()).ok,true);
});
test('observed concurrent project setting edits are retained and stop the artifact',async t=>{
 const h=await fixture(t);h.changeAtPick=()=>h.setConfig({entryPath:'Main.sol',contractName:'Other'});
 await assert.rejects(h.build.compile(),/configuration changed/);assert.equal(h.artifact.length,0);assert.equal(JSON.parse(await readFile(h.settingsPath,'utf8'))['ynx.solidity.build'].contractName,'Other');
 h.changeAtPick=undefined;h.afterConfigUpdate=()=>h.setConfig({entryPath:'Main.sol',contractName:'Other'});h.pickName='Main';
 await assert.rejects(h.build.configure(),/configuration changed/);assert.equal(h.artifact.length,0);assert.equal(JSON.parse(await readFile(h.settingsPath,'utf8'))['ynx.solidity.build'].contractName,'Other');
});

test('progress transport exceptions observe real Worker termination and permit retry',async t=>{
 const h=await fixture(t);h.progressThrows=true;await assert.rejects(h.build.compile(),/Progress transport failed/);assert.equal(h.language.status().active,0);assert.equal(h.artifact.length,0);
 h.progressThrows=false;assert.equal((await h.build.compile()).ok,true);
});
