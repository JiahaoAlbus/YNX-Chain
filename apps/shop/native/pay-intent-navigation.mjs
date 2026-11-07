// Normal Main/Pay owner supplies its existing qualified entry. This adapter
// consumes original-order reads and explicit Main review requests; it constructs no
// Source, approval, capsule, signer, endpoint or transaction journal.
const fail=(code,cause)=>{throw Object.assign(Error(code,cause?{cause}:undefined),{code});};
export function createOriginalShopPayNavigation({entry,current}){
 if(typeof entry?.invoke!=='function'||typeof entry?.status!=='function'||typeof current!=='function')fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');
 let active=false;
 async function dispatch(request){
  if(active)fail('SHOP_NATIVE_PAY_MAIN_BUSY');
  active=true;
  try{
   current();const status=await entry.status();current();
   if((status?.available!==true&&status?.canRequest!==true)||status?.normalMainEntry!==true||status?.paymentAuthorized!==false){
    const reason=typeof status?.reason==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(status.reason)?Object.assign(Error(status.reason),{code:status.reason}):undefined;
    fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE',reason);
   }
   const response=await entry.invoke(request);current();
   if(response?.ok===false){if(typeof response.code==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(response.code))fail(response.code);fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');}
   return response;
  }finally{active=false;}
 }
 async function invoke(originalOperation){
  if(typeof originalOperation!=='string'||!/^npi_[a-f0-9]{48}$/.test(originalOperation))fail('SHOP_NATIVE_PAY_ORIGINAL_REQUIRED');
  // Cold recovery remains a read. Never select recover-intent/reconcile here.
  const response=await dispatch({action:'intent',intentId:originalOperation});
  if(response?.reference?.intentId!==originalOperation||response?.intent?.intentId!==originalOperation||response?.intent?.originalOperation!==originalOperation||!['PREPARED','ISSUED'].includes(response.intent.state)||response?.clientIndependentFinality!==false)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  return Object.freeze({originalOperation,queryOnly:true,clientIndependentFinality:false,approvalInOriginalMain:true});
 }
 const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
 function originalOrder(sourceOrder){if(!identifier(sourceOrder))fail('SHOP_NATIVE_PAY_ORDER_REQUIRED');return {productId:'shop.order',sourceOrder};}
 async function orderAction(action,sourceOrder,extra={}){
  const original=originalOrder(sourceOrder);
  const response=await dispatch({action,...original,...extra});
  const ref=response?.reference;
  if(ref?.productId!==original.productId||ref?.sourceOrder!==sourceOrder||typeof ref?.intentId!=='string'||!/^npi_[a-f0-9]{48}$/.test(ref.intentId)||typeof ref?.merchant!=='string'||!/^0x[a-f0-9]{40}$/.test(ref.merchant)||!identifier(ref?.invoiceId)||response?.clientIndependentFinality!==false||response?.canRetry!==false)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  if(action==='order-invoice'){
   if(response.queryOnly!==true||response.approvalRequired!==false||response.walletRequest!=null||response.intent?.intentId!==ref.intentId||response.intent?.originalOperation!==ref.intentId||!['PREPARED','ISSUED'].includes(response.intent?.state))fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
   if(response.bill!=null&&(response.intent.state!=='ISSUED'||response.bill.sourceOrder!==sourceOrder||response.bill.invoiceId!==ref.invoiceId||response.bill.merchant!==ref.merchant))fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
   return Object.freeze({...original,originalOperation:ref.intentId,invoiceID:ref.invoiceId,queryOnly:true,recoveryOnly:response.recoveryOnly===true,clientIndependentFinality:false,paymentAuthorized:false});
  }
  if(action==='order-refund-review'&&ref.refundId!==extra.refundId)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  const pending=response.walletRequest;
  if(response.approvalRequired!==true||response.queryOnly!==false||typeof pending?.id!=='string'||pending.id.length===0||pending.id.length>256||pending.method!=='ynx_signPQNativeAction'||pending.approvalRequired!==true)fail('SHOP_NATIVE_PAY_REVIEW_CHANGED');
  // Main retains the actual review. This id is not an approval/sign/send result.
  return Object.freeze({...original,originalOperation:ref.intentId,invoiceID:ref.invoiceId,reviewID:pending.id,reviewPending:true,approvalInOriginalMain:true,clientIndependentFinality:false,paymentAuthorized:false});
 }
 return Object.freeze({
  openOriginalIntent:operation=>invoke(operation),recoverOriginalIntent:operation=>invoke(operation),
  openOriginalOrder:sourceOrder=>orderAction('order-invoice',sourceOrder),
  recoverOriginalOrder:sourceOrder=>orderAction('order-invoice',sourceOrder),
  reviewOriginalOrderTerms:sourceOrder=>orderAction('order-terms-review',sourceOrder),
  reviewOriginalOrderPayment:sourceOrder=>orderAction('order-pay-review',sourceOrder),
  async reviewOriginalOrderRefund(sourceOrder,refundId,amountAtoms){
   if(!identifier(refundId)||typeof amountAtoms!=='string'||!/^[1-9][0-9]{0,19}$/.test(amountAtoms)||BigInt(amountAtoms)>18446744073709551615n)fail('SHOP_NATIVE_PAY_REFUND_ORIGINAL_REQUIRED');
   return orderAction('order-refund-review',sourceOrder,{refundId,amountAtoms});
  }
 });
}

// Consume only the existing normal Main preload methods. This is JS response
// adaptation, not a standalone Native transport, caller registration or grant.
export function createOriginalShopPayNavigationFromMainIPC({api,current}){
 if(typeof api?.nativePayStatus!=='function'||typeof api?.nativePayInvoke!=='function'||typeof current!=='function')fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');
 const status=api.nativePayStatus.bind(api),invoke=api.nativePayInvoke.bind(api);
 async function unwrap(call){
  current();const reply=await call();current();
  if(reply?.ok!==true){
   const code=reply?.error?.code;
   if(typeof code==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(code))fail(code);
   const cause=Number.isSafeInteger(code)?Object.assign(Error('Original Main IPC refusal'),{code}):undefined;
   fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE',cause);
  }
  if(!reply.value||typeof reply.value!=='object')fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');
  return reply.value;
 }
 return createOriginalShopPayNavigation({entry:Object.freeze({status:()=>unwrap(status),invoke:request=>unwrap(()=>invoke(request))}),current});
}
