import test from 'node:test';import assert from'node:assert/strict';import vm from'node:vm';import fs from'node:fs/promises';
const source=await fs.readFile(new URL('../runtime/ynx-workbench/lib/contract-deployment-view.js',import.meta.url),'utf8'),tick=()=>new Promise(resolve=>setImmediate(resolve));
class Node{constructor(document,tag){this.ownerDocument=document;this.tag=tag;this.children=[];this.listeners=new Map();}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(){}addEventListener(event,fn){this.listeners.set(event,fn);}click(){if(!this.disabled)this.listeners.get('click')?.();}}
const document={createElement:tag=>new Node(document,tag)};class Widget{constructor(){this.node=new Node(document,'root');this.title={};this.toDispose=[];}dispose(){for(const item of this.toDispose)item.dispose();}}
const loaded={exports:{}};vm.runInNewContext(source,{module:loaded,require:name=>name==='@theia/core/lib/browser/widgets'?{BaseWidget:Widget}:{CommonMenus:{VIEW_VIEWS:[]}}});
const referenceId='11111111-2222-3333-4444-555555555555',broadcastReferenceId='22222222-2222-3333-4444-555555555555';
function fixture(override,translate=(_key,text)=>text){const calls=[],files=['file:///PUBLIC/Counter.sol','file:///PUBLIC/Counter.json','file:///PUBLIC/build.json'],widget=new loaded.exports.ContractDeploymentWidget({call:async(action,body)=>{calls.push({action,body});if(override)return override(action,body);if(action==='inspect')return{onlineConfigured:true};if(action==='deployment-preview')return{draftId:referenceId,referenceId,broadcastReferenceId,review:{constructorArgs:[body.constructorArg]},authorized:false};if(action==='deployment-prepare')return{reference:{state:'saved',operationId:'PUBLIC-op'},result:{savedLocally:true,submitted:false}};return{PUBLIC:'original result'};}},{ynxDesktopFiles:{open:async({kind})=>{assert.equal(kind,'file');return{uris:[files.shift()]};}}},{executeCommand:async()=>{}},translate);return{widget,calls};}
test('normal contract view starts with no constructor and never connects, reads files or sends an action on open',async()=>{const f=fixture();await tick();assert.equal(f.widget.fields.constructorArg.value,'');assert.equal(f.widget.fields.name.value,'');assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'inspect');f.widget.buttons.review.click();await tick();assert.equal(f.calls.length,1);f.widget.dispose();});
test('real click callbacks keep material review, signing request and broadcast request separate',async()=>{const f=fixture();await tick();f.widget.fields.name.value='SampleEVMWriteCounter';for(const key of['sourceURI','artifactURI','buildInfoURI']){f.widget.buttons[key].click();await tick();}assert.equal(f.calls.length,1);f.widget.fields.constructorArg.value='42';f.widget.fields.constructorArg.listeners.get('input')();f.widget.buttons.review.click();await tick();assert.equal(f.calls[1].action,'deployment-preview');assert.equal(f.calls[1].body.constructorArg,'42');assert.equal(f.calls.filter(call=>call.action==='deployment-prepare').length,0);assert.equal(f.widget.buttons.broadcast.disabled,true);
 f.widget.buttons.prepare.click();await tick();assert.equal(f.calls[2].action,'deployment-prepare');assert.equal(f.calls[2].body.draftId,referenceId);assert.equal(f.calls.filter(call=>call.action==='deployment-broadcast').length,0);assert.equal(f.widget.buttons.broadcast.disabled,false);f.widget.buttons.broadcast.click();await tick();assert.equal(f.calls[3].action,'deployment-broadcast');assert.equal(f.calls[3].body.referenceId,referenceId);assert.equal(f.widget.fields.referenceId.value,broadcastReferenceId);f.widget.buttons.broadcast.click();await tick();assert.equal(f.calls.filter(call=>call.action==='deployment-broadcast').length,1);f.widget.dispose();});
test('restoring a saved reference restores only query data, never constructor or approval state',async()=>{const f=fixture();f.widget.restoreState({referenceId,constructorArg:'PUBLIC-untrusted',prepared:true});await tick();assert.equal(f.widget.fields.referenceId.value,referenceId);assert.equal(f.widget.fields.constructorArg.value,'');assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);f.widget.buttons.read.click();await tick();assert.equal(f.calls.at(-1).action,'read');assert.equal(f.calls.at(-1).body.referenceId,referenceId);assert.deepEqual(Object.keys(f.widget.storeState()),['referenceId']);f.widget.dispose();});
test('cold saved-request discovery restores a lost UUID without recreating preparation or broadcast',async()=>{const f=fixture(async action=>action==='inspect'?{onlineConfigured:false}:action==='references'?{version:2,references:[{referenceId:broadcastReferenceId,state:'unknown',method:'ynx_preparePQContractBroadcast'}],legacy:{state:'none'}}:null);await tick();f.widget.buttons.references.click();await tick();assert.equal(f.widget.fields.referenceId.value,broadcastReferenceId);assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);assert.equal(f.calls.filter(call=>call.action.startsWith('deployment-')).length,0);f.widget.dispose();});

test('legacy scope-unavailable history is visible and never becomes a selected request or approval',async()=>{const f=fixture(async action=>action==='inspect'?{onlineConfigured:false}:action==='references'?{version:2,references:[],legacy:{state:'retained-scope-unavailable',queryOnly:true,readable:false}}:null);await tick();f.widget.buttons.references.click();await tick();assert.ok(f.widget.node.children.some(node=>node.hidden===false&&node.textContent?.includes('Earlier request records are retained')));assert.equal(f.widget.fields.referenceId.value,'');assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);assert.equal(f.calls.filter(call=>call.action.startsWith('deployment-')).length,0);f.widget.dispose();});

test('an uncertain writer is visible even when there are no selectable records',async()=>{const f=fixture(async action=>action==='inspect'?{onlineConfigured:false}:action==='references'?{version:2,references:[],uncertainWriter:true,legacy:{state:'none'}}:null);await tick();f.widget.buttons.references.click();await tick();assert.ok(f.widget.node.children.some(node=>node.hidden===false&&node.textContent?.includes('Retained request writes are incomplete')));assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);f.widget.dispose();});

function fillCall(widget){widget.fields.mode.value='execute';widget.fields.mode.listeners.get('change')();widget.fields.name.value='SampleEVMWriteCounter';for(const[key,value]of Object.entries({target:'0x'+'1'.repeat(40),sourceHash:'2'.repeat(64),deployedBytecodeHash:'3'.repeat(64),compilerConfigHash:'4'.repeat(64),expectedStorageCommitment:'5'.repeat(64),calldata:'0x7cf5dab0'+'0'.repeat(64)})){widget.fields[key].value=value;widget.fields[key].listeners.get('input')();}}
function callFixture(override){return fixture(async(action,body)=>{if(action==='inspect')return{onlineConfigured:true};if(override)return override(action,body);if(action==='execution-preview')return{draftId:referenceId,referenceId,broadcastReferenceId,review:body,authorized:false,submitted:false};if(action==='execution-prepare')return{reference:{state:'saved',operationId:'PUBLIC-op'},result:{savedLocally:true,submitted:false}};return{queryOnly:true,consensusFinality:false};});}
test('existing window call mode routes review, Wallet signing and broadcast through separate clicks',async()=>{const f=callFixture();await tick();fillCall(f.widget);assert.equal(f.calls.length,1);assert.equal(f.widget.buttons.sourceURI.hidden,true);f.widget.buttons.review.click();await tick();assert.equal(f.calls.at(-1).action,'execution-preview');assert.equal(Object.keys(f.calls.at(-1).body).sort().join(),'calldata,compilerConfigHash,deployedBytecodeHash,expectedStorageCommitment,name,sourceHash,target,value');assert.equal(f.calls.at(-1).body.value,'0');assert.equal(f.widget.buttons.broadcast.disabled,true);f.widget.buttons.prepare.click();await tick();assert.equal(f.calls.at(-1).action,'execution-prepare');assert.equal(f.widget.buttons.broadcast.disabled,false);assert.equal(f.calls.filter(c=>c.action==='execution-broadcast').length,0);f.widget.buttons.broadcast.click();await tick();assert.equal(f.calls.at(-1).action,'execution-broadcast');assert.equal(f.calls.at(-1).body.referenceId,referenceId);assert.equal(f.widget.fields.referenceId.value,broadcastReferenceId);f.widget.buttons.broadcast.click();await tick();assert.equal(f.calls.filter(c=>c.action==='execution-broadcast').length,1);f.widget.buttons.query.click();await tick();assert.equal(f.calls.at(-1).action,'query');assert.equal(f.calls.at(-1).body.referenceId,broadcastReferenceId);assert.ok(f.widget.output.textContent.includes('"consensusFinality": false'));f.widget.dispose();});
test('editing expected storage after signing requires new review and cannot broadcast stale call',async()=>{const f=callFixture();await tick();fillCall(f.widget);f.widget.buttons.review.click();await tick();f.widget.buttons.prepare.click();await tick();f.widget.fields.expectedStorageCommitment.value='6'.repeat(64);f.widget.fields.expectedStorageCommitment.listeners.get('input')();assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);f.widget.buttons.broadcast.click();await tick();assert.equal(f.calls.filter(c=>c.action==='execution-broadcast').length,0);f.widget.dispose();});
test('changing call mode to deploy discards call approval state',async()=>{const f=callFixture();await tick();fillCall(f.widget);f.widget.buttons.review.click();await tick();f.widget.fields.mode.value='deploy';f.widget.fields.mode.listeners.get('change')();assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);assert.equal(f.widget.buttons.sourceURI.hidden,false);f.widget.dispose();});
test('new failed call review cannot reuse the earlier successful draft',async()=>{let previews=0;const f=callFixture(async action=>{if(action==='execution-preview'){if(++previews===2)throw Object.assign(Error('PUBLIC invalid'),{code:'PQ_NATIVE_ACTION_INVALID'});return{draftId:referenceId,referenceId,broadcastReferenceId,review:{},authorized:false};}return{};});await tick();fillCall(f.widget);f.widget.buttons.review.click();await tick();assert.equal(f.widget.buttons.prepare.disabled,false);f.widget.buttons.review.click();await tick();assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);assert.ok(f.widget.status.textContent.includes('storage commitment'));f.widget.dispose();});
test('reopen restores only query reference, never a call payload or signing state',async()=>{const f=callFixture();f.widget.restoreState({referenceId:broadcastReferenceId,mode:'execute',calldata:'PUBLIC-untrusted',prepared:true});await tick();assert.equal(f.widget.fields.referenceId.value,broadcastReferenceId);assert.equal(f.widget.fields.mode.value,'deploy');assert.equal(f.widget.fields.calldata.value,'');assert.equal(f.widget.buttons.prepare.disabled,true);assert.deepEqual(Object.keys(f.widget.storeState()),['referenceId']);assert.equal(f.calls.filter(c=>c.action.startsWith('execution-')).length,0);f.widget.dispose();});
test('selecting another saved reference cannot sign the earlier call draft',async()=>{const f=callFixture();await tick();fillCall(f.widget);f.widget.buttons.review.click();await tick();assert.equal(f.widget.buttons.prepare.disabled,false);f.widget.fields.referenceId.value=broadcastReferenceId;f.widget.fields.referenceId.listeners.get('input')();assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);f.widget.buttons.prepare.click();await tick();assert.equal(f.calls.filter(c=>c.action==='execution-prepare').length,0);f.widget.dispose();});

for(const operation of ['deployment','execution'])test(operation+' pending signing can be cancelled without adopting a late success or replaying the request',async()=>{
 let finish;const f=fixture(async(action,body)=>{
  if(action==='inspect')return{onlineConfigured:true};
  if(action.endsWith('-preview'))return{draftId:referenceId,referenceId,broadcastReferenceId,authorized:false};
  if(action.endsWith('-prepare'))return new Promise(resolve=>{finish=resolve;});
  if(action==='cancel')return{state:'cancelled',queryOnly:true};
  return{queryOnly:true};
 });await tick();
 if(operation==='execution')fillCall(f.widget);else{for(const key of ['sourceURI','artifactURI','buildInfoURI'])f.widget.fields[key].value='file:///PUBLIC/'+key;f.widget.fields.name.value='SampleEVMWriteCounter';f.widget.fields.constructorArg.value='1';}
 f.widget.buttons.review.click();await tick();f.widget.buttons.prepare.click();await tick();
 assert.ok(f.widget.buttons.cancel,'pending Wallet requests need an explicit cancellation action');
 assert.equal(f.widget.buttons.cancel.disabled,false);f.widget.buttons.cancel.click();await tick();
 assert.equal(f.calls.filter(c=>c.action==='cancel').length,1);
 assert.equal(f.widget.fields.referenceId.value,referenceId,'retain the original query reference');
 assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);
 finish({reference:{state:'saved',operationId:'PUBLIC-late'},result:{savedLocally:true,submitted:false}});await tick();
 assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);
 assert.ok(!f.widget.output.textContent.includes('PUBLIC-late'));
 assert.equal(f.calls.filter(c=>c.action===operation+'-prepare').length,1);
 f.widget.buttons.query.click();await tick();assert.equal(f.calls.at(-1).action,'query');assert.equal(f.calls.at(-1).body.referenceId,referenceId);f.widget.dispose();
});

test('Chinese contract call fields, cancellation and failure guidance use owned locale keys',async()=>{
 const {createRequire}=await import('node:module'),locale=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/ynx-localization.js');
 const translate=(key,fallback)=>locale.TRANSLATIONS['ynx/workbench/'+key]??fallback;
 const f=fixture(async action=>{if(action==='inspect')return{onlineConfigured:true};throw Object.assign(Error('SECRET'),{code:'PQ_NATIVE_ACTION_INVALID'});},translate);await tick();fillCall(f.widget);
 assert.equal(f.widget.fields.mode.children[0].textContent,'部署受支持的合约');assert.equal(f.widget.fields.mode.children[1].textContent,'调用已部署合约');
 for(const caption of ['已部署合约地址','已登记的源码哈希','已部署字节码哈希','编译配置哈希','预期存储承诺','已编码的函数调用'])assert.ok(f.widget.node.children.some(n=>n.tag==='label'&&n.textContent===caption),caption);
 assert.equal(f.widget.buttons.review.textContent,'审阅合约调用');assert.equal(f.widget.buttons.cancel.textContent,'取消待处理请求');
 f.widget.buttons.review.click();await tick();assert.equal(f.widget.status.textContent,'请核对受支持的合约、已登记哈希、当前存储承诺和已编码调用。本次没有自动重试交易。');
 assert.equal(f.widget.buttons.prepare.disabled,true);assert.equal(f.widget.buttons.broadcast.disabled,true);assert.ok(!f.widget.status.textContent.includes('SECRET'));f.widget.dispose();
});

for(const operation of ['deployment','execution'])test(operation+' cancellation crosses the actual private pipe with its closed empty-body ABI',async()=>{
 const {duplexPair}=await import('node:stream'),{createRequire}=await import('node:module');
 const channel=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/project-contracts-channel.js');
 const [a,b]=duplexPair();let finish;const calls=[];
 const server=channel.serve(a,{async call(action,body){calls.push({action,body});
  if(action==='inspect')return{onlineConfigured:true};
  if(action.endsWith('-preview'))return{draftId:referenceId,referenceId,broadcastReferenceId,authorized:false};
  if(action.endsWith('-prepare'))return new Promise(resolve=>{finish=resolve;});
  if(action==='cancel')return{state:'cancelled',queryOnly:true};return{queryOnly:true};
 },async close(){}}),client=channel.client(b);
 const widget=new loaded.exports.ContractDeploymentWidget({call:(action,body)=>client.call(action,JSON.parse(JSON.stringify(body)))},{},{executeCommand:async()=>{}},(_key,text)=>text);
 const settle=async predicate=>{for(let i=0;i<20&&!predicate();i++)await tick();assert.ok(predicate());};
 try{
  await settle(()=>widget.buttons.query.disabled===false);
  if(operation==='execution')fillCall(widget);else{for(const key of ['sourceURI','artifactURI','buildInfoURI'])widget.fields[key].value='file:///PUBLIC/'+key;widget.fields.name.value='SampleEVMWriteCounter';widget.fields.constructorArg.value='1';}
  widget.buttons.review.click();await settle(()=>widget.buttons.prepare.disabled===false);
  widget.buttons.prepare.click();await settle(()=>typeof finish==='function');
  widget.buttons.cancel.click();await tick();await tick();
  assert.equal(calls.filter(c=>c.action==='cancel').length,1,'actual channel must accept and deliver cancel');
  assert.deepEqual(calls.find(c=>c.action==='cancel').body,{});
  await settle(()=>widget.buttons.query.disabled===false);
  finish({reference:{state:'saved',operationId:'PUBLIC-late'},result:{savedLocally:true,submitted:false}});await tick();await tick();
  assert.equal(widget.buttons.broadcast.disabled,true);assert.equal(widget.fields.referenceId.value,referenceId);
  widget.buttons.query.click();await settle(()=>calls.some(c=>c.action==='query'));
  assert.equal(calls.find(c=>c.action==='query').body.referenceId,referenceId);
  assert.equal(calls.filter(c=>c.action===operation+'-prepare').length,1);
 }finally{finish?.({});widget.dispose();client.close();server.close();}
});

test('disposing the contract window before its queued picker runs never opens a native dialog',async()=>{
 let picks=0,calls=0;
 const widget=new loaded.exports.ContractDeploymentWidget({call:async()=>{calls++;return{onlineConfigured:true};}},{ynxDesktopFiles:{open:async()=>{picks++;return{cancelled:true};}}},{executeCommand:async()=>{}},(_key,text)=>text);
 await tick();const before=calls;widget.buttons.sourceURI.click();widget.dispose();await tick();
 assert.equal(picks,0,'retired window must not open the system file picker');assert.equal(calls,before,'retirement must not start project work');
});
