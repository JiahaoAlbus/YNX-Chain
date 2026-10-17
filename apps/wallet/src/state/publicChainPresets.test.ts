import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {PUBLIC_CHAIN_PRESETS,publicChainPreset,fillPublicChainPreset} from './publicChainPresets';
const desktop=process.env.PUBLIC_DESKTOP_DEFAULTS?pathToFileURL(process.env.PUBLIC_DESKTOP_DEFAULTS):new URL('../../../wallet-desktop/src/multichain-family-defaults.mjs',import.meta.url);
test('R66 mobile suggestions match the six existing Desktop provider/genesis rows exactly',async()=>{
 const {FAMILY_DEFAULT_NETWORKS}=await import(desktop.href);
 assert.deepEqual(PUBLIC_CHAIN_PRESETS,FAMILY_DEFAULT_NETWORKS.map((row:any)=>({family:row.family,network:row.network,rpcURL:row.rpcUrl,genesisBlockId:row.genesis})));
 assert.ok(Object.isFrozen(PUBLIC_CHAIN_PRESETS));assert.ok(PUBLIC_CHAIN_PRESETS.every(Object.isFrozen));
});
test('R66 unsupported family/network never silently falls back to mainnet',()=>{
 for(const [family,network] of [['bitcoin','testnet4'],['bitcoin','nile'],['tron','signet'],['ethereum','mainnet'],['bitcoin','MAINNET']]){
  assert.equal(publicChainPreset(family!,network!),null);assert.equal(fillPublicChainPreset({family:family!,network:network!}),null);
 }
});
test('R66 fill returns only public editable endpoint fields and never mutates the draft',()=>{
 const draft={family:'tron',network:'nile',address:'PUBLIC_ADDRESS_NOT_KEY',contract:'PUBLIC_CONTRACT',label:'Original',rpcURL:'https://custom.example',genesisBlockId:'a'.repeat(64)},before={...draft};
 const patch=fillPublicChainPreset(draft);assert.deepEqual(draft,before);
 assert.deepEqual(Object.keys(patch!).sort(),['genesisBlockId','rpcURL']);
 assert.equal(patch!.rpcURL,'https://nile.trongrid.io');assert.ok(Object.isFrozen(patch));
});
const source=readFileSync(process.env.PUBLIC_WATCH_MODAL_SOURCE?pathToFileURL(process.env.PUBLIC_WATCH_MODAL_SOURCE):new URL('./PublicChainWatchModal.tsx',import.meta.url),'utf8');
const start=source.indexOf('export function PublicChainWatchModal('),end=source.indexOf('  return <Modal visible',start);
const compiled=ts.transpileModule(source.slice(start,end).replace('export function','function')+"return {edit,draft,fillPreset:typeof fillPreset==='function'?fillPreset:null};}\nreturn PublicChainWatchModal(props);",{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function caller(){
 const slots:any[]=[],effects:Array<()=>void>=[];let cursor=0;
 const calls={load:0,edit:0,save:0,query:0};
 const EMPTY={phase:'idle',entries:[],selected:null,result:null,error:null};
 const context={EMPTY,NETWORKS:{bitcoin:['mainnet','testnet3','testnet4','signet'],tron:['mainnet','shasta','nile']},publicChainPreset,fillPublicChainPreset,
  useRef(value:any){const i=cursor++;if(!slots[i])slots[i]={value:{current:value}};return slots[i].value;},
  useState(value:any){const i=cursor++;if(!slots[i])slots[i]={value};return[slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},
  useEffect(effect:()=>void,deps:any[]){const i=cursor++;if(!slots[i])effects.push(()=>{slots[i]={deps};effect();});},
  PublicWatchStore:class{},PublicChainWatchController:class{snapshot(){return EMPTY}subscribe(){return()=>{}}load(){calls.load++;}edit(){calls.edit++;}save(){calls.save++;}query(){calls.query++;}close(){}},
  styles:{button:{},input:{}}
 };
 const invoke=new Function(...Object.keys(context),'props',compiled),props={account:'PUBLIC_ACTOR_NOT_PRINCIPAL',operations:{},storage:{},locale:'zh-CN',textScale:1,colors:{ink:'#000',blue:'#00f',white:'#fff'},close(){}};
 return{calls,render(){cursor=0;const result=invoke(...Object.values(context),props);while(effects.length)effects.shift()!();return result;}};
}
test('R66 opening normal modal leaves endpoint blank and does not auto-save or query',()=>{
 const h=caller(),view=h.render();assert.equal(view.draft.rpcURL,'');assert.equal(view.draft.genesisBlockId,'');assert.equal(h.calls.save,0);assert.equal(h.calls.query,0);assert.equal(h.calls.edit,0);
});
test('R66 explicit normal modal preset callback fills Bitcoin endpoint without changing user address',()=>{
 const h=caller();h.render();h.render().edit({address:'PUBLIC_BTC_ADDRESS',label:'My address',contract:''});
 const view=h.render();assert.equal(typeof view.fillPreset,'function');view.fillPreset();
 const next=h.render();assert.equal(next.draft.rpcURL,'https://blockstream.info/api');assert.equal(next.draft.address,'PUBLIC_BTC_ADDRESS');assert.equal(next.draft.label,'My address');assert.equal(next.draft.genesisBlockId,'');assert.equal(h.calls.save,0);assert.equal(h.calls.query,0);assert.equal(h.calls.edit,2);
});
test('R66 explicit normal modal TRON selection uses selected network genesis and keeps contract',()=>{
 const h=caller();h.render();h.render().edit({family:'tron',network:'shasta',address:'PUBLIC_TRON_ADDRESS',contract:'PUBLIC_TOKEN'});
 const view=h.render();assert.equal(typeof view.fillPreset,'function');view.fillPreset();
 const next=h.render();assert.equal(next.draft.rpcURL,'https://api.shasta.trongrid.io');assert.equal(next.draft.genesisBlockId,publicChainPreset('tron','shasta')!.genesisBlockId);assert.equal(next.draft.contract,'PUBLIC_TOKEN');assert.equal(next.draft.address,'PUBLIC_TRON_ADDRESS');assert.equal(h.calls.save,0);assert.equal(h.calls.query,0);
});
test('R66 manual-only network callback does not overwrite custom endpoint',()=>{
 const h=caller();h.render();h.render().edit({network:'testnet4',rpcURL:'https://custom.example/api',genesisBlockId:''});
 const view=h.render();assert.equal(typeof view.fillPreset,'function');view.fillPreset();assert.equal(h.render().draft.rpcURL,'https://custom.example/api');assert.equal(h.calls.edit,1);
});
test('R66 UI exposes explicit fill with unverified/manual copy and keeps watch-only boundary',()=>{
 assert.match(source,/Fill provider preset/);assert.match(source,/未验证/);assert.match(source,/手动配置/);assert.match(source,/watch only/);assert.doesNotMatch(source,/accountSecret|accountMnemonic|sendNew|broadcast\(/);
});
