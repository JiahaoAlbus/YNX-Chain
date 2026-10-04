import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createVideoBusinessIdentity} from './business-identity.js';
import {createRecoveredPlaylist} from './playlist-recovery.js';

const code=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const video={id:'vid_guest',channel_id:'ch_guest',title:'Owned test video',description:'Test fixture',status:'published',visibility:'public',variants:[{name:'original-fallback',mime:'video/mp4',object_key:'owned.mp4'}]};
class Element {
 constructor(){this.textContent='';this.innerHTML='';this.children=[];this.dataset={};this.attributes=new Map();this.listeners=new Map();this.style={};this.hidden=false;this.open=false;this.classList={toggle(){},add(){},remove(){}};}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 removeAttribute(name){this.attributes.delete(name);}
 remove(){this.removed=true;}
 replaceChildren(...children){this.children=children;this.innerHTML='';}
 append(...children){this.children.push(...children);}
 querySelector(){return this.child??=new Element();}
 addEventListener(name,listener){this.listeners.set(name,listener);}
 showModal(){this.open=true;}
 close(){this.open=false;}
 pause(){this.paused=true;}
 canPlayType(){return '';}
 scrollIntoView(){}
 focus(){this.focused=true;}
}
async function controller({search='',hash='',browser={invalidate(){},signIn(){},logout:async()=>({revoked:true})},product={atRegisteredOrigin:()=>false},request=async path=>path.startsWith('/v1/videos?')?[video]:path.endsWith('/comments')?[]:video}={}){
 const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
 const nav=['discover','subscriptions','playlists','history','settings'].map(view=>{const e=node(`[data-view="${view}"]`);e.dataset.view=view;return e;});
 node('#page-title').setAttribute('data-i18n','discover');node('#content').setAttribute('aria-busy','true');
 const document={querySelector:node,querySelectorAll:selector=>selector==='nav button'?nav:[],createElement:tag=>{const element=new Element();if(tag==='form')element.elements={name:new Element()};return element;}};
 const calls=[];
 const dependencies={createMediaBrowserIdentity:()=>({...browser,authorization:(_session,proof)=>proof()}),document,location:{origin:'https://video.ynxweb4.com',pathname:'/',search,hash},window:{addEventListener(){}},navigator:{onLine:true},URLSearchParams,
  history:{replaceState(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,
  t:key=>({discover:'Discover',empty:'No published videos yet'})[key]??key,i18nReady:Promise.resolve(),
  WALLET_INSTALLATION_OPTIONS:{ynxWallet:'https://www.ynxweb4.com/dapp/download',metaMask:'https://metamask.io/download/'},
  videoProductSession:product,restoreVideoWallet:async()=>null,
  createVideoBusinessIdentity,createRecoveredPlaylist,
  // Navigation fixtures have no real IDB or real actor. Real recovery is checked
  // separately with Chromium IDB and the original protected service journey.
  createPlaylistJournal:()=>({read:async(_account,current)=>{current();return {pending:null,history:[]};}}),
  createVideoAPI:()=>async (path,options)=>{calls.push(path);return path==='/v1/account'?{schemaVersion:1,account:connected.session.account}:request(path,options);},
  createWatchProgress:()=>({flush:async()=>{},discard(){},resetSample(){}}),
  discoverWalletCandidates:async()=>[],
 };
 const app=await new AsyncFunction(...Object.keys(dependencies),code+'\nreturn {openVideo,showChannel,loadVideos,restoreVideoAccount,signOutVideoAccount,renderProductState,showPlaylists,readView:()=>currentView};')(...Object.values(dependencies));
 await turn();await turn();
 return {...app,node,calls};
}

test('opening a video deep link also loads the catalog so closing returns to usable content',async()=>{
 const c=await controller({search:'?video=vid_guest&lang=ar'});
 assert.equal(c.node('#player').open,true);
 c.node('#close').onclick();
 assert.equal(c.node('#player').open,false);
 assert.equal(c.node('#video').paused,true);
 assert.equal(c.node('#content').getAttribute('aria-busy'),'false');
 assert.equal(c.node('#content').children.length,1);
 assert.ok(c.calls.includes('/v1/videos?q='));
});

test('a late translation apply cannot replace the actual channel heading with Discover',async()=>{
 const c=await controller({request:async path=>path.startsWith('/v1/channels/')?{channel:{Name:'Test channel',Handle:'test'},subscribers:0,videos:[video]}:path.startsWith('/v1/videos?')?[video]:[]});
 await c.showChannel('ch_guest');
 assert.equal(c.node('#page-title').textContent,'Test channel');
 assert.equal(c.node('#page-title').getAttribute('data-i18n'),null);
 await c.loadVideos();
 assert.equal(c.node('#page-title').getAttribute('data-i18n'),'discover');
  assert.equal(c.node('#page-title').textContent,'Discover');
});

test('deep-link playback starts while the catalog is pending and closing recovers when it arrives',async()=>{
 let resolveCatalog;
 const pending=new Promise(resolve=>{resolveCatalog=resolve;});
 const c=await controller({search:'?video=vid_guest',request:path=>path.startsWith('/v1/videos?')?pending:path.endsWith('/comments')?[]:video});
 assert.equal(c.node('#player').open,true);
 c.node('#close').onclick();
 assert.equal(c.node('#content').getAttribute('aria-busy'),'true');
 resolveCatalog([video]);await turn();
 assert.equal(c.node('#content').getAttribute('aria-busy'),'false');
 assert.equal(c.node('#content').children.length,1);
});

test('channel navigation ends its own loading state and ignores an older catalog response',async()=>{
 let resolveCatalog;
 const pending=new Promise(resolve=>{resolveCatalog=resolve;});
 const c=await controller({request:path=>path.startsWith('/v1/videos?')?pending:{channel:{Name:'Fresh channel',Handle:'fresh'},subscribers:0,videos:[video]}});
 await c.showChannel('ch_guest');
 assert.equal(c.node('#content').getAttribute('aria-busy'),'false');
 resolveCatalog([]);await turn();
 assert.equal(c.node('#page-title').textContent,'Fresh channel');
 assert.equal(c.node('#content').children.length,1);
});

test('a failed channel request clears loading without letting a late error replace a newer view',async()=>{
 let rejectChannel;
 const pending=new Promise((_,reject)=>{rejectChannel=reject;});
 const c=await controller({request:path=>path.startsWith('/v1/channels/')?pending:[video]});
 const request=c.showChannel('ch_guest');
 assert.equal(c.node('#content').getAttribute('aria-busy'),'true');
 await c.loadVideos();
 rejectChannel(new Error('Old channel unavailable'));await request;
 assert.equal(c.node('#content').getAttribute('aria-busy'),'false');
 assert.equal(c.node('#page-title').textContent,'Discover');
 assert.equal(c.node('#notice').textContent,'');
});

const connected={status:'connected',session:{account:'0x1111111111111111111111111111111111111111',sessionBinding:'original-test-binding',expiresAt:new Date(Date.now()+60000).toISOString()}};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('two tabs showing Subscribe both set the desired state instead of undoing each other',async()=>{
 let subscribed=false;const mutations=[];
 const request=async(path,options={})=>{
  if(path==='/v1/subscriptions')return subscribed?[{ID:video.channel_id}]:[];
  if(path.endsWith('/subscription')){mutations.push(options.method);subscribed=options.method==='PUT';return {ok:true};}
  return path.startsWith('/v1/videos?q=')?[video]:path.endsWith('/comments')?[]:video;
 };
 const product={atRegisteredOrigin:()=>true,restore:async()=>connected};
 const a=await controller({product,request}),b=await controller({product,request});
 await a.openVideo(video);await b.openVideo(video);await turn();
 for(const c of [a,b])assert.equal(c.node('#subscribe').textContent,'Subscribe');
 await a.node('#subscribe').onclick({currentTarget:a.node('#subscribe')});
 await b.node('#subscribe').onclick({currentTarget:b.node('#subscribe')});
 assert.deepEqual(mutations,['PUT','PUT']);assert.equal(subscribed,true);
 for(const c of [a,b]){assert.equal(c.node('#subscribe').textContent,'Unsubscribe');assert.equal(c.node('#subscribe').disabled,false);}
});
test('an older subscription read cannot replace the result of a newer explicit action',async()=>{
 const old=deferred();const mutations=[];
 const c=await controller({product:{atRegisteredOrigin:()=>true,restore:async()=>connected},request:async(path,options={})=>{
  if(path==='/v1/subscriptions')return old.promise;
  if(path.endsWith('/subscription')){mutations.push(options.method);return {ok:true};}
  return path.startsWith('/v1/videos?q=')?[video]:[];
 }});
 await c.openVideo(video);
 await c.node('#subscribe').onclick({currentTarget:c.node('#subscribe')});
 old.resolve([]);await turn();
 assert.deepEqual(mutations,['PUT']);assert.equal(c.node('#subscribe').textContent,'Unsubscribe');
 assert.equal(c.node('#subscribe').dataset.subscribed,'true');
});
test('sign-out immediately hides private library while revoke is pending, and a late restore cannot reconnect',async()=>{
 const revoke=deferred(),late=deferred();let restores=0;
 const c=await controller({product:{atRegisteredOrigin:()=>true,restore:()=>++restores===1?Promise.resolve(connected):late.promise,disconnect:()=>revoke.promise},request:async path=>path==='/v1/playlists'?[{ID:'private-one',Name:'Secret list'}]:[]});
 await c.showPlaylists(c.node('[data-view="playlists"]'));
 assert.ok(c.node('#content').children.some(child=>/Secret list/.test(child.innerHTML)));
 const restoring=c.restoreVideoAccount(),signingOut=c.signOutVideoAccount();
 assert.doesNotMatch(c.node('#content').innerHTML,/Secret list/);
 assert.equal(c.node('#product-connect').disabled,true);
 late.resolve(connected);await restoring;
 assert.equal(c.node('#comment textarea').disabled,true);
 revoke.resolve({status:'network-unavailable',revocationPending:true,message:'Retry logout'});await signingOut;
 assert.equal(c.node('#product-disconnect').textContent,'Retry sign out');
 assert.equal(c.node('#product-connect').disabled,true);
 assert.equal(c.node('#product-retry').hidden,true);
});
test('a late private playlist response cannot reopen its picker after sign-out',async()=>{
 const lists=deferred();
 const c=await controller({product:{atRegisteredOrigin:()=>true,restore:async()=>connected,disconnect:async()=>({status:'disconnected'})},request:path=>path==='/v1/playlists'?lists.promise:path.endsWith('/comments')?[]:video});
 await c.openVideo(video);const opening=c.node('#playlist').onclick();
 await c.signOutVideoAccount();lists.resolve([{ID:'secret',Name:'Private name'}]);await opening;
 assert.equal(c.node('#playlist-picker').open,false);
 assert.equal(c.node('#playlist-choice').children.length,0);
});
test('restored pending logout has only explicit retry and never starts new approval',async()=>{
 let prepares=0,restores=0;
 const c=await controller({product:{atRegisteredOrigin:()=>true,restore:async()=>{restores++;return {status:'retry-required',revocationPending:true,message:'Sign-out pending'};},prepare:async()=>{prepares++;}}});
 assert.equal(c.node('#product-connect').disabled,true);
 assert.equal(c.node('#product-disconnect').hidden,false);
 await c.node('#product-connect').onclick();await c.restoreVideoAccount();
 assert.equal(prepares,0);assert.equal(restores,1);
});

test('a sign-in racing initial restore still exposes SDK pending logout retry',async()=>{
 const initial=deferred(),state={status:'retry-required',revocationPending:true,message:'Pending sign-out'};
 const c=await controller({product:{atRegisteredOrigin:()=>true,restore:()=>initial.promise,prepare:async()=>{throw Object.assign(new Error(state.message),{productSessionState:state});}}});
 await c.node('#product-connect').onclick();await c.node('#product-wallet-choices').children.at(-1).onclick();initial.resolve(connected);await turn();
 assert.equal(c.node('#product-disconnect').hidden,false);
 assert.equal(c.node('#product-disconnect').textContent,'Retry sign out');
 assert.equal(c.node('#product-connect').disabled,true);
 assert.equal(c.node('#product-launch').hidden,true);
 assert.equal(c.node('#comment textarea').disabled,true);
});

const unavailableNativeDetection = route => ({status:'retry-required',request:{nonce:'protected-unsigned-request'},
 route:{status:route},message:'Install YNX Wallet or return to Guest / Try mode'});

test('a browser launch route is an unsigned guest request, not proof that the native Wallet is absent',async()=>{
 for(const route of ['wallet-not-installed','scheme-not-registered']){
  const c=await controller({product:{atRegisteredOrigin:()=>true,restore:async()=>unavailableNativeDetection(route)}});
  assert.match(c.node('#product-status').textContent,/Watch as a guest/);
  assert.doesNotMatch(c.node('#product-status').textContent,/Install|reinstall/);
  assert.equal(c.node('#product-connect').disabled,false);
  assert.equal(c.node('#product-retry').hidden,true);
  assert.equal(c.node('#product-disconnect').hidden,true);
  assert.equal(c.node('#product-launch').hidden,true);
  assert.equal(c.node('#comment textarea').disabled,true);
 }
});

test('a confirmed sign-out and subsequent browser restore keep retry and sign-out controls hidden',async()=>{
 let signedOut=false;
 const c=await controller({product:{atRegisteredOrigin:()=>true,
  restore:async()=>signedOut?unavailableNativeDetection('wallet-not-installed'):connected,
  disconnect:async()=>{signedOut=true;return {status:'disconnected',message:'Auth confirmed revocation of the exact Product Session'};}}});
 await c.signOutVideoAccount();
 assert.equal(c.node('#product-retry').hidden,true);
 assert.equal(c.node('#product-disconnect').hidden,true);
 await c.restoreVideoAccount();
 assert.equal(c.node('#product-retry').hidden,true);
 assert.equal(c.node('#product-disconnect').hidden,true);
 assert.equal(c.node('#product-connect').disabled,false);
 assert.equal(c.node('#comment textarea').disabled,true);
});

test('actual network failures and revocation intents retain explicit retry even beside a native detection route',async()=>{
 const c=await controller();
 for(const state of [{status:'network-unavailable',message:'Authority time unavailable'},
  {status:'retry-required',message:'Stored session requires repair'},
  {status:'retry-required',route:{status:'wallet-not-installed'},message:'No usable request'}]){
  c.renderProductState(state);
  assert.equal(c.node('#product-retry').hidden,false);
  assert.equal(c.node('#product-disconnect').hidden,false);
 }
 c.renderProductState({...unavailableNativeDetection('wallet-not-installed'),revocationPending:true});
 assert.equal(c.node('#product-connect').disabled,true);
 assert.equal(c.node('#product-retry').hidden,true);
 assert.equal(c.node('#product-disconnect').hidden,false);
 assert.equal(c.node('#product-disconnect').textContent,'Retry sign out');
});

test('a recoverable sign-in error opens the chooser and the selected native request has its own launch link',async()=>{
 const c=await controller({product:{atRegisteredOrigin:()=>true,
  restore:async()=>({status:'network-unavailable',message:'Authority time unavailable'}),
  prepare:async()=>({url:'ynxwallet://authorize?request=fixture',state:'fixture',expiresAt:new Date(Date.now()+60000).toISOString()})}});
 assert.equal(c.node('#product-retry').hidden,false);
 await c.node('#product-connect').onclick();
 assert.equal(c.node('#product-wallet-chooser').open,true);
 await c.node('#product-wallet-choices').children.at(-1).onclick();
 assert.equal(c.node('#product-launch').hidden,true);
 assert.equal(c.node('#product-native-open').hidden,false);
 assert.equal(c.node('#product-native-open').href,'ynxwallet://authorize?request=fixture');
 assert.equal(c.node('#comment textarea').disabled,true);
});

test('original BrowserSSO hash landing resumes only an existing Video page',async()=>{
 const returned=await controller({hash:'#settings'});assert.equal(returned.readView(),'settings');
 const foreign=await controller({hash:'#https://other.test/private'});assert.equal(foreign.readView(),'discover');
});

test('site account login waits for original private retirement and rejects duplicate account actions',async()=>{
 const pending=deferred(),calls=[];let prepares=0;
 const c=await controller({browser:{invalidate(){},signIn:t=>calls.push('site:'+t)},product:{atRegisteredOrigin:()=>true,restore:async()=>connected,disconnect:()=>{calls.push('retire');return pending.promise},prepare:()=>{prepares++}}});
 const changing=c.node('#browser-signin').onclick();await c.node('#browser-signin').onclick();await c.node('#product-connect').onclick();
 assert.deepEqual(calls,['retire']);assert.equal(prepares,0);assert.equal(c.node('#browser-signin').disabled,true);
 pending.resolve({status:'disconnected'});await changing;assert.deepEqual(calls,['retire','site:settings']);assert.equal(c.node('#browser-signin').disabled,false);
});
test('unconfirmed original Video retirement blocks site login and site logout',async()=>{
 for(const id of ['#browser-signin','#browser-disconnect']){let sites=0;const c=await controller({browser:{invalidate(){},signIn:()=>sites++,logout:()=>sites++},product:{atRegisteredOrigin:()=>true,restore:async()=>connected,disconnect:async()=>({status:'retry-required',revocationPending:true})}});await c.node(id).onclick();assert.equal(sites,0);assert.match(c.node('#notice').textContent,/Confirm Video sign out/);assert.equal(c.node('#product-connect').disabled,true);}
});
