import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createPQTypedActionReviewUI,PQ_TYPED_ACTION_FORM} from '../src/wallet-pq-typed-action-ui.mjs';
function fixture(prepare){
 const nodes=[],calls=[],state={account:'0x'+'11'.repeat(20),revision:1,locked:false,authenticating:false};let ready=false;
 const doc={querySelector:selector=>{assert.equal(selector,'#send-sheet');return sheet;},createElement(tag){const n={tag,value:'',children:[],handlers:new Map(),setAttribute(){},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[...items]},addEventListener(name,fn){this.handlers.set(name,fn)}};nodes.push(n);return n;}};
 const sheet=doc.createElement('dialog'),ui=createPQTypedActionReviewUI({document:doc,getKeyState(){assert.equal(ready,true);return state},api:{preparePQTypedAction:async input=>{calls.push(input);return prepare?prepare(input):{ok:true,value:{requestId:'synthetic-review',submitted:false}}}}});ready=true;
 const byId=id=>nodes.find(n=>n.id===id),form=nodes.find(n=>n.tag==='form'),button=nodes.find(n=>n.tag==='button'),result=nodes.filter(n=>n.tag==='p').at(-1),selector=byId('pq-typed-action-kind');
 return {ui,nodes,calls,state,sheet,selector,button,result,field:name=>byId('pq-action-'+name),select(kind){selector.value=kind;selector.handlers.get('change')()},submit:()=>form.handlers.get('submit')({preventDefault(){}})};
}
test('normal typed form initializes before renderer state, names all original actions and fences four missing-material actions',async()=>{
 const f=fixture();f.ui.render();assert.equal(PQ_TYPED_ACTION_FORM.length,16);assert.equal(f.selector.children.filter(n=>!n.disabled).length,12);assert.equal(f.button.disabled,false);
 for(const kind of ['contract_deploy','stake_delegate','stake_unbond','stake_withdraw']){f.select(kind);assert.equal(f.button.disabled,true);await f.submit()}
 assert.equal(f.calls.length,0);f.select('contract_execute');assert.deepEqual(f.field('name').children.map(n=>n.value),['SampleEVMWriteCounter','SampleYNXTCompatibleERC20']);
});
test('typed form submits only kind fixed fee and complete public payload; wide integers stay strings',async()=>{
 const f=fixture();f.select('dex_asset_create');const values={assetID:'demo-asset',symbol:'DEMO',name:'QA asset',decimals:'18',maxSupply:'9007199254740995',initialSupply:'9007199254740994'};
 for(const [key,value] of Object.entries(values))f.field(key).value=value;await f.submit();
 assert.deepEqual(f.calls,[{kind:'dex_asset_create',fee:'1',payload:{...values,decimals:18}}]);assert.match(f.result.textContent,/尚未签名或发送/);
 assert.deepEqual(Object.keys(f.calls[0]).sort(),['fee','kind','payload']);assert.equal(Object.hasOwn(f.calls[0],'owner'),false);
});
test('typed form refuses empty fields or noncanonical small numbers before IPC',async()=>{
 const f=fixture();await f.submit();assert.equal(f.calls.length,0);f.select('dex_asset_create');
 for(const name of PQ_TYPED_ACTION_FORM.find(r=>r.kind==='dex_asset_create').fields)f.field(name).value='1';
 f.field('decimals').value='01';await f.submit();assert.equal(f.calls.length,0);
 f.state.locked=true;f.field('decimals').value='18';await f.submit();assert.equal(f.calls.length,0);
});
test('typed form suppresses duplicate calls and stale lock/account/modal callbacks without retry',async()=>{
 for(const change of [f=>{f.state.locked=true;f.state.revision++;f.ui.invalidate()},f=>{f.state.account='0x'+'22'.repeat(20);f.ui.invalidate()},f=>f.sheet.handlers.get('close')()]){
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}));f.field('amount').value='9007199254740994';const pending=f.submit();await f.submit();assert.equal(f.calls.length,1);
  change(f);release({ok:true,value:{requestId:'stale',submitted:false}});await pending;assert.equal(f.result.textContent,'');assert.equal(f.calls.length,1);
 }
});
test('typed normal Main/preload provider-review route is wired without sign or send capability in form',async()=>{
 const main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf("handleWalletIPC('wallet:pq-typed-action-review'"),end=main.indexOf('\nhandleWalletIPC(',start+1),handlers=new Map(),events=[],calls=[];
 assert.ok(start>=0&&end>start);const request={id:'typed-QA-review',method:'ynx_signPQNativeAction'};
 runInNewContext(main.slice(start,end),{handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:fn=>fn(),walletAuthority:{async requestPQTypedAction(value){calls.push(value);return {request}}},keyAccess:{current:()=>({assert(){}})},mainWindow:{webContents:{send:(...args)=>events.push(args)}}});
 const input={kind:'stake',fee:'0',payload:{amount:'1'}},result=await handlers.get('wallet:pq-typed-action-review')({},input);assert.equal(result.requestId,request.id);assert.equal(result.submitted,false);assert.equal(calls[0],input);assert.equal(events[0][1],request);
 let api;const invoked=[];runInNewContext(readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value}},ipcRenderer:{invoke:(...args)=>invoked.push(args)}})});api.preparePQTypedAction(input);assert.equal(invoked[0][0],'wallet:pq-typed-action-review');
 const renderer=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');assert.match(renderer,/createPQTypedActionReviewUI\(\{api:window\.ynxWallet/);assert.match(renderer,/if\(securityChanged\)pqTypedActionReviewUI\.invalidate\(\)/);
});
