import {createQRFileInput} from "./qr-file-input.mjs";
/** Desktop image import, not a camera or an authorization flow. The chooser
 * remains bound to the account/draft that opened it before decoding starts. */
export function createRecipientScanUI({document:doc,getContext,image}) {
  const entry=doc.querySelector("#scan-recipient"),panel=doc.querySelector("#recipient-scan-panel");
  let intent=null;
  const chooser=createQRFileInput({document:doc,selector:"#recipient-qr-file",onClick:()=>{
    const current=getContext();intent=current.open&&!current.locked&&current.account?{...current}:null;
  },onCancel:()=>{intent=null},onChange:file=>{
    const before=intent,after=getContext();intent=null;
    if(!before||!after.open||after.locked||after.account!==before.account||after.keyRevision!==before.keyRevision||after.draftRevision!==before.draftRevision)return;
    void image(file);
  }});
  function invalidate(){intent=null;chooser.invalidate();panel.hidden=true}
  entry.addEventListener("click",()=>{
    const current=getContext();
    if(!current.open||current.locked||!current.account)return;
    chooser.invalidate();intent={...current};panel.hidden=false;chooser.focus();
  });
  return Object.freeze({invalidate});
}
