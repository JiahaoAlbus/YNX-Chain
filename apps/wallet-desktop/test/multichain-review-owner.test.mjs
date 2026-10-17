import test from 'node:test';
import assert from 'node:assert/strict';
import {createBitcoinTransferUI} from '../src/multichain-family-bitcoin-ui.mjs';
import {createTronTransferUI} from '../src/multichain-family-tron-ui.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
function fixture(family){
 class Node{constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.value='';this.ownerDocument={};}append(...n){this.children.push(...n)}replaceChildren(){this.children=[]}setAttribute(){}addEventListener(e,f){this.handlers[e]=f}}
 const parent=new Node('div'),context={account:'PUBLIC-owner',revision:1,locked:false},selection={family,network:family==='bitcoin'?'mainnet':'nile'},cancelled=[];
 let next=0;const record=()=>({id:`PUBLIC-${++next}`,family,network:selection.network,vaultAccount:context.account,state:'prepared',signingSupported:false,broadcastSupported:false,from:'PUBLIC-from',to:'PUBLIC-to',amount:'1',symbol:'TRX',maxFeeSun:'1000',fees:{totalSun:'1',budgetScope:'provider-upper-bound'},maxFeeSats:'1000',feeSats:'1',estimatedVbytes:100,endpoint:'https://public.example'});
 const route=family==='bitcoin'?'Bitcoin':'Tron',api={[`family${route}Prepare`]:async()=>({ok:true,value:record()}),[`family${route}Cancel`]:async({id})=>{cancelled.push(id);return {ok:true,value:{id,state:'cancelled'}}}};
 const ui=(family==='bitcoin'?createBitcoinTransferUI:createTronTransferUI)({document:{createElement:tag=>new Node(tag)},parent,api,getContext:()=>context,getSelection:()=>selection,isOpen:()=>true});
 const all=()=>{const out=[];function visit(n){out.push(n);n.children.forEach(visit)}visit(parent);return out},buttons=all().filter(n=>n.tag==='button'),prepare=buttons[family==='bitcoin'?0:1],cancel=buttons[family==='bitcoin'?1:2];
 return {api,route,ui,prepare,cancel,cancelled,context,all};
}
for(const family of ['bitcoin','tron'])test(`R42 ${family} retired pre-review cancellation cannot erase a successor review or its ID`,async()=>{
 const f=fixture(family);await f.prepare.handlers.click();
 const gate=deferred(),entered=deferred(),cancel=f.api[`family${f.route}Cancel`];let first=true;
 f.api[`family${f.route}Cancel`]=async input=>{if(first){first=false;entered.resolve();await gate.promise}return cancel(input)};
 const retired=f.prepare.handlers.click();await entered.promise;
 f.context.revision++;f.ui.invalidate();await f.prepare.handlers.click();
 assert(f.all().some(n=>n.textContent==='prepared'));assert(f.all().some(n=>n.textContent===': PUBLIC-to'));assert.equal(f.cancel.disabled,false);
 gate.resolve();await retired;
 assert(f.all().some(n=>n.textContent==='prepared'),'successor status remains');assert(f.all().some(n=>n.textContent===': PUBLIC-to'),'successor review facts remain');assert.equal(f.cancel.disabled,false,'successor ID remains cancellable');
 await f.cancel.handlers.click();assert.equal(f.cancelled.at(-1),'PUBLIC-2');assert(f.all().some(n=>n.textContent==='cancelled'));
});
