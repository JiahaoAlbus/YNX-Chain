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
const channel=id=>({ID:id,Name:'Channel '+id,Handle:id});
const detail=id=>({channel:channel(id),videos:[{id:'vid_'+id,title:'Video '+id,status:'ready',visibility:'public',description:'Fixture catalog'}],subscribers:7});
function harness(){
  const fixtureA={account:'unit-only-account-A'},fixtureB={account:'unit-only-account-B'};
  const calls=[],responses=[],channelResponses=[],notices=[],authorizations=[],values=new Map([['profile','original-profile'],['draft','original-draft'],['ynx.video.pending-mutations.v1',JSON.stringify({version:1,records:[{account:'original-owner',method:'POST',path:'/v1/videos/original/watch',key:'original-operation-key',bodyDigest:'a'.repeat(64),bodyBytes:31,contentType:'application/json',firstCause:{name:'TypeError',stage:'result-unconfirmed'},state:'UNKNOWN'}]})]]),original=[...values];
  let activeEmpty=null,identityAdmitted=true,storageWrites=0,context;
  class Element extends EventTarget{
    constructor(){super();this.children=[];this.attributes={};this.dataset={};this.classList={toggle(){}};this._html='';this.textContent='';this.open=false;this.paused=true;}
    set innerHTML(value){this._html=value;this.children=[];if(this===content){activeEmpty=null;if(value.includes('<div class="empty">')){activeEmpty=new Element();this.children.push(activeEmpty);}}}get innerHTML(){return this._html;}
    replaceChildren(...items){this.children=[...items];this._html='';if(this===content)activeEmpty=null;}append(...items){this.children.push(...items);}
    setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];}
    querySelector(selector){this.parts??=new Map();if(!this.parts.has(selector))this.parts.set(selector,new Element());return this.parts.get(selector);}
    pause(){this.paused=true;}close(){this.open=false;}
  }
  const content=new Element(),nodes=new Map([['#content',content]]),$=key=>{if(key==='#retry-load')return null;if(key==='#content .empty')return activeEmpty;if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
  const nav=['discover','subscriptions'].map(view=>{const node=new Element();node.dataset.view=view;return node;});
  const api=createVideoAPI({baseURL:API,environment:{localStorage:{getItem:k=>values.get(k)??null,setItem(){storageWrites++;assert.fail('read path cannot change saved state');}}},
    // Isolated unit fixture only: returns no credential or proof, never contacts a service.
    authorize(path,method,body){assert.equal(path,'/v1/subscriptions');assert.equal(method,'GET');assert.equal(body,undefined);authorizations.push({path,method,account:context.productState.session?.account});return {};},getAccount(){assert.fail('GET path must not read a mutation principal');},
    fetch:async(url,options)=>{calls.push({url,method:options.method,credentials:options.credentials,headers:options.headers});assert.equal(options.method,'GET');assert.equal(Object.keys(options.headers).length,0);assert.ok(url===API+'/v1/subscriptions'||url.startsWith(API+'/v1/videos?q=')||/^https:\/\/video\.ynxweb4\.com\/video\/api\/v1\/channels\/[A-Za-z0-9_]+$/.test(url));assert.equal(options.credentials,url.endsWith('/subscriptions')?'same-origin':'omit');
      let response;
      if(url.includes('/v1/channels/')){response=channelResponses.shift()??{data:detail(url.split('/').at(-1))};}
      else response=responses.shift()??{data:[]};
      response.entered?.resolve();if(response.gate)await response.gate.promise;return new Response(JSON.stringify(response.data??[]),{headers:{'Content-Type':'application/json'}});
    }});
  context=vm.createContext({API,api,Error,DOMException,AbortController,AbortSignal,libraryEpoch:0,navigationRevision:0,currentView:'subscriptions',currentPlaylist:null,currentChannelId:null,playbackSelectionRevision:0,productRevision:0,productState:{status:'connected',session:fixtureA},productSignOutPending:false,productRequestAbort:new AbortController(),businessIdentity:{matches:session=>identityAdmitted&&(session===fixtureA||session===fixtureB)},
    $,t:key=>key,navigator:{onLine:true},notice:(...args)=>notices.push(args),focusSignIn:()=>assert.fail('no sign-in fixture'),nav,document:{createElement:()=>new Element(),querySelectorAll:()=>nav,querySelector:selector=>nav.find(row=>selector.includes('"'+row.dataset.view+'"'))??null}});
  vm.runInContext(slice('function invalidateProductRequests()', '\nlet productSignOutPending')+'\n'+slice('const privateAPI = async','\nconst playlistJournal=')+'\n'+slice('function playlistScope(', '\nasync function createOriginalPlaylist')+'\n'+slice('function productConnected()', '\nfunction renderProductState')+'\n'+slice('function renderAccountRequired(', '\nasync function restoreVideoAccount')+'\n'+slice('function beginLibrary(', '\nasync function openSavedVideo')+'\n'+slice('function esc(', '\nfunction renderWalletChoices(')+'\n'+slice('async function showSubscriptions(', '\nasync function refreshSubscriptionButton')+'\n'+slice('async function showChannel(', '\nasync function showPlaylists')+'\n'+slice('function showSettings(', '\n$("#signin").onclick')+'\n'+slice('nav.find(b => b.dataset.view === "discover").onclick =','\nnav.find(b => b.dataset.view === "subscriptions")')+'\n'+slice('nav.find(b => b.dataset.view === "subscriptions").onclick =','\nnav.find(b => b.dataset.view === "playlists")')+'\n'+slice('$("#privacy").onclick =','\n\nclearLegacySession'),context);
  const queue=(data,gate=null)=>{const entry={data,gate,entered:deferred()};responses.push(entry);return entry;};
  const subscriptions=async(data=[channel('chn_A'),channel('chn_B')])=>{queue(data);context.button=nav[1];await vm.runInContext('showSubscriptions(button)',context);await turn();};
  const state=()=>({view:context.currentView,playlist:context.currentPlaylist,channel:context.currentChannelId,epoch:context.libraryEpoch,navigation:context.navigationRevision,html:content.innerHTML,children:content.children.map(x=>x.innerHTML),busy:content.attributes['aria-busy'],title:$('#page-title').textContent,i18n:$('#page-title').attributes['data-i18n'],notice:JSON.stringify(notices),requests:calls.length,unitAuthorizations:authorizations.length});
  return {context,$,calls,authorizations,notices,queue,subscriptions,state,rows:()=>content.children.filter(row=>row.className==='library-row'),
    async open(row){await row.querySelector('.open-channel').onclick();await turn();},privacy:()=>$('#privacy').onclick(),
    async catalog(){queue([]);await vm.runInContext('loadVideos("new")',context);await turn();},
    async subNav(data=[channel('chn_A'),channel('chn_B')]){queue(data);await nav[1].onclick({currentTarget:nav[1]});await turn();},
    holdChannel(id){const entry={data:detail(id),gate:deferred(),entered:deferred()};channelResponses.push(entry);return entry;},
    rejectIdentity(){identityAdmitted=false;},retire(){vm.runInContext('invalidateProductRequests()',context);context.productState={status:'guest',session:null};identityAdmitted=false;},
    identityABA(){vm.runInContext('invalidateProductRequests()',context);context.productState={status:'connected',session:fixtureB};vm.runInContext('invalidateProductRequests()',context);context.productState={status:'connected',session:fixtureA};},
    assertSeparate(){assert.equal(storageWrites,0);assert.deepEqual([...values],original);assert.ok(calls.every(x=>x.method==='GET'));assert.ok(authorizations.every(x=>x.path==='/v1/subscriptions'&&x.method==='GET'));}};
}

test('old subscription opener cannot navigate/read after newer public catalog',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];await h.catalog();const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('old opener cannot acquire replacement subscription-list generation',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];await h.subscriptions([channel('chn_B')]);const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('old opener cannot overwrite newer in-flight catalog loading state',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0],gate=deferred(),entry=h.queue([],gate);const pending=vm.runInContext('loadVideos("new")',h.context);await entry.entered.promise;const before=h.state();await h.open(old);const after=h.state();gate.resolve();await pending;assert.deepEqual(after,before);h.assertSeparate();});
test('old A opener cannot replace actual channel B rendered catalog or heading',async()=>{const h=harness();await h.subscriptions();const [old,b]=h.rows();await h.open(b);assert.equal(h.context.currentChannelId,'chn_B');const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('normal privacy navigation retires original subscription opener',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];h.privacy();const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('subscriptions to catalog to subscriptions ABA never revives first opener',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];await h.catalog();await h.subNav();const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);await h.open(h.rows()[0]);assert.equal(h.context.currentChannelId,'chn_A');h.assertSeparate();});
test('actual request/guest retirement stops old opener before public channel read',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];h.retire();const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('unit account A to B to A revisions do not revive old opener',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];h.identityABA();const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
test('lost unit business identity blocks old row before channel/view mutation',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];h.rejectIdentity();const before=h.state();await h.open(old);assert.deepEqual(h.state(),before);h.assertSeparate();});
for(const index of [0,1])test(`current subscription opener ${index} uses actual channel API and videoCard rendering`,async()=>{const h=harness();await h.subscriptions();await h.open(h.rows()[index]);const id=index?'chn_B':'chn_A';assert.equal(h.context.currentChannelId,id);assert.equal(h.context.currentView,'channel');assert.equal(h.$('#page-title').textContent,'Channel '+id);assert.equal(h.$('#content').children.length,1);assert.match(h.$('#content').children[0].innerHTML,new RegExp('Video '+id));assert.equal(h.$('#content').attributes['aria-busy'],'false');assert.equal(h.calls.length,2);assert.equal(h.authorizations.length,1);assert.equal(h.calls[1].credentials,'omit');assert.match(h.notices.at(-1)[0],/7 persisted subscriber/);h.assertSeparate();});
test('starting channel request immediately retires repeated original row handler',async()=>{const h=harness();await h.subscriptions();const button=h.rows()[0].querySelector('.open-channel'),entry=h.holdChannel('chn_A');const first=button.onclick();await entry.entered.promise;const before=h.state();await button.onclick();await turn();const after=h.state();entry.gate.resolve();await first;assert.deepEqual(after,before);h.assertSeparate();});
test('empty current subscriptions renders empty state without channel opener',async()=>{const h=harness();await h.subscriptions([]);assert.equal(h.rows().length,0);assert.match(h.$('#content').innerHTML,/No subscriptions yet/);assert.equal(h.calls.length,1);assert.equal(h.authorizations.length,1);h.assertSeparate();});
test('fresh subscription navigation creates a valid opener that can reopen same channel',async()=>{const h=harness();await h.subscriptions();const old=h.rows()[0];await h.open(old);await h.subNav();const fresh=h.rows()[0];assert.notEqual(fresh,old);await h.open(fresh);assert.equal(h.context.currentChannelId,'chn_A');assert.equal(h.calls.length,4);assert.equal(h.authorizations.length,2);h.assertSeparate();});
