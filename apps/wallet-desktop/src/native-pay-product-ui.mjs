// Renderer presentation only. Every operation goes through the existing trusted
// Main IPC and original review. No Source, approval packet, signer or URL input.
export const NATIVE_PAY_UI_ACTIONS=Object.freeze({
 invoice:['merchant','invoiceId'],intent:['intentId'],'create-intent':['productId','sourceOrder'],'lookup-intent':['productId','sourceOrder'],
 'terms-review':['intentId'],'pay-review':['merchant','invoiceId'],'refund-review':['merchant','invoiceId','refundId','amountAtoms'],
 recover:['merchant','invoiceId','nativeHash'],'recover-archive':['productId','sourceOrder','merchant','invoiceId','nativeHash'],'reconcile-archive':['productId','sourceOrder','merchant','invoiceId'],
});
const labels={invoice:'Read invoice / 读取账单',intent:'Read original intent / 读取原意向','create-intent':'Create invoice intent / 创建账单意向','lookup-intent':'Find original order intent / 查找原订单意向','terms-review':'Request terms review / 请求条款审核','pay-review':'Request payment review / 请求付款审核','refund-review':'Request refund review / 请求退款审核',recover:'Recover original invoice / 恢复原账单','recover-archive':'Recover original archive / 恢复原订单归档','reconcile-archive':'Reconcile original archive / 核对原订单归档'};
const fieldLabels={merchant:'Merchant ID (0x) / 商户 ID',invoiceId:'Original invoice ID / 原账单 ID',intentId:'Original intent ID / 原意向 ID',productId:'Original product ID / 原产品 ID',sourceOrder:'Original source order / 原订单',nativeHash:'Original native hash (not ABCI hash) / 原生哈希（非 ABCI 哈希）',refundId:'Original refund ID / 原退款 ID',amountAtoms:'Refund amount (integer atoms) / 退款整数原子量'};
export function nativePayUIRequest(action,values){
 const fields=NATIVE_PAY_UI_ACTIONS[action];if(!fields)throw Error('Unsupported Pay action');const result={action};
 for(const field of fields){const value=values[field];if(typeof value!=='string'||!value||value!==value.trim()||value.length>256||/[\u0000-\u001f]/.test(value))throw Error('Enter every original field exactly.');
 if(field==='merchant'&&!/^0x[0-9a-f]{40}$/.test(value)||field==='nativeHash'&&!/^0x[0-9a-f]{64}$/.test(value)||field==='amountAtoms'&&!/^[1-9][0-9]*$/.test(value))throw Error('Invalid original ID, hash or integer amount.');if(['sourceOrder','invoiceId'].includes(field)&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value)||field==='intentId'&&!/^npi_[0-9a-f]{48}$/.test(value)||field==='productId'&&!['shop.order','cloud.ide-usage'].includes(value)||field==='amountAtoms'&&BigInt(value)>18446744073709551615n)throw Error('Unsupported or invalid original selector.');result[field]=value;}
 return Object.freeze(result);
}
const recoveryNames=new Set(['invoice','intent','lookup-intent','recover','recover-archive','reconcile-archive']);
const refFields=['merchant','invoiceId','intentId','productId','sourceOrder','nativeHash','refundId'];
const primitive=v=>typeof v==='string'&&v.length<=512||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
export function nativePayUIDisplay(reply){
 if(reply?.ok!==true){const error=Error('Main request failed. Original result is unconfirmed.');if(typeof reply?.error?.code==='string'&&/^[A-Z0-9_]{1,128}$/.test(reply.error.code))error.code=reply.error.code;throw error;}
 const value=reply.value;if(value?.version!=='ynx.pay.main-result/v1'||typeof value.ok!=='boolean'||value.canRetry!==false)throw Error('Unrecognized original Pay result. Do not retry.');
 for(const section of ['bill','archiveReceipt','reconciliation'])if(value[section])for(const [key,item]of Object.entries(value[section]))if((key.endsWith('Atoms')||['expiresAtHeight','executionHeight','executionIndex','executionMember','executionEvent'].includes(key))&&item!==undefined&&typeof item!=='string')throw Error('Original quantities must remain strings.');
 const facts=[];for(const key of ['phase','reason','code','outcome','queryOnly','recoveryOnly','clientIndependentFinality','approvalRequired','paymentAuthorized','httpStatus','outcomeUnknown'])if(primitive(value[key]))facts.push([key,String(value[key])]);
 for(const section of ['reference','intent','bill'])for(const key of section==='bill'?['merchant','invoiceId','sourceOrder','status','refundStatus','assetId','unitVersion','principalAtoms','paidAtoms','refundedAtoms','netPaidAtoms','termsFeeAtoms','paymentFeeAtoms','refundFeeAtoms','maxFeeAtoms','expiresAtHeight','termsNativeHash','settlementNativeHash']:section==='intent'?['intentId','originalOperation','state','phase','termsNativeHash']:refFields)if(primitive(value[section]?.[key]))facts.push([section+'.'+key,String(value[section][key])]);
 const archiveFields=["version","productId","storeId","sourceOrder","merchant","invoiceId","sessionId","nativeHash","abciHash","kind","status","archiveDigest","termsHash","settlementNativeHash","eventClaim","executionHeight","executionIndex","executionMember","executionEvent","assetId","unitVersion","refundId","payer","recipient","principalAtoms","paidAtoms","refundedAtoms","netPaidAtoms","proofVerification","dataOnly","queryOnly","canRetry","SourceAdmission","nativeGrant","completeKnownOriginals"];
 for(const section of ['archive','archiveReceipt','reconciliation']){const item=value[section];if(!item||typeof item!=='object')continue;for(const key of archiveFields)if(primitive(item[key]))facts.push([section+'.'+key,String(item[key])]);if(Array.isArray(item.receipts))for(const [i,row]of item.receipts.slice(0,50).entries())for(const key of archiveFields)if(primitive(row?.[key]))facts.push([section+'.receipts['+i+'].'+key,String(row[key])]);}
 for(const [i,op]of (Array.isArray(value.operations)?value.operations:[]).slice(0,50).entries())for(const key of ['nativeHash','abciHash','kind','status','failure'])if(primitive(op?.[key]))facts.push(['operations['+i+'].'+key,String(op[key])]);
 if(Array.isArray(value.pendingOriginals))for(const [i,hash]of value.pendingOriginals.slice(0,50).entries())if(typeof hash==='string'&&/^0x[0-9a-f]{64}$/.test(hash))facts.push(['pendingOriginals['+i+']',hash]);
 for(const key of ['id','method','approvalRequired'])if(primitive(value.walletRequest?.[key]))facts.push(['walletRequest.'+key,String(value.walletRequest[key])]);
 const recoveries=[];if(Array.isArray(value.recoveryActions))for(const item of value.recoveryActions.slice(0,8))try{if(!recoveryNames.has(item.action))continue;const request=nativePayUIRequest(item.action,item);if(Object.keys(item).length!==Object.keys(request).length)continue;recoveries.push(request);}catch{}
 return {failed:value.ok===false,unknown:value.ok===false||value.outcomeUnknown===true,review:value.ok===true&&value.approvalRequired===true&&typeof value.walletRequest?.id==='string',facts,recoveries};
}
// Public selector only. SAME Main review association + original durable list
// are checked again; Main alone validates original Member and Pay submitOnce.
export function selectNativePayBroadcastReview(selection,originalReview,reply,pending){
 const fail=code=>{throw Object.assign(Error(code),{code});},hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
 const kindByAction={'terms-review':'invoice_terms','pay-review':'invoice_settle','refund-review':'invoice_refund'},kind=kindByAction[selection?.request?.action],r=selection?.request,c=selection?.context;
 if(!kind||originalReview?.id!==selection.reviewId||originalReview.method!=='ynx_signPQNativeAction'||originalReview.review?.account!==c?.account)fail('NATIVE_PAY_UI_SAME_ORIGINAL_REVIEW_REQUIRED');
 const typed=originalReview.review.typedReview,invoice=originalReview.review.invoice;
 if(typed?.account!==c.account||typed.action?.kind!==kind||typed.action?.owner!==c.account||invoice?.kind!==kind||invoice.owner!==c.account||invoice.operationId!==typed.operationId)fail('NATIVE_PAY_UI_ORIGINAL_REVIEW_BINDING');
 if(kind==='invoice_terms'){if(invoice.merchant!==c.account||!/^npi_[0-9a-f]{48}$/.test(r.intentId??''))fail('NATIVE_PAY_UI_ORIGINAL_REVIEW_BINDING');}
 else if(invoice.merchant!==r.merchant||invoice.invoiceID!==r.invoiceId||kind==='invoice_refund'&&invoice.refundID!==r.refundId)fail('NATIVE_PAY_UI_ORIGINAL_REVIEW_BINDING');
 const result=reply?.value?.result;if(reply?.ok!==true||reply.value.status!=='success'||result?.version!==1||result.account!==c.account||result.savedLocally!==true||result.submitted!==false||result.confirmed!==false||!hash(result.transportHash)||!hash(result.memberHash)||result.transportHash===result.memberHash||result.hash!==result.transportHash||result.operationId!==typed.operationId)fail('NATIVE_PAY_UI_ORIGINAL_SIGN_RESULT_UNCONFIRMED');
 if(pending?.ok!==true||!Array.isArray(pending.value)||pending.value.length>256)fail('NATIVE_PAY_UI_ORIGINAL_SELECTOR_UNAVAILABLE');
 const matches=pending.value.filter(row=>row?.account===c.account&&row.hash===result.transportHash&&row.operationId===result.operationId&&row.kind==='pq-typed-action');
 if(matches.length!==1||matches[0].status!=='pq-signed-unsubmitted'||matches[0].canRetryExact!==false)fail('NATIVE_PAY_UI_ORIGINAL_NOT_UNSUBMITTED');
 if(matches[0].resultStorageConfirmed!==true||matches[0].resultHeldInMemory===true)fail('NATIVE_PAY_UI_ORIGINAL_STORAGE_UNCONFIRMED');
 return Object.freeze({action:'broadcast-review',kind,merchant:kind==='invoice_terms'?'':r.merchant,invoiceId:kind==='invoice_terms'?'':r.invoiceId,intentId:kind==='invoice_terms'?r.intentId:'',originalHash:result.transportHash});
}

export function mountNativePayProductUI({document:doc,window:win,api,getContext,reviewPending}){
 const root=doc.createElement('dialog');root.id='native-pay-product-sheet';root.setAttribute('aria-labelledby','native-pay-product-title');
 const make=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 const title=make('h2','YNX Pay · 原生账单与原件'),intro=make('p','Use original merchant, invoice and order identifiers. Requests for terms, payment and refund only open Main review. Signing and broadcasting require their own original approvals. / 使用原商户、账单与订单标识；条款、付款、退款仅请求主进程审核，签名与广播另行批准。');title.id='native-pay-product-title';
 const status=make('p');status.setAttribute('role','status');const form=make('form'),select=make('select');select.setAttribute('aria-label','Pay operation / Pay 操作');
 for(const [action,text]of Object.entries(labels)){const option=make('option',text);option.value=action;select.append(option);}select.value='invoice';
 const fields=make('div'),submit=make('button','Read invoice / 读取账单');submit.type='submit';const facts=make('dl');facts.className='network-facts';const recoveries=make('div'),review=make('button','Open original Main review / 查看主进程原审核');review.type='button';review.hidden=true;
 const cancel=make('button','Cancel held review / 取消待审核请求');cancel.type='button';const close=make('button','Close / 关闭');close.type='button';form.append(select,fields,submit);root.append(title,intro,status,form,facts,recoveries,review,cancel,close);doc.body.append(root);
 let epoch=0,opened=false,busy=false,ready=false,held=false,unknown=false,debt=false,touched=false,cancelFlight=null,signSelection=null;const inputs=new Map();
 const context=()=>getContext(),live=(before,token)=>{const after=context();return opened&&epoch===token&&typeof before.account==='string'&&/^0x[0-9a-f]{40}$/.test(before.account)&&before.account===after.account&&before.keyRevision===after.keyRevision&&!after.locked&&after.focused!==false;};
 // Readiness is read-only: locked/empty contexts may explain refusal, but cannot enable an operation.
 const readinessCurrent=(before,token)=>{const after=context();return opened&&epoch===token&&before.account===after.account&&before.keyRevision===after.keyRevision&&before.locked===after.locked&&before.focused===after.focused;};
 function paint(){submit.disabled=!ready||busy||held||unknown||debt;select.disabled=busy||held||unknown||debt;for(const input of inputs.values())input.disabled=select.disabled;cancel.disabled=!!cancelFlight;close.disabled=!!cancelFlight;}
 function fieldForm(){fields.replaceChildren();inputs.clear();for(const name of NATIVE_PAY_UI_ACTIONS[select.value]){const label=make('label',fieldLabels[name]),input=make('input');input.id='native-pay-'+name;input.maxLength=256;input.autocomplete='off';input.spellcheck=false;input.required=true;label.setAttribute('for',input.id);fields.append(label,input);inputs.set(name,input);}submit.textContent=labels[select.value];paint();}
 select.addEventListener('change',fieldForm);fieldForm();
 async function invalidate(reason='Pay context changed. Original results are retained. / Pay 上下文已变更，原结果保留。'){
  epoch++;ready=false;busy=false;held=false;signSelection=null;review.hidden=true;facts.replaceChildren();recoveries.replaceChildren();for(const input of inputs.values())input.value='';status.textContent=reason;
  if(cancelFlight)return cancelFlight;
  if(!touched){paint();return true;}
  if(typeof api.nativePayCancel!=='function'){debt=true;status.textContent='Cancel unavailable; cleanup is unconfirmed. / 无取消接口，清理未确认。';paint();return false;}
  cancelFlight=(async()=>{try{const reply=await api.nativePayCancel();if(reply?.ok!==true||reply.value?.cancelled!==true||reply.value?.originalRetained!==true)throw Error();debt=false;touched=false;return true;}catch{debt=true;status.textContent='Cancellation failed or is unconfirmed. Keep original records; do not retry the operation. / 取消失败或未确认，请保留原记录，勿重试业务。';return false;}finally{cancelFlight=null;paint();}})();paint();return cancelFlight;
 }
 async function run(request,recovery=false){
  if(busy||debt||!ready||held||(!recovery&&unknown))return;const before=context(),token=epoch;if(!live(before,token))return;busy=true;touched=true;facts.replaceChildren();recoveries.replaceChildren();review.hidden=true;paint();status.textContent='Reading original Pay result… / 正在读取原 Pay 结果…';
  try{const reply=await api.nativePayInvoke(request);if(!live(before,token))return;const view=nativePayUIDisplay(reply);unknown=unknown||view.unknown;held=view.review;signSelection=view.review&&reply.value.walletRequest.method==='ynx_signPQNativeAction'&&['terms-review','pay-review','refund-review'].includes(request.action)?{reviewId:reply.value.walletRequest.id,request,context:before,token,consumed:false}:null;facts.replaceChildren();recoveries.replaceChildren();for(const [key,value]of view.facts){const dt=make('dt',key),dd=make('dd',value);dd.dir='ltr';facts.append(dt,dd);}review.hidden=!view.review;
   status.textContent=view.failed?'Pay failed or outcome UNKNOWN. No automatic retry; use only original recovery below. / Pay 失败或结果未知，不自动重试；仅用下列原件恢复。':view.review?'Original Main review requested; nothing is approved by this screen. / 已请求主进程原审核，本页面未批准任何操作。':'Original Pay query completed. This is not payment or consensus finality. / 原 Pay 查询已返回，不代表付款或共识最终性。';
   for(const item of view.recoveries){const button=make('button',labels[item.action]);button.type='button';button.addEventListener('click',()=>{if(live(before,token))void run(item,true);});recoveries.append(button);}
  }catch(error){if(live(before,token)){unknown=true;status.textContent=(error.code?error.code+' · ':'')+'Original result is unconfirmed. Preserve references; no automatic retry or new signature. / 原结果未确认，请保留标识；不自动重试或重新签名。';}}
  finally{if(live(before,token)){busy=false;paint();}}
 }
 form.addEventListener('submit',event=>{event.preventDefault();try{const request=nativePayUIRequest(select.value,Object.fromEntries([...inputs].map(([k,v])=>[k,v.value])));void run(request);}catch(error){status.textContent=error.message;}});
 review.addEventListener('click',()=>{if(held&&!debt&&!context().locked){root.close();reviewPending?.();}});
 cancel.addEventListener('click',()=>void invalidate('Cancel requested. Original results remain retained. / 已请求取消，原结果仍保留。'));
 async function closeSheet(){if(await invalidate('Closing original Pay review… / 正在关闭原 Pay 审核…')){opened=false;root.close();}}
 close.addEventListener('click',()=>void closeSheet());root.addEventListener('cancel',event=>{event.preventDefault();void closeSheet();});
 win?.addEventListener('blur',()=>{if(opened)void invalidate();});win?.addEventListener('pagehide',()=>{if(opened)void invalidate();});
 doc.addEventListener?.('visibilitychange',()=>{if(opened&&doc.visibilityState==='hidden')void invalidate();});
 return Object.freeze({async open(){if(opened){if(!root.open)root.showModal();return;}opened=true;epoch++;root.showModal();ready=false;unknown=false;held=false;status.textContent='Checking Pay readiness… / 正在检查 Pay 就绪状态…';paint();
   if(debt){status.textContent='Prior cancellation remains unconfirmed. Use Cancel; no new request. / 之前取消未确认，请先取消，不发新请求。';return;}
   if(['nativePayStatus','nativePayInvoke','nativePayCancel'].some(k=>typeof api[k]!=='function')){status.textContent='Native Pay normal entry is unavailable in this build. / 本版本没有原生 Pay 正常入口。';return;}
   const before=context(),token=epoch;try{const reply=await api.nativePayStatus();if(!readinessCurrent(before,token))return;if(reply?.ok!==true||reply.value?.normalMainEntry!==true||reply.value?.paymentAuthorized!==false)throw Error();ready=reply.value.canRequest===true&&live(before,token);status.textContent=ready?'Enter the original identifiers. A Source is acquired for each request. / 请输入原始标识，每次请求独立获取原 Source。':typeof before.account!=='string'||!/^0x[0-9a-f]{40}$/.test(before.account)?'Create or import an account, then unlock Wallet before requesting Pay. / 请先创建或导入账户并解锁钱包，再请求 Pay。':before.locked||before.focused===false?'Unlock and focus Wallet before requesting Pay. / 请先解锁并保持钱包前台。':'Pay is not ready for a request. No operation was sent. / Pay 暂未就绪，未发送任何业务请求。';paint();}catch{if(readinessCurrent(before,token))status.textContent='Pay readiness unconfirmed. / Pay 就绪状态未确认。';}},async observeOriginalDecision(originalReview,action,reply){
   const selected=signSelection;if(!selected||selected.consumed||originalReview?.id!==selected.reviewId||!live(selected.context,selected.token))return false;selected.consumed=true;
   if(action!=='approve'){held=false;review.hidden=true;status.textContent='Original signing review declined. No broadcast requested. / 原签名审核已拒绝，未请求广播。';paint();return false;}
   try{
    if(typeof api.pendingTransactions!=='function')throw Object.assign(Error(),{code:'NATIVE_PAY_UI_ORIGINAL_SELECTOR_UNAVAILABLE'});
    const pending=await api.pendingTransactions();if(!live(selected.context,selected.token))return false;
    const request=selectNativePayBroadcastReview(selected,originalReview,reply,pending);held=false;review.hidden=true;recoveries.replaceChildren();
    const original=make('p',request.kind+' · ABCI '+request.originalHash);original.dir='ltr';const button=make('button','Request separate original broadcast review / 请求独立原广播审核');button.type='button';
    button.addEventListener('click',()=>{if(live(selected.context,selected.token)){button.disabled=true;void run(request);}});recoveries.append(original,button);
    status.textContent='Original signed result is retained and unsubmitted. This only requests a separate Main broadcast review; nothing is sent automatically. / 原签名结果已保留且未提交；下一步仅请求独立主进程广播审核，不自动发送。';paint();
    if(!root.open&&!doc.querySelector?.('dialog[open]'))root.showModal();return true;
   }catch(error){if(live(selected.context,selected.token)){held=true;review.hidden=true;status.textContent=(error.code??'NATIVE_PAY_UI_ORIGINAL_SELECTOR_UNCONFIRMED')+' · Original retained; no broadcast candidate can be confirmed. / 原件保留，无法确认可提交原件。';paint();}return false;}
  },invalidate:()=>opened?invalidate():Promise.resolve(true),close:closeSheet,element:root});
}
