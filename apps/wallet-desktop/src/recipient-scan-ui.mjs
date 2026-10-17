import {createQRFileInput} from "./qr-file-input.mjs";
import {createPaymentRecipientUI} from './payment-recipient-ui.mjs';
import {setWalletCopy} from './wallet-locale.mjs';
import {createRecipientCameraControls} from './recipient-camera-ui.mjs';
/** Desktop image import, not a camera or an authorization flow. The chooser
 * remains bound to the account/draft that opened it before decoding starts. */
export function createRecipientScanUI({document:doc,getContext,image,onChoose=()=>{},onInvalidate=()=>{},bindEntry=true,selectors={entry:'#scan-recipient',panel:'#recipient-scan-panel',file:'#recipient-qr-file'}}) {
  const entry=doc.querySelector(selectors.entry),panel=doc.querySelector(selectors.panel);
  let intent=null;
  const chooser=createQRFileInput({document:doc,selector:selectors.file,onClick:()=>{
    onChoose();
    const current=getContext();intent=current.open&&!current.locked&&current.account?{...current}:null;
  },onCancel:()=>{intent=null},onChange:file=>{
    const before=intent,after=getContext();intent=null;
    if(!before||!after.open||after.locked||after.account!==before.account||after.keyRevision!==before.keyRevision||after.draftRevision!==before.draftRevision||after.networkId!==before.networkId||after.configRevision!==before.configRevision)return;
    return image(file);
  }});
  function invalidate(){intent=null;chooser.invalidate();panel.hidden=true;onInvalidate()}
  const open=()=>{
    const current=getContext();
    if(!current.open||current.locked||!current.account)return;
    onChoose();
    // onChoose retires the previous draft. Capture its successor, but never
    // borrow an account/key change that happened during that retirement.
    const after=getContext();
    intent=null;chooser.invalidate();panel.hidden=true;
    if(!after.open||after.locked||after.account!==current.account||after.keyRevision!==current.keyRevision||after.networkId!==current.networkId||after.configRevision!==current.configRevision)return;
    intent={...after};panel.hidden=false;chooser.focus();
  };
  if(bindEntry)entry.addEventListener("click",open);
  return Object.freeze({invalidate,open});
}

/** Compose the existing photo chooser and recipient lease for a family Send.
 * No preview, approval, signing, network switching or amount import happens here. */
export function createFamilyRecipientScanUI({document:doc,parent,api,family,getContext,getSelection,isOpen,isBusy,onChoose,apply}){
  const make=(tag,key)=>{const n=doc.createElement(tag);if(key)setWalletCopy(n,key);return n};
  const entry=make('button','Scan'),panel=make('div'),file=make('input'),status=make('p');
  const prefix=family+'-send',selectors={entry:'#'+prefix+'-scan',panel:'#'+prefix+'-scan-panel',file:'#'+prefix+'-qr-file'};
  entry.type='button';entry.setAttribute('id',selectors.entry.slice(1));entry.setAttribute('aria-controls',selectors.panel.slice(1));entry.setAttribute('aria-expanded','false');
  panel.setAttribute('id',selectors.panel.slice(1));panel.hidden=true;
  file.type='file';file.accept='image/png,image/jpeg,image/webp';file.setAttribute('id',selectors.file.slice(1));
  const label=make('label'),caption=make('span','QR image (this device)');label.append(caption,file);
  status.setAttribute('id',prefix+'-scan-status');status.setAttribute('role','status');file.setAttribute('aria-describedby',prefix+'-scan-status');panel.append(label);parent.append(entry,panel,status);
  let draftRevision=0,picker=null,camera=null;
  const context=()=>{const c=getContext(),s=getSelection();return {open:isOpen(),account:c.account,keyRevision:c.revision,networkId:s.network,draftRevision,locked:c.locked||c.authenticating||isBusy()||s.family!==family}};
  const decode=async image=>{
    const c=context(),reply=await api.familyNetworks();if(!reply?.ok||!Number.isSafeInteger(reply.value?.revision))throw Error('FAMILY_NETWORK_REQUIRED');
    return api.paymentQR({...image,target:family,account:c.account,revision:c.keyRevision,network:c.networkId,configRevision:reply.value.revision});
  };
  const report=key=>setWalletCopy(status,key,{family:family==='bitcoin'?'BTC':'TRON'});
  const controller=createPaymentRecipientUI({target:family,getContext:context,parse:()=>{throw Error('Photo only')},decode,apply,report});
  const retire=()=>{draftRevision++;controller.invalidate();camera?.stop();onChoose();status.textContent=''};
  function invalidate(){draftRevision++;controller.invalidate();camera?.stop();if(picker)picker.invalidate();else panel.hidden=true;status.textContent='';entry.setAttribute('aria-expanded','false')}
  function update(){const c=context();entry.disabled=!c.open||c.locked||!c.account||typeof api.paymentQR!=='function'||typeof api.familyNetworks!=='function';const input=picker?doc.querySelector(selectors.file):file;input.disabled=entry.disabled;camera?.update()}
  camera=createRecipientCameraControls({document:doc,parent,api,target:family,getContext:context,decode,apply,report,onStart:()=>{if(picker)picker.invalidate();retire()}});
  entry.addEventListener('click',()=>{
    update();if(entry.disabled)return;
    if(!picker)picker=createRecipientScanUI({document:doc,selectors,bindEntry:false,getContext:context,image:controller.image,onChoose:retire,onInvalidate:()=>entry.setAttribute('aria-expanded','false')});
    picker.open();entry.setAttribute('aria-expanded',String(!panel.hidden));
  });
  update();return Object.freeze({invalidate,update});
}
