/** Product-side listener lifetime helper. It owns no Wallet protocol state. */
export function bindWalletProviderEvents(provider,handlers){
  if(!provider||typeof provider.on!=='function')return ()=>{};
  const listeners=Object.freeze({accountsChanged:handlers.accountsChanged,chainChanged:handlers.chainChanged,disconnect:handlers.disconnect});
  for(const [event,listener] of Object.entries(listeners))provider.on(event,listener);
  let detached=false;
  return ()=>{if(detached)return;detached=true;for(const [event,listener] of Object.entries(listeners)){try{if(typeof provider.removeListener==='function')provider.removeListener(event,listener);else if(typeof provider.off==='function')provider.off(event,listener)}catch{}}};
}
