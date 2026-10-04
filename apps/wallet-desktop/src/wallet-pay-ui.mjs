import {setWalletCopy} from "./wallet-locale.mjs";
import {createQRFileInput} from "./qr-file-input.mjs";
const payStateCopy=Object.freeze({transfer_unconfirmed:"Transfer outcome unconfirmed",settlement_pending:"Transfer verified — settlement pending",settlement_unknown:"Settlement outcome unknown — read original receipt",settled:"Settlement verified",archived:"Receipt archived"});
const hash=value=>typeof value==="string"&&/^0x[0-9a-f]{64}$/.test(value);
const invoice=value=>typeof value==="string"&&/^inv_[a-f0-9]{20}$/.test(value);
const text=value=>typeof value==="string"&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
// Detach bounded public Main display DTOs before reading any fields. This is
// not invoice/session/receipt verification; the existing protected producer
// remains responsible for those proofs. No response accessor or iterator runs.
function snapshotPayDisplay(value){
  let visits=0;const memo=new WeakMap(),active=new WeakSet();
  function copy(value,depth=0){
    if(++visits>4096||depth>8)throw Error("Oversized Pay display");
    if(value===null||typeof value==="boolean")return value;
    if(typeof value==="string"){if(value.length>512)throw Error("Oversized Pay display");return value;}
    if(typeof value==="number"&&Number.isFinite(value))return value;
    if(!value||typeof value!=="object"||active.has(value))throw Error("Invalid Pay display");
    if(memo.has(value))return memo.get(value);
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(array?prototype!==Array.prototype:![Object.prototype,null].includes(prototype))throw Error("Invalid Pay display");
    const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
    if(keys.some(key=>typeof key!=="string"||!Object.hasOwn(descriptors[key],"value")))throw Error("Invalid Pay display");
    const length=array?descriptors.length?.value:null;
    if(array?(!Number.isSafeInteger(length)||length<0||length>50||keys.length!==length+1):keys.length>64)throw Error("Invalid Pay display");
    if(array)for(let index=0;index<length;index++)if(!Object.hasOwn(descriptors,index))throw Error("Invalid Pay display");
    const result=array?new Array(length):Object.create(prototype);memo.set(value,result);active.add(value);
    for(const key of keys){if(array&&key==="length")continue;Object.defineProperty(result,key,{value:copy(descriptors[key].value,depth+1),enumerable:true,writable:true,configurable:true});}
    active.delete(value);return Object.freeze(result);
  }
  return copy(value);
}
function original(value,account){
  if(!value||value.account!==account||!hash(value.hash)||!invoice(value.invoiceId)||!text(value.merchant)||!text(value.recipient)||!Number.isSafeInteger(value.amount)||value.amount<=0||value.fee!==1||value.total!==value.amount+1||!Number.isSafeInteger(value.total)||value.consensusFinality!==false||
    !["transfer_unconfirmed","settlement_pending","settlement_unknown","settled","archived"].includes(value.status)||
    ["checkpointVerified","settlementVerified","settlementAttempted","broadcastAttempted"].some(key=>typeof value[key]!=="boolean")||
    value.settlementVerified&&!value.checkpointVerified||["settled","archived"].includes(value.status)!==value.settlementVerified||value.status==="settlement_unknown"&&(!value.settlementAttempted||!value.checkpointVerified)||
    value.status==="settlement_pending"&&(!value.checkpointVerified||value.settlementAttempted)||value.status==="transfer_unconfirmed"&&value.checkpointVerified||
    ["record","session","payload","raw","paymentResult","intent","signature","privateKey"].some(key=>key in value))throw Error("Unverified Pay original");
  return Object.freeze({...value});
}
/** Renderer state machine; no keys, policy, original bytes, session or endpoint.
 * It can send only reference, review ID, explicit action and original hash.
 * Closing/editing/locking invalidates main-held review AND current operation.
 */
export function createDesktopPayUI({getContext,api,render}){
  let revision=0,busy=false,review=null,retained=null,available=false,historyRecords=[],historyCursor=null,settleBlocked=false;
  const view=(notice="",error=null)=>render({busy,review,original:retained,available,notice,error,historyCursor,settleBlocked});
  function clear(){revision++;busy=false;review=null;retained=null;available=false;historyRecords=[];historyCursor=null;settleBlocked=false;view();return Promise.resolve(api.payCancel()).catch(()=>{})}
  const capture=(before=getContext(),current=revision)=>({before,owns:()=>current===revision,live:()=>{const after=getContext();return current===revision&&before.open&&after.open&&!!before.account&&before.account===after.account&&before.keyRevision===after.keyRevision&&!before.locked&&!after.locked}});
  const request=async(fn,accept,{notice="Checking Pay…",failure="Pay could not be verified. Preserve the original; restore it and check its original hash or receipt."}={})=>{
    if(busy)return;const {before,live}=capture();if(!live()){view("Unlock Wallet before reviewing or restoring Pay.");return}busy=true;view(notice);
    try{const received=await fn();if(!live())return;const response=snapshotPayDisplay(received);if(!live())return;if(response?.ok!==true)throw Error("Pay request failed");accept(response.value,before.account);busy=false;view()}
    catch{if(live()){busy=false;view("",failure)}}
  };
  const acceptOriginal=(value,account)=>{if(value?.kind!=="original"&&value?.kind!=="archived")throw Error("Wrong Pay result");retained=value.original===null?null:original(value.original,account);settleBlocked=!!retained?.settlementAttempted;review=null};
  const ui=Object.freeze({
    clear,
    async open(){
      // Capture the original actor and the reset's own epoch BEFORE cancellation
      // or rendering can await/reenter. A late cancel must never adopt a newer
      // sheet/review/account simply because it is current when IPC returns.
      const {before,live,owns}=capture(getContext(),revision+1),cancelled=clear();
      if(!live()){if(owns()&&before.locked)view("Unlock Wallet before reviewing or restoring Pay.");await cancelled;return}
      await cancelled;if(!live())return;
      try{const received=await api.payStatus();if(!live())return;const result=snapshotPayDisplay(received);if(!live())return;if(result?.ok!==true||typeof result.value?.available!=="boolean"||result.value.paymentAuthorized!==false)throw Error();available=result.value.available;
        if(!available){view("Protected Pay is unavailable in this build. No payment was approved. Your saved originals remain on this device.");return}view();if(live())await ui.restore();
      }catch{if(live())view("","Pay readiness could not be verified. Nothing was signed.")}
    },
    async review(reference){if(!available||retained)return;review=null;return request(()=>api.payReview(reference),(value,account)=>{
      if(value?.kind==="original"||value?.kind==="archived"){acceptOriginal(value,account);return}
      const item=value?.review;
      if(value?.kind!=="review"||!item||item.account!==account||!text(item.id)||!invoice(item.invoiceId)||!text(item.merchant)||!text(item.recipient)||!Number.isSafeInteger(item.amount)||item.amount<=0||item.fee!==1||item.total!==item.amount+1||!Number.isSafeInteger(item.total)||typeof item.intentDigest!=="string"||!/^[a-f0-9]{64}$/.test(item.intentDigest)||!Number.isFinite(Date.parse(item.expiresAt))||item.paymentAuthorized!==false)throw Error("Wrong Pay review");
      review=Object.freeze({...item});retained=null;
    },{notice:"Verifying the signed invoice and bound quote…",failure:"The signed invoice and quote could not be reviewed. Nothing was signed or paid."})},
    async approve(){if(!available||!review||busy)return;const token=review.id;review=null;return request(()=>api.payAction({action:"approve",id:token}),acceptOriginal,{notice:"Saving and submitting the reviewed original…",failure:"Payment outcome is unconfirmed. Do not pay again. Choose Restore original, then check its original hash."})},
    async restore(){return request(()=>api.payRestore(),acceptOriginal,{notice:"Reading the original saved on this device…"})},
    async action(action){
      if(!available||!retained||busy)return;
      if(action==="settle"&&(settleBlocked||!retained.checkpointVerified||retained.settlementAttempted||retained.settlementVerified)||action==="receipt"&&!retained.checkpointVerified||action==="done"&&!retained.settlementVerified||!["check","settle","receipt","done"].includes(action))return;
      if(action==="settle")settleBlocked=true;
      const expected=retained.hash;return request(()=>api.payAction({action,id:expected}),(value,account)=>{const next=original(value?.original,account);if(next.hash!==expected||value.kind!==(action==="done"?"archived":"original"))throw Error("Substituted original");retained=next;review=null},
        {notice:action==="check"?"Checking the original transaction hash…":action==="receipt"?"Reading the original authenticated settlement receipt…":action==="done"?"Archiving the verified receipt…":"Submitting the original result once…"});
    },
    history:async(more=false)=>{
      if(busy||!available||more&&historyCursor===null)return null;
      if(!more){historyRecords=[];historyCursor=null}
      let records=null;await request(()=>api.payHistory(more?historyCursor:null),(value,account)=>{
        if(value?.account!==account||!Array.isArray(value.records)||value.records.length>50||value.nextCursor!==null&&!hash(value.nextCursor))throw Error("Wrong history");
        const verified=value.records.map(item=>original(item,account)),combined=more?[...historyRecords,...verified]:verified;
        if(verified.some(item=>item.status!=="archived")||new Set(combined.map(item=>item.hash)).size!==combined.length||value.nextCursor!==null&&verified.at(-1)?.hash!==value.nextCursor)throw Error("Wrong history");
        historyRecords=Object.freeze(combined);historyCursor=value.nextCursor;records=historyRecords;
      },{notice:"Reading verified Pay history…"});return records;
    },
  });return ui;
}
export function mountDesktopPayUI({document,api,getContext}){
  const sheet=document.querySelector("#protected-pay-sheet"),status=document.querySelector("#protected-pay-status"),facts=document.querySelector("#protected-pay-facts"),reference=document.querySelector("#protected-pay-reference");
  const buttons={review:document.querySelector("#protected-pay-review"),approve:document.querySelector("#protected-pay-approve"),restore:document.querySelector("#protected-pay-restore"),check:document.querySelector("#protected-pay-check"),settle:document.querySelector("#protected-pay-settle"),receipt:document.querySelector("#protected-pay-receipt"),done:document.querySelector("#protected-pay-done"),history:document.querySelector("#protected-pay-history")};
  const history=document.querySelector("#protected-pay-history-list");
  const ui=createDesktopPayUI({getContext:()=>({...getContext(),open:sheet.open}),api,render:view=>{
    setWalletCopy(status,view.error??view.notice??"");facts.replaceChildren();
    const item=view.review??view.original;
    if(item){for(const [label,value] of [["Invoice",item.invoiceId],["Merchant",item.merchant],["Paying account",item.account],["Recipient",item.recipient],["Amount",`${item.amount} YNXT`],["Network fee",`${item.fee} YNXT`],["Total",`${item.total} YNXT`],...(view.review?[["Quote expires",item.expiresAt],["Quote digest",item.intentDigest]]:[["Original hash",item.hash],["Saved state",item.status],["Native local checkpoint",item.checkpointVerified?"Verified, not consensus finality":"Unconfirmed"],["Pay settlement receipt",item.settlementVerified?"Verified":"Not verified"]])]){
      const dt=document.createElement("dt"),dd=document.createElement("dd");setWalletCopy(dt,label);
      if(label==="Saved state")setWalletCopy(dd,payStateCopy[value]);
      else if(label==="Native local checkpoint"||label==="Pay settlement receipt")setWalletCopy(dd,value);
      else {dd.textContent=String(value);dd.dir=label==="Merchant"?"auto":"ltr"}
      facts.append(dt,dd);
    }}
    buttons.review.disabled=view.busy||!view.available||!!view.original;reference.disabled=view.busy||!!view.original;
    buttons.approve.hidden=!view.review;buttons.approve.disabled=view.busy||!view.review;
    for(const action of ["check","settle","receipt","done"]){buttons[action].hidden=!view.original||view.original.status==="archived";buttons[action].disabled=view.busy||!view.original}
    buttons.settle.disabled||=view.settleBlocked||!view.original?.checkpointVerified||view.original?.settlementAttempted||view.original?.settlementVerified;
    buttons.receipt.disabled||=!view.original?.checkpointVerified||view.original?.settlementVerified;
    buttons.done.disabled||=!view.original?.settlementVerified;
    buttons.restore.disabled=view.busy||!view.available;buttons.history.disabled=view.busy||!view.available;
    document.querySelector("#protected-pay-older").hidden=view.historyCursor===null;document.querySelector("#protected-pay-older").disabled=view.busy;
    document.querySelector("#protected-pay-next").hidden=view.original?.status!=="archived";document.querySelector("#protected-pay-next").disabled=view.busy;
    if(!item&&!view.error&&!view.notice&&view.available)setWalletCopy(status,"Enter a signed invoice reference to review. Approval is a separate step; nothing is paid by scanning or checking.");
  }});
  let qrIntent=null,qrRevision=0;
  document.querySelector("#open-protected-pay").addEventListener("click",()=>{qrRevision++;qrIntent=null;qrFile.invalidate();document.querySelector("#invoice-sheet").close();history.replaceChildren();sheet.showModal();reference.focus();void ui.open()});
  document.querySelector("#protected-pay-form").addEventListener("submit",event=>{event.preventDefault();void ui.review(reference.value)});
  reference.addEventListener("input",()=>{qrRevision++;qrIntent=null;qrFile.invalidate();history.replaceChildren();void ui.open()});
  buttons.approve.addEventListener("click",()=>void ui.approve());buttons.restore.addEventListener("click",()=>void ui.restore());
  document.querySelector("#protected-pay-next").addEventListener("click",()=>{qrRevision++;qrIntent=null;qrFile.invalidate();reference.value="";history.replaceChildren();void ui.open();reference.focus()});
  for(const action of ["check","settle","receipt","done"])buttons[action].addEventListener("click",()=>void ui.action(action));
  const loadHistory=async more=>{if(!more)history.replaceChildren();const records=await ui.history(more);if(!records)return;history.replaceChildren();for(const item of records){const row=document.createElement("p");setWalletCopy(row,"{name} · {amount} YNXT + {fee} YNXT fee · {invoice} · {hash} · verified Pay settlement, local native checkpoint (not consensus finality)",{name:item.merchant,amount:item.amount,fee:item.fee,invoice:item.invoiceId,hash:item.hash});history.append(row)}if(records.length===0){const row=document.createElement("p");setWalletCopy(row,"No verified Pay receipts saved for this account.");history.append(row)}};
  buttons.history.addEventListener("click",()=>loadHistory(false));document.querySelector("#protected-pay-older").addEventListener("click",()=>loadHistory(true));
  const qrLive=bound=>{const current=getContext();return bound&&bound.revision===qrRevision&&sheet.open&&!current.locked&&bound.account===current.account&&bound.keyRevision===current.keyRevision};
  const qrFile=createQRFileInput({document,selector:"#protected-pay-qr",
  onClick:()=>{qrRevision++;const current=getContext();qrIntent=sheet.open&&!current.locked&&current.account?{account:current.account,keyRevision:current.keyRevision,revision:qrRevision}:null;void ui.clear()},
  onCancel:()=>{const bound=qrIntent;qrIntent=null;if(qrLive(bound))return ui.open()},
  onChange:async file=>{
    const bound=qrIntent;qrIntent=null;
    const live=()=>qrLive(bound);
    if(!live())return;
    try{if(!file||!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size<1||file.size>10*1024*1024)throw Error();const bytes=await file.arrayBuffer();if(!live())return;if(bytes.byteLength!==file.size)throw Error();const received=await api.invoiceReferenceQR({mimeType:file.type,bytes});if(!live())return;const result=snapshotPayDisplay(received);if(!live())return;if(result?.ok!==true||!invoice(result.value?.invoiceID)||result.value.decodedLocally!==true||result.value.uploaded!==false)throw Error();reference.value=result.value.invoiceID;await ui.open();if(live())setWalletCopy(status,"QR reference read locally. Choose Review signed invoice; scanning never signs or pays.")}
    catch{if(live())setWalletCopy(status,"No supported Pay invoice QR was found. Nothing was uploaded or paid.")}
  }});
  const invalidate=()=>{qrRevision++;qrIntent=null;qrFile.invalidate();history.replaceChildren();void ui.clear()};
  sheet.addEventListener("close",invalidate);sheet.addEventListener("cancel",invalidate);
  let lastContext={...getContext()};
  const refreshContext=()=>{
    const current=getContext(),changed=current.account!==lastContext.account||current.keyRevision!==lastContext.keyRevision||current.locked!==lastContext.locked;
    lastContext={...current};
    // The real lifecycle also notifies when an operation ENDS. An unchanged
    // notification must not cancel that operation's pending IPC result, clear
    // its review or recursively start another restore.
    if(!changed)return;
    invalidate();if(sheet.open&&!current.locked&&current.account)void ui.open();
  };
  api.onSecurityState(refreshContext);api.onAccountStatus(refreshContext);
  return {invalidate};
}
