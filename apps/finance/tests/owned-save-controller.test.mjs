import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

// Direct production controller regression, not Wallet/public authentication QA.
const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const controller=source.slice(source.indexOf('const formSaves='),source.indexOf("$('#category-form').addEventListener"));
const dataState=source.slice(source.indexOf('const dataDisabledControls='),source.indexOf('let loadOperation='));
function fixture(){
  const calls=[],notices=[],state={context:1,connected:true},workspace={dataset:{dataState:'ready'}};
  const button={disabled:false,closest:()=>form},attributes=new Map();
  const form={values:[['name','My budget'],['limitYnxt','17']],resetCount:0,querySelector:()=>null,querySelectorAll:()=>[button],setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),reset(){this.resetCount++;}};
  const scope={state,browserSSOIntentGeneration:1,document:{addEventListener(){}},crypto:{randomUUID},WeakMap,FormData:class{constructor(value){return value.values;}},$:id=>id==='#workspace'?workspace:{classList:{toggle(){}}},$$:()=>[button],financeText:k=>k,notify:x=>notices.push(x),notifyFailure:()=>notices.push('failed'),attestBrowserIdentityActivity:async()=>{},load:async()=>{},api:(path,options)=>new Promise((resolve,reject)=>calls.push({path,method:options.method,body:JSON.parse(options.body),resolve,reject}))};
  runInNewContext(controller+dataState+'\nglobalThis.save=submitForm;globalThis.dataState=workspaceDataState;globalThis.retireSaveView=retireOwnedFormSaveView;',scope);
  const reply=index=>{const call=calls[index],timestamp='2026-10-03T00:00:00Z';call.resolve(call.path==='/api/privacy'?{...call.body,updatedAt:timestamp}:{...call.body,id:'owned-'+index,source:'user',createdAt:timestamp,updatedAt:timestamp});};
  return {scope,form,button,attributes,calls,notices,state,reply,save:(body={})=>scope.save(form,'/api/budgets',{name:'My budget',categoryId:'category-1',limitYnxt:17,period:'monthly',startsAt:'2026-10-03T00:00:00Z',...body})};
}
test('same pending form uses one promise/request and restores submit controls',async()=>{
  const f=fixture(),first=f.save();assert.equal(f.save(),first);assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);assert.equal(f.attributes.get('aria-busy'),'true');
  f.reply(0);await first;assert.equal(f.form.resetCount,1);assert.equal(f.button.disabled,false);assert.deepEqual(f.notices,['profileSaved']);
});
test('four owned saves require exact real receipts and keep uncertain intent/draft for explicit retry',async()=>{
  const time='2026-10-03T00:00:00Z',base={id:'owned-1',source:'user',createdAt:time,updatedAt:time};
  const cases=[
    ['/api/categories',{name:' Category ',color:'#002fa7'},{...base,name:'Category',color:'#002FA7'},[{name:'Other'},{color:'#FFFFFF'},{source:'chain'},{id:''}]],
    ['/api/budgets',{name:'Budget',categoryId:'cat-1',limitYnxt:17,period:'monthly',startsAt:time},{...base,name:'Budget',categoryId:'cat-1',limitYnxt:17,period:'monthly',startsAt:time},[{categoryId:'foreign'},{limitYnxt:18},{startsAt:'2026-10-04T00:00:00Z'},{updatedAt:''}]],
    ['/api/reminders',{title:'Reminder',amountYnxt:null,schedule:'custom',nextDueAt:time,sourceRef:''},{...base,title:'Reminder',schedule:'custom',nextDueAt:time,enabled:true},[{enabled:false},{amountYnxt:0},{title:'Other'},{nextDueAt:'invalid'}]],
    ['/api/privacy',{includePayInStatements:false,allowAiActivityContext:false,alertsEnabled:true},{includePayInStatements:false,allowAiActivityContext:false,alertsEnabled:true,updatedAt:time},[{alertsEnabled:false},{allowAiActivityContext:true},{updatedAt:''}]],
  ];
  for(const [path,body,valid,mismatches] of cases)for(const receipt of [null,{},[],...mismatches.map(patch=>({...valid,...patch}))]){
    const f=fixture(),options={method:path==='/api/privacy'?'PUT':'POST',reset:path!=='/api/privacy'};
    const first=f.scope.save(f.form,path,body,null,options);f.calls[0].resolve(receipt);await first;
    assert.equal(f.form.resetCount,0);assert.deepEqual(f.notices,['failed']);assert.equal(f.button.disabled,false);
    const next=f.scope.save(f.form,path,body,null,options);assert.deepEqual(f.calls[1].body,f.calls[0].body);f.calls[1].resolve(valid);await next;assert.deepEqual(f.notices,['failed','profileSaved']);
  }
});
test('unsafe planning amounts and invalid payloads never send a write',async()=>{
  for(const [path,body] of [['/api/budgets',{name:'Budget',categoryId:'cat-1',limitYnxt:Number.MAX_SAFE_INTEGER+1,period:'monthly',startsAt:'2026-10-03T00:00:00Z'}],['/api/reminders',{title:'Reminder',amountYnxt:1.5,schedule:'monthly',nextDueAt:'2026-10-03T00:00:00Z'}],['/api/reminders',{title:'Reminder',amountYnxt:null,schedule:'monthly',nextDueAt:'invalid'}],['/api/categories',{name:'',color:'#002FA7'}],['/api/privacy',{alertsEnabled:true}]]){
    const f=fixture();await f.scope.save(f.form,path,body,null,{method:path==='/api/privacy'?'PUT':'POST'});assert.equal(f.calls.length,0);assert.equal(f.form.resetCount,0);assert.deepEqual(f.notices,['failed']);assert.equal(f.button.disabled,false);
  }
});
test('explicit retry after unknown outcome preserves key and original computed time/body',async()=>{
  const f=fixture(),first=f.save();f.calls[0].reject(new Error('response unavailable'));await first;
  assert.equal(f.form.resetCount,0);const next=f.save({name:'My budget',startsAt:'later-time'});
  assert.deepEqual(f.calls[1].body,f.calls[0].body);assert.equal(f.calls.length,2);f.reply(1);await next;
});
test('late old identity outcomes neither reset a new draft nor notify or release a newer save',async()=>{
  for(const rejected of [false,true]){
    const f=fixture(),first=f.save();f.state.context++;f.scope.browserSSOIntentGeneration++;f.form.values=[['name','New account draft']];
    const next=f.save({name:'New account draft'});assert.notEqual(f.calls[0].body.idempotencyKey,f.calls[1].body.idempotencyKey);
    if(rejected)f.calls[0].reject(new Error('old failure'));else f.calls[0].resolve({});await first;
    assert.equal(f.form.resetCount,0);assert.equal(f.button.disabled,true);assert.deepEqual(f.notices,[]);
    f.reply(1);await next;assert.equal(f.form.resetCount,1);assert.equal(f.button.disabled,false);assert.equal(f.attributes.has('aria-busy'),false);
  }
});
test('clearing an account retires only UI ownership so fresh account can submit before old response',async()=>{
  for(const rejected of [false,true]){
    const f=fixture(),old=f.save();f.scope.retireSaveView(f.form);
    assert.equal(f.button.disabled,false);assert.equal(f.attributes.has('aria-busy'),false);assert.equal(f.calls.length,1);
    f.state.context++;f.scope.browserSSOIntentGeneration++;f.form.values=[['name','Other account']];
    const next=f.save({name:'Other account'});assert.equal(f.button.disabled,true);
    if(rejected)f.calls[0].reject(new Error('old response lost'));else f.calls[0].resolve({});await old;
    assert.equal(f.button.disabled,true);assert.deepEqual(f.notices,[]);assert.equal(f.form.resetCount,0);
    f.reply(1);await next;assert.equal(f.button.disabled,false);assert.deepEqual(f.notices,['profileSaved']);
  }
});
test('edits made during a successful save remain as draft; unavailable data stays non-writable',async()=>{
  const f=fixture(),first=f.save();f.form.values=[['name','Next draft']];f.reply(0);await first;assert.equal(f.form.resetCount,0);
  const next=f.save();f.scope.$('#workspace').dataset.dataState='unavailable';f.calls[1].reject(new Error('unavailable'));await next;assert.equal(f.button.disabled,true);
});
test('save followed by unavailable read preserves real control baseline and refresh re-enables it',async()=>{
  const f=fixture();f.scope.load=async()=>f.scope.dataState('unavailable');const saved=f.save();
  f.reply(0);await saved;assert.equal(f.button.disabled,true);
  f.scope.dataState('ready');assert.equal(f.button.disabled,false);
});
test('privacy PUT coalesces without POST idempotency fields, preserves edited checkboxes and fences old errors',async()=>{
  const f=fixture(),options={method:'PUT',reset:false,successKey:'privacySaved'},body={includePayInStatements:false,allowAiActivityContext:false,alertsEnabled:true};
  const first=f.scope.save(f.form,'/api/privacy',body,null,options);assert.equal(f.scope.save(f.form,'/api/privacy',body,null,options),first);
  assert.equal(f.calls[0].method,'PUT');assert.equal(Object.hasOwn(f.calls[0].body,'idempotencyKey'),false);
  f.form.values=[['alertsEnabled','false']];
  f.scope.$=id=>id==='#privacy-form'?f.form:{dataset:{dataState:'ready'}};
  f.form.includePayInStatements={checked:false};f.form.allowAiActivityContext={checked:false};f.form.alertsEnabled={checked:false};
  const privacy=source.slice(source.indexOf('function renderPrivacy('),source.indexOf('function renderAIRecords('));
  runInNewContext(privacy+'globalThis.renderPrivacy=renderPrivacy;',f.scope);
  // Controller lexical draft guard is exercised through the same VM context.
  f.scope.load=async()=>runInNewContext('renderPrivacy({alertsEnabled:true})',f.scope);
  f.reply(0);await first;assert.equal(f.form.resetCount,0);assert.equal(f.form.alertsEnabled.checked,false);assert.deepEqual(f.notices,['privacySaved']);
  const old=f.scope.save(f.form,'/api/privacy',body,null,options);f.state.context++;f.scope.browserSSOIntentGeneration++;
  f.calls[1].reject(new Error('old privacy failure'));await old;assert.deepEqual(f.notices,['privacySaved']);assert.equal(f.form.resetCount,0);
});
