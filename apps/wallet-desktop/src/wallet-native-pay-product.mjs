const fail=code=>{throw Object.assign(Error(code),{code});};
// P06 owns orchestration. Main only publishes its SAME pending request into
// the existing approval UI; summary DATA never becomes an approval packet.
export function createWalletNativePayProduct({entry,getMain,getGuard,publishReview}){
  let closing=false;const active=new Set();
  async function invoke(input,original){
    if(closing)fail('NATIVE_PAY_MAIN_CLOSING');
    const guard=getGuard(),main=getMain();
    const current=()=>{guard.assert();if(original&&original.assertHostCurrent()!==undefined)fail('NATIVE_PAY_MAIN_HOST_CURRENT_RESULT');};
    current();let pending;const ticket={};active.add(ticket);
    try{
      const result=await (original?entry.invokeOriginalOrderResult(input,original.operation,current):entry.invoke(input));
      if(!original)guard.assert();
      if(result?.walletRequest){
        const id=result.walletRequest.id;
        const candidate=main.pendingRequests().find(request=>request.id===id);
        if(!candidate||candidate.review?.account!==guard.account||!['ynx_signPQNativeAction','ynx_broadcastPQNativeAction'].includes(candidate.method)||result.walletRequest.method!==candidate.method)fail('NATIVE_PAY_MAIN_REVIEW_CHANGED');
        pending=candidate;current();publishReview(candidate);
      }
      current();return result;
    }catch(cause){
      if(pending)try{main.expire(pending.id);}catch{/* original failure wins; existing Main retains any cleanup debt */}
      throw cause;
    }finally{active.delete(ticket);}
  }
  return Object.freeze({
    status:()=>entry.status(),
    cancel:()=>entry.cancel(),
    assertSafeToClose(){closing=true;if(active.size)fail('NATIVE_PAY_MAIN_OPERATION_PENDING');entry.assertSafeToClose?.();},
    invoke(input){return invoke(input);},
    invokeOriginalOrderResult(input,operation,assertHostCurrent){
      if(arguments.length!==3||typeof operation!=='string'||!/^npi_[0-9a-f]{48}$/.test(operation)||typeof assertHostCurrent!=='function')fail('NATIVE_PAY_MAIN_ORIGINAL_ORDER_REQUIRED');
      return invoke(input,{operation,assertHostCurrent});
    },
  });
}
export function installWalletNativePayProductIPC({handleWalletIPC,safeIPC,sensitiveIPC,service}){
  handleWalletIPC('wallet:native-pay-status',()=>safeIPC(()=>service.status()));
  handleWalletIPC('wallet:native-pay-invoke',(_event,input)=>sensitiveIPC(()=>service.invoke(input)));
  handleWalletIPC('wallet:native-pay-cancel',()=>safeIPC(()=>service.cancel()));
}
