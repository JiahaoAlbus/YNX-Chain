const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replaceBatch, expectedMatch } = require('../runtime/ynx-workbench/lib/search-replace-transaction');
function fixture(options = {}) {
  const state = { applied: [], removed: [], errors: [], disposed: [], saved: [] };
  const files = ['file:///project/a.sol', 'file:///project/b.sol'].map(fileUri => ({ kind: 'file', children: [], fileUri }));
  for (const f of files) f.children.push({ kind: 'line', parent: f, fileUri: f.fileUri, line: 1, character: 8, length: 5, lineText: 'public value;' });
  const models = files.map(() => ({ version: 1, getVersionId() { return this.version; }, getValueInRange() { return options.stale ? 'other' : 'value'; } }));
  const w = { resultTree: new Map(files.map((f, i) => [i, f])), searchTerm: 'value', _replaceTerm: 'total', confirmReplaceAll: async () => {
    if (options.changedQuery) w.searchTerm = 'other';
    return !options.cancel;
  }, findEndCharacterPosition: () => ({ line: 0, character: 12 }),
  ynxSearchWorkspace: { textModelService: { async createModelReference(uri) {
    const i = files.findIndex(f => f.fileUri === uri); if (options.race && i === 1) models[0].version++;
    return { object: { textEditorModel: models[i] }, dispose: () => state.disposed.push(uri) };
  } }, async applyBulkEdit(edits) { state.applied.push(edits); return { isApplied: !options.applyFailure, ariaSummary: 'apply failed' }; }, async saveAll(resources) { state.saved.push([...resources]); if (options.saveFailure) throw Error('save failed'); } },
  ynxSearchMessages: { error: async message => state.errors.push(message) }, removeNode: row => state.removed.push(row.fileUri) };
  const deps = { isFile: row => row.kind === 'file', isLine: row => row.kind === 'line', uri: x => x, range: (row, end) => ({ row, end }), edit: (target, text, version) => ({ target, text, version }), original: async () => { state.original = true; } };
  return { state, w, deps, models, files };
}
test('multi-file replacement reaches one versioned bulk edit before save and result retirement', async () => {
  const { state, w, deps } = fixture(); await replaceBatch(w, undefined, deps);
  assert.equal(state.applied.length, 1); assert.equal(state.applied[0].length, 2);
  assert.deepEqual(state.applied[0].map(x => [x.text, x.version]), [['total', 1], ['total', 1]]);
  assert.equal(state.saved[0].length, 2); assert.equal(state.removed.length, 2); assert.equal(state.disposed.length, 2); assert.deepEqual(state.errors, []);
});
for (const reason of ['cancel', 'stale', 'race', 'changedQuery']) test(reason + ' never applies or retires matches', async () => {
  const { state, w, deps } = fixture({ [reason]: true }); await replaceBatch(w, undefined, deps);
  assert.equal(state.applied.length, 0); assert.equal(state.removed.length, 0); assert.equal(w.ynxReplacing, false);
});
for (const reason of ['applyFailure', 'saveFailure']) test(reason + ' preserves results and reports failure', async () => {
  const { state, w, deps } = fixture({ [reason]: true }); await replaceBatch(w, undefined, deps);
  assert.equal(state.removed.length, 0); assert.equal(state.errors.length, 1); assert.equal(state.disposed.length, 2);
});
test('line-preview offset selects actual matched bytes', () => {
  assert.equal(expectedMatch({ character: 120, length: 5, lineText: { text: '...value...', character: 4 } }), 'value');
});
test('single file uses standard individual replacement', async () => {
  const { state, w, deps } = fixture(); await replaceBatch(w, w.resultTree.get(0), deps); assert.equal(state.original, true); assert.equal(state.applied.length, 0);
});

function r51Gate(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
function r51ReferenceBoundary(f){
 const gate=r51Gate(),entered=r51Gate(),create=f.w.ynxSearchWorkspace.textModelService.createModelReference;let first=true;
 f.w.ynxSearchWorkspace.textModelService.createModelReference=async uri=>{const ref=await create(uri);if(first){first=false;entered.resolve();await gate.promise}return ref};
 return{entered:entered.promise,release:gate.resolve};
}
function r51Workspace(f){
 const service={workspace:{resource:{toString:()=> 'file:///project'}},roots:[{resource:{toString:()=> 'file:///project'}}],tryGetRoots(){return this.roots}};
 f.w.workspaceService=service;return service;
}
function r51OpenEditor(f){
 const editor={isDisposed:false,selection:{line:2},editor:{uri:{toString:()=>f.files[0].fileUri},getControl:()=>({getModel:()=>f.models[0]})}};
 f.w.editorManager={all:[editor]};return editor;
}
for(const change of ['query','replacement','options','search-generation']){
 test('R51 '+change+' changed during model acquisition cannot apply an obsolete replacement',async()=>{
  const f=fixture(),boundary=r51ReferenceBoundary(f);f.w.searchOptions={matchCase:true};f.w.cancelIndicator={};
  const pending=replaceBatch(f.w,undefined,f.deps);await boundary.entered;
  if(change==='query')f.w.searchTerm='TEST_ONLY_NEW_QUERY';
  if(change==='replacement')f.w._replaceTerm='TEST_ONLY_NEW_REPLACEMENT';
  if(change==='options')f.w.searchOptions.matchCase=false;
  if(change==='search-generation')f.w.cancelIndicator={};
  boundary.release();await pending;assert.equal(f.state.applied.length,0);assert.equal(f.state.saved.length,0);assert.equal(f.state.removed.length,0);assert.equal(f.state.disposed.length,1);assert.equal(f.w.ynxReplacing,false);
 });
}
test('R51 workspace change while original model ref awaits cannot apply to departed project',async()=>{
 const f=fixture(),workspace=r51Workspace(f),boundary=r51ReferenceBoundary(f),pending=replaceBatch(f.w,undefined,f.deps);await boundary.entered;
 workspace.roots=[{resource:{toString:()=> 'file:///TEST_ONLY_OTHER_PROJECT'}}];boundary.release();await pending;
 assert.equal(f.state.applied.length,0);assert.equal(f.state.saved.length,0);assert.equal(f.state.removed.length,0);
});
test('R51 continued dirty editor edits during confirmation remain untouched by old plan',async()=>{
 const f=fixture(),editor=r51OpenEditor(f),confirm=r51Gate();f.w.confirmReplaceAll=()=>confirm.promise;
 const pending=replaceBatch(f.w,undefined,f.deps);f.models[0].version=2;const selection={line:9};editor.selection=selection;confirm.resolve(true);await pending;
 assert.equal(f.state.applied.length,0);assert.equal(f.state.saved.length,0);assert.equal(f.models[0].version,2);assert.equal(editor.selection,selection);
});
test('R51 closing captured source editor while model ref awaits retires its pending plan',async()=>{
 const f=fixture(),editor=r51OpenEditor(f),boundary=r51ReferenceBoundary(f),pending=replaceBatch(f.w,undefined,f.deps);await boundary.entered;
 editor.isDisposed=true;f.w.editorManager.all=[];boundary.release();await pending;assert.equal(f.state.applied.length,0);assert.equal(f.state.saved.length,0);
});
test('R51 completed old save cannot remove results of a newly entered search',async()=>{
 const f=fixture(),saved=r51Gate(),entered=r51Gate();f.w.ynxSearchWorkspace.saveAll=async resources=>{f.state.saved.push([...resources]);entered.resolve();await saved.promise};
 const pending=replaceBatch(f.w,undefined,f.deps);await entered.promise;f.w.searchTerm='TEST_ONLY_NEW_QUERY';f.w.resultTree=new Map(f.files.map((old,index)=>{const next={...old,children:[]};next.children=old.children.map(row=>({...row,parent:next}));return[index,next]}));
 saved.resolve();await pending;assert.equal(f.state.applied.length,1);assert.equal(f.state.saved.length,1);assert.equal(f.state.removed.length,0);assert.equal(f.w.resultTree.size,2);
});
test('R51 context change after admitted bulk edit does not auto-save or retire a new workspace',async()=>{
 const f=fixture(),workspace=r51Workspace(f),applied=r51Gate(),entered=r51Gate();f.w.ynxSearchWorkspace.applyBulkEdit=async edits=>{f.state.applied.push(edits);entered.resolve();return applied.promise};
 const pending=replaceBatch(f.w,undefined,f.deps);await entered.promise;workspace.roots=[{resource:{toString:()=> 'file:///TEST_ONLY_OTHER_PROJECT'}}];applied.resolve({isApplied:true});await pending;
 assert.equal(f.state.applied.length,1);assert.equal(f.state.saved.length,0);assert.equal(f.state.removed.length,0);assert.equal(f.w.ynxReplacing,false);
});
test('R51 undismissed error notification cannot hold replace ownership or model refs',async()=>{
 const f=fixture({stale:true}),notified=r51Gate(),dismissal=r51Gate();f.w.ynxSearchMessages.error=()=>{notified.resolve();return dismissal.promise};
 const pending=replaceBatch(f.w,undefined,f.deps);
 try{await notified.promise;assert.equal(f.w.ynxReplacing,false);assert.equal(f.state.disposed.length,1);for(const model of f.models)model.getValueInRange=()=> 'value';await replaceBatch(f.w,undefined,f.deps);assert.equal(f.state.applied.length,1);}
 finally{dismissal.resolve();await pending}
});
test('R51 ordinary approved transaction retains exact URI/range/version and original selection',async()=>{
 const f=fixture(),editor=r51OpenEditor(f),selection=editor.selection;r51Workspace(f);await replaceBatch(f.w,undefined,f.deps);
 assert.equal(f.state.applied.length,1);assert.deepEqual(f.state.applied[0].map(edit=>[edit.target.resource,edit.text,edit.version]),f.files.map(file=>[file.fileUri,'total',1]));assert.equal(f.state.saved.length,1);assert.equal(f.state.removed.length,2);assert.equal(editor.selection,selection);assert.deepEqual(f.state.errors,[]);
});
test('R51 explicit confirmation Cancel leaves buffers selection results and disk save untouched',async()=>{
 const f=fixture({cancel:true}),editor=r51OpenEditor(f),selection=editor.selection;await replaceBatch(f.w,undefined,f.deps);
 assert.equal(f.state.applied.length,0);assert.equal(f.state.saved.length,0);assert.equal(f.state.removed.length,0);assert.equal(f.state.disposed.length,0);assert.equal(editor.selection,selection);assert.equal(f.w.ynxReplacing,false);
});
