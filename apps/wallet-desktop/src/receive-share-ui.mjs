/** Public receiving data only. The original IPC rechecks selected identity.
 * All Wallet Receive writes share one ordered queue: an OS write already in
 * flight cannot be cancelled, but must finish before the next Wallet copy.
 * This is not atomic compare-and-swap against other apps' clipboard writes. */
export function createReceiveShareUI({getContext,requestCode,writeClipboard,report,selectAddress=()=>{}}) {
  let revision=0, writes=Promise.resolve();
  function invalidate(){revision++}
  async function copy(kind){
    const before=getContext(),current=++revision;
    const live=()=>{const after=getContext();return current===revision&&before.open&&after.open&&Boolean(before.account)&&before.account===after.account&&before.keyRevision===after.keyRevision};
    if(!live())return;
    let writeAttempted=false;
    report(kind==="link"?"Preparing your receiving link…":"Checking your receiving address…");
    try{
      const result=await requestCode(before.account);if(!live())return;
      const code=result?.value,uri=`ynx:${before.account}?chainId=ynx_6423-1&asset=YNXT`;
      if(!result?.ok||code?.account!==before.account||code?.chainId!=="ynx_6423-1"||code?.asset!=="YNXT"||code?.uri!==uri)throw new Error("Invalid receiving link");
      const pending=writes.catch(()=>{}).then(async()=>{
        if(!live())return false;
        writeAttempted=true;
        await writeClipboard(kind==="link"?uri:before.account);return true;
      });
      writes=pending;
      const copied=await pending;
      if(copied&&live())report(kind==="link"?"Receiving link copied. The sender must enter an amount and review the transfer.":"YNX address copied. The sender must review the transfer.");
    }catch{if(live()){
      if(kind==="address"&&writeAttempted){selectAddress();report("Clipboard unavailable. Select and copy the address above.")}
      else report("Receiving data unavailable. Reopen Receive and try copying again.");
    }}
  }
  return {invalidate,copyLink:()=>copy("link"),copyAddress:()=>copy("address")};
}
