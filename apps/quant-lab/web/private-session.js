import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from '../vendor/product-session-browser-9840ef87.mjs';
import registry from '../vendor/product-session-registry-9840ef87.json';

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
    // 9840ef87 owns authority namespacing and preserves legacy records in place.
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
export async function handlePrivateReturn(url){return operation(a=>a.client.handleReturn(url));}
export async function restorePrivateSession(){
  // Fresh visitors do not create keys, pending requests or automatic sign-in.
  if(localStorage.getItem(STARTED_KEY)!=='true')return state;
  return operation(async a=>{
    const key=a.client.storageKey;
    const [session,pending,returned,revoking]=await Promise.all([a.storage.get(key),a.storage.get(`${key}:pending`),a.storage.get(`${key}:return`),a.storage.get(`${key}:revoke`)]);
    // An opening attempt may return in another tab or after reload. Do not let
    // controlled automatic reconnect replace its persisted nonce/state first.
    if(!session&&pending&&!returned&&!revoking)return {status:'awaiting-return'};
    if(!session&&!returned&&!revoking)return a.client.current;
    return a.client.restore(navigator.onLine);
  });
}
export async function privateAccount(tenantId){
  if(!/^[0-9a-f]{64}$/.test(tenantId||''))fail('TENANT_BINDING_REQUIRED');
  if(busy)fail('PRIVATE_OPERATION_PENDING');
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
  const render=()=>{if(status)status.textContent=`Private sign-in: ${state.code}${state.account?` · ${state.account}`:''}. Installation unverified. Standard Wallet and Paper remain independent.`;const link=document.querySelector('#private-open-wallet');if(link){link.hidden=!state.openURL;if(state.openURL)link.setAttribute('href',state.openURL);else link.removeAttribute('href');}};
  window.addEventListener('ynx:quant-private-state',render);
  const run=fn=>fn().catch(()=>render());
  document.querySelector('#private-sign-in')?.addEventListener('click',()=>run(beginPrivateSession));
  document.querySelector('#private-retry')?.addEventListener('click',()=>run(retryPrivateSession));
  document.querySelector('#private-sign-out')?.addEventListener('click',()=>run(revokePrivateSession));
  document.querySelector('#private-account')?.addEventListener('click',()=>run(async()=>{const result=await privateAccount(localStorage.getItem('ynx.quant.tenant.v1'));if(status)status.textContent=`Private account ${result.account}; session verified by ${result.authority}. No native execution or Paper ownership was granted.`;}));
  window.addEventListener('offline',()=>{revision++;busy=false;if(adapter)publish(adapter.client.setNetworkAvailable(false));});
  window.addEventListener('online',()=>{if(adapter)publish(adapter.client.setNetworkAvailable(true));});
  window.addEventListener('focus',()=>{if(!busy&&state.status==='connected')run(restorePrivateSession);});
  window.addEventListener('pagehide',()=>{revision++;adapterEpoch++;busy=false;adapter?.close();adapter=null;adapterPromise=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted)run(restorePrivateSession);});
  // Root/callback route passes the entire URL to the shared parser. No token
  // extraction, legacy migration, or supplied callback/origin is accepted.
  if(location.pathname==='/wallet-auth/callback')run(()=>handlePrivateReturn(location.href));else run(restorePrivateSession);
  render();
}
