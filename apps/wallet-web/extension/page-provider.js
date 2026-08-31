(() => {
  "use strict";
  const expectedOrigin=location.origin;if(location.protocol!=="https:"||globalThis.__YNX_COMPANION_PROVIDER_V1__)return;
  const PAGE_REQUEST="YNX_PAGE_REQUEST_V1",PAGE_RESPONSE="YNX_PAGE_RESPONSE_V1",PAGE_EVENT="YNX_PAGE_EVENT_V1",VERSION=1,TIMEOUT_MS=120000;
  const METHODS=new Set(["eth_chainId","eth_accounts","eth_requestAccounts","wallet_getPermissions","wallet_requestPermissions","wallet_addEthereumChain","wallet_switchEthereumChain","wallet_revokePermissions","personal_sign","eth_signTypedData_v4","eth_sendTransaction","ynx_disconnect","eth_blockNumber","eth_call","eth_estimateGas","eth_gasPrice","eth_getBalance","eth_getBlockByHash","eth_getBlockByNumber","eth_getCode","eth_getLogs","eth_getStorageAt","eth_getTransactionByHash","eth_getTransactionCount","eth_getTransactionReceipt","eth_maxPriorityFeePerGas","net_version","web3_clientVersion"]),EVENTS=new Set(["connect","accountsChanged","chainChanged","disconnect"]),pending=new Map(),listeners=new Map();
  const emit=(event,payload)=>{for(const listener of listeners.get(event)||[]){try{listener(payload)}catch{}}};
  function bridgeRequest(input){
    if(!input||typeof input!=="object"||!METHODS.has(input.method)||(input.params!==undefined&&!Array.isArray(input.params)))return Promise.reject(Object.assign(new Error("Unsupported or malformed wallet method."),{code:4200}));
    const id=`ynx-${crypto.randomUUID()}`;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error("Wallet extension request timed out."),{code:"BRIDGE_TIMEOUT"}))},TIMEOUT_MS);pending.set(id,{resolve,reject,timer});window.postMessage({type:PAGE_REQUEST,version:VERSION,requestId:id,origin:expectedOrigin,method:input.method,params:input.params},expectedOrigin)});
  }
  window.addEventListener("message",(event)=>{
    if(event.source!==window||event.origin!==expectedOrigin||event.data?.origin!==expectedOrigin||event.data?.version!==VERSION)return;
    if(event.data.type===PAGE_RESPONSE){const item=pending.get(event.data.requestId);if(!item)return;pending.delete(event.data.requestId);clearTimeout(item.timer);if(event.data.ok===true)item.resolve(event.data.result);else item.reject(Object.assign(new Error(event.data.error?.message||"Wallet request failed closed."),{code:event.data.error?.code||"PROVIDER_REQUEST_FAILED"}))}
    else if(event.data.type===PAGE_EVENT&&EVENTS.has(event.data.event))emit(event.data.event,event.data.payload);
  });
  const provider=Object.freeze({
    isYNXWallet:true,isYnxWallet:true,isMetaMask:false,__ynxCompanion:true,
    providerInfo:Object.freeze({uuid:"6f4e2a77-7878-4f29-9c0d-191700000001",name:"YNX Wallet",icon:"__YNX_PROVIDER_ICON_DATA_URI__",rdns:"com.ynx.wallet"}),
    request:bridgeRequest,disconnect:()=>bridgeRequest({method:"ynx_disconnect"}),
    on(event,listener){if(EVENTS.has(event)&&typeof listener==="function"){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(listener)}return provider},
    removeListener(event,listener){listeners.get(event)?.delete(listener);return provider},
  });
  Object.defineProperty(globalThis,"__YNX_COMPANION_PROVIDER_V1__",{value:provider});
  // EIP-6963 is the authority for coexistence.  Legacy window.ethereum may be
  // sealed by another wallet, so a best-effort legacy attachment must never
  // prevent this provider from announcing itself.
  try{
    const existing=window.ethereum;
    if(!existing)Object.defineProperty(window,"ethereum",{value:provider,configurable:false,enumerable:true,writable:false});
    else{const providers=Array.isArray(existing.providers)?existing.providers:[existing];if(!providers.includes(provider))providers.push(provider);if(!Array.isArray(existing.providers))Object.defineProperty(existing,"providers",{value:providers,configurable:true});}
  }catch{}
  const announcement=Object.freeze({info:provider.providerInfo,provider});
  const announce=()=>window.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:announcement}));
  window.addEventListener("eip6963:requestProvider",announce);
  queueMicrotask(announce);
})();
