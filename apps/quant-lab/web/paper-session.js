import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from '../../../packages/wallet-auth/src/index.js';
import registry from '../../../packages/wallet-auth/product-session-registry.json';
import {privateSessionCopy} from './private-session-copy.js';
import {paperSessionCopy} from './paper-session-copy.js';

const SCOPES=Object.freeze(['quant:paper:workspace']);
const STARTED='ynx.quant.paper-workspace-session.v1.started';
let adapter=null,initializing=null,pending=null,retiring=null,cancelPending=null,epoch=0,closed=false,binding=null;
let state={status:'guest',account:null},data=null;
const fail=code=>{throw Object.assign(new Error(code),{code});};
function render(){
  const language=localStorage.getItem('ynx.quant.locale')||'en',copy=paperSessionCopy(language),common=privateSessionCopy(language);
  for(const [id,key] of [['paper-authorize','authorize'],['paper-refresh','refresh'],['paper-revoke','revoke']]){const el=document.getElementById(id);if(el){el.textContent=copy[key];el.disabled=id==='paper-refresh'?(!!pending||state.status!=='connected'):false;}}
  const status=document.getElementById('paper-session-status');if(status){status.dataset.pending=String(!!pending);status.textContent=(pending?common.pending:state.status==='connected'?common.connected:state.status==='guest'?common.guest:common.unavailable)+' '+(state.account||'')+' '+copy.boundary;}
  const title=document.getElementById('paper-owned-title');if(title)title.textContent=copy.workspace;
  for(const element of document.querySelectorAll('[data-paper-i18n]'))element.textContent=copy[element.dataset.paperI18n];
  for(const [id,value] of [['paper-owned-cash',data?.paper?.Cash],['paper-owned-position',data?.paper?.Position],['paper-owned-strategies',data?Object.keys(data.strategies).length:null],['paper-owned-audit',data?.audit?.length]]){const element=document.getElementById(id);if(element)element.textContent=Number.isSafeInteger(value)?String(value):'—';}
}
function publish(result){state={status:result.status,account:result.status==='connected'?result.session.account:null};data=null;if(state.status!=='connected')binding=null;render();notify();}
function notify(){window.dispatchEvent(new CustomEvent('ynx:quant-paper-session',{detail:{status:state.status,account:state.account,epoch}}));}
async function client(){
  if(adapter)return adapter;
  if(!initializing){const generation=epoch;
    const own=createBrowserProductSessionClient({registry,productId:'quant',scopes:SCOPES,purpose:'Use my simulated Paper workspace: save backtests, submit signals, halt, reconcile and read receipts. No real funds, live/Testnet execution or scheduling.',gateway:new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:globalThis.fetch.bind(globalThis),walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:10000})}).then(value=>{if(closed||generation!==epoch||initializing!==own){value.close();fail('PRIVATE_OPERATION_SUPERSEDED');}adapter=value;return value;}).finally(()=>{if(initializing===own)initializing=null;});initializing=own;
  }return initializing;
}
function sameContext(previous){const next=window.YNXQuantWallet.getPrivateWalletContext();return previous.provider===next.provider&&previous.account===next.account&&previous.chainId===next.chainId&&previous.providerKind===next.providerKind&&previous.revision===next.revision;}
function retire(selected=adapter){if(retiring)return retiring;if(!selected)return Promise.resolve(null);const own=selected.client.disconnect().finally(()=>{if(retiring===own)retiring=null;});retiring=own;return own;}
export function getPaperSessionState(){return Object.freeze({...state,epoch,ready:data!==null});}
export function getPaperWorkspaceSnapshot(){return data;}
export function beginPaperSession(){
  if(pending){render();return pending;}
  if(state.status==='connected')return Promise.resolve(adapter.client.current);
  const revision=++epoch;
  pending=(async()=>{
    if(retiring)await retiring;if(closed||revision!==epoch)fail('PRIVATE_OPERATION_SUPERSEDED');
    const selected=await client(),context=window.YNXQuantWallet.getPrivateWalletContext();let retirement=null;
    const cancel=()=>retirement??=(retire(selected).catch(()=>null));cancelPending=cancel;
    const assert=()=>{if(closed||revision!==epoch||!sameContext(context)||window.YNXQuantWallet.getPrivateWalletContext().status!=='connected')fail('PRIVATE_OPERATION_SUPERSEDED');};
    try{assert();localStorage.setItem(STARTED,'true');const request=await selected.client.beginExplicit();assert();
      if(request.status!=='connecting'||typeof request.route?.url!=='string')fail('PRIVATE_REQUEST_UNAVAILABLE');
      const reply=await window.YNXQuantWallet.requestProductSessionV2(request.route.url);assert();const result=await selected.client.handleReturn(reply.returnUrl);assert();publish(result);if(result.status==='connected')binding=context;return result;
    }catch(error){await cancel();if(revision===epoch){state={status:'degraded',account:null};data=null;render();notify();}throw error;}
    finally{if(cancelPending===cancel)cancelPending=null;}
  })();const own=pending;own.finally(()=>{if(pending===own){pending=null;render();}}).catch(()=>null);render();return own;
}
export async function revokePaperSession(){epoch++;data=null;state={status:'guest',account:null};render();notify();const selected=await client(),revision=epoch,result=await(cancelPending?cancelPending():retire(selected));if(revision===epoch&&result){if(result.status==='disconnected'&&result.revocationConfirmed===true)localStorage.removeItem(STARTED);publish(result);}return result;}
const allowed=Object.freeze({'GET /v1/wallet/paper/snapshot':true,'POST /v1/wallet/paper/backtests/from-market':true,'POST /v1/wallet/paper/orders':true,'POST /v1/wallet/paper/risk/kill':true,'POST /v1/wallet/paper/risk/reconcile':true});
// Response limits apply to actual decoded bytes, not JavaScript character count
// or a compressed Content-Length. Abort/cancel before retaining oversized data.
async function readPaperDocument(response){
  const reader=response.body?.getReader();if(!reader)fail('PAPER_BINDING_MISMATCH');
  const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,raw='';
  try{
    for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2097152)fail('PAPER_BINDING_MISMATCH');raw+=decoder.decode(part.value,{stream:true});}
    raw+=decoder.decode();const result=JSON.parse(raw);
    if(!result||typeof result!=='object'||Array.isArray(result))fail('PAPER_BINDING_MISMATCH');
    return result;
  }catch(error){await reader.cancel().catch(()=>null);if(error.code==='PAPER_BINDING_MISMATCH')throw error;fail('PAPER_BINDING_MISMATCH');}
  finally{reader.releaseLock();}
}
export async function paperWorkspaceRequest(path,options={}){
  const method=options.method||'GET';if(!allowed[method+' '+path])fail('PAPER_OPERATION_NOT_AUTHORIZED');
  const body=method==='POST'?options.body:undefined;
  if(method==='POST'&&(typeof body!=='string'||new TextEncoder().encode(body).byteLength>262144))fail('PAPER_OPERATION_NOT_AUTHORIZED');
  if(pending||state.status!=='connected')fail('PRIVATE_SIGN_IN_REQUIRED');
  const revision=epoch,context=window.YNXQuantWallet.getPrivateWalletContext(),selected=await client();
  const authorization=await selected.createIntrospectionProof(SCOPES),before=selected.client.current.session;
  if(!before||closed||revision!==epoch||!sameContext(context))fail('PRIVATE_OPERATION_SUPERSEDED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('/api'+path,{method,body,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json','X-YNX-Product-Session-Proof-V2':authorization.proofHeader}});
    if(!response.ok)throw Object.assign(new Error(response.status===401||response.status===403?'PRIVATE_AUTHORIZATION_REJECTED':'PAPER_SERVICE_UNAVAILABLE'),{code:response.status===401||response.status===403?'PRIVATE_AUTHORIZATION_REJECTED':'PAPER_SERVICE_UNAVAILABLE',status:response.status});
    if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail('PAPER_BINDING_MISMATCH');
    const result=await readPaperDocument(response),after=selected.client.current.session;
    if(closed||revision!==epoch||!sameContext(context))fail('PRIVATE_OPERATION_SUPERSEDED');
    if(!after||before.account!==after.account||before.sessionBinding!==after.sessionBinding||result.account!==after.account||result.sessionBinding!==after.sessionBinding)fail('PAPER_BINDING_MISMATCH');
    if(method==='GET'){
      const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
      if(result.access?.paperWorkspaceAuthorized!==true||result.access.statefulPreview!==false||result.access.nativeExecutionEnabled!==false||result.access.scheduleAuthorized!==false||!record(result.paper)||!record(result.strategies)||!record(result.experiments)||!Array.isArray(result.audit))fail('PAPER_BINDING_MISMATCH');
      data=result;if(context.status==='connected')binding=context;render();notify();
    }return result;
  }catch(error){if(revision===epoch){data=null;if(error.code==='PRIVATE_AUTHORIZATION_REJECTED'){state={status:'guest',account:null};epoch++;}render();notify();}throw error;}
  finally{clearTimeout(timer);}
}
export function mountPaperSession(){
  const run=fn=>fn().catch(()=>render());
  document.getElementById('paper-authorize')?.addEventListener('click',()=>run(async()=>{const result=await beginPaperSession();if(result.status==='connected')await paperWorkspaceRequest('/v1/wallet/paper/snapshot');}));
  document.getElementById('paper-refresh')?.addEventListener('click',()=>run(()=>paperWorkspaceRequest('/v1/wallet/paper/snapshot')));
  document.getElementById('paper-revoke')?.addEventListener('click',()=>run(revokePaperSession));
  document.getElementById('locale')?.addEventListener('change',()=>queueMicrotask(render));
  window.addEventListener('ynx:quant-wallet-context',event=>{epoch++;data=null;render();notify();if((event.detail.identityChanged===true||pending)&&adapter){binding=null;state={status:'guest',account:null};render();notify();const revision=epoch;(cancelPending?cancelPending():retire()).then(result=>{if(revision===epoch&&result)publish(result);}).catch(()=>null);}});
  window.addEventListener('ynx:quant-wallet-state',()=>{const next=window.YNXQuantWallet.getPrivateWalletContext();if(!binding){if(state.status==='connected'&&next.status==='connected')binding=next;return;}
    if(binding.provider===next.provider&&binding.account===next.account&&binding.chainId===next.chainId&&binding.providerKind===next.providerKind&&['connected','transport-unavailable'].includes(next.status))return;
    binding=null;epoch++;data=null;state={status:'guest',account:null};render();notify();const revision=epoch;(cancelPending?cancelPending():retire()).then(result=>{if(revision===epoch&&result)publish(result);}).catch(()=>null);
  });
  const restore=()=>run(async()=>{if(localStorage.getItem(STARTED)!=='true')return;const revision=epoch,selected=await client(),result=await selected.client.restore(navigator.onLine);if(revision===epoch)publish(result);});
  window.addEventListener('pagehide',()=>{epoch++;closed=true;adapter?.close();adapter=null;initializing=null;data=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted){closed=false;restore();}});restore();render();
}
