import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createVideoAPI} from './video-api.js';
const source=await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(done=>setImmediate(done));
const API='https://video.ynxweb4.com/video/api';
function harness(){
  const fixtureA={account:'unit-test-only-account-A'},fixtureB={account:'unit-test-only-account-B'};
  const calls=[],responses=[],retryNodes=[],notices=[],authorizations=[],values=new Map([['profile','original-profile'],['draft','original-draft'],['ynx.video.pending-mutations.v1',JSON.stringify({version:1,records:[{account:'original-owner',method:'POST',path:'/v1/videos/original/watch',key:'original-operation-key',bodyDigest:'a'.repeat(64),bodyBytes:31,contentType:'application/json',firstCause:{name:'TypeError',stage:'result-unconfirmed'},state:'UNKNOWN'}]})]]),original=[...values];
  let activeEmpty=null,identityAdmitted=true,storageWrites=0,context;
  class Element extends EventTarget{
    constructor(){super();this.children=[];this.attributes={};this.dataset={};this.classList={toggle(){}};this._html='';this.textContent='';}
    set innerHTML(value){this._html=value;this.children=[];if(this===content){activeEmpty=null;if(value.includes('<div class="empty">')){activeEmpty=new Element();this.children.push(activeEmpty);}}}get innerHTML(){return this._html;}
    replaceChildren(...items){this.children=[...items];this._html='';if(this===content)activeEmpty=null;}append(...items){this.children.push(...items);if(this===activeEmpty)for(const item of items)if(typeof item.onclick==='function')retryNodes.push(item);}
    setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];}
    querySelector(selector){return this.button??=new Element();}
  }
  const content=new Element(),nodes=new Map([['#content',content]]),$=key=>{if(key==='#retry-load')return null;if(key==='#content .empty')return activeEmpty;if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
  const nav=['discover','history'].map(view=>{const node=new Element();node.dataset.view=view;return node;});
  const api=createVideoAPI({baseURL:API,environment:{localStorage:{getItem:k=>values.get(k)??null,setItem(){storageWrites++;assert.fail('library GET must not alter original saved state');}}},
    // Explicit isolated authorization fixture: no proof, signature, token, issuer or external service.
    authorize(path,method,body){assert.equal(path,'/v1/history');assert.equal(method,'GET');assert.equal(body,undefined);authorizations.push({path,method,account:context.productState.session?.account});return {};},
    getAccount(){assert.fail('only mutations read principal in actual API; test permits GET only');},fetch:async(url,options)=>{
      calls.push({url,method:options.method,credentials:options.credentials,headers:options.headers});assert.equal(options.method,'GET');assert.ok(url===API+'/v1/history'||url.startsWith(API+'/v1/videos?q='));assert.equal(Object.keys(options.headers).length,0,'fixture authorization returns no credentials');assert.equal(options.credentials,url.endsWith('/v1/history')?'same-origin':'omit');
      const response=responses.shift()??{status:503,error:'unexpected extra library request'};response.entered?.resolve();if(response.gate)await response.gate.promise;if(response.networkError)throw new TypeError('controlled fixture read failure');return new Response(JSON.stringify(response.status?{error:response.error??'fixture history unavailable'}:response.data??[]),{status:response.status??200,headers:{'Content-Type':'application/json'}});
    }});
  context=vm.createContext({API,api,Error,DOMException,AbortController,AbortSignal,libraryEpoch:0,navigationRevision:0,currentView:'history',currentPlaylist:null,productRevision:0,productState:{status:'connected',session:fixtureA},productSignOutPending:false,productRequestAbort:new AbortController(),
    // Only the predicate dependency is a unit fixture; exact productConnected/privateAPI/scope run.
    businessIdentity:{matches:session=>identityAdmitted&&(session===fixtureA||session===fixtureB)},
    $,t:key=>key,navigator:{onLine:true},notice:(...args)=>notices.push(args),focusSignIn:()=>assert.fail('never initiate sign-in'),nav,document:{createElement:()=>new Element(),querySelectorAll:()=>nav,querySelector:()=>nav[0]}});
  vm.runInContext(slice('function invalidateProductRequests()', '\nlet productSignOutPending')+'\n'+slice('const privateAPI = async','\nconst playlistJournal=')+'\n'+slice('function playlistScope(', '\nasync function createOriginalPlaylist')+'\n'+slice('function productConnected()', '\nfunction renderProductState')+'\n'+slice('function renderAccountRequired(', '\nasync function restoreVideoAccount')+'\n'+slice('function beginLibrary(', '\nasync function openSavedVideo')+'\n'+slice('function esc(', '\nfunction renderWalletChoices(')+'\n'+slice('async function showHistory(', '\nfunction showSettings')+'\n'+slice('function showSettings(', '\n$("#signin").onclick')+'\n'+slice('nav.find(b => b.dataset.view === "discover").onclick =','\nnav.find(b => b.dataset.view === "subscriptions")')+'\n'+slice('nav.find(b => b.dataset.view === "history").onclick =','\n\n$("#privacy")')+'\n'+slice('$("#privacy").onclick =','\n\nclearLegacySession'),context);
  const queue=(response={})=>{const entry={...response,entered:deferred()};responses.push(entry);return entry;};
  const history=async(response={})=>{queue(response);context.historyButton=nav[1];await vm.runInContext('showHistory(historyButton)',context);await turn();};
  const retry=()=>activeEmpty?.children.find(item=>typeof item.onclick==='function')??null;
  const state=()=>({view:context.currentView,playlist:context.currentPlaylist,epoch:context.libraryEpoch,navigation:context.navigationRevision,html:content.innerHTML,children:content.children.map(x=>x.innerHTML),busy:content.attributes['aria-busy'],notice:JSON.stringify(notices),requests:calls.length,proofs:authorizations.length,retry:retry()});
  return {context,$,calls,authorizations,retryNodes,queue,history,retry,state,privacy:()=>$('#privacy').onclick(),
    async error(){await history({status:503});assert.ok(retry());return retry();},async click(button){assert.ok(button);await button.onclick();await turn();},
    async catalog(response={data:[]}){queue(response);await vm.runInContext('loadVideos("new")',context);await turn();},
    async historyNav(response={status:503}){queue(response);await nav[1].onclick({currentTarget:nav[1]});await turn();},
    rejectIdentity(){identityAdmitted=false;},retire(){vm.runInContext('invalidateProductRequests()',context);context.productState={status:'guest',session:null};identityAdmitted=false;},
    identityABA(){vm.runInContext('invalidateProductRequests()',context);context.productState={status:'connected',session:fixtureB};vm.runInContext('invalidateProductRequests()',context);context.productState={status:'connected',session:fixtureA};},
    assertSeparate(){assert.equal(storageWrites,0);assert.deepEqual([...values],original);assert.ok(calls.every(x=>x.method==='GET'));assert.ok(authorizations.every(x=>x.path==='/v1/history'&&x.method==='GET'));}};
}

test('old actual history failure retry cannot replace newer public catalog or add private read',async()=>{const h=harness(),old=await h.error();await h.catalog();const before=h.state();await h.click(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('old history retry cannot retire pending newer directory or loading state',async()=>{const h=harness(),old=await h.error(),gate=deferred(),entry=h.queue({data:[],gate});const pending=vm.runInContext('loadVideos("new")',h.context);await entry.entered.promise;const before=h.state();await h.click(old);const after=h.state();gate.resolve();await pending;assert.deepEqual(after,before);h.assertSeparate();});
test('normal privacy navigation retires previous library retry',async()=>{const h=harness(),old=await h.error();h.privacy();const before=h.state();assert.equal(before.view,'settings');await h.click(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('history to catalog to history ABA never revives first failure button',async()=>{const h=harness(),old=await h.error();await h.catalog();await h.historyNav();const before=h.state();assert.equal(before.view,'history');assert.notEqual(h.retry(),old);await h.click(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('new history error owns separate button and closure and remains retryable',async()=>{const h=harness(),old=await h.error();await h.history({status:503,error:'new fixture error'});const current=h.retry();assert.notEqual(current,old);assert.notEqual(current.onclick,old.onclick);const before=h.state();await h.click(old);assert.deepEqual(h.state(),before);h.queue({data:[]});await h.click(current);assert.equal(h.retry(),null);assert.equal(h.calls.length,3);h.assertSeparate();});
test('current history retry executes exact privateAPI and actual API with isolated empty authorization fixture',async()=>{const h=harness(),button=await h.error();h.queue({data:[]});await h.click(button);assert.equal(h.calls.length,2);assert.equal(h.authorizations.length,2);assert.match(h.$('#content').innerHTML,/No watch history yet/);assert.equal(h.retry(),null);h.assertSeparate();});
test('starting legal retry retires repeated original handler while history request is pending',async()=>{const h=harness(),button=await h.error(),gate=deferred(),entry=h.queue({data:[],gate});const first=button.onclick();await entry.entered.promise;const before=h.state();await button.onclick();const after=h.state();gate.resolve();await first;assert.deepEqual(after,before);assert.equal(h.calls.length,2);h.assertSeparate();});
test('lost fixture business identity blocks old retry before view or epoch changes',async()=>{const h=harness(),button=await h.error();h.rejectIdentity();const before=h.state();await h.click(button);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('actual request invalidation and guest retirement prevent old retry from navigating',async()=>{const h=harness(),button=await h.error();h.retire();const before=h.state();await h.click(button);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('account A to B to A request revisions never revive original library retry',async()=>{const h=harness(),button=await h.error();h.identityABA();const before=h.state();await h.click(button);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('current retry failure creates a new normally usable retry without lifetime once flag',async()=>{const h=harness(),first=await h.error();h.queue({status:503,error:'second fixture failure'});await h.click(first);const second=h.retry();assert.notEqual(second,first);h.queue({data:[]});await h.click(second);assert.equal(h.calls.length,3);assert.equal(h.authorizations.length,3);h.assertSeparate();});
test('actual API safe-read network retry stays at two attempts before current retry success',async()=>{const h=harness();h.queue({networkError:true});h.queue({networkError:true});h.context.historyButton={};await vm.runInContext('showHistory(historyButton)',h.context);assert.equal(h.calls.length,2);const button=h.retry();h.queue({data:[]});await h.click(button);assert.equal(h.calls.length,3);assert.equal(h.authorizations.length,3);h.assertSeparate();});
