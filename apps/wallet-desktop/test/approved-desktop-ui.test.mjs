import {createPQBackupUI} from '../src/pq-backup-ui.mjs';
import {createRegisteredPQRestoreUI} from '../src/wallet-pq-restore-ui.mjs';
import {createPQKeyPreparationUI} from '../src/wallet-pq-key-ui.mjs';
import vm from 'node:vm';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {createApprovedDesktopUI,projectDesktopPublicState} from '../src/approved-desktop-ui.mjs';
import {initWalletTheme,parseWalletTheme,WALLET_THEME_KEY} from '../src/wallet-appearance.mjs';
const html=fs.readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
const camel=s=>s.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.handlers={};this.className='';this.textContent='';this.value='';this.disabled=false;this.hidden=false;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(v=>v!==name).join(' ');},toggle:(name,on)=>on?this.classList.add(name):this.classList.remove(name)};}
 append(...nodes){for(const n of nodes){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);n.parentElement=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=String(v);if(k==='id')this.id=v;if(k==='class')this.className=v;if(k==='value')this.value=v;if(k.startsWith('data-'))this.dataset[camel(k.slice(5))]=v;}
 removeAttribute(k){delete this.attributes[k];}
 addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}async emit(type){for(const fn of this.handlers[type]??[])await fn({target:this});}click(){if(!this.disabled)return this.emit('click');}scrollIntoView(){}
}
function mounted(){
 const doc={createElement(tag){return new Element(tag,doc);},getElementById(id){return walk(doc.documentElement).find(n=>n.id===id)??null;},querySelector(selector){return doc.querySelectorAll(selector)[0]??null;},querySelectorAll(selector){return walk(doc.documentElement).filter(n=>match(n,selector));}};
 function walk(n){return n?[n,...n.children.flatMap(walk)]:[];}
 function match(n,s){if(s.startsWith('#'))return n.id===s.slice(1);if(s.startsWith('.'))return n.className.split(' ').includes(s.slice(1));const a=s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(a){const value=a[1].startsWith('data-')?n.dataset[camel(a[1].slice(5))]:n.attributes[a[1]];return value!==undefined&&(a[2]===undefined||value===a[2]);}const input=s.match(/^input\[name="([^"]+)"\]$/);if(input)return n.tagName==='INPUT'&&n.attributes.name===input[1];return n.tagName===s.toUpperCase();}
 const stack=[],voids=new Set(['meta','link','input','img','br','hr','source']);
 for(const m of html.matchAll(/<\/?([a-z][a-z0-9-]*)([^>]*)>/gi)){const tag=m[1].toLowerCase();if(m[0].startsWith('</')){const index=stack.map(n=>n.tagName.toLowerCase()).lastIndexOf(tag);if(index>=0)stack.length=index;continue;}const n=doc.createElement(tag);for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))n.setAttribute(a[1],a[2]??'');if(tag==='html'){doc.documentElement=n;n.lang=n.attributes.lang??'en';}if(tag==='body')doc.body=n;if(stack.length)stack.at(-1).append(n);if(!voids.has(tag))stack.push(n);}
 return doc;
}
const canonical='0x'+'12'.repeat(20),native='ynx1zgfpyysjzgfpyysjzgfpyysjzgfpyysjte2j78';
const key={account:canonical,revision:1,locked:false,authenticating:false,unlockAvailable:true};
const account={initialized:true,account:canonical,ynxAccount:native,passwordConfigured:true};
function fixture(api={}){const document=mounted(),calls=[];const ui=createApprovedDesktopUI({document,api,navigate:name=>calls.push(['view',name]),unlock:()=>calls.push(['unlock']),openImport:()=>calls.push(['import']),openCrossChain:()=>calls.push(['cross']),openNetworks:()=>calls.push(['network']),reviewPending:()=>calls.push(['review']),writeClipboard:async()=>{}});return {document,ui,calls,id:name=>document.getElementById(name)};}
test('full production HTML preserves every existing control ID exactly once and all normal view routes',()=>{
 const before=execFileSync('git',['show','ad0ac7642eb1c5155e6b0ae9c34025d680465c8a:apps/wallet-desktop/src/index.html'],{encoding:'utf8'}),ids=s=>[...s.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]),all=ids(html);assert.equal(all.length,new Set(all).size);for(const id of ids(before))assert(all.includes(id),id);
 const renderer=fs.readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');for(const name of ['overview','history','connections','security','agents','permissions','accounts','resolver','settings']){assert(html.includes('data-view="'+name+'"'));assert(renderer.includes('"'+name+'"'));}
 assert(!/node:|wallet-auth/.test(fs.readFileSync(new URL('../src/approved-desktop-ui.mjs',import.meta.url),'utf8')));
});
test('mainstream missing optional preload methods boots full actual DOM, disables unsupported policy and never pretends active',()=>{
 const f=fixture({});f.ui.render(account,key);assert.equal(f.document.body.dataset.walletStage,'workspace');assert.equal(f.id('desktop-read-pq-policy').disabled,true);assert.equal(f.id('desktop-open-crosschain').disabled,true);assert.equal(f.id('desktop-pq-a').textContent,'Not checked');assert.equal(f.id('desktop-agent-review').disabled,true);
 assert.equal(f.id('transaction-history').parentElement.id,'desktop-history-slot');assert.equal(f.id('walletconnect-sessions').parentElement.id,'desktop-permission-slot');
});
test('welcome and locked views use real account/security state; user unlock delegates original form only',async()=>{
 const f=fixture();f.ui.render({initialized:false,passwordConfigured:false},{locked:true,revision:0});assert.equal(f.document.body.dataset.walletStage,'welcome');await f.id('desktop-start-ynx').click();assert.deepEqual(f.calls,[['view','accounts'],['unlock']]);f.ui.render(account,key);f.ui.render(account,{...key,locked:true,revision:2});assert.equal(f.document.body.dataset.walletStage,'locked');await f.id('desktop-unlock').click();assert.equal(f.calls.at(-1)[0],'unlock');
});
test('shell public projection never reads credential/private input values or invents balances or USD',()=>{
 const f=fixture(),privateAccount={...account};Object.defineProperty(privateAccount,'privateKey',{get(){assert.fail('private key read');}});for(const n of f.document.querySelectorAll('input'))if(n.attributes.type==='password')Object.defineProperty(n,'value',{get(){assert.fail('secret input read');}});
 const value=projectDesktopPublicState(privateAccount,key);assert.equal('balance' in value,false);assert.equal('privateKey' in value,false);f.ui.render(privateAccount,key);assert(!html.includes('$128,406'));assert(!html.includes('2025-08-14'));assert(!html.includes('canyon'));
});
test('real readonly policy response updates both algorithm labels, but wrong owner/lock cannot publish active state',async()=>{
 let release;const f=fixture({pqAccountAuthorization:()=>new Promise(r=>{release=r;})});f.ui.render(account,key);const pending=f.id('desktop-read-pq-policy').click();f.ui.render(account,{...key,locked:true,revision:2});release({ok:true,value:{account:canonical,readOnly:true,signingAuthorized:false,authorizationStatus:'active'}});await pending;assert.equal(f.id('desktop-pq-a').textContent,'Not checked');
 const good=fixture({pqAccountAuthorization:async()=>({ok:true,value:{account:canonical,readOnly:true,signingAuthorized:false,authorizationStatus:'active'}})});good.ui.render(account,key);await good.id('desktop-read-pq-policy').click();assert.equal(good.id('desktop-pq-a').textContent,'Active on chain');assert.match(good.id('desktop-pq-policy').textContent,/local key custody/);
});
test('pending Agent request routes only to original protected review, never creates delegation or automatic approval',async()=>{
 const f=fixture();f.ui.render(account,key);f.ui.updatePending({count:1,ai:true});assert.equal(f.id('desktop-agent-review').disabled,false);await f.id('desktop-agent-review').click();assert.deepEqual(f.calls,[['review']]);f.ui.render(account,{...key,locked:true});assert.equal(f.id('desktop-agent-review').disabled,true);
});
test('theme schemas, independent dark palette and silently failed persistence remain honest',async()=>{
 for(const raw of [null,'{}','{"version":1,"theme":"invert"}','{"version":1,"theme":"dark","credential":"x"}'])assert.equal(parseWalletTheme(raw),'light');
 const doc=mounted(),data=new Map(),storage={getItem:k=>data.get(k),setItem(k,v){assert.equal(k,WALLET_THEME_KEY);data.set(k,v);}};const controller=initWalletTheme({document:doc,getStorage:()=>storage,matchMedia:()=>({matches:false})});const radios=doc.querySelectorAll('input[name="wallet-theme"]');radios[1].checked=true;await radios[1].emit('change');assert.equal(doc.documentElement.dataset.theme,'dark');assert.equal(controller.theme(),'dark');assert.match(doc.getElementById('appearance-status').textContent,/saved/);
 const css=fs.readFileSync(new URL('../src/approved-wallet-tokens.css',import.meta.url),'utf8');assert.match(css,/--ynx-bg: #101114/);assert.match(css,/--ynx-qr-ink: #002fa7; --ynx-qr-bg: #ffffff/);assert(!/invert\(/.test(css));
});
test('actual renderer setView executes every new route with real DOM ids and never passes an undefined localization key',()=>{
 const renderer=fs.readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8'),start=renderer.indexOf('function setView(name) {'),end=renderer.indexOf('\nfor (const button',start),document=mounted(),query=document.querySelectorAll.bind(document);document.querySelectorAll=selector=>selector==='nav [data-view]'?query('[data-view]'):query(selector);
 const scope={document,activeAccount:canonical,refreshWalletConnectConnectionView(){return Promise.resolve();},transactionHistoryUI:{refresh(){return Promise.resolve();}},copyUI(node,key){assert.equal(typeof key,'string');node.textContent=key;},desktopUI:{viewChanged(){}},window:{scrollTo(){}}};vm.runInNewContext(renderer.slice(start,end)+'\nglobalThis.runView=setView;',scope);
 for(const name of ['overview','history','connections','security','agents','permissions','accounts','resolver','settings']){scope.runView(name);const visible=query('[data-panel]').filter(n=>!n.hidden);assert(visible.length>0,name);assert(visible.every(n=>n.dataset.panel===name),name);}
});
test('actual PQ backup, registered restore and key-preparation UI mount safely with old preload methods absent',()=>{
 const document=mounted();for(const factory of [createPQBackupUI,createRegisteredPQRestoreUI,createPQKeyPreparationUI]){const control=factory({document,api:{},getKeyState:()=>key});assert.doesNotThrow(()=>control.render());}
 for(const id of ['pq-independent-backup','pq-registered-restore','pq-key-preparation']){const panel=document.getElementById(id);assert(panel);const buttons=panel.children.filter(n=>n.tagName==='BUTTON');assert(buttons.length>=2);assert.equal(buttons[0].disabled,true);assert.equal(buttons[1].disabled,true);}
});

test('language change relabels the same observed network without another probe or new authority',t=>{
 const prior=globalThis.MutationObserver;let changed;
 globalThis.MutationObserver=class{constructor(callback){changed=callback;}observe(){}disconnect(){}};
 t.after(()=>{if(prior===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=prior;});
 const f=fixture();f.ui.updateNetwork({available:true,chainId:'0x1917'});assert.equal(f.id('desktop-network-chip').textContent,'YNX Testnet');
 f.document.documentElement.lang='zh-CN';changed();assert.equal(f.id('desktop-network-chip').textContent,'YNX 测试网');assert.equal(f.id('desktop-network-chip').dataset.networkState,'available');
 f.ui.updateNetwork({available:false,chainId:'0x1917'});f.document.documentElement.lang='en';changed();assert.equal(f.id('desktop-network-chip').dataset.networkState,'unavailable');assert.equal(f.calls.length,0);
});
test('late account refresh preserves a selected history/settings page but redirects unavailable assets',()=>{
 const source=fs.readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8'),from=source.indexOf('function reconcileAccountView('),to=source.indexOf('\nfunction setView(',from);assert(from>=0&&to>from);
 for(const [selected,initialized,previous,expected]of [['history',false,null,[]],['settings',false,null,[]],['history',true,null,[]],['overview',false,canonical,['accounts']],['accounts',true,null,['overview']]]){
  const calls=[],document={querySelector:selector=>({hidden:!selector.includes('"'+selected+'"')})};
  const run=Function('document','setView',source.slice(from,to)+';return reconcileAccountView;')(document,name=>calls.push(name));run({initialized},previous);assert.deepEqual(calls,expected,selected);
 }
});
test('DApp and permissions routes keep the same actual session controls and original outcome visible in the active view',()=>{
 const f=fixture(),sessions=f.id('walletconnect-sessions'),detail=f.id('walletconnect-detail');
 let clicks=0;const button=f.document.createElement('button');button.addEventListener('click',()=>clicks++);sessions.append(button);detail.textContent='Original disconnect acknowledgement UNKNOWN';
 for(const route of ['connections','permissions','connections']){f.ui.viewChanged(route);const target=route==='connections'?'desktop-connection-sessions-slot':'desktop-permission-slot';assert.equal(sessions.parentElement.id,target);assert.equal(detail.parentElement.id,target);assert.equal(f.id('walletconnect-sessions'),sessions);assert.equal(detail.textContent,'Original disconnect acknowledgement UNKNOWN');}
 button.click();assert.equal(clicks,1);assert.equal(f.document.querySelectorAll('[id="walletconnect-sessions"]').length,1);
});
