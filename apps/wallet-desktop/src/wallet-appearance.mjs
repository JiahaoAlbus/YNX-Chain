export const WALLET_APPEARANCE_KEY = "ynx-wallet-ui-size-v1";
export const WALLET_UI_SIZES = Object.freeze(["compact", "standard", "larger"]);
export function parseWalletAppearance(raw) {
  try {
    const value = JSON.parse(raw);
    return value?.version === 1 && WALLET_UI_SIZES.includes(value.size) && Object.keys(value).sort().join(",") === "size,version" ? value.size : "standard";
  } catch { return "standard"; }
}

/** Public display preference only. Never touches native custody or account data. */
export function initWalletAppearance({ document, getStorage = () => null }) {
  const sheet = document.querySelector("#appearance-sheet");
  const inputs = [...document.querySelectorAll('input[name="wallet-ui-size"]')];
  const status = document.querySelector("#appearance-status");
  const apply = size => {
    document.documentElement.dataset.walletUiSize = size;
    for (const input of inputs) input.checked = input.value === size;
  };
  let initial = "standard";
  try { initial = parseWalletAppearance(getStorage()?.getItem(WALLET_APPEARANCE_KEY)); } catch {}
  apply(initial);
  document.querySelector("#open-appearance").addEventListener("click", () => { if (!sheet.open) sheet.showModal(); });
  document.querySelector("#close-appearance").addEventListener("click", () => sheet.close());
  for (const input of inputs) input.addEventListener("change", () => {
    if (!input.checked || !WALLET_UI_SIZES.includes(input.value)) return;
    apply(input.value);
    try {
      const storage = getStorage();
      if (!storage) throw new Error("Unavailable display preferences");
      storage.setItem(WALLET_APPEARANCE_KEY, JSON.stringify({ version: 1, size: input.value }));
      status.textContent = "Text size saved on this device.";
    } catch { status.textContent = "Text size changed for this window. It could not be saved on this device."; }
  });
  return Object.freeze({ size: () => document.documentElement.dataset.walletUiSize });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initWalletAppearance({ document, getStorage: () => window.localStorage });
}
