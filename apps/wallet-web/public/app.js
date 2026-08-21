import {LOCALES, catalog, isRTL} from "./i18n.js";
import {PREFERENCES_KEY,acceptPreferenceUpdate,loadPreferences,savePreferences} from "./preferences.js";
import {
  isMobileWalletBrowser, mobileWalletPresentation,
} from "./mobile-wallet-routing.js";
import {CORE_WALLET_AUTH_BINDING} from "./core-auth-binding.js";
import {createWalletWebCompanionLifecycle} from "./wallet-web-companion-lifecycle.js";
import {forgetConnectedDapp, providerChooserState, readConnectedDapp, rememberConnectedDapp} from "./connected-dapps.js";
import {
  METAMASK_DOWNLOAD_URL, WALLET_DOWNLOAD_MATRIX, YNX_DOWNLOAD_URL, addYNXChain, connectWallet, createExtensionProvider, discoverWallets,
  extensionWalletAvailability, forgetSession, rememberSession, restoreTestnetSession, sendTransaction,
  invalidatesConnectedSession, resolveRememberedWallet, signMessage, subscribeProviderLifecycle,
  providerAvailabilityState, switchToYNXChain, walletActionGates, walletDiscoveryPresentation,
} from "./provider.js";

const app = document.querySelector("#app");
const isExtension = location.protocol === "chrome-extension:" || location.protocol === "moz-extension:";
const mobileBrowser = !isExtension && isMobileWalletBrowser(navigator);
const preview = new URLSearchParams(location.search);
const companionLifecycle=createWalletWebCompanionLifecycle({binding:CORE_WALLET_AUTH_BINDING});
const requestedLocale = preview.get("lang");
const requestedTheme = preview.get("theme");
const requestedText = preview.get("text");
const loadedPreferences=loadPreferences(localStorage);
const state = {
  locale: LOCALES.some(([locale]) => locale === requestedLocale) ? requestedLocale : loadedPreferences.record.locale,
  theme: ["light", "dark"].includes(requestedTheme) ? requestedTheme : loadedPreferences.record.theme,
  preferences: loadedPreferences.record,
  provider: null, wallet: null, account: null, chainId: null, rpcVerified: false, unsubscribeProvider: null, status: null,
  providers: Object.freeze({ynx:false,metamask:false}), chooser: null, connectedDapp: null,
};

function text(key) { return catalog(state.locale)[key] || key; }
function options() { return LOCALES.map(([value, label]) => `<option value="${value}" ${value === state.locale ? "selected" : ""}>${label}</option>`).join(""); }
function escape(value) { const node = document.createElement("span"); node.textContent = String(value); return node.innerHTML; }
function unavailablePlatforms(){return Object.values(WALLET_DOWNLOAD_MATRIX).filter(item=>item.hosted!==true).map(item=>`<button type="button" disabled aria-disabled="true" data-permanent-disabled="true">${escape(item.label)} · ${text("unavailable")}</button>`).join("")}
function statusView(status = state.status) {
  if (!status) return {kind:"info",message:state.account ? `${text("connected")} · ${state.account}` : text("disconnected")};
  if (status.type === "working") return {kind:"info",message:text("working")};
  if (status.type === "error") return {kind:"error",message:`${status.code}: ${text(status.key || "requestFailed")}`};
  if (status.type === "key") return {kind:status.kind || "info",message:text(status.key)};
  if (status.type === "connected") return {kind:"info",message:`${text("connected")} · ${status.account}`};
  if (status.type === "label") return {kind:"info",message:`${text(status.labelKey)}: ${status.value}`};
  return {kind:"error",message:`REQUEST_FAILED: ${text("requestFailed")}`};
}
function statusHtml() { const view=statusView(); return `<strong>${text("status")}:</strong> ${escape(view.message)}`; }
function connectedDappsHtml() {
  const dapp=state.connectedDapp;
  if (!dapp) return "";
  return `<section class="card" id="connected-dapps" aria-label="${text("connectedDapps")}"><h2>${text("connectedDapps")}</h2><p class="download-meta mono">${escape(dapp.origin)} · ${escape(dapp.wallet)} · ${escape(dapp.account)} · ${escape(dapp.chainId)}</p><button id="disconnect-dapp" type="button" class="secondary">${text("disconnectThisSite")}</button></section>`;
}

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
      <div class="status" id="status" role="status" aria-live="polite" data-kind="${statusView().kind}">${statusHtml()}</div>
      <p class="risk">${text("rpcCheck")} ${text("testnet")}</p>
    </section>
    ${connectedDappsHtml()}
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

function setStatus(status) { state.status=Object.freeze(status); const node = document.querySelector("#status"); const view=statusView(); node.dataset.kind = view.kind; node.innerHTML = statusHtml(); }
function errorStatusKey(code) {
  return Object.freeze({
    NO_PROVIDER:"noProvider", EXTENSION_LOCKED:"extensionLocked", SITE_ACCESS_DENIED:"siteAccessDenied", AMBIGUOUS_PROVIDER:"ambiguousProvider",
    WRONG_NETWORK:"wrongChain", RPC_UNAVAILABLE:"rpcUnavailable", INVALID_RPC_RESPONSE:"invalidRpcResponse",
  })[code] || "requestFailed";
}
function localizedError(error) { const code=typeof error?.code==="string"||typeof error?.code==="number"?String(error.code):"REQUEST_FAILED"; return Object.freeze({type:"error",code,key:errorStatusKey(code)}); }
async function act(work, success) {
  setStatus({type:"working"});
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  try { const result = await work(); setStatus(success(result)); return result; }
  catch (error) {
    if (["RPC_UNAVAILABLE","WRONG_NETWORK","INVALID_RPC_RESPONSE"].includes(error?.code)) state.rpcVerified = false;
    if (invalidatesConnectedSession(error)) invalidateConnectedState();
    setStatus(localizedError(error));
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
  state.connectedDapp = null;
  forgetSession();
  forgetConnectedDapp();
  applyActionGates();
}

function clearConnectedSession() {
  invalidateConnectedState();
  setStatus({type:"key",key:"disconnected",kind:"error"});
}

function bindProviderLifecycle(provider) {
  state.unsubscribeProvider?.();
  state.unsubscribeProvider = subscribeProviderLifecycle(provider, {
    accountsChanged(accounts) {
      const next=accounts[0];
      if (!state.account || !next) return clearConnectedSession();
      if (next !== state.account.toLowerCase() && state.chainId === "0x1917") {
        state.account=next;
        rememberSession({account:next,chainId:"0x1917"},state.wallet);
        state.connectedDapp=rememberConnectedDapp({origin:location.origin,account:next,chainId:"0x1917",wallet:state.wallet});
        setStatus({type:"connected",account:next});
        render();
        return;
      }
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
  state.chooser=providerChooserState(state.providers,wallet,state.connectedDapp?.wallet || null);
  applyActionGates();
  return state.provider;
}

async function connect(wallet) {
  const provider = selectProvider(wallet);
  const session = await act(() => connectWallet(provider,{verifyRpc:false}), (result) => ({type:"connected",account:result.account}));
  if (!session) return;
  state.account = session.account; state.chainId = session.chainId; state.rpcVerified = true; rememberSession(session, wallet);
  state.connectedDapp=rememberConnectedDapp({origin:location.origin,...session,wallet});
  state.chooser=providerChooserState(state.providers,wallet,wallet);
  render(); await detect();
}

function disconnectCurrentDapp() {
  // EIP-1193 does not define a universal permission-revoke API.  This only
  // clears this Companion's local connection view; it never claims to revoke
  // the selected wallet's account permission.
  state.unsubscribeProvider?.(); state.unsubscribeProvider=null;
  state.provider=null; state.wallet=null; state.rpcVerified=false;
  invalidateConnectedState();
  state.chooser=providerChooserState(state.providers,null,null);
  setStatus({type:"key",key:"disconnected",kind:"info"});
  render();
}

function bind() {
  document.querySelector("#locale").addEventListener("change", (event) => {state.locale = event.target.value; state.preferences=savePreferences(localStorage,state.preferences,{locale:state.locale}); render(); detect().catch((error)=>setStatus(localizedError(error)));});
  document.querySelector("#theme").addEventListener("click", () => {state.theme = state.theme === "dark" ? "light" : "dark"; state.preferences=savePreferences(localStorage,state.preferences,{theme:state.theme}); render(); detect();});
  document.querySelector("#ynx").addEventListener("click", async () => {
    if (state.providers?.ynx) return connect("ynx");
    const result=await companionLifecycle.begin();
    setStatus(result.status === "connecting" ? {type:"working"} : {type:"error",code:String(result.code||result.status)});
  });
  document.querySelector("#metamask").addEventListener("click", (event) => {
    if (state.providers?.metamask) { event.preventDefault(); return connect("metamask"); }
  });
  document.querySelector("#add").addEventListener("click", () => act(async () => { const chainId=await addYNXChain(state.provider,{verifyRpc:false}); state.chainId=chainId; state.rpcVerified=true; return chainId; }, () => ({type:"key",key:"testnet"})));
  document.querySelector("#switch").addEventListener("click", () => act(async () => { const chainId=await switchToYNXChain(state.provider,{verifyRpc:false}); state.chainId=chainId; state.rpcVerified=true; return chainId; }, () => ({type:"key",key:"connected"})));
  document.querySelector("#sign").addEventListener("click", () => act(() => signMessage(state.provider, state.account, document.querySelector("#message").value), (value) => ({type:"label",labelKey:"signature",value})));
  document.querySelector("#send").addEventListener("click", () => act(() => sendTransaction(state.provider, {from: state.account, to: document.querySelector("#recipient").value.trim(), value: document.querySelector("#value").value.trim(), data: document.querySelector("#data").value.trim()},{verifyRpc:false}), (value) => ({type:"label",labelKey:"txHash",value})));
  document.querySelector("#disconnect-dapp")?.addEventListener("click", disconnectCurrentDapp);
}

function presentAvailability(availability) {
  const presentation = walletDiscoveryPresentation(availability);
  const mobile = mobileWalletPresentation(availability, mobileBrowser, CORE_WALLET_AUTH_BINDING,companionLifecycle.publicAuthAvailable?companionLifecycle.callback:null);
  document.querySelector("#ynx").classList.toggle("hidden", mobile.ynxRoute === "hidden");
  document.querySelector("#ynx").dataset.route = mobile.ynxRoute;
  document.querySelector("#ynx").textContent = mobile.ynxRoute === "canonical-auth-unavailable" ? `${text("connectYNX")} · ${text("unavailable")}` : text("connectYNX");
  document.querySelector("#download").classList.toggle("hidden", !presentation.showYNXDownload);
  document.querySelector("#download-meta").classList.toggle("hidden", !presentation.showYNXDownload);
  document.querySelector("#platforms").classList.toggle("hidden", !presentation.showYNXDownload);
  document.querySelector("#metamask").classList.toggle("hidden", mobileBrowser ? false : !presentation.showMetaMaskChoice);
  document.querySelector("#metamask").dataset.route = mobile.metaMaskRoute;
  document.querySelector("#metamask").href = mobile.metaMaskHref || METAMASK_DOWNLOAD_URL;
  document.querySelector("#detected").textContent = presentation.ynxPresent ? text("detected") : text("unavailable");
}

async function detect() {
  const rememberedDapp=readConnectedDapp(location.origin);
  state.providers = Object.freeze({ynx:false,metamask:false}); state.provider = null; state.wallet = null; state.account = null; state.chainId = null; state.rpcVerified = false; state.connectedDapp = null; applyActionGates(); presentAvailability(state.providers);
  let availability;
  try { availability = isExtension ? await extensionWalletAvailability() : await discoverWallets(); }
  catch (error) { forgetSession(); throw error; }
  state.providers = availability; state.chooser=providerChooserState(availability,rememberedDapp?.wallet || null,null); presentAvailability(availability);
  // Discovery and RPC are independent: a missing/locked extension must never be
  // re-labelled as an RPC outage, and an RPC timeout must not erase provider state.
  const providerState = isExtension
    ? {code: availability.ynx || availability.metamask ? null : "NO_PROVIDER", providerPresent:Boolean(availability.ynx || availability.metamask), accountAuthorized:false}
    : await providerAvailabilityState(availability);
  applyActionGates();
  if (providerState.code) setStatus({type:"error",code:providerState.code,key:errorStatusKey(providerState.code)});
  const wallet = resolveRememberedWallet(availability);
  if (wallet) {
    const provider = selectProvider(wallet);
    const restored = await restoreTestnetSession(provider);
    if (restored) {
      state.account = restored.account; state.chainId = restored.chainId; state.rpcVerified=true;
      state.connectedDapp=rememberConnectedDapp({origin:location.origin,...restored,wallet});
      state.chooser=providerChooserState(availability,wallet,wallet);
      applyActionGates(); setStatus({type:"connected",account:restored.account}); render();
    }
  }
}

const discoveryError=(error)=>localizedError(error);
render(); detect().then(()=>{if(loadedPreferences.status==="rejected")setStatus({type:"key",key:"preferencesRejected",kind:"error"})}).catch((error) => setStatus(discoveryError(error)));
if(!isExtension&&`${location.origin}${location.pathname}`===companionLifecycle.callback&&location.search){
  companionLifecycle.handleReturn(location.href).then((result)=>setStatus(result.authoritative?{type:"key",key:"connected"}:{type:"error",code:String(result.code||result.status)}));
}
addEventListener("storage",(event)=>{if(event.key!==PREFERENCES_KEY)return;try{const next=acceptPreferenceUpdate(state.preferences,event.newValue);state.preferences=next;state.locale=next.locale;state.theme=next.theme;render();detect().catch((error)=>setStatus(discoveryError(error)))}catch(error){setStatus({type:"key",key:"preferencesRejected",kind:"error"})}});
if (!isExtension && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?schema=8", {type:"module",updateViaCache:"none"}).then((registration) => registration.update()).catch(() => {});
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "YNX_PWA_SHELL_UPGRADED" || event.data?.schema !== 8) return;
    const reloadKey="ynx.wallet.web.pwa.schema.8.reloaded";
    if (sessionStorage.getItem(reloadKey)==="1") return;
    sessionStorage.setItem(reloadKey,"1");
    location.reload();
  });
}
