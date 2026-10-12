import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,writeFile,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createChainReader,CHAIN_PROTOCOL} from '../../chain-service/src/chain-reader.mjs';
const require=createRequire(import.meta.url);
const {createChainProject,projectConfiguration}=require('../../../native/ynx-tools/src/chain-project.cjs');
const {createChainProjectUI,CHAIN_PROJECT_TRANSLATIONS}=require('../../../native/ynx-tools/src/chain-project-ui.cjs');
const hash='0x'+'a'.repeat(64),account='0x'+'b'.repeat(40);
const status={chainId:'6423',nativeCurrencySymbol:'YNXT',network:'YNX Testnet',publicNetwork:true,height:'125'};
async function fixture(t,options={}) {
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-chain-project-中文 ')));t.after(()=>rm(root,{recursive:true,force:true}));
 const environment={YNX_WORKSPACE_MODE:'local',YNX_LOCAL_PROJECT_ID:'d964be82-5584-403b-900a-185cd5d940eb',YNX_LOCAL_WORKSPACE:root};
 const vscode={workspace:{isTrusted:true,textDocuments:[],workspaceFolders:[{uri:{scheme:'file',fsPath:root,toString:()=> 'file://'+root}}]}};
 const calls=[];let current=true;
 // Exercise the actual shared reader with deterministic transport responses.
 // This is neither canonical admission nor a live network/deployment proof.
 const reader=createChainReader(async(path,request)=>{calls.push({path,request});await options.onRequest?.(path);if(path==='/status')return {protocolVersion:CHAIN_PROTOCOL,status:options.status||status};if(path==='/compiler')return {protocolVersion:CHAIN_PROTOCOL,compiler:{runtimeMode:'bounded-contract',limitations:['No full EVM claim'],compilerVersion:'owner-version'}};
  if(path==='/rpc')return {protocolVersion:CHAIN_PROTOCOL,method:JSON.parse(request.body).method,result:null};
  if(path.startsWith('/transactions/'))return {protocolVersion:CHAIN_PROTOCOL,hash,record:null,transaction:null,receipt:options.receipt||null,confirmed:Boolean(options.receipt)};throw Error('unexpected path');});
 const provider=async scope=>({protocolVersion:CHAIN_PROTOCOL,...scope,service:'https://developer.ynxweb4.com/runtime/chain',sourceVersion:'controlled-test-contract',reader,
   assertCurrent:()=>{if(!current)throw Error('revoked');return options.assertionReturn;}});
 const project=createChainProject(vscode,environment,options.unconnected?{}:{connectionForProject:provider});
 return {root,environment,vscode,project,calls,reader,provider,revoke(){current=false;},async configure(){await project.configure('testnet');}};
}
test('normal project configuration is portable public data, preserved on reopen and never creates a connection',async t=>{
 const h=await fixture(t,{unconnected:true});const created=await h.project.configure('testnet');assert.equal(created.created,true);assert.equal(created.configuration.network.chainId,6423);
 const bytes=await readFile(join(h.root,'ynx-chain-project.json'),'utf8');assert.doesNotMatch(bytes,/token|secret|session|privateKey/);assert.equal(JSON.parse(bytes).network.endpoints.explorer,null);
 const reopened=createChainProject(h.vscode,h.environment);assert.equal((await reopened.configure('local')).created,false);assert.equal(await readFile(join(h.root,'ynx-chain-project.json'),'utf8'),bytes);
 await assert.rejects(reopened.query({kind:'status'},()=>true),error=>error.code==='chain_admission_unavailable');assert.equal(h.calls.length,0);assert.deepEqual(await reopened.history(),[]);
});
test('actual shared reader validates identity, preserves capability limitations and unknown balance, saves bounded project observations',async t=>{
 const h=await fixture(t);await h.configure();const result=await h.project.query({kind:'compiler'},()=>true);assert.equal(result.evidence.runtimeMode,'bounded-contract');assert.deepEqual(result.evidence.limitations,['No full EVM claim']);assert.equal(result.submittedByIDE,false);assert.equal(result.source.protocolVersion,CHAIN_PROTOCOL);
 const balance=await h.project.query({kind:'balance',address:account},()=>true);assert.equal(balance.evidence.value,null);assert.equal(balance.evidence.symbol,'YNXT');assert.equal((await h.project.history()).length,2);
 const reopened=createChainProject(h.vscode,h.environment,{connectionForProject:h.provider});assert.equal((await reopened.history())[0].workspace,h.root);assert.equal((await reopened.history())[0].projectId,h.environment.YNX_LOCAL_PROJECT_ID);
});
test('hash tracking is only an editable query association; reopen can query same hash without any submit path',async t=>{
 const h=await fixture(t);await h.configure();const tracked=await h.project.trackTransaction(hash);assert.equal(tracked.evidence,null);assert.equal(tracked.source.verified,false);assert.equal(h.calls.length,0);
 const reopened=createChainProject(h.vscode,h.environment,{connectionForProject:h.provider});const saved=(await reopened.history())[0];const observed=await reopened.query(saved.operation,()=>true);
 assert.equal(observed.evidence.confirmed,false);assert.equal(observed.evidence.receipt,null);assert.ok(h.calls.every(call=>call.path==='/status'||call.path==='/transactions/'+hash));assert.equal((await reopened.history()).length,2);
});
test('failed confirmed receipt stays failed, without inferred indexing or source verification',async t=>{
 const h=await fixture(t,{receipt:{transactionHash:hash,blockNumber:'0x1',status:'0x0'}});await h.configure();const result=await h.project.query({kind:'transaction',hash},()=>true);
 assert.equal(result.evidence.confirmed,true);assert.equal(result.evidence.receipt.status,'0x0');assert.equal(result.evidence.indexed,undefined);assert.equal(result.evidence.sourceVerified,undefined);
});
test('no approval, unsupported write methods and wrong chain never create successful records',async t=>{
 const h=await fixture(t);await h.configure();assert.equal(await h.project.query({kind:'status'},()=>false),null);assert.equal(h.calls.length,0);
 await assert.rejects(h.project.query({kind:'eth_sendRawTransaction'},()=>true),error=>error.code==='chain_action_invalid');
 const wrong=await fixture(t,{status:{...status,chainId:1}});await wrong.configure();await assert.rejects(wrong.project.query({kind:'status'},()=>true),error=>error.code==='chain_identity_mismatch');assert.deepEqual(await wrong.project.history(),[]);
});
test('project JSON cannot inject reader/URL/credentials; root and saved record mismatch preserve files',async t=>{
 const h=await fixture(t,{unconnected:true});await h.configure();const file=join(h.root,'ynx-chain-project.json');const invalid={...projectConfiguration('testnet'),connectionForProject:'fake',token:'not-a-real-token'};await writeFile(file,JSON.stringify(invalid));
 await assert.rejects(h.project.query({kind:'status'},()=>true),error=>error.code==='chain_configuration_invalid');assert.equal(h.calls.length,0);assert.deepEqual(JSON.parse(await readFile(file,'utf8')),invalid);
 const other=await fixture(t);await other.project.trackTransaction(hash);const historyFile=join(other.root,'.ynx','chain-history',(await readdir(join(other.root,'.ynx','chain-history')))[0]);const original=JSON.parse(await readFile(historyFile,'utf8'));await writeFile(historyFile,JSON.stringify({...original,projectId:h.environment.YNX_LOCAL_PROJECT_ID,workspace:h.root}));await assert.rejects(other.project.history(),error=>error.code==='chain_history_project_mismatch');assert.equal(JSON.parse(await readFile(historyFile,'utf8')).workspace,h.root);
});
test('trust, configuration and admission changes during approval refuse all network reads and history writes',async t=>{
 const trust=await fixture(t);await trust.configure();await assert.rejects(trust.project.query({kind:'status'},()=>{trust.vscode.workspace.isTrusted=false;return true;}),error=>error.code==='chain_project_untrusted');assert.equal(trust.calls.length,0);
 const changed=await fixture(t);await changed.configure();await assert.rejects(changed.project.query({kind:'status'},async()=>{await writeFile(join(changed.root,'ynx-chain-project.json'),JSON.stringify(projectConfiguration('local')));return true;}),error=>error.code==='chain_configuration_changed');assert.equal(changed.calls.length,0);
 const nullAssertion=await fixture(t,{assertionReturn:null});await nullAssertion.configure();await assert.rejects(nullAssertion.project.query({kind:'status'},()=>true),error=>error.code==='chain_identity_changed');assert.equal(nullAssertion.calls.length,0);
 const runtime=await fixture(t);await runtime.configure();await assert.rejects(runtime.project.query({kind:'status'},()=>{runtime.environment.YNX_LOCAL_PROJECT_ID='00000000-0000-0000-0000-000000000000';return true;}),error=>error.code==='chain_project_changed');assert.equal(runtime.calls.length,0);
});
test('cancellation during pending reader settles locally, saves nothing and permits retry',async t=>{
 let release,stall=true;const h=await fixture(t,{onRequest:path=>path==='/status'&&stall?new Promise(resolve=>release=resolve):undefined});await h.configure();const abort=new AbortController();const running=h.project.query({kind:'status'},()=>true,{signal:abort.signal});
 while(!release)await new Promise(resolve=>setTimeout(resolve,1));abort.abort();await assert.rejects(running,error=>error.code==='chain_read_cancelled');assert.deepEqual(await h.project.history(),[]);stall=false;release();await h.project.query({kind:'status'},()=>true);assert.equal((await h.project.history()).length,1);
});
test('symlink storage and damaged data are preserved and refused',async t=>{
 const h=await fixture(t);const outside=await fixture(t);await symlink(outside.root,join(h.root,'.ynx'));await assert.rejects(h.project.trackTransaction(hash),error=>error.code==='chain_storage_path_invalid');assert.deepEqual(await readdir(outside.root),[]);
 const broken=await fixture(t);const file=join(broken.root,'ynx-chain-project.json');await writeFile(file,'{broken');await assert.rejects(broken.project.configuration(),error=>error.code==='chain_storage_invalid');assert.equal(await readFile(file,'utf8'),'{broken');
});
test('mismatched trusted bridge binding and unsaved configuration refuse before any chain read',async t=>{
 const h=await fixture(t);await h.configure();
 const wrong=createChainProject(h.vscode,h.environment,{connectionForProject:async scope=>({...await h.provider(scope),projectId:'00000000-0000-0000-0000-000000000000'})});
 await assert.rejects(wrong.query({kind:'status'},()=>true),error=>error.code==='chain_admission_mismatch');assert.equal(h.calls.length,0);
 h.vscode.workspace.textDocuments.push({isClosed:false,isDirty:true,uri:{scheme:'file',fsPath:join(h.root,'ynx-chain-project.json')}});
 await assert.rejects(h.project.query({kind:'status'},()=>true),error=>error.code==='chain_configuration_open');assert.equal(h.calls.length,0);
});
test('native UI creates actual configuration, remembers references and displays saved evidence in Chinese without web pages',async t=>{
 const h=await fixture(t,{unconnected:true}),errors=[],shown=[],messages=[];let menu=[];const contents=new Map();
 const tfn=(key,...args)=>(CHAIN_PROJECT_TRANSLATIONS[key]||key).replace(/\{(\d+)\}/g,(_,index)=>args[index]);
 h.vscode.Uri={file:file=>({scheme:'file',fsPath:file,toString:()=> 'file://'+file}),parse:value=>({toString:()=>value})};h.vscode.ProgressLocation={Notification:15};
 h.vscode.workspace.registerTextDocumentContentProvider=(scheme,provider)=>{contents.set(scheme,provider);return {dispose(){}};};
 h.vscode.workspace.openTextDocument=async uri=>({uri,getText:()=>uri.fsPath?'configuration':contents.get('ynx-chain-observation').provideTextDocumentContent(uri)});
 h.vscode.window={};
 h.vscode.window.showQuickPick=async items=>{const key=menu.shift();return items.find(item=>item.action===key||item.environment===key)||items[key];};
 h.vscode.window.showInformationMessage=async(message,options,button)=>{messages.push(message);return button;};h.vscode.window.showWarningMessage=async(message,options,button)=>button;h.vscode.window.showInputBox=async()=>hash;
 h.vscode.window.showTextDocument=async doc=>shown.push(doc);h.vscode.window.showErrorMessage=message=>errors.push(message);
 h.vscode.window.withProgress=async(options,action)=>action({}, {onCancellationRequested:()=>({dispose(){}}),isCancellationRequested:false});
 const ui=createChainProjectUI(h.vscode,{subscriptions:[]},h.environment,tfn);menu=['testnet'];await ui.configure();assert.equal(JSON.parse(await readFile(join(h.root,'ynx-chain-project.json'),'utf8')).network.chainId,6423);
 await ui.track();assert.match(shown.at(-1).getText(),/仅记录|查询引用/);assert.equal(shown.at(-1).uri.toString().startsWith('ynx-chain-observation:'),true);
 menu=[0,'open'];await ui.saved();assert.match(shown.at(-1).getText(),/不是当前链状态证明/);
 menu=['status'];await ui.open();assert.match(errors.at(-1),/尚未接通/);assert.equal(h.calls.length,0);assert.equal((await h.project.history()).length,1);
});
