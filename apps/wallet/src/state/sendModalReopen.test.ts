import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {WalletOperationLifecycle} from '../security/operationLifecycle';

const app=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8');
const start=app.indexOf('  useEffect(()=>{recipientInput.cancel();scope.cancel();setTo("")');
assert.ok(start>=0);
const effect=app.slice(start,app.indexOf('  const pasteRecipient=',start));
const source=ts.transpileModule(effect,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const defer=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve}};
async function flush(){for(let i=0;i<20;i++)await Promise.resolve()}
function mount({locked=false}={}){
  let now=1,cleanup:(()=>void)|undefined;
  const operations=new WalletOperationLifecycle(()=>now);operations.setAccount('original');
  if(!locked){const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish()}
  const scope=operations.scope(),read=defer(),recover=defer(),calls:string[]=[],ui:Record<string,any>={};
  const context:any={useEffect:(fn:()=>void|(()=>void))=>{cleanup=fn()??undefined},recipientInput:{cancel(){}},scope,visible:true,account:{account:'original'},scannedRecipient:'reviewed-recipient',reload:0,operations,onSentRef:{current:()=>calls.push('sent')},message:(e:Error)=>e.message,nativeOutbox:{read:()=>{calls.push('read');return read.promise},recover:(account:string,client:any,guard:()=>void)=>{guard();assert.equal(account,'original');assert.equal(client.origin,'https://original.example');calls.push('recover');return recover.promise}},storedChainClient:(origin:string)=>({origin})};
  for(const key of ['To','Amount','Review','Busy','Pasting','RecipientAdded','Error','Stored','Loaded'])context['set'+key]=(value:any)=>{ui[key]=value};
  vm.runInNewContext(source,context);
  return {operations,scope,read,recover,calls,ui,close:()=>cleanup?.(),expire:()=>{now+=120_000}};
}
test('actual SendModal effect retains accepted original without acknowledgement or signing',async()=>{
  const x=mount();x.read.resolve({phase:'unknown',origin:'https://original.example'});await flush();x.recover.resolve({phase:'accepted',origin:'https://original.example'});await flush();
  assert.deepEqual(x.calls,['read','recover','sent']);assert.equal(x.ui.Stored.phase,'accepted');assert.equal(x.ui.Loaded,true);assert.equal(x.ui.Busy,false);
  assert.doesNotMatch(effect,/\.acknowledge\(|\.sendNew\(|\.retry\(|\.broadcast\(/);
});
for(const boundary of ['lock','account','background','inactive','expiry','close'])test(`real lifecycle ${boundary} fences a late original recovery`,async()=>{
  const x=mount();x.read.resolve({phase:'unknown',origin:'https://original.example'});await flush();assert.ok(x.calls.includes('recover'));
  if(boundary==='lock')x.operations.lock();if(boundary==='account')x.operations.setAccount('other');if(boundary==='background'||boundary==='inactive')x.operations.setAppState(boundary);if(boundary==='expiry')x.expire();if(boundary==='close')x.close();
  x.recover.resolve({phase:'accepted',origin:'https://original.example'});await flush();assert.equal(x.ui.Stored,null);assert.equal(x.ui.Loaded,false);assert.equal(x.ui.To,'');assert.ok(!x.calls.includes('sent'));
});
test('account rotation during read prevents original recovery entirely',async()=>{
  const x=mount();x.operations.setAccount('other');x.read.resolve({phase:'unknown',origin:'https://original.example'});await flush();assert.deepEqual(x.calls,['read']);assert.equal(x.ui.Loaded,false);
});
test('locked reopen never starts IO; current empty outbox alone permits reviewed prefill',async()=>{
  const locked=mount({locked:true});await flush();assert.deepEqual(locked.calls,[]);assert.equal(locked.ui.Loaded,false);
  for(const value of [null,{phase:'done'}]){const x=mount();x.read.resolve(value);await flush();assert.deepEqual(x.calls,['read']);assert.equal(x.ui.To,'reviewed-recipient');assert.equal(x.ui.Loaded,true)}
});
