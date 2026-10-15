import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {createPlaylistJournal,createPlaylistOperationJournal} from './playlist-journal.js';
import {createRecoveredPlaylist,recoverPlaylistOperation} from './playlist-recovery.js';
import {createVideoAPI} from './video-api.js';
const source=await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(done=>setImmediate(done));
const API='https://video.ynxweb4.com/video/api';
const video=id=>({id,title:'Title '+id,status:'ready',channel_id:'channel-'+id,variants:[{name:'original-fallback',object_key:id+'/original',mime:'video/mp4'}],captions:[]});
function harness(){
  const fixtureA={account:'ynx1'+'q'.repeat(38)},fixtureB={account:'ynx1'+'p'.repeat(38)};
  const calls=[],responses=[],retryNodes=[],notices=[],authorizations=[],values=new Map([['profile','original-profile'],['draft','original-draft'],['ynx.video.pending-mutations.v1',JSON.stringify({version:1,records:[{account:'original-owner',method:'POST',path:'/v1/videos/original/watch',key:'original-operation-key',bodyDigest:'a'.repeat(64),bodyBytes:31,contentType:'application/json',firstCause:{name:'TypeError',stage:'result-unconfirmed'},state:'UNKNOWN'}]})]]),original=[...values];
  let activeEmpty=null,identityAdmitted=true,storageWrites=0,context;
  const idbReads=[],idbOpens=[],databases=new Map();let journalWrites=0,journalAborts=0;
  const digest=text=>createHash('sha256').update(text).digest('hex');
  for(const operations of [false,true]){
    const name=operations?'ynx.video.playlist-changes.v1':'ynx.video.playlist-intents.v1',owner=digest((operations?'ynx.video.playlist-change.v1:':'ynx.video.playlist-intent.v1:')+fixtureA.account);
    const retained={key:(operations?'video-playlist-change-':'video-playlist-')+'00000000-0000-4000-8000-000000000001',body:operations?{action:'remove',playlistID:'pl_retained',videoID:'vid_retained',name:'Original paused item'}:{Name:'Original paused draft'}};
    databases.set(name,new Map([[owner,{version:1,owner,pending:null,history:[retained]}]]));
  }
  const journalSnapshot=JSON.stringify([...databases].map(([name,rows])=>[name,[...rows]]));
  // Narrow IndexedDB I/O fixture only; actual journal hashes/validates/reads records.
  const indexedDB={open(name,version){assert.equal(version,1);idbOpens.push(name);const request={};setImmediate(()=>{request.result={objectStoreNames:{contains:store=>store==='intents'},createObjectStore(){journalWrites++;assert.fail('no schema creation in seeded fixture');},close(){},transaction(store,mode){assert.equal(store,'intents');assert.equal(mode,'readwrite');let aborted=false;const tx={abort(){if(aborted)return;aborted=true;journalAborts++;setImmediate(()=>tx.onabort?.());},objectStore(){return {get(key){const get={};idbReads.push({name,key,mode});setImmediate(()=>{if(aborted)return;get.result=structuredClone(databases.get(name)?.get(key));get.onsuccess?.();if(!aborted)setImmediate(()=>{if(!aborted)tx.oncomplete?.();});});return get;},put(){journalWrites++;assert.fail('read path must not put journal record');},delete(){journalWrites++;assert.fail('read path must not delete journal record');}};}};return tx;}};request.onsuccess?.();});return request;}};
  const playlistJournal=createPlaylistJournal({indexedDB,crypto:webcrypto}),playlistOperations=createPlaylistOperationJournal({indexedDB,crypto:webcrypto});
  class Element extends EventTarget{
    constructor(){super();this.children=[];this.attributes={};this.dataset={};this.classList={toggle(){}};this._html='';this.textContent='';this.disabled=false;this.paused=true;this.open=false;}
    showModal(){this.open=true;}close(){this.open=false;}canPlayType(){return '';}pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
    set innerHTML(value){this._html=value;this.children=[];if(this===content){activeEmpty=null;if(value.includes('<div class="empty">')){activeEmpty=new Element();this.children.push(activeEmpty);}}}get innerHTML(){return this._html;}
    replaceChildren(...items){this.children=[...items];this._html='';if(this===content)activeEmpty=null;}append(...items){this.children.push(...items);if(this===activeEmpty)for(const item of items)if(typeof item.onclick==='function')retryNodes.push(item);}
    setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];if(k==='src')delete this.src;}
    querySelector(selector){if(selector==='[data-pause-playlist]')return null;this.parts??=new Map();if(!this.parts.has(selector))this.parts.set(selector,new Element());return this.parts.get(selector);}
  }
  const content=new Element(),nodes=new Map([['#content',content]]),$=key=>{if(key==='#retry-load')return null;if(key==='#content .empty')return activeEmpty;if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
  const nav=['discover','playlists'].map(view=>{const node=new Element();node.dataset.view=view;return node;});
  const api=createVideoAPI({baseURL:API,environment:{localStorage:{getItem:k=>values.get(k)??null,setItem(){storageWrites++;assert.fail('library GET must not alter original saved state');}}},
    // Explicit isolated authorization fixture: no proof, signature, token, issuer or external service.
    authorize(path,method,body){assert.ok(['/v1/playlists'].includes(path));assert.equal(method,'GET');assert.equal(body,undefined);authorizations.push({path,method,account:context.productState.session?.account});return {};},
    getAccount(){assert.fail('only mutations read principal in actual API; test permits GET only');},fetch:async(url,options)=>{
      calls.push({url,method:options.method,credentials:options.credentials,headers:options.headers});assert.equal(options.method,'GET');assert.ok(url===API+'/v1/playlists'||url===API+'/v1/subscriptions'||url.startsWith(API+'/v1/videos')); assert.equal(Object.keys(options.headers).length,0,'fixture authorization returns no credentials');assert.equal(options.credentials,(url.endsWith('/v1/playlists')||url.endsWith('/v1/subscriptions'))?'same-origin':'omit');
      if(url===API+'/v1/subscriptions'||/\/comments$/.test(url))return new Response('[]',{headers:{'Content-Type':'application/json'}});
      if(/\/v1\/videos\/[^/?]+$/.test(url))return new Response(JSON.stringify(video(decodeURIComponent(url.split('/').at(-1)))),{headers:{'Content-Type':'application/json'}});
      const response=responses.shift()??{data:[{ID:'pl_A',Owner:context.productState.session.account,Name:'Playlist pl_A',VideoIDs:['A']},{ID:'pl_B',Owner:context.productState.session.account,Name:'Playlist pl_B',VideoIDs:['B']}]};response.entered?.resolve();if(response.gate)await response.gate.promise;if(response.networkError)throw new TypeError('controlled fixture read failure');return new Response(JSON.stringify(response.status?{error:response.error??'fixture playlist unavailable'}:response.data??[]),{status:response.status??200,headers:{'Content-Type':'application/json'}});
    }});
  context=vm.createContext({API,api,Error,DOMException,AbortController,AbortSignal,libraryEpoch:0,navigationRevision:0,currentView:'playlists',currentPlaylist:null,productRevision:0,productState:{status:'connected',session:fixtureA},productSignOutPending:false,productRequestAbort:new AbortController(),playlistJournal,playlistOperations,createRecoveredPlaylist,recoverPlaylistOperation,currentVideo:null,watchProgress:null,watchProgressSelection:0,playbackSelectionRevision:0,commentsRevision:0,subscriptionRevision:0,
    // Only the predicate dependency is a unit fixture; exact productConnected/privateAPI/scope run.
    businessIdentity:{matches:session=>identityAdmitted&&(session===fixtureA||session===fixtureB)},
    $,t:key=>key,navigator:{onLine:true},notice:(...args)=>notices.push(args),focusSignIn:()=>assert.fail('never initiate sign-in'),nav,document:{createElement:tag=>{const node=new Element();if(tag==='form')node.elements={name:new Element()};return node;},querySelectorAll:()=>nav,querySelector:selector=>nav.find(row=>selector.includes('"'+row.dataset.view+'"'))??null}});
  vm.runInContext(slice('function invalidateProductRequests()', '\nlet productSignOutPending')+'\n'+slice('const privateAPI = async','\nconst playlistJournal=')+'\n'+slice('function playlistScope(', '\nconst json =')+'\n'+slice('function productConnected()', '\nfunction renderProductState')+'\n'+slice('function renderAccountRequired(', '\nasync function restoreVideoAccount')+'\n'+slice('function beginLibrary(', '\nasync function openSavedVideo')+'\n'+slice('function esc(', '\nfunction renderWalletChoices(')+'\n'+slice('async function showPlaylists(', '\nasync function showHistory')+'\n'+slice('function showSettings(', '\n$("#signin").onclick')+'\n'+slice('nav.find(b => b.dataset.view === "discover").onclick =','\nnav.find(b => b.dataset.view === "subscriptions")')+'\n'+slice('nav.find(b => b.dataset.view === "playlists").onclick =','\nnav.find(b => b.dataset.view === "history")')+'\n'+slice('$("#privacy").onclick =','\n\nclearLegacySession'),context);
  const queue=(response={})=>{const entry={...response,entered:deferred()};responses.push(entry);return entry;};
  const list=(id,ids=[])=>({ID:id,Owner:context.productState.session.account,Name:'Playlist '+id,VideoIDs:ids});
  const lists=async(data=[list('pl_A',['A']),list('pl_B',['B'])])=>{queue({data});context.listButton=nav[1];await vm.runInContext('showPlaylists(listButton)',context);await turn();await turn();};
  const state=()=>({view:context.currentView,playlist:context.currentPlaylist,epoch:context.libraryEpoch,navigation:context.navigationRevision,html:content.innerHTML,children:content.children.map(x=>x.innerHTML),busy:content.attributes['aria-busy'],notice:JSON.stringify(notices),requests:calls.length,unitAuthorizations:authorizations.length,journalReads:idbReads.length,retry:activeEmpty});
  const rows=()=>content.children.filter(row=>row.className==='library-row');
  return {context,$,calls,notices,authorizations,idbReads,idbOpens,queue,list,lists,state,rows,journalAborts:()=>journalAborts,form:()=>content.children.find(row=>row.className==='library-create'),
    async submit(form){const event={defaultPrevented:false,preventCalls:0,preventDefault(){this.defaultPrevented=true;this.preventCalls++;}};await form.onsubmit(event);await turn();return event;},
    async open(row){await row.querySelector('.open-list').onclick();await turn();await turn();},privacy:()=>$('#privacy').onclick(),
    async catalog(response={data:[]}){queue(response);await vm.runInContext('loadVideos("new")',context);await turn();},
    async listNav(data){queue({data});await nav[1].onclick({currentTarget:nav[1]});await turn();await turn();},
    async back(){const heading=content.children.find(row=>row.className==='library-heading');assert.ok(heading);await heading.querySelector('button').onclick();await turn();await turn();},
    rejectIdentity(){identityAdmitted=false;},retire(){vm.runInContext('invalidateProductRequests()',context);context.productState={status:'guest',session:null};identityAdmitted=false;},
    identityABA(){vm.runInContext('invalidateProductRequests()',context);context.productState={status:'connected',session:fixtureB};vm.runInContext('invalidateProductRequests()',context);context.productState={status:'connected',session:fixtureA};},
    assertSeparate(){assert.equal(storageWrites,0);assert.equal(journalWrites,0);assert.equal(JSON.stringify([...databases].map(([name,rows])=>[name,[...rows]])),journalSnapshot);assert.ok(idbReads.every(row=>['ynx.video.playlist-changes.v1','ynx.video.playlist-intents.v1'].includes(row.name)&&row.mode==='readwrite'));assert.deepEqual([...values],original);assert.ok(calls.every(x=>x.method==='GET'));assert.ok(authorizations.every(x=>x.path==='/v1/playlists'&&x.method==='GET'));}};
}

for(const retirement of ['privacy','replacement','guest','accountABA','predicate','listABA'])test(`retired form prevents default without disabling stale submit after ${retirement}`,async()=>{
  const h=harness();await h.lists();const old=h.form(),button=old.querySelector('button[type="submit"]');old.elements.name.value='Retained unit draft';assert.equal(button.disabled,false);
  if(retirement==='privacy')h.privacy();
  if(retirement==='replacement')await h.lists([h.list('pl_B',['B'])]);
  if(retirement==='guest')h.retire();
  if(retirement==='accountABA')h.identityABA();
  if(retirement==='predicate')h.rejectIdentity();
  if(retirement==='listABA'){await h.catalog();await h.listNav([h.list('pl_A',['A'])]);}
  const before=h.state(),event=await h.submit(old);
  // Existing current() already prevents any journal begin or API mutation.
  h.assertSeparate();assert.deepEqual(h.state(),before);assert.equal(event.defaultPrevented,true);assert.equal(event.preventCalls,1);assert.equal(old.elements.name.value,'Retained unit draft');assert.equal(h.journalAborts(),0);
  const current=h.form();if(current)assert.equal(current.querySelector('button[type="submit"]').disabled,false);
  assert.equal(button.disabled,false,'retired handler must not disable its old submit');
});
for(const input of ['', ' \t '])test(`current no-write journal validation stays intact for ${JSON.stringify(input)}`,async()=>{
  const h=harness();await h.lists();const form=h.form(),button=form.querySelector('button[type="submit"]');form.elements.name.value=input;const event=await h.submit(form);
  assert.equal(event.defaultPrevented,true);assert.equal(event.preventCalls,1);assert.equal(button.disabled,false);assert.equal(form.elements.name.value,'');assert.equal(form.elements.name.disabled,false);assert.equal(h.calls.length,1);assert.equal(h.authorizations.length,1);assert.equal(h.idbReads.length,4);assert.equal(h.journalAborts(),1);assert.deepEqual(h.notices.at(-1),['Playlist name must contain 1–100 UTF-8 bytes.',true]);h.assertSeparate();
});
test('fresh current form can repeat no-write validation with finally reenabled submit',async()=>{
  const h=harness();await h.lists();const old=h.form();await h.lists([h.list('pl_A',['A'])]);const form=h.form();assert.notEqual(form,old);const button=form.querySelector('button[type="submit"]');const first=await h.submit(form),second=await h.submit(form);assert.equal(first.defaultPrevented,true);assert.equal(second.defaultPrevented,true);assert.equal(button.disabled,false);assert.equal(h.journalAborts(),2);assert.equal(h.calls.length,2);assert.equal(h.authorizations.length,2);assert.equal(h.idbReads.length,8);assert.equal(h.notices.filter(row=>row[0]==='Playlist name must contain 1–100 UTF-8 bytes.').length,2);h.assertSeparate();
});
