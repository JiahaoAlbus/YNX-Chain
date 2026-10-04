import { WALLET_LINKS, attachWalletLifecycle, connectWallet, disconnectWallet, discoverProviders, ensureYNXChain, restoreWallet, revokeWallet, selectProvider, switchWalletAccount, socialTransports } from "./wallet-provider.js";

const byId = (id) => document.getElementById(id);
const state = { provider: null, account: null, chainId: null, wallet: null, detach: () => {}, revoking: false, revocation: null };
// UI intent ordering; provider sessions remain owned by the Wallet transport.
let connectionAttempt = 0;
const walletLabel=wallet=>({ynx:"YNX Wallet",hosted:"YNX Web Wallet",mobile:"YNX Mobile Wallet",metamask:"MetaMask"})[wallet]??"Wallet";
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
  byId("connect-wallet").textContent = `${walletLabel(result.wallet)} · ${shortAccount(result.account)}`;
  byId("connected-account").textContent = result.account;
  byId("connected-wallet-name").textContent = walletLabel(result.wallet);
  byId("connected-logo").src = result.wallet !== "metamask" ? "./assets/ynx-logo.png" : "./assets/metamask.svg";
  byId("connected-logo").alt = `${walletLabel(result.wallet)} logo`;
  byId("connected-chain").textContent = `${result.chainId === "0x1917" ? "YNX Testnet" : "Wrong network"} · ${result.chainId}`;
  byId("connected-panel").hidden = false;
  sessionStorage.setItem("ynx.social.standard-wallet.kind", result.wallet);
  state.detach = attachWalletLifecycle(result.provider, {
    onAccountsChanged(accounts) {
      connectionAttempt++;
      if (!accounts.length) {
        const operation = state.revocation;
        // Only the exact pending revoke may absorb its empty-account event.
        // The public epoch still advances to invalidate private consumers.
        if (state.revoking && operation?.provider === result.provider &&
            operation.attempt === connectionAttempt - 1) operation.attempt = connectionAttempt;
        if (!state.revoking) disconnect("Wallet permission was removed.");
        return;
      }
      state.account = accounts[0];
      byId("connected-account").textContent = accounts[0];
      byId("connect-wallet").textContent = `${walletLabel(state.wallet)} · ${shortAccount(accounts[0])}`;
      showStatus("accountsChanged received. The approved account was updated.", "success");
    },
    onChainChanged(chainId) {
      connectionAttempt++;
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
  state.revocation = null;
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

let selectedWallet=null;
function resetChooser(){for(const button of byId("wallet-dialog").querySelectorAll(".wallet-option")){button.disabled=false;button.removeAttribute("aria-busy");}selectedWallet=null;byId("wallet-list").hidden=false;byId("wallet-list").style.display="";byId("wallet-selected-step").hidden=true;byId("mobile-pair-panel").hidden=true;byId("retry-wallet-connection").hidden=true;}
async function connect(wallet, button) {
  selectedWallet=wallet;byId("wallet-list").hidden=true;byId("wallet-list").style.display="none";byId("wallet-selected-step").hidden=false;byId("retry-wallet-connection").hidden=true;byId("selected-wallet-name").textContent=({mobile:"YNX Mobile Wallet",hosted:"YNX Web Wallet",ynx:"YNX Wallet extension",metamask:"MetaMask"})[wallet];
  if(socialTransports(window).busy)void socialTransports(window).cancel().catch(()=>{});
  const attempt = ++connectionAttempt;
  sessionStorage.removeItem(disconnectedKey);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  byId("install-wallet").hidden = true;
  byId("retry-wallet-discovery").hidden = true;
  try {
    const result = await connectWallet(wallet, window, () => attempt === connectionAttempt, next=>{if(attempt===connectionAttempt)renderTransport(next)});
    if (attempt !== connectionAttempt) return;
    if (result.ok) setConnected(result);
    else {byId("retry-wallet-connection").hidden=false;
    if (result.code === "YNX_WALLET_NOT_FOUND" || result.code === "METAMASK_NOT_FOUND") notFound(wallet);
    else if (result.code === "AMBIGUOUS_WALLET_PROVIDER") ambiguous(wallet);
    else showStatus(`${result.code}: Select one wallet provider and try again.`, "warning");}
  } catch (error) {
    if (attempt !== connectionAttempt) return;
    byId("retry-wallet-connection").hidden=false;
    const rejected = Number(error?.code) === 4001;
    showStatus(rejected ? "Connection request was rejected. No Social session was created." : "Wallet connection failed. No account or Social session was saved.", "error");
  } finally {
    if(attempt===connectionAttempt){button.disabled = false;button.removeAttribute("aria-busy");}
  }
}

byId("connect-wallet").addEventListener("click", () => {
  if (state.provider) {
    byId("connected-panel").hidden = false;
    byId("connected-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    byId("wallet-switch-account").focus();
    return;
  }
  resetChooser();byId("wallet-dialog").showModal();
  sessionStorage.removeItem(disconnectedKey);
});
byId("hero-connect-wallet").addEventListener("click", () => {
  sessionStorage.removeItem(disconnectedKey);
  resetChooser();byId("wallet-dialog").showModal();
});
function cancelSelection(close=true){const token=++connectionAttempt;for(const button of byId("wallet-dialog").querySelectorAll(".wallet-option")){button.disabled=false;button.removeAttribute("aria-busy");}void socialTransports(window).cancel().catch(()=>{if(token===connectionAttempt)showStatus("The connection was cancelled. Network cleanup is not yet confirmed.","warning")});resetChooser();if(close)byId("wallet-dialog").close();}
byId("close-wallet-dialog").addEventListener("click",()=>cancelSelection());
byId("wallet-dialog").addEventListener("cancel",()=>cancelSelection());
byId("cancel-wallet-pair").addEventListener("click",()=>cancelSelection());
byId("back-wallet-selection").addEventListener("click",()=>{cancelSelection(false);showStatus("Choose a wallet to continue.")});
byId("retry-wallet-connection").addEventListener("click",()=>{if(selectedWallet)void connect(selectedWallet,byId("connect-"+selectedWallet));});
byId("connect-hosted").addEventListener("click",event=>void connect("hosted",event.currentTarget));
byId("connect-mobile").addEventListener("click",event=>void connect("mobile",event.currentTarget));
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
  const provider = state.provider;
  const operation = { provider, attempt: connectionAttempt };
  const current = () => state.provider === provider && state.revocation === operation && operation.attempt === connectionAttempt;
  state.revocation = operation;
  state.revoking = true;
  try {
    const outcome = await revokeWallet(provider);
    if (!current()) return;
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
    if (!current()) return;
    const code = Number(error?.code);
    showStatus(code === 4001 ? "Permission revocation was rejected." : [4200, -32601].includes(code) ? "This wallet cannot revoke permission here. Remove this site's access in your wallet, or use Disconnect to disconnect locally." : "Permission revocation failed. Check site permissions in your wallet.", "error");
  } finally {
    if (state.revocation === operation) { state.revoking = false; state.revocation = null; }
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
  for (const wallet of [preferred].filter((value) => ["ynx","metamask","hosted","mobile"].includes(value))) {
    try {
      const result = await restoreWallet(wallet, window, () => attempt === connectionAttempt && sessionStorage.getItem(disconnectedKey) !== "true");
      if (attempt !== connectionAttempt || sessionStorage.getItem(disconnectedKey) === "true") return;
      if(result.selectionPending){state.wallet=wallet;showStatus("Your Web Wallet selection is remembered. Your next request opens Wallet to verify its permission again.");return;}
      if (result.ok) { setConnected(result); showStatus("Standard wallet connection restored after refresh.", "success"); return; }
    } catch { if (attempt !== connectionAttempt) return; }
  }
}

function renderPrivateServiceDegraded(){byId("service-status").textContent="Browse as a guest, or sign in to use your private Social workspace.";byId("service-status").dataset.serviceState="NOT_CHECKED";byId("private-session-state").textContent="Connecting a wallet does not grant access to contacts or messages. Approve Social separately below.";}
function renderTransport(next){const panel=byId("mobile-pair-panel");panel.hidden=next.status!=="pairing";byId("wallet-pair-qr").removeAttribute("src");byId("wallet-pair-open").removeAttribute("href");if(next.status==="pairing"){if(next.qrDataURL)byId("wallet-pair-qr").src=next.qrDataURL;if(next.deeplink)byId("wallet-pair-open").href=next.deeplink;showStatus("Scan with YNX Wallet, or open it on this phone. Review the connection in Wallet.");}else if(next.status==="transport-unavailable")showStatus("Wallet window closed. Your Social identity stays signed in; the next request opens Wallet for review.");else if(next.status==="opening")showStatus("Opening the secure wallet connection…");else if(next.status==="cancel-unconfirmed")showStatus("Connection cancelled. Network cleanup is not yet confirmed.","warning");else if(next.status==="failed"){byId("retry-wallet-connection").hidden=false;showStatus(({YNX_PAIR_RELAY_TIMEOUT:"The wallet network could not be reached. Try another wallet or retry when your network is available.",YNX_PAIR_CONFIGURATION_INVALID:"Mobile connection is not enabled for Social in this Wallet release.",HOSTED_ORIGIN_UNREGISTERED:"Web Wallet is not enabled for Social in this Wallet release."})[next.code]??"Connection could not be completed. Retry or choose another wallet.","warning");}}
window.YNXSocialWallet=Object.freeze({reserve:()=>{if(state.wallet==='hosted'&&!state.provider){const intent=connectionAttempt,kind=state.wallet,transport=socialTransports(window),expectedRevision=transport.revision+1;const current=()=>intent===connectionAttempt&&state.wallet===kind&&!state.provider&&transport.kind===kind&&transport.revision===expectedRevision;return connectWallet('hosted',window,current,next=>{if(current())renderTransport(next)}).then(result=>{if(!current())throw new Error('SOCIAL_CONTEXT_CHANGED');if(!result.ok)throw new Error(result.code);setConnected(result)});}return socialTransports(window).reserve();},requestProductSessionV2:route=>{if(!state.provider||state.wallet==='metamask')throw new Error('WALLET_NOT_CONNECTED');return state.provider.request({method:'ynx_requestProductSessionV2',params:[route]});},getIntentRevision:()=>connectionAttempt,getRevision:()=>connectionAttempt+socialTransports(window).revision,available:()=>!!state.provider&&state.wallet!=="metamask",hasSelection:()=>!!state.wallet&&state.wallet!=='metamask',getAccount:()=>state.account,accountMatches:account=>socialTransports(window).accountMatches(account,state.account)});
addEventListener('pagehide',()=>socialTransports(window).suspend());

renderPrivateServiceDegraded();
void restoreConnection();
