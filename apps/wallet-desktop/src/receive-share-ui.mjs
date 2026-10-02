/** Public receiving data only. IPC rechecks the selected identity; this UI lease
 * rejects a late code after close/account change before writing the clipboard. */
export function createReceiveShareUI({getContext,requestCode,writeClipboard,report}) {
  let revision=0;
  function invalidate(){revision++}
  async function copyLink(){
    const before=getContext(),current=++revision;
    const live=()=>{const after=getContext();return current===revision&&before.open&&after.open&&Boolean(before.account)&&before.account===after.account};
    if(!live())return;
    report("Preparing your receiving link…");
    try{
      const result=await requestCode(before.account);if(!live())return;
      const code=result?.value,uri=`ynx:${before.account}?chainId=ynx_6423-1&asset=YNXT`;
      if(!result?.ok||code?.account!==before.account||code?.chainId!=="ynx_6423-1"||code?.asset!=="YNXT"||code?.uri!==uri)throw new Error("Invalid receiving link");
      await writeClipboard(uri);if(live())report("Receiving link copied. The sender must enter an amount and review the transfer.");
    }catch{if(live())report("Receiving link unavailable. Reopen Receive or copy your address instead.")}
  }
  return {invalidate,copyLink};
}
