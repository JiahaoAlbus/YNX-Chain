import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';
import {createWatchProgress} from './watch-progress.js';
const source=await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(done=>setImmediate(done));
const API='https://video.ynxweb4.com/video/api';
const video=(id, thumbnail=true)=>({id,channel_id:'channel-'+id,title:'Title '+id,description:'Description '+id,status:'ready',visibility:'public',thumbnail_key:thumbnail?id+'/thumbnail-asset.png':undefined,variants:[{name:'original-fallback',object_key:id+'/original',mime:'video/mp4'}],captions:[]});
function harness() {
  const calls=[],catalogs=[],trackers=[],notices=[],values=new Map([['profile','original-profile'],['draft','original-draft'],['ynx.video.pending-mutations.v1',JSON.stringify({version:1,records:[{account:'original-owner',method:'POST',path:'/v1/videos/original/watch',key:'original-operation-key',bodyDigest:'a'.repeat(64),bodyBytes:31,contentType:'application/json',firstCause:{name:'TypeError',stage:'result-unconfirmed'},state:'UNKNOWN'}]})]]),original=[...values];
  let authorityCalls=0,storageWrites=0,now=0;
  class Element extends EventTarget {
    constructor(){super();this.children=[];this.attributes={};this.dataset={};this.classList={toggle(){},add(){},remove(){}};this.open=false;this.paused=true;this.currentTime=0;this.seeking=false;this.playbackRate=1;this.textContent='';this._html='';}
    set innerHTML(value){this._html=value;this.children=[];}get innerHTML(){return this._html;}
    setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];if(k==='src')delete this.src;}
    replaceChildren(...items){this.children=[...items];}append(...items){this.children.push(...items);}
    showModal(){this.open=true;}close(){this.open=false;}
    canPlayType(){return '';}
    pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
    querySelector(selector){assert.equal(selector,'button');return this.button??=new Element();}
  }
  const nodes=new Map(),$=key=>{if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
  const discover=new Element();discover.dataset.view='discover';
  const api=createVideoAPI({baseURL:API,environment:{localStorage:{getItem:k=>values.get(k)??null,setItem(){storageWrites++;assert.fail('guest reads never alter UNKNOWN/profile/draft');}}},
    authorize(){authorityCalls++;assert.fail('guest catalog/player must not authorize');},getAccount(){authorityCalls++;assert.fail('guest GET must not read principal');},
    fetch:async(url,options)=>{calls.push({url,method:options.method,credentials:options.credentials});assert.equal(options.method,'GET');
      if(url.includes('/v1/videos?q=')){const entry=catalogs.shift();assert.ok(entry,'catalog response must be explicitly scheduled');entry.entered.resolve();if(entry.gate)await entry.gate.promise;return new Response(JSON.stringify(entry.videos),{headers:{'Content-Type':'application/json'}});}
      assert.match(url,/\/v1\/videos\/[^/]+\/comments$/);return new Response('[]',{headers:{'Content-Type':'application/json'}});}});
  const context=vm.createContext({API,api,Error,DOMException,AbortController,AbortSignal,
    libraryEpoch:0,navigationRevision:0,currentView:'discover',currentPlaylist:null,currentVideo:null,currentChannelId:null,
    playbackSelectionRevision:0,commentsRevision:0,subscriptionRevision:0,watchProgress:null,watchProgressSelection:0,
    productRevision:0,productState:{status:'guest',session:null},productSignOutPending:false,productRequestAbort:new AbortController(),
    productConnected:()=>false,notice:(...args)=>notices.push(args),focusSignIn:()=>assert.fail('fixture never signs in'),t:key=>key,navigator:{onLine:true},$,
    nav:[discover],document:{createElement:()=>new Element(),querySelectorAll:()=>[discover],querySelector:()=>discover},
    createWatchProgress:options=>{const tracker=createWatchProgress({...options,clock:()=>now,idFactory:randomUUID});trackers.push(tracker);return tracker;}});
  vm.runInContext(slice('const privateAPI = async','\nconst playlistJournal=')+'\n'+slice('function renderAccountRequired(', '\nasync function restoreVideoAccount')+'\n'+
    slice('function beginLibrary(', '\nfunction libraryFailure')+'\n'+slice('function esc(', '\nfunction renderWalletChoices(')+'\n'+
    slice('function startWatchProgress(', '\nasync function showSubscriptions')+'\n'+slice('async function refreshSubscriptionButton(', '\nasync function showChannel')+'\n'+
    slice('function showSettings(', '\n$("#signin").onclick')+'\n'+slice('const json =','\nfunction notice')+'\n'+
    slice('$("#close").onclick =','\n$("#channel").onclick =')+'\n'+
    slice('nav.find(b => b.dataset.view === "discover").onclick =','\nnav.find(b => b.dataset.view === "subscriptions")')+'\n'+
    slice('$("#privacy").onclick =','\n\nclearLegacySession'),context);
  const queue=(videos,gate=null)=>{const entry={videos,gate,entered:deferred()};catalogs.push(entry);return entry;};
  const settle=async()=>{await turn();await turn();};
  const load=async(videos,query='')=>{queue(videos);context.query=query;await vm.runInContext('loadVideos(query)',context);await settle();};
  const state=()=>({currentVideo:context.currentVideo,tracker:context.watchProgress,selection:context.playbackSelectionRevision,ownerSelection:context.watchProgressSelection,title:$('#player-title').textContent,media:$('#video').src,open:$('#player').open,commentsRevision:context.commentsRevision,trackers:trackers.length,requests:calls.length});
  return {context,$,calls,trackers,notices,queue,settle,load,state,cards:()=>$('#content').children,
    async invoke(card){await card.querySelector('button').onclick();await settle();},
    privacy:()=>$('#privacy').onclick(),async discover(videos){queue(videos);discover.onclick({currentTarget:discover});await settle();},
    close:()=>$('#close').onclick(),cancel:()=>{const event=new Event('cancel',{cancelable:true});$('#player').dispatchEvent(event);if(!event.defaultPrevented)$('#player').close();},
    async sample(){const media=$('#video');for(let p=0;p<=16;p++){now+=1000;media.currentTime=p;media.paused=false;media.dispatchEvent(new Event('timeupdate'));}media.pause();await settle();},
    assertSeparate(){assert.equal(authorityCalls,0);assert.equal(storageWrites,0);assert.deepEqual([...values],original);assert.ok(calls.every(x=>x.method==='GET'&&x.credentials==='omit'));assert.equal(context.productState.session,null);}};
}

test('old A card is retired immediately while newer catalog B is in flight',async()=>{
  const h=harness();await h.load([video('A')]);const old=h.cards()[0],gate=deferred(),entry=h.queue([video('B')],gate);const pending=vm.runInContext('loadVideos("B")',h.context);await entry.entered.promise;const before=h.state();await h.invoke(old);const after=h.state();gate.resolve();await pending;await h.settle();assert.deepEqual(after,before);assert.equal(h.context.currentVideo,null);h.assertSeparate();
});
test('old A card cannot start player or watch after B replaces directory',async()=>{
  const h=harness();await h.load([video('A')]);const old=h.cards()[0];await h.load([video('B')]);const before=h.state();await h.invoke(old);assert.deepEqual(h.state(),before);h.assertSeparate();
});
test('old A cannot replace actual B player, tracker, media, selection or trigger A metadata',async()=>{
  const h=harness();await h.load([video('A')]);const old=h.cards()[0];await h.load([video('B')]);await h.invoke(h.cards()[0]);const before=h.state();await h.invoke(old);assert.deepEqual(h.state(),before);assert.equal(h.context.currentVideo.id,'B');assert.equal(h.calls.filter(x=>x.url.endsWith('/A/comments')).length,0);await h.sample();h.assertSeparate();
});
test('normal privacy navigation retires retained directory callback without private authority',async()=>{
  const h=harness();await h.load([video('A')]);const old=h.cards()[0];h.privacy();assert.equal(h.context.currentView,'settings');const before=h.state();await h.invoke(old);assert.deepEqual(h.state(),before);h.assertSeparate();
});
test('discover to privacy to discover same view key cannot revive old A card',async()=>{
  const h=harness();await h.load([video('A')]);const old=h.cards()[0];h.privacy();await h.discover([video('A')]);assert.equal(h.context.currentView,'discover');const before=h.state();await h.invoke(old);assert.deepEqual(h.state(),before);await h.invoke(h.cards()[0]);assert.equal(h.context.currentVideo.id,'A');assert.equal(h.trackers.length,1);h.assertSeparate();
});
for(const thumbnail of [true,false])test(`current visible card with thumbnail=${thumbnail} opens real player/watch and public metadata`,async()=>{
  const h=harness();await h.load([video('current',thumbnail)]);const card=h.cards()[0];assert.equal(card.innerHTML.includes('<img'),thumbnail);await h.invoke(card);assert.equal(h.context.currentVideo.id,'current');assert.equal(h.$('#video').src,API+'/media/current/original');assert.equal(h.$('#player').open,true);assert.equal(h.trackers.length,1);assert.equal(h.context.watchProgress,h.trackers[0]);assert.equal(h.context.watchProgressSelection,h.context.playbackSelectionRevision);assert.equal(h.calls.filter(x=>x.url.endsWith('/current/comments')).length,1);await h.sample();h.assertSeparate();
});
for(const action of ['close','cancel'])test(`same still-current card remains reusable after actual player ${action}`,async()=>{
  const h=harness();await h.load([video('current')]);const card=h.cards()[0];await h.invoke(card);await h.sample();h[action]();await h.settle();const selection=h.context.playbackSelectionRevision;await h.invoke(card);assert.equal(h.$('#player').open,true);assert.equal(h.context.currentVideo.id,'current');assert.ok(h.context.playbackSelectionRevision>selection);assert.equal(h.trackers.length,2);assert.equal(h.calls.filter(x=>x.url.endsWith('/current/comments')).length,2);h.assertSeparate();
});
test('all cards of same current directory remain selectable A then B then A',async()=>{
  const h=harness();await h.load([video('A'),video('B')]);const [a,b]=h.cards();await h.invoke(a);await h.invoke(b);await h.invoke(a);assert.equal(h.context.currentVideo.id,'A');assert.equal(h.trackers.length,3);assert.equal(h.$('#video').src,API+'/media/A/original');h.assertSeparate();
});
test('identity revision alone does not retire a still-current public directory card',async()=>{
  const h=harness();await h.load([video('A')]);const card=h.cards()[0];h.context.productRevision++;await h.invoke(card);assert.equal(h.context.currentVideo.id,'A');assert.equal(h.trackers.length,1);h.assertSeparate();
});
