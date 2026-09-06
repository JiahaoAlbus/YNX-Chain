import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const code=(await readFile(new URL('../../app.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
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
async function controller({search='',request=async path=>path.startsWith('/v1/videos?')?[video]:path.endsWith('/comments')?[]:video}={}){
 const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
 const nav=['discover','subscriptions','playlists','history','settings'].map(view=>{const e=node(`[data-view="${view}"]`);e.dataset.view=view;return e;});
 node('#page-title').setAttribute('data-i18n','discover');node('#content').setAttribute('aria-busy','true');
 const document={querySelector:node,querySelectorAll:selector=>selector==='nav button'?nav:[],createElement:()=>new Element()};
 const calls=[];
 const dependencies={document,location:{origin:'https://video.ynxweb4.com',pathname:'/',search,hash:''},window:{addEventListener(){}},navigator:{onLine:true},URLSearchParams,
  history:{replaceState(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout,clearTimeout,
  t:key=>({discover:'Discover',empty:'No published videos yet'})[key]??key,i18nReady:Promise.resolve(),
  WALLET_INSTALLATION_OPTIONS:{ynxWallet:'https://www.ynxweb4.com/dapp/download',metaMask:'https://metamask.io/download/'},
  videoProductSession:{atRegisteredOrigin:()=>false},restoreVideoWallet:async()=>null,
  createVideoAPI:()=>async path=>{calls.push(path);return request(path);},
  createWatchProgress:()=>({flush:async()=>{},discard(){},resetSample(){}}),
 };
 const app=await new AsyncFunction(...Object.keys(dependencies),code+'\nreturn {openVideo,showChannel,loadVideos};')(...Object.values(dependencies));
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
