import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {WalletOperationLifecycle} from '../security/operationLifecycle';
import {createSignedNativeTransfer,ynxAddressFromEVM} from '@ynx-chain/wallet-auth';
import {NativeTransferOutbox,NATIVE_OUTBOX_PREFIX,NativeOutboxBlocked} from '../chain/nativeTransferOutbox';
import {NativeChainClient} from '../chain/nativeTransfer';
import {NATIVE_DURABILITY_MODEL} from '../chain/nativeDurability';
import {ModalActionGate} from './modalActionGate';

const app=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8');
const viewStart=app.indexOf('  const draftRevision=useRef(0)',app.indexOf('function SendModal(')),viewEnd=app.indexOf('  const [pasting,',viewStart);
const closeStart=app.indexOf('  const cancelInput=',viewEnd),closeEnd=app.indexOf('  useEffect(()=>{recipientInput.cancel();scope.cancel();setTo',closeStart);
const actStart=app.indexOf('  const act=async(mode:',closeEnd),actEnd=app.indexOf('  const problem=',actStart);
assert.ok(viewStart>=0&&viewEnd>viewStart&&closeStart>viewEnd&&closeEnd>closeStart&&actEnd>actStart);
// Same existing exact-caller extraction style. Only PUBLIC state/status-read
// stand-ins; this never signs/sends or exercises OS storage/device authority.
const viewProgram=ts.transpileModule(app.slice(viewStart,viewEnd)+app.slice(closeStart,closeEnd)+app.slice(actStart,actEnd)+'return {dismiss,cancelInput,invalidateDraft,act};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function viewCaller(){
  const operations=new WalletOperationLifecycle();operations.setAccount('PUBLIC A');const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish();
  const scope=operations.scope(),actionGate=new ModalActionGate(),refs:Array<{current:any}>=[],pending:Array<{resolve:(v:any)=>void;reject:(e:Error)=>void}>=[],events:string[]=[];
  let cursor=0;const ui:any={busy:false,error:null,stored:'PUBLIC original',loaded:true,closes:0,pasteClears:0};
  const context:any={scope,actionGate,useRef:(initial:any)=>{const index=cursor++;return refs[index]??(refs[index]={current:initial})},recipientInput:{cancel(){ui.pasteClears++}},
    setBusy:(v:boolean)=>{ui.busy=v},setPasting(){ui.pasteClears++},setRecipientAdded(){ui.pasteClears++},setError:(v:any)=>{ui.error=v},setStored:(v:any)=>{ui.stored=v},setLoaded:(v:any)=>{ui.loaded=v},close(){ui.closes++},message:(e:Error)=>e.message,
    storedChainClient:(origin:string)=>({origin}),chainClient:()=>({origin:'PUBLIC original'}),onSent(){events.push('onSent')},
    nativeOutbox:{read:async()=>{events.push('fallback');return null},checkStatus:(_account:any,_hash:any,_client:any,guard:()=>void)=>{guard();events.push('check');return new Promise((resolve,reject)=>pending.push({resolve,reject}))},sendNew:()=>assert.fail('No sign or broadcast in view-owner controls'),retry:()=>assert.fail('No resend'),acknowledge:()=>assert.fail('No acknowledgement')},
    walletPayFlow:{hasRetainedPayment:()=>assert.fail('No payment/sign preparation')}};
  const invoke=new Function(...Object.keys(context),'visible','account','scannedRecipient','reload','loaded','busy','stored','review','valid','to','amount',viewProgram);
  const render=(visible=true,owner='PUBLIC A')=>{cursor=0;return invoke(...Object.values(context),visible,{account:owner,accountPublicKey:'PUBLIC key'},'',0,true,false,{hash:'PUBLIC original',origin:'PUBLIC original'},true,true,'PUBLIC recipient','1')};
  return {scope,actionGate,pending,events,ui,render};
}
test('Send view owner: retained A dismiss and input cancel cannot touch reopened same-account B',()=>{
  const h=viewCaller(),old=h.render();old.dismiss();h.render(false);const current=h.render(),token=h.actionGate.acquire()!,lease=h.scope.begin({requireUnlocked:false});h.ui.busy=true;const before={...h.ui};
  old.dismiss();old.cancelInput();old.invalidateDraft();assert.equal(token.isCurrent(),true);assert.equal(lease.ownsScope(),true);assert.deepEqual(h.ui,before);current.dismiss();assert.equal(lease.ownsScope(),false);
});
test('Send view owner: current close cancels its own status read once and blocks late UI',async()=>{
  const h=viewCaller(),current=h.render(),pending=current.act('check');assert.equal(h.pending.length,1);current.dismiss();current.dismiss();assert.equal(h.ui.closes,1);const before={...h.ui};h.pending[0]!.resolve({phase:'accepted',marker:'old'});await pending;assert.deepEqual(h.ui,before);assert.deepEqual(h.events,['check']);
});
for(const result of ['success','failure'] as const)test(`Send view owner: late A ${result} and close cannot release B status operation`,async()=>{
  const h=viewCaller(),old=h.render(),first=old.act('check');old.dismiss();h.render(false);const current=h.render(),next=current.act('check');assert.equal(h.pending.length,2);old.dismiss();
  if(result==='success')h.pending[0]!.resolve({phase:'accepted',marker:'A'});else h.pending[0]!.reject(Error('PUBLIC old failure'));await first;assert.equal(h.ui.busy,true);assert.equal(h.ui.error,null);assert.equal(h.ui.stored,'PUBLIC original');assert.equal(h.ui.closes,1);assert.deepEqual(h.events,['check','check']);
  h.pending[1]!.resolve({phase:'unknown',marker:'B'});await next;assert.equal(h.ui.busy,false);assert.equal(h.ui.stored.marker,'B');
});
test('Send view owner: current close still works after draft revision changes',()=>{
  const h=viewCaller(),current=h.render();current.invalidateDraft();const token=h.actionGate.acquire()!,lease=h.scope.begin({requireUnlocked:false});h.ui.busy=true;current.dismiss();assert.equal(token.isCurrent(),false);assert.equal(lease.ownsScope(),false);assert.equal(h.ui.busy,false);assert.equal(h.ui.closes,1);
});
test('Send view owner: delayed parent visibility cannot revive a dismissed owner',async()=>{
  const h=viewCaller(),old=h.render();old.dismiss();const lag=h.render(true);await lag.act('check');lag.dismiss();assert.deepEqual(h.events,[]);assert.equal(h.ui.closes,1);h.render(false);const next=h.render(),pending=next.act('check');assert.equal(h.pending.length,1);h.pending[0]!.resolve({phase:'unknown'});await pending;
});
const start=app.indexOf('  useEffect(()=>{recipientInput.cancel();scope.cancel();setTo("")');
assert.ok(start>=0);
const effect=app.slice(start,app.indexOf('  const pasteRecipient=',start));
const source=ts.transpileModule(effect,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const defer=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve}};
async function flush(){for(let i=0;i<20;i++)await Promise.resolve()}
function mount({locked=false,owner='original',outbox,chain,onSent}: {locked?:boolean;owner?:string;outbox?:Pick<NativeTransferOutbox,'read'|'recover'>;chain?:(origin:string)=>NativeChainClient;onSent?:()=>void}={}){
  let now=1,cleanup:(()=>void)|undefined;
  const operations=new WalletOperationLifecycle(()=>now);operations.setAccount(owner);
  if(!locked){const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish()}
  const scope=operations.scope(),read=defer(),recover=defer(),calls:string[]=[],ui:Record<string,any>={};
  const context:any={useEffect:(fn:()=>void|(()=>void))=>{cleanup=fn()??undefined},recipientInput:{cancel(){}},scope,visible:true,account:{account:owner},scannedRecipient:'reviewed-recipient',reload:0,operations,onSentRef:{current:()=>{calls.push('sent');onSent?.()}},message:(e:Error)=>e.message,nativeOutbox:outbox??{read:()=>{calls.push('read');return read.promise},recover:(account:string,client:any,guard:()=>void)=>{guard();assert.equal(account,owner);assert.equal(client.origin,'https://original.example');calls.push('recover');return recover.promise}},storedChainClient:chain??((origin:string)=>({origin}))};
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

function journal(){
  // Public synthetic signing material only; no real profile/vault/device/network.
  const owner=ynxAddressFromEVM('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  const signed=createSignedNativeTransfer({accountSecret:'0'.repeat(63)+'1',to:ynxAddressFromEVM('0x'+'f'.repeat(40)),amount:25,nonce:7});
  const origin='https://rpc.ynxweb4.com',key=NATIVE_OUTBOX_PREFIX+owner;
  const values=new Map([[key,JSON.stringify({version:1,account:owner,origin,...signed,phase:'unknown',attempts:1,createdAt:'2026-10-03T01:00:00.000Z',updatedAt:'2026-10-03T01:00:01.000Z',replayed:null,durabilityEvidence:null})]]);
  const storage={getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value)},deleteItem:async()=>{throw Error('never delete originals')}};
  const checkpoint={version:NATIVE_DURABILITY_MODEL.version,scope:'local-snapshot',status:'durable',transactionHash:signed.hash,blockNumber:'0x2',blockHash:'0x'+'a'.repeat(64),checkpointBlockNumber:'0x2',checkpointBlockHash:'0x'+'a'.repeat(64),snapshotIntegrity:'0x'+'b'.repeat(64)};
  const receipt={transactionHash:signed.hash,from:signed.transaction.from,to:signed.transaction.to,blockNumber:checkpoint.blockNumber,blockHash:checkpoint.blockHash,status:'0x1',contractAddress:null,transactionIndex:'0x0',gasUsed:'0x5208',ynxNativeTransaction:{type:'transfer',amountYNXT:'25',feeYNXT:'1',nonce:'0x7'},ynxDurability:checkpoint};
  const gate=defer(),requests:string[]=[];let waiting=false;
  const chain=(requestedOrigin:string)=>{assert.equal(requestedOrigin,origin);return new NativeChainClient(requestedOrigin,async(url,init)=>{
    assert.equal(url,origin+'/evm');const request=JSON.parse(String(init?.body));requests.push(request.method);
    let result:unknown;
    if(request.method==='eth_chainId')result='0x1917';else if(request.method==='ynx_getDurabilityModel')result=NATIVE_DURABILITY_MODEL;
    else if(request.method==='eth_getTransactionReceipt'){assert.deepEqual(request.params,[signed.hash]);waiting=true;await gate.promise;result=receipt}
    else if(request.method==='ynx_getTransactionDurability'){assert.deepEqual(request.params,[signed.hash]);result=checkpoint}
    else throw Error('unexpected mutation or read');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200});
  })};
  return {owner,signed,origin,key,values,storage,gate,requests,chain,waiting:()=>waiting};
}
async function until(condition:()=>boolean){for(let i=0;i<100;i++){if(condition())return;await new Promise(resolve=>setImmediate(resolve))}assert.fail('controlled operation did not reach expected boundary')}
for(const boundary of ['lock','account','close'])test(`App + real outbox + chain ${boundary}: late checkpoint persists, cold reopen stays retained`,async()=>{
  const j=journal(),outbox=new NativeTransferOutbox(j.storage),x=mount({owner:j.owner,outbox,chain:j.chain});await until(j.waiting);
  if(boundary==='lock')x.operations.lock();if(boundary==='account')x.operations.setAccount('other');if(boundary==='close')x.close();
  j.gate.resolve(null);await until(()=>JSON.parse(j.values.get(j.key)!).phase==='accepted');await flush();
  assert.equal(x.ui.Stored,null);assert.equal(x.ui.Loaded,false);assert.ok(!x.calls.includes('sent'));
  const saved=JSON.parse(j.values.get(j.key)!);assert.equal(saved.hash,j.signed.hash);assert.equal(saved.payload,j.signed.payload);assert.equal(saved.origin,j.origin);assert.equal(saved.attempts,1);
  const reads=j.requests.length,restarted=new NativeTransferOutbox(j.storage),fresh=mount({owner:j.owner,outbox:restarted,chain:j.chain});await until(()=>fresh.ui.Loaded===true);
  assert.equal(fresh.ui.Stored.phase,'accepted');assert.equal(fresh.ui.Stored.hash,j.signed.hash);assert.equal(fresh.ui.To,'');assert.deepEqual(fresh.calls,['sent']);assert.equal(j.requests.length,reads,'validated retained checkpoint needs no new network query');
  await assert.rejects(restarted.sendNew(j.owner,j.chain(j.origin),()=>{},async()=>{throw Error('new signature forbidden')}),NativeOutboxBlocked);
  assert.equal(j.values.size,1,'no Done/history/payment release or replacement journal');
});
test('corrupt stored original cannot become a loaded empty form or perform RPC',async()=>{
  const j=journal();j.values.set(j.key,'{}');const before=j.values.get(j.key),x=mount({owner:j.owner,outbox:new NativeTransferOutbox(j.storage),chain:j.chain});await until(()=>x.ui.Error!==null);
  assert.equal(x.ui.Stored,null);assert.equal(x.ui.Loaded,false);assert.equal(x.ui.To,'');assert.deepEqual(j.requests,[]);assert.equal(j.values.get(j.key),before);
});
test('onSent account invalidation cannot publish accepted state or reviewed prefill afterward',async()=>{
  let x:ReturnType<typeof mount>;x=mount({onSent:()=>x.operations.setAccount('other')});x.read.resolve({phase:'unknown',origin:'https://original.example'});await flush();x.recover.resolve({phase:'accepted',origin:'https://original.example'});await flush();assert.deepEqual(x.calls,['read','recover','sent']);assert.equal(x.ui.Loaded,false);assert.equal(x.ui.Stored,null);assert.equal(x.ui.To,'');
});
