const extensionApi = globalThis.browser || globalThis.chrome;

function pageWalletRequest(preference, input) {
  const ethereum = globalThis.ethereum;
  const providers = Array.isArray(ethereum?.providers) ? ethereum.providers : ethereum ? [ethereum] : [];
  const isYNX = (provider) => provider?.isYNXWallet === true || provider?.isYnxWallet === true ||
    String(provider?.providerInfo?.rdns || provider?.rdns || "").toLowerCase().includes("ynx");
  const ynx = providers.find(isYNX);
  const metamask = providers.find((provider) => provider?.isMetaMask === true && !isYNX(provider));
  if (input?.method === "ynx_walletDetected") return {ynx: Boolean(ynx), metamask: Boolean(metamask)};
  const provider = preference === "ynx" ? ynx : preference === "metamask" ? metamask : ynx || metamask || providers[0];
  if (!provider || typeof provider.request !== "function") throw Object.assign(new Error("The selected wallet is not injected into the active tab."), {code: "WALLET_NOT_FOUND"});
  return provider.request(input);
}

async function execute(preference, input) {
  const [tab] = await extensionApi.tabs.query({active: true, currentWindow: true});
  if (!Number.isInteger(tab?.id) || !/^https?:/.test(tab.url || "")) throw Object.assign(new Error("Open an HTTPS DApp tab before using this companion."), {code: "UNSUPPORTED_TAB"});
  const [execution] = await extensionApi.scripting.executeScript({target: {tabId: tab.id}, world: "MAIN", func: pageWalletRequest, args: [preference, input]});
  return await execution?.result;
}

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "YNX_WALLET_DISCOVER") {
    execute("any", {method: "ynx_walletDetected"})
      .then((result) => sendResponse(result || {ynx: false, metamask: false}))
      .catch(() => sendResponse({ynx: false, metamask: false}));
    return true;
  }
  if (message?.type !== "YNX_WALLET_REQUEST") return false;
  execute(message.preference, message.input)
    .then((result) => sendResponse({ok: true, result}))
    .catch((error) => sendResponse({ok: false, error: {code: error?.code || "PROVIDER_REQUEST_FAILED", message: error?.message || "Wallet request failed closed."}}));
  return true;
});
