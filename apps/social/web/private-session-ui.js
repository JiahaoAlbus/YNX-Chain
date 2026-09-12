import { createSocialPrivateSession } from "./private-session.js";

const privateSession = createSocialPrivateSession();
const status = document.getElementById("private-auth-status");
const account = document.getElementById("private-auth-account");
const openWallet = document.getElementById("private-auth-open");
const buttons = ["private-auth-begin", "private-auth-restore", "private-auth-disconnect"].map(id => document.getElementById(id));

function render(result) {
  openWallet.hidden = true;
  openWallet.removeAttribute("href");
  account.textContent = result.status === "connected" ? `Linked identity: ${result.session.account}` : "No confirmed private identity link.";
  status.textContent = result.status === "connected" ? "Identity link verified. Messaging and payments require separate supported permissions." : result.message || `Private session: ${result.status}`;
  if (result.route?.status === "ready") {
    const url = new URL(result.route.url);
    if (url.protocol !== "ynxwallet:" || url.hostname !== "authorize") throw new Error("Unexpected Wallet launch route.");
    openWallet.href = url.href;
    openWallet.hidden = false;
    status.textContent += " Use Open YNX Wallet when you are ready to approve. No window opens automatically.";
  }
}

async function perform(action) {
  for (const button of buttons) button.disabled = true;
  status.textContent = "Checking private Social identity...";
  try { render(await action()); }
  catch (error) {
    account.textContent = "Private identity could not be confirmed.";
    openWallet.hidden = true;
    openWallet.removeAttribute("href");
    status.textContent = error?.code === "WALLET_LAUNCH_UNVERIFIED" ? error.message : "Private Social identity is unavailable or needs Retry. Existing standard wallet connection is unchanged.";
  } finally { for (const button of buttons) button.disabled = false; }
}

buttons[0].addEventListener("click", () => void perform(() => privateSession.begin()));
buttons[1].addEventListener("click", () => void perform(() => privateSession.restore()));
buttons[2].addEventListener("click", () => void perform(() => privateSession.disconnect()));
// Only the registered return path completes a pending request. Ordinary guest
// loads never initialize device keys, begin a session or sign an API proof.
if (location.pathname === "/wallet-auth/callback") {
  void perform(async () => {
    const result = await privateSession.handleReturn(location.href);
    // The SDK has consumed or durably retained the callback before removing it
    // from browser history; failed initialization leaves it available for Retry.
    history.replaceState(null, "", "/wallet-auth/callback");
    return result;
  });
}
