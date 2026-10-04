import {createFormContexts} from '../seller-console/form-context.js';
import {buyerActionAllowed,buyerActionInput,createBuyerActionRecovery} from './order-action.js';
import {orderActionCopy} from './order-action-copy.js';
import{createInvoiceRecovery,validateBuyerOrder,ownedBuyer}from'./invoice-recovery.js';
import {privateCopy} from '../seller-console/private-copy.js';
import{createRequestContext,contextChanged,ContextChangedError}from'./request-context.js';
import{createCheckoutRecovery}from'./checkout-recovery.js';
import{streamJob}from'./ai-stream.js';
import{cancelWalletConnection,expirePrivateSession,clearWalletSession,onPrivateSessionChange,privateSession,token,authorizeBusinessRequest,privateSignoutPending,startPrivateSession,clearPrivateSession,startWalletAuth,restoreStandardConnection,standardConnection,onStandardConnectionChange,completeWalletCallback,OFFICIAL_YNX_WALLET_DOWNLOAD_URL,STANDARD_METAMASK_DOWNLOAD_URL}from'./wallet-auth.js';
import{installI18n,outputLanguage,tr}from'./i18n.js';
const $=s=>document.querySelector(s);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const apiRoot=location.pathname.startsWith('/shop-staging/')?'/shop-api-staging/api':'/api';
const requests=createRequestContext(()=>token());
const aiRequests=createRequestContext(()=>token());
async function productRequest(context,path,options={}){
 const subject=token(),assertCurrent=context.capture();
 const publicPath=path.split('?')[0];
 const publicRead=(options.method||'GET')==='GET'&&(['/capabilities','/products'].includes(publicPath)||/^\/stores\/[A-Za-z0-9._:-]+$/.test(publicPath));
 let wire;try{wire=publicRead?{...options,headers:{'Content-Type':'application/json'}}:await authorizeBusinessRequest(apiRoot+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}})}catch(error){assertCurrent();if(error.code==='ORIGINAL_BROWSER_REQUIRED')$('#browserSignIn').hidden=false;throw error}
 assertCurrent();if(options.beforeDispatch){await options.beforeDispatch();assertCurrent()}try{return await context.fetchJSON(apiRoot+path,wire)}
 catch(error){if(error.code==='ORIGINAL_BROWSER_REQUIRED')$('#browserSignIn').hidden=false;if(error.status===401&&error.code!=='ORIGINAL_BROWSER_REQUIRED'&&subject&&subject===token()){expirePrivateSession();$('#status').textContent='Your Shop session expired. Approve a new private session to continue.';throw new ContextChangedError()}throw error}
}
let currentOrders=[],invoicePresentation=null,actionPresentation=null,actionBusy=null;const actionRecovery=createBuyerActionRecovery(()=>privateSession()?.account||'');const invoiceRecovery=createInvoiceRecovery();
const api=(path,options={})=>productRequest(requests,path,options);
const aiAPI=(path,options={})=>productRequest(aiRequests,path,options);
let products=[],cart=[],cartRevision=null,cartBusy=null,category='',profile=null,aiJob=null,aiConfig=null;
const checkoutRecovery=createCheckoutRecovery(),profileContexts=createFormContexts(),productContexts=createFormContexts();
let cartPresentation=0;
function closeCart(){cartPresentation++;cartBusy=null;$('#cart').hidden=true;}
function captureCart(){const presentation=cartPresentation,workspace=requests.capture();return()=>{workspace();if(presentation!==cartPresentation||$('#cart').hidden)throw new ContextChangedError();}}
const checkoutAccount=()=>{const account=privateSession()?.account;if(!account)throw new Error('Approve your private Shop session first.');return account};
async function cartAction(work){if(cartBusy)return;const operation=Symbol(),assertCurrent=requests.capture();cartBusy=operation;try{return await work(assertCurrent)}finally{if(cartBusy===operation){cartBusy=null;renderCart()}}}
async function refreshAfterFailure(){cartRevision=null;try{await loadCart()}catch(error){if(contextChanged(error))throw error;renderCart()}}

const downloadJSON=(filename,data)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url)};
const productFor=item=>products.find(p=>p.ID===item.ProductID);const variantFor=item=>productFor(item)?.Variants.find(v=>v.ID===item.VariantID);const requireSignIn=()=>{if(token())return true;if(standardConnection()){$('#status').textContent='Your standard wallet is connected. Approve a separate private Shop session to load your profile, cart, and orders.';return false}openWalletChooser();return false};
async function load(){try{const [caps,catalog]=await Promise.all([api('/capabilities'),api('/products')]);$('#capabilities').textContent=`Pay ${caps.paySettlement} · Tax ${caps.tax} · Logistics ${caps.logistics} · AI ${caps.aiProvider} · ${tr('label')} ${caps.privacyData}`;products=catalog.products||[];const categories=[...new Set(products.map(p=>p.Category).filter(Boolean))].sort();$('#filters select').innerHTML='<option value="">All</option>'+categories.map(c=>`<option>${esc(c)}</option>`).join('');renderProducts();if(token()){await Promise.all([loadCart(),loadProfile(),loadOrders(false)]);$('#wallet').textContent='Wallet session active'}}catch(e){if(contextChanged(e))return;$('#status').textContent=`Catalog unavailable: ${e.message}`}}
function renderProducts(){const q=$('#query').value.toLowerCase().trim(),f=new FormData($('#filters')),max=Number(f.get('maxPrice')||0),stock=f.get('inStock')==='on',cat=f.get('category')||category;const rows=products.filter(p=>(!q||(p.Title+' '+p.Description).toLowerCase().includes(q))&&(!cat||p.Category===cat)&&p.Variants.some(v=>(!max||v.PriceYNXT<=max)&&(!stock||v.Inventory-v.Reserved>0)));$('#status').textContent=rows.length?`${rows.length} products with persistent inventory`:'No matching products.';$('#products').setAttribute('aria-busy','false');$('#products').innerHTML=rows.map(p=>{const media=p.Media?.[0],available=p.Variants.reduce((sum,v)=>sum+Math.max(0,v.Inventory-v.Reserved),0);return`<button class="card" data-product="${p.ID}" aria-label="Open ${esc(p.Title)}"><div class="cardArt">${media?`<img src="${esc(media.URL)}" alt="${esc(media.AltText)}" loading="lazy">`:''}</div><div class="cardBody"><h3>${esc(p.Title)}</h3><p>${esc(p.Description)}</p><div class="meta"><span>${esc(p.Category)}</span><b>${Math.min(...p.Variants.map(v=>v.PriceYNXT)).toLocaleString()} YNXT</b></div><div class="availability"><span>${available} available</span><strong>View details →</strong></div></div></button>`}).join('')}
$('#search').onsubmit=e=>{e.preventDefault();renderProducts()};$('#filters').oninput=renderProducts;$('#filters').onreset=()=>setTimeout(()=>{category='';renderProducts()},0);document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category;$('#filters select').value=category;renderProducts()});
$('#products').onclick=async e=>{
 const button=e.target.closest('[data-product]');if(!button)return;
 const p=products.find(x=>x.ID===button.dataset.product);if(!p)return;
 const media=p.Media?.[0],dialog=$('#productDialog'),detail=$('#productDetail');
 detail.innerHTML=`${media?`<div class="cardArt"><img src="${esc(media.URL)}" alt="${esc(media.AltText)}"></div>`:''}<p>${esc(p.Category)}</p><h2>${esc(p.Title)}</h2><p>${esc(p.Description)}</p><label>Variant <select id="variant">${p.Variants.map(v=>`<option value="${v.ID}" ${v.Inventory-v.Reserved<1?'disabled':''}>${esc(v.Name)} · ${v.PriceYNXT} YNXT · ${v.Inventory-v.Reserved} available</option>`).join('')}</select></label><button class="primary" id="add">Add to persistent cart</button>`;
 $('#storeEvidence').textContent='Loading seller policy and Trust evidence…';
 productContexts.open(dialog);const current=productContexts.capture(detail,requests.capture());
 detail.querySelector('#add').onclick=async()=>{
  try{current();if(!requireSignIn())return;
   const existingStore=cart.length?productFor(cart[0])?.StoreID:p.StoreID;
   if(existingStore&&existingStore!==p.StoreID){$('#storeEvidence').textContent='Create separate orders for different sellers.';return;}
   const id=detail.querySelector('#variant').value,variant=p.Variants.find(v=>v.ID===id);
   if(!variant||variant.Inventory-variant.Reserved<1){$('#storeEvidence').textContent='Choose an available variant.';return;}
   await cartAction(async assertWorkspace=>{
    current();const next=cart.map(x=>({...x})),found=next.find(x=>x.ProductID===p.ID&&x.VariantID===id);
    if(found)found.Quantity+=1;else next.push({ProductID:p.ID,VariantID:id,Quantity:1});
    await saveCart(next,current);assertWorkspace();current();productContexts.close(dialog);
   });
  }catch(error){try{current()}catch{return;}if(contextChanged(error))return;$('#storeEvidence').textContent='Cart change was not confirmed. '+error.message;}
 };
 try{const store=await api(`/stores/${p.StoreID}`);current();$('#storeEvidence').innerHTML=`<hr><h3>${esc(store.Name)}</h3><p>${esc(store.Policy)}</p>${store.TrustURL?`<a class="trustLink" href="${esc(store.TrustURL)}" rel="noreferrer">Open Trust evidence</a>`:'<p>Trust evidence: link unavailable</p>'}`;}
 catch(error){try{current()}catch{return;}if(contextChanged(error))return;$('#storeEvidence').textContent='Seller evidence unavailable: '+error.message;}
};
$('#closeProduct').onclick=()=>productContexts.close($('#productDialog'));
async function loadCart(){const data=await api('/cart');if(typeof data.Revision!=='string')throw new Error('Cart version unavailable. Refresh after the Shop service is updated.');cart=data.Items||[];cartRevision=data.Revision;renderCart()}
async function saveCart(items,beforeDispatch){if(cartRevision===null)throw new Error('Refresh the cart before changing it.');try{const saved=await api('/cart',{method:'PUT',body:JSON.stringify({Items:items,ExpectedRevision:cartRevision}),beforeDispatch});cart=saved.Items||[];cartRevision=saved.Revision??null;renderCart()}catch(error){if(contextChanged(error))throw error;await refreshAfterFailure();throw error}}
function renderCart(){$('#cartCount').textContent=cart.reduce((n,x)=>n+x.Quantity,0);let total=0;$('#cartLines').innerHTML=cart.map((x,i)=>{const p=productFor(x),v=variantFor(x);total+=(v?.PriceYNXT||0)*x.Quantity;return`<div class="cartLine"><span>${esc(p?.Title||x.ProductID)} · ${esc(v?.Name||x.VariantID)} × ${x.Quantity}</span><button data-remove="${i}">Remove</button></div>`}).join('')||'<p>Your persistent cart is empty.</p>';$('#cartTotal').innerHTML=`<h3>Subtotal ${total} YNXT</h3>`}
$('#cartButton').onclick=()=>{if(!requireSignIn())return;if($('#cart').hidden)cartPresentation++;$('#cart').hidden=false;renderCart()};$('#closeCart').onclick=closeCart;$('#cartLines').onclick=async e=>{if(e.target.dataset.remove!==undefined){const index=+e.target.dataset.remove;try{await cartAction(()=>saveCart(cart.filter((_,i)=>i!==index)))}catch(err){if(contextChanged(err))return;$('#orderState').textContent=err.message}}};
async function loadProfile(current=()=>{}){const data=await api('/profile',{beforeDispatch:current});current();profile=data.profile||{};const a=profile.Addresses?.[0];if(a)for(const key of['recipient','line1','city','region','postalCode','country']){const el=$('#checkout').elements[key];if(el)el.value=a[key[0].toUpperCase()+key.slice(1)]||''}}
const recoveryButton=document.createElement('button');recoveryButton.type='button';recoveryButton.textContent='Recover unconfirmed checkout';$('#orderState').after(recoveryButton);
async function confirmCheckout(order,account,intent,assertCurrent){
 assertCurrent();validateBuyerOrder(order,account);if(!order||typeof order.ID!=='string'||!order.ID||!ownedBuyer(order,account)||order.CartConsumption?.PreviousRevision!==intent.cartRevision||typeof order.CartConsumption?.Revision!=='string'||!order.CartConsumption.Revision)throw new Error('The order receipt does not match this account and checkout. Recovery evidence is preserved.');$('#orderState').textContent=`Order ${order.ID} confirmed. Status: ${order.Status}.`;
 try{await loadCart();assertCurrent();await checkoutRecovery.complete(account,intent.key);assertCurrent()}catch(error){if(contextChanged(error))throw error;$('#orderState').textContent+= ' Cart refresh or local recovery cleanup failed. Keep this checkout key and use Recover before placing another order: '+error.message}
 await loadOrders(true);
}
async function lookupCheckout(account,intent,assertCurrent){const order=await api('/orders/intent-lookup',{method:'POST',body:JSON.stringify({IdempotencyKey:intent.key}),beforeDispatch:assertCurrent});await confirmCheckout(order,account,intent,assertCurrent);return order}
recoveryButton.onclick=async()=>{if(!requireSignIn())return;const current=captureCart();try{await cartAction(async()=>{const assertCurrent=current;const account=checkoutAccount(),intent=await checkoutRecovery.pending(account);assertCurrent();if(!intent){$('#orderState').textContent='No saved checkout awaiting confirmation.';return}await lookupCheckout(account,intent,assertCurrent)})}catch(error){if(contextChanged(error))return;$('#orderState').textContent='Checkout remains unconfirmed. Keep the original cart and address to retry the same request. '+error.message}};
$('#checkout').onsubmit=async e=>{
 e.preventDefault();if(!requireSignIn())return;const form=e.target,current=captureCart();
 try{await cartAction(async()=>{const assertCurrent=current;assertCurrent();
  const account=checkoutAccount(),pending=await checkoutRecovery.pending(account);assertCurrent();
  if(pending&&await checkoutRecovery.phase(account,pending)!=='prepared'){assertCurrent();await lookupCheckout(account,pending,assertCurrent);return}
  if(!cart.length)throw new Error('No cart to retry. Use Recover; an empty cart does not prove checkout failed.');
  if(cartRevision===null)throw new Error('Refresh the cart before checkout.');
  const f=new FormData(form),p=productFor(cart[0]);if(!p)throw new Error('Refresh the catalog before checkout.');
  const revision=pending?.cartRevision??cartRevision;
  const input={StoreID:p.StoreID,Items:cart.map(x=>({...x})),Address:{Recipient:f.get('recipient'),Line1:f.get('line1'),City:f.get('city'),Country:f.get('country')},CartRevision:revision};
  const intent=await checkoutRecovery.prepareUnsent(account,input,revision,assertCurrent);assertCurrent();
  let order;
  try{order=await api('/orders',{method:'POST',body:JSON.stringify({...input,IdempotencyKey:intent.key}),beforeDispatch:()=>checkoutRecovery.dispatched(account,intent,assertCurrent)})}
  catch(error){await checkoutRecovery.unknown(account,intent);if(contextChanged(error))throw error;if(await checkoutRecovery.phase(account,intent)==='prepared')throw error;if(!intent.existing&&error.code==='CART_REVISION_CONFLICT'){await checkoutRecovery.complete(account,intent.key);await refreshAfterFailure();throw error}try{await lookupCheckout(account,intent,assertCurrent);return}catch(lookupError){if(contextChanged(lookupError))throw lookupError}throw error}
  await confirmCheckout(order,account,intent,assertCurrent);
 })}catch(error){if(contextChanged(error))return;$('#orderState').textContent='Checkout unconfirmed or rejected. Your recovery key is preserved when the outcome is unknown. '+error.message}
};
$('#ordersButton').onclick=()=>{if(requireSignIn())loadOrders(true)};$('#refreshOrders').onclick=()=>loadOrders(true);async function loadOrders(show){if(show){$('#ordersSection').hidden=false;$('#ordersSection').scrollIntoView({behavior:'smooth'})}try{const data=await api('/orders');renderOrders(data.orders||[])}catch(err){if(contextChanged(err))return;$('#ordersState').textContent=`Orders unavailable: ${err.message}`}}
const actionsFor=o=>{const a=[['ai_support','AI support draft']];if(actionRecovery.hasPending(o.ID))a.push(['recover_action',orderActionCopy().recover]);if(o.Status==='payment_pending')a.push(['pay','Review invoice in YNX Wallet'],['confirm-payment','Check settlement'],['cancelled','Cancel order']);if(o.Status==='paid')a.push(['refund_requested','Request refund'],['disputed','Open dispute']);if(o.Status==='shipped')a.push(['delivered','Confirm delivery'],['disputed','Open dispute']);if(['delivered','reviewed'].includes(o.Status))a.push(['return_requested','Request return'],['disputed','Open dispute'],['ai_return','AI return explanation']);if(o.Status==='delivered')a.push(['reviewed','Write review']);if(o.Status==='refund_requested')a.push(['disputed','Open dispute']);if(['return_requested','return_approved'].includes(o.Status))a.push(['refund_requested','Request refund'],['disputed','Open dispute'],['ai_return','AI return explanation']);return a};
function renderOrders(rows){rows.forEach(order=>validateBuyerOrder(order,checkoutAccount()));currentOrders=rows;$('#ordersState').textContent=rows.length?`${rows.length} persistent orders`:'No orders yet.';$('#orders').innerHTML=rows.map(o=>`<article class="orderCard"><div class="orderHead"><div><b>${esc(o.ID)}</b><p>${new Date(o.CreatedAt).toLocaleString()}</p></div><span class="statusPill">${esc(o.Status)}</span><strong>${o.TotalYNXT} YNXT</strong></div><div class="orderLines">${o.Lines.map(l=>`${esc(l.Title)} · ${esc(l.VariantName)} × ${l.Quantity}`).join('<br>')}</div><div class="evidenceRow"><span>Tax: ${esc(o.TaxStatus)}</span><span>Logistics: ${esc(o.LogisticsStatus)}</span><span>Refund: ${esc(o.RefundStatus)}</span><span>Trust: ${esc(o.TrustStatus)}</span>${o.Settlement?`<span>Settlement block ${o.Settlement.BlockHeight} · ${esc(o.Settlement.TransactionHash)}</span>`:''}${o.Refund?`<span>Refund block ${o.Refund.BlockHeight} · ${esc(o.Refund.TransactionHash)}</span>`:''}${o.TrustCase?.EvidenceURL?`<a href="${esc(o.TrustCase.EvidenceURL)}">Trust case</a>`:''}${o.TrustCase?.AppealURL?`<a href="${esc(o.TrustCase.AppealURL)}">Appeal</a>`:''}${o.Shipment?`<span>Manual shipment · ${esc(o.Shipment.Carrier)} · ${esc(o.Shipment.TrackingNumber)}</span>`:''}</div><div class="timeline" aria-label="Order timeline">${(o.Timeline||[]).map(event=>`<div><b>${esc(event.Status)}</b> · ${esc(event.Action)}<time>${new Date(event.At).toLocaleString()}</time></div>`).join('')}</div><div class="orderActions">${actionsFor(o).map(([a,l])=>`<button data-order="${o.ID}" data-action="${a}" ${a==='cancelled'?'class="danger"':''}>${l}</button>`).join('')}</div></article>`).join('')}
$('#orders').onclick=async e=>{const b=e.target.closest('[data-action]');if(!b)return;const {order,action}=b.dataset;if(action==='recover_action'){try{openAction(order,'',true)}catch(error){if(!contextChanged(error))$('#ordersState').textContent=error.message}return}if(action==='pay'){await reviewInvoice(order);return}if(action==='confirm-payment'){try{await api(`/orders/${order}/confirm-payment`,{method:'POST',body:'{}'});await loadOrders(false)}catch(err){if(contextChanged(err))return;$('#ordersState').textContent=`Still payment pending: ${err.message}`}return}if(action==='ai_support'){openAI({title:'AI support draft',workflow:'support_draft',contextClasses:['owned_order'],summary:`Owned order ${order}; no address or payment history`,estimate:10,onApply:r=>{$('#ordersState').textContent=`Support draft for review: ${r}`}});return}if(action==='ai_return'){openAI({title:'AI return explanation',workflow:'return_explanation',contextClasses:['owned_order'],summary:`Owned order ${order} status and seller policy only`,estimate:10,onApply:r=>{if(openAction(order,'return_requested'))$('#actionForm').elements.explanation.value=r}});return}try{openAction(order,action)}catch(error){if(!contextChanged(error))$('#ordersState').textContent=error.message}};
function openAction(orderId,action,recoverOnly=false){
 if(actionBusy){$('#ordersState').textContent=orderActionCopy().order_request_pending;return false}
 const order=currentOrders.find(row=>row.ID===orderId),account=checkoutAccount(),assertCurrent=requests.capture(),copy=orderActionCopy();validateBuyerOrder(order,account);if(!recoverOnly&&!buyerActionAllowed(order.Status,action))throw new Error('This order action is no longer available. Refresh the order.');
 const labels={cancelled:copy.cancel_order,delivered:copy.confirm_delivery,return_requested:copy.return_request,refund_requested:copy.refund_request,disputed:copy.dispute,reviewed:copy.write_review};actionPresentation={order:JSON.parse(JSON.stringify(order)),action,account,assertCurrent,recoverOnly};
 $('#actionTitle').textContent=recoverOnly?copy.recover:labels[action];$('#actionForm').elements.orderId.value=orderId;$('#actionForm').elements.action.value=action;
 const fields=value=>value==='reviewed'?'<label>'+esc(copy.order_rating)+' <select name="rating" required><option value="">'+esc(copy.order_rating_select)+'</option>'+[1,2,3,4,5].map(value=>'<option value="'+value+'">'+value+' ★</option>').join('')+'</select></label><label>'+esc(copy.order_review_text)+'<textarea name="body"></textarea></label>':(['return_requested','refund_requested','disputed'].includes(value)?'<label>'+esc(copy.order_reason)+'<input name="reason" required></label><label>'+esc(copy.order_explanation)+'<textarea name="explanation"></textarea></label>':value?'<p>'+esc(labels[value])+'</p>':'');
 $('#actionFields').innerHTML=recoverOnly?'<select id="originalAction" aria-label="'+esc(copy.recover)+'"><option value="">'+esc(copy.recover)+'</option>'+Object.entries(labels).map(([value,label])=>'<option value="'+value+'">'+esc(label)+'</option>').join('')+'</select><div id="originalActionFields"></div>':fields(action);
 if(recoverOnly)$('#originalAction').onchange=event=>{actionPresentation={...actionPresentation,action:event.target.value};$('#actionForm').elements.action.value=event.target.value;$('#originalActionFields').innerHTML=fields(event.target.value);$('#actionState').textContent=''};
 $('#actionState').textContent='';$('#actionSubmit').textContent=copy.order_submit;$('#actionSubmit').hidden=recoverOnly;$('#actionRecover').textContent=copy.recover;$('#actionDiscard').textContent=copy.discard;$('#closeAction').textContent=copy.cancel;$('#actionDialog').showModal();return true;
}
$('#closeAction').onclick=()=>$('#actionDialog').close();$('#actionDialog').addEventListener('close',()=>{actionPresentation=null;$('#actionForm').reset();$('#actionFields').replaceChildren();$('#actionState').textContent=''});
$('#actionForm').onsubmit=async event=>{
 event.preventDefault();if(actionBusy||!actionPresentation)return;const presentation=actionPresentation,operation=Symbol(),copy=orderActionCopy();
 const current=()=>{presentation.assertCurrent();if(actionPresentation!==presentation||!$('#actionDialog').open||checkoutAccount()!==presentation.account)throw new ContextChangedError();};
 const form=new FormData(event.target),discard=event.submitter?.id==='actionDiscard',recover=presentation.recoverOnly||event.submitter?.id==='actionRecover';actionBusy=operation;for(const button of event.target.querySelectorAll('input,textarea,select,button:not(#closeAction)'))button.disabled=true;
 try{current();if(discard){await actionRecovery.discardPrepared('/orders/'+presentation.order.ID+'/transition',current);current();$('#actionState').textContent=copy.discarded;return}
  let input;try{input=buyerActionInput(presentation.order.Status,presentation.action,{rating:Number(form.get('rating')||0),reason:form.get('reason')||'',explanation:form.get('explanation')||'',body:form.get('body')||''},{readOnly:recover})}catch{throw Error(copy.order_input_required)}
  await actionRecovery.execute(presentation.order.ID,input,current,(path,body,beforeDispatch)=>api(path,{method:'POST',body:JSON.stringify(body),beforeDispatch}),(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)}),recover);current();$('#actionDialog').close();await loadOrders(false);
 }catch(error){if(contextChanged(error))return;$('#actionState').textContent=error.message}
 finally{if(actionBusy===operation){actionBusy=null;for(const button of $('#actionForm').querySelectorAll('input,textarea,select,button:not(#closeAction)'))button.disabled=false}}
};

let privateAttempt=0;
const walletState=$('#walletState');
const walletLabel=connection=>`${connection.wallet==='ynx-wallet'?'YNX Wallet':'MetaMask'} · ${connection.account.slice(0,6)}…${connection.account.slice(-4)}`;
function renderStandardWallet(connection){
  $('#privateSession').disabled=!connection&&!privateSignoutPending();$('#privateSession').textContent=privateSignoutPending()?privateCopy('retry'):token()?privateCopy('active'):privateCopy('connectBuyer');
  $('#wallet').textContent=connection?walletLabel(connection):'Sign in with YNX Wallet';
}
function openWalletChooser(){walletState.textContent='Choose an installed wallet. Connecting never sends your recovery phrase or private key to Shop.';$('#walletDialog').showModal()}
async function connectWallet(wallet){
  walletState.textContent=`Looking for ${wallet==='ynx'?'YNX Wallet':'MetaMask'}…`;
  try{
    const connection=await startWalletAuth('buyer',{wallet});
    renderStandardWallet(connection);
    walletState.textContent=`Connected to YNX Testnet as ${connection.account}. Standard account and transaction access is available; private Shop services remain separately protected.`;
    $('#status').textContent='Wallet connected. You can continue browsing; private Shop actions will report their Product Session status separately.';
    if($('#walletDialog').open)$('#walletDialog').close();
    $('#wallet').focus();
  }catch(e){if(contextChanged(e))return;
    walletState.textContent=`${e.code||'WALLET_CONNECTION_FAILED'}: ${e.message}`;
  }
}
$('#wallet').onclick=openWalletChooser;
$('#privateSession').onclick=async()=>{const attempt=++privateAttempt,connection=standardConnection();try{if(privateSignoutPending()){const state=await clearPrivateSession();renderStandardWallet(standardConnection());$('#status').textContent=state?.message||'Private sign-out confirmation is pending.';return}if(!standardConnection()){openWalletChooser();return}const state=await startPrivateSession();if(attempt!==privateAttempt||connection!==standardConnection())throw new ContextChangedError();if(state.status!=='connecting'||state.route?.status!=='ready'||!state.route.url){$('#status').textContent=state.message||'Private approval is unavailable.';return}const link=document.createElement('a');link.href=state.route.url;link.textContent=privateCopy('openBuyer');$('#status').replaceChildren(document.createTextNode('Review access to your profile, cart, and orders. No private session has been created. '),link);}catch(error){if(contextChanged(error))return;$('#status').textContent='Private Shop service unavailable; standard Wallet remains connected: '+error.message;}};
$('#connectYNXWallet').onclick=()=>connectWallet('ynx');
$('#connectMetaMask').onclick=()=>connectWallet('metamask');
$('#downloadYNXWallet').href=OFFICIAL_YNX_WALLET_DOWNLOAD_URL;
$('#downloadMetaMask').href=STANDARD_METAMASK_DOWNLOAD_URL;
$('#closeWalletDialog').onclick=()=>{cancelWalletConnection();$('#walletDialog').close()};
$('#walletDialog').oncancel=()=>cancelWalletConnection();
onStandardConnectionChange(connection=>{
  privateAttempt++;
  requests.invalidate();
  renderStandardWallet(connection);
  if(!connection&&$('#walletDialog').open)walletState.textContent='The wallet disconnected or left YNX Testnet. Choose a wallet to reconnect.';
});
function clearPrivateWorkspace(){$('#status').replaceChildren();requests.invalidate();cartPresentation++;invoicePresentation=null;actionPresentation=null;currentOrders=[];resetAI();cart=[];profile=null;cartRevision=null;cartBusy=null;renderCart();$('#orders').innerHTML='';$('#ordersSection').hidden=true;$('#cart').hidden=true;$('#checkout').reset();$('#profileForm').reset();$('#actionForm').reset();$('#actionFields').replaceChildren();$('#deleteConfirmation').value='';for(const id of['ordersState','orderState','profileState','privacyState','actionState'])$('#'+id).textContent='';document.querySelectorAll('dialog[open]').forEach(d=>d.close());renderStandardWallet(standardConnection());}
onPrivateSessionChange(clearPrivateWorkspace);
$('#disconnectWallet').onclick=()=>{clearPrivateWorkspace();clearWalletSession();$('#status').textContent='Signed out. Connect Wallet to continue with your account.';};
$('#profileButton').onclick=async()=>{if(!requireSignIn())return;profileContexts.open($('#profileDialog'));const current=profileContexts.capture($('#profileForm'),requests.capture());$('#privacyState').textContent='';$('#deleteConfirmation').value='';try{await loadProfile(current);current();const p=profile||{},a=p.Addresses?.[0]||{};for(const [k,v]of Object.entries({displayName:p.DisplayName||'',recipient:a.Recipient||'',line1:a.Line1||'',city:a.City||'',region:a.Region||'',postalCode:a.PostalCode||'',country:a.Country||''}))$('#profileForm').elements[k].value=v}catch(err){try{current()}catch{return}if(contextChanged(err))return;$('#profileState').textContent=err.message}};
$('#closeProfile').onclick=()=>profileContexts.close($('#profileDialog'));
$('#profileForm').onsubmit=async e=>{e.preventDefault();const current=profileContexts.capture(e.target,requests.capture()),f=new FormData(e.target),has=f.get('recipient')||f.get('line1')||f.get('country');try{const saved=await api('/profile',{method:'PUT',body:JSON.stringify({DisplayName:f.get('displayName'),Addresses:has?[{Recipient:f.get('recipient'),Line1:f.get('line1'),City:f.get('city'),Region:f.get('region'),PostalCode:f.get('postalCode'),Country:f.get('country')}]:[]}),beforeDispatch:current});current();profile=saved.profile||saved;$('#profileState').textContent='Profile and address saved.'}catch(err){try{current()}catch{return}if(contextChanged(err))return;$('#profileState').textContent=err.message}};
$('#exportData').onclick=async()=>{if(!requireSignIn())return;const current=profileContexts.capture($('#profileForm'),requests.capture());try{const data=await api('/privacy/export',{beforeDispatch:current});current();downloadJSON(`ynx-shop-data-${new Date().toISOString().slice(0,10)}.json`,data);$('#privacyState').textContent=tr('exported',{orders:data.orders?.length||0,ai:data.aiJobs?.length||0,notice:data.retentionNotice});}catch(err){try{current()}catch{return}if(contextChanged(err))return;$('#privacyState').textContent=tr('exportFailed',{error:err.message})}};
$('#deleteData').onclick=async()=>{if(!requireSignIn())return;const confirmation=$('#deleteConfirmation').value;if(confirmation!=='DELETE_MY_SHOP_DATA'){$('#privacyState').textContent=tr('exactRequired');return}const assertCurrent=profileContexts.capture($('#profileForm'),requests.capture());try{const account=checkoutAccount();const receipt=await checkoutRecovery.exclusive(account,async pending=>{assertCurrent();if(pending)throw new Error('Recover the unconfirmed checkout before deleting shopping data.');return api('/privacy/delete',{method:'POST',body:JSON.stringify({confirmation}),beforeDispatch:assertCurrent})});assertCurrent();profile=null;cart=[];cartRevision=null;renderCart();$('#profileForm').reset();$('#deleteConfirmation').value='';$('#privacyState').textContent=tr('deleted',{receipt:receipt.receiptId,orders:receipt.ordersPseudonymized})}catch(err){try{assertCurrent()}catch{return}if(contextChanged(err))return;$('#privacyState').textContent=tr('deleteFailed',{error:err.message})}};
let aiGeneration=0;
function resetAI(){aiGeneration++;aiRequests.invalidate();aiJob=null;aiConfig=null;$('#aiState').textContent='';$('#aiContextPreview').textContent='';$('#aiEstimate').textContent='';$('#aiReview').hidden=true;for(const id of['aiGrant','aiApply','aiReject','aiDelete'])$('#'+id).disabled=false;}
function closeAI(){
  const job=aiJob;resetAI();const generation=aiGeneration,assertCurrent=requests.capture();if($('#aiDialog').open)$('#aiDialog').close();
  if(job&&['permission_granted','running'].includes(job.Status))void api(`/ai/jobs/${encodeURIComponent(job.ID)}/cancel`,{method:'POST',body:'{}'}).then(()=>{assertCurrent();if(generation===aiGeneration)$('#status').textContent='AI cancellation confirmed.'}).catch(error=>{if(!contextChanged(error)&&generation===aiGeneration)$('#status').textContent='AI dialog closed. Server cancellation could not be confirmed: '+error.message});
}
function openAI(config){
  if(!requireSignIn())return;if(aiConfig)closeAI();else resetAI();aiConfig=config;
  $('#aiDialog h2').textContent=config.title;$('#aiContextPreview').textContent=config.summary;$('#aiEstimate').textContent=String(config.estimate);
  $('#aiState').textContent=`Context preview accepted only after review. Estimate: ${config.estimate} AI units.`;$('#aiReview').hidden=true;$('#aiDialog').showModal();
}
async function streamAI(id){
 const subject=token(),assertCurrent=aiRequests.capture(),url=`${apiRoot}/ai/jobs/${encodeURIComponent(id)}/stream`,wire=await authorizeBusinessRequest(url);assertCurrent();
 try{return await streamJob(aiRequests,url,wire,state=>{$('#aiState').textContent=`Provider ${state.ProviderStatus} · ${state.Status}`;});}
 catch(error){if(error.status===401&&subject&&subject===token()){expirePrivateSession();$('#status').textContent='Your Shop session expired. Approve a new private session to continue.';throw new ContextChangedError()}throw error}
}
$('#compare').onclick=()=>openAI({title:'AI product comparison',workflow:'search_comparison',contextClasses:['public_catalog'],summary:`Public catalog search: ${$('#query').value||'discover'}`,estimate:12,onApply:r=>{$('#status').textContent=`Comparison draft for review: ${r}`}});
$('#aiDialog').oncancel=event=>{event.preventDefault();closeAI();};
$('#aiDialog').onclose=()=>{if(!$('#aiDialog').open&&aiConfig)closeAI();};
$('#aiCancel').onclick=closeAI;
$('#aiGrant').onclick=async()=>{
  if(!aiConfig||$('#aiGrant').disabled)return;const config=aiConfig,assertCurrent=aiRequests.capture();$('#aiGrant').disabled=true;
  try{
    const created=await aiAPI('/ai/jobs',{method:'POST',body:JSON.stringify({Workflow:config.workflow,ContextClasses:config.contextClasses,ContextSummary:config.summary,EstimateUnits:config.estimate,PermissionGranted:true,IdempotencyKey:crypto.randomUUID()})});assertCurrent();aiJob=created;
    $('#aiState').textContent='Permission recorded. Connecting to configured provider…';const id=encodeURIComponent(aiJob.ID);
    const [job]=await Promise.all([aiAPI(`/ai/jobs/${id}/run`,{method:'POST',body:'{}'}),streamAI(aiJob.ID)]);assertCurrent();aiJob=job;
    $('#aiState').textContent=aiJob.Result||`AI job status: ${aiJob.Status}`;$('#aiReview').hidden=aiJob.Status!=='review_required';
  }catch(error){if(contextChanged(error))return;try{assertCurrent()}catch{return}aiRequests.invalidate();$('#aiState').textContent=`AI unavailable or failed honestly: ${error.message}`;$('#aiGrant').disabled=false;}
};
for(const decision of['Apply','Reject'])$('#ai'+decision).onclick=async()=>{
  if(!aiJob||!aiConfig||$('#ai'+decision).disabled)return;const job=aiJob,config=aiConfig,assertCurrent=aiRequests.capture();$('#aiApply').disabled=true;$('#aiReject').disabled=true;$('#aiDelete').disabled=true;
  try{const result=await aiAPI(`/ai/jobs/${encodeURIComponent(job.ID)}/decision`,{method:'POST',body:JSON.stringify({Decision:decision.toLowerCase()})});assertCurrent();aiJob=result;$('#aiState').textContent=`Result ${result.Status}. No purchase was made.`;if(decision==='Apply'){closeAI();config.onApply(result.Result)}}
  catch(error){if(contextChanged(error))return;try{assertCurrent()}catch{return}$('#aiState').textContent=error.message;$('#aiApply').disabled=false;$('#aiReject').disabled=false;}
  finally{try{assertCurrent();$('#aiDelete').disabled=false}catch{}}
};
$('#aiDelete').onclick=async()=>{
  if(!aiJob||$('#aiDelete').disabled)return;const job=aiJob,assertCurrent=aiRequests.capture();$('#aiDelete').disabled=true;
  try{await aiAPI(`/ai/jobs/${encodeURIComponent(job.ID)}`,{method:'DELETE'});assertCurrent();aiJob=null;$('#aiState').textContent='AI context and result deleted.';$('#aiReview').hidden=true;$('#aiGrant').disabled=false;}
  catch(error){if(contextChanged(error))return;try{assertCurrent()}catch{return}$('#aiState').textContent=error.message;}
  finally{try{assertCurrent();$('#aiDelete').disabled=false}catch{}}
};
// Moving to another buyer view invalidates the current AI dialog immediately.
for(const id of['profileButton','ordersButton','cartButton','search','filters'])$('#'+id).addEventListener(id==='search'?'submit':id==='filters'?'input':'click',()=>{if(aiConfig)closeAI()},{capture:true});
function showSellerContinuation(session){const link=document.createElement('a');link.href=session.entry;link.textContent=privateCopy('continueSeller');$('#status').replaceChildren(document.createTextNode(session.rejected?'Seller approval was rejected. No private session was created. ':'Seller approval verified. Buyer access was not granted. '),link);}

async function reviewInvoice(orderId){if(!requireSignIn())return;try{const assertCurrent=requests.capture(),account=checkoutAccount(),order=currentOrders.find(o=>o.ID===orderId);if(!order)throw Error('Refresh the current order first.');const pending=await invoiceRecovery.prepare(account,order,assertCurrent);assertCurrent();const create=pending.phase==='prepared';const response=await api('/orders/'+pending.orderId+'/pay-handoff',{method:create?'POST':'GET',...(create?{body:JSON.stringify({IdempotencyKey:pending.key}),beforeDispatch:()=>invoiceRecovery.dispatched(account,pending,assertCurrent)}:{})});assertCurrent();const received=await invoiceRecovery.received(account,pending,response,assertCurrent);assertCurrent();invoicePresentation={account,original:received,assertCurrent};$('#invoiceOrder').textContent=order.ID;$('#invoiceAmount').textContent=order.TotalYNXT.toLocaleString()+' YNXT';$('#invoiceReference').textContent=received.invoiceId;$('#openInvoiceWallet').href='ynxpay://invoice/'+received.invoiceId;$('#invoiceDialog').showModal()}catch(error){if(contextChanged(error))return;$('#ordersState').textContent='Original invoice remains unconfirmed. Refresh its original reference before taking further action. '+error.message}}
$('#closeInvoice').onclick=()=>{$('#invoiceDialog').close();invoicePresentation=null};
$('#openInvoiceWallet').onclick=async event=>{event.preventDefault();const shown=invoicePresentation;if(!shown)return;try{shown.assertCurrent();await invoiceRecovery.requested(shown.account,shown.original,shown.assertCurrent);shown.assertCurrent();location.href='ynxpay://invoice/'+shown.original.invoiceId;$('#invoiceDialog').close();invoicePresentation=null;$('#ordersState').textContent='Wallet opening requested. Payment remains pending until backend settlement is confirmed.'}catch(error){if(!contextChanged(error))$('#ordersState').textContent=error.message}};
async function resumeOriginalInvoice(){if(!token())return;try{const assertCurrent=requests.capture(),account=checkoutAccount(),pending=await invoiceRecovery.pending(account,assertCurrent);assertCurrent();if(!pending)return;const order=await api('/orders/'+pending.orderId);assertCurrent();await invoiceRecovery.observed(account,pending,order,assertCurrent);assertCurrent();await loadOrders(false)}catch(error){if(!contextChanged(error))$('#ordersState').textContent='Original payment readback unavailable: '+error.message}}
window.addEventListener('pageshow',()=>resumeOriginalInvoice());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeOriginalInvoice()});
async function bootstrap(){let continuation=null,callbackFailure=null;installI18n();if('serviceWorker'in navigator){const scope=new URL('./',document.baseURI).pathname;navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope}).catch(()=>{})}try{const restored=await restoreStandardConnection();if(restored){renderStandardWallet(restored);$('#status').textContent='Wallet connection restored on YNX Testnet.'}}catch{}try{const session=await completeWalletCallback();if(session?.continuation==='seller'||session?.continuation==='buyer-rejected'){continuation=session;}else if(session)$('#wallet').textContent=`Wallet · ${session.account.slice(0,10)}…`}catch(e){if(contextChanged(e))return;callbackFailure=`Wallet callback rejected: ${e.message}`}await load();if(token())await resumeOriginalInvoice();if(callbackFailure)$('#status').textContent=callbackFailure;else if(continuation?.continuation==='seller')showSellerContinuation(continuation);else if(continuation?.continuation==='buyer-rejected')$('#status').textContent='Shop approval was rejected. No private session was created.'}
for(const id of['profileButton','ordersButton','cartButton'])$('#'+id).disabled=true;
bootstrap().finally(()=>{for(const id of['profileButton','ordersButton','cartButton'])$('#'+id).disabled=false});

document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('#actionDialog').open)$('#actionDialog').close()});window.addEventListener('pagehide',()=>{if($('#actionDialog').open)$('#actionDialog').close()});

function suspendBuyerForms(){if($('#productDialog').open)productContexts.close($('#productDialog'));if($('#profileDialog').open)profileContexts.close($('#profileDialog'));if(!$('#cart').hidden)closeCart();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspendBuyerForms()});window.addEventListener('pagehide',suspendBuyerForms);
