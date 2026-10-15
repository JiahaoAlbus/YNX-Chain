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
const {installOn}=require(process.env.YNX_R55_PARENT_MODULE || '../lib/filesystem-save-as-owner');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};

function part(text,a,b){const i=text.indexOf(a),j=text.indexOf(b,i+a.length);assert.ok(i>=0&&j>i);return text.slice(i,j).trim().replace(/\/\*\*[\s\S]*$/,'').trim()}
const handlerText=fs.readFileSync(req.resolve('@theia/core/lib/browser/widget-open-handler'),'utf8');
const editorText=fs.readFileSync(req.resolve('@theia/editor/lib/browser/editor-manager'),'utf8');
const shellText=fs.readFileSync(req.resolve('@theia/core/lib/browser/shell/application-shell'),'utf8');
const dockText=fs.readFileSync(req.resolve('@theia/core/lib/browser/shell/theia-dock-panel'),'utf8');
const saveableText=fs.readFileSync(req.resolve('@theia/core/lib/browser/saveable-service'),'utf8');
const Handler=Function('return class {'+[
 part(handlerText,'    async open(uri, options) {','    async doOpen('),
 part(handlerText,'    async doOpen(widget, uri, options) {','    getByUri(')].join('\n')+'}')();
const Editor=Function('Base','return class extends Base {'+[
 part(editorText,'    async open(uri, options) {','    openToSide('),
 part(editorText,'    async doOpen(widget, uri, options) {','    async revealSelection(')].join('\n')+'}')(Handler);
const Shell=Function('ApplicationShell_1','return class {'+[
 part(shellText,'    async addWidget(widget, options) {','    getInsertionOptions('),
 part(shellText,'    getInsertionOptions(options) {','    getWidgets(')].join('\n')+'}')({
 isOpenToSideMode:m=>m==='open-to-left'||m==='open-to-right',isReplaceMode:m=>m==='tab-replace'});
class DockBoundary { addWidget(widget,options){this.added.push({widget,options});widget.isAttached=true} }
const Dock=Function('Base','return class extends Base {'+
 part(dockText,'    addWidget(widget, options) {','    activateWidget(')+'}')(DockBoundary);
function setup({attached=false}={}) {
 const chooser=deferred(),factory=deferred(),entered=deferred(),writes=[],activated=[],added=[],closed=[],prompts=[],closeRequests=[],closePromises=[],warnings=[];
 const uri=new URI('file:///TEST_ONLY/source.cpp'),targetUri=new URI('file:///TEST_ONLY/target.cpp');
 const document={version:1,dirty:true,text:'TEST_ONLY_SNAPSHOT',
 createSnapshot(){const value=this.text;return{read:()=>value}},
 async revert(){this.dirty=false;this.text='TEST_ONLY_SOURCE_DISK'}};
 const sourceWidget={id:'TEST_ONLY_SOURCE',isDisposed:false,isAttached:true,resource:uri,
 editor:{document},saveable:document,selection:{line:7,character:2},getResourceUri(){return this.resource},
 async closeWithoutSaving(){closed.push(this);this.isDisposed=true}};
 const closers=Function('saveable_1','return ({'+[
 part(saveableText,'    async closeWithSaving(widget, options) {','    async shouldSaveWidget('),
 part(saveableText,'    async shouldSaveWidget(widget, options) {','    async closeWithoutSaving(')
 ].join(',\n')+'})')({SaveReason:{AfterDelay:1},Saveable:{isDirty:w=>w.saveable.dirty,get:w=>w.saveable,closingWidgetWouldLoseSaveable:()=>true},
 ShouldSaveDialog:class{constructor(w){this.w=w}async open(){prompts.push(this.w);return undefined}}});
 const closeService=Object.assign({},closers,{autoSave:'off',saveThrottles:new Map(),logger:{warn:()=>{}}});
 sourceWidget.close=function(){closeRequests.push(this);const result=closeService.closeWithSaving(this);closePromises.push(result);return result};
 const dock=Object.assign(new Dock(),{mode:'multiple-document',added,widgetAdded:{emit:()=>{}},markActiveTabBar:()=>{}});
 const shell=Object.assign(new Shell(),{mainPanel:dock,track:()=>{},resolveWidgetArea:(_w,o)=>o,
 getAreaFor:()=> 'main',getTabBarFor:()=>undefined,activateWidget:async id=>activated.push(id),revealWidget:async id=>activated.push(id),
 logger:{error:()=>{}}});
 const target={id:'TEST_ONLY_TARGET',isAttached:attached,title:{},editor:{uri:targetUri}};
 const handler=Object.assign(new Editor(),{shell,navigationLocationService:{startNavigation:()=>{},endNavigation:()=>{}},
 preferenceService:{get:()=>false},nextCounter:()=>1,getOrCreateWidget:async()=>{entered.resolve();return factory.promise},
 revealSelection:async()=>{}});
 const prototype=Object.assign({},nativeSave);installOn(prototype,undefined,Handler);
 const service=Object.assign(Object.create(prototype),{canSaveNotSaveAs:()=>true,
 fileDialogService:{showSaveDialog:()=>chooser.promise},fileService:{exists:async()=>false,
 createFile:async(u,b)=>writes.push({uri:String(u),text:b.toString()})},confirmOverwrite:async()=>true,
 openerService:{getOpener:async()=>handler},messageService:{info:async()=>{}},logger:{warn:e=>warnings.push(e)}});
 return {service,sourceWidget,document,uri,targetUri,target,handler,shell,dock,factory,entered,chooser,writes,activated,added,closed,prompts,closeRequests,closePromises,warnings,
 start(){const pending=service.saveAs(sourceWidget);chooser.resolve(targetUri);return pending},
 type(text){document.version++;document.dirty=true;document.text=text},
 async finish(pending){factory.resolve(target);const result=await pending;await Promise.all(closePromises);return result}};
}
test('normal native EditorManager open inserts target and closes exact clean source once',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;const result=await f.finish(pending);
 assert.equal(String(result),String(f.targetUri));assert.equal(f.writes.length,1);
 assert.equal(f.added.length,1);assert.equal(f.added[0].options.ref,f.sourceWidget);assert.equal(f.added[0].options.closeRef,true);
 assert.deepEqual(f.closeRequests,[f.sourceWidget]);assert.deepEqual(f.closed,[f.sourceWidget]);assert.deepEqual(f.prompts,[]);
 assert.deepEqual(f.activated,['TEST_ONLY_TARGET']);
});
test('late typing during native widget factory does not request source close or steal focus',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;f.type('TEST_ONLY_NEW_WHILE_FACTORY');
 const result=await f.finish(pending);assert.equal(String(result),String(f.targetUri));assert.equal(f.writes.length,1);
 assert.deepEqual(f.closeRequests,[]);assert.deepEqual(f.prompts,[]);assert.deepEqual(f.added,[]);assert.deepEqual(f.activated,[]);
 assert.equal(f.document.dirty,true);assert.equal(f.document.text,'TEST_ONLY_NEW_WHILE_FACTORY');
 assert.deepEqual(f.sourceWidget.selection,{line:7,character:2});assert.equal(String(f.sourceWidget.resource),String(f.uri));
});
test('rebound source document is not subject to old close request',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;
 const next={dirty:true,text:'TEST_ONLY_REBOUND',version:1};f.sourceWidget.saveable=next;f.sourceWidget.editor.document=next;
 await f.finish(pending);assert.deepEqual(f.closeRequests,[]);assert.deepEqual(f.activated,[]);assert.deepEqual(f.added,[]);
 assert.equal(next.text,'TEST_ONLY_REBOUND');assert.equal(next.dirty,true);
});
test('rebound source URI does not insert target relative to a different resource',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;f.sourceWidget.resource=new URI('file:///TEST_ONLY/other.cpp');
 await f.finish(pending);assert.deepEqual(f.added,[]);assert.deepEqual(f.closeRequests,[]);assert.deepEqual(f.activated,[]);
});
test('same-id replacement remains untouched; original disposed source no longer triggers stale insertion',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;f.sourceWidget.isDisposed=true;
 const replacement={id:f.sourceWidget.id,dirty:true,text:'TEST_ONLY_REOPENED',close(){assert.fail('replacement must not be closed')}};
 await f.finish(pending);assert.equal(replacement.dirty,true);assert.equal(replacement.text,'TEST_ONLY_REOPENED');
 assert.deepEqual(f.added,[]);assert.deepEqual(f.activated,[]);assert.deepEqual(f.closeRequests,[]);
});
test('already attached target does not get stale activation after source changes',async()=>{
 const f=setup({attached:true}),pending=f.start();await f.entered.promise;f.type('TEST_ONLY_EXISTING_TARGET_NEW');
 await f.finish(pending);assert.deepEqual(f.activated,[]);assert.deepEqual(f.added,[]);assert.deepEqual(f.closeRequests,[]);
 assert.equal(f.document.dirty,true);
});
test('chooser cancel never enters original handler or writes a target',async()=>{
 const f=setup(),pending=f.service.saveAs(f.sourceWidget);f.chooser.resolve(undefined);assert.equal(await pending,undefined);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.added,[]);assert.deepEqual(f.activated,[]);assert.deepEqual(f.closeRequests,[]);
});
test('native factory failure remains original cause without replaying accepted write',async()=>{
 const f=setup(),pending=f.start();await f.entered.promise;const failure=Error('TEST_ONLY_FACTORY_FAILED');
 f.factory.reject(failure);assert.equal(await pending,undefined);assert.deepEqual(f.warnings,[failure]);
 assert.equal(f.writes.length,1);assert.deepEqual(f.added,[]);assert.deepEqual(f.closeRequests,[]);
});
test('non-native custom opener is delegated without installing native doOpen behavior',async()=>{
 const f=setup(),calls=[];
 f.service.openerService.getOpener=async()=>({open:async(u,o)=>calls.push({u:String(u),o})});
 const result=await f.start();assert.equal(String(result),String(f.targetUri));assert.equal(calls.length,1);
 assert.equal(calls[0].o.widgetOptions.ref,f.sourceWidget);assert.equal(f.writes.length,1);
});
