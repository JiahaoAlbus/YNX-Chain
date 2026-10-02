import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from './vendor/product-session-browser-e1471c491.mjs';
import registry from './vendor/product-session-registry-a7dad7ec.json' with {type:'json'};
import {assertFinancePrivateAuthority,financePrivateAuthorityRevision,invalidateFinancePrivateAuthority} from './endpoint-authority-entry.js';
import {privateFiniteConsentText} from './private-finite-consent-copy.js';
import {privateSubjectMatchesSelectedWallet} from './private-subject-boundary.js';
const ATTEMPT_KEY='ynx.finance.browser-private.9840ef87.wallet-auth.attempted';
const SCOPES=Object.freeze(['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write']);
let adapter=null,initializing=null,generation=0,revision=0,busy=false;
let current=Object.freeze({status:'disconnected',session:null}),lastCode='',requestStage='idle';
function label(key){return window.YNXFinanceLocale?.text(key)??key;}
function revocationRequested(){try{return localStorage.getItem(ATTEMPT_KEY)==='revoking';}catch{return true;}}
function publish(next,code=''){
  if(next.status==='connected'&&revocationRequested()){next={status:'retry-required',session:null,revocationPending:true};code='REVOCATION_PENDING';}
  current=Object.freeze({status:next.status,session:next.status==='connected'?next.session:null,request:next.status==='connecting'?next.request:null,route:next.route,installation:next.installation,code,stage:requestStage,approvalRejected:next.approvalRejected===true,revocationConfirmed:next.revocationConfirmed===true,revocationPending:next.revocationPending===true});
  revision++;lastCode=code;render();window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:current.status,account:current.session?.account??null,revision,code,stage:requestStage,approvalRejected:current.approvalRejected,revocationConfirmed:current.revocationConfirmed}}));
}
function code(error){if(Number(error?.code)===4001)return 'USER_REJECTED';const value=error?.code||error?.message?.match(/^([A-Z][A-Z0-9_]{1,80})(?::|$)/)?.[1];return /^[A-Z][A-Z0-9_]{1,80}$/.test(value??'')?value:'PRIVATE_SERVICE_DEGRADED';}
async function initialize(){
  if(adapter)return adapter;
  if(!initializing)initializing=assertFinancePrivateAuthority().then(authority=>createBrowserProductSessionClient({registry,productId:'finance',scopes:SCOPES,
    finiteServiceSeconds:7200,
    purpose:'Read owned Finance activity and Pay evidence; manage private planning and explicitly requested AI drafts. No asset execution.',
    gateway:new ProductSessionGatewayFetchAdapter({endpoint:authority.walletGateway,fetch:globalThis.fetch.bind(globalThis),walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:10000})})).then(value=>adapter=value).finally(()=>{initializing=null;});
  return initializing;
}
async function operation(action){
  const attempt=++generation;const markStage=stage=>{if(attempt===generation){requestStage=stage;window.dispatchEvent(new CustomEvent('ynx-finance-private-progress',{detail:{stage,revision,code:lastCode,status:current.status}}));}};requestStage='authorityChecking';busy=true;publish({status:'checking',session:null});
  try{await assertFinancePrivateAuthority();markStage('authorityOK');const selected=await initialize(),authorityRevision=financePrivateAuthorityRevision();if(attempt!==generation)return current;const result=await action(selected,markStage);if(authorityRevision!==financePrivateAuthorityRevision())throw new Error('AUTHORITY_V2_SUPERSEDED');if(attempt===generation){
    // A disconnected SDK result follows its durable original-target cleanup.
    // Unconfirmed results retain the opt-in fence and retry only that sign-out.
    if(result.status==='disconnected'&&(result.revocationConfirmed===true||revocationRequested())){try{localStorage.removeItem(ATTEMPT_KEY);}catch{}}
    publish(result);
  }return attempt===generation?result:current;}
  catch(error){if(attempt===generation)reportFailure(error);return current;}
  finally{if(attempt===generation){busy=false;render();}}
}
async function restore(){
  const callback=location.pathname==='/wallet-auth/callback'&&location.search!=='';
  let attempted=false;try{attempted=['yes','revoking'].includes(localStorage.getItem(ATTEMPT_KEY));}catch{}
  if(!callback&&!attempted){publish({status:'guest',session:null});return current;}
  return operation(async selected=>{
  // Pass the complete callback intact to the shared parser; never extract a token.
  // The fixed shared SDK owns cold pending validation, fresh authority time,
  // original URL restoration and cancellation. Do not reconstruct a second
  // product-local pending state or replace a saved request on cold start.
  const result=revocationRequested()?await selected.client.disconnect():callback?await selected.client.handleReturn(location.href):await selected.client.restore(navigator.onLine);
  if(callback&&['connected','disconnected'].includes(result.status))history.replaceState(null,'',location.pathname);
  return result;
});}
async function begin(){return explicitRequest(false);}
async function retry(){return explicitRequest(true);}
async function explicitRequest(retry){
  if(busy)return current;
  if(revocationRequested())return disconnect();
  const recovering=retry||['connecting','retry-required','expired','network-unavailable','degraded'].includes(current.status);
  const wallet=window.YNXFinanceWallet,standardRevision=wallet?.getStandardRevision?.();
  const assertSelected=()=>{if(standardRevision!==wallet?.getStandardRevision?.())throw Object.assign(new Error('FINANCE_CONTEXT_CHANGED'),{code:'FINANCE_CONTEXT_CHANGED'})};
  return operation(async (selected,markStage)=>{
    try{
    assertSelected();try{localStorage.setItem(ATTEMPT_KEY,'yes');}catch{}
    let pending=recovering?await selected.client.retryDetected():await selected.client.beginExplicit();assertSelected();
    // A Retry that completes revocation ends that intent. It must never also
    // start a replacement authorization in the same click.
    if(pending.revocationPending||pending.revocationConfirmed===true)return pending;
    if(pending.status==='retry-required'&&wallet?.privateProviderAvailable?.()){
      // Native availability remains false. The SDK can recover the exact
      // saved pending request as an explicit route without pretending that a
      // browser extension is an installed native application.
      if(pending.request&&pending.route)pending=await selected.client.retryDetected();
      assertSelected();
      // Expired/invalid pending replacement is the official explicit SDK
      // action, guarded by its own revocation/time/device binding checks.
      if(pending.status==='retry-required'&&!pending.revocationPending)pending=await selected.client.beginExplicit();
      assertSelected();
    }
    // An explicitly selected native link remains available when no selected
    // YNX provider transport exists. Never infer installation or switch to
    // Hosted/MetaMask. The exact route is created and stored by the shared SDK.
    if(pending.status!=='connecting'||pending.route?.status!=='ready'||!wallet?.privateProviderAvailable?.())return pending;
    publish(pending);
    markStage('requestPrepared');
    markStage('transportDispatch');const response=await wallet.requestProductSessionV2(pending.route.url);assertSelected();markStage('returnReceived');
    const settled=await selected.client.handleReturn(response.returnUrl);
    assertSelected();
    if(settled.status==='connected'&&!privateSubjectMatchesSelectedWallet(settled.session,wallet.getStandardWalletState())){
      await selected.client.disconnect();throw new Error('FINANCE_ACCOUNT_MISMATCH');
    }
    // Locked SDK handleReturn returns disconnected only for its strictly
    // validated user-rejected callback; missing/expired/mismatched callbacks
    // and network failures return retry-required/network-unavailable instead.
    // Preserve the explicit revocation acknowledgement as a different terminal.
    return settled.status==='disconnected'&&!settled.revocationConfirmed?Object.freeze({...settled,approvalRejected:true}):settled;
    }catch(error){
      // enterGuest only changes presentation. Canonical disconnect serializes
      // with SDK begin/return, clears its pending callback and retains any
      // unconfirmed revocation intent for recovery. Never forge a cleared ack.
      if(error?.message==='FINANCE_CONTEXT_CHANGED'||error?.message==='WALLET_REQUEST_SUPERSEDED')await selected.client.disconnect();
      throw error;
    }
  });
}
async function disconnect(){
  // This existing browser opt-in key records sign-out before authority/network
  // waits. Reload resumes only the SDK's original revocation, never restore.
  try{localStorage.setItem(ATTEMPT_KEY,'revoking');}catch{publish({status:'retry-required',session:null},'REVOCATION_PENDING');return current;}
  const pending=adapter?.client.disconnect();pending?.catch(()=>{});
  return operation(selected=>pending??selected.client.disconnect());
}
function guest(){generation++;busy=false;const state=adapter?.client.enterGuest()??{status:'guest',session:null};publish(state);return state;}
function reportFailure(error){const failure=error?code(error):'PRIVATE_SERVICE_DEGRADED';publish({status:failure==='SESSION_EXPIRED'?'expired':'degraded',session:null},failure);}
async function proof(scope){
  if(revocationRequested())throw Object.assign(new Error('REVOCATION_PENDING'),{code:'REVOCATION_PENDING'});
  if(!SCOPES.includes(scope)||current.status!=='connected'||!current.session||!adapter)throw new Error('PRIVATE_SERVICE_DEGRADED: Private Finance requires separate Wallet approval.');
  const standardRevision=window.YNXFinanceWallet?.getStandardRevision?.();
  if(!privateSubjectMatchesSelectedWallet(current.session,window.YNXFinanceWallet?.getStandardWalletState?.()))throw new Error('FINANCE_ACCOUNT_MISMATCH: Selected Wallet differs from the approved private Finance subject.');
  const attempt=generation,view=current,selected=adapter;let phase='AUTHORITY';
  try{await assertFinancePrivateAuthority();phase='DEVICE_PROOF';const authorityRevision=financePrivateAuthorityRevision(),authorization=await selected.createIntrospectionProof([scope]);if(revocationRequested()||authorityRevision!==financePrivateAuthorityRevision()||attempt!==generation||current!==view||selected!==adapter||standardRevision!==window.YNXFinanceWallet?.getStandardRevision?.()||!privateSubjectMatchesSelectedWallet(view.session,window.YNXFinanceWallet?.getStandardWalletState?.()))throw new Error('FINANCE_CONTEXT_CHANGED');return authorization;}
  catch(error){if(attempt===generation&&error?.message!=='FINANCE_CONTEXT_CHANGED'){
    const failure=code(error);
    // A temporary failure to obtain fresh proof blocks this request, not the
    // already server-verified identity. Never create proof from a stale clock.
    if(['NETWORK_UNAVAILABLE','CLOCK_UNAVAILABLE'].includes(failure)||error?.name==='TimeoutError'){lastCode=failure;render();}
    else reportFailure(failure!=='PRIVATE_SERVICE_DEGRADED'?error:{code:`PRIVATE_${phase}_${/^[A-Za-z]{1,30}$/.test(error?.name??'')?error.name.toUpperCase():'ERROR'}`});
  }throw error;}
}
function render(){
  const consent=document.querySelector('#private-service-consent');if(consent)consent.textContent=privateFiniteConsentText(window.YNXFinanceLocale?.get?.()??'en',current.request??current.session,!!current.request);
  const status=document.querySelector('#private-state'),account=current.session?.account;
  if(status){
    const key=revocationRequested()?'privateLogoutUnconfirmed':current.status==='expired'?'privateReauthorize':current.status==='network-unavailable'||current.status==='retry-required'?'privateNetwork':current.status==='degraded'?'privateDegraded':'privateGuestState';
    const mismatch=current.status==='connected'&&!privateSubjectMatchesSelectedWallet(current.session,window.YNXFinanceWallet?.getStandardWalletState?.());
    status.textContent=current.status==='connected'?`${label('privateConnected')} ${account}. ${label('privateConnectedSuffix')}${mismatch?` ${label('privateAccountMismatch')}`:''}`:current.status==='connecting'?label('privateConnecting'):busy?label('privateChecking'):label(key);
    status.title=lastCode||'';
  }
  const open=document.querySelector('#private-open');
  // Exact SDK route, explicit user click only: no automatic navigation or install claim.
  if(open){const available=current.status==='connecting'&&current.route?.status==='ready'&&current.installation==='unverified';open.hidden=!available;if(available)open.setAttribute('href',current.route.url);else open.removeAttribute('href');}
  for(const id of ['private-begin','private-retry','private-revoke']){const element=document.querySelector('#'+id);if(element)element.disabled=busy;}
}
export const privateFinance=Object.freeze({restore,begin,retry,disconnect,guest,proof,reportFailure,revision:()=>revision,
  connected:()=>current.status==='connected'&&!!current.session,session:()=>current.session,state:()=>current,
  accountMatchesSelected:()=>privateSubjectMatchesSelectedWallet(current.session,window.YNXFinanceWallet?.getStandardWalletState?.())});
export function bindPrivateFinanceUI(){
  document.addEventListener('finance:localechange',render);
  window.addEventListener('ynx-finance-standard-state',render);
  document.querySelector('#private-begin')?.addEventListener('click',begin);
  document.querySelector('#private-retry')?.addEventListener('click',retry);
  document.querySelector('#private-revoke')?.addEventListener('click',disconnect);
  document.querySelector('#private-guest')?.addEventListener('click',guest);
  window.addEventListener('offline',()=>{generation++;busy=false;publish(adapter?.client.setNetworkAvailable(false)??{status:'network-unavailable'});});
  window.addEventListener('online',()=>{generation++;busy=false;publish(adapter?.client.setNetworkAvailable(true)??{status:'retry-required'});});
  window.addEventListener('pagehide',()=>{generation++;invalidateFinancePrivateAuthority();adapter?.close();adapter=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted)restore();});
  render();void restore();
}
