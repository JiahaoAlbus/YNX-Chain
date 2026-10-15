import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WalletOperationLifecycle} from '../security/operationLifecycle';
import {tronPublicAddress} from '../chain/tronRead';
import {PUBLIC_WATCH_PREFIX,PublicChainWatchController,PublicWatchStore,type PublicWatchAddress} from './publicChainWatch';
import ts from 'typescript';

const A='ynx1'+'q'.repeat(38),B='ynx1'+'p'.repeat(38); // PUBLIC non-principal fixture IDs.
const BTC='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',TRON='TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const BTC_GENESIS='000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',TRON_GENESIS='a'.repeat(64);
const btc:PublicWatchAddress={family:'bitcoin',network:'mainnet',address:BTC,rpcURL:'https://btc.example/api',label:'PUBLIC BTC'};
const trx:PublicWatchAddress={family:'tron',network:'nile',address:TRON,rpcURL:'https://tron.example',genesisBlockId:TRON_GENESIS,label:'PUBLIC TRON'};
const wait=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {promise,resolve}};
async function flush(){for(let i=0;i<30;i++)await Promise.resolve()}
class PublicMemory{
  data=new Map<string,string>();reads:string[]=[];writes:Array<{key:string;value:string}>=[];
  get authenticatedSecrets():never{throw Error('Private storage must never be accessed')}
  async getItem(key:string){this.reads.push(key);return this.data.get(key)??null}
  async setItem(key:string,value:string){this.writes.push({key,value});this.data.set(key,value)}
}
function json(value:unknown){return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})}
function provider(){
  const calls:Array<{url:string;body?:string}>=[];
  const fetchImpl:typeof fetch=async(input,init)=>{const url=String(input);calls.push({url,body:init?.body as string|undefined});
    if(url.startsWith(btc.rpcURL))return url.endsWith('/block-height/0')?new Response(BTC_GENESIS,{headers:{'content-type':'text/plain'}}):json([{txid:'b'.repeat(64),vout:0,value:'123456789',status:{confirmed:true,block_height:1,block_hash:'c'.repeat(64)}}]);
    if(url.endsWith('/getblockbynum'))return json({blockID:TRON_GENESIS,block_header:{raw_data:{number:0}}});
    return json({address:tronPublicAddress(TRON).hex,balance:'1234567'});
  };return {fetchImpl,calls};
}
function fixture(storage=new PublicMemory(),account=A,fetchImpl=provider().fetchImpl,now:()=>number=Date.now){
  const operations=new WalletOperationLifecycle(now);operations.setAccount(account);const lease=operations.scope().begin({requireUnlocked:false});operations.unlock(lease);lease.finish();
  const store=new PublicWatchStore(storage),controller=new PublicChainWatchController(operations,account,store,fetchImpl);return {storage,operations,store,controller};
}
test('Watch caller: add persist reopen select BTC query uses actual reader and precise public result',async()=>{
  const p=provider(),h=fixture(new PublicMemory(),A,p.fetchImpl);await h.controller.load();await h.controller.save(btc);assert.equal(h.controller.snapshot().selected,h.controller.snapshot().entries[0]);await h.controller.query();
  const state=h.controller.snapshot();assert.equal(state.phase,'ready');assert.equal(state.selected?.address,BTC);assert.equal(state.result?.family,'bitcoin');if(state.result?.family!=='bitcoin')throw Error('wrong family');assert.equal(state.result.totalSats,'123456789');assert.equal(state.result.totalBTC,'1.23456789');assert.equal(p.calls.length,3);assert.equal(state.result.watchOnly,true);h.controller.close();
  const reopened=fixture(h.storage);await reopened.controller.load();assert.equal(reopened.controller.snapshot().entries[0]?.address,BTC);assert.equal(reopened.controller.snapshot().result,null);assert.equal(reopened.controller.snapshot().selected,null);reopened.controller.select(0);assert.equal(reopened.controller.snapshot().selected?.address,BTC);reopened.controller.close();
});
test('Watch caller: native TRON address selection reaches real reader with explicit network and source',async()=>{
  const p=provider(),h=fixture(new PublicMemory(),A,p.fetchImpl);await h.controller.save(trx);await h.controller.query();const state=h.controller.snapshot();assert.equal(state.phase,'ready');if(state.result?.family!=='tron')throw Error('wrong family');assert.equal(state.result.trx.sun,'1234567');assert.equal(state.result.trx.display,'1.234567');assert.equal(state.result.network,'nile');assert.equal(state.result.address,TRON);assert.equal(state.result.source.rpcURL,trx.rpcURL);assert.equal(p.calls.length,2);assert.ok(p.calls.every(c=>!/sign|broadcast|triggersmart/.test(c.url)));h.controller.close();
});
test('Watch caller: per-Wallet-account storage isolation and no authenticated storage or native manifest writes',async()=>{
  const storage=new PublicMemory(),a=fixture(storage);await a.controller.save(btc);a.controller.close();const b=fixture(storage,B);await b.controller.load();assert.equal(b.controller.snapshot().entries.length,0);await b.controller.save(trx);assert.ok(storage.writes.every(w=>w.key.startsWith(PUBLIC_WATCH_PREFIX)));assert.deepEqual([...storage.data.keys()].sort(),[PUBLIC_WATCH_PREFIX+A,PUBLIC_WATCH_PREFIX+B].sort());assert.ok(!JSON.stringify([...storage.data.values()]).includes('secretHex'));b.controller.close();
});
test('Watch caller: corrupt or foreign records are retained and never silently replaced',async()=>{
  for(const raw of ['{broken',JSON.stringify({schemaVersion:1,walletAccount:B,entries:[btc]})]){const storage=new PublicMemory();storage.data.set(PUBLIC_WATCH_PREFIX+A,raw);const h=fixture(storage);await h.controller.load();assert.equal(h.controller.snapshot().phase,'failed');await h.controller.save(btc);assert.equal(h.controller.snapshot().phase,'failed');assert.equal(storage.data.get(PUBLIC_WATCH_PREFIX+A),raw);assert.equal(storage.writes.length,0);h.controller.close()}
});
test('Watch caller: invalid family address endpoint or secret-bearing input fails before writes and fetch',async()=>{
  for(const input of [{...btc,address:'ynx1public'},{...trx,address:'0x'+'11'.repeat(20)},{...btc,rpcURL:'http://localhost'},{...trx,genesisBlockId:'0'.repeat(64)},{...btc,secretHex:'PUBLIC NOT KEY'}]){const p=provider(),h=fixture(new PublicMemory(),A,p.fetchImpl);await h.controller.save(input);assert.equal(h.controller.snapshot().phase,'failed');assert.equal(h.storage.writes.length,0);assert.equal(p.calls.length,0);h.controller.close()}
});
test('Watch caller: duplicate query admission leaves first request and busy state intact',async()=>{
  const pending=wait<Response>();let requests=0;const h=fixture(new PublicMemory(),A,async()=>{requests++;return pending.promise});await h.controller.save(btc);const first=h.controller.query();await h.controller.query();assert.equal(h.controller.snapshot().phase,'querying');assert.equal(requests,1);h.controller.cancel();await first;assert.equal(h.controller.snapshot().phase,'idle');assert.equal(h.controller.snapshot().result,null);pending.resolve(new Response(BTC_GENESIS));h.controller.close();
});
test('Watch caller: cancel and switch address cannot let old BTC result overwrite TRON',async()=>{
  const pending=wait<Response>(),p=provider();const h=fixture(new PublicMemory(),A,async(input,init)=>String(input).startsWith(btc.rpcURL)?pending.promise:p.fetchImpl(input,init));await h.controller.save(btc);await h.controller.save(trx);h.controller.select(0);const old=h.controller.query();h.controller.select(1);await h.controller.query();assert.equal(h.controller.snapshot().result?.family,'tron');pending.resolve(new Response(BTC_GENESIS));await old;assert.equal(h.controller.snapshot().result?.family,'tron');h.controller.close();
});
for(const boundary of ['lock','account','background','close'])test(`Watch caller: ${boundary} clears visible state and fences late provider`,async()=>{
  const pending=wait<Response>(),h=fixture(new PublicMemory(),A,()=>pending.promise);await h.controller.save(btc);const old=h.controller.query();if(boundary==='lock')h.operations.lock();else if(boundary==='account')h.operations.setAccount(B);else if(boundary==='background')h.operations.setAppState('background');else h.controller.close();await old;pending.resolve(new Response(BTC_GENESIS));await flush();assert.equal(h.controller.snapshot().phase,'closed');assert.equal(h.controller.snapshot().result,null);assert.equal(h.controller.snapshot().selected,null);assert.equal(h.controller.snapshot().entries.length,0);assert.equal(h.controller.close(),false);
});
test('Watch caller: started cancelled public save is not rolled back; reopen reconciles original owner',async()=>{
  const storage=new PublicMemory(),pending=wait<void>(),set=storage.setItem.bind(storage);let started=false;storage.setItem=async(key,value)=>{started=true;await pending.promise;await set(key,value)};const h=fixture(storage),save=h.controller.save(btc);await flush();assert.equal(started,true);h.controller.cancel();pending.resolve();await save;assert.equal(h.controller.snapshot().phase,'idle');assert.equal(h.controller.snapshot().selected,null);h.controller.close();const reopened=fixture(storage);await reopened.controller.load();assert.equal(reopened.controller.snapshot().entries[0]?.address,BTC);assert.equal(storage.writes.length,1);reopened.controller.close();
});
test('Watch caller: genuine provider failure is unavailable, never fabricated zero balance',async()=>{
  const h=fixture(new PublicMemory(),A,async()=>new Response('unavailable',{status:503}));await h.controller.save(btc);await h.controller.query();assert.equal(h.controller.snapshot().phase,'failed');assert.equal(h.controller.snapshot().result,null);assert.equal(h.controller.snapshot().error,'BTC_HTTP_RESPONSE');h.controller.close();
});
test('Watch caller: expired current read fails closed without leaving indefinite busy',async()=>{
  let now=0;const pending=wait<Response>(),h=fixture(new PublicMemory(),A,()=>pending.promise,()=>now);await h.controller.save(btc);const task=h.controller.query();now=120001;pending.resolve(new Response(BTC_GENESIS,{headers:{'content-type':'text/plain'}}));await task;assert.equal(h.controller.snapshot().phase,'failed');assert.equal(h.controller.snapshot().result,null);assert.equal(h.controller.snapshot().error,'WALLET_OPERATION_CANCELLED');h.controller.close();
});
test('Watch caller: failed or uncertain storage write is not reported as success or zero',async()=>{
  const storage=new PublicMemory();storage.setItem=async()=>{throw Error('PUBLIC OS store failure')};const h=fixture(storage);await h.controller.save(btc);assert.equal(h.controller.snapshot().phase,'failed');assert.equal(h.controller.snapshot().error,'WATCH_SAVE_FAILED_OR_UNCERTAIN');assert.equal(h.controller.snapshot().entries.length,0);assert.equal(h.controller.snapshot().selected,null);h.controller.close();
});
test('Watch caller: editing clears selection and old result; no automatic query on load or save',async()=>{
  const p=provider(),h=fixture(new PublicMemory(),A,p.fetchImpl);await h.controller.load();await h.controller.save(btc);assert.equal(p.calls.length,0);await h.controller.query();assert.ok(h.controller.snapshot().result);h.controller.edit();assert.equal(h.controller.snapshot().selected,null);assert.equal(h.controller.snapshot().result,null);const count=p.calls.length;await h.controller.query();assert.equal(p.calls.length,count);h.controller.close();
});
test('Watch caller: synchronous cancellation from loading listener prevents storage admission',async()=>{
  const h=fixture();h.controller.subscribe(state=>{if(state.phase==='loading')h.controller.cancel()});await h.controller.load();assert.equal(h.storage.reads.length,0);assert.equal(h.controller.snapshot().phase,'idle');h.controller.close();
});
test('Watch caller: Dashboard real entry and modal normal controls bind public QR, never signing or custody',()=>{
  const app=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8'),ui=readFileSync(new URL('./PublicChainWatchModal.tsx',import.meta.url),'utf8');assert.match(app,/setPublicWatch\(true\)/);assert.match(app,/<PublicChainWatchModal key=\{selected\.account\} account=\{selected\.account\} operations=\{operations\} storage=\{platformSecureStorage\}/);assert.match(ui,/new PublicChainWatchController/);assert.match(ui,/current\.load\(\)/);assert.match(ui,/controller\.current\?\.save/);assert.match(ui,/controller\.current\?\.query/);assert.match(ui,/controller\.current\?\.cancel/);assert.match(ui,/<QRCodeView value=\{selected\.address\}/);assert.match(ui,/watch only/);assert.doesNotMatch(ui,/accountMnemonic|accountSecret|authorizeLocalKeyUse|sendNew|broadcast\(/);
});

// Execute actual modal hook/callback body, without mounting RN or OS UI.
const modalSource=readFileSync(new URL('./PublicChainWatchModal.tsx',import.meta.url),'utf8');
const modalStart=modalSource.indexOf('export function PublicChainWatchModal('),modalEnd=modalSource.indexOf('  return <Modal visible',modalStart);assert.ok(modalStart>=0&&modalEnd>modalStart);
const modalProgram=ts.transpileModule(modalSource.slice(modalStart,modalEnd).replace('export function','function')+'return {save,choose,dismiss,edit,snapshot,draft,controller};}\nreturn PublicChainWatchModal(props);',{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function modalCaller(storage=new PublicMemory()){
  const p=provider(),h=fixture(storage,A,p.fetchImpl);h.controller.close(); // Use actual UI-created controller below.
  const slots:any[]=[],effects:Array<()=>void>=[];let cursor=0,closes=0;
  const changes=(a:any[],b:any[])=>!a||a.length!==b.length||a.some((value,index)=>value!==b[index]);
  const context={EMPTY:{phase:'idle',entries:[],selected:null,result:null,error:null},NETWORKS:{bitcoin:['mainnet','testnet3','testnet4','signet'],tron:['mainnet','shasta','nile']},
    useRef(value:any){const i=cursor++;if(!slots[i])slots[i]={value:{current:value}};return slots[i].value},
    useState(value:any){const i=cursor++;if(!slots[i])slots[i]={value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next}]},
    useEffect(effect:()=>void|(()=>void),deps:any[]){const i=cursor++,old=slots[i];if(!old||changes(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,effect,cleanup:effect()}})},
    PublicWatchStore,PublicChainWatchController:class extends PublicChainWatchController{constructor(ops:WalletOperationLifecycle,account:string,store:PublicWatchStore){super(ops,account,store,p.fetchImpl)}},
    styles:{button:{},input:{}}};
  const invoke=new Function(...Object.keys(context),'props',modalProgram),props={account:A,operations:h.operations,storage,locale:'en',textScale:1,colors:{ink:'#000',blue:'#00f',white:'#fff'},close:()=>closes++};
  const render=()=>{cursor=0;const view=invoke(...Object.values(context),props);while(effects.length)effects.shift()!();return view};
  return {render,storage,provider:p,closes:()=>closes,unmount:()=>{for(const slot of slots)slot?.cleanup?.()},replay:()=>{for(const slot of slots)slot?.cleanup?.();for(const slot of slots)if(slot?.effect)slot.cleanup=slot.effect()}};
}
test('Watch modal caller: real add/select/query callbacks publish public balance through UI state',async()=>{
  const h=modalCaller();h.render();await flush();h.render().edit({...btc,genesisBlockId:'',contract:''});h.render().save();await flush();const view=h.render();assert.equal(view.snapshot.entries.length,1);assert.equal(view.snapshot.selected.address,BTC);await view.controller.current.query();assert.equal(h.render().snapshot.result.totalBTC,'1.23456789');assert.equal(h.provider.calls.length,3);h.unmount();
});
test('Watch modal caller: duplicate close and retained unmounted callback do not close parent twice',async()=>{
  const h=modalCaller(),old=h.render();await flush();old.dismiss();old.dismiss();assert.equal(h.closes(),1);h.unmount();old.dismiss();assert.equal(h.closes(),1);
});
test('Watch modal caller: effect replay creates fresh controller, not a permanently closed one',async()=>{
  const h=modalCaller();h.render();await flush();h.replay();await flush();assert.equal(h.render().snapshot.phase,'idle');h.render().edit({...btc,genesisBlockId:'',contract:''});h.render().save();await flush();assert.equal(h.render().snapshot.entries.length,1);h.unmount();assert.equal(h.closes(),0);
});
test('Watch modal caller: late old storage read cannot replace replayed current UI',async()=>{
  const storage=new PublicMemory(),pending=wait<string|null>(),get=storage.getItem.bind(storage);let first=true;storage.getItem=async key=>{if(first){first=false;return pending.promise}return get(key)};const h=modalCaller(storage);h.render();h.replay();await flush();assert.equal(h.render().snapshot.phase,'idle');pending.resolve('{broken old PUBLIC record');await flush();assert.equal(h.render().snapshot.phase,'idle');assert.equal(h.render().snapshot.error,null);h.unmount();
});
