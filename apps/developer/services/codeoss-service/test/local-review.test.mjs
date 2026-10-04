import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLocalReview, LOCAL_REVIEW_TRANSLATIONS } = require('../../../native/ynx-tools/src/local-review.cjs');
const { createLocalReviewPanel } = require('../../../native/ynx-tools/src/local-review-panel.cjs');
async function harness(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-local-review-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'example.ts'), disk = 'same same'; await writeFile(file, disk);
  let text = options.text || disk, version = 1, dirty = text !== disk;
  const uri = { scheme: 'file', fsPath: file, toString: () => 'file://' + file };
  const document = { uri, isClosed: false, get isDirty() { return dirty; }, get version() { return version; },
    getText: () => text, offsetAt: position => position, positionAt: offset => offset };
  const environment = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_PROJECT_ID: 'd964be82-5584-403b-900a-185cd5d940eb', YNX_LOCAL_WORKSPACE: root };
  const transactions = [], previews = [], undo = [];
  class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, replacement) { this.edits.push({ uri, range, replacement }); } }
  const vscode = { WorkspaceEdit, Range: class { constructor(start,end) { this.start=start; this.end=end; } }, ViewColumn: { Beside: 2 },
    workspace: { textDocuments: [document], workspaceFolders: [{uri:{scheme:'file',fsPath:root,toString:()=> 'file://'+root}}],
      async applyEdit(edit) { transactions.push(edit); undo.push(text); for (const item of edit.edits) text=text.slice(0,item.range.start)+item.replacement+text.slice(item.range.end); version++;dirty=true;return true; } },
    commands: { async executeCommand(...args) { previews.push(args); await options.onDiff?.(); } },
    window: { activeTextEditor: { document, selection: { start:5,end:9,isEmpty:false } },
      async showWarningMessage(...args) { await options.onApproval?.(); return options.cancel ? undefined : 'Apply local change'; } } };
  const review = createLocalReview(vscode,environment,async change=>({uri:'ynx-review:preview',getText:()=>change.text}));
  return { root,file,disk,environment,document,vscode,review,transactions,previews,
    change(value) { text=value;version++;dirty=true; }, undo() { text=undo.pop();version++;dirty=true; }, get text() { return text; } };
}
async function prepared(h, replacement='different') { await h.review.captureSelection(); await h.review.stageReplacement(replacement,h.review.state().revision); await h.review.preview(h.review.state().revision); }

test('real project files bind unsaved selected range; text transaction preserves other occurrences, disk and Undo',async t=>{
  const h=await harness(t,{text:'same same unsaved'});
  const source=(await h.review.captureSelection()).source;
  assert.equal(source.protocol,'ynx-local-selected-edit/v1');assert.equal(source.bufferWasUnsaved,true);assert.equal(source.selectedText,'same');assert.equal(source.sent,false);assert.equal(source.sessionId,undefined);
  await h.review.stageReplacement('manual',h.review.state().revision);
  await assert.rejects(h.review.apply(h.review.state().revision),/diff/);
  await h.review.preview(h.review.state().revision);assert.equal(h.transactions.length,0);
  assert.equal(h.review.state().proposal.provenance,'Manually entered replacement');
  await h.review.apply(h.review.state().revision);assert.equal(h.text,'same manual unsaved');assert.equal(h.transactions.length,1);
  assert.equal(await readFile(h.file,'utf8'),h.disk);h.undo();assert.equal(h.text,'same same unsaved');assert.equal(h.review.state().source,null);
});
test('changed buffers and changed account/runtime provenance refuse transactions',async t=>{
  const h=await harness(t);await prepared(h);h.change('changed same');await assert.rejects(h.review.apply(h.review.state().revision),/document changed/);assert.equal(h.transactions.length,0);
  const other=await harness(t);await prepared(other);other.environment.YNX_CORE_SESSION_ID='d964be82-5584-403b-900a-185cd5d940eb';
  await assert.rejects(other.review.apply(other.review.state().revision),/local project changed/);assert.equal(other.transactions.length,0);
});
test('actual inode replacement and symlink traversal fail without changing either file',async t=>{
  const h=await harness(t);await prepared(h);const replacement=join(h.root,'replacement.ts');await writeFile(replacement,h.disk);await rename(replacement,h.file);
  await assert.rejects(h.review.apply(h.review.state().revision),/path changed/);assert.equal(h.transactions.length,0);assert.equal(await readFile(h.file,'utf8'),h.disk);
  const linked=await harness(t);const target=join(linked.root,'target.ts');await rename(linked.file,target);await symlink(target,linked.file);
  await assert.rejects(linked.review.captureSelection(),/symbolic links/);assert.equal(await readFile(target,'utf8'),linked.disk);
});
test('cancel, recapture, disposal and changed buffer during approval never apply old review',async t=>{
  const cancelled=await harness(t,{cancel:true});await prepared(cancelled);await cancelled.review.apply(cancelled.review.state().revision);assert.equal(cancelled.transactions.length,0);
  const stale=await harness(t);await prepared(stale);const revision=stale.review.state().revision;await stale.review.captureSelection();await assert.rejects(stale.review.apply(revision),/diff/);
  stale.review.dispose();await assert.rejects(stale.review.captureSelection(),/local project changed/);assert.equal(stale.transactions.length,0);
  let raced; raced=await harness(t,{onApproval:()=>raced.change('user edit')});await prepared(raced);await assert.rejects(raced.review.apply(raced.review.state().revision),/document changed/);assert.equal(raced.text,'user edit');assert.equal(raced.transactions.length,0);
});
test('UTF-8 capture/replacement budgets and unsupported replacement input are rejected',async t=>{
  const h=await harness(t,{text:'界'.repeat(12000)});h.vscode.window.activeTextEditor.selection={start:0,end:12000,isEmpty:false};await assert.rejects(h.review.captureSelection(),/32 KiB/);
  const normal=await harness(t);await normal.review.captureSelection();const revision=normal.review.state().revision;
  await assert.rejects(normal.review.stageReplacement('界'.repeat(12000),revision),/32 KiB/);await assert.rejects(normal.review.stageReplacement({sessionId:'fake'},revision),/text replacement/);
  assert.equal(normal.transactions.length,0);
});
async function nativeUi(t, options={}) {
  const h=await harness(t,options),errors=[],notices=[],menus=[],replacementEditors=[];let action='status',buffer='',version=1,document;
  h.vscode.window.showQuickPick=async(items,settings)=>{menus.push({items,settings});return items.find(item=>item.action===action);};
  h.vscode.window.showErrorMessage=text=>{errors.push(text);return Promise.resolve();};
  h.vscode.window.showInformationMessage=text=>{notices.push(text);return Promise.resolve();};
  h.vscode.workspace.openTextDocument=async input=>{
    assert.equal(input.language,'plaintext');buffer=input.content;version=1;
    document={uri:{scheme:'untitled',toString:()=> 'untitled:manual-review'},isClosed:false,get version(){return version;},getText:()=>buffer};
    h.vscode.workspace.textDocuments.push(document);return document;
  };
  h.vscode.window.showTextDocument=async(doc,options)=>{replacementEditors.push({doc,options});h.vscode.window.activeTextEditor={document:doc,selection:{start:0,end:0,isEmpty:true}};};
  const ui=createLocalReviewPanel(h.vscode,{subscriptions:[]},h.environment,async change=>({uri:'ynx-review:manual',getText:()=>change.text}));
  return {...h,ui,errors,notices,menus,replacementEditors,get document(){return document;},
    edit(value){buffer=value;version++;},async choose(value){action=value;await ui.open(false);},get sourceText(){return h.text;}};
}
test('native menu status and multiline untitled editor drive diff and one unsaved source transaction',async t=>{
  const h=await nativeUi(t);await h.ui.open(false);assert.match(h.notices[0],/not connected/);assert.equal(h.replacementEditors.length,0);
  await h.ui.open(true);assert.equal(h.document.getText(),'same');assert.equal(h.replacementEditors[0].options.preview,false);assert.equal(h.document.uri.scheme,'untitled');
  h.edit('manual\nmultiline');await h.choose('preview');assert.equal(h.previews.length,1);assert.equal(h.transactions.length,0);
  await h.choose('apply');assert.equal(h.sourceText,'same manual\nmultiline');assert.equal(h.transactions.length,1);assert.equal(await readFile(h.file,'utf8'),h.disk);assert.match(h.notices.at(-1),/Save separately/);
  h.undo();assert.equal(h.sourceText,h.disk);assert.equal(h.errors.length,0);
});
test('changed, closed or saved replacement documents cannot reuse a preview approval',async t=>{
  const h=await nativeUi(t);await h.ui.open(true);h.edit('first');await h.choose('preview');h.edit('changed');await h.choose('apply');assert.match(h.errors.at(-1),/replacement document changed/);assert.equal(h.transactions.length,0);
  await h.choose('preview');h.document.isClosed=true;await h.choose('apply');assert.match(h.errors.at(-1),/unsaved replacement/);assert.equal(h.transactions.length,0);
  const saved=await nativeUi(t);await saved.ui.open(true);saved.edit('first');await saved.choose('preview');saved.document.uri.scheme='file';await saved.choose('apply');assert.match(saved.errors.at(-1),/unsaved replacement/);assert.equal(saved.transactions.length,0);
});
test('replacement edits during the actual approval await are rejected before WorkspaceEdit',async t=>{
  const h=await nativeUi(t);await h.ui.open(true);h.edit('approved');await h.choose('preview');
  h.vscode.window.showWarningMessage=async()=>{h.edit('changed during modal');return 'Apply local change';};
  await h.choose('apply');assert.match(h.errors.at(-1),/replacement document changed/);assert.equal(h.transactions.length,0);assert.equal(h.sourceText,h.disk);
});
test('Chinese command-driven editor flow uses localized native labels and approval',async t=>{
  const h=await nativeUi(t);const keys={'Identity and AI are not connected':'身份与 AI 未连接','Nothing is sent. Replacements are manually entered.':'不会发送内容，替换内容由手动输入。','Edit replacement document':'编辑替换文档','Unsaved text; maximum 32 KiB':'未保存文本，最多 32 KiB','Review the current replacement before applying':'应用前审阅当前替换内容','Changes the source buffer; does not save':'修改源缓冲区，不保存文件','Reviewing {0}':'正在审阅 {0}','Local change applied to the editor buffer. Save separately; Undo remains available.':'本地修改已应用到编辑器缓冲区。请单独保存，仍可撤销。'};
  h.vscode.l10n={t:(key,...args)=>(keys[key]||LOCAL_REVIEW_TRANSLATIONS[key]||key).replace(/\{(\d+)\}/g,(_,index)=>args[index])};
  h.vscode.window.showWarningMessage=async(message,options,button)=>{assert.match(message,/手动输入/);assert.equal(button,'应用本地修改');return button;};
  await h.ui.open(true);h.edit('手动\n内容');await h.choose('preview');assert.equal(h.menus.at(-1).settings.title,'本地修改审阅');assert.match(h.menus.at(-1).settings.placeHolder,/正在审阅 file:/);assert.equal(h.menus.at(-1).items[0].label,'身份与 AI 未连接');assert.equal(h.previews.at(-1)[3],'本地修改审阅');
  await h.choose('apply');assert.equal(h.sourceText,'same 手动\n内容');assert.match(h.notices.at(-1),/单独保存/);assert.equal(await readFile(h.file,'utf8'),h.disk);
});
test('native edit accepts exactly 32 KiB and refuses one more byte before diff',async t=>{
  const h=await nativeUi(t);await h.ui.open(true);const bytes='a'.repeat(32*1024);h.edit(bytes+'a');await h.choose('preview');assert.match(h.errors.at(-1),/32 KiB/);assert.equal(h.previews.length,0);
  h.edit(bytes);await h.choose('preview');await h.choose('apply');assert.equal(h.sourceText,'same '+bytes);assert.equal(h.transactions.length,1);assert.equal(await readFile(h.file,'utf8'),h.disk);
});
test('native UI disposal retires in-flight menu results and never creates a webview',async t=>{
  const h=await nativeUi(t);let resolve;h.vscode.window.createWebviewPanel=()=>{throw Error('webview forbidden');};
  h.vscode.window.showQuickPick=()=>new Promise(done=>resolve=done);const pending=h.ui.open(false);h.ui.dispose();resolve({action:'capture'});await pending;assert.equal(h.replacementEditors.length,0);assert.equal(h.transactions.length,0);assert.equal(h.errors.length,0);
});
