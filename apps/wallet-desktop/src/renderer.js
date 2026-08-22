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
  authResult.textContent = `${review.code}: review is visible, but account, signing authority and callback remain unavailable.`;
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
  authResult.textContent = `${result.code}: callbackEmitted=${result.callbackEmitted}; authorityGranted=${result.authorityGranted}`;
}

document.querySelector("#reject-auth").addEventListener("click", () => act("reject"));
document.querySelector("#approve-auth").addEventListener("click", () => act("approve"));

const accountTitle = document.querySelector("#account-title");
const accountDetail = document.querySelector("#account-detail");
const accountShort = document.querySelector("#account-short");
const signingShort = document.querySelector("#signing-short");
const createAccount = document.querySelector("#create-account");
function renderAccount(payload) {
  const status = payload?.ok === true ? payload.value : payload;
  if (!status?.initialized) {
    accountTitle.textContent = "No account created";
    accountShort.textContent = "Not created";
    signingShort.textContent = "Locked";
    createAccount.hidden = false;
    return;
  }
  accountTitle.textContent = "Secure Testnet account ready";
  accountDetail.textContent = `${status.account} · ${status.ynxAccount} · OS-encrypted local custody`;
  accountShort.textContent = `${status.account.slice(0, 8)}…${status.account.slice(-6)}`;
  signingShort.textContent = "Approval required";
  createAccount.hidden = true;
}
createAccount.addEventListener("click", async () => {
  createAccount.disabled = true;
  const result = await window.ynxWallet.createAccount();
  createAccount.disabled = false;
  if (!result.ok) accountDetail.textContent = `${result.error.code}: ${result.error.message}`;
  else renderAccount(result);
});
window.ynxWallet.onAccountStatus(renderAccount);
window.ynxWallet.accountStatus().then(renderAccount);

const walletConnectTitle = document.querySelector("#walletconnect-title");
const walletConnectDetail = document.querySelector("#walletconnect-detail");
const pairButton = document.querySelector("#walletconnect-pair");
function renderWalletConnect(payload) {
  const status = payload?.ok === true ? payload.value : payload;
  walletConnectTitle.textContent = status?.connected ? "WalletConnect relay connected" : status?.configured ? "WalletConnect relay unavailable" : "WalletConnect not configured";
  walletConnectDetail.textContent = status?.connected ? "Pairing is available. Every session and signing request still requires visible approval." : `${status?.code ?? "WALLETCONNECT_UNAVAILABLE"}: no session or account success is claimed.`;
  pairButton.disabled = !status?.connected;
}
window.ynxWallet.onWalletConnectStatus(renderWalletConnect);
window.ynxWallet.walletConnectStatus().then(renderWalletConnect);
pairButton.addEventListener("click", async () => {
  const uri = document.querySelector("#walletconnect-uri").value.trim();
  pairButton.disabled = true;
  const result = await window.ynxWallet.walletConnectPair(uri);
  if (!result.ok) walletConnectDetail.textContent = `${result.error.code}: ${result.error.message}`;
  else walletConnectDetail.textContent = "Pairing request submitted. Waiting for a DApp proposal.";
  pairButton.disabled = false;
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
  if (result.ok) { activeProposal = null; proposalPanel.hidden = true; }
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
async function providerAction(action) {
  if (!activeProviderRequest) return;
  const result = await window.ynxWallet.providerAction(activeProviderRequest.id, action);
  walletConnectDetail.textContent = result.ok ? (result.value?.status === "success" ? "Request response delivered." : "Request rejected.") : `${result.error.code}: ${result.error.message}`;
  activeProviderRequest = null;
  providerPanel.hidden = true;
}
document.querySelector("#reject-provider").addEventListener("click", () => providerAction("reject"));
document.querySelector("#approve-provider").addEventListener("click", () => providerAction("approve"));
