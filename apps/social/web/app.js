import { WALLET_LINKS, attachWalletLifecycle, connectWallet, discoverProviders, restoreWallet, revokeWallet, selectProvider, switchWalletAccount } from "./wallet-provider.js";

const byId = (id) => document.getElementById(id);
const state = { provider: null, account: null, chainId: null, wallet: null, detach: () => {} };

function shortAccount(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function showStatus(message, tone = "neutral") {
  const region = byId("wallet-status");
  region.textContent = message;
  region.dataset.tone = tone;
}

function setConnected(result) {
  state.detach();
  state.provider = result.provider;
  state.account = result.account;
  state.chainId = result.chainId;
  state.wallet = result.wallet;
  byId("wallet-dialog").close();
  byId("connect-wallet").textContent = `${result.wallet === "ynx" ? "YNX Wallet" : "MetaMask"} · ${shortAccount(result.account)}`;
  byId("connected-account").textContent = result.account;
  byId("connected-wallet-name").textContent = result.wallet === "ynx" ? "YNX Wallet" : "MetaMask";
  byId("connected-logo").src = result.wallet === "ynx" ? "./assets/ynx-wallet.svg" : "./assets/metamask.svg";
  byId("connected-logo").alt = `${result.wallet === "ynx" ? "YNX Wallet" : "MetaMask"} logo`;
  byId("connected-chain").textContent = `YNX Testnet · ${result.chainId}`;
  byId("connected-panel").hidden = false;
  sessionStorage.setItem("ynx.social.standard-wallet.kind", result.wallet);
  state.detach = attachWalletLifecycle(result.provider, {
    onAccountsChanged(accounts) {
      if (!accounts.length) return disconnect("Wallet permission was removed.");
      state.account = accounts[0];
      byId("connected-account").textContent = accounts[0];
      byId("connect-wallet").textContent = `${state.wallet === "ynx" ? "YNX Wallet" : "MetaMask"} · ${shortAccount(accounts[0])}`;
      showStatus("accountsChanged received. The approved account was updated.", "success");
    },
    onChainChanged(chainId) {
      state.chainId = chainId;
      byId("connected-chain").textContent = `${chainId === "0x1917" ? "YNX Testnet" : "Wrong network"} · ${chainId}`;
      showStatus(chainId === "0x1917" ? "chainChanged confirmed YNX Testnet." : `chainChanged to ${chainId}. Switch back to 0x1917.`, chainId === "0x1917" ? "success" : "warning");
    },
    onDisconnect() { disconnect("Wallet disconnected by provider."); },
  });
  renderPrivateServiceDegraded();
  showStatus("Standard wallet connection is active. Private Social features remain locked until a separate YNX Product Session is approved.", "success");
}

function disconnect(message = "Wallet disconnected locally.") {
  state.detach();
  state.provider = null;
  state.account = null;
  state.chainId = null;
  state.wallet = null;
  state.detach = () => {};
  sessionStorage.removeItem("ynx.social.standard-wallet.kind");
  byId("connect-wallet").textContent = "Connect wallet";
  byId("connected-panel").hidden = true;
  showStatus(message, "neutral");
}

function notFound(wallet) {
  const label = wallet === "ynx" ? "YNX Wallet" : "MetaMask";
  const link = wallet === "ynx" ? WALLET_LINKS.ynx : WALLET_LINKS.metamask;
  showStatus(`${label} was not detected in this browser. Install it, then retry from this page.`, "warning");
  const action = byId("install-wallet");
  action.href = link;
  action.textContent = `Install ${label}`;
  action.hidden = false;
  byId("retry-wallet-discovery").textContent = `Retry ${label} detection`;
  byId("retry-wallet-discovery").hidden = false;
  state.wallet = wallet;
}

function ambiguous(wallet) {
  const label = wallet === "ynx" ? "YNX Wallet" : "MetaMask";
  showStatus(`Multiple ${label} providers were detected. Keep one active, then retry detection. No account request was sent.`, "warning");
  const action = byId("install-wallet");
  action.href = WALLET_LINKS[wallet];
  action.textContent = `Install or update ${label}`;
  action.hidden = false;
  byId("retry-wallet-discovery").textContent = `Retry ${label} detection`;
  byId("retry-wallet-discovery").hidden = false;
  state.wallet = wallet;
}

async function refreshWalletGuidance() {
  const wallet = state.wallet;
  if (wallet !== "ynx" && wallet !== "metamask") return;
  const label = wallet === "ynx" ? "YNX Wallet" : "MetaMask";
  const retry = byId("retry-wallet-discovery");
  retry.disabled = true;
  retry.setAttribute("aria-busy", "true");
  try {
    const selected = selectProvider(await discoverProviders(window), wallet);
    if (selected.ok) {
      showStatus(`${label} is now detected. Choose ${label} again only when you are ready to approve account access.`, "success");
      byId("install-wallet").hidden = true;
      retry.hidden = true;
    } else if (selected.code === "AMBIGUOUS_WALLET_PROVIDER") {
      ambiguous(wallet);
    } else {
      notFound(wallet);
    }
  } finally {
    retry.disabled = false;
    retry.removeAttribute("aria-busy");
  }
}

async function connect(wallet, button) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  byId("install-wallet").hidden = true;
  byId("retry-wallet-discovery").hidden = true;
  try {
    const result = await connectWallet(wallet);
    if (result.ok) setConnected(result);
    else if (result.code === "YNX_WALLET_NOT_FOUND" || result.code === "METAMASK_NOT_FOUND") notFound(wallet);
    else if (result.code === "AMBIGUOUS_WALLET_PROVIDER") ambiguous(wallet);
    else showStatus(`${result.code}: Select one wallet provider and try again.`, "warning");
  } catch (error) {
    const rejected = Number(error?.code) === 4001;
    showStatus(rejected ? "Connection request was rejected. No Social session was created." : "Wallet connection failed. No account or Social session was saved.", "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

byId("connect-wallet").addEventListener("click", () => {
  if (state.provider) {
    byId("connected-panel").hidden = false;
    byId("connected-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    byId("wallet-switch-account").focus();
    return;
  }
  byId("wallet-dialog").showModal();
});
byId("hero-connect-wallet").addEventListener("click", () => byId("wallet-dialog").showModal());
byId("close-wallet-dialog").addEventListener("click", () => byId("wallet-dialog").close());
byId("connect-ynx").addEventListener("click", (event) => void connect("ynx", event.currentTarget));
byId("connect-metamask").addEventListener("click", (event) => void connect("metamask", event.currentTarget));
byId("retry-wallet-discovery").addEventListener("click", () => void refreshWalletGuidance());
byId("wallet-disconnect").addEventListener("click", () => disconnect("Wallet disconnected by user."));
byId("wallet-revoke").addEventListener("click", async () => {
  if (!state.provider) return;
  try { await revokeWallet(state.provider); disconnect("Wallet permission revoked."); }
  catch (error) { showStatus(Number(error?.code) === 4001 ? "Permission revocation was rejected." : "Permission revocation failed.", "error"); }
});
byId("wallet-switch-account").addEventListener("click", async () => {
  if (!state.provider) return;
  try {
    const changed = await switchWalletAccount(state.provider);
    setConnected({ provider: state.provider, wallet: state.wallet, account: changed.account, chainId: changed.chainId });
    showStatus("Account switch approved and YNX Testnet reconfirmed.", "success");
  } catch (error) { showStatus(Number(error?.code) === 4001 ? "Account switch was rejected. Existing connection was kept." : "Account switch failed. Existing connection was kept.", "error"); }
});

async function restoreConnection() {
  const preferred = sessionStorage.getItem("ynx.social.standard-wallet.kind");
  for (const wallet of [preferred, "ynx", "metamask"].filter((value, index, values) => value && values.indexOf(value) === index)) {
    try {
      const result = await restoreWallet(wallet);
      if (result.ok) { setConnected(result); showStatus("Standard wallet connection restored after refresh.", "success"); return; }
    } catch {}
  }
}

function renderPrivateServiceDegraded() {
  const status = byId("service-status");
  status.textContent = "Private Social service degraded — guest preview is still available";
  status.dataset.tone = "warning";
  status.dataset.serviceState = "PRIVATE_SERVICE_DEGRADED";
  byId("private-session-state").textContent = state.account ? "Private Social service degraded. Standard wallet connection remains active." : "Private Social service degraded. Wallet connection remains independently available.";
}

renderPrivateServiceDegraded();
void restoreConnection();
