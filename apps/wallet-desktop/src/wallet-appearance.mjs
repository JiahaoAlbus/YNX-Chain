import {initWalletLocale,setWalletCopy} from "./wallet-locale.mjs";
import {mountWalletBuildInfo} from './wallet-build-info-ui.mjs';
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
  const opener=document.querySelector("#open-appearance");
  document.querySelector("#close-appearance").addEventListener("click", () => sheet.close());
  // Explicit restoration also covers browser versions whose native dialog
  // close does not return focus after an RTL/locale display change.
  sheet.addEventListener("close",()=>opener.focus?.());
  for (const input of inputs) input.addEventListener("change", () => {
    if (!input.checked || !WALLET_UI_SIZES.includes(input.value)) return;
    apply(input.value);
    try {
      const storage = getStorage();
      if (!storage) throw new Error("Unavailable display preferences");
      const raw=JSON.stringify({ version: 1, size: input.value });storage.setItem(WALLET_APPEARANCE_KEY,raw);
      if(storage.getItem(WALLET_APPEARANCE_KEY)!==raw)throw Error("Display preference readback failed");
      setWalletCopy(status,"Text size saved on this device.");
    } catch { setWalletCopy(status,"Text size changed for this window. It could not be saved on this device."); }
  });
  return Object.freeze({ size: () => document.documentElement.dataset.walletUiSize });
}

export const WALLET_THEME_KEY='ynx-wallet-theme-v1';
export function parseWalletTheme(raw){try{const v=JSON.parse(raw);if(v?.version===1&&['light','dark','system'].includes(v.theme)&&Object.keys(v).sort().join(',')==='theme,version')return v.theme;}catch{}return 'light';}
export function initWalletTheme({document,getStorage=()=>null,matchMedia=()=>null}){
 const radios=[...document.querySelectorAll('input[name="wallet-theme"]')],status=document.querySelector('#appearance-status');let theme='light';try{theme=parseWalletTheme(getStorage()?.getItem(WALLET_THEME_KEY));}catch{}
 const media=matchMedia('(prefers-color-scheme: dark)');
 const apply=()=>{document.documentElement.dataset.theme=theme==='system'?(media?.matches?'dark':'light'):theme;for(const radio of radios)radio.checked=radio.value===theme;};
 apply();media?.addEventListener?.('change',()=>{if(theme==='system')apply();});
 for(const radio of radios)radio.addEventListener('change',()=>{if(!radio.checked||!['light','dark','system'].includes(radio.value))return;theme=radio.value;apply();try{const store=getStorage(),raw=JSON.stringify({version:1,theme});if(!store)throw Error();store.setItem(WALLET_THEME_KEY,raw);if(store.getItem(WALLET_THEME_KEY)!==raw)throw Error();if(status)status.textContent=document.documentElement.lang?.startsWith('zh')?'主题已保存在此设备。':'Theme saved on this device.';}catch{if(status)status.textContent=document.documentElement.lang?.startsWith('zh')?'主题已应用于当前窗口，未能保存。':'Theme applied to this window; saving unavailable.';}});
 return Object.freeze({theme:()=>theme});
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if(document.querySelector("#wallet-language"))initWalletLocale({document,getStorage:()=>window.localStorage,systemLanguages:window.navigator?.languages??[]});
  initWalletAppearance({ document, getStorage: () => window.localStorage });
  initWalletTheme({document,getStorage:()=>window.localStorage,matchMedia:query=>window.matchMedia?.(query)});
  mountWalletBuildInfo({document,readInfo:()=>window.ynxWallet.appInfo()});
}
