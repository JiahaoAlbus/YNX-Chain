import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ModelService} from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/services/modelService.js';
import {TextModel} from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/model/textModel.js';
import {Range} from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/core/range.js';
import {URI} from '../node_modules/@theia/monaco-editor-core/esm/vs/base/common/uri.js';
import {Event} from '../node_modules/@theia/monaco-editor-core/esm/vs/base/common/event.js';
import {EDITOR_MODEL_DEFAULTS} from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/core/misc/textModelDefaults.js';
import {SingleModelEditStackElement,MultiModelEditStackElement} from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/model/editStack.js';
import {UndoRedoService} from '../node_modules/@theia/monaco-editor-core/esm/vs/platform/undoRedo/common/undoRedoService.js';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {prepare}=require('../../ynx-workbench/lib/workspace-model-relocation.js');
const {applyTextTransaction}=require('../../ynx-workbench/lib/workspace-text-edit-adapter.js');
const {begin:beginEventFence}=require('../../ynx-workbench/lib/workspace-edit-event-fence.js');
const {ReferenceCollection}=require('../node_modules/@theia/core/lib/common/reference.js');
const listener=require('../node_modules/@theia/core/lib/common/listener.js');
const coreURI=require('../node_modules/@theia/core/lib/common/uri.js').default;
// Execute the retained, unmodified MonacoEditorModel implementation. Only DOM
// service lookup/UI imports are supplied; real buffers, document methods,
// resources, reference ownership and all history code remain retained classes.
function documentClass(modelService){
 const filename=require.resolve('../node_modules/@theia/monaco/lib/browser/monaco-editor-model.js'),exports={};
 const hostRequire=createRequire(filename),modelToken={},languageToken={};
 const load=name=>{
  if(name==='@theia/monaco-editor-core')return{Uri:URI};
  if(name.includes('/standaloneServices'))return{StandaloneServices:{get:token=>token===modelToken?modelService:{createByFilepathOrFirstLine:()=> 'plaintext'}}};
  if(name.endsWith('/languages/language'))return{ILanguageService:languageToken};
  if(name.endsWith('/services/model'))return{IModelService:modelToken};
  if(name.endsWith('/model/textModel'))return{TextModel};
  if(name==='@theia/core')return listener;
  if(name.endsWith('/browser/saveable'))return{SaveReason:{Manual:1}};
  return hostRequire(name);
 };
 runInNewContext(readFileSync(filename,'utf8'),{require:load,exports,console,setTimeout,clearTimeout},{filename});return exports.MonacoEditorModel;
}
async function fixture(t,text='twice'){
 const warnings=[],undoRedo=new UndoRedoService({prompt(){throw Error('No split');}},{warn:message=>warnings.push(message),error:message=>warnings.push(message)});
 const tokenization=()=>({dispose(){},onDidChangeLanguage:Event.None,onDidChangeFontTokens:Event.None,_hasListeners:()=>false,handleDidChangeContent(){},handleDidChangeLanguage(){},handleLanguageConfigurationServiceChange(){},getLanguageId:()=> 'plaintext'});
 const modelService=new ModelService({onDidChangeConfiguration:Event.None,getValue:key=>key==='files.restoreUndoStack'?true:key==='editor'?{...EDITOR_MODEL_DEFAULTS,trimAutoWhitespace:false,detectIndentation:false}:undefined},{getEOL:()=> '\n'},undoRedo,{createInstance:(ctor,...args)=>new ctor(...args,undoRedo,{requestRichLanguageFeatures(){}},{onDidChange:Event.None},{createInstance:()=>tokenization()})});
 const Document=documentClass(modelService),disk=new Map([['file:///owned/A.sol',text],['file:///owned/B.sol','twice'],['file:///owned/Other.sol','unchanged']]),resources=new Map(),refs=[],disposed=[];
 const collection=new ReferenceCollection(async key=>{
  const resource={uri:new coreURI(key),encoding:'utf16le',version:{etag:'original'},readOnly:false,async readContents(){return disk.get(key)||'';},dispose(){disposed.push(key);}};resources.set(key,resource);
  return new Document(resource,{asRange:range=>range},{asRange:range=>range}).load();
 });
 const service={get:key=>collection.get(key),createModelReference:uri=>collection.acquire(uri.toString())};
 for(const key of disk.keys())refs.push(await service.createModelReference(URI.parse(key)));
 t.after(()=>{collection.dispose();modelService.dispose();});
 const dependencies={URI,Range,SingleModelEditStackElement,MultiModelEditStackElement,undoRedo,minimalEdits:async(_,edits)=>edits,selections:()=>[],warn:message=>warnings.push(message),readClosed:async uri=>disk.get(uri.toString())};
 const edit=keys=>keys.map(key=>({resource:URI.parse(key),textEdit:{range:new Range(1,1,1,6),text:'doubleValue'}}));
 const a=refs[0].object,b=refs[1].object,other=refs[2].object;
 return{service,collection,modelService,undoRedo,disk,resources,refs,disposed,a,b,other,warnings,dependencies,edit};
}
test('real replacement preparation uses scoped owned buffer writes while the actual document event fence is held',async t=>{
 const h=await fixture(t),old=URI.parse(h.a.uri),next=URI.parse('file:///owned/moved/A.sol');
 h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' dirty'}],()=>[]);
 h.service.onDidCreate=h.collection.onDidCreate;
 const fence=await beginEventFence({affectedResources:[old,next],documents:[h.a],textModelService:h.service});
 let plan,targets;
 try{
  plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}],runOwned:callback=>fence.runOwned(callback)});
  const replacement=plan.entries[0].target.object;
  assert.equal(replacement.getText(),'twice dirty');assert.equal(replacement.dirty,true);assert.equal(replacement.getEncoding(),'utf16le');
  replacement.updateModel(()=>replacement.textEditorModel.setValue('stale watch'),{ignoreDirty:true});assert.equal(replacement.getText(),'twice dirty');
  plan.migrate();targets=await plan.finalize();
  await fence.release({outcome:'commit',redirectDocument:document=>document===h.a?replacement:undefined});
  assert.equal(replacement.getText(),'twice dirty');assert.equal(replacement.dirty,true);
 }finally{
  await fence.release();for(const target of targets||[])target.dispose();
 }
});
test('real Theia documents preserve dirty/saved version, encoding, references and native typing/workspace history through finalize',async t=>{
 const h=await fixture(t),old=URI.parse(h.a.uri),next=URI.parse('file:///owned/moved/A.sol');h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' old'}],()=>[]);assert.equal(h.a.dirty,true);const saved=h.a.bufferSavedVersionId;
 await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);const originalOther=h.undoRedo.getElements(URI.parse(h.other.uri));let fence=0,view;
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}],beginFence:()=>{fence++;return{dispose(){fence--;}};},captureView:()=>({selection:7}),restoreView:(_,state)=>{view=state;}});
 assert.equal(h.a.isDisposed(),false);assert.equal(plan.entries[0].target.object.dirty,true);assert.equal(plan.entries[0].target.object.bufferSavedVersionId,saved);assert.equal(plan.entries[0].target.object.getEncoding(),'utf16le');assert.equal(h.disk.get(h.a.uri),'twice');
 plan.migrate();const targets=await plan.finalize();assert.deepEqual(view,{selection:7});assert.equal(fence,0);assert.equal(h.a.isDisposed(),false);h.refs[0].dispose();assert.equal(h.a.isDisposed(),true);assert.equal(h.service.get(old.toString()),undefined);
 const moved=targets[0].object;await moved.textEditorModel.undo();assert.equal(moved.getText(),'twice old');assert.equal(h.b.getText(),'twice');await moved.textEditorModel.undo();assert.equal(moved.getText(),'twice');assert.equal(moved.dirty,false);await moved.textEditorModel.redo();await moved.textEditorModel.redo();assert.equal(moved.getText(),'doubleValue old');assert.equal(moved.dirty,true);assert.deepEqual(h.undoRedo.getElements(URI.parse(h.other.uri)),originalOther);assert.deepEqual(h.warnings,[]);
 h.disk.set(next.toString(),moved.getText());targets[0].dispose();assert.equal(h.service.get(next.toString()),undefined);const reopened=await h.service.createModelReference(next);await reopened.object.textEditorModel.undo();assert.equal(reopened.object.getText(),'twice old');reopened.dispose();
});
test('directory leaves migrate together and rollback preserves original document identities and native past/future history',async t=>{
 const h=await fixture(t);await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);await h.a.textEditorModel.undo();
 const mappings=[h.a,h.b].map(doc=>({oldResource:URI.parse(doc.uri),newResource:URI.parse(doc.uri.replace('/owned/','/owned/dir/'))})),before=mappings.map(mapping=>h.undoRedo.getElements(mapping.oldResource));
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings});plan.migrate();plan.rollback();assert.equal(h.service.get(h.a.uri),h.a);assert.equal(h.service.get(h.b.uri),h.b);assert.equal(mappings.every(mapping=>!h.service.get(mapping.newResource.toString())),true);assert.deepEqual(mappings.map(mapping=>h.undoRedo.getElements(mapping.oldResource)),before);
 await h.a.textEditorModel.redo();assert.equal(h.a.getText(),'doubleValue');assert.equal(h.b.getText(),'doubleValue');assert.deepEqual(h.warnings,[]);
});
test('existing target model/history, preparation failure and source version change refuse without migrating any original resource',async t=>{
 const h=await fixture(t),old=URI.parse(h.a.uri),next=URI.parse('file:///owned/new.sol');
 await assert.rejects(prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:URI.parse(h.b.uri)}]}),/already has/);
 const original=h.service.createModelReference;h.service.createModelReference=async uri=>{if(uri.toString()===next.toString())throw Error('load failure');return original(uri);};await assert.rejects(prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]}),/load failure/);h.service.createModelReference=original;assert.equal(h.a.getText(),'twice');assert.equal(h.service.get(next.toString()),undefined);
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]});h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' user'}],()=>[]);assert.throws(()=>plan.migrate(),/changed/);assert.equal(h.a.uri,old.toString());assert.equal(h.a.getText(),'twice user');assert.throws(()=>plan.rollback(),/changed/);plan.cancelPreparation();assert.equal(h.service.get(next.toString()),undefined);assert.equal(h.a.getText(),'twice user');
});
test('closed origin history hydrates using real ModelService then moves to a normally referenced replacement',async t=>{
 const h=await fixture(t),old=URI.parse(h.a.uri),next=URI.parse('file:///owned/closed.sol');await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);h.disk.set(h.a.uri,h.a.getText());h.refs[0].dispose();assert.equal(h.service.get(old.toString()),undefined);
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]});plan.migrate();const [target]=await plan.finalize();assert.equal(h.service.get(old.toString()),undefined);await target.object.textEditorModel.undo();assert.equal(target.object.getText(),'twice');assert.equal(h.b.getText(),'twice');assert.deepEqual(h.warnings,[]);
});
test('native migration failure restores original keys, child maps and captured records without altering dirty models',async t=>{
 const h=await fixture(t);await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);const old=URI.parse(h.a.uri),next=URI.parse('file:///owned/failure.sol'),element=h.undoRedo.getElements(old).past.at(-1),history=h.undoRedo.getElements(old),child=element._editStackElementsArr[0],original=child.setModel.bind(child),childMap=element._editStackElementsMap;
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]});let fail=true;child.setModel=model=>{if(fail){fail=false;throw Error('native migration failure');}return original(model);};assert.throws(()=>plan.migrate(),/native migration failure/);child.setModel=original;
 assert.equal(element._editStackElementsMap,childMap);assert.deepEqual(h.undoRedo.getElements(old),history);assert.equal(h.undoRedo._editStacks.has(next.toString()),false);assert.equal(h.a.getText(),'doubleValue');assert.equal(h.a.dirty,true);plan.rollback();await h.a.textEditorModel.undo();assert.equal(h.a.getText(),'twice');assert.equal(h.b.getText(),'twice');assert.deepEqual(h.warnings,[]);
});
test('busy native stacks and owned transactions refuse zero migration; stale rollback protects later user text/history',async t=>{
 const h=await fixture(t);await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);const old=URI.parse(h.a.uri),next=URI.parse('file:///owned/stale.sol'),stack=h.undoRedo._editStacks.get(old.toString()),transaction=h.undoRedo.getElements(old).past.at(-1)[Symbol.for('ynx.workspace-text-transaction.v1')];
 stack.locked=true;await assert.rejects(prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]}),/busy/);stack.locked=false;assert.equal(h.service.get(next.toString()),undefined);
 transaction.busy=true;await assert.rejects(prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]}),/busy/);transaction.busy=false;
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]});plan.migrate();const moved=plan.entries[0].target.object;moved.textEditorModel.pushStackElement();moved.textEditorModel.pushEditOperations([],[{range:new Range(1,12,1,12),text:' user'}],()=>[]);moved.textEditorModel.pushStackElement();const history=h.undoRedo.getElements(next);assert.throws(()=>plan.rollback(),/changed/);assert.equal(moved.getText(),'doubleValue user');assert.deepEqual(h.undoRedo.getElements(next),history);assert.equal(h.a.getText(),'doubleValue');
});
test('destination history and duplicate directory leaves are refused before any replacement reference is acquired',async t=>{
 const h=await fixture(t),old=URI.parse(h.a.uri),target=URI.parse(h.other.uri);h.other.textEditorModel.pushEditOperations([],[{range:new Range(1,10,1,10),text:' user'}],()=>[]);h.disk.set(h.other.uri,h.other.getText());h.refs[2].dispose();assert.equal(h.service.get(target.toString()),undefined);const history=h.undoRedo.getElements(target);
 await assert.rejects(prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:target}]}),/history/);assert.deepEqual(h.undoRedo.getElements(target),history);assert.equal(h.a.getText(),'twice');
 const next=URI.parse('file:///owned/duplicate.sol');await assert.rejects(prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next},{oldResource:URI.parse(h.b.uri),newResource:next}]}),/duplicate/);assert.equal(h.service.get(next.toString()),undefined);
});
test('replacement preserves native BOM metadata, CRLF and UTF-16 spans without introducing visible BOM text',async t=>{
 const h=await fixture(t,'\uFEFFtwice\r\n中文🧩'),old=URI.parse(h.a.uri),next=URI.parse('file:///owned/bom.sol');h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' user'}],()=>[]);const value=h.a.getText(),withBOM=h.a.textEditorModel.getValue(undefined,true);
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]});plan.migrate();const [target]=await plan.finalize();assert.equal(target.object.getText(),value);assert.equal(target.object.textEditorModel.getValue(undefined,true),withBOM);assert.equal(target.object.textEditorModel.getEOL(),'\r\n');await target.object.textEditorModel.undo();assert.equal(target.object.getText(),'twice\r\n中文🧩');assert.equal(target.object.dirty,false);
});
test('unrelated typing during prepare and after migrate remains independently undoable and does not block migration rollback',async t=>{
 for(const phase of ['preparing','prepared','migrated']) {
  const h=await fixture(t),old=URI.parse(h.a.uri),next=URI.parse(`file:///owned/${phase}.sol`);
  await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);
  const typeOther=()=>{h.other.textEditorModel.pushEditOperations([],[{range:new Range(1,10,1,10),text:' user'}],()=>[]);h.other.textEditorModel.pushStackElement();};
  const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}],captureView:()=>{if(phase==='preparing')typeOther();}});
  if(phase==='migrated')plan.migrate();
  if(phase!=='preparing')typeOther();const otherHistory=h.undoRedo.getElements(URI.parse(h.other.uri));
  if(phase!=='migrated')plan.migrate();plan.rollback();assert.equal(h.a.getText(),'doubleValue');assert.equal(h.b.getText(),'doubleValue');assert.equal(h.other.getText(),'unchanged user');assert.deepEqual(h.undoRedo.getElements(URI.parse(h.other.uri)),otherHistory);
  await h.other.textEditorModel.undo();assert.equal(h.other.getText(),'unchanged');await h.a.textEditorModel.undo();assert.equal(h.a.getText(),'twice');assert.equal(h.b.getText(),'twice');assert.deepEqual(h.warnings,[]);
 }
});
test('synchronous migration failure callbacks can create unrelated native history without compensation deleting it',async t=>{
 for(const phase of ['failure','compensation']) {
 const h=await fixture(t),old=URI.parse(h.a.uri),next=URI.parse('file:///owned/reentrant-failure.sol');await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]}),element=h.undoRedo.getElements(old).past.at(-1),child=element._editStackElementsArr[0],original=child.setModel.bind(child);let calls=0,otherHistory;
 child.setModel=model=>{calls++;if(calls===(phase==='failure'?1:2)){h.other.textEditorModel.pushEditOperations([],[{range:new Range(1,10,1,10),text:' callback'}],()=>[]);h.other.textEditorModel.pushStackElement();otherHistory=h.undoRedo.getElements(URI.parse(h.other.uri));}if(calls===1)throw Error('callback migration failure');return original(model);};
 assert.throws(()=>plan.migrate(),/callback migration failure/);child.setModel=original;assert.equal(h.other.getText(),'unchanged callback');assert.deepEqual(h.undoRedo.getElements(URI.parse(h.other.uri)),otherHistory);plan.rollback();assert.deepEqual(h.undoRedo.getElements(URI.parse(h.other.uri)),otherHistory);
 await h.other.textEditorModel.undo();assert.equal(h.other.getText(),'unchanged');await h.a.textEditorModel.undo();assert.equal(h.a.getText(),'twice');assert.equal(h.b.getText(),'twice');assert.deepEqual(h.warnings,[]);
 }
});
test('changes to a related shared workspace wrapper still refuse migration before native resource changes',async t=>{
 const h=await fixture(t),old=URI.parse(h.a.uri),next=URI.parse('file:///owned/related.sol');await applyTextTransaction({textModelService:h.service,transformSnippetStringToInsertText:edit=>edit.textEdit},h.edit([h.a.uri,h.b.uri]),h.dependencies);
 const plan=await prepare({textModelService:h.service,undoRedo:h.undoRedo,mappings:[{oldResource:old,newResource:next}]}),wrapper=h.undoRedo._editStacks.get(old.toString())._past.at(-1),labels=wrapper.resourceLabels;wrapper.resourceLabels=[...labels,'changed'];
 assert.throws(()=>plan.migrate(),/history changed/);assert.equal(h.undoRedo._editStacks.has(next.toString()),false);assert.equal(h.a.getText(),'doubleValue');wrapper.resourceLabels=labels;plan.rollback();await h.a.textEditorModel.undo();assert.equal(h.a.getText(),'twice');
});
