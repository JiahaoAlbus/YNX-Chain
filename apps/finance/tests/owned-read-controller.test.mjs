import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const statements=source.slice(source.indexOf('let statementOperation='),source.indexOf("$('#statement-form').addEventListener"));
const downloads=source.slice(source.indexOf('const ownedExportOperations='),source.indexOf("$('#export-json').addEventListener"));
const workspace=source.slice(source.indexOf('let loadOperation='),source.indexOf('async function reconnect('));
test('confirmed save can retire a pre-save workspace read without stale success or failure overriding it',async()=>{
  for(const reject of [false,true]){
    const calls=[],rendered=[],states=[],failures=[];
    const scope={state:{context:1,connected:true},window:{YNXFinanceWallet:{ready:Promise.resolve(),connected:()=>true}},renderBrowserWalletIdentity:()=>true,sourceStatus:()=>{},workspaceDataState:value=>states.push(value),reconcileOpaqueBrokerOwner:()=>{},render:value=>rendered.push(value),clearPrivateView:()=>failures.push('signed-out'),notify:()=>failures.push('notify'),financeText:key=>key,api:()=>new Promise((resolve,reject)=>calls.push({resolve,reject}))};
    runInNewContext(workspace+'globalThis.readWorkspace=load;',scope);
    const old=scope.readWorkspace();await new Promise(setImmediate);
    assert.equal(scope.readWorkspace(),old);assert.equal(calls.length,1);
    const current=scope.readWorkspace({fresh:true});await new Promise(setImmediate);
    assert.equal(calls.length,2);
    calls[1].resolve({profile:'saved-current'});await current;
    if(reject)calls[0].reject(Object.assign(new Error('old permission failure'),{status:401}));else calls[0].resolve({profile:'before-save'});
    await old;assert.deepEqual(rendered,[{profile:'saved-current'}]);assert.deepEqual(states,['ready']);assert.deepEqual(failures,[]);
  }
});
function fixture(){
  const form={values:[['from','2026-09-01'],['to','2026-09-30']],attributes:new Map(),setAttribute(k,v){this.attributes.set(k,v)},removeAttribute(k){this.attributes.delete(k)}};
  const panel={...form,attributes:new Map(),classList:{remove(){}}},calls=[],notices=[],rendered=[],urls=[];
  const scope={state:{context:1,statement:null,statementError:false},browserSSOIntentGeneration:1,FormData:class{constructor(form){this.values=form.values}get(key){return this.values.find(value=>value[0]===key)?.[1]}[Symbol.iterator](){return this.values[Symbol.iterator]()}},$:selector=>selector==='#statement-form'?form:panel,renderStatement:value=>rendered.push(value),financeText:key=>key,notifyFailure:()=>notices.push('failed'),api:(path)=>new Promise((resolve,reject)=>calls.push({path,resolve,reject})),URL:{createObjectURL:()=>{urls.push('created');return 'blob:isolated'},revokeObjectURL:()=>urls.push('revoked')},document:{createElement:()=>({click:()=>urls.push('clicked')})}};
  runInNewContext('function formDraft(form){return JSON.stringify(Array.from(new FormData(form)));}\n'+statements+downloads+'globalThis.read=loadStatement;globalThis.exportOwned=download;globalThis.retireRead=retireOwnedStatementView;',scope);
  return {scope,form,panel,calls,notices,rendered,urls,read:()=>scope.read(form)};
}
test('same report request coalesces and a newer period rejects old success or error',async()=>{
  for(const reject of [false,true]){
    const f=fixture(),old=f.read();assert.equal(f.read(),old);assert.equal(f.calls.length,1);
    f.form.values=[['from','2026-08-01'],['to','2026-08-31']];const next=f.read();
    if(reject)f.calls[0].reject(new Error('old failure'));else f.calls[0].resolve({account:'old period'});await old;
    assert.deepEqual(f.rendered,[]);assert.deepEqual(f.notices,[]);assert.equal(f.panel.attributes.get('aria-busy'),'true');
    f.calls[1].resolve({account:'current period'});await next;assert.deepEqual(f.rendered,[{account:'current period'}]);assert.equal(f.panel.attributes.has('aria-busy'),false);
  }
});
test('account or identity generation switch prevents old report failure from clearing new data',async()=>{
  for(const field of ['context','generation']){
    const f=fixture(),old=f.read();if(field==='context')f.scope.state.context++;else f.scope.browserSSOIntentGeneration++;
    const next=f.read();f.calls[1].resolve({account:'new owner'});await next;f.calls[0].reject(new Error('old failure'));await old;
    assert.equal(f.scope.state.statement.account,'new owner');assert.equal(f.scope.state.statementError,false);assert.deepEqual(f.notices,[]);
  }
});
test('sign-out retires old report busy state without letting its response publish into the next account',async()=>{
  const f=fixture(),old=f.read();f.scope.retireRead();f.scope.state.context++;
  assert.equal(f.panel.attributes.has('aria-busy'),false);assert.equal(f.form.attributes.has('aria-busy'),false);
  const next=f.read();f.calls[0].resolve({account:'old owner'});await old;
  assert.equal(f.panel.attributes.get('aria-busy'),'true');assert.deepEqual(f.rendered,[]);
  f.calls[1].resolve({account:'current owner'});await next;assert.deepEqual(f.rendered,[{account:'current owner'}]);
});
test('late export never downloads old account data or reports its error to a new account',async()=>{
  for(const reject of [false,true]){
    const f=fixture(),old=f.scope.exportOwned('/api/export?format=json','owned.json');f.scope.state.context++;
    if(reject)f.calls[0].reject(new Error('old export'));else f.calls[0].resolve({});await old;assert.deepEqual(f.urls,[]);assert.deepEqual(f.notices,[]);
  }
  const current=fixture(),download=current.scope.exportOwned('/api/export?format=json','owned.json');current.calls[0].resolve({});await download;assert.deepEqual(current.urls,['created','clicked','revoked']);
});
test('repeated export clicks coalesce while a new account can start its own export',async()=>{
  const f=fixture(),first=f.scope.exportOwned('/api/export?format=json','owned.json');
  const repeated=f.scope.exportOwned('/api/export?format=json','owned.json');
  assert.equal(repeated,first);
  assert.equal(f.calls.length,1);
  f.scope.state.context++;
  const next=f.scope.exportOwned('/api/export?format=json','owned.json');assert.equal(f.calls.length,2);
  f.calls[0].resolve({});await Promise.all([first,repeated]);assert.deepEqual(f.urls,[]);
  f.calls[1].resolve({});await next;assert.deepEqual(f.urls,['created','clicked','revoked']);
  const retry=f.scope.exportOwned('/api/export?format=json','owned.json');assert.equal(f.calls.length,3);
  f.calls[2].reject(new Error('unavailable'));await retry;assert.deepEqual(f.notices,['failed']);
  const recovered=f.scope.exportOwned('/api/export?format=json','owned.json');assert.equal(f.calls.length,4);f.calls[3].resolve({});await recovered;
  assert.deepEqual(f.urls,['created','clicked','revoked','created','clicked','revoked']);
});
