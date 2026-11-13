import {types} from 'node:util';
// Main-private order/review/reconciliation consumer. NOT a Native registrar, caller capture,
// transport, Source or permission. Only the existing Main keyAccess ALS lease
// may enter. A protected caller also needs the original holder captured by
// Main's supplier. No renderer/IPC input can install or provide that holder.
const fault=code=>Object.assign(Error(code),{code});
const protectedActions=new Set(['order-invoice','order-terms-review','order-pay-review','order-refund-review','order-reconcile-operation']);
function publicError(cause){const raw=cause?.data?.code??cause?.code,code=typeof raw==='string'&&/^[A-Z0-9_]{1,128}$/.test(raw)?raw:'STANDALONE_PAY_NAVIGATION_FAILED';return {ok:false,error:{code,message:'Original Pay navigation did not complete. Preserve the original order; no retry or approval is performed.'}};}
export function createMainStandalonePayNavigationSteps({nativePayProduct,keyAccess,captureOriginalShopHolder}){
 let closing=false,openingProtected=false,held=null,shutdown=null;
 function open(action,args,protectedOrder=false){
  if(closing)throw fault('STANDALONE_PAY_NAVIGATION_CLOSED');if(held||openingProtected)throw fault('STANDALONE_PAY_NAVIGATION_BUSY');
  if(args.length!==(action==='order-refund-review'?3:action==='order-reconcile-operation'?2:1)||typeof args[0]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(args[0]))throw fault('STANDALONE_PAY_ORDER_INVALID');
  const sourceOrder=args[0];
  if(action==='order-refund-review'&&(typeof args[1]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(args[1])||typeof args[2]!=='string'||!/^[0-9]{1,256}$/.test(args[2])))throw fault('STANDALONE_PAY_REFUND_INVALID');
  if(action==='order-reconcile-operation'&&(typeof args[1]!=='string'||!/^0x[0-9a-f]{64}$/.test(args[1])))throw fault('STANDALONE_PAY_ORIGINAL_HASH_INVALID');
  const request=Object.freeze({action,productId:'shop.order',sourceOrder,...(action==='order-reconcile-operation'?{nativeHash:args[1]}:{}),...(action==='order-refund-review'?{refundId:args[1],amountAtoms:args[2]}:{})});
  const guard=keyAccess.current();guard.assert();const original=keyAccess.status();
  if(original.locked||original.authenticating||original.account!==guard.account||!/^0x[0-9a-f]{40}$/.test(original.account??'')||!Number.isSafeInteger(original.revision)||!Number.isSafeInteger(guard.expiresAtMs))throw fault('STANDALONE_PAY_CONTEXT_REQUIRED');
  const account=original.account,generation=original.revision,deadline=guard.expiresAtMs;
  let assertHolderCurrent,operation;
  if(protectedOrder){
   if(typeof captureOriginalShopHolder!=='function'||typeof nativePayProduct.invokeOriginalOrderResult!=='function')throw fault('STANDALONE_PAY_PROTECTED_HOLDER_REQUIRED');
   openingProtected=true;
   let holder;
   try{holder=captureOriginalShopHolder(request);}finally{openingProtected=false;}
   if(!holder||types.isProxy(holder)||!Object.isFrozen(holder))throw fault('STANDALONE_PAY_PROTECTED_HOLDER_INVALID');
   const fields=Object.getOwnPropertyDescriptors(holder);
   const holderRequest=fields.request?.value,originalOperation=fields.originalOperation?.value,holderAccount=fields.account?.value;
   const walletGeneration=fields.walletGeneration?.value,nativeGeneration=fields.nativeGeneration?.value;
   const session=fields.session?.value,readCurrent=fields.current?.value;
   if(holderRequest!==request||typeof originalOperation!=='string'||!/^npi_[0-9a-f]{48}$/.test(originalOperation)||
      holderAccount!==account||walletGeneration!==generation||!Number.isSafeInteger(nativeGeneration)||nativeGeneration<0||
      !session||typeof session!=='object'||types.isProxy(session)||typeof readCurrent!=='function'||types.isProxy(readCurrent))
    throw fault('STANDALONE_PAY_PROTECTED_HOLDER_INVALID');
   operation=originalOperation;
   // Current is synchronous. The original supplier must return this exact
   // capture only while its session, generation and request still match.
   assertHolderCurrent=()=>{if(readCurrent()!==holder)throw fault('STANDALONE_PAY_PROTECTED_HOLDER_CHANGED');};
  }
  let retired=false,closed=false,statusSelected=false,statusSettled=false,canInvoke=false,invokeSelected=false,firstPresent=false,firstCause,joining=null,closeFlight=null;const active=new Set();
  const remember=cause=>{if(!firstPresent){firstPresent=true;firstCause=cause;}};
  function assertWalletCurrent(){if(retired||closed)throw fault('STANDALONE_PAY_NAVIGATION_RETIRED');if(keyAccess.current()!==guard)throw fault('STANDALONE_PAY_CONTEXT_CHANGED');guard.assert();const state=keyAccess.status();if(state.locked||state.authenticating||state.account!==account||state.revision!==generation||keyAccess.now()>=deadline)throw fault('STANDALONE_PAY_CONTEXT_CHANGED');}
  function current(){
   assertWalletCurrent();
   if(assertHolderCurrent){assertHolderCurrent();assertWalletCurrent();}
  }
  function run(kind,args){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});active.add(promise);void promise.then(()=>active.delete(promise),()=>active.delete(promise));void Promise.resolve().then(()=>step(kind,args)).then(resolve,reject);return promise;}
  async function step(kind,args){
   try{current();if(args.length)throw fault('STANDALONE_PAY_ARGUMENTS_INVALID');
    if(kind==='status'){if(statusSelected)throw fault('STANDALONE_PAY_STATUS_ONCE');statusSelected=true;}
    else{if(!statusSettled||!canInvoke)throw fault('STANDALONE_PAY_NOT_READY');if(invokeSelected)throw fault('STANDALONE_PAY_INVOKE_ONCE');invokeSelected=true;}
    const value=await(kind==='status'?nativePayProduct.status():protectedOrder
     ?nativePayProduct.invokeOriginalOrderResult(request,operation,current)
     :nativePayProduct.invoke(request));
    current();
    if(kind==='status'){if(!value||types.isProxy(value)||value.normalMainEntry!==true||value.paymentAuthorized!==false||typeof value.canRequest!=='boolean')throw fault('STANDALONE_PAY_STATUS_INVALID');statusSettled=true;canInvoke=value.canRequest===true;}
    return {ok:true,value};
   }catch(cause){remember(cause);return publicError(cause);}
  }
  function retire(){retired=true;}
  function join(){retire();return joining??=(async()=>{while(active.size)await Promise.allSettled([...active]);})();}
  function close(){return closeFlight??=(async()=>{await join();closed=true;if(held===owner)held=null;})();}
  const owner=Object.freeze({status:(...a)=>run('status',a),invoke:(...a)=>run('invoke',a),retire,join,close,
   assertSafeToClose(){if(active.size||!closed)throw fault('STANDALONE_PAY_CHILD_NOT_CLOSED');},
   // Main diagnostic custody only. Neither method is an authenticated caller
   // getter and neither is exported to any transport or renderer.
   readFirstCause:()=>({present:firstPresent,...(firstPresent?{cause:firstCause}:{})})});
  if(protectedOrder){
   openingProtected=true;
   try{current();if(closing)throw fault('STANDALONE_PAY_NAVIGATION_CLOSED');}finally{openingProtected=false;}
  }
  held=owner;return owner;
 }
 return Object.freeze({openOrder:(...a)=>open('order-invoice',a),openOrderTermsReview:(...a)=>open('order-terms-review',a),openOrderPayReview:(...a)=>open('order-pay-review',a),openOrderRefundReview:(...a)=>open('order-refund-review',a),openOrderReconcileOperation:(...a)=>open('order-reconcile-operation',a),
  openProtectedOrder(action,...args){if(!protectedActions.has(action))throw fault('STANDALONE_PAY_ORDER_INVALID');return open(action,args,true);},
  retireAll(){held?.retire();},async join(){if(held)await held.join();},close(){closing=true;return shutdown??=(async()=>{const child=held;if(child){child.retire();await child.join();await child.close();child.assertSafeToClose();}})();},assertSafeToClose(){if(held)throw fault('STANDALONE_PAY_CHILD_NOT_CLOSED');}});
}
