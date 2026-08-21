const network = document.querySelector("#network");
const detail = document.querySelector("#detail");
const chain = document.querySelector("#chain");
const indicator = document.querySelector("#indicator");

function render(status) {
  indicator.className = `indicator ${status.available ? "ok" : "failed"}`;
  network.textContent = status.available ? "Connected to YNX Testnet" : "YNX Testnet unavailable";
  chain.textContent = status.available ? status.chainId : "Unavailable";
  detail.textContent = status.available
    ? `Verified eth_chainId ${status.chainId}. Signing remains locked until real local key custody is implemented.`
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
