import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
const {registerChainResultsView}=require('./chain-results-view.cjs');
const {createChainProjectUI}=require('./chain-project-ui.cjs');
function fixture(load) {
 const commands=new Map(),context={subscriptions:[]};let provider;
 class EventEmitter { event=()=>({dispose(){}}); fire(){} dispose(){} }
 const view=registerChainResultsView({EventEmitter,window:{registerTreeDataProvider(id,p){assert.equal(id,'ynx.chainResults');provider=p;return{dispose(){}};}},commands:{registerCommand(id,callback){commands.set(id,callback);return{dispose(){commands.delete(id);}};}}},context,{load,open:reference=>reference});
 return {provider,commands,view,dispose(){context.subscriptions.forEach(row=>row.dispose());}};
}
const record={id:'a0a0a0a0-0000-0000-0000-000000000001',projectId:'a0a0a0a0-0000-0000-0000-000000000002',workspace:'/QA',savedAt:'2026-10-11T00:00:00.000Z',operation:{kind:'transaction',hash:'0x'+'a'.repeat(64)},evidence:null};
test('saved reference is labeled without execution proof and commands carry only a scoped locator',async()=>{
 const f=fixture(async()=>[record]);const rows=await f.provider.getChildren();assert.match(rows[0].description,/no chain evidence/);
 const item=f.provider.getTreeItem(rows[0]);assert.deepEqual(item.command.arguments,[{id:record.id,projectId:record.projectId,workspace:record.workspace}]);
 assert.equal(item.command.command,'ynx.chainResults.open');assert.equal(await f.provider.getChildren(rows[0]).then(rows=>rows.length),0);f.dispose();
});
test('refresh and disposal retire in-flight history responses',async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;}));let pending=f.provider.getChildren();f.view.refresh();release([record]);assert.deepEqual(await pending,[]);
 pending=f.provider.getChildren();f.dispose();release([record]);assert.deepEqual(await pending,[]);assert.deepEqual(await f.provider.getChildren(),[]);
});
test('failure remains distinct from empty history and raw errors never enter tree labels',async()=>{
 const failed=fixture(async()=>{throw Error('/private/credential transport header');});const rows=await failed.provider.getChildren();assert.match(rows[0].label,/failed/);assert.doesNotMatch(JSON.stringify(rows),/credential|header/);assert.equal(failed.provider.getTreeItem(rows[0]).command,undefined);failed.dispose();
 const empty=fixture(async()=>[]);assert.match((await empty.provider.getChildren())[0].label,/No saved/);empty.dispose();
});
test('opening an observation reloads current-project disk evidence and rejects foreign or removed records',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-chain-results-')));const directory=join(root,'.ynx','chain-history');await mkdir(directory,{recursive:true});
 const saved={schemaVersion:1,...record,workspace:root,source:{kind:'user-supplied-query-reference',verified:false},submittedByIDE:false};const file=join(directory,record.id+'.json');await writeFile(file,JSON.stringify(saved));
 const context={subscriptions:[]},shown=[],errors=[];
 const uri={scheme:'file',fsPath:root,toString:()=>root};
 const vscode={Uri:{parse:value=>({toString:()=>value})},workspace:{workspaceFolders:[{uri}],textDocuments:[],isTrusted:true,registerTextDocumentContentProvider(){return{dispose(){}};},openTextDocument:async uri=>uri},window:{showTextDocument:async doc=>shown.push(doc),showErrorMessage:message=>errors.push(message)}};
 const environment={YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:root,YNX_LOCAL_PROJECT_ID:record.projectId};
 try {
  const ui=createChainProjectUI(vscode,context,environment,text=>text);
  await ui.openObservation({...record,workspace:root,projectId:'foreign'});assert.equal(shown.length,0);assert.equal(errors.length,1);
  await ui.openObservation({id:record.id,projectId:record.projectId,workspace:root,evidence:{fake:'cannot inject'}});assert.equal(shown.length,1);
  await rm(file);await ui.openObservation({id:record.id,projectId:record.projectId,workspace:root});assert.equal(shown.length,1);
  environment.YNX_LOCAL_PROJECT_ID='a0a0a0a0-0000-0000-0000-000000000099';await ui.openObservation({id:record.id,projectId:record.projectId,workspace:root});assert.equal(shown.length,1);
 } finally {context.subscriptions.forEach(row=>row.dispose());await rm(root,{recursive:true,force:true});}
});

test('host folder changes invalidate pending results and distinct observations retain stable scoped IDs',async()=>{
 let changed,release,provider;const commands=new Map(),context={subscriptions:[]};let unregistered=false;
 class EventEmitter {event=()=>({dispose(){}});fire(){}dispose(){}}
 registerChainResultsView({EventEmitter,workspace:{onDidChangeWorkspaceFolders(callback){changed=callback;return{dispose(){unregistered=true;}};}},window:{registerTreeDataProvider(id,value){provider=value;return{dispose(){}};}},commands:{registerCommand(id,callback){commands.set(id,callback);return{dispose(){}};}}},context,{load:()=>new Promise(resolve=>{release=resolve;}),open:()=>{}});
 const pending=provider.getChildren();changed();release([record]);assert.deepEqual(await pending,[]);
 const next=provider.getChildren();release([record,{...record,id:'a0a0a0a0-0000-0000-0000-000000000003'}]);const rows=await next;const ids=rows.map(row=>provider.getTreeItem(row).id);assert.equal(new Set(ids).size,2);assert.ok(ids.every(id=>id.startsWith(record.projectId+':')));
 context.subscriptions.forEach(row=>row.dispose());assert.equal(unregistered,true);
});
