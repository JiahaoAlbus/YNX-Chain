import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const statementSource=app.slice(app.indexOf('async function requestStatement('),app.indexOf("\n$('#statement-form').addEventListener"));
const downloadSource=app.slice(app.indexOf('async function download('),app.indexOf("\n$('#export-json').addEventListener"));
assert.ok(statementSource.startsWith('async function requestStatement('));
assert.ok(downloadSource.startsWith('async function download('));

function fixture(){
  let revision=0;
  const state={context:0,statement:{owner:'a'},statementError:false},requests=[],renders=[],notices=[],downloads=[],urls=[],revoked=[];
  const node={textContent:'current report',classList:{remove(){}}};
  const context={state,window:{YNXFinanceWallet:{getRevision:()=>revision}},Date,encodeURIComponent,
    FormData:class{constructor(form){this.form=form}get(key){return this.form[key]}},
    api(path,options){return new Promise((resolve,reject)=>requests.push({path,options,resolve,reject}))},
    renderStatement(value){if(value.invalid)throw new Error('invalid statement');renders.push(value)},
    notifyFailure(error,key){notices.push({error,key})},financeText:key=>key,$:()=>node,
    URL:{createObjectURL(blob){urls.push(blob);return 'blob:owned-export'},revokeObjectURL(url){revoked.push(url)}},
    document:{createElement(){return {click(){downloads.push({href:this.href,name:this.download})}}}},
  };
  vm.runInNewContext(`${statementSource}\n${downloadSource}`,context,{filename:'app.js:statement-export'});
  return {state,requests,renders,notices,node,downloads,urls,revoked,statement:()=>context.requestStatement({from:'2026-10-01',to:'2026-10-02'}),download:()=>context.download('/api/export?format=json','observed.json'),change(kind){if(kind==='context')state.context++;else revision++}};
}

test('old-account statement rejection cannot erase a new report or show old error',async()=>{
  for(const kind of ['context','revision']){
    const f=fixture(),pending=f.statement();f.change(kind);const current={owner:'b'};f.state.statement=current;
    f.requests[0].reject(new Error('FINANCE_CONTEXT_CHANGED'));await pending;
    assert.equal(f.state.statement,current);assert.equal(f.state.statementError,false);assert.equal(f.node.textContent,'current report');assert.deepEqual(f.notices,[]);
  }
});

test('retired statement response cannot render or cache previous-account data',async()=>{
  const f=fixture(),pending=f.statement();f.change('context');const current={owner:'b'};f.state.statement=current;
  f.requests[0].resolve({owner:'a'});await pending;
  assert.equal(f.state.statement,current);assert.deepEqual(f.renders,[]);
});

test('latest same-account report request wins over an older success or failure',async()=>{
  for(const rejected of [false,true]){
    const f=fixture(),old=f.statement(),latest=f.statement(),candidate={range:'new selection'};
    f.requests[1].resolve(candidate);await latest;
    if(rejected)f.requests[0].reject(new Error('old range failure'));else f.requests[0].resolve({range:'old selection'});
    await old;assert.equal(f.state.statement,candidate);assert.deepEqual(f.renders,[candidate]);assert.deepEqual(f.notices,[]);assert.equal(f.state.statementError,false);
  }
});

test('current statement preserves exact inclusive-day range and normal success/error handling',async()=>{
  const f=fixture(),pending=f.statement();
  const query=new URL(f.requests[0].path,'https://finance.test').searchParams;
  assert.equal(query.get('from'),'2026-10-01T00:00:00.000Z');assert.equal(query.get('to'),'2026-10-03T00:00:00.000Z');
  const candidate={coverageComplete:false};f.requests[0].resolve(candidate);await pending;
  assert.equal(f.state.statement,candidate);assert.equal(f.renders[0],candidate);
  const invalid=f.statement();f.requests[1].resolve({invalid:true});await invalid;
  assert.equal(f.state.statement,null);assert.equal(f.state.statementError,true);assert.equal(f.notices.length,1);
});

test('retired export response creates no blob URL and triggers no download',async()=>{
  for(const kind of ['context','revision']){
    const f=fixture(),pending=f.download();f.change(kind);f.requests[0].resolve({oldAccountBytes:true});await pending;
    assert.deepEqual(f.urls,[]);assert.deepEqual(f.downloads,[]);assert.deepEqual(f.revoked,[]);
  }
});

test('retired export failure is silent but current failure remains visible',async()=>{
  const f=fixture(),pending=f.download();f.change('revision');f.requests[0].reject(new Error('old failure'));await pending;
  assert.deepEqual(f.notices,[]);
  const current=f.download();f.requests[1].reject(new Error('current failure'));await current;
  assert.equal(f.notices.length,1);assert.equal(f.notices[0].error.message,'current failure');
});

test('current export uses the requested filename and releases its URL',async()=>{
  const f=fixture(),pending=f.download(),blob={currentAccountBytes:true};
  assert.equal(f.requests[0].options.responseType,'blob');f.requests[0].resolve(blob);await pending;
  assert.equal(f.urls[0],blob);assert.deepEqual(f.downloads,[{href:'blob:owned-export',name:'observed.json'}]);assert.deepEqual(f.revoked,['blob:owned-export']);
});
