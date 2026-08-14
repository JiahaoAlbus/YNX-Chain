import {LOCALES, catalog, isRTL} from "./i18n.js";
import {
  YNX_DOWNLOAD_URL, addYNXChain, connectWallet, createExtensionProvider, discoverWallets,
  extensionWalletAvailability, forgetSession, rememberSession, restoreTestnetSession, sendTransaction,
  signMessage, subscribeProviderLifecycle, switchToYNXChain, walletActionGates,
} from "./provider.js";

const app = document.querySelector("#app");
const isExtension = location.protocol === "chrome-extension:" || location.protocol === "moz-extension:";
const preview = new URLSearchParams(location.search);
const requestedLocale = preview.get("lang");
const requestedTheme = preview.get("theme");
const state = {
  locale: LOCALES.some(([locale]) => locale === requestedLocale) ? requestedLocale : localStorage.getItem("ynx.wallet.web.locale") || "en",
  theme: ["light", "dark"].includes(requestedTheme) ? requestedTheme : localStorage.getItem("ynx.wallet.web.theme") || "system",
  provider: null, wallet: null, account: null, chainId: null, unsubscribeProvider: null,
};

function text(key) { return catalog(state.locale)[key] || key; }
function options() { return LOCALES.map(([value, label]) => `<option value="${value}" ${value === state.locale ? "selected" : ""}>${label}</option>`).join(""); }
function escape(value) { const node = document.createElement("span"); node.textContent = String(value); return node.innerHTML; }

function render() {
  document.documentElement.lang = state.locale;
  document.documentElement.dir = isRTL(state.locale) ? "rtl" : "ltr";
  document.documentElement.dataset.theme = state.theme === "system" ? "" : state.theme;
  app.innerHTML = `<div class="shell">
    <header><div class="brand"><img src="./ynx-logo.png" alt="YNX"><p class="eyebrow">${text("eyebrow")}</p></div>
      <div class="controls"><label><span class="hidden">${text("language")}</span><select id="locale" aria-label="${text("language")}">${options()}</select></label><button id="theme" type="button">${state.theme === "dark" ? text("light") : text("dark")}</button></div></header>
    <section aria-labelledby="title"><h1 id="title">${text("title")}</h1><p class="intro">${text("intro")}</p></section>
    <section class="card" aria-label="Wallet connection"><div id="detected" class="eyebrow">${text("unavailable")}</div>
      <div class="wallets"><button id="ynx" class="primary hidden" type="button">${text("connectYNX")}</button><a id="download" href="${YNX_DOWNLOAD_URL}" class="secondary" rel="noreferrer">${text("download")}</a><button id="metamask" class="secondary" type="button">${text("metamask")}</button></div>
      <div class="status" id="status" role="status" aria-live="polite"><strong>${text("status")}:</strong> ${state.account ? `${text("connected")} · <span class="mono">${escape(state.account)}</span>` : text("disconnected")}</div>
      <p class="risk">${text("rpcCheck")} ${text("testnet")}</p>
    </section>
    <section class="card" id="actions" aria-label="Wallet actions">
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
async function act(work, success) {
  setStatus(text("working"));
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  try { const result = await work(); setStatus(success(result)); return result; }
  catch (error) { setStatus(`${error?.code ? `${error.code}: ` : ""}${error?.message || "Request failed closed."}`, "error"); return null; }
  finally { for (const button of document.querySelectorAll("button")) button.disabled = false; applyActionGates(); }
}

function applyActionGates() {
  const gates = walletActionGates(state.provider, state.account, state.chainId);
  const mapping = {add:gates.canAddChain,switch:gates.canSwitchChain,sign:gates.canSign,send:gates.canSendTransaction};
  for (const [id, enabled] of Object.entries(mapping)) {
    const button = document.querySelector(`#${id}`);
    if (!button) continue;
    button.disabled = !enabled;
    button.setAttribute("aria-disabled", String(!enabled));
  }
}

function clearConnectedSession() {
  state.account = null;
  state.chainId = null;
  forgetSession();
  applyActionGates();
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
  document.querySelector("#locale").addEventListener("change", (event) => {state.locale = event.target.value; localStorage.setItem("ynx.wallet.web.locale", state.locale); render(); detect();});
  document.querySelector("#theme").addEventListener("click", () => {state.theme = state.theme === "dark" ? "light" : "dark"; localStorage.setItem("ynx.wallet.web.theme", state.theme); render(); detect();});
  document.querySelector("#ynx").addEventListener("click", () => connect("ynx"));
  document.querySelector("#metamask").addEventListener("click", () => connect("metamask"));
  document.querySelector("#add").addEventListener("click", () => act(() => addYNXChain(state.provider), () => text("testnet")));
  document.querySelector("#switch").addEventListener("click", () => act(() => switchToYNXChain(state.provider), () => text("connected")));
  document.querySelector("#sign").addEventListener("click", () => act(() => signMessage(state.provider, state.account, document.querySelector("#message").value), (value) => `${text("signature")}: ${value}`));
  document.querySelector("#send").addEventListener("click", () => act(() => sendTransaction(state.provider, {from: state.account, to: document.querySelector("#recipient").value.trim(), value: document.querySelector("#value").value.trim(), data: document.querySelector("#data").value.trim()}), (value) => `${text("txHash")}: ${value}`));
}

async function detect() {
  const availability = isExtension ? await extensionWalletAvailability() : await discoverWallets();
  state.providers = availability;
  const ynxPresent = Boolean(availability.ynx);
  const metamaskPresent = Boolean(availability.metamask);
  document.querySelector("#ynx").classList.toggle("hidden", !ynxPresent);
  document.querySelector("#download").classList.toggle("hidden", ynxPresent);
  document.querySelector("#metamask").classList.toggle("hidden", ynxPresent);
  document.querySelector("#detected").textContent = ynxPresent ? text("detected") : text("unavailable");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("ynx.wallet.web.session.v1") || "null"); }
  catch { localStorage.removeItem("ynx.wallet.web.session.v1"); }
  const wallet = saved?.wallet === "ynx" && ynxPresent ? "ynx" : saved?.wallet === "metamask" && metamaskPresent ? "metamask" : null;
  if (wallet) {
    const provider = selectProvider(wallet);
    const restored = await restoreTestnetSession(provider);
    if (restored) { state.account = restored.account; state.chainId = restored.chainId; applyActionGates(); setStatus(`${text("connected")} · ${restored.account}`); }
  }
}

render(); detect().catch((error) => setStatus(error?.message || "Wallet detection failed closed.", "error"));
if (!isExtension && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
