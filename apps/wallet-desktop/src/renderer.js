import { ApprovalReviewQueue } from "./approval-review-queue.mjs";
import { formatApprovalReview } from "./approval-review-display.mjs";
import { createPasswordVaultUI } from "./password-vault-ui.mjs";
import { createReceiveCodeUI } from "./receive-code-ui.mjs";
import { createPaymentRecipientUI } from "./payment-recipient-ui.mjs";
import { createTransactionHistoryUI } from "./transaction-history-ui.mjs";
import { createReceiveShareUI } from "./receive-share-ui.mjs";
import { createNativeContractUI } from "./native-contract-ui.mjs";
import { createInvoiceReferenceUI } from "./wallet-invoice-reference-ui.mjs";
import {mountDesktopPayUI} from "./wallet-pay-ui.mjs";
import { setWalletCopy } from "./wallet-locale.mjs";
import { createRecipientScanUI } from "./recipient-scan-ui.mjs";
import {createQRFileInput} from "./qr-file-input.mjs";
import {renderPermissionError} from "./permission-error-ui.mjs";

// Explicit product copy only; never pass an original request/value container.
function copyUI(node,key,values={}){if(typeof setWalletCopy==="function")setWalletCopy(node,key,values);else node.textContent=key.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match)}
function showAccountError(node,error){if(!renderPermissionError(node,error))node.textContent=`${error.code}: ${error.message}`}

const receiveCodeUI = createReceiveCodeUI({
  canvas: document.querySelector("#receive-qr"),
  status: document.querySelector("#receive-qr-status"),
  requestCode: account => window.ynxWallet.receiveCode(account),
});
const receiveShareUI=createReceiveShareUI({
  getContext:()=>({open:document.querySelector("#receive-sheet").open,account:accountState?.ynxAccount,keyRevision:keyState.revision}),
  requestCode:account=>window.ynxWallet.receiveCode(account),
  writeClipboard:value=>navigator.clipboard.writeText(value),
  selectAddress:()=>document.querySelector("#receive-address").select(),
  report:value=>{copyUI(document.querySelector("#receive-status"),value)},
});

let keyState = { locked: true, unlockAvailable: false, authenticating: false };
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
    document.querySelector("#contract-status").textContent = busy ? "Reading from YNX Testnet…" : error ?? (result ? "Read-only response verified. No transaction was signed or submitted." : "");
    const facts = document.querySelector("#contract-facts"), methods = document.querySelector("#contract-methods"), output = document.querySelector("#contract-result");
    facts.replaceChildren(); methods.replaceChildren(); output.textContent = ""; output.hidden = true;
    if (!result) return;
    const artifact = result.artifact ?? result.read.artifact;
    const rows = [["Contract", artifact.name], ["Address", artifact.address], ["Runtime", artifact.runtimeMode], ["Source hash", artifact.sourceHash], ["Bytecode hash", artifact.deployedBytecodeHash]];
    if (artifact.auditHash) rows.push(["Record audit hash", artifact.auditHash], ["Last updated height", String(artifact.lastUpdatedHeight)]);
    if (result.read) rows.push(["As of", result.read.asOf], ["Endpoint", result.read.origin], ["Opcode steps", String(result.read.opcodeStepCount ?? "Not applicable")]);
    for (const [label, value] of rows) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; facts.append(dt, dd); }
    for (const method of result.methods ?? []) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = `${method.signature}${method.inputCount ? " — encoded arguments required" : ""}`;
      button.addEventListener("click", () => { contractUI.clear(); document.querySelector("#contract-function").value = method.selector; document.querySelector("#contract-function").focus(); });
      methods.append(button);
    }
    if (result.read) { output.hidden = false; output.textContent = `Result: ${result.read.returnValue ?? "No known ABI decoder; encoded result below"}\nEncoded result: ${result.read.encodedResult}\n${(result.read.limitations ?? artifact.limitations ?? []).join("\n")}`; }
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
const paymentRecipientUI = createPaymentRecipientUI({
  getContext: () => ({ open: document.querySelector("#send-sheet").open, account: accountState?.account, locked: keyState.locked, keyRevision: keyState.revision }),
  parse: input => window.ynxWallet.paymentRecipient(input),
  decode: input => window.ynxWallet.paymentQR(input),
  onStart: () => { paymentDraftRevision++; },
  apply: address => {
    paymentDraftRevision++;
    document.querySelector("#transfer-to").value = address;
    document.querySelector("#transfer-amount").value = "";
    transferReview = null;
    document.querySelector("#transfer-amount").focus();
  },
  report: message => { copyUI(document.querySelector("#recipient-status"),message); },
});
const recipientScanUI=createRecipientScanUI({document,getContext:()=>({open:document.querySelector("#send-sheet").open,account:accountState?.account,locked:keyState.locked,keyRevision:keyState.revision,draftRevision:paymentDraftRevision}),image:file=>paymentRecipientUI.image(file)});
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
  if (result?.callbackOutcomeUnknown) return "The return link was handed to the system, but its outcome is unconfirmed. Check the app before requesting another sign-in.";
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
    document.querySelector("#proposal-permissions").textContent = (review.methods ?? review.permissions?.methods ?? []).map(methodLabel).join(" · ") || "Share your account on YNX Testnet";
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
function renderAccount(payload) {
  clearAssetBalance();
  clearTransactionResolution();
  invalidateWalletConnectSessions();
  accountViewRevision++;
  clearInvoiceInput();
  contractUI.clear();
  invalidatePaymentInput();
  receiveShareUI.invalidate();
  if (payload?.ok === false) {
    accountState = null;
    activeAccount = null; transactionHistoryUI.clear();
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
      const operation = beginAccountOperation(button);
      button.disabled = true;
      try {
        const result = await window.ynxWallet.selectAccount(item.account);
        if(!accountOperationCurrent(operation))return;
        if (!result.ok) showAccountError(accountDetail,result.error);
        else renderAccount(result);
      } catch {if(accountOperationCurrent(operation))copyUI(accountDetail,"Wallet did not finish. Reopen the current Wallet before continuing.");}
      finally {finishAccountOperation(operation,item.account===activeAccount);}
    });
    accountList.append(button);
  }
}
// Private renderer ownership only: never a key/signing authorization context.
let accountSecurityIntent=0,pendingImportOperation=null;
const accountOperationOwners=new WeakMap();
function beginAccountOperation(control,kind="account"){
  const operation={control,view:accountViewRevision,security:accountSecurityIntent,revision:keyState.revision,kind,commit:null};
  accountOperationOwners.set(control,operation);if(kind==="import")pendingImportOperation=operation;return operation;
}
function accountOperationCurrent(operation){return accountOperationOwners.get(operation.control)===operation&&operation.view===accountViewRevision&&operation.security===accountSecurityIntent&&operation.revision===keyState.revision;}
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
  finally { if(current()){try{const status=await window.ynxWallet.walletConnectStatus();if(current())renderWalletConnect(status);}catch{if(current())copyUI(walletConnectDetail,"The pairing attempt did not finish. Request a fresh QR code before retrying.");}if(current())pairCancel.disabled=false;} }
});
function renderWalletConnect(payload) {
  const status = payload?.ok === true ? payload.value : payload;
  pairCancel.hidden = !status?.pairing;
  pairButton.disabled = !status?.started || status?.pairing === true;
  const startupFailed = status?.configured && status?.code && status.code !== "WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED";
  walletConnectTitle.textContent = startupFailed ? "WalletConnect unavailable" : status?.relayConnected ? "Ready to connect an app" : status?.started ? "Connecting to WalletConnect…" : status?.configured ? "WalletConnect unavailable" : "Cross-device connections are coming";
  walletConnectDetail.textContent = status?.relayConnected && !startupFailed
    ? `${status.activeSessionCount} connected app${status.activeSessionCount === 1 ? "" : "s"}. You review every signature and transaction.`
    : status?.configured ? "The connection service is unavailable. Your wallet and accounts remain accessible." : "WalletConnect is not enabled in this build. You can still connect directly from supported YNX apps.";
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
  const current = () => revision === walletConnectSessionsRevision && account === activeAccount && view === accountViewRevision && security === accountSecurityIntent && keyRevision === keyState.revision;
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
      busy = true;
      disconnect.disabled = true;
      try {
        const result = await window.ynxWallet.walletConnectDisconnect(session.topic);
        if (!current()) return;
        const complete = result?.ok === true && result.value?.topic === session.topic && result.value.disconnected === true && result.value.localPermissionRevoked === true;
        copyUI(walletConnectDetail,complete ? "Session disconnected and local account permission revoked." : "Disconnect did not return complete confirmation. Refresh connected apps before deciding whether to retry.");
      } catch {
        if (current()) copyUI(walletConnectDetail,"Disconnect did not return complete confirmation. Refresh connected apps before deciding whether to retry.");
      } finally {
        const refresh = current();
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
  finally {if(current()){try{const status=await window.ynxWallet.walletConnectStatus();if(current())renderWalletConnect(status);}catch{if(current()){copyUI(walletConnectDetail,"The pairing attempt did not finish. Request a fresh QR code before retrying.");pairButton.disabled=false;}}}}
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
  approvalQueue.remove("provider", event.id);
  walletConnectDetail.textContent = "The app request expired. Request it again from the app.";
});
async function providerAction(action) {
  if (approvalQueue.current?.type !== "provider") return;
  const item = approvalQueue.begin(approvalQueue.current.key);
  if (!item) { if (action === "reject") await window.ynxWallet.lock(); return; }
  try {
    const result = await window.ynxWallet.providerAction(item.review.id, action);
    walletConnectDetail.textContent = result.ok ? (result.value?.responseDelivered === false ? "Wallet locked before the response could be delivered. Check the app and any submitted transaction before trying again." : result.value?.status === "success" ? "Your response was delivered to the app." : result.value?.message ?? "Request declined.") : errorText(result);
  } catch { walletConnectDetail.textContent = "The response was interrupted. Check the app before requesting another signature."; }
  finally { approvalQueue.finish(item.key); void refreshTransactions(); }
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
  try {
    const result = await window.ynxWallet.pendingTransactions();
    if (!current()) return;
    list.replaceChildren(); panel.hidden = result.ok && result.value.length === 0 && !document.querySelector("#transaction-resolution-result").textContent;
    if (!result.ok) { document.querySelector("#transaction-resolution-result").textContent = errorText(result); return; }
    for (const record of result.value) {
      const row = document.createElement("div"), description = document.createElement("p");
      copyUI(description,"{amount} YNXT to {to} · {hash}",{amount:record.amount,to:record.to,hash:record.hash}); row.append(description);
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
            const resultNode=document.querySelector("#transaction-resolution-result");
            if(!response.ok) resultNode.textContent=errorText(response);
            else if(response.value.confirmed) copyUI(resultNode,response.value.successful ? "Transaction mined successfully in the node's completed local snapshot. Actual fee: {fee} YNXT. Consensus finality is not established by this proof." : "Transaction failed in the node's completed local snapshot. Actual fee: {fee} YNXT. Consensus finality is not established by this proof.",{fee:response.value.actualFee});
            else copyUI(resultNode,response.value.durabilityStatus === "pending_durable" ? "The node saved this transaction, but it has not been mined. This account remains blocked from creating a new transfer." : "A complete durable mined receipt is still unavailable. This account remains blocked from creating a new transfer.");
            if (response.ok && response.value.confirmed) void refreshAssets();
          } catch { if (actionCurrent()) copyUI(document.querySelector("#transaction-resolution-result"),"The transaction outcome could not be checked. Keep its hash and try checking again."); }
          finally {
            actionBusy = false;
            if (current()) button.disabled = retry && keyState.locked;
            if (actionCurrent()) { void refreshTransactions(); void transactionHistoryUI.refresh(); }
          }
        });
        row.append(button);
      }
      if (!record.canRetryExact) { const note = document.createElement("p"); copyUI(note,"This older journal has no original signed bytes. Check the saved hash; do not recreate the transaction."); row.append(note); }
      list.append(row);
    }
  } catch { if (current()) { panel.hidden = false; copyUI(document.querySelector("#transaction-resolution-result"),"The local transaction journal is unavailable. New transfers remain blocked."); } }
}
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
  const button = event.target.querySelector("button"); button.disabled = true;
  const operation=beginAccountOperation(button,"import");
  const output = document.querySelector("#import-result");
  const kind = document.querySelector("#import-kind").value;
  let value = document.querySelector("#import-value").value;
  let password = document.querySelector("#import-password").value;
  document.querySelector("#import-value").value = "";
  document.querySelector("#import-password").value = "";
  copyUI(output,"Importing and protecting the account…");
  try {
    if (kind === "encrypted-json") {
      const file = document.querySelector("#import-file").files?.[0];
      if (!file || file.size > 100_000) throw new Error("Choose an encrypted JSON backup smaller than 100 KB.");
      value = await file.text();
    }
    if (keyState.locked || !accountOperationCurrent(operation)) return;
    const result = await window.ynxWallet.importAccount({ kind, value, password });
    if(!accountOperationCurrent(operation)){
      // The normal main-process commit publishes its account event before the
      // IPC receipt. Acknowledge that exact current commit without rendering its
      // older status a second time; intervening views/unlocks own their notice.
      if(currentImportCommit(operation,result))copyUI(output,"Account imported. Save a backup and keep it safe.");
      return;
    }
    if(result.ok)copyUI(output,"Account imported. Save a backup and keep it safe.");else if(!renderPermissionError(output,result.error))output.textContent=errorText(result);
    if (result.ok) renderAccount(result);
  } catch (error) { if(accountOperationCurrent(operation))copyUI(output,error.message ?? "Unable to import the account."); }
  finally { value = null; password = null; if(accountOperationCurrent(operation))document.querySelector("#import-file").value = "";finishAccountOperation(operation); }
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
  const current = () => accountOperationCurrent(operation) && !keyState.locked && keyState.revision === revision && account === activeAccount && draftIsCurrent();
  button.disabled = true; transferReview = null; document.querySelector("#transfer-review").hidden = true;
  copyUI(output,"Checking recipient, balance and network fee…");
  try {
    const result = await window.ynxWallet.prepareTransfer({ to, amount });
    if (!current()) return;
    if (!result.ok) { output.textContent = errorText(result); return; }
    if (result.value.account !== activeAccount) { copyUI(output,"Account changed. Review again."); return; }
    transferReview = result.value;
    const summary = document.querySelector("#transfer-summary"); summary.replaceChildren();
    for (const [label, value] of [["From", transferReview.ynxFrom], ["To", transferReview.ynxTo], ["Amount", `${transferReview.amount} YNXT`], ...(transferReview.actualFee ? [["Native transfer fee", `${transferReview.actualFee} YNXT`]] : []), ["Maximum fee budget", `${transferReview.maximumFee} YNXT`], ["Maximum total budget", `${transferReview.total} YNXT`], ...(transferReview.feeExplanation ? [["Fee and budget", transferReview.feeExplanation]] : []), ["Network", "YNX Testnet · 6423"]]) {
      const term = document.createElement("dt"), description = document.createElement("dd"); copyUI(term,label); description.textContent = value; description.dir = "ltr"; summary.append(term, description);
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
  const detail = document.querySelector("#key-security-detail"), state = keyState;
  const send = document.querySelector("#open-send");
  copyUI(send,state.authenticating ? "Unlocking…" : state.locked ? "Unlock to send" : "Send YNXT");
  send.disabled = !accountState?.initialized || state.authenticating || state.locked && !state.unlockAvailable;
  copyUI(detail,!accountState ? "Checking local Wallet protection…" : !accountState.passwordConfigured ? accountState.initialized ? "Existing accounts use OS protection. Set a local password to explicitly migrate all accounts." : "Set a local password to encrypt your Wallet before creating or importing accounts." : accountState.recoveryRequired ? "This account needs its offline backup. Public accounts remain visible; their previous keys are not silently replaced." : state.locked ? "Your local password encrypts this Wallet. Leaving the app, locking the screen or switching accounts cancels pending key operations." : "Review each request before approving. Wallet locks after two minutes or when it loses focus.");
}
function renderKeyState(state) {
  if(Number.isSafeInteger(state?.revision)&&Number.isSafeInteger(keyState.revision)&&state.revision<keyState.revision)return;
  if(state.revision!==keyState.revision||state.locked!==keyState.locked||state.account!==keyState.account||state.authenticating!==keyState.authenticating){accountSecurityIntent++;invalidateWalletConnectSessions();}
  securityViewRevision++;
  const accountChanged = state.account !== keyState.account;
  if (state.revision !== keyState.revision || state.locked !== keyState.locked) clearInvoiceInput();
  if (state.revision !== keyState.revision || state.locked !== keyState.locked) contractUI.clear();
  if (state.revision !== keyState.revision || state.locked !== keyState.locked) invalidatePaymentInput();
  const invalidated = state.locked && (!keyState.locked || state.revision !== keyState.revision);
  keyState = state;
  const title = document.querySelector("#key-security-title"), detail = document.querySelector("#key-security-detail"), unlock = document.querySelector("#unlock-wallet");
  copyUI(title,state.locked ? "Wallet locked" : "Wallet unlocked");
  renderKeyDetail();
  unlock.hidden = !state.locked;
  unlock.disabled = !state.unlockAvailable || state.authenticating;
  document.querySelector("#lock-wallet").disabled = state.locked && !state.authenticating;
  copyUI(signingShort,state.locked ? "Locked" : "Approval required");
  for (const element of document.querySelectorAll("#create-account,#add-account,#prepare-transfer,#paste-recipient,#confirm-transfer,#account-list button,#import-form input,#import-form select,#import-form button,#backup-form input,#backup-form button")) {const owner=accountOperationOwners.get(element);element.disabled = state.locked || element.dataset.account === activeAccount || !!(owner&&accountOperationCurrent(owner)&&(owner.kind!=="transfer"||owner.draft===paymentDraftRevision));}
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
