import { WALLET_LINKS, connectWallet } from "./wallet-provider.js";

const byId = (id) => document.getElementById(id);
const state = { provider: null, account: null };

function shortAccount(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function showStatus(message, tone = "neutral") {
  const region = byId("wallet-status");
  region.textContent = message;
  region.dataset.tone = tone;
}

function setConnected(result) {
  state.provider = result.provider;
  state.account = result.account;
  byId("wallet-dialog").close();
  byId("connect-wallet").textContent = shortAccount(result.account);
  byId("connected-account").textContent = result.account;
  byId("connected-panel").hidden = false;
  showStatus("Standard wallet connection is active. Private Social features remain locked until a separate YNX Product Session is approved.", "success");
}

function notFound(wallet) {
  const label = wallet === "ynx" ? "YNX Wallet" : "MetaMask";
  const link = wallet === "ynx" ? WALLET_LINKS.ynx : WALLET_LINKS.metamask;
  showStatus(`${label} was not detected in this browser. Install it, then retry from this page.`, "warning");
  const action = byId("install-wallet");
  action.href = link;
  action.textContent = `Install ${label}`;
  action.hidden = false;
}

async function connect(wallet, button) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  byId("install-wallet").hidden = true;
  try {
    const result = await connectWallet(wallet);
    if (result.ok) setConnected(result);
    else if (result.code === "YNX_WALLET_NOT_FOUND" || result.code === "METAMASK_NOT_FOUND") notFound(wallet);
    else showStatus(`${result.code}: Select one wallet provider and try again.`, "warning");
  } catch (error) {
    const rejected = Number(error?.code) === 4001;
    showStatus(rejected ? "Connection request was rejected. No Social session was created." : "Wallet connection failed. No account or Social session was saved.", "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

byId("connect-wallet").addEventListener("click", () => byId("wallet-dialog").showModal());
byId("close-wallet-dialog").addEventListener("click", () => byId("wallet-dialog").close());
byId("connect-ynx").addEventListener("click", (event) => void connect("ynx", event.currentTarget));
byId("connect-metamask").addEventListener("click", (event) => void connect("metamask", event.currentTarget));

async function readService() {
  const status = byId("service-status");
  try {
    const response = await fetch("https://api.ynxweb4.com/social/health", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    status.textContent = "Social service reachable";
    status.dataset.tone = "success";
  } catch {
    status.textContent = "Private Social service degraded — guest preview is still available";
    status.dataset.tone = "warning";
  }
}

void readService();
