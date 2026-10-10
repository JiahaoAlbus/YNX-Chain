import {createQRFileInput} from "./qr-file-input.mjs";
/** Desktop image import, not a camera or an authorization flow. The chooser
 * remains bound to the account/draft that opened it before decoding starts. */
export function createRecipientScanUI({document:doc,getContext,image,onChoose=()=>{},onInvalidate=()=>{}}) {
  const entry=doc.querySelector("#scan-recipient"),panel=doc.querySelector("#recipient-scan-panel");
  let intent=null;
  const chooser=createQRFileInput({document:doc,selector:"#recipient-qr-file",onClick:()=>{
    onChoose();
    const current=getContext();intent=current.open&&!current.locked&&current.account?{...current}:null;
  },onCancel:()=>{intent=null},onChange:file=>{
    const before=intent,after=getContext();intent=null;
    if(!before||!after.open||after.locked||after.account!==before.account||after.keyRevision!==before.keyRevision||after.draftRevision!==before.draftRevision)return;
    void image(file);
  }});
  function invalidate(){intent=null;chooser.invalidate();panel.hidden=true;onInvalidate()}
  entry.addEventListener("click",()=>{
    const current=getContext();
    if(!current.open||current.locked||!current.account)return;
    onChoose();
    // onChoose retires the previous draft. Capture its successor, but never
    // borrow an account/key change that happened during that retirement.
    const after=getContext();
    intent=null;chooser.invalidate();panel.hidden=true;
    if(!after.open||after.locked||after.account!==current.account||after.keyRevision!==current.keyRevision)return;
    intent={...after};panel.hidden=false;chooser.focus();
  });
  return Object.freeze({invalidate});
}
