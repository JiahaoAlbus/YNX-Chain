import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createSessionRecoveryUI} from '../src/wallet-session-recovery-ui.mjs';
function fixture(){
 const nodes=new Map(),node=()=>({children:[],textContent:'',disabled:false,setAttribute(){},append(...items){this.children.push(...items);for(const item of items)if(item.id)nodes.set(item.id,item);},replaceChildren(...items){this.children=[...items];},addEventListener(name,fn){this[name]=fn;}}),root=node(),document={createElement:node,querySelector:()=>root};
 const state={account:'0x'+'1'.repeat(40),revision:1,locked:false,authenticating:false};let lists=0,reads=0;
 const api={async sessionPublicationRecords(){lists++;return {ok:true,value:[{requestDigest:'digest-original',productId:'finance',signed:true,publicationStatus:'publish-unknown'}]};},async sessionPublicationOutcome(digest){reads++;assert.equal(digest,'digest-original');return {ok:true,value:{state:'pending',expired:true,retryAuthorized:false,callbackEmitted:false,productSessionCreated:false}};}};
 const ui=createSessionRecoveryUI({api,getKeyState:()=>state,document});ui.render();const section=root.children[0],refresh=section.children[2],rows=section.children[3],output=section.children[4];
 return {api,state,ui,refresh,rows,output,counts:()=>({lists,reads})};
}
test('mounted recovery UI reads local records then explicitly queries one original, never auto-polls or claims a new grant',async()=>{
 const f=fixture();assert.deepEqual(f.counts(),{lists:0,reads:0});await f.refresh.click();assert.deepEqual(f.counts(),{lists:1,reads:0});
 await f.rows.children[0].children[1].click();assert.deepEqual(f.counts(),{lists:1,reads:1});assert.match(f.output.textContent,/Request expired/);assert.match(f.output.textContent,/no new grant or callback/);
});
test('mounted recovery UI discards late response after lock/account change and clears prior account records',async()=>{
 const f=fixture();await f.refresh.click();let release;f.api.sessionPublicationOutcome=()=>new Promise(resolve=>{release=resolve;});
 const waiting=f.rows.children[0].children[1].click();f.state.locked=true;f.state.revision++;f.ui.render();release({ok:true,value:{state:'completed',retryAuthorized:false,callbackEmitted:false,productSessionCreated:false}});await waiting;
 assert.equal(f.rows.children.length,0);assert.equal(f.output.textContent,'');assert.equal(f.refresh.disabled,true);
 f.state.locked=false;f.state.account='0x'+'2'.repeat(40);f.state.revision++;f.ui.render();assert.equal(f.rows.children.length,0);assert.equal(f.refresh.disabled,false);
});
test('mounted recovery UI refuses malformed outcome success flags and preserves UNKNOWN messaging',async()=>{
 const f=fixture();await f.refresh.click();f.api.sessionPublicationOutcome=async()=>({ok:true,value:{state:'completed',retryAuthorized:true,callbackEmitted:false,productSessionCreated:false}});
 await f.rows.children[0].children[1].click();assert.match(f.output.textContent,/retained, no automatic retry/);
});
test('actual preload and main handler bodies route mounted UI reads only through the sensitive original authority',async()=>{
 const f=fixture(),local=f.api.sessionPublicationRecords,read=f.api.sessionPublicationOutcome,handlers=new Map();let sensitive=0,exposed;
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf("handleWalletIPC('wallet:session-publication-records'"),end=main.indexOf('\nhandleWalletIPC("wallet:password-setup"',start);
 assert.ok(start>=0&&end>start);
 runInNewContext(main.slice(start,end),{handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:async action=>{sensitive++;return {ok:true,value:await action()};},walletAuthority:{canonicalPublicationRecords:async()=> (await local()).value,readCanonicalPublicationOutcome:async digest=>(await read(digest)).value}});
 runInNewContext(await readFile(new URL('../src/preload.cjs',import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'ynxWallet');exposed=value;}},ipcRenderer:{invoke:(name,...args)=>handlers.get(name)({},...args)}};}});
 f.api.sessionPublicationRecords=exposed.sessionPublicationRecords;f.api.sessionPublicationOutcome=exposed.sessionPublicationOutcome;
 await f.refresh.click();await f.rows.children[0].children[1].click();assert.equal(sensitive,2);assert.deepEqual(f.counts(),{lists:1,reads:1});assert.match(f.output.textContent,/Read only/);
});
