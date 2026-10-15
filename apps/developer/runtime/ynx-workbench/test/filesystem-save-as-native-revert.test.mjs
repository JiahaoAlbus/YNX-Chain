import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const req=createRequire(new URL('../../theia/node_modules/@theia/filesystem/lib/browser/filesystem-saveable-service.js',import.meta.url));
const require=createRequire(import.meta.url);
const URI=req('@theia/core/lib/common/uri').default;
const buffer=req('@theia/core/lib/common/buffer');
const source=fs.readFileSync(req.resolve('@theia/filesystem/lib/browser/filesystem-saveable-service'),'utf8');
const openerSource=fs.readFileSync(req.resolve('@theia/core/lib/browser/opener-service'),'utf8');
function method(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start);return source.slice(start,end).trim().replace(/\/\*\*[\s\S]*$/,'').trim();}
const openStart=openerSource.indexOf('async function open('),openEnd=openerSource.indexOf('function getDefaultHandler',openStart);
const open=Function('return ('+openerSource.slice(openStart,openEnd).trim()+')')();
const nativeSave=Function('browser_1','buffer_1','return ({'+[
 method('    async saveAs(','    async saveSnapshot('),
 method('    async saveSnapshot(','    async confirmOverwrite(')].join(',\n')+'})')(
 {CommonCommands:{SAVE_AS:{label:'Save As'}},Saveable:{Snapshot:{read:s=>s.read()}},open},buffer);
const {installOn}=require(process.env.YNX_R54_PARENT_MODULE || '../lib/filesystem-save-as-owner');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const modelSource=fs.readFileSync(req.resolve("@theia/monaco/lib/browser/monaco-editor-model"),"utf8");
function extract(a,b){const start=modelSource.indexOf(a),end=modelSource.indexOf(b,start+a.length);if(start<0||end<0)throw Error("nativeModel boundary");return modelSource.slice(start,end).trim().replace(/\/\*\*[\s\S]*$/,"").trim()}
const nativeModel=Function("cancellation_1","standaloneServices_1","model_1","return ({"+[
extract("    setDirty(dirty) {","    updateSavedVersionId()"),
extract("    updateSavedVersionId() {","    get onDirtyChanged()"),
extract("    async run(operation) {","    cancelSync()"),
extract("    cancelSync() {","    async sync()"),
extract("    async sync() {","    async doSync("),
extract("    async doSync(token) {","    async readContents("),
extract("    markAsDirty() {","    cancelSave()"),
extract("    cancelSave() {","    scheduleSave("),
extract("    async revert(options) {","    createSnapshot(")
].join(",\n")+"})")(req("@theia/core/lib/common/cancellation"),
{StandaloneServices:{get:()=>({updateModel:(m,value)=>{m.text=value;m.version++;m.alt++}})}},{IModelService:0});
function makeModel(){const read=deferred(),entered=deferred(),cancel=req("@theia/core/lib/common/cancellation").CancellationTokenSource;
 const model={text:"TEST_ONLY_OLD",version:1,alt:1,getAlternativeVersionId(){return this.alt}};
 const s=Object.assign(Object.create(nativeModel),{model,_dirty:true,bufferSavedVersionId:0,pendingOperation:Promise.resolve(),toDispose:{disposed:false},
 trace:()=>{},resource:{version:"TEST_ONLY_RESOURCE"},onDirtyChangedEmitter:{fire:()=>{}},syncCancellationTokenSource:new cancel(),saveCancellationTokenSource:new cancel(),
 async readContents(){entered.resolve();return read.promise},updateModel(fn){fn()}});
 Object.defineProperty(s,"version",{get:()=>model.version});Object.defineProperty(s,"dirty",{get:()=>s._dirty});return{s,model,read,entered,type(text){model.text=text;model.version++;model.alt++;s.markAsDirty()}}}

function setup({clean=false}={}) {
 const f=makeModel(),chooser=deferred(),writes=[],opens=[],warnings=[],messages=[];
 f.s._dirty=!clean;
 f.s.createSnapshot=()=>{const value=f.model.text;return {read:()=>value}};
 const uri=new URI('file:///TEST_ONLY/source.cpp'),target=new URI('file:///TEST_ONLY/target.cpp');
 const widget={id:'TEST_ONLY_SOURCE',isDisposed:false,resource:uri,editor:{document:f.s},
  selection:{line:5,character:3},saveable:f.s,getResourceUri(){return this.resource}};
 const prototype=Object.assign({},nativeSave);installOn(prototype,nativeModel.revert);
 const service=Object.assign(Object.create(prototype),{
  canSaveNotSaveAs:()=>true,fileDialogService:{showSaveDialog:()=>chooser.promise},
  fileService:{exists:async()=>false,createFile:async(u,b)=>writes.push({uri:String(u),text:b.toString()})},
  confirmOverwrite:async()=>true,
  openerService:{getOpener:async()=>({open:async(u,o)=>opens.push({uri:String(u),o})})},
  logger:{warn:e=>warnings.push(e)},messageService:{info:async m=>messages.push(m)}
 });
 return {...f,chooser,writes,opens,warnings,messages,widget,service,uri,target,
  start(){const pending=service.saveAs(widget);chooser.resolve(target);return pending}};
}
test('native hard revert success preserves original disk sync and target write',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;f.read.resolve('TEST_ONLY_DISK');const result=await pending;
 assert.equal(String(result),String(f.target));assert.deepEqual(f.writes,[{uri:String(f.target),text:'TEST_ONLY_OLD'}]);
 assert.equal(f.model.text,'TEST_ONLY_DISK');assert.equal(f.s.dirty,false);
 assert.equal(f.s.bufferSavedVersionId,f.model.alt);assert.equal(f.opens.length,1);
 assert.equal(f.opens[0].o.widgetOptions.ref,f.widget);assert.deepEqual(f.messages,[]);
});
test('native cancellation before selection performs no write or revert',async()=>{
 const f=setup(),pending=f.service.saveAs(f.widget);f.chooser.resolve(undefined);assert.equal(await pending,undefined);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);assert.equal(f.model.text,'TEST_ONLY_OLD');
 assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,0);
});
test('typing during native read keeps text, dirty, saved version and source tab',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;f.type('TEST_ONLY_NEW_DURING_READ');
 f.read.resolve('TEST_ONLY_DISK');const result=await pending;
 assert.equal(String(result),String(f.target));assert.equal(f.writes.length,1);assert.equal(f.writes[0].text,'TEST_ONLY_OLD');
 assert.equal(f.model.text,'TEST_ONLY_NEW_DURING_READ');assert.equal(f.s.dirty,true);
 assert.equal(f.s.bufferSavedVersionId,0);assert.deepEqual(f.opens,[]);
 assert.equal(f.messages.length,1);assert.deepEqual(f.widget.selection,{line:5,character:3});
 assert.equal(String(f.widget.resource),String(f.uri));
});
test('initially clean source becomes dirty when typed during native revert',async()=>{
 const f=setup({clean:true}),pending=f.start();await f.entered.promise;f.type('TEST_ONLY_CLEAN_NEW');
 f.read.resolve('TEST_ONLY_DISK');await pending;
 assert.equal(f.model.text,'TEST_ONLY_CLEAN_NEW');assert.equal(f.s.dirty,true);
 assert.equal(f.s.bufferSavedVersionId,0);assert.deepEqual(f.opens,[]);assert.equal(f.writes.length,1);
});
test('multiple edits during one revert do not mark newest version as saved',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;f.type('TEST_ONLY_EDIT1');f.type('TEST_ONLY_EDIT2');
 f.read.resolve('TEST_ONLY_DISK');await pending;
 assert.equal(f.model.text,'TEST_ONLY_EDIT2');assert.equal(f.s.dirty,true);
 assert.equal(f.s.bufferSavedVersionId,0);assert.deepEqual(f.opens,[]);assert.equal(f.messages.length,1);assert.equal(f.writes.length,1);
});
test('shared source document retains dirty state for second editor too',async()=>{
 const f=setup(),second={saveable:f.s},pending=f.start();await f.entered.promise;
 f.type('TEST_ONLY_SHARED_NEW');f.read.resolve('TEST_ONLY_DISK');await pending;
 assert.equal(second.saveable.dirty,true);assert.equal(second.saveable.model.text,'TEST_ONLY_SHARED_NEW');
 assert.deepEqual(f.opens,[]);
});
test('native revert rejection preserves original error and does not replay accepted write',async()=>{
 const f=setup(),failure=Error('TEST_ONLY_REVERT_SYNC_FAILURE');
 f.s.sync=async()=>{throw failure};const pending=f.start();assert.equal(await pending,undefined);
 assert.deepEqual(f.warnings,[failure]);assert.equal(f.writes.length,1);
 assert.equal(f.s.dirty,true);assert.equal(f.model.text,'TEST_ONLY_OLD');assert.deepEqual(f.opens,[]);
});
test('closing and rebinding source during revert never changes replacement document',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;
 f.type('TEST_ONLY_OLD_DOCUMENT_NEW');const replacement={dirty:true,text:'TEST_ONLY_NEW_OWNER'};
 f.widget.isDisposed=true;f.widget.editor.document=replacement;f.widget.saveable=replacement;
 f.read.resolve('TEST_ONLY_DISK');await pending;
 assert.equal(f.s.dirty,true);assert.equal(f.model.text,'TEST_ONLY_OLD_DOCUMENT_NEW');
 assert.equal(replacement.dirty,true);assert.equal(replacement.text,'TEST_ONLY_NEW_OWNER');assert.deepEqual(f.opens,[]);
});
test('ordinary direct native soft revert remains unchanged outside Save As',async()=>{
 const f=makeModel(),original=nativeModel.revert;await f.s.revert({soft:true});
 assert.equal(nativeModel.revert,original);assert.equal(f.s.dirty,false);assert.equal(f.model.text,'TEST_ONLY_OLD');
 assert.equal(f.s.bufferSavedVersionId,f.model.alt);
});
