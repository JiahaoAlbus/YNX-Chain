const network = document.querySelector("#network");
const detail = document.querySelector("#detail");
const chain = document.querySelector("#chain");
const indicator = document.querySelector("#indicator");

function render(status) {
  indicator.className = `indicator ${status.available ? "ok" : "failed"}`;
  network.textContent = status.available ? "Connected to YNX Testnet" : "YNX Testnet unavailable";
  chain.textContent = status.available ? status.chainId : "Unavailable";
  detail.textContent = status.available
    ? `Verified eth_chainId ${status.chainId}. DApp permissions and signing remain separate and require visible approval.`
    : "Network verification failed. Local account creation, import and backup remain available; balances and transfers require YNX Testnet.";
}

document.querySelector("#retry").addEventListener("click", async () => render(await window.ynxWallet.status()));
window.ynxWallet.onStatus(render);
window.ynxWallet.status().then(render);

const authorization = document.querySelector("#authorization");
const authResult = document.querySelector("#auth-result");
window.ynxWallet.onAuthorizationRequest(review => {
  authorization.hidden = false;
  if (!authorization.open) authorization.showModal();
  document.querySelector("#auth-product").textContent = `Authorization request from ${review.displayName}`;
  document.querySelector("#auth-purpose").textContent = review.request.purpose;
  document.querySelector("#auth-scopes").textContent = review.request.scopes.join(", ");
  authResult.textContent = `${review.code}: no account, scope, signature or callback is granted until you approve this exact request.`;
});
window.ynxWallet.onAuthorizationError(result => {
  authorization.hidden = false;
  if (!authorization.open) authorization.showModal();
  document.querySelector("#auth-product").textContent = "Authorization request rejected";
  document.querySelector("#auth-purpose").textContent = "The link did not contain a valid frozen Wallet Auth request.";
  document.querySelector("#auth-scopes").textContent = "None";
  authResult.textContent = `${result.code}: callbackEmitted=false; authorityGranted=false`;
});

async function act(action) {
  const result = await window.ynxWallet.authorizationAction(action);
  const diagnostic = result.underlyingCode ? `; underlyingCode=${result.underlyingCode}; failureClass=${result.failureClass ?? "Error"}; failureCategory=${result.failureCategory ?? "UNCLASSIFIED"}` : "";
  authResult.textContent = `${result.code}: callbackEmitted=${result.callbackEmitted}; callbackReceivedProved=${result.callbackReceivedProved ?? false}; authorityGranted=${result.authorityGranted}; productSessionCreated=${result.productSessionCreated ?? false}${diagnostic}`;
  if (action === "reject" || result.callbackEmitted) { authorization.close(); authorization.hidden = true; }
}

document.querySelector("#reject-auth").addEventListener("click", () => act("reject"));
document.querySelector("#approve-auth").addEventListener("click", () => act("approve"));

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
  accountTitle.textContent = "Secure Testnet account ready";
  accountDetail.textContent = `${status.account} · ${status.ynxAccount} · OS-encrypted local custody`;
  accountShort.textContent = `${status.account.slice(0, 8)}…${status.account.slice(-6)}`;
  signingShort.textContent = "Approval required";
  createAccount.hidden = true;
  addAccount.hidden = false;
  accountList.replaceChildren();
  for (const item of status.accounts ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.account = item.account;
    button.textContent = item.account === status.account ? `${item.account} · active` : `Switch to ${item.account}`;
    button.disabled = item.account === status.account;
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
  createAccount.disabled = false;
  if (!result.ok) accountDetail.textContent = `${result.error.code}: ${result.error.message}`;
  else renderAccount(result);
});
addAccount.addEventListener("click", async () => {
  addAccount.disabled = true;
  const result = await window.ynxWallet.addAccount();
  addAccount.disabled = false;
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
  walletConnectTitle.textContent = startupFailed ? "WalletConnect startup failed" : status?.relayConnected ? "WalletConnect relay connected" : status?.started ? "WalletConnect SDK ready — relay not proved" : status?.configured ? "WalletConnect startup failed" : "WalletConnect not configured";
  walletConnectDetail.textContent = status?.relayConnected && !startupFailed
    ? `${status.activeSessionCount} active session(s). Every connection and signing request requires visible approval.`
    : `${status?.code ?? "WALLETCONNECT_UNAVAILABLE"}: no relay, session or account success is claimed.`;
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
window.ynxWallet.onWalletConnectSessionChanged(() => refreshWalletConnectSessions());
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

let activeProposal = null;
const proposalPanel = document.querySelector("#walletconnect-proposal");
window.ynxWallet.onWalletConnectProposal(proposal => {
  activeProposal = proposal;
  proposalPanel.hidden = false;
  if (!proposalPanel.open) proposalPanel.showModal();
  document.querySelector("#proposal-name").textContent = `${proposal.name} requests a connection`;
  document.querySelector("#proposal-origin").textContent = proposal.url ?? "The DApp did not provide an origin.";
});
async function proposalAction(action) {
  if (!activeProposal) return;
  const result = await window.ynxWallet.walletConnectProposalAction(activeProposal.id, action);
  walletConnectDetail.textContent = result.ok ? (action === "approve" ? "Session approved for the selected account." : "Session rejected.") : `${result.error.code}: ${result.error.message}`;
  if (result.ok) { activeProposal = null; proposalPanel.close(); proposalPanel.hidden = true; await refreshWalletConnectSessions(); }
}
document.querySelector("#reject-proposal").addEventListener("click", () => proposalAction("reject"));
document.querySelector("#approve-proposal").addEventListener("click", () => proposalAction("approve"));

let activeProviderRequest = null;
const providerPanel = document.querySelector("#provider-request");
window.ynxWallet.onProviderRequest(request => {
  activeProviderRequest = request;
  providerPanel.hidden = false;
  if (!providerPanel.open) providerPanel.showModal();
  document.querySelector("#provider-title").textContent = request.review.title;
  document.querySelector("#provider-origin").textContent = request.origin;
  document.querySelector("#provider-detail").textContent = JSON.stringify(request.review, null, 2);
});
window.ynxWallet.onProviderRequestExpired(event => {
  if (activeProviderRequest?.id !== event.id) return;
  activeProviderRequest = null;
  providerPanel.hidden = true;
  providerPanel.close();
  walletConnectDetail.textContent = `${event.code}: the DApp request expired without approval or signing.`;
});
async function providerAction(action) {
  if (!activeProviderRequest) return;
  const result = await window.ynxWallet.providerAction(activeProviderRequest.id, action);
  walletConnectDetail.textContent = result.ok ? (result.value?.status === "success" ? "Request response delivered." : "Request rejected.") : `${result.error.code}: ${result.error.message}`;
  activeProviderRequest = null;
  providerPanel.hidden = true;
  providerPanel.close();
}
document.querySelector("#reject-provider").addEventListener("click", () => providerAction("reject"));
document.querySelector("#approve-provider").addEventListener("click", () => providerAction("approve"));

let activeAccount = null;
let transferReview = null;
let balanceRevision = 0;
const errorText = result => result?.error?.message ?? "The wallet is unavailable. Try again shortly.";
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
    const result = await window.ynxWallet.importAccount({ kind, value, password });
    output.textContent = result.ok ? "Account imported. Save a backup and keep it safe." : errorText(result);
    if (result.ok) renderAccount(result);
  } catch (error) { output.textContent = error.message ?? "Unable to import the account."; }
  finally { value = null; password = null; document.querySelector("#import-file").value = ""; button.disabled = false; }
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
  finally { password = null; button.disabled = false; }
});
document.querySelector("#transfer-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.querySelector("#prepare-transfer"), output = document.querySelector("#transfer-result");
  button.disabled = true; transferReview = null; document.querySelector("#transfer-review").hidden = true;
  output.textContent = "Checking recipient, balance and network fee…";
  try {
    const result = await window.ynxWallet.prepareTransfer({ to: document.querySelector("#transfer-to").value.trim(), amount: document.querySelector("#transfer-amount").value.trim() });
    if (!result.ok) { output.textContent = errorText(result); return; }
    if (result.value.account !== activeAccount) { output.textContent = "Account changed. Review again."; return; }
    transferReview = result.value;
    const summary = document.querySelector("#transfer-summary"); summary.replaceChildren();
    for (const [label, value] of [["From", transferReview.account], ["To", transferReview.to], ["Amount", `${transferReview.amount} YNXT`], ["Maximum fee", `${transferReview.maximumFee} YNXT`], ["Maximum total", `${transferReview.total} YNXT`], ["Network", "YNX Testnet · 6423"]]) {
      const term = document.createElement("dt"), description = document.createElement("dd"); term.textContent = label; description.textContent = value; summary.append(term, description);
    }
    document.querySelector("#transfer-review").hidden = false;
    document.querySelector("#send-sheet").close();
    document.querySelector("#transfer-review").showModal();
    output.textContent = "Review the details below. Nothing has been signed or sent.";
  } catch { output.textContent = "Unable to prepare the transfer. Check the network and try again."; }
  finally { button.disabled = false; }
});
async function actOnTransfer(action) {
  if (!transferReview) return;
  const id = transferReview.id; transferReview = null;
  const output = document.querySelector("#transfer-result");
  document.querySelector("#confirm-transfer").disabled = true;
  output.textContent = action === "approve" ? "Submitting the approved transfer…" : "Cancelling…";
  try {
    const result = await window.ynxWallet.transferAction(id, action);
    output.textContent = result.ok ? (result.value.rejected ? "Transfer cancelled. Nothing was signed or sent." : `Submitted: ${result.value.hash}. Network confirmation is pending.`) : errorText(result);
    if (result.ok && !result.value.rejected) void refreshAssets();
  } catch { output.textContent = "The response was interrupted. Check the network before trying another transfer."; }
  finally { document.querySelector("#transfer-review").close(); document.querySelector("#transfer-review").hidden = true; document.querySelector("#confirm-transfer").disabled = false; document.querySelector("#send-sheet").showModal(); }
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
