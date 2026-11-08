const fail=code=>{throw Object.assign(Error(code),{code});};
// P06 owns orchestration. Main only publishes its SAME pending request into
// the existing approval UI; summary DATA never becomes an approval packet.
export function createWalletNativePayProduct({entry,getMain,getGuard,publishReview}){
  let closing=false;const active=new Set();
  return Object.freeze({
    status:()=>entry.status(),
    cancel:()=>entry.cancel(),
    assertSafeToClose(){closing=true;if(active.size)fail('NATIVE_PAY_MAIN_OPERATION_PENDING');entry.assertSafeToClose?.();},
    async invoke(input){
      if(closing)fail('NATIVE_PAY_MAIN_CLOSING');
      const guard=getGuard(),main=getMain();guard.assert();let pending;const ticket={};active.add(ticket);
      try{
        const result=await entry.invoke(input);guard.assert();
        if(result?.walletRequest){
          const id=result.walletRequest.id;
          const candidate=main.pendingRequests().find(request=>request.id===id);
          if(!candidate||candidate.review?.account!==guard.account||!['ynx_signPQNativeAction','ynx_broadcastPQNativeAction'].includes(candidate.method)||result.walletRequest.method!==candidate.method)fail('NATIVE_PAY_MAIN_REVIEW_CHANGED');
          pending=candidate;guard.assert();publishReview(candidate);guard.assert();
        }
        return result;
      }catch(cause){
        if(pending)try{main.expire(pending.id);}catch{/* original failure wins; existing Main retains any cleanup debt */}
        throw cause;
      }finally{active.delete(ticket);}
    },
  });
}
export function installWalletNativePayProductIPC({handleWalletIPC,safeIPC,sensitiveIPC,service}){
  handleWalletIPC('wallet:native-pay-status',()=>safeIPC(()=>service.status()));
  handleWalletIPC('wallet:native-pay-invoke',(_event,input)=>sensitiveIPC(()=>service.invoke(input)));
  handleWalletIPC('wallet:native-pay-cancel',()=>safeIPC(()=>service.cancel()));
}
