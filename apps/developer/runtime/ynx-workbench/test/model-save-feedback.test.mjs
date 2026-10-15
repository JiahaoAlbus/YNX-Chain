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
const adapter=process.env.YNX_R57_PARENT_MODULE?require(process.env.YNX_R57_PARENT_MODULE):candidate;
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
test('normal button uses native FileResource write and shows no failure notice',async()=>{
 const f=setup();try{const command=f.command(),write=await f.waitWrite();write.done.resolve();await command;await f.s.pendingOperation;
 assert.equal(f.writes.length,1);assert.equal(f.s.dirty,false);assert.deepEqual(f.messages,[]);assert.equal(f.resource.version.etag,'TEST_ONLY_ETAG1');
 }finally{f.disconnect()}
});
test('generic write failure reaches visible feedback and preserves native first cause/dirty',async()=>{
 const f=setup(),before=nativeLogs.length,error=Error('TEST_ONLY_WRITE_UNKNOWN');try{await f.fail(error);
 assert.deepEqual(nativeLogs.slice(before),[error]);assert.equal(f.s.dirty,true);assert.equal(f.s.bufferSavedVersionId,0);
 assert.deepEqual(f.s.contentChanges,[{text:'TEST_ONLY_CHANGE'}]);assert.equal(f.writes.length,1);
 assert.equal(f.messages.length,1);assert.match(f.messages[0],/source\.cpp/);assert.match(f.messages[0],/could not confirm/i);
 assert.doesNotMatch(f.messages[0],/TEST_ONLY_WRITE_UNKNOWN/);
 }finally{f.disconnect()}
});
test('pending notice dismissal does not block explicit next Save',async()=>{
 const pendingNotice=deferred(),f=setup({notice:()=>pendingNotice.promise});try{
 await f.fail(Error('TEST_ONLY_UNKNOWN'));assert.equal(f.messages.length,1);assert.equal(f.writes.length,1);
 const next=f.command(),write=await f.waitWrite(1);write.done.resolve();await next;await f.s.pendingOperation;
 assert.equal(f.s.dirty,false);assert.equal(f.writes.length,2);assert.equal(f.messages.length,1);
 }finally{pendingNotice.resolve();f.disconnect()}
});
test('notification synchronous failure cannot replace original save error',async()=>{
 const sink=Error('TEST_ONLY_NOTICE_THROW'),f=setup({notice:()=>{throw sink}}),original=Error('TEST_ONLY_ORIGINAL'),before=nativeLogs.length;
 try{await f.fail(original);assert.deepEqual(nativeLogs.slice(before),[original]);assert.equal(f.messages.length,1);assert.equal(f.s.dirty,true)}
 finally{f.disconnect()}
});
test('notification rejection cannot replace original save error',async()=>{
 const f=setup({notice:()=>Promise.reject(Error('TEST_ONLY_NOTICE_REJECT'))}),original=Error('TEST_ONLY_ORIGINAL'),before=nativeLogs.length;
 try{await f.fail(original);assert.deepEqual(nativeLogs.slice(before),[original]);assert.equal(f.messages.length,1);assert.equal(f.s.dirty,true)}
 finally{f.disconnect()}
});
test('error notice identifies captured source after active editor switches',async()=>{
 const f=setup();try{const command=f.command(),write=await f.waitWrite();f.frontend.shell.currentWidget={uri:new URI('file:///TEST_ONLY/other.cpp')};
 await command;write.done.reject(Error('TEST_ONLY_UNKNOWN'));await f.s.pendingOperation;
 assert.equal(f.messages.length,1);assert.match(f.messages[0],/source\.cpp/);assert.doesNotMatch(f.messages[0],/other\.cpp/);
 assert.equal(f.writes.length,1);assert.equal(f.s.dirty,true);
 }finally{f.disconnect()}
});
test('existing modified-file overwrite refusal keeps original dialog without generic error notice',async()=>{
 const f=setup();try{await f.fail(new files.FileOperationError('TEST_ONLY_MODIFIED',3));
 assert.equal(f.conflicts.length,1);assert.deepEqual(f.messages,[]);assert.equal(f.s.dirty,true);assert.equal(f.writes.length,1);
 }finally{f.disconnect()}
});
test('only a new explicit Save retries generic failed provider write',async()=>{
 const f=setup();try{await f.fail(Error('TEST_ONLY_UNKNOWN'));assert.equal(f.messages.length,1);assert.equal(f.writes.length,1);
 const next=f.command(),write=await f.waitWrite(1);write.done.resolve();await next;await f.s.pendingOperation;
 assert.equal(f.writes.length,2);assert.equal(f.s.dirty,false);assert.equal(f.messages.length,1);
 }finally{f.disconnect()}
});
test('old frontend disconnect does not clear newer feedback owner',async()=>{
 const old=setup(),current=setup();old.disconnect();try{await current.fail(Error('TEST_ONLY_NEW_OWNER'));
 assert.equal(current.messages.length,1);assert.deepEqual(old.messages,[]);
 }finally{current.disconnect()}
});
