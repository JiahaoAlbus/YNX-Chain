import {createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter} from './vendor/wallet-sdk-a7dad7ec/product-session-browser.mjs';
export const CLOUD_ORIGIN='https://web4.ynxweb4.com';
export const CLOUD_SCOPES=Object.freeze(['files.read','files.write']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
export function cloudScopes(path,method='GET'){
 const route=path.split('?')[0],id='[A-Za-z0-9_-]+';method=method.toUpperCase();
 if(path.includes('..')||path.includes('//')||!path.startsWith('/'))fail('CLOUD_ROUTE_INVALID','Invalid Cloud operation.');
 if(method==='GET'&&(route==='/objects'||new RegExp(`^/objects/${id}(/(content|versions|comments))?$`).test(route)))return ['files.read'];
 if(method==='POST'&&new RegExp(`^/objects/${id}/duplicate$`).test(route))return [...CLOUD_SCOPES];
 if(method==='POST'&&(route==='/objects'||new RegExp(`^/objects/${id}/(trash|restore|versions/[0-9]+/restore|comments(/${id}/resolve)?)$`).test(route)))return ['files.write'];
 if(method==='PATCH'&&new RegExp(`^/objects/${id}$`).test(route)||method==='PUT'&&new RegExp(`^/objects/${id}/document$`).test(route))return ['files.write'];
 fail('V2_ROUTE_NOT_ENABLED','This Cloud action is not available with the current file permission. Your files and approval are unchanged.');
}
// One original SDK namespace owns device keys, pending requests, session and
// durable revocation. Selection/UI generations never replace that authority.
export function createCloudPrivateSession({environment=globalThis,createBrowserClient=createBrowserProductSessionClient,GatewayAdapter=ProductSessionGatewayFetchAdapter,publish=()=>{}}={}){
 let browserPromise,generation=0,flight=null,current=Object.freeze({status:'guest',session:null}),revokeFlight=null,active=null;
 const update=value=>{current=Object.freeze(value);publish(current);return current};
 async function browser(){
  if(environment.location?.origin!==CLOUD_ORIGIN)fail('ORIGIN_MISMATCH','Open the official YNX Cloud site to approve file access.');
  if(!browserPromise)browserPromise=(async()=>{const response=await environment.fetch(new URL('/cloud/vendor/wallet-sdk-a7dad7ec/product-session-registry.json',environment.location.origin),{cache:'no-store'});if(!response.ok)fail('CLOUD_CONFIGURATION_UNAVAILABLE','Cloud sign-in could not be loaded. Retry when connected.');const registry=await response.json();const gateway=new GatewayAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:environment.fetch.bind(environment),walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:10000});return createBrowserClient({registry,environment,productId:'cloud',scopes:[...CLOUD_SCOPES],purpose:'Read, create and update my YNX Cloud files. Sharing, permanent deletion and AI need separate available permissions.',gateway});})().catch(error=>{browserPromise=null;throw error});
  return browserPromise;
 }
 async function disconnect(){if(revokeFlight)return revokeFlight;const epoch=++generation;update({status:'disconnected',session:null});const operation=(async()=>{const b=await browser();const result=await b.client.disconnect();if(epoch===generation)update(result);return result})();revokeFlight=operation;try{return await operation}finally{if(revokeFlight===operation)revokeFlight=null}}
 async function cancel(){const needsRevocation=active?.preparing===true;if(needsRevocation)return disconnect();++generation;return current;}
 async function restore(){if(flight||revokeFlight)return current;const epoch=++generation,b=await browser();if(epoch!==generation)return current;const result=await b.client.restore(environment.navigator?.onLine!==false);if(epoch===generation)update(result);return current;}
 async function connect(provider){
  if(!provider?.request)fail('CLOUD_WALLET_UNAVAILABLE','Select an installed YNX Wallet.');
  if(flight||revokeFlight)fail('PRODUCT_APPROVAL_DRAINING','The previous approval is still closing. Retry after it finishes.');
  if(current.revocationPending)fail('REVOCATION_PENDING','Previous sign-out still needs confirmation.');
  const epoch=++generation,live=()=>epoch===generation,check=()=>{if(!live())fail('PRODUCT_APPROVAL_CANCELLED','Cloud sign-in was cancelled.');};
  const intent={preparing:false};active=intent;const operation=(async()=>{const b=await browser();check();
   // A different explicit selection cannot inherit a previous account grant.
   if(current.status==='connected'){intent.preparing=true;update({status:'connecting',session:null});const revoked=await b.client.disconnect();check();update(revoked);if(!['disconnected','expired'].includes(revoked.status)||revoked.revocationPending)fail('REVOCATION_PENDING','Previous sign-out still needs confirmation.');}
   intent.preparing=true;const pending=await b.client.beginExplicit();check();update(pending);
   if(!pending.request||typeof pending.route?.url!=='string')fail('PRODUCT_REQUEST_UNAVAILABLE','Cloud approval could not be prepared. Retry when connected.');
   const returned=await provider.request({method:'ynx_requestProductSessionV2',params:[pending.route.url]});check();
   if(!returned||returned.version!==2||typeof returned.returnUrl!=='string'||returned.returnUrl.length>16384||Object.keys(returned).sort().join(',')!=='returnUrl,version')fail('PRODUCT_RETURN_INVALID','Wallet approval could not be verified. Retry.');
   const result=await b.client.handleReturn(returned.returnUrl);
   check();return update(result);
  })();flight=operation;
  try{return await operation}catch(error){if(live())update(current.revocationPending?{...current,errorCode:error.code}:{status:error.code==='SESSION_EXPIRED'?'expired':'retry-required',session:null,errorCode:error.code});throw error}finally{if(flight===operation)flight=null;if(active===intent)active=null}
 }
 async function authorization(path,method='GET'){
  const scopes=cloudScopes(path,method),epoch=generation,view=current;if(view.status!=='connected'||!view.session?.account)fail('SESSION_INACTIVE','Approve Cloud file access before continuing.');
  let b,proof;try{b=await browser();proof=await b.createIntrospectionProof(scopes)}catch(error){if(epoch===generation&&['SESSION_EXPIRED','SESSION_INACTIVE','SESSION_REVOKED','PROOF_EXPIRED'].includes(error.code))invalidate(error.code);throw error}
  if(epoch!==generation||view!==current)fail('PRIVATE_CONTEXT_CHANGED','The selected Cloud account changed.');
  return {headers:{'X-YNX-Product-Session-Proof-V2':proof.proofHeader},account:view.session.account,generation:epoch};
 }
 function invalidate(code){++generation;update({status:'expired',session:null,errorCode:code});}
 return {connect,restore,disconnect,cancel,authorization,invalidate,state:()=>current,isCurrent:epoch=>epoch===generation,close:()=>{++generation;},busy:()=>!!flight||!!revokeFlight};
}
