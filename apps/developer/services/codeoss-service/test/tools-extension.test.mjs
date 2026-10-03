import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import { createRequire } from 'node:module';
const localRequire = createRequire(import.meta.url), source = await readFile(new URL('../../../native/ynx-tools/src/extension.cjs', import.meta.url), 'utf8');
const { digest } = localRequire('../../../native/ynx-tools/src/guards.cjs');
function harness({ answer, exists = false, onModal, selectionEdit = false, workspace = '/project', filePath = '/project/a.ts', pathGuard = async () => {}, folderPath = workspace, directoryGuard = async (folder,root) => ({realWorkspace:root,realDirectory:folder}) } = {}) {
  const commands = new Map(), errors = [], calls = [], id = '12345678-1234-1234-1234-123456789012';
  class FileSystemError extends Error { constructor() { super('absent'); this.code = 'FileNotFound'; } }
  let text = 'saved draft', version = 1; const runtimeEnv = { YNX_CORE_SESSION_ID: id, YNX_CORE_WORKSPACE: workspace };
  const uri = { fsPath: filePath, toString: () => 'file://' + filePath }, doc = { uri, languageId: 'typescript', get version() { return version; }, getText: () => text, positionAt: offset => offset };
  const bundle = JSON.stringify({ protocol: 'ynx-reviewed-text/v1', sessionId: id, changes: [{ uri: uri.toString(), version, fullTextDigest: digest(text), ...(selectionEdit ? {replacements:[{find:'saved draft',replace:'suggested'}]} : {text:'suggested'}) }] });
  class WorkspaceEdit { constructor() { this.operations = []; } createFile(uri, options) { this.operations.push({ type: 'create', uri, options }); } insert(uri, position, text) { this.operations.push({ type: 'insert', uri, text }); } replace(uri, range, text) { this.operations.push({ type: 'replace', uri, text }); } }
  const vscode = { FileSystemError, WorkspaceEdit, Position: class {}, Range: class {}, Uri: { parse: value => value, joinPath: (root, name) => ({fsPath:join(root.fsPath,name),toString:()=> 'file://'+join(root.fsPath,name)}) },
    env: { clipboard: { writeText: async value => calls.push({ type: 'clipboard', value }) }, openExternal: async url => calls.push({ type: 'open', url }) },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return {}; }, executeCommand: async (...args) => calls.push({ type: 'preview', args }) },
    window: { activeTextEditor: { document: doc, selection: { isEmpty: false } }, registerTreeDataProvider: () => ({}), showErrorMessage: value => errors.push(value), showTextDocument: async () => {}, showInputBox: async () => bundle,
      showInformationMessage: async () => { await onModal?.(() => version++, runtimeEnv); return answer; }, showWarningMessage: async () => { await onModal?.(() => version++, runtimeEnv); return answer; } },
    workspace: { workspaceFolders: [{ uri: {fsPath:folderPath,toString:()=> 'file://'+folderPath} }], textDocuments: [doc], fs: { stat: async () => { if (!exists) throw new FileSystemError(); return {}; } }, openTextDocument: async () => ({ uri: 'untitled:preview' }), applyEdit: async edit => { calls.push({ type: 'edit', operations: edit.operations }); return true; } }
  };
  const module = { exports: {} }; vm.runInNewContext(source, { module, require: name => name === 'vscode' ? vscode : name === './guards.cjs' ? { ...localRequire('../../../native/ynx-tools/src/guards.cjs'), assertWorkspacePath: pathGuard, assertWorkspaceDirectory: directoryGuard } : localRequire('../../../native/ynx-tools/src/' + name.slice(2)), process: { env: runtimeEnv }, Buffer });
  module.exports.activate({ subscriptions: [] }); return { commands, errors, calls, vscode };
}
test('actual extension command opens only fixed trusted host locator; canceled context stays local', async () => {
  const h = harness(); await h.commands.get('ynx.openTools')(); assert.deepEqual(h.calls.map(x => x.type), ['open']); assert.match(h.calls[0].url, /^https:\/\/developer\.ynxweb4\.com\/native-tools\?sessionId=/); assert.equal(h.calls[0].url.includes('saved'), false);
  await h.commands.get('ynx.copyContext')(); assert.equal(h.calls.length, 1);
});
test('actual template command never overwrites existing file; creation uses atomic no-overwrite edit', async () => {
  const existing = harness({ exists: true, answer: 'Create starter' }); await existing.commands.get('ynx.createTemplate')(); assert.equal(existing.calls.length, 0); assert.match(existing.errors[0], /already exists/);
  const fresh = harness({ answer: 'Create starter' }); await fresh.commands.get('ynx.createTemplate')(); const operations = fresh.calls[0].operations;
  assert.equal(operations[0].options.overwrite, false); assert.equal(operations[0].options.ignoreIfExists, false); assert.match(operations[1].text, /6423n/); assert.doesNotMatch(operations[1].text, /eth_sendTransaction|privateKey/);
});
test('actual diff command previews then rejects edit made during approval; no changes applied', async () => {
  const h = harness({ answer: 'Apply reviewed changes', onModal: change => change() }); await h.commands.get('ynx.applyReviewedDiff')(); assert.deepEqual(h.calls.map(x => x.type), ['preview']); assert.match(h.errors[0], /changed/);
});

test('actual extension previews a selected replacement and applies only after explicit unchanged-document approval',async()=>{
 const accepted=harness({answer:'Apply reviewed changes',selectionEdit:true});await accepted.commands.get('ynx.applyReviewedDiff')();
 assert.deepEqual(accepted.errors,[]);assert.deepEqual(accepted.calls.map(call=>call.type),['preview','edit']);assert.equal(accepted.calls[1].operations[0].text,'suggested');
 const changed=harness({answer:'Apply reviewed changes',selectionEdit:true,onModal:change=>change()});await changed.commands.get('ynx.applyReviewedDiff')();
 assert.deepEqual(changed.calls.map(call=>call.type),['preview']);assert.match(changed.errors[0],/changed/);
});


test('copy command uses real filesystem project containment before and after approval',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-native-copy-')),outside=await mkdtemp(join(tmpdir(),'ynx-native-outside-'));t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
 const own=join(root,'a.ts'),foreign=join(outside,'foreign.ts');await writeFile(own,'saved draft');await writeFile(foreign,'foreign private');
 const {assertWorkspacePath}=localRequire('../../../native/ynx-tools/src/guards.cjs');
 const valid=harness({answer:'Copy selection',workspace:root,filePath:own,pathGuard:assertWorkspacePath});await valid.commands.get('ynx.copyContext')();
 assert.deepEqual(valid.errors,[]);assert.equal(valid.calls[0].type,'clipboard');assert.equal(JSON.parse(valid.calls[0].value).selectedText,'saved draft');
 const denied=harness({answer:'Copy selection',workspace:root,filePath:foreign,pathGuard:assertWorkspacePath});await denied.commands.get('ynx.copyContext')();assert.equal(denied.calls.length,0);assert.match(denied.errors[0],/outside/);
 const switched=harness({answer:'Copy selection',workspace:root,filePath:own,pathGuard:assertWorkspacePath,onModal:async()=>{await unlink(own);await symlink(foreign,own);}});await switched.commands.get('ynx.copyContext')();assert.equal(switched.calls.length,0);assert.match(switched.errors[0],/outside/);
});
test('copy approval rejects missing runtime, changed session and document mutation during final path check',async()=>{
 const missing=harness({answer:'Copy selection',workspace:''});await missing.commands.get('ynx.copyContext')();assert.equal(missing.calls.length,0);assert.match(missing.errors[0],/active YNX project/);
 const switched=harness({answer:'Copy selection',onModal:(_,env)=>{env.YNX_CORE_SESSION_ID='changed';}});await switched.commands.get('ynx.copyContext')();assert.equal(switched.calls.length,0);assert.match(switched.errors[0],/runtime changed/);
 let checks=0,mutate;const changed=harness({answer:'Copy selection',onModal:change=>{mutate=change;},pathGuard:async()=>{if(++checks===2)mutate();}});await changed.commands.get('ynx.copyContext')();assert.equal(changed.calls.length,0);assert.match(changed.errors[0],/document changed/);
 let runtimeChecks=0,currentEnv;const runtimeChanged=harness({answer:'Copy selection',onModal:(_,env)=>{currentEnv=env;},pathGuard:async()=>{if(++runtimeChecks===2)currentEnv.YNX_CORE_WORKSPACE='/other';}});await runtimeChanged.commands.get('ynx.copyContext')();assert.equal(runtimeChanged.calls.length,0);assert.match(runtimeChanged.errors[0],/runtime changed/);
});


test('starter creation validates real project root/subfolder and refuses external or swapped folders',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-native-starter-')),outside=await mkdtemp(join(tmpdir(),'ynx-native-starter-outside-'));t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
 const sub=join(root,'sub');await mkdir(sub);const {assertWorkspaceDirectory}=localRequire('../../../native/ynx-tools/src/guards.cjs');
 for(const folderPath of [root,sub]){const own=harness({answer:'Create starter',workspace:root,folderPath,directoryGuard:assertWorkspaceDirectory});await own.commands.get('ynx.createTemplate')();assert.deepEqual(own.errors,[]);assert.equal(own.calls[0].operations[0].uri.fsPath,join(folderPath,'ynx-testnet-readonly.mjs'));assert.equal(own.calls[0].operations[0].options.overwrite,false);}
 const denied=harness({answer:'Create starter',workspace:root,folderPath:outside,directoryGuard:assertWorkspaceDirectory});await denied.commands.get('ynx.createTemplate')();assert.equal(denied.calls.length,0);assert.match(denied.errors[0],/outside/);
 const link=join(root,'linked');await symlink(sub,link);const swapped=harness({answer:'Create starter',workspace:root,folderPath:link,directoryGuard:assertWorkspaceDirectory,onModal:async()=>{await unlink(link);await symlink(outside,link);}});await swapped.commands.get('ynx.createTemplate')();assert.equal(swapped.calls.length,0);assert.match(swapped.errors[0],/outside/);
 const insideLink=join(root,'inside-link');await symlink(sub,insideLink);const movedInside=harness({answer:'Create starter',workspace:root,folderPath:insideLink,directoryGuard:assertWorkspaceDirectory,onModal:async()=>{await unlink(insideLink);await symlink(root,insideLink);}});await movedInside.commands.get('ynx.createTemplate')();assert.equal(movedInside.calls.length,0);assert.match(movedInside.errors[0],/folder or runtime changed/);
 const runtimeLink=join(root,'runtime-link');await symlink(root,runtimeLink);const rootChanged=harness({answer:'Create starter',workspace:runtimeLink,folderPath:runtimeLink,directoryGuard:assertWorkspaceDirectory,onModal:async()=>{await unlink(runtimeLink);await symlink(outside,runtimeLink);}});await rootChanged.commands.get('ynx.createTemplate')();assert.equal(rootChanged.calls.length,0);assert.match(rootChanged.errors[0],/folder or runtime changed/);
});
test('starter approval is retired on runtime or displayed workspace-folder change',async()=>{
 const missing=harness({answer:'Create starter',workspace:''});await missing.commands.get('ynx.createTemplate')();assert.equal(missing.calls.length,0);assert.match(missing.errors[0],/active YNX project/);
 const switched=harness({answer:'Create starter',onModal:(_,env)=>{env.YNX_CORE_SESSION_ID='retired';}});await switched.commands.get('ynx.createTemplate')();assert.equal(switched.calls.length,0);assert.match(switched.errors[0],/runtime changed/);
 let moved;moved=harness({answer:'Create starter',onModal:()=>{moved.vscode.workspace.workspaceFolders=[{uri:{fsPath:'/other',toString:()=> 'file:///other'}}];}});await moved.commands.get('ynx.createTemplate')();assert.equal(moved.calls.length,0);assert.match(moved.errors[0],/folder or runtime changed/);
});
