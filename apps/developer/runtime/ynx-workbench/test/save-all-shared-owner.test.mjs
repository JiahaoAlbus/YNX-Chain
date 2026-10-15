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
const adapter=process.env.YNX_R59_PARENT_MODULE?require(process.env.YNX_R59_PARENT_MODULE):candidate;
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

const shellText=fs.readFileSync(req.resolve('@theia/core/lib/browser/shell/application-shell'),'utf8');
const allPrototype=Function('saveable_1','return ({'+[
 nativeMethod(shellText,'    async saveAll(options) {','    get widgets()'),
 nativeMethod(shellText,'    get widgets() {','    getWidgetById(')].join(',\n')+'})')({Saveable:{isDirty:w=>w.saveable.dirty}});
const registryStart=frontendText.indexOf('commandRegistry.registerCommand(common_commands_1.CommonCommands.SAVE_ALL, {');
assert.ok(registryStart>=0);
const executeLine=frontendText.slice(registryStart).split('\n').find(line=>line.trim().startsWith('execute:'));
const nativeAllCommand=Function('return ({'+executeLine.trim()+'})');
function pack(configs=[{}]) {
 const models=configs.map((config,index)=>{
  const f=setup(),name=config.name||('file'+index+'.cpp');f.widget.id='TEST_ONLY_EDITOR_'+index;
  f.uri=new URI('file:///TEST_ONLY/'+name);f.widget.uri=f.uri;f.resource.uri=f.uri;
  const ops=[],failure=config.failure;let attempts=0;
  f.resource.fileService.write=async(_uri,content)=>{
   attempts++;ops.push({content,attempt:attempts});if(config.onWrite)config.onWrite(f,attempts);
   if(failure&&attempts===1)throw failure;
   return{etag:'TEST_ONLY_'+index+'_'+attempts,mtime:attempts,encoding:'utf8'};
  };
  return {...f,ops};
 });
 const messages=[],notice=deferred();
 const disconnect=candidate.connectSaveErrors({error:m=>{messages.push(m);return notice.promise}});
 const prototype=Object.create(allPrototype);
 if(adapter.installSaveAllOn)adapter.installSaveAllOn(prototype,w=>w.saveable);
 const service=models[0].frontend.saveResourceService;
 const shell=Object.assign(Object.create(prototype),{tracker:{widgets:models.map(f=>f.widget)},saveableService:service});
 const command=nativeAllCommand.call({shell});
 return {models,messages,shell,service,command,
  run(){return command.execute()},
  twin(index=0){return{id:'TEST_ONLY_TWIN_'+index,uri:models[index].uri,saveable:models[index].s}},
  cleanup(){notice.resolve();disconnect();for(const f of models)f.disconnect()}
 };
}
test('normal Save All keeps independent native writes and clears both documents',async()=>{
 const p=pack([{},{}]);try{await p.run();assert.deepEqual(p.models.map(f=>f.ops.length),[1,1]);
 assert.deepEqual(p.models.map(f=>f.s.dirty),[false,false]);assert.deepEqual(p.messages,[])}finally{p.cleanup()}
});
test('two successful views of same document still perform just one write',async()=>{
 const p=pack();p.shell.tracker.widgets.push(p.twin());try{await p.run();
 assert.equal(p.models[0].ops.length,1);assert.equal(p.models[0].s.dirty,false)}finally{p.cleanup()}
});
test('same Saveable second view cannot replay first unknown write within same command',async()=>{
 const original=Error('TEST_ONLY_LOST_ACK'),p=pack([{failure:original}]),before=nativeLogs.length;
 p.shell.tracker.widgets.push(p.twin());try{await p.run();assert.equal(p.models[0].ops.length,1);
 assert.equal(p.models[0].s.dirty,true);assert.equal(p.models[0].s.bufferSavedVersionId,0);
 assert.deepEqual(nativeLogs.slice(before),[original]);assert.equal(p.messages.length,1)}finally{p.cleanup()}
});
test('next explicit Save All gets a new attempt without replay inside either gesture',async()=>{
 const p=pack([{failure:Error('TEST_ONLY_UNKNOWN')}]);p.shell.tracker.widgets.push(p.twin());
 try{await p.run();assert.equal(p.models[0].ops.length,1);assert.equal(p.models[0].s.dirty,true);
 await p.run();assert.equal(p.models[0].ops.length,2);assert.equal(p.models[0].s.dirty,false);assert.equal(p.messages.length,1)}
 finally{p.cleanup()}
});
test('partial failure continues other file and preserves original error source after focus/tracker switch',async()=>{
 const p=pack([{failure:Error('TEST_ONLY_UNKNOWN'),name:'original.cpp'}, {name:'other.cpp'},{name:'late.cpp'}]);
 p.shell.tracker.widgets=[p.models[0].widget,p.twin(),p.models[1].widget];
 p.models[0].resource.fileService.write=async(_uri,content)=>{
  p.models[0].ops.push({content});p.shell.currentWidget=p.models[1].widget;
  p.shell.tracker.widgets.push(p.models[2].widget);throw Error('TEST_ONLY_PARTIAL_UNKNOWN');
 };
 try{await p.run();assert.deepEqual(p.models.map(f=>f.ops.length),[1,1,0]);
 assert.deepEqual(p.models.map(f=>f.s.dirty),[true,false,true]);assert.equal(p.messages.length,1);
 assert.match(p.messages[0],/original\.cpp/);assert.doesNotMatch(p.messages[0],/other\.cpp/)}
 finally{p.cleanup()}
});
test('distinct Saveables sharing a URI are not suppressed by path or widget id',async()=>{
 const p=pack([{name:'same.cpp'},{name:'same.cpp'}]);try{await p.run();
 assert.deepEqual(p.models.map(f=>f.ops.length),[1,1]);assert.deepEqual(p.models.map(f=>f.s.dirty),[false,false])}
 finally{p.cleanup()}
});
test('typing while first view saves stays dirty rather than being saved by second view',async()=>{
 const p=pack([{onWrite(f,attempt){if(attempt===1){f.model.text='TEST_ONLY_NEW_TYPING';f.model.alt++;f.model.version++;f.s.markAsDirty();f.s.contentChanges.push({text:'TEST_ONLY_NEW_TYPING'})}}}]);
 p.shell.tracker.widgets.push(p.twin());try{await p.run();const f=p.models[0];
 assert.equal(f.ops.length,1);assert.equal(f.ops[0].content,'TEST_ONLY_OLD');assert.equal(f.s.dirty,true);
 assert.equal(f.model.text,'TEST_ONLY_NEW_TYPING');assert.equal(f.s.bufferSavedVersionId,1);
 assert.deepEqual(f.s.contentChanges,[{text:'TEST_ONLY_NEW_TYPING'}])}finally{p.cleanup()}
});
test('original service rejection remains exact and aborts later loop rather than inventing success',async()=>{
 const p=pack([{},{}]),original=Error('TEST_ONLY_SERVICE_REJECTION');let calls=0;
 p.service.save=function(){assert.equal(this,p.service);calls++;return Promise.reject(original)};
 try{await assert.rejects(p.run(),e=>e===original);assert.equal(calls,1);
 assert.deepEqual(p.models.map(f=>f.ops.length),[0,0]);assert.deepEqual(p.messages,[])}finally{p.cleanup()}
});
test('native clean and untitled filters remain unchanged',async()=>{
 const p=pack([{},{}]);p.models[0].s._dirty=false;p.models[1].widget.uri=new URI('untitled:TEST_ONLY');
 p.service.canSaveNotSaveAs=w=>w.uri.scheme!=='untitled';
 try{await p.run();assert.deepEqual(p.models.map(f=>f.ops.length),[0,0]);assert.equal(p.models[1].s.dirty,true)}
 finally{p.cleanup()}
});
