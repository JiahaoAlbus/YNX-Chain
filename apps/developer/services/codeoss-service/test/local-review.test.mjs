import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import vm from 'node:vm';
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
test('webview has no network; bounded exact messages cannot manufacture captures or apply stale reviews',async t=>{
  const h=await harness(t), posts=[];let receive, dispose;
  const panel={webview:{html:'',async postMessage(value){posts.push(value);return true;},onDidReceiveMessage(fn){receive=fn;}},onDidDispose(fn){dispose=fn;},dispose(){dispose?.();},reveal(){}};
  h.vscode.window.createWebviewPanel=(type,title,column,options)=>{assert.deepEqual(options.localResourceRoots,[]);assert.equal(title,'Local Change Review');return panel;};
  const ui=createLocalReviewPanel(h.vscode,{subscriptions:[]},h.environment,async change=>({uri:'ynx-review:test'}));await ui.open(true);
  assert.match(panel.webview.html,/connect-src 'none'/);assert.match(panel.webview.html,/nonce-/);assert.doesNotMatch(panel.webview.html,/<iframe|https?:\/\//);assert.match(panel.webview.html,/not an AI result/);
  await receive({action:'apply',revision:posts.at(-1).revision,sessionId:'fake'});assert.match(posts.at(-1).error,/Unsupported/);
  await receive({action:'stage',revision:posts.at(-1).revision,replacement:'x'.repeat(80000)});assert.match(posts.at(-1).error,/Unsupported/);
  const revision=posts.at(-1).revision;await receive({action:'stage',revision,replacement:'manual'});await receive({action:'apply',revision});assert.match(posts.at(-1).error,/review changed/);assert.equal(h.transactions.length,0);
  assert.ok(posts.every((post,index)=>!index||post.publication>posts[index-1].publication));ui.dispose();await receive({action:'capture',revision});assert.equal(h.transactions.length,0);
});
test('rendered script ignores out-of-order updates and treats all source text as textContent',async t=>{
  const h=await harness(t);let panel;h.vscode.window.createWebviewPanel=()=>panel={webview:{html:'',postMessage:async()=>true,onDidReceiveMessage(){}},onDidDispose(){},dispose(){}};
  await createLocalReviewPanel(h.vscode,{subscriptions:[]},h.environment,async()=>{}).open();
  const script=panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1],elements=new Map();let receive;
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false});return elements.get(id);};
  vm.runInNewContext(script,{acquireVsCodeApi:()=>({postMessage(){}}),document:{getElementById:element},window:{addEventListener:(name,fn)=>receive=fn}});
  receive({data:{type:'state',publication:3,revision:2,error:'new',busy:false,source:{selectedText:'<script>bad</script>'}}});
  receive({data:{type:'state',publication:2,revision:2,error:'stale',busy:true}});
  assert.equal(element('error').textContent,'new');assert.equal(element('selected').textContent,'<script>bad</script>');assert.equal(element('capture').disabled,false);
});
test('Chinese UI exercises capture, manual review, diff and translated approval without saving or sending',async t=>{
  const h=await harness(t),posts=[];let receive,panel,title;
  h.vscode.l10n={t:key=>LOCAL_REVIEW_TRANSLATIONS[key]||key};
  h.vscode.window.showWarningMessage=async(message,options,button)=>{assert.match(message,/手动输入/);assert.equal(button,'应用本地修改');return button;};
  h.vscode.window.createWebviewPanel=(type,value)=>{title=value;return panel={webview:{html:'',postMessage:async value=>{posts.push(value);return true;},onDidReceiveMessage:fn=>receive=fn},onDidDispose(){},dispose(){}};};
  await createLocalReviewPanel(h.vscode,{subscriptions:[]},h.environment,async change=>({uri:'ynx-review:test'})).open(true);
  assert.equal(title,'本地修改审阅');assert.match(panel.webview.html,/产品身份：未连接/);assert.match(panel.webview.html,/手动输入的替换内容不是 AI 结果/);assert.match(panel.webview.html,/捕获当前选区/);
  await receive({action:'stage',revision:posts.at(-1).revision,replacement:'手动内容'});
  assert.equal(posts.at(-1).proposal.provenance,'手动输入的替换内容');
  await receive({action:'preview',revision:posts.at(-1).revision});assert.equal(h.previews.at(-1)[3],'本地修改审阅');
  await receive({action:'apply',revision:posts.at(-1).revision});assert.equal(h.text,'same 手动内容');assert.equal(await readFile(h.file,'utf8'),h.disk);assert.equal(posts.at(-1).sent,false);
});
test('translated HTML and script fallback remain escaped even for markup supplied by localization',async t=>{
  const h=await harness(t);let panel,receive;
  const unsafe='</script><img src=x onerror=bad>&\"\u2028';
  h.vscode.l10n={t:key=>key==='Select text in the editor to begin.'?unsafe:key==='Local Change Review'?'审阅<em>':key};
  h.vscode.window.createWebviewPanel=()=>panel={webview:{html:'',postMessage:async()=>true,onDidReceiveMessage(){}},onDidDispose(){},dispose(){}};
  await createLocalReviewPanel(h.vscode,{subscriptions:[]},h.environment,async()=>{}).open();
  assert.match(panel.webview.html,/<h1>审阅&lt;em&gt;<\/h1>/);assert.equal((panel.webview.html.match(/<\/script>/g)||[]).length,1);
  const script=panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];assert.ok(!script.includes('</script>'));
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false});return elements.get(id);};
  vm.runInNewContext(script,{acquireVsCodeApi:()=>({postMessage(){}}),document:{getElementById:element},window:{addEventListener:(name,fn)=>receive=fn}});
  receive({data:{type:'state',publication:1,revision:0,busy:false}});assert.equal(element('source').textContent,unsafe);
});
test('exact 32 KiB replacement succeeds and one more UTF-8 byte is rejected',async t=>{
  const h=await harness(t);await h.review.captureSelection();const bytes='a'.repeat(32*1024);await h.review.stageReplacement(bytes,h.review.state().revision);
  await assert.rejects(h.review.stageReplacement(bytes+'a',h.review.state().revision),/32 KiB/);
  await h.review.preview(h.review.state().revision);await h.review.apply(h.review.state().revision);assert.equal(h.text,'same '+bytes);assert.equal(await readFile(h.file,'utf8'),h.disk);
});
