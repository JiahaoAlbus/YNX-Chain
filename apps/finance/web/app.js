const state={connected:false,overview:null,aiJob:null,aiTimer:null,context:0,brokerAssets:new Map(),brokerWatchlist:new Map(),brokerSelectedAsset:null,brokerSubmissionEnabled:false};
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
function renderWalletIdentity(){const status=document.querySelector('#wallet-login-state'),button=document.querySelector('#wallet-login-verify');if(status)status.textContent=financeText(walletIdentityState);if(button){button.hidden=window.YNXFinanceWallet?.getStandardWalletState?.()?.status!=='connected';button.disabled=walletIdentityBusy;}}
let brokerConfigurationState='brokerStatusMissing';
function renderBrokerConfigurationStatus(){const target=document.querySelector('#broker-status');if(target)target.textContent=financeText(brokerConfigurationState)}
let brokerDiagnosticsState={approval:false,journal:false};
function renderBrokerDiagnostics(){const approval=document.querySelector('#broker-approval'),journal=document.querySelector('#broker-journal');if(approval)approval.textContent=financeText(brokerDiagnosticsState.approval?'brokerApprovalAvailable':'brokerApprovalUnavailable');if(journal)journal.textContent=financeText(brokerDiagnosticsState.journal?'brokerJournalAvailable':'brokerJournalUnavailable')}
document.addEventListener('finance:localechange',()=>{renderBrokerConfigurationStatus();renderBrokerDiagnostics();renderWalletIdentity();renderBrokerSnapshot();renderSourceStatus();renderBrokerQuote();renderBrokerWorkspace(brokerWorkspaceDisplay);if(brokerApprovalDisplay)renderBrokerApprovalRoute(brokerApprovalDisplay.route,brokerApprovalDisplay.recovered);else if(brokerApprovalMessageKey)$('#broker-order-preview').textContent=financeText(brokerApprovalMessageKey);if(brokerAssetResults!==null)renderBrokerAssets(brokerAssetResults);if(!state.connected)route()});
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
let brokerAssetResults=null,brokerAssetSearchRevision=0,brokerAssetSearchController=null;
function renderBrokerAssets(assets){
  brokerAssetResults=assets;
  state.brokerAssets=new Map(assets.map(asset=>[asset.id,asset]));
  $('#broker-asset-results').innerHTML=assets.length?assets.map(asset=>`<div class="row"><div class="row-main"><strong>${esc(asset.symbol)}</strong><small>${esc(asset.name)} · ${esc(financeText('brokerActiveAsset'))}</small></div><div class="wallet-choice"><button type="button" data-broker-select="${esc(asset.id)}">${esc(financeText('brokerSelect'))}</button>${state.connected?`<button type="button" data-broker-watch="${esc(asset.id)}">${esc(financeText('brokerAddWatch'))}</button>`:''}</div></div>`).join(''):`<div class="empty compact">${esc(financeText('brokerNoAssets'))}</div>`;
}
async function searchBrokerAssets(event){
  event?.preventDefault();const query=String(new FormData($('#broker-asset-search')).get('query')||'').trim();
  const revision=++brokerAssetSearchRevision;
  brokerAssetSearchController?.abort();const controller=new AbortController();brokerAssetSearchController=controller;
  const timer=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(`/api/broker/assets?query=${encodeURIComponent(query)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),result=await response.json();if(!response.ok||result?.schema!=='ynx-finance-broker-assets-v1'||!Array.isArray(result.assets))throw new Error('Sandbox asset directory is unavailable.');if(revision===brokerAssetSearchRevision)renderBrokerAssets(result.assets)}catch{if(revision===brokerAssetSearchRevision){renderBrokerAssets([]);notify(financeText('brokerAssetsUnavailable'),true)}}finally{clearTimeout(timer);if(revision===brokerAssetSearchRevision)brokerAssetSearchController=null}
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
async function refreshBrokerSnapshot(){
  if(!state.connected){brokerSnapshotState={kind:'guest'};renderBrokerSnapshot();return}
  try{
    const result=await api('/api/broker/snapshot');
    const snapshot=result?.schema==='ynx-finance-broker-snapshot-v1'?result.snapshot:null;
    if(!snapshot||snapshot.provider!=='alpaca_broker'||snapshot.environment!=='sandbox'||!Array.isArray(snapshot.orders)||!Array.isArray(snapshot.positions)||snapshot.account?.currency!=='USD')throw Object.assign(new Error('Broker Sandbox returned an invalid account snapshot.'),{nonRetryable:true});
    brokerSnapshotState={kind:'data',snapshot};renderBrokerSnapshot();
  }catch(error){
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
function renderBrokerWorkspace(workspace){
  brokerWorkspaceDisplay=workspace;
  const orders=Array.isArray(workspace?.orders)?workspace.orders:[];
  const outbox=new Map((Array.isArray(workspace?.outbox)?workspace.outbox:[]).map(item=>[item.orderId,item]));
  $('#broker-local-orders').innerHTML=brokerWorkspaceUnavailable?`<div class="empty compact">${esc(financeText('brokerLocalOrdersUnavailable'))}</div>`:orders.length?orders.map(record=>{
    const queued=outbox.get(record.order.orderId),attempted=Boolean(record.cancelAttemptedAt);
    const cancelable=['submitted','partially_filled'].includes(record.state)&&!attempted;
    const executable=state.brokerSubmissionEnabled&&record.approvalState==='consumed'&&queued?.status==='pending_unwired';
    const cancelState=attempted&&['cancel_requested','partially_filled'].includes(record.state)?'brokerCancelReconcile':record.state==='cancel_requested'?(record.cancelIntentAt?'brokerCancelQueued':'brokerCancelLegacy'):null;
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
  $('#broker-order-preview').innerHTML=order?`<strong>${esc(brokerWorkflowLabel(order.side))} ${esc(order.qty)} ${esc(order.symbol)} @ ${esc(order.limitPrice)} ${esc(financeText('brokerSimulatedUSD'))}</strong><br>${esc(financeText('brokerPreviewMaximum'))}: ${esc(order.maxCost)} USD · ${esc(financeText('brokerPreviewFee'))} ${esc(order.maxFee)} USD · ${esc(financeText('brokerPreviewExpires'))} ${esc(unsigned.expiresAt)}<br><small>${esc(financeText('brokerPreviewRequest'))} ${esc(short(unsigned.requestId))}. ${esc(financeText(recovered?'brokerRecovered':'brokerProviderNotContacted'))}</small>`:
    `${esc(financeText('brokerConfidentialPending'))} · ${esc(financeText('brokerPreviewExpires'))} ${esc(unsigned.expiresAt)}. ${esc(financeText('brokerConfidentialNoStorage'))}`;
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
  if(!legacyPending)return null;
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
    $('#broker-order-preview').textContent='Order actions are unavailable until the shared authority verifies both Wallet Gateway and Finance Product Session.';
    $('#broker-wallet-approve').hidden=true;
    throw error;
  }
}
async function requestBrokerExecution(orderId){
  try{await requireBrokerOrderAuthority();if(!state.brokerSubmissionEnabled)throw new Error('Controlled Sandbox execution is disabled by server policy.');if(!window.confirm('Queue this already approved Sandbox order for the controlled worker? The browser never contacts the provider directly.'))return;const idempotencyKey=`finance-execution-${orderId}`,result=await api(`/api/broker/orders/${encodeURIComponent(orderId)}/execution-request`,{method:'POST',body:JSON.stringify({idempotencyKey})});if(result?.schema!=='ynx-finance-broker-execution-request-v1'||result.providerWriteAttempted!==false)throw new Error('Execution request response is invalid.');notify('Controlled execution request queued once. Refresh shows provider status; no success is implied.');await refreshBrokerWorkspace()}catch(error){notify(error.message,true)}
}
async function refreshBrokerExecutionStatus(orderId){
  try{
    const result=await api(`/api/broker/orders/${encodeURIComponent(orderId)}/execution-status`),outbox=result?.outbox;
    if(result?.schema!=='ynx-finance-broker-execution-status-v1'||result.providerWriteAttempted!==false||outbox?.orderId!==orderId||typeof outbox.status!=='string')throw new Error('Execution status response is invalid.');
    notify(`Execution status: ${outbox.status}. This read did not reconcile the provider or submit an order.`);
    await refreshBrokerWorkspace();
  }catch(error){notify(error.message,true)}
}
async function refreshBrokerWorkspace(){
  if(!state.connected){brokerWorkspaceUnavailable=false;renderBrokerWorkspace(null);return null}
  try{const result=await api('/api/broker/orders');if(result?.schema!=='ynx-finance-broker-workspace-v1'||typeof result.workspace?.serverTime!=='string')throw new Error('Broker workspace response is invalid.');brokerWorkspaceUnavailable=false;renderBrokerWorkspace(result.workspace);return result.workspace}catch{brokerWorkspaceUnavailable=true;renderBrokerWorkspace(null);return null}
}
async function createBrokerApproval(event){
  event.preventDefault();
  if(brokerApprovalInFlight){notify('A Wallet order request is already being created. Wait for that exact request to finish.',true);return}
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
    renderBrokerApprovalRoute(route);notify('Opaque review ticket created. Copy the link to YNX Wallet; this Web page will not launch a custom scheme or submit to the Broker.');await refreshBrokerWorkspace();
  }catch(error){notify(error.message,true)}finally{brokerApprovalInFlight=false;if(submit){submit.disabled=wasDisabled;submit.removeAttribute('aria-busy')}}
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
  const symbol=String(new FormData($('#broker-order-form')).get('symbol')||'').toUpperCase();
  if(!state.brokerSelectedAsset||state.brokerSelectedAsset.symbol!==symbol){brokerQuoteDisplay={kind:'unavailable'};renderBrokerQuote();return}
  const revision=++brokerQuoteRevision;brokerQuoteController?.abort();const controller=new AbortController();brokerQuoteController=controller;
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(`/api/broker/quote?symbol=${encodeURIComponent(symbol)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),result=await response.json(),quote=result?.quote;
    const decimal=/^-?(?:0|[1-9][0-9]{0,31})(?:\.[0-9]{1,18})?$/;
    if(!response.ok||result?.schema!=='ynx-finance-broker-quote-v1'||result.source!=='alpaca_market_data_sandbox'||result.officialSandboxVerified!==false||quote?.symbol!==symbol||!decimal.test(quote?.bidPrice||'')||!decimal.test(quote?.askPrice||'')||!['iex','sample'].includes(quote?.feed)||!['real_time','delayed','stale','sample'].includes(result.quoteState)||!Number.isFinite(Date.parse(quote?.timestamp)))throw new Error('BROKER_QUOTE_UNVERIFIED');
    if(revision===brokerQuoteRevision&&state.brokerSelectedAsset?.symbol===symbol){brokerQuoteDisplay={kind:'data',quote,quoteState:result.quoteState};renderBrokerQuote()}
  }catch{if(revision===brokerQuoteRevision){brokerQuoteDisplay={kind:'unavailable'};renderBrokerQuote()}}
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
      notify(result.status==='approved'?'Wallet approval queued one local Sandbox outbox. Provider submission has not occurred.':'Wallet decision recorded without a provider order.');
      await refreshBrokerWorkspace();return;
    }
    const workspace=await refreshBrokerWorkspace();if(!workspace)throw new Error('Current Finance server time is unavailable.');
    const raw=await window.YNXFinanceOrderWallet.parseReturn(pendingLegacyBrokerReturnURL,workspace.serverTime);
    const result=await api('/api/broker/callback',{method:'POST',body:raw});
    if(result?.schema!=='ynx-finance-order-approval-consume-v1'||result.providerWriteAttempted!==false)throw new Error('Finance order callback response is invalid.');
    window.YNXFinanceOrderWallet.clear();pendingLegacyBrokerReturnURL=null;history.replaceState(null,'','/');hideBrokerApproval();$('#broker-complete-callback').hidden=true;notify(result.status==='approved'?'Wallet approval consumed into the durable local outbox. Broker submission remains disabled.':'Wallet decision recorded. No broker submission occurred.');await refreshBrokerWorkspace();
  }catch(error){notify(error.message,true)}finally{brokerCallbackInFlight=false}
}
const READ_RETRY_DELAYS=[0,600,1600];
const $=(s)=>document.querySelector(s),$$=(s)=>[...document.querySelectorAll(s)];
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=v=>Number.isSafeInteger(v)&&v>=0?new Intl.NumberFormat(window.YNXFinanceLocale?.get()||'en').format(v):financeText('unknown');
const short=(v)=>v?`${v.slice(0,8)}…${v.slice(-6)}`:'—';
const date=(v)=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat(window.YNXFinanceLocale?.get()||'en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):financeText('dateUnavailable');

const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
let sourceStatusState={key:'notConnected',className:'neutral',attempt:0,total:0};
function renderSourceStatus(){const {key,className,attempt,total}=sourceStatusState;$('#source-pill').textContent=key==='reconnecting'?`${financeText(key)} ${attempt}/${total}`:financeText(key);$('#source-pill').className=`pill ${className}`}
function sourceStatus(key,className='neutral',attempt=0,total=0){sourceStatusState={key,className,attempt,total};renderSourceStatus()}
async function publicHealth(){for(let attempt=0;attempt<READ_RETRY_DELAYS.length;attempt++){if(attempt){sourceStatus('reconnecting','warning',attempt,READ_RETRY_DELAYS.length-1);await wait(READ_RETRY_DELAYS[attempt])}try{const response=await fetch('/health',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000)}),body=await response.json();if(!response.ok||body.ok!==true||body.chainId!=='ynx_6423-1'||body.portfolio!=='read-only')throw Object.assign(new Error(`Finance health check failed (${response.status})`),{status:response.status});sourceStatus(state.connected?'privateFinanceReachable':'publicFinanceReachable','live');return body}catch(error){if(error?.status||attempt===READ_RETRY_DELAYS.length-1){sourceStatus('connectionUnavailable','warning');throw error}}}throw new Error('Public connection retry exhausted.')}
async function api(path,options={}){
  const context=state.context,walletRevision=window.YNXFinanceWallet.getRevision();
  const assertCurrent=()=>{if(context!==state.context||walletRevision!==window.YNXFinanceWallet.getRevision())throw Object.assign(new Error('FINANCE_CONTEXT_CHANGED: Discarded a response from an older account or connection.'),{nonRetryable:true})};
  const method=String(options.method||'GET').toUpperCase(),readOnly=method==='GET',attempts=readOnly?READ_RETRY_DELAYS.length:1;
  for(let attempt=0;attempt<attempts;attempt++){
    if(attempt){sourceStatus('reconnecting','warning',attempt,attempts-1);await wait(READ_RETRY_DELAYS[attempt])}
    try{
      const headers={'Content-Type':'application/json',...(options.headers||{})};try{const authorization=await window.YNXFinanceWallet.requireProof(scope(path));assertCurrent();if(!authorization?.proofHeader||!authorization?.requestId)throw new Error('PRIVATE_SERVICE_DEGRADED: Fresh v2 proof is unavailable.');headers['X-YNX-Product-Session-Proof-V2']=authorization.proofHeader;headers['X-Request-ID']=authorization.requestId}catch(error){error.nonRetryable=true;throw error}
      const response=await fetch(path,{...options,method,headers,signal:AbortSignal.timeout(10_000)});assertCurrent();if(response.status===204){sourceStatus('privateFinanceReachable','live');return null}const type=response.headers.get('content-type')||'',body=options.responseType==='blob'&&response.ok?await response.blob():type.includes('json')?JSON.parse(await response.text()):await response.text();assertCurrent();
      if(!response.ok){const error=new Error(body.error||`Request failed (${response.status})`);error.code=body.code;error.status=response.status;if(!readOnly||![502,503,504].includes(response.status)||attempt===attempts-1)throw error;continue}
      sourceStatus('privateFinanceReachable','live');return body
    }catch(error){if(!readOnly||error?.status||error?.nonRetryable||attempt===attempts-1){if(!error?.nonRetryable&&(!error?.status||[502,503,504].includes(error.status)))sourceStatus('connectionUnavailable','warning');throw error}}
  }
  throw new Error('Read connection retry exhausted.')
}
function scope(path){if(path.startsWith('/api/ai/'))return'finance.ai.draft';if(['/api/categories','/api/budgets','/api/reminders','/api/notes','/api/privacy','/api/account','/api/broker/challenges','/api/broker/callback','/api/broker/order-handoff/issue','/api/broker/order-handoff/exchange','/api/broker/watchlist','/api/broker/reconcile'].some(v=>path.startsWith(v))||/^\/api\/broker\/orders\/[^/]+\/(?:cancel-request|execution-request)$/.test(path)||path.includes('/category'))return'finance.profile.write';return'finance.portfolio.read'}
function notify(message,error=false){const box=$('#notice');box.textContent=message;box.classList.toggle('error',error);box.classList.remove('hidden');clearTimeout(box.timer);box.timer=setTimeout(()=>box.classList.add('hidden'),6500)}

async function signIn(){try{await window.YNXFinanceWallet.connect()}catch(error){notify(error.message,true)}}
async function verifyWalletIdentity(){
  if(walletIdentityBusy)return;
  const wallet=window.YNXFinanceWallet,selected=wallet.getStandardWalletState(),revision=wallet.getStandardRevision();
  if(selected.status!=='connected'||selected.chainId!=='0x1917'||!selected.account){walletIdentityState='identityRejected';renderWalletIdentity();return}
  walletIdentityBusy=true;walletIdentityState='identityChecking';renderWalletIdentity();
  let requestId='';
  const unchanged=()=>{const current=wallet.getStandardWalletState();if(wallet.getStandardRevision()!==revision||current.status!=='connected'||current.account!==selected.account||current.providerKind!==selected.providerKind||current.chainId!=='0x1917')throw new Error('WALLET_CONTEXT_CHANGED')};
  try{
    const issue=await fetch('/api/wallet-login/challenges',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:selected.account,providerKind:selected.providerKind}),signal:AbortSignal.timeout(10000)});
    const issued=await issue.json();unchanged();
    if(!issue.ok||issued?.schemaVersion!=='finance-evm-login-challenge-v1'||issued?.privateFinanceAuthorized!==false||issued.challenge?.account!==selected.account||issued.challenge?.providerKind!==selected.providerKind||issued.challenge?.chainId!==6423||issued.challenge?.productId!=='finance'||JSON.stringify(issued.challenge?.scopes)!=='["finance.account.read"]'||!/^finance-login-[0-9a-f]{32}$/.test(issued.challenge?.requestId||'')||issued.signingRequest?.method!=='personal_sign')throw new Error('WALLET_LOGIN_CHALLENGE_UNAVAILABLE');
    requestId=issued.challenge.requestId;
    try{sessionStorage.setItem('ynx.finance.evm-login.pending.v1',JSON.stringify({requestId,account:selected.account,providerKind:selected.providerKind,expiresAt:issued.challenge.expirationTime}))}catch{}
    const signature=await wallet.signEVMLoginRequest(issued.signingRequest);unchanged();
    const verify=await fetch('/api/wallet-login/verify',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof:{challenge:issued.challenge,message:issued.signingRequest.message,signature}}),signal:AbortSignal.timeout(10000)});
    const result=await verify.json();unchanged();
    if(!verify.ok||result?.schemaVersion!=='finance-evm-login-verification-v1'||result.verified!==true||result.account!==selected.account||result.providerKind!==selected.providerKind||result.chainId!==6423||JSON.stringify(result.scopes)!=='["finance.account.read"]'||result.requestId!==requestId||result.privateFinanceAuthorized!==false||result.standardWalletUnchanged!==true)throw new Error('WALLET_LOGIN_VERIFICATION_REJECTED');
    walletIdentityState='identityVerified';
  }catch(error){walletIdentityState='identityRejected';notify(`${financeText('identityRejected')} ${error?.code||error?.message||''}`.trim(),true)}
  finally{if(requestId){try{const pending=JSON.parse(sessionStorage.getItem('ynx.finance.evm-login.pending.v1')||'null');if(pending?.requestId===requestId)sessionStorage.removeItem('ynx.finance.evm-login.pending.v1')}catch{}}walletIdentityBusy=false;renderWalletIdentity()}
}
async function consumeCallback(){await window.YNXFinanceWallet.ready}
function clearPrivateView({clearOpaquePending=true}={}){state.context++;clearInterval(state.aiTimer);state.aiJob=null;state.overview=null;state.connected=false;if(clearOpaquePending){sessionStorage.removeItem(OPAQUE_ORDER_PENDING_KEY);window.YNXFinanceOrderWallet?.clear()}hideBrokerApproval();for(const id of ['account','balance','staked','balance-source','statement','ai-status']){const element=$('#'+id);if(element)element.textContent='—'}brokerSnapshotState={kind:'guest'};brokerWorkspaceUnavailable=false;renderBrokerSnapshot();renderBrokerWorkspace(null);renderSignedOut()}
async function logout(){const result=await window.YNXFinanceWallet.disconnect();if(result?.status==='disconnected'){clearPrivateView()}else notify(financeText('privateLogoutUnconfirmed'),true)}
function renderSignedOut(){document.body.classList.add('signed-out-state');$('#signed-out').classList.remove('hidden');$('#workspace').classList.add('hidden');$('#signin').classList.add('hidden');$('#logout').classList.add('hidden');sourceStatus('notConnected');$('#page-title').textContent=financeText('pageTitle');route()}

async function load(){await window.YNXFinanceWallet.ready;state.connected=window.YNXFinanceWallet.connected();if(!state.connected){renderSignedOut();return}try{sourceStatus('checkingSources');const data=await api('/api/overview');state.overview=data;reconcileOpaqueBrokerOwner();render(data)}catch(error){if(error.status===401||error.status===403){window.YNXFinanceWallet.reportPrivateFailure();clearPrivateView();notify(financeText('privateReauthorize'),true)}else notify(error.message,true)}}
async function reconnect(){try{await publicHealth();if(state.connected)await load()}catch(error){notify(error.message,true)}}
function render(data){document.body.classList.remove('signed-out-state');$('#signed-out').classList.add('hidden');$('#workspace').classList.remove('hidden');$('#signin').classList.add('hidden');$('#logout').classList.remove('hidden');const p=data.portfolio,profile=data.profile;$('#account').textContent=p.account;$('#balance').textContent=p.explorerStatus.available?`${fmt(p.balanceYnxt)} YNXT`:'Unavailable';$('#staked').textContent=p.explorerStatus.available?`${fmt(p.stakedYnxt)} YNXT`:'Unavailable';$('#balance-source').textContent=p.explorerStatus.available?`Explorer evidence · ${date(p.asOf)}`:p.explorerStatus.error;const both=p.explorerStatus.available&&p.payStatus.available;sourceStatus(both?'sourcesLive':p.explorerStatus.available?'explorerLivePayUnavailable':'sourcesUnavailable',both?'live':'warning');renderAlerts(data.alerts);renderActivity(p.activity);renderReceipts(p.payReceipts,p.payStatus);renderPlanning(profile,data.budgetProgress);renderPrivacy(profile.privacy);renderAIRecords(p.activity);renderSupport(data.support);refreshBrokerSnapshot();refreshBrokerWorkspace().then(async workspace=>{if(workspace)try{await restoreBrokerApproval(workspace.serverTime)}catch(error){notify(error.message,true)}await completeBrokerCallback()});route()}
function renderAlerts(alerts){const el=$('#alerts');if(!alerts.length){el.innerHTML='<div class="alert info"><div><strong>No source or rule alerts</strong><small>Finance alerts are informational and never freeze assets.</small></div></div>';return}el.innerHTML=alerts.map(a=>`<div class="alert ${a.severity==='info'?'info':''}"><div><strong>${esc(a.title)}</strong><small>${esc(a.detail)}</small></div></div>`).join('')}
function activityRow(a){const sign=a.direction==='outgoing'?'-':'+';return `<div class="row"><div class="row-main"><strong>${esc(a.type||'YNXT activity')}</strong><small>${esc(date(a.timestamp))} · ${esc(short(a.id))}</small></div><div class="row-value">${sign}${fmt(a.amountYnxt)} YNXT<small>fee ${fmt(a.feeYnxt)}</small></div></div>`}
function renderActivity(items){$('#recent-activity').innerHTML=items.length?items.slice(0,5).map(activityRow).join(''):'<div class="empty compact">No owned indexed activity was returned. Nothing has been invented.</div>';$('#activity-body').innerHTML=items.map(a=>`<tr><td>${esc(date(a.timestamp))}</td><td>${esc(a.type)}</td><td>${esc(a.direction)}</td><td class="num">${fmt(a.amountYnxt)} YNXT</td><td class="num">${fmt(a.feeYnxt)}</td><td><span class="evidence">${esc(short(a.id))}</span></td></tr>`).join('');$('#activity-empty').classList.toggle('hidden',items.length>0);$('#activity-empty').textContent='No owned YNXT activity is available from Explorer.'}
function renderReceipts(items,status){const el=$('#recent-receipts');if(!status.available){el.innerHTML=`<div class="empty compact">${esc(status.error)}. No receipt placeholders are shown.</div>`;return}el.innerHTML=items.length?items.slice(0,5).map(r=>`<div class="row"><div class="row-main"><strong>${esc(r.status||'Pay record')}</strong><small>${esc(date(r.createdAt))} · ${esc(short(r.transactionHash||r.id))}</small></div><div class="row-value">${fmt(r.amountYnxt)} YNXT${r.disputeUrl?`<small><a href="${esc(r.disputeUrl)}" rel="noreferrer">Dispute link</a></small>`:''}</div></div>`).join(''):'<div class="empty compact">Pay is available, but returned no receipts owned by this account.</div>'}
// The bounded activity API cannot prove a full-period total. Do not coerce
// missing progress to zero or render a percentage of an unknown total.
function budgetAmount(value){return Number.isSafeInteger(value)&&value>=0?`${new Intl.NumberFormat().format(value)} YNXT`:'Unknown (exact amount unavailable)'}
function budgetProgressRow(b,progress){
  const p=progress?.budgetId===b.id?progress:null;
  const observed=p?.calculationStatus==='partial'&&p.coverageComplete===false?budgetAmount(p.observedSpentYnxt):'Unknown';
  const period=p?.periodTimezone==='UTC'&&p.periodStart?String(p.periodStart):'Unknown';
  const effective=p?.effectiveFrom?String(p.effectiveFrom):'Unknown';
  const status=p?.calculationStatus==='not-started'?'Budget has not started':p?.calculationStatus==='partial'?'Partial observation · full history unavailable':'Source or exact calculation unavailable';
  return `<div class="row"><div class="row-main"><strong>${esc(b.name)}</strong><small>${esc(b.period)} · planning only · UTC</small><small>Period start: ${esc(period)} · Count from: ${esc(effective)}</small><small>${esc(status)}</small><small>${esc(p?.coverage||'No complete period history was supplied.')}</small></div><div class="row-value">Limit: ${budgetAmount(b.limitYnxt)}<small>Observed spending: ${observed}</small><small>Full-period spending: Unknown</small><small>Remaining budget: Unknown</small></div></div>`;
}
function renderPlanning(profile,progress=[]){$('#categories').innerHTML=profile.categories.length?profile.categories.map(c=>`<span><i class="chip-dot"></i>${esc(c.name)} <small>${esc(c.color)}</small></span>`).join(''):'<span>No categories yet</span>';const options='<option value="">Choose category</option>'+profile.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('#budget-form select[name=categoryId]').innerHTML=options;$('#budgets').innerHTML=profile.budgets.length?profile.budgets.map(b=>budgetProgressRow(b,Array.isArray(progress)?progress.find(p=>p.budgetId===b.id):null)).join(''):'<div class="empty compact">Create a budget after adding a category.</div>';$('#reminders').innerHTML=profile.reminders.length?profile.reminders.map(r=>`<div class="row"><div class="row-main"><strong>${esc(r.title)}</strong><small>${esc(r.schedule)} · next ${esc(date(r.nextDueAt))}</small></div><div class="row-value">${r.amountYnxt==null?'Amount not set':`${fmt(r.amountYnxt)} YNXT`}<small>reminder only</small></div></div>`).join(''):'<div class="empty compact">No recurring reminders. Finance will never auto-pay one.</div>'}
function renderPrivacy(p){const f=$('#privacy-form');f.includePayInStatements.checked=!!p.includePayInStatements;f.allowAiActivityContext.checked=!!p.allowAiActivityContext;f.alertsEnabled.checked=!!p.alertsEnabled}
function renderAIRecords(items){$('#ai-records').innerHTML=items.length?items.map(a=>`<label class="check-item"><input type="checkbox" value="${esc(a.id)}"><span><strong>${esc(a.type)}</strong><br><small>${esc(date(a.timestamp))} · ${fmt(a.amountYnxt)} YNXT</small></span></label>`).join(''):'<div class="empty compact">No owned activity is available for AI context.</div>'}
function renderSupport(s){$('#support-links').innerHTML=[['Help center',s.helpUrl],['Privacy request',s.privacyUrl],['Open a dispute',s.disputeUrl]].map(([label,url])=>`<a class="panel support-card" href="${esc(url)}" rel="noreferrer"><span>Verified path</span><strong>${esc(label)} →</strong></a>`).join('')}

async function submitForm(form,path,body){body.idempotencyKey=crypto.randomUUID();try{await api(path,{method:'POST',body:JSON.stringify(body)});form.reset();notify(financeText('profileSaved'));await load()}catch(error){notify(error.message,true)}}
$('#category-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);submitForm(e.currentTarget,'/api/categories',{name:f.get('name'),color:f.get('color')})});
$('#budget-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);submitForm(e.currentTarget,'/api/budgets',{name:f.get('name'),categoryId:f.get('categoryId'),limitYnxt:Number(f.get('limitYnxt')),period:f.get('period'),startsAt:new Date().toISOString()})});
$('#reminder-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const raw=f.get('amountYnxt');submitForm(e.currentTarget,'/api/reminders',{title:f.get('title'),amountYnxt:raw===''?null:Number(raw),schedule:f.get('schedule'),nextDueAt:new Date(f.get('nextDueAt')).toISOString(),sourceRef:''})});
$('#privacy-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api('/api/privacy',{method:'PUT',body:JSON.stringify({includePayInStatements:f.includePayInStatements.checked,allowAiActivityContext:f.allowAiActivityContext.checked,alertsEnabled:f.alertsEnabled.checked})});notify(financeText('privacySaved'));await load()}catch(error){notify(error.message,true)}});
function renderStatement(s){
  if(s?.schemaVersion!=='finance-statement-v2'||s.coverageComplete!==false||!Array.isArray(s.activity)||!s.totals||!['incomingYnxt','outgoingYnxt','feesYnxt'].every(key=>s.totals[key]===null))throw new Error('Statement coverage response is invalid. No totals were shown.');
  const observed=s.calculationStatus==='partial'?s.observedTotals:null;
  const amount=value=>Number.isSafeInteger(value)&&value>=0?`${fmt(value)} YNXT`:'Unknown';
  $('#statement').innerHTML=`<p><strong>${esc(s.network)} · ${esc(s.symbol)}</strong><br>${esc(date(s.from))} through ${esc(date(new Date(new Date(s.toExclusive).getTime()-1)))}</p><p><strong>Full-period totals: Unknown</strong><br>${esc(s.coverage||'Complete activity history was not provided.')}</p><div class="statement-grid"><div class="stat"><small>Observed incoming</small><strong>${amount(observed?.incomingYnxt)}</strong></div><div class="stat"><small>Observed outgoing</small><strong>${amount(observed?.outgoingYnxt)}</strong></div><div class="stat"><small>Observed fees</small><strong>${amount(observed?.feesYnxt)}</strong></div><div class="stat"><small>Returned records</small><strong>${s.activity.length}</strong></div></div><p><small>${esc(s.openingBalance)}. This is not a bank statement.</small></p>`;
}
$('#statement-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const from=new Date(`${f.get('from')}T00:00:00Z`).toISOString(),toDate=new Date(`${f.get('to')}T00:00:00Z`);toDate.setUTCDate(toDate.getUTCDate()+1);renderStatement(await api(`/api/statements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(toDate.toISOString())}`))}catch(error){notify(error.message,true)}});

async function download(path,name){try{const blob=await api(path,{responseType:'blob'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}catch(error){notify(error.message,true)}}
$('#export-json').addEventListener('click',()=>download('/api/export?format=json','ynx-finance-observed-export.json'));$$('[data-auth-download]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();download(a.getAttribute('href'),'ynx-finance-observed-activity.csv')}));

async function startAI(){const button=$('#ai-start'),idleLabel=button.textContent;if(button.disabled)return;button.disabled=true;button.textContent='Requesting review…';try{const recordIds=$$('#ai-records input:checked').map(x=>x.value),kind=$('#ai-kind').value,consent=$('#ai-consent').checked;if(kind!=='draft_broker_order'&&recordIds.length<1)throw new Error('Select at least one owned activity record.');if(!consent)throw new Error('Confirm the exact AI context before requesting a draft.');const payload={kind,recordIds,contextClasses:recordIds.length?['owned_activity']:[],consent};if(kind==='draft_broker_order'){const form=$('#ai-order-intent');if(!(form instanceof HTMLFormElement))throw new Error('Broker order intent form is unavailable.');const fields=new FormData(form),intent={symbol:String(fields.get('symbol')||'').trim().toUpperCase(),side:String(fields.get('side')||''),qty:String(fields.get('qty')||'').trim(),limitPrice:String(fields.get('limitPrice')||'').trim()};if(!/^[A-Z][A-Z0-9.]{0,11}$/.test(intent.symbol))throw new Error('Enter a canonical Broker symbol.');if(!['buy','sell'].includes(intent.side))throw new Error('Choose buy or sell.');if(!/^(?:[1-9][0-9]{0,5}|1000000)$/.test(intent.qty))throw new Error('Quantity must be a whole-share value from 1 through 1000000.');if(!/^(?:0\.[0-9]{0,3}[1-9]|[1-9][0-9]{0,8}(?:\.[0-9]{0,3}[1-9])?)$/.test(intent.limitPrice))throw new Error('Limit price must be a canonical fixed decimal from 0.0001 through 999999999.9999.');payload.securitiesOrderIntent=intent}state.aiJob=await api('/api/ai/jobs',{method:'POST',body:JSON.stringify(payload)});renderAIJob();pollAI()}catch(error){notify(error.message||'AI draft request failed.',true)}finally{button.disabled=false;button.textContent=idleLabel}}
function renderAIJob(){const j=state.aiJob;if(!j)return;$('#ai-status').innerHTML=`<p><strong>${esc(j.status)}</strong> · ${esc(j.provider||'Provider unavailable')} / ${esc(j.model||'—')}</p><p>${esc(j.progress||j.error||'Waiting for provider stream…')}</p><p><small>Estimate: ${esc(j.estimatedCost||'not returned')}</small></p>${j.result?`<pre>${esc(JSON.stringify(j.result,null,2))}</pre>`:''}`;$('#ai-actions').classList.remove('hidden');$$('[data-ai=cancel]').forEach(b=>b.classList.toggle('hidden',j.status!=='running'));$$('[data-ai=delete]').forEach(b=>b.classList.toggle('hidden',j.status==='running'));$$('[data-ai=apply],[data-ai=reject]').forEach(b=>b.classList.toggle('hidden',j.status!=='ready'||j.kind==='draft_broker_order'));$$('[data-ai=use-order]').forEach(b=>b.classList.toggle('hidden',j.status!=='ready'||j.kind!=='draft_broker_order'))}
function pollAI(){clearInterval(state.aiTimer);state.aiTimer=setInterval(async()=>{if(!state.aiJob)return;try{state.aiJob=await api(`/api/ai/jobs/${state.aiJob.id}`);renderAIJob();if(state.aiJob.status!=='running')clearInterval(state.aiTimer)}catch(error){clearInterval(state.aiTimer);notify(error.message,true)}},700)}
const deleteAIButton=document.createElement('button');deleteAIButton.dataset.ai='delete';deleteAIButton.className='danger hidden';deleteAIButton.textContent='Delete draft data';$('#ai-actions').append(deleteAIButton);
$('#ai-start').addEventListener('click',startAI);$('#ai-actions').addEventListener('click',async e=>{const decision=e.target.dataset.ai;if(!decision||!state.aiJob)return;try{if(decision==='cancel'){await api(`/api/ai/jobs/${state.aiJob.id}/cancel`,{method:'POST'});state.aiJob.status='cancelled'}else if(decision==='use-order'){const d=state.aiJob.result?.orderDraft,form=$('#broker-order-form');if(!d||!['buy','sell'].includes(d.side)||!d.symbol||!d.qty||!d.limitPrice)throw new Error('AI order draft is incomplete and was not copied');form.elements.assetId.value='';form.elements.symbol.value='';form.elements.side.value=String(d.side);form.elements.qty.value=String(d.qty);form.elements.limitPrice.value=String(d.limitPrice);$('#broker-asset-search').elements.query.value=String(d.symbol);state.brokerSelectedAsset=null;location.hash='broker-sandbox';notify('AI draft terms copied. Search and select the exact provider-backed asset before previewing approval.');return}else if(decision==='delete'){if(!window.confirm('Delete this AI draft, streamed text and result? The minimal deletion audit event will remain.'))return;await api(`/api/ai/jobs/${state.aiJob.id}`,{method:'DELETE'});state.aiJob=null;$('#ai-status').textContent='Draft data deleted. A minimal deletion audit event remains.';$('#ai-actions').classList.add('hidden');return}else state.aiJob=await api(`/api/ai/jobs/${state.aiJob.id}/decision`,{method:'POST',body:JSON.stringify({decision})});renderAIJob();if(decision==='apply')await load()}catch(error){notify(error.message,true)}});
$('#ai-order-intent').addEventListener('submit',event=>{event.preventDefault();startAI()});
$('#ai-kind').addEventListener('change',()=>$('#ai-order-intent').classList.toggle('hidden',$('#ai-kind').value!=='draft_broker_order'));

function route(){
  const requested=(location.hash||'#overview').slice(1);
  const aliases={orders:'broker-sandbox',privacy:'settings',budgets:'planning',ai:'assistant',reports:'statements'};
  const known=new Set(['overview','assets','markets','broker-sandbox','strategies','planning','statements','assistant','settings','activity','support']);
  const target=requested==='wallet-connect'?'overview':aliases[requested]||requested;
  const section=known.has(target)?target:'overview';
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
  $$('.view').forEach(view=>view.classList.toggle('active-view',view.id===visible));
  const active={"broker-sandbox":'orders',activity:'assets',statements:'planning',support:'settings'}[section]||section;
  $$('#nav a').forEach(link=>{const selected=link.hash===`#${active}`;link.classList.toggle('active',selected);if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
  $('#page-title').textContent=financeText('appName');
}
window.addEventListener('ynx-finance-standard-state',()=>{state.context++;clearInterval(state.aiTimer);walletIdentityState='identityUnverified';renderWalletIdentity()});window.addEventListener('ynx-finance-private-state',event=>{clearPrivateView({clearOpaquePending:['disconnected','guest'].includes(event.detail?.status)});if(event.detail?.status==='connected')load()});
window.addEventListener('hashchange',route);window.addEventListener('online',reconnect);window.addEventListener('offline',()=>sourceStatus('offlineRetry','warning'));$$('.connect').forEach(b=>b.addEventListener('click',signIn));$('#signin').addEventListener('click',signIn);$('#logout').addEventListener('click',logout);$('#refresh').addEventListener('click',load);$('#network-retry').addEventListener('click',reconnect);
$('#wallet-login-verify').addEventListener('click',verifyWalletIdentity);
const now=new Date(),monthAgo=new Date(Date.now()-30*864e5);$('#statement-form [name=from]').value=monthAgo.toISOString().slice(0,10);$('#statement-form [name=to]').value=now.toISOString().slice(0,10);
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
$('#broker-clear-approval').addEventListener('click',async()=>{try{const workspace=await refreshBrokerWorkspace();if(!workspace)throw new Error('Current Finance server time is unavailable.');const route=await restoreBrokerApproval(workspace.serverTime,{announce:true});if(!route){$('#broker-wallet-approve').hidden=true;$('#broker-order-preview').textContent='No local Wallet request is pending.'}}catch(error){notify(error.message,true)}});
refreshBrokerConfiguration();
