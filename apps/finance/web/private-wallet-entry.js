import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from './vendor/product-session-browser-9840ef87.mjs';
import registry from './vendor/product-session-registry-9840ef87.json';
const AUTHORITY='https://wallet-auth.ynxweb4.com';
const ATTEMPT_KEY='ynx.finance.browser-private.9840ef87.wallet-auth.attempted';
const SCOPES=Object.freeze(['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write']);
let adapter=null,initializing=null,generation=0,revision=0,busy=false;
let current=Object.freeze({status:'disconnected',session:null}),lastCode='';
function publish(next,code=''){
  current=Object.freeze({status:next.status,session:next.status==='connected'?next.session:null,route:next.route,installation:next.installation});
  revision++;lastCode=code;render();window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:current.status,account:current.session?.account??null,revision}}));
}
function code(error){return /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code??'')?error.code:'PRIVATE_SERVICE_DEGRADED';}
async function initialize(){
  if(adapter)return adapter;
  if(!initializing)initializing=createBrowserProductSessionClient({registry,productId:'finance',scopes:SCOPES,
    purpose:'Read owned Finance activity and Pay evidence; manage private planning and explicitly requested AI drafts. No asset execution.',
    gateway:new ProductSessionGatewayFetchAdapter({endpoint:AUTHORITY,fetch:globalThis.fetch.bind(globalThis),walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:10000})}).then(value=>adapter=value).finally(()=>{initializing=null;});
  return initializing;
}
async function operation(action){
  const attempt=++generation;busy=true;publish({status:'checking',session:null});
  try{const selected=await initialize();if(attempt!==generation)return current;const result=await action(selected);if(attempt===generation)publish(result);return attempt===generation?result:current;}
  catch(error){if(attempt===generation)publish({status:'degraded',session:null},code(error));return current;}
  finally{if(attempt===generation){busy=false;render();}}
}
async function restore(){
  const callback=location.pathname==='/wallet-auth/callback'&&location.search!=='';
  let attempted=false;try{attempted=localStorage.getItem(ATTEMPT_KEY)==='yes';}catch{}
  if(!callback&&!attempted){publish({status:'guest',session:null});return current;}
  return operation(async selected=>{
  // Pass the complete callback intact to the shared parser; never extract a token.
  const key=selected.client.storageKey;
  const [session,pending,returned,revoking]=await Promise.all([selected.storage.get(key),selected.storage.get(key+':pending'),selected.storage.get(key+':return'),selected.storage.get(key+':revoke')]);
  if(!callback&&!session&&!returned&&!revoking){
    // Preserve the SDK's exact pending request across tabs/reload. Calling its
    // detected-reconnect path here would deliberately begin a different attempt.
    return {status:pending?'awaiting-return':'guest',session:null};
  }
  const result=callback?await selected.client.handleReturn(location.href):await selected.client.restore(navigator.onLine);
  if(callback&&['connected','disconnected'].includes(result.status))history.replaceState(null,'',location.pathname);
  return result;
});}
async function begin(){return operation(selected=>{try{localStorage.setItem(ATTEMPT_KEY,'yes');}catch{}return selected.client.beginExplicit();});}
async function retry(){return operation(selected=>selected.client.retryDetected());}
async function disconnect(){return operation(selected=>selected.client.disconnect());}
function guest(){generation++;busy=false;const state=adapter?.client.enterGuest()??{status:'guest',session:null};publish(state);return state;}
function reportFailure(){publish({status:'degraded',session:null},'PRIVATE_SERVICE_DEGRADED');}
async function proof(scope){
  if(!SCOPES.includes(scope)||current.status!=='connected'||!current.session||!adapter)throw new Error('PRIVATE_SERVICE_DEGRADED: Private Finance requires separate Wallet approval.');
  const attempt=generation,view=current,selected=adapter;
  try{const authorization=await selected.createIntrospectionProof([scope]);if(attempt!==generation||current!==view||selected!==adapter)throw new Error('FINANCE_CONTEXT_CHANGED');return authorization;}
  catch(error){if(attempt===generation)reportFailure();throw error;}
}
function render(){
  const status=document.querySelector('#private-state'),account=current.session?.account;
  if(status)status.textContent=(lastCode?lastCode+' · ':'')+(current.status==='connected'?'Private Finance verified for '+account+'. Standard EVM connection is separate.':current.status==='connecting'?'Request saved. Native installation is unverified. Click Open YNX Wallet yourself; only a verified Wallet callback can authorize Finance.':busy?'Checking the separate private Wallet authority…':'Private Finance: '+current.status+'. Public information and Standard Wallet remain available. Legacy sessions stay isolated with their original authority.');
  const open=document.querySelector('#private-open');
  // Exact SDK route, explicit user click only: no automatic navigation or install claim.
  if(open){const available=current.status==='connecting'&&current.route?.status==='ready'&&current.installation==='unverified';open.hidden=!available;if(available)open.setAttribute('href',current.route.url);else open.removeAttribute('href');}
  for(const id of ['private-begin','private-retry','private-revoke']){const element=document.querySelector('#'+id);if(element)element.disabled=busy;}
}
export const privateFinance=Object.freeze({restore,begin,retry,disconnect,guest,proof,reportFailure,revision:()=>revision,
  connected:()=>current.status==='connected'&&!!current.session,session:()=>current.session,state:()=>current});
export function bindPrivateFinanceUI(){
  document.querySelector('#private-begin')?.addEventListener('click',begin);
  document.querySelector('#private-retry')?.addEventListener('click',retry);
  document.querySelector('#private-revoke')?.addEventListener('click',disconnect);
  document.querySelector('#private-guest')?.addEventListener('click',guest);
  window.addEventListener('offline',()=>{generation++;busy=false;publish(adapter?.client.setNetworkAvailable(false)??{status:'network-unavailable'});});
  window.addEventListener('online',()=>{generation++;busy=false;publish(adapter?.client.setNetworkAvailable(true)??{status:'retry-required'});});
  window.addEventListener('pagehide',()=>{generation++;adapter?.close();adapter=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted)restore();});
  render();void restore();
}
