import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

export const appSource=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
export const htmlIDs=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
export function environment(options={}){
 const nodes=new Map(),handlers=new Map(),requests=[],timers=new Map(),manualRoutes=new Set(),windowHandlers=new Map();let timerID=0;
 const ids=options.html?new Set([...options.html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1])):htmlIDs;
 class Element{
  constructor(tag,id=''){this.tagName=tag;this.id=id;this.value='';this.hidden=false;this.disabled=false;this.className='';this.files=[];this.children=[];this.listeners=new Map();this.ownText='';const classes=new Set();this.classList={toggle:(c,on)=>{if(on)classes.add(c);else classes.delete(c);},remove:(...cs)=>cs.forEach(c=>classes.delete(c)),contains:c=>classes.has(c)};}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
  append(...children){this.children.push(...children);}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.ownText='';this.children=[...children];}
  addEventListener(type,fn){this.listeners.set(type,fn);if(this.id)handlers.set(this.id+':'+type,fn);}
  setAttribute(name,value){this[name]=String(value);}
  emit(type){const fn=this.listeners.get(type);return fn&&fn({preventDefault(){},target:this});}
 }
 for(const id of ids)nodes.set(id,new Element('div',id));
 const rows=Array.from({length:4},()=>{const row=new Element('li'),status=new Element('span');row.querySelector=selector=>selector==='.step-status'?status:null;return row;});
 const storage=options.storage||new Map(options.ticket===false?[]:[['ynxNetworkTicket',options.ticket||'ticket']]);
 nodes.get('tx-id').value=options.txId||'0x'+'a'.repeat(64);
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const statusBody={paired:true,callerOsIdentityVerified:false,anchorConfigured:false,pqIndependentTrustConfigured:false,version:'controller-contract-fixture'};
 const defaults={
  '/api/node-report':{classification:'RPC_ONLY',source:'contract-fixture',reports:Object.fromEntries(['status','latestBlock','validators'].map(key=>[key,{status:'unavailable',code:'NOT_SUPPLIED',source:'fixture/'+key}]))},
  '/api/native-status':{native:null,browserIdentityVerified:false,code:'NATIVE_UNAVAILABLE'},
  '/api/receipts':{classification:'historical-local-projection',authority:false,receipts:[]}
 };
 const fetch=options.fetch||((path,request)=>{
  if(path==='/api/status'&&!options.pendingStatus)return Promise.resolve(response(options.status||statusBody));
  if(options.autoConnected!==false&&!manualRoutes.has(path)&&Object.hasOwn(defaults,path))return Promise.resolve(response(defaults[path]));
  return new Promise(resolve=>requests.push({path,options:request,resolve:(body,status=200)=>resolve(response(body,status))}));
 });
 const documentHandlers=new Map(), intervals=[];const documentObject={visibilityState:"visible",addEventListener:(type,fn)=>documentHandlers.set(type,fn),getElementById:id=>nodes.get(id)||null,querySelectorAll:selector=>selector==='.levels li'?rows:[],createElement:tag=>new Element(tag)};
 const uiEvents=[], windowObject={addEventListener:(type,fn)=>windowHandlers.set(type,fn),NetworkUI:{receive:(channel,value)=>uiEvents.push({channel,value})}};
 if(options.intervals)windowObject.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
 const timerSet=(fn,ms)=>{const id=++timerID;timers.set(id,{fn,ms});return id;};
 runInNewContext(options.source||appSource,{
  document:documentObject,
  sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
  navigator:{},window:windowObject,fetch,console,AbortController,setTimeout:timerSet,clearTimeout:id=>timers.delete(id)
 });
 return {intervals,tick:()=>intervals.forEach(timer=>timer.fn()),visibility:value=>{documentObject.visibilityState=value;documentHandlers.get("visibilitychange")?.();},uiEvents,client:windowObject.NetworkClient,node:id=>{const n=nodes.get(id);if(!n)throw Error('Missing actual HTML id '+id);return n;},rows,storage,requests,pending:requests,timers,
  emit:(id,type)=>nodes.get(id).emit(type),
  take:path=>{const index=requests.findIndex(r=>r.path===path);if(index<0)throw Error('No pending request '+path+'; got '+requests.map(r=>r.path));return requests.splice(index,1)[0];},
  manual:path=>manualRoutes.add(path),
  pageshow:()=>windowHandlers.get('pageshow')?.({persisted:true}),
  fireTimers:()=>{for(const [id,timer]of [...timers]){timers.delete(id);timer.fn();}}
 };
}
export async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
export const A='0x'+'a'.repeat(64),B='0x'+'b'.repeat(64),R1='1'.repeat(64),R2='2'.repeat(64);
export const view=(txId=A,level='INCLUSION_VERIFIED',extra={})=>({txId,level,source:'controller-contract-fixture',height:'12',reason:'STATE_NOT_PROVEN',detail:'UI contract fixture only; not cryptographic acceptance evidence',...extra});
export const record=(txId=A,level='INCLUSION_VERIFIED',extra={})=>({receiptId:R1,txId,observedAt:'2026-10-31T10:00:00Z',contextPin:'',view:view(txId,level),report:{hash:txId,status:'success'},reportCollection:{status:'reported',source:'fixture/txs'},proofCollection:{status:'reported',source:'fixture/proof'},...extra});
