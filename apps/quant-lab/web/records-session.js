import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from '../../../packages/wallet-auth/src/index.js';
import registry from '../../../packages/wallet-auth/product-session-registry.json';
import {privateSessionCopy} from './private-session-copy.js';

// A different SDK scope namespace/device from the old account-only session.
const SCOPES=Object.freeze(['quant:records:read']);
const STARTED='ynx.quant.records-session.v1.started';
let adapter=null,initializing=null,pending=null,pendingCancel=null,retiring=null,epoch=0,closed=false,selectionBinding=null;
let recordsReadRevision=0;
let state={status:'guest',account:null},lastRecords=null;
function fail(code){throw Object.assign(new Error(code),{code});}
function render(){
  const copy=privateSessionCopy(localStorage.getItem('ynx.quant.locale')||'en');
  for(const [id,key] of [['records-authorize','recordsAuthorize'],['records-read','recordsRead'],['records-revoke','recordsRevoke']]){const el=document.getElementById(id);if(el)el.textContent=copy[key];}
  const status=document.getElementById('records-status');if(status){status.dataset.pending=String(!!pending);status.textContent=(pending?copy.pending:state.status==='connected'?copy.connected:state.status==='guest'?copy.guest:copy.unavailable)+' '+(state.account||'')+' '+copy.recordsBoundary;}
  const list=document.getElementById('records-owned');if(list){
    list.replaceChildren();
    if(lastRecords&&(lastRecords.mandates.length+lastRecords.executions.length===0)){const empty=document.createElement('li');empty.textContent=copy.recordsEmpty;list.append(empty);}
    for(const mandate of lastRecords?.mandates||[]){const row=document.createElement('li');row.textContent=`${copy.recordsMandate}: ${mandate.digest||'—'} · ${mandate.market||'—'} · ${mandate.revoked?copy.recordsRevoked:copy.recordsActive} · ${copy.recordsDailyLoss}: ${mandate.maxDailyLoss} (${copy.recordsUnits}) · ${copy.recordsExpiry}: ${mandate.expiresAt||'—'}`;list.append(row);}
    for(const execution of lastRecords?.executions||[]){const row=document.createElement('li');row.textContent=`${copy.recordsExecution}: ${execution.id||'—'} · ${execution.market||'—'} · ${execution.status||'—'} · ${execution.venueOrderId||'—'} · ${execution.createdAt||'—'}`;list.append(row);}
  }
}
async function client(){
  if(adapter)return adapter;
  if(!initializing){
    const generation=epoch;
    const own=createBrowserProductSessionClient({registry,productId:'quant',scopes:SCOPES,purpose:'Read my existing Quant mandates, execution status and risk limits. No creation, execution, revocation, Paper or tenant permission.',gateway:new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:globalThis.fetch.bind(globalThis),walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:10000})}).then(value=>{if(closed||generation!==epoch||initializing!==own){value.close();fail('PRIVATE_OPERATION_SUPERSEDED');}adapter=value;return value;}).finally(()=>{if(initializing===own)initializing=null;});
    initializing=own;
  }
  return initializing;
}
function publish(result){state={status:result.status,account:result.status==='connected'?result.session.account:null};if(state.status!=='connected')selectionBinding=null;lastRecords=null;render();}
function retireClient(selected=adapter){
  if(retiring)return retiring;
  if(!selected)return Promise.resolve(null);
  const own=selected.client.disconnect().finally(()=>{if(retiring===own)retiring=null;});retiring=own;return own;
}
export function beginRecordsSession(){
  if(pending){render();return pending;}
  if(state.status==='connected')return Promise.resolve(adapter.client.current);
  const revision=++epoch;
  pending=(async()=>{
    if(retiring)await retiring;
    if(epoch!==revision||closed)fail('PRIVATE_OPERATION_SUPERSEDED');
    const selected=await client();
    let retirement=null;
    const retire=()=>retirement??=(retireClient(selected).catch(()=>null));
    pendingCancel=retire;
    const snapshot=window.YNXQuantWallet.getPrivateWalletContext();
    const current=()=>{const next=window.YNXQuantWallet.getPrivateWalletContext();if(closed||epoch!==revision||snapshot.provider!==next.provider||snapshot.account!==next.account||snapshot.chainId!==next.chainId||snapshot.providerKind!==next.providerKind||snapshot.revision!==next.revision||next.status!=='connected')fail('PRIVATE_OPERATION_SUPERSEDED');};
    try{
      current();localStorage.setItem(STARTED,'true');
      const request=await selected.client.beginExplicit();current();
      if(request.status!=='connecting'||typeof request.route?.url!=='string')fail('PRIVATE_REQUEST_UNAVAILABLE');
      const response=await window.YNXQuantWallet.requestProductSessionV2(request.route.url);current();
      const result=await selected.client.handleReturn(response.returnUrl);current();publish(result);if(result.status==='connected')selectionBinding=snapshot;return result;
    }catch(error){
      // Guest presentation alone does not clear a durable pending challenge.
      // Original SDK disconnect owns cancel/revocation confirmation and retry.
      await retire();
      if(epoch===revision){state={status:'degraded',account:null};lastRecords=null;render();}
      throw error;
    }finally{if(pendingCancel===retire)pendingCancel=null;}
  })();
  const own=pending;own.finally(()=>{if(pending===own){pending=null;render();}}).catch(()=>null);render();return own;
}
export async function revokeRecordsSession(){epoch++;lastRecords=null;render();const selected=await client();const revision=epoch;const result=await (pendingCancel?pendingCancel():retireClient(selected));if(epoch===revision){if(result)publish(result);else{state={status:'degraded',account:null};render();}}return result;}
export async function readPrivateRecords(){
  if(pending||state.status!=='connected')fail('PRIVATE_SIGN_IN_REQUIRED');
  const revision=epoch,readRevision=++recordsReadRevision,context=window.YNXQuantWallet.getPrivateWalletContext();
  const current=()=>!closed&&epoch===revision&&recordsReadRevision===readRevision;
  let timer;
  try{
    const selected=await client();if(!current())fail('PRIVATE_OPERATION_SUPERSEDED');
    const authorization=await selected.createIntrospectionProof(SCOPES);
    const before=selected.client.current.session;
    if(!current()||!before)fail('PRIVATE_OPERATION_SUPERSEDED');
    const controller=new AbortController();timer=setTimeout(()=>controller.abort(),10000);
    const response=await fetch('/api/v1/wallet/private-records',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json','X-YNX-Product-Session-Proof-V2':authorization.proofHeader},body:'{}'});
    if(!current())fail('PRIVATE_OPERATION_SUPERSEDED');
    if(!response.ok)fail(response.status===401||response.status===403?'PRIVATE_AUTHORIZATION_REJECTED':'PRIVATE_RECORDS_UNAVAILABLE');
    if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail('PRIVATE_RECORDS_BINDING_MISMATCH');
    const raw=await response.text();if(raw.length>262144)fail('PRIVATE_RECORDS_BINDING_MISMATCH');const result=JSON.parse(raw);
    const after=selected.client.current.session;
    const next=window.YNXQuantWallet.getPrivateWalletContext();
    if(!current()||context.revision!==next.revision||context.provider!==next.provider||context.account!==next.account||context.chainId!==next.chainId||context.providerKind!==next.providerKind)fail('PRIVATE_OPERATION_SUPERSEDED');
    if(!after||before.account!==after.account||before.sessionBinding!==after.sessionBinding||result.account!==after.account||result.sessionBinding!==after.sessionBinding||result.nativeExecutionEnabled!==false||result.paperWorkspaceLinked!==false||!Array.isArray(result.records?.mandates)||!Array.isArray(result.records?.executions))fail('PRIVATE_RECORDS_BINDING_MISMATCH');
    if(next.status==='connected')selectionBinding=next;
    lastRecords=result.records;render();return result;
  }catch(error){if(current()){lastRecords=null;if(error.code==='PRIVATE_AUTHORIZATION_REJECTED'){state={status:'guest',account:null};epoch++;}render();}throw error;}finally{clearTimeout(timer);}
}
export function mountRecordsSession(){
  const run=fn=>fn().catch(()=>render());
  document.getElementById('records-authorize')?.addEventListener('click',()=>run(beginRecordsSession));
  document.getElementById('records-read')?.addEventListener('click',()=>run(readPrivateRecords));
  document.getElementById('records-revoke')?.addEventListener('click',()=>run(revokeRecordsSession));
  document.getElementById('locale')?.addEventListener('change',()=>queueMicrotask(render));
  window.addEventListener('ynx:quant-wallet-context',event=>{
    // A lost transport is not a revoked server grant. Clear in-flight display,
    // but later reads still use fresh SDK/server verification of the native user.
    epoch++;lastRecords=null;render();
    if((event.detail.identityChanged===true||pending)&&adapter){selectionBinding=null;state={status:'guest',account:null};render();const revision=epoch;(pendingCancel?pendingCancel():retireClient()).then(result=>{if(epoch===revision&&result)publish(result);}).catch(()=>{if(epoch===revision){state={status:'degraded',account:null};render();}});}
  });
  window.addEventListener('ynx:quant-wallet-state',()=>{
    const next=window.YNXQuantWallet.getPrivateWalletContext();
    if(!selectionBinding){if(state.status==='connected'&&next.status==='connected')selectionBinding=next;return;}
    if(selectionBinding.provider===next.provider&&selectionBinding.account===next.account&&selectionBinding.chainId===next.chainId&&selectionBinding.providerKind===next.providerKind&&['connected','transport-unavailable'].includes(next.status))return;
    // Transport continuity is not native identity mapping. A proven selected
    // account/provider/network change retires the old approved read context.
    selectionBinding=null;epoch++;lastRecords=null;state={status:'guest',account:null};render();
    const revision=epoch;(pendingCancel?pendingCancel():retireClient()).then(result=>{if(epoch===revision&&result)publish(result);}).catch(()=>{if(epoch===revision){state={status:'degraded',account:null};render();}});
  });
  window.addEventListener('pagehide',()=>{epoch++;closed=true;adapter?.close();adapter=null;initializing=null;});
  // Restore only the SDK's existing server session; never begin/sign on refresh.
  if(localStorage.getItem(STARTED)==='true')run(async()=>{const revision=epoch,selected=await client(),result=await selected.client.restore(navigator.onLine);if(revision===epoch)publish(result);});
  window.addEventListener('pageshow',event=>{if(event.persisted){closed=false;run(async()=>{const revision=epoch,selected=await client(),result=await selected.client.restore(navigator.onLine);if(revision===epoch)publish(result);});}});
  render();
}
