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
 nativeMethod(shellText,'    get widgets() {','    getWidgetById(')].join(',\n')+'})')({Saveable:{isDirty:w=>!!w.saveable?.dirty}});
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
let closeChoice = true;

const defaultText=fs.readFileSync(req.resolve('@theia/core/lib/browser/window/default-window-service'),'utf8');
const windowMethods=Function('frontend_application_contribution_1','dialogs_1','return ({'+[
 nativeMethod(defaultText,'    collectContributionUnloadVetoes() {','    registerUnloadListeners('),
 nativeMethod(defaultText,'    async isSafeToShutDown(stopReason) {','    setSafeToShutDown(')].join('\n,\n')+'})')({OnWillStopAction:{is:v=>typeof v.action==='function'}},{confirmExit:()=>undefined});
const commonMethods=Function('document','nls_1','dialogs_1','saveable_1','navigatable_1','common_1','return ({'+[
 nativeMethod(frontendText,'    onWillStop() {','    async confirmExitWithOrWithoutSaving('),
 nativeMethod(frontendText,'    async confirmExitWithOrWithoutSaving(captionsToSave, performSave) {','    unsavedTabsCaptions('),
 nativeMethod(frontendText,'    unsavedTabsCaptions() {','    unsavedUntitledTabsCaptions('),
 nativeMethod(frontendText,'    unsavedUntitledTabsCaptions() {','    async configureDisplayLanguage('),
 nativeMethod(frontendText,'    async saveDirty(toSave) {','    toggleBreadcrumbs(')].join('\n,\n')+'})')(
 {createElement:()=>({appendChild:()=>{}})},
 {nls:{localizeByDefault:s=>s}},
 {ConfirmSaveDialog:class{async open(){if(closeChoice instanceof Error)throw closeChoice;return typeof closeChoice==='function'?await closeChoice():closeChoice}},Dialog:{CANCEL:'Cancel'},confirmExit:()=>undefined},
 {Saveable:{get:w=>w.saveable}},{NavigatableWidget:{getUri:w=>w.uri}},{UNTITLED_SCHEME:'untitled'});
allPrototype.canSaveAll=Function('return ({'+nativeMethod(shellText,'    canSaveAll() {','    async saveAll(')+'}).canSaveAll')();

const closeSource=fs.readFileSync(process.env.YNX_R60_PARENT_MODULE || new URL('../lib/native-window-close.js',import.meta.url),'utf8');
const closeModule={exports:{}};
Function('require','module','exports',closeSource)(name=>
 name==='@theia/core/lib/browser/common-frontend-contribution'?{CommonFrontendContribution:{prototype:commonMethods}}:
 name==='@theia/core/lib/browser/saveable'?{Saveable:{get:w=>w.saveable}}:req(name),closeModule,closeModule.exports);
closeModule.exports.installCloseSaveGuardOn?.(commonMethods);
function closePack(configs=[{}], options={}) {
 const p=pack(configs), posted=[],errors=[];
 p.service.canSave=w=>!!w.saveable?.dirty;
 for(const f of p.models)f.widget.title={label:'TEST_ONLY_FILE'};
 const common=Object.assign(Object.create(commonMethods),{shell:p.shell,saveResourceService:p.service});
 const windows=Object.assign(Object.create(windowMethods),{
  allowVetoes:true,corePreferences:{'application.confirmExit':'ifRequired'},
  contributions:{getContributions:()=>[common]},logger:{debug:()=>{},error:e=>errors.push(e)}
 });
 const target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:m=>posted.push(m)}}}};
 const host=new closeModule.exports.NativeWindowClose(windows,target,undefined,options.storage,options.persist);
 host.onStart({shell:p.shell});
 const request=target.__ynxLocalWorkbenchClose;
 return {...p,posted,errors,windows,target,host,request,common,
  close(id='00000000-0000-0000-0000-000000000001'){return request(id)}};
}


function expireAfterFinalDispose(p, restart=true) {
 let disposed=0;p.models[0].s.onContentChanged=()=>({dispose(){if(++disposed===2)queueMicrotask(()=>{
  p.host.onStop();if(restart)p.host.onStart({shell:p.shell});
 })}});
}
test('post-await owner rejection restores Save protection for next native close',async()=>{
 closeChoice=true;const p=closePack();expireAfterFinalDispose(p);
 try{await p.close();assert.equal(p.posted[0].accepted,false);assert.equal(p.windows.allowVetoes,true);
 p.models[0].type('TEST_ONLY_AFTER_RESTART');await p.target.__ynxLocalWorkbenchClose('00000000-0000-0000-0000-000000000002');
 assert.equal(p.posted[1].accepted,true);assert.equal(p.models[0].s.dirty,false);assert.equal(p.models[0].ops.length,2)}
 finally{p.cleanup()}
});
test('next Cancel after stale approval remains a real native veto',async()=>{
 closeChoice=true;const p=closePack();expireAfterFinalDispose(p);
 try{await p.close();p.models[0].type('TEST_ONLY_NEW_CANCEL');closeChoice=undefined;
 await p.target.__ynxLocalWorkbenchClose('00000000-0000-0000-0000-000000000002');
 assert.equal(p.posted[1].accepted,false);assert.equal(p.models[0].s.dirty,true);
 assert.equal(p.models[0].ops.length,1);assert.equal(p.windows.allowVetoes,true)}
 finally{p.cleanup()}
});
test('duplicate stale requests restore the original shared-operation veto permission',async()=>{
 closeChoice=true;const gate=deferred(),entered=deferred(),p=closePack([{}],{persist:()=>{entered.resolve();return gate.promise}});
 expireAfterFinalDispose(p);
 try{const first=p.close();await entered.promise;
 const second=p.close('00000000-0000-0000-0000-000000000002');gate.resolve();await Promise.all([first,second]);
 assert.equal(p.posted.length,2);assert.ok(p.posted.every(m=>m.accepted===false));
 assert.equal(p.windows.allowVetoes,true);assert.equal(p.models[0].ops.length,1);
 assert.equal(p.host.pendingClose,undefined)}finally{gate.resolve();p.cleanup()}
});
test('an explicitly preapproved false permission is preserved after owner expiry',async()=>{
 closeChoice=true;const p=closePack();p.windows.allowVetoes=false;let disposed=0;
 p.models[0].s.onContentChanged=()=>({dispose(){if(++disposed===1)queueMicrotask(()=>{p.host.onStop();p.host.onStart({shell:p.shell})})}});
 try{await p.close();assert.equal(p.posted[0].accepted,false);assert.equal(p.windows.allowVetoes,false);
 assert.equal(p.models[0].ops.length,0);assert.equal(p.models[0].s.dirty,true)}
 finally{p.cleanup()}
});
test('restoring one expired close does not alter an independent normal window',async()=>{
 closeChoice=true;const a=closePack(),b=closePack();expireAfterFinalDispose(a);
 try{await a.close();await b.close();assert.equal(a.windows.allowVetoes,true);
 assert.equal(a.posted[0].accepted,false);assert.equal(b.posted[0].accepted,true);
 assert.equal(b.windows.allowVetoes,false);assert.equal(b.models[0].ops.length,1)}
 finally{a.cleanup();b.cleanup()}
});
