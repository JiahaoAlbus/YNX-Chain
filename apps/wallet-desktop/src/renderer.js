import { ApprovalReviewQueue } from "./approval-review-queue.mjs";
import { formatApprovalReview } from "./approval-review-display.mjs";

let keyState = { locked: true, unlockAvailable: false, authenticating: false };
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
      document.querySelector("#connection-result").textContent = action === "approve" ? `Returning to ${item.review.displayName}. The app will verify your sign-in.` : `Connection to ${item.review.displayName} declined.`;
    } else {
      authResult.textContent = authorizationErrorText(result);
      const code = result.underlyingCode ?? result.code;
      if (code === "CANONICAL_CALLBACK_LAUNCH_FAILED" || result.code === "CANONICAL_CALLBACK_LAUNCH_FAILED") authorizationChoices.set(item.key, action);
      remove = ["ACCOUNT_CHANGED", "SESSION_EXPIRED", "NO_PENDING_AUTHORIZATION", "AUTHORIZATION_REVIEW_MISMATCH"].includes(code);
    }
  } catch { authResult.textContent = "The response was interrupted. Try returning to the app again."; }
  finally { if (remove) authorizationChoices.delete(item.key); approvalQueue.finish(item.key, { remove }); }
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
    document.querySelector("#auth-expiry").textContent = `Valid until ${new Date(review.expiresAt).toLocaleTimeString()}`;
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
    document.querySelector("#proposal-account").textContent = review.account ?? activeAccount ?? "Create an account first";
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
  presentApproval();
  try {
    const result = await window.ynxWallet.createAccount();
    if (result.ok) renderAccount(result);
    else authResult.textContent = "Your account could not be created. Try again or return to the app.";
  } catch { authResult.textContent = "Your account could not be created. Try again or return to the app."; }
  finally { creatingAuthorizationAccount = false; presentApproval(); }
});

const accountTitle = document.querySelector("#account-title");
const accountDetail = document.querySelector("#account-detail");
const accountShort = document.querySelector("#account-short");
const signingShort = document.querySelector("#signing-short");
const createAccount = document.querySelector("#create-account");
const addAccount = document.querySelector("#add-account");
const accountList = document.querySelector("#account-list");
function renderAccount(payload) {
  if (payload?.ok === false) { accountDetail.textContent = `${payload.error.code}: ${payload.error.message}`; return; }
  const status = payload?.ok === true ? payload.value : payload;
  const previousAccount = activeAccount;
  activeAccount = status?.account ?? null;
  document.querySelector("#assets").hidden = !status?.initialized;
  document.querySelector("#backup-section").hidden = !status?.initialized;
  if (!status?.initialized) setView("accounts");
  else if (!previousAccount) setView("overview");
  document.querySelector("#toolbar-account").textContent = activeAccount ? `${activeAccount.slice(0, 6)}…${activeAccount.slice(-4)}` : "My accounts";
  document.querySelector("#receive-address").value = activeAccount ?? "";
  transferReview = null;
  document.querySelector("#transfer-review").hidden = true;
  document.querySelector("#transfer-review").close();
  if (status?.initialized) void refreshAssets();
  if (!status?.initialized) {
    accountTitle.textContent = "No account created";
    accountShort.textContent = "Not created";
    signingShort.textContent = "Locked";
    createAccount.hidden = false;
    addAccount.hidden = true;
    accountList.replaceChildren();
    return;
  }
  accountTitle.textContent = "Your account";
  accountDetail.textContent = `${status.account} · ${status.ynxAccount}`;
  accountShort.textContent = `${status.account.slice(0, 8)}…${status.account.slice(-6)}`;
  signingShort.textContent = keyState.locked ? "Locked" : "Approval required";
  createAccount.hidden = true;
  addAccount.hidden = false;
  accountList.replaceChildren();
  for (const item of status.accounts ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.account = item.account;
    button.textContent = item.account === status.account ? `${item.account} · active` : `Switch to ${item.account}`;
    button.disabled = keyState.locked || item.account === status.account;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await window.ynxWallet.selectAccount(item.account);
      if (!result.ok) accountDetail.textContent = `${result.error.code}: ${result.error.message}`;
      else renderAccount(result);
    });
    accountList.append(button);
  }
}
createAccount.addEventListener("click", async () => {
  createAccount.disabled = true;
  const result = await window.ynxWallet.createAccount();
  createAccount.disabled = keyState.locked;
  if (!result.ok) accountDetail.textContent = `${result.error.code}: ${result.error.message}`;
  else renderAccount(result);
});
addAccount.addEventListener("click", async () => {
  addAccount.disabled = true;
  const result = await window.ynxWallet.addAccount();
  addAccount.disabled = keyState.locked;
  if (!result.ok) accountDetail.textContent = `${result.error.code}: ${result.error.message}`;
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
function renderWalletConnect(payload) {
  const status = payload?.ok === true ? payload.value : payload;
  const startupFailed = status?.configured && status?.code && status.code !== "WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED";
  walletConnectTitle.textContent = startupFailed ? "WalletConnect unavailable" : status?.relayConnected ? "Ready to connect an app" : status?.started ? "Connecting to WalletConnect…" : status?.configured ? "WalletConnect unavailable" : "Cross-device connections are coming";
  walletConnectDetail.textContent = status?.relayConnected && !startupFailed
    ? `${status.activeSessionCount} connected app${status.activeSessionCount === 1 ? "" : "s"}. You review every signature and transaction.`
    : status?.configured ? "The connection service is unavailable. Your wallet and accounts remain accessible." : "WalletConnect is not enabled in this build. You can still connect directly from supported YNX apps.";
  pairButton.disabled = !status?.started || startupFailed;
}
async function refreshWalletConnectSessions() {
  const response = await window.ynxWallet.walletConnectSessions();
  const sessions = response?.ok ? response.value : [];
  sessionsPanel.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.textContent = "No active WalletConnect sessions.";
    sessionsPanel.append(empty);
    return;
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = `${session.name} · ${session.origin}`;
    const disconnect = document.createElement("button");
    disconnect.type = "button";
    disconnect.textContent = "Disconnect and revoke";
    disconnect.addEventListener("click", async () => {
      disconnect.disabled = true;
      const result = await window.ynxWallet.walletConnectDisconnect(session.topic);
      walletConnectDetail.textContent = result.ok ? "Session disconnected and local account permission revoked." : `${result.error.code}: ${result.error.message}`;
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
    document.querySelector("#connection-result").textContent = "Your account changed. Connect again from the app to share the new account.";
  }
  void refreshWalletConnectSessions();
});
window.ynxWallet.walletConnectStatus().then(payload => { renderWalletConnect(payload); return refreshWalletConnectSessions(); });
pairButton.addEventListener("click", async () => {
  const uri = walletConnectURI.value.trim();
  pairButton.disabled = true;
  const result = await window.ynxWallet.walletConnectPair(uri);
  if (!result.ok) walletConnectDetail.textContent = `${result.error.code}: ${result.error.message}`;
  else walletConnectDetail.textContent = "Pairing request submitted. Waiting for a DApp proposal.";
  const status = await window.ynxWallet.walletConnectStatus();
  pairButton.disabled = !(status?.ok ? status.value.started : status?.started);
});
walletConnectQR.addEventListener("change", async () => {
  const file = walletConnectQR.files?.[0];
  walletConnectQR.value = "";
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
    walletConnectQRStatus.textContent = "INVALID_QR_IMAGE: choose a PNG, JPEG or WebP image up to 10 MB.";
    return;
  }
  try {
    const result = await window.ynxWallet.walletConnectDecodeQR({ mimeType: file.type, bytes: await file.arrayBuffer() });
    if (!result.ok) { walletConnectQRStatus.textContent = `${result.error.code}: ${result.error.message}`; return; }
    walletConnectURI.value = result.value.uri;
    walletConnectQRStatus.textContent = "WalletConnect v2 URI decoded locally. Review it, then pair the DApp.";
  } catch {
    walletConnectQRStatus.textContent = "QR_DECODE_FAILED: no usable WalletConnect QR code was found.";
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
    walletConnectDetail.textContent = result.ok ? (action === "approve" ? "App connected to the selected account." : "Connection declined.") : errorText(result);
    remove = result.ok || ["PROPOSAL_NOT_FOUND", "PROPOSAL_EXPIRED", "ACCOUNT_CHANGED"].includes(result.error?.code);
    if (result.ok) await refreshWalletConnectSessions();
  } catch { walletConnectDetail.textContent = "The app did not receive your response. Check the connection and try again."; }
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
  finally { approvalQueue.finish(item.key); }
}
document.querySelector("#reject-provider").addEventListener("click", () => providerAction("reject"));
document.querySelector("#approve-provider").addEventListener("click", () => providerAction("approve"));

let activeAccount = null;
let transferReview = null;
let transferInFlight = false;
let balanceRevision = 0;
const errorText = result => result?.error?.outcomeUnknown ? `${result.error.message}${result.error.transactionHash ? ` Transaction hash: ${result.error.transactionHash}.` : ""}` : result?.error?.message ?? "The wallet is unavailable. Try again shortly.";
async function refreshAssets() {
  const revision = ++balanceRevision;
  document.querySelector("#balance-value").textContent = "—";
  document.querySelector("#asset-balance").textContent = "—";
  document.querySelector("#balance-status").textContent = "Checking YNX Testnet…";
  try {
    const result = await window.ynxWallet.balance();
    if (revision !== balanceRevision) return;
    if (!result.ok) { document.querySelector("#balance-status").textContent = errorText(result); return; }
    if (result.value.account !== activeAccount) return;
    document.querySelector("#balance-value").textContent = result.value.formatted;
    document.querySelector("#asset-balance").textContent = `${result.value.formatted} YNXT`;
    document.querySelector("#balance-status").textContent = `YNX Testnet · Updated ${new Date(result.value.checkedAt).toLocaleTimeString()}`;
  } catch { if (revision === balanceRevision) document.querySelector("#balance-status").textContent = "Balance unavailable. Try refreshing."; }
}
document.querySelector("#refresh-balance").addEventListener("click", refreshAssets);
document.querySelector("#copy-address").addEventListener("click", async () => {
  if (!activeAccount) return;
  try { await navigator.clipboard.writeText(activeAccount); document.querySelector("#receive-status").textContent = "Address copied."; }
  catch { document.querySelector("#receive-address").select(); document.querySelector("#receive-status").textContent = "Select and copy the address above."; }
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
  output.textContent = "Importing and protecting the account…";
  try {
    if (kind === "encrypted-json") {
      const file = document.querySelector("#import-file").files?.[0];
      if (!file || file.size > 100_000) throw new Error("Choose an encrypted JSON backup smaller than 100 KB.");
      value = await file.text();
    }
    if (keyState.locked || keyState.revision !== revision) return;
    const result = await window.ynxWallet.importAccount({ kind, value, password });
    output.textContent = result.ok ? "Account imported. Save a backup and keep it safe." : errorText(result);
    if (result.ok) renderAccount(result);
  } catch (error) { output.textContent = error.message ?? "Unable to import the account."; }
  finally { value = null; password = null; if (keyState.revision === revision) document.querySelector("#import-file").value = ""; button.disabled = keyState.locked; }
});
document.querySelector("#backup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const passwordField = document.querySelector("#backup-password"), confirmField = document.querySelector("#backup-confirm");
  const output = document.querySelector("#backup-result"), button = document.querySelector("#save-backup");
  if (passwordField.value !== confirmField.value) { output.textContent = "The backup passwords do not match."; return; }
  let password = passwordField.value; passwordField.value = ""; confirmField.value = ""; button.disabled = true;
  output.textContent = "Encrypting your backup…";
  try { const result = await window.ynxWallet.saveBackup(password); output.textContent = result.ok ? (result.value.saved ? "Encrypted backup saved. Keep its password separately." : "Backup was not saved.") : errorText(result); }
  catch { output.textContent = "Unable to save the backup."; }
  finally { password = null; button.disabled = keyState.locked; }
});
document.querySelector("#transfer-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.querySelector("#prepare-transfer"), output = document.querySelector("#transfer-result");
  const revision = keyState.revision;
  button.disabled = true; transferReview = null; document.querySelector("#transfer-review").hidden = true;
  output.textContent = "Checking recipient, balance and network fee…";
  try {
    const result = await window.ynxWallet.prepareTransfer({ to: document.querySelector("#transfer-to").value.trim(), amount: document.querySelector("#transfer-amount").value.trim() });
    if (keyState.locked || keyState.revision !== revision) return;
    if (!result.ok) { output.textContent = errorText(result); return; }
    if (result.value.account !== activeAccount) { output.textContent = "Account changed. Review again."; return; }
    transferReview = result.value;
    const summary = document.querySelector("#transfer-summary"); summary.replaceChildren();
    for (const [label, value] of [["From", transferReview.account], ["To", transferReview.to], ["Amount", `${transferReview.amount} YNXT`], ["Maximum fee", `${transferReview.maximumFee} YNXT`], ["Maximum total", `${transferReview.total} YNXT`], ["Network", "YNX Testnet · 6423"]]) {
      const term = document.createElement("dt"), description = document.createElement("dd"); term.textContent = label; description.textContent = value; summary.append(term, description);
    }
    document.querySelector("#transfer-transaction").textContent = formatApprovalReview(transferReview.transaction ?? {});
    document.querySelector("#transfer-review").hidden = false;
    document.querySelector("#send-sheet").close();
    document.querySelector("#transfer-review").showModal();
    output.textContent = "Review the details below. Nothing has been signed or sent.";
  } catch { output.textContent = "Unable to prepare the transfer. Check the network and try again."; }
  finally { button.disabled = keyState.locked; }
});
async function actOnTransfer(action) {
  if (transferInFlight) { if (action === "reject") await window.ynxWallet.lock(); return; }
  if (!transferReview) return;
  transferInFlight = true;
  const revision = keyState.revision;
  const id = transferReview.id; transferReview = null;
  const output = document.querySelector("#transfer-result");
  document.querySelector("#confirm-transfer").disabled = true;
  output.textContent = action === "approve" ? "Submitting the approved transfer…" : "Cancelling…";
  try {
    const result = await window.ynxWallet.transferAction(id, action);
    output.textContent = result.ok ? (result.value.rejected ? "Transfer cancelled. Nothing was signed or sent." : `Submitted: ${result.value.hash}. Network confirmation is pending.`) : errorText(result);
    if (result.ok && !result.value.rejected) void refreshAssets();
  } catch { output.textContent = "The response was interrupted. Check the network before trying another transfer."; }
  finally {
    transferInFlight = false;
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
  if (!["overview", "connections", "accounts"].includes(name)) return;
  if (name === "overview" && !activeAccount) name = "accounts";
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== name;
  for (const button of document.querySelectorAll("nav [data-view]")) {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  document.querySelector("#page-title").textContent = { overview: "Overview", connections: "Connections", accounts: "Accounts & backup" }[name];
  window.scrollTo({ top: 0 });
}
for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => setView(button.dataset.view));
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("close", () => queueMicrotask(presentApproval));
document.querySelector("#open-send").addEventListener("click", () => { document.querySelector("#send-sheet").showModal(); document.querySelector("#transfer-to").focus(); });
document.querySelector("#open-receive").addEventListener("click", () => { document.querySelector("#receive-sheet").showModal(); document.querySelector("#copy-address").focus(); });
document.querySelector("#transfer-review").addEventListener("cancel", event => { event.preventDefault(); void actOnTransfer("reject"); });
authorization.addEventListener("cancel", event => { event.preventDefault(); void act("reject"); });
proposalPanel.addEventListener("cancel", event => { event.preventDefault(); void proposalAction("reject"); });
providerPanel.addEventListener("cancel", event => { event.preventDefault(); void providerAction("reject"); });
document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && ["1", "2", "3"].includes(event.key) && !document.querySelector("dialog[open]")) {
    event.preventDefault(); setView(["overview", "connections", "accounts"][Number(event.key) - 1]);
  }
});

function renderKeyState(state) {
  const invalidated = state.locked && (!keyState.locked || state.revision !== keyState.revision);
  keyState = state;
  const title = document.querySelector("#key-security-title"), detail = document.querySelector("#key-security-detail"), unlock = document.querySelector("#unlock-wallet");
  title.textContent = state.locked ? "Wallet locked" : "Wallet unlocked";
  detail.textContent = !state.unlockAvailable ? "Secure system unlock is unavailable here. Keys stay locked; your public accounts remain visible." : state.locked ? "Use system Touch ID to unlock. Leaving Wallet, locking the screen or switching accounts cancels pending key operations." : "Review each request before approving. Wallet locks when it loses focus.";
  unlock.hidden = !state.locked;
  unlock.disabled = !state.unlockAvailable || state.authenticating;
  unlock.textContent = state.authenticating ? "Confirm system Touch ID…" : "Unlock with system Touch ID";
  document.querySelector("#lock-wallet").disabled = state.locked && !state.authenticating;
  signingShort.textContent = state.locked ? "Locked" : "Approval required";
  for (const element of document.querySelectorAll("#create-account,#add-account,#open-send,#prepare-transfer,#confirm-transfer,#account-list button,#import-form input,#import-form select,#import-form button,#backup-form input,#backup-form button")) element.disabled = state.locked || element.dataset.account === activeAccount;
  if (state.locked) {
    if (invalidated) { approvalQueue.clear(); authorizationChoices.clear(); transferReview = null; }
    for (const field of document.querySelectorAll('input[type="password"],input[type="file"]')) field.value = "";
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  } else presentApproval();
}
window.ynxWallet.onSecurityState?.(renderKeyState);
if (window.ynxWallet.securityStatus) window.ynxWallet.securityStatus().then(renderKeyState);
else renderKeyState(keyState);
document.querySelector("#unlock-wallet").addEventListener("click", async () => {
  const output = document.querySelector("#unlock-result"); output.textContent = "";
  try { const result = await window.ynxWallet.unlock(); if (!result.ok) output.textContent = errorText(result); }
  catch { output.textContent = "System unlock did not complete. Wallet remains locked."; }
});
document.querySelector("#lock-wallet").addEventListener("click", () => window.ynxWallet.lock());
