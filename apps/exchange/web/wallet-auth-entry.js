import {createExchangeWallet} from './wallet-connect-entry.js';
import {createExchangePrivateAccount} from './private-session-entry.js';

const $=selector=>document.querySelector(selector);
const short=value=>value?`${value.slice(0,10)}…${value.slice(-6)}`:'None';
const NATIVE_SIGNING_MESSAGE='Native Wallet action signing is not available in this browser adapter. Product Session device proof is read-only and cannot authorize an order, cancellation, margin transfer or withdrawal. Nothing was submitted.';
const WRITE_SCOPE_MESSAGE='This connection grants exchange:read only. An explicit product write permission and its verified action contract are required. Nothing was submitted.';
const unsupported=message=>Promise.reject(Object.assign(new Error(message),{code:'NATIVE_ACTION_SIGNING_UNAVAILABLE',nonRetryable:true}));
const dispatch=(name,detail)=>window.dispatchEvent(new CustomEvent(name,{detail}));
let standard,privateAccount;
function errorText(error){return ({USER_REJECTED:'Wallet approval was rejected.',WRONG_NETWORK:'Select YNX Testnet (0x1917) in the chosen wallet.',PROVIDER_DISCOVERY_AMBIGUOUS:'Multiple providers claim this identity. Resolve the wallet extensions, then retry.',YNX_WALLET_NOT_INJECTED:'YNX Wallet provider was not detected. Download YNX Wallet or choose MetaMask.',METAMASK_NOT_INJECTED:'MetaMask provider was not detected. Install MetaMask from its official page, then retry.',ORIGIN_NOT_ALLOWED:'Private account access is available only at the canonical Exchange origin.',NATIVE_ACTION_SIGNING_UNAVAILABLE:NATIVE_SIGNING_MESSAGE})[error?.detail||error?.code]||'Wallet operation could not complete. Your public market view remains available.'}
function show(error){const message=errorText(error);$('#wallet-state').textContent=message;dispatch('ynx-exchange-wallet-error',message)}
function showWalletFallback(result){$('#wallet-state').textContent=errorText(result);$('#wallet-downloads').hidden=false}
function renderStandard(value){
  const connected=value.status==='connected',name=value.providerKind==='metamask'?'MetaMask':'YNX Wallet';
  $('#connect').textContent=connected?`${name} · ${short(value.account)}`:'Connect wallet';
  $('#wallet-details').hidden=!value.account;
  $('#standard-wallet-provider').textContent=value.providerKind?name:'Not selected';
  $('#standard-wallet-account').textContent=value.account||'None';
  $('#standard-wallet-chain').textContent=value.chainId||'Unknown';
  if(connected){$('#wallet-state').textContent=`${name} Standard connection · ${short(value.account)} · 0x1917. Private Exchange access is separate.`;$('#wallet-dialog').close();$('#connect').focus();}
  else if(value.status==='wrong-chain')$('#wallet-state').textContent='The selected wallet is on another chain. Public markets remain usable; select 0x1917 before reconnecting.';
  else if(value.status==='disconnected')$('#wallet-state').textContent='Standard connection is locally disconnected. This does not claim remote permission revocation.';
  dispatch('ynx-exchange-standard-wallet-state',value);
}
async function choose(kind){
  try{const result=await standard.connect(kind);if(result.status==='unsupported')showWalletFallback(result);else if(result.status!=='standard-connected')show(result)}catch(error){show(error)}
}
function renderPrivate(value){
  const label=$('#private-state'),open=$('#private-open-wallet');
  open.hidden=true;open.removeAttribute('href');
  $('#private-account').textContent=value.account||'Not connected';
  $('#private-source').textContent=value.snapshot?.sourceMetadata?`${value.snapshot.sourceMetadata.stateBackend} · ${value.snapshot.sourceMetadata.status} · observed ${value.snapshot.sourceMetadata.asOf}`:'No private venue data loaded';
  $('#private-revoke').disabled=value.phase==='loading'||!['connected','degraded','authorization-required'].includes(value.phase);
  if(value.phase==='connected')label.textContent='Read-only private Exchange account verified. This is venue ledger data, not EVM wallet holdings or an order signature.';
  else if(value.phase==='approval-pending'){label.textContent='Request prepared and persisted by the Wallet SDK. Native installation is unverified. Click Open YNX Wallet to try; a real callback and Gateway verification are still required.';open.href=value.route;open.hidden=false;}
  else if(value.phase==='loading')label.textContent='Checking the private read-only session…';
  else if(value.code==='PRIVATE_REVOCATION_CONFIRMED')label.textContent='Private session revocation confirmed by the Wallet SDK. Standard connection is unchanged.';
  else if(value.code==='LOCAL_GUEST_NOT_REVOKED')label.textContent='Guest mode: private data hidden locally; remote revocation is not claimed.';
  else if(value.phase==='degraded'||value.phase==='authorization-required')label.textContent=`Private service ${value.phase}: ${value.code||'RETRY_REQUIRED'}. Standard Wallet connection is unchanged; retry when ready.`;
  else label.textContent='Optional private account access requests exchange:read only. Public markets and Standard Wallet do not require it.';
  dispatch('ynx-exchange-private-account-state',value);
}
standard=createExchangeWallet({scope:window,onState:renderStandard});
privateAccount=createExchangePrivateAccount({scope:window,onState:renderPrivate});
window.YNXExchangeWebWallet=standard;
const ready=initialize();
window.YNXExchangeWallet=Object.freeze({
  ready,
  connected:()=>privateAccount.state().phase==='connected',
  session:()=>privateAccount.state().phase==='connected'?Object.freeze({account:privateAccount.state().account,scopes:['exchange:read']}):null,
  privateState:()=>privateAccount.state(),
  refresh:()=>privateAccount.refresh(),
  async read(path){
    if(path==='/v1/account'){const next=await privateAccount.refresh();if(next.phase!=='connected')throw Object.assign(new Error('Private account read unavailable. Standard Wallet connection is unchanged.'),{nonRetryable:true,code:next.code});return next.snapshot;}
    return privateAccount.readResource(path);
  },
  connect:()=>{$('#wallet-dialog').showModal();},
  placeSpotOrder:()=>unsupported(NATIVE_SIGNING_MESSAGE),
  cancelSpotOrder:()=>unsupported(NATIVE_SIGNING_MESSAGE),
  transferMargin:()=>unsupported(NATIVE_SIGNING_MESSAGE),
  placePerpetualOrder:()=>unsupported(NATIVE_SIGNING_MESSAGE),
  cancelPerpetualOrder:()=>unsupported(NATIVE_SIGNING_MESSAGE),
  unsupportedWrite:kind=>unsupported(['deposit','withdrawal'].includes(kind)?NATIVE_SIGNING_MESSAGE:WRITE_SCOPE_MESSAGE),
  consumeActionResult:()=>null
});
async function initialize(){
  $('#wallet-request').onclick=()=>choose('ynx-wallet');
  $('#metamask-request').onclick=()=>choose('metamask');
  $('#wallet-disconnect').onclick=()=>standard.disconnect();
  $('#wallet-switch').onclick=()=>{standard.disconnect();$('#wallet-request').focus()};
  $('#wallet-restore').onclick=()=>standard.restore().catch(show);
  $('#wallet-revoke').onclick=async()=>{try{const outcome=await standard.revoke();$('#wallet-state').textContent=outcome.permissionRevoked?'Wallet permission revocation confirmed; accounts read back empty.':'Permission revocation is not confirmed. You can revoke access in the selected wallet.'}catch(error){show(error)}};
  $('#private-prepare').onclick=()=>privateAccount.begin();
  $('#private-retry').onclick=()=>privateAccount.retry();
  $('#private-guest').onclick=()=>privateAccount.guest();
  $('#private-revoke').onclick=()=>privateAccount.disconnect();
  window.addEventListener('offline',()=>privateAccount.offline());
  window.addEventListener('online',()=>privateAccount.online());
  window.addEventListener('pagehide',event=>{if(!event.persisted)privateAccount.close()});
  renderStandard(standard.state());renderPrivate(privateAccount.state());
  const url=new URL(location.href);
  if(url.pathname==='/wallet-action/callback'){
    // Old action callbacks and raw-device-key storage stay quarantined.
    // No parsing, migration, key reads, automatic POST or success toast.
    $('#wallet-state').textContent='Legacy action callback is not executed. A fresh reviewed native action signing contract is required; nothing was submitted.';
  }
  await Promise.allSettled([standard.restore(),privateAccount.start(url.href)]);
  const privateState=privateAccount.state();
  if(url.pathname==='/wallet-auth/callback'&&(privateState.phase==='connected'||['PRIVATE_REVOCATION_CONFIRMED','PRIVATE_SESSION_DISCONNECTED'].includes(privateState.code)))history.replaceState({},'', '/#market');
}
