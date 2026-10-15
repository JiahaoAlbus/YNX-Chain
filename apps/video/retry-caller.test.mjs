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
const catalog=id=>[{id,title:'Title '+id,status:'ready',visibility:'public',description:'Normal description'}];
function harness(){
  const calls=[],responses=[],retryNodes=[],notices=[],values=new Map([['profile','original-profile'],['draft','original-draft'],['ynx.video.pending-mutations.v1',JSON.stringify({version:1,records:[{account:'original-owner',method:'POST',path:'/v1/videos/original/watch',key:'original-operation-key',bodyDigest:'a'.repeat(64),bodyBytes:31,contentType:'application/json',firstCause:{name:'TypeError',stage:'result-unconfirmed'},state:'UNKNOWN'}]})]]),original=[...values];
  let activeRetry=null,authorityCalls=0,storageWrites=0;
  class Element extends EventTarget{
    constructor(){super();this.children=[];this.attributes={};this.dataset={};this.listeners=new Map();this.classList={toggle(){}};this._html='';this.textContent='';this.value='';}
    set innerHTML(value){this._html=value;this.children=[];if(this===content){activeRetry=null;if(value.includes('id="retry-load"')){activeRetry=new Element();retryNodes.push(activeRetry);this.children.push(activeRetry);}}}get innerHTML(){return this._html;}
    replaceChildren(...items){this.children=[...items];this._html='';if(this===content)activeRetry=null;}append(...items){this.children.push(...items);}
    setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];}
    addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(handler);super.addEventListener(name,handler);}
    querySelector(selector){assert.equal(selector,'button');return this.button??=new Element();}
  }
  const content=new Element(),nodes=new Map([['#content',content]]),$=key=>{if(key==='#retry-load')return activeRetry;if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
  const discover=new Element();discover.dataset.view='discover';
  const api=createVideoAPI({baseURL:API,environment:{localStorage:{getItem:k=>values.get(k)??null,setItem(){storageWrites++;assert.fail('public retry cannot change original saved state');}}},authorize(){authorityCalls++;assert.fail('public retry never authorizes');},getAccount(){authorityCalls++;assert.fail('public GET never reads private identity');},fetch:async(url,options)=>{
    calls.push({url,method:options.method,credentials:options.credentials});assert.equal(options.method,'GET');assert.match(url,/\/v1\/videos\?q=/);
    const response=responses.shift()??{status:503,error:'unexpected extra catalog request'};response.entered?.resolve();if(response.gate)await response.gate.promise;
    if(response.networkError)throw new TypeError('controlled original catalog transport failure');
    return new Response(JSON.stringify(response.status?{error:response.error??'catalog unavailable'}:response.videos??[]),{status:response.status??200,headers:{'Content-Type':'application/json'}});
  }});
  const context=vm.createContext({API,api,Error,DOMException,libraryEpoch:0,navigationRevision:0,currentView:'discover',currentPlaylist:null,productRevision:0,productState:{status:'guest',session:null},productConnected:()=>false,
    $: $,t:key=>key,navigator:{onLine:true},notice:(...args)=>notices.push(args),focusSignIn:()=>assert.fail('no sign-in fixture'),nav:[discover],document:{createElement:()=>new Element(),querySelectorAll:()=>[discover],querySelector:()=>discover}});
  vm.runInContext(slice('function renderAccountRequired(', '\nasync function restoreVideoAccount')+'\n'+slice('function beginLibrary(', '\nfunction libraryFailure')+'\n'+slice('function esc(', '\nfunction renderWalletChoices(')+'\n'+slice('function showSettings(', '\n$("#signin").onclick')+'\n'+slice('nav.find(b => b.dataset.view === "discover").onclick =','\nnav.find(b => b.dataset.view === "subscriptions")')+'\n'+slice('$("#privacy").onclick =','\n\nclearLegacySession'),context);
  const queue=(response={})=>{const entry={...response,entered:deferred()};responses.push(entry);return entry;};
  const load=async(response,query='')=>{queue(response);context.query=query;await vm.runInContext('loadVideos(query)',context);await turn();};
  const listener=button=>{assert.ok(button);const list=button.listeners.get('click');assert.equal(list.length,1);return list[0];};
  const state=()=>({view:context.currentView,playlist:context.currentPlaylist,epoch:context.libraryEpoch,navigation:context.navigationRevision,html:content.innerHTML,children:content.children.map(x=>x.innerHTML),busy:content.attributes['aria-busy'],notice:JSON.stringify(notices),requests:calls.length,retry:activeRetry});
  return {context,$,calls,notices,retryNodes,queue,load,state,listener,retry:()=>activeRetry,privacy:()=>$('#privacy').onclick(),
    async click(button){await listener(button)(new Event('click'));await turn();},
    async discover(response){queue(response);discover.onclick({currentTarget:discover});await turn();await turn();},
    async error(){await load({status:503},'original');assert.ok(activeRetry);return activeRetry;},
    assertSeparate(){assert.equal(authorityCalls,0);assert.equal(storageWrites,0);assert.deepEqual([...values],original);assert.equal(context.productState.session,null);assert.ok(calls.every(x=>x.method==='GET'&&x.credentials==='omit'));}};
}

test('old error retry cannot replace a newer successful directory or add GET',async()=>{
  const h=harness(),old=await h.error();await h.load({videos:catalog('B')},'B');const before=h.state();await h.click(old);assert.deepEqual(h.state(),before);h.assertSeparate();
});
test('old retry cannot restart directory while newer catalog request is pending',async()=>{
  const h=harness(),old=await h.error(),gate=deferred(),entry=h.queue({videos:catalog('B'),gate});const pending=vm.runInContext('loadVideos("B")',h.context);await entry.entered.promise;const before=h.state();await h.click(old);const after=h.state();gate.resolve();await pending;await turn();assert.deepEqual(after,before);assert.equal(h.$('#content').attributes['aria-busy'],'false');h.assertSeparate();
});
test('normal privacy navigation retires previous retry and preserves account-required view',async()=>{
  const h=harness(),old=await h.error();h.privacy();const before=h.state();assert.equal(before.view,'settings');await h.click(old);assert.deepEqual(h.state(),before);h.assertSeparate();
});
test('discover error to privacy to discover same-view ABA cannot revive first retry',async()=>{
  const h=harness(),old=await h.error();h.privacy();await h.discover({videos:catalog('B')});assert.equal(h.context.currentView,'discover');const before=h.state();await h.click(old);assert.deepEqual(h.state(),before);h.assertSeparate();
});
test('separate new error button owns its listener and old error cannot retire it',async()=>{
  const h=harness(),old=await h.error();await h.load({status:503,error:'new catalog unavailable'},'new');const current=h.retry();assert.notEqual(current,old);assert.notEqual(h.listener(current),h.listener(old));const before=h.state();await h.click(old);assert.deepEqual(h.state(),before);h.queue({videos:catalog('recovered')});await h.click(current);assert.equal(h.retry(),null);assert.equal(h.calls.length,3);h.assertSeparate();
});
test('current retry reads current query and preserves normal encoded public request',async()=>{
  const h=harness(),button=await h.error();h.$('#query').value='edited & "query"';h.queue({videos:catalog('current')});await h.click(button);assert.equal(h.calls.length,2);assert.equal(h.calls[1].url,API+'/v1/videos?q='+encodeURIComponent('edited & "query"'));assert.equal(h.retry(),null);assert.equal(h.$('#content').attributes['aria-busy'],'false');h.assertSeparate();
});
test('current retry starting new request immediately retires its own repeated old handler',async()=>{
  const h=harness(),button=await h.error(),handler=h.listener(button),gate=deferred(),entry=h.queue({videos:catalog('current'),gate});const first=handler(new Event('click'));await entry.entered.promise;const before=h.state();await handler(new Event('click'));const after=h.state();gate.resolve();await first;await turn();assert.deepEqual(after,before);assert.equal(h.calls.length,2);h.assertSeparate();
});
test('new retries remain usable after repeated real HTTP failures without permanent once flag',async()=>{
  const h=harness(),first=await h.error();h.queue({status:503,error:'second failure'});await h.click(first);const second=h.retry();assert.notEqual(second,first);h.queue({videos:catalog('recovered')});await h.click(second);assert.equal(h.calls.length,3);assert.equal(h.retryNodes.length,2);assert.equal(h.retry(),null);h.assertSeparate();
});
test('actual API two-attempt safe-read transport behavior remains intact before legal retry',async()=>{
  const h=harness();h.queue({networkError:true});h.queue({networkError:true});await vm.runInContext('loadVideos("network")',h.context);assert.equal(h.calls.length,2);const button=h.retry();assert.ok(button);h.queue({videos:catalog('recovered')});await h.click(button);assert.equal(h.calls.length,3);h.assertSeparate();
});
test('successful empty catalog creates no retry node or listener',async()=>{
  const h=harness();await h.load({videos:[]});assert.equal(h.retry(),null);assert.equal(h.retryNodes.length,0);assert.equal(h.calls.length,1);assert.match(h.$('#content').innerHTML,/<div class="empty">/);h.assertSeparate();
});
test('product revision alone does not retire a current public error retry',async()=>{
  const h=harness(),button=await h.error();h.context.productRevision++;h.queue({videos:catalog('current')});await h.click(button);assert.equal(h.calls.length,2);assert.equal(h.retry(),null);h.assertSeparate();
});
