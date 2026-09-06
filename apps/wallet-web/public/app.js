import {LOCALES, catalog, isRTL} from "./i18n.js";
import {decimalYNXTToWei, prepareTransaction, reviewMatchesSession} from "./transaction-input.js";
import {PREFERENCES_KEY,acceptPreferenceUpdate,loadPreferences,savePreferences} from "./preferences.js";
import {
  isMobileWalletBrowser, mobileWalletPresentation,
} from "./mobile-wallet-routing.js";
import {CORE_WALLET_AUTH_BINDING} from "./core-auth-binding.js";
import {createWalletWebCompanionLifecycle} from "./wallet-web-companion-lifecycle.js";
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_CONNECT_STATUS} from "./standard-wallet-connect-state.js";
import {PWA_CACHE,cleanPwaNavigationUrl,obsoletePwaCaches,upgradeNavigationUrl} from "./service-worker-policy.js";
import {
  METAMASK_DOWNLOAD_URL, WALLET_DOWNLOAD_MATRIX, YNX_DOWNLOAD_URL, addYNXChain, connectStandardWallet, createExtensionProvider, discoverWallets,
  extensionWalletAvailability, forgetSession, rememberSession, restoreTestnetSession, sendTransaction,
  invalidatesConnectedSession, resolveRememberedWallet, signMessage, subscribeProviderLifecycle,
  switchToYNXChain, walletActionGates, walletDiscoveryPresentation,
} from "./provider.js";

const app = document.querySelector("#app");
const isExtension = location.protocol === "chrome-extension:" || location.protocol === "moz-extension:";
const initialPwaNavigationUrl=location.href;
function cleanPwaRecoveryMarker(){if(isExtension)return;const cleanUrl=cleanPwaNavigationUrl(location.href);if(cleanUrl)history.replaceState(history.state,"",cleanUrl)}
cleanPwaRecoveryMarker();
const mobileBrowser = !isExtension && isMobileWalletBrowser(navigator);
const preview = new URLSearchParams(location.search);
const companionLifecycle=createWalletWebCompanionLifecycle({binding:CORE_WALLET_AUTH_BINDING});
const requestedLocale = preview.get("lang");
const requestedTheme = preview.get("theme");
const requestedText = preview.get("text");
const loadedPreferences=loadPreferences(localStorage);
const initialConnectState=reduceStandardWalletConnectState(createStandardWalletConnectState(),{type:"OPEN_CHOOSER"});
const state = {
  locale: LOCALES.some(([locale]) => locale === requestedLocale) ? requestedLocale : loadedPreferences.record.locale,
  theme: ["light", "dark"].includes(requestedTheme) ? requestedTheme : loadedPreferences.record.theme,
  preferences: loadedPreferences.record,
  provider: null, wallet: null, account: null, chainId: null, rpcVerified: false, unsubscribeProvider: null,
  providers:Object.freeze({ynx:false,metamask:false}),connectState:initialConnectState,errorCode:null,
  form:{recipient:"",amount:"",value:"0x0",data:"0x",message:"",useHex:false},review:null,epoch:0,busy:false,discoveryReady:false,
};

function darkTheme() { return state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); }
function text(key) { return catalog(state.locale)[key] || key; }
function options() { return LOCALES.map(([value, label]) => `<option value="${value}" ${value === state.locale ? "selected" : ""}>${label}</option>`).join(""); }
function escape(value) { const node = document.createElement("span"); node.textContent = String(value); return node.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function unavailablePlatforms(){return Object.values(WALLET_DOWNLOAD_MATRIX).filter(item=>item.hosted!==true).map(item=>`<button type="button" disabled aria-disabled="true" data-permanent-disabled="true">${escape(item.label)} · ${text("otherDownloads")}</button>`).join("")}
function statusContent(){if(state.errorCode)return`${escape(state.errorCode)}: ${text("requestFailed")}`;return state.account?`${text("connected")} · <span class="mono">${escape(state.account)}</span>`:text("disconnected")}

function render() {
  state.review = null;
  state.epoch += 1;
  const connectionDetails = Boolean(state.account) && state.connectState.chooserOpen && state.connectState.chooserMode === "connection-details";
  const providerChooserVisible = state.connectState.chooserOpen && !connectionDetails;
  document.documentElement.lang = state.locale;
  document.documentElement.dir = isRTL(state.locale) ? "rtl" : "ltr";
  document.documentElement.dataset.theme = state.theme === "system" ? "" : state.theme;
  document.documentElement.dataset.text = requestedText === "large" ? "large" : "";
  app.innerHTML = `<div class="shell">
    <header><div class="brand"><img src="./ynx-logo.png" alt="YNX"><span>Wallet <span class="brand-subtitle">Companion</span></span></div>
      <div class="controls"><label><span class="sr-only">${text("language")}</span><select id="locale" aria-label="${text("language")}">${options()}</select></label><button id="theme" type="button">${darkTheme() ? text("light") : text("dark")}</button></div></header>
    <section class="intro-section" aria-labelledby="title"><p class="network-label">YNX Testnet <span>6423</span></p><h1 id="title">${state.account?text("readyTitle"):text("title")}</h1><p class="intro">${text("intro")}</p></section>
    <div class="workspace ${state.account?"is-connected":""}">
    <section class="card connection-card" aria-label="${text("walletConnection")}">
      <div class="section-heading"><h2>${text("walletConnection")}</h2><button id="wallet-connect-trigger" type="button" aria-controls="wallet-chooser connection-controls" aria-expanded="${state.connectState.chooserOpen}">${state.account?text("connected"):text("chooseWallet")}</button></div>
      <p id="detected" class="availability">${text("unavailable")}</p>
      ${state.account?`<dl class="connection-facts"><div><dt>${text("wallet")}</dt><dd>${state.wallet==="ynx"?"YNX Wallet":"MetaMask"}</dd></div><div><dt>${text("network")}</dt><dd>${state.chainId==="0x1917"?"YNX Testnet":""} <bdi class="mono">${escape(state.chainId||"")}</bdi></dd></div><div><dt>${text("connected")}</dt><dd class="address">${escape(state.account)}</dd></div></dl>`:""}
      <div id="wallet-chooser" class="wallets ${providerChooserVisible?"":"hidden"}" data-mode="${state.connectState.chooserMode}" data-pending-intent="${state.connectState.pendingIntent?"true":"false"}"><button id="ynx" class="primary hidden" type="button">${text("connectYNX")}</button><a id="download" href="${YNX_DOWNLOAD_URL}" class="primary" rel="noreferrer" aria-describedby="download-meta">${text("download")}</a><a id="metamask" href="${METAMASK_DOWNLOAD_URL}" class="secondary" rel="noreferrer">${text("metamask")}</a></div>
      <div id="connection-controls" class="actions ${connectionDetails?"":"hidden"}" data-mode="${state.connectState.chooserMode}"><button id="switch-account" type="button">${text("switchAccount")}</button><button id="disconnect" type="button">${text("disconnect")}</button></div>
      <p id="download-meta" class="download-meta">${text("previewNotice")}</p>
      <details id="platforms" class="platforms"><summary>${text("installDetails")}</summary><a id="android-download" href="${WALLET_DOWNLOAD_MATRIX.android.url}" rel="noreferrer">Android · ${text("download")}</a><details class="package-details"><summary>${text("packageDetails")}</summary><p class="download-meta mono">${escape(WALLET_DOWNLOAD_MATRIX.android.label)} · ${WALLET_DOWNLOAD_MATRIX.android.bytes.toLocaleString("en-US")} Bytes · SHA-256 ${escape(WALLET_DOWNLOAD_MATRIX.android.sha256)} · ${escape(WALLET_DOWNLOAD_MATRIX.android.signingClass)} · productionSigned=false</p></details><div class="platform-grid">${unavailablePlatforms()}</div></details>
      <div class="status ${!state.errorCode&&!state.account?"hidden":""}" id="status" role="status" aria-live="polite"><strong>${text("status")}:</strong> ${statusContent()}</div>
      <details id="network-tools" class="tools"><summary>${text("networkTools")}</summary><div class="actions"><button id="add" type="button">${text("add")}</button><button id="switch" type="button">${text("switch")}</button></div><p class="risk">${text("rpcCheck")}</p></details>
    </section>
    <section class="card transfer-card ${state.account?"":"hidden"}" id="actions" aria-label="${text("walletActions")}">
      <h2>${text("transfer")}</h2>
      <label class="label" for="recipient">${text("recipient")}</label><input id="recipient" class="address" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0x…" value="${escape(state.form.recipient)}" aria-describedby="form-error">
      <label class="label" for="amount">${text("amount")}</label><div class="amount-input"><input id="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escape(state.form.amount)}" ${state.form.useHex?"disabled":""} aria-describedby="amount-hint form-error"><span>YNXT</span></div><p id="amount-hint" class="hint">${text("amountHint")}</p>
      <details id="advanced" class="tools" ${state.form.useHex?"open":""}><summary>${text("advanced")}</summary><label class="check-label"><input id="use-hex" type="checkbox" ${state.form.useHex?"checked":""}>${text("useHex")}</label><label class="label" for="value">${text("value")}</label><input id="value" class="mono" value="${escape(state.form.value)}" inputmode="text" autocomplete="off" ${state.form.useHex?"":"disabled"} aria-describedby="form-error"><label class="label" for="data">${text("data")}</label><textarea id="data" class="mono" spellcheck="false" autocomplete="off" aria-describedby="form-error">${escape(state.form.data)}</textarea></details>
      <p id="form-error" class="form-error hidden" role="alert"></p><p class="fee-note">${text("fees")}: ${text("feesWallet")}</p>
      <button id="send" class="primary send-action" type="button">${text("review")}</button>
      <details class="tools message-tools"><summary>${text("messageTools")}</summary><label class="label" for="message">${text("message")}</label><textarea id="message" maxlength="4096" autocomplete="off">${escape(state.form.message)}</textarea><button id="sign" class="secondary" type="button">${text("sign")}</button></details>
    </section></div><footer><span>${text("testnet")}</span><span>YNX Testnet · 6423 · 0x1917</span></footer>
    <dialog id="review-dialog" aria-labelledby="review-title" aria-describedby="review-note"><h2 id="review-title">${text("reviewTitle")}</h2><div id="review-content"></div><p id="review-note" class="risk">${text("requestOnly")}</p><div class="review-actions"><button id="review-cancel" type="button">${text("cancel")}</button><button id="review-confirm" class="primary" type="button">${text("confirmWallet")}</button></div></dialog></div>`;
  bind();
  applyActionGates();
  presentAvailability(state.providers);
}

function formError(error) {
  const labels = {INVALID_AMOUNT:"invalidAmount",AMOUNT_TOO_LARGE:"amountTooLarge",INVALID_RECIPIENT:"invalidAddress",INVALID_CALLDATA:"invalidData",INVALID_HEX_VALUE:"invalidHex"};
  const node = document.querySelector("#form-error");
  node.textContent = text(labels[error.code] || "requestFailed");
  node.classList.remove("hidden");
  if (["value","data"].includes(error.field)) document.querySelector("#advanced").open = true;
  const input = document.getElementById(error.field);
  input?.setAttribute("aria-invalid","true");
  input?.focus();
}

function closeReview() {
  state.review = null;
  document.querySelector("#review-dialog")?.close();
  document.querySelector("#send")?.focus();
}

function openReview() {
  if (state.busy || !walletActionGates(state.provider,state.account,state.chainId).canSendTransaction) return;
  try {
    const transaction = prepareTransaction({from:state.account,to:state.form.recipient,...state.form});
    state.review = Object.freeze({transaction,provider:state.provider,wallet:state.wallet,account:state.account,chainId:state.chainId,epoch:state.epoch});
    const rows = [[text("wallet"),state.wallet==="ynx"?"YNX Wallet":"MetaMask"],[text("network"),"YNX Testnet · 6423"],[text("sender"),transaction.from],[text("recipient"),transaction.to],[text("amount"),transaction.displayAmount+" YNXT"],[text("fees"),text("feesWallet")]];
    document.querySelector("#review-content").innerHTML = `<dl class="review-facts">${rows.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>${transaction.data!=="0x"?`<details open><summary>${text("data")}</summary><p class="mono address">${escape(transaction.data)}</p></details>`:""}`;
    document.querySelector("#review-dialog").showModal();
    document.querySelector("#review-cancel").focus();
  } catch (error) { formError(error); }
}

async function confirmReview() {
  if (state.busy) return;
  const reviewed = state.review;
  if (!reviewMatchesSession(reviewed,state)) { closeReview();setStatus(text("sessionChanged"),"error");return; }
  closeReview();
  await act(() => sendTransaction(reviewed.provider,reviewed.transaction), (value) => reviewMatchesSession(reviewed,state)?`${text("txHash")}: ${value}`:text("sessionChanged"));
}

function setStatus(message, kind = "info") { state.errorCode=null;const node = document.querySelector("#status"); node.classList.remove("hidden"); node.dataset.kind = kind; node.innerHTML = `<strong>${text("status")}:</strong> ${escape(message)}`; }
function setError(error){state.errorCode=String(error?.code||"REQUEST_FAILED");const node=document.querySelector("#status");node.classList.remove("hidden");node.dataset.kind="error";node.innerHTML=`<strong>${text("status")}:</strong> ${statusContent()}`}
function localizedError(error) { const code=typeof error?.code==="string"||typeof error?.code==="number"?String(error.code):"REQUEST_FAILED"; return `${code}: ${text("requestFailed")}`; }
async function act(work, success) {
  if (state.busy) return null;
  state.busy = true;
  setStatus(text("working"));
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  try { const result = await work(); setStatus(success(result)); return result; }
  catch (error) {
    if (["RPC_UNAVAILABLE","WRONG_NETWORK","INVALID_RPC_RESPONSE"].includes(error?.code)) state.rpcVerified = false;
    if (invalidatesConnectedSession(error)) invalidateConnectedState();
    setError(error);
    return null;
  }
  finally { state.busy = false; for (const button of document.querySelectorAll("button")) button.disabled = button.dataset.permanentDisabled === "true"; applyActionGates(); }
}

function applyActionGates() {
  const gates = walletActionGates(state.provider, state.account, state.chainId, state.rpcVerified);
  const mapping = {add:gates.canAddChain,switch:gates.canSwitchChain,sign:gates.canSign,send:gates.canSendTransaction};
  for (const [id, enabled] of Object.entries(mapping)) {
    const button = document.querySelector(`#${id}`);
    if (!button) continue;
    button.disabled = !enabled || state.busy;
    button.setAttribute("aria-disabled", String(!enabled || state.busy));
  }
  document.querySelector("#network-tools")?.classList.toggle("hidden", !state.provider);
  if (state.busy) for (const button of document.querySelectorAll("button")) button.disabled = true;
}

function invalidateConnectedState() {
  state.review=null;state.epoch+=1;state.form={recipient:"",amount:"",value:"0x0",data:"0x",message:"",useHex:false};
  document.querySelector("#review-dialog")?.close();
  document.querySelector("#actions")?.classList.add("hidden");
  state.account = null;
  state.chainId = null;
  forgetSession();
  state.connectState=reduceStandardWalletConnectState(state.connectState,{type:"DISCONNECT"});
  applyActionGates();
}

function clearConnectedSession() {
  invalidateConnectedState();
  state.errorCode="PROVIDER_DISCONNECTED";render();
}

function bindProviderLifecycle(provider) {
  state.unsubscribeProvider?.();
  state.unsubscribeProvider = subscribeProviderLifecycle(provider, {
    accountsChanged(accounts) {
      if(accounts.length===0)return clearConnectedSession();
      if(state.connectState.status!==STANDARD_WALLET_CONNECT_STATUS.CONNECTED)return;
      state.connectState=reduceStandardWalletConnectState(state.connectState,{type:"ACCOUNTS_CHANGED",accounts});state.account=state.connectState.account;rememberSession({account:state.account,chainId:state.chainId},state.wallet);state.errorCode=null;render();
    },
    chainChanged(chainId) {
      if(!state.account)return;
      state.connectState=reduceStandardWalletConnectState(state.connectState,{type:"CHAIN_CHANGED",chainId});state.chainId=state.connectState.chainId;
      if(chainId!=="0x1917"){forgetSession();state.errorCode="WRONG_NETWORK"}else{rememberSession({account:state.account,chainId},state.wallet);state.errorCode=null}render();
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
  if(state.busy)return;
  const provider = selectProvider(wallet);
  const attemptEpoch=state.epoch;
  const pendingIntent=`connect_${crypto.randomUUID().replaceAll("-","")}`;
  const result = await act(() => connectStandardWallet(provider,wallet,{pendingIntent}), (value) => `${text("connected")} · ${value.session.account}`);
  if (!result) return;
  if(state.provider!==provider||state.epoch!==attemptEpoch){setStatus(text("sessionChanged"),"error");return;}
  state.connectState=result.connectState;state.account=result.session.account;state.chainId=result.session.chainId;state.errorCode=null;rememberSession(result.session,wallet);render();await detect({preserveConnection:true});queueMicrotask(()=>document.querySelector("#wallet-connect-trigger")?.focus());
}

function bind() {
  document.querySelector("#locale").addEventListener("change", (event) => {state.locale = event.target.value; state.preferences=savePreferences(localStorage,state.preferences,{locale:state.locale}); render(); document.querySelector("#locale").focus(); detect({preserveConnection:true}).catch(setError);});
  document.querySelector("#theme").addEventListener("click", () => {state.theme = darkTheme() ? "light" : "dark"; state.preferences=savePreferences(localStorage,state.preferences,{theme:state.theme}); render(); document.querySelector("#theme").focus(); detect({preserveConnection:true}).catch(setError);});
  document.querySelector("#ynx").addEventListener("click", async () => {
    if (state.providers?.ynx) return connect("ynx");
    const result=await companionLifecycle.begin();
    setStatus(`${result.code||result.status}: ${text("requestFailed")}`, "error");
  });
  document.querySelector("#metamask").addEventListener("click", (event) => {
    if(state.busy){event.preventDefault();return;}
    if (state.providers?.metamask) { event.preventDefault(); return connect("metamask"); }
  });
  document.querySelector("#wallet-connect-trigger").addEventListener("click",()=>{state.connectState=reduceStandardWalletConnectState(state.connectState,{type:state.connectState.chooserOpen?"CLOSE_CHOOSER":"OPEN_CHOOSER"});render();document.querySelector("#wallet-connect-trigger")?.focus()});
  document.querySelector("#disconnect")?.addEventListener("click",()=>{clearConnectedSession();detect({preserveConnection:false}).catch(setError);queueMicrotask(()=>document.querySelector("#wallet-connect-trigger")?.focus())});
  document.querySelector("#switch-account")?.addEventListener("click",()=>connect(state.wallet));
  document.querySelector("#add").addEventListener("click", () => act(() => addYNXChain(state.provider), () => text("testnet")));
  document.querySelector("#switch").addEventListener("click", () => act(() => switchToYNXChain(state.provider), () => text("connected")));
  document.querySelector("#sign").addEventListener("click", () => act(() => signMessage(state.provider, state.account, document.querySelector("#message").value), (value) => `${text("signature")}: ${value}`));
  document.querySelector("#send").addEventListener("click", openReview);
  document.querySelector("#review-confirm").addEventListener("click", confirmReview);
  document.querySelector("#review-cancel").addEventListener("click", closeReview);
  document.querySelector("#review-dialog").addEventListener("cancel", (event)=>{event.preventDefault();closeReview()});
  for (const id of ["recipient","amount","value","data","message"]) document.getElementById(id).addEventListener("input", (event)=>{
    state.form[id]=event.target.value;state.review=null;
    event.target.removeAttribute("aria-invalid");document.querySelector("#form-error").classList.add("hidden");
    if(id==="amount"&&!state.form.useHex){try{state.form.value=decimalYNXTToWei(state.form.amount);document.querySelector("#value").value=state.form.value}catch{}}
  });
  document.querySelector("#use-hex").addEventListener("change",(event)=>{state.form.useHex=event.target.checked;state.review=null;document.querySelector("#amount").disabled=state.form.useHex;document.querySelector("#value").disabled=!state.form.useHex});
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
  document.querySelector("#metamask").classList.toggle("hidden", !presentation.showMetaMaskChoice);
  document.querySelector("#metamask").dataset.route = mobile.metaMaskRoute;
  document.querySelector("#metamask").href = mobile.metaMaskHref || METAMASK_DOWNLOAD_URL;
  document.querySelector("#download").classList.toggle("primary", !presentation.ynxPresent && !presentation.metamaskPresent);
  document.querySelector("#download").classList.toggle("secondary", presentation.ynxPresent || presentation.metamaskPresent);
  document.querySelector("#metamask").classList.toggle("primary", presentation.metamaskPresent && !presentation.ynxPresent);
  document.querySelector("#metamask").classList.toggle("secondary", !presentation.metamaskPresent || presentation.ynxPresent);
  document.querySelector("#detected").textContent = !state.discoveryReady?text("checkingWallets"):presentation.ynxPresent ? text("detected") : presentation.metamaskPresent?text("metaMaskReady"):presentation.errorKey==="providerNotInjected"?text("noWalletHelp"):text(presentation.errorKey);
}

async function detect({preserveConnection=false}={}) {
  document.documentElement.dataset.walletDiscovery="checking";
  if(!preserveConnection&&!state.account){state.provider=null;state.wallet=null;state.chainId=null}state.rpcVerified=false;applyActionGates();
  let availability;
  try { availability = isExtension ? await extensionWalletAvailability() : await discoverWallets(); }
  catch (error) { if(!state.account)forgetSession();throw error; }
  state.providers = availability; state.discoveryReady=true; document.documentElement.dataset.walletDiscovery="ready"; presentAvailability(availability);
  if(state.account&&preserveConnection){applyActionGates();return}
  const wallet = resolveRememberedWallet(availability);
  if (wallet) {
    const provider = selectProvider(wallet);
    const restored = await restoreTestnetSession(provider);
    if (restored) { state.connectState=reduceStandardWalletConnectState(createStandardWalletConnectState(),{type:"RESTORE",providerKind:wallet==="ynx"?"ynx-wallet":wallet,accounts:[restored.account],chainId:restored.chainId});state.account = restored.account; state.chainId = restored.chainId;state.errorCode=null;render();setStatus(`${text("connected")} · ${restored.account}`); }
  }
  applyActionGates();
}

const discoveryError=(error)=>localizedError(error);
render(); detect().then(()=>{if(loadedPreferences.status==="rejected")setError({code:"PREFERENCES_REJECTED"})}).catch(setError);
if(!isExtension&&`${location.origin}${location.pathname}`===companionLifecycle.callback&&location.search){
  companionLifecycle.handleReturn(location.href).then((result)=>setStatus(`${result.code||result.status}: ${result.authoritative?text("connected"):text("requestFailed")}`,result.authoritative?"info":"error"));
}
addEventListener("storage",(event)=>{if(event.key!==PREFERENCES_KEY)return;try{const next=acceptPreferenceUpdate(state.preferences,event.newValue);state.preferences=next;state.locale=next.locale;state.theme=next.theme;render();detect({preserveConnection:true}).catch(setError)}catch(error){setError(error)}});
addEventListener("focus",()=>{if(!state.account)detect({preserveConnection:false}).catch(setError)});
const wait=(milliseconds)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function workerVersion(worker){return new Promise(resolve=>{if(!worker){resolve(null);return}const channel=new MessageChannel(),timer=setTimeout(()=>resolve(null),500);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data?.cache||null)};try{worker.postMessage({type:"YNX_WALLET_PWA_VERSION"},[channel.port2])}catch{clearTimeout(timer);resolve(null)}})}
async function waitForV11Worker(registration,timeout=12000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    for(const worker of [registration.installing,registration.waiting,registration.active])if(worker?.state==="activated"&&await workerVersion(worker)===PWA_CACHE)return worker;
    await wait(100);
  }
  throw Object.assign(new Error("YNX Wallet service worker did not activate"),{code:"PWA_SERVICE_WORKER_ACTIVATION_FAILED"});
}
async function waitForV11Controller(timeout=2500){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await workerVersion(navigator.serviceWorker.controller)===PWA_CACHE)return true;await wait(100)}
  return false;
}
async function waitForV11Cache(timeout=5000){
  const deadline=Date.now()+timeout;
  let stableSince=null;
  while(Date.now()<deadline){
    const keys=await caches.keys(),converged=keys.includes(PWA_CACHE)&&obsoletePwaCaches(keys).length===0;
    if(converged){stableSince??=Date.now();if(Date.now()-stableSince>=1000)return true}else stableSince=null;
    await wait(100);
  }
  return false;
}
async function convergePwaServiceWorker(){
  const startingControllerVersion=await workerVersion(navigator.serviceWorker.controller);
  const registration=await navigator.serviceWorker.register("./sw.js",{type:"module",scope:"./"});
  await registration.update();
  await waitForV11Worker(registration);
  const reloadUrl=upgradeNavigationUrl(initialPwaNavigationUrl);
  if(startingControllerVersion!==PWA_CACHE&&reloadUrl){
    location.replace(reloadUrl);
    return {reloading:true};
  }
  if(!await waitForV11Controller())throw Object.assign(new Error("YNX Wallet service worker could not control the page after one reload"),{code:"PWA_SERVICE_WORKER_CONTROL_FAILED"});
  if(!await waitForV11Cache())throw Object.assign(new Error("YNX Wallet service worker left an obsolete cache after activation"),{code:"PWA_SERVICE_WORKER_CACHE_CONVERGENCE_FAILED"});
  return {reloading:false};
}
if(!isExtension&&"serviceWorker" in navigator)convergePwaServiceWorker().then(result=>{if(!result.reloading)document.documentElement.dataset.pwa="ready"}).catch(error=>{document.documentElement.dataset.pwa="failed";setError(error)});
