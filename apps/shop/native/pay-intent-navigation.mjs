// Normal Main/Pay owner supplies its existing qualified entry. This adapter
// consumes original-order reads and explicit Main review requests; it constructs no
// Source, approval, capsule, signer, endpoint or transaction journal.
const fail=(code,cause)=>{throw Object.assign(Error(code,cause?{cause}:undefined),{code});};
export function createOriginalShopPayNavigation({entry,current}){
 if(typeof entry?.invoke!=='function'||typeof entry?.status!=='function'||typeof current!=='function')fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');
 let active=false;
 async function dispatch(request,beforeInvoke){
  if(active)fail('SHOP_NATIVE_PAY_MAIN_BUSY');
  active=true;
  try{
   current();const status=await entry.status();current();
   if(status?.canRequest===false||(status?.available!==true&&status?.canRequest!==true)||status?.normalMainEntry!==true||status?.paymentAuthorized!==false){
    const reason=typeof status?.reason==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(status.reason)?Object.assign(Error(status.reason),{code:status.reason}):undefined;
    fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE',reason);
   }
   beforeInvoke?.();const response=await entry.invoke(request);current();
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
 const nativeHash=value=>typeof value==='string'&&/^0x[a-f0-9]{64}$/.test(value);
 const address=value=>typeof value==='string'&&/^0x[a-f0-9]{40}$/.test(value);
 function originalOrder(sourceOrder){if(!identifier(sourceOrder))fail('SHOP_NATIVE_PAY_ORDER_REQUIRED');return {productId:'shop.order',sourceOrder};}
 function checkedArchive(response,ref,operation){
  const receipt=response.archiveReceipt;
  if(receipt?.version!=='ynx.pay.native.archive-receipt/v1'||['productId','sourceOrder','merchant','invoiceId','nativeHash'].some(k=>receipt[k]!==ref[k])||
   !nativeHash(receipt.abciHash)||!identifier(receipt.sessionId)||!['invoice_settle','invoice_refund'].includes(receipt.kind)||!['confirmed','confirmed_failed'].includes(receipt.status)||
   receipt.proofVerification!=='original-independent-core-verifier'||receipt.dataOnly!==true||receipt.queryOnly!==true||receipt.canRetry!==false||receipt.SourceAdmission!==false||receipt.nativeGrant!==false)
   fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  if(operation&&(['abciHash','kind','status'].some(k=>receipt[k]!==operation[k])||['sessionId','genesis','nativeChainId'].some(k=>receipt[k]!==response.bill[k])))fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  return receipt;
 }
 async function orderAction(action,sourceOrder,extra={},beforeInvoke){
  const original=originalOrder(sourceOrder);
  const response=await dispatch({action,...original,...extra},beforeInvoke);
  const ref=response?.reference;
  if(ref?.productId!==original.productId||ref?.sourceOrder!==sourceOrder||typeof ref?.intentId!=='string'||!/^npi_[a-f0-9]{48}$/.test(ref.intentId)||typeof ref?.merchant!=='string'||!/^0x[a-f0-9]{40}$/.test(ref.merchant)||!identifier(ref?.invoiceId)||response?.clientIndependentFinality!==false||response?.canRetry!==false)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  if(action==='order-reconcile-operation'||action==='order-receipt'){
   if(ref.nativeHash!==extra.nativeHash||response.queryOnly!==true||response.approvalRequired!==false||response.walletRequest!=null||response.paymentAuthorized===true)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
   let observed;
   if(action==='order-reconcile-operation'){
    observed=response.reconciledOriginal;
    if(!observed||['merchant','invoiceId','nativeHash'].some(k=>observed[k]!==ref[k])||!nativeHash(observed.abciHash)||!address(observed.owner)||
     !['invoice_terms','invoice_settle','invoice_refund'].includes(observed.kind)||!['unknown','submitted','confirmed','confirmed_failed'].includes(observed.status)||
     (observed.kind==='invoice_settle'?observed.owner===ref.merchant:observed.owner!==ref.merchant)||
     !response.bill||['sourceOrder','merchant','invoiceId'].some(k=>response.bill[k]!==ref[k])||!Array.isArray(response.operations))fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
    const matching=response.operations.filter(row=>row?.nativeHash===extra.nativeHash);
    if(matching.length!==1||['abciHash','kind','status'].some(k=>matching[0][k]!==observed[k]))fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
    if(response.archiveReceipt!=null||(observed.kind!=='invoice_terms'&&['confirmed','confirmed_failed'].includes(observed.status)))checkedArchive(response,ref,observed);
   }else observed=checkedArchive(response,ref);
   // Original Main checked and persisted its original operation. This bounded
   // DATA projection is not a Shop funds receipt or permission to send again.
   return Object.freeze({...original,originalOperation:ref.intentId,merchant:ref.merchant,invoiceID:ref.invoiceId,nativeHash:extra.nativeHash,abciHash:observed.abciHash,operationKind:observed.kind,operationStatus:observed.status,queryOnly:true,canRetry:false,clientIndependentFinality:false,paymentAuthorized:false});
  }
  if(action==='order-invoice'){
   if(response.queryOnly!==true||response.approvalRequired!==false||response.walletRequest!=null||response.paymentAuthorized===true||response.intent?.intentId!==ref.intentId||response.intent?.originalOperation!==ref.intentId||!['PREPARED','ISSUED'].includes(response.intent?.state))fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
   if(response.bill!=null){
    if(response.bill.sourceOrder!==sourceOrder||response.bill.invoiceId!==ref.invoiceId||response.bill.merchant!==ref.merchant)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
    if(response.intent.state==='PREPARED'){
     const hash=response.intent.termsNativeHash;
     if(response.recoveryOnly!==true||ref.kind!=='invoice_terms'||!nativeHash(hash)||ref.nativeHash!==hash||response.bill.termsNativeHash!==hash)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
    }
   }
   return Object.freeze({...original,originalOperation:ref.intentId,invoiceID:ref.invoiceId,queryOnly:true,recoveryOnly:response.recoveryOnly===true,clientIndependentFinality:false,paymentAuthorized:false});
  }
  if(action==='order-refund-review'&&ref.refundId!==extra.refundId)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  const pending=response.walletRequest;
  if(response.approvalRequired!==true||response.queryOnly!==false||typeof pending?.id!=='string'||pending.id.length===0||pending.id.length>256||pending.method!=='ynx_signPQNativeAction'||pending.approvalRequired!==true)fail('SHOP_NATIVE_PAY_REVIEW_CHANGED');
  // Main retains the actual review. This id is not an approval/sign/send result.
  return Object.freeze({...original,originalOperation:ref.intentId,invoiceID:ref.invoiceId,reviewID:pending.id,reviewPending:true,approvalInOriginalMain:true,clientIndependentFinality:false,paymentAuthorized:false});
 }
 async function originalOperationAction(action,sourceOrder,hash){
  const original=Object.freeze({...originalOrder(sourceOrder),nativeHash:hash});
  if(!nativeHash(hash))fail('SHOP_NATIVE_PAY_ORIGINAL_HASH_REQUIRED');
  let invoked=false;
  try{return await orderAction(action,sourceOrder,{nativeHash:hash},()=>{invoked=true;});}
  catch(cause){
   if(!invoked)throw cause;current();
   // A lost Main reply does not establish npi/merchant/invoice DATA. Keep only
   // the known selector, and offer the original archive read without invoking it.
   const code=typeof cause?.code==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(cause.code)?cause.code:'SHOP_NATIVE_PAY_MAIN_UNAVAILABLE';
   throw Object.assign(Error(code,{cause}),{code,originalReference:original,recoveryAction:Object.freeze({action:'order-receipt',...original}),canRetry:false,outcome:'UNKNOWN'});
  }
 }
 return Object.freeze({
  openOriginalIntent:operation=>invoke(operation),recoverOriginalIntent:operation=>invoke(operation),
  openOriginalOrder:sourceOrder=>orderAction('order-invoice',sourceOrder),
  recoverOriginalOrder:sourceOrder=>orderAction('order-invoice',sourceOrder),
  reconcileOriginalOrderOperation:(sourceOrder,hash)=>originalOperationAction('order-reconcile-operation',sourceOrder,hash),
  recoverOriginalOrderOperation:(sourceOrder,hash)=>originalOperationAction('order-receipt',sourceOrder,hash),
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
