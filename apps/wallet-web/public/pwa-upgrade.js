const output=document.querySelector("#recovery");
const cachePrefix="ynx-wallet-web-v";

async function recover() {
  try {
    const phase=new URLSearchParams(location.search).get("phase");
    if (phase!=="register") {
      const registration=await navigator.serviceWorker?.getRegistration();
      await registration?.unregister();
      await Promise.all((await caches.keys()).filter((name)=>name.startsWith(cachePrefix)).map((name)=>caches.delete(name)));
      localStorage.removeItem("ynx.wallet.web.session.v1");
      sessionStorage.removeItem("ynx.wallet.web.pwa.schema.7.reloaded");
      location.replace("./pwa-upgrade.html?phase=register");
      return;
    }
    const next=await navigator.serviceWorker?.register("./sw-v7.js?schema=7",{type:"module",updateViaCache:"none"});
    if (!next) throw new Error("PWA worker registration is unavailable");
    location.replace("./?pwa-recovered=7");
  } catch (error) {
    output.dataset.recoveryError=error instanceof Error?error.message:"unknown";
    output.textContent="YNX Wallet recovery could not complete. Reload this page while online.";
  }
}

void recover();
