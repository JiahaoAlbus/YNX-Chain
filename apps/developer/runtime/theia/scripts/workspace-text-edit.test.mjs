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
const require = createRequire(import.meta.url), { applyTextTransaction, assertSupported, readClosedDocument } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js');
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
 return {workspace,dependencies,models,undoRedo,warnings,resources,edits,values,save,close,disk};
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
