import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const code=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const video={id:'vid_guest',channel_id:'ch_guest',title:'Owned test video',description:'Test fixture',status:'published',visibility:'public',variants:[{name:'original-fallback',mime:'video/mp4',object_key:'owned.mp4'}]};
class Element {
 constructor(){this.textContent='';this.innerHTML='';this.children=[];this.dataset={};this.attributes=new Map();this.listeners=new Map();this.style={};this.hidden=false;this.open=false;this.classList={toggle(){},add(){},remove(){}};}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 removeAttribute(name){this.attributes.delete(name);}
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
async function controller({search='',product={atRegisteredOrigin:()=>false},request=async path=>path.startsWith('/v1/videos?')?[video]:path.endsWith('/comments')?[]:video}={}){
 const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
 const nav=['discover','subscriptions','playlists','history','settings'].map(view=>{const e=node(`[data-view="${view}"]`);e.dataset.view=view;return e;});
 node('#page-title').setAttribute('data-i18n','discover');node('#content').setAttribute('aria-busy','true');
 const document={querySelector:node,querySelectorAll:selector=>selector==='nav button'?nav:[],createElement:()=>new Element()};
 const calls=[];
 const dependencies={document,location:{origin:'https://video.ynxweb4.com',pathname:'/',search,hash:''},window:{addEventListener(){}},navigator:{onLine:true},URLSearchParams,
  history:{replaceState(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,
  t:key=>({discover:'Discover',empty:'No published videos yet'})[key]??key,i18nReady:Promise.resolve(),
  WALLET_INSTALLATION_OPTIONS:{ynxWallet:'https://www.ynxweb4.com/dapp/download',metaMask:'https://metamask.io/download/'},
  videoProductSession:product,restoreVideoWallet:async()=>null,
  createVideoAPI:()=>async path=>{calls.push(path);return request(path);},
  createWatchProgress:()=>({flush:async()=>{},discard(){},resetSample(){}}),
 };
 const app=await new AsyncFunction(...Object.keys(dependencies),code+'\nreturn {openVideo,showChannel,loadVideos,restoreVideoAccount,signOutVideoAccount,renderProductState,showPlaylists};')(...Object.values(dependencies));
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

const connected={status:'connected',session:{account:'0x1111111111111111111111111111111111111111',expiresAt:new Date(Date.now()+60000).toISOString()}};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
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
