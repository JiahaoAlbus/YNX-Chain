import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ModelService } from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/services/modelService.js';
import { UndoRedoSource } from '../node_modules/@theia/monaco-editor-core/esm/vs/platform/undoRedo/common/undoRedo.js';
import { setUnexpectedErrorHandler, errorHandler } from '../node_modules/@theia/monaco-editor-core/esm/vs/base/common/errors.js';
import { TextModel } from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/model/textModel.js';
import { Range } from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/core/range.js';
import { URI } from '../node_modules/@theia/monaco-editor-core/esm/vs/base/common/uri.js';
import { Event } from '../node_modules/@theia/monaco-editor-core/esm/vs/base/common/event.js';
import { EDITOR_MODEL_DEFAULTS } from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/core/misc/textModelDefaults.js';
import { SingleModelEditStackElement, MultiModelEditStackElement } from '../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/model/editStack.js';
import { UndoRedoService } from '../node_modules/@theia/monaco-editor-core/esm/vs/platform/undoRedo/common/undoRedoService.js';
const require = createRequire(import.meta.url), { applyTextTransaction, assertSupported, readClosedDocument, relocateResources } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js');
require('reflect-metadata');
const { EncodingService } = require('../node_modules/@theia/core/lib/common/encoding-service.js');
const { BinaryBufferReadableStream } = require('../node_modules/@theia/core/lib/common/buffer.js');
const { consumeStream } = require('../node_modules/@theia/core/lib/common/stream.js');
function fixture(t, texts = ['twice\r\n中文🧩', 'twice\nsecond line', 'twice', 'twice']) {
 const warnings = [], undoRedo = new UndoRedoService({ prompt(){throw Error('No split/confirmation dialog is allowed');} }, {warn:message=>warnings.push(message),error:message=>warnings.push(message)}), models = new Map(), disk = new Map();
 const tokenization = () => ({dispose(){},onDidChangeLanguage:Event.None,onDidChangeFontTokens:Event.None,_hasListeners:()=>false,handleDidChangeContent(){},handleDidChangeLanguage(){},handleLanguageConfigurationServiceChange(){},getLanguageId:()=> 'plaintext'});
 const modelService=new ModelService({onDidChangeConfiguration:Event.None,getValue:key=>key==='files.restoreUndoStack'?true:key==='editor'?{...EDITOR_MODEL_DEFAULTS,trimAutoWhitespace:false,detectIndentation:false}:undefined},{getEOL:()=> '\n'},undoRedo,{createInstance:(ctor,...args)=>new ctor(...args,undoRedo,{requestRichLanguageFeatures(){}},{onDidChange:Event.None},{createInstance:()=>tokenization()})});
 function create(uri,text) {const model=modelService.createModel(text,'plaintext',uri);models.set(uri.toString(),model);return model;}
 for(let i=0;i<texts.length;i++){const uri=URI.parse(`file:///owned/${i}.sol`);disk.set(uri.toString(),texts[i]);create(uri,texts[i]);}
 const service={async createModelReference(uri){let model=models.get(uri.toString());if(!model){model=create(uri,disk.get(uri.toString()));}return{object:{textEditorModel:model},dispose(){}};}};
 const workspace={textModelService:service,transformSnippetStringToInsertText:edit=>edit.textEdit};
 const dependencies={URI,Range,SingleModelEditStackElement,MultiModelEditStackElement,undoRedo,minimalEdits:async(_,edits)=>edits,selections:()=>[],warn:message=>warnings.push(message),readClosed:async uri=>disk.get(uri.toString())};
 t.after(()=>{for(const model of models.values())model.dispose();});
 const resources=Array.from(models.values()).map(model=>model.uri);
 const edits=()=>resources.map(uri=>({resource:uri,versionId:models.get(uri.toString()).getVersionId(),textEdit:{range:new Range(1,1,1,6),text:'doubleValue'}}));
 const values=()=>resources.map(uri=>models.get(uri.toString()).getValue());
 const save=()=>{for(const model of models.values())disk.set(model.uri.toString(),model.getValue());};
 function close(uri){const model=models.get(uri.toString());save();modelService.destroyModel(uri);models.delete(uri.toString());}
 return {modelService,workspace,dependencies,models,undoRedo,warnings,resources,edits,values,save,close,disk};
}
test('real retained Monaco models and workspace undo stacks restore every text edit, EOL and UTF-16 span from any caller',async t=>{
 const h=fixture(t),before=h.values();const changes=h.edits();changes[0].textEdit.eol=0;
 assert.deepEqual(await applyTextTransaction(h.workspace,changes,h.dependencies),{totalEdits:4,totalFiles:4});
 const after=h.values();assert.match(after[0],/doubleValue\n中文🧩/);h.save();
 assert.equal(new Set(h.resources.map(uri=>h.undoRedo.getElements(uri).past.at(-1))).size,1);
 await h.models.get(h.resources[0].toString()).undo();assert.deepEqual(h.values(),before);h.save();
 await h.models.get(h.resources[3].toString()).redo();assert.deepEqual(h.values(),after);h.save();
 await h.models.get(h.resources[2].toString()).undo();assert.deepEqual(h.values(),before);assert.deepEqual(h.warnings,[]);
});
test('later typing in another caller blocks whole-workspace undo without splitting or dropping any history',async t=>{
 const h=fixture(t);await applyTextTransaction(h.workspace,h.edits(),h.dependencies);const after=h.values(),caller=h.models.get(h.resources[1].toString());
 caller.pushStackElement();caller.pushEditOperations([],[{range:new Range(1,12,1,12),text:' user'}],()=>[]);caller.pushStackElement();
 const histories=h.resources.map(uri=>h.undoRedo.getElements(uri));const changed=h.values();
 await h.models.get(h.resources[0].toString()).undo();assert.deepEqual(h.values(),changed);assert.deepEqual(h.resources.map(uri=>h.undoRedo.getElements(uri)),histories);assert.match(h.warnings[0],/later edits/);
 await caller.undo();assert.deepEqual(h.values(),after);await h.models.get(h.resources[0].toString()).undo();assert.equal(h.values().every(value=>value.startsWith('twice')),true);
});
test('closed caller models are restored before atomic undo/redo and external changed bytes refuse without losing history',async t=>{
 const h=fixture(t);await applyTextTransaction(h.workspace,h.edits(),h.dependencies);const after=h.values();h.close(h.resources[1]);
 await h.models.get(h.resources[0].toString()).undo();assert.equal(h.values().every(value=>value.startsWith('twice')),true);
 await h.models.get(h.resources[0].toString()).redo();assert.deepEqual(h.values(),after);
 h.close(h.resources[2]);h.disk.set(h.resources[2].toString(),'external user replacement');const history=h.undoRedo.getElements(h.resources[0]);
 await h.models.get(h.resources[0].toString()).undo();assert.equal(h.models.get(h.resources[0].toString()).getValue(),after[0]);assert.equal(h.disk.get(h.resources[2].toString()),'external user replacement');assert.equal(h.models.has(h.resources[2].toString()),false);assert.deepEqual(h.undoRedo.getElements(h.resources[0]),history);assert.match(h.warnings.at(-1),/changed|unavailable/);
});
test('version changes during async preparation and unsupported mixed workspace operations never mutate buffers or history',async t=>{
 const h=fixture(t),edits=h.edits(),before=h.values();let first=true;h.dependencies.minimalEdits=async(_,values)=>{if(first){first=false;h.models.get(h.resources[0].toString()).applyEdits([{range:new Range(1,1,1,1),text:'user '}]);}return values;};
 await assert.rejects(applyTextTransaction(h.workspace,edits,h.dependencies),/changed during preparation/);assert.equal(h.values()[0],'user '+before[0]);assert.deepEqual(h.values().slice(1),before.slice(1));assert.equal(h.resources.every(uri=>!h.undoRedo.getElements(uri).past.length),true);
 class ResourceTextEdit{};const text=Object.assign(new ResourceTextEdit(),{resource:h.resources[0],textEdit:{text:'x'}});
 assert.throws(()=>assertSupported([text,{oldResource:h.resources[1],newResource:URI.parse('file:///owned/new.sol')}],ResourceTextEdit),/not available yet/);
});
test('string and UndoRedoSource routes hydrate real ModelService closed-model undo history',async t=>{
 const h=fixture(t);h.dependencies.undoRedoSource=new UndoRedoSource();await applyTextTransaction(h.workspace,h.edits(),h.dependencies);h.close(h.resources[1]);
 await h.undoRedo.undo(h.dependencies.undoRedoSource);assert.equal(h.values().every(value=>value.startsWith('twice')),true);
 await h.undoRedo.redo(h.dependencies.undoRedoSource);assert.equal(h.values().every(value=>value.startsWith('doubleValue')),true);
 const other=fixture(t);await applyTextTransaction(other.workspace,other.edits(),other.dependencies);other.close(other.resources[2]);await other.undoRedo.undo(other.resources[0].toString());assert.equal(other.values().every(value=>value.startsWith('twice')),true);
});
test('cross-file listeners see a complete commit, undo and redo; their typing remains a separate native stack element',async t=>{
 for(const direction of ['commit','undo','redo']) {
  const h=fixture(t,['twice','twice']);if(direction!=='commit')await applyTextTransaction(h.workspace,h.edits(),h.dependencies);if(direction==='redo')await h.undoRedo.undo(h.resources[0]);
  const first=h.models.get(h.resources[0].toString()),second=h.models.get(h.resources[1].toString());let seen,once=true;
  first.onDidChangeContent(()=>{if(!once)return;once=false;seen=second.getValue();second.pushStackElement();second.pushEditOperations([],[{range:new Range(1,1,1,1),text:'user '}],()=>[]);second.pushStackElement();});
  if(direction==='commit')await applyTextTransaction(h.workspace,h.edits(),h.dependencies);else await h.undoRedo[direction](h.resources[0]);
  const expected=direction==='undo'?'twice':'doubleValue';assert.equal(seen,expected);assert.deepEqual(h.values(),[expected,'user '+expected]);
  await second.undo();assert.deepEqual(h.values(),[expected,expected]);
 }
});
test('a throwing listener cannot leave half of the workspace edit applied and still reports the listener error',async t=>{
 const h=fixture(t,['twice','twice']),errors=[],previous=errorHandler.getUnexpectedErrorHandler();setUnexpectedErrorHandler(error=>errors.push(error));t.after(()=>setUnexpectedErrorHandler(previous));
 h.models.get(h.resources[0].toString()).onDidChangeContent(()=>{throw Error('listener failure');});await applyTextTransaction(h.workspace,h.edits(),h.dependencies);
 assert.deepEqual(h.values(),['doubleValue','doubleValue']);assert.match(errors[0].message,/listener failure/);await h.undoRedo.undo(h.resources[0]);assert.deepEqual(h.values(),['twice','twice']);
});
test('unexpected native apply or stack failure rolls back all bytes and keeps previous past/future elements',async t=>{
 const h=fixture(t,['twice','twice']);await applyTextTransaction(h.workspace,h.edits(),h.dependencies);await h.undoRedo.undo(h.resources[0]);const before=h.values(),history=h.resources.map(uri=>h.undoRedo.getElements(uri));
 const second=h.models.get(h.resources[1].toString()),apply=second.applyEdits.bind(second);let fail=true;second.applyEdits=(...args)=>{if(fail){fail=false;throw Error('injected apply failure');}return apply(...args);};
 await assert.rejects(applyTextTransaction(h.workspace,h.edits(),h.dependencies),/injected apply/);assert.deepEqual(h.values(),before);assert.deepEqual(h.resources.map(uri=>h.undoRedo.getElements(uri)),history);
 const push=h.undoRedo.pushElement.bind(h.undoRedo);h.undoRedo.pushElement=(...args)=>{push(...args);throw Error('injected stack failure');};
 await assert.rejects(applyTextTransaction(h.workspace,h.edits(),h.dependencies),/injected stack/);h.undoRedo.pushElement=push;assert.deepEqual(h.values(),before);assert.deepEqual(h.resources.map(uri=>h.undoRedo.getElements(uri)),history);
 await h.undoRedo.redo(h.resources[0]);assert.deepEqual(h.values(),['doubleValue','doubleValue']);
});
test('generic workspace text edits support more than 128 resources and reject independent resource/text bounds without mutation',async t=>{
 const h=fixture(t,Array.from({length:130},()=> 'twice'));assert.equal((await applyTextTransaction(h.workspace,h.edits(),h.dependencies)).totalFiles,130);await h.undoRedo.undo(h.resources[129].toString());assert.equal(h.values().every(value=>value==='twice'),true);
 const negative=fixture(t,['twice','twice']),before=negative.values(),excessive=Array.from({length:2049},(_,index)=>({resource:URI.parse(`file:///extra/${index}.ts`),textEdit:{range:new Range(1,1,1,1),text:'x'}}));
 await assert.rejects(applyTextTransaction(negative.workspace,excessive,negative.dependencies),/2048 resources/);assert.deepEqual(negative.values(),before);assert.equal(negative.resources.every(uri=>!negative.undoRedo.getElements(uri).past.length),true);
 const large=fixture(t,['twice'+'x'.repeat(8*1024*1024),'twice']);await assert.rejects(applyTextTransaction(large.workspace,large.edits(),large.dependencies),/16 MiB/);assert.equal(large.resources.every(uri=>!large.undoRedo.getElements(uri).past.length),true);
});
test('prior typing closes only on successful commit; new typing after undo retires the entire workspace redo branch',async t=>{
 const h=fixture(t,['twice','twice']),first=h.models.get(h.resources[0].toString());
 first.pushEditOperations([],[{range:new Range(1,6,1,6),text:' old'}],()=>[]);
 const prior=h.undoRedo.getElements(h.resources[0]).past.at(-1),openData=prior._data;
 const push=h.undoRedo.pushElement.bind(h.undoRedo);h.undoRedo.pushElement=(...args)=>{push(...args);throw Error('boundary stack failure');};
 await assert.rejects(applyTextTransaction(h.workspace,h.edits(),h.dependencies),/boundary stack failure/);
 h.undoRedo.pushElement=push;assert.equal(prior._data,openData);assert.equal(prior.canAppend(first),true);assert.deepEqual(h.values(),['twice old','twice']);
 await applyTextTransaction(h.workspace,h.edits(),h.dependencies);assert.equal(prior.canAppend(first),false);
 await first.undo();assert.deepEqual(h.values(),['twice old','twice']);
 first.pushEditOperations([],[{range:new Range(1,10,1,10),text:' new'}],()=>[]);first.pushStackElement();
 assert.deepEqual(h.values(),['twice old new','twice']);assert.equal(h.resources.every(uri=>h.undoRedo.getElements(uri).future.length===0),true);
 await first.undo();assert.deepEqual(h.values(),['twice old','twice']);
 await first.undo();assert.deepEqual(h.values(),['twice','twice']);assert.deepEqual(h.warnings,[]);
});
test('closed UTF-8 BOM and UTF-16LE callers use retained text decoding before real ModelService hydration',async t=>{
 for(const encoding of ['utf8bom','utf16le']) {
  const h=fixture(t,['twice','twice\n中文🧩']),codec=new EncodingService(),bytes=new Map();
  const reference=h.workspace.textModelService.createModelReference;
  h.workspace.textModelService.createModelReference=async uri=>{const ref=await reference(uri);ref.object.getEncoding=()=>encoding;return ref;};
  const fileService={async read(uri,options){assert.equal(options.encoding,encoding);assert.equal(options.acceptTextOnly,true);const decoded=await codec.decodeStream(BinaryBufferReadableStream.fromBuffer(bytes.get(uri.toString())),{overwriteEncoding:()=>options.encoding});return{value:await consumeStream(decoded.stream,chunks=>chunks.join(''))};}};
  h.dependencies.readClosed=(uri,selected)=>readClosedDocument(fileService,uri,selected);
  await applyTextTransaction(h.workspace,h.edits(),h.dependencies);const after=h.values();h.close(h.resources[1]);
  bytes.set(h.resources[1].toString(),codec.encode(after[1],{encoding,hasBOM:true}));
  await h.undoRedo.undo(h.resources[0]);assert.deepEqual(h.values(),['twice','twice\n中文🧩']);
  await h.undoRedo.redo(h.resources[0]);assert.deepEqual(h.values(),after);h.close(h.resources[1]);
  bytes.set(h.resources[1].toString(),codec.encode('external replacement',{encoding,hasBOM:true}));const history=h.resources.map(uri=>h.undoRedo.getElements(uri));
  await h.undoRedo.undo(h.resources[0]);assert.equal(h.models.has(h.resources[1].toString()),false);assert.deepEqual(h.resources.map(uri=>h.undoRedo.getElements(uri)),history);assert.match(h.warnings.at(-1),/changed|unavailable/);
 }
});
test('failed workspace push restores the exact initial undo snapshot, including null, across real ModelService close/reopen',async t=>{
 for(const priorTyping of [false,true]) {
  const h=fixture(t,['twice','twice']),first=h.models.get(h.resources[0].toString());
  if(priorTyping)first.pushEditOperations([],[{range:new Range(1,6,1,6),text:' old'}],()=>[]);
  const snapshots=h.resources.map(uri=>h.models.get(uri.toString()).getInitialUndoRedoSnapshot()),before=h.values(),history=h.resources.map(uri=>h.undoRedo.getElements(uri));
  assert.equal(snapshots[0]===null,!priorTyping);assert.equal(snapshots[1],null);
  const push=h.undoRedo.pushElement.bind(h.undoRedo);h.undoRedo.pushElement=(...args)=>{push(...args);throw Error('snapshot stack failure');};
  await assert.rejects(applyTextTransaction(h.workspace,h.edits(),h.dependencies),/snapshot stack failure/);h.undoRedo.pushElement=push;
  for(let index=0;index<h.resources.length;index++)assert.equal(h.models.get(h.resources[index].toString()).getInitialUndoRedoSnapshot(),snapshots[index]);
  assert.deepEqual(h.values(),before);assert.deepEqual(h.resources.map(uri=>h.undoRedo.getElements(uri)),history);
  for(const uri of h.resources)h.close(uri);
  for(const uri of h.resources)await h.workspace.textModelService.createModelReference(uri);
  assert.deepEqual(h.values(),before);assert.deepEqual(h.resources.map(uri=>h.undoRedo.getElements(uri)),history);
  for(let index=0;index<h.resources.length;index++)assert.equal(h.models.get(h.resources[index].toString()).getInitialUndoRedoSnapshot(),snapshots[index]);
  if(priorTyping){await h.undoRedo.undo(h.resources[0]);assert.deepEqual(h.values(),['twice','twice']);await h.undoRedo.redo(h.resources[0]);assert.deepEqual(h.values(),before);}
  await applyTextTransaction(h.workspace,h.edits(),h.dependencies);const after=h.values();
  await h.undoRedo.undo(h.resources[1]);assert.deepEqual(h.values(),before);await h.undoRedo.redo(h.resources[0]);assert.deepEqual(h.values(),after);assert.deepEqual(h.warnings,[]);
 }
});

// Test-only native relocation: the production hook does not perform this work.
function migrateNative(h,oldUri,newUri){
 const oldKey=oldUri.toString(),newKey=newUri.toString(),oldModel=h.models.get(oldKey),snapshot=oldModel.getInitialUndoRedoSnapshot();
 const replacement=h.modelService.createModel(oldModel.getValue(undefined,true),'plaintext',newUri);
 replacement._overwriteVersionId(oldModel.getVersionId());replacement._overwriteAlternativeVersionId(oldModel.getAlternativeVersionId());
 if(snapshot){const moved=Object.create(Object.getPrototypeOf(snapshot));Object.assign(moved,snapshot,{resource:newUri});replacement._overwriteInitialUndoRedoSnapshot(moved);}
 const stack=h.undoRedo._editStacks.get(oldKey),seen=new Set();
 if(stack){h.undoRedo._editStacks.delete(oldKey);h.undoRedo._editStacks.set(newKey,stack);stack.strResource=newKey;stack.resourceLabel=newUri.fsPath;}
 for(const current of h.undoRedo._editStacks.values())for(const wrapper of [...current._past,...current._future]){
  if(seen.has(wrapper))continue;seen.add(wrapper);
  wrapper.strResources=wrapper.strResources.map(key=>key===oldKey?newKey:key);wrapper.resourceLabels=wrapper.resourceLabels.map((label,index)=>wrapper.strResources[index]===newKey?newUri.fsPath:label);
  if(wrapper.strResource===oldKey){wrapper.strResource=newKey;wrapper.resourceLabel=newUri.fsPath;}
  const actual=wrapper.actual;
  if(actual instanceof SingleModelEditStackElement){if(actual.model===oldModel||actual.model.toString()===oldKey)actual.setModel(replacement);}
  else if(actual instanceof MultiModelEditStackElement){const child=actual._editStackElementsMap.get(oldKey);if(child){actual._editStackElementsMap.delete(oldKey);actual._editStackElementsMap.set(newKey,child);child.setModel(replacement);}}
  for(const flag of [wrapper.removedResources,wrapper.invalidatedResources])if(flag?.elements.has(oldKey)){const entry=flag.elements.get(oldKey);flag.elements.delete(oldKey);entry.resourceLabel=newUri.fsPath;flag.elements.set(newKey,entry);}
 }
 h.models.set(newKey,replacement);h.models.delete(oldKey);h.modelService.destroyModel(oldUri);
 const index=h.resources.findIndex(uri=>uri.toString()===oldKey);h.resources[index]=newUri;h.disk.set(newKey,h.disk.get(oldKey));h.disk.delete(oldKey);return replacement;
}
test('explicit relocation preserves old typing, owned workspace history, closed restore, inverse migration and unrelated history',async t=>{
 const h=fixture(t,['twice','twice','unrelated']),oldUri=h.resources[0],first=h.models.get(oldUri.toString()),unrelated=h.models.get(h.resources[2].toString());
 first.pushEditOperations([],[{range:new Range(1,6,1,6),text:' old'}],()=>[]);unrelated.pushEditOperations([],[{range:new Range(1,10,1,10),text:' user'}],()=>[]);const unrelatedHistory=h.undoRedo.getElements(unrelated.uri);
 await applyTextTransaction(h.workspace,h.edits().slice(0,2),h.dependencies);const after=h.values(),element=h.undoRedo.getElements(oldUri).past.at(-1),newUri=URI.parse('file:///owned/renamed.sol'),replacement=migrateNative(h,oldUri,newUri);
 const relocation=relocateResources(h.undoRedo,[{oldResource:oldUri,newResource:newUri,model:replacement}]);assert.equal(relocation.recordsChanged,1);assert.equal(h.disk.get(newUri.toString()),'twice');
 await replacement.undo();assert.deepEqual(h.values(),['twice old','twice','unrelated user']);await replacement.undo();assert.deepEqual(h.values(),['twice','twice','unrelated user']);await replacement.redo();await replacement.redo();assert.deepEqual(h.values(),after);
 h.close(newUri);h.close(h.resources[1]);await h.undoRedo.undo(newUri);assert.deepEqual(h.values(),['twice old','twice','unrelated user']);await h.undoRedo.redo(newUri);assert.deepEqual(h.values(),after);
 // Closing/reopening changed the bound model, so the original immediate
 // rollback token is stale. A later inverse migration is a fresh operation.
 assert.throws(()=>relocation.rollback(),/changed before rollback/);
 const restored=migrateNative(h,newUri,oldUri);relocateResources(h.undoRedo,[{oldResource:newUri,newResource:oldUri,model:restored}]);await restored.undo();assert.deepEqual(h.values(),['twice old','twice','unrelated user']);await restored.redo();assert.deepEqual(h.values(),after);
 assert.deepEqual(h.undoRedo.getElements(unrelated.uri),unrelatedHistory);assert.deepEqual(h.warnings,[]);
});
test('directory leaf relocation updates past and future owned records, including closed models',async t=>{
 const h=fixture(t,['twice','twice']);await applyTextTransaction(h.workspace,h.edits(),h.dependencies);await h.undoRedo.undo(h.resources[0]);const old=h.resources.slice(),mappings=[];
 for(let index=0;index<old.length;index++){const next=URI.parse(`file:///owned/moved/${index}.sol`);migrateNative(h,old[index],next);h.close(next);mappings.push({oldResource:old[index],newResource:next});}
 const moved=relocateResources(h.undoRedo,mappings);assert.equal(moved.recordsChanged,2);await h.undoRedo.redo(h.resources[1]);assert.deepEqual(h.values(),['doubleValue','doubleValue']);await h.undoRedo.undo(h.resources[0]);assert.deepEqual(h.values(),['twice','twice']);assert.deepEqual(h.warnings,[]);
});
test('relocation validates the entire batch before changing records and refuses busy, collisions and mismatched model identities',async t=>{
 const h=fixture(t,['twice','twice']);await applyTextTransaction(h.workspace,h.edits(),h.dependencies);const element=h.undoRedo.getElements(h.resources[0]).past.at(-1),transaction=element[Symbol.for('ynx.workspace-text-transaction.v1')],old=h.resources[0],next=URI.parse('file:///owned/moved.sol'),model=migrateNative(h,old,next),before=transaction.records.map(row=>({resource:row.resource,model:row.model})),mapping={oldResource:old,newResource:next,model};
 for(const invalid of [[mapping,{oldResource:h.resources[1],newResource:next}], [{...mapping,model:h.models.get(h.resources[1].toString())}], [{...mapping,model:{uri:next,isDisposed:()=>false}}], [{oldResource:old,newResource:next}], [{oldResource:old,newResource:h.resources[1],model:h.models.get(h.resources[1].toString())}]]){assert.throws(()=>relocateResources(h.undoRedo,invalid),/duplicate|match|collid|rekeyed/);assert.deepEqual(transaction.records.map(row=>({resource:row.resource,model:row.model})),before);}
 transaction.busy=true;assert.throws(()=>relocateResources(h.undoRedo,[mapping]),/busy/);transaction.busy=false;assert.deepEqual(transaction.records.map(row=>({resource:row.resource,model:row.model})),before);
 const key=h.undoRedo.getUriComparisonKey.bind(h.undoRedo);h.undoRedo.getUriComparisonKey=uri=>uri.toString()===next.toString()?old.toString():key(uri);assert.throws(()=>relocateResources(h.undoRedo,[mapping]),/alias/);h.undoRedo.getUriComparisonKey=key;assert.deepEqual(transaction.records.map(row=>({resource:row.resource,model:row.model})),before);
 const move=relocateResources(h.undoRedo,[mapping]);transaction.busy=true;assert.throws(()=>move.rollback(),/busy/);transaction.busy=false;assert.equal(transaction.records[0].resource,next);move.rollback();assert.deepEqual(transaction.records.map(row=>({resource:row.resource,model:row.model})),before);
});
test('relocated transactions still refuse later user typing and recover only after that native typing is undone',async t=>{
 const h=fixture(t,['twice','twice']);await applyTextTransaction(h.workspace,h.edits(),h.dependencies);const old=h.resources[0],next=URI.parse('file:///owned/moved.sol'),model=migrateNative(h,old,next);relocateResources(h.undoRedo,[{oldResource:old,newResource:next,model}]);
 model.pushStackElement();model.pushEditOperations([],[{range:new Range(1,12,1,12),text:' user'}],()=>[]);model.pushStackElement();const before=h.values(),history=h.resources.map(uri=>h.undoRedo.getElements(uri));await h.undoRedo.undo(h.resources[1]);assert.deepEqual(h.values(),before);assert.deepEqual(h.resources.map(uri=>h.undoRedo.getElements(uri)),history);assert.match(h.warnings.at(-1),/later edits/);await model.undo();await h.undoRedo.undo(h.resources[1]);assert.deepEqual(h.values(),['twice','twice']);
});
test('relocation updates every marked past and future element sharing a source URI',async t=>{
 const h=fixture(t,['twice','twice']);await applyTextTransaction(h.workspace,h.edits(),h.dependencies);
 const second=h.resources.map(uri=>({resource:uri,textEdit:{range:new Range(1,1,1,12),text:'tripleValue'}}));await applyTextTransaction(h.workspace,second,h.dependencies);await h.undoRedo.undo(h.resources[0]);
 const old=h.resources[0],next=URI.parse('file:///owned/shared-history.sol'),model=migrateNative(h,old,next),result=relocateResources(h.undoRedo,[{oldResource:old,newResource:next,model}]);assert.equal(result.recordsChanged,2);assert.equal(result.elementsChanged,2);
 await model.redo();assert.deepEqual(h.values(),['tripleValue','tripleValue']);await model.undo();assert.deepEqual(h.values(),['doubleValue','doubleValue']);await model.undo();assert.deepEqual(h.values(),['twice','twice']);await model.redo();await model.redo();assert.deepEqual(h.values(),['tripleValue','tripleValue']);assert.deepEqual(h.warnings,[]);
});
