// Local logout, remote revocation and Native cleanup are separate outcomes.
// A lost response is not proof of remote revocation and is never replayed here.
export async function finishSessionSignOut(clear:()=>Promise<void>,revoke:(()=>Promise<void>)|null,close:Promise<void>,retain:(()=>Promise<void>)|null=null){
 const closeOutcome=close.then(()=>true,()=>false);
 const custody=await Promise.allSettled([retain?Promise.resolve().then(retain):Promise.resolve()]);
 const retained=custody[0].status==='fulfilled';
 const [local,remote,native]=await Promise.allSettled([
  retained?Promise.resolve().then(clear):Promise.reject(Error('PENDING_SESSION_CUSTODY_FAILED')),
  retained&&revoke?Promise.resolve().then(revoke):Promise.resolve(),
  closeOutcome,
 ]);
 return {localCleared:local.status==='fulfilled',remote:!revoke||!retained?'not-requested':remote.status==='fulfilled'?'response-received':'unconfirmed',nativeClosed:native.status==='fulfilled'&&native.value,retained} as const;
}

export function signOutNotice(result:Awaited<ReturnType<typeof finishSessionSignOut>>,zh:boolean){
 const parts:string[]=[];
 if(!result.localCleared)parts.push(zh?'本机登录信息未能完全清除，请重新打开应用检查。':'Local session data could not be fully cleared; reopen the app and check.');
 if(!result.retained)parts.push(zh?'原会话待撤销记录未保存，未重试远端操作。':'The original pending session could not be retained; no remote operation was retried.');
 else if(result.remote!=='not-requested')parts.push(zh?'原钱包会话撤销仍需确认；请在原钱包中检查授权。':'Original Wallet session revocation still requires confirmation. Check the authorization in Wallet.');
 if(!result.nativeClosed)parts.push(zh?'原任务连接尚未确认关闭。':'Original task connection closure was not confirmed.');
 return parts.join(' ');
}
