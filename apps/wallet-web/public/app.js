import {LOCALES, catalog, isRTL} from "./i18n.js";
import {PREFERENCES_KEY,acceptPreferenceUpdate,loadPreferences,savePreferences} from "./preferences.js";
import {
  METAMASK_DOWNLOAD_URL, WALLET_DOWNLOAD_MATRIX, YNX_DOWNLOAD_URL, addYNXChain, connectWallet, createExtensionProvider, discoverWallets,
  extensionWalletAvailability, forgetSession, rememberSession, restoreTestnetSession, sendTransaction,
  invalidatesConnectedSession, resolveRememberedWallet, signMessage, subscribeProviderLifecycle,
  switchToYNXChain, verifyTestnetRpc, walletActionGates, walletDiscoveryPresentation,
} from "./provider.js";

const app = document.querySelector("#app");
const isExtension = location.protocol === "chrome-extension:" || location.protocol === "moz-extension:";
const preview = new URLSearchParams(location.search);
const requestedLocale = preview.get("lang");
const requestedTheme = preview.get("theme");
const requestedText = preview.get("text");
const loadedPreferences=loadPreferences(localStorage);
const state = {
  locale: LOCALES.some(([locale]) => locale === requestedLocale) ? requestedLocale : loadedPreferences.record.locale,
  theme: ["light", "dark"].includes(requestedTheme) ? requestedTheme : loadedPreferences.record.theme,
  preferences: loadedPreferences.record,
  provider: null, wallet: null, account: null, chainId: null, rpcVerified: false, unsubscribeProvider: null,
};

function text(key) { return catalog(state.locale)[key] || key; }
function options() { return LOCALES.map(([value, label]) => `<option value="${value}" ${value === state.locale ? "selected" : ""}>${label}</option>`).join(""); }
function escape(value) { const node = document.createElement("span"); node.textContent = String(value); return node.innerHTML; }
function unavailablePlatforms(){return Object.values(WALLET_DOWNLOAD_MATRIX).filter(item=>item.hosted!==true).map(item=>`<button type="button" disabled aria-disabled="true" data-permanent-disabled="true">${escape(item.label)} · ${text("unavailable")}</button>`).join("")}

function render() {
  document.documentElement.lang = state.locale;
  document.documentElement.dir = isRTL(state.locale) ? "rtl" : "ltr";
  document.documentElement.dataset.theme = state.theme === "system" ? "" : state.theme;
  document.documentElement.dataset.text = requestedText === "large" ? "large" : "";
  app.innerHTML = `<div class="shell">
    <header><div class="brand"><img src="./ynx-logo.png" alt="YNX"><p class="eyebrow">${text("eyebrow")}</p></div>
      <div class="controls"><label><span class="hidden">${text("language")}</span><select id="locale" aria-label="${text("language")}">${options()}</select></label><button id="theme" type="button">${state.theme === "dark" ? text("light") : text("dark")}</button></div></header>
    <section aria-labelledby="title"><h1 id="title">${text("title")}</h1><p class="intro">${text("intro")}</p></section>
    <section class="card" aria-label="${text("walletConnection")}"><div id="detected" class="eyebrow">${text("unavailable")}</div>
      <div class="wallets"><button id="ynx" class="primary hidden" type="button">${text("connectYNX")}</button><a id="download" href="${YNX_DOWNLOAD_URL}" class="secondary" rel="noreferrer" aria-describedby="download-meta">Android · ${text("download")}</a><a id="metamask" href="${METAMASK_DOWNLOAD_URL}" class="secondary" rel="noreferrer">${text("metamask")}</a></div>
      <p id="download-meta" class="download-meta mono">${escape(WALLET_DOWNLOAD_MATRIX.android.label)} · ${WALLET_DOWNLOAD_MATRIX.android.bytes.toLocaleString("en-US")} Bytes · SHA-256 ${escape(WALLET_DOWNLOAD_MATRIX.android.sha256)} · ${escape(WALLET_DOWNLOAD_MATRIX.android.signingClass)} · productionSigned=false</p>
      <details id="platforms" class="platforms"><summary>${text("download")}</summary><div class="platform-grid">${unavailablePlatforms()}</div></details>
      <div class="status" id="status" role="status" aria-live="polite"><strong>${text("status")}:</strong> ${state.account ? `${text("connected")} · <span class="mono">${escape(state.account)}</span>` : text("disconnected")}</div>
      <p class="risk">${text("rpcCheck")} ${text("testnet")}</p>
    </section>
    <section class="card" id="actions" aria-label="${text("walletActions")}">
      <div class="actions"><button id="add" type="button">${text("add")}</button><button id="switch" type="button">${text("switch")}</button></div>
      <label class="label" for="message">${text("message")}</label><textarea id="message" maxlength="4096" autocomplete="off"></textarea><button id="sign" class="primary" type="button">${text("sign")}</button>
      <label class="label" for="recipient">${text("recipient")}</label><input id="recipient" inputmode="text" autocomplete="off">
      <label class="label" for="value">${text("value")}</label><input id="value" value="0x0" inputmode="text" autocomplete="off">
      <label class="label" for="data">${text("data")}</label><input id="data" value="0x" inputmode="text" autocomplete="off">
      <button id="send" class="primary" type="button">${text("send")}</button>
    </section><footer>YNX Testnet · Chain 6423 · 0x1917</footer></div>`;
  bind();
  applyActionGates();
}

function setStatus(message, kind = "info") { const node = document.querySelector("#status"); node.dataset.kind = kind; node.innerHTML = `<strong>${text("status")}:</strong> ${escape(message)}`; }
function localizedError(error) { const code=typeof error?.code==="string"||typeof error?.code==="number"?String(error.code):"REQUEST_FAILED"; return `${code}: ${text("requestFailed")}`; }
async function act(work, success) {
  setStatus(text("working"));
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  try { const result = await work(); setStatus(success(result)); return result; }
  catch (error) {
    if (["RPC_UNAVAILABLE","WRONG_NETWORK","INVALID_RPC_RESPONSE"].includes(error?.code)) state.rpcVerified = false;
    if (invalidatesConnectedSession(error)) invalidateConnectedState();
    setStatus(localizedError(error), "error");
    return null;
  }
  finally { for (const button of document.querySelectorAll("button")) button.disabled = button.dataset.permanentDisabled === "true"; applyActionGates(); }
}

function applyActionGates() {
  const gates = walletActionGates(state.provider, state.account, state.chainId, state.rpcVerified);
  const mapping = {add:gates.canAddChain,switch:gates.canSwitchChain,sign:gates.canSign,send:gates.canSendTransaction};
  for (const [id, enabled] of Object.entries(mapping)) {
    const button = document.querySelector(`#${id}`);
    if (!button) continue;
    button.disabled = !enabled;
    button.setAttribute("aria-disabled", String(!enabled));
  }
}

function invalidateConnectedState() {
  state.account = null;
  state.chainId = null;
  forgetSession();
  applyActionGates();
}

function clearConnectedSession() {
  invalidateConnectedState();
  setStatus(text("disconnected"), "error");
}

function bindProviderLifecycle(provider) {
  state.unsubscribeProvider?.();
  state.unsubscribeProvider = subscribeProviderLifecycle(provider, {
    accountsChanged(accounts) {
      if (!state.account || !accounts.includes(state.account.toLowerCase())) clearConnectedSession();
    },
    chainChanged(chainId) {
      if (chainId !== "0x1917") clearConnectedSession();
      else { state.chainId = chainId; applyActionGates(); }
    },
    disconnect() { clearConnectedSession(); },
  });
}

function selectProvider(wallet) {
  if (state.wallet && state.wallet !== wallet) clearConnectedSession();
  state.wallet = wallet;
  state.provider = isExtension ? createExtensionProvider(wallet) : state.providers?.[wallet];
  if (!state.provider) throw Object.assign(new Error(text("unavailable")), {code: "WALLET_NOT_FOUND"});
  bindProviderLifecycle(state.provider);
  applyActionGates();
  return state.provider;
}

async function connect(wallet) {
  const provider = selectProvider(wallet);
  const session = await act(() => connectWallet(provider), (result) => `${text("connected")} · ${result.account}`);
  if (!session) return;
  state.account = session.account; state.chainId = session.chainId; rememberSession(session, wallet); render(); await detect();
}

function bind() {
  document.querySelector("#locale").addEventListener("change", (event) => {state.locale = event.target.value; state.preferences=savePreferences(localStorage,state.preferences,{locale:state.locale}); render(); detect();});
  document.querySelector("#theme").addEventListener("click", () => {state.theme = state.theme === "dark" ? "light" : "dark"; state.preferences=savePreferences(localStorage,state.preferences,{theme:state.theme}); render(); detect();});
  document.querySelector("#ynx").addEventListener("click", () => connect("ynx"));
  document.querySelector("#metamask").addEventListener("click", (event) => {
    if (!state.providers?.metamask) return;
    event.preventDefault();
    connect("metamask");
  });
  document.querySelector("#add").addEventListener("click", () => act(() => addYNXChain(state.provider), () => text("testnet")));
  document.querySelector("#switch").addEventListener("click", () => act(() => switchToYNXChain(state.provider), () => text("connected")));
  document.querySelector("#sign").addEventListener("click", () => act(() => signMessage(state.provider, state.account, document.querySelector("#message").value), (value) => `${text("signature")}: ${value}`));
  document.querySelector("#send").addEventListener("click", () => act(() => sendTransaction(state.provider, {from: state.account, to: document.querySelector("#recipient").value.trim(), value: document.querySelector("#value").value.trim(), data: document.querySelector("#data").value.trim()}), (value) => `${text("txHash")}: ${value}`));
}

function presentAvailability(availability) {
  const presentation = walletDiscoveryPresentation(availability);
  document.querySelector("#ynx").classList.toggle("hidden", !presentation.showYNXConnect);
  document.querySelector("#download").classList.toggle("hidden", !presentation.showYNXDownload);
  document.querySelector("#download-meta").classList.toggle("hidden", !presentation.showYNXDownload);
  document.querySelector("#platforms").classList.toggle("hidden", !presentation.showYNXDownload);
  document.querySelector("#metamask").classList.toggle("hidden", !presentation.showMetaMaskChoice);
  document.querySelector("#metamask").dataset.route = presentation.metaMaskChoice;
  document.querySelector("#detected").textContent = presentation.ynxPresent ? text("detected") : text("unavailable");
}

async function detect() {
  state.providers = Object.freeze({ynx:false,metamask:false}); state.provider = null; state.wallet = null; state.account = null; state.chainId = null; state.rpcVerified = false; applyActionGates(); presentAvailability(state.providers);
  let availability;
  try { availability = isExtension ? await extensionWalletAvailability() : await discoverWallets(); }
  catch (error) { forgetSession(); throw error; }
  state.providers = availability; presentAvailability(availability);
  try { await verifyTestnetRpc(); state.rpcVerified = true; }
  catch (error) { state.rpcVerified = false; applyActionGates(); throw error; }
  applyActionGates();
  const wallet = resolveRememberedWallet(availability);
  if (wallet) {
    const provider = selectProvider(wallet);
    const restored = await restoreTestnetSession(provider);
    if (restored) { state.account = restored.account; state.chainId = restored.chainId; applyActionGates(); setStatus(`${text("connected")} · ${restored.account}`); }
  }
}

const discoveryError=(error)=>localizedError(error);
render(); detect().then(()=>{if(loadedPreferences.status==="rejected")setStatus(text("preferencesRejected"),"error")}).catch((error) => setStatus(discoveryError(error), "error"));
addEventListener("storage",(event)=>{if(event.key!==PREFERENCES_KEY)return;try{const next=acceptPreferenceUpdate(state.preferences,event.newValue);state.preferences=next;state.locale=next.locale;state.theme=next.theme;render();detect().catch((error)=>setStatus(discoveryError(error),"error"))}catch(error){setStatus(`${error?.code||"PREFERENCES_REJECTED"}: ${text("preferencesRejected")}`,"error")}});
if (!isExtension && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", {type:"module"}).catch(() => {});
