import { ApprovalReviewQueue } from "./approval-review-queue.mjs";
import { formatApprovalReview } from "./approval-review-display.mjs";
import { createPasswordVaultUI } from "./password-vault-ui.mjs";
import { createReceiveCodeUI } from "./receive-code-ui.mjs";
import { createPaymentRecipientUI } from "./payment-recipient-ui.mjs";
import { createDesktopI18n, LOCALES, MESSAGES } from "./desktop-i18n.mjs";
import { desktopErrorText } from "./desktop-error-text.mjs";

let displayStorage;
try { displayStorage = window.localStorage; } catch { /* Display preference is optional. */ }
const i18n = createDesktopI18n({ systemLocale: navigator.language, storage: displayStorage, document });
const t = (english, parameters) => i18n.t(english, parameters);
const write = (node, english, parameters) => i18n.write(node, english, parameters);
void window.ynxWallet.appInfo().then(info => {
  if (typeof info?.version === "string" && /^\d+\.\d+\.\d+$/.test(info.version)) write(document.querySelector("#wallet-version"), "Version {version}", { version: info.version });
}).catch(() => {});
const languageSelect = document.querySelector("#display-language");
for (const [code, label] of [["system", "System language"], ...LOCALES]) {
  const option = document.createElement("option"); option.value = code; option.textContent = code === "system" ? t(label) : label;
  languageSelect.append(option);
}
languageSelect.value = i18n.selection;
languageSelect.addEventListener("change", () => i18n.setLocale(languageSelect.value));

const receiveCodeUI = createReceiveCodeUI({
  canvas: document.querySelector("#receive-qr"),
  status: document.querySelector("#receive-qr-status"),
  requestCode: account => window.ynxWallet.receiveCode(account),
  translate: t,
});

let keyState = { locked: true, unlockAvailable: false, authenticating: false };
let accountState = null, passwordUI, accountReadFailed = false;
i18n.apply();
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
  report: message => { document.querySelector("#recipient-status").textContent = message; },
  translate: t,
});
function invalidatePaymentInput() { paymentDraftRevision++; paymentRecipientUI.invalidate(); }
// Public metadata was identity-checked by the main-process vault. Protocol keys remain EVM addresses.
const nativeAccountLabel = account => accountState?.accounts?.find(item => item.account === account)?.ynxAccount ?? account;
const network = document.querySelector("#network");
const detail = document.querySelector("#detail");
const chain = document.querySelector("#chain");
const indicator = document.querySelector("#indicator");

function render(status) {
  indicator.className = `indicator ${status.available ? "ok" : "failed"}`;
  write(network, status.available ? "Connected to YNX Testnet" : "YNX Testnet unavailable");
  if (status.available) chain.textContent = status.chainId; else write(chain, "Unavailable");
  write(detail, status.available
    ? "Your wallet is connected. You review every app connection and transaction."
    : "The network is unavailable. Your accounts and backups remain accessible. Try again to refresh balances or send.");
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
  write(document.querySelector("#connection-result"), authorizationErrorKey(result));
});

async function act(action) {
  if (approvalQueue.current?.type !== "authorization") return;
  if (action === "reject" && creatingAuthorizationAccount) { await window.ynxWallet.lock(); return; }
  const item = approvalQueue.begin(approvalQueue.current.key);
  if (!item) { if (action === "reject") await window.ynxWallet.lock(); return; }
  let remove = false;
  try {
    const result = await window.ynxWallet.authorizationAction({ id: item.review.id, account: item.review.account, action });
    authorization.dataset.resultCode = result.code ?? "UNKNOWN";
    authorization.dataset.callbackEmitted = String(result.callbackEmitted === true);
    authorization.dataset.authorityGranted = String(result.authorityGranted === true);
    authorization.dataset.productSessionCreated = String(result.productSessionCreated === true);
    authorization.dataset.requestId = result.requestId ?? item.review.id;
    if (result.callbackEmitted) {
      remove = true;
      write(document.querySelector("#connection-result"), action === "approve" ? "Returning to {name}. The app will verify your sign-in." : "Connection to {name} declined.", { name: item.review.displayName });
    } else {
      write(authResult, authorizationErrorKey(result));
      const code = result.underlyingCode ?? result.code;
      if (code === "CANONICAL_CALLBACK_LAUNCH_FAILED" || result.code === "CANONICAL_CALLBACK_LAUNCH_FAILED") authorizationChoices.set(item.key, action);
      remove = ["ACCOUNT_CHANGED", "SESSION_EXPIRED", "NO_PENDING_AUTHORIZATION", "AUTHORIZATION_REVIEW_MISMATCH"].includes(code);
    }
  } catch { write(authResult, "The response was interrupted. Try returning to the app again."); }
  finally { if (remove) authorizationChoices.delete(item.key); approvalQueue.finish(item.key, { remove }); }
}

function authorizationErrorKey(result) {
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
    write(document.querySelector("#auth-product"), "Connect to {name}", { name: review.displayName });
    document.querySelector("#auth-origin").textContent = review.origin;
    document.querySelector("#auth-account").textContent = review.ynxAccount ?? review.account ?? t("Create or import an account first");
    document.querySelector("#auth-purpose").textContent = review.purpose ?? review.request.purpose;
    document.querySelector("#auth-scopes").textContent = review.scopes.map(scopeLabel).join(" · ");
    write(document.querySelector("#auth-expiry"), "Valid until {time}", { time: i18n.formatTime(review.expiresAt) });
    if (newlyShown) write(authResult, "Share this account with the app. Connecting does not send any assets.");
    const choice = authorizationChoices.get(item.key);
    document.querySelector("#auth-create-account").hidden = Boolean(review.account);
    document.querySelector("#auth-create-account").disabled = creatingAuthorizationAccount || approvalQueue.busy;
    document.querySelector("#approve-auth").disabled = creatingAuthorizationAccount || approvalQueue.busy || !review.account || choice === "reject";
    document.querySelector("#reject-auth").disabled = !approvalQueue.busy && !creatingAuthorizationAccount && choice === "approve";
    write(document.querySelector("#reject-auth"), approvalQueue.busy || creatingAuthorizationAccount ? "Cancel and lock Wallet" : "Reject request");
  } else if (type === "proposal") {
    write(document.querySelector("#proposal-name"), "Connect to {name}", { name: review.name });
    document.querySelector("#proposal-origin").textContent = review.url ?? t("No verified app address was provided.");
    document.querySelector("#proposal-account").textContent = nativeAccountLabel(review.account ?? activeAccount) ?? t("Create an account first");
    document.querySelector("#proposal-permissions").textContent = (review.methods ?? review.permissions?.methods ?? []).map(methodLabel).join(" · ") || t("Share your account on YNX Testnet");
    for (const button of panel.querySelectorAll("button")) button.disabled = approvalQueue.busy && button.id !== "reject-proposal";
    write(document.querySelector("#reject-proposal"), approvalQueue.busy ? "Cancel and lock Wallet" : "Reject connection");
    document.querySelector("#approve-proposal").disabled = approvalQueue.busy || !review.account;
  } else {
    document.querySelector("#provider-title").textContent = t(review.review.title);
    document.querySelector("#provider-origin").textContent = review.origin;
    document.querySelector("#provider-detail").textContent = readableProviderReview(review);
    for (const button of panel.querySelectorAll("button")) button.disabled = approvalQueue.busy && button.id !== "reject-provider";
    write(document.querySelector("#reject-provider"), approvalQueue.busy ? "Cancel and lock Wallet" : "Reject request");
  }
  if (approvalQueue.count > 1) write(panel.querySelector(".queue-count"), "{count} more requests waiting", { count: i18n.formatNumber(approvalQueue.count - 1) });
  else panel.querySelector(".queue-count").textContent = "";
  if (newlyShown) panel.showModal();
}
function scopeLabel(scope) { return ({ "creator:account": t("View your creator account"), "creator:publish": t("Publish your videos"), "creator:revenue": t("View creator revenue"), "video:account": t("View your account"), "video:library": t("Manage your library"), "video:playback": t("Play videos"), "account:read": t("View your account"), "profile:link": t("Link your profile") })[scope] ?? scope; }
function methodLabel(method) { return ({ eth_requestAccounts: t("Share account"), personal_sign: t("Request message signatures"), eth_signTypedData_v4: t("Request structured signatures"), eth_sendTransaction: t("Request transactions") })[method] ?? method; }
function readableProviderReview(request) { return formatApprovalReview(request.review, t); }

document.querySelector("#reject-auth").addEventListener("click", () => act("reject"));
document.querySelector("#approve-auth").addEventListener("click", () => act("approve"));
document.querySelector("#auth-create-account").addEventListener("click", async () => {
  if (creatingAuthorizationAccount || approvalQueue.busy || approvalQueue.current?.type !== "authorization" || approvalQueue.current.review.account) return;
  creatingAuthorizationAccount = true;
  presentApproval();
  try {
    const result = await window.ynxWallet.createAccount();
    if (result.ok) renderAccount(result);
    else write(authResult, "Your account could not be created. Try again or return to the app.");
  } catch { write(authResult, "Your account could not be created. Try again or return to the app."); }
  finally { creatingAuthorizationAccount = false; presentApproval(); }
});

const accountTitle = document.querySelector("#account-title");
const accountDetail = document.querySelector("#account-detail");
const accountShort = document.querySelector("#account-short");
const signingShort = document.querySelector("#signing-short");
const createAccount = document.querySelector("#create-account");
const addAccount = document.querySelector("#add-account");
const accountList = document.querySelector("#account-list");
const walletCopy = (english, chinese) => MESSAGES[english] ? t(english) : i18n.locale === "zh-CN" ? chinese : english;
function renderAccount(payload) {
  invalidatePaymentInput();
  if (payload?.ok === false) {
    accountReadFailed = true;
    accountState = null;
    activeAccount = null;
    receiveCodeUI.clear();
    document.querySelector("#receive-address").value = "";
    document.querySelector("#receive-evm-address").value = "";
    document.querySelector("#copy-address").disabled = true;
    document.querySelector("#assets").hidden = true;
    document.querySelector("#backup-section").hidden = true;
    accountList.replaceChildren();
    createAccount.hidden = true;
    createAccount.disabled = true;
    addAccount.hidden = true;
    for (const control of document.querySelectorAll("#import-form input,#import-form select,#import-form button")) control.disabled = true;
    write(accountTitle, "Wallet status unavailable");
    write(accountDetail, "Your existing recovery files have been retained. Reopen Wallet before continuing. Do not create or import an account while storage is unavailable.");
    document.querySelector("#unlock-result").textContent = errorText(payload);
    passwordUI?.render(); renderKeyDetail(); return;
  }
  const status = payload?.ok === true ? payload.value : payload;
  accountReadFailed = false;
  accountState = status;
  createAccount.disabled = keyState.locked;
  for (const control of document.querySelectorAll("#import-form input,#import-form select,#import-form button")) control.disabled = keyState.locked;
  passwordUI?.render(); renderKeyDetail();
  const previousAccount = activeAccount;
  activeAccount = status?.account ?? null;
  if (previousAccount !== activeAccount) {
    document.querySelector("#transfer-to").value = "";
    document.querySelector("#transfer-amount").value = "";
    document.querySelector("#recipient-status").textContent = "";
  }
  if (previousAccount !== activeAccount) document.querySelector("#transaction-resolution-result").textContent = "";
  void refreshTransactions();
  document.querySelector("#assets").hidden = !status?.initialized;
  document.querySelector("#backup-section").hidden = !status?.initialized;
  if (!status?.initialized) setView("accounts");
  else if (!previousAccount) setView("overview");
  document.querySelector("#toolbar-account").textContent = activeAccount ? `${nativeAccountLabel(activeAccount).slice(0, 8)}…${nativeAccountLabel(activeAccount).slice(-6)}` : t("My accounts");
  document.querySelector("#receive-address").value = status?.ynxAccount ?? "";
  document.querySelector("#receive-evm-address").value = activeAccount ?? "";
  document.querySelector("#receive-compatibility").open = false;
  document.querySelector("#receive-status").textContent = "";
  document.querySelector("#copy-address").disabled = !status?.ynxAccount;
  receiveCodeUI.clear();
  if (document.querySelector("#receive-sheet").open) void receiveCodeUI.refresh(status?.ynxAccount);
  transferReview = null;
  document.querySelector("#transfer-review").hidden = true;
  document.querySelector("#transfer-review").close();
  if (status?.initialized) void refreshAssets();
  if (!status?.initialized) {
    write(accountTitle, status?.passwordConfigured ? "Password protected · no account yet" : "Set up Wallet protection");
    accountShort.textContent = walletCopy("Not created", "尚未创建");
    signingShort.textContent = t("Locked");
    createAccount.hidden = false;
    addAccount.hidden = true;
    accountList.replaceChildren();
    write(accountDetail, status?.passwordConfigured ? "Your encrypted Wallet is saved. Unlock with your local password, then create or import an account." : "Set a local password to encrypt your Wallet before creating or importing an account.");
    return;
  }
  write(accountTitle, "Your account");
  accountDetail.textContent = status.ynxAccount;
  accountShort.textContent = `${status.ynxAccount.slice(0, 8)}…${status.ynxAccount.slice(-6)}`;
  signingShort.textContent = t(keyState.locked ? "Locked" : "Approval required");
  createAccount.hidden = true;
  addAccount.hidden = false;
  accountList.replaceChildren();
  for (const item of status.accounts ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.account = item.account;
    button.textContent = `${t(item.account === status.account ? "{address} · active" : "Switch to {address}", { address: item.ynxAccount })}${item.state === "recovery-required" ? t(" · restore from backup") : ""}`;
    button.disabled = keyState.locked || item.account === status.account;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await window.ynxWallet.selectAccount(item.account);
      if (!result.ok) accountDetail.textContent = errorText(result);
      else renderAccount(result);
    });
    accountList.append(button);
  }
}
createAccount.addEventListener("click", async () => {
  createAccount.disabled = true;
  const result = await window.ynxWallet.createAccount();
  createAccount.disabled = keyState.locked;
  if (!result.ok) accountDetail.textContent = errorText(result);
  else renderAccount(result);
});
addAccount.addEventListener("click", async () => {
  addAccount.disabled = true;
  const result = await window.ynxWallet.addAccount();
  addAccount.disabled = keyState.locked;
  if (!result.ok) accountDetail.textContent = errorText(result);
  else renderAccount(result);
});
window.ynxWallet.onAccountStatus(renderAccount);
window.ynxWallet.accountStatus().then(renderAccount);

const walletConnectTitle = document.querySelector("#walletconnect-title");
const walletConnectDetail = document.querySelector("#walletconnect-detail");
const pairButton = document.querySelector("#walletconnect-pair");
const walletConnectURI = document.querySelector("#walletconnect-uri");
const walletConnectQR = document.querySelector("#walletconnect-qr");
const walletConnectQRStatus = document.querySelector("#walletconnect-qr-status");
const sessionsPanel = document.querySelector("#walletconnect-sessions");
let lastWalletConnectStatus = null;
function renderWalletConnect(payload) {
  lastWalletConnectStatus = payload;
  const status = payload?.ok === true ? payload.value : payload;
  const startupFailed = status?.configured && status?.code && status.code !== "WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED";
  walletConnectTitle.textContent = startupFailed ? t("WalletConnect unavailable") : status?.relayConnected ? t("Ready to connect an app") : status?.started ? t("Connecting to WalletConnect…") : status?.configured ? t("WalletConnect unavailable") : t("Cross-device connections are coming");
  walletConnectDetail.textContent = status?.relayConnected && !startupFailed
    ? t("{count} connected apps. You review every signature and transaction.", { count: i18n.formatNumber(status.activeSessionCount) })
    : status?.configured ? t("The connection service is unavailable. Your wallet and accounts remain accessible.") : t("WalletConnect is not enabled in this build. You can still connect directly from supported YNX apps.");
  pairButton.disabled = !status?.started || startupFailed;
}
async function refreshWalletConnectSessions() {
  const response = await window.ynxWallet.walletConnectSessions();
  const sessions = response?.ok ? response.value : [];
  sessionsPanel.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.textContent = t("No active WalletConnect sessions.");
    sessionsPanel.append(empty);
    return;
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = `${session.name} · ${session.origin}`;
    const disconnect = document.createElement("button");
    disconnect.type = "button";
    disconnect.textContent = t("Disconnect and revoke");
    disconnect.addEventListener("click", async () => {
      disconnect.disabled = true;
      const result = await window.ynxWallet.walletConnectDisconnect(session.topic);
      walletConnectDetail.textContent = result.ok ? t("Session disconnected and local account permission revoked.") : errorText(result);
      await refreshWalletConnectSessions();
    });
    row.append(label, disconnect);
    sessionsPanel.append(row);
  }
}
window.ynxWallet.onWalletConnectStatus(renderWalletConnect);
window.ynxWallet.onWalletConnectSessionChanged(event => {
  if (event?.type === "account-switched") {
    for (const id of event.cancelledProposalIds ?? []) approvalQueue.remove("proposal", id);
    document.querySelector("#connection-result").textContent = t("Your account changed. Connect again from the app to share the new account.");
  }
  void refreshWalletConnectSessions();
});
window.ynxWallet.walletConnectStatus().then(payload => { renderWalletConnect(payload); return refreshWalletConnectSessions(); });
pairButton.addEventListener("click", async () => {
  const uri = walletConnectURI.value.trim();
  pairButton.disabled = true;
  const result = await window.ynxWallet.walletConnectPair(uri);
  if (!result.ok) walletConnectDetail.textContent = errorText(result);
  else walletConnectDetail.textContent = t("Pairing request submitted. Waiting for a DApp proposal.");
  const status = await window.ynxWallet.walletConnectStatus();
  pairButton.disabled = !(status?.ok ? status.value.started : status?.started);
});
walletConnectQR.addEventListener("change", async () => {
  const file = walletConnectQR.files?.[0];
  walletConnectQR.value = "";
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
    walletConnectQRStatus.textContent = t("INVALID_QR_IMAGE: choose a PNG, JPEG or WebP image up to 10 MB.");
    return;
  }
  try {
    const result = await window.ynxWallet.walletConnectDecodeQR({ mimeType: file.type, bytes: await file.arrayBuffer() });
    if (!result.ok) { walletConnectQRStatus.textContent = errorText(result); return; }
    walletConnectURI.value = result.value.uri;
    walletConnectQRStatus.textContent = t("WalletConnect v2 URI decoded locally. Review it, then pair the DApp.");
  } catch {
    walletConnectQRStatus.textContent = t("QR_DECODE_FAILED: no usable WalletConnect QR code was found.");
  }
});

const proposalPanel = document.querySelector("#walletconnect-proposal");
window.ynxWallet.onWalletConnectProposal(proposal => {
  approvalQueue.enqueue("proposal", proposal);
});
async function proposalAction(action) {
  if (approvalQueue.current?.type !== "proposal") return;
  const item = approvalQueue.begin(approvalQueue.current.key);
  if (!item) { if (action === "reject") await window.ynxWallet.lock(); return; }
  let remove = false;
  try {
    const result = await window.ynxWallet.walletConnectProposalAction(item.review.id, action, item.review.account);
    walletConnectDetail.textContent = result.ok ? (action === "approve" ? t("App connected to the selected account.") : t("Connection declined.")) : errorText(result);
    remove = result.ok || ["PROPOSAL_NOT_FOUND", "PROPOSAL_EXPIRED", "ACCOUNT_CHANGED"].includes(result.error?.code);
    if (result.ok) await refreshWalletConnectSessions();
  } catch { walletConnectDetail.textContent = t("The app did not receive your response. Check the connection and try again."); }
  finally { approvalQueue.finish(item.key, { remove }); }
}
document.querySelector("#reject-proposal").addEventListener("click", () => proposalAction("reject"));
document.querySelector("#approve-proposal").addEventListener("click", () => proposalAction("approve"));

const providerPanel = document.querySelector("#provider-request");
window.ynxWallet.onProviderRequest(request => {
  approvalQueue.enqueue("provider", request);
});
window.ynxWallet.onProviderRequestExpired(event => {
  approvalQueue.remove("provider", event.id);
  walletConnectDetail.textContent = t("The app request expired. Request it again from the app.");
});
async function providerAction(action) {
  if (approvalQueue.current?.type !== "provider") return;
  const item = approvalQueue.begin(approvalQueue.current.key);
  if (!item) { if (action === "reject") await window.ynxWallet.lock(); return; }
  try {
    const result = await window.ynxWallet.providerAction(item.review.id, action);
    walletConnectDetail.textContent = result.ok ? (result.value?.responseDelivered === false ? t("Wallet locked before the response could be delivered. Check the app and any submitted transaction before trying again.") : result.value?.status === "success" ? t("Your response was delivered to the app.") : MESSAGES[result.value?.message] ? t(result.value.message) : t("Request declined.")) : errorText(result);
  } catch { walletConnectDetail.textContent = t("The response was interrupted. Check the app before requesting another signature."); }
  finally { approvalQueue.finish(item.key); void refreshTransactions(); }
}
document.querySelector("#reject-provider").addEventListener("click", () => providerAction("reject"));
document.querySelector("#approve-provider").addEventListener("click", () => providerAction("approve"));

let activeAccount = null;
let transferReview = null;
let transferInFlight = false;
let balanceRevision = 0;
let lastBalance = null;
function errorText(result) {
  return desktopErrorText(result, t);
}
let transactionRevision = 0;
async function refreshTransactions() {
  if (!window.ynxWallet.pendingTransactions) return;
  const revision = ++transactionRevision, account = activeAccount;
  const panel = document.querySelector("#transaction-resolution"), list = document.querySelector("#pending-transactions");
  try {
    const result = await window.ynxWallet.pendingTransactions();
    if (revision !== transactionRevision || account !== activeAccount) return;
    list.replaceChildren(); panel.hidden = result.ok && result.value.length === 0 && !document.querySelector("#transaction-resolution-result").textContent;
    if (!result.ok) { document.querySelector("#transaction-resolution-result").textContent = errorText(result); return; }
    for (const record of result.value) {
      const row = document.createElement("div"), description = document.createElement("p");
      description.textContent = t("{amount} YNXT to {address} · {hash}", { amount: i18n.formatDecimalString(record.amount), address: record.to, hash: record.hash }); row.append(description);
      for (const retry of [false, ...(record.canRetryExact ? [true] : [])]) {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = retry ? t("Retry identical signed transaction") : t("Check receipt");
        button.disabled = retry && keyState.locked;
        if (retry) button.dataset.retryTransaction = "true";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const response = await (retry ? window.ynxWallet.retryTransaction(record.hash) : window.ynxWallet.transactionStatus(record.hash));
            if (account !== activeAccount) return;
            document.querySelector("#transaction-resolution-result").textContent = !response.ok ? errorText(response) : response.value.confirmed ? t(response.value.successful ? "Transaction mined successfully in the node's completed local snapshot. Actual fee: {fee} YNXT. Consensus finality is not established by this proof." : "Transaction failed in the node's completed local snapshot. Actual fee: {fee} YNXT. Consensus finality is not established by this proof.", { fee: i18n.formatDecimalString(response.value.actualFee) }) : response.value.durabilityStatus === "pending_durable" ? t("The node saved this transaction, but it has not been mined. This account remains blocked from creating a new transfer.") : t("A complete durable mined receipt is still unavailable. This account remains blocked from creating a new transfer.");
            if (response.ok && response.value.confirmed) void refreshAssets();
          } catch { if (account === activeAccount) document.querySelector("#transaction-resolution-result").textContent = t("The transaction outcome could not be checked. Keep its hash and try checking again."); }
          finally { void refreshTransactions(); }
        });
        row.append(button);
      }
      if (!record.canRetryExact) { const note = document.createElement("p"); note.textContent = t("This older journal has no original signed bytes. Check the saved hash; do not recreate the transaction."); row.append(note); }
      list.append(row);
    }
  } catch { if (revision === transactionRevision) { panel.hidden = false; document.querySelector("#transaction-resolution-result").textContent = t("The local transaction journal is unavailable. New transfers remain blocked."); } }
}
async function refreshAssets() {
  const revision = ++balanceRevision;
  document.querySelector("#balance-value").textContent = "—";
  document.querySelector("#asset-balance").textContent = "—";
  document.querySelector("#balance-status").textContent = t("Checking YNX Testnet…");
  try {
    const result = await window.ynxWallet.balance();
    if (revision !== balanceRevision) return;
    if (!result.ok) { document.querySelector("#balance-status").textContent = errorText(result); return; }
    if (result.value.account !== activeAccount) return;
    lastBalance = result.value;
    document.querySelector("#balance-value").textContent = i18n.formatDecimalString(result.value.formatted);
    document.querySelector("#asset-balance").textContent = `${i18n.formatDecimalString(result.value.formatted)} YNXT`;
    document.querySelector("#balance-status").textContent = result.value.transferEnabled === false ? t("Legacy whole-YNXT balance verified. Ethereum transfers are not enabled on this network.") : t("YNX Testnet · Updated {time}", { time: i18n.formatTime(result.value.checkedAt) });
  } catch { if (revision === balanceRevision) document.querySelector("#balance-status").textContent = t("Balance unavailable. Try refreshing."); }
}
document.querySelector("#refresh-balance").addEventListener("click", refreshAssets);
document.querySelector("#copy-address").addEventListener("click", async () => {
  const address = accountState?.ynxAccount, selected = activeAccount;
  if (!address || !selected) return;
  try { await navigator.clipboard.writeText(address); if (selected === activeAccount) document.querySelector("#receive-status").textContent = t("YNX address copied."); }
  catch { document.querySelector("#receive-address").select(); document.querySelector("#receive-status").textContent = t("Select and copy the address above."); }
});
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
  const revision = keyState.revision;
  const button = event.target.querySelector("button"); button.disabled = true;
  const output = document.querySelector("#import-result");
  const kind = document.querySelector("#import-kind").value;
  let value = document.querySelector("#import-value").value;
  let password = document.querySelector("#import-password").value;
  document.querySelector("#import-value").value = "";
  document.querySelector("#import-password").value = "";
  output.textContent = t("Importing and protecting the account…");
  try {
    if (kind === "encrypted-json") {
      const file = document.querySelector("#import-file").files?.[0];
      if (!file || file.size > 100_000) throw new Error(t("Choose an encrypted JSON backup smaller than 100 KB."));
      value = await file.text();
    }
    if (keyState.locked || keyState.revision !== revision) return;
    const result = await window.ynxWallet.importAccount({ kind, value, password });
    output.textContent = result.ok ? t("Account imported. Save a backup and keep it safe.") : errorText(result);
    if (result.ok) renderAccount(result);
  } catch { output.textContent = t("Unable to import the account."); }
  finally { value = null; password = null; if (keyState.revision === revision) document.querySelector("#import-file").value = ""; button.disabled = keyState.locked; }
});
document.querySelector("#backup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const passwordField = document.querySelector("#backup-password"), confirmField = document.querySelector("#backup-confirm");
  const output = document.querySelector("#backup-result"), button = document.querySelector("#save-backup");
  if (passwordField.value !== confirmField.value) { output.textContent = t("The backup passwords do not match."); return; }
  let password = passwordField.value; passwordField.value = ""; confirmField.value = ""; button.disabled = true;
  output.textContent = t("Encrypting your backup…");
  try { const result = await window.ynxWallet.saveBackup(password); output.textContent = result.ok ? (result.value.saved ? t("Encrypted backup saved. Keep its password separately.") : t("Backup was not saved.")) : errorText(result); }
  catch { output.textContent = t("Unable to save the backup."); }
  finally { password = null; button.disabled = keyState.locked; }
});
document.querySelector("#transfer-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (keyState.locked || keyState.authenticating) return;
  invalidatePaymentInput();
  const button = document.querySelector("#prepare-transfer"), output = document.querySelector("#transfer-result");
  const revision = keyState.revision;
  const draftRevision = paymentDraftRevision, to = document.querySelector("#transfer-to").value.trim(), amount = document.querySelector("#transfer-amount").value.trim();
  const draftIsCurrent = () => draftRevision === paymentDraftRevision && document.querySelector("#send-sheet").open && to === document.querySelector("#transfer-to").value.trim() && amount === document.querySelector("#transfer-amount").value.trim();
  button.disabled = true; transferReview = null; document.querySelector("#transfer-review").hidden = true;
  output.textContent = t("Checking recipient, balance and network fee…");
  try {
    const result = await window.ynxWallet.prepareTransfer({ to, amount });
    if (keyState.locked || keyState.revision !== revision || !draftIsCurrent()) return;
    if (!result.ok) { output.textContent = errorText(result); return; }
    if (result.value.account !== activeAccount) { output.textContent = t("Account changed. Review again."); return; }
    transferReview = result.value;
    const summary = document.querySelector("#transfer-summary"); summary.replaceChildren();
    for (const [label, value] of [[t("From"), transferReview.ynxFrom], [t("To"), transferReview.ynxTo], [t("Amount"), `${i18n.formatDecimalString(transferReview.amount)} YNXT`], ...(transferReview.actualFee ? [[t("Native transfer fee"), `${i18n.formatDecimalString(transferReview.actualFee)} YNXT`]] : []), [t("Maximum fee budget"), `${i18n.formatDecimalString(transferReview.maximumFee)} YNXT`], [t("Maximum total budget"), `${i18n.formatDecimalString(transferReview.total)} YNXT`], ...(transferReview.feeExplanation ? [[t("Fee and budget"), transferReview.feeExplanation]] : []), [t("Network"), "YNX Testnet · 6423"]]) {
      const term = document.createElement("dt"), description = document.createElement("dd"); term.textContent = label; description.textContent = value; summary.append(term, description);
    }
    document.querySelector("#transfer-transaction").textContent = formatApprovalReview(transferReview.transaction ?? {}, t);
    document.querySelector("#transfer-review").hidden = false;
    document.querySelector("#send-sheet").close();
    document.querySelector("#transfer-review").showModal();
    output.textContent = t("Review the details below. Nothing has been signed or sent.");
  } catch { if (draftIsCurrent()) output.textContent = t("Unable to prepare the transfer. Check the network and try again."); }
  finally { button.disabled = keyState.locked; }
});
async function actOnTransfer(action) {
  if (action === "approve" && (keyState.locked || keyState.authenticating)) return;
  if (transferInFlight) { if (action === "reject") await window.ynxWallet.lock(); return; }
  if (!transferReview) return;
  transferInFlight = true;
  const revision = keyState.revision;
  const id = transferReview.id; transferReview = null;
  const output = document.querySelector("#transfer-result");
  document.querySelector("#confirm-transfer").disabled = true;
  output.textContent = t(action === "approve" ? "Submitting the approved transfer…" : "Cancelling…");
  try {
    const result = await window.ynxWallet.transferAction(id, action);
    output.textContent = result.ok ? (result.value.rejected ? t("Transfer cancelled. Nothing was signed or sent.") : t("Submitted: {hash}. Network confirmation is pending.", { hash: result.value.hash })) : errorText(result);
    if (result.ok && !result.value.rejected) void refreshAssets();
  } catch { output.textContent = t("The response was interrupted. Check the network before trying another transfer."); }
  finally {
    transferInFlight = false;
    void refreshTransactions();
    if (keyState.revision === revision) {
      document.querySelector("#transfer-review").close(); document.querySelector("#transfer-review").hidden = true;
      document.querySelector("#confirm-transfer").disabled = keyState.locked;
      if (!keyState.locked) document.querySelector("#send-sheet").showModal();
    }
  }
}
document.querySelector("#cancel-transfer").addEventListener("click", () => actOnTransfer("reject"));
document.querySelector("#confirm-transfer").addEventListener("click", () => actOnTransfer("approve"));

function setView(name) {
  if (!["overview", "connections", "accounts", "settings"].includes(name)) return;
  if (name === "overview" && !activeAccount) name = "accounts";
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== name;
  for (const button of document.querySelectorAll("nav [data-view]")) {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  document.querySelector("#page-title").textContent = t({ overview: "Overview", connections: "Connections", accounts: "Accounts & backup", settings: "Settings" }[name]);
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
document.querySelector("#receive-sheet").addEventListener("close", () => receiveCodeUI.clear());
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
  send.textContent = t(state.authenticating ? "Unlocking…" : state.locked ? "Unlock to send" : "Send YNXT");
  send.disabled = !accountState?.initialized || state.authenticating || state.locked && !state.unlockAvailable;
  detail.textContent = accountReadFailed ? walletCopy("Wallet storage cannot be read. Existing files are retained; reopen Wallet before continuing.", "无法读取钱包存储。现有文件已保留，请重新打开钱包后继续。") : !accountState ? walletCopy("Checking local Wallet protection…", "正在检查本地钱包保护…") : !accountState.passwordConfigured ? accountState.initialized ? walletCopy("Existing accounts use OS protection. Set a local password to explicitly migrate all accounts.", "现有账户使用系统保护。请设置本地密码并明确迁移全部账户。") : walletCopy("Set a local password to encrypt your Wallet before creating or importing accounts.", "请先设置本地密码加密钱包，再创建或导入账户。") : accountState.recoveryRequired ? walletCopy("This account needs its offline backup. Public accounts remain visible; their previous keys are not silently replaced.", "此账户需要离线备份才能恢复。公开账户仍可见，原有密钥不会被静默替换。") : state.locked ? walletCopy("Your local password encrypts this Wallet. Leaving the app, locking the screen or switching accounts cancels pending key operations.", "本地密码加密此钱包。离开应用、锁屏或切换账户会取消进行中的密钥操作。") : walletCopy("Review each request before approving. Wallet locks after two minutes or when it loses focus.", "批准前请逐项核对请求。钱包会在两分钟后或失去焦点时锁定。");
}
function renderKeyState(state) {
  if (state.revision !== keyState.revision || state.locked !== keyState.locked) invalidatePaymentInput();
  const invalidated = state.locked && (!keyState.locked || state.revision !== keyState.revision);
  keyState = state;
  const title = document.querySelector("#key-security-title"), detail = document.querySelector("#key-security-detail"), unlock = document.querySelector("#unlock-wallet");
  title.textContent = state.locked ? walletCopy("Wallet locked", "钱包已锁定") : walletCopy("Wallet unlocked", "钱包已解锁");
  renderKeyDetail();
  unlock.hidden = !state.locked;
  unlock.disabled = !state.unlockAvailable || state.authenticating;
  document.querySelector("#lock-wallet").disabled = state.locked && !state.authenticating;
  signingShort.textContent = t(state.locked ? "Locked" : "Approval required");
  for (const element of document.querySelectorAll("#create-account,#add-account,#prepare-transfer,#paste-recipient,#confirm-transfer,#account-list button,#import-form input,#import-form select,#import-form button,#backup-form input,#backup-form button")) element.disabled = state.locked || !accountState || element.dataset.account === activeAccount;
  for (const button of document.querySelectorAll("[data-retry-transaction]")) button.disabled = state.locked;
  if (state.locked) {
    if (invalidated) {
      document.querySelector("#unlock-result").textContent = "";
      approvalQueue.clear(); authorizationChoices.clear(); transferReview = null; passwordUI?.cancel();
      for (const field of document.querySelectorAll('input[type="password"],input[type="file"]')) field.value = "";
      for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
    }
  } else presentApproval();
  passwordUI?.render();
}
passwordUI = createPasswordVaultUI({ api: window.ynxWallet, getKeyState: () => keyState, getAccountStatus: () => accountState, renderAccount, translate: t, write, locale: () => i18n.locale });
window.ynxWallet.onSecurityState?.(renderKeyState);
if (window.ynxWallet.securityStatus) window.ynxWallet.securityStatus().then(renderKeyState);
else renderKeyState(keyState);
document.querySelector("#lock-wallet").addEventListener("click", () => window.ynxWallet.lock());
i18n.onChange(() => {
  languageSelect.querySelector('option[value="system"]').textContent = t("System language");
  document.querySelector("#page-title").textContent = t({ overview: "Overview", connections: "Connections", accounts: "Accounts & backup", settings: "Settings" }[document.querySelector("[data-panel]:not([hidden])")?.dataset.panel] ?? "Overview");
  document.querySelector("#toolbar-account").textContent = activeAccount ? `${nativeAccountLabel(activeAccount).slice(0, 8)}…${nativeAccountLabel(activeAccount).slice(-6)}` : t("My accounts");
  document.querySelector("#key-security-title").textContent = t(keyState.locked ? "Wallet locked" : "Wallet unlocked");
  signingShort.textContent = t(keyState.locked ? "Locked" : "Approval required");
  passwordUI.render();
  renderKeyDetail();
  receiveCodeUI.retranslate();
  paymentRecipientUI.retranslate(document.querySelector("#recipient-status").textContent);
  if (lastWalletConnectStatus) renderWalletConnect(lastWalletConnectStatus);
  if (lastBalance?.account === activeAccount) {
    document.querySelector("#balance-value").textContent = i18n.formatDecimalString(lastBalance.formatted);
    document.querySelector("#asset-balance").textContent = `${i18n.formatDecimalString(lastBalance.formatted)} YNXT`;
    document.querySelector("#balance-status").textContent = lastBalance.transferEnabled === false ? t("Legacy whole-YNXT balance verified. Ethereum transfers are not enabled on this network.") : t("YNX Testnet · Updated {time}", { time: i18n.formatTime(lastBalance.checkedAt) });
  }
  presentApproval();
});
