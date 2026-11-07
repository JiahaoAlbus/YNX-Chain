import {types} from 'node:util';
// Main-private read-only step consumer. NOT a Native registrar, caller capture,
// transport, Source or permission. Only the existing Main keyAccess ALS lease
// may enter. There is no renderer/IPC/URL/path/token/provider input here.
const fault=code=>Object.assign(Error(code),{code});
function publicError(cause){const raw=cause?.data?.code??cause?.code,code=typeof raw==='string'&&/^[A-Z0-9_]{1,128}$/.test(raw)?raw:'STANDALONE_PAY_NAVIGATION_FAILED';return {ok:false,error:{code,message:'Original Pay navigation did not complete. Preserve the original order; no retry or approval is performed.'}};}
export function createMainStandalonePayNavigationSteps({nativePayProduct,keyAccess}){
 let closing=false,held=null,shutdown=null;
 function open(action,args){
  if(closing)throw fault('STANDALONE_PAY_NAVIGATION_CLOSED');if(held)throw fault('STANDALONE_PAY_NAVIGATION_BUSY');
  if(args.length!==(action==='order-refund-review'?3:1)||typeof args[0]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(args[0]))throw fault('STANDALONE_PAY_ORDER_INVALID');
  const sourceOrder=args[0];
  if(action==='order-refund-review'&&(typeof args[1]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(args[1])||typeof args[2]!=='string'||!/^[0-9]{1,256}$/.test(args[2])))throw fault('STANDALONE_PAY_REFUND_INVALID');
  const request=Object.freeze({action,productId:'shop.order',sourceOrder,...(action==='order-refund-review'?{refundId:args[1],amountAtoms:args[2]}:{})});
  const guard=keyAccess.current();guard.assert();const original=keyAccess.status();
  if(original.locked||original.authenticating||original.account!==guard.account||!/^0x[0-9a-f]{40}$/.test(original.account??'')||!Number.isSafeInteger(original.revision)||!Number.isSafeInteger(guard.expiresAtMs))throw fault('STANDALONE_PAY_CONTEXT_REQUIRED');
  const account=original.account,generation=original.revision,deadline=guard.expiresAtMs;
  let retired=false,closed=false,statusSelected=false,statusSettled=false,canInvoke=false,invokeSelected=false,firstPresent=false,firstCause,joining=null,closeFlight=null;const active=new Set();
  const remember=cause=>{if(!firstPresent){firstPresent=true;firstCause=cause;}};
  function current(){if(retired||closed)throw fault('STANDALONE_PAY_NAVIGATION_RETIRED');if(keyAccess.current()!==guard)throw fault('STANDALONE_PAY_CONTEXT_CHANGED');guard.assert();const state=keyAccess.status();if(state.locked||state.authenticating||state.account!==account||state.revision!==generation||keyAccess.now()>=deadline)throw fault('STANDALONE_PAY_CONTEXT_CHANGED');}
  function run(kind,args){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});active.add(promise);void promise.then(()=>active.delete(promise),()=>active.delete(promise));void Promise.resolve().then(()=>step(kind,args)).then(resolve,reject);return promise;}
  async function step(kind,args){
   try{current();if(args.length)throw fault('STANDALONE_PAY_ARGUMENTS_INVALID');
    if(kind==='status'){if(statusSelected)throw fault('STANDALONE_PAY_STATUS_ONCE');statusSelected=true;}
    else{if(!statusSettled||!canInvoke)throw fault('STANDALONE_PAY_NOT_READY');if(invokeSelected)throw fault('STANDALONE_PAY_INVOKE_ONCE');invokeSelected=true;}
    const value=await(kind==='status'?nativePayProduct.status():nativePayProduct.invoke(request));
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
  held=owner;return owner;
 }
 return Object.freeze({openOrder:(...a)=>open('order-invoice',a),openOrderTermsReview:(...a)=>open('order-terms-review',a),openOrderPayReview:(...a)=>open('order-pay-review',a),openOrderRefundReview:(...a)=>open('order-refund-review',a),retireAll(){held?.retire();},async join(){if(held)await held.join();},close(){closing=true;return shutdown??=(async()=>{const child=held;if(child){child.retire();await child.join();await child.close();child.assertSafeToClose();}})();},assertSafeToClose(){if(held)throw fault('STANDALONE_PAY_CHILD_NOT_CLOSED');}});
}
