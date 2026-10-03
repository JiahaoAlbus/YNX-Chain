import {createMarketFeed,formatMicro,aggregateRetainedCandles} from './market-data.js?v=b8a186f1a359bfd7f83ddcf1f9186ae8aefebf4de3ab21e1b67a24f0891a6312';
import {buildOrderPreview,parseMicro,validateTradingRules} from './order-preview.js?v=5098a2dd729cc1f9b1321382febc46e361c3939ed371272a8ac63cf1bcac92b3';
import {createExchangePrivateAccount} from './private-session.js?v=ef1b89eef8e13e2ad27bc8893c5d4f09bf8c9fe21bb3b54498e34eb828a74675';
import {installExchangeLocale} from './locale.js';
const $=(s)=>document.querySelector(s);const $$=(s)=>[...document.querySelectorAll(s)];
const state={account:null,side:'buy',snapshot:null,book:null,publicTrades:[],config:null,activity:'trades',standardWallet:null,lastWalletKind:'ynx'};
const display=(v)=>formatMicro(v,document.documentElement.lang||'en');
function toast(message){const el=$('#toast');window.YNXExchangeLocale?.forget(el);if(message?.localeKey&&window.YNXExchangeLocale?.has(message.localeKey))window.YNXExchangeLocale.write(el,message.localeKey,message.suffix||'');else if(!window.YNXExchangeLocale?.error(el,message))el.textContent=message?.message??message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3500)}
function productApiUnavailable(){return Object.assign(new Error('API_UNAVAILABLE: This Exchange action needs a separate approved write scope and, for orders or withdrawals, an exact native Wallet signature. No request was sent.'),{code:'API_UNAVAILABLE'})}
function showWalletFallback(show){$('#wallet-fallback').hidden=!show}
function requireProductSession(){toast(productApiUnavailable());$('#private-account').scrollIntoView({block:'center'});$('#private-begin').focus();return false}
const privateAccount=createExchangePrivateAccount({onState:renderPrivateAccount});
let browserIdentity=null,browserIdentityEpoch=0,browserIdentitySilentAttempted=false,browserIdentityExplicitIntent=false,browserIdentityRestoreDeferred=false,browserIdentityLogoutOperation=null;
function writeBrowserIdentity(element,key,fallback,suffix=''){element.textContent=fallback;window.YNXExchangeLocale?.write(element,key,suffix)}
async function browserIdentityRequest(path,options={}){
  if(!['config','account','logout'].includes(path))throw new Error('IDENTITY_ROUTE_INVALID');
  const controller=new AbortController();let timer;
  const invalid=()=>Object.assign(new Error('IDENTITY_RESPONSE_INVALID'),{code:'IDENTITY_RESPONSE_INVALID'});
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Object.assign(new Error('IDENTITY_REQUEST_TIMEOUT'),{code:'IDENTITY_REQUEST_TIMEOUT'}));controller.abort()},5000)});
  try{return await Promise.race([deadline,(async()=>{
    const response=await fetch(`/api/v1/sso/${path}`,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=response.headers.get('content-length');
    if(!/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(mime)||(length!==null&&(!/^\d+$/.test(length)||Number(length)>262144)))throw invalid();
    const text=await response.text();if(new TextEncoder().encode(text).byteLength>262144)throw invalid();
    let data;try{data=JSON.parse(text)}catch{throw invalid()}
    if(!data||typeof data!=='object'||Array.isArray(data))throw invalid();
    return {response,data};
  })()])}finally{clearTimeout(timer)}
}
async function restoreBrowserIdentity(){const epoch=++browserIdentityEpoch;const status=$('#browser-identity-status');if(!status)return;try{const {response,data}=await browserIdentityRequest('account');if(epoch!==browserIdentityEpoch)return;if(response.ok){
  if(data.scopes?.length!==1||data.scopes[0]!=='identity:read'||data.privateWorkspaceAuthorized!==false)throw new Error('IDENTITY_BOUNDARY_INVALID');
  if(state.account&&state.account!==data.account)await privateAccount.disconnect();if(epoch!==browserIdentityEpoch)return;browserIdentity=data;writeBrowserIdentity(status,'identity-read',`${data.account} · Browser identity only; approve private Exchange read access separately.`,` (${data.account})`);$('#browser-identity-logout').hidden=false;$('#browser-identity-logout').disabled=false;
}else if(response.status===401||response.status===403){const wasSignedIn=!!browserIdentity;if(browserIdentity)await privateAccount.guest();if(epoch!==browserIdentityEpoch)return;browserIdentity=null;writeBrowserIdentity(status,'identity-guest','Browser sign-in is separate from Wallet connection and private Exchange permission.');$('#browser-identity-logout').hidden=true;$('#browser-identity-logout').disabled=false;if(!wasSignedIn)await restoreBrowserIdentityQuietly();}else{writeBrowserIdentity(status,'identity-unavailable','Identity recheck unavailable. Retry without creating another Wallet request.');$('#browser-identity-logout').disabled=false;}}catch{if(epoch===browserIdentityEpoch){writeBrowserIdentity(status,'identity-unavailable','Identity recheck unavailable. Retry without creating another Wallet request.');$('#browser-identity-logout').disabled=false;}}}
async function restoreBrowserIdentityQuietly(){
  const epoch=browserIdentityEpoch,privateState=privateAccount.state(),walletState=state.standardWallet;
  if(browserIdentityExplicitIntent||browserIdentitySilentAttempted){browserIdentityRestoreDeferred=false;return;}
  if(['loading','approval-pending'].includes(privateState.phase)){browserIdentityRestoreDeferred=true;return;}
  const {response,data}=await browserIdentityRequest('config');
  if(browserIdentityExplicitIntent||!response.ok||data.enabled!==true||data.silentRestoreAllowed!==true||browserIdentity){browserIdentityRestoreDeferred=false;return;}
  if(epoch!==browserIdentityEpoch)return; // A newer identity recheck owns its result.
  if(privateAccount.state()!==privateState||state.standardWallet!==walletState){browserIdentityRestoreDeferred=true;resumeDeferredBrowserIdentity();return;}
  browserIdentityRestoreDeferred=false;browserIdentitySilentAttempted=true;const target=['market','assets','activity','controls'].includes(location.hash.slice(1))?location.hash.slice(1):'assets';location.assign(`/sso/start?prompt=none&target=${encodeURIComponent(target)}`);
}
function resumeDeferredBrowserIdentity(){if(!browserIdentityRestoreDeferred||browserIdentity||browserIdentityExplicitIntent||browserIdentitySilentAttempted||!$('#browser-identity-status')||['loading','approval-pending'].includes(privateAccount.state().phase))return;browserIdentityRestoreDeferred=false;queueMicrotask(()=>void restoreBrowserIdentity());}
async function initializeBrowserIdentity(){try{const {response,data}=await browserIdentityRequest('config');if(!response.ok||data.enabled!==true)return;
  const panel=document.createElement('div');panel.id='browser-identity';const signIn=document.createElement('a');signIn.className='button';signIn.id='browser-identity-start';writeBrowserIdentity(signIn,'Sign in across YNX products','Sign in across YNX products');signIn.href='/sso/start?target=assets';signIn.addEventListener('click',()=>{browserIdentityExplicitIntent=true;browserIdentityRestoreDeferred=false;browserIdentityEpoch++;signIn.href=`/sso/start?target=${encodeURIComponent(['market','assets','activity','controls'].includes(location.hash.slice(1))?location.hash.slice(1):'assets')}`;});
  const logout=document.createElement('button');logout.id='browser-identity-logout';logout.type='button';writeBrowserIdentity(logout,'Sign out of Exchange','Sign out of Exchange');logout.hidden=true;const retry=document.createElement('button');retry.type='button';writeBrowserIdentity(retry,'Recheck browser identity','Recheck browser identity');retry.addEventListener('click',restoreBrowserIdentity);const status=document.createElement('p');status.id='browser-identity-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(signIn,logout,retry,status);$('#private-account').append(panel);
  logout.addEventListener('click',async()=>{
    const current=browserIdentity;if(!current||logout.disabled)return;
    const epoch=++browserIdentityEpoch;let signedOut=false;
    const owns=()=>epoch===browserIdentityEpoch&&browserIdentity===(signedOut?null:current);
    const operation={};browserIdentityLogoutOperation=operation;
    logout.disabled=true;
    try{
      await privateAccount.guest();if(!owns())return;
      const {response,data}=await browserIdentityRequest('logout',{method:'POST',headers:{'content-type':'application/json','X-YNX-SSO-CSRF':current.csrfToken},body:'{}'});
      if(!owns())return; // The server result still belongs to the original request.
      if(!response.ok||data.revoked!==true)throw new Error('REVOKE_UNCONFIRMED');
      signedOut=true;browserIdentity=null;logout.hidden=true;writeBrowserIdentity(status,'identity-signed-out','Signed out of Exchange. Other YNX products are unchanged.');
      await privateAccount.disconnect();if(!owns())return;
    }catch{if(owns())writeBrowserIdentity(status,signedOut?'identity-private-cleanup-unconfirmed':'identity-signout-unconfirmed',signedOut?'Exchange browser sign-out is confirmed. Separate private-access cleanup is not confirmed.':'Sign-out is not confirmed. Retry; no successful remote revocation is assumed.');}
    finally{if(browserIdentityLogoutOperation===operation){browserIdentityLogoutOperation=null;logout.disabled=false;}}
  });
  window.addEventListener('focus',restoreBrowserIdentity);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void restoreBrowserIdentity();});await restoreBrowserIdentity();
}catch{/* Opt-in unavailable; keep existing native/private and public routes. */}}

const marketFeed=createMarketFeed({onSnapshot(value){state.book=value.orderBook;state.publicTrades=value.trades;state.rules=value.tradingRules;state.source=value.sourceMetadata;renderBook();renderPublicMarket()},onStatus(value){state.marketPhase=value.phase;renderMarketStatus(value);estimate()}});
async function boot(){
  let languageStorage;try{languageStorage=window.localStorage}catch{}
  window.YNXExchangeLocale=installExchangeLocale({document,storage:languageStorage,onChange(){renderBook();renderPublicMarket();if(state.snapshot)renderAccount();estimate()}});
  bind();renderBook();renderPublicMarket();renderAIState();$('#custody-address').textContent='Separate approved deposit workflow required';window.YNXExchangeLocale?.write($('#custody-address'),'Separate approved deposit workflow required');$('#withdraw-fee').textContent='—';marketFeed.start();await Promise.all([restoreStandardWallet(),privateAccount.start(location.href),initializeBrowserIdentity()]);
}
function bind(){
  $$('.topbar nav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('#connect').addEventListener('click',openWalletChooser);
  $('#connect-ynx-wallet').addEventListener('click',()=>connectWallet('ynx').catch(error=>walletConnectionFailure(error,'YNX Wallet')));
  $('#connect-hosted-ynx').addEventListener('click',()=>connectWallet('hosted').catch(error=>walletConnectionFailure(error,'YNX Wallet Web')));
  $('#connect-metamask').addEventListener('click',()=>connectWallet('metamask').catch(error=>walletConnectionFailure(error,'MetaMask')));
  $('#wallet-retry').addEventListener('click',()=>connectWallet(state.lastWalletKind).catch(error=>walletConnectionFailure(error,state.lastWalletKind==='metamask'?'MetaMask':state.lastWalletKind==='hosted'?'YNX Wallet Web':'YNX Wallet')));
  $('#wallet-disconnect').addEventListener('click',()=>disconnectWallet());
  $('#wallet-revoke').addEventListener('click',()=>revokeWalletPermission());
  $('#wallet-switch').addEventListener('click',()=>{disconnectWallet();$('#wallet-dialog').showModal()});
  $('#private-begin').addEventListener('click',()=>privateAccount.begin());
  $('#private-retry').addEventListener('click',()=>privateAccount.retry());
  $('#private-refresh').addEventListener('click',()=>privateAccount.refresh());
  $('#private-guest').addEventListener('click',()=>privateAccount.guest());
  $('#private-disconnect').addEventListener('click',()=>{if(window.confirm(window.YNXExchangeLocale?.text('confirm-private-revoke')??'Revoke this read-only Exchange Product Session? This does not disconnect your standard Wallet or cancel orders.'))privateAccount.disconnect()});
  $('#private-standard-wallet').addEventListener('click',openWalletChooser);
  window.addEventListener('ynx-exchange-standard-wallet-state',event=>{privateAccount.walletChanged(window.YNXExchangeWebWallet.getPrivateWalletContext());renderWalletState(event.detail)});
  $('#buy-tab').addEventListener('click',()=>setSide('buy'));$('#sell-tab').addEventListener('click',()=>setSide('sell'));
  $('#price').addEventListener('input',estimate);$('#amount').addEventListener('input',estimate);$('#withdraw-amount').addEventListener('input',withdrawEstimate);
  $('#order-form').addEventListener('submit',reviewOrder);$('#deposit-form').addEventListener('submit',observeDeposit);$('#withdraw-form').addEventListener('submit',reviewWithdrawal);
  $('#refresh').addEventListener('click',refreshAll);$('#security-form').addEventListener('submit',saveSecurity);$('#support-form').addEventListener('submit',openSupport);
  $('#market-retry').addEventListener('click',refreshAll);
  $('#chart-interval').addEventListener('change',renderPublicMarket);
  window.addEventListener('offline',()=>{marketFeed.offline();privateAccount.offline()});window.addEventListener('online',()=>{marketFeed.retry();privateAccount.online()});
  window.addEventListener('pagehide',()=>marketFeed.stop());window.addEventListener('pageshow',event=>{if(event.persisted)marketFeed.retry()});
  $('#ai-submit').addEventListener('click',requestAI);$('#draft-order').addEventListener('click',()=>{showView('controls');$('#ai-kind').value='order_draft';$('#ai-prompt').focus()});
  $$('.tabs button').forEach(b=>b.addEventListener('click',()=>{state.activity=b.dataset.activity;$$('.tabs button').forEach(x=>x.setAttribute('aria-selected',String(x===b)));renderActivity()}));
}
function renderStandardWallet(result){state.standardWallet=result;state.lastWalletKind=result.transport==='hosted-wallet-web'?'hosted':result.providerKind==='metamask'?'metamask':'ynx';showWalletFallback(false);$('#wallet-details').hidden=false;$('#wallet-provider').textContent=result.providerKind==='metamask'?'MetaMask':result.transport==='hosted-wallet-web'?'YNX Wallet Web':'YNX Wallet';$('#wallet-account').textContent=result.account||'—';$('#wallet-chain').textContent=result.chainId||'—';$('#wallet-revoke').hidden=result.transport==='hosted-wallet-web';$('#connect').textContent='Wallet details';window.YNXExchangeLocale?.write($('#connect'),'Wallet details');$('#wallet-state').textContent=`Standard ${result.providerKind} Wallet connected on YNX Testnet. Exchange private account status is independent; no order or withdrawal was authorized.`;window.YNXExchangeLocale?.write($('#wallet-state'),'wallet-connected',` (${ $('#wallet-provider').textContent })`);if($('#wallet-dialog').open){$('#wallet-dialog').close();$('#connect').focus()}}
function renderWalletState(connectionState){if(connectionState?.status==='transport-unavailable'){state.standardWallet=null;$('#wallet-details').hidden=true;$('#connect').textContent='Reconnect Wallet';window.YNXExchangeLocale?.write($('#connect'),'Reconnect Wallet');$('#wallet-state').textContent='Wallet transport temporarily unavailable. Existing private reads are checked independently; reconnect to approve a new request.';window.YNXExchangeLocale?.write($('#wallet-state'),'wallet-transport');return}if(connectionState?.status==='connected')return renderStandardWallet({status:'standard-connected',...connectionState});state.standardWallet=null;$('#wallet-details').hidden=true;$('#connect').textContent='Connect YNX Wallet';window.YNXExchangeLocale?.write($('#connect'),'Connect YNX Wallet');const wrongChain=connectionState?.status==='wrong-chain'||connectionState?.errorCode==='WRONG_NETWORK';$('#wallet-state').textContent=wrongChain?'Selected Wallet is not on YNX Testnet. Reconnect to request a switch to chain 0x1917; no account permission was requested.':'Standard Wallet disconnected. Exchange market data remains available.';window.YNXExchangeLocale?.write($('#wallet-state'),wrongChain?'wallet-wrong-chain':'wallet-disconnected')}
function disconnectWallet(){window.YNXExchangeWebWallet.disconnect();renderWalletState(window.YNXExchangeWebWallet.state());if($('#wallet-dialog').open)$('#wallet-dialog').close();$('#connect').focus();toast({localeKey:'wallet-toast-disconnected',message:'Selected Wallet disconnected. Its bound private read access is cleared; venue orders and token approvals are unchanged.'});}
async function revokeWalletPermission(){
  if(!window.confirm(window.YNXExchangeLocale?.text('confirm-wallet-revoke')??'Request this Wallet to revoke Exchange account access? This does not revoke token approvals or cancel orders.'))return;
  const button=$('#wallet-revoke');if(button.disabled)return;button.disabled=true;
  try{const outcome=await window.YNXExchangeWebWallet.revoke();if(outcome.permissionRevoked){renderWalletState(window.YNXExchangeWebWallet.state());if($('#wallet-dialog').open)$('#wallet-dialog').close();$('#connect').focus();toast({localeKey:'wallet-toast-revoked',message:'Account permission revoked and empty account exposure confirmed. Token approvals and venue orders are unchanged.'})}else toast({localeKey:'wallet-toast-revoke-unconfirmed',message:`Account permission revocation ${outcome.status}; not confirmed. No private service or token approval was changed.`,suffix:` (${outcome.status})`})}catch{toast({localeKey:'wallet-toast-revoke-failed',message:'Wallet revocation failed. Permission removal is not confirmed.'})}finally{button.disabled=false}
}
function openWalletChooser(){browserIdentityExplicitIntent=true;browserIdentityRestoreDeferred=false;browserIdentityEpoch++;if(state.standardWallet?.status==='standard-connected'){$('#wallet-dialog').showModal();return}showWalletFallback(false);$('#wallet-state').textContent='Choose injected YNX Wallet, YNX Wallet Web, or MetaMask. Only an explicit click requests an account.';window.YNXExchangeLocale?.write($('#wallet-state'),'wallet-chooser');$('#wallet-dialog').showModal()}
async function restoreStandardWallet(){try{const result=await window.YNXExchangeWebWallet.restore();if(result.status==='standard-connected')renderStandardWallet(result)}catch{}}
function walletConnectionFailure(error,provider){toast({localeKey:'wallet-toast-connect-failed',message:error?.message||'Wallet connection failed closed.',suffix:` (${provider}; ${error?.code||error?.message||'UNKNOWN_ERROR'})`})}
async function connectWallet(kind){
  state.lastWalletKind=kind;
  const result=await (kind==='hosted'?window.YNXExchangeWebWallet.connectHosted():kind==='metamask'?window.YNXExchangeWebWallet.connectMetaMask():window.YNXExchangeWebWallet.connectYNX());
  const provider=kind==='metamask'?'MetaMask':kind==='hosted'?'YNX Wallet Web':'YNX Wallet';
  if(result.status==='wrong-chain'){
    showWalletFallback(false);$('#wallet-state').textContent=`${kind==='metamask'?'MetaMask':'YNX Wallet'} remains on a different network. Reconnect to request YNX Testnet (0x1917); no account permission was requested.`;
    window.YNXExchangeLocale?.write($('#wallet-state'),'wallet-wrong-chain',` (${provider})`);$('#wallet-dialog').showModal();return result;
  }
  if(result.status!=='standard-connected'){
    showWalletFallback(true);$('#wallet-state').textContent=`${kind==='hosted'?'Hosted Wallet approval did not complete.':kind==='metamask'?'MetaMask':'Injected YNX Wallet'} was not available. Exchange remains on this page; use Download YNX Wallet or MetaMask.`;
    window.YNXExchangeLocale?.write($('#wallet-state'),'wallet-unavailable',` (${provider}; ${result.status})`);$('#wallet-dialog').showModal();return result;
  }
  renderStandardWallet(result);if($('#wallet-dialog').open)$('#wallet-dialog').close();$('#connect').focus();
  toast({localeKey:'wallet-toast-connected',message:'Standard Wallet connected. No Exchange Product Session or order authority was created.'});return result;
}
function showView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.topbar nav button').forEach(b=>b.classList.toggle('nav-active',b.dataset.view===id));location.hash=id;document.title=`YNX Exchange — ${id[0].toUpperCase()+id.slice(1)}`}
function setSide(side){state.side=side;$('#buy-tab').setAttribute('aria-selected',side==='buy');$('#sell-tab').setAttribute('aria-selected',side==='sell');estimate()}
function preview(){return buildOrderPreview({price:$('#price').value,amount:$('#amount').value,side:state.side,rules:state.rules,source:state.source,marketPhase:state.marketPhase})}
function estimate(){
  $('#reservation').textContent='—';$('#order-fees').textContent='Unavailable';window.YNXExchangeLocale?.write($('#order-fees'),'Unavailable');window.YNXExchangeLocale?.forget($('#order-error'));$('#order-error').textContent='';
  try{const rules=validateTradingRules(state.rules);window.YNXExchangeLocale?.forget($('#order-fees'));$('#order-fees').textContent=`${rules.makerFeeBps} / ${rules.takerFeeBps} bps`;const limitSuffix=` ${display(BigInt(rules.maxOrderNotionalMicro))} YUSD_TEST.`;$('#order-limits').textContent=`6 decimals; price and amount 0.000001–1,000,000. Maximum notional:${limitSuffix}`;window.YNXExchangeLocale?.write($('#order-limits'),'order-limits-description',limitSuffix);if(!$('#price').value&&!$('#amount').value)return;const value=preview();$('#reservation').textContent=`${display(value.initialReservationMicro)} ${value.reservationAsset}`}catch(error){if(!window.YNXExchangeLocale?.error($('#order-error'),error))$('#order-error').textContent=error.message}
}
function withdrawEstimate(){const fee=state.config?.networks?.find(n=>n.asset==='YNXT'&&n.network==='YNX Testnet')?.withdrawalFeeMicro;$('#withdraw-receive').textContent='—';if(!Number.isSafeInteger(fee)||fee<0)return;try{const amount=parseMicro($('#withdraw-amount').value);if(amount>BigInt(fee))$('#withdraw-receive').textContent=`${display(amount-BigInt(fee))} YNXT`}catch{}}

async function refreshAll(){await marketFeed.retry();if(privateAccount.state().phase==='connected')await privateAccount.refresh()}
function renderMarketStatus({phase,source}){const cached=!!source;$('#market-connection').textContent=({loading:'Loading venue market data…',live:source?.status==='degraded_single_host'?'Connected · single-host test data':'Connected · venue market data',polling:'Connected · periodic market snapshots',reconnecting:'Market connection interrupted · reconnecting',offline:'Offline · reconnect when your network returns',unavailable:'Market data unavailable · retrying'})[phase];window.YNXExchangeLocale?.write($('#market-connection'),phase==='live'?(source?.status==='degraded_single_host'?'market-single':'market-live'):`market-${phase}`);$('#market-source').textContent=source?`${source.authority} · ${source.coverage} · snapshot ${new Date(source.asOf).toLocaleString(document.documentElement.lang)} · ${source.version}`:'No verified market snapshot received.';$('#market-source').dataset.stale=String(cached&&!['live','polling'].includes(phase));$('#market-stale').hidden=!cached||['live','polling'].includes(phase);if(!cached&&['offline','unavailable'].includes(phase)){$('#spread').textContent='Market depth unavailable';$('#public-trades').innerHTML='<tr><td colspan="5" class="empty-cell">Market source unavailable. Reconnect to load actual matches.</td></tr>';$('#chart-empty').querySelector('strong').textContent='Market source unavailable'}}
async function refreshBook(){await refreshAll()}
async function refreshAccount(){return privateAccount.refresh()}
function renderPrivateAccount(value){
  if(state.account!==value.account)rememberSupportDraft(state.account,value.account);
  state.privatePhase=value.phase;state.account=value.account;state.snapshot=value.snapshot;
  const messages={guest:'Guest mode. Private venue data is hidden; standard Wallet and public markets are independent.',loading:'Verifying the Exchange private account…',connected:'Read-only Exchange account verified by the private authority and Product API. No order or withdrawal permission.', 'approval-pending':'Request saved. Click Open YNX Wallet to review read-only access. Native installation is unverified; returning here alone is not approval.',degraded:'Private account unavailable. Retry can recover its protected state; your standard Wallet remains unchanged.','authorization-required':'Private account authorization expired or was rejected. Retry or start a new explicit approval.',closed:'Private account is closed.'};
  $('#private-status').textContent=`${value.phase==='approval-pending'&&value.installation==='selected-provider'?'Review Exchange read-only access in the selected Wallet. No venue data is available until its approved return is verified.':messages[value.phase]||messages.degraded}${value.code?' ('+value.code+')':''}`;
  window.YNXExchangeLocale?.write($('#private-status'),value.phase==='approval-pending'&&value.installation==='selected-provider'?'selected-pending':Object.hasOwn(messages,value.phase)?value.phase:'degraded',value.code?' ('+value.code+')':'');
  const open=$('#private-open');open.hidden=!value.route;if(value.route)open.href=value.route;else open.removeAttribute('href');
  $('#private-details').hidden=value.phase!=='connected';$('#private-native-account').textContent=value.account||'—';$('#private-expiry').textContent=value.expiresAt?new Date(value.expiresAt).toLocaleString():'—';
  for(const id of ['private-begin','private-retry','private-refresh','private-disconnect'])$('#'+id).disabled=value.phase==='loading';
  $('#private-refresh').hidden=value.phase!=='connected';
  if(value.snapshot){window.YNXExchangeLocale?.forget($('#balances'));window.YNXExchangeLocale?.forget($('#private-source'));renderAccount();$('#private-source').textContent=`${value.snapshot.sourceMetadata.status} · ${value.snapshot.sourceMetadata.coverage} · ${new Date(value.snapshot.sourceMetadata.asOf).toLocaleString()}`}
  else{for(const id of ['balances','orders','activity-head','activity-body'])$('#'+id).replaceChildren();$('#balances').textContent='Private balances are not currently verified.';window.YNXExchangeLocale?.write($('#balances'),'private-no-balances');$('#owned-volume').textContent='—';$('#private-source').textContent='No verified account snapshot.';window.YNXExchangeLocale?.write($('#private-source'),'private-no-snapshot')}
  renderOwnedControls();
  if(location.pathname==='/wallet-auth/callback'&&(value.phase==='connected'||value.code==='PRIVATE_SESSION_DISCONNECTED'))history.replaceState(null,'','/');
  resumeDeferredBrowserIdentity();
}
const supportDrafts=new Map();
function rememberSupportDraft(previous,next){
  if(previous)supportDrafts.set(previous,{category:$('#support-category').value,message:$('#support-message').value});
  $('#support-form').reset();
  const draft=next&&supportDrafts.get(next);if(draft){$('#support-category').value=draft.category;$('#support-message').value=draft.message;supportDrafts.delete(next)}
}
function renderOwnedControls(){
  const snapshot=state.snapshot,security=$('#security-read-state'),root=$('#owned-support-cases');window.YNXExchangeLocale?.forget(root);root.replaceChildren();
  if(!snapshot){$('#security-form').reset();$('#withdraw-lock').disabled=true;$('#session-ttl').disabled=true;security.textContent='No verified account settings. Saving controls requires a separate write approval.';window.YNXExchangeLocale?.write(security,'controls-unverified');root.textContent='Existing support cases are not currently verified. Restore Exchange read access to view them.';window.YNXExchangeLocale?.write(root,'support-unverified');return}
  $('#withdraw-lock').disabled=true;$('#session-ttl').disabled=true;
  const asOf=Number.isFinite(Date.parse(snapshot.security.updatedAt))?new Date(snapshot.security.updatedAt).toLocaleString():'Source timestamp unavailable';
  security.textContent=`Verified read-only settings · ${asOf}. Saving controls requires a separate write approval.`;
  window.YNXExchangeLocale?.write(security,Number.isFinite(Date.parse(snapshot.security.updatedAt))?'controls-read-verified':'controls-read-no-time',Number.isFinite(Date.parse(snapshot.security.updatedAt))?` · ${asOf}`:'');
  const cases=snapshot.support.filter(item=>item.account===state.account);
  if(!cases.length){root.textContent='No existing support cases for this approved account.';window.YNXExchangeLocale?.write(root,'support-empty');return}
  for(const item of [...cases].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))){
    const article=document.createElement('article'),title=document.createElement('strong'),detail=document.createElement('p'),message=document.createElement('p');
    title.textContent=`${item.category} · ${item.status}`;detail.textContent=`${item.id} · ${new Date(item.createdAt).toLocaleString()}`;message.textContent=item.message;article.append(title,detail,message);root.append(article);
  }
}
function renderBook(){const best=(rows,direction)=>rows.slice().sort((a,b)=>direction*(a.priceMicro-b.priceMicro)||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,7);renderRows('#asks',best(state.book?.asks||[],1).reverse());renderRows('#bids',best(state.book?.bids||[],-1));const all=[...(state.book?.asks||[]),...(state.book?.bids||[])];const key=all.length?'Owned venue open orders':'No public market depth';$('#spread').textContent=key;window.YNXExchangeLocale?.write($('#spread'),key)}
function renderRows(selector,rows){const root=$(selector);root.replaceChildren();if(!rows.length){const div=document.createElement('div');div.innerHTML='<span>—</span><span>—</span><span>—</span>';root.append(div);return}rows.forEach(o=>{const div=document.createElement('div'),remaining=BigInt(o.amountMicro)-BigInt(o.filledMicro);[display(o.priceMicro),display(remaining),display(remaining*BigInt(o.priceMicro)/1_000_000n)].forEach(v=>{const span=document.createElement('span');span.textContent=v;div.append(span)});root.append(div)})}
function renderAccount(){renderOrders();renderBalances();renderActivity();const s=state.snapshot.security;$('#withdraw-lock').checked=!!s.withdrawalLock;$('#session-ttl').value=String(s.sessionTtlMinutes||480);const volume=(state.snapshot.trades||[]).reduce((n,t)=>n+BigInt(t.amountMicro),0n);$('#owned-volume').textContent=`${display(volume)} YNXT`}
function renderOrders(){const root=$('#orders');root.replaceChildren();const rows=(state.snapshot.orders||[]).filter(o=>['open','partially_filled'].includes(o.status));if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.className='empty-cell';td.textContent='No open orders. The venue does not seed fake depth.';window.YNXExchangeLocale?.write(td,'orders-empty');tr.append(td);root.append(tr);return}rows.sort(ownedRecordOrder).forEach(o=>{const tr=document.createElement('tr');const values=[ownedRecordTime(o.createdAt,true),o.side,display(o.priceMicro),`${display(o.amountMicro)} / ${display(o.filledMicro)}`,window.YNXExchangeLocale?.record('order',o.status)??o.status];values.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i===4)td.className=`status-${o.status}`;tr.append(td)});const td=document.createElement('td');const btn=document.createElement('button');btn.className='text-button';btn.textContent=window.YNXExchangeLocale?.text('Cancel')??'Cancel';btn.addEventListener('click',()=>cancelOrder(o));td.append(btn);tr.append(td);root.append(tr)})}
function ownedRecordInstant(value){
  if(typeof value!=='string')return null;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if(!parts)return null;
  const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]),instant=Date.parse(value);
  if(year<=0||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||!Number.isFinite(instant))return null;
  return instant;
}
function ownedRecordOrder(a,b){return (ownedRecordInstant(b.createdAt)??-Infinity)-(ownedRecordInstant(a.createdAt)??-Infinity)||String(a.id).localeCompare(String(b.id))}
function ownedRecordTime(value,timeOnly=false){const instant=ownedRecordInstant(value);if(instant===null)return '—';const date=new Date(instant),locale=document.documentElement.lang||'en';return timeOnly?date.toLocaleTimeString(locale):date.toLocaleString(locale)}
function renderBalances(){const root=$('#balances');root.replaceChildren();(state.snapshot.balances||[]).forEach(b=>{const div=document.createElement('div');div.className='balance-card';const title=document.createElement('strong');title.textContent=b.asset;const dl=document.createElement('dl');for(const [key,value] of [['Available',b.availableMicro],['Reserved',b.reservedMicro]]){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=window.YNXExchangeLocale?.text(key)??key;dd.textContent=display(value);row.append(dt,dd);dl.append(row)}div.append(title,dl);root.append(div)})}
function renderActivity(){
  const head=$('#activity-head'),body=$('#activity-body');head.replaceChildren();body.replaceChildren();
  if(!state.snapshot)return;
  const owned=key=>(state.snapshot[key]||[]).filter(row=>key==='trades'?row.buyer===state.account||row.seller===state.account:row.account===state.account)
    .slice().sort(ownedRecordOrder);
  const time=ownedRecordTime;
  let rows=[],columns=[];
  if(state.activity==='orders'){
    columns=['Time','Order ID','Market','Side / type','Price','Amount / Filled','Status','Reason'];
    rows=owned('orders').map(o=>[time(o.createdAt),o.id,o.market,`${o.side} / ${o.type}`,display(o.priceMicro),`${display(o.amountMicro)} / ${display(o.filledMicro)}`,window.YNXExchangeLocale?.record('order',o.status)??o.status,o.rejectReason||'—']);
  }else if(state.activity==='ledger'){
    columns=['Time','Entry ID','Asset','Available change','Reserved change','Source','Reference','Source digest'];
    rows=owned('ledger').map(l=>[time(l.createdAt),l.id,l.asset,display(l.availableDelta),display(l.reservedDelta),l.sourceType,l.sourceId,l.sourceDigest]);
  }else if(state.activity==='deposits'){
    columns=['Time','Deposit ID','Asset / network','Amount','Confirmations / required','Venue status','Transaction hash','Source digest'];
    rows=owned('deposits').map(d=>[time(d.createdAt),d.id,`${d.asset} / ${d.network}`,display(d.amountMicro),`${d.confirmations} / ${d.required}`,window.YNXExchangeLocale?.record('deposit',d.status)??d.status,d.txHash,d.sourceDigest]);
  }else if(state.activity==='withdrawals'){
    columns=['Time','Withdrawal ID','Asset / network','Amount','Fee','Receive','Venue status','Destination','Source digest'];
    rows=owned('withdrawals').map(w=>[time(w.createdAt),w.id,`${w.asset} / ${w.network}`,display(w.amountMicro),display(w.feeMicro),display(w.receiveMicro),window.YNXExchangeLocale?.record('withdrawal',w.status)??w.status,w.destination,w.sourceDigest]);
  }else if(state.activity==='trades'){
    columns=['Time','Side','Price','Amount','Fee'];
    rows=owned('trades').map(t=>[time(t.createdAt),t.buyer===state.account?'buy':'sell',display(t.priceMicro),display(t.amountMicro),display(t.buyer===state.account?t.buyerFeeMicro:t.sellerFeeMicro)]);
  }else if(state.activity==='fees'){
    columns=['Time','Kind','Asset','Exact fee','Reference'];
    rows=owned('fees').map(f=>[time(f.createdAt),f.kind,f.asset,display(f.amountMicro),f.reference]);
  }else{
    columns=['Time','Action','Object','Proof digest'];
    rows=owned('audit').map(a=>[time(a.createdAt),a.action,`${a.objectType}:${a.objectId}`,a.digest]);
  }
  const heading=document.createElement('tr');
  for(const label of columns){const th=document.createElement('th');th.scope='col';if(window.YNXExchangeLocale)window.YNXExchangeLocale.write(th,label);else th.textContent=label;heading.append(th)}head.append(heading);
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns.length;td.className='empty-cell';if(window.YNXExchangeLocale)window.YNXExchangeLocale.write(td,'No owned records yet.');else td.textContent='No owned records yet.';tr.append(td);body.append(tr);return}
  for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td)}body.append(tr)}
}
function renderPublicMarket(){
  const candles=aggregateRetainedCandles(state.publicTrades,Number($('#chart-interval').value));
  const byID=new Map(state.publicTrades.map(trade=>[trade.id,trade]));
  const trades=candles.flatMap(candle=>candle.trades.map(reference=>byID.get(reference.id)));
  const matchTime=$('#market-last-match'),latestMatch=trades.at(-1);
  if(matchTime){
    matchTime.textContent=latestMatch?`Latest retained match time · ${latestMatch.createdAt}`:'No actual venue matches yet.';
    window.YNXExchangeLocale?.write(matchTime,latestMatch?'market-match-time':'market-no-matches',latestMatch?` · ${latestMatch.createdAt}`:'');
    for(const [key,value] of Object.entries({matchId:latestMatch?.id,matchTime:latestMatch?.createdAt,matchDigest:latestMatch?.sourceDigest})){
      if(value)matchTime.dataset[key]=value;else delete matchTime.dataset[key];
    }
  }
  const body=$('#public-trades'),svg=$('#chart-svg');body.replaceChildren();svg.replaceChildren();
  let caption=$('#candle-caption');if(!caption){caption=document.createElement('p');caption.id='candle-caption';caption.className='source-note';svg.before(caption)}
  caption.textContent='OHLCV from retained venue matches';window.YNXExchangeLocale?.write(caption,'candle-chart-label');svg.setAttribute('aria-labelledby','chart-title candle-caption');
  const records=$('#candle-records');records.replaceChildren();
  // SVG has no HTML hidden property. Set the actual attribute, not an expando.
  svg.toggleAttribute('hidden',!trades.length);$('#chart-empty').hidden=!!trades.length;$('#last-price').textContent='—';
  const emptyTitle=$('#chart-empty').querySelector('strong');emptyTitle.textContent='No matched price yet';window.YNXExchangeLocale?.write(emptyTitle,'market-no-price');
  if(!trades.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty-cell';td.textContent='No actual venue matches yet.';window.YNXExchangeLocale?.write(td,'market-no-matches');tr.append(td);body.append(tr);return}
  for(const trade of [...trades].reverse().slice(0,20)){const tr=document.createElement('tr');[new Date(trade.createdAt).toLocaleString(),display(trade.priceMicro),display(trade.amountMicro),trade.sourceType,trade.sourceDigest].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td)});body.append(tr)}
  const visible=candles.slice(-60),lo=Math.min(...visible.map(c=>c.lowMicro)),hi=Math.max(...visible.map(c=>c.highMicro));
  const y=price=>250-(price-lo)/Math.max(1,hi-lo)*210;
  const element=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));return node};
  const fontSize=Math.round(14*800/Math.max(280,svg.getBoundingClientRect().width||800));
  const label=element('text',{x:30,y:fontSize+5,fill:'#667085','font-size':fontSize});label.textContent='OHLCV';svg.append(label);
  for(const [i,candle] of visible.entries()){
    // x is elapsed UTC time, not a synthetic fill for intervals without trades.
    const x=visible.length===1?400:40+(candle.start-visible[0].start)/Math.max(1,visible.at(-1).start-visible[0].start)*720;
    const width=Math.min(12,Math.max(1,720/Math.max(1,(visible.at(-1).start-visible[0].start)/Number($('#chart-interval').value)+1)*.6));
    const color=candle.closeMicro>=candle.openMicro?'#087a55':'#c0342b';
    const group=element('g',{'data-candle-start':candle.start});
    group.append(element('line',{x1:x,x2:x,y1:y(candle.highMicro),y2:y(candle.lowMicro),stroke:color,'stroke-width':2}),element('rect',{x:x-width/2,y:Math.min(y(candle.openMicro),y(candle.closeMicro)),width,height:Math.max(1,Math.abs(y(candle.openMicro)-y(candle.closeMicro))),fill:color}));
    const description=`${new Date(candle.start).toISOString()} · O/H/L/C ${[candle.openMicro,candle.highMicro,candle.lowMicro,candle.closeMicro].map(price=>display(price)).join(' / ')} YUSD_TEST · V ${display(BigInt(candle.volumeMicro))} YNXT`;
    const title=element('title',{});title.textContent=description;group.append(title);svg.append(group);
    const row=document.createElement('tr');[new Date(candle.start).toISOString(),[candle.openMicro,candle.highMicro,candle.lowMicro,candle.closeMicro].map(price=>display(price)).join(' / '),display(BigInt(candle.volumeMicro)),candle.trades.map(t=>`${t.id}: ${t.sourceDigest}`).join('\n')].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell)});records.append(row);
  }
  $('#last-price').textContent=`${display(trades.at(-1).priceMicro)} YUSD_TEST`;
}

async function reviewOrder(event){
  event.preventDefault();const button=$('#review-order');if(button.disabled)return;button.disabled=true;
  try{
    // One public read refreshes rules. This does not create a preview on the
    // server, request an account, sign, or submit an order.
    await marketFeed.retry();const value=preview(),root=$('#order-preview-values');root.replaceChildren();
    const available=state.privatePhase==='connected'?state.snapshot?.balances.find(b=>b.asset===value.reservationAsset):null;
    const rows=[['Side / type',`${value.side} / limit`],['Limit price',`${display(value.priceMicro)} YUSD_TEST`],['Amount',`${display(value.amountMicro)} YNXT`],['Notional at limit',`${display(value.notionalMicro)} YUSD_TEST`],['Single-fill maker fee',`${display(value.makerFeeMicro)} YUSD_TEST`],['Single-fill taker fee',`${display(value.takerFeeMicro)} YUSD_TEST`],['Initial reservation',`${display(value.initialReservationMicro)} ${value.reservationAsset}`],['Available venue balance',available?`${display(available.availableMicro)} ${value.reservationAsset} at last account read; not reserved`:'Unknown — Exchange account proof required'],['Wallet state',state.standardWallet?.status==='standard-connected'?'Standard connection only; not Exchange order authority':'Not connected; guest preview remains available'],['Rule source',`${value.sourceStatus} · ${new Date(value.rulesObservedAt).toLocaleString()}`]];
    for(const [label,text] of rows){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');if(window.YNXExchangeLocale){window.YNXExchangeLocale.write(dt,label);if(label==='Available venue balance'&&available)window.YNXExchangeLocale.write(dd,'balance-last-read',` · ${display(available.availableMicro)} ${value.reservationAsset}`);else if(label==='Wallet state'||(label==='Available venue balance'&&!available))window.YNXExchangeLocale.write(dd,text);else dd.textContent=text}else{dt.textContent=label;dd.textContent=text}row.append(dt,dd);root.append(row)}
    $('#order-preview-dialog').showModal();
  }catch(error){if(!window.YNXExchangeLocale?.error($('#order-error'),error))$('#order-error').textContent=error.message;toast(error)}finally{button.disabled=false}
}
function cancelOrder(){requireProductSession()}
async function observeDeposit(event){event.preventDefault();requireProductSession()}
function reviewWithdrawal(event){event.preventDefault();requireProductSession()}
async function saveSecurity(event){event.preventDefault();requireProductSession()}
async function openSupport(event){event.preventDefault();requireProductSession()}
async function requestAI(){renderAIState();requireProductSession()}
function renderAIState(){const root=$('#ai-result');window.YNXExchangeLocale?.forget(root);root.replaceChildren();const message=document.createElement('p'),error=productApiUnavailable();message.textContent=error.message;window.YNXExchangeLocale?.error(message,error);root.append(message)}
boot();
