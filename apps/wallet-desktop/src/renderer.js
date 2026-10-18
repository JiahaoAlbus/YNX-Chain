import { ApprovalReviewQueue } from "./approval-review-queue.mjs";
import { formatApprovalReview } from "./approval-review-display.mjs";
import { createPasswordVaultUI } from "./password-vault-ui.mjs";
import { createReceiveCodeUI } from "./receive-code-ui.mjs";
import { createPaymentRecipientUI } from "./payment-recipient-ui.mjs";
import { createTransactionHistoryUI } from "./transaction-history-ui.mjs";
import { projectTransactionResolution, projectPendingTransactions,projectPQOriginalObservation } from "./transaction-resolution-display.mjs";
import {createPQTransferReviewUI} from './wallet-pq-transfer-ui.mjs';
const pqTransferReviewUI=createPQTransferReviewUI({api:window.ynxWallet,getKeyState:()=>keyState});
import {createPQMigrationReviewUI} from './wallet-pq-migration-ui.mjs';
const pqMigrationReviewUI=createPQMigrationReviewUI({api:window.ynxWallet,getKeyState:()=>keyState});
import {createPQRevocationReviewUI} from './wallet-pq-revocation-ui.mjs';
import {appendPQOriginalRecoveryActions} from './wallet-pq-original-recovery-ui.mjs';
const pqRevocationReviewUI=createPQRevocationReviewUI({api:window.ynxWallet,getKeyState:()=>keyState});
import {createPQKeyPreparationUI} from './wallet-pq-key-ui.mjs';
const pqKeyPreparationUI=createPQKeyPreparationUI({api:window.ynxWallet,getKeyState:()=>keyState});
import {createPQBackupUI} from './pq-backup-ui.mjs';
const pqBackupUI=createPQBackupUI({api:window.ynxWallet,getKeyState:()=>keyState});
import {createRegisteredPQRestoreUI} from './wallet-pq-restore-ui.mjs';
const pqRegisteredRestoreUI=createRegisteredPQRestoreUI({api:window.ynxWallet,getKeyState:()=>keyState});
import {createSessionRecoveryUI} from './wallet-session-recovery-ui.mjs';
const sessionRecoveryUI=createSessionRecoveryUI({api:window.ynxWallet,getKeyState:()=>keyState});
import { createReceiveShareUI } from "./receive-share-ui.mjs";
import { createNativeContractUI } from "./native-contract-ui.mjs";
import { createInvoiceReferenceUI } from "./wallet-invoice-reference-ui.mjs";
import {mountDesktopPayUI} from "./wallet-pay-ui.mjs";
import { setWalletCopy } from "./wallet-locale.mjs";
import { createRecipientScanUI } from "./recipient-scan-ui.mjs";
import {createRecipientCameraUI,captureRecipientFrame} from "./recipient-camera-ui.mjs";
import {createQRFileInput} from "./qr-file-input.mjs";
import {renderPermissionError} from "./permission-error-ui.mjs";
import {ADDRESS_ONLY_CONNECTION_NOTICE} from './wallet-locale-permissions.mjs';
import {createTransferAttemptUI} from "./transfer-attempt-ui.mjs";
import {renderTransferPreparationError} from './transfer-preparation-error-ui.mjs';
import {createMnemonicUI,createMnemonicImportUI} from './mnemonic-ui.mjs';
import {createMultichainUI} from './multichain-ui.mjs';
import {createFamilyUI} from './multichain-family-ui.mjs';
let multichainUI;
let familyUI;

// Explicit product copy only; never pass an original request/value container.
function copyUI(node,key,values={}){if(typeof setWalletCopy==="function")setWalletCopy(node,key,values);else node.textContent=key.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match)}
function showAccountError(node,error){if(!renderPermissionError(node,error))node.textContent=`${error.code}: ${error.message}`}

const receiveCodeUI = createReceiveCodeUI({
  canvas: document.querySelector("#receive-qr"),
  status: document.querySelector("#receive-qr-status"),
  requestCode: account => window.ynxWallet.receiveCode(account),
  exportButton: document.querySelector("#download-receiving-png"),
  getContext:()=>({open:document.querySelector("#receive-sheet").open,account:accountState?.ynxAccount,keyRevision:keyState.revision}),
  savePNG:(dataURL,fileName)=>{const anchor=document.createElement("a");anchor.href=dataURL;anchor.download=fileName;document.body.append(anchor);try{anchor.click()}finally{anchor.remove()}},
});
document.querySelector("#download-receiving-png")?.addEventListener("click",()=>receiveCodeUI.exportPNG());
const transferAttemptUI=createTransferAttemptUI({node:document.querySelector("#transfer-attempt-status"),getAccount:()=>activeAccount,request:account=>window.ynxWallet.transferAttempts?.(account)});
window.ynxWallet.onTransferAttempt?.(record=>transferAttemptUI.receive(record));
let receivingClipboardWrites=Promise.resolve();
function writeReceivingClipboard(value,isCurrent=()=>true){
  const pending=receivingClipboardWrites.catch(()=>{}).then(async()=>{if(!isCurrent())return false;await navigator.clipboard.writeText(value);return true});
  receivingClipboardWrites=pending;return pending;
}
const receiveShareUI=createReceiveShareUI({
  getContext:()=>({open:document.querySelector("#receive-sheet").open,account:accountState?.ynxAccount,keyRevision:keyState.revision}),
  requestCode:account=>window.ynxWallet.receiveCode(account),
  writeClipboard:writeReceivingClipboard,
  selectAddress:()=>document.querySelector("#receive-address").select(),
  report:value=>{copyUI(document.querySelector("#receive-status"),value)},
});

let keyState = { locked: true, unlockAvailable: false, authenticating: false };
let originalAdmissionState={phase:'not-supplied',available:false,busy:false,revision:-1,hasReview:false};
let pendingOriginalAdmissionState=null,originalAdmissionRefreshTuple=null;
const admissionSecurityTuple=state=>JSON.stringify([state.account,state.revision,state.locked,state.authenticating,state.unlockExpiresAt]);
function renderOriginalAdmission(payload){
  const state=payload?.ok===true?payload.value:payload;
  if(!state||!Number.isSafeInteger(state.revision)||state.revision<originalAdmissionState.revision)return;
  if(Number.isSafeInteger(state.securityRevision)&&Number.isSafeInteger(keyState.revision)&&(state.securityRevision!==keyState.revision||state.account!==keyState.account)){
    if(state.securityRevision>keyState.revision&&(!pendingOriginalAdmissionState||state.revision>=pendingOriginalAdmissionState.revision))pendingOriginalAdmissionState=state;
    return;
  }
  originalAdmissionState=state;
  const facts=document.querySelector('#original-admission-facts');
  facts.replaceChildren();facts.hidden=!state.review;
  if(state.review)for(const [label,value] of [['Application / 应用',state.review.applicationId],['Service / 服务',state.review.service],['Gateway / 网关',state.review.gatewayOrigin],['Consumer build / 客户端版本',state.review.consumerManifestDigest],['Gateway build / 网关版本',state.review.gatewayManifestDigest],['Registry / 注册表',state.review.registryDigest],['Instance / 实例',state.review.instanceId],['Current reference / 当前引用',state.review.currentReference],['Deadline / 截止时间',new Date(state.review.expiresAtMs).toISOString()]]){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value??'—');facts.append(dt,dd);
  }
  const copy={
    'not-supplied':'原始凭据及受保护通道尚未供给 / Original admission and protected channel not supplied.',
    review:'请审查 Developer 服务入口请求。不授权账户或项目 / Review Developer service entry only.',
    acquiring:'正在核对原发布者 / Checking original custodian…',
    launching:'正在打开本次批准的 Developer 实例 / Opening the approved Developer instance…',
    publishing:'正在保存原接入结果 / Saving original admission result…',
    delivering:'正在等待本次结果回执 / Waiting for this exact delivery acknowledgement…',
    acknowledged:'本次交付已确认；不代表账户或工具已授权 / Delivery acknowledged, not account or tools permission.',
    retired:'本次服务接入已到期或结束；原记录保留 / This service admission expired or ended; records retained.',
    cancelled:'已取消；不会自动发布或重试 / Cancelled; no automatic publication or retry.',
    unknown:'结果未知，请保留原记录；不会重新发布 / Outcome unknown; original records retained, no retry.',
    failed:'连接操作失败；未宣称接通 / Connection operation failed; not connected.',
  };
  const progress={pending:'签名操作已进入，结果未确认 / Signing entered, outcome unconfirmed.',UNKNOWN:'结果未知，禁止自动重试 / Unknown; no automatic retry.',signed:'已签名，尚未交付 / Signed, not delivered.',entered:'已开始交付，尚未确认 / Delivery entered, unconfirmed.',acknowledged:'交付回执已确认 / Delivery acknowledged.'};
  const recovery=state.recovery;
  if(recovery?.state==='read'){
    for(const [rows,limit] of [[recovery.records,32],[recovery.runtimeRecords,64]])if(Array.isArray(rows)&&rows.length<=limit)for(const row of rows){
      const label=row.requestNonce?'服务接入记录 / Admission record':'运行结果记录 / Runtime record';
      const phase=row.deliveryState??row.state;if(!Object.hasOwn(progress,phase))continue;
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=progress[phase];facts.append(dt,dd);facts.hidden=false;
    }
  }
  const suffix=recovery?.state==='read'?'':recovery?.state==='locked'?' 状态查询需解锁 / Unlock for protected status readback.':' 受保护的恢复查询尚不可用，不能确定是否有记录 / Protected recovery readback unavailable; record inventory is unknown.';
  const missingSupply={
    AUTH_IDENTITY_IDE_EXTERNAL_ORIGINALS_NOT_PROTECTED:'原生接口已具备，但合法授权原件尚未配置；未签名、未激活 / Native interface present; protected authorization originals are not configured. Nothing signed or activated.',
    AUTH_IDENTITY_ORIGINAL_PROFILE_NOT_SUPPLIED:'尚未提供原授权配置；不会用临时配置代替 / Original authorization profile not supplied; no substitute profile will be used.',
    ADMISSION_SUMMARY_NOT_SUPPLIED:'受保护记录查询不可用；不能判断是否已有操作 / Protected record readback unavailable; existing operation state is unknown.',
    WALLET_SERVICE_ADMISSION_NOT_SUPPLIED:'服务授权来源尚未就绪；不会自动重试 / Original service authorization source unavailable; no automatic retry.',
  };
  const supplyMessage=Object.hasOwn(missingSupply,state.unavailableReason)?missingSupply[state.unavailableReason]:null;
  document.querySelector('#original-admission-status').textContent=(state.phase==='unknown'?copy.unknown:state.preparing?'正在准备本次审查 / Preparing this review…':supplyMessage??copy[state.phase]??copy.failed)+suffix;
  document.querySelector('#original-admission-review').disabled=(state.canPrepareReview===undefined?!state.available:!state.canPrepareReview)||state.busy||state.preparing||state.outcomeUnknown||state.cleanupIncomplete||recovery?.unresolved===true||keyState.locked;
  const approve=document.querySelector('#original-admission-approve');approve.hidden=!state.hasReview;approve.disabled=state.busy||keyState.locked||state.phase!=='review';
  document.querySelector('#original-admission-cancel').hidden=!state.hasReview&&!state.busy;
}
async function originalAdmissionAction(method,arg){
  const selectedSecurity=admissionSecurityTuple(keyState);
  try{const result=await window.ynxWallet[method](arg);if(selectedSecurity!==admissionSecurityTuple(keyState))return;if(result?.ok)renderOriginalAdmission(result);else if(originalAdmissionState.phase!=='unknown'){if(originalAdmissionState.unavailableReason)renderOriginalAdmission(originalAdmissionState);else document.querySelector('#original-admission-status').textContent='操作未完成；不会自动重试 / Operation incomplete; no automatic retry.';}}
  catch{if(selectedSecurity===admissionSecurityTuple(keyState)&&originalAdmissionState.phase!=='unknown')document.querySelector('#original-admission-status').textContent='交付通道不可用 / Delivery channel unavailable.';}
}
function updateOriginalAdmissionSecurity(previous,state){
  const tuple=admissionSecurityTuple(state);
  if(tuple!==admissionSecurityTuple(previous)){
    // Clear old facts synchronously even if the real cleanup remains pending.
    renderOriginalAdmission({revision:originalAdmissionState.revision,securityRevision:state.revision,account:state.account,locked:state.locked,phase:'retired',available:false,hasReview:false,busy:false,canPrepareReview:false,recovery:{state:state.locked?'locked':'not-read',records:null,runtimeRecords:null,unresolved:null}});
  }
  const pending=pendingOriginalAdmissionState;
  if(pending&&pending.securityRevision===state.revision&&pending.account===state.account){pendingOriginalAdmissionState=null;renderOriginalAdmission(pending);}
  else if(pending&&pending.securityRevision<=state.revision)pendingOriginalAdmissionState=null;
  if(tuple!==originalAdmissionRefreshTuple){
    originalAdmissionRefreshTuple=tuple; // Reserve BEFORE requesting a notifying guarded read.
    if(!state.locked&&!state.authenticating&&window.ynxWallet.originalAdmissionStatus)void originalAdmissionAction('originalAdmissionStatus');
  }
}
document.querySelector('#original-admission-review').addEventListener('click',()=>originalAdmissionAction('originalAdmissionReview'));
document.querySelector('#original-admission-approve').addEventListener('click',()=>originalAdmissionAction('originalAdmissionConfirm',originalAdmissionState.review?.id));
document.querySelector('#original-admission-cancel').addEventListener('click',()=>originalAdmissionAction('originalAdmissionCancel'));
window.ynxWallet.onOriginalAdmissionState?.(renderOriginalAdmission);
let accountState = null, passwordUI;
let accountViewRevision = 0;
let securityViewRevision = 0;
const invoiceSheet=document.querySelector("#invoice-sheet");
const invoiceUI=createInvoiceReferenceUI({
  getContext:()=>({open:invoiceSheet.open,account:accountState?.account,keyRevision:keyState.revision}),
  request:reference=>window.ynxWallet.invoiceReference(reference),
  requestQR:input=>window.ynxWallet.invoiceReferenceQR(input),
  applyReference:id=>{document.querySelector("#invoice-reference").value=id;document.querySelector("#invoice-reference").focus()},
  render:({busy,result,error,notice})=>{
    document.querySelector("#check-invoice").disabled=busy;
    document.querySelector("#invoice-status").textContent=notice??(busy?"Checking the invoice reference…":error??(result?"Service response received. This is not a trusted signed invoice or payment receipt.":""));
    const facts=document.querySelector("#invoice-facts");facts.replaceChildren();
    if(!result)return;
    const invoice=result.invoice;
    for(const [label,value] of [["Invoice",invoice.id],["Selected account",nativeAccountLabel(result.account)],["Reported merchant",invoice.merchant],["Reported recipient",invoice.payoutAddress],["Reported amount",`${invoice.amount} YNXT`],["Expires",invoice.dueAt],["Service status",invoice.status],["Source",result.source]]){
      const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=value;facts.append(dt,dd);
    }
  },
});
function clearInvoiceInput(){invoiceQR.invalidate();invoiceUI.clear()}
document.querySelector("#open-invoice").addEventListener("click",()=>{if(!accountState?.account)return;clearInvoiceInput();invoiceSheet.showModal();document.querySelector("#invoice-reference").focus()});
document.querySelector("#invoice-form").addEventListener("submit",event=>{event.preventDefault();void invoiceUI.check(document.querySelector("#invoice-reference").value)});
document.querySelector("#invoice-reference").addEventListener("input",clearInvoiceInput);
const invoiceQR=createQRFileInput({document,selector:"#invoice-qr",onClick:()=>invoiceUI.captureQRSelection(),onCancel:()=>invoiceUI.clear(),onChange:file=>{
  void invoiceUI.importSelectedQR(async()=>{if(!file||!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size<1||file.size>10*1024*1024)throw new Error("Invalid QR image");const bytes=await file.arrayBuffer();if(bytes.byteLength!==file.size)throw new Error("Changed QR image");return {mimeType:file.type,bytes}});
}});
invoiceSheet.addEventListener("close",clearInvoiceInput);invoiceSheet.addEventListener("cancel",clearInvoiceInput);
const contractSheet = document.querySelector("#contract-sheet");
const contractUI = createNativeContractUI({
  getContext: () => ({open: contractSheet.open, account: accountState?.account ?? null, keyRevision: keyState.revision}),
  request: input => window.ynxWallet.nativeContract(input),
  render: ({busy, result, error}) => {
    document.querySelector("#lookup-contract").disabled = busy;
    document.querySelector("#read-contract").disabled = busy;
    copyUI(document.querySelector("#contract-status"),busy ? "Reading from YNX Testnet…" : error ?? (result ? "Read-only response verified. No transaction was signed or submitted." : ""));
    const facts = document.querySelector("#contract-facts"), methods = document.querySelector("#contract-methods"), output = document.querySelector("#contract-result");
    facts.replaceChildren(); methods.replaceChildren(); output.textContent = ""; output.hidden = true;
    if (!result) return;
    const artifact = result.artifact ?? result.read.artifact;
    const rows = [["Contract", artifact.name], ["Address", artifact.address], ["Runtime", artifact.runtimeMode], ["Source hash", artifact.sourceHash], ["Bytecode hash", artifact.deployedBytecodeHash]];
    if (artifact.auditHash) rows.push(["Record audit hash", artifact.auditHash], ["Last updated height", String(artifact.lastUpdatedHeight)]);
    if (result.read) rows.push(["As of", result.read.asOf], ["Endpoint", result.read.origin], ["Opcode steps", String(result.read.opcodeStepCount ?? "Not applicable")]);
    for (const [label, value] of rows) { const dt = document.createElement("dt"), dd = document.createElement("dd"); copyUI(dt,label);dd.dir="ltr";if(label==="Opcode steps"&&result.read.opcodeStepCount==null)copyUI(dd,"Not applicable");else dd.textContent=value;facts.append(dt, dd); }
    for (const method of result.methods ?? []) {
      const button = document.createElement("button"); button.type = "button";
      if(method.inputCount)copyUI(button,"{signature} — encoded arguments required",{signature:method.signature});else{button.textContent=method.signature;button.dir="ltr";}
      button.addEventListener("click", () => { contractUI.clear(); document.querySelector("#contract-function").value = method.selector; document.querySelector("#contract-function").focus(); });
      methods.append(button);
    }
    if (result.read) { output.hidden = false;copyUI(output,result.read.returnValue==null?"No known ABI decoder; encoded result: {encoded}\n{limitations}":"Result: {value}\nEncoded result: {encoded}\n{limitations}",{value:result.read.returnValue,encoded:result.read.encodedResult,limitations:(result.read.limitations??artifact.limitations??[]).join("\n")}); }
  },
});
function contractInput(action) { return {mode: document.querySelector("#contract-mode").value, address: document.querySelector("#contract-address").value.trim(), action, ...(action === "read" ? {function: document.querySelector("#contract-function").value.trim()} : {})}; }
document.querySelector("#open-contracts").addEventListener("click", () => { contractUI.clear(); contractSheet.showModal(); document.querySelector("#contract-address").focus(); });
document.querySelector("#lookup-contract").addEventListener("click", () => void contractUI.run(contractInput("lookup")));
document.querySelector("#contract-form").addEventListener("submit", event => { event.preventDefault(); void contractUI.run(contractInput("read")); });
for (const id of ["contract-address", "contract-function", "contract-mode"]) {
  document.getElementById(id).addEventListener("input", () => contractUI.clear());
  document.getElementById(id).addEventListener("change", () => contractUI.clear());
}
for (const id of ["contract-address", "contract-mode"]) document.getElementById(id).addEventListener("change", () => { document.querySelector("#contract-function").value = ""; });
contractSheet.addEventListener("close", () => contractUI.clear());
contractSheet.addEventListener("cancel", () => contractUI.clear());
let paymentDraftRevision = 0;
let recipientCameraUI;
const paymentRecipientUI = createPaymentRecipientUI({
  getContext: () => ({ open: document.querySelector("#send-sheet").open, account: accountState?.account, locked: keyState.locked, keyRevision: keyState.revision }),
  parse: input => window.ynxWallet.paymentRecipient(input),
  decode: input => window.ynxWallet.paymentQR(input),
  onStart: () => { paymentDraftRevision++; recipientCameraUI?.stop(); },
  apply: address => {
    paymentDraftRevision++;
    document.querySelector("#transfer-to").value = address;
    document.querySelector("#transfer-amount").value = "";
    transferReview = null;
    document.querySelector("#transfer-amount").focus();
  },
  report: message => { copyUI(document.querySelector("#recipient-status"),message); },
});
const recipientScanContext=()=>({open:document.querySelector("#send-sheet").open,account:accountState?.account,locked:keyState.locked||keyState.authenticating,keyRevision:keyState.revision,draftRevision:paymentDraftRevision});
const recipientVideo=document.querySelector("#recipient-camera-video"),recipientFrame=document.createElement("canvas");
recipientCameraUI=createRecipientCameraUI({
  getContext:()=>({...recipientScanContext(),focused:document.hasFocus()&&document.visibilityState==="visible"}),
  begin:()=>window.ynxWallet.beginRecipientCamera(),end:id=>window.ynxWallet.endRecipientCamera(id),
  openStream:()=>navigator.mediaDevices.getUserMedia({video:{width:{ideal:720},height:{ideal:720}},audio:false}),
  attach:async stream=>{recipientVideo.srcObject=stream;recipientVideo.hidden=false;await recipientVideo.play();},
  detach:()=>{recipientVideo.pause();recipientVideo.srcObject=null;recipientVideo.hidden=true;recipientFrame.width=recipientFrame.height=1;},
  capture:()=>captureRecipientFrame(recipientVideo,recipientFrame),
  decode:input=>window.ynxWallet.paymentQR(input),apply:address=>paymentRecipientUI.text(address),
  report:value=>copyUI(document.querySelector("#recipient-status"),value),
});
// A new chooser/camera intent retires already-reading images and paste/decoder
// replies, not only the native chooser node or the old camera stream. Preserve
// visible input while advancing the draft fence used by transfer review.
const recipientScanUI=createRecipientScanUI({document,getContext:recipientScanContext,image:file=>paymentRecipientUI.image(file),onChoose:()=>{paymentDraftRevision++;paymentRecipientUI.invalidate();recipientCameraUI.stop();},onInvalidate:()=>recipientCameraUI.stop()});
document.querySelector("#start-recipient-camera").addEventListener("click",()=>{paymentDraftRevision++;paymentRecipientUI.invalidate();recipientScanUI.invalidate();void recipientCameraUI.start();});
document.querySelector("#stop-recipient-camera").addEventListener("click",()=>{recipientCameraUI.stop();copyUI(document.querySelector("#recipient-status"),"Camera stopped.");});
window.addEventListener("blur",()=>recipientCameraUI.stop());
window.addEventListener("pagehide",()=>recipientCameraUI.stop());
document.addEventListener("visibilitychange",()=>{if(document.visibilityState!=="visible")recipientCameraUI.stop();});
function invalidatePaymentInput() { paymentDraftRevision++; paymentRecipientUI.invalidate(); recipientScanUI.invalidate(); document.querySelector("#prepare-transfer").disabled=keyState.locked||keyState.authenticating; }
// Public metadata was identity-checked by the main-process vault. Protocol keys remain EVM addresses.
const nativeAccountLabel = account => accountState?.accounts?.find(item => item.account === account)?.ynxAccount ?? account;
const network = document.querySelector("#network");
const detail = document.querySelector("#detail");
const chain = document.querySelector("#chain");
const indicator = document.querySelector("#indicator");

function render(status) {
  indicator.className = `indicator ${status.available ? "ok" : "failed"}`;
  network.textContent = status.available ? "Connected to YNX Testnet" : "YNX Testnet unavailable";
  chain.textContent = status.available ? status.chainId : "Unavailable";
  detail.textContent = status.available
    ? "Your wallet is connected. You review every app connection and transaction."
    : "The network is unavailable. Your accounts and backups remain accessible. Try again to refresh balances or send.";
}

document.querySelector("#retry").addEventListener("click", async () => render(await window.ynxWallet.status()));
window.ynxWallet.onStatus(render);
window.ynxWallet.status().then(render);

const authorization = document.querySelector("#authorization");
const authResult = document.querySelector("#auth-result");
const approvalQueue = new ApprovalReviewQueue({ onChange: () => queueMicrotask(presentApproval) });
const authorizationChoices = new Map();
let creatingAuthorizationAccount = false;
setInterval(() => approvalQueue.sweep(), 1000);
window.ynxWallet.onAuthorizationRequest(review => {
  if (!approvalQueue.refreshAuthorization(review)) approvalQueue.enqueue("authorization", review);
});
window.ynxWallet.onAuthorizationError(result => {
  if (result.requestId && ["ACCOUNT_CHANGED", "SESSION_EXPIRED"].includes(result.code)) approvalQueue.remove("authorization", result.requestId);
  document.querySelector("#connection-result").textContent = authorizationErrorText(result);
});

async function act(action) {
  if (approvalQueue.current?.type !== "authorization") return;
  if (action === "reject" && creatingAuthorizationAccount) { await window.ynxWallet.lock(); return; }
  const item = approvalQueue.begin(approvalQueue.current.key);
  if (!item) { if (action === "reject") await window.ynxWallet.lock(); return; }
  const account = activeAccount, view = accountViewRevision, security = accountSecurityIntent, revision = keyState.revision;
  const current = () => approvalQueue.current === item && approvalQueue.busy && account === activeAccount && view === accountViewRevision && security === accountSecurityIntent && revision === keyState.revision && !keyState.locked && item.expiresAt > Date.now();
  let remove = false;
  try {
    const result = await window.ynxWallet.authorizationAction({ id: item.review.id, account: item.review.account, action });
    if (!current()) return;
    authorization.dataset.resultCode = result.code ?? "UNKNOWN";
    authorization.dataset.callbackEmitted = String(result.callbackEmitted === true);
    authorization.dataset.authorityGranted = String(result.authorityGranted === true);
    authorization.dataset.returnKind = result.returnKind??'unknown';
    authorization.dataset.productSessionCreated = String(result.productSessionCreated === true);
    authorization.dataset.requestId = result.requestId ?? item.review.id;
    if (result.callbackEmitted) {
      remove = true;
      document.querySelector("#connection-result").textContent = action === "approve" ? `Returning to ${item.review.displayName}. The app will verify your sign-in.` : `Connection to ${item.review.displayName} declined.`;
    } else {
      authResult.textContent = authorizationErrorText(result);
      const code = result.underlyingCode ?? result.code;
      if (code === "CANONICAL_CALLBACK_LAUNCH_FAILED" || result.code === "CANONICAL_CALLBACK_LAUNCH_FAILED") authorizationChoices.set(item.key, action);
      remove = ["ACCOUNT_CHANGED", "SESSION_EXPIRED", "NO_PENDING_AUTHORIZATION", "AUTHORIZATION_REVIEW_MISMATCH"].includes(code);
    }
  } catch { if(current())authResult.textContent = "The response was interrupted. Try returning to the app again."; }
  finally { if (approvalQueue.current === item && approvalQueue.busy) { if (remove) authorizationChoices.delete(item.key); approvalQueue.finish(item.key, { remove }); } }
}

function authorizationErrorText(result) {
  if (result?.callbackOutcomeUnknown) return "The original return link may already have been delivered. Its outcome is unknown; it will not be automatically sent or signed again.";
  if((result?.underlyingCode??result?.code)==='SESSION_REFERENCE_RETURN_REQUIRED'&&result?.sessionOriginal?.signed&&result.sessionOriginal.storageConfirmed&&result.sessionOriginal.cleanupComplete)return "Your original signed result is safely retained. The small-reference return service is required before it can be delivered. Unlocking again will not fix that service dependency; no new signature or return was sent.";
  if(result?.sessionOriginal?.signed)return result.sessionOriginal.storageConfirmed&&result.sessionOriginal.cleanupComplete?"The original signed result is retained. Unlock Wallet to revalidate and recover that same result; do not create another signature.":"The original signing result is retained or its storage/cleanup is unresolved. No new signature will be created. Preserve this Wallet for read-only recovery.";
  const code = result?.underlyingCode ?? result?.code;
  return ({ ACCOUNT_CHANGED: "Your selected account changed. Connect again from the app.", ACCOUNT_NOT_CREATED: "Create or import an account before connecting.", SESSION_EXPIRED: "This request expired. Connect again from the app.", AUTHORIZATION_ACTION_IN_PROGRESS: "Your previous response is still being processed.", AUTHORIZATION_REVIEW_MISMATCH: "This request changed. Review a new connection from the app.", CANONICAL_CALLBACK_LAUNCH_FAILED: "The return link could not be opened. Retry to return to the app.", AUTHORIZATION_REQUEST_IN_PROGRESS: "Another connection is waiting for your review." })[code] ?? "This connection request could not be verified. Open the app and connect again.";
}

function presentApproval() {
  const item = approvalQueue.current;
  const panels = { authorization, proposal: document.querySelector("#walletconnect-proposal"), provider: document.querySelector("#provider-request") };
  for (const [type, panel] of Object.entries(panels)) if (!item || type !== item.type) { if (panel.open) panel.close(); panel.hidden = true; }
  if (!item || keyState.locked) return;
  const { type, review } = item, panel = panels[type];
  const otherDialog = document.querySelector("dialog[open]");
  if (otherDialog && otherDialog !== panel) return;
  const newlyShown = !panel.open;
  panel.hidden = false;
  if (type === "authorization") {
    if (authorization.dataset.reviewId !== String(review.id)) {
      authorization.dataset.reviewId = String(review.id);
      authorization.dataset.resultCode = "AWAITING_APPROVAL";
      authorization.dataset.callbackEmitted = "false";
      authorization.dataset.authorityGranted = "false";
      authorization.dataset.returnKind = 'none';
      authorization.dataset.productSessionCreated = "false";
      authorization.dataset.requestId = String(review.id);
    }
    document.querySelector("#auth-product").textContent = `Connect to ${review.displayName}`;
    document.querySelector("#auth-origin").textContent = review.origin;
    document.querySelector("#auth-account").textContent = review.ynxAccount ?? review.account ?? "Create or import an account first";
    document.querySelector("#auth-purpose").textContent = review.purpose ?? review.request.purpose;
    document.querySelector("#auth-scopes").textContent = review.scopes.map(scopeLabel).join(" · ");
    document.querySelector("#auth-expiry").textContent = review.request.serviceConsent
      ? `Approve before ${review.expiresAt}. Service access until ${review.request.serviceConsent.expiresAt}. Only the listed permissions until this fixed deadline. Logout, revocation or account changes restrict access. No automatic signatures, transfers or deadline extension.`
      : `Valid until ${new Date(review.expiresAt).toLocaleTimeString()}`;
    if (newlyShown) authResult.textContent = "Share this account with the app. Connecting does not send any assets.";
    const choice = authorizationChoices.get(item.key);
    document.querySelector("#auth-create-account").hidden = Boolean(review.account);
    document.querySelector("#auth-create-account").disabled = creatingAuthorizationAccount || approvalQueue.busy;
    document.querySelector("#approve-auth").disabled = creatingAuthorizationAccount || approvalQueue.busy || !review.account || choice === "reject";
    document.querySelector("#reject-auth").disabled = !approvalQueue.busy && !creatingAuthorizationAccount && choice === "approve";
    document.querySelector("#reject-auth").textContent = approvalQueue.busy || creatingAuthorizationAccount ? "Cancel and lock Wallet" : "Reject request";
  } else if (type === "proposal") {
    document.querySelector("#proposal-name").textContent = `Connect to ${review.name}`;
    document.querySelector("#proposal-origin").textContent = review.url ?? "No verified app address was provided.";
    document.querySelector("#proposal-account").textContent = nativeAccountLabel(review.account ?? activeAccount) ?? "Create an account first";
    const proposalMethods=review.methods??review.permissions?.methods;
    if(Array.isArray(proposalMethods)&&proposalMethods.length===0)copyUI(document.querySelector('#proposal-permissions'),ADDRESS_ONLY_CONNECTION_NOTICE);
    else document.querySelector("#proposal-permissions").textContent = (Array.isArray(proposalMethods)?proposalMethods:[]).map(methodLabel).join(" · ") || "Share your account on YNX Testnet";
    for (const button of panel.querySelectorAll("button")) button.disabled = approvalQueue.busy && button.id !== "reject-proposal";
    document.querySelector("#reject-proposal").textContent = approvalQueue.busy ? "Cancel and lock Wallet" : "Reject connection";
    document.querySelector("#approve-proposal").disabled = approvalQueue.busy || !review.account;
  } else {
    document.querySelector("#provider-title").textContent = review.review.title;
    document.querySelector("#provider-origin").textContent = review.origin;
    document.querySelector("#provider-detail").textContent = readableProviderReview(review);
    for (const button of panel.querySelectorAll("button")) button.disabled = approvalQueue.busy && button.id !== "reject-provider";
    document.querySelector("#reject-provider").textContent = approvalQueue.busy ? "Cancel and lock Wallet" : "Reject request";
  }
  panel.querySelector(".queue-count").textContent = approvalQueue.count > 1 ? `${approvalQueue.count - 1} more request${approvalQueue.count > 2 ? "s" : ""} waiting` : "";
  if (newlyShown) panel.showModal();
}
function scopeLabel(scope) { return ({ "creator:account": "View your creator account", "creator:publish": "Publish your videos", "creator:revenue": "View creator revenue", "video:account": "View your account", "video:library": "Manage your library", "video:playback": "Play videos", "account:read": "View your account", "profile:link": "Link your profile" })[scope] ?? scope; }
function methodLabel(method) { return ({ eth_requestAccounts: "Share account", personal_sign: "Request message signatures", eth_signTypedData_v4: "Request structured signatures", eth_sendTransaction: "Request transactions" })[method] ?? method; }
function readableProviderReview(request) { return formatApprovalReview(request.review); }

document.querySelector("#reject-auth").addEventListener("click", () => act("reject"));
document.querySelector("#approve-auth").addEventListener("click", () => act("approve"));
document.querySelector("#auth-create-account").addEventListener("click", async () => {
  if (creatingAuthorizationAccount || approvalQueue.busy || approvalQueue.current?.type !== "authorization" || approvalQueue.current.review.account) return;
  if(typeof mnemonicUI!=="undefined"&&window.ynxWallet.prepareMnemonicAccount){authorization.close();mnemonicUI.openCreate();return}
  creatingAuthorizationAccount = true;
  const operation=beginAccountOperation(document.querySelector("#auth-create-account"));
  presentApproval();
  try {
    const result = await window.ynxWallet.createAccount();
    if(!accountOperationCurrent(operation))return;
    if (result.ok) renderAccount(result);
    else authResult.textContent = "Your account could not be created. Try again or return to the app.";
  } catch { if(accountOperationCurrent(operation))authResult.textContent = "Your account could not be created. Try again or return to the app."; }
  finally { finishAccountOperation(operation);creatingAuthorizationAccount = false; presentApproval(); }
});

const accountTitle = document.querySelector("#account-title");
const accountDetail = document.querySelector("#account-detail");
const accountShort = document.querySelector("#account-short");
const signingShort = document.querySelector("#signing-short");
const createAccount = document.querySelector("#create-account");
const addAccount = document.querySelector("#add-account");
const accountList = document.querySelector("#account-list");
const mnemonicUI=createMnemonicUI({document,api:window.ynxWallet,getState:()=>keyState,getAccount:()=>activeAccount,onAccount:renderAccount,
  getView:()=>[accountViewRevision,accountOperationIntent].join(':'),onCommitFailure:result=>showAccountError(accountDetail,result.error)});
const mnemonicImportUI=createMnemonicImportUI({document,getState:()=>keyState,getAccount:()=>activeAccount});
const mnemonicBackupButton=document.createElement('button');mnemonicBackupButton.id='show-recovery-phrase';mnemonicBackupButton.type='button';copyUI(mnemonicBackupButton,'Show recovery phrase');
document.querySelector('#backup-section').insertAdjacentElement('beforebegin',mnemonicBackupButton);
mnemonicBackupButton.addEventListener('click',()=>mnemonicUI.openBackup());
function renderAccount(payload) {
  clearAssetBalance();
  clearTransactionResolution();
  invalidateWalletConnectSessions();
  accountViewRevision++;
  clearInvoiceInput();
  if(typeof mnemonicUI!=="undefined")mnemonicUI.invalidate();
  if(typeof mnemonicImportUI!=="undefined")mnemonicImportUI.invalidate();
  contractUI.clear();
  invalidatePaymentInput();
  receiveShareUI.invalidate();
  if (payload?.ok === false) {
    accountState = null;
    activeAccount = null; transactionHistoryUI.clear();
    if(typeof transferAttemptUI!=="undefined")void transferAttemptUI.refresh();
    receiveCodeUI.clear();
    document.querySelector("#receive-address").value = "";
    document.querySelector("#receive-evm-address").value = "";
    document.querySelector("#copy-address").disabled = true;
    document.querySelector("#copy-receiving-link").disabled = true;
    passwordUI?.render(); renderKeyDetail(); showAccountError(accountDetail,payload.error); return;
  }
  const status = payload?.ok === true ? payload.value : payload;
  if(pendingImportOperation&&!pendingImportOperation.commit&&accountViewRevision===pendingImportOperation.view+1&&keyState.locked&&!keyState.authenticating&&keyState.account===status?.account){
    pendingImportOperation.commit={view:accountViewRevision,security:accountSecurityIntent,revision:keyState.revision,account:status.account};
  }
  accountState = status;
  passwordUI?.render(); renderKeyDetail();
  const previousAccount = activeAccount;
  activeAccount = status?.account ?? null;
  multichainUI?.render();
  if(typeof transferAttemptUI!=="undefined")void transferAttemptUI.refresh();
  if (previousAccount !== activeAccount) {
    document.querySelector("#transfer-to").value = "";
    document.querySelector("#transfer-amount").value = "";
    document.querySelector("#recipient-status").textContent = "";
  }
  if (previousAccount !== activeAccount) document.querySelector("#transaction-resolution-result").textContent = "";
  if (previousAccount !== activeAccount) void transactionHistoryUI.refresh();
  void refreshTransactions();
  document.querySelector("#assets").hidden = !status?.initialized;
  document.querySelector("#backup-section").hidden = !status?.initialized;
  if (!status?.initialized) setView("accounts");
  else if (!previousAccount) setView("overview");
  if(activeAccount)document.querySelector("#toolbar-account").textContent = `${nativeAccountLabel(activeAccount).slice(0, 8)}…${nativeAccountLabel(activeAccount).slice(-6)}`;
  else copyUI(document.querySelector("#toolbar-account"),"My accounts");
  document.querySelector("#receive-address").value = status?.ynxAccount ?? "";
  document.querySelector("#receive-evm-address").value = activeAccount ?? "";
  document.querySelector("#receive-compatibility").open = false;
  document.querySelector("#receive-status").textContent = "";
  document.querySelector("#copy-address").disabled = !status?.ynxAccount;
  document.querySelector("#copy-receiving-link").disabled = !status?.ynxAccount;
  receiveCodeUI.clear();
  if (document.querySelector("#receive-sheet").open) void receiveCodeUI.refresh(status?.ynxAccount);
  transferReview = null;
  document.querySelector("#transfer-review").hidden = true;
  document.querySelector("#transfer-review").close();
  if (status?.initialized) void refreshAssets();
  if (!status?.initialized) {
    copyUI(accountTitle,"No account created");
    copyUI(accountShort,"Not created");
    copyUI(signingShort,"Locked");
    createAccount.hidden = false;
    addAccount.hidden = true;
    accountList.replaceChildren();
    copyUI(accountDetail,status?.passwordConfigured ? "Unlock with your local password, then create or import an account." : "Set a local password to encrypt your Wallet before creating or importing an account.");
    return;
  }
  copyUI(accountTitle,"Your account");
  accountDetail.textContent = status.ynxAccount;
  accountShort.textContent = `${status.ynxAccount.slice(0, 8)}…${status.ynxAccount.slice(-6)}`;
  copyUI(signingShort,keyState.locked ? "Locked" : "Approval required");
  createAccount.hidden = true;
  addAccount.hidden = false;
  accountList.replaceChildren();
  for (const item of status.accounts ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.account = item.account;
    copyUI(button,item.account === status.account ? item.state === "recovery-required" ? "{account} · active · restore from backup" : "{account} · active" : item.state === "recovery-required" ? "Switch to {account} · restore from backup" : "Switch to {account}",{account:item.ynxAccount});
    button.disabled = keyState.locked || item.account === status.account;
    button.addEventListener("click", async () => {
      if(keyState.locked||keyState.authenticating||item.account===activeAccount||accountSelectionPendingCurrent())return;
      const operation = beginAccountOperation(button,"select");operation.target=item.account;
      pendingAccountSelection=operation;renderAccountSelectionControls();
      try {
        const result = await window.ynxWallet.selectAccount(item.account);
        if(!accountOperationCurrent(operation)&&!selectionFeedbackCurrent(operation,result))return;
        if (!result.ok) showAccountError(accountDetail,result.error);
        else renderAccount(result);
      } catch {if(accountOperationCurrent(operation))copyUI(accountDetail,"Wallet did not finish. Reopen the current Wallet before continuing.");}
      finally {
        const owned=pendingAccountSelection===operation;if(owned)pendingAccountSelection=null;
        finishAccountOperation(operation,item.account===activeAccount);
        if(owned&&operation.view===accountViewRevision&&operation.account===activeAccount)renderAccountSelectionControls();
      }
    });
    accountList.append(button);
  }
}
// Private renderer ownership only: never a key/signing authorization context.
let accountSecurityIntent=0,pendingImportOperation=null,pendingAccountSelection=null,accountOperationIntent=0;
const accountOperationOwners=new WeakMap();
function beginAccountOperation(control,kind="account"){
  const operation={control,view:accountViewRevision,security:accountSecurityIntent,revision:keyState.revision,kind,commit:null,account:activeAccount,intent:++accountOperationIntent};
  accountOperationOwners.set(control,operation);if(kind==="import")pendingImportOperation=operation;return operation;
}
function accountOperationCurrent(operation){return accountOperationOwners.get(operation.control)===operation&&operation.view===accountViewRevision&&operation.security===accountSecurityIntent&&operation.revision===keyState.revision;}
function accountSelectionPendingCurrent(){const operation=pendingAccountSelection;return !!operation&&accountOperationOwners.get(operation.control)===operation&&operation.intent===accountOperationIntent&&operation.view===accountViewRevision&&operation.account===activeAccount;}
function renderAccountSelectionControls(){for(const button of accountList.children)button.disabled=keyState.locked||keyState.authenticating||button.dataset.account===activeAccount||accountSelectionPendingCurrent();}
function selectionFeedbackCurrent(operation,result){
  const checkpoint=result?.selectionView;
  // Admit only this trusted Main receipt's exact own invalidation for ERROR
  // display. Never rebase success, authority, account status or another action.
  return result?.ok===false&&accountSelectionPendingCurrent()&&pendingAccountSelection===operation&&
    operation.account===keyState.account&&!keyState.locked&&!keyState.authenticating&&
    checkpoint?.account===operation.account&&checkpoint.target===operation.target&&
    checkpoint.revision===operation.revision&&checkpoint.retiredRevision===operation.revision+1&&
    keyState.revision===checkpoint.retiredRevision&&accountSecurityIntent===operation.security+1;
}
function importFeedbackCurrent(operation,result){
  const checkpoint=result?.importView;
  // Only the original Main cancellation may retire this exact failed import's
  // public notice. This never revives secrets, success or an operation grant.
  return result?.ok===false&&pendingImportOperation===operation&&
    accountOperationOwners.get(operation.control)===operation&&operation.intent===accountOperationIntent&&
    operation.view===accountViewRevision&&operation.account===activeAccount&&operation.account===keyState.account&&
    !keyState.locked&&!keyState.authenticating&&checkpoint?.kind===operation.format&&
    checkpoint.account===operation.account&&checkpoint.revision===operation.revision&&
    checkpoint.retiredRevision===operation.revision+1&&keyState.revision===checkpoint.retiredRevision&&
    accountSecurityIntent===operation.security+1;
}
function currentImportCommit(operation,result){
  const commit=operation.commit;
  return accountOperationOwners.get(operation.control)===operation&&commit&&result.ok&&result.value.account===commit.account&&activeAccount===commit.account&&keyState.account===commit.account&&keyState.locked&&!keyState.authenticating&&accountViewRevision===commit.view&&accountSecurityIntent===commit.security&&keyState.revision===commit.revision;
}
function finishAccountOperation(operation,selected=false){
  if(accountOperationCurrent(operation))operation.control.disabled=keyState.locked||selected;
  if(accountOperationOwners.get(operation.control)===operation)accountOperationOwners.delete(operation.control);
  if(pendingImportOperation===operation)pendingImportOperation=null;
}
createAccount.addEventListener("click", async () => {
  if(typeof mnemonicUI!=="undefined"&&window.ynxWallet.prepareMnemonicAccount){mnemonicUI.openCreate();return}
  const operation = beginAccountOperation(createAccount);
  createAccount.disabled = true;
  try {
    const result = await window.ynxWallet.createAccount();
    if(!accountOperationCurrent(operation))return;
    if (!result.ok) showAccountError(accountDetail,result.error);
    else renderAccount(result);
  } catch {if(accountOperationCurrent(operation))copyUI(accountDetail,"Wallet did not finish. Reopen the current Wallet before continuing.");}
  finally {finishAccountOperation(operation);}
});
addAccount.addEventListener("click", async () => {
  if(typeof mnemonicUI!=="undefined"&&window.ynxWallet.prepareMnemonicAccount){mnemonicUI.openCreate();return}
  const operation = beginAccountOperation(addAccount);
  addAccount.disabled = true;
  try {
    const result = await window.ynxWallet.addAccount();
    if(!accountOperationCurrent(operation))return;
    if (!result.ok) showAccountError(accountDetail,result.error);
    else renderAccount(result);
  } catch {if(accountOperationCurrent(operation))copyUI(accountDetail,"Wallet did not finish. Reopen the current Wallet before continuing.");}
  finally {finishAccountOperation(operation);}
});
window.ynxWallet.onAccountStatus(renderAccount);
const initialAccountView = accountViewRevision;
window.ynxWallet.accountStatus().then(result => {
  if(initialAccountView === accountViewRevision)renderAccount(result);
}).catch(() => {
  if(initialAccountView === accountViewRevision)renderAccount({ok:false,error:{code:"ACCOUNT_STATUS_UNAVAILABLE",message:"Wallet did not finish. Reopen the current Wallet before continuing."}});
});

const walletConnectTitle = document.querySelector("#walletconnect-title");
const walletConnectDetail = document.querySelector("#walletconnect-detail");
const pairButton = document.querySelector("#walletconnect-pair");
const walletConnectURI = document.querySelector("#walletconnect-uri");
let walletConnectQR = document.querySelector("#walletconnect-qr");
const walletConnectQRStatus = document.querySelector("#walletconnect-qr-status");
const sessionsPanel = document.querySelector("#walletconnect-sessions");
let walletConnectSessionsRevision = 0;
const walletConnectDisconnectOwners = new Map();
let walletConnectDisconnectRevision = 0;
let walletConnectInputRevision = 0;
let walletConnectStatusRevision = 0;
function walletConnectViewCurrent() {
  const input = walletConnectInputRevision, account = activeAccount, view = accountViewRevision, security = accountSecurityIntent, revision = keyState.revision;
  return () => input === walletConnectInputRevision && account === activeAccount && view === accountViewRevision && security === accountSecurityIntent && revision === keyState.revision;
}
const pairCancel = document.createElement("button");
pairCancel.id = "walletconnect-cancel-pair"; pairCancel.type = "button";
pairCancel.hidden = true; copyUI(pairCancel,"Cancel"); pairButton.after(pairCancel);
pairCancel.addEventListener("click",async()=>{
  if(pairCancel.disabled)return;
  walletConnectInputRevision++;
  const current = walletConnectViewCurrent();
  pairCancel.disabled = true;
  try { const result=await window.ynxWallet.walletConnectCancelPair(); if(current()&&!result.ok)walletConnectDetail.textContent=errorText(result); }
  catch {if(current())copyUI(walletConnectDetail,"The pairing attempt did not finish. Request a fresh QR code before retrying.");}
  finally { if(current()){const revision=++walletConnectStatusRevision;try{const status=await window.ynxWallet.walletConnectStatus();if(current()&&revision===walletConnectStatusRevision)renderWalletConnect(status);}catch{if(current()&&revision===walletConnectStatusRevision)copyUI(walletConnectDetail,"The pairing attempt did not finish. Request a fresh QR code before retrying.");}if(current()&&revision===walletConnectStatusRevision)pairCancel.disabled=false;} }
});
function renderWalletConnect(payload) {
  const status = payload?.ok === true ? payload.value : payload;
  pairCancel.hidden = !status?.pairing;
  pairButton.disabled = !status?.started || status?.pairing === true;
  const startupFailed = status?.configured && status?.code && status.code !== "WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED";
  // Unproved Relay connectivity is not a startup failure. Keep title/detail
  // on the same branch without changing pairing or authorization readiness.
  if(startupFailed){
    walletConnectTitle.textContent="WalletConnect unavailable";
    walletConnectDetail.textContent="The connection service is unavailable. Your wallet and accounts remain accessible.";
  }else if(status?.relayConnected){
    walletConnectTitle.textContent="Ready to connect an app";
    walletConnectDetail.textContent=`${status.activeSessionCount} connected app${status.activeSessionCount === 1 ? "" : "s"}. You review every signature and transaction.`;
  }else if(status?.configured){
    if(status.started)walletConnectTitle.textContent="Connecting to WalletConnect…";
    else copyUI(walletConnectTitle,"WalletConnect not started");
    copyUI(walletConnectDetail,"The Relay connection is not yet confirmed. Your wallet and accounts remain accessible.");
  }else{
    walletConnectTitle.textContent="Cross-device connections are coming";
    walletConnectDetail.textContent="WalletConnect is not enabled in this build. You can still connect directly from supported YNX apps.";
  }
  pairButton.disabled = !status?.started || startupFailed || status?.pairing === true;
  const pairPhase = status?.pair?.phase;
  if(pairPhase === "pairing")copyUI(walletConnectDetail,"Connecting… You can cancel this pairing attempt.");
  else if(pairPhase === "proposal-received")copyUI(walletConnectDetail,"Connection proposal received. Review before approving.");
  else if(["canceled","timed-out","failed"].includes(pairPhase))copyUI(walletConnectDetail,pairPhase === "canceled" ? "Pairing canceled. Request a fresh QR code before retrying." : "The pairing attempt did not finish. Request a fresh QR code before retrying.");
}
function invalidateWalletConnectSessions() {
  const revision = ++walletConnectSessionsRevision;
  sessionsPanel.replaceChildren();
  const retry = document.createElement("button");
  retry.type = "button"; copyUI(retry,"Try refreshing");
  retry.addEventListener("click",() => {if(revision===walletConnectSessionsRevision)return refreshWalletConnectSessions();});
  sessionsPanel.append(retry);
  invalidateWalletConnectInput();
}
async function refreshWalletConnectSessions() {
  const revision = ++walletConnectSessionsRevision;
  const account = activeAccount, view = accountViewRevision, security = accountSecurityIntent, keyRevision = keyState.revision;
  const contextCurrent = () => account === activeAccount && view === accountViewRevision && security === accountSecurityIntent && keyRevision === keyState.revision;
  const current = () => revision === walletConnectSessionsRevision && contextCurrent();
  let sessions;
  try {
    const response = await window.ynxWallet.walletConnectSessions();
    if (!current()) return;
    if (response?.ok !== true || !Array.isArray(response.value) || response.value.length > 256) throw new Error("Session inventory unavailable");
    sessions = response.value;
    const topics = new Set();
    for (const session of sessions) {
      if (!session || typeof session.topic !== "string" || !/^[A-Za-z0-9_-]{3,256}$/.test(session.topic) || topics.has(session.topic) || typeof session.name !== "string" || session.name.length < 1 || session.name.length > 512 || typeof session.origin !== "string" || !/^https:\/\/[^\s/?#]+$/.test(session.origin) || !Number.isSafeInteger(session.expiry) || session.expiry <= Math.floor(Date.now()/1000)) throw new Error("Session inventory unavailable");
      topics.add(session.topic);
    }
  } catch {
    if (!current()) return;
    sessionsPanel.replaceChildren();
    const notice = document.createElement("p"), retry = document.createElement("button");
    copyUI(notice,"Connected apps could not be read. This is not confirmation that no sessions exist.");
    retry.type = "button"; copyUI(retry,"Try refreshing");
    retry.addEventListener("click",() => {if(current())return refreshWalletConnectSessions();});
    sessionsPanel.append(notice,retry);
    return;
  }
  sessionsPanel.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("p");
    copyUI(empty,"No active WalletConnect sessions.");
    sessionsPanel.append(empty);
    return;
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = `${session.name} · ${session.origin}`;
    const disconnect = document.createElement("button");
    disconnect.type = "button";
    copyUI(disconnect,"Disconnect and revoke");
    let busy = false;
    disconnect.addEventListener("click", async () => {
      if (!current() || busy) return;
      if(walletConnectDisconnectOwners.get(session.topic)?.contextCurrent())return;
      const actionRevision=++walletConnectDisconnectRevision;
      const operation={contextCurrent};walletConnectDisconnectOwners.set(session.topic,operation);
      const resultCurrent=()=>contextCurrent()&&actionRevision===walletConnectDisconnectRevision&&walletConnectDisconnectOwners.get(session.topic)===operation;
      busy = true;
      disconnect.disabled = true;
      try {
        const result = await window.ynxWallet.walletConnectDisconnect(session.topic);
        if (!resultCurrent()) return;
        const complete = result?.ok === true && result.value?.topic === session.topic && result.value.disconnected === true && result.value.localPermissionRevoked === true;
        copyUI(walletConnectDetail,complete ? "Session disconnected and local account permission revoked." : "Disconnect did not return complete confirmation. Refresh connected apps before deciding whether to retry.");
      } catch {
        if (resultCurrent()) copyUI(walletConnectDetail,"Disconnect did not return complete confirmation. Refresh connected apps before deciding whether to retry.");
      } finally {
        const owned=walletConnectDisconnectOwners.get(session.topic)===operation;
        const refresh = owned&&contextCurrent();
        if(owned)walletConnectDisconnectOwners.delete(session.topic);
        busy = false; disconnect.disabled = false;
        if (refresh) await refreshWalletConnectSessions();
      }
    });
    row.append(label, disconnect);
    sessionsPanel.append(row);
  }
}
async function refreshWalletConnectConnectionView() {
  const revision = ++walletConnectStatusRevision, current = walletConnectViewCurrent();
  void refreshWalletConnectSessions();
  try {
    const status = await window.ynxWallet.walletConnectStatus();
    if(current() && revision === walletConnectStatusRevision)renderWalletConnect(status);
  } catch {
    if(current() && revision === walletConnectStatusRevision)copyUI(walletConnectDetail,"The pairing attempt did not finish. Request a fresh QR code before retrying.");
  }
}
window.ynxWallet.onWalletConnectStatus(payload=>{walletConnectStatusRevision++;renderWalletConnect(payload);});
window.ynxWallet.onWalletConnectSessionChanged(event => {
  invalidateWalletConnectSessions();
  if (event?.type === "account-switched") {
    for (const id of event.cancelledProposalIds ?? []) approvalQueue.remove("proposal", id);
    document.querySelector("#connection-result").textContent = "Your account changed. Connect again from the app to share the new account.";
  }
  void refreshWalletConnectSessions();
});
void refreshWalletConnectConnectionView();
pairButton.addEventListener("click", async () => {
  if(pairButton.disabled)return;
  walletConnectInputRevision++;
  const current = walletConnectViewCurrent();
  const uri = walletConnectURI.value.trim();
  pairButton.disabled = true;
  try {
    const result = await window.ynxWallet.walletConnectPair(uri);
    if(!current())return;
    if (!result.ok) walletConnectDetail.textContent = errorText(result);
    else copyUI(walletConnectDetail,"Connection proposal received. Review before approving.");
  } catch { if(current())copyUI(walletConnectDetail,"The pairing attempt did not finish. Request a fresh QR code before retrying."); }
  finally {if(current()){const revision=++walletConnectStatusRevision;try{const status=await window.ynxWallet.walletConnectStatus();if(current()&&revision===walletConnectStatusRevision)renderWalletConnect(status);}catch{if(current()&&revision===walletConnectStatusRevision){copyUI(walletConnectDetail,"The pairing attempt did not finish. Request a fresh QR code before retrying.");pairButton.disabled=false;}}}}
});
function invalidateWalletConnectInput() {
  walletConnectInputRevision++;
  walletConnectURI.value = ""; walletConnectQRStatus.textContent = "";
  pairCancel.disabled = false;
  const old = walletConnectQR, replacement = old.cloneNode(false);
  old.value = ""; replacement.value = ""; old.replaceWith(replacement);
  walletConnectQR = replacement; bindWalletConnectQR(replacement);
}
function bindWalletConnectQR(input) {
let chooserCurrent = null, readRevision = 0;
input.addEventListener("click",()=>{chooserCurrent=walletConnectViewCurrent();readRevision++;});
input.addEventListener("change", async () => {
  if(input!==walletConnectQR||chooserCurrent&&!chooserCurrent())return;
  const viewCurrent = chooserCurrent ?? walletConnectViewCurrent(), read = ++readRevision;
  const current = () => input === walletConnectQR && read === readRevision && viewCurrent();
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
    walletConnectQRStatus.textContent = "INVALID_QR_IMAGE: choose a PNG, JPEG or WebP image up to 10 MB.";
    return;
  }
  try {
    const bytes = await file.arrayBuffer();
    if(!current())return;
    const result = await window.ynxWallet.walletConnectDecodeQR({ mimeType: file.type, bytes });
    if(!current())return;
    if (!result.ok) { walletConnectQRStatus.textContent = `${result.error.code}: ${result.error.message}`; return; }
    walletConnectURI.value = result.value.uri;
    walletConnectQRStatus.textContent = "WalletConnect v2 URI decoded locally. Review it, then pair the DApp.";
  } catch {
    if(current())walletConnectQRStatus.textContent = "QR_DECODE_FAILED: no usable WalletConnect QR code was found.";
  }
});
}
bindWalletConnectQR(walletConnectQR);

const proposalPanel = document.querySelector("#walletconnect-proposal");
window.ynxWallet.onWalletConnectProposal(proposal => {
  approvalQueue.enqueue("proposal", proposal);
});
async function proposalAction(action) {
  if (approvalQueue.current?.type !== "proposal") return;
  const item = approvalQueue.begin(approvalQueue.current.key);
  if (!item) { if (action === "reject") await window.ynxWallet.lock(); return; }
  const account = activeAccount, view = accountViewRevision, security = accountSecurityIntent, revision = keyState.revision;
  const current = () => approvalQueue.current === item && approvalQueue.busy && account === activeAccount && view === accountViewRevision && security === accountSecurityIntent && revision === keyState.revision && !keyState.locked && item.expiresAt > Date.now();
  let remove = false;
  try {
    const result = await window.ynxWallet.walletConnectProposalAction(item.review.id, action, item.review.account);
    if (!current()) return;
    walletConnectDetail.textContent = result.ok ? (action === "approve" ? "App connected to the selected account." : "Connection declined.") : errorText(result);
    remove = result.ok || ["PROPOSAL_NOT_FOUND", "PROPOSAL_EXPIRED", "ACCOUNT_CHANGED"].includes(result.error?.code);
    if (result.ok) await refreshWalletConnectSessions();
  } catch { if(current())walletConnectDetail.textContent = "The app did not receive your response. Check the connection and try again."; }
  finally { if(approvalQueue.current === item && approvalQueue.busy)approvalQueue.finish(item.key, { remove }); }
}
document.querySelector("#reject-proposal").addEventListener("click", () => proposalAction("reject"));
document.querySelector("#approve-proposal").addEventListener("click", () => proposalAction("approve"));

const providerPanel = document.querySelector("#provider-request");
window.ynxWallet.onProviderRequest(request => {
  approvalQueue.enqueue("provider", request);
});
window.ynxWallet.onProviderRequestExpired(event => {
  const shown = approvalQueue.current?.type === "provider" && approvalQueue.current.review.id === event.id;
  approvalQueue.remove("provider", event.id);
  if(shown)walletConnectDetail.textContent = "The app request expired. Request it again from the app.";
});
async function providerAction(action) {
  if (approvalQueue.current?.type !== "provider") return;
  const item = approvalQueue.begin(approvalQueue.current.key);
  if (!item) { if (action === "reject") await window.ynxWallet.lock(); return; }
  const account = activeAccount, view = accountViewRevision, security = accountSecurityIntent, revision = keyState.revision;
  const current = () => approvalQueue.current === item && approvalQueue.busy && account === activeAccount && view === accountViewRevision && security === accountSecurityIntent && revision === keyState.revision && !keyState.locked && item.expiresAt > Date.now();
  try {
    const result = await window.ynxWallet.providerAction(item.review.id, action);
    if(!current())return;
    walletConnectDetail.textContent = result.ok ? (result.value?.responseDelivered === false ? "Wallet locked before the response could be delivered. Check the app and any submitted transaction before trying again." : result.value?.status === "success" ? "Your response was delivered to the app." : result.value?.message ?? "Request declined.") : errorText(result);
  } catch { if(current())walletConnectDetail.textContent = "The response was interrupted. Check the app before requesting another signature."; }
  finally { if(approvalQueue.current === item && approvalQueue.busy)approvalQueue.finish(item.key); void refreshTransactions(); }
}
document.querySelector("#reject-provider").addEventListener("click", () => providerAction("reject"));
document.querySelector("#approve-provider").addEventListener("click", () => providerAction("approve"));

let activeAccount = null;
let transferReview = null;
let transferInFlight = false;
let balanceRevision = 0;
const errorText = result => result?.error?.outcomeUnknown ? `${result.error.message}${result.error.transactionHash ? ` Transaction hash: ${result.error.transactionHash}.` : ""}` : result?.error?.message ?? "The wallet is unavailable. Try again shortly.";
let transactionRevision = 0;
let transactionActionRevision = 0;
const transactionHistoryUI = createTransactionHistoryUI({
  getAccount: () => activeAccount,
  request: cursor => window.ynxWallet.transactionHistory(cursor),
  render: view => {
    const list = document.querySelector("#transaction-history-list"); list.replaceChildren();
    const historyStatus=document.querySelector("#transaction-history-status");
    if(view.error && view.error!=="Saved transaction history could not be verified. Original records remain on this device.") historyStatus.textContent=view.error;
    else copyUI(historyStatus,view.error ?? (view.busy ? "Reading saved transactions…" : view.loaded && view.records.length === 0 ? "No verified completed transfers for this account on this device." : ""));
    document.querySelector("#refresh-transaction-history").disabled = view.busy || !activeAccount;
    document.querySelector("#older-transaction-history").hidden = view.nextCursor === null;
    document.querySelector("#older-transaction-history").disabled = view.busy;
    for (const record of view.records) {
      const row = document.createElement("article"), title = document.createElement("h3"), facts = document.createElement("dl"); row.className = "transaction-history-row";
      copyUI(title,record.successful ? "{amount} YNXT · Mined locally" : "{amount} YNXT · Failed",{amount:record.amount});
      for (const [label, value] of [["Recipient", nativeAccountLabel(record.to)], ["Transaction", record.hash], ["Actual fee", `${record.actualFee} YNXT`], ["Block", record.blockNumber]]) {
        const term = document.createElement("dt"), detail = document.createElement("dd"); copyUI(term,label); detail.textContent = value; detail.dir="ltr"; facts.append(term, detail);
      }
      row.append(title, facts); list.append(row);
    }
  },
});
document.querySelector("#refresh-transaction-history").addEventListener("click", () => void transactionHistoryUI.refresh());
document.querySelector("#older-transaction-history").addEventListener("click", () => void transactionHistoryUI.older());
function clearTransactionResolution() {
  ++transactionRevision; ++transactionActionRevision;
  document.querySelector("#refresh-pending-transactions").disabled = true;
  document.querySelector("#pending-transactions").replaceChildren();
  document.querySelector("#transaction-resolution").hidden = true;
  document.querySelector("#transaction-resolution-result").textContent = "";
}
async function refreshTransactions() {
  if (!window.ynxWallet.pendingTransactions) return;
  const revision = ++transactionRevision, account = activeAccount;
  const panel = document.querySelector("#transaction-resolution"), list = document.querySelector("#pending-transactions");
  if (!account) { clearTransactionResolution(); return; }
  const current = () => revision === transactionRevision && account === activeAccount;
  const refresh = document.querySelector("#refresh-pending-transactions");
  refresh.disabled = true;
  try {
    const result = await window.ynxWallet.pendingTransactions();
    if (!current()) return;
    const records=projectPendingTransactions(result,account);
    if (!current()) return;
    list.replaceChildren(); panel.hidden = records!==null && records.length === 0 && !document.querySelector("#transaction-resolution-result").textContent;
    if (records===null) { document.querySelector("#transaction-resolution-result").textContent = errorText(result); return; }
    for (const record of records) {
      const row = document.createElement("div"), description = document.createElement("p");
      if(record.signingUnknown){description.textContent="An interrupted signing operation has an unknown result. No complete original is available to this view. New signatures and retries remain blocked; preserve the journal.";row.append(description);list.append(row);continue}
      if(['pq-transfer','pq-migration','pq-revocation'].includes(record.kind)){
        const kind=record.kind==='pq-transfer'?'PQ 转账 / PQ transfer':record.kind==='pq-migration'?'PQ 账户迁移 / PQ account migration':'PQ 终止授权 / Terminal PQ revocation';
        description.textContent=kind+' · '+record.hash;row.append(description);
        const notice=document.createElement('p');notice.textContent=record.status==='pq-save-unconfirmed'?'签名结果已保留，持久化保存尚未确认。请保持钱包运行；不会重新签名或发送。 / Signed result retained; durable saving is unconfirmed. Keep Wallet running; no replacement signature or send.':'签名结果已本地保存，尚未提交。不代表链上确认、迁移或撤销成功，不允许直接重试。 / Signed result saved locally, not submitted. Not chain confirmation, migration or revocation success; no direct retry.';
        row.append(notice);
        appendPQOriginalRecoveryActions({row,record,api:window.ynxWallet,getKeyState:()=>keyState,isCurrent:current,onResult:text=>{document.querySelector('#transaction-resolution-result').textContent=text;},onRefresh:()=>{void refreshTransactions();}});
        if(record.kind==='pq-revocation'&&record.status==='pq-signed-unsubmitted'){
          const unavailable=document.createElement('p');unavailable.textContent='当前可信节点的撤销原件查询格式尚未接通。保留本地原件；不表示已撤销，不重新签名或发送。 / Trusted revocation lookup is not yet supplied. Local original retained; no claim of revocation, no re-sign or send.';row.append(unavailable);
        }
        if(record.status==='pq-signed-unsubmitted'&&record.kind!=='pq-revocation'){
          const check=document.createElement('button');check.type='button';check.textContent='只读核对原件 / Check original (read only)';check.disabled=keyState.locked;let busy=false;
          check.addEventListener('click',async()=>{
            if(busy||!current()||keyState.locked)return;busy=true;check.disabled=true;
            const action=++transactionActionRevision,keyRevision=keyState.revision,live=()=>current()&&action===transactionActionRevision&&keyRevision===keyState.revision&&!keyState.locked;
            try{const response=await window.ynxWallet.pqTransactionStatus(record.hash);if(!live())return;const observed=projectPQOriginalObservation(response,{account,hash:record.hash,kind:record.kind});
              if(!live())return;document.querySelector('#transaction-resolution-result').textContent=observed?({'pending-local-durable':'原件已存在于节点本地快照，尚未入块。原件保留，不重试。 / Pending in the local snapshot; original retained, no retry.','local-inclusion-durable':'原件已在节点本地快照中入块，不代表共识最终性；原件保留。 / Local durable inclusion, not consensus finality; original retained.','not-found-observed':'该节点当前未找到原件，不证明未发生；保留 UNKNOWN，不重签或重发。 / Not found at this producer; UNKNOWN retained, no replacement signature or send.','outcome-unknown':'原件结果仍未知；保留原件，不重签或重发。 / Outcome unknown; original retained, no replacement signature or send.'}[observed.outcome]):'可信原件查询未供给或被拒绝；记录保留，不自动重试。 / Trusted lookup unavailable or refused; original retained, no automatic retry.';
            }catch{if(live())document.querySelector('#transaction-resolution-result').textContent='无法核实原件结果；记录保留，不重签或重发。 / Original outcome unverified; retained without re-signing or sending.';}
            finally{busy=false;if(current())check.disabled=keyState.locked;}
          });row.append(check);
        }
        list.append(row);continue;
      }
      copyUI(description,"{amount} YNXT to {to} · {hash}",{amount:record.amount,to:record.to,hash:record.hash}); row.append(description);
      if(record.localRetention){
        const warning=document.createElement("p");warning.textContent="Original signed transaction retained only in this running Wallet. Durable saving is unresolved; keep Wallet running. Do not resend or sign a replacement.";row.append(warning);
        for(const cause of [record.localRetention.originalCause,record.localRetention.storageCause])if(cause){const detail=document.createElement("p");detail.textContent=cause.message;row.append(detail)}
        const save=document.createElement("button");save.type="button";save.textContent="Save original locally / 本地保存原签名";save.disabled=keyState.locked;let saveBusy=false;
        save.addEventListener("click",async()=>{
          if(saveBusy||!current()||keyState.locked)return;
          saveBusy=true;save.disabled=true;
          const action=++transactionActionRevision,keyRevision=keyState.revision;
          const live=()=>current()&&action===transactionActionRevision&&keyRevision===keyState.revision&&!keyState.locked;
          try{
            const response=await window.ynxWallet.saveTransactionOriginal(record.hash);if(!live())return;
            const value=response?.value;
            document.querySelector("#transaction-resolution-result").textContent=response?.ok===true&&value?.account===account&&value?.hash===record.hash&&value.savedLocally===true&&value.submitted===false&&value.confirmed===false?"Saved locally. This action did not send a transaction. / 已本地保存，此操作未发送交易。":errorText(response);
          }catch{if(live())document.querySelector("#transaction-resolution-result").textContent="Saving could not be verified. Keep Wallet running and preserve the original. / 无法确认保存成功，请保持钱包运行。"}
          finally{saveBusy=false;if(current())save.disabled=keyState.locked;if(live())void refreshTransactions()}
        });row.append(save);
        list.append(row);continue;
      }
      for (const retry of [false, ...(record.canRetryExact ? [true] : [])]) {
        const button = document.createElement("button"); button.type = "button";
        copyUI(button,retry ? "Retry identical signed transaction" : "Check receipt");
        button.disabled = retry && keyState.locked;
        if (retry) button.dataset.retryTransaction = "true";
        let actionBusy = false;
        button.addEventListener("click", async () => {
          if (actionBusy || !current() || retry && keyState.locked) return;
          actionBusy = true;
          const action = ++transactionActionRevision, keyRevision = keyState.revision;
          const actionCurrent = () => current() && action === transactionActionRevision && keyRevision === keyState.revision;
          button.disabled = true;
          try {
            const response = await (retry ? window.ynxWallet.retryTransaction(record.hash) : window.ynxWallet.transactionStatus(record.hash));
            if (!actionCurrent()) return;
            const outcome=projectTransactionResolution(response,{account,hash:record.hash,retry});
            if (!actionCurrent()) return;
            const resultNode=document.querySelector("#transaction-resolution-result");
            if(outcome===null) resultNode.textContent=errorText(response);
            else if(outcome.confirmed) copyUI(resultNode,outcome.successful ? "Transaction mined successfully in the node's completed local snapshot. Actual fee: {fee} YNXT. Consensus finality is not established by this proof." : "Transaction failed in the node's completed local snapshot. Actual fee: {fee} YNXT. Consensus finality is not established by this proof.",{fee:outcome.actualFee});
            else copyUI(resultNode,outcome.durabilityStatus === "pending_durable" ? "The node saved this transaction, but it has not been mined. This account remains blocked from creating a new transfer." : "A complete durable mined receipt is still unavailable. This account remains blocked from creating a new transfer.");
            if (outcome?.confirmed) void refreshAssets();
          } catch { if (actionCurrent()) copyUI(document.querySelector("#transaction-resolution-result"),"The transaction outcome could not be checked. Keep its hash and try checking again."); }
          finally {
            actionBusy = false;
            if (current()) button.disabled = retry && keyState.locked;
            if (actionCurrent()) { void refreshTransactions(); void transactionHistoryUI.refresh(); }
          }
        });
        row.append(button);
      }
      if (!record.canRetryExact) { const note = document.createElement("p"); copyUI(note,"Retry is unavailable for this record. Check the saved hash; do not recreate or resend the transaction. / 此记录不允许直接重试。请核查已保存的交易哈希，不要重新签名或发送。"); row.append(note); }
      list.append(row);
    }
  } catch { if (current()) { list.replaceChildren(); panel.hidden = false; copyUI(document.querySelector("#transaction-resolution-result"),"The local transaction journal is unavailable. New transfers remain blocked."); } }
  finally { if (current()) refresh.disabled = false; }
}
document.querySelector("#refresh-pending-transactions").addEventListener("click", () => {
  if (!activeAccount || document.querySelector("#refresh-pending-transactions").disabled) return;
  document.querySelector("#transaction-resolution-result").textContent = "";
  return refreshTransactions();
});
function clearAssetBalance() {
  ++balanceRevision;
  document.querySelector("#balance-value").textContent = "—";
  document.querySelector("#asset-balance").textContent = "—";
  document.querySelector("#balance-status").textContent = "";
}
async function refreshAssets() {
  clearAssetBalance();
  const revision = balanceRevision, account = activeAccount;
  if (!account) return;
  const current = () => revision === balanceRevision && account === activeAccount;
  copyUI(document.querySelector("#balance-status"),"Checking YNX Testnet…");
  try {
    const result = await window.ynxWallet.balance();
    if (!current()) return;
    if (!result.ok) { document.querySelector("#balance-status").textContent = errorText(result); return; }
    const value=result.value;
    if(value?.account!==account||typeof value.formatted!=="string"||value.formatted.length>80||!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value.formatted)||typeof value.transferEnabled!=="boolean"||typeof value.checkedAt!=="string"||!Number.isFinite(Date.parse(value.checkedAt))||![new Date(value.checkedAt).toISOString(),new Date(value.checkedAt).toISOString().replace(/\.000Z$/,"Z")].includes(value.checkedAt))throw new Error("Invalid balance projection");
    document.querySelector("#balance-value").textContent = value.formatted;
    document.querySelector("#asset-balance").textContent = `${value.formatted} YNXT`;
    copyUI(document.querySelector("#balance-status"),value.transferEnabled===false?"Legacy whole-YNXT balance verified. Ethereum transfers are not enabled on this network.":"YNX Testnet · Updated {time}",{time:new Date(value.checkedAt).toLocaleTimeString()});
  } catch { if (current()) copyUI(document.querySelector("#balance-status"),"Balance unavailable. Try refreshing."); }
}
document.querySelector("#refresh-balance").addEventListener("click", refreshAssets);
document.querySelector("#copy-receiving-link").addEventListener("click",()=>void receiveShareUI.copyLink());
document.querySelector("#copy-address").addEventListener("click",()=>void receiveShareUI.copyAddress());
document.querySelector("#import-kind").addEventListener("change", event => {
  // The modal editor owns format changes and clears every secret field.
  if(typeof mnemonicImportUI!=="undefined")return;
  const encrypted = event.target.value === "encrypted-json";
  document.querySelector("#import-value").hidden = encrypted;
  document.querySelector('label[for="import-value"]').hidden = encrypted;
  document.querySelector("#import-file-group").hidden = !encrypted;
  document.querySelector("#import-password-group").hidden = !encrypted;
  document.querySelector("#import-value").value = "";
  document.querySelector("#import-file").value = "";
  document.querySelector("#import-password").value = "";
});
document.querySelector("#import-form").addEventListener("submit", async event => {
  event.preventDefault();
  const editor=typeof mnemonicImportUI!=="undefined"?mnemonicImportUI:null;
  const editorToken=editor?.beginSubmission();if(editor&&!editorToken)return;
  const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
  const operation=beginAccountOperation(button,"import");
  const output = document.querySelector("#import-result");
  const kind = document.querySelector("#import-kind").value;
  operation.format=kind;
  let value = editor?editor.value():document.querySelector("#import-value").value;
  let password = document.querySelector("#import-password").value;
  const selectedFile=document.querySelector("#import-file").files?.[0];
  document.querySelector("#import-value").value = "";
  document.querySelector("#import-password").value = "";
  editor?.clearSecrets();
  copyUI(output,"Importing and protecting the account…");
  if(editor)copyUI(document.querySelector('#import-editor-result'),"Importing and protecting the account…");
  try {
    if (kind === "encrypted-json") {
      const file = selectedFile;
      if (!file || file.size > 100_000) throw new Error("Choose an encrypted JSON backup smaller than 100 KB.");
      value = await file.text();
    }
    if (keyState.locked || !accountOperationCurrent(operation) || editor&&!editor.accepts(editorToken)) return;
    const result = await window.ynxWallet.importAccount({ kind, value, password });
    if(editor&&!editor.accepts(editorToken))return;
    if(!accountOperationCurrent(operation)){
      // The normal main-process commit publishes its account event before the
      // IPC receipt. Acknowledge that exact current commit without rendering its
      // older status a second time; intervening views/unlocks own their notice.
      if(currentImportCommit(operation,result))copyUI(output,"Account imported. Save a backup and keep it safe.");
      else if(importFeedbackCurrent(operation,result)){
        if(!renderPermissionError(output,result.error))output.textContent=errorText(result);
      }
      return;
    }
    if(result.ok)copyUI(output,"Account imported. Save a backup and keep it safe.");else if(!renderPermissionError(output,result.error))output.textContent=errorText(result);
    if(editor&&!result.ok)document.querySelector('#import-editor-result').textContent=output.textContent;
    if (result.ok) renderAccount(result);
  } catch (error) { if(accountOperationCurrent(operation)&&(!editor||editor.accepts(editorToken))){copyUI(output,"Unable to import the account. Check the backup and try again.");if(editor)copyUI(document.querySelector('#import-editor-result'),"Unable to import the account. Check the backup and try again.");} }
  finally { value = null; password = null; if(accountOperationCurrent(operation))document.querySelector("#import-file").value = "";finishAccountOperation(operation);editor?.finish(editorToken); }
});
document.querySelector("#backup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const passwordField = document.querySelector("#backup-password"), confirmField = document.querySelector("#backup-confirm");
  const output = document.querySelector("#backup-result"), button = document.querySelector("#save-backup");
  const operation=beginAccountOperation(button,"backup"),current=()=>accountOperationCurrent(operation)&&!keyState.locked;
  if (passwordField.value !== confirmField.value) { copyUI(output,"The backup passwords do not match."); finishAccountOperation(operation);return; }
  let password = passwordField.value; passwordField.value = ""; confirmField.value = ""; button.disabled = true;
  copyUI(output,"Encrypting your backup…");
  try { const result = await window.ynxWallet.saveBackup(password); if(!current())return;if(result.ok)copyUI(output,result.value.saved ? "Encrypted backup saved. Keep its password separately." : "Backup was not saved.");else output.textContent=errorText(result); }
  catch { if(current())copyUI(output,"Unable to save the backup."); }
  finally { password = null; finishAccountOperation(operation); }
});
document.querySelector("#transfer-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (keyState.locked || keyState.authenticating) return;
  invalidatePaymentInput();
  const button = document.querySelector("#prepare-transfer"), output = document.querySelector("#transfer-result");
  const operation=beginAccountOperation(button,"transfer");operation.draft=paymentDraftRevision;
  const revision = keyState.revision, account = activeAccount;
  const draftRevision = paymentDraftRevision, to = document.querySelector("#transfer-to").value.trim(), amount = document.querySelector("#transfer-amount").value.trim();
  const draftIsCurrent = () => draftRevision === paymentDraftRevision && document.querySelector("#send-sheet").open && to === document.querySelector("#transfer-to").value.trim() && amount === document.querySelector("#transfer-amount").value.trim();
  const current = () => accountOperationCurrent(operation) && !keyState.locked && !keyState.authenticating && keyState.revision === revision && account === activeAccount && draftIsCurrent();
  button.disabled = true; transferReview = null; document.querySelector("#transfer-review").hidden = true;
  copyUI(output,"Checking recipient, balance and network fee…");
  try {
    let recipient = to;
    if (!current()) return;
    if (to.startsWith("ynx:")) {
      // Reuse the normal public parser without replacing the entered draft or
      // borrowing an amount/approval from the receiving link.
      const parsed = await window.ynxWallet.paymentRecipient(to);
      if (!current()) return;
      if (parsed?.ok !== true || parsed.value?.chainId !== "ynx_6423-1" || parsed.value?.asset !== "YNXT" ||
          !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]+$/u.test(parsed.value?.ynxAccount ?? "")) {
        copyUI(output,"Recipient unavailable. Use a YNX Testnet address, receiving link or its QR image.");
        return;
      }
      recipient = parsed.value.ynxAccount;
    }
    if (!current()) return;
    const result = await window.ynxWallet.prepareTransfer({ to: recipient, amount });
    if (!current()) return;
    if (!result.ok) { if(!renderTransferPreparationError(output,result.error))output.textContent = errorText(result); return; }
    if (result.value.account !== activeAccount) { copyUI(output,"Account changed. Review again."); return; }
    transferReview = result.value;
    const summary = document.querySelector("#transfer-summary"); summary.replaceChildren();
    for (const [label, value] of [["From", transferReview.ynxFrom], ["To", transferReview.ynxTo], ["Amount", `${transferReview.amount} YNXT`], ...(transferReview.actualFee ? [["Native transfer fee", `${transferReview.actualFee} YNXT`]] : []), ["Maximum fee budget", `${transferReview.maximumFee} YNXT`], ["Maximum total budget", `${transferReview.total} YNXT`], ...(transferReview.feeExplanation ? [["Fee and budget", transferReview.feeExplanation]] : []), ["Network", "YNX Testnet · 6423"]]) {
      const term = document.createElement("dt"), description = document.createElement("dd"); copyUI(term,label); if(label==="Fee and budget")copyUI(description,value);else description.textContent=value; description.dir = "ltr"; summary.append(term, description);
    }
    document.querySelector("#transfer-transaction").textContent = formatApprovalReview(transferReview.transaction ?? {});
    document.querySelector("#transfer-review").hidden = false;
    document.querySelector("#send-sheet").close();
    document.querySelector("#transfer-review").showModal();
    copyUI(output,"Review the details below. Nothing has been signed or sent.");
  } catch { if (current()) copyUI(output,"Unable to prepare the transfer. Check the network and try again."); }
  finally { finishAccountOperation(operation); }
});
async function actOnTransfer(action) {
  if (action === "approve" && (keyState.locked || keyState.authenticating)) return;
  if (transferInFlight) { if (action === "reject") await window.ynxWallet.lock(); return; }
  if (!transferReview) return;
  transferInFlight = true;
  const operation=beginAccountOperation(document.querySelector("#confirm-transfer"),"transfer");operation.draft=paymentDraftRevision;
  const revision = keyState.revision;
  const account = activeAccount, draftRevision = paymentDraftRevision;
  const current = () => accountOperationCurrent(operation) && !keyState.locked && revision === keyState.revision && account === activeAccount && draftRevision === paymentDraftRevision;
  const id = transferReview.id; transferReview = null;
  const output = document.querySelector("#transfer-result");
  document.querySelector("#confirm-transfer").disabled = true;
  copyUI(output,action === "approve" ? "Submitting the approved transfer…" : "Cancelling…");
  try {
    const result = await window.ynxWallet.transferAction(id, action);
    // Main retains signed originals/outcomes even after this view is gone.
    // Its old receipt owns neither a new account nor a newly edited Send draft.
    if(!current())return;
    if(result.ok)copyUI(output,result.value.rejected ? "Transfer cancelled. Nothing was signed or sent." : "Submitted: {hash}. Network confirmation is pending.",{hash:result.value.hash});
    else output.textContent = errorText(result);
    if (result.ok && !result.value.rejected) void refreshAssets();
  } catch { if(current())copyUI(output,"The response was interrupted. Check the network before trying another transfer."); }
  finally {
    transferInFlight = false;
    void refreshTransactions();
    if (current()) {
      document.querySelector("#transfer-review").close(); document.querySelector("#transfer-review").hidden = true;
      document.querySelector("#confirm-transfer").disabled = keyState.locked;
      if (!document.querySelector("dialog[open]")) document.querySelector("#send-sheet").showModal();
    }
    finishAccountOperation(operation);
  }
}
document.querySelector("#cancel-transfer").addEventListener("click", () => actOnTransfer("reject"));
document.querySelector("#confirm-transfer").addEventListener("click", () => actOnTransfer("approve"));

function setView(name) {
  if (!["overview", "connections", "accounts"].includes(name)) return;
  if (name === "overview" && !activeAccount) name = "accounts";
  if (name === "connections") void refreshWalletConnectConnectionView();
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== name;
  for (const button of document.querySelectorAll("nav [data-view]")) {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  copyUI(document.querySelector("#page-title"),{ overview: "Overview", connections: "Connections", accounts: "Accounts & backup" }[name]);
  window.scrollTo({ top: 0 });
}
for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => setView(button.dataset.view));
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("close", () => queueMicrotask(presentApproval));
document.querySelector("#open-send").addEventListener("click", () => {
  if (!accountState?.initialized || keyState.authenticating) return;
  if (keyState.locked) {
    if (keyState.unlockAvailable) document.querySelector("#unlock-wallet").click();
    return;
  }
  invalidatePaymentInput();
  document.querySelector("#transfer-result").textContent="";
  document.querySelector("#send-sheet").showModal();
  document.querySelector("#transfer-to").focus();
});
document.querySelector("#send-sheet").addEventListener("close", invalidatePaymentInput);
document.querySelector("#send-sheet").addEventListener("cancel", invalidatePaymentInput);
for (const id of ["transfer-to", "transfer-amount"]) document.getElementById(id).addEventListener("input", () => {
  invalidatePaymentInput();
  document.querySelector("#recipient-status").textContent = "";
});
document.querySelector("#paste-recipient").addEventListener("click", () => void paymentRecipientUI.text(() => navigator.clipboard.readText()));
document.querySelector("#transfer-to").addEventListener("paste", event => {
  const items = Array.from(event.clipboardData?.items ?? []), file = items.find(item => item.kind === "file")?.getAsFile();
  const text = event.clipboardData?.getData("text/plain");
  if (!file && !text) return;
  event.preventDefault();
  if (file) void paymentRecipientUI.image(file); else void paymentRecipientUI.text(text);
});
document.querySelector("#open-receive").addEventListener("click", () => {
  document.querySelector("#receive-sheet").showModal();
  document.querySelector("#copy-address").focus();
  void receiveCodeUI.refresh(accountState?.ynxAccount);
});
document.querySelector("#receive-sheet").addEventListener("close", () => {receiveCodeUI.clear();receiveShareUI.invalidate()});
document.querySelector("#transfer-review").addEventListener("cancel", event => { event.preventDefault(); void actOnTransfer("reject"); });
authorization.addEventListener("cancel", event => { event.preventDefault(); void act("reject"); });
proposalPanel.addEventListener("cancel", event => { event.preventDefault(); void proposalAction("reject"); });
providerPanel.addEventListener("cancel", event => { event.preventDefault(); void providerAction("reject"); });
document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && ["1", "2", "3"].includes(event.key) && !document.querySelector("dialog[open]")) {
    event.preventDefault(); setView(["overview", "connections", "accounts"][Number(event.key) - 1]);
  }
});

function renderKeyDetail() {
  if(typeof mnemonicBackupButton!=="undefined"){mnemonicBackupButton.hidden=!accountState?.initialized;mnemonicBackupButton.disabled=keyState.locked||keyState.authenticating;}
  const detail = document.querySelector("#key-security-detail"), state = keyState;
  const lockReason=document.querySelector("#wallet-lock-reason");
  if(lockReason){lockReason.hidden=!state.locked||!Number.isSafeInteger(state.lockedAt);if(!lockReason.hidden)copyUI(lockReason,"Wallet locked: {reason} · {time}",{reason:state.lockReason,time:new Date(state.lockedAt).toLocaleTimeString()});else lockReason.textContent="";}
  const send = document.querySelector("#open-send");
  copyUI(send,state.authenticating ? "Unlocking…" : state.locked ? "Unlock to send" : "Send YNXT");
  send.disabled = !accountState?.initialized || state.authenticating || state.locked && !state.unlockAvailable;
  copyUI(detail,!accountState ? "Checking local Wallet protection…" : !accountState.passwordConfigured ? accountState.initialized ? "Existing accounts use OS protection. Set a local password to explicitly migrate all accounts." : "Set a local password to encrypt your Wallet before creating or importing accounts." : accountState.recoveryRequired ? "This account needs its offline backup. Public accounts remain visible; their previous keys are not silently replaced." : state.locked ? "Your local password encrypts this Wallet. Leaving the app, locking the screen or switching accounts cancels pending key operations." : "Review each request before approving. Wallet locks after two minutes or when it loses focus.");
}
function renderKeyState(state) {
  if(Number.isSafeInteger(state?.revision)&&Number.isSafeInteger(keyState.revision)&&state.revision<keyState.revision)return;
  const securityChanged=state.revision!==keyState.revision||state.locked!==keyState.locked||state.account!==keyState.account||state.authenticating!==keyState.authenticating;
  if(securityChanged){accountSecurityIntent++;invalidateWalletConnectSessions();}
  securityViewRevision++;
  const accountChanged = state.account !== keyState.account;
  if (state.revision !== keyState.revision || state.locked !== keyState.locked) clearInvoiceInput();
  if (state.revision !== keyState.revision || state.locked !== keyState.locked) contractUI.clear();
  if (state.revision !== keyState.revision || state.locked !== keyState.locked) invalidatePaymentInput();
  const invalidated = state.locked && (!keyState.locked || state.revision !== keyState.revision);
  const previousKeyState=keyState;
  keyState = state;
  if(typeof pqTransferReviewUI!=='undefined')pqTransferReviewUI.render();
  if(typeof pqMigrationReviewUI!=='undefined')pqMigrationReviewUI.render();
  if(typeof pqRevocationReviewUI!=='undefined'){if(securityChanged)pqRevocationReviewUI.invalidate();else pqRevocationReviewUI.render();}
  if(typeof pqKeyPreparationUI!=='undefined'){if(securityChanged)pqKeyPreparationUI.invalidate();else pqKeyPreparationUI.render();}
  if(typeof pqBackupUI!=='undefined'){if(securityChanged)pqBackupUI.invalidate();else pqBackupUI.render();}
  if(typeof pqRegisteredRestoreUI!=='undefined'){if(securityChanged)pqRegisteredRestoreUI.invalidate();else pqRegisteredRestoreUI.render();}
  if(typeof sessionRecoveryUI!=='undefined')sessionRecoveryUI.render();
  updateOriginalAdmissionSecurity(previousKeyState,state);
  if(securityChanged)familyUI?.invalidate();
  multichainUI?.render();
  if(typeof mnemonicUI!=="undefined")mnemonicUI.render();
  const title = document.querySelector("#key-security-title"), detail = document.querySelector("#key-security-detail"), unlock = document.querySelector("#unlock-wallet");
  copyUI(title,state.locked ? "Wallet locked" : "Wallet unlocked");
  renderKeyDetail();
  unlock.hidden = !state.locked;
  unlock.disabled = !state.unlockAvailable || state.authenticating;
  document.querySelector("#lock-wallet").disabled = state.locked && !state.authenticating;
  copyUI(signingShort,state.locked ? "Locked" : "Approval required");
  for (const element of document.querySelectorAll("#create-account,#add-account,#prepare-transfer,#paste-recipient,#confirm-transfer,#account-list button,#import-form input,#import-form select,#import-form button,#backup-form input,#backup-form button")) {const owner=accountOperationOwners.get(element);element.disabled = state.locked || element.dataset.account === activeAccount || !!(element.dataset.account&&accountSelectionPendingCurrent()) || !!(owner&&accountOperationCurrent(owner)&&(owner.kind!=="transfer"||owner.draft===paymentDraftRevision));}
  if(typeof mnemonicImportUI!=="undefined")mnemonicImportUI.render();
  for (const button of document.querySelectorAll("[data-retry-transaction]")) button.disabled = state.locked;
  if (state.locked) {
    if (invalidated) {
      document.querySelector("#unlock-result").textContent = "";
      document.querySelector("#import-result").textContent = "";
      document.querySelector("#backup-result").textContent = "";
      if(accountChanged){approvalQueue.clear();authorizationChoices.clear();}
      else approvalQueue.suspend();
      transferReview = null; passwordUI?.cancel();
      for (const field of document.querySelectorAll('input[type="password"],input[type="file"]')) field.value = "";
      for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
    }
  } else presentApproval();
  passwordUI?.render();
}
passwordUI = createPasswordVaultUI({ api: window.ynxWallet, getKeyState: () => keyState, getAccountStatus: () => accountState, renderAccount });
window.ynxWallet.onSecurityState?.(renderKeyState);
const initialSecurityView=securityViewRevision;
if (window.ynxWallet.securityStatus) window.ynxWallet.securityStatus().then(state=>{
  if(initialSecurityView===securityViewRevision)renderKeyState(state);
}).catch(()=>{
  if(initialSecurityView===securityViewRevision){renderKeyState(keyState);copyUI(document.querySelector("#key-security-detail"),"Wallet did not finish. Reopen the current Wallet before continuing.");}
});
else renderKeyState(keyState);
document.querySelector("#lock-wallet").addEventListener("click", () => window.ynxWallet.lock());
mountDesktopPayUI({document,api:window.ynxWallet,getContext:()=>({account:accountState?.ynxAccount??null,keyRevision:keyState.revision,locked:keyState.locked})});
multichainUI=createMultichainUI({document,api:window.ynxWallet,writeClipboard:writeReceivingClipboard,getContext:()=>({account:accountState?.account??null,revision:keyState.revision,locked:keyState.locked||keyState.authenticating})});
familyUI=createFamilyUI({document,api:window.ynxWallet,getContext:()=>({account:accountState?.account??null,revision:keyState.revision,locked:keyState.locked||keyState.authenticating})});
window.addEventListener('blur',()=>familyUI.invalidate());
window.addEventListener('blur',()=>multichainUI.invalidate());

