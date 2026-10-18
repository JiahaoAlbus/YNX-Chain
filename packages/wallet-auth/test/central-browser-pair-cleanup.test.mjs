import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../src/central-browser-session-browser.js',import.meta.url));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
class Element{
 constructor(tag='div',document){this.tagName=tag.toUpperCase();this.document=document;this.children=[];this.dataset={};this.listeners=new Map();this.attributes={};this.disabled=false;this.hidden=false;this.value='';this.textContent='';}
 set id(v){this._id=v;this.document.elements.set(v,this);}get id(){return this._id;}
 append(...values){this.children.push(...values);}prepend(...values){this.children.unshift(...values);}before(){}after(){}replaceChildren(...values){this.children=values;}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}removeAttribute(k){delete this.attributes[k];}
 querySelectorAll(){return [];}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
 dispatchEvent(event){for(const fn of this.listeners.get(event.type)??[])fn(event);}
 click(){if(!this.disabled)this.dispatchEvent({type:'click'});}
}
const stubs={
 'central-browser-session-locale.js':`export const CENTRAL_UI_LANGUAGES={en:'English'};export const centralUILanguage=()=> 'en';export const centralUIText=x=>x;`,
 'canonical.js':`export const canonicalJSON=JSON.stringify;`,
 'central-browser-session-registry.js':`export const centralBrowserProfiles=()=>[];`,
 'crypto.js':`export const evmAddressFromYNX=x=>x;`,
 'metamask-evm-adapter.js':`export const METAMASK_EVM_CHAIN={chainId:'0x1917'};`,
 'central-browser-session-contract.js':`export const parseCentralBrowserSignInChallenge=x=>x;export const parseCentralBrowserSignInApproval=x=>x;export const approveCentralBrowserProfile=async()=>{throw Error('NO_AUTH_APPROVAL_IN_PUBLIC_TEST')};`,
 'standard-wallet-connection.js':`export class StandardWalletConnection{constructor(){this.current={selectedChain:'0x1917',selectedAccount:'0x'+'1'.repeat(40)}}async connect(){}disconnect(){} }`,
 'wallet-provider-discovery.js':`export const WALLET_PROVIDER_KIND={YNX:'YNX'};export const createWalletProviderDiscovery=()=>({subscribe(fn){globalThis.__qa.discovery=fn;fn({candidates:[]});},dispose(){}});`,
 'hosted-adapter.js':`export const createHostedWalletAdapter=()=>({async connect(){},async detach(){},on(){},removeListener(){},request(){throw Error('NO_AUTH_REQUEST')}});`,
 'walletconnect-dapp-connection.js':`export class WalletConnectDAppConnection{constructor(){globalThis.__qa.pair=this;this.events=new Map()}on(n,f){if(!this.events.has(n))this.events.set(n,new Set());this.events.get(n).add(f)}removeListener(n,f){this.events.get(n)?.delete(f)}emit(n,v){for(const f of this.events.get(n)??[])f(v)}connect(){globalThis.__qa.connects++;return new Promise((resolve,reject)=>{globalThis.__qa.resolve=resolve;globalThis.__qa.reject=reject})}cancel(){const s=globalThis.__qa;s.cancels++;const p=Promise.reject(s.cleanupError);p.catch(()=>{});return {then(resolve,reject){if(reject)s.caughtCancels++;return p.then(resolve,reject)},catch(reject){s.caughtCancels++;return p.catch(reject)}}}}`,
 qrcode:`export default {toCanvas:async()=>{}};`,
};
const bundles=new Map();
async function fixture({actualPair=false}={}){
 if(!bundles.has(actualPair))bundles.set(actualPair,build({entryPoints:[entry],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'PUBLIC-browser-dependencies',setup(b){b.onResolve({filter:/.*/},a=>{if(a.kind==='entry-point')return;const name=a.path.split('/').at(-1);if(actualPair&&a.path==='@walletconnect/core')return {path:'actual-core',namespace:'PUBLIC'};if(actualPair&&a.path==='@walletconnect/sign-client')return {path:'actual-client',namespace:'PUBLIC'};if(actualPair&&a.importer!==entry)return;if(actualPair&&name==='walletconnect-dapp-connection.js')return;if(Object.hasOwn(stubs,name))return {path:name,namespace:'PUBLIC'};throw Error('UNEXPECTED_TEST_IMPORT:'+a.path)});b.onLoad({filter:/.*/,namespace:'PUBLIC'},a=>({contents:a.path==='actual-core'?`export const RELAYER_EVENTS={connect:'connect'};export class Core{constructor(options){const s=globalThis.__qa;s.actualConstructions++;s.actualDatabase=options.storageOptions.database;this.customStoragePrefix='';this.relayer={on(){},transportClose:async()=>{s.actualCloses++}};this.pairing={pairings:{getAll:()=>[]}};globalThis._walletConnectCore_=this;globalThis._walletConnectCore__count=1;}}`:a.path==='actual-client'?`export default class SignClient{static async init(options){const s=globalThis.__qa;s.actualInitializations++;s.originalCore=options.core;throw s.originalFailure;}}`:stubs[a.path],loader:'js'}));}}]}).then(r=>r.outputFiles[0].text));
 const document={elements:new Map(),createElement(tag){return new Element(tag,this)},getElementById(id){return this.elements.get(id)},querySelector(s){return this.elements.get(s)},querySelectorAll(){return []},title:'YNX'};
 for(const id of ['context','wallet','approve','cancel','status','main','h1','label[for="wallet"]']){const e=new Element('div',document);e.id=id;}document.head=new Element('head',document);document.documentElement=new Element('html',document);
 const challenge={challengeId:'PUBLIC',expiresAt:new Date(Date.now()+60000).toISOString(),clients:[{origin:'https://developer.ynxweb4.com'}],initiator:{origin:'https://developer.ynxweb4.com',redirectUri:'https://developer.ynxweb4.com/return',state:'PUBLIC'}};
 document.getElementById('context').textContent=JSON.stringify({mode:'authorize',challenge,registry:[],csrfToken:'PUBLIC'});
 const state={actualConstructions:0,actualInitializations:0,actualCloses:0,originalFailure:Object.assign(Error('PRIVATE_PARTIAL_ORIGINAL_CAUSE'),{code:'PRIVATE_INIT_FAILURE'}),connects:0,cancels:0,caughtCancels:0,cleanupError:Object.assign(Error('PRIVATE_CAUSE_MUST_NOT_RENDER'),{code:'YNX_PAIR_CLEANUP_UNCONFIRMED',stage:'cleanup'}),requests:[],redirects:[]};
 const window={addEventListener(){}};const ctx={document,window,__qa:state,location:{origin:'https://wallet-auth.ynxweb4.com',hash:'',reload(){},assign(x){state.redirects.push(x)}},navigator:{language:'en'},localStorage:{getItem(){return null}},URL,URLSearchParams,Event,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:async(path)=>{state.requests.push(path);if(state.serverFailure)throw Error('SSO_CSRF_MISMATCH');return {ok:true,json:async()=>({redirectUri:'https://developer.ynxweb4.com/return?state=PUBLIC&error=access_denied'})};}};
 vm.runInNewContext(await bundles.get(actualPair),ctx);return {state,document,el:id=>document.getElementById(id),async flush(){await tick();await tick();}};
}
async function start(f){f.el('pair').click();await f.flush();}
test('normal page consumes initialization cleanup debt, keeps first cause and refuses mobile retry',async()=>{
 const f=await fixture();await start(f);f.state.pair.emit('cancelUnconfirmed',{reason:'initialization-unresolved',attempt:1,current:true});f.state.reject(Object.assign(Error('first cause'),{code:'YNX_PAIR_INITIALIZATION_UNAVAILABLE',stage:'initialization',cleanupError:f.state.cleanupError}));await f.flush();
 assert.equal(f.el('status').dataset.errorCode,'YNX_PAIR_INITIALIZATION_UNAVAILABLE');assert.equal(f.el('status').dataset.pairCleanup,'unconfirmed');assert.equal(f.el('pair').disabled,true);assert.equal(f.el('pair-cleanup-status').hidden,false);assert.equal(f.el('pair-cleanup-status').textContent.includes('PRIVATE_CAUSE'),false);f.el('pair').click();await f.flush();assert.equal(f.state.connects,1);
});
test('safe return consumes rejected mobile cancel without claiming remote revocation',async()=>{
 const f=await fixture();await start(f);f.el('return-product').click();await f.flush();assert.equal(f.state.cancels,1);assert.equal(f.state.caughtCancels,1);assert.equal(f.el('status').dataset.pairCleanup,'unconfirmed');assert.equal(f.state.requests.length,0);f.state.reject({code:'YNX_PAIR_CANCELLED'});await f.flush();
});
test('server cancellation retains its own failure while independent mobile cleanup remains UNKNOWN',async()=>{
 const f=await fixture();await start(f);f.state.serverFailure=true;f.el('cancel').click();await f.flush();assert.equal(f.state.caughtCancels,1);assert.equal(f.el('status').dataset.errorCode,'SSO_CSRF_MISMATCH');assert.equal(f.el('status').dataset.phase,'server-cancel');assert.equal(f.el('status').dataset.pairCleanup,'unconfirmed');assert.equal(f.state.redirects.length,0);f.state.reject({code:'YNX_PAIR_CANCELLED'});await f.flush();
});
test('late pair cleanup cannot overwrite newer installed-wallet success or re-enable mobile retry',async()=>{
 const f=await fixture();await start(f);const provider={request(){},on(){},removeListener(){}};f.state.discovery({candidates:[{kind:'YNX',provider}]});f.el('wallet').value='0';f.el('wallet').dispatchEvent({type:'change'});await f.flush();assert.equal(f.state.caughtCancels,1);const message=f.el('status').textContent;assert.match(message,/Wallet connected/);assert.equal(f.el('approve').disabled,false);
 f.state.pair.emit('cancelUnconfirmed',{reason:'initialization-unresolved',attempt:1,current:false});f.state.reject({code:'YNX_PAIR_CANCELLED'});await f.flush();assert.equal(f.el('status').textContent,message);assert.equal(f.el('approve').disabled,false);assert.equal(f.el('pair').disabled,true);assert.equal(f.el('status').dataset.pairCleanup,'unconfirmed');
});
test('independent hosted connection remains usable while mobile cleanup is unconfirmed',async()=>{
 const f=await fixture();await start(f);f.state.pair.emit('cancelUnconfirmed',{reason:'initialization-unresolved',attempt:1,current:true});f.state.reject({code:'YNX_PAIR_INITIALIZATION_UNAVAILABLE',cleanupError:f.state.cleanupError});await f.flush();f.el('hosted').click();await f.flush();const message=f.el('status').textContent;assert.match(message,/Wallet Web connected/);assert.equal(f.el('approve').disabled,false);f.state.pair.emit('cancelUnconfirmed',{reason:'initialization-unresolved',attempt:1,current:false});await f.flush();assert.equal(f.el('status').textContent,message);assert.equal(f.el('approve').disabled,false);assert.equal(f.el('pair').disabled,true);
});
test('server cancel success remains distinct from unknown mobile cleanup',async()=>{
 const f=await fixture();await start(f);f.el('cancel').click();await f.flush();assert.equal(f.state.caughtCancels,1);assert.equal(f.state.requests.length,1);assert.match(f.state.requests[0],/\/cancel$/);assert.equal(f.state.redirects.length,1);assert.equal(f.el('status').dataset.pairCleanup,'unconfirmed');assert.equal(f.el('pair-cleanup-status').hidden,false);f.state.reject({code:'YNX_PAIR_CANCELLED'});await f.flush();
});

test('normal browser caller consumes actual default SDK partial initialization and keeps independent UNKNOWN',async()=>{
 const f=await fixture({actualPair:true});await start(f);
 assert.equal(f.state.actualConstructions,1);assert.equal(f.state.actualInitializations,1);assert.equal(f.state.actualDatabase,'ynx-pair-wallet-auth.ynxweb4.com');assert.equal(f.state.actualCloses,0);
 assert.equal(f.el('status').dataset.errorCode,'YNX_PAIR_INITIALIZATION_UNAVAILABLE');assert.equal(f.el('status').dataset.pairCleanup,'unconfirmed');assert.equal(f.el('pair').disabled,true);
 assert.equal(f.el('status').textContent.includes('PRIVATE_PARTIAL'),false);assert.equal(f.el('connection-diagnostics').children.at(-1).textContent.includes('PRIVATE_'),false);
 f.el('pair').click();await f.flush();assert.equal(f.state.actualConstructions,1);assert.equal(f.state.actualInitializations,1);
 f.state.serverFailure=true;f.el('cancel').click();await f.flush();assert.equal(f.el('status').dataset.errorCode,'SSO_CSRF_MISMATCH');assert.equal(f.el('status').dataset.phase,'server-cancel');assert.equal(f.el('status').dataset.pairCleanup,'unconfirmed');assert.equal(f.state.actualCloses,0);assert.equal(f.state.redirects.length,0);
});
