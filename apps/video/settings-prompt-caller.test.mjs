import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createVideoBusinessIdentity} from './business-identity.js';
const source=await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const turn=()=>new Promise(done=>setImmediate(done));
function harness(){
  let now=Date.parse('2030-01-01T00:00:00Z'),verifyingAccount=null,answer=false,timerID=0,activeDelete=null;
  const timers=new Map(),identityReads=[],prompts=[],dangerCalls=[],nodes=new Map(),values=new Map([['profile','original-profile'],['draft','original-draft'],['ynx.video.pending-mutations.v1','original UNKNOWN fence']]),original=[...values];
  const session=id=>({account:'unit-only-account-'+id,sessionBinding:'unit-binding-'+id,deviceId:'unit-device-'+id,deviceKey:'unit-key-'+id,expiresAt:new Date(now+60000).toISOString()});
  const a=session('A'),b=session('B');
  // Actual identity algorithm, controlled time and local reply only; no service proof or grant.
  const businessIdentity=createVideoBusinessIdentity({now:()=>now,read:async path=>{assert.equal(path,'/v1/account');identityReads.push({path,account:verifyingAccount});return {schemaVersion:1,account:verifyingAccount};}});
  class Element extends EventTarget{
    constructor(){super();this.children=[];this.attributes={};this.dataset={};this.classList={toggle(){}};this.style={};this.textContent='';this.value='';this.disabled=false;this.hidden=false;this.open=false;this._html='';}
    set innerHTML(value){this._html=value;this.children=[];if(this===content){activeDelete=value.includes('id="delete-viewer-data"')?new Element():null;if(activeDelete)this.children.push(activeDelete);}}get innerHTML(){return this._html;}
    setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];}
    replaceChildren(...items){this.children=[...items];this._html='';if(this===content)activeDelete=null;}append(...items){this.children.push(...items);}close(){this.open=false;}
  }
  const content=new Element();nodes.set('#content',content);const $=key=>{if(key==='#delete-viewer-data')return activeDelete;if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
  const denied=name=>(...args)=>{dangerCalls.push(name);assert.fail('unexercised privacy deletion dependency: '+name);};
  class FixtureDate extends Date{static now(){return now;}}
  const nav=new Element();nav.dataset.view='settings';
  const context=vm.createContext({Error,DOMException,AbortController,Date:FixtureDate,productState:{status:'guest'},productRevision:0,productRequestAbort:new AbortController(),productSignOutPending:false,productExpiryTimer:null,libraryEpoch:0,navigationRevision:0,currentView:'initial',currentPlaylist:null,currentVideo:null,watchProgress:null,playlistTarget:null,siteAccountBusy:false,subscriptionRevision:0,playbackSelectionRevision:0,
    businessIdentity,browserIdentity:{invalidate(){}},$,document:{querySelectorAll:()=>[nav]},focusSignIn:denied('sign-in'),
    confirm:message=>{prompts.push(message);return answer;},
    setTimeout:(callback,delay)=>{const id=++timerID;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
    // Never return a fake successful delete/flush/clear; these branches must remain unentered.
    privateAPI:denied('privateAPI'),flushWatch:denied('flushWatch'),startWatchProgress:denied('startWatchProgress'),refreshLibraryView:denied('refreshLibraryView'),
    playlistJournal:{clear:denied('journal.clear')},playlistOperations:{clear:denied('operations.clear')},
    localStorage:{getItem:k=>values.get(k)??null,setItem:denied('storage.set'),removeItem:denied('storage.remove')}});
  vm.runInContext(slice('function maskAccount(', '\nfunction clearLegacySession')+'\n'+slice('function invalidateProductRequests()', '\nlet productSignOutPending')+'\n'+slice('function playlistScope(', '\nasync function createOriginalPlaylist')+'\n'+slice('function notice(', '\nfunction focusSignIn')+'\n'+slice('function renderAccountRequired(', '\nasync function restoreVideoAccount')+'\n'+slice('function beginLibrary(', '\nfunction libraryFailure')+'\n'+slice('function activate(', '\nfunction videoCard')+'\n'+slice('async function refreshSubscriptionButton(', '\nasync function showChannel')+'\n'+slice('function showSettings(', '\n$("#signin").onclick'),context);
  const render=async state=>{context.nextState=state;vm.runInContext('renderProductState(nextState)',context);await turn();};
  const admit=async fixture=>{verifyingAccount=fixture.account;await businessIdentity.verify(fixture);context.nextState={status:'connected',session:fixture};vm.runInContext('renderProductState(nextState,{identityConfirmed:true})',context);await turn();};
  const show=()=>vm.runInContext('showSettings()',context);
  const snapshot=()=>({epoch:context.libraryEpoch,revision:context.productRevision,view:context.currentView,playlist:context.currentPlaylist,html:content.innerHTML,notice:$('#notice').textContent,dangerCalls:dangerCalls.length,identityReads:identityReads.length});
  return {context,$,prompts,identityReads,dangerCalls,a,b,businessIdentity,timers,admit,render,show,snapshot,button:()=>activeDelete,setAnswer:value=>answer=value,
    async init(){await admit(a);show();assert.ok(activeDelete);},
    expireBeforeTimer(){now+=60001;assert.equal(businessIdentity.matches(a),false);},
    async expiryCallback(){const id=context.productExpiryTimer,entry=timers.get(id);assert.ok(entry);timers.delete(id);entry.callback();await turn();},
    async click(button){await button.onclick({currentTarget:button});await turn();},
    assertUnchanged(){assert.equal(dangerCalls.length,0);assert.deepEqual([...values],original);assert.ok(identityReads.every(row=>row.path==='/v1/account'));}};
}

for(const answer of [false,true])test(`actual identity expiry before queued timer must block prompt/control, answer=${answer}`,async()=>{
  const h=harness();await h.init();const button=h.button(),epoch=h.context.libraryEpoch;h.expireBeforeTimer();assert.equal(h.context.libraryEpoch,epoch);assert.equal(h.context.currentView,'settings');assert.ok(h.timers.size>0,'expiry task deliberately queued, not treated as already handled');h.setAnswer(answer);const before=h.snapshot();await h.click(button);h.assertUnchanged();assert.deepEqual(h.snapshot(),before);assert.deepEqual({prompts:h.prompts.length,disabled:button.disabled},{prompts:0,disabled:false});
});
for(const retirement of ['guest','switch','accountABA','timer','newSettings'])for(const answer of [false,true])test(`normal ${retirement} contract already retires settings button, answer=${answer}`,async()=>{
  const h=harness();await h.init();const button=h.button(),epoch=h.context.libraryEpoch;
  if(retirement==='guest')await h.render({status:'guest'});
  if(retirement==='switch')await h.admit(h.b);
  if(retirement==='accountABA'){await h.admit(h.b);await h.admit(h.a);}
  if(retirement==='timer'){h.expireBeforeTimer();await h.expiryCallback();}
  if(retirement==='newSettings')h.show();
  assert.ok(h.context.libraryEpoch>epoch);h.setAnswer(answer);const before=h.snapshot();await h.click(button);h.assertUnchanged();assert.deepEqual(h.snapshot(),before);assert.equal(h.prompts.length,0);assert.equal(button.disabled,false);
});
test('current valid settings cancellation remains repeatable without private deletion',async()=>{const h=harness();await h.init();const button=h.button(),before=h.snapshot();h.setAnswer(false);await h.click(button);await h.click(button);assert.deepEqual(h.snapshot(),before);assert.equal(h.prompts.length,2);assert.equal(button.disabled,false);h.assertUnchanged();});
test('fresh settings owns new current control with normal cancellation',async()=>{const h=harness();await h.init();const old=h.button();h.show();const fresh=h.button();assert.notEqual(fresh,old);h.setAnswer(false);const before=h.snapshot();await h.click(fresh);assert.deepEqual(h.snapshot(),before);assert.equal(h.prompts.length,1);assert.equal(fresh.disabled,false);h.assertUnchanged();});
test('normal guest settings shows account-required content without extra identity read or delete control',async()=>{const h=harness();h.show();assert.equal(h.button(),null);assert.match(h.$('#content').innerHTML,/Sign in with YNX Wallet/);assert.equal(h.identityReads.length,0);assert.equal(h.prompts.length,0);h.assertUnchanged();});
