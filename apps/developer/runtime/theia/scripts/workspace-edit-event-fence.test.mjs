import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),{begin}=require('../../ynx-workbench/lib/workspace-edit-event-fence.js');
// Reuse the retained Theia document/ReferenceCollection/Monaco fixture without
// replacing any document sync/save/dirty/native history methods.
const fixtureURL=new URL('./workspace-model-relocation.test.mjs',import.meta.url),runtime=new URL('../node_modules/',import.meta.url).href;
let source=readFileSync(fixtureURL,'utf8');source=source.slice(0,source.indexOf("test('real Theia"));source=source.replaceAll("from '../node_modules/",`from '${runtime}`).replace('createRequire(import.meta.url)',`createRequire(${JSON.stringify(fixtureURL.href)})`);source+='\nexport {fixture,URI,Range};';
const {fixture,URI,Range}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function saveResource(h,document){document.resource.saveContents=async content=>{h.disk.set(document.uri,content);};}
test('real document sync and save wait for release while unrelated dirty/save/history remain normal',async t=>{
 const h=await fixture(t);saveResource(h,h.a);saveResource(h,h.other);h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' user'}],()=>[]);h.other.textEditorModel.pushEditOperations([],[{range:new Range(1,10,1,10),text:' other'}],()=>[]);
 const sync=h.a.sync,save=h.a.scheduleSave,errors=[],fence=await begin({affectedResources:[URI.parse(h.a.uri)],documents:[h.a,h.other],onError:error=>errors.push(error)});
 let settled=false;const pending=h.a.save().then(()=>{settled=true;});await h.other.save();assert.equal(h.disk.get(h.other.uri),'unchanged other');assert.equal(h.other.dirty,false);assert.equal(h.disk.get(h.a.uri),'twice');assert.equal(h.a.dirty,true);assert.equal(settled,false);
 h.disk.set(h.a.uri,'external watch');const watched=h.a.sync();await fence.release();await pending;await watched;assert.equal(h.disk.get(h.a.uri),'twice user');assert.equal(h.a.dirty,false);assert.equal(h.a.sync,sync);assert.equal(h.a.scheduleSave,save);await h.other.textEditorModel.undo();assert.equal(h.other.getText(),'unchanged');assert.deepEqual(errors,[]);
});
test('watch sync re-reads final resource state and never replays stale data over a dirty model; owned buffer writes are explicit',async t=>{
 const h=await fixture(t),fence=await begin({affectedResources:[URI.parse(h.a.uri)],documents:[h.a]});h.disk.set(h.a.uri,'stale disk');const sync=h.a.sync();h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' user'}],()=>[]);h.a.updateModel(()=>h.a.textEditorModel.setValue('stale queued'),{ignoreDirty:true});assert.equal(h.a.getText(),'twice user');
 fence.runOwned(()=>h.a.updateModel(()=>h.a.textEditorModel.applyEdits([{range:new Range(1,1,1,1),text:'owned '}]),{ignoreDirty:true}));assert.equal(h.a.getText(),'owned twice user');assert.throws(()=>fence.runOwned(async()=>{}),/synchronous/);await fence.release();await sync;assert.equal(h.a.getText(),'owned twice user');assert.equal(h.a.dirty,true);
});
test('queued manual save errors preserve dirty contents and all methods are restored even when release callbacks fail',async t=>{
 const h=await fixture(t);h.a.resource.saveContents=async()=>{throw Error('real Resource save failed');};h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' user'}],()=>[]);const errors=[],original=h.a.scheduleSave,fence=await begin({affectedResources:[URI.parse(h.a.uri)],documents:[h.a],onError:error=>errors.push(error)}),saved=h.a.save();
 // Native MonacoEditorModel.run handles its real save error and retains dirty.
 const previous=console.error;console.error=()=>{};try{await fence.release();await saved;}finally{console.error=previous;}assert.equal(h.a.getText(),'twice user');assert.equal(h.a.dirty,true);assert.equal(h.a.scheduleSave,original);assert.equal(h.disk.get(h.a.uri),'twice');
});
test('workspace lifecycle and default move handling are fenced only for affected owned operations',async t=>{
 const h=await fixture(t),calls=[],workspace={fireDidOpen:doc=>calls.push(['open',doc.uri]),fireDidClose:doc=>calls.push(['close',doc.uri]),openEditorIfDirty:doc=>calls.push(['dirty',doc.uri])},contribution={pushMove:async uri=>calls.push(['will',uri.toString()]),applyMove:async uri=>calls.push(['did',uri.toString()]),revertMove:async uri=>calls.push(['fail',uri.toString()]),updateWidget:uri=>calls.push(['watch',uri.toString()])},uri=URI.parse(h.a.uri),other=URI.parse(h.other.uri);
 const fence=await begin({affectedResources:[uri],documents:[h.a],workspace,fileSystemContribution:contribution,isOwnedOperation:event=>event.transaction==='ours'});workspace.fireDidOpen(h.a);workspace.fireDidOpen(h.other);await contribution.pushMove(uri,{}, {source:uri,transaction:'ours'});await contribution.applyMove(other,{}, {source:other,transaction:'ours'});await contribution.pushMove(uri,{}, {source:uri,transaction:'external'});contribution.updateWidget(uri,{},{});assert.deepEqual(calls,[['open',h.other.uri],['did',h.other.uri],['will',h.a.uri]]);
 const published=[];await fence.release({outcome:'commit',publishLifecycle:item=>published.push(item.kind)});assert.deepEqual(published,['fireDidOpen','watch']);assert.equal(calls.length,3);await contribution.pushMove(uri,{}, {source:uri,transaction:'ours'});assert.equal(calls.length,4);
});
test('retained filesystem pushMove actually soft-reverts dirty documents without a fence, but owned fenced moves preserve them',async t=>{
 const h=await fixture(t);h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' user'}],()=>[]);const retained=readFileSync(require.resolve('../node_modules/@theia/filesystem/lib/browser/filesystem-frontend-contribution.js'),'utf8'),method=retained.slice(retained.indexOf('    async pushMove('),retained.indexOf('    async revertMove('));
 const Contract=runInNewContext(`(class {${method}})`,{browser_1:{Saveable:{get:widget=>widget.document},StatefulWidget:{is:()=>false}}});const contribution=new Contract();contribution.moveSnapshots=new Map();contribution.createMoveToUri=()=>URI.parse('file:///owned/moved.sol');contribution.applyMove=async()=>{};contribution.revertMove=async()=>{};contribution.updateWidget=()=>{};const uri=URI.parse(h.a.uri),event={source:uri,target:URI.parse('file:///owned/moved.sol'),transaction:'ours'};
 const fence=await begin({affectedResources:[uri],documents:[h.a],fileSystemContribution:contribution,isOwnedOperation:e=>e.transaction==='ours'});await contribution.pushMove(uri,{document:h.a},event);assert.equal(h.a.dirty,true);assert.equal(h.a.getText(),'twice user');assert.equal(contribution.moveSnapshots.size,0);await fence.release();await contribution.pushMove(uri,{document:h.a},event);assert.equal(h.a.dirty,false);assert.equal(h.a.getText(),'twice user');assert.equal(contribution.moveSnapshots.size,1);
});
test('release restores methods in finally and publishes preexisting document close even after its disposal',async t=>{
 const h=await fixture(t),seen=[],workspace={fireDidOpen:()=>{},fireDidClose:doc=>seen.push(doc.uri),openEditorIfDirty:()=>{}},fence=await begin({affectedResources:[URI.parse(h.a.uri)],documents:[h.a],workspace});workspace.fireDidClose(h.a);h.refs[0].dispose();assert.equal(h.a.isDisposed(),true);await fence.release({outcome:'commit',publishLifecycle:item=>item.invoke()});assert.deepEqual(seen,['file:///owned/A.sol']);
});
test('real ReferenceCollection created targets join the fence while ordinary existing document saves remain immediate',async t=>{
 const h=await fixture(t),target=URI.parse('file:///owned/New.sol');h.disk.set(target.toString(),'new');h.service.onDidCreate=h.collection.onDidCreate;saveResource(h,h.other);
 const fence=await begin({affectedResources:[target],textModelService:h.service,documents:[h.other]}),ref=await h.service.createModelReference(target),doc=ref.object;saveResource(h,doc);doc.textEditorModel.pushEditOperations([],[{range:new Range(1,4,1,4),text:' user'}],()=>[]);const saved=doc.save();
 h.other.textEditorModel.pushEditOperations([],[{range:new Range(1,10,1,10),text:' now'}],()=>[]);await h.other.save();assert.equal(h.disk.get(h.other.uri),'unchanged now');assert.equal(h.disk.get(doc.uri),'new');await fence.release();await saved;assert.equal(h.disk.get(doc.uri),'new user');assert.equal(doc.dirty,false);ref.dispose();
});
test('a failed lifecycle publisher cannot retain the fence or discard dirty document contents',async t=>{
 const h=await fixture(t),errors=[],original=h.a.sync,workspace={fireDidOpen:()=>{},fireDidClose:()=>{},openEditorIfDirty:()=>{}},fence=await begin({affectedResources:[URI.parse(h.a.uri)],documents:[h.a],workspace,onError:error=>errors.push(error)});h.a.textEditorModel.pushEditOperations([],[{range:new Range(1,6,1,6),text:' user'}],()=>[]);workspace.fireDidOpen(h.a);await assert.rejects(fence.release({outcome:'commit',publishLifecycle(){throw Error('publisher failed');}}),/publisher failed/);assert.equal(h.a.sync,original);assert.equal(h.a.dirty,true);assert.equal(h.a.getText(),'twice user');assert.match(errors[0].message,/publisher failed/);
});
