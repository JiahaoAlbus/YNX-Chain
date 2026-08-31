(() => {
  "use strict";
  if(location.protocol!=="https:"||globalThis.__YNX_CONTENT_BRIDGE_V1__===true)return;
  Object.defineProperty(globalThis,"__YNX_CONTENT_BRIDGE_V1__",{value:true});
  const PAGE_REQUEST="YNX_PAGE_REQUEST_V1",PAGE_RESPONSE="YNX_PAGE_RESPONSE_V1",PAGE_EVENT="YNX_PAGE_EVENT_V1",RUNTIME_REQUEST="YNX_DAPP_REQUEST_V1",RUNTIME_EVENT="YNX_DAPP_EVENT_V1",VERSION=1,TIMEOUT_MS=120000;
  const METHODS=new Set(["eth_chainId","eth_accounts","eth_requestAccounts","wallet_getPermissions","wallet_requestPermissions","wallet_addEthereumChain","wallet_switchEthereumChain","wallet_revokePermissions","personal_sign","eth_signTypedData_v4","eth_sendTransaction","ynx_disconnect","eth_blockNumber","eth_call","eth_estimateGas","eth_gasPrice","eth_getBalance","eth_getBlockByHash","eth_getBlockByNumber","eth_getCode","eth_getLogs","eth_getStorageAt","eth_getTransactionByHash","eth_getTransactionCount","eth_getTransactionReceipt","eth_maxPriorityFeePerGas","net_version","web3_clientVersion"]);
  const EVENTS=new Set(["connect","accountsChanged","chainChanged","disconnect"]),pending=new Set(),requestIdPattern=/^ynx-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,targetOrigin=location.origin;
  const reply=(requestId,response)=>window.postMessage({type:PAGE_RESPONSE,version:VERSION,requestId,origin:targetOrigin,...response},targetOrigin);
  window.addEventListener("message",(event)=>{
    const data=event.data;
    if(event.source!==window||event.origin!==targetOrigin||data?.type!==PAGE_REQUEST||data?.version!==VERSION)return;
    if(data.origin!==targetOrigin||!requestIdPattern.test(data.requestId||"")||!METHODS.has(data.method)||(data.params!==undefined&&!Array.isArray(data.params))||pending.has(data.requestId))return;
    pending.add(data.requestId);
    const timer=setTimeout(()=>{if(pending.delete(data.requestId))reply(data.requestId,{ok:false,error:{code:"BRIDGE_TIMEOUT",message:"Wallet extension request timed out."}})},TIMEOUT_MS);
    chrome.runtime.sendMessage({type:RUNTIME_REQUEST,version:VERSION,requestId:data.requestId,origin:targetOrigin,method:data.method,params:data.params,deadlineAt:Date.now()+TIMEOUT_MS})
      .then((response)=>{if(!pending.delete(data.requestId))return;clearTimeout(timer);reply(data.requestId,response?.ok===true?{ok:true,result:response.result}:{ok:false,error:response?.error||{code:"PROVIDER_REQUEST_FAILED",message:"Wallet request failed closed."}})})
      .catch(()=>{if(!pending.delete(data.requestId))return;clearTimeout(timer);reply(data.requestId,{ok:false,error:{code:"RUNTIME_UNAVAILABLE",message:"Wallet extension runtime is unavailable."}})});
  });
  chrome.runtime.onMessage.addListener((message)=>{
    if(message?.type!==RUNTIME_EVENT||message.version!==VERSION||message.origin!==targetOrigin||!EVENTS.has(message.event))return;
    window.postMessage({type:PAGE_EVENT,version:VERSION,origin:targetOrigin,event:message.event,payload:message.payload},targetOrigin);
  });
})();
