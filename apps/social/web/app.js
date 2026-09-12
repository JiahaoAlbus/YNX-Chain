import { WALLET_LINKS, attachWalletLifecycle, connectWallet, disconnectWallet, discoverProviders, ensureYNXChain, restoreWallet, revokeWallet, selectProvider, switchWalletAccount } from "./wallet-provider.js";

const byId = (id) => document.getElementById(id);
const state = { provider: null, account: null, chainId: null, wallet: null, detach: () => {}, revoking: false };
// UI intent ordering; provider sessions remain owned by the Wallet transport.
let connectionAttempt = 0;
const disconnectedKey = "ynx.social.standard-wallet.disconnected";

function shortAccount(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function showStatus(message, tone = "neutral") {
  const region = byId("wallet-status");
  region.textContent = message;
  region.dataset.tone = tone;
  const connectedRegion = byId("connected-wallet-status");
  connectedRegion.textContent = message;
  connectedRegion.dataset.tone = tone;
}

function setConnected(result) {
  state.detach();
  if (state.provider && state.provider !== result.provider) disconnectWallet(state.provider);
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
  byId("connected-chain").textContent = `${result.chainId === "0x1917" ? "YNX Testnet" : "Wrong network"} · ${result.chainId}`;
  byId("connected-panel").hidden = false;
  sessionStorage.setItem("ynx.social.standard-wallet.kind", result.wallet);
  state.detach = attachWalletLifecycle(result.provider, {
    onAccountsChanged(accounts) {
      if (!accounts.length) { if (!state.revoking) disconnect("Wallet permission was removed."); return; }
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
    onDisconnect() { if (!state.revoking) disconnect("Wallet disconnected by provider."); },
  });
  renderPrivateServiceDegraded();
  showStatus("Standard wallet connection is active. Private Social features remain locked until a separate YNX Product Session is approved.", "success");
}

function disconnect(message = "Wallet disconnected locally.") {
  connectionAttempt += 1;
  state.detach();
  if (state.provider) disconnectWallet(state.provider);
  state.revoking = false;
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
  const attempt = ++connectionAttempt;
  sessionStorage.removeItem(disconnectedKey);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  byId("install-wallet").hidden = true;
  byId("retry-wallet-discovery").hidden = true;
  try {
    const result = await connectWallet(wallet, window, () => attempt === connectionAttempt);
    if (attempt !== connectionAttempt) return;
    if (result.ok) setConnected(result);
    else if (result.code === "YNX_WALLET_NOT_FOUND" || result.code === "METAMASK_NOT_FOUND") notFound(wallet);
    else if (result.code === "AMBIGUOUS_WALLET_PROVIDER") ambiguous(wallet);
    else showStatus(`${result.code}: Select one wallet provider and try again.`, "warning");
  } catch (error) {
    if (attempt !== connectionAttempt) return;
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
  sessionStorage.removeItem(disconnectedKey);
});
byId("hero-connect-wallet").addEventListener("click", () => {
  sessionStorage.removeItem(disconnectedKey);
  byId("wallet-dialog").showModal();
});
byId("close-wallet-dialog").addEventListener("click", () => byId("wallet-dialog").close());
byId("connect-ynx").addEventListener("click", (event) => void connect("ynx", event.currentTarget));
byId("connect-metamask").addEventListener("click", (event) => void connect("metamask", event.currentTarget));
byId("retry-wallet-discovery").addEventListener("click", () => void refreshWalletGuidance());
byId("wallet-disconnect").addEventListener("click", () => {
  sessionStorage.setItem(disconnectedKey, "true");
  disconnect("Wallet disconnected locally. Wallet permissions were not revoked.");
});
byId("wallet-switch-network").addEventListener("click", async () => {
  const provider = state.provider;
  const attempt = connectionAttempt;
  if (!provider) return;
  const button = byId("wallet-switch-network");
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const chainId = await ensureYNXChain(provider);
    if (state.provider !== provider || attempt !== connectionAttempt) return;
    state.chainId = chainId;
    byId("connected-chain").textContent = `YNX Testnet · ${chainId}`;
    showStatus("YNX Testnet confirmed by wallet readback.", "success");
  } catch (error) {
    if (state.provider !== provider || attempt !== connectionAttempt) return;
    showStatus(Number(error?.code) === 4001 ? "Network switch was rejected. Existing wallet connection was kept." : "Network switch could not be confirmed. Check the network in your wallet and retry.", "warning");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});
byId("wallet-revoke").addEventListener("click", async () => {
  if (!state.provider || state.revoking) return;
  const provider = state.provider, attempt = connectionAttempt;
  state.revoking = true;
  try {
    const outcome = await revokeWallet(provider);
    if (state.provider !== provider || attempt !== connectionAttempt) return;
    if (outcome.permissionRevoked && outcome.status === "revoked") {
      sessionStorage.setItem(disconnectedKey, "true");
      disconnect("Wallet permission revoked and empty accounts confirmed.");
    } else {
      const message = outcome.status === "rejected" ? "Permission revocation was rejected."
        : outcome.status === "unsupported" ? "This wallet cannot revoke permission here. Remove this site's access in your wallet, or disconnect locally."
        : "Wallet permission revocation was not confirmed. Check site permissions in your wallet.";
      if (outcome.locallyDisconnected) disconnect(message);
      else showStatus(message, "warning");
    }
  } catch (error) {
    if (state.provider !== provider || attempt !== connectionAttempt) return;
    const code = Number(error?.code);
    showStatus(code === 4001 ? "Permission revocation was rejected." : [4200, -32601].includes(code) ? "This wallet cannot revoke permission here. Remove this site's access in your wallet, or use Disconnect to disconnect locally." : "Permission revocation failed. Check site permissions in your wallet.", "error");
  } finally {
    state.revoking = false;
  }
});
byId("wallet-switch-account").addEventListener("click", async () => {
  if (!state.provider) return;
  const provider = state.provider, wallet = state.wallet, attempt = ++connectionAttempt;
  try {
    const changed = await switchWalletAccount(provider);
    if (attempt !== connectionAttempt || state.provider !== provider) return;
    setConnected({ provider, wallet, account: changed.account, chainId: changed.chainId });
    showStatus(changed.chainId === "0x1917" ? "Account switch approved on YNX Testnet." : "Account switch approved. Use Switch network to select YNX Testnet.", changed.chainId === "0x1917" ? "success" : "warning");
  } catch (error) {
    if (attempt !== connectionAttempt || state.provider !== provider) return;
    showStatus(Number(error?.code) === 4001 ? "Account switch was rejected. Existing connection was kept." : "Account switch failed. Existing connection was kept.", "error");
  }
});

async function restoreConnection() {
  if (sessionStorage.getItem(disconnectedKey) === "true") return;
  const attempt = connectionAttempt;
  const preferred = sessionStorage.getItem("ynx.social.standard-wallet.kind");
  for (const wallet of [preferred].filter((value) => value === "ynx" || value === "metamask")) {
    try {
      const result = await restoreWallet(wallet, window, () => attempt === connectionAttempt && sessionStorage.getItem(disconnectedKey) !== "true");
      if (attempt !== connectionAttempt || sessionStorage.getItem(disconnectedKey) === "true") return;
      if (result.ok) { setConnected(result); showStatus("Standard wallet connection restored after refresh.", "success"); return; }
    } catch { if (attempt !== connectionAttempt) return; }
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
