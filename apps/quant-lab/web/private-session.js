import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from '../vendor/product-session-browser-a7dad7ec.mjs';
import registry from '../vendor/product-session-registry-a7dad7ec.json';
import {privateSessionCopy} from './private-session-copy.js';

export const QUANT_PRIVATE_AUTHORITY='https://wallet-auth.ynxweb4.com';
const ORIGIN='https://quant.ynxweb4.com',STARTED_KEY='ynx.quant.private-session.9840ef87.started';
const SCOPES=Object.freeze(['quant:account']);
let adapterPromise=null,adapter=null,revision=0,adapterEpoch=0,busy=false;
let state=Object.freeze({status:'guest',code:'PRIVATE_SIGN_IN_REQUIRED',account:null});
function emit(next){state=Object.freeze(next);window.dispatchEvent(new CustomEvent('ynx:quant-private-state',{detail:state}));return state;}
function fail(code){throw Object.assign(new Error(`PRIVATE_SERVICE_DEGRADED: ${code}. Standard Wallet, Research and Paper remain available.`),{code});}
function publish(result){return emit({status:result.status,code:result.route?.status||result.status,account:result.status==='connected'?result.session.account:null,expiresAt:result.status==='connected'?result.session.expiresAt:null,revocationConfirmed:result.revocationConfirmed===true,openURL:result.status==='connecting'&&result.automatic===false&&result.route?.installation==='unverified'?result.route.url:null,installation:'unverified'});}

async function getAdapter(){
  if(adapterPromise)return adapterPromise;
  const epoch=adapterEpoch;
  adapterPromise=(async()=>{
    if(location.origin!==ORIGIN||!globalThis.isSecureContext)fail('REGISTERED_SECURE_ORIGIN_REQUIRED');
    // Shared a7dad7ec owns authority namespacing; legacy records remain in place.
    // This marker only opts into silent restore, never grants authentication.
    const gateway=new ProductSessionGatewayFetchAdapter({endpoint:QUANT_PRIVATE_AUTHORITY,fetch:globalThis.fetch.bind(globalThis),walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:10000});
    // EIP-1193 discovery is not proof of an installed native handler. This Web
    // build has no supported native bridge; no custom scheme is opened here.
    const created=await createBrowserProductSessionClient({registry,productId:'quant',scopes:SCOPES,purpose:'Sign in to read this Quant private account. No strategy, order or mandate permission.',gateway});
    if(epoch!==adapterEpoch){created.close();fail('PRIVATE_OPERATION_SUPERSEDED');}
    adapter=created;
    return adapter;
  })().catch(error=>{if(epoch===adapterEpoch)adapterPromise=null;throw error;});
  return adapterPromise;
}
async function operation(run){
  const intent=++revision;busy=true;
  try{const client=await getAdapter();if(intent!==revision)return state;const result=await run(client);if(intent===revision)return publish(result);return state;}
  catch(error){if(intent===revision)emit({status:'degraded',code:error.code||'PRIVATE_SERVICE_UNAVAILABLE',account:null});throw error;}
  finally{if(intent===revision)busy=false;}
}
export function getPrivateSessionState(){return state;}
export async function beginPrivateSession(){localStorage.setItem(STARTED_KEY,'true');return operation(a=>a.client.beginExplicit());}
export async function retryPrivateSession(){return operation(a=>a.client.retryDetected());}
export async function revokePrivateSession(){return operation(a=>a.client.disconnect());}
export async function handlePrivateReturn(url){
  const result=await operation(a=>a.client.handleReturn(url));
  // A processed callback is not a reusable login token. Keep it out of refresh,
  // history, referrers and the address bar; never navigate/open a new page.
  if(url===location.href&&['connected','disconnected'].includes(result.status))history.replaceState(null,'','/');
  return result;
}
export async function restorePrivateSession(){
  // Fresh visitors do not create keys, pending requests or automatic sign-in.
  if(localStorage.getItem(STARTED_KEY)!=='true')return state;
  // The shared SDK restores the original nonce/state/expiry and refuses stale
  // responses; the product never reads or edits protocol storage directly.
  return operation(a=>a.client.restore(navigator.onLine));
}
export async function privateAccount(tenantId){
  if(!/^[0-9a-f]{64}$/.test(tenantId||''))fail('TENANT_BINDING_REQUIRED');
  if(busy)fail('PRIVATE_OPERATION_PENDING');
  if(state.status!=='connected')fail('PRIVATE_SIGN_IN_REQUIRED');
  const intent=revision,a=await getAdapter();
  if(intent!==revision)fail('PRIVATE_OPERATION_SUPERSEDED');
  // No cached bearer/proof: SDK rechecks the persisted session and revocation
  // intent in every tab, and creates a fresh one-use Auth introspection proof.
  const authorization=await a.createIntrospectionProof(['quant:account']);
  if(intent!==revision)fail('PRIVATE_OPERATION_SUPERSEDED');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  let response,account;
  try{
    response=await fetch('/api/v1/wallet/private-account',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json','X-YNX-Tenant-ID':tenantId,'X-YNX-Product-Session-Proof-V2':authorization.proofHeader},body:'{}'});
    if(!response.ok)fail(response.status===401||response.status===403?'PRIVATE_AUTHORIZATION_REJECTED':'PRIVATE_ACCOUNT_UNAVAILABLE');
    if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail('PRIVATE_ACCOUNT_BINDING_MISMATCH');
    const text=await response.text();if(text.length>16384)fail('PRIVATE_ACCOUNT_BINDING_MISMATCH');account=JSON.parse(text);
  }finally{clearTimeout(timeout);}
  if(intent!==revision)fail('PRIVATE_OPERATION_SUPERSEDED');
  if(intent!==revision||a.client.current.status!=='connected'||account.account!==a.client.current.session.account||account.sessionBinding!==a.client.current.session.sessionBinding||account.authority!==QUANT_PRIVATE_AUTHORITY||account.nativeExecutionEnabled!==false||account.paperWorkspaceLinked!==false)fail('PRIVATE_ACCOUNT_BINDING_MISMATCH');
  return account;
}
export async function requireNativeExecutionProof(){fail('NATIVE_MANDATE_SIGNATURE_AND_EXCHANGE_V2_ADAPTER_REQUIRED');}
export function mountPrivateSession(){
  const status=document.querySelector('#private-session-status');
  let verifiedAccount=null,accountError=null;
  const copy=()=>privateSessionCopy(localStorage.getItem('ynx.quant.locale')||'en');
  const render=()=>{
    const text=copy();
    for(const [id,key] of [['private-sign-in','signIn'],['private-open-wallet','open'],['private-retry','retry'],['private-account','verify'],['private-sign-out','signOut']]){const el=document.getElementById(id);if(el)el.textContent=text[key];}
    const message=accountError?text.unavailable:verifiedAccount?text.verified:state.status==='connected'?text.connected:['connecting','awaiting-return'].includes(state.status)?text.pending:state.status==='disconnected'?text.disconnected:state.status==='guest'?text.guest:text.unavailable;
    if(status){status.textContent=`${message} ${verifiedAccount||state.account||''} ${text.boundary}`;status.dataset.code=accountError||state.code;}
    const link=document.querySelector('#private-open-wallet');if(link){link.hidden=!state.openURL;if(state.openURL)link.setAttribute('href',state.openURL);else link.removeAttribute('href');}
  };
  window.addEventListener('ynx:quant-private-state',()=>{verifiedAccount=null;accountError=null;render();});
  document.querySelector('#locale')?.addEventListener('change',()=>queueMicrotask(render));
  window.addEventListener('storage',event=>{if(event.key==='ynx.quant.locale')render();});
  const run=fn=>fn().catch(()=>render());
  document.querySelector('#private-sign-in')?.addEventListener('click',()=>run(beginPrivateSession));
  document.querySelector('#private-retry')?.addEventListener('click',()=>run(retryPrivateSession));
  document.querySelector('#private-sign-out')?.addEventListener('click',()=>run(revokePrivateSession));
  document.querySelector('#private-account')?.addEventListener('click',()=>run(async()=>{try{const result=await privateAccount(localStorage.getItem('ynx.quant.tenant.v1'));verifiedAccount=result.account;accountError=null;}catch(error){verifiedAccount=null;accountError=error.code||'PRIVATE_ACCOUNT_UNAVAILABLE';}render();}));
  window.addEventListener('offline',()=>{revision++;busy=false;if(adapter)publish(adapter.client.setNetworkAvailable(false));});
  window.addEventListener('online',()=>{if(adapter)publish(adapter.client.setNetworkAvailable(true));});
  window.addEventListener('focus',()=>{if(!busy&&state.status==='connected')run(restorePrivateSession);});
  window.addEventListener('pagehide',()=>{revision++;adapterEpoch++;busy=false;adapter?.close();adapter=null;adapterPromise=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted)run(restorePrivateSession);});
  // Root/callback route passes the entire URL to the shared parser. No token
  // extraction, legacy migration, or supplied callback/origin is accepted.
  if(location.pathname==='/wallet-auth/callback'&&location.search)run(()=>handlePrivateReturn(location.href));else run(restorePrivateSession);
  render();
}
