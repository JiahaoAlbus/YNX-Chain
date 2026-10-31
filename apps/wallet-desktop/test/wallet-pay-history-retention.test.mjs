import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopPayUI,mountDesktopPayUI} from '../src/wallet-pay-ui.mjs';
import {fileInputDOM} from './fixture-file-input-dom.mjs';
const account='PUBLIC-account';
const row=n=>({account,chainId:'ynx_6423-1',asset:'YNXT',hash:'0x'+n.toString(16).padStart(64,'0'),invoiceId:'inv_'+n.toString(16).padStart(20,'0'),merchant:'Merchant '+n,recipient:'PUBLIC-recipient',amount:25,fee:1,total:26,status:'archived',checkpointVerified:true,settlementVerified:true,settlementAttempted:true,broadcastAttempted:true,consensusFinality:false});
function fixture(){
 const context={open:true,account,keyRevision:1,locked:false},requests=[],views=[];let read,notify=()=>{},actions=0;
 const api={payCancel:async()=>({ok:true}),payStatus:async()=>({ok:true,value:{available:true,paymentAuthorized:false}}),payRestore:async()=>({ok:true,value:{kind:'original',original:null}}),payHistory:async cursor=>{requests.push(cursor);return{ok:true,value:await read(cursor)}},payAction:async()=>{actions++;throw Error('Unexpected action')},onSecurityState:f=>notify=f,onAccountStatus:f=>notify=f};
 const ui=createDesktopPayUI({api,getContext:()=>({...context}),render:v=>views.push(v)});
 return{context,requests,views,api,ui,read:f=>read=f,notify:()=>notify(),actions:()=>actions};
}
test('same-account Pay refresh failure preserves verified history and its exclusive older-page cursor',async()=>{
 const f=fixture();let failed=false;
 f.read(async cursor=>{if(failed)throw Error('PUBLIC unavailable');return{account,records:[row(cursor?1:2)],nextCursor:cursor?null:row(2).hash}});
 await f.ui.open();assert.equal((await f.ui.history()).length,1);failed=true;assert.equal(await f.ui.history(),null);
 assert.equal(f.views.at(-1).historyCursor,row(2).hash);assert.ok(f.views.at(-1).error);
 failed=false;const older=await f.ui.history(true);assert.deepEqual(older.map(r=>r.hash),[row(2).hash,row(1).hash]);assert.deepEqual(f.requests,[null,null,row(2).hash]);assert.equal(f.actions(),0);
});
test('history ownership changes retire the retained cursor without sending it for another actor',async()=>{
 for(const kind of ['account','keyRevision']){
  const f=fixture();f.read(async()=>({account,records:[row(2)],nextCursor:row(2).hash}));await f.ui.open();await f.ui.history();
  if(kind==='account')f.context.account='PUBLIC-other';else f.context.keyRevision++;
  assert.equal(await f.ui.history(true),null);assert.equal(f.views.at(-1).historyCursor,null);assert.deepEqual(f.requests,[null]);assert.equal(f.actions(),0);
 }
});
test('mounted Pay keeps verified receipt rows through a pending failed refresh and removes them on account change',async()=>{
 const f=fixture(),nodes=new Map(),make=()=>({open:false,value:'',hidden:false,disabled:false,textContent:'',children:[],listeners:new Map(),addEventListener(t,fn){this.listeners.set(t,fn)},emit(t,event={}){return this.listeners.get(t)?.(event)},showModal(){this.open=true},close(){this.open=false;this.emit('close')},focus(){},replaceChildren(){this.children=[]},append(...children){this.children.push(...children)}}),get=s=>{if(!nodes.has(s))nodes.set(s,make());return nodes.get(s)};
 let reject,reads=0;f.read(cursor=>{if(++reads===2)return new Promise((_,no)=>reject=no);return{account,records:[row(cursor?1:2)],nextCursor:cursor?null:row(2).hash}});
 mountDesktopPayUI({document:{querySelector:s=>fileInputDOM(get(s),next=>nodes.set(s,next)),createElement:make},api:f.api,getContext:()=>({...f.context})});
 get('#open-protected-pay').emit('click');await new Promise(r=>setImmediate(r));await get('#protected-pay-history').emit('click');
 const list=get('#protected-pay-history-list'),saved=list.children[0],pending=get('#protected-pay-history').emit('click');
 assert.equal(list.children[0],saved);reject(Error('PUBLIC read failed'));await pending;
 assert.equal(list.children[0],saved);assert.match(get('#protected-pay-status').textContent,/could not be verified/);assert.equal(get('#protected-pay-older').hidden,false);
 await get('#protected-pay-older').emit('click');assert.equal(list.children.length,2);assert.deepEqual(f.requests,[null,null,row(2).hash]);
 f.context.account='PUBLIC-other';f.context.keyRevision++;f.notify();assert.equal(list.children.length,0);assert.equal(f.actions(),0);
});
