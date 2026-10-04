const state={connected:false,overview:null,statement:null,statementError:false,aiJob:null,aiTimer:null,context:0,brokerAssets:new Map(),brokerWatchlist:new Map(),brokerSelectedAsset:null,brokerSubmissionEnabled:false};
// Legacy v1 Wallet returns contain the signed order proof in the URL. Capture
// only for this page lifetime and scrub the address bar before async work or
// any account request. New orders must move to the opaque v2 code transport.
let pendingLegacyBrokerReturnURL=null;
let pendingOpaqueBrokerReturnURL=null;
function captureLegacyBrokerCallback(){
  if(location.pathname==='/wallet-auth/callback'&&location.search.includes('financeOrderCode=')){
    pendingOpaqueBrokerReturnURL=location.href;
    history.replaceState(null,'','/wallet-auth/callback');
    return;
  }
  if(location.pathname==='/wallet-auth/callback'&&location.search.includes('financeOrderApprovalResult=')){
    pendingLegacyBrokerReturnURL=location.href;
    history.replaceState(null,'','/wallet-auth/callback');
  }
}
captureLegacyBrokerCallback();
const financeText=(key)=>window.YNXFinanceLocale?.text(key)??key;
let walletIdentityState='identityUnverified',walletIdentityBusy=false;
let browserIdentityLogoutPending=null,browserSSOFinite=false,browserSSOClockOffset=0,browserSSOIntentGeneration=0;
let browserIdentity=null,browserSSOEnabled=false,browserSSORevision=0,browserIdentitySilentAttempted=false,browserIdentityExplicitIntent=false,browserIdentityRestoreDeferred=false;
let browserSSOChannel;try{browserSSOChannel=new BroadcastChannel('ynx.finance.browser-session.recheck.v1');browserSSOChannel.onmessage=()=>void recheckBrowserIdentity();}catch{}
async function browserSSOFetch(path,options={}){
  const controller=new AbortController();let timer;
  const invalid=()=>Object.assign(new Error('Browser identity response is invalid.'),{code:'BROWSER_SSO_RESPONSE_INVALID'});
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Object.assign(new Error('Browser identity request timed out.'),{code:'BROWSER_SSO_REQUEST_TIMEOUT'}));controller.abort()},5000)});
  try{return await Promise.race([deadline,(async()=>{
    const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    const length=response.headers.get('content-length');
    if(!/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(mime)||(length!==null&&(!/^\d+$/.test(length)||Number(length)>262144)))throw invalid();
    const text=await response.text();if(new TextEncoder().encode(text).byteLength>262144)throw invalid();
    let data;try{data=JSON.parse(text)}catch{throw invalid()}
    if(!data||typeof data!=='object'||Array.isArray(data))throw invalid();
    return {response,data};
  })()])}finally{clearTimeout(timer)}
}
function browserWalletMismatch(){return !!browserIdentity&&!!window.YNXFinanceWallet?.getStandardWalletState?.()?.account&&!window.YNXFinanceWallet.browserIdentityMatchesSelected(browserIdentity.account);}
function renderBrowserWalletIdentity(){
 const mismatch=browserWalletMismatch(),selected=window.YNXFinanceWallet?.getStandardWalletState?.();
 const signIn=$('#browser-signin-start');if(signIn)signIn.hidden=!!browserIdentity||!!browserIdentityLogoutPending;
 const walletButton=$('#wallet-entry');if(walletButton)walletButton.textContent=financeText(mismatch?'walletChooseMatching':selected?.status==='connected'?'walletManageConnection':'connect');
 const status=$('#browser-signin-state');if(status&&!browserIdentity)delete status.dataset.identityState;if(status&&browserIdentity){status.textContent=mismatch?financeText('walletIdentityMismatch')+' · '+browserIdentity.account+' / '+selected.account:browserIdentity.account;status.dataset.identityState=mismatch?'account-mismatch':'signed-in';}
 if(mismatch){clearLoginIntent();clearPrivateView({clearOpaquePending:false});}
 return !mismatch;
}
async function recheckBrowserIdentity(){
  if(!browserSSOEnabled||browserIdentityLogoutPending)return;const revision=++browserSSORevision;
  try{const {response,data}=await browserSSOFetch('/api/sso/account');if(revision!==browserSSORevision)return;
    if(response.ok){const previous=browserIdentity;browserIdentity=data;
 if(Number.isFinite(Date.parse(data.serverNow)))browserSSOClockOffset=Date.parse(data.serverNow)-Date.now();
      const native=window.YNXFinanceWallet?.session()?.account;
      if(previous&&previous.account!==data.account||native&&native!==data.account){++browserSSOIntentGeneration;clearLoginIntent();clearPrivateView();void window.YNXFinanceWallet.disconnect();}
      $('#browser-signin-state').textContent=data.account;$('#browser-signin-logout').hidden=false;renderBrowserWalletIdentity();
    }else if(response.status===401||response.status===403){const wasSignedIn=!!browserIdentity;if(browserIdentity){++browserSSOIntentGeneration;clearLoginIntent();clearPrivateView();void window.YNXFinanceWallet.disconnect();}browserIdentity=null;renderBrowserWalletIdentity();$('#browser-signin-state').textContent=financeText('browserSignInBoundary');$('#browser-signin-logout').hidden=true;if(!wasSignedIn&&data.silentRestoreAllowed!==false)await restoreBrowserIdentityQuietly();
     }else if(data.revocationPending===true&&typeof data.csrfToken==='string') {
 ++browserSSOIntentGeneration;browserIdentity=null;browserIdentityLogoutPending={csrfToken:data.csrfToken};browserIdentityExplicitIntent=true;clearLoginIntent();clearPrivateView();renderBrowserWalletIdentity();$('#browser-signin-logout').hidden=false;$('#browser-signin-state').textContent=financeText('privateLogoutUnconfirmed');
 }else $('#browser-signin-state').textContent=financeText('connectionUnavailable');
  }catch{if(revision===browserSSORevision)$('#browser-signin-state').textContent=financeText('connectionUnavailable');}
}
async function restoreBrowserIdentityQuietly(){
  const context=state.context,revision=browserSSORevision;
  if(browserIdentityLogoutPending||browserIdentityExplicitIntent||browserIdentitySilentAttempted){browserIdentityRestoreDeferred=false;return;}
  if(walletIdentityBusy||loginIntent||['checking','connecting'].includes(window.YNXFinanceWallet?.getPrivateState?.()?.status)){browserIdentityRestoreDeferred=true;return;}
  const {response,data}=await browserSSOFetch('/api/sso/config');
  if(browserIdentityExplicitIntent||!response.ok||data.enabled!==true||data.silentRestoreAllowed!==true||browserIdentity){browserIdentityRestoreDeferred=false;return;}
  if(revision!==browserSSORevision)return; // A newer identity recheck owns its result.
  if(context!==state.context||walletIdentityBusy||loginIntent||['checking','connecting'].includes(window.YNXFinanceWallet?.getPrivateState?.()?.status)){browserIdentityRestoreDeferred=true;resumeDeferredBrowserIdentity();return;}
  browserIdentityRestoreDeferred=false;browserIdentitySilentAttempted=true;location.assign(`/sso/start?prompt=none&target=${encodeURIComponent(loginTarget())}`);
}
function resumeDeferredBrowserIdentity(){if(!browserIdentityRestoreDeferred||!browserSSOEnabled||browserIdentity||browserIdentityExplicitIntent||browserIdentitySilentAttempted||walletIdentityBusy||loginIntent||['checking','connecting'].includes(window.YNXFinanceWallet?.getPrivateState?.()?.status))return;browserIdentityRestoreDeferred=false;queueMicrotask(()=>void recheckBrowserIdentity());}
async function initializeBrowserIdentity(){try{const {response,data}=await browserSSOFetch('/api/sso/config');if(!response.ok||data.enabled!==true)return;browserSSOEnabled=true;browserSSOFinite=data.finiteRenewalEnabled===true;$('#browser-signin').hidden=false;await recheckBrowserIdentity();}catch{}}
function renderWalletIdentity(){const status=document.querySelector('#wallet-login-state'),button=document.querySelector('#wallet-login-verify');if(status)status.textContent=financeText(walletIdentityState);if(button){button.hidden=!['connected','selection-pending'].includes(window.YNXFinanceWallet?.getStandardWalletState?.()?.status);button.disabled=walletIdentityBusy;}}
void window.YNXFinanceWallet.ready.then(()=>renderWalletIdentity());
let brokerConfigurationState='brokerStatusMissing';
function renderBrokerConfigurationStatus(){const target=document.querySelector('#broker-status');if(target)target.textContent=financeText(brokerConfigurationState)}
let brokerDiagnosticsState={approval:false,journal:false};
function renderBrokerDiagnostics(){const approval=document.querySelector('#broker-approval'),journal=document.querySelector('#broker-journal');if(approval)approval.textContent=financeText(brokerDiagnosticsState.approval?'brokerApprovalAvailable':'brokerApprovalUnavailable');if(journal)journal.textContent=financeText(brokerDiagnosticsState.journal?'brokerJournalAvailable':'brokerJournalUnavailable')}
document.addEventListener('finance:localechange',()=>{renderBrokerConfigurationStatus();renderBrokerDiagnostics();renderWalletIdentity();renderBrokerSnapshot();renderSourceStatus();renderBrokerQuote();renderBrokerWorkspace(brokerWorkspaceDisplay);if(brokerApprovalDisplay)renderBrokerApprovalRoute(brokerApprovalDisplay.route,brokerApprovalDisplay.recovered);else if(brokerApprovalMessageKey)$('#broker-order-preview').textContent=financeText(brokerApprovalMessageKey);if(brokerAssetResults!==null)renderBrokerAssets(brokerAssetResults,brokerAssetSearchFailed);if(state.connected&&state.overview){const portfolio=state.overview.portfolio;$('#balance-source').textContent=portfolio.explorerStatus.available?`${financeText('explorerEvidence')} · ${date(portfolio.asOf)}`:financeText('sourcesUnavailable');if(!portfolio.explorerStatus.available){$('#balance').textContent=financeText('unavailable');$('#staked').textContent=financeText('unavailable')}renderAlerts(state.overview.alerts);renderActivity(portfolio.activity,portfolio.explorerStatus);renderReceipts(portfolio.payReceipts,portfolio.payStatus);renderPlanning(state.overview.profile,state.overview.budgetProgress);renderAIRecords(portfolio.activity);renderSupport(state.overview.support);if(state.statement)renderStatement(state.statement);else if(state.statementError)$('#statement').textContent=financeText('unavailable');if(state.aiJob)renderAIJob()}const deleteButton=document.querySelector('[data-ai=delete]');if(deleteButton)deleteButton.textContent=financeText('aiDeleteDraftData');if(!state.connected)route()});
// Guest-readable diagnostics only. This never requests a Wallet account, signs,
// reads broker credentials or automatically enables order submission.
let brokerCheckRevision=0;
async function refreshBrokerConfiguration(){
  if(typeof fetch!=='function'||typeof AbortController!=='function')return;
  const revision=++brokerCheckRevision;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch('/api/broker/status',{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
    if(!response.ok)throw new Error('unavailable');
    const result=await response.json();
    if(result.schema!=='ynx-finance-broker-status-v1'||result.status?.tradingEnvironment!=='sandbox'||result.status?.chainEnvironment!=='testnet'||typeof result.status?.enabled!=='boolean'||typeof result.status?.submissionEnabled!=='boolean')throw new Error('invalid');
    if(revision!==brokerCheckRevision)return;
	state.brokerSubmissionEnabled=result.status.submissionEnabled;
    brokerConfigurationState=!result.status.enabled?'brokerDisabled':result.status.state==='CONFIGURED_NOT_VERIFIED'?'brokerConfigured':'brokerDisconnected';renderBrokerConfigurationStatus();
	brokerDiagnosticsState={approval:result.walletOrderApproval==='frozen_contract_with_owner_scoped_execution_request',journal:result.durableOrderJournal==='implemented_state_v2'};renderBrokerDiagnostics();
    route();
	  }catch{
	state.brokerSubmissionEnabled=false;
    if(revision===brokerCheckRevision){brokerConfigurationState='brokerCheckUnavailable';brokerDiagnosticsState={approval:false,journal:false};renderBrokerConfigurationStatus();renderBrokerDiagnostics()}
  }finally{clearTimeout(timer)}
}
let brokerSnapshotState={kind:'guest'};
function renderBrokerSnapshot(){
  const snapshot=brokerSnapshotState.kind==='data'?brokerSnapshotState.snapshot:null;
  $('#broker-sandbox').classList.toggle('broker-unlinked',!snapshot);
  const hasSavedOrders=Array.isArray(brokerWorkspaceDisplay?.orders)&&brokerWorkspaceDisplay.orders.length>0;
  $('#broker-sandbox').classList.toggle('broker-no-trading',!snapshot&&!brokerApprovalDisplay&&!hasSavedOrders);
  let connect=$('#broker-connect-action');
  if(!connect){connect=document.createElement('a');connect.id='broker-connect-action';connect.className='button primary';connect.href='#wallet-connect';$('#broker-private-status').insertAdjacentElement('afterend',connect)}
  connect.textContent=financeText('brokerConnectAction');connect.hidden=Boolean(snapshot);
  if(!snapshot){
    $('#broker-account').textContent=financeText('brokerNotLinked');$('#broker-cash').textContent=financeText('brokerUnknownNotZero');$('#broker-buying-power').textContent=financeText('brokerUnknownNotZero');
    $('#broker-private-status').textContent=financeText(brokerSnapshotState.kind==='unavailable'?'brokerSnapshotUnavailable':'brokerPrivate');
    $('#broker-positions').innerHTML=`<div class="empty compact">${esc(financeText('brokerNoProviderResult'))}</div>`;$('#broker-orders').innerHTML=`<div class="empty compact">${esc(financeText('brokerNoProviderResult'))}</div>`;return;
  }
  $('#broker-account').textContent=`${financeText('brokerLinked')} · ${short(snapshot.account.providerAccountId)}`;
  $('#broker-cash').textContent=`${snapshot.account.cash} ${financeText('brokerSimulatedUSD')}`;
  $('#broker-buying-power').textContent=`${snapshot.account.buyingPower} ${financeText('brokerSimulatedUSD')}`;
  $('#broker-private-status').textContent=financeText('brokerOwnerRead');
  $('#broker-positions').innerHTML=snapshot.positions.length?snapshot.positions.map(position=>`<div class="row"><div class="row-main"><strong>${esc(position.symbol)}</strong><small>${esc(position.qty)} ${esc(financeText('brokerShares'))} · ${esc(financeText('brokerAvailable'))} ${esc(position.availableQty)}</small></div><div class="row-value">${esc(position.marketValue)} ${esc(financeText('brokerSimulatedUSD'))}<small>${esc(financeText('brokerAverage'))} ${esc(position.averageEntryPrice)}</small></div></div>`).join(''):`<div class="empty compact">${esc(financeText('brokerNoPositions'))}</div>`;
  $('#broker-orders').innerHTML=snapshot.orders.length?snapshot.orders.map(order=>`<div class="row"><div class="row-main"><strong>${esc(order.side)} ${esc(order.qty)} ${esc(order.symbol)}</strong><small>${esc(order.type)} · ${esc(order.timeInForce)} · ${esc(order.providerStatus)}</small></div><div class="row-value">${order.limitPrice?`${esc(order.limitPrice)} ${esc(financeText('brokerSimulatedUSD'))}`:esc(financeText('brokerNoLimitPrice'))}<small>${esc(short(order.providerOrderId))}</small></div></div>`).join(''):`<div class="empty compact">${esc(financeText('brokerNoOrders'))}</div>`;
}
function selectBrokerAsset(asset){
  if(!asset||!/^[0-9a-f-]{36}$/.test(String(asset.id||''))||!/^[A-Z][A-Z0-9.]{0,11}$/.test(String(asset.symbol||'')))throw new Error(financeText('brokerSelectAssetFirst'));
  brokerQuoteRevision++;brokerQuoteController?.abort();brokerQuoteDisplay={kind:'none'};renderBrokerQuote();
  state.brokerSelectedAsset=asset;const form=$('#broker-order-form');form.elements.assetId.value=asset.id;form.elements.symbol.value=asset.symbol;
  $('#broker-order-preview').textContent=`${financeText('brokerAssetSelected')} ${asset.symbol} · ${asset.name}. ${financeText('brokerNoWrite')}`;
}
let brokerAssetResults=null,brokerAssetSearchFailed=false,brokerAssetSearchRevision=0,brokerAssetSearchController=null;
function renderBrokerAssets(assets,failed=false){
  brokerAssetResults=assets;
  brokerAssetSearchFailed=failed;
  state.brokerAssets=new Map(assets.map(asset=>[asset.id,asset]));
  $('#broker-asset-results').innerHTML=failed?`<div class="empty compact">${esc(financeText('brokerAssetsUnavailable'))}</div>`:assets.length?assets.map(asset=>`<div class="row"><div class="row-main"><strong>${esc(asset.symbol)}</strong><small>${esc(asset.name)} · ${esc(financeText('brokerActiveAsset'))}</small></div><div class="wallet-choice"><button type="button" data-broker-select="${esc(asset.id)}">${esc(financeText('brokerSelect'))}</button>${state.connected?`<button type="button" data-broker-watch="${esc(asset.id)}">${esc(financeText('brokerAddWatch'))}</button>`:''}</div></div>`).join(''):`<div class="empty compact">${esc(financeText('brokerNoAssets'))}</div>`;
}
async function searchBrokerAssets(event){
  event?.preventDefault();const query=String(new FormData($('#broker-asset-search')).get('query')||'').trim();
  const revision=++brokerAssetSearchRevision,context=state.context;
  brokerAssetSearchController?.abort();const controller=new AbortController();brokerAssetSearchController=controller;
  const timer=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(`/api/broker/assets?query=${encodeURIComponent(query)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),result=await response.json();if(!response.ok||result?.schema!=='ynx-finance-broker-assets-v1'||!Array.isArray(result.assets))throw new Error('Sandbox asset directory is unavailable.');if(revision===brokerAssetSearchRevision&&context===state.context)renderBrokerAssets(result.assets)}catch{if(revision===brokerAssetSearchRevision&&context===state.context){state.brokerSelectedAsset=null;const form=$('#broker-order-form');form.elements.assetId.value='';form.elements.symbol.value='';brokerQuoteRevision++;brokerQuoteController?.abort();brokerQuoteDisplay={kind:'none'};renderBrokerQuote();renderBrokerAssets([],true);if(!brokerApprovalDisplay)$('#broker-order-preview').textContent=financeText('brokerNoApproval');notify(financeText('brokerAssetsUnavailable'),true)}}finally{clearTimeout(timer);if(revision===brokerAssetSearchRevision)brokerAssetSearchController=null}
}
function renderBrokerWatchlist(items){
  const list=Array.isArray(items)?items:[];
  state.brokerWatchlist=new Map(list.map(item=>[item.assetId,item]));
  $('#broker-watchlist').innerHTML=list.length?list.map(item=>`<div class="row"><div class="row-main"><strong>${esc(item.symbol)}</strong><small>${esc(item.name)}</small></div><div class="wallet-choice"><button type="button" data-broker-watch-select="${esc(item.assetId)}">${esc(financeText('brokerSelect'))}</button><button type="button" class="ghost" data-broker-unwatch="${esc(item.assetId)}">${esc(financeText('brokerRemove'))}</button></div></div>`).join(''):`<div class="empty compact">${esc(financeText(state.connected?'brokerWatchlistEmpty':'brokerWatchlistGuest'))}</div>`;
}
async function updateBrokerWatchlist(asset,selected){
  if(!state.connected)throw new Error(financeText('brokerWatchlistSignIn'));
  const result=await api('/api/broker/watchlist',{method:'PUT',body:JSON.stringify({assetId:asset.id||asset.assetId,selected})});
  if(result?.schema!=='ynx-finance-broker-watchlist-v1'||result.providerWriteAttempted!==false)throw new Error(financeText('brokerWatchlistInvalid'));
  renderBrokerWatchlist(result.watchlist);await refreshBrokerWorkspace();notify(financeText(selected?'watchlistAdded':'watchlistRemoved'));
}
let brokerSnapshotRevision=0;
// Read-only display boundary: preserve the provider's exact decimal strings.
function readableBrokerSnapshot(snapshot){
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const text=value=>typeof value==='string'&&value.length>0;
  const decimal=value=>typeof value==='string'&&/^-?(?:0|[1-9][0-9]{0,31})(?:\.[0-9]{1,18})?$/.test(value);
  return record(snapshot)&&snapshot.provider==='alpaca_broker'&&snapshot.environment==='sandbox'&&record(snapshot.account)&&snapshot.account.currency==='USD'&&text(snapshot.account.providerAccountId)&&decimal(snapshot.account.cash)&&decimal(snapshot.account.buyingPower)&&
    Array.isArray(snapshot.positions)&&snapshot.positions.every(row=>record(row)&&text(row.symbol)&&['qty','availableQty','marketValue','averageEntryPrice'].every(key=>decimal(row[key])))&&
    Array.isArray(snapshot.orders)&&snapshot.orders.every(row=>record(row)&&['providerOrderId','symbol','type','timeInForce','providerStatus'].every(key=>text(row[key]))&&(row.side==='buy'||row.side==='sell')&&decimal(row.qty)&&(row.limitPrice===''||decimal(row.limitPrice)));
}
async function refreshBrokerSnapshot(){
  const revision=++brokerSnapshotRevision,context=state.context;
  const current=()=>revision===brokerSnapshotRevision&&context===state.context&&state.connected;
  if(!state.connected){brokerSnapshotState={kind:'guest'};renderBrokerSnapshot();return}
  try{
    const result=await api('/api/broker/snapshot');
    if(!current())return;
    const snapshot=result?.schema==='ynx-finance-broker-snapshot-v1'?result.snapshot:null;
    if(!readableBrokerSnapshot(snapshot))throw Object.assign(new Error('Broker Sandbox returned an invalid account snapshot.'),{nonRetryable:true});
    brokerSnapshotState={kind:'data',snapshot};renderBrokerSnapshot();
  }catch(error){
    if(!current())return;
    brokerSnapshotState={kind:'unavailable'};renderBrokerSnapshot();
  }
}
let brokerCallbackInFlight=false,brokerApprovalInFlight=false;
let brokerApprovalDisplay=null,brokerApprovalMessageKey='brokerNoApproval';
const OPAQUE_ORDER_PENDING_KEY='ynx.finance.order-opaque.v2.pending';
function hideBrokerApproval(){brokerApprovalDisplay=null;brokerApprovalMessageKey='brokerNoApproval';const link=$('#broker-wallet-approve');link.hidden=true;delete link.dataset.walletReviewUrl;$('#broker-order-preview').textContent=financeText('brokerNoApproval')}
function reconcileOpaqueBrokerOwner(){
  const raw=sessionStorage.getItem(OPAQUE_ORDER_PENDING_KEY);if(!raw)return;
  let pending;try{pending=JSON.parse(raw)}catch{sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);hideBrokerApproval();return}
  if(pending?.account!==brokerOwnerAccount()){sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);hideBrokerApproval()}
}
function brokerOwnerAccount(){
  const owner=state.overview?.portfolio?.account,session=window.YNXFinanceWallet?.session?.();
  return state.connected&&owner&&session?.account===owner?owner:null;
}
function opaqueOrderPending(serverTime){
  const raw=sessionStorage.getItem(OPAQUE_ORDER_PENDING_KEY);if(!raw)return null;
  let pending;try{pending=JSON.parse(raw)}catch{sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);hideBrokerApproval();return null}
  if(pending?.version!=='2'||!window.YNXFinanceOpaqueOrder||pending.account!==brokerOwnerAccount()||
    !/^[A-Za-z0-9_-]{32,64}$/.test(pending.ticket||'')||
    !/^request_[0-9a-f-]{36}$/.test(pending.requestId||'')||!Number.isFinite(Date.parse(pending.expiresAt))){
    sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);hideBrokerApproval();return null;
  }
  if(Date.parse(serverTime)>=Date.parse(pending.expiresAt)){
    sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);return {expired:true,request:{unsigned:{requestId:pending.requestId,expiresAt:pending.expiresAt}}};
  }
  return {expired:false,approved:false,request:{unsigned:{requestId:pending.requestId,expiresAt:pending.expiresAt}},url:window.YNXFinanceOpaqueOrder.launchURL(pending.ticket)};
}
let brokerWorkspaceDisplay=null;
let brokerWorkspaceUnavailable=false;
function brokerWorkflowLabel(value){const key={buy:'brokerBuy',sell:'brokerSell',consumed:'brokerApprovalRecorded',approved:'brokerApprovalRecorded',rejected:'brokerApprovalRejected',revoked:'brokerApprovalRevoked',submitted:'brokerStateSubmitted',submitting:'brokerStateSubmitting',partially_filled:'brokerStatePartial',filled:'brokerStateFilled',cancel_requested:'brokerStateCancelRequested',cancelled:'brokerStateCancelled',pending_unwired:'brokerStateAwaitingActivation',execution_requested:'brokerStateExecutionRequested'}[value];return financeText(key||'brokerStateUnknown')}
// Go's zero time.Time is serialized despite omitempty. Only that exact server
// sentinel (or legacy absence) means no record; unknown values remain fenced.
function brokerCancellationRecorded(value){return value!==undefined&&value!==null&&value!==''&&value!=='0001-01-01T00:00:00Z'}
function renderBrokerWorkspace(workspace){
  brokerWorkspaceDisplay=workspace;
  renderBrokerSnapshot();
  const orders=Array.isArray(workspace?.orders)?workspace.orders:[];
  const outbox=new Map((Array.isArray(workspace?.outbox)?workspace.outbox:[]).map(item=>[item.orderId,item]));
  $('#broker-local-orders').innerHTML=brokerWorkspaceUnavailable?`<div class="empty compact">${esc(financeText('brokerLocalOrdersUnavailable'))}</div>`:orders.length?orders.map(record=>{
    const queued=outbox.get(record.order.orderId),attempted=brokerCancellationRecorded(record.cancelAttemptedAt);
    const cancelable=['submitted','partially_filled'].includes(record.state)&&!attempted;
    const executable=state.brokerSubmissionEnabled&&record.approvalState==='consumed'&&queued?.status==='pending_unwired';
    const cancelState=attempted&&['cancel_requested','partially_filled'].includes(record.state)?'brokerCancelReconcile':record.state==='cancel_requested'?(brokerCancellationRecorded(record.cancelIntentAt)?'brokerCancelQueued':'brokerCancelLegacy'):null;
    const machine=[record.approvalState,record.state,queued?.status].filter(Boolean).join(' · ');
    return `<div class="row"><div class="row-main"><strong>${esc(brokerWorkflowLabel(record.order.side))} ${esc(record.order.qty)} ${esc(record.order.symbol)}</strong><small>${esc(brokerWorkflowLabel(record.approvalState))} · ${esc(brokerWorkflowLabel(record.state))} · ${esc(financeText('brokerRequest'))} ${esc(short(record.requestId))}</small><small>${queued?`${esc(brokerWorkflowLabel(queued.status))} · ${esc(financeText('brokerAttempts'))} ${esc(queued.attempts)}`:esc(financeText('brokerNoOutbox'))}</small>${cancelState?`<small>${esc(financeText(cancelState))}</small>`:''}<details class="order-machine-state"><summary>${esc(financeText('brokerTechnicalStatus'))}</summary><small>${esc(machine)}</small></details></div><div class="row-value">${esc(financeText('brokerMaximum'))} ${esc(record.order.maxCost)} ${esc(financeText('brokerSimulatedUSD'))}<div class="wallet-choice"><button type="button" data-broker-order-refresh="${esc(record.order.orderId)}">${esc(financeText('brokerRefresh'))}</button>${executable?`<button type="button" class="primary" data-broker-order-execute="${esc(record.order.orderId)}">${esc(financeText('brokerRequestExecution'))}</button>`:''}${cancelable?`<button type="button" class="danger" data-broker-order-cancel="${esc(record.order.orderId)}">${esc(financeText('brokerRequestCancel'))}</button>`:''}</div></div></div>`;
  }).join(''):`<div class="empty compact">${esc(financeText('brokerNoLocalOrders'))}</div>`;
  const journal=Array.isArray(workspace?.journal)?workspace.journal:[];
  $('#broker-events').innerHTML=brokerWorkspaceUnavailable?`<div class="empty compact">${esc(financeText('brokerLocalOrdersUnavailable'))}</div>`:journal.length?journal.slice().reverse().slice(0,30).map(item=>`<div class="row"><div class="row-main"><strong>${esc(financeText('brokerJournalEvent'))}</strong><small>${esc(date(item.createdAt))} · ${esc(short(item.orderId||item.requestId))}</small><details class="order-machine-state"><summary>${esc(financeText('brokerTechnicalStatus'))}</summary><small>${esc(item.action)}</small></details></div><div class="row-value">${esc(brokerWorkflowLabel(item.orderState))}<small>${esc(brokerWorkflowLabel(item.approvalState))}</small></div></div>`).join(''):`<div class="empty compact">${esc(financeText('brokerNoLocalEvents'))}</div>`;
  renderBrokerWatchlist(workspace?.watchlist);
}
function renderBrokerApprovalRoute(route,recovered=false){
  brokerApprovalDisplay={route,recovered};brokerApprovalMessageKey=null;
  const unsigned=route.request.unsigned,order=unsigned.order;
  $('#broker-order-preview').innerHTML=order?`<strong>${esc(brokerWorkflowLabel(order.side))} ${esc(order.qty)} ${esc(order.symbol)} @ ${esc(order.limitPrice)} ${esc(financeText('brokerSimulatedUSD'))}</strong><br>${esc(financeText('brokerPreviewMaximum'))}: ${esc(order.maxCost)} USD · ${esc(financeText('brokerPreviewFee'))} ${esc(order.maxFee)} USD · ${esc(financeText('brokerPreviewExpires'))} ${esc(date(unsigned.expiresAt))}<br><small>${esc(financeText('brokerPreviewRequest'))} ${esc(short(unsigned.requestId))}. ${esc(financeText(recovered?'brokerRecovered':'brokerProviderNotContacted'))}</small>`:
    `${esc(financeText('brokerConfidentialPending'))} · ${esc(financeText('brokerPreviewExpires'))} ${esc(date(unsigned.expiresAt))}. ${esc(financeText('brokerConfidentialNoStorage'))}`;
  const link=$('#broker-wallet-approve');link.hidden=false;link.rel='noreferrer';
  if(route.url.startsWith('ynxwallet://')){
    link.href='#';link.dataset.walletReviewUrl=route.url;link.textContent=financeText('brokerCopyReview');
  }else{link.href=route.url;delete link.dataset.walletReviewUrl;link.textContent=financeText(route.approved?'brokerReviewOrRevoke':'brokerReviewExact')}
}
async function restoreBrokerApproval(serverTime,{announce=false}={}){
  const opaque=opaqueOrderPending(serverTime);
  if(opaque){if(opaque.expired){brokerApprovalDisplay=null;brokerApprovalMessageKey='brokerTicketExpired';$('#broker-wallet-approve').hidden=true;$('#broker-order-preview').textContent=financeText('brokerTicketExpired');return opaque}
    renderBrokerApprovalRoute(opaque,true);if(announce)notify(financeText('brokerTicketStillActive'));return opaque}
  const legacyPending=window.YNXFinanceOrderWallet.pending();
  if(!legacyPending){hideBrokerApproval();return null}
  if(!brokerOwnerAccount()||legacyPending.request?.unsigned?.account!==brokerOwnerAccount()){
    window.YNXFinanceOrderWallet.clear();hideBrokerApproval();return null;
  }
  const route=await window.YNXFinanceOrderWallet.resume(serverTime);
  if(!route)return null;
  if(route.expired){brokerApprovalDisplay=null;brokerApprovalMessageKey='brokerLegacyExpired';$('#broker-wallet-approve').hidden=true;$('#broker-order-preview').textContent=financeText('brokerLegacyExpired');if(announce)notify(financeText('brokerLegacyExpiredNotice'));return route}
  renderBrokerApprovalRoute(route,true);if(announce)notify(financeText('brokerLegacyActive'));return route
}
async function requireBrokerOrderAuthority(){
  try{return await window.YNXFinanceOrderWallet.assertAuthority()}
  catch(error){
    state.brokerSubmissionEnabled=false;
    $('#broker-approval').textContent='Wallet Gateway and Finance Product Session are not yet verified by the shared endpoint authority. Order approval and submission are unavailable; public Finance views remain available.';
    brokerApprovalDisplay=null;brokerApprovalMessageKey='brokerAuthorityUnavailable';
    $('#broker-order-preview').textContent=financeText('brokerAuthorityUnavailable');
    const link=$('#broker-wallet-approve');link.hidden=true;delete link.dataset.walletReviewUrl;
    throw error;
  }
}
async function requestBrokerExecution(orderId){
  try{await requireBrokerOrderAuthority();if(!state.brokerSubmissionEnabled)throw new Error('Controlled Sandbox execution is disabled by server policy.');if(!window.confirm(financeText('brokerExecutionConfirm')))return;const idempotencyKey=`finance-execution-${orderId}`,result=await api(`/api/broker/orders/${encodeURIComponent(orderId)}/execution-request`,{method:'POST',body:JSON.stringify({idempotencyKey})});if(result?.schema!=='ynx-finance-broker-execution-request-v1'||result.providerWriteAttempted!==false)throw new Error('Execution request response is invalid.');notify(`${financeText('brokerStateExecutionRequested')}. ${financeText('brokerExecutionQueuedNotConfirmed')}`);await refreshBrokerWorkspace()}catch(error){notifyFailure(error,'brokerApprovalUnavailable')}
}
async function refreshBrokerExecutionStatus(orderId){
  try{
    const result=await api(`/api/broker/orders/${encodeURIComponent(orderId)}/execution-status`),outbox=result?.outbox;
    if(result?.schema!=='ynx-finance-broker-execution-status-v1'||result.providerWriteAttempted!==false||outbox?.orderId!==orderId||typeof outbox.status!=='string')throw new Error('Execution status response is invalid.');
    notify(window.YNXFinanceLocale?.get()==='en'?`Execution status: ${outbox.status}. ${financeText('brokerStatusReadOnly')}`:`${financeText('brokerExecutionStatus')}: ${brokerWorkflowLabel(outbox.status)}. ${financeText('brokerStatusReadOnly')}`);
    await refreshBrokerWorkspace();
  }catch(error){notifyFailure(error,'brokerJournalUnavailable')}
}
let brokerWorkspaceRevision=0;
async function refreshBrokerWorkspace(){
  const revision=++brokerWorkspaceRevision,context=state.context;
  const current=()=>revision===brokerWorkspaceRevision&&context===state.context&&state.connected;
  if(!state.connected){brokerWorkspaceUnavailable=false;renderBrokerWorkspace(null);return null}
  try{const result=await api('/api/broker/orders');if(!current())return null;if(result?.schema!=='ynx-finance-broker-workspace-v1'||typeof result.workspace?.serverTime!=='string')throw new Error('Broker workspace response is invalid.');brokerWorkspaceUnavailable=false;renderBrokerWorkspace(result.workspace);return result.workspace}catch{if(current()){brokerWorkspaceUnavailable=true;renderBrokerWorkspace(null)}return null}
}
async function createBrokerApproval(event){
  event.preventDefault();
  if(brokerApprovalInFlight){notify(financeText('brokerLegacyActive'),true);return}
  brokerApprovalInFlight=true;
  const submit=event.currentTarget.querySelector('button[type="submit"],button:not([type])'),wasDisabled=submit?.disabled===true;
  if(submit){submit.disabled=true;submit.setAttribute('aria-busy','true')}
  const form=new FormData(event.currentTarget),draft={assetId:String(form.get('assetId')||''),symbol:String(form.get('symbol')||'').toUpperCase(),side:String(form.get('side')||''),qty:String(form.get('qty')||''),limitPrice:String(form.get('limitPrice')||'')};
  try{
    await requireBrokerOrderAuthority();
    const workspace=await refreshBrokerWorkspace();if(!workspace)throw new Error('Current Finance server time is unavailable.');
    const existing=await restoreBrokerApproval(workspace.serverTime,{announce:true});if(existing&&!existing.expired)return;
    if(!state.brokerSelectedAsset||state.brokerSelectedAsset.id!==draft.assetId||state.brokerSelectedAsset.symbol!==draft.symbol)throw new Error('Select this asset from the provider-backed search results before creating approval.');
    if(!window.YNXFinanceOpaqueOrder)throw new Error('Confidential Wallet order builder is unavailable. No order request was created.');
    const result=await api('/api/broker/order-handoff/issue',{method:'POST',body:JSON.stringify({draft})});
    if(result?.version!=='2'||result.providerWriteAttempted!==false||!/^[A-Za-z0-9_-]{32,64}$/.test(result.ticket||'')||
      !/^request_[0-9a-f-]{36}$/.test(result.challenge?.requestId||''))throw new Error('Confidential Finance order challenge response is invalid.');
    const owner=brokerOwnerAccount();if(!owner||result.challenge.account!==owner)throw new Error('Confidential challenge owner differs from the active Finance session.');
    const route={request:{unsigned:result.challenge},url:window.YNXFinanceOpaqueOrder.launchURL(result.ticket),approved:false};
    sessionStorage.setItem(OPAQUE_ORDER_PENDING_KEY,JSON.stringify({version:'2',ticket:result.ticket,account:owner,requestId:result.challenge.requestId,expiresAt:result.challenge.expiresAt}));
    renderBrokerApprovalRoute(route);notify(`${financeText('brokerCopyReview')}. ${financeText('brokerProviderNotContacted')}`);await refreshBrokerWorkspace();
  }catch(error){notifyFailure(error,'brokerApprovalUnavailable')}finally{brokerApprovalInFlight=false;if(submit){submit.disabled=wasDisabled;submit.removeAttribute('aria-busy')}}
}
async function reconcileBroker(){
  if(!state.connected){notify(financeText('brokerPrivate'),true);return}
  if(!window.confirm(financeText('brokerReconcileConfirm')))return;
  try{const result=await api('/api/broker/reconcile',{method:'POST',body:'{}'});if(result?.schema!=='ynx-finance-broker-reconcile-v1'||result.providerWriteAttempted!==false)throw new Error('Broker reconcile response is invalid.');brokerWorkspaceUnavailable=false;renderBrokerWorkspace(result.workspace);await refreshBrokerSnapshot();notify(financeText('brokerReconcileSuccess'))}catch{notify(financeText('brokerReconcileUnavailable'),true)}
}
async function requestBrokerCancel(orderId){
  if(!window.confirm(financeText('brokerCancelConfirm')))return;
  try{const result=await api(`/api/broker/orders/${encodeURIComponent(orderId)}/cancel-request`,{method:'POST',body:'{}'});if(result?.schema!=='ynx-finance-broker-cancel-request-v1'||result.providerWriteAttempted!==false)throw new Error('Cancellation request response is invalid.');notify(financeText('brokerCancelRecorded'));await refreshBrokerWorkspace()}catch{notify(financeText('brokerCancelUnavailable'),true)}
}
async function refreshBrokerQuote(){
  const revision=++brokerQuoteRevision,context=state.context;brokerQuoteController?.abort();
  const symbol=String(new FormData($('#broker-order-form')).get('symbol')||'').toUpperCase();
  if(!state.brokerSelectedAsset||state.brokerSelectedAsset.symbol!==symbol){brokerQuoteDisplay={kind:'unavailable'};renderBrokerQuote();return}
  const current=()=>revision===brokerQuoteRevision&&context===state.context&&state.brokerSelectedAsset?.symbol===symbol&&String(new FormData($('#broker-order-form')).get('symbol')||'').toUpperCase()===symbol;
  const controller=new AbortController();brokerQuoteController=controller;
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(`/api/broker/quote?symbol=${encodeURIComponent(symbol)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),result=await response.json(),quote=result?.quote;
    const decimal=/^-?(?:0|[1-9][0-9]{0,31})(?:\.[0-9]{1,18})?$/;
    if(!response.ok||result?.schema!=='ynx-finance-broker-quote-v1'||result.source!=='alpaca_market_data_sandbox'||result.officialSandboxVerified!==false||quote?.symbol!==symbol||!decimal.test(quote?.bidPrice||'')||!decimal.test(quote?.askPrice||'')||!['iex','sample'].includes(quote?.feed)||!['real_time','delayed','stale','sample'].includes(result.quoteState)||!Number.isFinite(Date.parse(quote?.timestamp)))throw new Error('BROKER_QUOTE_UNVERIFIED');
    if(current()){brokerQuoteDisplay={kind:'data',quote,quoteState:result.quoteState};renderBrokerQuote()}
  }catch{if(current()){brokerQuoteDisplay={kind:'unavailable'};renderBrokerQuote()}}
  finally{clearTimeout(timer);if(revision===brokerQuoteRevision)brokerQuoteController=null}
}
let brokerQuoteRevision=0,brokerQuoteController=null,brokerQuoteDisplay={kind:'none'};
function renderBrokerQuote(){const target=$('#broker-quote-status');if(!target)return;if(brokerQuoteDisplay.kind!=='data'){target.textContent=financeText(brokerQuoteDisplay.kind==='unavailable'?'brokerQuoteUnavailable':'brokerQuoteNotRequested');return}const {quote,quoteState}=brokerQuoteDisplay;target.textContent=`${quote.symbol} · ${financeText('brokerBid')} ${quote.bidPrice} / ${financeText('brokerAsk')} ${quote.askPrice} ${financeText('brokerSimulatedUSD')} · ${quote.feed.toUpperCase()} · ${financeText(`brokerQuoteState_${quoteState}`)} · ${date(quote.timestamp)}. ${financeText('brokerQuoteNoAutofill')}`}
async function completeBrokerCallback(){
  captureLegacyBrokerCallback();
  if(brokerCallbackInFlight||!state.connected||location.pathname!=='/wallet-auth/callback'||(!pendingLegacyBrokerReturnURL&&!pendingOpaqueBrokerReturnURL))return;
  brokerCallbackInFlight=true;$('#broker-complete-callback').hidden=false;
  try{
    await requireBrokerOrderAuthority();
    if(pendingOpaqueBrokerReturnURL){
      const callback=new URL(pendingOpaqueBrokerReturnURL),keys=[...callback.searchParams.keys()];
      const code=callback.searchParams.get('financeOrderCode'),stateToken=callback.searchParams.get('state');
      if(callback.origin!==location.origin||callback.pathname!=='/wallet-auth/callback'||callback.hash||keys.join(',')!=='financeOrderCode,state'||
        !/^[A-Za-z0-9_-]{32,64}$/.test(code||'')||!/^[A-Za-z0-9_-]{32,64}$/.test(stateToken||'')||
        callback.href!==`${callback.origin}/wallet-auth/callback?financeOrderCode=${code}&state=${stateToken}`)throw new Error('Confidential Wallet callback URL is not canonical.');
      const result=await api('/api/broker/order-handoff/exchange',{method:'POST',body:JSON.stringify({code,state:stateToken})});
      if(result?.version!=='2'||!['approved','rejected','revoked'].includes(result.status)||result.result?.providerWriteAttempted!==false)throw new Error('Confidential Wallet decision response is invalid.');
      pendingOpaqueBrokerReturnURL=null;sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);history.replaceState(null,'','/');$('#broker-complete-callback').hidden=true;hideBrokerApproval();
      notify(`${brokerWorkflowLabel(result.status)}. ${financeText('brokerProviderNotContacted')}`);
      await refreshBrokerWorkspace();return;
    }
    const workspace=await refreshBrokerWorkspace();if(!workspace)throw new Error('Current Finance server time is unavailable.');
    const raw=await window.YNXFinanceOrderWallet.parseReturn(pendingLegacyBrokerReturnURL,workspace.serverTime);
    const result=await api('/api/broker/callback',{method:'POST',body:raw});
    if(result?.schema!=='ynx-finance-order-approval-consume-v1'||result.providerWriteAttempted!==false)throw new Error('Finance order callback response is invalid.');
    window.YNXFinanceOrderWallet.clear();pendingLegacyBrokerReturnURL=null;history.replaceState(null,'','/');hideBrokerApproval();$('#broker-complete-callback').hidden=true;notify(`${brokerWorkflowLabel(result.status)}. ${financeText('brokerProviderNotContacted')}`);await refreshBrokerWorkspace();
  }catch(error){notifyFailure(error,'brokerApprovalUnavailable')}finally{brokerCallbackInFlight=false}
}
const READ_RETRY_DELAYS=[0,600,1600];
const $=(s)=>document.querySelector(s),$$=(s)=>[...document.querySelectorAll(s)];
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=v=>Number.isSafeInteger(v)&&v>=0?new Intl.NumberFormat(window.YNXFinanceLocale?.get()||'en').format(v):financeText('unknown');
const short=(v)=>v?`${v.slice(0,8)}…${v.slice(-6)}`:'—';
function financeTimestampValid(value){
  if(typeof value!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value))return false;
  const calendar=new Date(value.slice(0,10)+'T00:00:00Z');
  return Number.isFinite(calendar.getTime())&&calendar.toISOString().slice(0,10)===value.slice(0,10)&&Number.isFinite(Date.parse(value));
}
const date=(v)=>financeTimestampValid(v)?new Intl.DateTimeFormat(window.YNXFinanceLocale?.get()||'en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):financeText('dateUnavailable');

const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
let sourceStatusState={key:'notConnected',className:'neutral',attempt:0,total:0};
function renderSourceStatus(){const {key,className,attempt,total}=sourceStatusState;$('#source-pill').textContent=key==='reconnecting'?`${financeText(key)} ${attempt}/${total}`:financeText(key);$('#source-pill').className=`pill ${className}`}
function sourceStatus(key,className='neutral',attempt=0,total=0){sourceStatusState={key,className,attempt,total};renderSourceStatus()}
async function publicHealth(){for(let attempt=0;attempt<READ_RETRY_DELAYS.length;attempt++){if(attempt){sourceStatus('reconnecting','warning',attempt,READ_RETRY_DELAYS.length-1);await wait(READ_RETRY_DELAYS[attempt])}try{const response=await fetch('/health',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000)}),body=await response.json();if(!response.ok||body.ok!==true||body.chainId!=='ynx_6423-1'||body.portfolio!=='read-only')throw Object.assign(new Error(`Finance health check failed (${response.status})`),{status:response.status});sourceStatus(state.connected?'privateFinanceReachable':'publicFinanceReachable','live');return body}catch(error){if(error?.status||attempt===READ_RETRY_DELAYS.length-1){sourceStatus('connectionUnavailable','warning');throw error}}}throw new Error('Public connection retry exhausted.')}
// Ordinary product response transport; proof generation remains in the shared
// Wallet adapter. Bound response parsing too, without ever replaying a write.
// Product documents must have one unambiguous value per decoded object key.
// This does not parse or replace Wallet/SSO authority messages.
function financeProductDocument(text){
  let cursor=0;
  const invalid=()=>{throw new Error('Ambiguous product document')};
  const whitespace=()=>{while(/[\t\n\r ]/.test(text[cursor]??'\0'))cursor++};
  const stringToken=()=>{
    const start=cursor++;
    while(cursor<text.length){if(text[cursor]==='\\'){cursor+=2;continue}if(text[cursor++]==='"')return text.slice(start,cursor)}
    invalid();
  };
  const scan=depth=>{
    if(depth>64)invalid();whitespace();
    if(text[cursor]==='"'){stringToken();return}
    if(text[cursor]==='{'||text[cursor]==='['){
      const object=text[cursor++]==='{',close=object?'}':']',keys=new Set();whitespace();
      if(text[cursor]===close){cursor++;return}
      while(cursor<text.length){
        if(object){if(text[cursor]!=='"')invalid();const key=JSON.parse(stringToken());if(keys.has(key))invalid();keys.add(key);whitespace();if(text[cursor++]!==':')invalid()}
        scan(depth+1);whitespace();if(text[cursor]===close){cursor++;return}if(text[cursor++]!==',')invalid();whitespace();
      }
      invalid();
    }
    const start=cursor;while(cursor<text.length&&!/[\t\n\r ,}\]]/.test(text[cursor]))cursor++;if(cursor===start)invalid();
  };
  scan(0);whitespace();if(cursor!==text.length)invalid();return JSON.parse(text);
}
async function financeProductResponse(path,options,assertCurrent,{fetchImpl=fetch,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  const controller=new AbortController();let rejectDeadline;
  const deadline=new Promise((_,reject)=>{rejectDeadline=reject});
  const timer=setTimer(()=>{rejectDeadline(Object.assign(new Error('FINANCE_REQUEST_TIMEOUT: Request outcome is unconfirmed.'),{code:'FINANCE_REQUEST_TIMEOUT'}));controller.abort()},10_000);
  const invalid=()=>Object.assign(new Error('FINANCE_RESPONSE_INVALID: The product response is not a verified document.'),{code:'FINANCE_RESPONSE_INVALID',nonRetryable:true});
  try{return await Promise.race([(async()=>{
    const response=await fetchImpl(path,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});assertCurrent();
    if(response.status===204)return {response,body:null};
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    // This endpoint acknowledges cancellation only; the job readback below
    // must still prove the exact requested job has actually been cancelled.
    const emptyAICancel=response.status===202&&options.method==='POST'&&/^\/api\/ai\/jobs\/[^/?#]+\/cancel$/.test(path);
    const exportDocument=options.responseType==='blob'&&response.ok;
    const expected=exportDocument&&new URL(path,location.href).searchParams.get('format')==='csv'?'text/csv':'application/json';
    const length=response.headers.get('content-length'),limit=emptyAICancel?0:8*1024*1024;
    if((!emptyAICancel&&mime!==expected)||(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>limit))){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{})}catch{}throw invalid()}
    let text;
    if(typeof response.body?.getReader==='function'){
      const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),parts=[];let bytes=0;
      const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{})}catch{}};
      controller.signal.addEventListener('abort',cancel,{once:true});
      try{
        while(true){
          assertCurrent();if(controller.signal.aborted)throw invalid();
          const chunk=await reader.read();assertCurrent();if(controller.signal.aborted)throw invalid();if(chunk.done)break;
          if(!Number.isSafeInteger(chunk.value?.byteLength)||chunk.value.byteLength<0||chunk.value.byteLength>limit-bytes)throw invalid();
          bytes+=chunk.value.byteLength;parts.push(decoder.decode(chunk.value,{stream:true}));
        }
        parts.push(decoder.decode());text=parts.join('');
      }catch(error){cancel();if(error?.nonRetryable)throw error;throw invalid()}
      finally{controller.signal.removeEventListener('abort',cancel);try{reader.releaseLock()}catch{}}
    }else{
      // Legacy controlled adapters only; native fetch uses the stream above.
      text=await response.text();
    }
    assertCurrent();
    if(emptyAICancel){if(text!=='')throw invalid();return {response,body:null}}
    if(new TextEncoder().encode(text).byteLength>8*1024*1024)throw invalid();
    let parsed;if(mime==='application/json'){try{parsed=financeProductDocument(text)}catch{throw invalid()}}
    return {response,body:exportDocument?new Blob([text],{type:mime}):parsed};
  })(),deadline])}finally{clearTimer(timer);controller.abort()}
}
async function api(path,options={}){
  const context=state.context,walletRevision=window.YNXFinanceWallet.getRevision();
  const assertCurrent=()=>{if(context!==state.context||walletRevision!==window.YNXFinanceWallet.getRevision())throw Object.assign(new Error('FINANCE_CONTEXT_CHANGED: Discarded a response from an older account or connection.'),{nonRetryable:true})};
  const method=String(options.method||'GET').toUpperCase(),readOnly=method==='GET',attempts=readOnly?READ_RETRY_DELAYS.length:1;
  for(let attempt=0;attempt<attempts;attempt++){
    if(attempt){sourceStatus('reconnecting','warning',attempt,attempts-1);await wait(READ_RETRY_DELAYS[attempt])}
    try{
      const headers={'Content-Type':'application/json',...(options.headers||{})};try{const authorization=await window.YNXFinanceWallet.requireProof(scope(path));assertCurrent();if(!authorization?.proofHeader||!authorization?.requestId)throw new Error('PRIVATE_SERVICE_DEGRADED: Fresh v2 proof is unavailable.');headers['X-YNX-Product-Session-Proof-V2']=authorization.proofHeader;headers['X-Request-ID']=authorization.requestId}catch(error){error.nonRetryable=true;throw error}
      const {response,body}=await financeProductResponse(path,{...options,method,headers},assertCurrent);assertCurrent();if(response.status===204){sourceStatus('privateFinanceReachable','live');return null}
      if(!response.ok){const error=new Error(body?.error||`Request failed (${response.status})`);error.code=body?.code;error.status=response.status;if(!readOnly||![502,503,504].includes(response.status)||attempt===attempts-1)throw error;continue}
      sourceStatus('privateFinanceReachable','live');return body
    }catch(error){if(!readOnly||error?.status||error?.nonRetryable||attempt===attempts-1){if(!error?.nonRetryable&&(!error?.status||[502,503,504].includes(error.status)))sourceStatus('connectionUnavailable','warning');throw error}}
  }
  throw new Error('Read connection retry exhausted.')
}
function scope(path){if(path.startsWith('/api/ai/'))return'finance.ai.draft';if(['/api/categories','/api/budgets','/api/reminders','/api/notes','/api/privacy','/api/account','/api/broker/challenges','/api/broker/callback','/api/broker/order-handoff/issue','/api/broker/order-handoff/exchange','/api/broker/watchlist','/api/broker/reconcile'].some(v=>path.startsWith(v))||/^\/api\/broker\/orders\/[^/]+\/(?:cancel-request|execution-request)$/.test(path)||path.includes('/category'))return'finance.profile.write';return'finance.portfolio.read'}
function notify(message,error=false){const box=$('#notice');box.textContent=message;box.classList.toggle('error',error);box.classList.remove('hidden');clearTimeout(box.timer);box.timer=setTimeout(()=>box.classList.add('hidden'),6500)}
function notifyFailure(error,key){
  const raw=String(error?.message||'');
  notify(window.YNXFinanceLocale?.get()==='en'?raw:financeText(key),true);
  const code=String(error?.code||raw.match(/^([A-Z][A-Z_0-9]+)(?::|$)/u)?.[1]||'');
  const box=$('#notice');if(code)box.dataset.diagnosticCode=code;else delete box.dataset.diagnosticCode;
}
function notifyKnownOrFailure(error,knownKeys,fallbackKey){
  const message=String(error?.message||'');
  if(knownKeys.some(key=>message===financeText(key)))notify(message,true);
  else notifyFailure(error,fallbackKey);
}

const LOGIN_INTENT_KEY='ynx.finance.login-intent.v1';
const LOGIN_ROUTES=new Set(['overview','assets','activity','planning','statements','assistant','settings','support','strategies']);
let loginIntent=null,loginOperation=null,pickerTrigger=null;
let pickerMethod=null,pickerPhase='pickerOpening',pickerCode='',pickerPending=null,pickerEpoch=0,pickerExpiry=null;
const pickerButtons={ynx:'#picker-ynx',mobile:'#picker-mobile',metamask:'#picker-metamask',hosted:'#picker-hosted'};
function clearPickerPair(){clearTimeout(pickerExpiry);pickerExpiry=null;$('#wallet-picker-qr').hidden=true;$('#wallet-picker-qr').removeAttribute('src');$('#wallet-picker-deeplink').hidden=true;$('#wallet-picker-deeplink').removeAttribute('href');}
function renderWalletPicker(){
  const selected=!!pickerMethod;$('#wallet-picker-choices').hidden=selected;$('#wallet-picker-step').hidden=!selected;$('#wallet-picker-intro').hidden=selected;
  if(!selected)return;
  $('#wallet-picker-selected').textContent=$(pickerButtons[pickerMethod]).querySelector('strong').textContent;
  const pairMessage=pickerCode==='YNX_PAIR_TRANSPORT_DRAINING'?'pairTransportDraining':/^YNX_PAIR_(RELAY|INITIALIZATION)_/.test(pickerCode)?'pairTransportUnavailable':pickerMethod==='mobile'&&pickerPhase==='pickerOpening'?'pairTransportWaiting':pickerPhase;
  $('#wallet-picker-state').textContent=financeText(pairMessage);
  $('#wallet-picker-hint').textContent=financeText(pickerPhase==='pickerConnected'?'pickerConnectedHint':pickerPhase==='pickerScan'?'pickerScan':'pickerIntro');
  const current=window.YNXFinanceWallet.getStandardWalletState();$('#wallet-picker-account').hidden=pickerPhase!=='pickerConnected';$('#wallet-picker-account').textContent=pickerPhase==='pickerConnected'?current.account??'':'';
  const terminal=['pickerConnected','pickerApproved','pickerRejected','pickerUnavailable','pickerExpired','pickerNetwork','pickerLocked','pickerCancelUnknown'].includes(pickerPhase);
  $('#wallet-picker-action').hidden=!terminal;$('#wallet-picker-action').textContent=financeText(['pickerConnected','pickerApproved'].includes(pickerPhase)?'pickerDone':'pickerRetry');
  $('#wallet-picker-back').disabled=pickerPhase==='pickerCancelling';$('#wallet-picker-details').hidden=!pickerCode;$('#wallet-picker-diagnostic').textContent=pickerCode;
}
function pickerFailure(code){
  pickerCode=/^[A-Z][A-Z_0-9]{0,80}$/.test(String(code))?String(code):'WALLET_UNAVAILABLE';
  pickerPhase=/YNX_PAIR_(?:RELAY|INITIALIZATION|TRANSPORT)/.test(pickerCode)?'pickerNetwork':code==='USER_REJECTED'||Number(code)===4001?'pickerRejected':/EXPIRED|TIMEOUT|DEADLINE/.test(pickerCode)?'pickerExpired':/LOCKED/.test(pickerCode)?'pickerLocked':/NOT_FOUND|UNAVAILABLE|NOT_INSTALLED/.test(pickerCode)?'pickerUnavailable':'pickerNetwork';clearPickerPair();renderWalletPicker();
}
function choosePickerMethod(method){
  if(pickerPending){$('#wallet-picker-state').focus();return pickerPending;}
  pickerMethod=method;pickerPhase='pickerOpening';pickerCode='';clearPickerPair();
  const icon=$(pickerButtons[method]).querySelector('img,svg');$('#wallet-picker-icon').replaceChildren(icon.cloneNode(true));renderWalletPicker();
  const epoch=++pickerEpoch,wallet=window.YNXFinanceWallet;
  const request=method==='ynx'?()=>wallet.connect():method==='metamask'?()=>wallet.connectMetaMask():method==='mobile'?()=>wallet.connectPair?.():()=>$('#connect-hosted-ynx').click();
  if(method==='mobile'&&!wallet.connectPair){pickerFailure('PAIR_UNAVAILABLE');return Promise.resolve(null);}
  pickerPhase=method==='mobile'?'pickerOpening':'pickerWaiting';renderWalletPicker();
  // Invoking the selected transport is a separate explicit action. Opening the
  // chooser itself never invokes accounts, signatures or the Hosted popup.
  const operation=Promise.resolve().then(request).catch(error=>{if(epoch===pickerEpoch)pickerFailure(error?.code??error?.message);}).finally(()=>{if(pickerPending===operation)pickerPending=null;});pickerPending=operation;return operation;
}
function loginTarget(){const requested=(location.hash||'#overview').slice(1);return LOGIN_ROUTES.has(requested)?requested:'planning'}
function clearLoginIntent(){loginIntent=null;try{sessionStorage.removeItem(LOGIN_INTENT_KEY)}catch{}}
function showWalletPicker(trigger,{login=false,target=loginTarget()}={}){
  browserIdentityExplicitIntent=true;browserIdentityRestoreDeferred=false;browserSSORevision++;
  if(loginOperation||window.YNXFinanceWallet.getStandardWalletState().status==='connecting'){
    if($('#wallet-picker').open)$('#wallet-picker-state').focus();
    else{$('#wallet-more').open=true;$('#private-state').tabIndex=-1;$('#private-state').focus()}
    return;
  }
  pickerTrigger=trigger;
  if(login){loginIntent={target,account:null,providerKind:null};try{sessionStorage.setItem(LOGIN_INTENT_KEY,JSON.stringify({target}))}catch{}}
  else clearLoginIntent();
  const wallet=window.YNXFinanceWallet;
  const connected=wallet.getStandardWalletState();
  if(login&&connected.status==='connected'&&(connected.providerKind!=='metamask'||['overview','assets','activity'].includes(target))){
    pickerMethod=connected.providerKind==='metamask'?'metamask':connected.transport==='walletconnect'?'mobile':connected.transport==='hosted-wallet-web'?'hosted':'ynx';pickerPhase='pickerSigning';pickerCode='';clearPickerPair();
    $('#wallet-picker-icon').replaceChildren($(pickerButtons[pickerMethod]).querySelector('img,svg').cloneNode(true));renderWalletPicker();
    if(!$('#wallet-picker').open)$('#wallet-picker').showModal();$('#wallet-picker-state').focus();void continueLoginIntent();return;
  }
  pickerMethod=null;pickerCode='';clearPickerPair();renderWalletPicker();
  const picker=$('#wallet-picker');if(!picker.open)picker.showModal();$('#picker-ynx').focus();
}
function closeWalletPicker({cancel=false,completed=false}={}){
  if(!cancel&&!completed&&loginIntent&&$('#wallet-picker').open){pickerPhase='pickerSigning';renderWalletPicker();return;}
  if(cancel){const cancelLogin=!!loginOperation&&!window.YNXFinanceWallet.connected();clearLoginIntent();++pickerEpoch;pickerPending=null;if(pickerMethod==='mobile'&&window.YNXFinanceWallet.getStandardWalletState().status==='connecting')void window.YNXFinanceWallet.cancelPair?.();else if(window.YNXFinanceWallet.getStandardWalletState().status==='connecting')window.YNXFinanceWallet.disconnectStandardWallet();if(cancelLogin)void window.YNXFinanceWallet.disconnect();}
  clearPickerPair();
  $('#wallet-picker').close();pickerTrigger?.focus();
}
async function finishLoginIntent(){
  const intent=loginIntent,context=state.context;if(!intent)return;
  if(window.YNXFinanceWallet.connected()){
    await load();completeLoginTarget(intent,context);
  }
}
function completeLoginTarget(intent,context){
  if(!intent||loginIntent!==intent||context!==state.context||!state.connected||$('#workspace').dataset.dataState!=='ready'||state.overview?.portfolio?.account!==window.YNXFinanceWallet.session()?.account)return;
  location.hash=intent.target;clearLoginIntent();
}
function continueLoginIntent(){
  if(!loginIntent)return Promise.resolve();
  if(loginOperation)return loginOperation;
  const intent=loginIntent,selected=window.YNXFinanceWallet.getStandardWalletState();
  if(selected.status!=='connected'||!renderBrowserWalletIdentity())return Promise.resolve();
  intent.account=selected.account;intent.providerKind=selected.providerKind;
  const revision=window.YNXFinanceWallet.getStandardRevision();
  loginOperation=(async()=>{
    closeWalletPicker();
    if(selected.providerKind==='ynx-wallet'){
      if(window.YNXFinanceWallet.connected()){await finishLoginIntent();return}
      const result=await window.YNXFinanceWallet.beginPrivate();
      if(loginIntent!==intent||revision!==window.YNXFinanceWallet.getStandardRevision())return;
      // The authoritative connected event owns the one initial protected read
      // and target restore. Do not race it with a second proof/load here.
      if(!['connected','connecting'].includes(result?.status)){
        const rejected=['denied','rejected'].includes(result?.status)||result?.code==='USER_REJECTED'||result?.approvalRejected===true;
        if(rejected||result?.revocationConfirmed===true)clearLoginIntent();
        notify(financeText(rejected?'identityRejected':'connectionUnavailable'),true);
      }
    }else{
      if(!['overview','assets','activity'].includes(intent.target)){clearLoginIntent();notify(financeText('privateApprovalInfo'),true);return}
      await verifyWalletIdentity({target:intent.target});
      clearLoginIntent();
    }
  })().finally(()=>{loginOperation=null});
  return loginOperation;
}
async function signIn(){try{await window.YNXFinanceWallet.connect()}catch(error){notifyFailure(error,'connectionUnavailable')}}
async function verifyWalletIdentity({target=(location.hash||'#assets').slice(1)}={}){
  if(walletIdentityBusy||!renderBrowserWalletIdentity())return;
  const wallet=window.YNXFinanceWallet,selected=wallet.getStandardWalletState(),revision=wallet.getStandardRevision();
  if(selected.status!=='connected'||selected.chainId!=='0x1917'||!selected.account){walletIdentityState='identityRejected';renderWalletIdentity();return}
  walletIdentityBusy=true;walletIdentityState='identityChecking';renderWalletIdentity();
  const unchanged=()=>{const current=wallet.getStandardWalletState();if(wallet.getStandardRevision()!==revision||current.status!=='connected'||current.account!==selected.account||current.providerKind!==selected.providerKind||current.chainId!=='0x1917')throw new Error('WALLET_CONTEXT_CHANGED')};
  try{
    // Reuse the existing durable, device-bound Finance account session instead
    // of ending at the old one-shot verified:true response. This grants only
    // finance.account.read; native Product Session remains a separate approval.
    const result=await window.YNXFinanceEVMRead.begin();unchanged();
    const session=window.YNXFinanceEVMRead.state();
    if(result?result.account!==selected.account||result.evmAccountReadAuthorized!==true:!session.serverConfirmed||!session.active||session.account!==selected.account)throw new Error('WALLET_LOGIN_VERIFICATION_REJECTED');
    walletIdentityState='identityVerified';
    location.hash=['overview','assets','activity'].includes(target)?target:'assets';
  }catch(error){walletIdentityState='identityRejected';notifyFailure(error,'identityRejected')}
  finally{walletIdentityBusy=false;renderWalletIdentity()}
}
function renderAccountSession(){
  const session=window.YNXFinanceEVMRead?.state(),data=session?.status==='ready'?session.data:null;
  const section=$('#account-workspace');if(!section)return;
  const selected=window.YNXFinanceWallet?.getStandardWalletState?.();
  const compatible=selected?.status!=='connecting'&&selected?.status!=='wrong-chain'&&!['explicit-local','permission-revoked','account-changed','chain-changed'].includes(selected?.disconnectReason)&&(!selected?.account||session?.account===selected.account&&session.providerKind===selected.providerKind&&selected.chainId==='0x1917');
  const bound=session?.active&&Boolean(session.account)&&compatible&&Date.parse(session.expiresAt)>Date.now();
  const authorized=bound&&session.serverConfirmed;
  const valid=authorized&&Boolean(data?.account)&&data?.portfolio?.account===data.account&&data.account===session.account;
  section.dataset.authorized=String(Boolean(authorized));
  section.dataset.recovering=String(Boolean(bound&&!session.serverConfirmed));
  section.dataset.dataState=valid?'ready':session?.status==='loading'?'loading':'unavailable';
  if(!walletIdentityBusy){if(authorized)walletIdentityState='identityVerified';else if(walletIdentityState==='identityVerified')walletIdentityState='identityUnverified';renderWalletIdentity();}
  $('#account-session-account').textContent=authorized?session.account:'—';
  $('#account-session-balance').textContent=valid&&data.portfolio.explorerStatus?.available?`${fmt(data.portfolio.balanceYnxt)} YNXT`:financeText('unavailable');
  const activities=valid?(Array.isArray(data.portfolio.activity)?data.portfolio.activity:[]):null;
  $('#account-session-activity').innerHTML=activities?activities.length?activities.map(activityRow).join(''):`<div class="empty">${esc(financeText('noOwnedActivity'))}</div>`:`<div class="empty">${esc(financeText(bound?session.status==='loading'?'checkingSources':'connectionUnavailable':'privateReauthorize'))}</div>`;
  $('#account-session-expiry').textContent=authorized?date(session.expiresAt):'—';
  $('#account-session-refresh').disabled=!bound||session.status==='loading';
  route();
}
async function consumeCallback(){await window.YNXFinanceWallet.ready}
const ownedFormDrafts=new Map();let ownedFormAccount=null;
function rememberOwnedFormDrafts(){
  retireOwnedStatementView();
  retireOwnedAIView();
  if(!ownedFormAccount)return;
  const drafts=[];for(const id of ['category-form','budget-form','reminder-form','privacy-form']){
    const form=$('#'+id);if(!form)continue;
    if(id!=='privacy-form'||formUncommittedDrafts.get(form)?.context===state.context)drafts.push({id,fields:Array.from(form.elements).filter(field=>field.name&&['INPUT','SELECT','TEXTAREA'].includes(field.tagName)).map(field=>({name:field.name,value:field.value,checked:field.checked,type:field.type}))});
    retireOwnedFormSaveView(form);form.reset();formUncommittedDrafts.delete(form);const status=form.querySelector('[data-save-state]');if(status){status.textContent='';delete status.dataset.saveKey}
  }
  ownedFormDrafts.set(ownedFormAccount,drafts);ownedFormAccount=null;
}
function restoreOwnedFormDrafts(account){
  if(ownedFormAccount&&ownedFormAccount!==account)rememberOwnedFormDrafts();ownedFormAccount=account;
  const drafts=ownedFormDrafts.get(account);if(!drafts)return;ownedFormDrafts.delete(account);
  for(const {id,fields} of drafts){const form=$('#'+id);if(!form)continue;for(const saved of fields){const field=form.elements.namedItem(saved.name);if(!field)continue;if(saved.type==='checkbox'||saved.type==='radio')field.checked=saved.checked;else field.value=saved.value}if(id==='privacy-form')formUncommittedDrafts.set(form,{context:state.context})}
}
function clearPrivateView({clearOpaquePending=true}={}){rememberOwnedFormDrafts();state.context++;clearInterval(state.aiTimer);state.aiJob=null;state.statement=null;state.statementError=false;state.overview=null;state.connected=false;if(clearOpaquePending){sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);window.YNXFinanceOrderWallet?.clear()}hideBrokerApproval();for(const id of ['account','balance','staked','balance-source','statement','ai-status']){const element=$('#'+id);if(element)element.textContent='—'}brokerSnapshotState={kind:'guest'};brokerWorkspaceUnavailable=false;renderBrokerSnapshot();renderBrokerWorkspace(null);renderSignedOut()}
async function logout(){const result=await window.YNXFinanceWallet.disconnect();if(result?.status==='disconnected'){clearPrivateView()}else notify(financeText('privateLogoutUnconfirmed'),true)}
function renderSignedOut(){document.body.classList.add('signed-out-state');$('#signed-out').classList.remove('hidden');$('#workspace').classList.add('hidden');$('#signin').classList.add('hidden');$('#logout').classList.add('hidden');sourceStatus('notConnected');$('#page-title').textContent=financeText('pageTitle');route()}

const dataDisabledControls=new Map();
function workspaceDataState(status){
  $('#workspace').dataset.dataState=status;
  $('#workspace-data-warning').classList.toggle('hidden',status!=='unavailable');
  for(const control of $$('#workspace form button,#ai-start,#ai-actions button')){
    if(status==='unavailable'){if(!dataDisabledControls.has(control)){const saving=formSaves.get(control.closest('form'));dataDisabledControls.set(control,saving?.buttons.find(previous=>previous.button===control)?.disabled??control.disabled)}control.disabled=true}
    else if(dataDisabledControls.has(control)){control.disabled=dataDisabledControls.get(control);dataDisabledControls.delete(control)}
  }
}
let loadOperation=null,workspaceReadRevision=0;
function load({fresh=false}={}){if(!fresh&&loadOperation?.context===state.context)return loadOperation.promise;const operation={context:state.context,revision:++workspaceReadRevision,promise:null};loadOperation=operation;operation.promise=loadOwnedWorkspace(operation.context,operation.revision).finally(()=>{if(loadOperation===operation)loadOperation=null});return operation.promise}
async function loadOwnedWorkspace(context,revision){await window.YNXFinanceWallet.ready;if(context!==state.context||revision!==workspaceReadRevision||!renderBrowserWalletIdentity())return;state.connected=window.YNXFinanceWallet.connected();if(!state.connected){renderSignedOut();return}try{sourceStatus('checkingSources');const data=await api('/api/overview');if(context!==state.context||revision!==workspaceReadRevision)return;validateFinanceOverview(data);state.overview=data;workspaceDataState('ready');reconcileOpaqueBrokerOwner();render(data)}catch(error){if(context!==state.context||revision!==workspaceReadRevision||error?.nonRetryable&&String(error.message).startsWith('FINANCE_CONTEXT_CHANGED'))return;if(error.status===401||error.status===403||error.code==='SESSION_EXPIRED'){window.YNXFinanceWallet.reportPrivateFailure(error);clearPrivateView();notify(financeText('privateReauthorize'),true)}else{state.overview=null;workspaceDataState('unavailable');$('#workspace').classList.remove('hidden');$('#signed-out').classList.add('hidden');$('#account').textContent=window.YNXFinanceWallet.session()?.account??'—';for(const id of ['balance','staked','balance-source','recent-activity','recent-receipts'])$('#'+id).textContent=financeText('unavailable');route();notifyFailure(error,'connectionUnavailable')}}}
async function reconnect(){try{await publicHealth();if(state.connected)await load()}catch(error){notifyFailure(error,'connectionUnavailable')}}
function validateFinanceOverview(data){
  const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  if(!record(data)||!record(data.portfolio)||typeof data.portfolio.account!=='string'||!data.portfolio.account.trim()||data.portfolio.account!==data.portfolio.account.trim()||!record(data.profile)||!record(data.profile.privacy)||!['includePayInStatements','allowAiActivityContext','alertsEnabled'].every(key=>typeof data.profile.privacy[key]==='boolean'))throw Object.assign(new Error('FINANCE_OVERVIEW_INVALID'),{code:'FINANCE_OVERVIEW_INVALID',nonRetryable:true});
  return data;
}
function render(data){const {portfolio:p,profile}=validateFinanceOverview(data);document.body.classList.remove('signed-out-state');$('#signed-out').classList.add('hidden');$('#workspace').classList.remove('hidden');$('#signin').classList.add('hidden');$('#logout').classList.remove('hidden');const available=status=>!!status&&typeof status==='object'&&!Array.isArray(status)&&status.available===true,explorerAvailable=available(p.explorerStatus),payAvailable=available(p.payStatus);if(ownedFormAccount&&ownedFormAccount!==p.account)rememberOwnedFormDrafts();$('#account').textContent=p.account;$('#balance').textContent=explorerAvailable?`${fmt(p.balanceYnxt)} YNXT`:financeText('unavailable');$('#staked').textContent=explorerAvailable?`${fmt(p.stakedYnxt)} YNXT`:financeText('unavailable');$('#balance-source').textContent=explorerAvailable?`${financeText('explorerEvidence')} · ${date(p.asOf)}`:financeText('sourcesUnavailable');const both=explorerAvailable&&payAvailable;sourceStatus(both?'sourcesLive':explorerAvailable?'explorerLivePayUnavailable':'sourcesUnavailable',both?'live':'warning');renderAlerts(data.alerts);renderActivity(p.activity,p.explorerStatus);renderReceipts(p.payReceipts,p.payStatus);renderPlanning(profile,data.budgetProgress);renderPrivacy(profile.privacy);restoreOwnedFormDrafts(p.account);renderAIRecords(p.activity);renderSupport(data.support);refreshBrokerSnapshot();refreshBrokerWorkspace().then(async workspace=>{if(workspace)try{await restoreBrokerApproval(workspace.serverTime)}catch(error){notifyFailure(error,'brokerApprovalUnavailable')}await completeBrokerCallback()});route()}
function renderAlerts(alerts){const el=$('#alerts'),unavailable=`<div class="alert"><div><strong>${esc(financeText('unavailable'))}</strong></div></div>`;if(!Array.isArray(alerts)){el.innerHTML=unavailable;return}if(!alerts.length){el.innerHTML=`<div class="alert info"><div><strong>${esc(financeText('noAlerts'))}</strong><small>${esc(financeText('alertsInformational'))}</small></div></div>`;return}el.innerHTML=alerts.map(a=>a&&typeof a==='object'&&!Array.isArray(a)&&typeof a.title==='string'&&a.title.trim()&&typeof a.detail==='string'?`<div class="alert ${a.severity==='info'?'info':''}"><div><strong>${esc(a.title)}</strong><small>${esc(a.detail)}</small></div></div>`:unavailable).join('')}
function readableActivityRow(a){return !!a&&typeof a==='object'&&!Array.isArray(a)&&typeof a.id==='string'&&!!a.id.trim()&&typeof a.type==='string'&&['incoming','outgoing'].includes(a.direction)}
function activityRow(a,status){if(!readableActivityRow(a))return `<div class="empty compact">${esc(financeText('unavailable'))}</div>`;const sign=a.direction==='outgoing'?'-':'+';return `<div class="row"><div class="row-main"><strong>${esc(a.type||financeText('ynxtActivity'))}</strong><small>${esc(date(a.timestamp))} · ${financeActivityEvidence(a,status)}</small></div><div class="row-value">${sign}${fmt(a.amountYnxt)} YNXT<small>${esc(financeText('feeLabel'))} ${fmt(a.feeYnxt)}</small></div></div>`}
function renderActivity(items,status){const rows=Array.isArray(items)?items:null;$('#recent-activity').innerHTML=rows?.length?rows.slice(0,5).map(a=>activityRow(a,status)).join(''):`<div class="empty compact">${esc(financeText(rows?'noOwnedActivity':'unavailable'))}</div>`;$('#activity-body').innerHTML=rows?rows.map(a=>readableActivityRow(a)?`<tr><td>${esc(date(a.timestamp))}</td><td>${esc(a.type)}</td><td>${esc(a.direction)}</td><td class="num">${fmt(a.amountYnxt)} YNXT</td><td class="num">${fmt(a.feeYnxt)}</td><td>${financeActivityEvidence(a,status)}</td></tr>`:`<tr><td colspan="6">${esc(financeText('unavailable'))}</td></tr>`).join(''):`<tr><td colspan="6">${esc(financeText('unavailable'))}</td></tr>`;$('#activity-empty').classList.toggle('hidden',!rows||rows.length>0);$('#activity-empty').textContent=financeText('noExplorerActivity')}
function financeActivityEvidence(a,status){
  const reference=`<details class="evidence"><summary>${esc(short(a.id))}</summary><code>${esc(a.id)}</code></details>`;
  if(a.source!=='ynx-explorerd:indexed-transaction'||status?.available!==true||! /^(?:0x)?[a-fA-F0-9]{64}$/.test(a.id))return reference;
  const source=financeNavigationURL(status.source);if(!source)return reference;
  const base=new URL(source);if(base.pathname!=='/'||base.search||base.hash)return reference;
  const target=new URL('/tx/'+encodeURIComponent(a.id),base);
  return `${reference}<a href="${esc(target.href)}" rel="noreferrer">${esc(financeText('explorerEvidence'))}</a>`;
}
function financeNavigationURL(value){
  if(typeof value!=='string'||value!==value.trim()||/[\u0000-\u0020\u007f\\]/.test(value)||value.startsWith('//'))return null;
  if(!value.startsWith('/')&&!/^https:\/\//i.test(value))return null;
  try{const url=value.startsWith('/')?new URL(value,location.origin):new URL(value);if(url.protocol!=='https:'||url.username||url.password)return null;return url.href}catch{return null}
}
function renderReceipts(items,status){const el=$('#recent-receipts');if(!status||typeof status!=='object'||Array.isArray(status)||status.available!==true||!Array.isArray(items)){el.innerHTML=`<div class="empty compact">${esc(financeText('unavailable'))}. ${esc(financeText('noReceiptPlaceholders'))}</div>`;return}el.innerHTML=items.length?items.slice(0,5).map(r=>{if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||!r.id.trim())return `<div class="empty compact">${esc(financeText('unavailable'))}</div>`;const disputeURL=financeNavigationURL(r.disputeUrl),hash=typeof r.transactionHash==='string'&&r.transactionHash.trim()?r.transactionHash:r.id;return `<div class="row"><div class="row-main"><strong>${esc(typeof r.status==='string'&&r.status.trim()?r.status:financeText('payRecord'))}</strong><small>${esc(date(typeof r.createdAt==='string'?r.createdAt:null))} · ${esc(short(hash))}</small></div><div class="row-value">${fmt(r.amountYnxt)} YNXT${disputeURL?`<small><a href="${esc(disputeURL)}" rel="noreferrer">${esc(financeText('disputeLink'))}</a></small>`:''}</div></div>`}).join(''):`<div class="empty compact">${esc(financeText('noOwnedPayReceipts'))}</div>`}
// The bounded activity API cannot prove a full-period total. Do not coerce
// missing progress to zero or render a percentage of an unknown total.
function budgetAmount(value){return Number.isSafeInteger(value)&&value>=0?`${fmt(value)} YNXT`:financeText('unknown')}
function budgetProgressRow(b,progress){
  const p=progress?.budgetId===b.id?progress:null;
  const observed=p?.calculationStatus==='partial'&&p.coverageComplete===false?budgetAmount(p.observedSpentYnxt):financeText('unknown');
  const period=p?.periodTimezone==='UTC'&&p.periodStart?String(p.periodStart):financeText('unknown');
  const effective=p?.effectiveFrom?String(p.effectiveFrom):financeText('unknown');
  const status=p?.calculationStatus==='not-started'?financeText('budgetNotStarted'):p?.calculationStatus==='partial'?financeText('partialObservation'):financeText('calculationUnavailable');
  return `<div class="row"><div class="row-main"><strong>${esc(b.name)}</strong><small>${esc(financeText(b.period==='weekly'?'weeklyLabel':'monthlyLabel'))} · ${esc(financeText('planningOnly'))} · UTC</small><small>${esc(financeText('periodStart'))}: ${esc(period)} · ${esc(financeText('countFrom'))}: ${esc(effective)}</small><small>${esc(status)}</small><small>${esc(p?.coverage||financeText('noCompletePeriodHistory'))}</small></div><div class="row-value">${esc(financeText('budgetLimit'))}: ${budgetAmount(b.limitYnxt)}<small>${esc(financeText('observedSpending'))}: ${observed}</small><small>${esc(financeText('fullPeriodSpending'))}: ${esc(financeText('unknown'))}</small><small>${esc(financeText('remainingBudget'))}: ${esc(financeText('unknown'))}</small></div></div>`;
}
function readablePlanningRecord(value,label){return !!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.id==='string'&&!!value.id.trim()&&typeof value[label]==='string'&&!!value[label].trim()}
function renderPlanning(profile,progress=[]){
  const categories=Array.isArray(profile?.categories)?profile.categories:null,budgets=Array.isArray(profile?.budgets)?profile.budgets:null,reminders=Array.isArray(profile?.reminders)?profile.reminders:null;
  const unavailable=`<div class="empty compact">${esc(financeText('unavailable'))}</div>`;
  $('#categories').innerHTML=categories?.length?categories.map(c=>readablePlanningRecord(c,'name')?`<span><i class="chip-dot"></i>${esc(c.name)} <small>${esc(typeof c.color==='string'?c.color:financeText('unknown'))}</small></span>`:unavailable).join(''):`<span>${esc(financeText(categories?'noCategories':'unavailable'))}</span>`;
  const select=$('#budget-form select[name=categoryId]'),selected=select.value,validCategories=categories?.filter(c=>readablePlanningRecord(c,'name'))??[];
  select.innerHTML=`<option value="">${esc(financeText(categories?'chooseCategory':'unavailable'))}</option>`+validCategories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if(validCategories.some(c=>c.id===selected))select.value=selected;
  $('#budgets').innerHTML=budgets?.length?budgets.map(b=>readablePlanningRecord(b,'name')&&['weekly','monthly'].includes(b.period)?budgetProgressRow(b,Array.isArray(progress)?progress.find(p=>p?.budgetId===b.id):null):unavailable).join(''):budgets?`<div class="empty compact">${esc(financeText('createBudget'))}</div>`:unavailable;
  $('#reminders').innerHTML=reminders?.length?reminders.map(r=>readablePlanningRecord(r,'title')&&['weekly','monthly','custom'].includes(r.schedule)?`<div class="row"><div class="row-main"><strong>${esc(r.title)}</strong><small>${esc(financeText(r.schedule+'Label'))} · ${esc(financeText('nextDue'))} ${esc(date(typeof r.nextDueAt==='string'?r.nextDueAt:null))}</small></div><div class="row-value">${r.amountYnxt==null?esc(financeText('amountNotSet')):`${fmt(r.amountYnxt)} YNXT`}<small>${esc(financeText('reminderOnly'))}</small></div></div>`:unavailable).join(''):reminders?`<div class="empty compact">${esc(financeText('noReminders'))}</div>`:unavailable;
}
function renderPrivacy(p){const f=$('#privacy-form');if(formUncommittedDrafts.get(f)?.context===state.context)return;formUncommittedDrafts.delete(f);f.includePayInStatements.checked=!!p.includePayInStatements;f.allowAiActivityContext.checked=!!p.allowAiActivityContext;f.alertsEnabled.checked=!!p.alertsEnabled}
function renderAIRecords(items){const selected=new Set($$('#ai-records input:checked').map(input=>input.value));$('#ai-records').innerHTML=Array.isArray(items)&&items.length?items.map(a=>readableActivityRow(a)?`<label class="check-item"><input type="checkbox" value="${esc(a.id)}" ${selected.has(a.id)?'checked':''}><span><strong>${esc(a.type)}</strong><br><small>${esc(date(a.timestamp))} · ${fmt(a.amountYnxt)} YNXT</small></span></label>`:`<div class="empty compact">${esc(financeText('unavailable'))}</div>`).join(''):`<div class="empty compact">${esc(financeText(Array.isArray(items)?'aiNoOwnedActivity':'unavailable'))}</div>`}
function renderSupport(s){const links=s&&typeof s==='object'&&!Array.isArray(s)?s:{};$('#support-links').innerHTML=[['supportHelp',links.helpUrl],['supportPrivacy',links.privacyUrl],['supportDispute',links.disputeUrl]].map(([key,value])=>{const url=financeNavigationURL(value);return url?`<a class="panel support-card" href="${esc(url)}" rel="noreferrer"><span>${esc(financeText('verifiedPath'))}</span><strong>${esc(financeText(key))} →</strong></a>`:`<div class="panel support-card"><span>${esc(financeText('unavailable'))}</span><strong>${esc(financeText(key))}</strong></div>`}).join('')}

const formSaves=new WeakMap(),formSaveIntents=new WeakMap(),formUncommittedDrafts=new WeakMap();
function ownedSavePayloadValid(path,body){
  const named=value=>typeof value==='string'&&value.trim().length>0;
  const instant=value=>financeTimestampValid(value)&&!value.startsWith('0001-');
  if(path==='/api/privacy')return ['includePayInStatements','allowAiActivityContext','alertsEnabled'].every(key=>typeof body[key]==='boolean');
  if(path==='/api/categories')return named(body.name)&&typeof body.color==='string'&&/^#[0-9a-f]{6}$/i.test(body.color);
  if(path==='/api/budgets')return named(body.name)&&named(body.categoryId)&&Number.isSafeInteger(body.limitYnxt)&&body.limitYnxt>0&&['weekly','monthly'].includes(body.period)&&instant(body.startsAt);
  if(path==='/api/reminders')return named(body.title)&&['weekly','monthly','custom'].includes(body.schedule)&&instant(body.nextDueAt)&&(body.amountYnxt==null||Number.isSafeInteger(body.amountYnxt)&&body.amountYnxt>=0);
  return false;
}
function ownedSaveReceiptMatches(path,body,receipt){
  const instant=value=>financeTimestampValid(value)&&!value.startsWith('0001-');
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return false;
  if(path==='/api/privacy')return instant(receipt.updatedAt)&&['includePayInStatements','allowAiActivityContext','alertsEnabled'].every(key=>typeof body[key]==='boolean'&&receipt[key]===body[key]);
  if(typeof receipt.id!=='string'||!receipt.id.trim()||receipt.source!=='user'||!instant(receipt.createdAt))return false;
  if(path==='/api/categories')return receipt.name===String(body.name).trim()&&typeof body.color==='string'&&/^#[0-9a-f]{6}$/i.test(receipt.color)&&receipt.color===body.color.toUpperCase();
  if(path==='/api/budgets')return receipt.name===String(body.name).trim()&&receipt.categoryId===body.categoryId&&Number.isSafeInteger(body.limitYnxt)&&body.limitYnxt>0&&receipt.limitYnxt===body.limitYnxt&&['weekly','monthly'].includes(body.period)&&receipt.period===body.period&&instant(body.startsAt)&&instant(receipt.startsAt)&&Date.parse(receipt.startsAt)===Date.parse(body.startsAt)&&instant(receipt.updatedAt);
  if(path==='/api/reminders')return receipt.title===String(body.title).trim()&&receipt.schedule===body.schedule&&['weekly','monthly','custom'].includes(body.schedule)&&receipt.enabled===true&&instant(body.nextDueAt)&&instant(receipt.nextDueAt)&&Date.parse(receipt.nextDueAt)===Date.parse(body.nextDueAt)&&instant(receipt.updatedAt)&&(body.amountYnxt==null?receipt.amountYnxt==null:Number.isSafeInteger(body.amountYnxt)&&body.amountYnxt>=0&&receipt.amountYnxt===body.amountYnxt)&&(receipt.sourceRef||'')===(body.sourceRef||'');
  return false;
}
function retireOwnedFormSaveView(form){
  const operation=formSaves.get(form);if(!operation)return;
  // Retire only this page's UI ownership. The sent write may still have committed;
  // retain its intent and never resend or claim cancellation here.
  formSaves.delete(form);form.removeAttribute('aria-busy');
  for(const {button,disabled} of operation.buttons){button.disabled=disabled;if(dataDisabledControls.has(button))dataDisabledControls.set(button,disabled)}
}
function ownedSaveStatus(form,key){const status=form.querySelector('[data-save-state]');if(status){status.dataset.saveKey=key;status.textContent=financeText(key)}}
document.addEventListener('finance:localechange',()=>{for(const status of $$('[data-save-state][data-save-key]'))status.textContent=financeText(status.dataset.saveKey)});
function formDraft(form){return JSON.stringify(Array.from(new FormData(form),([key,value])=>[key,String(value)]));}
function submitForm(form,path,body,event,{method='POST',reset=true,successKey='profileSaved'}={}){
  const context=state.context,identityRevision=browserSSOIntentGeneration;
  const pending=formSaves.get(form);if(pending?.context===context&&pending.identityRevision===identityRevision)return pending.promise;
  const draft=formDraft(form),previous=formSaveIntents.get(form);
  const intent=previous?.context===context&&previous.identityRevision===identityRevision&&previous.path===path&&previous.method===method&&previous.draft===draft?previous:{context,identityRevision,path,method,draft,payload:JSON.stringify(body),key:method==='POST'?crypto.randomUUID():null};
  formSaveIntents.set(form,intent);
  const buttons=Array.from(form.querySelectorAll('button[type="submit"],button:not([type])'),button=>({button,disabled:pending?.buttons.find(previous=>previous.button===button)?.disabled??button.disabled}));
  const operation={context,identityRevision,draft,buttons,promise:null};
  const current=()=>formSaves.get(form)===operation&&state.context===context&&browserSSOIntentGeneration===identityRevision;
  formSaves.set(form,operation);form.setAttribute('aria-busy','true');ownedSaveStatus(form,'ownedSavePending');for(const {button} of buttons)button.disabled=true;
  operation.promise=(async()=>{try{
    const submitted=JSON.parse(intent.payload);if(!ownedSavePayloadValid(path,submitted))throw new Error(financeText('ownedSaveUnconfirmed'));
    const receipt=await api(path,{method,body:JSON.stringify({...submitted,...(intent.key?{idempotencyKey:intent.key}:{})})});if(!current())return;
    if(!ownedSaveReceiptMatches(path,submitted,receipt))throw new Error(financeText('ownedSaveUnconfirmed'));
    formSaveIntents.delete(form);void attestBrowserIdentityActivity('save',event,identityRevision);
    const unchanged=formDraft(form)===operation.draft;
    if(reset&&unchanged)form.reset();
    if(!reset){if(unchanged)formUncommittedDrafts.delete(form);else formUncommittedDrafts.set(form,{context});}
    ownedSaveStatus(form,successKey);notify(financeText(successKey));
    // A verified write receipt and a later overview read are separate outcomes.
    // Never downgrade the persisted save to "unconfirmed" or replay it merely
    // because readiness/rendering of the follow-up read fails.
    try{await load({fresh:true})}catch(error){if(current())notifyFailure(error,'connectionUnavailable')}
  }catch(error){if(current()){ownedSaveStatus(form,'ownedSaveUnconfirmed');notifyFailure(error,'unavailable');}
  }finally{if(formSaves.get(form)===operation){formSaves.delete(form);form.removeAttribute('aria-busy');for(const {button,disabled} of buttons)button.disabled=disabled||!state.connected||$('#workspace').dataset.dataState==='unavailable';}}})();
  return operation.promise;
}
$('#category-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);submitForm(e.currentTarget,'/api/categories',{name:f.get('name'),color:f.get('color')},e)});
$('#budget-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);submitForm(e.currentTarget,'/api/budgets',{name:f.get('name'),categoryId:f.get('categoryId'),limitYnxt:Number(f.get('limitYnxt')),period:f.get('period'),startsAt:new Date().toISOString()},e)});
$('#reminder-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const raw=f.get('amountYnxt'),due=new Date(f.get('nextDueAt'));
  // Invalid/restored drafts must reach the guarded save controller, not throw
  // before it can preserve the draft and display the localized recovery state.
  const nextDueAt=Number.isFinite(due.getTime())?due.toISOString():'';
  submitForm(e.currentTarget,'/api/reminders',{title:f.get('title'),amountYnxt:raw===''?null:Number(raw),schedule:f.get('schedule'),nextDueAt,sourceRef:''},e)});
$('#privacy-form').addEventListener('input',e=>{if(state.connected)formUncommittedDrafts.set(e.currentTarget,{context:state.context})});
$('#privacy-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;submitForm(f,'/api/privacy',{includePayInStatements:f.includePayInStatements.checked,allowAiActivityContext:f.allowAiActivityContext.checked,alertsEnabled:f.alertsEnabled.checked},e,{method:'PUT',reset:false,successKey:'privacySaved'})});
function renderStatement(s){
  if(s?.schemaVersion!=='finance-statement-v2'||s.coverageComplete!==false||!Array.isArray(s.activity)||!s.totals||!['incomingYnxt','outgoingYnxt','feesYnxt'].every(key=>s.totals[key]===null))throw new Error(financeText('statementCoverageInvalid'));
  validateStatementObservation(s);
  $('#statement').classList.remove('statement-placeholder');
  const observed=s.calculationStatus==='partial'?s.observedTotals:null;
  const amount=value=>Number.isSafeInteger(value)&&value>=0?`${fmt(value)} YNXT`:financeText('unknown');
  $('#statement').innerHTML=`<p><strong>${esc(s.network)} · ${esc(s.symbol)}</strong><br>${esc(date(s.from))} ${esc(financeText('statementThrough'))} ${esc(date(new Date(new Date(s.toExclusive).getTime()-1).toISOString()))}</p><p><strong>${esc(financeText('fullPeriodTotals'))}: ${esc(financeText('unknown'))}</strong><br>${esc(s.coverage||financeText('completeHistoryMissing'))}</p><div class="statement-grid"><div class="stat"><small>${esc(financeText('observedIncoming'))}</small><strong>${amount(observed?.incomingYnxt)}</strong></div><div class="stat"><small>${esc(financeText('observedOutgoing'))}</small><strong>${amount(observed?.outgoingYnxt)}</strong></div><div class="stat"><small>${esc(financeText('observedFees'))}</small><strong>${amount(observed?.feesYnxt)}</strong></div><div class="stat"><small>${esc(financeText('returnedRecords'))}</small><strong>${s.activity.length}</strong></div></div><p><small>${esc(s.openingBalance)}. ${esc(financeText('notBankStatement'))}</small></p>`;
}
let statementOperation=null;
function statementDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error(financeText('statementCoverageInvalid'));
  const parsed=new Date(`${value}T00:00:00Z`);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new Error(financeText('statementCoverageInvalid'));
  return parsed;
}
function retireOwnedStatementView(){statementOperation=null;$('#statement').removeAttribute('aria-busy');$('#statement-form').removeAttribute('aria-busy')}
function validateStatementObservation(statement){
  if(statement?.calculationStatus!=='partial')return;
  const invalid=()=>{throw new Error(financeText('statementCoverageInvalid'))},keys=['incomingYnxt','outgoingYnxt','feesYnxt'],observed=statement.observedTotals;
  if(!Array.isArray(statement.activity)||!observed||typeof observed!=='object'||Array.isArray(observed)||!keys.every(key=>Number.isSafeInteger(observed[key])&&observed[key]>=0))invalid();
  const from=Date.parse(statement.from),to=Date.parse(statement.toExclusive),ids=new Set(),sum={incomingYnxt:0n,outgoingYnxt:0n,feesYnxt:0n};
  for(const row of statement.activity){
    if(!row||typeof row!=='object'||Array.isArray(row)||!['incoming','outgoing'].includes(row.direction)||!financeTimestampValid(row.timestamp)||!Number.isSafeInteger(row.amountYnxt)||row.amountYnxt<0||!Number.isSafeInteger(row.feeYnxt)||row.feeYnxt<0)invalid();
    if(typeof row.id!=='string'||!row.id.trim()||row.id!==row.id.trim()||ids.has(row.id))invalid();
    ids.add(row.id);
    const time=Date.parse(row.timestamp);if(!Number.isFinite(from)||!Number.isFinite(to)||time<from||time>=to)invalid();
    sum[row.direction==='incoming'?'incomingYnxt':'outgoingYnxt']+=BigInt(row.amountYnxt);sum.feesYnxt+=BigInt(row.feeYnxt);
  }
  if(!keys.every(key=>sum[key]===BigInt(observed[key])))invalid();
}
function loadStatement(form){
  const context=state.context,identityRevision=browserSSOIntentGeneration,account=state.overview?.portfolio?.account,draft=formDraft(form),previous=statementOperation;
  if(previous?.context===context&&previous.identityRevision===identityRevision&&previous.account===account&&previous.draft===draft)return previous.promise;
  const operation={context,identityRevision,account,draft,promise:null};statementOperation=operation;
  const current=()=>statementOperation===operation&&state.context===context&&browserSSOIntentGeneration===identityRevision&&state.overview?.portfolio?.account===account;
  $('#statement').setAttribute('aria-busy','true');form.setAttribute('aria-busy','true');
  operation.promise=(async()=>{try{
    const f=new FormData(form),fromDate=statementDate(f.get('from')),toDate=statementDate(f.get('to'));
    if(typeof account!=='string'||!account.trim()||fromDate>toDate)throw new Error(financeText('statementCoverageInvalid'));
    const from=fromDate.toISOString();toDate.setUTCDate(toDate.getUTCDate()+1);const toExclusive=toDate.toISOString();
    const candidate=await api(`/api/statements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(toExclusive)}`);if(!current()||formDraft(form)!==draft)return;
    if(candidate?.account!==account||!financeTimestampValid(candidate.from)||!financeTimestampValid(candidate.toExclusive)||Date.parse(candidate.from)!==fromDate.getTime()||Date.parse(candidate.toExclusive)!==toDate.getTime())throw new Error(financeText('statementCoverageInvalid'));
    validateStatementObservation(candidate);renderStatement(candidate);state.statement=candidate;state.statementError=false;
  }catch(error){if(!current()||formDraft(form)!==draft)return;state.statement=null;state.statementError=true;$('#statement').classList.remove('statement-placeholder');$('#statement').textContent=financeText('unavailable');notifyFailure(error,'unavailable');
  }finally{if(statementOperation===operation){statementOperation=null;$('#statement').removeAttribute('aria-busy');form.removeAttribute('aria-busy');}}})();
  return operation.promise;
}
$('#statement-form').addEventListener('submit',e=>{e.preventDefault();void loadStatement(e.currentTarget)});

const ownedExportOperations=new Map();
function download(path,name){
  const context=state.context,identityRevision=browserSSOIntentGeneration,account=state.overview?.portfolio?.account,key=JSON.stringify([path,name]);
  const previous=ownedExportOperations.get(key);
  if(previous?.context===context&&previous.identityRevision===identityRevision&&previous.account===account)return previous.promise;
  const operation={context,identityRevision,account,promise:null},current=()=>ownedExportOperations.get(key)===operation&&state.context===context&&browserSSOIntentGeneration===identityRevision&&state.overview?.portfolio?.account===account;
  ownedExportOperations.set(key,operation);
  operation.promise=(async()=>{try{
    const blob=await api(path,{responseType:'blob'});if(!current())return;
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    try{a.href=url;a.download=name;a.click()}finally{URL.revokeObjectURL(url)}
  }catch(error){if(current())notifyFailure(error,'unavailable');}
  finally{if(ownedExportOperations.get(key)===operation)ownedExportOperations.delete(key);}})();
  return operation.promise;
}
$('#export-json').addEventListener('click',()=>download('/api/export?format=json','ynx-finance-observed-export.json'));$$('[data-auth-download]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();download(a.getAttribute('href'),'ynx-finance-observed-activity.csv')}));

let ownedAIGeneration=0,ownedAIStart=null,ownedAIAction=null;
function restoreOwnedAIAction(operation){if(!operation)return;for(const {button,disabled} of operation.buttons||[])button.disabled=disabled;$('#ai-actions').removeAttribute('aria-busy')}
function retireOwnedAIView(){ownedAIGeneration++;ownedAIStart=null;restoreOwnedAIAction(ownedAIAction);ownedAIAction=null;clearInterval(state.aiTimer);state.aiTimer=null;state.aiJob=null;for(const input of $$('#ai-records input:checked'))input.checked=false;const consent=$('#ai-consent');if(consent)consent.checked=false;const status=$('#ai-status');if(status)status.textContent='—';$('#ai-actions')?.classList.add('hidden');const button=$('#ai-start');if(button){button.disabled=false;button.textContent=financeText('aiRequestDraft')}}
function ownedAIContext(){const context=state.context,identityRevision=browserSSOIntentGeneration,generation=ownedAIGeneration;return()=>context===state.context&&identityRevision===browserSSOIntentGeneration&&generation===ownedAIGeneration}
function ownedAIReceipt(value,kind,id=null){return value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.id==='string'&&!!value.id.trim()&&(id===null||value.id===id)&&value.kind===kind&&['running','ready','failed','cancelled','applied','rejected'].includes(value.status)}
async function startAI(){
  const button=$('#ai-start');if(button.disabled||ownedAIStart)return;
  ownedAIGeneration++;restoreOwnedAIAction(ownedAIAction);ownedAIAction=null;clearInterval(state.aiTimer);state.aiTimer=null;
  const operation={},currentContext=ownedAIContext(),current=()=>ownedAIStart===operation&&currentContext();ownedAIStart=operation;
  button.disabled=true;button.textContent=financeText('aiRequesting');
  try{
    const recordIds=$$('#ai-records input:checked').map(x=>x.value),kind=$('#ai-kind').value,consent=$('#ai-consent').checked;
    if(kind!=='draft_broker_order'&&recordIds.length<1)throw new Error(financeText('aiSelectOwned'));if(!consent)throw new Error(financeText('aiConsentRequired'));
    const payload={kind,recordIds,contextClasses:recordIds.length?['owned_activity']:[],consent};
    if(kind==='draft_broker_order'){
      const form=$('#ai-order-intent');if(!(form instanceof HTMLFormElement))throw new Error(financeText('aiIntentUnavailable'));const fields=new FormData(form),intent={symbol:String(fields.get('symbol')||'').trim().toUpperCase(),side:String(fields.get('side')||''),qty:String(fields.get('qty')||'').trim(),limitPrice:String(fields.get('limitPrice')||'').trim()};
      if(!/^[A-Z][A-Z0-9.]{0,11}$/.test(intent.symbol))throw new Error(financeText('aiSymbolInvalid'));if(!['buy','sell'].includes(intent.side))throw new Error(financeText('aiSideInvalid'));if(!/^(?:[1-9][0-9]{0,5}|1000000)$/.test(intent.qty))throw new Error(financeText('aiQtyInvalid'));if(!/^(?:0\.[0-9]{0,3}[1-9]|[1-9][0-9]{0,8}(?:\.[0-9]{0,3}[1-9])?)$/.test(intent.limitPrice))throw new Error(financeText('aiLimitInvalid'));payload.securitiesOrderIntent=intent;
    }
    const candidate=await api('/api/ai/jobs',{method:'POST',body:JSON.stringify(payload)});if(!current())return;
    if(!ownedAIReceipt(candidate,kind))throw new Error(financeText('aiDraftIncomplete'));
    state.aiJob=candidate;renderAIJob();pollAI();
  }catch(error){if(current())notifyKnownOrFailure(error,['aiSelectOwned','aiConsentRequired','aiIntentUnavailable','aiSymbolInvalid','aiSideInvalid','aiQtyInvalid','aiLimitInvalid','aiDraftIncomplete'],'aiDraftFailed')}
  finally{if(ownedAIStart===operation){ownedAIStart=null;button.disabled=false;button.textContent=financeText('aiRequestDraft');if(currentContext()&&state.aiJob?.status==='running'&&state.aiTimer===null)pollAI()}}
}
function renderAIJob(){const j=state.aiJob;if(!j)return;const statusKey=({running:'aiStatusRunning',ready:'aiStatusReady',failed:'aiStatusFailed',cancelled:'aiStatusCancelled',applied:'aiStatusApplied',rejected:'aiStatusRejected'})[j.status];$('#ai-status').innerHTML=`<p><strong>${esc(statusKey?financeText(statusKey):j.status)}</strong> · ${esc(j.provider||financeText('aiProviderUnavailable'))} / ${esc(j.model||'—')}</p><p>${esc(j.progress||j.error||financeText('aiWaitingStream'))}</p><p><small>${esc(financeText('aiEstimate'))}: ${esc(j.estimatedCost||financeText('aiNotReturned'))}</small></p>${j.result?`<pre>${esc(JSON.stringify(j.result,null,2))}</pre>`:''}`;$('#ai-actions').classList.remove('hidden');$$('[data-ai=cancel]').forEach(b=>b.classList.toggle('hidden',j.status!=='running'));$$('[data-ai=delete]').forEach(b=>b.classList.toggle('hidden',j.status==='running'));$$('[data-ai=apply],[data-ai=reject]').forEach(b=>b.classList.toggle('hidden',j.status!=='ready'||j.kind==='draft_broker_order'));$$('[data-ai=use-order]').forEach(b=>b.classList.toggle('hidden',j.status!=='ready'||j.kind!=='draft_broker_order'))}
function pollAI(){
  clearInterval(state.aiTimer);state.aiTimer=null;if(state.aiJob?.status!=='running')return;
  const contextCurrent=ownedAIContext();let busy=false;
  const timer=setInterval(async()=>{
    if(busy||!contextCurrent()||state.aiTimer!==timer||state.aiJob?.status!=='running')return;
    const job=state.aiJob,current=()=>contextCurrent()&&state.aiTimer===timer&&state.aiJob===job;busy=true;
    try{
      const candidate=await api(`/api/ai/jobs/${encodeURIComponent(job.id)}`);if(!current())return;
      if(!ownedAIReceipt(candidate,job.kind,job.id))throw new Error(financeText('aiDraftIncomplete'));
      state.aiJob=candidate;renderAIJob();if(candidate.status!=='running'){clearInterval(timer);state.aiTimer=null}
    }catch(error){if(current()){clearInterval(timer);state.aiTimer=null;notifyFailure(error,'aiDraftFailed')}}
    finally{busy=false}
  },700);state.aiTimer=timer;
}
const deleteAIButton=document.createElement('button');deleteAIButton.dataset.ai='delete';deleteAIButton.className='danger hidden';deleteAIButton.textContent=financeText('aiDeleteDraftData');$('#ai-actions').append(deleteAIButton);
async function decideOwnedAI(event){
  const decision=event.target.dataset.ai,job=state.aiJob;
  if(!['cancel','delete','apply','reject','use-order'].includes(decision)||!job||ownedAIAction||ownedAIStart)return;
  if(decision==='delete'&&!window.confirm(financeText('aiDeleteConfirm')))return;
  ownedAIGeneration++;clearInterval(state.aiTimer);state.aiTimer=null;
  const operation={},contextCurrent=ownedAIContext(),current=()=>ownedAIAction===operation&&contextCurrent()&&state.aiJob===job;ownedAIAction=operation;
  operation.buttons=$$('#ai-actions button').map(button=>({button,disabled:button.disabled}));for(const {button} of operation.buttons)button.disabled=true;$('#ai-actions').setAttribute('aria-busy','true');
  const path=`/api/ai/jobs/${encodeURIComponent(job.id)}`;
  try{
    if(decision==='use-order'){
      const d=job.result?.orderDraft,form=$('#broker-order-form');if(!d||!['buy','sell'].includes(d.side)||!d.symbol||!d.qty||!d.limitPrice)throw new Error(financeText('aiDraftIncomplete'));
      form.elements.assetId.value='';form.elements.symbol.value='';form.elements.side.value=String(d.side);form.elements.qty.value=String(d.qty);form.elements.limitPrice.value=String(d.limitPrice);$('#broker-asset-search').elements.query.value=String(d.symbol);state.brokerSelectedAsset=null;location.hash='broker-sandbox';notify(financeText('aiDraftCopied'));return;
    }
    if(decision==='delete'){
      await api(path,{method:'DELETE'});if(!current())return;state.aiJob=null;$('#ai-status').textContent=financeText('aiDraftDeleted');$('#ai-actions').classList.add('hidden');return;
    }
    let candidate;
    if(decision==='cancel'){await api(path+'/cancel',{method:'POST'});if(!current())return;candidate=await api(path)}
    else candidate=await api(path+'/decision',{method:'POST',body:JSON.stringify({decision})});
    if(!current())return;
    if(!ownedAIReceipt(candidate,job.kind,job.id)||candidate.status!==({cancel:'cancelled',apply:'applied',reject:'rejected'})[decision])throw new Error(financeText('aiDraftIncomplete'));
    state.aiJob=candidate;renderAIJob();if(decision==='apply')await load();
  }catch(error){if(current())notifyKnownOrFailure(error,['aiDraftIncomplete'],'aiDraftFailed')}
  finally{if(ownedAIAction===operation){restoreOwnedAIAction(operation);ownedAIAction=null;if(contextCurrent()&&state.aiJob?.status==='running')pollAI()}}
}
$('#ai-start').addEventListener('click',startAI);$('#ai-actions').addEventListener('click',decideOwnedAI);
$('#ai-order-intent').addEventListener('submit',event=>{event.preventDefault();startAI()});
$('#ai-kind').addEventListener('change',()=>$('#ai-order-intent').classList.toggle('hidden',$('#ai-kind').value!=='draft_broker_order'));

let lastFinanceRoute=null;
function route(){
  const requested=(location.hash||'#overview').slice(1);
  const aliases={orders:'broker-sandbox',privacy:'settings',budgets:'planning',ai:'assistant',reports:'statements'};
  const known=new Set(['overview','assets','markets','broker-sandbox','strategies','planning','statements','assistant','settings','activity','support']);
  const target=requested==='wallet-connect'?'overview':aliases[requested]||requested;
  const section=known.has(target)?target:'overview';
  document.body.classList.toggle('finance-route-broker',section==='broker-sandbox');
  const privateSection=!['markets','broker-sandbox'].includes(section);
  let visible=section;
  if(!state.connected&&privateSection){
    visible=section==='overview'?'signed-out':'guest-gate';
    if(visible==='guest-gate'){
      const gate={
        assets:['assets','guestGateAssets'],strategies:['strategies','guestGateStrategies'],
        planning:['budgetsReports','guestGateBudgets'],statements:['statements','guestGateBudgets'],
        assistant:['ai','guestGateAI'],settings:['settings','guestGateSettings'],support:['support','guestGateSettings'],
        activity:['activity','guestGateAssets'],
      }[section]||['overview','guestGateAssets'];
      $('#guest-gate-heading').textContent=financeText(gate[0]);
      $('#guest-gate-description').textContent=financeText(gate[1]);
    }
  }
  // Account-read authorization is not native product authorization. Display
  // its real owned result without exposing native planning/order/write views.
  if(!state.connected&&['overview','assets','activity'].includes(section)&&($('#account-workspace')?.dataset.authorized==='true'||$('#account-workspace')?.dataset.recovering==='true'))visible='account-workspace';
  $$('.view').forEach(view=>view.classList.toggle('active-view',view.id===visible));
  if(section==='broker-sandbox'&&lastFinanceRoute!==section)requestAnimationFrame(()=>$('#broker-sandbox').scrollIntoView({block:'start'}));
  lastFinanceRoute=section;
  const active={"broker-sandbox":'orders',activity:'assets',statements:'planning',support:'settings'}[section]||section;
  $$('#nav a').forEach(link=>{const selected=link.hash===`#${active}`;link.classList.toggle('active',selected);if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
  $('#page-title').textContent=financeText('appName');
}
window.addEventListener('ynx-finance-standard-state',event=>{
  state.context++;clearInterval(state.aiTimer);walletIdentityState='identityUnverified';renderWalletIdentity();
  renderAccountSession();
  if(window.YNXFinanceWallet?.connected?.()&&!window.YNXFinanceWallet.privateAccountMatchesSelected?.())clearPrivateView({clearOpaquePending:false});
  const selected=event.detail;
  renderBrowserWalletIdentity();
  if(['explicit-local','permission-revoked','account-changed','chain-changed'].includes(selected?.disconnectReason)||loginIntent?.account&&loginIntent.account!==selected?.account)clearLoginIntent();
  if($('#wallet-picker').open&&pickerMethod){if(selected?.status==='connected'){clearPickerPair();pickerPhase=loginIntent?'pickerSigning':'pickerConnected';pickerCode='';renderWalletPicker();}else if(selected?.errorCode)pickerFailure(selected.errorCode);else if(selected?.status==='wrong-chain')pickerFailure('WRONG_NETWORK');else if(['permission-revoked','account-changed','chain-changed'].includes(selected?.disconnectReason))pickerFailure('WALLET_CONTEXT_CHANGED');}
  if(selected?.status==='connected'&&!browserWalletMismatch()){
    // Restored private authorization may arrive before provider discovery.
    // Its earlier read belongs to the previous context; resume only after the
    // restored selected account still matches that independently verified grant.
    if(window.YNXFinanceWallet.connected()&&window.YNXFinanceWallet.privateAccountMatchesSelected()){
      const intent=loginIntent,context=state.context;
      void load().then(()=>completeLoginTarget(intent,context));
    }
    void continueLoginIntent();
  }
  resumeDeferredBrowserIdentity();
});window.addEventListener('ynx-finance-private-state',event=>{if(event.detail?.approvalRejected===true||event.detail?.revocationConfirmed===true)clearLoginIntent();clearPrivateView({clearOpaquePending:['disconnected','guest'].includes(event.detail?.status)});if(event.detail?.status==='connected'&&!browserWalletMismatch()){const intent=loginIntent,context=state.context;load().then(()=>completeLoginTarget(intent,context))}resumeDeferredBrowserIdentity();});
window.addEventListener('ynx-finance-private-state',event=>{if(!$('#wallet-picker').open||!pickerMethod)return;const next=event.detail;if(pickerMethod==='mobile'&&['opening','pairing'].includes(window.YNXFinanceWallet.getPairState?.()?.status))return;if(next?.status==='connected'){pickerPhase='pickerApproved';renderWalletPicker();if(loginIntent)closeWalletPicker({completed:true});}else if(['checking','connecting'].includes(next?.status)){pickerPhase='pickerSigning';renderWalletPicker();}else if(next?.code||next?.lastCode)pickerFailure(next.code??next.lastCode);});
window.addEventListener('ynx-finance-pair-state',event=>{
  if(!$('#wallet-picker').open||pickerMethod!=='mobile')return;
  const next=event.detail;if(next.status==='opening'){
    // No URI means no Wallet proposal is available for user approval yet.
    // Transport telemetry must never remove an already rendered pairing.
    if(!$('#wallet-picker-qr').getAttribute('src')&&!$('#wallet-picker-deeplink').getAttribute('href')){pickerPhase='pickerOpening';renderWalletPicker();}
  }else if(next.status==='pairing'){
    pickerPhase='pickerScan';renderWalletPicker();clearPickerPair();
    if(typeof next.qrDataURL==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(next.qrDataURL)){$('#wallet-picker-qr').src=next.qrDataURL;$('#wallet-picker-qr').hidden=false;}
    if(typeof next.deeplink==='string'){try{const url=new URL(next.deeplink);if(url.protocol==='ynxwallet:'&&url.hostname==='wc'&&!url.username&&!url.password&&!url.port&&!url.hash&&[...url.searchParams.keys()].join(',')==='uri'){$('#wallet-picker-deeplink').href=next.deeplink;$('#wallet-picker-deeplink').hidden=false;}}catch{}}
    pickerExpiry=setTimeout(()=>{clearPickerPair();pickerFailure('PAIR_EXPIRED');void window.YNXFinanceWallet.cancelPair?.();},Math.max(0,Math.min(120000,next.expiresAt-Date.now())));
  }else if(next.status==='failed')pickerFailure(next.errorCode);else if(next.status==='cancel-unconfirmed'){pickerPhase='pickerCancelUnknown';pickerCode='PAIR_CANCEL_UNCONFIRMED';clearPickerPair();renderWalletPicker();}
});
document.addEventListener('finance:localechange',()=>{renderWalletPicker();renderBrowserWalletIdentity();if(!browserIdentity&&$('#browser-signin-state').textContent)$('#browser-signin-state').textContent=financeText('browserSignInBoundary');});
window.addEventListener('hashchange',route);window.addEventListener('online',reconnect);window.addEventListener('offline',()=>sourceStatus('offlineRetry','warning'));$$('.connect').forEach(b=>b.addEventListener('click',signIn));$('#signin').addEventListener('click',event=>showWalletPicker(event.currentTarget,{login:true}));$('#logout').addEventListener('click',logout);$('#refresh').addEventListener('click',load);$('#network-retry').addEventListener('click',reconnect);
function handleWalletEntry(event){
 if(window.YNXFinanceWallet.getStandardWalletState()?.status==='connected'){const details=$('#wallet-connection-details');details.open=true;details.querySelector('summary')?.focus();return;}
 showWalletPicker(event.currentTarget);
}
$('#wallet-entry').addEventListener('click',handleWalletEntry);
for(const [method,id]of Object.entries(pickerButtons))$(id).addEventListener('click',()=>choosePickerMethod(method));
$('#wallet-picker-back').addEventListener('click',()=>{++pickerEpoch;pickerPending=null;clearPickerPair();if(loginOperation&&!window.YNXFinanceWallet.connected()){clearLoginIntent();void window.YNXFinanceWallet.disconnect();}if(window.YNXFinanceWallet.getStandardWalletState().status==='connecting'){if(pickerMethod==='mobile')void window.YNXFinanceWallet.cancelPair?.();else window.YNXFinanceWallet.disconnectStandardWallet();}pickerMethod=null;renderWalletPicker();$('#picker-ynx').focus();});
$('#wallet-picker-action').addEventListener('click',()=>{if(['pickerConnected','pickerApproved'].includes(pickerPhase))closeWalletPicker({completed:true});else if(pickerPhase!=='pickerCancelUnknown')void choosePickerMethod(pickerMethod);else $('#wallet-picker-back').click();});
$('#wallet-picker-close').addEventListener('click',()=>closeWalletPicker({cancel:true}));
$('#wallet-picker').addEventListener('cancel',event=>{event.preventDefault();closeWalletPicker({cancel:true})});
$('#workspace-data-retry').addEventListener('click',()=>{const intent=loginIntent,context=state.context;load().then(()=>completeLoginTarget(intent,context))});
for(const element of $$('[href="#wallet-connect"]'))element.addEventListener('click',event=>{event.preventDefault();showWalletPicker(event.currentTarget,{login:element.dataset.financeI18n==='signIn'||element.closest('#guest-gate')!==null,target:element.dataset.financeI18n==='signIn'?'planning':loginTarget()})});
try{const saved=JSON.parse(sessionStorage.getItem(LOGIN_INTENT_KEY)||'null');if(location.pathname==='/wallet-auth/callback'&&LOGIN_ROUTES.has(saved?.target))loginIntent={target:saved.target,account:null,providerKind:null};else sessionStorage.removeItem(LOGIN_INTENT_KEY)}catch{}
$('#wallet-login-verify').addEventListener('click',verifyWalletIdentity);
window.addEventListener('ynx-finance-account-session',renderAccountSession);
$('#browser-signin-start')?.addEventListener('click',event=>{if(!browserSSOEnabled){event.preventDefault();return;}browserIdentityExplicitIntent=true;++browserSSOIntentGeneration;browserSSORevision++;event.currentTarget.href=`/sso/start?target=${encodeURIComponent(loginTarget())}`;});
$('#browser-signin-logout')?.addEventListener('click',logoutBrowserIdentity);

window.addEventListener('focus',()=>void recheckBrowserIdentity());document.addEventListener('visibilitychange',()=>{if(!document.hidden)void recheckBrowserIdentity()});void initializeBrowserIdentity();
document.addEventListener('finance:localechange',renderAccountSession);
$('#account-session-refresh')?.addEventListener('click',()=>window.YNXFinanceEVMRead.read());
$('#account-session-logout')?.addEventListener('click',()=>window.YNXFinanceEVMRead.revoke());
setInterval(()=>{const session=window.YNXFinanceEVMRead?.state();if($('#account-workspace')?.dataset.authorized==='true'&&Date.parse(session?.expiresAt)<=Date.now())renderAccountSession()},1000);
const now=new Date(),monthAgo=new Date(Date.now()-30*864e5);$('#statement-form [name=from]').value=monthAgo.toISOString().slice(0,10);$('#statement-form [name=to]').value=now.toISOString().slice(0,10);
renderBrokerSnapshot();$('#broker-order-preview').textContent=financeText(brokerApprovalMessageKey);
route();consumeCallback().then(load).then(()=>{if(!state.connected)return publicHealth()}).catch(error=>notify(error.message,true));
document.querySelector('#broker-refresh').addEventListener('click',async()=>{await refreshBrokerConfiguration();await refreshBrokerSnapshot();await refreshBrokerWorkspace()});
$('#broker-reconcile').addEventListener('click',reconcileBroker);
$('#broker-asset-search').addEventListener('submit',searchBrokerAssets);
$('#broker-asset-results').addEventListener('click',async event=>{const selectId=event.target.dataset.brokerSelect,watchId=event.target.dataset.brokerWatch;if(selectId){try{selectBrokerAsset(state.brokerAssets.get(selectId))}catch(error){notify(error.message,true)}}else if(watchId){try{await updateBrokerWatchlist(state.brokerAssets.get(watchId),true)}catch(error){notify(error.message,true)}}});
$('#broker-watchlist').addEventListener('click',async event=>{const selectId=event.target.dataset.brokerWatchSelect,removeId=event.target.dataset.brokerUnwatch;if(selectId){try{const item=state.brokerWatchlist.get(selectId);selectBrokerAsset({id:item.assetId,symbol:item.symbol,name:item.name})}catch(error){notify(error.message,true)}}else if(removeId){try{await updateBrokerWatchlist(state.brokerWatchlist.get(removeId),false)}catch(error){notify(error.message,true)}}});
$('#broker-local-orders').addEventListener('click',async event=>{const refreshId=event.target.dataset.brokerOrderRefresh,cancelId=event.target.dataset.brokerOrderCancel,executeId=event.target.dataset.brokerOrderExecute;if(refreshId){await refreshBrokerExecutionStatus(refreshId)}else if(executeId){await requestBrokerExecution(executeId)}else if(cancelId){await requestBrokerCancel(cancelId)}});
$('#broker-order-form').addEventListener('submit',createBrokerApproval);
$('#broker-wallet-approve').addEventListener('click',async event=>{
  const link=event.currentTarget,reviewURL=link.dataset.walletReviewUrl;
  if(!reviewURL)return;
  event.preventDefault();
  try{
    if(!window.YNXFinanceOpaqueOrder||reviewURL!==window.YNXFinanceOpaqueOrder.launchURL(reviewURL.split('?ticket=')[1]||''))throw new Error('Invalid review link');
  }catch{notify(financeText('walletReviewInvalid'),true);return}
  try{await navigator.clipboard.writeText(reviewURL);notify(financeText('walletReviewCopied'))}
  catch{notify(financeText('walletReviewClipboardUnavailable'),true)}
});
$('#broker-quote').addEventListener('click',refreshBrokerQuote);
$('#broker-complete-callback').addEventListener('click',completeBrokerCallback);
$('#broker-clear-approval').addEventListener('click',async()=>{try{const workspace=await refreshBrokerWorkspace();if(!workspace)throw new Error('Current Finance server time is unavailable.');const route=await restoreBrokerApproval(workspace.serverTime,{announce:true});if(!route)hideBrokerApproval()}catch(error){notify(error.message,true)}});
refreshBrokerConfiguration();

async function attestBrowserIdentityActivity(action,event,revision=browserSSOIntentGeneration){
 if(!browserSSOFinite||!event?.isTrusted||!browserIdentity||browserIdentityLogoutPending||revision!==browserSSOIntentGeneration||!['navigate','save'].includes(action))return;
 const current=browserIdentity,raw=crypto.getRandomValues(new Uint8Array(32));
 const eventId=btoa(String.fromCharCode(...raw)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 try{await browserSSOFetch('/api/sso/activity',{method:'POST',headers:{'content-type':'application/json','X-YNX-SSO-CSRF':current.csrfToken},body:JSON.stringify({eventId,action,observedAt:new Date(Date.now()+browserSSOClockOffset).toISOString()})});}catch{}
}
async function logoutBrowserIdentity(){
 const current=browserIdentityLogoutPending||browserIdentity;if(!current)return;
 const button=$('#browser-signin-logout');if(button.disabled)return;
 browserIdentityLogoutPending=current;++browserSSOIntentGeneration;browserIdentityExplicitIntent=true;browserIdentityRestoreDeferred=false;++browserSSORevision;browserIdentity=null;
 clearLoginIntent();clearPrivateView();renderBrowserWalletIdentity();button.hidden=false;button.disabled=true;
 try{const {response,data}=await browserSSOFetch('/api/sso/logout',{method:'POST',headers:{'content-type':'application/json','X-YNX-SSO-CSRF':current.csrfToken},body:'{}'});
  if(!response.ok||data.revoked!==true)throw new Error('unconfirmed');
  ++browserSSORevision;browserIdentityLogoutPending=null;renderBrowserWalletIdentity();button.hidden=true;$('#browser-signin-state').textContent=financeText('browserSignInBoundary');browserSSOChannel?.postMessage({type:'recheck'});await window.YNXFinanceWallet.disconnect();
 }catch{notify(financeText('privateLogoutUnconfirmed'),true);}finally{button.disabled=false;}
}
document.addEventListener('click',event=>{
 if(!event.isTrusted||event.defaultPrevented)return;
 const link=event.target.closest?.('a[href]');if(!link||!link.closest('nav'))return;
 const target=link.getAttribute('href');if(!['#overview','#assets','#markets','#orders','#strategies','#planning','#assistant','#settings'].includes(target)||target===location.hash)return;
 void attestBrowserIdentityActivity('navigate',event);
});
