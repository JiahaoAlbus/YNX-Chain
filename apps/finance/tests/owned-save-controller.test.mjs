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
  const form={values:[['name','My budget'],['limitYnxt','17']],resetCount:0,querySelectorAll:()=>[button],setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),reset(){this.resetCount++;}};
  const scope={state,browserSSOIntentGeneration:1,crypto:{randomUUID},WeakMap,FormData:class{constructor(value){return value.values;}},$:id=>id==='#workspace'?workspace:{classList:{toggle(){}}},$$:()=>[button],financeText:k=>k,notify:x=>notices.push(x),notifyFailure:()=>notices.push('failed'),attestBrowserIdentityActivity:async()=>{},load:async()=>{},api:(path,options)=>new Promise((resolve,reject)=>calls.push({path,method:options.method,body:JSON.parse(options.body),resolve,reject}))};
  runInNewContext(controller+dataState+'\nglobalThis.save=submitForm;globalThis.dataState=workspaceDataState;',scope);
  return {scope,form,button,attributes,calls,notices,state,save:(body={name:'My budget',startsAt:'first-time'})=>scope.save(form,'/api/budgets',body)};
}
test('same pending form uses one promise/request and restores submit controls',async()=>{
  const f=fixture(),first=f.save();assert.equal(f.save(),first);assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);assert.equal(f.attributes.get('aria-busy'),'true');
  f.calls[0].resolve({});await first;assert.equal(f.form.resetCount,1);assert.equal(f.button.disabled,false);assert.deepEqual(f.notices,['profileSaved']);
});
test('explicit retry after unknown outcome preserves key and original computed time/body',async()=>{
  const f=fixture(),first=f.save();f.calls[0].reject(new Error('response unavailable'));await first;
  assert.equal(f.form.resetCount,0);const next=f.save({name:'My budget',startsAt:'later-time'});
  assert.deepEqual(f.calls[1].body,f.calls[0].body);assert.equal(f.calls.length,2);f.calls[1].resolve({});await next;
});
test('late old identity outcomes neither reset a new draft nor notify or release a newer save',async()=>{
  for(const rejected of [false,true]){
    const f=fixture(),first=f.save();f.state.context++;f.scope.browserSSOIntentGeneration++;f.form.values=[['name','New account draft']];
    const next=f.save({name:'New account draft'});assert.notEqual(f.calls[0].body.idempotencyKey,f.calls[1].body.idempotencyKey);
    if(rejected)f.calls[0].reject(new Error('old failure'));else f.calls[0].resolve({});await first;
    assert.equal(f.form.resetCount,0);assert.equal(f.button.disabled,true);assert.deepEqual(f.notices,[]);
    f.calls[1].resolve({});await next;assert.equal(f.form.resetCount,1);assert.equal(f.button.disabled,false);assert.equal(f.attributes.has('aria-busy'),false);
  }
});
test('edits made during a successful save remain as draft; unavailable data stays non-writable',async()=>{
  const f=fixture(),first=f.save();f.form.values=[['name','Next draft']];f.calls[0].resolve({});await first;assert.equal(f.form.resetCount,0);
  const next=f.save();f.scope.$('#workspace').dataset.dataState='unavailable';f.calls[1].reject(new Error('unavailable'));await next;assert.equal(f.button.disabled,true);
});
test('save followed by unavailable read preserves real control baseline and refresh re-enables it',async()=>{
  const f=fixture();f.scope.load=async()=>f.scope.dataState('unavailable');const saved=f.save();
  f.calls[0].resolve({});await saved;assert.equal(f.button.disabled,true);
  f.scope.dataState('ready');assert.equal(f.button.disabled,false);
});
test('privacy PUT coalesces without POST idempotency fields, preserves edited checkboxes and fences old errors',async()=>{
  const f=fixture(),options={method:'PUT',reset:false,successKey:'privacySaved'},body={alertsEnabled:true};
  const first=f.scope.save(f.form,'/api/privacy',body,null,options);assert.equal(f.scope.save(f.form,'/api/privacy',body,null,options),first);
  assert.equal(f.calls[0].method,'PUT');assert.equal(Object.hasOwn(f.calls[0].body,'idempotencyKey'),false);
  f.form.values=[['alertsEnabled','false']];
  f.scope.$=id=>id==='#privacy-form'?f.form:{dataset:{dataState:'ready'}};
  f.form.includePayInStatements={checked:false};f.form.allowAiActivityContext={checked:false};f.form.alertsEnabled={checked:false};
  const privacy=source.slice(source.indexOf('function renderPrivacy('),source.indexOf('function renderAIRecords('));
  runInNewContext(privacy+'globalThis.renderPrivacy=renderPrivacy;',f.scope);
  // Controller lexical draft guard is exercised through the same VM context.
  f.scope.load=async()=>runInNewContext('renderPrivacy({alertsEnabled:true})',f.scope);
  f.calls[0].resolve({});await first;assert.equal(f.form.resetCount,0);assert.equal(f.form.alertsEnabled.checked,false);assert.deepEqual(f.notices,['privacySaved']);
  const old=f.scope.save(f.form,'/api/privacy',body,null,options);f.state.context++;f.scope.browserSSOIntentGeneration++;
  f.calls[1].reject(new Error('old privacy failure'));await old;assert.deepEqual(f.notices,['privacySaved']);assert.equal(f.form.resetCount,0);
});
