import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const req=createRequire(new URL('../../theia/node_modules/@theia/monaco/lib/browser/monaco-editor-model.js',import.meta.url));
const nativeLogs=[];
const source=fs.readFileSync(req.resolve("@theia/monaco/lib/browser/monaco-editor-model"),"utf8");
function extract(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);if(start<0||end<0)throw Error("native boundary");return source.slice(start,end).trim().replace(/\/\*\*[\s\S]*$/,"").trim()}
const native=Function("cancellation_1","standaloneServices_1","model_1","resource_1","vscode_languageserver_protocol_1","console","return ({"+[
extract("    setDirty(dirty) {","    updateSavedVersionId()"),
extract("    updateSavedVersionId() {","    get onDirtyChanged()"),
extract("    async run(operation) {","    cancelSync()"),
extract("    cancelSync() {","    async sync()"),
extract("    async sync() {","    async doSync("),
extract("    async doSync(token) {","    async readContents("),
extract("    markAsDirty() {","    cancelSave()"),
extract("    cancelSave() {","    scheduleSave("),
extract("    async revert(options) {","    createSnapshot("),extract("    save(options) {","    async run("),extract("    scheduleSave(token =","    pushContentChanges("),extract("    async doSave(token, overwriteEncoding, options) {","    async fireWillSaveModel("),extract("    pushContentChanges(contentChanges) {","    fireDidChangeContent("),extract("    fireDidChangeContent(event) {","    asContentChangedEvent(")
].join(",\n")+"})")(req("@theia/core/lib/common/cancellation"),
{StandaloneServices:{get:()=>({updateModel:(m,value)=>{m.text=value;m.version++;m.alt++}})}},{IModelService:0},req("@theia/core/lib/common/resource"),{TextDocumentSaveReason:{Manual:1}},{error:e=>nativeLogs.push(e)});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function makeModel(){const read=deferred(),entered=deferred(),cancel=req("@theia/core/lib/common/cancellation").CancellationTokenSource;
 const model={text:"TEST_ONLY_OLD",version:1,alt:1,getAlternativeVersionId(){return this.alt}};
 const s=Object.assign(Object.create(native),{model,_dirty:true,bufferSavedVersionId:0,pendingOperation:Promise.resolve(),toDispose:{disposed:false},
 trace:()=>{},resource:{version:"TEST_ONLY_RESOURCE"},onDirtyChangedEmitter:{fire:()=>{}},syncCancellationTokenSource:new cancel(),saveCancellationTokenSource:new cancel(),
 async readContents(){entered.resolve();return read.promise},updateModel(fn){fn()}});
 Object.defineProperty(s,"version",{get:()=>model.version});Object.defineProperty(s,"dirty",{get:()=>s._dirty});return{s,model,read,entered,type(text){model.text=text;model.version++;model.alt++;s.markAsDirty()}}}


const {installOn}=require('../lib/model-save-version');
function setup(){
 const f=makeModel(),prototype=Object.assign({},native);Object.setPrototypeOf(f.s,prototype);
 if(!process.env.YNX_R56_UNPATCHED) installOn(prototype);
 const writes=[],waiters=[],saveEvents=[],state={stored:'TEST_ONLY_DISK',version:0};
 f.model.getValue=()=>f.model.text;f.model.getValueLength=()=>f.model.text.length;
 Object.assign(f.s,{contentChanges:[{text:'TEST_ONLY_INITIAL_CHANGE'}],getEncoding:()=> 'utf8',
 fireWillSaveModel:async()=>{},updateContentEncoding:()=>{},setValid:()=>{},fireDidSaveModel:()=>saveEvents.push(f.model.text),
 resourceVersion:'TEST_ONLY_V0',onDidChangeContentEmitter:{fire:()=>{}},
 asContentChangedEvent:event=>({contentChanges:event.changes})});
 f.s.resource.saveContents=async content=>{
  const entry={content,done:deferred()};writes.push(entry);
  for(const waiter of waiters)if(writes[waiter.index])waiter.resolve(writes[waiter.index]);
  await entry.done.promise;state.stored=content;state.version++;f.s.resource.version='TEST_ONLY_V'+state.version;
 };
 return {...f,writes,state,saveEvents,
  waitWrite(index=0){if(writes[index])return Promise.resolve(writes[index]);return new Promise(resolve=>waiters.push({index,resolve}))},
  type(text){f.model.text=text;f.model.version++;f.model.alt++;f.s.fireDidChangeContent({changes:[{text}]})},
  undoToWritten(text,alternative){f.model.text=text;f.model.version++;f.model.alt=alternative;f.s.fireDidChangeContent({changes:[{text}]})}
 };
}
test('native ordinary Save acknowledges exact snapshot and clears dirty normally',async()=>{
 const f=setup(),pending=f.s.save(),write=await f.waitWrite();assert.equal(write.content,'TEST_ONLY_OLD');
 write.done.resolve();await pending;assert.equal(f.state.stored,'TEST_ONLY_OLD');assert.equal(f.s.dirty,false);
 assert.equal(f.s.bufferSavedVersionId,1);assert.deepEqual(f.s.contentChanges,[]);assert.deepEqual(f.saveEvents,['TEST_ONLY_OLD']);
});
test('new typing during active-token write stays dirty with acknowledged saved version',async()=>{
 const f=setup(),pending=f.s.save(),write=await f.waitWrite();f.type('TEST_ONLY_NEW');
 assert.equal(f.s.saveCancellationTokenSource.token.isCancellationRequested,false);
 write.done.resolve();await pending;assert.equal(f.state.stored,'TEST_ONLY_OLD');assert.equal(f.model.text,'TEST_ONLY_NEW');
 assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,1);assert.equal(f.model.alt,2);
 assert.deepEqual(f.s.contentChanges,[{text:'TEST_ONLY_NEW'}]);assert.deepEqual(f.saveEvents,[]);assert.equal(f.writes.length,1);
});
test('undo to actual acknowledged version can become clean using original content event',async()=>{
 const f=setup(),pending=f.s.save(),write=await f.waitWrite();f.type('TEST_ONLY_NEW');write.done.resolve();await pending;
 f.undoToWritten('TEST_ONLY_OLD',1);assert.equal(f.model.text,f.state.stored);assert.equal(f.s.dirty,false);
 assert.equal(f.s.bufferSavedVersionId,1);
});
test('only explicit second Save writes new buffer and then clears dirty',async()=>{
 const f=setup(),first=f.s.save(),old=await f.waitWrite();f.type('TEST_ONLY_NEW');old.done.resolve();await first;
 assert.equal(f.s.dirty,true);assert.equal(f.writes.length,1);
 const second=f.s.save(),current=await f.waitWrite(1);assert.equal(current.content,'TEST_ONLY_NEW');current.done.resolve();await second;
 assert.equal(f.state.stored,'TEST_ONLY_NEW');assert.equal(f.s.dirty,false);assert.equal(f.s.bufferSavedVersionId,2);
 assert.deepEqual(f.s.contentChanges,[]);assert.deepEqual(f.saveEvents,['TEST_ONLY_NEW']);
});
test('write rejection retains original logged error and dirty changes without implicit replay',async()=>{
 const f=setup(),start=nativeLogs.length,pending=f.s.save(),write=await f.waitWrite(),failure=Error('TEST_ONLY_UNKNOWN_WRITE');
 write.done.reject(failure);await pending;assert.deepEqual(nativeLogs.slice(start),[failure]);
 assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,0);assert.equal(f.writes.length,1);
 assert.deepEqual(f.s.contentChanges,[{text:'TEST_ONLY_INITIAL_CHANGE'}]);assert.deepEqual(f.saveEvents,[]);
 const retry=f.s.save(),next=await f.waitWrite(1);next.done.resolve();await retry;
 assert.equal(f.s.dirty,false);assert.equal(f.writes.length,2);
});
test('cancelled queued native save does not write resource',async()=>{
 const f=setup(),pending=f.s.save();f.s.cancelSave();await pending;
 assert.equal(f.writes.length,0);assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,0);
});
test('willSave formatting is captured before write version is recorded',async()=>{
 const f=setup();f.s.fireWillSaveModel=async()=>f.type('TEST_ONLY_FORMATTED');
 const pending=f.s.save(),write=await f.waitWrite();assert.equal(write.content,'TEST_ONLY_FORMATTED');
 write.done.resolve();await pending;assert.equal(f.s.dirty,false);assert.equal(f.s.bufferSavedVersionId,2);
 assert.deepEqual(f.saveEvents,['TEST_ONLY_FORMATTED']);
});
test('rebound model while write pending is not marked clean',async()=>{
 const f=setup(),pending=f.s.save(),write=await f.waitWrite();
 f.s.model={text:'TEST_ONLY_REBOUND',alt:1,getAlternativeVersionId(){return this.alt}};
 write.done.resolve();await pending;assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,0);
 assert.equal(f.s.model.text,'TEST_ONLY_REBOUND');assert.deepEqual(f.saveEvents,[]);
});
test('incremental resource Save branch keeps later content dirty without replay',async()=>{
 const f=setup(),entered=deferred();let calls=0;
 f.model.text='TEST_ONLY_LONG_CONTENT_'.repeat(20);
 f.s.resource.saveContentChanges=async changes=>{
  calls++;const entry={content:changes.map(x=>x.text).join(''),done:deferred()};f.writes.push(entry);entered.resolve();
  await entry.done.promise;f.state.stored=entry.content;f.s.resource.version='TEST_ONLY_V1';
 };
 const pending=f.s.save();await entered.promise;
 // Resource.save awaits the incremental helper; its primitive is now pending.
 assert.equal(f.writes.length,1);f.type('TEST_ONLY_INCREMENTAL_NEW');f.writes[0].done.resolve();await pending;
 assert.equal(calls,1);assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,1);
 assert.deepEqual(f.s.contentChanges,[{text:'TEST_ONLY_INCREMENTAL_NEW'}]);assert.deepEqual(f.saveEvents,[]);
});
