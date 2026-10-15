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



const candidate=require('../lib/model-save-version');
const adapter=process.env.YNX_R58_PARENT_MODULE?require(process.env.YNX_R58_PARENT_MODULE):candidate;
const URI=req('@theia/core/lib/common/uri').default,resources=req('@theia/core/lib/common/resource');
const files=req('@theia/filesystem/lib/common/files'),{Mutex}=req('async-mutex');
const fileText=fs.readFileSync(req.resolve('@theia/filesystem/lib/browser/file-resource'),'utf8');
const writeStart=fileText.indexOf('this.doWrite = '),writeEnd=fileText.indexOf('this.doSaveContentChanges = ',writeStart);
const writeBody=fileText.slice(writeStart+'this.doWrite = '.length,writeEnd).trim();
const isStart=fileText.indexOf('function is(version)'),isEnd=fileText.indexOf('FileResourceVersion.is =',isStart);
const versionIs=Function('return ('+fileText.slice(isStart,isEnd).trim()+')')();
const doWriteFactory=Function('FileResourceVersion','files_1','resource_1','return '+writeBody);
function nativeMethod(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return text.slice(a,b).trim().replace(/\/\*\*[\s\S]*$/,'').trim()}
const frontendText=fs.readFileSync(req.resolve('@theia/core/lib/browser/common-frontend-contribution'),'utf8');
const saveableText=fs.readFileSync(req.resolve('@theia/core/lib/browser/saveable'),'utf8');
const serviceText=fs.readFileSync(req.resolve('@theia/core/lib/browser/saveable-service'),'utf8');
const nativeSaveable=Function('get','return ('+nativeMethod(saveableText,'    async function save(arg, options) {','    Saveable.save =')+')')(w=>w.saveable);
const nativeService=Function('saveable_1','navigatable_types_1','return ({'+nativeMethod(serviceText,'    async save(widget, options) {','    canSaveAs(')+'})')({Saveable:{save:nativeSaveable}},{NavigatableWidget:{getUri:w=>w.uri}});
const nativeFrontend=Function('return ({'+nativeMethod(frontendText,'    async save(options) {','    async openAbout(')+'})')();
function setup({notice}={}) {
 const f=makeModel(),prototype=Object.assign({},native),writes=[],waiters=[],messages=[],conflicts=[];
 Object.setPrototypeOf(f.s,prototype);adapter.installOn(prototype);
 const disconnect=candidate.connectSaveErrors({error:message=>{messages.push(message);return notice?notice(message):Promise.resolve()}});
 f.model.getValue=()=>f.model.text;f.model.getValueLength=()=>f.model.text.length;
 const uri=new URI('file:///TEST_ONLY/source.cpp');
 const resource={uri,_version:{etag:'TEST_ONLY_ETAG0',mtime:0,encoding:'utf8'},writingLock:new Mutex(),
  shouldOverwrite:async()=>{conflicts.push(uri);return false},
  fileService:{write:async(u,content)=>{
   const op={u:String(u),content,done:deferred()};writes.push(op);
   for(const w of waiters)if(writes[w.index])w.resolve(writes[w.index]);
   await op.done.promise;return{etag:'TEST_ONLY_ETAG'+writes.length,mtime:writes.length,encoding:'utf8'};
  }}};
 Object.defineProperty(resource,'version',{get:()=>resource._version});
 resource.saveContents=doWriteFactory.call(resource,{is:versionIs},files,resources);
 f.s.resource=resource;f.s.resourceVersion=resource.version;
 Object.assign(f.s,{contentChanges:[{text:'TEST_ONLY_CHANGE'}],getEncoding:()=> 'utf8',fireWillSaveModel:async()=>{},
  updateContentEncoding:()=>{},setValid:()=>{},fireDidSaveModel:()=>{}});
 const widget={uri,saveable:f.s},service=Object.assign({},nativeService,{canSaveNotSaveAs:()=>true});
 const frontend=Object.assign({},nativeFrontend,{shell:{currentWidget:widget},saveResourceService:service});
 return {...f,uri,resource,widget,frontend,writes,messages,conflicts,disconnect,
  command(){return frontend.save({formatType:1})},
  waitWrite(index=0){if(writes[index])return Promise.resolve(writes[index]);return new Promise(resolve=>waiters.push({index,resolve}))},
  async fail(error){const command=this.command(),write=await this.waitWrite();await command;write.done.reject(error);await f.s.pendingOperation}
 };
}

const updateStart=fileText.indexOf('this.doSaveContentChanges = '),updateEnd=fileText.indexOf('this.toDispose.',updateStart);
const updateTail=fileText.slice(updateStart+'this.doSaveContentChanges = '.length);
const updateBody=updateTail.slice(0,updateTail.indexOf('\n        };')+'\n        };'.length).trim();
const deltaFactory=Function('FileResourceVersion','files_1','resource_1','return '+updateBody);
function setupFull({deltaFailure=Error('TEST_ONLY_LOST_ACK'),deltaEffect=true,unread=false,unsupported=false,fullFailure,conflict,approve=false}={}){
 const f=setup(),ops=[],effects=[];let fullAttempts=0,deltaCalls=0;
 f.model.text='TEST_ONLY_CONTENT_'.repeat(80);f.expectedText=f.model.text;
 if(unread){f.resource._version=undefined;f.s.resourceVersion=undefined}
 const nativeDelta=deltaFactory.call(f.resource,{is:versionIs},files,resources);
 f.resource.saveContentChanges=(...args)=>{deltaCalls++;return nativeDelta(...args)};
 f.resource.fileService.update=async()=>{
  ops.push('incremental');if(deltaEffect&&!unsupported)effects.push('TEST_ONLY_INCREMENTAL_ACCEPTED');
  if(unsupported)throw Error('incremental file update is not supported');
  if(deltaFailure)throw deltaFailure;
  return{etag:'TEST_ONLY_DELTA',mtime:1,encoding:'utf8'};
 };
 f.resource.fileService.write=async(_uri,content)=>{
  fullAttempts++;ops.push('full');
  if(conflict&&fullAttempts===1)throw new files.FileOperationError('TEST_ONLY_MODIFIED',3);
  effects.push('TEST_ONLY_FULL_ACCEPTED');
  if(fullFailure&&fullAttempts===1)throw fullFailure;
  f.lastWritten=content;return{etag:'TEST_ONLY_FULL'+fullAttempts,mtime:fullAttempts,encoding:'utf8'};
 };
 f.resource.doWrite=f.resource.saveContents;
 if(approve)f.resource.shouldOverwrite=async()=>{f.conflicts.push(f.uri);return true};
 return {...f,ops,effects,get lastWritten(){return f.lastWritten},deltaCalls:()=>deltaCalls,async run(){await f.command();await f.s.pendingOperation}};
}
test('incremental-capable ordinary Save selects one native full write before I/O',async()=>{
 const f=setupFull({deltaFailure:null});try{await f.run();assert.deepEqual(f.ops,['full']);assert.equal(f.deltaCalls(),0);
 assert.equal(f.lastWritten,f.expectedText);assert.equal(f.s.dirty,false);assert.deepEqual(f.messages,[])}finally{f.disconnect()}
});
test('lost incremental ACK cannot trigger a second full write because delta was never dispatched',async()=>{
 const f=setupFull();try{await f.run();assert.deepEqual(f.ops,['full']);assert.equal(f.effects.length,1);
 assert.equal(f.deltaCalls(),0);assert.equal(f.s.dirty,false)}finally{f.disconnect()}
});
test('after-effect NotFound is not treated as proof permitting automatic replay',async()=>{
 const f=setupFull({deltaFailure:new files.FileOperationError('TEST_ONLY_POST_WRITE_STAT_NOT_FOUND',1)});
 try{await f.run();assert.deepEqual(f.ops,['full']);assert.equal(f.effects.length,1);assert.equal(f.deltaCalls(),0)}
 finally{f.disconnect()}
});
test('unread resource still uses original supported complete Save without speculative delta',async()=>{
 const f=setupFull({unread:true,deltaEffect:false});try{await f.run();assert.equal(f.deltaCalls(),0);
 assert.deepEqual(f.ops,['full']);assert.equal(f.s.dirty,false);assert.equal(f.lastWritten,f.expectedText)}finally{f.disconnect()}
});
test('unsupported incremental producer is bypassed before any operation',async()=>{
 const f=setupFull({unsupported:true,deltaEffect:false});try{await f.run();assert.deepEqual(f.ops,['full']);
 assert.equal(f.deltaCalls(),0);assert.equal(f.s.dirty,false)}finally{f.disconnect()}
});
test('full-write lost ACK preserves exact first cause and dirty state without replay',async()=>{
 const original=Error('TEST_ONLY_FULL_UNKNOWN'),f=setupFull({fullFailure:original}),before=nativeLogs.length;
 try{await f.run();assert.deepEqual(f.ops,['full']);assert.equal(f.effects.length,1);assert.equal(f.deltaCalls(),0);
 assert.deepEqual(nativeLogs.slice(before),[original]);assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,0);
 assert.equal(f.messages.length,1);assert.deepEqual(f.s.contentChanges,[{text:'TEST_ONLY_CHANGE'}])}finally{f.disconnect()}
});
test('only next explicit Save retries unknown full result',async()=>{
 const f=setupFull({fullFailure:Error('TEST_ONLY_FULL_UNKNOWN')});try{await f.run();assert.deepEqual(f.ops,['full']);
 await f.run();assert.deepEqual(f.ops,['full','full']);assert.equal(f.effects.length,2);assert.equal(f.deltaCalls(),0);
 assert.equal(f.s.dirty,false);assert.equal(f.messages.length,1)}finally{f.disconnect()}
});
test('queued cancelled Save dispatches neither incremental nor full write',async()=>{
 const f=setupFull();try{const pending=f.s.save();f.s.cancelSave();await pending;assert.deepEqual(f.ops,[]);
 assert.equal(f.deltaCalls(),0);assert.equal(f.s.dirty,true)}finally{f.disconnect()}
});
test('original overwrite refusal remains a confirmation without content effect or replay',async()=>{
 const f=setupFull({conflict:true});try{await f.run();assert.deepEqual(f.ops,['full']);assert.equal(f.effects.length,0);
 assert.equal(f.conflicts.length,1);assert.equal(f.s.dirty,true);assert.deepEqual(f.messages,[]);assert.equal(f.deltaCalls(),0)}finally{f.disconnect()}
});
test('original explicit overwrite approval permits one actual content write',async()=>{
 const f=setupFull({conflict:true,approve:true});try{await f.run();assert.deepEqual(f.ops,['full','full']);
 assert.equal(f.effects.length,1);assert.equal(f.conflicts.length,1);assert.equal(f.s.dirty,false);assert.equal(f.deltaCalls(),0)}finally{f.disconnect()}
});
