/** Desktop image import, not a camera or an authorization flow. The chooser
 * remains bound to the account/draft that opened it before decoding starts. */
export function createRecipientScanUI({document:doc,getContext,image}) {
  const entry=doc.querySelector("#scan-recipient"),panel=doc.querySelector("#recipient-scan-panel"),input=doc.querySelector("#recipient-qr-file");
  let intent=null;
  function invalidate(){intent=null;input.value="";panel.hidden=true}
  entry.addEventListener("click",()=>{
    const current=getContext();
    if(!current.open||current.locked||!current.account)return;
    intent={...current};input.value="";panel.hidden=false;input.focus();
  });
  input.addEventListener("change",()=>{
    const before=intent,after=getContext(),file=input.files?.[0];input.value="";intent=null;
    if(!before||!after.open||after.locked||after.account!==before.account||after.keyRevision!==before.keyRevision||after.draftRevision!==before.draftRevision)return;
    void image(file);
  });
  return Object.freeze({invalidate});
}
