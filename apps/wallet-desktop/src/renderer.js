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
    : "RPC verification failed closed. Account, balance, transaction and signing controls remain unavailable.";
}

document.querySelector("#retry").addEventListener("click", async () => render(await window.ynxWallet.status()));
window.ynxWallet.onStatus(render);
window.ynxWallet.status().then(render);

const authorization = document.querySelector("#authorization");
const authResult = document.querySelector("#auth-result");
window.ynxWallet.onAuthorizationRequest(review => {
  authorization.hidden = false;
  document.querySelector("#auth-product").textContent = `Authorization request from ${review.displayName}`;
  document.querySelector("#auth-purpose").textContent = review.request.purpose;
  document.querySelector("#auth-scopes").textContent = review.request.scopes.join(", ");
  authResult.textContent = `${review.code}: no account, scope, signature or callback is granted until you approve this exact request.`;
});
window.ynxWallet.onAuthorizationError(result => {
  authorization.hidden = false;
  document.querySelector("#auth-product").textContent = "Authorization request rejected";
  document.querySelector("#auth-purpose").textContent = "The link did not contain a valid frozen Wallet Auth request.";
  document.querySelector("#auth-scopes").textContent = "None";
  authResult.textContent = `${result.code}: callbackEmitted=false; authorityGranted=false`;
});

async function act(action) {
  const result = await window.ynxWallet.authorizationAction(action);
  authResult.textContent = `${result.code}: callbackEmitted=${result.callbackEmitted}; callbackReceivedProved=${result.callbackReceivedProved ?? false}; authorityGranted=${result.authorityGranted}; productSessionCreated=${result.productSessionCreated ?? false}`;
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
  const status = payload?.ok === true ? payload.value : payload;
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
  walletConnectTitle.textContent = status?.relayConnected ? "WalletConnect relay connected" : status?.started ? "WalletConnect SDK ready — relay not proved" : status?.configured ? "WalletConnect startup failed" : "WalletConnect not configured";
  walletConnectDetail.textContent = status?.relayConnected
    ? `${status.activeSessionCount} active session(s). Every connection and signing request requires visible approval.`
    : `${status?.code ?? "WALLETCONNECT_UNAVAILABLE"}: no relay, session or account success is claimed.`;
  pairButton.disabled = !status?.started;
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
  if (typeof BarcodeDetector !== "function" || !(await BarcodeDetector.getSupportedFormats()).includes("qr_code")) {
    walletConnectQRStatus.textContent = "QR_DECODER_UNAVAILABLE: this build cannot decode QR images.";
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    let results;
    try { results = await new BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap); }
    finally { bitmap.close(); }
    const values = [...new Set(results.map(result => result.rawValue?.trim()).filter(Boolean))];
    if (values.length !== 1 || !/^wc:[0-9a-f-]+@2\?/.test(values[0]) || values[0].length > 8192) {
      walletConnectQRStatus.textContent = "INVALID_WALLETCONNECT_QR: exactly one WalletConnect v2 URI is required.";
      return;
    }
    walletConnectURI.value = values[0];
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
  document.querySelector("#proposal-name").textContent = `${proposal.name} requests a connection`;
  document.querySelector("#proposal-origin").textContent = proposal.url ?? "The DApp did not provide an origin.";
});
async function proposalAction(action) {
  if (!activeProposal) return;
  const result = await window.ynxWallet.walletConnectProposalAction(activeProposal.id, action);
  walletConnectDetail.textContent = result.ok ? (action === "approve" ? "Session approved for the selected account." : "Session rejected.") : `${result.error.code}: ${result.error.message}`;
  if (result.ok) { activeProposal = null; proposalPanel.hidden = true; await refreshWalletConnectSessions(); }
}
document.querySelector("#reject-proposal").addEventListener("click", () => proposalAction("reject"));
document.querySelector("#approve-proposal").addEventListener("click", () => proposalAction("approve"));

let activeProviderRequest = null;
const providerPanel = document.querySelector("#provider-request");
window.ynxWallet.onProviderRequest(request => {
  activeProviderRequest = request;
  providerPanel.hidden = false;
  document.querySelector("#provider-title").textContent = request.review.title;
  document.querySelector("#provider-origin").textContent = request.origin;
  document.querySelector("#provider-detail").textContent = JSON.stringify(request.review, null, 2);
});
window.ynxWallet.onProviderRequestExpired(event => {
  if (activeProviderRequest?.id !== event.id) return;
  activeProviderRequest = null;
  providerPanel.hidden = true;
  walletConnectDetail.textContent = `${event.code}: the DApp request expired without approval or signing.`;
});
async function providerAction(action) {
  if (!activeProviderRequest) return;
  const result = await window.ynxWallet.providerAction(activeProviderRequest.id, action);
  walletConnectDetail.textContent = result.ok ? (result.value?.status === "success" ? "Request response delivered." : "Request rejected.") : `${result.error.code}: ${result.error.message}`;
  activeProviderRequest = null;
  providerPanel.hidden = true;
}
document.querySelector("#reject-provider").addEventListener("click", () => providerAction("reject"));
document.querySelector("#approve-provider").addEventListener("click", () => providerAction("approve"));
