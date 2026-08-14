import {BRIDGE_VERSION,PROVIDER_EVENTS,REQUEST_METHODS,RUNTIME_EVENT,RUNTIME_REQUEST,publicBridgeError,validateRuntimeRequest} from "./extension-bridge.js";

const extensionApi=globalThis.browser||globalThis.chrome,CHAIN_ID="0x1917",RPC_URL="https://evm.ynxweb4.com";

function pageWalletRequest(preference,input){
  const ethereum=globalThis.ethereum;
  const providers=(Array.isArray(ethereum?.providers)?ethereum.providers:ethereum?[ethereum]:[]).filter((provider)=>provider?.__ynxCompanion!==true);
  const isYNX=(provider)=>{const rdns=String(provider?.providerInfo?.rdns||provider?.rdns||"").toLowerCase();return provider?.isYNXWallet===true||provider?.isYnxWallet===true||rdns==="com.ynx.wallet"||rdns.endsWith(".ynxweb4.com")};
  const ynx=providers.find(isYNX),metamask=providers.find((provider)=>provider?.isMetaMask===true&&!isYNX(provider));
  if(input?.method==="ynx_walletDetected")return{ynx:Boolean(ynx),metamask:Boolean(metamask)};
  const provider=preference==="ynx"?ynx:preference==="metamask"?metamask:ynx||metamask||providers[0];
  if(!provider||typeof provider.request!=="function")throw Object.assign(new Error("No real wallet backend is injected into the DApp."),{code:"WALLET_BACKEND_NOT_FOUND"});
  return provider.request(input);
}
globalThis.__YNX_INTERNAL_PAGE_WALLET_REQUEST__=pageWalletRequest;

async function liveChainId(){
  let response;
  try{response=await fetch(RPC_URL,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]}),signal:AbortSignal.timeout(6000),cache:"no-store",credentials:"omit"})}
  catch(error){throw Object.assign(new Error("YNX Testnet RPC is unavailable."),{code:"RPC_UNAVAILABLE",cause:error})}
  const body=response.ok?await response.json().catch(()=>null):null;
  if(body?.result!==CHAIN_ID)throw Object.assign(new Error("RPC did not prove YNX Testnet chain 6423."),{code:body?.result?"WRONG_NETWORK":"RPC_UNAVAILABLE"});
  return body.result;
}
async function executeInTab(tabId,origin,preference,input){
  const tab=await extensionApi.tabs.get(tabId);
  if(!Number.isInteger(tab?.id)||new URL(tab.url).origin!==origin)throw Object.assign(new Error("The requesting DApp origin changed."),{code:"ORIGIN_CHANGED"});
  const[execution]=await extensionApi.scripting.executeScript({target:{tabId},world:"MAIN",func:pageWalletRequest,args:[preference,input]});return await execution?.result;
}
async function executeActive(preference,input){
  const[tab]=await extensionApi.tabs.query({active:true,currentWindow:true});
  if(!Number.isInteger(tab?.id)||!/^https?:/u.test(tab.url||""))throw Object.assign(new Error("Open an HTTP(S) DApp tab before using this companion."),{code:"UNSUPPORTED_TAB"});
  return executeInTab(tab.id,new URL(tab.url).origin,preference,input);
}
async function emitToTab(tabId,origin,event,payload){if(PROVIDER_EVENTS.includes(event))await extensionApi.tabs.sendMessage(tabId,{type:RUNTIME_EVENT,version:BRIDGE_VERSION,origin,event,payload}).catch(()=>{})}
function exactAccounts(value){if(!Array.isArray(value)||value.some((account)=>!/^0x[0-9a-fA-F]{40}$/u.test(account)))throw Object.assign(new Error("Wallet backend returned invalid accounts."),{code:"INVALID_ACCOUNT"});return value.map((account)=>account.toLowerCase())}
async function handleDappRequest(message,sender){
  const senderUrl=sender?.url||sender?.tab?.url;
  if(!Number.isInteger(sender?.tab?.id)||sender?.frameId!==0||!validateRuntimeRequest(message,senderUrl))throw Object.assign(new Error("Rejected invalid DApp bridge request."),{code:"INVALID_BRIDGE_REQUEST"});
  const tabId=sender.tab.id,origin=message.origin,input={method:message.method,params:message.params};
  if(message.method==="eth_chainId")return liveChainId();
  if(message.method==="ynx_disconnect"){await emitToTab(tabId,origin,"accountsChanged",[]);await emitToTab(tabId,origin,"disconnect",{code:4900,message:"YNX Wallet companion disconnected."});return null}
  let result;
  try{result=await executeInTab(tabId,origin,"any",input)}catch(error){if(message.method==="eth_accounts"&&error?.code==="WALLET_BACKEND_NOT_FOUND")return[];throw error}
  if(message.method==="wallet_addEthereumChain"||message.method==="wallet_switchEthereumChain"){
    const backendChain=await executeInTab(tabId,origin,"any",{method:"eth_chainId"});
    if(backendChain!==CHAIN_ID)throw Object.assign(new Error("Wallet backend remained on the wrong chain."),{code:"WRONG_NETWORK"});await emitToTab(tabId,origin,"chainChanged",CHAIN_ID);
  }
  if(message.method==="eth_requestAccounts"||message.method==="eth_accounts"){result=exactAccounts(result);if(message.method==="eth_requestAccounts")await emitToTab(tabId,origin,"accountsChanged",result)}
  return result;
}

extensionApi.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="YNX_WALLET_DISCOVER"){executeActive("any",{method:"ynx_walletDetected"}).then((result)=>sendResponse(result||{ynx:false,metamask:false})).catch(()=>sendResponse({ynx:false,metamask:false}));return true}
  if(message?.type==="YNX_WALLET_REQUEST"){
    if(!REQUEST_METHODS.includes(message.input?.method)){sendResponse({ok:false,error:{code:4200,message:"Unsupported wallet method."}});return false}
    executeActive(message.preference,message.input).then((result)=>sendResponse({ok:true,result})).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
  }
  if(message?.type!==RUNTIME_REQUEST)return false;
  handleDappRequest(message,sender).then((result)=>sendResponse({ok:true,result})).catch((error)=>sendResponse({ok:false,error:publicBridgeError(error)}));return true;
});
