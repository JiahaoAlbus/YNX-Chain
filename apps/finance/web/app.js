const state={connected:false,overview:null,aiJob:null,aiTimer:null,context:0,brokerAssets:new Map(),brokerWatchlist:new Map(),brokerSelectedAsset:null};
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
    document.querySelector('#broker-status').textContent=!result.status.enabled?'Sandbox module disabled. No broker connection is verified; submission is disabled.':result.status.state==='CONFIGURED_NOT_VERIFIED'?'Configuration present. Official Sandbox, linked account and trading permissions are not verified.':'Not configured / disconnected. Submission is disabled; no sample balances or trades are substituted.';
    document.querySelector('#broker-approval').textContent=result.walletOrderApproval==='frozen_contract_internal_only_no_public_submit_route'?'Frozen Finance/Wallet contract is integrated internally; public submission remains disabled.':'Wallet order approval is unavailable.';
    document.querySelector('#broker-journal').textContent=result.durableOrderJournal==='implemented_state_v2'?'Persistent v2 journal and one-time outbox are implemented. Any provider POST requires the separate operator worker and activation receipt; this page cannot submit.':'Durable order journal status is unavailable.';
    route();
  }catch{
    if(revision===brokerCheckRevision)document.querySelector('#broker-status').textContent='Configuration check unavailable. Retry is read-only; order submission remains disabled.';
  }finally{clearTimeout(timer)}
}
function clearBrokerSnapshot(message='Sign in to read an owner-mapped Sandbox account. Guest mode never receives balances, positions or orders.'){
  $('#broker-account').textContent='Not linked';$('#broker-cash').textContent='Unknown — not zero';$('#broker-buying-power').textContent='Unknown — not zero';$('#broker-private-status').textContent=message;
  $('#broker-positions').innerHTML='<div class="empty compact">Unknown — no provider result.</div>';$('#broker-orders').innerHTML='<div class="empty compact">Unknown — no provider result.</div>';
}
function selectBrokerAsset(asset){
  if(!asset||!/^[0-9a-f-]{36}$/.test(String(asset.id||''))||!/^[A-Z][A-Z0-9.]{0,11}$/.test(String(asset.symbol||'')))throw new Error('Select an exact active provider asset.');
  state.brokerSelectedAsset=asset;const form=$('#broker-order-form');form.elements.assetId.value=asset.id;form.elements.symbol.value=asset.symbol;
  $('#broker-order-preview').textContent=`Selected ${asset.symbol} · ${asset.name}. No Wallet or provider write has occurred.`;
}
function renderBrokerAssets(assets){
  state.brokerAssets=new Map(assets.map(asset=>[asset.id,asset]));
  $('#broker-asset-results').innerHTML=assets.length?assets.map(asset=>`<div class="row"><div class="row-main"><strong>${esc(asset.symbol)}</strong><small>${esc(asset.name)} · active/tradable Sandbox asset</small></div><div class="wallet-choice"><button type="button" data-broker-select="${esc(asset.id)}">Select</button>${state.connected?`<button type="button" data-broker-watch="${esc(asset.id)}">Add to watchlist</button>`:''}</div></div>`).join(''):'<div class="empty compact">No active tradable provider asset matched. Nothing was substituted.</div>';
}
async function searchBrokerAssets(event){
  event?.preventDefault();const query=String(new FormData($('#broker-asset-search')).get('query')||'').trim();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(`/api/broker/assets?query=${encodeURIComponent(query)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),result=await response.json();if(!response.ok||result?.schema!=='ynx-finance-broker-assets-v1'||!Array.isArray(result.assets))throw new Error(result?.error||'Sandbox asset directory is unavailable.');renderBrokerAssets(result.assets)}catch(error){renderBrokerAssets([]);notify(error.message||'Sandbox asset directory is unavailable.',true)}finally{clearTimeout(timer)}
}
function renderBrokerWatchlist(items){
  const list=Array.isArray(items)?items:[];
  state.brokerWatchlist=new Map(list.map(item=>[item.assetId,item]));
  $('#broker-watchlist').innerHTML=list.length?list.map(item=>`<div class="row"><div class="row-main"><strong>${esc(item.symbol)}</strong><small>${esc(item.name)}</small></div><div class="wallet-choice"><button type="button" data-broker-watch-select="${esc(item.assetId)}">Select</button><button type="button" class="ghost" data-broker-unwatch="${esc(item.assetId)}">Remove</button></div></div>`).join(''):`<div class="empty compact">${state.connected?'Your Sandbox watchlist is empty.':'Sign in to load your owner-scoped watchlist.'}</div>`;
}
async function updateBrokerWatchlist(asset,selected){
  if(!state.connected)throw new Error('Sign in before changing your watchlist.');
  const result=await api('/api/broker/watchlist',{method:'PUT',body:JSON.stringify({assetId:asset.id||asset.assetId,selected})});
  if(result?.schema!=='ynx-finance-broker-watchlist-v1'||result.providerWriteAttempted!==false)throw new Error('Watchlist response is invalid.');
  renderBrokerWatchlist(result.watchlist);await refreshBrokerWorkspace();notify(selected?'Added to your Sandbox watchlist.':'Removed from your Sandbox watchlist.');
}
async function refreshBrokerSnapshot(){
  if(!state.connected){clearBrokerSnapshot();return}
  try{
    const result=await api('/api/broker/snapshot');
    const snapshot=result?.schema==='ynx-finance-broker-snapshot-v1'?result.snapshot:null;
    if(!snapshot||snapshot.provider!=='alpaca_broker'||snapshot.environment!=='sandbox'||!Array.isArray(snapshot.orders)||!Array.isArray(snapshot.positions)||snapshot.account?.currency!=='USD')throw Object.assign(new Error('Broker Sandbox returned an invalid account snapshot.'),{nonRetryable:true});
    $('#broker-account').textContent=`Linked Sandbox account · ${short(snapshot.account.providerAccountId)}`;
    $('#broker-cash').textContent=`${snapshot.account.cash} simulated USD`;
    $('#broker-buying-power').textContent=`${snapshot.account.buyingPower} simulated USD`;
    $('#broker-private-status').textContent='Owner-mapped provider read-through. Values are simulated Sandbox records, not YNXT or fiat custody.';
    $('#broker-positions').innerHTML=snapshot.positions.length?snapshot.positions.map(position=>`<div class="row"><div class="row-main"><strong>${esc(position.symbol)}</strong><small>${esc(position.qty)} shares · available ${esc(position.availableQty)}</small></div><div class="row-value">${esc(position.marketValue)} simulated USD<small>average ${esc(position.averageEntryPrice)}</small></div></div>`).join(''):'<div class="empty compact">Provider returned no positions for this linked Sandbox account.</div>';
    $('#broker-orders').innerHTML=snapshot.orders.length?snapshot.orders.map(order=>`<div class="row"><div class="row-main"><strong>${esc(order.side)} ${esc(order.qty)} ${esc(order.symbol)}</strong><small>${esc(order.type)} · ${esc(order.timeInForce)} · ${esc(order.providerStatus)}</small></div><div class="row-value">${order.limitPrice?`${esc(order.limitPrice)} simulated USD`:'No limit price'}<small>${esc(short(order.providerOrderId))}</small></div></div>`).join(''):'<div class="empty compact">Provider returned no orders for this linked Sandbox account.</div>';
  }catch(error){
    clearBrokerSnapshot(error?.message||'Broker Sandbox account data is unavailable. No values were substituted.');
  }
}
let brokerCallbackInFlight=false;
function renderBrokerWorkspace(workspace){
  const orders=Array.isArray(workspace?.orders)?workspace.orders:[];
  const outbox=new Map((Array.isArray(workspace?.outbox)?workspace.outbox:[]).map(item=>[item.orderId,item]));
  $('#broker-local-orders').innerHTML=orders.length?orders.map(record=>{const queued=outbox.get(record.order.orderId),cancelable=['submitted','partially_filled'].includes(record.state);return `<div class="row"><div class="row-main"><strong>${esc(record.order.side)} ${esc(record.order.qty)} ${esc(record.order.symbol)}</strong><small>${esc(record.approvalState)} · ${esc(record.state)} · request ${esc(short(record.requestId))}</small><small>${queued?`outbox ${esc(queued.status)} · attempts ${esc(queued.attempts)}`:'no provider outbox'}</small></div><div class="row-value">max ${esc(record.order.maxCost)} simulated USD<div class="wallet-choice"><button type="button" data-broker-order-refresh="${esc(record.order.orderId)}">Refresh</button>${cancelable?`<button type="button" class="danger" data-broker-order-cancel="${esc(record.order.orderId)}">Request cancellation</button>`:''}</div></div></div>`}).join(''):'<div class="empty compact">No local Sandbox order drafts.</div>';
  const journal=Array.isArray(workspace?.journal)?workspace.journal:[];
  $('#broker-events').innerHTML=journal.length?journal.slice().reverse().slice(0,30).map(item=>`<div class="row"><div class="row-main"><strong>${esc(item.action)}</strong><small>${esc(date(item.createdAt))} · ${esc(short(item.orderId||item.requestId))}</small></div><div class="row-value">${esc(item.orderState)}<small>${esc(item.approvalState)}</small></div></div>`).join(''):'<div class="empty compact">No local broker events.</div>';
  renderBrokerWatchlist(workspace?.watchlist);
}
async function refreshBrokerWorkspace(){
  if(!state.connected){renderBrokerWorkspace(null);return null}
  try{const result=await api('/api/broker/orders');if(result?.schema!=='ynx-finance-broker-workspace-v1')throw new Error('Broker workspace response is invalid.');renderBrokerWorkspace(result.workspace);return result.workspace}catch(error){$('#broker-local-orders').innerHTML=`<div class="empty compact">${esc(error.message)} No order state was substituted.</div>`;return null}
}
async function createBrokerApproval(event){
  event.preventDefault();
  const form=new FormData(event.currentTarget),draft={assetId:String(form.get('assetId')||''),symbol:String(form.get('symbol')||'').toUpperCase(),side:String(form.get('side')||''),qty:String(form.get('qty')||''),limitPrice:String(form.get('limitPrice')||'')};
  try{
    if(!state.brokerSelectedAsset||state.brokerSelectedAsset.id!==draft.assetId||state.brokerSelectedAsset.symbol!==draft.symbol)throw new Error('Select this asset from the provider-backed search results before creating approval.');
    const result=await api('/api/broker/challenges',{method:'POST',body:JSON.stringify({draft})});
    if(result?.schema!=='ynx-finance-order-approval-challenge-v1'||result.providerWriteAttempted!==false)throw new Error('Finance order challenge response is invalid.');
    const route=window.YNXFinanceOrderWallet.begin(result.challenge.unsigned,result.challenge.serverTime),order=result.challenge.unsigned.order;
    $('#broker-order-preview').innerHTML=`<strong>${esc(order.side)} ${esc(order.qty)} ${esc(order.symbol)} @ ${esc(order.limitPrice)} simulated USD</strong><br>Maximum: ${esc(order.maxCost)} USD · maximum fee ${esc(order.maxFee)} USD · expires ${esc(result.challenge.unsigned.expiresAt)}<br><small>Request ${esc(short(result.challenge.unsigned.requestId))}. Broker provider has not been contacted.</small>`;
    const link=$('#broker-wallet-approve');link.href=route.url;link.hidden=false;link.rel='noreferrer';notify('Exact approval request created. Review it in YNX Wallet; no broker order has been submitted.');await refreshBrokerWorkspace();
  }catch(error){notify(error.message,true)}
}
async function reconcileBroker(){
  if(!state.connected){notify('Sign in before reconciling owner-scoped Sandbox data.',true);return}
  if(!window.confirm('Read the linked Sandbox account now and reconcile local order state? This performs no provider write.'))return;
  try{const result=await api('/api/broker/reconcile',{method:'POST',body:'{}'});if(result?.schema!=='ynx-finance-broker-reconcile-v1'||result.providerWriteAttempted!==false)throw new Error('Broker reconcile response is invalid.');renderBrokerWorkspace(result.workspace);await refreshBrokerSnapshot();notify('Sandbox provider state reconciled. No provider write occurred.')}catch(error){notify(error.message,true)}
}
async function requestBrokerCancel(orderId){
  if(!window.confirm('Record a cancellation request for this Sandbox order? The browser will not contact the provider; an operator worker must execute it.'))return;
  try{const result=await api(`/api/broker/orders/${encodeURIComponent(orderId)}/cancel-request`,{method:'POST',body:'{}'});if(result?.schema!=='ynx-finance-broker-cancel-request-v1'||result.providerWriteAttempted!==false)throw new Error('Cancellation request response is invalid.');notify('Cancellation intent recorded. Provider cancellation has not yet run.');await refreshBrokerWorkspace()}catch(error){notify(error.message,true)}
}
async function refreshBrokerQuote(){
  const symbol=String(new FormData($('#broker-order-form')).get('symbol')||'').toUpperCase();
  if(!/^[A-Z][A-Z0-9.]{0,11}$/.test(symbol)){notify('Enter a canonical US equity symbol before requesting a quote.',true);return}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(`/api/broker/quote?symbol=${encodeURIComponent(symbol)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),result=await response.json();if(!response.ok||result?.schema!=='ynx-finance-broker-quote-v1')throw new Error(result?.error||'Sandbox quote is unavailable.');const quote=result.quote;$('#broker-quote-status').textContent=`${quote.symbol} · bid ${quote.bidPrice} / ask ${quote.askPrice} simulated USD · IEX · ${result.quoteState||'unknown'} · ${date(quote.timestamp)}. This does not set the order limit automatically.`}catch(error){$('#broker-quote-status').textContent=`${error.message||'Sandbox quote is unavailable.'} No price was substituted.`}finally{clearTimeout(timer)}
}
async function completeBrokerCallback(){
  if(brokerCallbackInFlight||!state.connected||location.pathname!=='/wallet-auth/callback'||!location.search.includes('financeOrderApprovalResult='))return;
  brokerCallbackInFlight=true;$('#broker-complete-callback').hidden=false;
  try{
    const workspace=await refreshBrokerWorkspace();if(!workspace)throw new Error('Current Finance server time is unavailable.');
    const raw=window.YNXFinanceOrderWallet.parseReturn(location.href,workspace.serverTime);
    const result=await api('/api/broker/callback',{method:'POST',body:raw});
    if(result?.schema!=='ynx-finance-order-approval-consume-v1'||result.providerWriteAttempted!==false)throw new Error('Finance order callback response is invalid.');
    window.YNXFinanceOrderWallet.clear();history.replaceState(null,'','/');$('#broker-wallet-approve').hidden=true;$('#broker-complete-callback').hidden=true;notify(result.status==='approved'?'Wallet approval consumed into the durable local outbox. Broker submission remains disabled.':'Wallet decision recorded. No broker submission occurred.');await refreshBrokerWorkspace();
  }catch(error){notify(error.message,true)}finally{brokerCallbackInFlight=false}
}
const READ_RETRY_DELAYS=[0,600,1600];
const $=(s)=>document.querySelector(s),$$=(s)=>[...document.querySelectorAll(s)];
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=(v)=>new Intl.NumberFormat().format(Number(v||0));
const short=(v)=>v?`${v.slice(0,8)}…${v.slice(-6)}`:'—';
const date=(v)=>v?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Date unavailable';

const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function sourceStatus(message,className='neutral'){$('#source-pill').textContent=message;$('#source-pill').className=`pill ${className}`}
async function publicHealth(){for(let attempt=0;attempt<READ_RETRY_DELAYS.length;attempt++){if(attempt){sourceStatus(`Reconnecting ${attempt}/${READ_RETRY_DELAYS.length-1}`,'warning');await wait(READ_RETRY_DELAYS[attempt])}try{const response=await fetch('/health',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000)}),body=await response.json();if(!response.ok||body.ok!==true||body.chainId!=='ynx_6423-1'||body.portfolio!=='read-only')throw Object.assign(new Error(`Finance health check failed (${response.status})`),{status:response.status});sourceStatus(state.connected?'YNX Testnet connected':'YNX Testnet reachable · Wallet not connected','live');return body}catch(error){if(error?.status||attempt===READ_RETRY_DELAYS.length-1){sourceStatus('Connection unavailable','warning');throw error}}}throw new Error('Public connection retry exhausted.')}
async function api(path,options={}){
  const context=state.context,walletRevision=window.YNXFinanceWallet.getRevision();
  const assertCurrent=()=>{if(context!==state.context||walletRevision!==window.YNXFinanceWallet.getRevision())throw Object.assign(new Error('FINANCE_CONTEXT_CHANGED: Discarded a response from an older account or connection.'),{nonRetryable:true})};
  const method=String(options.method||'GET').toUpperCase(),readOnly=method==='GET',attempts=readOnly?READ_RETRY_DELAYS.length:1;
  for(let attempt=0;attempt<attempts;attempt++){
    if(attempt){sourceStatus(`Reconnecting ${attempt}/${attempts-1}`,'warning');await wait(READ_RETRY_DELAYS[attempt])}
    try{
      const headers={'Content-Type':'application/json',...(options.headers||{})};try{const authorization=await window.YNXFinanceWallet.requireProof(scope(path));assertCurrent();if(!authorization?.proofHeader||!authorization?.requestId)throw new Error('PRIVATE_SERVICE_DEGRADED: Fresh v2 proof is unavailable.');headers['X-YNX-Product-Session-Proof-V2']=authorization.proofHeader;headers['X-Request-ID']=authorization.requestId}catch(error){error.nonRetryable=true;throw error}
      const response=await fetch(path,{...options,method,headers,signal:AbortSignal.timeout(10_000)});assertCurrent();if(response.status===204){sourceStatus('YNX Testnet connected','live');return null}const type=response.headers.get('content-type')||'',body=options.responseType==='blob'&&response.ok?await response.blob():type.includes('json')?JSON.parse(await response.text()):await response.text();assertCurrent();
      if(!response.ok){const error=new Error(body.error||`Request failed (${response.status})`);error.code=body.code;error.status=response.status;if(!readOnly||![502,503,504].includes(response.status)||attempt===attempts-1)throw error;continue}
      sourceStatus('YNX Testnet connected','live');return body
    }catch(error){if(!readOnly||error?.status||error?.nonRetryable||attempt===attempts-1){if(!error?.nonRetryable&&(!error?.status||[502,503,504].includes(error.status)))sourceStatus('Connection unavailable','warning');throw error}}
  }
  throw new Error('Read connection retry exhausted.')
}
function scope(path){if(path.startsWith('/api/ai/'))return'finance.ai.draft';if(['/api/categories','/api/budgets','/api/reminders','/api/notes','/api/privacy','/api/account','/api/broker/challenges','/api/broker/callback','/api/broker/watchlist','/api/broker/reconcile'].some(v=>path.startsWith(v))||/^\/api\/broker\/orders\/[^/]+\/cancel-request$/.test(path)||path.includes('/category'))return'finance.profile.write';return'finance.portfolio.read'}
function notify(message,error=false){const box=$('#notice');box.textContent=message;box.classList.toggle('error',error);box.classList.remove('hidden');clearTimeout(box.timer);box.timer=setTimeout(()=>box.classList.add('hidden'),6500)}

async function signIn(){try{await window.YNXFinanceWallet.connect()}catch(error){notify(error.message,true)}}
async function consumeCallback(){await window.YNXFinanceWallet.ready}
function clearPrivateView(){state.context++;clearInterval(state.aiTimer);state.aiJob=null;state.overview=null;state.connected=false;for(const id of ['account','balance','staked','balance-source','statement','ai-status']){const element=$('#'+id);if(element)element.textContent='—'}clearBrokerSnapshot();renderBrokerWorkspace(null);renderSignedOut()}
async function logout(){const result=await window.YNXFinanceWallet.disconnect();if(result?.status==='disconnected'){clearPrivateView()}else notify('Private sign-out is unconfirmed. Retry to reconcile; Standard Wallet is unchanged.',true)}
function renderSignedOut(){document.body.classList.add('signed-out-state');$('#signed-out').classList.remove('hidden');$('#workspace').classList.add('hidden');$('#signin').classList.add('hidden');$('#logout').classList.add('hidden');$('#source-pill').textContent='Not connected';$('#source-pill').className='pill neutral';$('#page-title').textContent='Your money, with its evidence attached.'}

async function load(){await window.YNXFinanceWallet.ready;state.connected=window.YNXFinanceWallet.connected();if(!state.connected){renderSignedOut();return}try{$('#source-pill').textContent='Checking sources';const data=await api('/api/overview');state.overview=data;render(data)}catch(error){if(error.status===401||error.status===403){window.YNXFinanceWallet.reportPrivateFailure();clearPrivateView();notify('Private Finance access needs reauthorization. Standard Wallet is unchanged.',true)}else notify(error.message,true)}}
async function reconnect(){try{await publicHealth();if(state.connected)await load()}catch(error){notify(error.message,true)}}
function render(data){document.body.classList.remove('signed-out-state');$('#signed-out').classList.add('hidden');$('#workspace').classList.remove('hidden');$('#signin').classList.add('hidden');$('#logout').classList.remove('hidden');const p=data.portfolio,profile=data.profile;$('#account').textContent=p.account;$('#balance').textContent=p.explorerStatus.available?`${fmt(p.balanceYnxt)} YNXT`:'Unavailable';$('#staked').textContent=p.explorerStatus.available?`${fmt(p.stakedYnxt)} YNXT`:'Unavailable';$('#balance-source').textContent=p.explorerStatus.available?`Explorer evidence · ${date(p.asOf)}`:p.explorerStatus.error;const both=p.explorerStatus.available&&p.payStatus.available;$('#source-pill').textContent=both?'Explorer + Pay live':p.explorerStatus.available?'Explorer live · Pay unavailable':'Sources unavailable';$('#source-pill').className=`pill ${both?'live':'warning'}`;renderAlerts(data.alerts);renderActivity(p.activity);renderReceipts(p.payReceipts,p.payStatus);renderPlanning(profile,data.budgetProgress);renderPrivacy(profile.privacy);renderAIRecords(p.activity);renderSupport(data.support);refreshBrokerSnapshot();refreshBrokerWorkspace().then(()=>completeBrokerCallback());route()}
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

async function submitForm(form,path,body){body.idempotencyKey=crypto.randomUUID();try{await api(path,{method:'POST',body:JSON.stringify(body)});form.reset();notify('Saved to your account-scoped Finance profile.');await load()}catch(error){notify(error.message,true)}}
$('#category-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);submitForm(e.currentTarget,'/api/categories',{name:f.get('name'),color:f.get('color')})});
$('#budget-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);submitForm(e.currentTarget,'/api/budgets',{name:f.get('name'),categoryId:f.get('categoryId'),limitYnxt:Number(f.get('limitYnxt')),period:f.get('period'),startsAt:new Date().toISOString()})});
$('#reminder-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const raw=f.get('amountYnxt');submitForm(e.currentTarget,'/api/reminders',{title:f.get('title'),amountYnxt:raw===''?null:Number(raw),schedule:f.get('schedule'),nextDueAt:new Date(f.get('nextDueAt')).toISOString(),sourceRef:''})});
$('#privacy-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api('/api/privacy',{method:'PUT',body:JSON.stringify({includePayInStatements:f.includePayInStatements.checked,allowAiActivityContext:f.allowAiActivityContext.checked,alertsEnabled:f.alertsEnabled.checked})});notify('Privacy settings saved.');await load()}catch(error){notify(error.message,true)}});
$('#statement-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const from=new Date(`${f.get('from')}T00:00:00Z`).toISOString(),toDate=new Date(`${f.get('to')}T00:00:00Z`);toDate.setUTCDate(toDate.getUTCDate()+1);const s=await api(`/api/statements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(toDate.toISOString())}`);$('#statement').innerHTML=`<p><strong>${esc(s.network)} · ${esc(s.symbol)}</strong><br>${esc(date(s.from))} through ${esc(date(new Date(new Date(s.toExclusive).getTime()-1)))}</p><div class="statement-grid"><div class="stat"><small>Incoming</small><strong>${fmt(s.totals.incomingYnxt)} YNXT</strong></div><div class="stat"><small>Outgoing</small><strong>${fmt(s.totals.outgoingYnxt)} YNXT</strong></div><div class="stat"><small>Fees</small><strong>${fmt(s.totals.feesYnxt)} YNXT</strong></div><div class="stat"><small>Records</small><strong>${s.activity.length}</strong></div></div><p><small>${esc(s.openingBalance)}. This is not a bank statement.</small></p>`}catch(error){notify(error.message,true)}});

async function download(path,name){try{const blob=await api(path,{responseType:'blob'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}catch(error){notify(error.message,true)}}
$('#export-json').addEventListener('click',()=>download('/api/export?format=json','ynx-finance-export.json'));$$('[data-auth-download]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();download(a.getAttribute('href'),'ynx-finance-activity.csv')}));

async function startAI(){const recordIds=$$('#ai-records input:checked').map(x=>x.value),kind=$('#ai-kind').value,payload={kind,recordIds,contextClasses:['owned_activity'],consent:$('#ai-consent').checked};if(kind==='draft_broker_order'){const fields=new FormData($('#ai-order-intent'));payload.securitiesOrderIntent={symbol:String(fields.get('symbol')||'').trim().toUpperCase(),side:String(fields.get('side')||''),qty:String(fields.get('qty')||'').trim(),limitPrice:String(fields.get('limitPrice')||'').trim()}}try{state.aiJob=await api('/api/ai/jobs',{method:'POST',body:JSON.stringify(payload)});renderAIJob();pollAI()}catch(error){notify(error.message,true)}}
function renderAIJob(){const j=state.aiJob;if(!j)return;$('#ai-status').innerHTML=`<p><strong>${esc(j.status)}</strong> · ${esc(j.provider||'Provider unavailable')} / ${esc(j.model||'—')}</p><p>${esc(j.progress||j.error||'Waiting for provider stream…')}</p><p><small>Estimate: ${esc(j.estimatedCost||'not returned')}</small></p>${j.result?`<pre>${esc(JSON.stringify(j.result,null,2))}</pre>`:''}`;$('#ai-actions').classList.remove('hidden');$$('[data-ai=cancel]').forEach(b=>b.classList.toggle('hidden',j.status!=='running'));$$('[data-ai=delete]').forEach(b=>b.classList.toggle('hidden',j.status==='running'));$$('[data-ai=apply],[data-ai=reject]').forEach(b=>b.classList.toggle('hidden',j.status!=='ready'||j.kind==='draft_broker_order'));$$('[data-ai=use-order]').forEach(b=>b.classList.toggle('hidden',j.status!=='ready'||j.kind!=='draft_broker_order'))}
function pollAI(){clearInterval(state.aiTimer);state.aiTimer=setInterval(async()=>{if(!state.aiJob)return;try{state.aiJob=await api(`/api/ai/jobs/${state.aiJob.id}`);renderAIJob();if(state.aiJob.status!=='running')clearInterval(state.aiTimer)}catch(error){clearInterval(state.aiTimer);notify(error.message,true)}},700)}
const deleteAIButton=document.createElement('button');deleteAIButton.dataset.ai='delete';deleteAIButton.className='danger hidden';deleteAIButton.textContent='Delete draft data';$('#ai-actions').append(deleteAIButton);
$('#ai-start').addEventListener('click',startAI);$('#ai-actions').addEventListener('click',async e=>{const decision=e.target.dataset.ai;if(!decision||!state.aiJob)return;try{if(decision==='cancel'){await api(`/api/ai/jobs/${state.aiJob.id}/cancel`,{method:'POST'});state.aiJob.status='cancelled'}else if(decision==='use-order'){const d=state.aiJob.result?.orderDraft,form=$('#broker-order-form');if(!d||!['buy','sell'].includes(d.side)||!d.symbol||!d.qty||!d.limitPrice)throw new Error('AI order draft is incomplete and was not copied');form.elements.assetId.value='';form.elements.symbol.value='';form.elements.side.value=String(d.side);form.elements.qty.value=String(d.qty);form.elements.limitPrice.value=String(d.limitPrice);$('#broker-asset-search').elements.query.value=String(d.symbol);state.brokerSelectedAsset=null;location.hash='broker-sandbox';notify('AI draft terms copied. Search and select the exact provider-backed asset before previewing approval.');return}else if(decision==='delete'){if(!window.confirm('Delete this AI draft, streamed text and result? The minimal deletion audit event will remain.'))return;await api(`/api/ai/jobs/${state.aiJob.id}`,{method:'DELETE'});state.aiJob=null;$('#ai-status').textContent='Draft data deleted. A minimal deletion audit event remains.';$('#ai-actions').classList.add('hidden');return}else state.aiJob=await api(`/api/ai/jobs/${state.aiJob.id}/decision`,{method:'POST',body:JSON.stringify({decision})});renderAIJob();if(decision==='apply')await load()}catch(error){notify(error.message,true)}});
$('#ai-kind').addEventListener('change',()=>$('#ai-order-intent').classList.toggle('hidden',$('#ai-kind').value!=='draft_broker_order'));

function route(){const id=(location.hash||'#overview').slice(1);$$('.view').forEach(v=>v.classList.toggle('active-view',v.id===id));$$('#nav a').forEach(a=>a.classList.toggle('active',a.hash===`#${id}`));const heading=$(`#${id} h2`);if(state.connected&&heading)$('#page-title').textContent=heading.textContent;else if(!state.connected)$('#page-title').textContent='Your money, with its evidence attached.'}
window.addEventListener('ynx-finance-standard-state',()=>{state.context++;clearInterval(state.aiTimer)});window.addEventListener('ynx-finance-private-state',event=>{clearPrivateView();if(event.detail?.status==='connected')load()});
window.addEventListener('hashchange',route);window.addEventListener('online',reconnect);window.addEventListener('offline',()=>sourceStatus('Offline · reconnect when network returns','warning'));$$('.connect').forEach(b=>b.addEventListener('click',signIn));$('#signin').addEventListener('click',signIn);$('#logout').addEventListener('click',logout);$('#refresh').addEventListener('click',load);$('#network-retry').addEventListener('click',reconnect);
const now=new Date(),monthAgo=new Date(Date.now()-30*864e5);$('#statement-form [name=from]').value=monthAgo.toISOString().slice(0,10);$('#statement-form [name=to]').value=now.toISOString().slice(0,10);
route();consumeCallback().then(load).then(()=>{if(!state.connected)return publicHealth()}).catch(error=>notify(error.message,true));
document.querySelector('#broker-refresh').addEventListener('click',async()=>{await refreshBrokerConfiguration();await refreshBrokerSnapshot();await refreshBrokerWorkspace()});
$('#broker-reconcile').addEventListener('click',reconcileBroker);
$('#broker-asset-search').addEventListener('submit',searchBrokerAssets);
$('#broker-asset-results').addEventListener('click',async event=>{const selectId=event.target.dataset.brokerSelect,watchId=event.target.dataset.brokerWatch;if(selectId){try{selectBrokerAsset(state.brokerAssets.get(selectId))}catch(error){notify(error.message,true)}}else if(watchId){try{await updateBrokerWatchlist(state.brokerAssets.get(watchId),true)}catch(error){notify(error.message,true)}}});
$('#broker-watchlist').addEventListener('click',async event=>{const selectId=event.target.dataset.brokerWatchSelect,removeId=event.target.dataset.brokerUnwatch;if(selectId){try{const item=state.brokerWatchlist.get(selectId);selectBrokerAsset({id:item.assetId,symbol:item.symbol,name:item.name})}catch(error){notify(error.message,true)}}else if(removeId){try{await updateBrokerWatchlist(state.brokerWatchlist.get(removeId),false)}catch(error){notify(error.message,true)}}});
$('#broker-local-orders').addEventListener('click',async event=>{const refreshId=event.target.dataset.brokerOrderRefresh,cancelId=event.target.dataset.brokerOrderCancel;if(refreshId){await reconcileBroker()}else if(cancelId){await requestBrokerCancel(cancelId)}});
$('#broker-order-form').addEventListener('submit',createBrokerApproval);
$('#broker-quote').addEventListener('click',refreshBrokerQuote);
$('#broker-complete-callback').addEventListener('click',completeBrokerCallback);
$('#broker-clear-approval').addEventListener('click',()=>{window.YNXFinanceOrderWallet.clear();$('#broker-wallet-approve').hidden=true;$('#broker-complete-callback').hidden=true;$('#broker-order-preview').textContent='Pending Wallet approval request discarded. No broker action occurred.'});
refreshBrokerConfiguration();
